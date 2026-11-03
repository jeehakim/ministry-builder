import type { ImageRef } from "@ministry/schema";
import { donorDisplayName, languageName, localizeCampaign, localizeDocument, SiteDocument, siteLanguages, type CampaignWithTotals } from "@ministry/schema";
import { renderCampaignPage, renderSite, renderThanksPage, type CampaignCard, type RenderOptions } from "@ministry/templates";
import { and, asc, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { isSiteAssetKey, requireSiteRole } from "../access";
import { loadCampaigns } from "../campaigns";
import { gifts, publishEvents, siteVersions, sites } from "../db/schema";
import { orgEventInsert } from "../events";
import { newId } from "../ids";
import { limitsFor, PUBLISH_WINDOW_MS } from "../limits";
import { sanitizeDocumentForPublish } from "../publishSafety";
import { buildRobotsTxt, buildSitemapXml, languagePageUrl } from "../seo";
import {
  deleteKeys,
  externalFormOrigins,
  LANGUAGE_PATH_PATTERN,
  LANGUAGE_TAG_PATTERN,
  listKeys,
  publishedCampaignKey,
  publishedImagePrefix,
  publishedIndexKey,
  publishedLanguageCampaignKey,
  publishedLanguageIndexKey,
  publishedLanguageThanksKey,
  publishedPrefix,
  publishedRobotsKey,
  publishedSitemapKey,
  publishedThanksKey,
  publicSiteUrl,
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

/** Names on the donor wall for the campaigns that enable it, newest gift first, at most this many. */
const DONOR_WALL_LIMIT = 200;

/** Switcher entries as seen from a campaign page, two folders below its language page. */
function campaignLanguageLinksFor(languages: string[], primary: string, current: string, campaignSlug: string): LanguageLink[] {
  if (languages.length < 2) return [];
  const tail = `give/${campaignSlug}/`;
  return languages.map((code) => {
    let href: string;
    if (code === current) href = "./";
    else if (current === primary) href = `../../${code}/${tail}`;
    else href = code === primary ? `../../../${tail}` : `../../../${code}/${tail}`;
    return { code, label: languageName(code), href, current: code === current };
  });
}

/** Opted-in donor names per campaign ("Maria L."), for the campaigns that show a wall. */
async function donorWalls(db: ReturnType<typeof drizzle>, campaigns: CampaignWithTotals[]): Promise<Map<string, string[]>> {
  const walls = new Map<string, string[]>();
  const ids = campaigns.filter((c) => c.donorWallEnabled).map((c) => c.id);
  if (ids.length === 0) return walls;
  const rows = await db
    .select({ campaignId: gifts.campaignId, donorName: gifts.donorName })
    .from(gifts)
    .where(and(inArray(gifts.campaignId, ids), eq(gifts.public, true)))
    .orderBy(desc(gifts.receivedAt), desc(gifts.id));
  for (const row of rows) {
    const list = walls.get(row.campaignId) ?? [];
    if (list.length >= DONOR_WALL_LIMIT) continue;
    list.push(donorDisplayName(row.donorName));
    walls.set(row.campaignId, list);
  }
  return walls;
}

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
  const access = await requireSiteRole(c, db, c.req.param("id"), "editor");
  if (access instanceof Response) return access;
  const { site } = access;
  if (!site.currentVersionId) return c.json({ error: "Site has no content to publish" }, 409);

  const [version] = await db
    .select({ document: siteVersions.document })
    .from(siteVersions)
    .where(eq(siteVersions.id, site.currentVersionId))
    .limit(1);
  const parsed = version ? SiteDocument.safeParse(JSON.parse(version.document)) : null;
  if (!parsed?.success) return c.json({ error: "Current version is not a valid site document" }, 409);

  // At most N publishes per site per rolling hour. `publish_events` holds one row per attempt that got this far;
  // site_versions cannot be counted instead because publishing does not create a version.
  const { maxPublishesPerHour } = limitsFor(c.env);
  const now = Date.now();
  const recent = await db
    .select({ createdAt: publishEvents.createdAt })
    .from(publishEvents)
    .where(and(eq(publishEvents.siteId, site.id), gte(publishEvents.createdAt, new Date(now - PUBLISH_WINDOW_MS))))
    .orderBy(asc(publishEvents.createdAt));
  if (recent.length >= maxPublishesPerHour) {
    // A slot frees up when the event that puts the count over the limit leaves the window.
    const blocking = recent[recent.length - maxPublishesPerHour];
    const retryAfter = Math.max(1, Math.ceil(((blocking?.createdAt.getTime() ?? now) + PUBLISH_WINDOW_MS - now) / 1000));
    return c.json(
      { error: `Publish limit reached (${maxPublishesPerHour} per hour for this site). Try again later.`, limit: maxPublishesPerHour, retryAfterSeconds: retryAfter },
      429,
      { "Retry-After": String(retryAfter) },
    );
  }
  await db.batch([
    db.insert(publishEvents).values({ id: newId("pub"), siteId: site.id, userId: c.var.user.id }),
    db.delete(publishEvents).where(and(eq(publishEvents.siteId, site.id), lt(publishEvents.createdAt, new Date(now - 24 * PUBLISH_WINDOW_MS)))),
  ]);

  // The primary language is the site root; every other language is a sub-page. A language that
  // is not a plain code would become an odd object key, so it is skipped rather than published.
  const doc = parsed.data;
  const primary = doc.meta.language;
  const languages = siteLanguages(doc).filter((lang) => lang === primary || LANGUAGE_PATH_PATTERN.test(lang));

  // Absolute address of the site root on the sites host; canonical URLs, hreflang alternates and the sitemap derive from it.
  const siteUrl = publicSiteUrl(c.env, site.slug);

  // Active campaigns become cards in the Give section and a page each at give/<slug>/ in every language.
  const activeCampaigns = await loadCampaigns(db, site.id, ["active"]);
  const walls = await donorWalls(db, activeCampaigns);

  // Local images are copied once under images/; absolute URLs are left as the author wrote them.
  const pages = languages.map((lang) => {
    const imagesDir = lang === primary ? "images/" : "../images/";
    const key = lang === primary ? publishedIndexKey(site.id) : publishedLanguageIndexKey(site.id, lang);
    // Sanitize after localizing: a translation overlay can replace a link target with an unsafe one.
    const localized = sanitizeDocumentForPublish(localizeDocument(doc, lang));
    const pageUrl = languagePageUrl(siteUrl, primary, lang);
    // Campaign text comes from staff, not from the document: control characters are the only concern (no hrefs).
    const localizedCampaigns = activeCampaigns.map((campaign) => localizeCampaign(campaign, lang, primary));
    const cards: CampaignCard[] = localizedCampaigns.map((campaign) => ({
      id: campaign.id,
      slug: campaign.slug,
      title: campaign.title,
      summary: campaign.summary,
      href: `give/${campaign.slug}/`,
      goalAmount: campaign.totals.goalAmount,
      raisedAmount: campaign.totals.raisedAmount,
      currency: campaign.totals.currency,
      percent: campaign.totals.percent,
      coverImage: campaign.coverImage,
      deadline: campaign.deadline,
    }));
    const rendered = renderSite(localized, {
      canonicalUrl: pageUrl,
      imageUrl: (ref) => (ABSOLUTE_URL.test(ref.src) ? ref.src : `${imagesDir}${basename(ref.src)}`),
      languageLinks: languageLinksFor(languages, primary, lang),
      // Resolves to /<slug>/contact from both /<slug>/ and /<slug>/<lang>/ (see handleContactSubmission).
      formAction: lang === primary ? "contact" : "../contact",
      campaigns: cards,
    });
    // Both thank-you pages sit one folder below their language page, so "../" leads back to it.
    const thanksKey = lang === primary ? publishedThanksKey(site.id) : publishedLanguageThanksKey(site.id, lang);
    const thanksHtml = renderThanksPage(localized, { backHref: "../" });
    // Campaign pages sit two folders below their language page (give/<slug>/).
    const campaignImagesDir = `../../${imagesDir}`;
    const campaignPages = localizedCampaigns.map((campaign) => {
      const page = renderCampaignPage(localized, campaign, campaign.totals, {
        imageUrl: (ref) => (ABSOLUTE_URL.test(ref.src) ? ref.src : `${campaignImagesDir}${basename(ref.src)}`),
        siteHref: "../../",
        canonicalUrl: `${pageUrl}give/${campaign.slug}/`,
        languageLinks: campaignLanguageLinksFor(languages, primary, lang, campaign.slug),
        donorWall: walls.get(campaign.id),
      });
      const campaignKey = lang === primary ? publishedCampaignKey(site.id, campaign.slug) : publishedLanguageCampaignKey(site.id, lang, campaign.slug);
      return { key: campaignKey, html: page.html, images: page.images };
    });
    return { lang, key, html: rendered.html, images: rendered.images, thanksKey, thanksHtml, formOrigins: externalFormOrigins(localized), campaignPages };
  });
  const images = pages.flatMap((page) => [...page.images, ...page.campaignPages.flatMap((p) => p.images)]);

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
    const httpMetadata = { contentType: "text/html; charset=utf-8" };
    // Lets the hosting handler answer with Content-Language without reading the page.
    const language: Record<string, string> = LANGUAGE_TAG_PATTERN.test(page.lang) ? { language: page.lang } : {};
    // Origins of custom form endpoints, so the page's Content-Security-Policy lets its form post there.
    const formOrigins: Record<string, string> = page.formOrigins.length > 0 ? { formOrigins: page.formOrigins.join(" ") } : {};
    await c.env.PUBLISHED.put(page.key, relativizeRootLinks(page.html), { httpMetadata, customMetadata: { ...language, ...formOrigins } });
    await c.env.PUBLISHED.put(page.thanksKey, relativizeRootLinks(page.thanksHtml), { httpMetadata, customMetadata: language });
    for (const campaignPage of page.campaignPages) {
      await c.env.PUBLISHED.put(campaignPage.key, relativizeRootLinks(campaignPage.html), { httpMetadata, customMetadata: language });
    }
  }

  // Crawler files sit next to index.html, so hosting only has to serve objects.
  await c.env.PUBLISHED.put(publishedRobotsKey(site.id), buildRobotsTxt(siteUrl), {
    httpMetadata: { contentType: "text/plain; charset=utf-8" },
  });
  await c.env.PUBLISHED.put(
    publishedSitemapKey(site.id),
    buildSitemapXml(
      siteUrl,
      pages.map((page) => page.lang),
      activeCampaigns.map((campaign) => `give/${campaign.slug}/`),
    ),
    { httpMetadata: { contentType: "application/xml; charset=utf-8" } },
  );

  // Stale images, language pages of languages that are no longer in the document, and pages of campaigns
  // that are no longer active.
  const written = new Set(pages.flatMap((page) => [page.key, page.thanksKey, ...page.campaignPages.map((p) => p.key)]));
  const sitePrefix = publishedPrefix(site.id);
  const stale = (await listKeys(c.env.PUBLISHED, sitePrefix)).filter((key) => {
    if (key.startsWith(imagePrefix)) return !keep.has(key);
    const rest = key.slice(sitePrefix.length);
    return (/^[^/]+\/(?:thanks\/)?index\.html$/.test(rest) || /^(?:[^/]+\/)?give\/[^/]+\/index\.html$/.test(rest)) && !written.has(key);
  });
  await deleteKeys(c.env.PUBLISHED, stale);

  const publishedAt = new Date();
  const publishedPath = `/${site.slug}/`;
  await db.batch([
    db.update(sites).set({ status: "published", publishedAt, publishedPath, updatedAt: publishedAt }).where(eq(sites.id, site.id)),
    orgEventInsert(db, { orgId: site.orgId, actorUserId: c.var.user.id, action: "site.published", target: site.id, detail: { slug: site.slug, languages } }),
  ]);

  return c.json({ url: publishedUrlFor(c.env, publishedPath), publishedAt: publishedAt.toISOString() });
});

publishRoutes.post("/sites/:id/unpublish", async (c) => {
  const db = drizzle(c.env.DB);
  const access = await requireSiteRole(c, db, c.req.param("id"), "editor");
  if (access instanceof Response) return access;
  const { site } = access;

  // Flip the status first so the site stops resolving even if object deletion is interrupted.
  await db.batch([
    db.update(sites).set({ status: "draft", publishedAt: null, publishedPath: null, updatedAt: new Date() }).where(eq(sites.id, site.id)),
    orgEventInsert(db, { orgId: site.orgId, actorUserId: c.var.user.id, action: "site.unpublished", target: site.id, detail: { slug: site.slug } }),
  ]);
  await deleteKeys(c.env.PUBLISHED, await listKeys(c.env.PUBLISHED, publishedPrefix(site.id)));

  return c.json({ ok: true });
});
