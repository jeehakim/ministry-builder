import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { organizations, sites, type Organization, type Site } from "./db/schema";
import type { AuthUser } from "./types";

/**
 * Loads a site if the user owns its organization or is an admin.
 * Returns null for both "missing" and "not yours" so callers answer 404 either way.
 */
export async function loadAuthorizedSite(
  db: DrizzleD1Database,
  user: AuthUser,
  siteId: string,
): Promise<Site | null> {
  const [row] = await db
    .select({ site: sites, ownerUserId: organizations.ownerUserId })
    .from(sites)
    .innerJoin(organizations, eq(sites.orgId, organizations.id))
    .where(eq(sites.id, siteId))
    .limit(1);
  if (!row) return null;
  if (user.role !== "admin" && row.ownerUserId !== user.id) return null;
  return row.site;
}

/**
 * Loads an organization if the user owns it or is an admin.
 * Returns null for both "missing" and "not yours" so callers answer 404 either way.
 */
export async function loadAuthorizedOrg(
  db: DrizzleD1Database,
  user: AuthUser,
  orgId: string,
): Promise<Organization | null> {
  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
  if (!org) return null;
  if (user.role !== "admin" && org.ownerUserId !== user.id) return null;
  return org;
}

/** True when `key` is an R2 key inside this site's own prefix (`sites/<siteId>/...`). */
export function isSiteAssetKey(siteId: string, key: string): boolean {
  const prefix = `sites/${siteId}/`;
  return key.startsWith(prefix) && key.length > prefix.length && !key.includes("..");
}
