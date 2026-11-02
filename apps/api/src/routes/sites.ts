import { emptySiteDocument, SiteDocument } from "@ministry/schema";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { loadOrgAccess, requireSiteRole } from "../access";
import {
  aiUsage,
  assets,
  contactEmailVerifications,
  domains,
  formSubmissions,
  integrationEvents,
  orgEvents,
  orgIntegrations,
  orgInvitations,
  orgMembers,
  organizations,
  publishEvents,
  siteVersions,
  sites,
} from "../db/schema";
import { orgEventInsert } from "../events";
import { newId } from "../ids";
import { limitsFor } from "../limits";
import { deleteKeys, listKeys, publishedPrefix, publishedUrlFor } from "../published";
import { deleteCustomHostname, isCloudflareConfigured } from "../cloudflare";
import { pruneVersions } from "../versions";
import { countMessages } from "./messages";
import type { AppEnv } from "../types";

export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
/** Subdomains we keep for the platform itself (<slug>.sites.shofar.io). */
const RESERVED_SLUGS = new Set(["www", "api", "app", "admin", "build", "mail", "sites"]);
const MAX_DOCUMENT_BYTES = 1024 * 1024;

function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return slug || "site";
}

function isValidSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug) && !RESERVED_SLUGS.has(slug);
}

function isUniqueViolation(err: unknown): boolean {
  const text = err instanceof Error ? `${err.message} ${String(err.cause ?? "")}` : String(err);
  return text.includes("UNIQUE constraint failed");
}

export const siteRoutes = new Hono<AppEnv>();

/** The caller's sites across every organization they belong to, or those of one organization with `?orgId=`. */
siteRoutes.get("/sites", async (c) => {
  const db = drizzle(c.env.DB);
  const orgId = c.req.query("orgId");
  const member = and(eq(orgMembers.orgId, organizations.id), eq(orgMembers.userId, c.var.user.id));
  const rows = await db
    .select({
      id: sites.id,
      slug: sites.slug,
      orgId: organizations.id,
      orgName: organizations.name,
      role: orgMembers.role,
      templateId: sites.templateId,
      plan: sites.plan,
      status: sites.status,
      currentVersionId: sites.currentVersionId,
      publishedAt: sites.publishedAt,
      publishedPath: sites.publishedPath,
      createdAt: sites.createdAt,
      updatedAt: sites.updatedAt,
    })
    .from(sites)
    .innerJoin(organizations, eq(sites.orgId, organizations.id))
    .innerJoin(orgMembers, member)
    .where(orgId ? eq(organizations.id, orgId) : undefined)
    .orderBy(desc(sites.updatedAt));
  return c.json({
    sites: rows.map(({ publishedPath, ...row }) => ({ ...row, publishedUrl: publishedUrlFor(c.env, publishedPath) })),
  });
});

siteRoutes.post("/sites", bodyLimit({ maxSize: 16 * 1024, onError: (c) => c.json({ error: "Body too large" }, 413) }), async (c) => {
  const body: unknown = await c.req.json().catch(() => null);
  const input = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  const requestedOrgId = input?.["orgId"];
  if (requestedOrgId !== undefined && (typeof requestedOrgId !== "string" || requestedOrgId === "")) {
    return c.json({ error: "orgId must be a string" }, 400);
  }
  let orgName = typeof input?.["orgName"] === "string" ? input["orgName"].trim() : "";
  if ((!orgName && requestedOrgId === undefined) || orgName.length > 120) {
    return c.json({ error: "orgName is required (1-120 characters)" }, 400);
  }
  const requestedSlug = input?.["slug"];
  if (requestedSlug !== undefined && (typeof requestedSlug !== "string" || !isValidSlug(requestedSlug))) {
    return c.json({ error: "slug must be 1-40 lowercase letters, digits or hyphens, and not reserved" }, 400);
  }

  const db = drizzle(c.env.DB);
  const user = c.var.user;

  // Inside an existing organization the caller must be an admin or owner there; the site takes the organization's name by default.
  let targetOrg: { id: string } | null = null;
  if (typeof requestedOrgId === "string") {
    const access = await loadOrgAccess(db, user, requestedOrgId);
    if (!access) return c.json({ error: "Organization not found" }, 404);
    if (!["admin", "owner"].includes(access.role)) return c.json({ error: "You need admin access to add a site to this organization", role: access.role }, 403);
    targetOrg = { id: access.org.id };
    if (!orgName) orgName = access.org.name;
  }

  // Sites across every organization the user owns. Staff (admins) build sites for others and are exempt.
  if (user.role !== "admin") {
    const { maxSitesPerUser } = limitsFor(c.env);
    const [owned] = await db
      .select({ n: count() })
      .from(sites)
      .innerJoin(organizations, eq(sites.orgId, organizations.id))
      .where(eq(organizations.ownerUserId, user.id));
    if ((owned?.n ?? 0) >= maxSitesPerUser) {
      return c.json({ error: `Site limit reached (${maxSitesPerUser} sites per account)`, limit: maxSitesPerUser }, 429);
    }
  }

  let slug = requestedSlug ?? slugify(orgName);
  if (RESERVED_SLUGS.has(slug)) slug = `${slug}-site`;
  const [taken] = await db.select({ id: sites.id }).from(sites).where(eq(sites.slug, slug)).limit(1);
  if (taken) {
    if (requestedSlug !== undefined) return c.json({ error: "slug is already taken" }, 409);
    slug = `${slug.slice(0, 35)}-${crypto.randomUUID().slice(0, 4)}`;
  }

  const existingOrg =
    targetOrg ??
    (
      await db
        .select({ id: organizations.id })
        .from(organizations)
        .where(and(eq(organizations.ownerUserId, user.id), eq(organizations.name, orgName)))
        .limit(1)
    )[0];
  const orgId = existingOrg?.id ?? newId("org");

  const document = emptySiteDocument(orgName);
  const siteId = newId("site");
  const versionId = newId("ver");

  const insertSite = db.insert(sites).values({
    id: siteId,
    orgId,
    slug,
    templateId: document.theme.templateId,
    currentVersionId: versionId,
  });
  const insertVersion = db.insert(siteVersions).values({
    id: versionId,
    siteId,
    document: JSON.stringify(document),
    createdBy: user.id,
  });

  try {
    if (existingOrg) {
      await db.batch([insertSite, insertVersion]);
    } else {
      // A new organization: the creator is its first owner.
      await db.batch([
        db.insert(organizations).values({ id: orgId, name: orgName, ownerUserId: user.id, createdBy: user.id }),
        db.insert(orgMembers).values({ orgId, userId: user.id, role: "owner", invitedBy: null }),
        insertSite,
        insertVersion,
      ]);
    }
  } catch (err) {
    if (isUniqueViolation(err)) return c.json({ error: "slug is already taken" }, 409);
    throw err;
  }

  // Same envelope as GET /sites/:id so the client can navigate straight into the editor.
  return c.json({ site: { id: siteId, orgId, slug }, versionId, document }, 201);
});

siteRoutes.get("/sites/:id", async (c) => {
  const db = drizzle(c.env.DB);
  const access = await requireSiteRole(c, db, c.req.param("id"), "viewer");
  if (access instanceof Response) return access;
  const { site } = access;

  let document: unknown = null;
  if (site.currentVersionId) {
    const [version] = await db
      .select({ document: siteVersions.document })
      .from(siteVersions)
      .where(eq(siteVersions.id, site.currentVersionId))
      .limit(1);
    if (version) document = JSON.parse(version.document);
  }
  const messageCount = await countMessages(db, site.id);
  return c.json({ site: { ...site, publishedUrl: publishedUrlFor(c.env, site.publishedPath), messageCount, role: access.role }, document });
});

siteRoutes.put(
  "/sites/:id/document",
  bodyLimit({ maxSize: MAX_DOCUMENT_BYTES, onError: (c) => c.json({ error: "Document too large" }, 413) }),
  async (c) => {
    const db = drizzle(c.env.DB);
    const user = c.var.user;
    const access = await requireSiteRole(c, db, c.req.param("id"), "editor");
    if (access instanceof Response) return access;
    const { site } = access;

    const body: unknown = await c.req.json().catch(() => undefined);
    if (body === undefined) return c.json({ error: "Body must be valid JSON" }, 400);
    const parsed = SiteDocument.safeParse(body);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ");
      return c.json({ error: `Invalid site document: ${detail}` }, 400);
    }

    const versionId = newId("ver");
    await db.batch([
      db.insert(siteVersions).values({
        id: versionId,
        siteId: site.id,
        document: JSON.stringify(parsed.data),
        createdBy: user.id,
      }),
      db
        .update(sites)
        .set({ currentVersionId: versionId, updatedAt: sql`(unixepoch() * 1000)` })
        .where(eq(sites.id, site.id)),
    ]);
    await pruneVersions(db, site.id, versionId, limitsFor(c.env).maxVersionsPerSite);
    return c.json({ versionId });
  },
);

siteRoutes.get("/sites/:id/versions", async (c) => {
  const db = drizzle(c.env.DB);
  const access = await requireSiteRole(c, db, c.req.param("id"), "viewer");
  if (access instanceof Response) return access;
  const { site } = access;

  const versions = await db
    .select({ id: siteVersions.id, createdAt: siteVersions.createdAt })
    .from(siteVersions)
    .where(eq(siteVersions.siteId, site.id))
    .orderBy(desc(siteVersions.createdAt), desc(siteVersions.id));
  return c.json({ versions, currentVersionId: site.currentVersionId });
});

/**
 * Deletes a site and everything it owns: versions, uploaded images, published files,
 * form messages, and the organization (with its email integration) when this was its last site. AI usage rows keep
 * their token counts for billing but lose the site reference.
 */
siteRoutes.delete("/sites/:id", async (c) => {
  const db = drizzle(c.env.DB);
  const access = await requireSiteRole(c, db, c.req.param("id"), "owner");
  if (access instanceof Response) return access;
  const { site } = access;

  // Objects first, then rows: a retry after an interrupted delete still finds the site.
  await deleteKeys(c.env.PUBLISHED, await listKeys(c.env.PUBLISHED, publishedPrefix(site.id)));
  await deleteKeys(c.env.IMAGES, await listKeys(c.env.IMAGES, `sites/${site.id}/`));

  // Custom hostnames and their rows go first: the domains table has no cascade, and a dangling
  // hostname on Cloudflare would keep answering for a site that no longer exists.
  const siteDomains = await db.select({ id: domains.id, cfId: domains.cfCustomHostnameId }).from(domains).where(eq(domains.siteId, site.id));
  if (isCloudflareConfigured(c.env)) {
    for (const d of siteDomains) if (d.cfId) await deleteCustomHostname(c.env, d.cfId).catch(() => undefined);
  }
  await db.delete(domains).where(eq(domains.siteId, site.id));

  await db.update(sites).set({ currentVersionId: null }).where(eq(sites.id, site.id));
  await db.batch([
    // Keep token counts for cost records, drop the site reference and the owner's text.
    db.update(aiUsage).set({ siteId: null, requestJson: null, resultJson: null }).where(eq(aiUsage.siteId, site.id)),
    db.delete(formSubmissions).where(eq(formSubmissions.siteId, site.id)),
    db.delete(contactEmailVerifications).where(eq(contactEmailVerifications.siteId, site.id)),
    db.delete(publishEvents).where(eq(publishEvents.siteId, site.id)),
    db.delete(assets).where(eq(assets.siteId, site.id)),
    db.delete(siteVersions).where(eq(siteVersions.siteId, site.id)),
    db.delete(sites).where(eq(sites.id, site.id)),
    orgEventInsert(db, { orgId: site.orgId, actorUserId: c.var.user.id, action: "site.deleted", target: site.id, detail: { slug: site.slug } }),
  ]);

  const [remaining] = await db.select({ n: sql<number>`count(*)` }).from(sites).where(eq(sites.orgId, site.orgId));
  if ((remaining?.n ?? 0) === 0) {
    // The organization goes with its last site: its stored provider key, limit counters, members, invitations and audit log.
    await db.batch([
      db.update(aiUsage).set({ orgId: null }).where(eq(aiUsage.orgId, site.orgId)),
      db.delete(orgIntegrations).where(eq(orgIntegrations.orgId, site.orgId)),
      db.delete(integrationEvents).where(eq(integrationEvents.orgId, site.orgId)),
      db.delete(orgInvitations).where(eq(orgInvitations.orgId, site.orgId)),
      db.delete(orgEvents).where(eq(orgEvents.orgId, site.orgId)),
      db.delete(orgMembers).where(eq(orgMembers.orgId, site.orgId)),
      db.delete(organizations).where(eq(organizations.id, site.orgId)),
    ]);
  }

  return c.json({ ok: true });
});
