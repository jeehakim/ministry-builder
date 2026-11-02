import { emptySiteDocument, type Campaign, type CampaignTotals, type Gift } from "@ministry/schema";
import { renderCampaignPage } from "@ministry/templates";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseCsv, parseGiftCsv } from "../src/campaigns";
import { aiUsage, donors, gifts } from "../src/db/schema";
import { fillThankYou, thankYouEmail } from "../src/email/thankYou";
import realApp from "../src/index";
import { call, jsonInit, makeSite, uploadPng, type TestSite } from "./helpers";

const HOST = "sites.shofar.io";
const db = () => drizzle(env.DB);

afterEach(() => {
  vi.unstubAllGlobals();
});

type WithTotals = Campaign & { totals: CampaignTotals };
type CampaignBody = { campaign: WithTotals };
type GiftBody = { gift: Gift; totals: CampaignTotals };

function hosted(url: string, init?: RequestInit): Promise<Response> {
  return Promise.resolve(realApp.request(url, init, env));
}

const BASE = {
  title: "Winter Shelter",
  summary: "Keep forty neighbors warm this winter.",
  story: "Every winter, neighbors sleep outside.\n\nYour gift opens the shelter doors.",
  goalAmount: 500_000,
  currency: "USD",
  deadline: "2026-12-31",
  suggestedAmounts: [2_500, 5_000, 10_000],
  giveUrl: "https://www.zeffy.com/en-US/donation-form/abc?ref=site",
  donorWallEnabled: true,
  status: "active",
};

async function createCampaign(user: string, site: TestSite, overrides: Record<string, unknown> = {}): Promise<WithTotals> {
  const res = await call(user, `/sites/${site.id}/campaigns`, jsonInit("POST", { ...BASE, ...overrides }));
  if (res.status !== 201) throw new Error(`createCampaign failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as CampaignBody).campaign;
}

async function addGift(user: string, site: TestSite, campaignId: string, gift: Record<string, unknown>): Promise<GiftBody> {
  const res = await call(user, `/sites/${site.id}/campaigns/${campaignId}/gifts`, jsonInit("POST", gift));
  if (res.status !== 201) throw new Error(`addGift failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as GiftBody;
}

describe("campaign routes", () => {
  it("creates, lists, reads, updates and deletes a campaign with a derived slug", async () => {
    const site = await makeSite("cmp_a", "Shelter Org");
    const created = await createCampaign("cmp_a", site);
    expect(created).toMatchObject({ slug: "winter-shelter", siteId: site.id, orgId: site.orgId, status: "active", goalAmount: 500_000 });
    expect(created.totals).toEqual({ raisedAmount: 0, giftCount: 0, goalAmount: 500_000, currency: "USD", percent: 0 });

    const list = (await (await call("cmp_a", `/sites/${site.id}/campaigns`)).json()) as { campaigns: WithTotals[] };
    expect(list.campaigns.map((c) => c.id)).toEqual([created.id]);

    const read = (await (await call("cmp_a", `/sites/${site.id}/campaigns/${created.id}`)).json()) as CampaignBody;
    expect(read.campaign.title).toBe("Winter Shelter");

    const updated = await call("cmp_a", `/sites/${site.id}/campaigns/${created.id}`, jsonInit("PUT", { ...BASE, title: "Winter Shelter 2026", goalAmount: 600_000 }));
    expect(updated.status).toBe(200);
    expect(((await updated.json()) as CampaignBody).campaign).toMatchObject({ title: "Winter Shelter 2026", slug: "winter-shelter", goalAmount: 600_000 });

    // The slug is part of the public URL and cannot move.
    const renamed = await call("cmp_a", `/sites/${site.id}/campaigns/${created.id}`, jsonInit("PUT", { ...BASE, slug: "other" }));
    expect(renamed.status).toBe(400);

    expect((await call("cmp_a", `/sites/${site.id}/campaigns/${created.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await call("cmp_a", `/sites/${site.id}/campaigns/${created.id}`)).status).toBe(404);
  });

  it("rejects invalid input, duplicate slugs, foreign cover images and unknown translation languages", async () => {
    const site = await makeSite("cmp_b", "Validation Org");
    const bad = async (body: Record<string, unknown>, status = 400) => {
      const res = await call("cmp_b", `/sites/${site.id}/campaigns`, jsonInit("POST", { ...BASE, ...body }));
      expect(res.status).toBe(status);
    };
    await bad({ title: "" });
    await bad({ giveUrl: "http://insecure.example/give" });
    await bad({ giveUrl: "javascript:alert(1)" });
    await bad({ goalAmount: -5 });
    await bad({ suggestedAmounts: [0] });
    await bad({ currency: "dollars" });
    await bad({ deadline: "tomorrow" });
    await bad({ status: "paused" });
    await bad({ coverImage: { src: "/assets/sites/other-site/x.webp", alt: "" } });
    await bad({ translations: { fr: { title: "Abri" } } });

    await createCampaign("cmp_b", site, { slug: "fixed" });
    await bad({ slug: "fixed" }, 409);
    // Without an explicit slug a clash gets a suffix instead of a 409.
    const second = await createCampaign("cmp_b", site, { title: "Fixed" });
    expect(second.slug).toMatch(/^fixed-[0-9a-f]{4}$/);
  });

  it("hides other users' sites and campaigns, and lists an organization's campaigns", async () => {
    const site = await makeSite("cmp_c", "Private Org");
    const campaign = await createCampaign("cmp_c", site);
    expect((await call("cmp_d", `/sites/${site.id}/campaigns`)).status).toBe(404);
    expect((await call("cmp_d", `/sites/${site.id}/campaigns/${campaign.id}`)).status).toBe(404);
    expect((await call("cmp_d", `/sites/${site.id}/campaigns/${campaign.id}/gifts`, jsonInit("POST", { amountCents: 100 }))).status).toBe(404);
    expect((await call("cmp_d", `/orgs/${site.orgId}/campaigns`)).status).toBe(404);
    expect((await call(null, `/sites/${site.id}/campaigns`)).status).toBe(401);

    const org = (await (await call("cmp_c", `/orgs/${site.orgId}/campaigns`)).json()) as { campaigns: (WithTotals & { siteSlug: string })[]; sites: { id: string }[] };
    expect(org.campaigns).toHaveLength(1);
    expect(org.campaigns[0]).toMatchObject({ id: campaign.id, siteSlug: site.slug });
    expect(org.sites.map((s) => s.id)).toEqual([site.id]);
  });
});

describe("gifts and totals", () => {
  it("records gifts, sums them into totals, dedupes donors by email and deletes", async () => {
    const site = await makeSite("gift_a", "Gifts Org");
    const campaign = await createCampaign("gift_a", site);
    const first = await addGift("gift_a", site, campaign.id, { amountCents: 10_000, donorName: "Maria Lopez", donorEmail: "Maria@Example.org", public: true });
    expect(first.gift).toMatchObject({ amountCents: 10_000, currency: "USD", source: "offline", donorEmail: "maria@example.org", public: true, thankYouSentAt: null, thankYouError: null });
    expect(first.totals).toMatchObject({ raisedAmount: 10_000, giftCount: 1, percent: 2 });

    const second = await addGift("gift_a", site, campaign.id, { amountCents: 240_000, source: "external", donorEmail: "maria@example.org", receivedAt: "2026-01-05T10:00:00Z" });
    expect(second.totals).toMatchObject({ raisedAmount: 250_000, giftCount: 2, percent: 50 });

    const donorRows = await db().select().from(donors).where(eq(donors.orgId, site.orgId));
    expect(donorRows).toHaveLength(1);
    expect(donorRows[0]).toMatchObject({ email: "maria@example.org", name: "Maria Lopez" });

    const list = (await (await call("gift_a", `/sites/${site.id}/campaigns/${campaign.id}/gifts`)).json()) as { gifts: Gift[]; totals: CampaignTotals };
    expect(list.gifts.map((g) => g.id)).toEqual([first.gift.id, second.gift.id]);
    expect(list.totals.raisedAmount).toBe(250_000);

    const totals = (await (await call("gift_a", `/sites/${site.id}/campaigns/${campaign.id}/totals`)).json()) as CampaignTotals;
    expect(totals).toEqual({ raisedAmount: 250_000, giftCount: 2, goalAmount: 500_000, currency: "USD", percent: 50 });

    const del = await call("gift_a", `/sites/${site.id}/campaigns/${campaign.id}/gifts/${second.gift.id}`, { method: "DELETE" });
    expect(del.status).toBe(200);
    expect(((await del.json()) as { totals: CampaignTotals }).totals.raisedAmount).toBe(10_000);
    expect((await call("gift_a", `/sites/${site.id}/campaigns/${campaign.id}/gifts/${second.gift.id}`, { method: "DELETE" })).status).toBe(404);

    // Percent is capped at 100 once the goal is passed.
    await addGift("gift_a", site, campaign.id, { amountCents: 1_000_000 });
    const over = (await (await call("gift_a", `/sites/${site.id}/campaigns/${campaign.id}/totals`)).json()) as CampaignTotals;
    expect(over.percent).toBe(100);

    for (const body of [{ amountCents: 0 }, { amountCents: 12.5 }, { amountCents: 100, donorEmail: "not-an-email" }, { amountCents: 100, source: "card" }]) {
      expect((await call("gift_a", `/sites/${site.id}/campaigns/${campaign.id}/gifts`, jsonInit("POST", body))).status).toBe(400);
    }
  });

  it("sends a thank-you email through the configured sender when the gift has an email", async () => {
    const site = await makeSite("gift_b", "Thanks Org");
    const doc = emptySiteDocument("Thanks Org");
    const contact = doc.sections.find((s) => s.type === "contact");
    if (contact?.type === "contact") contact.email = "office@thanks.example";
    await call("gift_b", `/sites/${site.id}/document`, jsonInit("PUT", doc));
    const campaign = await createCampaign("gift_b", site, { thankYouMessage: "Dear {{name}},\n\nYour gift feeds a family.\n\nThanks Org" });

    const fetchStub = vi.fn(async () => Response.json({ id: "email_1" }));
    vi.stubGlobal("fetch", fetchStub);
    const resend = { ...env, EMAIL_PROVIDER: "resend", RESEND_API_KEY: "re_test_key", EMAIL_FROM: "Ministry Sites <forms@shofar.io>" };
    const res = await call("gift_b", `/sites/${site.id}/campaigns/${campaign.id}/gifts`, jsonInit("POST", { amountCents: 5_000, donorName: "Ada Giver", donorEmail: "ada@example.com" }), resend);
    expect(res.status).toBe(201);
    const body = (await res.json()) as GiftBody;
    expect(body.gift.thankYouSentAt).not.toBeNull();
    expect(body.gift.thankYouError).toBeNull();

    expect(fetchStub).toHaveBeenCalledTimes(1);
    const [url, init] = fetchStub.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    const sent = JSON.parse(String(init.body)) as { to: string[]; subject: string; text: string; reply_to?: string };
    expect(sent.to).toEqual(["ada@example.com"]);
    expect(sent.subject).toBe("Thank you for your gift to Winter Shelter");
    expect(sent.text).toContain("Dear Ada Giver,");
    expect(sent.text).toContain("Your gift feeds a family.");
    expect(sent.text).toContain("$50");
    expect(sent.reply_to).toBe("office@thanks.example");

    // Store-only mode: nothing is sent and nothing is recorded as an error.
    const quiet = await addGift("gift_b", site, campaign.id, { amountCents: 100, donorEmail: "quiet@example.com" });
    expect(quiet.gift.thankYouSentAt).toBeNull();
    expect(quiet.gift.thankYouError).toBeNull();
    expect(fetchStub).toHaveBeenCalledTimes(1);

    // A provider failure is recorded on the gift and never fails the request.
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ message: "domain not verified" }, { status: 403 })));
    const failed = await call("gift_b", `/sites/${site.id}/campaigns/${campaign.id}/gifts`, jsonInit("POST", { amountCents: 100, donorEmail: "x@example.com" }), resend);
    expect(failed.status).toBe(201);
    const failedBody = (await failed.json()) as GiftBody;
    expect(failedBody.gift.thankYouSentAt).toBeNull();
    expect(failedBody.gift.thankYouError).toContain("403");
  });

  it("builds the thank-you email from the default text with the name filled in", () => {
    expect(fillThankYou("Dear {{ name }}, thanks", "Ada")).toBe("Dear Ada, thanks");
    expect(fillThankYou("Dear {{name}}", "")).toBe("Dear friend");
    const email = thankYouEmail(
      { orgName: "Org", campaignTitle: "Roof <Fund>", donorName: "Ada Giver", amountCents: 12_550, currency: "USD", message: "", campaignUrl: "https://sites.shofar.io/org/give/roof/" },
      "ada@example.com",
    );
    expect(email.subject).toBe("Thank you for your gift to Roof <Fund>");
    expect(email.text).toContain("Dear Ada Giver,");
    expect(email.text).toContain("$125.50");
    expect(email.html).toContain("Roof &lt;Fund&gt;");
    expect(email.html).not.toContain("<Fund>");
  });
});

describe("CSV import", () => {
  const HEADER = "amount,name,email,date,source,public,note";

  it("parses quoted fields, CRLF rows and a BOM", () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\n\nlast,')).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"'],
      ["last", ""],
    ]);
  });

  it("validates rows and reports every problem with its row number", () => {
    const result = parseGiftCsv(`${HEADER}\n25,Ada,ada@example.com,2026-03-01,external,yes,first\nabc,Bob,,,,no,\n10,,bad-email,,,,\n5,,,,card,,\n7,,,,offline,maybe,`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual([
      { row: 2, message: 'Bad amount "abc"' },
      { row: 3, message: 'Bad email "bad-email"' },
      { row: 4, message: 'Source must be "external" or "offline", not "card"' },
      { row: 5, message: 'Public must be yes or no, not "maybe"' },
    ]);
    expect(parseGiftCsv("name,email\nAda,a@b.co")).toMatchObject({ ok: false, errors: [{ row: 0, message: 'The header row needs an "amount" column' }] });
    expect(parseGiftCsv("amount,phone\n5,123")).toMatchObject({ ok: false, errors: [{ row: 0, message: "Unknown column: phone" }] });
    expect(parseGiftCsv("amount\n")).toMatchObject({ ok: false, errors: [{ row: 0, message: "No rows after the header" }] });
    const tooMany = `amount\n${Array.from({ length: 2001 }, () => "1").join("\n")}`;
    expect(parseGiftCsv(tooMany)).toMatchObject({ ok: false, errors: [{ row: 0, message: "Too many rows (2001); the limit is 2000 per file" }] });
  });

  it("accepts a valid file with defaults for missing columns", () => {
    const result = parseGiftCsv(`Amount,Name,Email,Date,Public\n"$1,250.00",Maria Lopez,MARIA@example.org,2026-02-10,TRUE\n12.5,,,,`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toEqual([
      { row: 1, gift: { amountCents: 125_000, source: "external", donorName: "Maria Lopez", donorEmail: "MARIA@example.org", public: true, note: "", receivedAt: "2026-02-10T12:00:00.000Z" } },
      { row: 2, gift: { amountCents: 1_250, source: "external", donorName: "", donorEmail: "", public: false, note: "" } },
    ]);
  });

  it("imports all rows or none through the API, from JSON or text/csv, without thank-you emails", async () => {
    const site = await makeSite("csv_a", "Import Org");
    const campaign = await createCampaign("csv_a", site);
    const fetchStub = vi.fn(async () => Response.json({ id: "email_1" }));
    vi.stubGlobal("fetch", fetchStub);
    const resend = { ...env, EMAIL_PROVIDER: "resend", RESEND_API_KEY: "re_test_key" };

    const ok = await call("csv_a", `/sites/${site.id}/campaigns/${campaign.id}/gifts/import`, jsonInit("POST", { csv: `${HEADER}\n100,Ada,ada@example.com,2026-01-01,offline,yes,cash\n50.25,Bob,ada@example.com,,external,no,` }), resend);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ imported: 2, errors: [], totals: { raisedAmount: 15_025, giftCount: 2 } });
    expect(fetchStub).not.toHaveBeenCalled();
    expect(await db().select().from(donors).where(eq(donors.orgId, site.orgId))).toHaveLength(1);

    const rows = await db().select().from(gifts).where(eq(gifts.campaignId, campaign.id));
    expect(rows.every((r) => r.thankYouSentAt === null && r.recordedBy === "csv_a")).toBe(true);

    const text = await call("csv_a", `/sites/${site.id}/campaigns/${campaign.id}/gifts/import`, { method: "POST", headers: { "content-type": "text/csv" }, body: "amount\n7" });
    expect(text.status).toBe(200);
    expect(await text.json()).toMatchObject({ imported: 1, totals: { giftCount: 3 } });

    const bad = await call("csv_a", `/sites/${site.id}/campaigns/${campaign.id}/gifts/import`, jsonInit("POST", { csv: "amount\n5\nnope" }));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ imported: 0, errors: [{ row: 2, message: 'Bad amount "nope"' }], totals: { giftCount: 3 } });
    expect(await db().select().from(gifts).where(eq(gifts.campaignId, campaign.id))).toHaveLength(3);
  });
});

describe("campaign AI", () => {
  it("drafts a story and a thank-you through the provider and records usage", async () => {
    const site = await makeSite("cmp_ai", "AI Org");
    const campaign = await createCampaign("cmp_ai", site);
    const story = await call("cmp_ai", `/sites/${site.id}/campaigns/${campaign.id}/ai/story`, jsonInit("POST", { brief: "We open a winter shelter for forty neighbors every December." }));
    expect(story.status).toBe(200);
    const storyBody = (await story.json()) as { title: string; summary: string; story: string };
    expect(storyBody.title).toBe("Campaign for AI Org");
    expect(storyBody.story).toContain("winter shelter");
    expect(storyBody.story).toContain("$5,000");

    const thanks = await call("cmp_ai", `/sites/${site.id}/campaigns/${campaign.id}/ai/thank-you`, jsonInit("POST", { notes: "Mention the January opening." }));
    expect(thanks.status).toBe(200);
    const thanksBody = (await thanks.json()) as { message: string };
    expect(thanksBody.message).toContain("Dear {{name}}");
    expect(thanksBody.message).toContain("Winter Shelter");

    const rows = await db().select({ action: aiUsage.action }).from(aiUsage).where(eq(aiUsage.userId, "cmp_ai"));
    expect(rows.map((r) => r.action).sort()).toEqual(["campaign_story", "thank_you"]);

    expect((await call("cmp_ai", `/sites/${site.id}/campaigns/${campaign.id}/ai/story`, jsonInit("POST", { brief: "short" }))).status).toBe(400);
    expect((await call("cmp_ai", `/sites/${site.id}/campaigns/nope/ai/story`, jsonInit("POST", { brief: "A long enough brief here." }))).status).toBe(404);
    expect((await call("cmp_zz", `/sites/${site.id}/campaigns/${campaign.id}/ai/story`, jsonInit("POST", { brief: "A long enough brief here." }))).status).toBe(404);
  });
});

describe("publishing and hosting campaign pages", () => {
  it("renders a campaign page with progress bar, amount links, donor wall and cards, in every language", async () => {
    const site = await makeSite("cmp_pub", "Publish Org");
    const image = await uploadPng("cmp_pub", site.id);
    const file = image.key.slice(image.key.lastIndexOf("/") + 1);
    await call("cmp_pub", `/sites/${site.id}/ai/translate`, jsonInit("POST", { language: "es" }));
    const active = await createCampaign("cmp_pub", site, {
      coverImage: { src: `/assets/${image.key}`, alt: "Shelter" },
      translations: { es: { title: "Refugio de invierno", story: "Cada invierno." } },
    });
    const draft = await createCampaign("cmp_pub", site, { title: "Not yet", status: "draft" });
    await addGift("cmp_pub", site, active.id, { amountCents: 125_000, donorName: "Maria Lopez", public: true });
    await addGift("cmp_pub", site, active.id, { amountCents: 125_000, donorName: "Hidden Person", public: false });
    await addGift("cmp_pub", site, active.id, { amountCents: 1_000, donorName: "Solo", public: true });
    // A page from an earlier publish of a campaign that is no longer active must go.
    await env.PUBLISHED.put(`published/${site.id}/give/old-drive/index.html`, "old");

    const res = await call("cmp_pub", `/sites/${site.id}/publish`, { method: "POST" });
    expect(res.status).toBe(200);

    const page = await hosted(`https://${HOST}/${site.slug}/give/winter-shelter/`);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(page.headers.get("cache-control")).toBe("public, max-age=60");
    const html = await page.text();
    expect(html).toContain("<h1>Winter Shelter</h1>");
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="50"');
    expect(html).toContain("width:50%");
    expect(html).toContain("$2,510");
    expect(html).toContain("$5,000");
    expect(html).toContain("3 gifts");
    expect(html).not.toContain("<script");
    // Suggested amounts link out with the campaign and amount in the query string, the existing query kept.
    expect(html).toContain('href="https://www.zeffy.com/en-US/donation-form/abc?ref=site&amp;campaign=winter-shelter&amp;amount=25"');
    expect(html).toContain('href="https://www.zeffy.com/en-US/donation-form/abc?ref=site&amp;campaign=winter-shelter"');
    // Donor wall: public gifts only, first name and initial.
    expect(html).toContain("Maria L.");
    expect(html).toContain("<li>Solo</li>");
    expect(html).not.toContain("Lopez");
    expect(html).not.toContain("Hidden");
    expect(html).toContain(`../../images/${file}`);
    expect(html).toContain(`<link rel="canonical" href="https://${HOST}/${site.slug}/give/winter-shelter/">`);
    expect(html).toContain('hreflang="es" href="https://sites.shofar.io/' + site.slug + '/es/give/winter-shelter/"');

    const es = await hosted(`https://${HOST}/${site.slug}/es/give/winter-shelter/`);
    expect(es.status).toBe(200);
    expect(es.headers.get("content-language")).toBe("es");
    const esHtml = await es.text();
    expect(esHtml).toContain("<h1>Refugio de invierno</h1>");
    expect(esHtml).toContain("Cada invierno.");
    expect(esHtml).toContain("recaudado");
    expect(esHtml).toContain(`../../../images/${file}`);

    // Cards in the Give section of the home page, linking to the active campaign only.
    const home = await (await hosted(`https://${HOST}/${site.slug}/`)).text();
    expect(home).toContain('class="campaign-card"');
    expect(home).toContain('href="give/winter-shelter/"');
    expect(home).not.toContain("Not yet");
    const esHome = await (await hosted(`https://${HOST}/${site.slug}/es/`)).text();
    expect(esHome).toContain("Refugio de invierno");

    // Draft campaigns have no page; stale pages are removed; the sitemap lists the live ones.
    expect((await hosted(`https://${HOST}/${site.slug}/give/${draft.slug}/`)).status).toBe(404);
    expect(await env.PUBLISHED.head(`published/${site.id}/give/old-drive/index.html`)).toBeNull();
    const sitemap = await (await hosted(`https://${HOST}/${site.slug}/sitemap.xml`)).text();
    expect(sitemap).toContain(`<loc>https://${HOST}/${site.slug}/give/winter-shelter/</loc>`);
    expect(sitemap).toContain(`<loc>https://${HOST}/${site.slug}/es/give/winter-shelter/</loc>`);
    expect(sitemap).not.toContain(draft.slug);

    // Trailing slash redirect for known pages, 404 for unknown ones and bad slugs.
    const slash = await hosted(`https://${HOST}/${site.slug}/give/winter-shelter`, { redirect: "manual" });
    expect(slash.status).toBe(301);
    expect(slash.headers.get("location")).toBe(`/${site.slug}/give/winter-shelter/`);
    expect((await hosted(`https://${HOST}/${site.slug}/give/missing`)).status).toBe(404);
    expect((await hosted(`https://${HOST}/${site.slug}/give/..%2Fx/`)).status).toBe(404);
  });

  it("honours the Give section's campaign selection and shows no cards when none are active", async () => {
    const site = await makeSite("cmp_sel", "Select Org");
    const a = await createCampaign("cmp_sel", site, { title: "Alpha" });
    const b = await createCampaign("cmp_sel", site, { title: "Beta" });
    const doc = emptySiteDocument("Select Org");
    const give = doc.sections.find((s) => s.type === "give");
    if (give?.type === "give") give.campaigns = [b.id];
    await call("cmp_sel", `/sites/${site.id}/document`, jsonInit("PUT", doc));
    await call("cmp_sel", `/sites/${site.id}/publish`, { method: "POST" });
    const home = await (await hosted(`https://${HOST}/${site.slug}/`)).text();
    expect(home).toContain("Beta");
    expect(home).not.toContain(">Alpha<");
    // Both pages exist regardless of the cards shown.
    expect((await hosted(`https://${HOST}/${site.slug}/give/${a.slug}/`)).status).toBe(200);

    await call("cmp_sel", `/sites/${site.id}/campaigns/${b.id}`, jsonInit("PUT", { ...BASE, title: "Beta", status: "closed" }));
    await call("cmp_sel", `/sites/${site.id}/campaigns/${a.id}`, { method: "DELETE" });
    await call("cmp_sel", `/sites/${site.id}/publish`, { method: "POST" });
    const after = await (await hosted(`https://${HOST}/${site.slug}/`)).text();
    expect(after).not.toContain('class="campaign-card"');
    expect((await hosted(`https://${HOST}/${site.slug}/give/${b.slug}/`)).status).toBe(404);
  });

  it("renders a closed campaign without give buttons and escapes campaign text", () => {
    const doc = emptySiteDocument("Render <Org>");
    const { html, images } = renderCampaignPage(
      doc,
      { ...BASE, status: "closed", slug: "x", title: "Title <b>bold</b>", giveLabel: "", coverImage: { src: "/assets/sites/s/c.webp", alt: "cover" } } as never,
      { raisedAmount: 0, giftCount: 0, goalAmount: 0, currency: "USD", percent: 0 },
      { imageUrl: (ref) => ref.src, siteHref: "../../", donorWall: ["Ada G."] },
    );
    expect(html).toContain("Title &lt;b&gt;bold&lt;/b&gt;");
    expect(html).toContain("This campaign has ended");
    expect(html).not.toContain('class="cp-give"');
    expect(html).not.toContain('role="progressbar"');
    expect(html).toContain("Ada G.");
    expect(images).toEqual([{ src: "/assets/sites/s/c.webp", alt: "cover" }]);
  });
});
