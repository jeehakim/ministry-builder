import type { SiteDocument } from "@ministry/schema";

/** Control characters except tab, newline and carriage return, which free text (addresses, paragraphs) uses. */
const TEXT_CONTROLS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
/** Every control character. Browsers ignore tab and newline inside a URL, so `java\tscript:` must not survive. */
const URL_CONTROLS = /[\u0000-\u001F\u007F-\u009F]/g;

const SAFE_SCHEMES = new Set(["http", "https", "mailto", "tel"]);
const SCHEME = /^([a-z][a-z0-9+.-]*):/i;
const REMOVE = Symbol("remove");

/** Control characters out of a free-text string. */
function cleanText(text: string): string {
  return text.replace(TEXT_CONTROLS, "");
}

/**
 * The link as it may be published, or null when it must be dropped. Allowed: http(s), mailto, tel,
 * a fragment ("#about") and a relative path without "..". Leading whitespace, control characters and
 * letter case never hide a scheme: the check runs on the string the way a browser would read it.
 */
export function safeHref(href: unknown): string | null {
  if (typeof href !== "string") return null;
  const value = href.replace(URL_CONTROLS, "").trim();
  if (value === "") return null;
  if (value.startsWith("#")) return value;
  const scheme = SCHEME.exec(value);
  if (scheme) return SAFE_SCHEMES.has((scheme[1] ?? "").toLowerCase()) ? value : null;
  // Relative reference. Reject traversal in any spelling a path segment can take.
  const lowered = value.toLowerCase();
  if (lowered.includes("..") || lowered.includes("%2e") || lowered.includes("\\")) return null;
  return value;
}

type Mode = { overlay: boolean };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clean(value: unknown, mode: Mode): unknown {
  if (typeof value === "string") return cleanText(value);
  if (Array.isArray(value)) return value.map((item) => clean(item, mode)).filter((item) => item !== REMOVE);
  if (!isPlainObject(value)) return value;

  const out: [string, unknown][] = [];
  for (const [key, child] of Object.entries(value)) {
    if (key === "translations") {
      // Overlays are partial and merged by index, so nothing may be removed from their arrays.
      out.push([key, clean(child, { overlay: true })]);
    } else if (key === "href") {
      const href = safeHref(child);
      // A link without a destination is dropped whole in the document; in an overlay only the href goes,
      // so the primary language's (already checked) link shows through.
      if (href === null) {
        if (mode.overlay) continue;
        return REMOVE;
      }
      out.push([key, href]);
    } else if (key === "formEndpoint") {
      const endpoint = safeHref(child);
      if (endpoint !== null) out.push([key, endpoint]);
    } else {
      const next = clean(child, mode);
      if (next !== REMOVE) out.push([key, next]);
    }
  }
  return Object.fromEntries(out);
}

/**
 * Makes a site document safe to render into public HTML. Pure: the input is not modified.
 *
 * - Every `href` must be http(s), mailto, tel, a fragment or a relative path without "..".
 *   A link object with any other destination (javascript:, data:, vbscript:, ...) is removed from its
 *   section; a contact `formEndpoint` that fails the same test is cleared.
 * - Control characters are stripped from every string (tab, newline and carriage return stay in free text).
 *
 * Run it on the localized document of each language, because translation overlays can replace link targets.
 */
export function sanitizeDocumentForPublish(doc: SiteDocument): SiteDocument {
  return clean(doc, { overlay: false }) as SiteDocument;
}
