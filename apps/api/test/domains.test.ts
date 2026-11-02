import { emptySiteDocument } from "@ministry/schema";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { domains } from "../src/db/schema";
import realApp from "../src/index";
import { relativizeRootLinks } from "../src/published";
import { expireUnverifiedDomains, normalizeHostname, txtProvesOwnership, UNVERIFIED_TTL_MS } from "../src/routes/domains";
import { call, insertActiveDomain, jsonInit, makeSite, uploadPng } from "./helpers";

const SITES_HOST = "sites.shofar.io";
const CF = "https://api.cloudflare.com/client/v4/zones/zone-test";
const DOH = "https://cloudflare-dns.com/dns-query";

type DomainView = {
  id: string;
  hostname: string;
  kind: "primary" | "redirect";
  sslStatus: string;
  ownershipVerifiedAt: string | null;
  verifiedAt: string | null;
  active: boolean;
  txt: { type: string; name: string; value: string };
  dns: { type: string; name: string; target: string };
  expiresAt: string | null;
};

type Recorded = { method: string; url: string; headers: Headers; body: unknown };

/**
 * Stand-ins for the two services the domain routes call: the Cloudflare API (custom hostnames it was
 * asked to create, served back on GET with whatever status the test set) and the DNS-over-HTTPS resolver
 * (TXT records the test published). Every request is recorded so tests can assert on them.
 */
function stubNetwork() {
  const hostnames = new Map<string, { hostname: string; status: string; ssl: { status: string } }>();
  const txt = new Map<string, string[]>();
  const requests: Recorded[] = [];
  let failNext: { status: number; message: string } | null = null;
  let dnsDown = false;
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

    if (url.startsWith(DOH)) {
      if (dnsDown) return new Response("bad gateway", { status: 502 });
      const name = new URL(url).searchParams.get("name") ?? "";
      expect(request.headers.get("accept")).toBe("application/dns-json");
      const records = txt.get(name) ?? [];
      return Response.json({ Status: records.length ? 0 : 3, Answer: records.map((data) => ({ name, type: 16, TTL: 300, data })) });
    }

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
    cfRequests: () => requests.filter((r) => r.url.startsWith(CF)),
    failNext(status: number, message: string) {
      failNext = { status, message };
    },
    setDnsDown(down: boolean) {
      dnsDown = down;
    },
    /** Publishes TXT strings at a name, quoted the way the resolver prints them. */
    publishTxt(name: string, values: string[]) {
      txt.set(
        name,
        values.map((v) => `"${v}"`),
      );
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

type Stub = ReturnType<typeof stubNetwork>;
let net: Stub;

beforeEach(() => {
  net = stubNetwork();
  vi.stubGlobal("fetch", net.fetchStub);
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

async function addDomain(user: string, siteId: string, hostname: string, kind?: "primary" | "redirect", bindings: object = env) {
  const res = await call(user, `/sites/${siteId}/domains`, jsonInit("POST", kind ? { hostname, kind } : { hostname }), bindings);
  const body = (await res.json()) as { domain?: DomainView; error?: string };
  return { status: res.status, ...body };
}

async function refresh(user: string, siteId: string, domainId: string, bindings: object = env) {
  const res = await call(user, `/sites/${siteId}/domains/${domainId}/refresh`, { method: "POST" }, bindings);
  const body = (await res.json()) as { domain?: DomainView; txtFound?: boolean; error?: string };
  return { status: res.status, ...body };
}

/** Walks a freshly added domain through TXT proof, hostname creation and activation, as the owner would. */
async function goLive(user: string, siteId: string, domain: DomainView): Promise<DomainView> {
  net.publishTxt(domain.txt.name, [domain.txt.value]);
  const proved = await refresh(user, siteId, domain.id);
  expect(proved.status).toBe(200);
  net.activate(domain.hostname);
  const live = await refresh(user, siteId, domain.id);
  expect(live.domain?.active).toBe(true);
  return live.domain!;
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

describe("txtProvesOwnership", () => {
  it("matches the token bare or with its prefix, never an empty token", () => {
    expect(txtProvesOwnership(["ministry-verify=abc123"], "abc123")).toBe(true);
    expect(txtProvesOwnership(["v=spf1 -all", "abc123"], "abc123")).toBe(true);
    expect(txtProvesOwnership(["ministry-verify=other"], "abc123")).toBe(false);
    expect(txtProvesOwnership(["ministry-verify=abc123x"], "abc123")).toBe(false);
    expect(txtProvesOwnership([""], "")).toBe(false);
    expect(txtProvesOwnership([], "abc123")).toBe(false);
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
  it("records the domain with its TXT and CNAME instructions without touching Cloudflare", async () => {
    const site = await makeSite("dom_a", "Bridge World Foundation");
    const created = await addDomain("dom_a", site.id, "BridgeWorldFoundation.net");
    expect(created.status).toBe(201);
    expect(created.domain).toMatchObject({
      hostname: "bridgeworldfoundation.net",
      kind: "primary",
      sslStatus: "pending",
      ownershipVerifiedAt: null,
      verifiedAt: null,
      active: false,
      txt: { type: "TXT", name: "_ministry-verify.bridgeworldfoundation.net" },
      dns: { type: "CNAME", name: "bridgeworldfoundation.net", target: SITES_HOST },
    });
    expect(created.domain!.txt.value).toMatch(/^ministry-verify=[0-9a-f]{32}$/);
    expect(new Date(created.domain!.expiresAt!).getTime()).toBeGreaterThan(Date.now() + UNVERIFIED_TTL_MS - 60_000);
    // Nothing goes to Cloudflare until ownership is proved.
    expect(net.requests).toHaveLength(0);

    const list = (await (await call("dom_a", `/sites/${site.id}/domains`)).json()) as {
      domains: DomainView[];
      cnameTarget: string;
      enabled: boolean;
    };
    expect(list.enabled).toBe(true);
    expect(list.cnameTarget).toBe(SITES_HOST);
    expect(list.domains.map((d) => d.hostname)).toEqual(["bridgeworldfoundation.net"]);
    expect(list.domains[0]!.txt.value).toBe(created.domain!.txt.value);

    // Each domain gets its own token.
    const other = await addDomain("dom_a", site.id, "www.bridgeworldfoundation.net", "redirect");
    expect(other.domain!.txt.value).not.toBe(created.domain!.txt.value);
  });

  it("validates input, allows one primary per site and no hostname twice", async () => {
    const site = await makeSite("dom_b", "Validation Org");
    expect((await addDomain("dom_b", site.id, "not a domain")).status).toBe(400);
    expect((await addDomain("dom_b", site.id, "mine.sites.shofar.io")).status).toBe(400);
    expect((await call("dom_b", `/sites/${site.id}/domains`, jsonInit("POST", { hostname: "x.org", kind: "other" }))).status).toBe(400);

    expect((await addDomain("dom_b", site.id, "one.org")).status).toBe(201);
    expect((await addDomain("dom_b", site.id, "two.org")).status).toBe(409);
    expect((await addDomain("dom_b", site.id, "two.org", "redirect")).status).toBe(201);
    expect((await addDomain("dom_b", site.id, "one.org", "redirect")).status).toBe(409);

    const other = await makeSite("dom_c", "Other Org");
    expect((await addDomain("dom_c", other.id, "ONE.org")).status).toBe(409);
    expect(net.requests).toHaveLength(0);
  });

  it("caps domains per site and per user, with admins exempt from the user cap", async () => {
    const tight = { ...env, MAX_DOMAINS_PER_SITE: "2", MAX_DOMAINS_PER_USER: "3" };
    const a = await makeSite("dom_cap", "Cap Site A");
    const b = await makeSite("dom_cap", "Cap Site B");
    expect((await addDomain("dom_cap", a.id, "cap-a1.org", "primary", tight)).status).toBe(201);
    expect((await addDomain("dom_cap", a.id, "cap-a2.org", "redirect", tight)).status).toBe(201);
    const perSite = await addDomain("dom_cap", a.id, "cap-a3.org", "redirect", tight);
    expect(perSite.status).toBe(429);
    expect(perSite.error).toContain("2 domains");

    expect((await addDomain("dom_cap", b.id, "cap-b1.org", "primary", tight)).status).toBe(201);
    const perUser = await addDomain("dom_cap", b.id, "cap-b2.org", "redirect", tight);
    expect(perUser.status).toBe(429);
    expect(perUser.error).toContain("3 domains");

    // An admin acting on the same site is not subject to the per-user cap, but the per-site one still holds.
    expect((await addDomain("dom_admin:admin", b.id, "cap-b2.org", "redirect", tight)).status).toBe(201);
    expect((await addDomain("dom_admin:admin", b.id, "cap-b3.org", "redirect", tight)).status).toBe(429);
  });

  it("answers 503 when Cloudflare is not configured and 404 for other users", async () => {
    const site = await makeSite("dom_d", "Config Org");
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

describe("refresh: ownership proof, then Cloudflare", () => {
  it("creates the custom hostname only once the TXT record carries the token, then tracks its status", async () => {
    const site = await makeSite("dom_f", "Refresh Org");
    const created = await addDomain("dom_f", site.id, "refresh.org");
    const domain = created.domain!;

    // No record yet: nothing changes and Cloudflare is not called.
    let step = await refresh("dom_f", site.id, domain.id);
    expect(step.status).toBe(200);
    expect(step.txtFound).toBe(false);
    expect(step.domain).toMatchObject({ ownershipVerifiedAt: null, active: false });
    expect(net.requests.map((r) => r.url)).toEqual([`${DOH}?name=_ministry-verify.refresh.org&type=TXT`]);

    // Someone else's token, or the record on the wrong name, does not count.
    net.publishTxt("_ministry-verify.refresh.org", ["ministry-verify=ffffffffffffffffffffffffffffffff"]);
    net.publishTxt("refresh.org", [domain.txt.value]);
    step = await refresh("dom_f", site.id, domain.id);
    expect(step.txtFound).toBe(false);
    expect(net.cfRequests()).toHaveLength(0);

    // The right record: ownership is recorded and the hostname is created at Cloudflare in the same step.
    net.publishTxt("_ministry-verify.refresh.org", ["v=spf1 -all", domain.txt.value]);
    step = await refresh("dom_f", site.id, domain.id);
    expect(step.status).toBe(200);
    expect(step.txtFound).toBe(true);
    expect(step.domain).toMatchObject({ sslStatus: "pending_validation", verifiedAt: null, active: false });
    expect(step.domain!.ownershipVerifiedAt).not.toBeNull();
    const create = net.cfRequests()[0]!;
    expect(create.method).toBe("POST");
    expect(create.url).toBe(`${CF}/custom_hostnames`);
    expect(create.headers.get("authorization")).toBe("Bearer test-cf-token");
    expect(create.body).toEqual({ hostname: "refresh.org", ssl: { method: "http", type: "dv", settings: { min_tls_version: "1.2" } } });

    // Later refreshes read the status; no further DNS lookups are needed.
    const before = net.requests.length;
    step = await refresh("dom_f", site.id, domain.id);
    expect(step.domain).toMatchObject({ sslStatus: "pending_validation", active: false });
    expect(net.requests.slice(before).map((r) => r.method + " " + r.url)).toEqual([`GET ${CF}/custom_hostnames/cfh_1`]);

    net.activate("refresh.org");
    step = await refresh("dom_f", site.id, domain.id);
    expect(step.domain).toMatchObject({ sslStatus: "active", active: true });
    expect(step.domain!.verifiedAt).not.toBeNull();
    expect(step.domain!.expiresAt).toBeNull();

    const list = (await (await call("dom_f", `/sites/${site.id}/domains`)).json()) as { domains: DomainView[] };
    expect(list.domains[0]).toMatchObject({ active: true, verifiedAt: step.domain!.verifiedAt });

    expect((await refresh("dom_g", site.id, domain.id)).status).toBe(404);
    expect((await refresh("dom_f", site.id, "dom_missing")).status).toBe(404);
  });

  it("answers 502 when the resolver or Cloudflare fails, and retries the hostname creation next time", async () => {
    const site = await makeSite("dom_h", "Failure Org");
    const domain = (await addDomain("dom_h", site.id, "flaky.org")).domain!;

    net.setDnsDown(true);
    const dns = await refresh("dom_h", site.id, domain.id);
    expect(dns.status).toBe(502);
    expect(dns.error).toContain("DNS");
    net.setDnsDown(false);

    net.publishTxt(domain.txt.name, [domain.txt.value]);
    net.failNext(400, "Duplicate custom hostname found");
    const cf = await refresh("dom_h", site.id, domain.id);
    expect(cf.status).toBe(502);
    expect(cf.error).toContain("Duplicate custom hostname found");
    // Ownership stays proved, so the next refresh goes straight to Cloudflare again.
    expect(cf.domain!.ownershipVerifiedAt).not.toBeNull();
    const retry = await refresh("dom_h", site.id, domain.id);
    expect(retry.status).toBe(200);
    expect(net.cfRequests().map((r) => r.method)).toEqual(["POST", "POST"]);
    expect(net.hostnames.size).toBe(1);

    const unconfigured = { ...env, CLOUDFLARE_API_TOKEN: undefined };
    expect((await refresh("dom_h", site.id, domain.id, unconfigured)).status).toBe(503);
  });
});

describe("expiry of unverified domains", () => {
  it("forgets a domain whose ownership was not proved within a week, freeing the hostname", async () => {
    const squatter = await makeSite("dom_sq", "Squatter Org");
    const owner = await makeSite("dom_own", "Owner Org");
    const squatted = (await addDomain("dom_sq", squatter.id, "contested.org")).domain!;
    expect((await addDomain("dom_own", owner.id, "contested.org")).status).toBe(409);

    // A proved domain of the same age is kept.
    const kept = (await addDomain("dom_sq", squatter.id, "kept.org", "redirect")).domain!;
    net.publishTxt(kept.txt.name, [kept.txt.value]);
    await refresh("dom_sq", squatter.id, kept.id);

    const old = new Date(Date.now() - UNVERIFIED_TTL_MS - 60_000);
    await drizzle(env.DB).update(domains).set({ createdAt: old }).where(eq(domains.siteId, squatter.id));
    expect(await expireUnverifiedDomains(drizzle(env.DB), env)).toBe(1);
    expect(await expireUnverifiedDomains(drizzle(env.DB), env)).toBe(0);

    const list = (await (await call("dom_sq", `/sites/${squatter.id}/domains`)).json()) as { domains: DomainView[] };
    expect(list.domains.map((d) => d.hostname)).toEqual(["kept.org"]);
    expect((await refresh("dom_sq", squatter.id, squatted.id)).status).toBe(404);

    // The real owner can now claim it.
    expect((await addDomain("dom_own", owner.id, "contested.org")).status).toBe(201);
  });

  it("runs the cleanup on add as well, and removes a stale row's hostname at Cloudflare if it has one", async () => {
    const site = await makeSite("dom_sq2", "Stale Org");
    const stale = (await addDomain("dom_sq2", site.id, "stale.org")).domain!;
    const old = new Date(Date.now() - UNVERIFIED_TTL_MS - 60_000);
    await drizzle(env.DB).update(domains).set({ createdAt: old, cfCustomHostnameId: "cfh_legacy" }).where(eq(domains.id, stale.id));
    net.hostnames.set("cfh_legacy", { hostname: "stale.org", status: "pending", ssl: { status: "pending_validation" } });

    expect((await addDomain("dom_sq2", site.id, "fresh.org", "redirect")).status).toBe(201);
    expect(net.cfRequests().map((r) => `${r.method} ${r.url}`)).toEqual([`DELETE ${CF}/custom_hostnames/cfh_legacy`]);
    const list = (await (await call("dom_sq2", `/sites/${site.id}/domains`)).json()) as { domains: DomainView[] };
    expect(list.domains.map((d) => d.hostname)).toEqual(["fresh.org"]);
  });
});

describe("delete", () => {
  it("removes the custom hostname at Cloudflare and the row, keeping the row if Cloudflare fails", async () => {
    const site = await makeSite("dom_i", "Delete Org");
    const domain = await goLive("dom_i", site.id, (await addDomain("dom_i", site.id, "delete.org")).domain!);
    const id = domain.id;

    expect((await call("dom_j", `/sites/${site.id}/domains/${id}`, { method: "DELETE" })).status).toBe(404);

    net.failNext(500, "Internal error");
    expect((await call("dom_i", `/sites/${site.id}/domains/${id}`, { method: "DELETE" })).status).toBe(502);
    expect(((await (await call("dom_i", `/sites/${site.id}/domains`)).json()) as { domains: unknown[] }).domains).toHaveLength(1);

    expect((await call("dom_i", `/sites/${site.id}/domains/${id}`, { method: "DELETE" })).status).toBe(200);
    expect(net.cfRequests().at(-1)).toMatchObject({ method: "DELETE", url: `${CF}/custom_hostnames/cfh_1` });
    expect(net.hostnames.size).toBe(0);
    expect(((await (await call("dom_i", `/sites/${site.id}/domains`)).json()) as { domains: unknown[] }).domains).toHaveLength(0);
    expect((await call("dom_i", `/sites/${site.id}/domains/${id}`, { method: "DELETE" })).status).toBe(404);

    // The hostname is free again.
    expect((await addDomain("dom_i", site.id, "delete.org")).status).toBe(201);
  });

  it("deletes a domain that never reached Cloudflare without calling it, and treats a forgotten hostname as removed", async () => {
    const site = await makeSite("dom_k", "Gone Org");
    const pending = (await addDomain("dom_k", site.id, "pending.org")).domain!;
    expect((await call("dom_k", `/sites/${site.id}/domains/${pending.id}`, { method: "DELETE" })).status).toBe(200);
    expect(net.cfRequests()).toHaveLength(0);

    const live = await goLive("dom_k", site.id, (await addDomain("dom_k", site.id, "gone.org")).domain!);
    net.hostnames.clear();
    expect((await call("dom_k", `/sites/${site.id}/domains/${live.id}`, { method: "DELETE" })).status).toBe(200);
  });
});

describe("hosting on a custom domain", () => {
  it("serves nothing on a domain until it is active, at every step of the way", async () => {
    const { site } = await publishedSite("dom_gate", "Gated Org");
    const domain = (await addDomain("dom_gate", site.id, "gated.org")).domain!;
    const page = () => hosted("https://gated.org/");

    // Added, unproved.
    expect((await page()).status).toBe(404);
    expect((await hosted("https://gated.org/contact", { method: "POST", body: new URLSearchParams({ name: "A", email: "a@b.co", message: "x" }) })).status).toBe(404);

    // Ownership proved, hostname pending at Cloudflare.
    net.publishTxt(domain.txt.name, [domain.txt.value]);
    await refresh("dom_gate", site.id, domain.id);
    expect((await page()).status).toBe(404);

    // Cloudflare says active but the certificate is still being issued.
    for (const entry of net.hostnames.values()) entry.status = "active";
    await refresh("dom_gate", site.id, domain.id);
    expect((await page()).status).toBe(404);

    net.activate("gated.org");
    await refresh("dom_gate", site.id, domain.id);
    expect((await page()).status).toBe(200);

    // A redirect domain that is not itself active serves nothing either, and a redirect never targets an inactive primary.
    const redirect = (await addDomain("dom_gate", site.id, "gated.net", "redirect")).domain!;
    expect((await hosted("https://gated.net/")).status).toBe(404);
    await goLive("dom_gate", site.id, redirect);
    await drizzle(env.DB).update(domains).set({ sslStatus: "pending_deployment" }).where(eq(domains.id, domain.id));
    const res = await hosted("https://gated.net/", { redirect: "manual" });
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe(`https://${SITES_HOST}/${site.slug}/`);
  });

  it("serves the primary domain at / and redirects the redirect domain to it", async () => {
    const { site, file } = await publishedSite("dom_l", "Bridge World");
    await insertActiveDomain(site.id, "bridgeworldfoundation.org");
    await insertActiveDomain(site.id, "bridgeworld.foundation", "redirect");

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
    const { site } = await publishedSite("dom_m", "Lonely Redirect");
    await insertActiveDomain(site.id, "lonely.org", "redirect");
    const res = await hosted("https://lonely.org/anything", { redirect: "manual" });
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe(`https://${SITES_HOST}/${site.slug}/`);

    const draft = await makeSite("dom_m", "Draft Domain");
    await insertActiveDomain(draft.id, "draft.org");
    const page = await hosted("https://draft.org/");
    expect(page.status).toBe(404);
    expect(page.headers.get("content-type")).toBe("text/html; charset=utf-8");

    await call("dom_m", `/sites/${site.id}/unpublish`, { method: "POST" });
    expect((await hosted("https://lonely.org/")).status).toBe(404);
  });

  it("serves language pages at /<lang>/ on the custom domain with Content-Language", async () => {
    const site = await makeSite("dom_n", "Multilingual Domain");
    const doc = emptySiteDocument("Multilingual Domain");
    doc.meta.language = "ko";
    expect((await call("dom_n", `/sites/${site.id}/document`, jsonInit("PUT", doc))).status).toBe(200);
    expect((await call("dom_n", `/sites/${site.id}/ai/translate`, jsonInit("POST", { language: "en" }))).status).toBe(200);
    expect((await call("dom_n", `/sites/${site.id}/publish`, { method: "POST" })).status).toBe(200);
    await insertActiveDomain(site.id, "multilingual.org");

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
    const site = await makeSite("dom_o", "Contact Domain");
    const doc = emptySiteDocument("Contact Domain");
    const contact = doc.sections.find((s) => s.type === "contact");
    if (contact?.type === "contact") contact.email = "owner@example.org";
    expect((await call("dom_o", `/sites/${site.id}/document`, jsonInit("PUT", doc))).status).toBe(200);
    expect((await call("dom_o", `/sites/${site.id}/ai/translate`, jsonInit("POST", { language: "es" }))).status).toBe(200);
    expect((await call("dom_o", `/sites/${site.id}/publish`, { method: "POST" })).status).toBe(200);
    await insertActiveDomain(site.id, "contact-domain.org");
    await insertActiveDomain(site.id, "contact-domain.net", "redirect");

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
