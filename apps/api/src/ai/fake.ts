import { emptySiteDocument, type SiteDocument, type Theme } from "@ministry/schema";
import { AiProviderError, type AiCallUsage, type AiProvider, type EditOption } from "./provider";
import { extractTranslatable, mapStrings } from "./translatable";

const USAGE: AiCallUsage = { inputTokens: 100, outputTokens: 200, model: "fake-model", provider: "fake" };
/** A rewrite with this instruction fails like an unreachable provider, so routes can be tested on that path. */
export const FAKE_FAILING_INSTRUCTION = "__fail__";

const LOOKS: { label: string; theme: Partial<Theme> }[] = [
  {
    label: "Warm and classic",
    theme: { primary: "#1f4e79", accent: "#d9a441", heroStyle: "image", radius: "small" },
  },
  {
    label: "Fresh and bold",
    theme: { primary: "#7a1f3d", accent: "#f2b134", heroStyle: "solid", radius: "large" },
  },
  {
    label: "Calm and earthy",
    theme: { primary: "#2f5d50", accent: "#c8864b", heroStyle: "split", radius: "none" },
  },
];

/** Deterministic stand-in for tests: no network, same output for the same input. */
export function createFakeProvider(): AiProvider {
  return {
    async draft(input) {
      const variations = Array.from({ length: input.variations }, (_, i) => {
        const look = LOOKS[i % LOOKS.length]!;
        const document: SiteDocument = emptySiteDocument(input.orgName);
        document.meta.language = input.language;
        document.theme = {
          ...document.theme,
          ...look.theme,
          templateId: input.templates[i % input.templates.length]?.id ?? document.theme.templateId,
        };
        for (const section of document.sections) {
          if (section.type === "about") section.body = input.notes.trim();
        }
        return { label: look.label, document };
      });
      return { variations, usage: USAGE };
    },

    async rewrite(input) {
      if (input.instruction === FAKE_FAILING_INSTRUCTION) throw new AiProviderError("The fake provider was asked to fail.");
      return { text: "Rewritten text.", usage: USAGE };
    },

    async theme(input) {
      const theme: Theme = {
        templateId: input.templates[0]?.id ?? "classic",
        primary: "#2f5d50",
        accent: "#c8864b",
        background: "#fbf8f3",
        text: "#1a1a1a",
        headingFont: "Georgia, 'Times New Roman', serif",
        bodyFont: "system-ui, -apple-system, 'Segoe UI', sans-serif",
        heroStyle: "split",
        radius: "small",
      };
      return { theme, rationale: "Earthy greens and warm clay for a calm, welcoming feel.", usage: USAGE };
    },

    async altText() {
      return { alt: "People gathered together at a community event", usage: USAGE };
    },

    async campaignStory(input) {
      const brief = input.brief.trim();
      return {
        title: `Campaign for ${input.orgName}`,
        summary: `Your gift helps ${input.orgName} with: ${brief.slice(0, 80)}`,
        story: `${brief}\n\nEvery gift goes straight to this work.${input.goalText ? ` Our goal is ${input.goalText}.` : ""}\n\nWill you give today?`,
        usage: USAGE,
      };
    },

    async thankYou(input) {
      return {
        message: `Dear {{name}},\n\nThank you for giving to ${input.campaignTitle}. Your gift makes this work possible.${input.notes ? ` ${input.notes.trim()}` : ""}\n\nWith gratitude,\n${input.orgName}`,
        usage: USAGE,
      };
    },

    async translate(input) {
      const prefix = `[${input.targetLanguage}] `;
      return { overlay: mapStrings(extractTranslatable(input.document), (s) => `${prefix}${s}`), usage: USAGE };
    },

    async edit(input) {
      const labels = ["Warmer", "Shorter", "Clearer"];
      const t = input.target;
      const options: EditOption[] = Array.from({ length: input.options }, (_, i) => {
        const label = labels[i % labels.length]!;
        switch (t.kind) {
          case "section":
            return {
              label,
              changes: [
                {
                  target: t.section.id,
                  after: {
                    ...t.section,
                    heading: `${t.section.heading} · ${label}`,
                    ...("body" in t.section ? { body: `${t.section.body}\n\n${input.instruction}` } : {}),
                  },
                },
              ],
            };
          case "meta":
            return { label, changes: [{ target: "meta", after: { ...t.meta, tagline: `${input.instruction} · ${label}` } }] };
          case "theme":
            return { label, changes: [{ target: "theme", after: { ...t.theme, ...LOOKS[i % LOOKS.length]!.theme } }] };
          case "page":
            return {
              label,
              changes: [
                { target: "meta", after: { ...t.meta, tagline: `${t.meta.tagline} · ${label}` } },
                ...t.sections.filter((s) => s.type === "hero" || s.type === "about").map((s) => ({ target: s.id, after: { ...s, heading: `${s.heading} · ${label}` } })),
              ],
            };
        }
      });
      return { options, usage: USAGE };
    },

    async addSection(input) {
      const section = /event|camp|service|time|schedule/i.test(input.instruction)
        ? { id: "new", type: "events", heading: "Upcoming", items: [{ title: input.instruction, when: "", where: "", description: "" }] }
        : { id: "new", type: "about", heading: "More about us", body: input.instruction };
      return { section, usage: USAGE };
    },
  };
}
