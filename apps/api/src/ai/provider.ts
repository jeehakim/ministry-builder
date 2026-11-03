import type { SiteDocument, Theme } from "@ministry/schema";

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

export type CampaignStoryInput = {
  /** What the campaign is for, who it helps, the goal and timing. */
  brief: string;
  language: string;
  orgName: string;
  /** Goal and deadline as the owner typed them, for the model to mention; already formatted. */
  goalText?: string;
  deadline?: string;
};

export type ThankYouInput = {
  campaignTitle: string;
  /** The story, so the thank-you can echo its purpose. May be empty. */
  story: string;
  orgName: string;
  language: string;
  notes?: string;
};

export interface AiProvider {
  /** `document` is unvalidated JSON; the route validates it against `SiteDocument`. */
  draft(input: DraftInput): Promise<{ variations: { label: string; document: unknown }[]; usage: AiCallUsage }>;
  rewrite(input: RewriteInput): Promise<{ text: string; usage: AiCallUsage }>;
  theme(input: ThemeInput): Promise<{ theme: Theme; rationale: string; usage: AiCallUsage }>;
  altText(input: AltTextInput): Promise<{ alt: string; usage: AiCallUsage }>;
  /** `overlay` is unvalidated JSON; the route validates it against `TranslationOverlay`. */
  translate(input: TranslateInput): Promise<{ overlay: unknown; usage: AiCallUsage }>;
  /** A campaign title, one-line summary and story drafted from a brief. */
  campaignStory(input: CampaignStoryInput): Promise<{ title: string; summary: string; story: string; usage: AiCallUsage }>;
  /** A short thank-you message sent to donors of a campaign. Plain text; `{{name}}` marks where the donor's name goes. */
  thankYou(input: ThankYouInput): Promise<{ message: string; usage: AiCallUsage }>;
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
