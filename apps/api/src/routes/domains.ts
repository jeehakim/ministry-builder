import { and, asc, count, eq, isNull, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { requireSiteRole } from "../access";
import {
  CloudflareError,
  createCustomHostname,
  deleteCustomHostname,
  getCustomHostname,
  isCloudflareConfigured,
  type CustomHostname,
} from "../cloudflare";
import { domains, organizations, sites, type Domain } from "../db/schema";
import { DnsLookupError, lookupTxt } from "../dns";
import { orgEventInsert, recordOrgEvent } from "../events";
import { newId } from "../ids";
import { limitsFor } from "../limits";
import { logError, requestIdOf } from "../log";
import type { AppEnv, Bindings } from "../types";

const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
/** Zones the platform owns: customers never attach a hostname under them. */
const PLATFORM_ZONES = ["shofar.io", "shofar.ai"];
/** A domain whose ownership was never proved is forgotten after this long, so the hostname can be claimed by its real owner. */
export const UNVERIFIED_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Label of the TXT record that proves ownership: `_ministry-verify.<hostname>`. */
export const VERIFY_RECORD_PREFIX = "_ministry-verify";
/** Prefix of the TXT value, so the record is recognisable next to other verification records. */
export const VERIFY_VALUE_PREFIX = "ministry-verify=";

/** Normalizes user input to a bare lowercase hostname, or null when it is not a usable domain name. */
export function normalizeHostname(input: string): string | null {
  let host = input.trim().toLowerCase();
  host = host.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/\.$/, "");
  if (host.length === 0 || host.length > 253) return null;
  const labels = host.split(".");
  // At least a registrable domain (two labels) and a TLD that is not all digits (an IP address).
  if (labels.length < 2 || !labels.every((l) => DNS_LABEL.test(l))) return null;
  if (/^\d+$/.test(labels[labels.length - 1]!)) return null;
  if (PLATFORM_ZONES.some((zone) => host === zone || host.endsWith(`.${zone}`))) return null;
  return host;
}

export function cnameTargetFor(env: Pick<Bindings, "CUSTOM_HOSTNAME_CNAME_TARGET" | "PUBLIC_SITES_HOST">): string {
  return env.CUSTOM_HOSTNAME_CNAME_TARGET || env.PUBLIC_SITES_HOST;
}

/** 128 random bits as hex: unguessable, and plain enough to paste into a DNS record. */
export function newVerificationToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function verificationRecordName(hostname: string): string {
  return `${VERIFY_RECORD_PREFIX}.${hostname}`;
}

export function verificationRecordValue(token: string): string {
  return `${VERIFY_VALUE_PREFIX}${token}`;
}

/** True when one of the TXT strings published at the record carries the domain's token (with or without the prefix). */
export function txtProvesOwnership(records: readonly string[], token: string): boolean {
  if (!token) return false;
  return records.some((r) => r === token || r === verificationRecordValue(token));
}

/**
 * A domain serves its site only once all three hold: the owner proved control of the DNS zone (TXT),
 * Cloudflare saw the CNAME and marked the hostname active, and the certificate is deployed.
 */
export function isDomainActive(domain: Pick<Domain, "ownershipVerifiedAt" | "verifiedAt" | "sslStatus">): boolean {
  return domain.ownershipVerifiedAt !== null && domain.verifiedAt !== null && domain.sslStatus === "active";
}

/** The domain as the API reports it, with the DNS records the customer must create. */
export function domainView(domain: Domain, cnameTarget: string) {
  return {
    id: domain.id,
    hostname: domain.hostname,
    kind: domain.kind,
    sslStatus: domain.sslStatus,
    /** Set once the ownership TXT record was seen. Until then Cloudflare is not involved at all. */
    ownershipVerifiedAt: domain.ownershipVerifiedAt?.toISOString() ?? null,
    /** Set once Cloudflare reports the hostname active (the CNAME points at us). */
    verifiedAt: domain.verifiedAt?.toISOString() ?? null,
    /** True once ownership is proved, the hostname is verified and its certificate is deployed: the domain serves the site. */
    active: isDomainActive(domain),
    /** Ownership proof, checked by "refresh". Unverified domains are removed after UNVERIFIED_TTL_MS. */
    txt: { type: "TXT", name: verificationRecordName(domain.hostname), value: verificationRecordValue(domain.verificationToken) },
    /** Routing, which Cloudflare checks once the hostname exists there. */
    dns: { type: "CNAME", name: domain.hostname, target: cnameTarget },
    expiresAt: domain.ownershipVerifiedAt ? null : new Date(domain.createdAt.getTime() + UNVERIFIED_TTL_MS).toISOString(),
    createdAt: domain.createdAt.toISOString(),
  };
}

const CreateBody = z.object({
  hostname: z.string().min(1).max(260),
  kind: z.enum(["primary", "redirect"]).default("primary"),
});

function isUniqueViolation(err: unknown): boolean {
  const text = err instanceof Error ? `${err.message} ${String(err.cause ?? "")}` : String(err);
  return text.includes("UNIQUE constraint failed");
}

/** Maps a Cloudflare custom hostname onto the columns we keep for it. */
function statusPatch(remote: CustomHostname, previous: Domain, now: Date) {
  const verifiedAt = remote.status === "active" ? (previous.verifiedAt ?? now) : null;
  return { cfCustomHostnameId: remote.id, sslStatus: remote.sslStatus, verifiedAt, updatedAt: now };
}

/**
 * Forgets domains whose ownership was never proved within UNVERIFIED_TTL_MS, for every site. Runs
 * before a list or an add, so a squatted hostname frees itself without a scheduled job. Such rows
 * normally have no Cloudflare side; one that does (older data) is removed there on a best-effort basis.
 */
export async function expireUnverifiedDomains(db: DrizzleD1Database, env: Bindings, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - UNVERIFIED_TTL_MS);
  const stale = await db
    .select({ id: domains.id, cfCustomHostnameId: domains.cfCustomHostnameId })
    .from(domains)
    .where(and(isNull(domains.ownershipVerifiedAt), lt(domains.createdAt, cutoff)));
  if (stale.length === 0) return 0;
  if (isCloudflareConfigured(env)) {
    for (const row of stale) {
      if (row.cfCustomHostnameId) await deleteCustomHostname(env, row.cfCustomHostnameId).catch(() => undefined);
    }
  }
  await db.delete(domains).where(and(isNull(domains.ownershipVerifiedAt), lt(domains.createdAt, cutoff)));
  return stale.length;
}

/** Domains attached to any site in an organization the user owns. */
async function domainsOwnedBy(db: DrizzleD1Database, userId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(domains)
    .innerJoin(sites, eq(domains.siteId, sites.id))
    .innerJoin(organizations, eq(sites.orgId, organizations.id))
    .where(eq(organizations.ownerUserId, userId));
  return row?.n ?? 0;
}

export const domainRoutes = new Hono<AppEnv>();

domainRoutes.get("/sites/:id/domains", async (c) => {
  const db = drizzle(c.env.DB);
  const access = await requireSiteRole(c, db, c.req.param("id"), "viewer");
  if (access instanceof Response) return access;
  const { site } = access;
  await expireUnverifiedDomains(db, c.env);
  const rows = await db.select().from(domains).where(eq(domains.siteId, site.id)).orderBy(asc(domains.createdAt));
  const target = cnameTargetFor(c.env);
  return c.json({
    domains: rows.map((row) => domainView(row, target)),
    cnameTarget: target,
    enabled: isCloudflareConfigured(c.env),
  });
});

domainRoutes.post(
  "/sites/:id/domains",
  bodyLimit({ maxSize: 4 * 1024, onError: (c) => c.json({ error: "Body too large" }, 413) }),
  async (c) => {
    const db = drizzle(c.env.DB);
    const access = await requireSiteRole(c, db, c.req.param("id"), "admin");
    if (access instanceof Response) return access;
    const { site } = access;
    if (!isCloudflareConfigured(c.env)) return c.json({ error: "Custom domains are not enabled on this server" }, 503);

    const parsed = CreateBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "hostname is required; kind must be primary or redirect" }, 400);
    const hostname = normalizeHostname(parsed.data.hostname);
    if (!hostname) return c.json({ error: "Enter a domain name you own, like example.org or www.example.org" }, 400);
    const kind = parsed.data.kind;

    await expireUnverifiedDomains(db, c.env);
    const limits = limitsFor(c.env);
    const [[perSite], perUser] = await Promise.all([
      db.select({ n: count() }).from(domains).where(eq(domains.siteId, site.id)),
      c.var.user.role === "admin" ? Promise.resolve(0) : domainsOwnedBy(db, c.var.user.id),
    ]);
    if ((perSite?.n ?? 0) >= limits.maxDomainsPerSite) {
      return c.json({ error: `A site can have at most ${limits.maxDomainsPerSite} domains. Remove one first.` }, 429);
    }
    if (c.var.user.role !== "admin" && perUser >= limits.maxDomainsPerUser) {
      return c.json({ error: `You can attach at most ${limits.maxDomainsPerUser} domains across your sites. Remove one first.` }, 429);
    }

    const [taken] = await db.select({ id: domains.id }).from(domains).where(eq(domains.hostname, hostname)).limit(1);
    if (taken) return c.json({ error: "This domain is already attached to a site" }, 409);
    if (kind === "primary") {
      const [primary] = await db
        .select({ id: domains.id })
        .from(domains)
        .where(and(eq(domains.siteId, site.id), eq(domains.kind, "primary")))
        .limit(1);
      if (primary) return c.json({ error: "This site already has a main domain; remove it first or add this one as a redirect" }, 409);
    }

    // Nothing is created at Cloudflare yet: that happens on the refresh that finds the ownership TXT record.
    const now = new Date();
    const row: Domain = {
      id: newId("dom"),
      siteId: site.id,
      hostname,
      kind,
      cfCustomHostnameId: null,
      sslStatus: "pending",
      verifiedAt: null,
      verificationToken: newVerificationToken(),
      ownershipVerifiedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await db.insert(domains).values(row);
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      return c.json({ error: "This domain is already attached to a site" }, 409);
    }
    await recordOrgEvent(db, { orgId: site.orgId, actorUserId: c.var.user.id, action: "domain.added", target: hostname, detail: { siteId: site.id, kind } });
    return c.json({ domain: domainView(row, cnameTargetFor(c.env)) }, 201);
  },
);

/**
 * Moves the domain along: looks for the ownership TXT record until it is found, then registers the
 * custom hostname at Cloudflare, then pulls its verification and certificate status until it is active.
 */
domainRoutes.post("/sites/:id/domains/:domainId/refresh", async (c) => {
  const db = drizzle(c.env.DB);
  const access = await requireSiteRole(c, db, c.req.param("id"), "admin");
  if (access instanceof Response) return access;
  const { site } = access;
  const [domain] = await db
    .select()
    .from(domains)
    .where(and(eq(domains.id, c.req.param("domainId")), eq(domains.siteId, site.id)))
    .limit(1);
  if (!domain) return c.json({ error: "Domain not found" }, 404);
  if (!isCloudflareConfigured(c.env)) return c.json({ error: "Custom domains are not enabled on this server" }, 503);
  const target = cnameTargetFor(c.env);
  const now = new Date();

  let current: Domain = domain;
  if (!current.ownershipVerifiedAt) {
    let records: string[];
    try {
      records = await lookupTxt(verificationRecordName(current.hostname));
    } catch (err) {
      if (err instanceof DnsLookupError) return c.json({ error: `Could not check the DNS record: ${err.message}` }, 502);
      throw err;
    }
    if (!txtProvesOwnership(records, current.verificationToken)) {
      // Not there yet. The record is reported back so the owner can compare.
      return c.json({ domain: domainView(current, target), txtFound: false });
    }
    current = { ...current, ownershipVerifiedAt: now, updatedAt: now };
    await db.update(domains).set({ ownershipVerifiedAt: now, updatedAt: now }).where(eq(domains.id, current.id));
  }

  let remote: CustomHostname;
  try {
    remote = current.cfCustomHostnameId ? await getCustomHostname(c.env, current.cfCustomHostnameId) : await createCustomHostname(c.env, current.hostname);
  } catch (err) {
    if (err instanceof CloudflareError) {
      logError("custom_hostname_failed", requestIdOf(c), { domain_id: current.id, status: err.status });
      return c.json({ error: `Could not check the domain: ${err.message}`, domain: domainView(current, target) }, 502);
    }
    throw err;
  }
  const patch = statusPatch(remote, current, now);
  await db.update(domains).set(patch).where(eq(domains.id, current.id));
  return c.json({ domain: domainView({ ...current, ...patch }, target), txtFound: true });
});

domainRoutes.delete("/sites/:id/domains/:domainId", async (c) => {
  const db = drizzle(c.env.DB);
  const access = await requireSiteRole(c, db, c.req.param("id"), "admin");
  if (access instanceof Response) return access;
  const { site } = access;
  const [domain] = await db
    .select()
    .from(domains)
    .where(and(eq(domains.id, c.req.param("domainId")), eq(domains.siteId, site.id)))
    .limit(1);
  if (!domain) return c.json({ error: "Domain not found" }, 404);

  // Remove the Cloudflare side first: a row that outlives its custom hostname can be retried, the reverse cannot.
  if (domain.cfCustomHostnameId) {
    if (!isCloudflareConfigured(c.env)) return c.json({ error: "Custom domains are not enabled on this server" }, 503);
    try {
      await deleteCustomHostname(c.env, domain.cfCustomHostnameId);
    } catch (err) {
      if (err instanceof CloudflareError) return c.json({ error: `Could not remove the domain: ${err.message}` }, 502);
      throw err;
    }
  }
  await db.batch([
    db.delete(domains).where(eq(domains.id, domain.id)),
    orgEventInsert(db, { orgId: site.orgId, actorUserId: c.var.user.id, action: "domain.removed", target: domain.hostname, detail: { siteId: site.id, kind: domain.kind } }),
  ]);
  return c.json({ ok: true });
});
