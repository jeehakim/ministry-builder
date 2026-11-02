import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { publishedImagePrefix, publishedIndexKey } from "./published";
import { domains, sites } from "./db/schema";
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

function methodNotAllowed(): Response {
  return new Response("Method not allowed", {
    status: 405,
    headers: { Allow: "GET, HEAD", "X-Content-Type-Options": "nosniff" },
  });
}

/** Streams one object of a published site: its index at "/" or an image under "/images/". */
async function serveSiteFile(c: Context<AppEnv>, siteId: string, rest: string): Promise<Response> {
  let key: string;
  let cacheControl: string;
  if (rest === "/") {
    key = publishedIndexKey(siteId);
    cacheControl = "public, max-age=60";
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
  if (rest === "/") headers.set("Content-Type", "text/html; charset=utf-8");
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
 */
async function serveCustomDomain(c: Context<AppEnv>, url: URL, hostname: string): Promise<Response | null> {
  const db = drizzle(c.env.DB);
  const [match] = await db
    .select({ siteId: domains.siteId, kind: domains.kind, slug: sites.slug, status: sites.status })
    .from(domains)
    .innerJoin(sites, eq(domains.siteId, sites.id))
    .where(eq(domains.hostname, hostname))
    .limit(1);
  if (!match) return null;

  if (c.req.method !== "GET" && c.req.method !== "HEAD") return methodNotAllowed();
  if (match.status !== "published") return notFoundPage();

  if (match.kind === "redirect") {
    const [primary] = await db
      .select({ hostname: domains.hostname })
      .from(domains)
      .where(and(eq(domains.siteId, match.siteId), eq(domains.kind, "primary")))
      .limit(1);
    const location = primary
      ? `https://${primary.hostname}${url.pathname}${url.search}`
      : `https://${c.env.PUBLIC_SITES_HOST}/${match.slug}/`;
    return redirect(301, location);
  }
  return serveSiteFile(c, match.siteId, url.pathname);
}

/**
 * Serves published sites from the PUBLISHED bucket (never from IMAGES). Runs before CORS and
 * auth: requests for the sites host and for customer domains never reach the API routes.
 *
 * Customer domain: bridgeworldfoundation.org/ and /images/<file>
 * Host form:       sites.shofar.io/<slug>/ and /<slug>/images/<file>
 * Subdomain form:  <slug>.sites.shofar.io/ and /images/<file>
 */
export const serveSites = createMiddleware<AppEnv>(async (c, next) => {
  const sitesHost = c.env.PUBLIC_SITES_HOST?.toLowerCase();
  const url = new URL(c.req.url);
  const hostname = url.hostname.toLowerCase();

  if (!sitesHost || !isSitesHost(hostname, sitesHost)) {
    // Anything that is not the API itself may be a customer domain; one indexed D1 read decides.
    if (hostname !== c.env.PUBLIC_API_HOST?.toLowerCase()) {
      const response = await serveCustomDomain(c, url, hostname);
      if (response) return response;
    }
    return next();
  }

  if (c.req.method !== "GET" && c.req.method !== "HEAD") return methodNotAllowed();

  let slug: string;
  let rest: string; // path below the site root, always starting with "/"
  if (hostname === sitesHost) {
    if (url.pathname === "/") return redirect(302, WEB_APP_URL);
    const match = /^\/([^/]+)(\/.*)?$/.exec(url.pathname);
    if (!match) return notFoundPage();
    slug = match[1] ?? "";
    if (match[2] === undefined) return redirect(301, `/${slug}/${url.search}`);
    rest = match[2];
  } else {
    slug = hostname.slice(0, hostname.length - sitesHost.length - 1).split(".")[0] ?? "";
    rest = url.pathname;
  }
  if (!SLUG_PATTERN.test(slug)) return notFoundPage();

  const [site] = await drizzle(c.env.DB)
    .select({ id: sites.id })
    .from(sites)
    .where(and(eq(sites.slug, slug), eq(sites.status, "published")))
    .limit(1);
  if (!site) return notFoundPage();
  return serveSiteFile(c, site.id, rest);
});
