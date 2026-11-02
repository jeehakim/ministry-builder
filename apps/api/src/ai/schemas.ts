import { SiteDocument, Theme, TranslationOverlay } from "@ministry/schema";
import { z } from "zod";
import { conformOverlay, type TranslatableText } from "./translatable";

/** Section ids double as anchors and React keys, so repeats must be rejected (and repaired), not tolerated. */
const UniqueSectionIds = SiteDocument.superRefine((doc, ctx) => {
  const seen = new Set<string>();
  doc.sections.forEach((section, index) => {
    if (seen.has(section.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sections", index, "id"],
        message: `duplicate section id "${section.id}"; ids must be unique`,
      });
    }
    seen.add(section.id);
  });
});

export function draftOutputSchema(variations: number) {
  return z.object({
    variations: z
      .array(z.object({ label: z.string().trim().min(1).max(60), document: UniqueSectionIds }))
      .length(variations),
  });
}

export const RewriteOutput = z.object({ text: z.string().trim().min(1).max(8000) });
export const ThemeOutput = z.object({ theme: Theme, rationale: z.string().trim().max(600).default("") });
export const AltOutput = z.object({ alt: z.string().trim().min(1).max(200) });

/**
 * A model-written overlay, checked against the text that was sent: same sections, same array
 * lengths, strings only. Anything outside that shape is dropped; mismatches fail (and get repaired).
 */
export function translationOutputSchema(source: TranslatableText) {
  return TranslationOverlay.transform((overlay, ctx) => {
    const { value, problems } = conformOverlay(source, overlay);
    if (problems.length > 0) {
      for (const message of problems.slice(0, 12)) ctx.addIssue({ code: z.ZodIssueCode.custom, message });
      return z.NEVER;
    }
    return value;
  });
}
