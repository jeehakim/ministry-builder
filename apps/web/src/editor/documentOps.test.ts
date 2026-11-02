import { test } from "node:test";
import assert from "node:assert/strict";
import { emptySiteDocument, localizeDocument, SiteDocument, SECTION_TYPES } from "@ministry/schema";
import {
  addLanguage,
  addSection,
  editMetaText,
  editSection,
  formatIssue,
  mergeTheme,
  moveSection,
  removeLanguage,
  removeSection,
  replaceSection,
  setPrimaryLanguage,
  setTranslation,
  toggleHidden,
} from "./documentOps.ts";

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

test("mergeTheme applies the incoming theme but keeps the template when the id is unknown", () => {
  const current = emptySiteDocument().theme;
  const incoming = { ...current, templateId: "ghost", primary: "#112233", heroStyle: "solid" as const };
  const merged = mergeTheme(current, incoming, ["classic", "modern"]);
  assert.equal(merged.primary, "#112233");
  assert.equal(merged.heroStyle, "solid");
  assert.equal(merged.templateId, current.templateId);
});

test("mergeTheme adopts a known template id", () => {
  const current = emptySiteDocument().theme;
  const merged = mergeTheme(current, { ...current, templateId: "modern" }, ["classic", "modern"]);
  assert.equal(merged.templateId, "modern");
});

function withTranslation(): SiteDocument {
  const base = emptySiteDocument("Grace");
  return setTranslation(base, "ko", {
    meta: { tagline: "안녕" },
    sections: { about: { heading: "소개" }, hero: { heading: "환영합니다" } },
  });
}

test("removeSection drops the section's overlay entries in every language", () => {
  const doc = setTranslation(withTranslation(), "es", { meta: {}, sections: { about: { heading: "Quiénes somos" }, hero: { heading: "Bienvenidos" } } });
  const next = removeSection(doc, "about");
  assert.deepEqual(Object.keys(next.translations.ko?.sections ?? {}), ["hero"]);
  assert.deepEqual(Object.keys(next.translations.es?.sections ?? {}), ["hero"]);
  assert.equal(next.translations.ko?.meta.tagline, "안녕");
  assert.ok(doc.translations.ko?.sections.about, "the original document is not mutated");
});

test("editSection writes the primary section directly and a translation into the overlay", () => {
  const doc = emptySiteDocument("Grace");
  const about = doc.sections.find((s) => s.id === "about");
  assert.ok(about && about.type === "about");

  const primary = editSection(doc, "en", { ...about, heading: "Who we are" });
  assert.equal((primary.sections.find((s) => s.id === "about") as { heading: string }).heading, "Who we are");
  assert.deepEqual(primary.translations, {});

  const withKo = addLanguage(doc, "ko");
  const localized = localizeDocument(withKo, "ko").sections.find((s) => s.id === "about");
  assert.ok(localized && localized.type === "about");
  const translated = editSection(withKo, "ko", { ...localized, heading: "소개" });
  assert.equal((translated.sections.find((s) => s.id === "about") as { heading: string }).heading, "About us");
  assert.deepEqual(translated.translations.ko?.sections.about, { heading: "소개" });
  const view = localizeDocument(translated, "ko").sections.find((s) => s.id === "about");
  assert.equal(view?.type === "about" && view.heading, "소개");
});

test("editSection in a translation ignores non-text changes", () => {
  const doc = addLanguage(emptySiteDocument("Grace"), "ko");
  const localized = localizeDocument(doc, "ko").sections.find((s) => s.id === "about");
  assert.ok(localized && localized.type === "about");
  const next = editSection(doc, "ko", { ...localized, hidden: true, image: { src: "x.webp", alt: "" } });
  assert.deepEqual(next.sections, doc.sections);
  assert.deepEqual(next.translations.ko?.sections ?? {}, {});
});

test("editMetaText edits the primary meta or the overlay", () => {
  const doc = addLanguage(emptySiteDocument("Grace"), "ko");
  const primary = editMetaText(doc, "en", { tagline: "New tagline" });
  assert.equal(primary.meta.tagline, "New tagline");
  const ko = editMetaText(doc, "ko", { tagline: "새 문구", description: "설명" });
  assert.equal(ko.meta.tagline, doc.meta.tagline);
  assert.deepEqual(ko.translations.ko?.meta, { tagline: "새 문구", description: "설명" });
  assert.equal(localizeDocument(ko, "ko").meta.tagline, "새 문구");
});

test("addLanguage and setTranslation keep meta.languages unique and never add the primary", () => {
  const doc = emptySiteDocument("Grace");
  const once = addLanguage(doc, "ko");
  assert.deepEqual(once.meta.languages, ["ko"]);
  assert.equal(addLanguage(once, "ko"), once);
  assert.equal(addLanguage(doc, "en"), doc);
  const translated = setTranslation(once, "ko", { meta: { tagline: "x" }, sections: {} });
  assert.deepEqual(translated.meta.languages, ["ko"]);
  assert.equal(translated.translations.ko?.meta.tagline, "x");
  assert.equal(setTranslation(doc, "en", { meta: {}, sections: {} }), doc);
});

test("setTranslation replaces an earlier overlay and the result is a valid document", () => {
  const next = setTranslation(withTranslation(), "ko", { meta: {}, sections: { give: { heading: "나눔" } } });
  assert.deepEqual(Object.keys(next.translations.ko?.sections ?? {}), ["give"]);
  assert.equal(SiteDocument.safeParse(next).success, true);
});

test("removeLanguage deletes the entry and its overlay", () => {
  const next = removeLanguage(withTranslation(), "ko");
  assert.deepEqual(next.meta.languages, []);
  assert.equal("ko" in next.translations, false);
  assert.equal(localizeDocument(next, "ko").sections.length, next.sections.length);
});

test("setPrimaryLanguage changes meta.language and drops that code from the extras", () => {
  const doc = withTranslation();
  const es = setPrimaryLanguage(doc, "es");
  assert.equal(es.meta.language, "es");
  assert.deepEqual(es.meta.languages, ["ko"]);
  const ko = setPrimaryLanguage(doc, "ko");
  assert.equal(ko.meta.language, "ko");
  assert.deepEqual(ko.meta.languages, []);
  assert.equal("ko" in ko.translations, false);
  assert.equal(setPrimaryLanguage(doc, "en"), doc);
});
