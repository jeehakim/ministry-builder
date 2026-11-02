import { test } from "node:test";
import assert from "node:assert/strict";
import { emptySiteDocument, parseSiteDocument, newSectionId } from "./index.ts";

test("empty document parses and has defaults", () => {
  const doc = emptySiteDocument("Shofar");
  assert.equal(doc.meta.orgName, "Shofar");
  assert.equal(doc.theme.templateId, "classic");
  assert.ok(doc.sections.length >= 5);
  assert.equal(doc.sections[0]?.type, "hero");
});

test("invalid section type is rejected", () => {
  assert.throws(() =>
    parseSiteDocument({ meta: { orgName: "x" }, sections: [{ id: "a", type: "nope" }] }),
  );
});

test("newSectionId avoids collisions", () => {
  const doc = emptySiteDocument();
  assert.equal(newSectionId("about", doc.sections), "about-1");
  const withOne = [...doc.sections, { id: "about-1", type: "about" as const, hidden: false, heading: "x", body: "y" }];
  assert.equal(newSectionId("about", withOne), "about-2");
});

test("localizeDocument merges overlays and setTranslatedSection stores only differences", async () => {
  const { localizeDocument, setTranslatedSection, siteLanguages } = await import("./site.ts");
  const doc = parseSiteDocument({
    meta: { orgName: "Org", language: "ko", languages: ["en"], tagline: "다리" },
    sections: [
      { id: "hero", type: "hero", heading: "안녕", subheading: "환영" },
      { id: "programs", type: "programs", items: [{ title: "하나", description: "d1", image: { src: "a.webp" } }] },
    ],
    translations: { en: { meta: { tagline: "Bridge" }, sections: { hero: { heading: "Hello" }, programs: { items: [{ title: "One" }] } } } },
  });
  assert.deepEqual(siteLanguages(doc), ["ko", "en"]);
  const en = localizeDocument(doc, "en");
  assert.equal(en.meta.tagline, "Bridge");
  assert.equal(en.meta.language, "en");
  const hero = en.sections[0];
  assert.ok(hero && hero.type === "hero");
  assert.equal(hero.heading, "Hello");
  assert.equal(hero.subheading, "환영");
  const programs = en.sections[1];
  assert.ok(programs && programs.type === "programs");
  assert.equal(programs.items[0]?.title, "One");
  assert.equal(programs.items[0]?.image?.src, "a.webp");
  assert.equal(localizeDocument(doc, "ko"), doc);

  const edited = { ...hero, subheading: "Welcome" };
  const next = setTranslatedSection(doc, "en", edited);
  assert.deepEqual(next.translations["en"]?.sections["hero"], { heading: "Hello", subheading: "Welcome" });
  const reverted = setTranslatedSection(next, "en", { ...hero, heading: "안녕", subheading: "환영" });
  assert.equal(reverted.translations["en"]?.sections["hero"], undefined);
});

test("theme rejects CSS or HTML syntax in colors and fonts", () => {
  const base = { meta: { orgName: "x" }, sections: [] };
  assert.throws(() => parseSiteDocument({ ...base, theme: { primary: "red}</style><script>alert(1)</script><style>" } }));
  assert.throws(() => parseSiteDocument({ ...base, theme: { headingFont: "Georgia; } </style>" } }));
  const ok = parseSiteDocument({ ...base, theme: { primary: "#0F2A4A", headingFont: "system-ui, 'Segoe UI', sans-serif" } });
  assert.equal(ok.theme.primary, "#0F2A4A");
});

test("AiChange keeps section changes tied to their target and accepts meta and theme changes", async () => {
  const { AiChange, AiEditRequest } = await import("./ai.ts");
  const doc = emptySiteDocument("Org");
  const hero = doc.sections[0]!;
  assert.equal(AiChange.safeParse({ target: "hero", before: hero, after: { ...hero, heading: "Hi" } }).success, true);
  assert.equal(AiChange.safeParse({ target: "about", before: hero, after: hero }).success, false);
  assert.equal(AiChange.safeParse({ target: "hero", before: hero, after: { ...doc.sections[1]!, id: "hero" } }).success, false);
  assert.equal(AiChange.safeParse({ target: "meta", before: doc.meta, after: { ...doc.meta, tagline: "New" } }).success, true);
  assert.equal(AiChange.safeParse({ target: "theme", before: doc.theme, after: { ...doc.theme, primary: "#000" } }).success, true);
  assert.equal(AiChange.safeParse({ target: "theme", before: doc.theme, after: { ...doc.theme, primary: "red" } }).success, false);
  const req = AiEditRequest.parse({ instruction: " warmer ", scope: { kind: "section", id: "hero" } });
  assert.deepEqual(req, { instruction: "warmer", scope: { kind: "section", id: "hero" }, options: 1 });
  assert.equal(AiEditRequest.safeParse({ instruction: "x", scope: { kind: "section" } }).success, false);
});
