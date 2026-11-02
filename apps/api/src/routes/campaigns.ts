import {
  AiCampaignStoryRequest,
  AiThankYouRequest,
  CAMPAIGN_SLUG_PATTERN,
  CampaignInput,
  campaignSlugFromTitle,
  formatMoney,
  GiftImportRequest,
  GiftInput,
  LANGUAGE_NAMES,
  localizeCampaign,
  siteLanguages,
  type AiCampaignStoryResponse,
  type AiThankYouResponse,
  type Campaign,
  type CampaignListResponse,
  type CampaignResponse,
  type CampaignTotals,
  type CampaignWithTotals,
  type GiftImportResponse,
  type GiftListResponse,
  type GiftResponse,
  type SiteDocument,
} from "@ministry/schema";
import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Context } from "hono";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { isSiteAssetKey, loadAuthorizedOrg, loadAuthorizedSite } from "../access";
import { giftTotals, loadCampaigns, parseGiftCsv, toCampaign, toGift, totalsFor } from "../campaigns";
import { campaigns, donors, gifts, sites, type CampaignRow, type Site } from "../db/schema";
import { createSender } from "../email";
import { resolveOrgSender, type OrgSenderResolution } from "../email/orgSender";
import { thankYouEmail } from "../email/thankYou";
import { newId } from "../ids";
import { errorFields, logError, requestIdOf } from "../log";
import { publicCampaignUrl } from "../published";
import type { AppEnv } from "../types";
import { callProvider, currentDocument, finishUsage, guard, parseBody } from "./ai";

type Ctx = Context<AppEnv>;

const MAX_CAMPAIGN_BODY_BYTES = 64 * 1024;
/** 2 MB of CSV is far more than 2000 rows need; the row limit is enforced after parsing. */
const MAX_IMPORT_BODY_BYTES = 2 * 1024 * 1024 + 1024;
const SEND_TIMEOUT_MS = 10_000;
const MAX_THANK_YOU_ERROR = 300;
const ABSOLUTE_URL = /^(?:https?:)?\/\//i;

const campaignBody = bodyLimit({ maxSize: MAX_CAMPAIGN_BODY_BYTES, onError: (c) => c.json({ error: "Body too large" }, 413) });
const importBody = bodyLimit({ maxSize: MAX_IMPORT_BODY_BYTES, onError: (c) => c.json({ error: "File too large (2 MB at most)" }, 413) });

function isUniqueViolation(err: unknown): boolean {
  const text = err instanceof Error ? `${err.message} ${String(err.cause ?? "")}` : String(err);
  return text.includes("UNIQUE constraint failed");
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Email send timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Loads the site (404 for missing or not yours) and one of its campaigns (404 likewise). */
async function loadSiteCampaign(c: Ctx): Promise<{ site: Site; row: CampaignRow } | Response> {
  const db = drizzle(c.env.DB);
  const site = await loadAuthorizedSite(db, c.var.user, c.req.param("id") ?? "");
  if (!site) return c.json({ error: "Site not found" }, 404);
  const [row] = await db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.id, c.req.param("cid") ?? ""), eq(campaigns.siteId, site.id)))
    .limit(1);
  if (!row) return c.json({ error: "Campaign not found" }, 404);
  return { site, row };
}

async function withTotals(db: ReturnType<typeof drizzle>, campaign: Campaign): Promise<CampaignWithTotals> {
  const totals = await giftTotals(db, [campaign.id]);
  return { ...campaign, totals: totalsFor(campaign, totals.get(campaign.id)) };
}

/** The cover image must be one of this site's own uploads or an absolute URL. */
function coverImageProblem(siteId: string, input: CampaignInput): string | null {
  const src = input.coverImage?.src;
  if (!src || ABSOLUTE_URL.test(src)) return null;
  const key = src.replace(/^\/assets\//, "");
  return isSiteAssetKey(siteId, key) ? null : "Cover image does not belong to this site";
}

/** Only languages of the site may carry a translation overlay. */
function translationProblem(doc: SiteDocument | null, input: CampaignInput): string | null {
  const allowed = new Set(doc ? siteLanguages(doc) : []);
  for (const lang of Object.keys(input.translations)) {
    if (!allowed.has(lang)) return `The site has no "${lang}" language`;
  }
  return null;
}

function columnsFrom(input: CampaignInput) {
  return {
    title: input.title,
    summary: input.summary,
    story: input.story,
    goalAmount: input.goalAmount,
    currency: input.currency,
    deadline: input.deadline ?? null,
    coverImageJson: input.coverImage ? JSON.stringify(input.coverImage) : null,
    suggestedAmountsJson: JSON.stringify(input.suggestedAmounts),
    giveUrl: input.giveUrl,
    giveLabel: input.giveLabel,
    donorWallEnabled: input.donorWallEnabled,
    thankYouMessage: input.thankYouMessage,
    status: input.status,
    translationsJson: JSON.stringify(input.translations),
  };
}

export const campaignRoutes = new Hono<AppEnv>();

// ---- Campaigns ---------------------------------------------------------

campaignRoutes.get("/sites/:id/campaigns", async (c) => {
  const db = drizzle(c.env.DB);
  const site = await loadAuthorizedSite(db, c.var.user, c.req.param("id"));
  if (!site) return c.json({ error: "Site not found" }, 404);
  const body: CampaignListResponse = { campaigns: await loadCampaigns(db, site.id) };
  return c.json(body);
});

/** Every campaign of an organization, across its sites, for the Fundraising dashboard. */
campaignRoutes.get("/orgs/:orgId/campaigns", async (c) => {
  const db = drizzle(c.env.DB);
  const org = await loadAuthorizedOrg(db, c.var.user, c.req.param("orgId"));
  if (!org) return c.json({ error: "Organization not found" }, 404);
  const orgSites = await db.select({ id: sites.id, slug: sites.slug, publishedPath: sites.publishedPath }).from(sites).where(eq(sites.orgId, org.id));
  const lists = await Promise.all(orgSites.map((s) => loadCampaigns(db, s.id)));
  const slugs = new Map(orgSites.map((s) => [s.id, s.slug]));
  const body = {
    campaigns: lists
      .flat()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((campaign) => ({ ...campaign, siteSlug: slugs.get(campaign.siteId) ?? "" })),
    sites: orgSites.map((s) => ({ id: s.id, slug: s.slug, published: s.publishedPath !== null })),
  };
  return c.json(body);
});

campaignRoutes.post("/sites/:id/campaigns", campaignBody, async (c) => {
  const db = drizzle(c.env.DB);
  const site = await loadAuthorizedSite(db, c.var.user, c.req.param("id"));
  if (!site) return c.json({ error: "Site not found" }, 404);
  const input = await parseBody(c, CampaignInput);
  if (input instanceof Response) return input;
  const problem = coverImageProblem(site.id, input) ?? translationProblem(await currentDocument(db, site), input);
  if (problem) return c.json({ error: problem }, 400);

  const slug = input.slug ?? campaignSlugFromTitle(input.title);
  const id = newId("cmp");
  const insert = (finalSlug: string) =>
    db.insert(campaigns).values({ id, orgId: site.orgId, siteId: site.id, slug: finalSlug, createdBy: c.var.user.id, ...columnsFrom(input) });
  try {
    await insert(slug);
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    if (input.slug !== undefined) return c.json({ error: "A campaign with that slug already exists on this site" }, 409);
    await insert(`${slug.slice(0, 35)}-${crypto.randomUUID().slice(0, 4)}`);
  }
  const [row] = await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
  const body: CampaignResponse = { campaign: await withTotals(db, toCampaign(row!)) };
  return c.json(body, 201);
});

campaignRoutes.get("/sites/:id/campaigns/:cid", async (c) => {
  const loaded = await loadSiteCampaign(c);
  if (loaded instanceof Response) return loaded;
  const body: CampaignResponse = { campaign: await withTotals(drizzle(c.env.DB), toCampaign(loaded.row)) };
  return c.json(body);
});

campaignRoutes.put("/sites/:id/campaigns/:cid", campaignBody, async (c) => {
  const loaded = await loadSiteCampaign(c);
  if (loaded instanceof Response) return loaded;
  const db = drizzle(c.env.DB);
  const input = await parseBody(c, CampaignInput);
  if (input instanceof Response) return input;
  // The slug is part of a published URL, so it stays what it was.
  if (input.slug !== undefined && input.slug !== loaded.row.slug) return c.json({ error: "The slug cannot change after the campaign is created" }, 400);
  const problem = coverImageProblem(loaded.site.id, input) ?? translationProblem(await currentDocument(db, loaded.site), input);
  if (problem) return c.json({ error: problem }, 400);

  await db
    .update(campaigns)
    .set({ ...columnsFrom(input), updatedAt: new Date() })
    .where(eq(campaigns.id, loaded.row.id));
  const [row] = await db.select().from(campaigns).where(eq(campaigns.id, loaded.row.id)).limit(1);
  const body: CampaignResponse = { campaign: await withTotals(db, toCampaign(row!)) };
  return c.json(body);
});

/** Deletes a campaign with its gifts. Donor records stay with the organization. The published page goes on the next publish. */
campaignRoutes.delete("/sites/:id/campaigns/:cid", async (c) => {
  const loaded = await loadSiteCampaign(c);
  if (loaded instanceof Response) return loaded;
  const db = drizzle(c.env.DB);
  await db.batch([db.delete(gifts).where(eq(gifts.campaignId, loaded.row.id)), db.delete(campaigns).where(eq(campaigns.id, loaded.row.id))]);
  return c.json({ ok: true });
});

campaignRoutes.get("/sites/:id/campaigns/:cid/totals", async (c) => {
  const loaded = await loadSiteCampaign(c);
  if (loaded instanceof Response) return loaded;
  const campaign = toCampaign(loaded.row);
  const totals = await giftTotals(drizzle(c.env.DB), [campaign.id]);
  const body: CampaignTotals = totalsFor(campaign, totals.get(campaign.id));
  return c.json(body);
});

// ---- Gifts -------------------------------------------------------------

const DEFAULT_GIFT_LIMIT = 200;
const MAX_GIFT_LIMIT = 2000;

campaignRoutes.get("/sites/:id/campaigns/:cid/gifts", async (c) => {
  const loaded = await loadSiteCampaign(c);
  if (loaded instanceof Response) return loaded;
  const db = drizzle(c.env.DB);
  const requested = Number.parseInt(c.req.query("limit") ?? "", 10);
  const limit = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), MAX_GIFT_LIMIT) : DEFAULT_GIFT_LIMIT;
  const rows = await db
    .select()
    .from(gifts)
    .where(eq(gifts.campaignId, loaded.row.id))
    .orderBy(desc(gifts.receivedAt), desc(gifts.id))
    .limit(limit);
  const campaign = toCampaign(loaded.row);
  const totals = await giftTotals(db, [campaign.id]);
  const body: GiftListResponse = { gifts: rows.map(toGift), totals: totalsFor(campaign, totals.get(campaign.id)) };
  return c.json(body);
});

/** Finds or creates the organization's donor record for an email address. Null without an email. */
async function donorIdFor(db: ReturnType<typeof drizzle>, orgId: string, name: string, email: string): Promise<string | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;
  const [existing] = await db
    .select({ id: donors.id, name: donors.name })
    .from(donors)
    .where(and(eq(donors.orgId, orgId), eq(donors.email, normalized)))
    .limit(1);
  if (existing) {
    // A later gift with a name fills in a record that was created from an email alone.
    if (!existing.name && name) await db.update(donors).set({ name }).where(eq(donors.id, existing.id));
    return existing.id;
  }
  const id = newId("don");
  await db.insert(donors).values({ id, orgId, name, email: normalized }).onConflictDoNothing();
  const [row] = await db
    .select({ id: donors.id })
    .from(donors)
    .where(and(eq(donors.orgId, orgId), eq(donors.email, normalized)))
    .limit(1);
  return row?.id ?? id;
}

function giftColumns(orgId: string, campaign: Campaign, input: GiftInput, donorId: string | null, recordedBy: string) {
  return {
    id: newId("gift"),
    orgId,
    campaignId: campaign.id,
    donorId,
    amountCents: input.amountCents,
    currency: campaign.currency,
    source: input.source,
    donorName: input.donorName,
    donorEmail: input.donorEmail.trim().toLowerCase(),
    public: input.public,
    note: input.note,
    receivedAt: input.receivedAt ? new Date(input.receivedAt) : new Date(),
    recordedBy,
  };
}

/**
 * Emails the donor through the organization's own sender, else the platform's; store-only when neither
 * is configured. The outcome lands on the gift row and never fails the request.
 */
async function sendThankYou(c: Ctx, site: Site, campaign: Campaign, gift: { id: string; donorName: string; donorEmail: string; amountCents: number }): Promise<void> {
  if (!gift.donorEmail) return;
  const db = drizzle(c.env.DB);
  const org = await resolveOrgSender(c.env, db, site.orgId);
  const platform = createSender(c.env);
  const choice: OrgSenderResolution = org ?? (platform ? { sender: platform } : null);
  if (!choice) return;
  const doc = await currentDocument(db, site);
  const orgName = doc?.meta.orgName ?? "";
  const replyTo = doc?.sections.flatMap((s) => (s.type === "contact" && s.email.trim() ? [s.email.trim()] : []))[0];
  const localized = doc ? localizeCampaign(campaign, doc.meta.language, doc.meta.language) : campaign;
  try {
    if ("error" in choice) throw new Error(choice.error);
    const message = thankYouEmail(
      {
        orgName: orgName || "Our team",
        campaignTitle: localized.title,
        donorName: gift.donorName,
        amountCents: gift.amountCents,
        currency: campaign.currency,
        message: localized.thankYouMessage,
        campaignUrl: site.publishedPath && campaign.status === "active" ? publicCampaignUrl(c.env, site.slug, campaign.slug) : undefined,
        replyTo,
      },
      gift.donorEmail,
    );
    await withTimeout(choice.sender.send(message), SEND_TIMEOUT_MS);
    await db.update(gifts).set({ thankYouSentAt: new Date(), thankYouError: null }).where(eq(gifts.id, gift.id));
  } catch (err) {
    const reason = (err instanceof Error ? err.message : String(err)).slice(0, MAX_THANK_YOU_ERROR);
    logError("thank_you_email_failed", requestIdOf(c), { site_id: site.id, gift_id: gift.id, via: org ? "organization" : "platform", ...errorFields(err) });
    await db.update(gifts).set({ thankYouError: reason }).where(eq(gifts.id, gift.id));
  }
}

campaignRoutes.post("/sites/:id/campaigns/:cid/gifts", campaignBody, async (c) => {
  const loaded = await loadSiteCampaign(c);
  if (loaded instanceof Response) return loaded;
  const input = await parseBody(c, GiftInput);
  if (input instanceof Response) return input;
  const db = drizzle(c.env.DB);
  const campaign = toCampaign(loaded.row);
  const donorId = await donorIdFor(db, loaded.site.orgId, input.donorName, input.donorEmail);
  const values = giftColumns(loaded.site.orgId, campaign, input, donorId, c.var.user.id);
  await db.insert(gifts).values(values);
  await sendThankYou(c, loaded.site, campaign, values);

  const [row] = await db.select().from(gifts).where(eq(gifts.id, values.id)).limit(1);
  const totals = await giftTotals(db, [campaign.id]);
  const body: GiftResponse = { gift: toGift(row!), totals: totalsFor(campaign, totals.get(campaign.id)) };
  return c.json(body, 201);
});

campaignRoutes.delete("/sites/:id/campaigns/:cid/gifts/:gid", async (c) => {
  const loaded = await loadSiteCampaign(c);
  if (loaded instanceof Response) return loaded;
  const db = drizzle(c.env.DB);
  const [gift] = await db
    .select({ id: gifts.id })
    .from(gifts)
    .where(and(eq(gifts.id, c.req.param("gid")), eq(gifts.campaignId, loaded.row.id)))
    .limit(1);
  if (!gift) return c.json({ error: "Gift not found" }, 404);
  await db.delete(gifts).where(eq(gifts.id, gift.id));
  const campaign = toCampaign(loaded.row);
  const totals = await giftTotals(db, [campaign.id]);
  return c.json({ ok: true, totals: totalsFor(campaign, totals.get(campaign.id)) });
});

/**
 * Imports gifts from a CSV (see `GIFT_CSV_COLUMNS`). All rows are validated first and nothing is written
 * when any row fails. Imported gifts get no thank-you email: they are usually historical, and a bulk
 * send from a spreadsheet is not something staff should trigger by accident.
 */
campaignRoutes.post("/sites/:id/campaigns/:cid/gifts/import", importBody, async (c) => {
  const loaded = await loadSiteCampaign(c);
  if (loaded instanceof Response) return loaded;
  const contentType = c.req.header("content-type") ?? "";
  let csv: string;
  if (contentType.startsWith("text/csv") || contentType.startsWith("text/plain")) {
    csv = await c.req.text();
  } else {
    const input = await parseBody(c, GiftImportRequest);
    if (input instanceof Response) return input;
    csv = input.csv;
  }
  const db = drizzle(c.env.DB);
  const campaign = toCampaign(loaded.row);
  const parsed = parseGiftCsv(csv);
  if (!parsed.ok) {
    const totals = await giftTotals(db, [campaign.id]);
    const body: GiftImportResponse = { imported: 0, errors: parsed.errors, totals: totalsFor(campaign, totals.get(campaign.id)) };
    return c.json(body, 400);
  }

  // Donor records are shared across the rows of one file, so look each email up once.
  const donorIds = new Map<string, string | null>();
  const values = [];
  for (const { gift } of parsed.rows) {
    const email = gift.donorEmail.trim().toLowerCase();
    let donorId = donorIds.get(email);
    if (donorId === undefined) {
      donorId = await donorIdFor(db, loaded.site.orgId, gift.donorName, email);
      donorIds.set(email, donorId);
    }
    values.push(giftColumns(loaded.site.orgId, campaign, gift, donorId, c.var.user.id));
  }
  // D1 batches are transactional; chunks keep each statement under the bound-parameter limit.
  for (let i = 0; i < values.length; i += 50) {
    await db.insert(gifts).values(values.slice(i, i + 50));
  }
  const totals = await giftTotals(db, [campaign.id]);
  const body: GiftImportResponse = { imported: values.length, errors: [], totals: totalsFor(campaign, totals.get(campaign.id)) };
  return c.json(body);
});

// ---- AI ----------------------------------------------------------------

function deadlineText(deadline: string | undefined): string | undefined {
  if (!deadline) return undefined;
  const date = new Date(`${deadline}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? undefined : date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

/** Keeps a requested language to one the site has, so the model writes something the page can show. */
function knownLanguage(doc: SiteDocument | null, requested: string): string {
  if (doc && siteLanguages(doc).includes(requested)) return requested;
  if (Object.hasOwn(LANGUAGE_NAMES, requested)) return requested;
  return doc?.meta.language ?? "en";
}

campaignRoutes.post("/sites/:id/campaigns/:cid/ai/story", campaignBody, async (c) => {
  const g = await guard(c);
  if (g instanceof Response) return g;
  const loaded = await loadSiteCampaign(c);
  if (loaded instanceof Response) return loaded;
  const body = await parseBody(c, AiCampaignStoryRequest);
  if (body instanceof Response) return body;
  const db = drizzle(c.env.DB);
  const campaign = toCampaign(loaded.row);
  const language = knownLanguage(await currentDocument(db, loaded.site), body.language);

  const called = await callProvider(c, g.site.id, "campaign_story", () =>
    g.provider.campaignStory({
      brief: body.brief,
      language,
      orgName: g.orgName,
      goalText: campaign.goalAmount > 0 ? formatMoney(campaign.goalAmount, campaign.currency) : undefined,
      deadline: deadlineText(campaign.deadline),
    }),
  );
  if (called instanceof Response) return called;
  const { result, usageId } = called;

  await finishUsage(db, usageId, result.usage, {
    request: { campaignId: campaign.id, brief: body.brief, language },
    result: { title: result.title, summary: result.summary, story: result.story },
  });
  const response: AiCampaignStoryResponse = { title: result.title, summary: result.summary, story: result.story };
  return c.json(response);
});

campaignRoutes.post("/sites/:id/campaigns/:cid/ai/thank-you", campaignBody, async (c) => {
  const g = await guard(c);
  if (g instanceof Response) return g;
  const loaded = await loadSiteCampaign(c);
  if (loaded instanceof Response) return loaded;
  const body = await parseBody(c, AiThankYouRequest);
  if (body instanceof Response) return body;
  const db = drizzle(c.env.DB);
  const campaign = toCampaign(loaded.row);
  const language = knownLanguage(await currentDocument(db, loaded.site), body.language);

  const called = await callProvider(c, g.site.id, "thank_you", () =>
    g.provider.thankYou({ campaignTitle: campaign.title, story: campaign.story, orgName: g.orgName, language, notes: body.notes }),
  );
  if (called instanceof Response) return called;
  const { result, usageId } = called;

  await finishUsage(db, usageId, result.usage, {
    request: { campaignId: campaign.id, notes: body.notes, language },
    result: { message: result.message },
  });
  const response: AiThankYouResponse = { message: result.message };
  return c.json(response);
});
