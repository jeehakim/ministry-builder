import type { Template } from "./types";
import { ClassicBody } from "./classic/Classic";
import { classicCss } from "./classic/styles";
import { ModernBody } from "./modern/Modern";
import { modernCss } from "./modern/styles";
import { BoldBody } from "./bold/Bold";
import { boldCss } from "./bold/styles";

export const classic: Template = {
  id: "classic",
  name: "Classic",
  description: "Warm, readable, single column with a bold hero. Good for churches and community organizations.",
  themeDefaults: {},
  css: classicCss,
  Body: ClassicBody,
};

export const modern: Template = {
  id: "modern",
  name: "Modern",
  description: "Airy, editorial sans-serif layout with a sticky top bar and a split hero. Good for newer ministries and nonprofits.",
  themeDefaults: {
    heroStyle: "split",
    radius: "large",
    headingFont: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  },
  css: modernCss,
  Body: ModernBody,
};

export const bold: Template = {
  id: "bold",
  name: "Bold",
  description: "Confident, high-contrast layout with a full-bleed hero, a values grid and a closing call to action. Good for foundations and campaigns.",
  themeDefaults: {
    heroStyle: "image",
    radius: "large",
    headingFont: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
    bodyFont: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  },
  css: boldCss,
  Body: BoldBody,
};

export const templates: Record<string, Template> = { classic, modern, bold };

/** Registry keys in display order, for other packages (pickers, validation). */
export const TEMPLATE_IDS: string[] = Object.keys(templates);

export function getTemplate(id: string): Template {
  return templates[id] ?? classic;
}

