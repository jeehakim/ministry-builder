import { renderToStaticMarkup } from "react-dom/server";
import { SiteDocument, type ImageRef } from "@ministry/schema";
import type { RenderOptions, Template } from "./types";
import { ClassicBody } from "./classic/Classic";
import { classicCss } from "./classic/styles";

export type { RenderOptions, Template } from "./types";

export const classic: Template = {
  id: "classic",
  name: "Classic",
  description: "Warm, readable, single column with a bold hero. Good for churches and community organizations.",
  themeDefaults: {},
  css: classicCss,
  Body: ClassicBody,
};

export const templates: Record<string, Template> = { classic };

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
  const body = renderToStaticMarkup(<template.Body doc={doc} options={options} />);
  const title = doc.meta.tagline ? `${doc.meta.orgName} — ${doc.meta.tagline}` : doc.meta.orgName;
  const html = `<!doctype html>
<html lang="${escapeHtml(doc.meta.language)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(doc.meta.description || doc.meta.tagline)}">
<style>${template.css(doc.theme)}</style>
</head>
<body>
${body}
</body>
</html>
`;
  return { html, images: collectImages(doc) };
}
