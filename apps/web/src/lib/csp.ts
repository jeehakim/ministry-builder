/**
 * The Content-Security-Policy for the static Worker, as data. `public/_headers` carries the
 * serialised policy (Cloudflare reads that file, not this one); csp.test.ts fails if the two
 * drift apart, so edit this list first and then paste `buildCsp(CSP_DIRECTIVES)` into the file.
 */

export type CspDirectives = Readonly<Record<string, readonly string[]>>;

/** The API Worker (apps/api/wrangler.jsonc routes); VITE_API_URL must point at the same origin. */
const API_ORIGIN = "https://api.build.shofar.ai";
/**
 * Clerk's frontend API for the "Shofar Builder" Clerk application, whose production instance has
 * build.shofar.ai as its primary domain. Serves clerk-js and answers the sign-in calls.
 */
const CLERK_FAPI = "https://clerk.build.shofar.ai";
/** Clerk's bot protection (Turnstile) and fraud protection hosts, per Clerk's CSP guide. */
const CLERK_CHALLENGE = "https://challenges.cloudflare.com";
const CLERK_PROTECT = "https://*.protect.clerk.com";

export const CSP_DIRECTIVES: CspDirectives = {
  "default-src": ["'self'"],
  // No 'unsafe-inline': the theme bootstrap lives in public/theme-init.js.
  "script-src": ["'self'", CLERK_FAPI, CLERK_CHALLENGE, CLERK_PROTECT],
  // Tailwind utilities are static CSS, but Clerk injects runtime styles and the preview iframe has an inline <style>.
  "style-src": ["'self'", "'unsafe-inline'"],
  // Uploaded images come from the API; users may also point an image at any https URL.
  "img-src": ["'self'", "data:", "blob:", "https:"],
  "font-src": ["'self'", "data:"],
  // The trailing :* on protect.clerk.com is required: those hosts are served on non-443 ports.
  "connect-src": ["'self'", API_ORIGIN, CLERK_FAPI, "https://*.clerk.accounts.dev", `${CLERK_PROTECT}:*`],
  "frame-src": ["'self'", CLERK_FAPI, "blob:", CLERK_CHALLENGE, CLERK_PROTECT],
  "worker-src": ["'self'", "blob:"],
  "base-uri": ["'self'"],
  "form-action": ["'self'"],
  "frame-ancestors": ["'none'"],
  "upgrade-insecure-requests": [],
};

/** Serialises directives into a header value. Throws on an empty name or a value that could break the header. */
export function buildCsp(directives: CspDirectives): string {
  const parts: string[] = [];
  for (const [name, sources] of Object.entries(directives)) {
    if (!/^[a-z][a-z-]*$/.test(name)) throw new Error(`Invalid CSP directive name: ${JSON.stringify(name)}`);
    for (const source of sources) {
      if (source === "" || /[\s;,\r\n]/.test(source)) throw new Error(`Invalid CSP source in ${name}: ${JSON.stringify(source)}`);
    }
    parts.push([name, ...sources].join(" "));
  }
  return parts.join("; ");
}

/** Reads `public/_headers` into a map of path pattern to header name to value. Comments and blank lines are skipped. */
export function parseHeadersFile(text: string): Map<string, Map<string, string>> {
  const rules = new Map<string, Map<string, string>>();
  let current: Map<string, string> | null = null;
  for (const raw of text.split(/\r?\n/)) {
    if (raw.trim() === "" || raw.trimStart().startsWith("#")) continue;
    if (!/^\s/.test(raw)) {
      current = rules.get(raw.trim()) ?? new Map<string, string>();
      rules.set(raw.trim(), current);
      continue;
    }
    if (!current) throw new Error(`Header before any path pattern: ${raw.trim()}`);
    const colon = raw.indexOf(":");
    if (colon === -1) throw new Error(`Malformed header line: ${raw.trim()}`);
    current.set(raw.slice(0, colon).trim().toLowerCase(), raw.slice(colon + 1).trim());
  }
  return rules;
}
