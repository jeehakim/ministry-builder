import { and, asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { loadAuthorizedSite } from "../access";
import {
  CloudflareError,
  createCustomHostname,
  deleteCustomHostname,
  getCustomHostname,
  isCloudflareConfigured,
  type CustomHostname,
} from "../cloudflare";
import { domains, type Domain } from "../db/schema";
import { newId } from "../ids";
import type { AppEnv, Bindings } from "../types";

const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
/** Zones the platform owns: customers never attach a hostname under them. */
const PLATFORM_ZONES = ["shofar.io", "shofar.ai"];

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

/** The domain as the API reports it, with the DNS record the customer must create. */
export function domainView(domain: Domain, cnameTarget: string) {
  const verified = domain.verifiedAt !== null;
  return {
    id: domain.id,
    hostname: domain.hostname,
    kind: domain.kind,
    sslStatus: domain.sslStatus,
    verifiedAt: domain.verifiedAt?.toISOString() ?? null,
    /** True once Cloudflare has verified the hostname and deployed its certificate: the domain serves the site. */
    active: verified && domain.sslStatus === "active",
    dns: { type: "CNAME", name: domain.hostname, target: cnameTarget },
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
function statusPatch(remote: CustomHostname, previous: Domain | null, now: Date) {
  const verifiedAt = remote.status === "active" ? (previous?.verifiedAt ?? now) : null;
  return { cfCustomHostnameId: remote.id, sslStatus: remote.sslStatus, verifiedAt, updatedAt: now };
}

export const domainRoutes = new Hono<AppEnv>();

domainRoutes.get("/sites/:id/domains", async (c) => {
  const db = drizzle(c.env.DB);
  const site = await loadAuthorizedSite(db, c.var.user, c.req.param("id"));
  if (!site) return c.json({ error: "Site not found" }, 404);
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
    const site = await loadAuthorizedSite(db, c.var.user, c.req.param("id"));
    if (!site) return c.json({ error: "Site not found" }, 404);
    if (!isCloudflareConfigured(c.env)) return c.json({ error: "Custom domains are not enabled on this server" }, 503);

    const parsed = CreateBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "hostname is required; kind must be primary or redirect" }, 400);
    const hostname = normalizeHostname(parsed.data.hostname);
    if (!hostname) return c.json({ error: "Enter a domain name you own, like example.org or www.example.org" }, 400);
    const kind = parsed.data.kind;

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

    let remote: CustomHostname;
    try {
      remote = await createCustomHostname(c.env, hostname);
    } catch (err) {
      if (err instanceof CloudflareError) return c.json({ error: `Cloudflare rejected the domain: ${err.message}` }, 502);
      throw err;
    }

    const now = new Date();
    const row: Domain = {
      id: newId("dom"),
      siteId: site.id,
      hostname,
      kind,
      createdAt: now,
      ...statusPatch(remote, null, now),
    };
    try {
      await db.insert(domains).values(row);
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      // Lost a race with a concurrent request for the same hostname: undo the Cloudflare side.
      await deleteCustomHostname(c.env, remote.id).catch(() => undefined);
      return c.json({ error: "This domain is already attached to a site" }, 409);
    }
    return c.json({ domain: domainView(row, cnameTargetFor(c.env)) }, 201);
  },
);

/** Pulls the current verification and certificate status from Cloudflare and stores it. */
domainRoutes.post("/sites/:id/domains/:domainId/refresh", async (c) => {
  const db = drizzle(c.env.DB);
  const site = await loadAuthorizedSite(db, c.var.user, c.req.param("id"));
  if (!site) return c.json({ error: "Site not found" }, 404);
  const [domain] = await db
    .select()
    .from(domains)
    .where(and(eq(domains.id, c.req.param("domainId")), eq(domains.siteId, site.id)))
    .limit(1);
  if (!domain) return c.json({ error: "Domain not found" }, 404);
  if (!isCloudflareConfigured(c.env)) return c.json({ error: "Custom domains are not enabled on this server" }, 503);
  if (!domain.cfCustomHostnameId) return c.json({ error: "This domain is not registered with Cloudflare" }, 409);

  let remote: CustomHostname;
  try {
    remote = await getCustomHostname(c.env, domain.cfCustomHostnameId);
  } catch (err) {
    if (err instanceof CloudflareError) return c.json({ error: `Could not check the domain: ${err.message}` }, 502);
    throw err;
  }
  const patch = statusPatch(remote, domain, new Date());
  await db.update(domains).set(patch).where(eq(domains.id, domain.id));
  return c.json({ domain: domainView({ ...domain, ...patch }, cnameTargetFor(c.env)) });
});

domainRoutes.delete("/sites/:id/domains/:domainId", async (c) => {
  const db = drizzle(c.env.DB);
  const site = await loadAuthorizedSite(db, c.var.user, c.req.param("id"));
  if (!site) return c.json({ error: "Site not found" }, 404);
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
  await db.delete(domains).where(eq(domains.id, domain.id));
  return c.json({ ok: true });
});
