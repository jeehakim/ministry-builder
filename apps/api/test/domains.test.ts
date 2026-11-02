import { emptySiteDocument } from "@ministry/schema";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import realApp from "../src/index";
import { relativizeRootLinks } from "../src/published";
import { normalizeHostname } from "../src/routes/domains";
import { call, jsonInit, makeSite, uploadPng } from "./helpers";

const SITES_HOST = "sites.shofar.io";
const CF = "https://api.cloudflare.com/client/v4/zones/zone-test";

type DomainView = {
  id: string;
  hostname: string;
  kind: "primary" | "redirect";
  sslStatus: string;
  verifiedAt: string | null;
  active: boolean;
  dns: { type: string; name: string; target: string };
};

type Recorded = { method: string; url: string; headers: Headers; body: unknown };

/**
 * A stand-in Cloudflare API: remembers the custom hostnames it was asked to create, serves them back
 * on GET with whatever status the test set, and records every request so tests can assert on them.
 */
function stubCloudflare() {
  const hostnames = new Map<string, { hostname: string; status: string; ssl: { status: string } }>();
  const requests: Recorded[] = [];
  let failNext: { status: number; message: string } | null = null;
  let counter = 0;

  const envelope = (status: number, result: unknown, errors: { message: string }[] = []) =>
    new Response(JSON.stringify({ success: status < 400, errors, result }), {
      status,
      headers: { "content-type": "application/json" },
    });

  const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = request.url;
    const body = request.method === "POST" ? await request.json() : null;
    requests.push({ method: request.method, url, headers: request.headers, body });
    if (!url.startsWith(`${CF}/custom_hostnames`)) return new Response("not stubbed", { status: 599 });
    if (failNext) {
      const fail = failNext;
      failNext = null;
      return envelope(fail.status, null, [{ message: fail.message }]);
    }
    if (request.method === "POST") {
      const id = `cfh_${++counter}`;
      const { hostname } = body as { hostname: string };
      hostnames.set(id, { hostname, status: "pending", ssl: { status: "pending_validation" } });
      return envelope(201, { id, ...hostnames.get(id) });
    }
    const id = url.slice(`${CF}/custom_hostnames/`.length);
    const known = hostnames.get(id);
    if (!known) return envelope(404, null, [{ message: "Custom hostname not found" }]);
    if (request.method === "DELETE") {
      hostnames.delete(id);
      return envelope(200, { id });
    }
    return envelope(200, { id, ...known });
  });

  return {
    fetchStub,
    requests,
    hostnames,
    failNext(status: number, message: string) {
      failNext = { status, message };
    },
    activate(hostname: string) {
      for (const entry of hostnames.values()) {
        if (entry.hostname === hostname) {
          entry.status = "active";
          entry.ssl.status = "active";
        }
      }
    },
  };
}

type Stub = ReturnType<typeof stubCloudflare>;
let cf: Stub;

beforeEach(() => {
  cf = stubCloudflare();
  vi.stubGlobal("fetch", cf.fetchStub);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function hosted(url: string, init?: RequestInit): Promise<Response> {
  return Promise.resolve(realApp.request(url, init, env));
}

async function publishedSite(user: string, orgName: string) {
  const site = await makeSite(user, orgName);
  const image = await uploadPng(user, site.id);
  const doc = emptySiteDocument(orgName);
  const hero = doc.sections.find((s) => s.type === "hero");
  if (hero?.type === "hero") hero.image = { src: `/assets/${image.key}`, alt: "Hero" };
  await call(user, `/sites/${site.id}/document`, jsonInit("PUT", doc));
  expect((await call(user, `/sites/${site.id}/publish`, { method: "POST" })).status).toBe(200);
  return { site, file: image.key.slice(image.key.lastIndexOf("/") + 1) };
}

async function addDomain(user: string, siteId: string, hostname: string, kind?: "primary" | "redirect") {
  const res = await call(user, `/sites/${siteId}/domains`, jsonInit("POST", kind ? { hostname, kind } : { hostname }));
  const body = (await res.json()) as { domain?: DomainView; error?: string };
  return { status: res.status, ...body };
}

describe("normalizeHostname", () => {
  it("accepts domain names and rejects anything else", () => {
    expect(normalizeHostname(" Https://BridgeWorldFoundation.org/ ")).toBe("bridgeworldfoundation.org");
    expect(normalizeHostname("www.bridgeworld.foundation.")).toBe("www.bridgeworld.foundation");
    for (const bad of ["", "localhost", "example", "1.2.3.4", "-bad.org", "a..b", "a b.org", "x".repeat(64) + ".org"]) {
      expect(normalizeHostname(bad), bad).toBeNull();
    }
    // The platform's own zones are never customer domains.
    for (const own of ["shofar.io", "sites.shofar.io", "foo.sites.shofar.io", "SHOFAR.AI"]) {
      expect(normalizeHostname(own), own).toBeNull();
    }
  });
});

describe("relativizeRootLinks", () => {
  it("turns root-relative href and src into document-relative links and leaves everything else", () => {
    const html = `<a href="/about">x</a><img src='/images/a.png'><a href="//cdn.example/x">y</a><a href="https://e.org/">z</a><a href="#top">t</a><img src="images/b.png">`;
    expect(relativizeRootLinks(html)).toBe(
      `<a href="about">x</a><img src='images/a.png'><a href="//cdn.example/x">y</a><a href="https://e.org/">z</a><a href="#top">t</a><img src="images/b.png">`,
    );
  });
});

describe("POST /sites/:id/domains", () => {
  it("creates a custom hostname at Cloudflare and returns the CNAME instructions", async () => {
    const site = await makeSite("dom_a", "Bridge World Foundation");
    const created = await addDomain("dom_a", site.id, "BridgeWorldFoundation.net");
    expect(created.status).toBe(201);
    expect(created.domain).toMatchObject({
      hostname: "bridgeworldfoundation.net",
      kind: "primary",
      sslStatus: "pending_validation",
      verifiedAt: null,
      active: false,
      dns: { type: "CNAME", name: "bridgeworldfoundation.net", target: SITES_HOST },
    });

    expect(cf.requests).toHaveLength(1);
    const req = cf.requests[0]!;
    expect(req.method).toBe("POST");
    expect(req.url).toBe(`${CF}/custom_hostnames`);
    expect(req.headers.get("authorization")).toBe("Bearer test-cf-token");
    expect(req.body).toEqual({
      hostname: "bridgeworldfoundation.net",
      ssl: { method: "http", type: "dv", settings: { min_tls_version: "1.2" } },
    });

    const list = (await (await call("dom_a", `/sites/${site.id}/domains`)).json()) as {
      domains: DomainView[];
      cnameTarget: string;
      enabled: boolean;
    };
    expect(list.enabled).toBe(true);
    expect(list.cnameTarget).toBe(SITES_HOST);
    expect(list.domains.map((d) => d.hostname)).toEqual(["bridgeworldfoundation.net"]);
  });

  it("validates input, allows one primary per site and no hostname twice", async () => {
    const site = await makeSite("dom_b", "Validation Org");
    expect((await addDomain("dom_b", site.id, "not a domain")).status).toBe(400);
    expect((await addDomain("dom_b", site.id, "mine.sites.shofar.io")).status).toBe(400);
    expect((await call("dom_b", `/sites/${site.id}/domains`, jsonInit("POST", { hostname: "x.org", kind: "other" }))).status).toBe(400);
    expect(cf.requests).toHaveLength(0);

    expect((await addDomain("dom_b", site.id, "one.org")).status).toBe(201);
    expect((await addDomain("dom_b", site.id, "two.org")).status).toBe(409);
    expect((await addDomain("dom_b", site.id, "two.org", "redirect")).status).toBe(201);
    expect((await addDomain("dom_b", site.id, "one.org", "redirect")).status).toBe(409);

    const other = await makeSite("dom_c", "Other Org");
    expect((await addDomain("dom_c", other.id, "ONE.org")).status).toBe(409);
    // Rejections never reach Cloudflare.
    expect(cf.requests.filter((r) => r.method === "POST")).toHaveLength(2);
  });

  it("answers 502 when Cloudflare fails, 503 when it is not configured, 404 for other users", async () => {
    const site = await makeSite("dom_d", "Failure Org");
    cf.failNext(400, "Duplicate custom hostname found");
    const failed = await addDomain("dom_d", site.id, "dup.org");
    expect(failed.status).toBe(502);
    expect(failed.error).toContain("Duplicate custom hostname found");
    expect((await (await call("dom_d", `/sites/${site.id}/domains`)).json()) as { domains: unknown[] }).toMatchObject({ domains: [] });

    const unconfigured = { ...env, CLOUDFLARE_API_TOKEN: undefined };
    const res = await call("dom_d", `/sites/${site.id}/domains`, jsonInit("POST", { hostname: "x.org" }), unconfigured);
    expect(res.status).toBe(503);
    const list = (await (await call("dom_d", `/sites/${site.id}/domains`, {}, unconfigured)).json()) as { enabled: boolean };
    expect(list.enabled).toBe(false);

    expect((await addDomain("dom_e", site.id, "x.org")).status).toBe(404);
    expect((await call("dom_e", `/sites/${site.id}/domains`)).status).toBe(404);
    expect((await call(null, `/sites/${site.id}/domains`)).status).toBe(401);
  });
});

describe("refresh and delete", () => {
  it("stores the status Cloudflare reports and marks the domain active once verified", async () => {
    const site = await makeSite("dom_f", "Refresh Org");
    const created = await addDomain("dom_f", site.id, "refresh.org");
    const id = created.domain!.id;

    let refreshed = (await (await call("dom_f", `/sites/${site.id}/domains/${id}/refresh`, { method: "POST" })).json()) as {
      domain: DomainView;
    };
    expect(refreshed.domain).toMatchObject({ sslStatus: "pending_validation", verifiedAt: null, active: false });

    cf.activate("refresh.org");
    refreshed = (await (await call("dom_f", `/sites/${site.id}/domains/${id}/refresh`, { method: "POST" })).json()) as {
      domain: DomainView;
    };
    expect(refreshed.domain).toMatchObject({ sslStatus: "active", active: true });
    expect(refreshed.domain.verifiedAt).not.toBeNull();
    expect(cf.requests.at(-1)).toMatchObject({ method: "GET", url: `${CF}/custom_hostnames/cfh_1` });

    const list = (await (await call("dom_f", `/sites/${site.id}/domains`)).json()) as { domains: DomainView[] };
    expect(list.domains[0]).toMatchObject({ active: true, verifiedAt: refreshed.domain.verifiedAt });

    expect((await call("dom_g", `/sites/${site.id}/domains/${id}/refresh`, { method: "POST" })).status).toBe(404);
    expect((await call("dom_f", `/sites/${site.id}/domains/dom_missing/refresh`, { method: "POST" })).status).toBe(404);
  });

  it("removes the custom hostname at Cloudflare and the row, keeping the row if Cloudflare fails", async () => {
    const site = await makeSite("dom_h", "Delete Org");
    const created = await addDomain("dom_h", site.id, "delete.org");
    const id = created.domain!.id;

    expect((await call("dom_i", `/sites/${site.id}/domains/${id}`, { method: "DELETE" })).status).toBe(404);

    cf.failNext(500, "Internal error");
    expect((await call("dom_h", `/sites/${site.id}/domains/${id}`, { method: "DELETE" })).status).toBe(502);
    expect(((await (await call("dom_h", `/sites/${site.id}/domains`)).json()) as { domains: unknown[] }).domains).toHaveLength(1);

    expect((await call("dom_h", `/sites/${site.id}/domains/${id}`, { method: "DELETE" })).status).toBe(200);
    expect(cf.requests.at(-1)).toMatchObject({ method: "DELETE", url: `${CF}/custom_hostnames/cfh_1` });
    expect(cf.hostnames.size).toBe(0);
    expect(((await (await call("dom_h", `/sites/${site.id}/domains`)).json()) as { domains: unknown[] }).domains).toHaveLength(0);
    expect((await call("dom_h", `/sites/${site.id}/domains/${id}`, { method: "DELETE" })).status).toBe(404);

    // The hostname is free again.
    expect((await addDomain("dom_h", site.id, "delete.org")).status).toBe(201);
  });

  it("treats a hostname Cloudflare already forgot as removed", async () => {
    const site = await makeSite("dom_j", "Gone Org");
    const created = await addDomain("dom_j", site.id, "gone.org");
    cf.hostnames.clear();
    expect((await call("dom_j", `/sites/${site.id}/domains/${created.domain!.id}`, { method: "DELETE" })).status).toBe(200);
  });
});

describe("hosting on a custom domain", () => {
  it("serves the primary domain at / and redirects the redirect domain to it", async () => {
    const { site, file } = await publishedSite("dom_k", "Bridge World");
    await addDomain("dom_k", site.id, "bridgeworldfoundation.org");
    await addDomain("dom_k", site.id, "bridgeworld.foundation", "redirect");

    const page = await hosted("https://bridgeworldfoundation.org/");
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(page.headers.get("cache-control")).toBe("public, max-age=60");
    const html = await page.text();
    expect(html).toContain("Bridge World");
    expect(html).toContain(`images/${file}`);
    expect(html).not.toMatch(/(href|src)=["']\/(?!\/)/);

    const image = await hosted(`https://bridgeworldfoundation.org/images/${file}`);
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toBe("image/png");

    expect((await hosted("https://BridgeWorldFoundation.org/other")).status).toBe(404);
    expect((await hosted("https://bridgeworldfoundation.org/", { method: "POST" })).status).toBe(405);

    for (const [from, to] of [
      ["https://bridgeworld.foundation/", "https://bridgeworldfoundation.org/"],
      ["https://bridgeworld.foundation/images/x.png?v=1", "https://bridgeworldfoundation.org/images/x.png?v=1"],
    ]) {
      const res = await hosted(from!, { redirect: "manual" });
      expect(res.status, from).toBe(301);
      expect(res.headers.get("location"), from).toBe(to);
    }

    // The sites host keeps working alongside the custom domain.
    expect((await hosted(`https://${SITES_HOST}/${site.slug}/`)).status).toBe(200);
    expect((await hosted(`https://${site.slug}.${SITES_HOST}/`)).status).toBe(200);
  });

  it("sends a redirect domain to the sites host while there is no primary, and 404s unpublished sites", async () => {
    const { site } = await publishedSite("dom_l", "Lonely Redirect");
    await addDomain("dom_l", site.id, "lonely.org", "redirect");
    const res = await hosted("https://lonely.org/anything", { redirect: "manual" });
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe(`https://${SITES_HOST}/${site.slug}/`);

    const draft = await makeSite("dom_l", "Draft Domain");
    await addDomain("dom_l", draft.id, "draft.org");
    const page = await hosted("https://draft.org/");
    expect(page.status).toBe(404);
    expect(page.headers.get("content-type")).toBe("text/html; charset=utf-8");

    await call("dom_l", `/sites/${site.id}/unpublish`, { method: "POST" });
    expect((await hosted("https://lonely.org/")).status).toBe(404);
  });

  it("serves language pages at /<lang>/ on the custom domain with Content-Language", async () => {
    const site = await makeSite("dom_m", "Multilingual Domain");
    const doc = emptySiteDocument("Multilingual Domain");
    doc.meta.language = "ko";
    expect((await call("dom_m", `/sites/${site.id}/document`, jsonInit("PUT", doc))).status).toBe(200);
    expect((await call("dom_m", `/sites/${site.id}/ai/translate`, jsonInit("POST", { language: "en" }))).status).toBe(200);
    expect((await call("dom_m", `/sites/${site.id}/publish`, { method: "POST" })).status).toBe(200);
    await addDomain("dom_m", site.id, "multilingual.org");

    const primary = await hosted("https://multilingual.org/");
    expect(primary.status).toBe(200);
    expect(primary.headers.get("content-language")).toBe("ko");
    expect(await primary.text()).toContain(`hreflang="en" href="https://sites.shofar.io/${site.slug}/en/"`);
    expect(await (await hosted("https://multilingual.org/")).text()).toContain('href="en/"');

    const english = await hosted("https://multilingual.org/en/");
    expect(english.status).toBe(200);
    expect(english.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(english.headers.get("content-language")).toBe("en");
    expect(await english.text()).toContain(`hreflang="ko" href="https://sites.shofar.io/${site.slug}/"`);

    const redirected = await hosted("https://multilingual.org/en?ref=x", { redirect: "manual" });
    expect(redirected.status).toBe(301);
    expect(redirected.headers.get("location")).toBe("/en/?ref=x");
    expect((await hosted("https://multilingual.org/fr/")).status).toBe(404);
    expect((await hosted("https://multilingual.org/en/index.html")).status).toBe(404);
  });

  it("takes contact-form posts at /contact and serves the thank-you pages on the custom domain", async () => {
    const site = await makeSite("dom_n", "Contact Domain");
    const doc = emptySiteDocument("Contact Domain");
    const contact = doc.sections.find((s) => s.type === "contact");
    if (contact?.type === "contact") contact.email = "owner@example.org";
    expect((await call("dom_n", `/sites/${site.id}/document`, jsonInit("PUT", doc))).status).toBe(200);
    expect((await call("dom_n", `/sites/${site.id}/ai/translate`, jsonInit("POST", { language: "es" }))).status).toBe(200);
    expect((await call("dom_n", `/sites/${site.id}/publish`, { method: "POST" })).status).toBe(200);
    await addDomain("dom_n", site.id, "contact-domain.org");
    await addDomain("dom_n", site.id, "contact-domain.net", "redirect");

    // The published form posts to /contact relative to the page it is on.
    const page = await (await hosted("https://contact-domain.org/")).text();
    expect(page).toMatch(/action="contact"/);
    expect(await (await hosted("https://contact-domain.org/es/")).text()).toMatch(/action="\.\.\/contact"/);

    const post = (fields: Record<string, string>, ip: string) =>
      hosted("https://contact-domain.org/contact", {
        method: "POST",
        redirect: "manual",
        headers: { "CF-Connecting-IP": ip, "User-Agent": "domain-test" },
        body: new URLSearchParams(fields),
      });
    const primary = await post({ name: "Ada", email: "ada@example.com", message: "Hello" }, "198.51.100.1");
    expect(primary.status).toBe(303);
    expect(primary.headers.get("location")).toBe("/thanks/");
    const spanish = await post({ name: "Ada", email: "ada@example.com", message: "Hola", _lang: "es" }, "198.51.100.2");
    expect(spanish.status).toBe(303);
    expect(spanish.headers.get("location")).toBe("/es/thanks/");

    const thanks = await hosted("https://contact-domain.org/thanks/");
    expect(thanks.status).toBe(200);
    expect(thanks.headers.get("cache-control")).toBe("no-store");
    expect(thanks.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const spanishThanks = await hosted("https://contact-domain.org/es/thanks/");
    expect(spanishThanks.status).toBe(200);
    expect(spanishThanks.headers.get("content-language")).toBe("es");
    const slashless = await hosted("https://contact-domain.org/es/thanks", { redirect: "manual" });
    expect(slashless.status).toBe(301);
    expect(slashless.headers.get("location")).toBe("/es/thanks/");

    // Other writes are still refused, and a redirect domain sends the form to the main domain.
    expect((await hosted("https://contact-domain.org/", { method: "POST" })).status).toBe(405);
    const viaRedirect = await hosted("https://contact-domain.net/contact", { method: "POST", redirect: "manual" });
    expect(viaRedirect.status).toBe(301);
    expect(viaRedirect.headers.get("location")).toBe("https://contact-domain.org/contact");
  });

  it("lets unknown hosts and the API host fall through to the API", async () => {
    expect((await hosted("https://api.build.shofar.io/health")).status).toBe(200);
    expect((await hosted("https://nobody.example/health")).status).toBe(200);
    expect((await hosted("https://nobody.example/nothing")).status).toBe(404);
    expect((await hosted("https://nobody.example/nothing")).headers.get("content-type")).toContain("application/json");
  });
});
