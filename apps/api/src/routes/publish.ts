import type { ImageRef } from "@ministry/schema";
import { SiteDocument } from "@ministry/schema";
import { renderSite } from "@ministry/templates";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { isSiteAssetKey, loadAuthorizedSite } from "../access";
import { siteVersions, sites } from "../db/schema";
import {
  deleteKeys,
  listKeys,
  publishedImagePrefix,
  publishedIndexKey,
  publishedPrefix,
  publishedUrlFor,
  relativizeRootLinks,
} from "../published";
import type { AppEnv } from "../types";

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

const ABSOLUTE_URL = /^(?:https?:)?\/\//i;

/** The IMAGES key an image ref points at: the ref's src without a leading "/assets/". */
function imageKey(ref: ImageRef): string {
  return ref.src.replace(/^\/assets\//, "");
}

export const publishRoutes = new Hono<AppEnv>();

publishRoutes.post("/sites/:id/publish", async (c) => {
  const db = drizzle(c.env.DB);
  const site = await loadAuthorizedSite(db, c.var.user, c.req.param("id"));
  if (!site) return c.json({ error: "Site not found" }, 404);
  if (!site.currentVersionId) return c.json({ error: "Site has no content to publish" }, 409);

  const [version] = await db
    .select({ document: siteVersions.document })
    .from(siteVersions)
    .where(eq(siteVersions.id, site.currentVersionId))
    .limit(1);
  const parsed = version ? SiteDocument.safeParse(JSON.parse(version.document)) : null;
  if (!parsed?.success) return c.json({ error: "Current version is not a valid site document" }, 409);

  // Local images are copied next to index.html; absolute URLs are left as the author wrote them.
  const { html, images } = renderSite(parsed.data, {
    imageUrl: (ref) => (ABSOLUTE_URL.test(ref.src) ? ref.src : `images/${basename(ref.src)}`),
  });

  const imagePrefix = publishedImagePrefix(site.id);
  const keep = new Set<string>();
  for (const ref of images) {
    const sourceKey = imageKey(ref);
    // Only this site's own uploads are copied into its bundle.
    if (ABSOLUTE_URL.test(ref.src) || !isSiteAssetKey(site.id, sourceKey)) continue;
    const destKey = `${imagePrefix}${basename(sourceKey)}`;
    if (keep.has(destKey)) continue;
    const object = await c.env.IMAGES.get(sourceKey);
    if (!object) continue;
    await c.env.PUBLISHED.put(destKey, await object.arrayBuffer(), {
      httpMetadata: { contentType: object.httpMetadata?.contentType },
    });
    keep.add(destKey);
  }

  await c.env.PUBLISHED.put(publishedIndexKey(site.id), relativizeRootLinks(html), {
    httpMetadata: { contentType: "text/html; charset=utf-8" },
  });

  const stale = (await listKeys(c.env.PUBLISHED, imagePrefix)).filter((key) => !keep.has(key));
  await deleteKeys(c.env.PUBLISHED, stale);

  const publishedAt = new Date();
  const publishedPath = `/${site.slug}/`;
  await db
    .update(sites)
    .set({ status: "published", publishedAt, publishedPath, updatedAt: publishedAt })
    .where(eq(sites.id, site.id));

  return c.json({ url: publishedUrlFor(c.env, publishedPath), publishedAt: publishedAt.toISOString() });
});

publishRoutes.post("/sites/:id/unpublish", async (c) => {
  const db = drizzle(c.env.DB);
  const site = await loadAuthorizedSite(db, c.var.user, c.req.param("id"));
  if (!site) return c.json({ error: "Site not found" }, 404);

  // Flip the status first so the site stops resolving even if object deletion is interrupted.
  await db
    .update(sites)
    .set({ status: "draft", publishedAt: null, publishedPath: null, updatedAt: new Date() })
    .where(eq(sites.id, site.id));
  await deleteKeys(c.env.PUBLISHED, await listKeys(c.env.PUBLISHED, publishedPrefix(site.id)));

  return c.json({ ok: true });
});
