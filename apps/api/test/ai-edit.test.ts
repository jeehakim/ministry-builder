import { SiteDocument, type AiChange } from "@ministry/schema";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";
import { aiUsage, siteVersions } from "../src/db/schema";
import { call, jsonInit, makeSite } from "./helpers";

type Edit = { changes: AiChange[]; model?: string };
type Added = { section: { id: string; type: string; heading?: string }; model?: string };

const db = () => drizzle(env.DB);
const edit = (user: string, siteId: string, body: unknown, bindings?: object) => call(user, `/sites/${siteId}/ai/edit`, jsonInit("POST", body), bindings);
const addSection = (user: string, siteId: string, body: unknown) => call(user, `/sites/${siteId}/ai/add-section`, jsonInit("POST", body));

async function used(user: string): Promise<number> {
  return ((await (await call(user, "/ai/usage")).json()) as { used: number }).used;
}

async function currentDoc(user: string, siteId: string) {
  const detail = (await (await call(user, `/sites/${siteId}`)).json()) as { site: { currentVersionId: string }; document: unknown };
  return { versionId: detail.site.currentVersionId, doc: SiteDocument.parse(detail.document) };
}

describe("POST /sites/:id/ai/edit", () => {
  it("proposes a change to one section with before and after, stores nothing, and records one usage row", async () => {
    const site = await makeSite("ai_edit_a", "Grace Church");
    const before = await currentDoc("ai_edit_a", site.id);
    const res = await edit("ai_edit_a", site.id, { instruction: "Warmer, mention childcare", scope: { kind: "section", id: "about" } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Edit;
    expect(body.model).toBe("fake-model");
    expect(body.changes).toHaveLength(1);
    const change = body.changes[0]!;
    expect(change.target).toBe("about");
    expect(change.before).toEqual(before.doc.sections.find((s) => s.id === "about"));
    expect(change.after).toMatchObject({ id: "about", type: "about", heading: "About us · Warmer" });
    expect("type" in change.after && change.after.type === "about" ? change.after.body : "").toContain("mention childcare");

    // Nothing is applied until the editor's Apply click.
    const after = await currentDoc("ai_edit_a", site.id);
    expect(after.versionId).toBe(before.versionId);
    expect(after.doc).toEqual(before.doc);
    expect(await db().select().from(siteVersions).where(eq(siteVersions.siteId, site.id))).toHaveLength(1);

    expect(await used("ai_edit_a")).toBe(1);
    const [row] = await db().select().from(aiUsage).where(eq(aiUsage.siteId, site.id));
    expect(row).toMatchObject({ userId: "ai_edit_a", action: "edit", provider: "fake", model: "fake-model" });
    expect(JSON.parse(row!.requestJson!)).toEqual({ instruction: "Warmer, mention childcare", scope: { kind: "section", id: "about" }, options: 1 });
    expect(JSON.parse(row!.resultJson!)).toMatchObject({ changes: [{ target: "about", label: "Warmer" }] });
  });

  it("returns three labelled alternatives for the same section as one quota action", async () => {
    const site = await makeSite("ai_edit_b", "Options Org");
    const res = await edit("ai_edit_b", site.id, { instruction: "Rewrite three ways", scope: { kind: "section", id: "hero" }, options: 3 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Edit;
    expect(body.changes).toHaveLength(3);
    expect(body.changes.every((c) => c.target === "hero")).toBe(true);
    expect(new Set(body.changes.map((c) => c.label)).size).toBe(3);
    expect(await used("ai_edit_b")).toBe(1);
  });

  it("edits the meta text, the theme and the whole page", async () => {
    const site = await makeSite("ai_edit_c", "Scopes Org");
    const meta = (await (await edit("ai_edit_c", site.id, { instruction: "Punchier tagline", scope: { kind: "meta" } })).json()) as Edit;
    expect(meta.changes[0]).toMatchObject({ target: "meta", before: { orgName: "Scopes Org" }, after: { orgName: "Scopes Org", tagline: "Punchier tagline · Warmer" } });

    const theme = (await (await edit("ai_edit_c", site.id, { instruction: "Earthy", scope: { kind: "theme" } })).json()) as Edit;
    expect(theme.changes[0]).toMatchObject({ target: "theme", after: { primary: "#1f4e79", templateId: "classic" } });

    // The page scope always yields a single option, even when 3 are asked for.
    const page = (await (await edit("ai_edit_c", site.id, { instruction: "Friendlier everywhere", scope: { kind: "page" }, options: 3 })).json()) as Edit;
    expect(page.changes.map((c) => c.target)).toEqual(["meta", "hero", "about"]);
    expect(page.changes.every((c) => c.label === "Warmer")).toBe(true);
    expect(await used("ai_edit_c")).toBe(3);
  });

  it("answers 400 for an unknown section or a bad body, 404 for other people's sites, and spends nothing", async () => {
    const site = await makeSite("ai_edit_d", "Strict Org");
    expect((await edit("ai_edit_d", site.id, { instruction: "x", scope: { kind: "section", id: "missing" } })).status).toBe(400);
    expect((await edit("ai_edit_d", site.id, { instruction: "", scope: { kind: "meta" } })).status).toBe(400);
    expect((await edit("ai_edit_d", site.id, { instruction: "x", scope: { kind: "nope" } })).status).toBe(400);
    expect((await edit("ai_edit_d", site.id, { instruction: "x", scope: { kind: "meta" }, options: 2 })).status).toBe(400);
    expect((await edit("ai_edit_d", site.id, { instruction: "x".repeat(501), scope: { kind: "meta" } })).status).toBe(400);
    expect((await edit("ai_edit_other", site.id, { instruction: "x", scope: { kind: "meta" } })).status).toBe(404);
    expect(await used("ai_edit_d")).toBe(0);
  });

  it("counts against the daily quota and answers 503 without a provider", async () => {
    const site = await makeSite("ai_edit_e", "Quota Org");
    for (let i = 0; i < 4; i++) expect((await edit("ai_edit_e", site.id, { instruction: "x", scope: { kind: "meta" } })).status).toBe(200);
    const blocked = await edit("ai_edit_e", site.id, { instruction: "x", scope: { kind: "meta" } });
    expect(blocked.status).toBe(429);
    const noProvider = { ...env, AI_PROVIDER: undefined, OPENAI_API_KEY: undefined };
    const other = await makeSite("ai_edit_f", "No Provider");
    expect((await edit("ai_edit_f", other.id, { instruction: "x", scope: { kind: "meta" } }, noProvider)).status).toBe(503);
  });
});

describe("POST /sites/:id/ai/add-section", () => {
  it("returns a new section with a fresh id, leaves the page alone and records usage", async () => {
    const site = await makeSite("ai_add_a", "Add Org");
    const before = await currentDoc("ai_add_a", site.id);
    const res = await addSection("ai_add_a", site.id, { instruction: "Add a section about the youth camp in July", afterSectionId: "about" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Added;
    expect(body.section).toMatchObject({ id: "events-1", type: "events", heading: "Upcoming" });
    expect(body.model).toBe("fake-model");

    const after = await currentDoc("ai_add_a", site.id);
    expect(after.versionId).toBe(before.versionId);
    expect(after.doc.sections.map((s) => s.id)).toEqual(before.doc.sections.map((s) => s.id));

    expect(await used("ai_add_a")).toBe(1);
    const [row] = await db().select().from(aiUsage).where(eq(aiUsage.siteId, site.id));
    expect(row).toMatchObject({ action: "add_section" });
    expect(JSON.parse(row!.requestJson!)).toEqual({ instruction: "Add a section about the youth camp in July", afterSectionId: "about" });
    expect(JSON.parse(row!.resultJson!)).toMatchObject({ section: { id: "events-1" } });
  });

  it("picks an id that does not collide and validates the request", async () => {
    const site = await makeSite("ai_add_b", "Collide Org");
    const first = (await (await addSection("ai_add_b", site.id, { instruction: "Tell our story" })).json()) as Added;
    expect(first.section).toMatchObject({ id: "about-1", type: "about" });
    expect((await addSection("ai_add_b", site.id, { instruction: "x", afterSectionId: "missing" })).status).toBe(400);
    expect((await addSection("ai_add_b", site.id, { instruction: "" })).status).toBe(400);
    expect((await addSection("ai_add_other", site.id, { instruction: "x" })).status).toBe(404);
    expect(await used("ai_add_b")).toBe(1);
  });
});
