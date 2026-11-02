import { createMiddleware } from "hono/factory";
import { requestIdFor } from "./log";
import type { AppEnv } from "./types";

const HSTS_MAX_AGE = "max-age=31536000";

/** Routes that need a signed-in user; their JSON must never be stored by a browser or an intermediary. */
const AUTHENTICATED_PATH = /^\/(?:sites|ai|admin|orgs)(?:\/|$)/;

/** Gives every request an id (the Cloudflare ray id, else a UUID) that error logs carry. */
export const requestContext = createMiddleware<AppEnv>(async (c, next) => {
  c.set("requestId", requestIdFor(c.req.raw));
  await next();
});

/** Headers for the JSON API (everything the hosting handler did not answer). */
export const apiSecurityHeaders = createMiddleware<AppEnv>(async (c, next) => {
  await next();
  const headers = c.res.headers;
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  const url = new URL(c.req.url);
  if (url.protocol === "https:") headers.set("Strict-Transport-Security", `${HSTS_MAX_AGE}; includeSubDomains`);
  if (AUTHENTICATED_PATH.test(url.pathname)) headers.set("Cache-Control", "no-store");
});

/**
 * Policy for published pages. They are static: no scripts (so `script-src` is absent and falls back to
 * `default-src 'none'`, which blocks inline scripts too), inline CSS from the templates, images from the
 * site, data: URIs and any https host, and system fonts only. The contact form posts to the site itself;
 * `extraFormOrigins` adds the https origin of a form endpoint the author configured on purpose.
 */
export function hostedContentSecurityPolicy(sitesHost: string | undefined, extraFormOrigins: readonly string[] = []): string {
  const formAction = ["'self'", ...(sitesHost ? [`https://${sitesHost}`] : []), ...extraFormOrigins].join(" ");
  return [
    "default-src 'none'",
    "img-src 'self' data: https:",
    "style-src 'unsafe-inline'",
    "font-src 'self'",
    `form-action ${formAction}`,
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/**
 * Applies the hosted-site headers to a response built by the hosting handler. HSTS covers subdomains only
 * on the platform's own hosts: a customer's apex domain may have subdomains that are not ours to force onto HTTPS.
 * A Content-Security-Policy the handler already set (pages with a custom form endpoint) is kept.
 */
export function withHostedHeaders(response: Response, url: URL, sitesHost: string | undefined): Response {
  const headers = response.headers;
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("X-Frame-Options", "DENY");
  if (!headers.has("Content-Security-Policy")) headers.set("Content-Security-Policy", hostedContentSecurityPolicy(sitesHost));
  if (url.protocol === "https:") {
    const hostname = url.hostname.toLowerCase();
    const own = sitesHost !== undefined && (hostname === sitesHost || hostname.endsWith(`.${sitesHost}`));
    headers.set("Strict-Transport-Security", own ? `${HSTS_MAX_AGE}; includeSubDomains` : HSTS_MAX_AGE);
  }
  return response;
}
