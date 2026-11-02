import { LANGUAGE_NAMES, languageName, siteLanguages, type SiteDocument } from "@ministry/schema";
import type { RenderOptions } from "@ministry/templates";

export type LanguageLink = NonNullable<RenderOptions["languageLinks"]>[number];

/** Hash prefix used by the preview's language links, so the editor can tell them from page anchors. */
export const LANG_HASH_PREFIX = "#lang-";

/**
 * The language the editor is showing. `requested` is what the user picked (null
 * means the primary); it only counts while that language still exists on the site.
 */
export function resolveEditingLang(doc: SiteDocument, requested: string | null): string {
  const primary = doc.meta.language;
  return requested && requested !== primary && doc.meta.languages.includes(requested) ? requested : primary;
}

/** Language switcher entries for the preview. Hrefs are in-page hashes the editor intercepts. */
export function previewLanguageLinks(doc: SiteDocument, current: string): LanguageLink[] {
  const codes = siteLanguages(doc);
  if (codes.length < 2) return [];
  return codes.map((code) => ({ code, label: languageName(code), href: `${LANG_HASH_PREFIX}${code}`, current: code === current }));
}

/** The language code in a preview language link href, or null for any other href. */
export function langFromHash(href: string | null | undefined): string | null {
  if (!href || !href.startsWith(LANG_HASH_PREFIX)) return null;
  const code = href.slice(LANG_HASH_PREFIX.length);
  return code === "" ? null : code;
}

export interface LanguageUrl {
  code: string;
  label: string;
  url: string;
  primary: boolean;
}

/** Public address of each language version: the site URL for the primary, `<url><lang>/` for the others. */
export function languageUrls(siteUrl: string, doc: SiteDocument): LanguageUrl[] {
  const root = siteUrl.endsWith("/") ? siteUrl : `${siteUrl}/`;
  const primary = doc.meta.language;
  return siteLanguages(doc).map((code) => ({
    code,
    label: languageName(code),
    url: code === primary ? root : `${root}${encodeURIComponent(code)}/`,
    primary: code === primary,
  }));
}

/** Languages that can still be added: the known list minus the ones the site already has. */
export function addableLanguages(doc: SiteDocument): { code: string; label: string }[] {
  const taken = new Set(siteLanguages(doc));
  return Object.keys(LANGUAGE_NAMES)
    .filter((code) => !taken.has(code))
    .map((code) => ({ code, label: languageName(code) }));
}

/** Options for the primary language Select: every known language except the extra ones, plus the current code. */
export function primaryLanguageOptions(doc: SiteDocument): { code: string; label: string }[] {
  const extras = new Set(doc.meta.languages);
  const codes = Object.keys(LANGUAGE_NAMES).filter((c) => !extras.has(c));
  if (!codes.includes(doc.meta.language)) codes.unshift(doc.meta.language);
  return codes.map((code) => ({ code, label: languageName(code) }));
}

/** The note shown while editing a translation. */
export function translationNotice(primaryCode: string): string {
  return `Switch to ${languageName(primaryCode)} to change images, links and layout.`;
}

/** Messages shown while the translate call runs; the last one stays until it returns. */
export function translateProgressMessages(targetCode: string): string[] {
  const name = languageName(targetCode);
  return [
    "Reading your page…",
    `Translating into ${name}…`,
    "Keeping names, links and numbers as they are…",
    "Almost there, this can take up to a minute…",
  ];
}
