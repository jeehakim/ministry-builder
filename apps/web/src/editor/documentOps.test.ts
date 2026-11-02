import { test } from "node:test";
import assert from "node:assert/strict";
import { emptySiteDocument, SiteDocument, SECTION_TYPES } from "@ministry/schema";
import { addSection, formatIssue, moveSection, removeSection, replaceSection, toggleHidden } from "./documentOps.ts";

const ids = (doc: SiteDocument) => doc.sections.map((s) => s.id);

test("addSection produces a schema-valid section for every type", () => {
  for (const type of SECTION_TYPES) {
    const next = addSection(emptySiteDocument(), type);
    assert.equal(SiteDocument.safeParse(next).success, true, type);
    assert.equal(next.sections.at(-1)?.type, type);
  }
});

test("addSection does not mutate and avoids id collisions", () => {
  const doc = emptySiteDocument();
  const before = ids(doc);
  const once = addSection(doc, "about");
  const twice = addSection(once, "about");
  assert.deepEqual(ids(doc), before);
  assert.equal(new Set(ids(twice)).size, ids(twice).length);
});

test("moveSection swaps neighbours and clamps at the ends", () => {
  const doc = emptySiteDocument();
  const [a, b] = ids(doc);
  assert.ok(a && b);
  assert.deepEqual(ids(moveSection(doc, a, 1)).slice(0, 2), [b, a]);
  assert.equal(moveSection(doc, a, -1), doc);
  const last = ids(doc).at(-1);
  assert.ok(last);
  assert.equal(moveSection(doc, last, 1), doc);
});

test("toggleHidden flips only the target section", () => {
  const doc = emptySiteDocument();
  const next = toggleHidden(doc, "about");
  assert.equal(next.sections.find((s) => s.id === "about")?.hidden, true);
  assert.equal(next.sections.find((s) => s.id === "hero")?.hidden, false);
  assert.equal(doc.sections.find((s) => s.id === "about")?.hidden, false);
});

test("removeSection and replaceSection", () => {
  const doc = emptySiteDocument();
  assert.equal(ids(removeSection(doc, "about")).includes("about"), false);
  const about = doc.sections.find((s) => s.id === "about");
  assert.ok(about && about.type === "about");
  const next = replaceSection(doc, { ...about, heading: "Who we are" });
  const changed = next.sections.find((s) => s.id === "about");
  assert.equal(changed?.type === "about" && changed.heading, "Who we are");
});

test("formatIssue reports the first Zod issue with its path", () => {
  const doc = emptySiteDocument();
  const bad = { ...doc, meta: { ...doc.meta, orgName: "" } };
  const result = SiteDocument.safeParse(bad);
  assert.equal(result.success, false);
  if (!result.success) assert.match(formatIssue(result.error), /^meta\.orgName: /);
});

test("reorderSection moves a section to the target position and ignores unknown ids", async () => {
  const { reorderSection } = await import("./documentOps.ts");
  const doc = emptySiteDocument();
  const [first, second, third] = ids(doc);
  const moved = reorderSection(doc, first!, third!);
  assert.deepEqual(ids(moved).slice(0, 3), [second, third, first]);
  assert.equal(reorderSection(doc, first!, "nope"), doc);
  assert.equal(reorderSection(doc, first!, first!), doc);
});
