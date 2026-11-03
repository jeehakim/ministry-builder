import { test } from "node:test";
import assert from "node:assert/strict";
import { emptySiteDocument, type AiChange, type Section } from "@ministry/schema";
import {
  applyChanges,
  changeLines,
  changeTitle,
  computeSuggestions,
  insertSection,
  isAddSectionInstruction,
  isOptionSet,
  isUntouchedStarter,
  proposedDocument,
  proposedSectionIds,
  scopeLabel,
  sectionLines,
  type Proposal,
} from "./askAi.ts";

const doc = emptySiteDocument("Grace Church");
const hero = doc.sections[0]!;
const about = doc.sections.find((s) => s.id === "about")!;

test("scopeLabel follows the section heading and names the other scopes", () => {
  assert.equal(scopeLabel({ kind: "section", id: "hero" }, doc), "Welcome to Grace Church");
  assert.equal(scopeLabel({ kind: "section", id: "contact" }, doc), "Contact");
  assert.equal(scopeLabel({ kind: "section", id: "gone" }, doc), "gone");
  assert.equal(scopeLabel({ kind: "meta" }, doc), "Site text");
  assert.equal(scopeLabel({ kind: "theme" }, doc), "Design");
  assert.equal(scopeLabel({ kind: "page" }, doc), "Whole page");
});

test("isAddSectionInstruction spots requests for a new section only", () => {
  assert.equal(isAddSectionInstruction("Add a section about the youth camp in July"), true);
  assert.equal(isAddSectionInstruction("insert a block with our service times"), true);
  assert.equal(isAddSectionInstruction("Make this warmer and add that childcare is available"), false);
  assert.equal(isAddSectionInstruction("Add a button to the hero"), false);
});

test("applyChanges replaces the targeted section, meta or theme and nothing else", () => {
  const changes: AiChange[] = [
    { target: "hero", before: hero, after: { ...hero, heading: "Hello" } as Section },
    { target: "meta", before: doc.meta, after: { ...doc.meta, tagline: "New line" } },
    { target: "theme", before: doc.theme, after: { ...doc.theme, primary: "#123456" } },
  ];
  const next = applyChanges(doc, changes);
  assert.equal(next.sections[0]?.type === "hero" && next.sections[0].heading, "Hello");
  assert.equal(next.meta.tagline, "New line");
  assert.equal(next.theme.primary, "#123456");
  assert.deepEqual(next.sections.slice(1), doc.sections.slice(1));
  assert.equal(doc.sections[0]?.type === "hero" && doc.sections[0].heading, "Welcome to Grace Church");
});

test("insertSection goes after the given id or at the end", () => {
  const section: Section = { id: "about-1", type: "about", hidden: false, heading: "Camp", body: "July." };
  assert.deepEqual(insertSection(doc, section, "hero").sections.map((s) => s.id).slice(0, 3), ["hero", "about-1", "about"]);
  assert.equal(insertSection(doc, section).sections.at(-1)?.id, "about-1");
  assert.equal(insertSection(doc, section, "nope").sections.at(-1)?.id, "about-1");
});

test("option sets apply only the chosen option and outline its section", () => {
  const options: AiChange[] = [1, 2, 3].map((n) => ({ target: "about", before: about, after: { ...about, heading: `Take ${n}` } as Section }));
  assert.equal(isOptionSet(options), true);
  assert.equal(isOptionSet(options.slice(0, 1)), false);
  const proposal: Proposal = { kind: "edit", request: { instruction: "x", scope: { kind: "section", id: "about" }, options: 3 }, changes: options };
  const chosen = proposedDocument(doc, proposal, 1);
  assert.equal(chosen.sections.find((s) => s.id === "about")?.type === "about" && (chosen.sections.find((s) => s.id === "about") as { heading: string }).heading, "Take 2");
  assert.deepEqual(proposedSectionIds(proposal, 1), ["about"]);

  const add: Proposal = { kind: "add", request: { instruction: "Add", afterSectionId: "about" }, section: { id: "events-1", type: "events", hidden: false, heading: "Camp", items: [] } };
  assert.deepEqual(proposedSectionIds(add), ["events-1"]);
  assert.equal(proposedDocument(doc, add).sections[2]?.id, "events-1");
});

test("changeLines lists only the text that differs, with readable field names", () => {
  const programs = doc.sections.find((s) => s.id === "programs")!;
  const before = { ...programs, items: [{ title: "Youth", description: "", image: { src: "/a.png", alt: "" } }] } as Section;
  const after = { ...programs, heading: "What we do", items: [{ title: "Youth group", description: "Fridays", image: { src: "/a.png", alt: "Teens" } }] } as Section;
  const lines = changeLines({ target: "programs", before, after });
  assert.deepEqual(lines, [
    { field: "Items › #1 › Title", before: "Youth", after: "Youth group" },
    { field: "Items › #1 › Description", before: "", after: "Fridays" },
    { field: "Items › #1 › Image › Alt", before: "", after: "Teens" },
  ]);
  assert.equal(changeTitle({ target: "meta", before: doc.meta, after: doc.meta }, doc), "Site text");
  assert.equal(changeTitle({ target: "about", before: about, after: about }, doc), "About us");
});

test("computeSuggestions finds the starter page's gaps and clears them as the page fills in", () => {
  const starter = computeSuggestions(doc).map((s) => s.id);
  assert.deepEqual(starter, ["about", "email", "hero-button", "languages"]);

  const filled = emptySiteDocument("Full Org");
  filled.meta.languages = ["ko"];
  for (const s of filled.sections) {
    if (s.type === "about") s.body = Array.from({ length: 45 }, () => "word").join(" ");
    if (s.type === "contact") s.email = "hello@full.org";
    if (s.type === "hero") {
      s.primaryCta = { label: "Visit", href: "#contact" };
      s.image = { src: "/assets/x.webp", alt: "" };
    }
    if (s.type === "programs") s.items = [{ title: "A", description: "", image: { src: "/assets/y.webp", alt: "" } }];
  }
  const next = computeSuggestions(filled);
  assert.deepEqual(next.map((s) => s.id), ["alt"]);
  assert.equal(next[0]?.title, "2 images have no alt text");
  assert.equal(next[0]?.kind === "ask" && next[0].scope.kind === "section" && next[0].scope.id, "hero");

  // Hidden sections do not count.
  filled.sections.forEach((s) => (s.hidden = true));
  assert.deepEqual(computeSuggestions(filled), []);
});

test("isUntouchedStarter is true for the starter document and false after any edit", () => {
  assert.equal(isUntouchedStarter(emptySiteDocument("Any Name")), true);
  const edited = emptySiteDocument("Any Name");
  edited.meta.tagline = "Changed";
  assert.equal(isUntouchedStarter(edited), false);
  const reordered = emptySiteDocument("Any Name");
  reordered.sections.reverse();
  assert.equal(isUntouchedStarter(reordered), false);
  // A round trip through JSON (what the server stores) still counts as untouched.
  assert.equal(isUntouchedStarter(JSON.parse(JSON.stringify(emptySiteDocument("Round Trip")))), true);
});

test("sectionLines lists a new section's text without ids, flags or empty fields", () => {
  const section: Section = { id: "events-1", type: "events", hidden: false, heading: "Youth camp", items: [{ title: "Summer camp", when: "July", where: "", description: "" }] };
  assert.deepEqual(sectionLines(section), [
    { field: "Heading", before: "", after: "Youth camp" },
    { field: "Items › #1 › Title", before: "", after: "Summer camp" },
    { field: "Items › #1 › When", before: "", after: "July" },
  ]);
});
