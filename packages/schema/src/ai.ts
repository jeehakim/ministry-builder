import { z } from "zod";
import { SiteDocument, Theme, TranslationOverlay } from "./site.ts";

/**
 * Contract for the AI copilot endpoints. The API validates requests with
 * these, the web client validates responses with them. Keep both apps on
 * this file; never redefine the shapes locally.
 */

export const AI_ACTIONS = ["draft", "rewrite", "theme", "alt_text", "translate"] as const;
export type AiAction = (typeof AI_ACTIONS)[number];

/** Preset instructions the editor offers on text fields; custom text is also allowed. */
export const AI_REWRITE_PRESETS = [
  { id: "improve", label: "Improve", instruction: "Improve clarity and flow. Keep the meaning, length and voice." },
  { id: "shorter", label: "Shorter", instruction: "Make it about half as long without losing the key point." },
  { id: "warmer", label: "Warmer", instruction: "Make it warmer and more welcoming, as if inviting a neighbor." },
  { id: "ko", label: "Translate to Korean", instruction: "Translate to natural, respectful Korean (존댓말)." },
  { id: "en", label: "Translate to English", instruction: "Translate to natural, plain English." },
] as const;

export const AiRewriteRequest = z.object({
  text: z.string().min(1).max(4000),
  instruction: z.string().min(1).max(300),
  /** Where the text lives, e.g. "hero heading" or "give section body". Helps tone. */
  context: z.string().max(200).optional(),
});
export type AiRewriteRequest = z.infer<typeof AiRewriteRequest>;

export const AiRewriteResponse = z.object({ text: z.string().min(1) });
export type AiRewriteResponse = z.infer<typeof AiRewriteResponse>;

export const AiDraftRequest = z.object({
  /** Free-form notes about the organization: mission, programs, times, people, how to give. */
  notes: z.string().min(10).max(8000),
  language: z.string().default("en"),
  variations: z.union([z.literal(1), z.literal(3)]).default(3),
  /** R2 key of an uploaded design reference image (the part after "/assets/"). */
  referenceAssetKey: z.string().optional(),
  /** Free text about the look they want, e.g. "calm, earthy, like our flyer". */
  styleNotes: z.string().max(500).optional(),
});
export type AiDraftRequest = z.infer<typeof AiDraftRequest>;

export const AiDraftVariation = z.object({
  versionId: z.string(),
  /** Short human label, e.g. "Warm & classic". */
  label: z.string(),
  document: SiteDocument,
});
export type AiDraftVariation = z.infer<typeof AiDraftVariation>;

export const AiDraftResponse = z.object({
  variationGroupId: z.string(),
  variations: z.array(AiDraftVariation).min(1),
});
export type AiDraftResponse = z.infer<typeof AiDraftResponse>;

export const AiThemeRequest = z
  .object({
    referenceAssetKey: z.string().optional(),
    description: z.string().max(500).optional(),
  })
  .refine((v) => v.referenceAssetKey || v.description, { message: "Provide a reference image or a description." });
export type AiThemeRequest = z.infer<typeof AiThemeRequest>;

export const AiThemeResponse = z.object({ theme: Theme, rationale: z.string() });
export type AiThemeResponse = z.infer<typeof AiThemeResponse>;

export const AiAltTextRequest = z.object({ assetKey: z.string().min(1) });
export type AiAltTextRequest = z.infer<typeof AiAltTextRequest>;

export const AiAltTextResponse = z.object({ alt: z.string().min(1).max(200) });
export type AiAltTextResponse = z.infer<typeof AiAltTextResponse>;

export const AiUsageResponse = z.object({
  used: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  /** ISO timestamp when the daily window resets (midnight UTC). */
  resetsAt: z.string(),
  /** False when the server has no AI key configured. */
  available: z.boolean(),
});
export type AiUsageResponse = z.infer<typeof AiUsageResponse>;

export const AiTranslateRequest = z.object({
  /** Target language code, e.g. "en" or "es". Must differ from the primary language. */
  language: z.string().min(2).max(10),
});
export type AiTranslateRequest = z.infer<typeof AiTranslateRequest>;

export const AiTranslateResponse = z.object({ language: z.string(), overlay: TranslationOverlay });
export type AiTranslateResponse = z.infer<typeof AiTranslateResponse>;
