import type { ImageRef } from "@ministry/schema";
import { languageName, localizeDocument, SiteDocument, siteLanguages } from "@ministry/schema";
import { renderSite, renderThanksPage, type RenderOptions } from "@ministry/templates";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { isSiteAssetKey, loadAuthorizedSite } from "../access";
import { siteVersions, sites } from "../db/schema";
import {
  deleteKeys,
  LANGUAGE_PATH_PATTERN,
  LANGUAGE_TAG_PATTERN,
  listKeys,
  publishedImagePrefix,
  publishedIndexKey,
  publishedLanguageIndexKey,
  publishedLanguageThanksKey,
  publishedPrefix,
  publishedThanksKey,
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

type LanguageLink = NonNullable<RenderOptions["languageLinks"]>[number];

/** Switcher entries as seen from the page of `current`: the primary page is the site root, the others sit one level down. */
function languageLinksFor(languages: string[], primary: string, current: string): LanguageLink[] {
  if (languages.length < 2) return [];
  return languages.map((code) => {
    let href: string;
    if (code === current) href = "./";
    else if (current === primary) href = `${code}/`;
    else href = code === primary ? "../" : `../${code}/`;
    return { code, label: languageName(code), href, current: code === current };
  });
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

  // The primary language is the site root; every other language is a sub-page. A language that
  // is not a plain code would become an odd object key, so it is skipped rather than published.
  const doc = parsed.data;
  const primary = doc.meta.language;
  const languages = siteLanguages(doc).filter((lang) => lang === primary || LANGUAGE_PATH_PATTERN.test(lang));

  // Local images are copied once under images/; absolute URLs are left as the author wrote them.
  const pages = languages.map((lang) => {
    const imagesDir = lang === primary ? "images/" : "../images/";
    const key = lang === primary ? publishedIndexKey(site.id) : publishedLanguageIndexKey(site.id, lang);
    const localized = localizeDocument(doc, lang);
    const rendered = renderSite(localized, {
      imageUrl: (ref) => (ABSOLUTE_URL.test(ref.src) ? ref.src : `${imagesDir}${basename(ref.src)}`),
      languageLinks: languageLinksFor(languages, primary, lang),
      // Resolves to /<slug>/contact from both /<slug>/ and /<slug>/<lang>/ (see handleContactSubmission).
      formAction: lang === primary ? "contact" : "../contact",
    });
    // Both thank-you pages sit one folder below their language page, so "../" leads back to it.
    const thanksKey = lang === primary ? publishedThanksKey(site.id) : publishedLanguageThanksKey(site.id, lang);
    const thanksHtml = renderThanksPage(localized, { backHref: "../" });
    return { lang, key, html: rendered.html, images: rendered.images, thanksKey, thanksHtml };
  });
  const images = pages.flatMap((page) => page.images);

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

  for (const page of pages) {
    const options = {
      httpMetadata: { contentType: "text/html; charset=utf-8" },
      // Lets the hosting handler answer with Content-Language without reading the page.
      ...(LANGUAGE_TAG_PATTERN.test(page.lang) ? { customMetadata: { language: page.lang } } : {}),
    };
    await c.env.PUBLISHED.put(page.key, relativizeRootLinks(page.html), options);
    await c.env.PUBLISHED.put(page.thanksKey, relativizeRootLinks(page.thanksHtml), options);
  }

  // Stale images, and language pages of languages that are no longer in the document.
  const written = new Set(pages.flatMap((page) => [page.key, page.thanksKey]));
  const sitePrefix = publishedPrefix(site.id);
  const stale = (await listKeys(c.env.PUBLISHED, sitePrefix)).filter((key) => {
    if (key.startsWith(imagePrefix)) return !keep.has(key);
    const rest = key.slice(sitePrefix.length);
    return /^[^/]+\/(?:thanks\/)?index\.html$/.test(rest) && !written.has(key);
  });
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
