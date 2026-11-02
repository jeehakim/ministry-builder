import {
  emptySiteDocument,
  type AiAddSectionRequest,
  type AiChange,
  type AiEditRequest,
  type AiEditScope,
  type Section,
  type SiteDocument,
} from "@ministry/schema";
import { SECTION_LABELS } from "./fields.ts";

/** A result from Ask AI waiting for the user's Apply, Try again or Discard. */
export type Proposal =
  | { kind: "edit"; request: AiEditRequest; changes: AiChange[]; model?: string }
  | { kind: "add"; request: AiAddSectionRequest; section: Section; model?: string };

/** The instruction behind "3 options for this section". */
export const THREE_OPTIONS_INSTRUCTION =
  "Rewrite this section three different ways: vary the tone, the length and the structure. Keep every fact.";

export const WHOLE_PAGE_LABEL = "Whole page";
export const SITE_TEXT_LABEL = "Site text";
export const DESIGN_LABEL = "Design";

export function sectionLabel(section: Section): string {
  const heading = "heading" in section ? section.heading : "";
  return heading || SECTION_LABELS[section.type];
}

/** What the scope chip shows for a scope. */
export function scopeLabel(scope: AiEditScope, doc: SiteDocument): string {
  switch (scope.kind) {
    case "section": {
      const section = doc.sections.find((s) => s.id === scope.id);
      return section ? sectionLabel(section) : scope.id;
    }
    case "meta":
      return SITE_TEXT_LABEL;
    case "theme":
      return DESIGN_LABEL;
    case "page":
      return WHOLE_PAGE_LABEL;
  }
}

/** "Add a section about the youth camp" inserts a new section instead of editing the current one. */
export function isAddSectionInstruction(instruction: string): boolean {
  return /^\s*(add|insert|create|include)\b[^.]{0,80}?\b(section|block)\b/i.test(instruction);
}

/** Several changes with the same target are alternatives the user picks from, not a set to apply together. */
export function isOptionSet(changes: readonly AiChange[]): boolean {
  return changes.length > 1 && changes.every((c) => c.target === changes[0]!.target);
}

export function applyChange(doc: SiteDocument, change: AiChange): SiteDocument {
  if (change.target === "meta") return { ...doc, meta: change.after as SiteDocument["meta"] };
  if (change.target === "theme") return { ...doc, theme: change.after as SiteDocument["theme"] };
  const after = change.after as Section;
  return { ...doc, sections: doc.sections.map((s) => (s.id === change.target ? after : s)) };
}

export function applyChanges(doc: SiteDocument, changes: readonly AiChange[]): SiteDocument {
  return changes.reduce(applyChange, doc);
}

/** Inserts `section` after `afterId`, or at the end when that id is not on the page. */
export function insertSection(doc: SiteDocument, section: Section, afterId?: string): SiteDocument {
  const index = afterId ? doc.sections.findIndex((s) => s.id === afterId) : -1;
  const sections = [...doc.sections];
  sections.splice(index < 0 ? sections.length : index + 1, 0, section);
  return { ...doc, sections };
}

/** The document as it would be after Apply. For an option set only the chosen option is applied. */
export function proposedDocument(doc: SiteDocument, proposal: Proposal, chosen = 0): SiteDocument {
  if (proposal.kind === "add") return insertSection(doc, proposal.section, proposal.request.afterSectionId);
  if (isOptionSet(proposal.changes)) {
    const change = proposal.changes[chosen] ?? proposal.changes[0];
    return change ? applyChange(doc, change) : doc;
  }
  return applyChanges(doc, proposal.changes);
}

/** Section ids the preview should outline as proposed. */
export function proposedSectionIds(proposal: Proposal, chosen = 0): string[] {
  if (proposal.kind === "add") return [proposal.section.id];
  const changes = isOptionSet(proposal.changes) ? [proposal.changes[chosen] ?? proposal.changes[0]!] : proposal.changes;
  return changes.map((c) => c.target).filter((t) => t !== "meta" && t !== "theme");
}

export type ChangeLine = { field: string; before: string; after: string };

const SKIP_LEAVES = new Set(["id", "type", "src", "width", "height"]);

function leaves(value: unknown, path: string[], out: Map<string, string>): void {
  if (typeof value === "string") {
    out.set(path.join("."), value);
    return;
  }
  if (typeof value === "boolean" || typeof value === "number") {
    out.set(path.join("."), String(value));
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => leaves(item, [...path, String(i + 1)], out));
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      if (SKIP_LEAVES.has(key)) continue;
      leaves(child, [...path, key], out);
    }
  }
}

function humanize(path: string): string {
  return path
    .split(".")
    .map((part) => (/^\d+$/.test(part) ? `#${part}` : part.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())))
    .join(" › ");
}

/** The text that differs between before and after, one line per field, in document order. */
export function changeLines(change: AiChange): ChangeLine[] {
  const before = new Map<string, string>();
  const after = new Map<string, string>();
  leaves(change.before, [], before);
  leaves(change.after, [], after);
  const keys = [...new Set([...before.keys(), ...after.keys()])];
  return keys
    .filter((key) => before.get(key) !== after.get(key))
    .map((key) => ({ field: humanize(key), before: before.get(key) ?? "", after: after.get(key) ?? "" }));
}

/** Every non-empty text of a section, as lines with nothing before: what a new section would add. */
export function sectionLines(section: Section): ChangeLine[] {
  const after = new Map<string, string>();
  leaves(section, [], after);
  return [...after.entries()]
    .filter(([key, value]) => value !== "" && key !== "hidden" && !/(^|\.)showEmail$/.test(key))
    .map(([key, value]) => ({ field: humanize(key), before: "", after: value }));
}

export function changeTitle(change: AiChange, doc: SiteDocument): string {
  if (change.target === "meta") return SITE_TEXT_LABEL;
  if (change.target === "theme") return DESIGN_LABEL;
  return scopeLabel({ kind: "section", id: change.target }, doc);
}

// ---- Suggestions ----------------------------------------------------------

export type Suggestion = { id: string; title: string; detail: string } & (
  | { kind: "ask"; scope: AiEditScope; instruction: string }
  | { kind: "languages" }
);

const THIN_ABOUT_WORDS = 40;

function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/).length;
}

function missingAltIn(section: Section): number {
  let n = 0;
  if ("image" in section && section.image && section.image.alt.trim() === "") n++;
  if (section.type === "programs") for (const it of section.items) if (it.image && it.image.alt.trim() === "") n++;
  if (section.type === "team") for (const m of section.members) if (m.photo && m.photo.alt.trim() === "") n++;
  return n;
}

/** Concrete, one-click improvements computed from the document alone (no model call). */
export function computeSuggestions(doc: SiteDocument): Suggestion[] {
  const out: Suggestion[] = [];
  const visible = doc.sections.filter((s) => !s.hidden);

  const withMissingAlt = visible.map((s) => ({ section: s, count: missingAltIn(s) })).filter((e) => e.count > 0);
  const missingAlt = withMissingAlt.reduce((n, e) => n + e.count, 0);
  if (missingAlt > 0 && withMissingAlt[0]) {
    out.push({
      id: "alt",
      kind: "ask",
      title: missingAlt === 1 ? "1 image has no alt text" : `${missingAlt} images have no alt text`,
      detail: "Screen readers and search engines read it.",
      scope: { kind: "section", id: withMissingAlt[0].section.id },
      instruction: "Write short, descriptive alt text for every image in this section that has none, based on the surrounding text.",
    });
  }

  const about = visible.find((s) => s.type === "about");
  if (about?.type === "about" && wordCount(about.body) < THIN_ABOUT_WORDS) {
    out.push({
      id: "about",
      kind: "ask",
      title: `About is under ${THIN_ABOUT_WORDS} words`,
      detail: "Visitors decide in a few sentences whether this is for them.",
      scope: { kind: "section", id: about.id },
      instruction: "Expand this to about 80 to 120 words. Keep every fact and do not invent new ones.",
    });
  }

  const contact = visible.find((s) => s.type === "contact");
  if (contact?.type === "contact" && contact.email.trim() === "") {
    out.push({
      id: "email",
      kind: "ask",
      title: "No contact email",
      detail: "Messages from the contact form have nowhere to go.",
      scope: { kind: "section", id: contact.id },
      instruction: "Set the contact email to ",
    });
  }

  const hero = visible.find((s) => s.type === "hero");
  if (hero?.type === "hero" && !hero.primaryCta) {
    out.push({
      id: "hero-button",
      kind: "ask",
      title: "Hero has no button",
      detail: "Give visitors one clear next step.",
      scope: { kind: "section", id: hero.id },
      instruction: "Add a primary button that invites visitors to get in touch, linking to #contact.",
    });
  }

  if (doc.meta.languages.length === 0) {
    out.push({
      id: "languages",
      kind: "languages",
      title: doc.meta.language === "en" ? "Add a Korean or Spanish version" : "Add an English version",
      detail: "The whole page can be translated and published at its own address.",
    });
  }
  return out;
}

// ---- First run ------------------------------------------------------------

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b as object).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/** True while the site is still the starter document, so the AI-first start screen is the right first step. */
export function isUntouchedStarter(doc: SiteDocument): boolean {
  return deepEqual(doc, emptySiteDocument(doc.meta.orgName));
}

export function startWithAiSkipKey(siteId: string): string {
  return `ministry.startWithAi.skipped:${siteId}`;
}
