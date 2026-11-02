const ASSET_PREFIX = "/assets/";

/**
 * Extracts the R2 key from an `ImageRef.src` served by the API ("/assets/<key>",
 * optionally with the API origin in front). Returns null for anything that is
 * not an uploaded asset (local data URLs, export-relative paths, other hosts).
 */
export function assetKeyFromSrc(src: string): string | null {
  let path = src;
  if (/^https?:\/\//i.test(src)) {
    try {
      path = new URL(src).pathname;
    } catch {
      return null;
    }
  }
  path = path.split(/[?#]/)[0] ?? "";
  if (!path.startsWith(ASSET_PREFIX)) return null;
  const key = path.slice(ASSET_PREFIX.length);
  return key === "" ? null : key;
}

/** Returns the URL only if it is http(s); anything else (javascript:, data:) becomes null. */
export function safeHttpUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
  } catch {
    return null;
  }
}
