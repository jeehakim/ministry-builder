/** Scales (width, height) so the long side is at most `max`. Never upscales. */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const long = Math.max(width, height);
  if (long <= max) return { width, height };
  const scale = max / long;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "site";
}

const EXT_BY_MIME: Record<string, string> = {
  "image/webp": "webp",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "image/avif": "avif",
};

/**
 * Picks the file name used for an image inside the export ZIP: the basename of
 * `src`, sanitized, given an extension from the mime type if missing, and made
 * unique against `used` (which is updated).
 */
export function uniqueFileName(src: string, mime: string, used: Set<string>): string {
  const path = src.split(/[?#]/)[0] ?? "";
  const base = path.split("/").filter(Boolean).pop() ?? "image";
  let name = base.replace(/[^a-zA-Z0-9._-]/g, "_") || "image";
  if (!/\.[a-zA-Z0-9]+$/.test(name)) name += `.${EXT_BY_MIME[mime] ?? "bin"}`;

  const dot = name.lastIndexOf(".");
  const stem = name.slice(0, dot);
  const ext = name.slice(dot);
  let candidate = name;
  for (let n = 2; used.has(candidate); n++) candidate = `${stem}-${n}${ext}`;
  used.add(candidate);
  return candidate;
}
