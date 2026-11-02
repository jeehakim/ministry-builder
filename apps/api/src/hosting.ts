import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import {
  LANGUAGE_PATH_PATTERN,
  LANGUAGE_TAG_PATTERN,
  publishedImagePrefix,
  publishedIndexKey,
  publishedLanguageIndexKey,
  parseFormOrigins,
  publishedLanguageThanksKey,
  publishedRobotsKey,
  publishedSitemapKey,
  publishedThanksKey,
} from "./published";
import { handleContactSubmission } from "./contact";
import { domains, sites } from "./db/schema";
import { errorFields, logError, requestIdOf } from "./log";
import { isDomainActive } from "./routes/domains";
import { SLUG_PATTERN } from "./routes/sites";
import { hostedContentSecurityPolicy, withHostedHeaders } from "./security";
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

function methodNotAllowed(): Response {
  return new Response("Method not allowed", {
    status: 405,
    headers: { Allow: "GET, HEAD", "X-Content-Type-Options": "nosniff" },
  });
}

/**
 * Streams one object of a published site: its index at "/", a language page at "/<lang>/", a thank-you
 * page at "/thanks/" or "/<lang>/thanks/", "/robots.txt", "/sitemap.xml", or an image under "/images/". `base` is the URL prefix of the
 * site root ("" or "/<slug>"), used for the redirects that add a trailing slash.
 */
async function serveSiteFile(c: Context<AppEnv>, siteId: string, base: string, rest: string, search: string): Promise<Response> {
  let key: string;
  let cacheControl: string;
  let isPage = false;
  let textType: string | undefined;
  let pageLanguage: string | undefined;
  const languageMatch = /^\/([^/]+)(\/)?$/.exec(rest);
  const lang = languageMatch?.[1];
  const thanksMatch = /^(?:\/([^/]+))?\/thanks(\/)?$/.exec(rest);
  const thanksLang = thanksMatch?.[1];
  if (thanksMatch && (thanksLang === undefined || LANGUAGE_PATH_PATTERN.test(thanksLang))) {
    key = thanksLang === undefined ? publishedThanksKey(siteId) : publishedLanguageThanksKey(siteId, thanksLang);
    // The thank-you page is only ever reached through a form post; it must not be cached or indexed.
    cacheControl = "no-store";
    isPage = true;
    pageLanguage = thanksLang;
    if (thanksMatch[2] === undefined) {
      if (!(await c.env.PUBLISHED.head(key))) return notFoundPage();
      return redirect(301, `${base}${thanksLang === undefined ? "" : `/${thanksLang}`}/thanks/${search}`);
    }
  } else if (rest === "/") {
    key = publishedIndexKey(siteId);
    cacheControl = "public, max-age=60";
    isPage = true;
  } else if (lang !== undefined && LANGUAGE_PATH_PATTERN.test(lang)) {
    key = publishedLanguageIndexKey(siteId, lang);
    cacheControl = "public, max-age=60";
    isPage = true;
    pageLanguage = lang;
    if (languageMatch?.[2] === undefined) {
      // Only redirect to pages that exist, so unknown languages stay a plain 404.
      if (!(await c.env.PUBLISHED.head(key))) return notFoundPage();
      return redirect(301, `${base}/${lang}/${search}`);
    }
  } else if (rest === "/robots.txt" || rest === "/sitemap.xml") {
    key = rest === "/robots.txt" ? publishedRobotsKey(siteId) : publishedSitemapKey(siteId);
    cacheControl = "public, max-age=3600";
    textType = rest === "/robots.txt" ? "text/plain; charset=utf-8" : "application/xml; charset=utf-8";
  } else if (rest.startsWith("/images/") && IMAGE_FILE_PATTERN.test(rest.slice("/images/".length))) {
    key = `${publishedImagePrefix(siteId)}${rest.slice("/images/".length)}`;
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
  if (textType) headers.set("Content-Type", textType);
  if (isPage) {
    // A form endpoint the author chose on purpose (recorded at publish time) may receive the post.
    const formOrigins = parseFormOrigins(object.customMetadata?.formOrigins);
    if (formOrigins.length > 0) {
      headers.set("Content-Security-Policy", hostedContentSecurityPolicy(c.env.PUBLIC_SITES_HOST?.toLowerCase(), formOrigins));
    }
  }
  headers.set("ETag", object.httpEtag);
  headers.set("Cache-Control", cacheControl);
  headers.set("X-Content-Type-Options", "nosniff");

  // With `onlyIf`, R2 returns an object without a body when the precondition (If-None-Match) fails.
  if (!("body" in object)) return new Response(null, { status: 304, headers });
  return new Response(object.body, { headers });
}

/**
 * A customer domain attached through Cloudflare for SaaS. The primary domain serves the site at "/";
 * a redirect domain answers 301 to the primary (or to the site's sites-host address when there is none).
 * A domain row that is not yet active (ownership unproved, hostname pending or certificate not deployed)
 * answers 404 like an unknown site: nothing is served on a hostname nobody has proved they control.
 */
async function serveCustomDomain(c: Context<AppEnv>, url: URL, hostname: string): Promise<Response | null> {
  const db = drizzle(c.env.DB);
  const [match] = await db
    .select({
      siteId: domains.siteId,
      kind: domains.kind,
      ownershipVerifiedAt: domains.ownershipVerifiedAt,
      verifiedAt: domains.verifiedAt,
      sslStatus: domains.sslStatus,
      slug: sites.slug,
      status: sites.status,
    })
    .from(domains)
    .innerJoin(sites, eq(domains.siteId, sites.id))
    .where(eq(domains.hostname, hostname))
    .limit(1);
  if (!match) return null;
  if (!isDomainActive(match)) return notFoundPage();

  if (url.pathname === "/contact") {
    if (match.kind === "redirect") return redirect(301, await primaryLocation(c, match, url));
    // Submissions are accepted for any site with a contact address, published or not.
    return handleContactSubmission(c.req.raw, c.env, match.slug, "", requestIdOf(c));
  }
  if (c.req.method !== "GET" && c.req.method !== "HEAD") return methodNotAllowed();
  if (match.status !== "published") return notFoundPage();

  if (match.kind === "redirect") return redirect(301, await primaryLocation(c, match, url));
  return serveSiteFile(c, match.siteId, "", url.pathname, url.search);
}

/** Where a redirect domain sends a request: the live primary domain with the path kept, or the site's sites-host address. */
async function primaryLocation(c: Context<AppEnv>, site: { siteId: string; slug: string }, url: URL): Promise<string> {
  const [primary] = await drizzle(c.env.DB)
    .select({ hostname: domains.hostname, ownershipVerifiedAt: domains.ownershipVerifiedAt, verifiedAt: domains.verifiedAt, sslStatus: domains.sslStatus })
    .from(domains)
    .where(and(eq(domains.siteId, site.siteId), eq(domains.kind, "primary")))
    .limit(1);
  return primary && isDomainActive(primary) ? `https://${primary.hostname}${url.pathname}${url.search}` : `https://${c.env.PUBLIC_SITES_HOST}/${site.slug}/`;
}

/**
 * Serves published sites from the PUBLISHED bucket (never from IMAGES). Runs before CORS and
 * auth: requests for the sites host and for customer domains never reach the API routes.
 *
 * Customer domain: bridgeworldfoundation.org/, /<lang>/, /thanks/, /<lang>/thanks/ and /images/<file>
 * Host form:       sites.shofar.io/<slug>/, /<slug>/<lang>/, /<slug>/thanks/, /<slug>/<lang>/thanks/ and /<slug>/images/<file>
 * Subdomain form:  <slug>.sites.shofar.io/, /<lang>/, /thanks/, /<lang>/thanks/ and /images/<file>
 *
 * The one write: POST /<slug>/contact (custom domain and subdomain form: POST /contact) takes
 * contact-form submissions.
 */
export const serveSites = createMiddleware<AppEnv>(async (c, next) => {
  const sitesHost = c.env.PUBLIC_SITES_HOST?.toLowerCase();
  const url = new URL(c.req.url);
  let response: Response | null;
  try {
    response = await routeHostedRequest(c, url, sitesHost);
  } catch (err) {
    // A failure here belongs to a hosted request, so the error answer carries the hosted headers too.
    logError("hosting_error", requestIdOf(c), { method: c.req.method, host: url.hostname, ...errorFields(err) });
    response = Response.json({ error: "Internal server error" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
  if (response) return withHostedHeaders(response, url, sitesHost);
  return next();
});

/** The response for a request to the sites host or a customer domain, or null when the request is for the API itself. */
async function routeHostedRequest(c: Context<AppEnv>, url: URL, sitesHost: string | undefined): Promise<Response | null> {
  const hostname = url.hostname.toLowerCase();

  if (!sitesHost || !isSitesHost(hostname, sitesHost)) {
    // Anything that is not the API itself may be a customer domain; one indexed D1 read decides.
    if (hostname !== c.env.PUBLIC_API_HOST?.toLowerCase()) {
      const response = await serveCustomDomain(c, url, hostname);
      if (response) return response;
    }
    return null;
  }

  const isContactPath = hostname === sitesHost ? /^\/[^/]+\/contact$/.test(url.pathname) : url.pathname === "/contact";
  if (!isContactPath && c.req.method !== "GET" && c.req.method !== "HEAD") return methodNotAllowed();

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
  if (rest === "/contact") return handleContactSubmission(c.req.raw, c.env, slug, base, requestIdOf(c));

  const [site] = await drizzle(c.env.DB)
    .select({ id: sites.id })
    .from(sites)
    .where(and(eq(sites.slug, slug), eq(sites.status, "published")))
    .limit(1);
  if (!site) return notFoundPage();
  return serveSiteFile(c, site.id, base, rest, url.search);
}
