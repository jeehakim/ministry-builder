import { emptySiteDocument } from "@ministry/schema";
import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, describe, expect, it, vi } from "vitest";
import { domains } from "../src/db/schema";
import realApp from "../src/index";
import { externalFormOrigins, parseFormOrigins } from "../src/published";
import { hostedContentSecurityPolicy } from "../src/security";
import { call, insertActiveDomain, jsonInit, makeSite, uploadPng, verifyContactEmail, type TestSite } from "./helpers";

const HOST = "sites.shofar.io";
const API = "https://api.build.shofar.io";
const STAFF = { "X-Staff-Token": "test-staff-token" };

/** Requests go through the real app so the middleware order is the production one. */
function app(url: string, init?: RequestInit, bindings: object = env): Promise<Response> {
  return Promise.resolve(realApp.request(url, init, bindings));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("API response headers", () => {
  const COMMON = {
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-frame-options": "DENY",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
  };

  it("sets the security headers and HSTS on an HTTPS response", async () => {
    const res = await app(`${API}/health`);
    expect(res.status).toBe(200);
    for (const [name, value] of Object.entries(COMMON)) expect(res.headers.get(name), name).toBe(value);
    expect(res.headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains");
  });

  it("omits HSTS on plain HTTP", async () => {
    const res = await app("http://localhost:8787/health");
    for (const [name, value] of Object.entries(COMMON)) expect(res.headers.get(name), name).toBe(value);
    expect(res.headers.get("strict-transport-security")).toBeNull();
  });

  it("marks authenticated routes no-store, errors included, and leaves public assets cacheable", async () => {
    const ok = await app(`${API}/sites`, { headers: STAFF });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("no-store");
    expect(ok.headers.get("x-frame-options")).toBe("DENY");

    const unauthenticated = await app(`${API}/sites`);
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.headers.get("cache-control")).toBe("no-store");
    expect(unauthenticated.headers.get("x-content-type-options")).toBe("nosniff");

    const ai = await app(`${API}/ai/usage`);
    expect(ai.headers.get("cache-control")).toBe("no-store");
    const admin = await app(`${API}/admin/sites`);
    expect(admin.headers.get("cache-control")).toBe("no-store");

    const site = await makeSite("sec_assets", "Asset Headers");
    const image = await uploadPng("sec_assets", site.id);
    const asset = await app(`${API}/assets/${image.key}`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(asset.headers.get("x-content-type-options")).toBe("nosniff");
    expect(asset.headers.get("strict-transport-security")).toContain("max-age=31536000");
  });

  it("covers not-found answers, CORS preflights and handler errors", async () => {
    const missing = await app(`${API}/nope`);
    expect(missing.status).toBe(404);
    expect(missing.headers.get("x-frame-options")).toBe("DENY");

    const preflight = await app(`${API}/sites`, {
      method: "OPTIONS",
      headers: { Origin: "https://build.shofar.io", "Access-Control-Request-Method": "GET" },
    });
    expect(preflight.headers.get("access-control-allow-origin")).toBe("https://build.shofar.io");
    expect(preflight.headers.get("x-content-type-options")).toBe("nosniff");
    expect(preflight.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");

    vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = await app(`${API}/sites`, { headers: STAFF }, { ...env, DB: undefined });
    expect(broken.status).toBe(500);
    expect(await broken.json()).toEqual({ error: "Internal server error" });
    expect(broken.headers.get("x-frame-options")).toBe("DENY");
    expect(broken.headers.get("cache-control")).toBe("no-store");
  });
});

describe("error logging", () => {
  it("logs a structured line with the cf-ray as request_id and nothing from the request", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await app(
      `${API}/sites?token=query-secret`,
      { headers: { ...STAFF, Authorization: "Bearer jwt-secret-value", "cf-ray": "8a1b2c3d4e5f-SJC" } },
      { ...env, DB: undefined },
    );
    expect(res.status).toBe(500);
    expect(errorLog).toHaveBeenCalledTimes(1);
    const line = String(errorLog.mock.calls[0]?.[0]);
    const entry = JSON.parse(line) as Record<string, unknown>;
    expect(entry).toMatchObject({ event: "unhandled_error", request_id: "8a1b2c3d4e5f-SJC", method: "GET", path: "/sites" });
    for (const secret of ["test-staff-token", "jwt-secret-value", "query-secret"]) expect(line).not.toContain(secret);
  });

  it("falls back to a UUID request_id when there is no cf-ray header", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    await app(`${API}/sites`, { headers: STAFF }, { ...env, DB: undefined });
    const entry = JSON.parse(String(errorLog.mock.calls[0]?.[0])) as { request_id: string };
    expect(entry.request_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("never logs the visitor's message or address when contact email delivery fails", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ message: "bad address ada@example.com rejected" }, { status: 422 })));
    const site = await makeSite("sec_log", "Log Org");
    const doc = emptySiteDocument("Log Org");
    const contact = doc.sections.find((s) => s.type === "contact");
    if (contact?.type === "contact") contact.email = "owner@example.org";
    await call("sec_log", `/sites/${site.id}/document`, jsonInit("PUT", doc));
    await call("sec_log", `/sites/${site.id}/publish`, { method: "POST" });
    await verifyContactEmail(site.id, "owner@example.org");
    const res = await app(
      `https://${HOST}/${site.slug}/contact`,
      {
        method: "POST",
        redirect: "manual",
        headers: { "CF-Connecting-IP": "203.0.113.200", "cf-ray": "ray-contact-1" },
        body: new URLSearchParams({ name: "Ada Visitor", email: "ada@example.com", message: "A very private message" }),
      },
      { ...env, EMAIL_PROVIDER: "resend", RESEND_API_KEY: "re_secret_key_value_123456" },
    );
    vi.unstubAllGlobals();
    expect(res.status).toBe(303);
    const line = String(errorLog.mock.calls[0]?.[0]);
    expect(JSON.parse(line)).toMatchObject({ event: "contact_email_failed", request_id: "ray-contact-1", site_id: site.id });
    for (const secret of ["ada@example.com", "A very private message", "re_secret_key_value_123456", "Ada Visitor"]) {
      expect(line).not.toContain(secret);
    }
  });
});

async function publishedSite(user: string, orgName: string, languages: string[] = []): Promise<TestSite> {
  const site = await makeSite(user, orgName);
  const doc = emptySiteDocument(orgName);
  const contact = doc.sections.find((s) => s.type === "contact");
  if (contact?.type === "contact") contact.email = "owner@example.org";
  expect((await call(user, `/sites/${site.id}/document`, jsonInit("PUT", doc))).status).toBe(200);
  for (const language of languages) {
    expect((await call(user, `/sites/${site.id}/ai/translate`, jsonInit("POST", { language }))).status).toBe(200);
  }
  expect((await call(user, `/sites/${site.id}/publish`, { method: "POST" })).status).toBe(200);
  return site;
}

const HOSTED_CSP =
  "default-src 'none'; img-src 'self' data: https:; style-src 'unsafe-inline'; font-src 'self'; form-action 'self' https://sites.shofar.io; base-uri 'none'; frame-ancestors 'none'";

function expectHostedHeaders(res: Response, label: string): void {
  expect(res.headers.get("x-content-type-options"), label).toBe("nosniff");
  expect(res.headers.get("referrer-policy"), label).toBe("strict-origin-when-cross-origin");
  expect(res.headers.get("x-frame-options"), label).toBe("DENY");
  expect(res.headers.get("content-security-policy"), label).toBe(HOSTED_CSP);
  expect(res.headers.get("strict-transport-security"), label).toBe("max-age=31536000; includeSubDomains");
}

describe("hosted site headers", () => {
  it("puts the same headers on pages, images, thank-you and error pages, redirects and form answers", async () => {
    const site = await publishedSite("sec_host_a", "Header Org");
    const image = await uploadPng("sec_host_a", site.id);
    const file = image.key.slice(image.key.lastIndexOf("/") + 1);
    const doc = emptySiteDocument("Header Org");
    const hero = doc.sections.find((s) => s.type === "hero");
    if (hero?.type === "hero") hero.image = { src: `/assets/${image.key}`, alt: "" };
    const contact = doc.sections.find((s) => s.type === "contact");
    if (contact?.type === "contact") contact.email = "owner@example.org";
    await call("sec_host_a", `/sites/${site.id}/document`, jsonInit("PUT", doc));
    await call("sec_host_a", `/sites/${site.id}/publish`, { method: "POST" });

    const base = `https://${HOST}/${site.slug}`;
    const post = (fields: Record<string, string>) =>
      app(`${base}/contact`, { method: "POST", redirect: "manual", headers: { "CF-Connecting-IP": "203.0.113.201" }, body: new URLSearchParams(fields) });
    const responses: [string, Response][] = [
      ["page", await app(`${base}/`)],
      ["image", await app(`${base}/images/${file}`)],
      ["thanks", await app(`${base}/thanks/`)],
      ["robots", await app(`${base}/robots.txt`)],
      ["sitemap", await app(`${base}/sitemap.xml`)],
      ["missing page", await app(`${base}/nope/`)],
      ["unknown site", await app(`https://${HOST}/no-such-site/`)],
      ["slash redirect", await app(base, { redirect: "manual" })],
      ["root redirect", await app(`https://${HOST}/`, { redirect: "manual" })],
      ["method not allowed", await app(`${base}/`, { method: "DELETE" })],
      ["contact invalid", await post({ name: "", email: "x", message: "" })],
      ["contact ok", await post({ name: "Ada", email: "ada@example.com", message: "Hi" })],
      ["subdomain", await app(`https://${site.slug}.${HOST}/`)],
    ];
    const statuses = responses.map(([label, res]) => `${label}:${res.status}`);
    expect(statuses).toEqual([
      "page:200", "image:200", "thanks:200", "robots:200", "sitemap:200", "missing page:404", "unknown site:404",
      "slash redirect:301", "root redirect:302", "method not allowed:405", "contact invalid:400", "contact ok:303", "subdomain:200",
    ]);
    for (const [label, res] of responses) expectHostedHeaders(res, label);

    // The page is cacheable and the thank-you page is not; the headers did not disturb either.
    expect(responses[0]?.[1].headers.get("cache-control")).toBe("public, max-age=60");
    expect(responses[2]?.[1].headers.get("cache-control")).toBe("no-store");
  });

  it("gives a 304 the same headers, and none of the API-only ones", async () => {
    const site = await publishedSite("sec_host_b", "Conditional Org");
    const first = await app(`https://${HOST}/${site.slug}/`);
    const etag = first.headers.get("etag") ?? "";
    const second = await app(`https://${HOST}/${site.slug}/`, { headers: { "if-none-match": etag } });
    expect(second.status).toBe(304);
    expectHostedHeaders(second, "304");
    expect(second.headers.get("permissions-policy")).toBeNull();
  });

  it("skips HSTS over plain HTTP", async () => {
    const site = await publishedSite("sec_host_c", "Plain Http Org");
    const res = await app(`http://${HOST}/${site.slug}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("strict-transport-security")).toBeNull();
    expect(res.headers.get("content-security-policy")).toBe(HOSTED_CSP);
  });

  it("limits HSTS to the exact host on customer domains, which may have subdomains of their own", async () => {
    const site = await publishedSite("sec_host_d", "Customer Domain Org");
    await insertActiveDomain(site.id, "customer-sec.org");
    const res = await app("https://customer-sec.org/");
    expect(res.status).toBe(200);
    expect(res.headers.get("strict-transport-security")).toBe("max-age=31536000");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("content-security-policy")).toBe(HOSTED_CSP);
    const robots = await app("https://customer-sec.org/robots.txt");
    expect(robots.status).toBe(200);
    expect(robots.headers.get("content-security-policy")).toBe(HOSTED_CSP);
  });

  it("builds a CSP with no script-src, so scripts (inline ones too) fall under default-src 'none'", () => {
    const csp = hostedContentSecurityPolicy(HOST);
    expect(csp).toBe(HOSTED_CSP);
    expect(csp).not.toContain("script-src");
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toContain("unsafe-eval");
    expect(hostedContentSecurityPolicy(undefined)).toContain("form-action 'self';");
  });

  it("publishes pages that run no scripts, which is what the policy assumes", async () => {
    const site = await publishedSite("sec_host_e", "No Script Org", ["es"]);
    for (const path of ["", "es/", "thanks/", "es/thanks/"]) {
      const html = await (await app(`https://${HOST}/${site.slug}/${path}`)).text();
      expect(html.length, path).toBeGreaterThan(200);
      // Structured data is inert (type="application/ld+json" is never executed), anything else would be blocked.
      expect(html, path).not.toMatch(/<script(?![^>]*application\/ld\+json)/i);
      expect(html, path).not.toMatch(/\son[a-z]+\s*=/i);
      expect(html, path).not.toMatch(/javascript:/i);
      expect(html, path).not.toMatch(/<(?:iframe|object|embed)\b/i);
    }
  });

  it("lets the form post to a custom https form endpoint the author configured, and nowhere else", async () => {
    const site = await makeSite("sec_host_f", "Endpoint Org");
    const doc = emptySiteDocument("Endpoint Org");
    const contact = doc.sections.find((s) => s.type === "contact");
    if (contact?.type === "contact") contact.formEndpoint = "https://formspree.io/f/abc123?x=1";
    await call("sec_host_f", `/sites/${site.id}/document`, jsonInit("PUT", doc));
    expect((await call("sec_host_f", `/sites/${site.id}/publish`, { method: "POST" })).status).toBe(200);

    const page = await app(`https://${HOST}/${site.slug}/`);
    expect(page.headers.get("content-security-policy")).toBe(HOSTED_CSP.replace("https://sites.shofar.io;", "https://sites.shofar.io https://formspree.io;"));
    const thanks = await app(`https://${HOST}/${site.slug}/thanks/`);
    expect(thanks.headers.get("content-security-policy")).toBe(HOSTED_CSP);
  });

  it("accepts only well-formed https origins as form origins", () => {
    expect(parseFormOrigins("https://formspree.io https://api.web3forms.com:8443")).toEqual(["https://formspree.io", "https://api.web3forms.com:8443"]);
    expect(parseFormOrigins("https://x.com; script-src * http://x.com https://x.com/path 'unsafe-inline' https://UPPER.com")).toEqual([]);
    expect(parseFormOrigins(undefined)).toEqual([]);

    const doc = emptySiteDocument("Origins");
    const contact = doc.sections.find((s) => s.type === "contact");
    if (contact?.type !== "contact") throw new Error("starter document changed");
    for (const [endpoint, expected] of [
      ["http://plain.example.org/f", []],
      ["https://good.example.org/f/1", ["https://good.example.org"]],
      ["/relative/endpoint", []],
      ["not a url", []],
      ["https://user:pw@creds.example.org/f", ["https://creds.example.org"]],
    ] as const) {
      contact.formEndpoint = endpoint;
      expect(externalFormOrigins(doc), endpoint).toEqual(expected);
    }
  });
});

describe("robots.txt and sitemap.xml", () => {
  it("writes both next to index.html at publish time with absolute URLs", async () => {
    const site = await publishedSite("sec_seo_a", "Seo Org");
    const robots = await env.PUBLISHED.get(`published/${site.id}/robots.txt`);
    expect(robots?.httpMetadata?.contentType).toBe("text/plain; charset=utf-8");
    expect(await robots?.text()).toBe(`User-agent: *\nAllow: /\nSitemap: https://${HOST}/${site.slug}/sitemap.xml\n`);

    const sitemap = await env.PUBLISHED.get(`published/${site.id}/sitemap.xml`);
    expect(sitemap?.httpMetadata?.contentType).toBe("application/xml; charset=utf-8");
    const xml = await sitemap!.text();
    expect(xml).toBe(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <url>
    <loc>https://${HOST}/${site.slug}/</loc>
  </url>
</urlset>
`);
  });

  it("lists the primary page and every language page with hreflang alternates", async () => {
    const site = await publishedSite("sec_seo_b", "Multilingual Seo", ["es", "ko"]);
    const xml = await (await app(`https://${HOST}/${site.slug}/sitemap.xml`)).text();
    const root = `https://${HOST}/${site.slug}/`;
    expect([...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])).toEqual([root, `${root}es/`, `${root}ko/`]);
    const alternates = [
      `<xhtml:link rel="alternate" hreflang="en" href="${root}"/>`,
      `<xhtml:link rel="alternate" hreflang="es" href="${root}es/"/>`,
      `<xhtml:link rel="alternate" hreflang="ko" href="${root}ko/"/>`,
      `<xhtml:link rel="alternate" hreflang="x-default" href="${root}"/>`,
    ];
    // Every one of the three <url> entries carries all four alternates.
    for (const alternate of alternates) expect(xml.split(alternate)).toHaveLength(4);
    expect(xml).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"');
  });

  it("serves them on the path form, the subdomain form and a custom domain", async () => {
    const site = await publishedSite("sec_seo_c", "Served Seo", ["es"]);
    await insertActiveDomain(site.id, "served-seo.org");
    const sitemapUrl = `https://${HOST}/${site.slug}/sitemap.xml`;

    for (const origin of [`https://${HOST}/${site.slug}`, `https://${site.slug}.${HOST}`, "https://served-seo.org"]) {
      const robots = await app(`${origin}/robots.txt`);
      expect(robots.status, origin).toBe(200);
      expect(robots.headers.get("content-type")).toBe("text/plain; charset=utf-8");
      expect(robots.headers.get("cache-control")).toBe("public, max-age=3600");
      expect(await robots.text()).toBe(`User-agent: *\nAllow: /\nSitemap: ${sitemapUrl}\n`);

      const sitemap = await app(`${origin}/sitemap.xml`);
      expect(sitemap.status, origin).toBe(200);
      expect(sitemap.headers.get("content-type")).toBe("application/xml; charset=utf-8");
      expect(await sitemap.text()).toContain(`<loc>https://${HOST}/${site.slug}/es/</loc>`);
    }
    expect((await app(`https://${HOST}/${site.slug}/robots.txt`, { method: "POST" })).status).toBe(405);
  });

  it("answers 404 for an unpublished site, a draft and a nested path, and drops them on unpublish", async () => {
    const site = await publishedSite("sec_seo_d", "Gone Seo");
    expect((await app(`https://${HOST}/${site.slug}/en/robots.txt`)).status).toBe(404);
    expect((await app(`https://${HOST}/${site.slug}/robots.txt/`)).status).toBe(404);
    expect((await call("sec_seo_d", `/sites/${site.id}/unpublish`, { method: "POST" })).status).toBe(200);
    expect((await app(`https://${HOST}/${site.slug}/robots.txt`)).status).toBe(404);
    expect(await env.PUBLISHED.head(`published/${site.id}/robots.txt`)).toBeNull();
    expect(await env.PUBLISHED.head(`published/${site.id}/sitemap.xml`)).toBeNull();
    const draft = await makeSite("sec_seo_d", "Draft Seo");
    expect((await app(`https://${HOST}/${draft.slug}/sitemap.xml`)).status).toBe(404);
  });

  it("rewrites the language list when a language leaves the site", async () => {
    const site = await publishedSite("sec_seo_e", "Shrinking Seo", ["es"]);
    expect(await (await app(`https://${HOST}/${site.slug}/sitemap.xml`)).text()).toContain("/es/");
    const doc = emptySiteDocument("Shrinking Seo");
    await call("sec_seo_e", `/sites/${site.id}/document`, jsonInit("PUT", doc));
    await call("sec_seo_e", `/sites/${site.id}/publish`, { method: "POST" });
    const xml = await (await app(`https://${HOST}/${site.slug}/sitemap.xml`)).text();
    expect(xml).not.toContain("/es/");
    expect(xml).not.toContain("xhtml:link");
  });
});

describe("link safety at publish", () => {
  it("drops unsafe links from every language page, including ones that arrive through a translation overlay", async () => {
    const site = await makeSite("sec_links", "Links Org");
    const doc = emptySiteDocument("Links Org");
    doc.meta.languages = ["es"];
    const hero = doc.sections.find((s) => s.type === "hero");
    const give = doc.sections.find((s) => s.type === "give");
    const contact = doc.sections.find((s) => s.type === "contact");
    if (hero?.type !== "hero" || give?.type !== "give" || contact?.type !== "contact") throw new Error("starter document changed");
    hero.primaryCta = { label: "Open", href: "  JaVaScRiPt:alert(1)" };
    hero.secondaryCta = { label: "Jump", href: "#about" };
    give.links = [
      { label: "Bad data", href: "data:text/html,<b>x</b>" },
      { label: "Fine give", href: "https://give.example.org/now" },
    ];
    contact.email = "owner@example.org";
    contact.formEndpoint = "vbscript:msgbox(1)";
    doc.translations = {
      es: { meta: {}, sections: { [hero.id]: { primaryCta: { label: "Abrir", href: "javascript:alert(2)" }, secondaryCta: { label: "Saltar", href: "#about" } } } },
    };
    expect((await call("sec_links", `/sites/${site.id}/document`, jsonInit("PUT", doc))).status).toBe(200);
    expect((await call("sec_links", `/sites/${site.id}/publish`, { method: "POST" })).status).toBe(200);

    for (const path of ["index.html", "es/index.html"]) {
      const html = await (await env.PUBLISHED.get(`published/${site.id}/${path}`))!.text();
      expect(html, path).not.toMatch(/javascript:|vbscript:|data:text/i);
      expect(html, path).toContain('href="https://give.example.org/now"');
      expect(html, path).toContain('href="#about"');
    }
    const spanish = await (await env.PUBLISHED.get(`published/${site.id}/es/index.html`))!.text();
    expect(spanish).not.toContain("Abrir");
  });
});
