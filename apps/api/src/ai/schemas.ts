import {
  AboutSection,
  ContactSection,
  EventsSection,
  GiveSection,
  HeroSection,
  Link,
  ProgramsSection,
  SiteDocument,
  StoriesSection,
  TeamSection,
  Theme,
  TranslationOverlay,
  type SectionType,
} from "@ministry/schema";
import { z } from "zod";
import type { EditInput, EditOption } from "./provider";
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
export const CampaignStoryOutput = z.object({
  title: z.string().trim().min(1).max(120),
  summary: z.string().trim().max(300).default(""),
  story: z.string().trim().min(1).max(8000),
});
export const ThankYouOutput = z.object({ message: z.string().trim().min(1).max(2000) });

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

// ---- Scoped edits --------------------------------------------------------

/** The model sees and returns images as alt text only; the route restores the real references. */
const AltOnly = z.object({ alt: z.string().max(200).default("") });

/** Section schemas as the model writes them: the real ones with media reduced to `AltOnly`. */
const MODEL_SECTIONS: Record<SectionType, z.AnyZodObject> = {
  hero: HeroSection.extend({ image: AltOnly.optional() }),
  about: AboutSection.extend({ image: AltOnly.optional() }),
  programs: ProgramsSection.extend({
    items: z.array(z.object({ title: z.string().min(1), description: z.string().default(""), image: AltOnly.optional(), link: Link.optional() })).default([]),
  }),
  events: EventsSection,
  team: TeamSection.extend({
    members: z.array(z.object({ name: z.string().min(1), role: z.string().default(""), bio: z.string().default(""), photo: AltOnly.optional() })).default([]),
  }),
  stories: StoriesSection,
  give: GiveSection,
  contact: ContactSection,
};

const ModelSection = z.discriminatedUnion("type", [
  MODEL_SECTIONS.hero as typeof HeroSection,
  MODEL_SECTIONS.about as typeof AboutSection,
  MODEL_SECTIONS.programs as typeof ProgramsSection,
  MODEL_SECTIONS.events as typeof EventsSection,
  MODEL_SECTIONS.team as typeof TeamSection,
  MODEL_SECTIONS.stories as typeof StoriesSection,
  MODEL_SECTIONS.give as typeof GiveSection,
  MODEL_SECTIONS.contact as typeof ContactSection,
]);

const optionLabel = z.string().trim().min(1).max(60);

/** The three meta strings the AI may write. Logo and languages are never part of an edit. */
export const MetaTextOutput = z.object({
  orgName: z.string().trim().min(1).max(120),
  tagline: z.string().max(200).default(""),
  description: z.string().max(400).default(""),
});

type EditOutput = { options: EditOption[] };

/**
 * The shape an edit must come back in, per scope. Section edits are pinned to the
 * section's own type and id (enforced by the grammar for providers that support one),
 * page edits may touch any section on the page plus the meta text. Everything is
 * normalized to `{ options: [{ label, changes }] }` for the route.
 */
export function editOutputSchema(input: EditInput): z.ZodType<EditOutput, z.ZodTypeDef, unknown> {
  const n = input.options;
  const target = input.target;
  switch (target.kind) {
    case "section": {
      const section = MODEL_SECTIONS[target.section.type].extend({
        id: z.literal(target.section.id),
        type: z.literal(target.section.type),
      });
      return z
        .object({ options: z.array(z.object({ label: optionLabel, section })).length(n) })
        .transform((o) => ({
          options: o.options.map((opt) => ({ label: opt.label, changes: [{ target: target.section.id, after: opt.section }] })),
        }));
    }
    case "meta":
      return z
        .object({ options: z.array(z.object({ label: optionLabel, meta: MetaTextOutput })).length(n) })
        .transform((o) => ({ options: o.options.map((opt) => ({ label: opt.label, changes: [{ target: "meta", after: opt.meta }] })) }));
    case "theme":
      return z
        .object({ options: z.array(z.object({ label: optionLabel, theme: Theme })).length(n) })
        .transform((o) => ({ options: o.options.map((opt) => ({ label: opt.label, changes: [{ target: "theme", after: opt.theme }] })) }));
    case "page": {
      const byId = new Map(target.sections.map((s) => [s.id, s.type]));
      const change = z.union([
        z.object({ target: z.literal("meta"), after: MetaTextOutput }),
        z.object({ target: z.string().min(1), after: ModelSection }),
      ]);
      return z
        .object({ label: optionLabel, changes: z.array(change).min(1) })
        .superRefine((o, ctx) => {
          o.changes.forEach((c, index) => {
            if (c.target === "meta") return;
            const type = byId.get(c.target);
            if (!type) {
              ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["changes", index, "target"], message: `"${c.target}" is not a section on this page` });
            } else if ("type" in c.after && c.after.type !== type) {
              ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["changes", index, "after", "type"], message: `section "${c.target}" is of type "${type}" and must stay so` });
            } else if ("id" in c.after && c.after.id !== c.target) {
              ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["changes", index, "after", "id"], message: `keep the id "${c.target}"` });
            }
          });
        })
        .transform((o) => ({ options: [{ label: o.label, changes: o.changes }] }));
    }
  }
}

export const AddSectionOutput = z.object({ section: ModelSection });
