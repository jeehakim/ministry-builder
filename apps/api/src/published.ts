import type { SiteDocument } from "@ministry/schema";
import type { Bindings } from "./types";

/** Public URL of a published site, or null when it is not live. */
export function publishedUrlFor(env: Pick<Bindings, "PUBLIC_SITES_HOST">, publishedPath: string | null): string | null {
  return publishedPath ? `https://${env.PUBLIC_SITES_HOST}${publishedPath}` : null;
}

/**
 * Makes root-relative `href`/`src` attributes document-relative ("/images/a.png" -> "images/a.png").
 * A published page is served both at "/" (customer domain, subdomain form) and at "/<slug>/" (host form),
 * so only document-relative links work everywhere. Templates already emit relative links; this guards
 * authored content and future templates. Protocol-relative URLs ("//cdn...") are left alone.
 */
export function relativizeRootLinks(html: string): string {
  return html.replace(/\b(href|src)=(["'])\/(?!\/)/g, "$1=$2");
}

/** Every object of a published site lives under this prefix in the PUBLISHED bucket. */
export function publishedPrefix(siteId: string): string {
  return `published/${siteId}/`;
}

export function publishedIndexKey(siteId: string): string {
  return `${publishedPrefix(siteId)}index.html`;
}

/** A URL path segment that names a language page: "en", "es", "zh-Hant". Anything else is not a language. */
export const LANGUAGE_PATH_PATTERN = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/;

/** The page of a non-primary language. Callers must check `LANGUAGE_PATH_PATTERN` first. */
export function publishedLanguageIndexKey(siteId: string, lang: string): string {
  return `${publishedPrefix(siteId)}${lang}/index.html`;
}

/** robots.txt of a published site, generated at publish time. */
export function publishedRobotsKey(siteId: string): string {
  return `${publishedPrefix(siteId)}robots.txt`;
}

/** sitemap.xml of a published site, generated at publish time. */
export function publishedSitemapKey(siteId: string): string {
  return `${publishedPrefix(siteId)}sitemap.xml`;
}

/** Absolute public URL of a site's primary page on the sites host, with a trailing slash. */
export function publicSiteUrl(env: Pick<Bindings, "PUBLIC_SITES_HOST">, slug: string): string {
  return `https://${env.PUBLIC_SITES_HOST}/${slug}/`;
}

/** An https origin as a CSP source: no path, no credentials, lowercase host. */
const HTTPS_ORIGIN = /^https:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::\d{1,5})?$/;

/** The https origins the contact forms of a document post to, other than the site itself (custom `formEndpoint`s). */
export function externalFormOrigins(doc: SiteDocument): string[] {
  const origins = new Set<string>();
  for (const section of doc.sections) {
    if (section.type !== "contact" || !section.formEndpoint) continue;
    try {
      const { protocol, origin } = new URL(section.formEndpoint);
      if (protocol === "https:" && HTTPS_ORIGIN.test(origin)) origins.add(origin);
    } catch {
      // A relative or malformed endpoint posts to the site itself, which 'self' already covers.
    }
  }
  return [...origins];
}

/** Reads origins back from page metadata, accepting only well-formed https origins so a header can never be injected. */
export function parseFormOrigins(value: string | undefined): string[] {
  return (value ?? "").split(" ").filter((origin) => HTTPS_ORIGIN.test(origin));
}

/** The page shown after a contact form submission, in the primary language. */
export function publishedThanksKey(siteId: string): string {
  return `${publishedPrefix(siteId)}thanks/index.html`;
}

/** The thank-you page of a non-primary language. Callers must check `LANGUAGE_PATH_PATTERN` first. */
export function publishedLanguageThanksKey(siteId: string, lang: string): string {
  return `${publishedPrefix(siteId)}${lang}/thanks/index.html`;
}

/** Safe to send as a Content-Language header value. */
export const LANGUAGE_TAG_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

export function publishedImagePrefix(siteId: string): string {
  return `${publishedPrefix(siteId)}images/`;
}

/** Lists every key under a prefix, following R2's pagination cursor. */
export async function listKeys(bucket: R2Bucket, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix, cursor });
    for (const object of page.objects) keys.push(object.key);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return keys;
}

/** R2 deletes at most 1000 keys per call. */
export async function deleteKeys(bucket: R2Bucket, keys: string[]): Promise<void> {
  for (let i = 0; i < keys.length; i += 1000) {
    await bucket.delete(keys.slice(i, i + 1000));
  }
}
