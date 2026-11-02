import { test } from "node:test";
import assert from "node:assert/strict";
import {
  amountsToText,
  campaignPublicUrl,
  centsToText,
  giftCsvTemplate,
  orgsFromSites,
  progressText,
  publishState,
  resolveOrg,
  textToAmounts,
  textToGoal,
} from "./fundraising.ts";

test("orgsFromSites keeps one entry per organization in first-seen order", () => {
  const orgs = orgsFromSites([
    { orgId: "b", orgName: "Beta" },
    { orgId: "a", orgName: "Alpha" },
    { orgId: "b", orgName: "Beta again" },
  ]);
  assert.deepEqual(orgs, [
    { id: "b", name: "Beta" },
    { id: "a", name: "Alpha" },
  ]);
});

test("resolveOrg prefers the URL, then the remembered one, then the first", () => {
  const orgs = [
    { id: "a", name: "A" },
    { id: "b", name: "B" },
  ];
  assert.equal(resolveOrg(orgs, "b", "a"), "b");
  assert.equal(resolveOrg(orgs, "zz", "b"), "b");
  assert.equal(resolveOrg(orgs, null, "gone"), "a");
  assert.equal(resolveOrg([], "a", "b"), null);
});

test("progress and money text", () => {
  assert.equal(progressText({ raisedAmount: 251_000, goalAmount: 500_000, currency: "USD", percent: 50, giftCount: 3 }), "$2,510 of $5,000 · 50%");
  assert.equal(progressText({ raisedAmount: 2_550, goalAmount: 0, currency: "USD", percent: 0, giftCount: 1 }), "$25.50 raised");
  assert.equal(centsToText(2_500), "25");
  assert.equal(centsToText(2_550), "25.50");
  assert.equal(centsToText(0), "");
  assert.equal(amountsToText([2_500, 5_000, 12_345]), "25, 50, 123.45");
});

test("textToAmounts parses, dedupes and reports bad entries", () => {
  assert.deepEqual(textToAmounts("25, 50,50, $100.00"), { amounts: [2_500, 5_000, 10_000], error: null });
  assert.deepEqual(textToAmounts(""), { amounts: [], error: null });
  assert.equal(textToAmounts("25, lots").error, '"lots" is not an amount');
  assert.equal(textToAmounts("1,2,3,4,5,6,7").error, "At most 6 suggested amounts");
  assert.deepEqual(textToGoal(" "), { goal: 0, error: null });
  assert.deepEqual(textToGoal("5,000"), { goal: 500_000, error: null });
  assert.equal(textToGoal("five").error, "The goal must be an amount such as 5000");
});

test("campaignPublicUrl and publishState", () => {
  assert.equal(campaignPublicUrl("https://sites.shofar.io/grace/", "roof"), "https://sites.shofar.io/grace/give/roof/");
  assert.equal(campaignPublicUrl("https://sites.shofar.io/grace", "roof fund"), "https://sites.shofar.io/grace/give/roof%20fund/");
  assert.equal(campaignPublicUrl(null, "roof"), null);
  assert.equal(publishState("draft", "2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z").label, "Not published");
  assert.equal(publishState("active", null, "2026-01-02T00:00:00Z").label, "Site not published");
  assert.equal(publishState("active", "2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z").label, "Needs a publish");
  assert.equal(publishState("active", "2026-01-03T00:00:00Z", "2026-01-02T00:00:00Z").label, "Live");
});

test("the CSV template starts with the accepted header", () => {
  assert.ok(giftCsvTemplate().startsWith("amount,name,email,date,source,public,note\n"));
});
