import { test } from "node:test";
import assert from "node:assert/strict";
import { emptySiteDocument, type SiteDocument } from "@ministry/schema";
import {
  addableLanguages,
  langFromHash,
  languageUrls,
  previewLanguageLinks,
  primaryLanguageOptions,
  resolveEditingLang,
  translateProgressMessages,
  translationNotice,
} from "./languages.ts";

function bilingual(): SiteDocument {
  const doc = emptySiteDocument("Grace");
  return { ...doc, meta: { ...doc.meta, language: "en", languages: ["ko", "es"] } };
}

test("resolveEditingLang falls back to the primary for unknown or removed languages", () => {
  const doc = bilingual();
  assert.equal(resolveEditingLang(doc, null), "en");
  assert.equal(resolveEditingLang(doc, "ko"), "ko");
  assert.equal(resolveEditingLang(doc, "en"), "en");
  assert.equal(resolveEditingLang(doc, "fr"), "en");
});

test("previewLanguageLinks is empty for one language and flags the current one otherwise", () => {
  assert.deepEqual(previewLanguageLinks(emptySiteDocument(), "en"), []);
  const links = previewLanguageLinks(bilingual(), "ko");
  assert.deepEqual(
    links.map((l) => [l.code, l.label, l.current]),
    [
      ["en", "English", false],
      ["ko", "한국어", true],
      ["es", "Español", false],
    ],
  );
  assert.equal(langFromHash(links[1]?.href), "ko");
});

test("langFromHash ignores page anchors and other links", () => {
  assert.equal(langFromHash("#about"), null);
  assert.equal(langFromHash("#lang-"), null);
  assert.equal(langFromHash("https://example.com"), null);
  assert.equal(langFromHash(null), null);
});

test("languageUrls puts the primary at the site root and the others under /<lang>/", () => {
  const urls = languageUrls("https://grace.sites.shofar.io/", bilingual());
  assert.deepEqual(
    urls.map((u) => u.url),
    ["https://grace.sites.shofar.io/", "https://grace.sites.shofar.io/ko/", "https://grace.sites.shofar.io/es/"],
  );
  assert.deepEqual(urls.map((u) => u.primary), [true, false, false]);
});

test("languageUrls adds a missing trailing slash and follows a changed primary", () => {
  const doc = bilingual();
  const urls = languageUrls("https://grace.sites.shofar.io", { ...doc, meta: { ...doc.meta, language: "ko", languages: ["en"] } });
  assert.deepEqual(
    urls.map((u) => [u.code, u.url]),
    [
      ["ko", "https://grace.sites.shofar.io/"],
      ["en", "https://grace.sites.shofar.io/en/"],
    ],
  );
});

test("addableLanguages excludes the primary and existing languages", () => {
  const codes = addableLanguages(bilingual()).map((l) => l.code);
  assert.equal(codes.includes("en"), false);
  assert.equal(codes.includes("ko"), false);
  assert.equal(codes.includes("es"), false);
  assert.equal(codes.includes("fr"), true);
});

test("primaryLanguageOptions keeps a custom current code and hides the extra languages", () => {
  const doc = bilingual();
  const custom = { ...doc, meta: { ...doc.meta, language: "sw" } };
  const codes = primaryLanguageOptions(custom).map((o) => o.code);
  assert.equal(codes[0], "sw");
  assert.equal(codes.includes("ko"), false);
  assert.equal(primaryLanguageOptions(custom)[0]?.label, "SW");
  assert.equal(primaryLanguageOptions(doc).some((o) => o.code === "en"), true);
});

test("translationNotice names the primary language", () => {
  assert.equal(translationNotice("en"), "Switch to English to change images, links and layout.");
});

test("translateProgressMessages names the target language and ends with the patience note", () => {
  const messages = translateProgressMessages("ko");
  assert.ok(messages.some((m) => m.includes("한국어")));
  assert.match(messages.at(-1) ?? "", /Almost there/);
});
