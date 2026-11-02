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
