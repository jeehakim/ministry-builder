import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { createMiddleware } from "hono/factory";
import {
  LANGUAGE_PATH_PATTERN,
  LANGUAGE_TAG_PATTERN,
  publishedImagePrefix,
  publishedIndexKey,
  publishedLanguageIndexKey,
  publishedLanguageThanksKey,
  publishedThanksKey,
} from "./published";
import { handleContactSubmission } from "./contact";
import { sites } from "./db/schema";
import { SLUG_PATTERN } from "./routes/sites";
import type { AppEnv } from "./types";

const WEB_APP_URL = "https://build.shofar.io";
const IMAGE_FILE_PATTERN = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

function redirect(status: 301 | 302, location: string): Response {
  return new Response(null, { status, headers: { Location: location, "X-Content-Type-Options": "nosniff" } });
}

function notFoundPage(): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Page not found</title>
<style>body{font:16px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;color:#1a1a1a}main{max-width:28rem;padding:1.5rem;text-align:center}</style>
</head>
<body>
<main>
<h1>Page not found</h1>
<p>This site does not exist or is not published.</p>
</main>
</body>
</html>
`;
  return new Response(html, {
    status: 404,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=30",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/** True when the hostname is the sites host itself or any subdomain of it. */
function isSitesHost(hostname: string, sitesHost: string): boolean {
  return hostname === sitesHost || hostname.endsWith(`.${sitesHost}`);
}

/**
 * Serves published sites from the PUBLISHED bucket (never from IMAGES). Runs before CORS and
 * auth: requests for the sites host never reach the API routes.
 *
 * Host form:      sites.shofar.io/<slug>/, /<slug>/<lang>/, /<slug>/thanks/, /<slug>/<lang>/thanks/ and /<slug>/images/<file>
 * Subdomain form: <slug>.sites.shofar.io/, /<lang>/, /thanks/, /<lang>/thanks/ and /images/<file>
 *
 * The one write: POST /<slug>/contact (subdomain form: POST /contact) takes contact-form submissions.
 */
export const serveSites = createMiddleware<AppEnv>(async (c, next) => {
  const sitesHost = c.env.PUBLIC_SITES_HOST?.toLowerCase();
  const url = new URL(c.req.url);
  const hostname = url.hostname.toLowerCase();
  if (!sitesHost || !isSitesHost(hostname, sitesHost)) return next();

  const isContactPath = hostname === sitesHost ? /^\/[^/]+\/contact$/.test(url.pathname) : url.pathname === "/contact";
  if (!isContactPath && c.req.method !== "GET" && c.req.method !== "HEAD") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { Allow: "GET, HEAD", "X-Content-Type-Options": "nosniff" },
    });
  }

  let slug: string;
  let base: string; // URL prefix of the site root, without a trailing slash
  let rest: string; // path below the site root, always starting with "/"
  if (hostname === sitesHost) {
    if (url.pathname === "/") return redirect(302, WEB_APP_URL);
    const match = /^\/([^/]+)(\/.*)?$/.exec(url.pathname);
    if (!match) return notFoundPage();
    slug = match[1] ?? "";
    if (match[2] === undefined) return redirect(301, `/${slug}/${url.search}`);
    base = `/${slug}`;
    rest = match[2];
  } else {
    slug = hostname.slice(0, hostname.length - sitesHost.length - 1).split(".")[0] ?? "";
    base = "";
    rest = url.pathname;
  }
  if (!SLUG_PATTERN.test(slug)) return notFoundPage();

  // Submissions are accepted for any site with a contact address, published or not.
  if (rest === "/contact") return handleContactSubmission(c.req.raw, c.env, slug, base);

  const [site] = await drizzle(c.env.DB)
    .select({ id: sites.id })
    .from(sites)
    .where(and(eq(sites.slug, slug), eq(sites.status, "published")))
    .limit(1);
  if (!site) return notFoundPage();

  let key: string;
  let cacheControl: string;
  let isPage = false;
  let pageLanguage: string | undefined;
  const languageMatch = /^\/([^/]+)(\/)?$/.exec(rest);
  const lang = languageMatch?.[1];
  const thanksMatch = /^(?:\/([^/]+))?\/thanks(\/)?$/.exec(rest);
  const thanksLang = thanksMatch?.[1];
  if (thanksMatch && (thanksLang === undefined || LANGUAGE_PATH_PATTERN.test(thanksLang))) {
    key = thanksLang === undefined ? publishedThanksKey(site.id) : publishedLanguageThanksKey(site.id, thanksLang);
    // The thank-you page is only ever reached through a form post; it must not be cached or indexed.
    cacheControl = "no-store";
    isPage = true;
    pageLanguage = thanksLang;
    if (thanksMatch[2] === undefined) {
      if (!(await c.env.PUBLISHED.head(key))) return notFoundPage();
      return redirect(301, `${base}${thanksLang === undefined ? "" : `/${thanksLang}`}/thanks/${url.search}`);
    }
  } else if (rest === "/") {
    key = publishedIndexKey(site.id);
    cacheControl = "public, max-age=60";
    isPage = true;
  } else if (lang !== undefined && LANGUAGE_PATH_PATTERN.test(lang)) {
    key = publishedLanguageIndexKey(site.id, lang);
    cacheControl = "public, max-age=60";
    isPage = true;
    pageLanguage = lang;
    if (languageMatch?.[2] === undefined) {
      // Only redirect to pages that exist, so unknown languages stay a plain 404.
      if (!(await c.env.PUBLISHED.head(key))) return notFoundPage();
      return redirect(301, `${base}/${lang}/${url.search}`);
    }
  } else if (rest.startsWith("/images/") && IMAGE_FILE_PATTERN.test(rest.slice("/images/".length))) {
    key = `${publishedImagePrefix(site.id)}${rest.slice("/images/".length)}`;
    cacheControl = "public, max-age=31536000, immutable";
  } else {
    return notFoundPage();
  }

  const object = await c.env.PUBLISHED.get(key, { onlyIf: c.req.raw.headers });
  if (!object) return notFoundPage();

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  if (isPage) {
    headers.set("Content-Type", "text/html; charset=utf-8");
    const contentLanguage = pageLanguage ?? object.customMetadata?.language;
    if (contentLanguage && LANGUAGE_TAG_PATTERN.test(contentLanguage)) headers.set("Content-Language", contentLanguage);
  }
  headers.set("ETag", object.httpEtag);
  headers.set("Cache-Control", cacheControl);
  headers.set("X-Content-Type-Options", "nosniff");

  // With `onlyIf`, R2 returns an object without a body when the precondition (If-None-Match) fails.
  if (!("body" in object)) return new Response(null, { status: 304, headers });
  return new Response(object.body, { headers });
});
