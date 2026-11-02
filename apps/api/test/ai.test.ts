import { templates } from "@ministry/templates";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";
import { aiUsage, siteVersions } from "../src/db/schema";
import { call, jsonInit, makeSite, uploadPng } from "./helpers";

const NOTES = "Grace Church is a Korean-American congregation in Dallas. We meet Sundays at 10:30 AM.";

type Usage = { used: number; limit: number; resetsAt: string; available: boolean };
type Draft = {
  variationGroupId: string;
  variations: { versionId: string; label: string; document: { meta: { orgName: string }; theme: { templateId: string } } }[];
};

const db = () => drizzle(env.DB);

async function usage(user: string): Promise<Usage> {
  return (await (await call(user, "/ai/usage")).json()) as Usage;
}

describe("GET /ai/usage", () => {
  it("reports zero use, the configured limit, the next UTC midnight and availability", async () => {
    const res = await call("ai_usage_a", "/ai/usage");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Usage;
    expect(body.used).toBe(0);
    expect(body.limit).toBe(4);
    expect(body.available).toBe(true);

    const resets = new Date(body.resetsAt);
    expect(resets.getTime()).toBeGreaterThan(Date.now());
    expect(resets.getTime() - Date.now()).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
    expect(resets.getUTCHours() + resets.getUTCMinutes() + resets.getUTCSeconds()).toBe(0);
  });

  it("requires authentication and reports unavailable without a provider", async () => {
    expect((await call(null, "/ai/usage")).status).toBe(401);
    const noProvider = { ...env, AI_PROVIDER: undefined, OPENAI_API_KEY: undefined };
    const body = (await (await call("ai_usage_b", "/ai/usage", {}, noProvider)).json()) as Usage;
    expect(body.available).toBe(false);
  });
});

describe("POST /sites/:id/ai/draft", () => {
  it("stores three versions sharing a group id, leaves the current version alone and records usage", async () => {
    const site = await makeSite("ai_draft_a", "Grace Church");
    const res = await call("ai_draft_a", `/sites/${site.id}/ai/draft`, jsonInit("POST", { notes: NOTES, language: "en" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Draft;

    expect(body.variations).toHaveLength(3);
    const templateIds = new Set(body.variations.map((v) => v.document.theme.templateId));
    for (const id of templateIds) expect(Object.keys(templates)).toContain(id);
    for (const v of body.variations) expect(v.document.meta.orgName).toBe("Grace Church");
    expect(new Set(body.variations.map((v) => v.label)).size).toBe(3);

    const rows = await db().select().from(siteVersions).where(eq(siteVersions.variationGroupId, body.variationGroupId));
    expect(rows.map((r) => r.id).sort()).toEqual(body.variations.map((v) => v.versionId).sort());
    expect(rows.every((r) => r.siteId === site.id && r.createdBy === "ai_draft_a")).toBe(true);
    expect(JSON.parse(rows[0]!.document)).toMatchObject({ meta: { orgName: "Grace Church" } });

    const detail = (await (await call("ai_draft_a", `/sites/${site.id}`)).json()) as { site: { currentVersionId: string } };
    expect(detail.site.currentVersionId).toBe(site.versionId);

    expect((await usage("ai_draft_a")).used).toBe(1);
    const [row] = await db().select().from(aiUsage).where(eq(aiUsage.siteId, site.id));
    expect(row).toMatchObject({ userId: "ai_draft_a", action: "draft", provider: "fake", model: "fake-model" });
    expect(row!.inputTokens).toBeGreaterThan(0);
  });

  it("folds the notes into the draft and honours a single variation", async () => {
    const site = await makeSite("ai_draft_b", "Hope Mission");
    const res = await call("ai_draft_b", `/sites/${site.id}/ai/draft`, jsonInit("POST", { notes: NOTES, variations: 1 }));
    const body = (await res.json()) as Draft & { variations: { document: { sections: { type: string; body?: string }[] } }[] };
    expect(body.variations).toHaveLength(1);
    expect(body.variations[0]!.document.sections.find((s) => s.type === "about")?.body).toBe(NOTES);
  });

  it("rejects bad bodies and other people's sites, and does not spend quota doing so", async () => {
    const site = await makeSite("ai_draft_c", "Private");
    expect((await call("ai_draft_c", `/sites/${site.id}/ai/draft`, jsonInit("POST", { notes: "short" }))).status).toBe(400);
    expect((await call("ai_draft_c", `/sites/${site.id}/ai/draft`, { method: "POST", body: "{" })).status).toBe(400);
    expect((await call("ai_draft_other", `/sites/${site.id}/ai/draft`, jsonInit("POST", { notes: NOTES }))).status).toBe(404);
    expect((await usage("ai_draft_c")).used).toBe(0);
  });

  it("only accepts a reference image from the same site", async () => {
    const mine = await makeSite("ai_draft_d", "Mine");
    const theirs = await makeSite("ai_draft_e", "Theirs");
    const theirImage = await uploadPng("ai_draft_e", theirs.id);
    const foreign = await call("ai_draft_d", `/sites/${mine.id}/ai/draft`, jsonInit("POST", { notes: NOTES, referenceAssetKey: theirImage.key }));
    expect(foreign.status).toBe(400);

    const ownImage = await uploadPng("ai_draft_d", mine.id);
    const ok = await call("ai_draft_d", `/sites/${mine.id}/ai/draft`, jsonInit("POST", { notes: NOTES, referenceAssetKey: ownImage.key }));
    expect(ok.status).toBe(200);
    const missing = await call("ai_draft_d", `/sites/${mine.id}/ai/draft`, jsonInit("POST", { notes: NOTES, referenceAssetKey: `sites/${mine.id}/${crypto.randomUUID()}.png` }));
    expect(missing.status).toBe(404);
  });
});

describe("quota and availability", () => {
  it("answers 429 with the limit details once the daily limit is used", async () => {
    const site = await makeSite("ai_quota_a", "Quota Org");
    const rewrite = () =>
      call("ai_quota_a", `/sites/${site.id}/ai/rewrite`, jsonInit("POST", { text: "Hello", instruction: "Warmer" }));
    for (let i = 0; i < 4; i++) expect((await rewrite()).status).toBe(200);

    const blocked = await rewrite();
    expect(blocked.status).toBe(429);
    const body = (await blocked.json()) as { error: string; used: number; limit: number; resetsAt: string };
    expect(body).toMatchObject({ used: 4, limit: 4 });
    expect(body.error).toBeTruthy();
    expect(new Date(body.resetsAt).getTime()).toBeGreaterThan(Date.now());

    // Quota is per user: another user is unaffected.
    const other = await makeSite("ai_quota_b", "Other Org");
    expect((await call("ai_quota_b", `/sites/${other.id}/ai/rewrite`, jsonInit("POST", { text: "Hello", instruction: "Warmer" }))).status).toBe(200);
  });

  it("ignores usage from before today's UTC midnight", async () => {
    const site = await makeSite("ai_quota_c", "Old Usage");
    const yesterday = new Date(Date.now() - 36 * 60 * 60 * 1000);
    await db().insert(aiUsage).values(
      Array.from({ length: 4 }, (_, i) => ({
        id: `aiu_old_${i}`,
        userId: "ai_quota_c",
        siteId: site.id,
        action: "rewrite" as const,
        provider: "fake",
        model: "fake-model",
        createdAt: yesterday,
      })),
    );
    expect((await usage("ai_quota_c")).used).toBe(0);
    expect((await call("ai_quota_c", `/sites/${site.id}/ai/rewrite`, jsonInit("POST", { text: "Hello", instruction: "Warmer" }))).status).toBe(200);
  });

  it("answers 503 when no provider is configured", async () => {
    const site = await makeSite("ai_noprov", "No Provider");
    const noProvider = { ...env, AI_PROVIDER: undefined, OPENAI_API_KEY: undefined };
    const res = await call("ai_noprov", `/sites/${site.id}/ai/rewrite`, jsonInit("POST", { text: "Hello", instruction: "Warmer" }), noProvider);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "AI is not configured on this server" });
  });
});

describe("rewrite, theme and alt text", () => {
  it("rewrites text", async () => {
    const site = await makeSite("ai_misc_a", "Rewrite Org");
    const res = await call("ai_misc_a", `/sites/${site.id}/ai/rewrite`, jsonInit("POST", { text: "We meet Sundays.", instruction: "Warmer", context: "about body" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: "Rewritten text." });
    expect((await call("ai_misc_a", `/sites/${site.id}/ai/rewrite`, jsonInit("POST", { text: "", instruction: "x" }))).status).toBe(400);
  });

  it("returns a valid theme for a description and requires a description or reference", async () => {
    const site = await makeSite("ai_misc_b", "Theme Org");
    const res = await call("ai_misc_b", `/sites/${site.id}/ai/theme`, jsonInit("POST", { description: "calm and earthy" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { theme: { templateId: string; primary: string }; rationale: string };
    expect(Object.keys(templates)).toContain(body.theme.templateId);
    expect(body.theme.primary).toMatch(/^#/);
    expect(body.rationale).toBeTruthy();
    expect((await call("ai_misc_b", `/sites/${site.id}/ai/theme`, jsonInit("POST", {}))).status).toBe(400);
  });

  it("writes alt text for the site's own image", async () => {
    const site = await makeSite("ai_misc_c", "Alt Org");
    const image = await uploadPng("ai_misc_c", site.id);
    const res = await call("ai_misc_c", `/sites/${site.id}/ai/alt-text`, jsonInit("POST", { assetKey: image.key }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { alt: string };
    expect(body.alt.length).toBeGreaterThan(0);
    expect(body.alt.length).toBeLessThan(125);
    expect((await usage("ai_misc_c")).used).toBe(1);
  });

  it("rejects an asset key from another site, a missing asset, and spends nothing", async () => {
    const mine = await makeSite("ai_misc_d", "Mine");
    const theirs = await makeSite("ai_misc_e", "Theirs");
    const theirImage = await uploadPng("ai_misc_e", theirs.id);

    const foreign = await call("ai_misc_d", `/sites/${mine.id}/ai/alt-text`, jsonInit("POST", { assetKey: theirImage.key }));
    expect(foreign.status).toBe(400);
    const traversal = await call("ai_misc_d", `/sites/${mine.id}/ai/alt-text`, jsonInit("POST", { assetKey: `sites/${mine.id}/../${theirs.id}/x.png` }));
    expect(traversal.status).toBe(400);
    const missing = await call("ai_misc_d", `/sites/${mine.id}/ai/alt-text`, jsonInit("POST", { assetKey: `sites/${mine.id}/${crypto.randomUUID()}.png` }));
    expect(missing.status).toBe(404);
    expect((await usage("ai_misc_d")).used).toBe(0);
  });
});
