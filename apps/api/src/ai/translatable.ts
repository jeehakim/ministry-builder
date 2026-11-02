import type { SiteDocument, TranslationOverlay } from "@ministry/schema";

/**
 * The translatable text of a document, in the same shape as a `TranslationOverlay`.
 * Structure, media and machine-readable values (ids, image refs, hrefs, emails, phone
 * numbers, form endpoints) are never included, so they can neither be sent to the model
 * nor be changed by what comes back.
 */
const SKIP_KEYS = new Set(["id", "type", "hidden", "image", "photo", "logo", "href", "email", "phone", "formEndpoint", "campaigns"]);

export type TranslatableText = {
  meta: { tagline?: string; description?: string };
  sections: Record<string, Record<string, unknown>>;
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Strings, and arrays/objects that contain strings, with everything else left out. Undefined when nothing remains. */
function pick(value: unknown): unknown {
  if (typeof value === "string") return value.trim() ? value : undefined;
  if (Array.isArray(value)) {
    const items = value.map((item) => (typeof item === "string" ? item : pick(item)));
    if (items.every((item) => item === undefined || item === "")) return undefined;
    return items.map((item) => item ?? {});
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (SKIP_KEYS.has(key)) continue;
      const picked = pick(child);
      if (picked !== undefined) out[key] = picked;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return undefined;
}

export function extractTranslatable(doc: SiteDocument): TranslatableText {
  const meta: TranslatableText["meta"] = {};
  if (doc.meta.tagline.trim()) meta.tagline = doc.meta.tagline;
  if (doc.meta.description.trim()) meta.description = doc.meta.description;
  const sections: TranslatableText["sections"] = {};
  for (const section of doc.sections) {
    const picked = pick(section);
    if (isPlainObject(picked)) sections[section.id] = picked;
  }
  return { meta, sections };
}

export function isEmptyTranslatable(text: TranslatableText): boolean {
  return Object.keys(text.meta).length === 0 && Object.keys(text.sections).length === 0;
}

/** Applies `fn` to every string, keeping the structure. */
export function mapStrings<T>(value: T, fn: (s: string) => string): T {
  if (typeof value === "string") return fn(value) as T;
  if (Array.isArray(value)) return value.map((v) => mapStrings(v, fn)) as T;
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapStrings(v, fn)])) as T;
  }
  return value;
}

/**
 * Reduces what the model returned to the shape of `source`. Keys that are not in the source are
 * dropped silently; a wrong type or a different array length is reported so it can be repaired.
 */
function conform(src: unknown, got: unknown, path: string, problems: string[]): unknown {
  if (got === undefined || got === null) return undefined;
  if (typeof src === "string") {
    if (typeof got !== "string") {
      problems.push(`${path}: expected a string`);
      return undefined;
    }
    return got.trim() ? got : undefined;
  }
  if (Array.isArray(src)) {
    if (!Array.isArray(got)) {
      problems.push(`${path}: expected an array`);
      return undefined;
    }
    if (got.length !== src.length) {
      problems.push(`${path}: expected exactly ${src.length} items in the same order, got ${got.length}`);
      return undefined;
    }
    return src.map((item, i) => {
      const out = conform(item, got[i], `${path}[${i}]`, problems);
      return out ?? (typeof item === "string" ? item : {});
    });
  }
  if (isPlainObject(src)) {
    if (!isPlainObject(got)) {
      problems.push(`${path}: expected an object`);
      return undefined;
    }
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src)) {
      const child = conform(src[key], got[key], `${path}.${key}`, problems);
      if (child !== undefined) out[key] = child;
    }
    return out;
  }
  return undefined;
}

export function conformOverlay(
  source: TranslatableText,
  overlay: TranslationOverlay,
): { value: TranslationOverlay; problems: string[] } {
  const problems: string[] = [];
  const meta = (conform(source.meta, overlay.meta, "meta", problems) ?? {}) as TranslationOverlay["meta"];
  const sections: TranslationOverlay["sections"] = {};
  for (const [id, src] of Object.entries(source.sections)) {
    const out = conform(src, overlay.sections[id], `sections.${id}`, problems);
    if (isPlainObject(out) && Object.keys(out).length) sections[id] = out;
  }
  return { value: { meta, sections }, problems };
}
