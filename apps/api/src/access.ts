import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { organizations, sites, type Site } from "./db/schema";
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
