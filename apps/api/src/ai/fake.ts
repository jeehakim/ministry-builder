import { emptySiteDocument, type SiteDocument, type Theme } from "@ministry/schema";
import type { AiCallUsage, AiProvider } from "./provider";

const USAGE: AiCallUsage = { inputTokens: 100, outputTokens: 200, model: "fake-model", provider: "fake" };

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

    async rewrite() {
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
  };
}
