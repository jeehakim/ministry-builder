import {
  newSectionId,
  Section,
  setTranslatedMeta,
  setTranslatedSection,
  type SectionType,
  type SiteDocument,
  type Theme,
  type TranslationOverlay,
} from "@ministry/schema";

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

/** Moves the section `id` to the position currently held by `overId`. Returns `doc` itself if nothing changes. */
export function reorderSection(doc: SiteDocument, id: string, overId: string): SiteDocument {
  const from = doc.sections.findIndex((s) => s.id === id);
  const to = doc.sections.findIndex((s) => s.id === overId);
  if (from < 0 || to < 0 || from === to) return doc;
  const sections = [...doc.sections];
  const [moved] = sections.splice(from, 1);
  if (!moved) return doc;
  sections.splice(to, 0, moved);
  return { ...doc, sections };
}

export function toggleHidden(doc: SiteDocument, id: string): SiteDocument {
  return {
    ...doc,
    sections: doc.sections.map((s) => (s.id === id ? { ...s, hidden: !s.hidden } : s)),
  };
}

/** Removes a section and its entries in every translation overlay, so a later section with the same id starts clean. */
export function removeSection(doc: SiteDocument, id: string): SiteDocument {
  const translations = Object.fromEntries(
    Object.entries(doc.translations).map(([lang, overlay]) => {
      const { [id]: _dropped, ...sections } = overlay.sections;
      return [lang, { ...overlay, sections }];
    }),
  );
  return { ...doc, sections: doc.sections.filter((s) => s.id !== id), translations };
}

export function replaceSection(doc: SiteDocument, next: Section): SiteDocument {
  return { ...doc, sections: doc.sections.map((s) => (s.id === next.id ? next : s)) };
}

/** Applies an edit made on the localized view: to the section itself in the primary language, to the overlay otherwise. */
export function editSection(doc: SiteDocument, lang: string, edited: Section): SiteDocument {
  return lang === doc.meta.language ? replaceSection(doc, edited) : setTranslatedSection(doc, lang, edited);
}

/** Applies a tagline or description edit made on the localized view. */
export function editMetaText(doc: SiteDocument, lang: string, patch: { tagline?: string; description?: string }): SiteDocument {
  return lang === doc.meta.language ? { ...doc, meta: { ...doc.meta, ...patch } } : setTranslatedMeta(doc, lang, patch);
}

/** Adds an additional language with no translated text yet. Returns `doc` itself if the site already has it. */
export function addLanguage(doc: SiteDocument, code: string): SiteDocument {
  if (code === doc.meta.language || doc.meta.languages.includes(code)) return doc;
  return { ...doc, meta: { ...doc.meta, languages: [...doc.meta.languages, code] } };
}

/** Stores a whole translation (for example from the AI), adding the language if needed and replacing any earlier overlay. */
export function setTranslation(doc: SiteDocument, code: string, overlay: TranslationOverlay): SiteDocument {
  if (code === doc.meta.language) return doc;
  const withLanguage = addLanguage(doc, code);
  return { ...withLanguage, translations: { ...withLanguage.translations, [code]: overlay } };
}

/** Removes an additional language together with its translated text. */
export function removeLanguage(doc: SiteDocument, code: string): SiteDocument {
  const { [code]: _dropped, ...translations } = doc.translations;
  return { ...doc, meta: { ...doc.meta, languages: doc.meta.languages.filter((l) => l !== code) }, translations };
}

/** Changes the primary language. If it was an additional language, that entry and its overlay are dropped. */
export function setPrimaryLanguage(doc: SiteDocument, code: string): SiteDocument {
  if (code === doc.meta.language) return doc;
  return removeLanguage({ ...doc, meta: { ...doc.meta, language: code } }, code);
}

/**
 * Merges a theme suggested by the AI into the current one. A template id the
 * registry does not know is ignored so the page never switches to a missing template.
 */
export function mergeTheme(current: Theme, incoming: Theme, knownTemplateIds: readonly string[]): Theme {
  const templateId = knownTemplateIds.includes(incoming.templateId) ? incoming.templateId : current.templateId;
  return { ...current, ...incoming, templateId };
}

/** "path.to.field: message" for the first issue of a Zod error. */
export function formatIssue(error: { issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }> }): string {
  const issue = error.issues[0];
  if (!issue) return "The document is invalid.";
  const path = issue.path.map(String).join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}
