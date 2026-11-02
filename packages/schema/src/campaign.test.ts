import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CampaignInput,
  campaignPercent,
  campaignSlugFromTitle,
  donorDisplayName,
  formatMoney,
  GiftInput,
  giveLink,
  localizeCampaign,
  parseAmountToCents,
} from "./campaign.ts";
import { parseSiteDocument } from "./site.ts";

test("CampaignInput applies defaults and rejects unsafe giving links", () => {
  const parsed = CampaignInput.parse({ title: " Roof fund " });
  assert.equal(parsed.title, "Roof fund");
  assert.equal(parsed.status, "draft");
  assert.equal(parsed.currency, "USD");
  assert.deepEqual(parsed.suggestedAmounts, []);
  assert.equal(parsed.giveUrl, "");
  for (const giveUrl of ["http://x.example/give", "javascript:alert(1)", "zeffy.com/form"]) {
    assert.equal(CampaignInput.safeParse({ title: "x", giveUrl }).success, false, giveUrl);
  }
  assert.equal(CampaignInput.safeParse({ title: "x", slug: "Bad Slug" }).success, false);
  assert.equal(CampaignInput.safeParse({ title: "x", suggestedAmounts: [1, 2, 3, 4, 5, 6, 7] }).success, false);
});

test("GiftInput accepts an empty email and rejects non-integer amounts", () => {
  assert.equal(GiftInput.parse({ amountCents: 500 }).donorEmail, "");
  assert.equal(GiftInput.safeParse({ amountCents: 5.5 }).success, false);
  assert.equal(GiftInput.safeParse({ amountCents: 5, donorEmail: "nope" }).success, false);
});

test("percent, money and amount parsing", () => {
  assert.equal(campaignPercent(0, 0), 0);
  assert.equal(campaignPercent(50, 200), 25);
  assert.equal(campaignPercent(500, 200), 100);
  assert.equal(formatMoney(125000, "USD"), "$1,250");
  assert.equal(formatMoney(1250, "USD"), "$12.50");
  assert.equal(parseAmountToCents("$1,250.00"), 125000);
  assert.equal(parseAmountToCents("12.5"), 1250);
  assert.equal(parseAmountToCents("0"), null);
  assert.equal(parseAmountToCents("abc"), null);
  assert.equal(parseAmountToCents("1.234"), null);
});

test("giveLink appends campaign and amount safely", () => {
  assert.equal(giveLink("https://give.example/form?x=1", "roof"), "https://give.example/form?x=1&campaign=roof");
  assert.equal(giveLink("https://give.example/form", "roof", 2550), "https://give.example/form?campaign=roof&amount=25.50");
  assert.equal(giveLink("https://give.example/form", "roof", 2500), "https://give.example/form?campaign=roof&amount=25");
  assert.equal(giveLink("http://give.example/form", "roof"), null);
  assert.equal(giveLink("", "roof"), null);
});

test("donor display names and slugs", () => {
  assert.equal(donorDisplayName("Maria Lopez"), "Maria L.");
  assert.equal(donorDisplayName("  maria  de la cruz "), "maria C.");
  assert.equal(donorDisplayName("Solo"), "Solo");
  assert.equal(donorDisplayName("   "), "Anonymous");
  assert.equal(campaignSlugFromTitle("Winter Shelter 2026!"), "winter-shelter-2026");
  assert.equal(campaignSlugFromTitle("***"), "campaign");
});

test("localizeCampaign overlays only the given strings", () => {
  const campaign = CampaignInput.parse({ title: "Roof", story: "Fix it", translations: { es: { title: "Techo" } } });
  const es = localizeCampaign(campaign, "es", "en");
  assert.equal(es.title, "Techo");
  assert.equal(es.story, "Fix it");
  assert.equal(localizeCampaign(campaign, "en", "en"), campaign);
  assert.equal(localizeCampaign(campaign, "fr", "en").title, "Roof");
});

test("give sections carry a campaigns list that defaults to empty", () => {
  const doc = parseSiteDocument({ meta: { orgName: "x" }, sections: [{ id: "give", type: "give" }] });
  const give = doc.sections[0];
  assert.ok(give && give.type === "give");
  assert.deepEqual(give.campaigns, []);
});
