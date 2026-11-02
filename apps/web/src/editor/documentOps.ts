import { newSectionId, Section, type SectionType, type SiteDocument } from "@ministry/schema";

/** Minimal valid content per type; the schema fills in the other defaults. */
const STARTERS: Record<SectionType, Record<string, unknown>> = {
  hero: { heading: "A headline for your page" },
  about: { body: "Tell visitors who you are and why it matters." },
  programs: {},
  events: {},
  team: {},
  stories: {},
  give: {},
  contact: {},
};

export function addSection(doc: SiteDocument, type: SectionType): SiteDocument {
  const section = Section.parse({ ...STARTERS[type], id: newSectionId(type, doc.sections), type });
  return { ...doc, sections: [...doc.sections, section] };
}

/** Moves a section one place up (-1) or down (1). Returns `doc` itself if nothing changes. */
export function moveSection(doc: SiteDocument, id: string, direction: -1 | 1): SiteDocument {
  const from = doc.sections.findIndex((s) => s.id === id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= doc.sections.length) return doc;
  const sections = [...doc.sections];
  const moved = sections[from];
  const other = sections[to];
  if (!moved || !other) return doc;
  sections[from] = other;
  sections[to] = moved;
  return { ...doc, sections };
}

export function toggleHidden(doc: SiteDocument, id: string): SiteDocument {
  return {
    ...doc,
    sections: doc.sections.map((s) => (s.id === id ? { ...s, hidden: !s.hidden } : s)),
  };
}

export function removeSection(doc: SiteDocument, id: string): SiteDocument {
  return { ...doc, sections: doc.sections.filter((s) => s.id !== id) };
}

export function replaceSection(doc: SiteDocument, next: Section): SiteDocument {
  return { ...doc, sections: doc.sections.map((s) => (s.id === next.id ? next : s)) };
}

/** "path.to.field: message" for the first issue of a Zod error. */
export function formatIssue(error: { issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }> }): string {
  const issue = error.issues[0];
  if (!issue) return "The document is invalid.";
  const path = issue.path.map(String).join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}
