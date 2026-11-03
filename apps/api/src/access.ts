import { roleAtLeast, type OrgRole } from "@ministry/schema";
import { and, eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { Context } from "hono";
import { orgMembers, organizations, sites, type Organization, type Site } from "./db/schema";
import type { AppEnv, AuthUser } from "./types";

/**
 * Access control. Membership (`org_members`) is the source of truth: a user acts in an organization
 * with the role of their membership row. Platform admins (users.role = "admin", the staff token
 * included) act as owners everywhere without a row. Every route resolves its organization or site
 * through this module before touching data, and answers 404 for "missing or not yours" and 403 for
 * "yours, but your role does not allow this".
 *
 * Matrix: viewer reads everything (sites, versions, messages, domains, integration status, members,
 * events); editor also edits content, uploads images, uses AI, publishes and deletes messages; admin
 * also manages members, invitations, domains and integrations; owner also deletes sites and transfers ownership.
 */

export type OrgAccess = {
  org: Organization;
  /** The caller's effective role. */
  role: OrgRole;
  /** True when the role comes from platform-admin status rather than a membership row. */
  staff: boolean;
};

export type SiteAccess = OrgAccess & { site: Site };

/** The caller's membership role in an organization, or null when they are not a member. */
export async function memberRole(db: DrizzleD1Database, orgId: string, userId: string): Promise<OrgRole | null> {
  const [row] = await db
    .select({ role: orgMembers.role })
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)))
    .limit(1);
  return row?.role ?? null;
}

async function effectiveRole(db: DrizzleD1Database, user: AuthUser, orgId: string): Promise<{ role: OrgRole; staff: boolean } | null> {
  if (user.role === "admin") return { role: "owner", staff: true };
  const role = await memberRole(db, orgId, user.id);
  return role ? { role, staff: false } : null;
}

/** The organization with the caller's role, or null when it does not exist or they are not a member. */
export async function loadOrgAccess(db: DrizzleD1Database, user: AuthUser, orgId: string): Promise<OrgAccess | null> {
  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
  if (!org) return null;
  const access = await effectiveRole(db, user, org.id);
  return access ? { org, ...access } : null;
}

/** The site, its organization and the caller's role, or null when the site is missing or not theirs. */
export async function loadSiteAccess(db: DrizzleD1Database, user: AuthUser, siteId: string): Promise<SiteAccess | null> {
  const [row] = await db
    .select({ site: sites, org: organizations })
    .from(sites)
    .innerJoin(organizations, eq(sites.orgId, organizations.id))
    .where(eq(sites.id, siteId))
    .limit(1);
  if (!row) return null;
  const access = await effectiveRole(db, user, row.org.id);
  return access ? { site: row.site, org: row.org, ...access } : null;
}

/** True when the access grants at least `minimum`. */
export function hasRole(access: Pick<OrgAccess, "role">, minimum: OrgRole): boolean {
  return roleAtLeast(access.role, minimum);
}

export const FORBIDDEN: Record<OrgRole, string> = {
  viewer: "You need at least viewer access",
  editor: "You need editor access or higher for this",
  admin: "You need admin access or higher for this",
  owner: "Only an owner can do this",
};

/**
 * Resolves a site for a route: 404 when it is missing or the caller is not a member of its organization,
 * 403 when their role is below `minimum`.
 */
export async function requireSiteRole(c: Context<AppEnv>, db: DrizzleD1Database, siteId: string, minimum: OrgRole): Promise<SiteAccess | Response> {
  const access = await loadSiteAccess(db, c.var.user, siteId);
  if (!access) return c.json({ error: "Site not found" }, 404);
  if (!hasRole(access, minimum)) return c.json({ error: FORBIDDEN[minimum], role: access.role }, 403);
  return access;
}

/** The organization counterpart of `requireSiteRole`. */
export async function requireOrgRole(c: Context<AppEnv>, db: DrizzleD1Database, orgId: string, minimum: OrgRole): Promise<OrgAccess | Response> {
  const access = await loadOrgAccess(db, c.var.user, orgId);
  if (!access) return c.json({ error: "Organization not found" }, 404);
  if (!hasRole(access, minimum)) return c.json({ error: FORBIDDEN[minimum], role: access.role }, 403);
  return access;
}

/** True when `key` is an R2 key inside this site's own prefix (`sites/<siteId>/...`). */
export function isSiteAssetKey(siteId: string, key: string): boolean {
  const prefix = `sites/${siteId}/`;
  return key.startsWith(prefix) && key.length > prefix.length && !key.includes("..");
}
