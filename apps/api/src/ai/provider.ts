import type { AiEditScope, Meta, Section, SiteDocument, Theme } from "@ministry/schema";

/** What one provider call consumed. Written to `ai_usage` by the routes. */
export type AiCallUsage = {
  inputTokens: number;
  outputTokens: number;
  model: string;
  provider: string;
};

export type TemplateChoice = { id: string; name: string; description: string };

export type DraftInput = {
  notes: string;
  language: string;
  variations: number;
  /** Template ids the model may choose from (read from the registry at request time). */
  templates: TemplateChoice[];
  orgName: string;
  styleNotes?: string;
  /** R2 key in the IMAGES bucket of a design reference image. */
  referenceAssetKey?: string;
};

export type RewriteInput = {
  text: string;
  instruction: string;
  context?: string;
};

export type ThemeInput = {
  templates: TemplateChoice[];
  description?: string;
  referenceAssetKey?: string;
  currentTheme?: Theme;
};

export type AltTextInput = {
  assetKey: string;
  orgName: string;
};

export type TranslateInput = {
  document: SiteDocument;
  /** Code of the language to produce, e.g. "es". */
  targetLanguage: string;
  /** Code of the document's primary language. */
  sourceLanguage: string;
};

/** The scoped content an edit may change. The model never sees the rest of the document, only `pageSummary`. */
export type EditTarget =
  | { kind: "section"; section: Section }
  | { kind: "meta"; meta: Meta }
  | { kind: "theme"; theme: Theme }
  | { kind: "page"; meta: Meta; sections: Section[] };

export type EditInput = {
  instruction: string;
  scope: AiEditScope;
  target: EditTarget;
  /** One line describing the page, so a section edit knows what else is there. */
  pageSummary: string;
  templateId: string;
  /** Template ids the model may choose from when the scope is the theme. */
  templates: TemplateChoice[];
  orgName: string;
  language: string;
  /** 1 or 3 alternatives. Page edits are always 1. */
  options: number;
};

/** One alternative the model wrote. `after` values are unvalidated JSON; the route validates and conforms them. */
export type EditOption = {
  label: string;
  changes: { target: string; after: unknown }[];
};

export type AddSectionInput = {
  instruction: string;
  pageSummary: string;
  /** Types already on the page and the one the new section would follow, for context. */
  existingTypes: string[];
  afterSection?: Section;
  orgName: string;
  language: string;
};

export interface AiProvider {
  /** Scoped edit: each option changes only the scoped content. */
  edit(input: EditInput): Promise<{ options: EditOption[]; usage: AiCallUsage }>;
  /** `section` is unvalidated JSON; the route validates it against `Section` and assigns the id. */
  addSection(input: AddSectionInput): Promise<{ section: unknown; usage: AiCallUsage }>;
  /** `document` is unvalidated JSON; the route validates it against `SiteDocument`. */
  draft(input: DraftInput): Promise<{ variations: { label: string; document: unknown }[]; usage: AiCallUsage }>;
  rewrite(input: RewriteInput): Promise<{ text: string; usage: AiCallUsage }>;
  theme(input: ThemeInput): Promise<{ theme: Theme; rationale: string; usage: AiCallUsage }>;
  altText(input: AltTextInput): Promise<{ alt: string; usage: AiCallUsage }>;
  /** `overlay` is unvalidated JSON; the route validates it against `TranslationOverlay`. */
  translate(input: TranslateInput): Promise<{ overlay: unknown; usage: AiCallUsage }>;
}

/** A provider or network failure. Routes answer 502 with `message`; `detail` is only logged. */
export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}
