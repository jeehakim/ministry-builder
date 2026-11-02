import { renderToStaticMarkup } from "react-dom/server";
import { SiteDocument, type ImageRef } from "@ministry/schema";
import type { RenderOptions, Template } from "./types";
import { uiStrings as uiStringsFor } from "./i18n";
import { ClassicBody } from "./classic/Classic";
import { classicCss } from "./classic/styles";
import { ModernBody } from "./modern/Modern";
import { modernCss } from "./modern/styles";
import { BoldBody } from "./bold/Bold";
import { boldCss } from "./bold/styles";

export type { LanguageLink, RenderOptions, Template } from "./types";
export { uiStrings, type UiStrings } from "./i18n";

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

export interface RenderedSite {
  /** Complete index.html with inline CSS. */
  html: string;
  /** Every image reference used by the document, for bundling. */
  images: ImageRef[];
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

/** Collects all image refs in the document (meta.logo and any section image fields). */
export function collectImages(doc: SiteDocument): ImageRef[] {
  const out: ImageRef[] = [];
  if (doc.meta.logo) out.push(doc.meta.logo);
  for (const s of doc.sections) {
    if ("image" in s && s.image) out.push(s.image);
    if (s.type === "programs") for (const it of s.items) if (it.image) out.push(it.image);
    if (s.type === "team") for (const m of s.members) if (m.photo) out.push(m.photo);
  }
  return out;
}

export function renderSite(input: SiteDocument, options: RenderOptions): RenderedSite {
  const doc = SiteDocument.parse(input);
  const template = getTemplate(doc.theme.templateId);
  const body = renderToStaticMarkup(<template.Body doc={doc} options={{ ...options, language: doc.meta.language }} />);
  const title = doc.meta.tagline ? `${doc.meta.orgName} — ${doc.meta.tagline}` : doc.meta.orgName;
  const html = `<!doctype html>
<html lang="${escapeHtml(doc.meta.language)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(doc.meta.description || doc.meta.tagline)}">
${(options.languageLinks ?? []).map((l) => `<link rel="alternate" hreflang="${escapeHtml(l.code)}" href="${escapeHtml(l.href)}">`).join("\n")}
<style>${template.css(doc.theme)}</style>
</head>
<body>
${body}
</body>
</html>
`;
  return { html, images: collectImages(doc) };
}

/** A minimal "thank you" page shown after the contact form is submitted, in the site's theme and language. */
export function renderThanksPage(input: SiteDocument, options: { backHref: string; languageLinks?: RenderOptions["languageLinks"] }): string {
  const doc = SiteDocument.parse(input);
  const template = getTemplate(doc.theme.templateId);
  const t = uiStringsFor(doc.meta.language);
  const title = `${t.thanksTitle} — ${doc.meta.orgName}`;
  return `<!doctype html>
<html lang="${escapeHtml(doc.meta.language)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>${template.css(doc.theme)}
.thanks{min-height:70vh;display:grid;place-items:center;text-align:center;padding:48px 20px}
.thanks .card{max-width:34rem}
.thanks h1{font-size:clamp(2rem,5vw,3rem)}
.thanks a.btn{display:inline-block;margin-top:16px;padding:12px 22px;border-radius:var(--radius);background:var(--primary);color:#fff;text-decoration:none;font-weight:600}</style>
</head>
<body>
<main class="thanks"><div class="card">
<h1>${escapeHtml(t.thanksTitle)}</h1>
<p>${escapeHtml(t.thanksBody)}</p>
<a class="btn" href="${escapeHtml(options.backHref)}">${escapeHtml(t.back)}</a>
</div></main>
</body>
</html>
`;
}
