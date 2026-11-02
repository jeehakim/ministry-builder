import { and, asc, count, desc, eq, inArray, ne, notInArray } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { PROTECTED_RECENT_VERSIONS } from "./limits";
import { siteVersions } from "./db/schema";

/**
 * Keeps a site's history bounded. Once a site has more than `max` versions, the oldest ones go until it
 * is back at `max`; the current version and the newest PROTECTED_RECENT_VERSIONS are never pruned,
 * so nothing a user could reasonably still want to restore is lost.
 */
export async function pruneVersions(db: DrizzleD1Database, siteId: string, currentVersionId: string, max: number): Promise<void> {
  const [total] = await db.select({ n: count() }).from(siteVersions).where(eq(siteVersions.siteId, siteId));
  const excess = (total?.n ?? 0) - max;
  if (excess <= 0) return;

  const newest = db
    .select({ id: siteVersions.id })
    .from(siteVersions)
    .where(eq(siteVersions.siteId, siteId))
    .orderBy(desc(siteVersions.createdAt), desc(siteVersions.id))
    .limit(PROTECTED_RECENT_VERSIONS);
  const victims = db
    .select({ id: siteVersions.id })
    .from(siteVersions)
    .where(and(eq(siteVersions.siteId, siteId), ne(siteVersions.id, currentVersionId), notInArray(siteVersions.id, newest)))
    .orderBy(asc(siteVersions.createdAt), asc(siteVersions.id))
    .limit(excess);
  await db.delete(siteVersions).where(and(eq(siteVersions.siteId, siteId), inArray(siteVersions.id, victims)));
}
