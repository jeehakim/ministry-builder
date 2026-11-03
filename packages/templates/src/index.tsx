import { renderToStaticMarkup } from "react-dom/server";
import { SiteDocument, type ImageRef } from "@ministry/schema";
import type { RenderOptions } from "./types";
import { uiStrings as uiStringsFor } from "./i18n";
import { campaignImages } from "./campaign";
import { getTemplate } from "./registry";

export type { CampaignCard, LanguageLink, RenderOptions, Template } from "./types";
export { uiStrings, type UiStrings } from "./i18n";
export { bold, classic, getTemplate, modern, TEMPLATE_IDS, templates } from "./registry";
export { CAMPAIGN_CSS, campaignsFor, formatDeadline } from "./campaign";
export { renderCampaignPage, type CampaignPageOptions, type CampaignPageInput, type RenderedCampaignPage } from "./campaignPage";

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
  const description = doc.meta.description || doc.meta.tagline;
  const html = `<!doctype html>
<html lang="${escapeHtml(doc.meta.language)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta name="theme-color" content="${escapeHtml(doc.theme.primary)}">
${seoHead(doc, options, title, description)}
<style>${template.css(doc.theme)}</style>
</head>
<body>
${body}
</body>
</html>
`;
  return { html, images: [...collectImages(doc), ...campaignImages(options)] };
}

/** Resolves a possibly relative href against the page's canonical URL; returns the input when no base is known. */
function absolute(href: string, base: string | undefined): string {
  if (!base) return href;
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

/** Canonical, alternates, Open Graph, Twitter card and Organization JSON-LD. Alternates stay relative without a canonical URL. */
function seoHead(doc: SiteDocument, options: RenderOptions, title: string, description: string): string {
  const base = options.canonicalUrl;
  const links = options.languageLinks ?? [];
  const lines: string[] = [];
  for (const l of links) lines.push(`<link rel="alternate" hreflang="${escapeHtml(l.code)}" href="${escapeHtml(absolute(l.href, base))}">`);
  if (links.length > 1) {
    const primary = links[0];
    if (primary) lines.push(`<link rel="alternate" hreflang="x-default" href="${escapeHtml(absolute(primary.href, base))}">`);
  }
  if (base) {
    lines.push(`<link rel="canonical" href="${escapeHtml(base)}">`);
    const hero = doc.sections.find((s) => s.type === "hero" && !s.hidden);
    const image = (hero && hero.type === "hero" && hero.image) || doc.meta.logo;
    const imageUrl = image ? absolute(options.imageUrl(image), base) : undefined;
    lines.push(
      `<meta property="og:type" content="website">`,
      `<meta property="og:site_name" content="${escapeHtml(doc.meta.orgName)}">`,
      `<meta property="og:title" content="${escapeHtml(title)}">`,
      `<meta property="og:description" content="${escapeHtml(description)}">`,
      `<meta property="og:url" content="${escapeHtml(base)}">`,
      `<meta property="og:locale" content="${escapeHtml(doc.meta.language)}">`,
      `<meta name="twitter:card" content="${imageUrl ? "summary_large_image" : "summary"}">`,
    );
    if (imageUrl) lines.push(`<meta property="og:image" content="${escapeHtml(imageUrl)}">`);
    const contact = doc.sections.find((s) => s.type === "contact" && !s.hidden);
    const org: Record<string, unknown> = {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: doc.meta.orgName,
      url: base,
      ...(description ? { description } : {}),
      ...(doc.meta.logo ? { logo: absolute(options.imageUrl(doc.meta.logo), base) } : {}),
      ...(contact && contact.type === "contact" && contact.social.length ? { sameAs: contact.social.map((l) => l.href).filter((h) => /^https?:/i.test(h)) } : {}),
    };
    // JSON inside <script> must not be able to close the tag.
    lines.push(`<script type="application/ld+json">${JSON.stringify(org).replace(/</g, "\\u003c")}</script>`);
  }
  return lines.join("\n");
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
