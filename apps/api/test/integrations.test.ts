import { emptySiteDocument, IntegrationsResponse } from "@ministry/schema";
import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, describe, expect, it, vi } from "vitest";
import { decryptSecret } from "../src/crypto";
import { formSubmissions, integrationEvents, orgIntegrations } from "../src/db/schema";
import realApp from "../src/index";
import { MAX_KEY_ATTEMPTS_PER_HOUR, MAX_TEST_EMAILS_PER_HOUR } from "../src/routes/integrations";
import { call, jsonInit, makeSite, verifyContactEmail, type TestSite } from "./helpers";

const db = () => drizzle(env.DB);
const KEY = "re_Abc12345_SecretValueK4Q2";
const OTHER_KEY = "re_Zzz98765_AnotherSecretWxyz";

afterEach(() => {
  vi.unstubAllGlobals();
});

type ResendState = {
  domains: { name: string; status: string }[];
  /** Status Resend answers GET /domains with. */
  domainsStatus: number;
  /** Status and body of POST /emails. */
  sendStatus: number;
  sendBody: unknown;
  /** Set to make every request fail at the network level. */
  networkError: boolean;
};

/** Stubs api.resend.com. Mutate `state` mid-test to change what Resend answers next. */
function stubResend(overrides: Partial<ResendState> = {}) {
  const state: ResendState = {
    domains: [
      { name: "grace.org", status: "verified" },
      { name: "pending.org", status: "not_started" },
      { name: "Other.Example", status: "verified" },
    ],
    domainsStatus: 200,
    sendStatus: 200,
    sendBody: { id: "email_1" },
    networkError: false,
    ...overrides,
  };
  const fn = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
    if (state.networkError) throw new TypeError("fetch failed");
    const url = String(input);
    if (url === "https://api.resend.com/domains") {
      return state.domainsStatus === 200
        ? Response.json({ object: "list", has_more: false, data: state.domains })
        : Response.json({ message: "API key is invalid" }, { status: state.domainsStatus });
    }
    if (url === "https://api.resend.com/emails") return Response.json(state.sendBody, { status: state.sendStatus });
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fn);
  const calls = (url: string) =>
    fn.mock.calls
      .map(([input, init]) => ({ url: String(input), init: init as RequestInit }))
      .filter((c) => c.url === url);
  return { state, fn, calls, bearer: (init: RequestInit) => new Headers(init.headers).get("authorization") };
}

const base = (orgId: string) => `/orgs/${orgId}/integrations`;
const putKey = (user: string, orgId: string, apiKey: string = KEY, bindings?: object) =>
  call(user, `${base(orgId)}/resend/key`, jsonInit("PUT", { apiKey }), bindings);
const putFrom = (user: string, orgId: string, body: unknown) => call(user, `${base(orgId)}/resend/from`, jsonInit("PUT", body));
const postTest = (user: string, orgId: string, to = "me@example.com") => call(user, `${base(orgId)}/resend/test`, jsonInit("POST", { to }));
const getIntegrations = (user: string, orgId: string, bindings?: object) => call(user, base(orgId), {}, bindings);

async function rowFor(orgId: string) {
  const [row] = await db().select().from(orgIntegrations).where(eq(orgIntegrations.orgId, orgId));
  return row;
}

/** Every row of every table, as one string: used to prove a secret is stored nowhere in plaintext. */
async function dumpDatabase(): Promise<string> {
  const tables = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all<{ name: string }>();
  const parts: string[] = [];
  // Skip SQLite's and the platform's own bookkeeping tables, which D1 does not let queries read.
  for (const { name } of tables.results.filter((t) => !t.name.startsWith("_cf_") && !t.name.startsWith("sqlite_"))) parts.push(JSON.stringify((await env.DB.prepare(`SELECT * FROM "${name}"`).all()).results));
  return parts.join("\n");
}

/** A site (and so an organization) with a key stored and, optionally, a from address. */
async function configured(user: string, orgName: string, from?: { fromAddress: string; fromName?: string }): Promise<TestSite> {
  const site = await makeSite(user, orgName);
  expect((await putKey(user, site.orgId)).status).toBe(200);
  if (from) expect((await putFrom(user, site.orgId, from)).status).toBe(200);
  return site;
}

describe("GET /orgs/:id/integrations", () => {
  it("reports an empty integration with the contract shape and no-store", async () => {
    stubResend();
    const site = await makeSite("int_get", "Int Get");
    const res = await getIntegrations("int_get", site.orgId);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = IntegrationsResponse.parse(await res.json());
    expect(body).toEqual({ encryptionAvailable: true, activeSender: "none", resend: null });
  });

  it("names the platform sender as active when one is configured", async () => {
    const site = await makeSite("int_get2", "Int Get Platform");
    const platform = { ...env, EMAIL_PROVIDER: "resend", RESEND_API_KEY: "re_platform_key_123456" };
    const body = IntegrationsResponse.parse(await (await getIntegrations("int_get2", site.orgId, platform)).json());
    expect(body.activeSender).toBe("platform");
  });

  it("reports encryptionAvailable false without INTEGRATIONS_KEY, and every write route answers 503", async () => {
    const fetchStub = stubResend();
    const site = await makeSite("int_off", "Int Off");
    const off = { ...env, INTEGRATIONS_KEY: undefined };
    const body = IntegrationsResponse.parse(await (await getIntegrations("int_off", site.orgId, off)).json());
    expect(body.encryptionAvailable).toBe(false);

    const put = (path: string, payload: unknown, method = "PUT") => call("int_off", `${base(site.orgId)}/resend/${path}`, jsonInit(method, payload), off);
    const attempts = [
      await put("key", { apiKey: KEY }),
      await put("from", { fromAddress: "hi@grace.org" }),
      await put("test", { to: "me@example.com" }, "POST"),
    ];
    for (const res of attempts) {
      expect(res.status).toBe(503);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.json()).toEqual({ error: "Integrations are not enabled on this server" });
    }
    expect(fetchStub.fn).not.toHaveBeenCalled();
    expect(await rowFor(site.orgId)).toBeUndefined();

    // A malformed server key counts as absent.
    const malformed = { ...env, INTEGRATIONS_KEY: "short" };
    expect((await putKey("int_off", site.orgId, KEY, malformed)).status).toBe(503);
  });

  it("still lets an owner remove a stored integration when the server key is gone", async () => {
    stubResend();
    const site = await configured("int_off2", "Int Off Delete");
    const off = { ...env, INTEGRATIONS_KEY: undefined };
    const res = await call("int_off2", `${base(site.orgId)}/resend`, { method: "DELETE" }, off);
    expect(res.status).toBe(200);
    expect(await rowFor(site.orgId)).toBeUndefined();
  });
});

describe("access", () => {
  it("answers 404 to everyone but the owner and admins, and 401 without a user", async () => {
    stubResend();
    const site = await configured("int_own", "Int Owner", { fromAddress: "hi@grace.org" });
    const routes: [string, string, unknown][] = [
      ["GET", base(site.orgId), undefined],
      ["PUT", `${base(site.orgId)}/resend/key`, { apiKey: OTHER_KEY }],
      ["PUT", `${base(site.orgId)}/resend/from`, { fromAddress: "x@grace.org" }],
      ["POST", `${base(site.orgId)}/resend/test`, { to: "me@example.com" }],
      ["DELETE", `${base(site.orgId)}/resend`, undefined],
    ];
    for (const [method, path, body] of routes) {
      const init = body === undefined ? { method } : jsonInit(method, body);
      expect((await call("int_stranger", path, init)).status, `${method} ${path}`).toBe(404);
      expect((await call(null, path, init)).status, `${method} ${path} anonymous`).toBe(401);
    }
    expect((await call("int_own", `${base("org_missing")}`)).status).toBe(404);
    // The stranger changed nothing.
    expect((await rowFor(site.orgId))?.fromAddress).toBe("hi@grace.org");

    expect((await call("int_admin:admin", base(site.orgId))).status).toBe(200);
  });
});

describe("PUT /orgs/:id/integrations/resend/key", () => {
  it("rejects a malformed key without calling Resend", async () => {
    const resend = stubResend();
    const site = await makeSite("key_a", "Key Malformed");
    for (const apiKey of ["", "sk_live_1234567890", "re_short", "re_has space_123456", 42]) {
      const res = await call("key_a", `${base(site.orgId)}/resend/key`, jsonInit("PUT", { apiKey }));
      expect(res.status, String(apiKey)).toBe(400);
    }
    expect((await call("key_a", `${base(site.orgId)}/resend/key`, { method: "PUT", body: "not json" })).status).toBe(400);
    expect(resend.fn).not.toHaveBeenCalled();
    expect(await rowFor(site.orgId)).toBeUndefined();
  });

  it("answers 400 when Resend rejects the key (401 and 403) and stores nothing", async () => {
    const resend = stubResend({ domainsStatus: 401 });
    const site = await makeSite("key_b", "Key Rejected");
    const res = await putKey("key_b", site.orgId);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Resend rejected this key" });
    resend.state.domainsStatus = 403;
    expect((await putKey("key_b", site.orgId)).status).toBe(400);
    expect(await rowFor(site.orgId)).toBeUndefined();
    expect(await dumpDatabase()).not.toContain(KEY);
  });

  it("answers 502 and stores nothing when Resend is unreachable or failing", async () => {
    const resend = stubResend({ domainsStatus: 500 });
    const site = await makeSite("key_c", "Key Down");
    expect((await putKey("key_c", site.orgId)).status).toBe(502);
    resend.state.domainsStatus = 200;
    resend.state.networkError = true;
    const res = await putKey("key_c", site.orgId);
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain(KEY);
    expect(await rowFor(site.orgId)).toBeUndefined();
  });

  it("verifies the key against GET /domains, stores it encrypted, and returns only a hint", async () => {
    const resend = stubResend();
    const site = await makeSite("key_d", "Key Accepted");
    const res = await putKey("key_d", site.orgId);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");

    const [domainsCall] = resend.calls("https://api.resend.com/domains");
    expect(domainsCall?.init.method ?? "GET").toBe("GET");
    expect(resend.bearer(domainsCall!.init)).toBe(`Bearer ${KEY}`);

    const text = await res.text();
    const body = IntegrationsResponse.parse(JSON.parse(text));
    expect(body.activeSender).toBe("none");
    expect(body.resend).toMatchObject({
      provider: "resend",
      keyHint: "…K4Q2",
      fromAddress: null,
      // Only verified domains, lowercased and sorted; "pending.org" is not verified.
      verifiedDomains: ["grace.org", "other.example"],
      testedAt: null,
      lastError: null,
    });
    expect(text).not.toContain(KEY);

    const row = await rowFor(site.orgId);
    expect(row?.keyHint).toBe("K4Q2");
    expect(row?.provider).toBe("resend");
    expect(row?.encryptedKey).toMatch(/^v1\./);
    expect(JSON.parse(row!.verifiedDomainsJson)).toEqual(["grace.org", "other.example"]);
    expect(text).not.toContain(row!.encryptedKey);
    // It decrypts with the organization id, and only with it.
    expect(await decryptSecret(env, row!.encryptedKey, site.orgId)).toBe(KEY);
    await expect(decryptSecret(env, row!.encryptedKey, "org_other")).rejects.toThrow();

    // The raw key is nowhere in D1: not in this table, not in any other.
    expect(await dumpDatabase()).not.toContain(KEY);
    expect(await dumpDatabase()).not.toContain(KEY.slice(3));
  });

  it("replaces the key in place, clearing the test status and keeping the from address only while its domain stays verified", async () => {
    const resend = stubResend();
    const site = await configured("key_e", "Key Replace", { fromAddress: "hi@grace.org", fromName: "Grace Church" });
    expect((await postTest("key_e", site.orgId)).status).toBe(200);
    expect((await rowFor(site.orgId))?.testedAt).not.toBeNull();

    // Same account: the from address survives, but it has to be tested again.
    expect((await putKey("key_e", site.orgId, OTHER_KEY)).status).toBe(200);
    let row = await rowFor(site.orgId);
    expect(row).toMatchObject({ keyHint: "Wxyz", fromAddress: "hi@grace.org", fromName: "Grace Church", testedAt: null, lastError: null });
    expect(await decryptSecret(env, row!.encryptedKey, site.orgId)).toBe(OTHER_KEY);
    expect(resend.bearer(resend.calls("https://api.resend.com/domains").at(-1)!.init)).toBe(`Bearer ${OTHER_KEY}`);

    // Another account that has not verified grace.org: the address cannot be kept.
    resend.state.domains = [{ name: "elsewhere.org", status: "verified" }];
    const body = IntegrationsResponse.parse(await (await putKey("key_e", site.orgId, KEY)).json());
    expect(body.resend).toMatchObject({ fromAddress: null, verifiedDomains: ["elsewhere.org"] });
    expect(body.activeSender).toBe("none");
    row = await rowFor(site.orgId);
    expect(row?.fromName).toBeNull();
    expect(await dumpDatabase()).not.toContain(OTHER_KEY);

    const all = await db().select().from(orgIntegrations).where(eq(orgIntegrations.orgId, site.orgId));
    expect(all).toHaveLength(1);
  });

  it("allows 10 attempts per organization per hour, counting failures, then answers 429 without calling Resend", async () => {
    const resend = stubResend({ domainsStatus: 401 });
    const site = await makeSite("key_f", "Key Limit");
    for (let i = 0; i < MAX_KEY_ATTEMPTS_PER_HOUR; i++) expect((await putKey("key_f", site.orgId)).status).toBe(400);
    expect(resend.fn).toHaveBeenCalledTimes(MAX_KEY_ATTEMPTS_PER_HOUR);

    // Even a good key is refused once the limit is hit.
    resend.state.domainsStatus = 200;
    const limited = await putKey("key_f", site.orgId);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(Number(limited.headers.get("retry-after"))).toBeLessThanOrEqual(3600);
    expect(resend.fn).toHaveBeenCalledTimes(MAX_KEY_ATTEMPTS_PER_HOUR);
    expect(await rowFor(site.orgId)).toBeUndefined();

    // Another organization is unaffected.
    const other = await makeSite("key_f2", "Key Limit Other");
    expect((await putKey("key_f2", other.orgId)).status).toBe(200);
  });

  it("stops counting attempts older than an hour", async () => {
    stubResend();
    const site = await makeSite("key_g", "Key Window");
    const old = new Date(Date.now() - 61 * 60 * 1000);
    await db()
      .insert(integrationEvents)
      .values(Array.from({ length: MAX_KEY_ATTEMPTS_PER_HOUR }, (_, i) => ({ id: `ievt_old_g${i}`, orgId: site.orgId, kind: "key_attempt" as const, createdAt: old })));
    expect((await putKey("key_g", site.orgId)).status).toBe(200);
  });
});

describe("PUT /orgs/:id/integrations/resend/from", () => {
  it("needs a key first", async () => {
    stubResend();
    const site = await makeSite("from_a", "From No Key");
    expect((await putFrom("from_a", site.orgId, { fromAddress: "hi@grace.org" })).status).toBe(409);
  });

  it("answers 400 for a domain that is not verified in Resend and stores no address", async () => {
    const resend = stubResend();
    const site = await configured("from_b", "From Unverified");
    for (const fromAddress of ["hi@pending.org", "hi@unknown.example", "hi@sub.grace.org"]) {
      const res = await putFrom("from_b", site.orgId, { fromAddress });
      expect(res.status, fromAddress).toBe(400);
      expect(((await res.json()) as { error: string }).error).toContain("not a verified domain");
    }
    expect((await rowFor(site.orgId))?.fromAddress).toBeNull();
    // The list was refreshed from Resend each time.
    expect(resend.calls("https://api.resend.com/domains")).toHaveLength(4);
  });

  it("stores a verified address (any letter case) with an optional display name and activates the organization sender", async () => {
    stubResend();
    const site = await configured("from_c", "From Verified");
    const res = await putFrom("from_c", site.orgId, { fromAddress: " Hi@GRACE.org ", fromName: "Grace Church" });
    expect(res.status).toBe(200);
    const body = IntegrationsResponse.parse(await res.json());
    expect(body.activeSender).toBe("organization");
    expect(body.resend?.fromAddress).toBe("Hi@GRACE.org");
    expect(await rowFor(site.orgId)).toMatchObject({ fromAddress: "Hi@GRACE.org", fromName: "Grace Church" });

    // Saving again without a name clears it.
    await putFrom("from_c", site.orgId, { fromAddress: "hi@grace.org" });
    expect((await rowFor(site.orgId))?.fromName).toBeNull();
  });

  it("refreshes the verified list, so a domain verified after the key was entered is accepted", async () => {
    const resend = stubResend({ domains: [{ name: "grace.org", status: "verified" }, { name: "new.org", status: "pending" }] });
    const site = await configured("from_d", "From Refresh");
    expect((await putFrom("from_d", site.orgId, { fromAddress: "hi@new.org" })).status).toBe(400);
    resend.state.domains = [{ name: "grace.org", status: "verified" }, { name: "new.org", status: "verified" }];
    const res = await putFrom("from_d", site.orgId, { fromAddress: "hi@new.org" });
    expect(res.status).toBe(200);
    expect(JSON.parse((await rowFor(site.orgId))!.verifiedDomainsJson)).toEqual(["grace.org", "new.org"]);
  });

  it("rejects invalid addresses and display names that could break out of the header", async () => {
    stubResend();
    const site = await configured("from_e", "From Invalid");
    const bad = [
      { fromAddress: "not-an-email" },
      { fromAddress: "a@grace.org, b@grace.org" },
      { fromAddress: "hi@grace.org", fromName: 'Evil" <x@evil.example>' },
      { fromAddress: "hi@grace.org", fromName: "Line\r\nBcc: x@evil.example" },
      { fromAddress: "hi@grace.org", fromName: "n".repeat(81) },
      {},
    ];
    for (const body of bad) expect((await putFrom("from_e", site.orgId, body)).status, JSON.stringify(body)).toBe(400);
    expect((await rowFor(site.orgId))?.fromAddress).toBeNull();
  });

  it("records a revoked key as the integration's error", async () => {
    const resend = stubResend();
    const site = await configured("from_f", "From Revoked");
    resend.state.domainsStatus = 401;
    const res = await putFrom("from_f", site.orgId, { fromAddress: "hi@grace.org" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Resend rejected this key" });
    expect((await rowFor(site.orgId))?.lastError).toBe("Resend rejected this key");
  });

  it("clears an earlier successful test, since it vouched for the old address", async () => {
    stubResend();
    const site = await configured("from_g", "From Retest", { fromAddress: "hi@grace.org" });
    expect((await postTest("from_g", site.orgId)).status).toBe(200);
    expect((await rowFor(site.orgId))?.testedAt).not.toBeNull();
    expect((await putFrom("from_g", site.orgId, { fromAddress: "news@grace.org" })).status).toBe(200);
    expect((await rowFor(site.orgId))?.testedAt).toBeNull();
  });
});

describe("POST /orgs/:id/integrations/resend/test", () => {
  it("needs a key and a from address first, without consuming the limit", async () => {
    const resend = stubResend();
    const site = await makeSite("test_a", "Test Missing");
    expect((await postTest("test_a", site.orgId)).status).toBe(409);
    expect((await putKey("test_a", site.orgId)).status).toBe(200);
    expect((await postTest("test_a", site.orgId)).status).toBe(409);
    expect(resend.calls("https://api.resend.com/emails")).toHaveLength(0);
    expect(await db().select().from(integrationEvents).where(and(eq(integrationEvents.orgId, site.orgId), eq(integrationEvents.kind, "test_email")))).toEqual([]);
    expect((await postTest("test_a", site.orgId, "not-an-email")).status).toBe(400);
  });

  it("sends a short email through the organization's key and from address and records tested_at", async () => {
    const resend = stubResend();
    const site = await configured("test_b", "Test Success", { fromAddress: "hi@grace.org", fromName: "Grace Church" });
    const res = await postTest("test_b", site.orgId, "pastor@church.example");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");

    const [sent] = resend.calls("https://api.resend.com/emails");
    expect(sent?.init.method).toBe("POST");
    expect(resend.bearer(sent!.init)).toBe(`Bearer ${KEY}`);
    const payload = JSON.parse(sent!.init.body as string) as Record<string, unknown>;
    expect(payload).toMatchObject({ from: '"Grace Church" <hi@grace.org>', to: ["pastor@church.example"], subject: "Test email from Ministry Sites" });
    expect(String(payload["text"]).length).toBeLessThan(300);

    const body = IntegrationsResponse.parse(await res.json());
    expect(body.activeSender).toBe("organization");
    expect(body.resend?.testedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(body.resend?.lastError).toBeNull();
    expect((await rowFor(site.orgId))?.testedAt).toBeInstanceOf(Date);
  });

  it("sends a bare address when no display name is set", async () => {
    const resend = stubResend();
    const site = await configured("test_b2", "Test Bare", { fromAddress: "hi@grace.org" });
    expect((await postTest("test_b2", site.orgId)).status).toBe(200);
    const payload = JSON.parse(resend.calls("https://api.resend.com/emails")[0]!.init.body as string) as Record<string, unknown>;
    expect(payload["from"]).toBe("hi@grace.org");
  });

  it("answers 502 with a sanitized last_error when Resend refuses, never exposing the key", async () => {
    const resend = stubResend();
    const site = await configured("test_c", "Test Failure", { fromAddress: "hi@grace.org" });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    resend.state.sendStatus = 403;
    // A hostile or buggy upstream message that echoes the key and an address.
    resend.state.sendBody = { message: `The ${KEY} key cannot send from hi@grace.org: domain not verified` };
    const res = await postTest("test_c", site.orgId);
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).toContain("domain not verified");
    expect(text).not.toContain(KEY);

    const row = await rowFor(site.orgId);
    expect(row?.testedAt).toBeNull();
    expect(row?.lastError).toContain("403");
    expect(row?.lastError).not.toContain(KEY);
    expect(row?.lastError).not.toContain("K4Q2");
    expect(errorLog.mock.calls.flat().join(" ")).not.toContain(KEY);
    errorLog.mockRestore();

    // GET shows it; a later success clears it.
    expect(IntegrationsResponse.parse(await (await getIntegrations("test_c", site.orgId)).json()).resend?.lastError).toBe(row?.lastError);
    resend.state.sendStatus = 200;
    resend.state.sendBody = { id: "ok" };
    expect((await postTest("test_c", site.orgId)).status).toBe(200);
    expect((await rowFor(site.orgId))?.lastError).toBeNull();
  });

  it("answers 502 on a network failure", async () => {
    const resend = stubResend();
    const site = await configured("test_d", "Test Network", { fromAddress: "hi@grace.org" });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    resend.state.networkError = true;
    const res = await postTest("test_d", site.orgId);
    expect(res.status).toBe(502);
    expect((await rowFor(site.orgId))?.lastError).toBe("fetch failed");
    errorLog.mockRestore();
  });

  it("allows 5 test emails per organization per hour, then answers 429 without sending", async () => {
    const resend = stubResend();
    const site = await configured("test_e", "Test Limit", { fromAddress: "hi@grace.org" });
    for (let i = 0; i < MAX_TEST_EMAILS_PER_HOUR; i++) expect((await postTest("test_e", site.orgId)).status).toBe(200);
    const limited = await postTest("test_e", site.orgId);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(resend.calls("https://api.resend.com/emails")).toHaveLength(MAX_TEST_EMAILS_PER_HOUR);

    // Key attempts have their own allowance.
    expect((await putKey("test_e", site.orgId)).status).toBe(200);
    // Another organization is unaffected.
    const other = await configured("test_e2", "Test Limit Other", { fromAddress: "hi@grace.org" });
    expect((await postTest("test_e2", other.orgId)).status).toBe(200);
  });

  it("counts failed test emails against the limit", async () => {
    const resend = stubResend({ sendStatus: 500, sendBody: { message: "boom" } });
    const site = await configured("test_f", "Test Failing Limit", { fromAddress: "hi@grace.org" });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    for (let i = 0; i < MAX_TEST_EMAILS_PER_HOUR; i++) expect((await postTest("test_f", site.orgId)).status).toBe(502);
    expect((await postTest("test_f", site.orgId)).status).toBe(429);
    expect(resend.calls("https://api.resend.com/emails")).toHaveLength(MAX_TEST_EMAILS_PER_HOUR);
    errorLog.mockRestore();
  });

  it("tells the owner to re-enter the key when it cannot be decrypted", async () => {
    stubResend();
    const site = await configured("test_g", "Test Rotated", { fromAddress: "hi@grace.org" });
    const rotated = { ...env, INTEGRATIONS_KEY: Buffer.alloc(32, 9).toString("base64") };
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await call("test_g", `${base(site.orgId)}/resend/test`, jsonInit("POST", { to: "me@example.com" }), rotated);
    expect(res.status).toBe(409);
    errorLog.mockRestore();
  });
});

describe("DELETE /orgs/:id/integrations/resend", () => {
  it("removes the row and reverts to the platform or no sender", async () => {
    stubResend();
    const site = await configured("del_a", "Del Org", { fromAddress: "hi@grace.org" });
    const res = await call("del_a", `${base(site.orgId)}/resend`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(IntegrationsResponse.parse(await res.json())).toEqual({ encryptionAvailable: true, activeSender: "none", resend: null });
    expect(await rowFor(site.orgId)).toBeUndefined();
    expect(await dumpDatabase()).not.toContain(KEY);
    // Deleting again is harmless.
    expect((await call("del_a", `${base(site.orgId)}/resend`, { method: "DELETE" })).status).toBe(200);
  });

  it("does not reset the key-attempt limit", async () => {
    stubResend({ domainsStatus: 401 });
    const site = await makeSite("del_b", "Del Limit");
    for (let i = 0; i < MAX_KEY_ATTEMPTS_PER_HOUR; i++) await putKey("del_b", site.orgId);
    await call("del_b", `${base(site.orgId)}/resend`, { method: "DELETE" });
    expect((await putKey("del_b", site.orgId)).status).toBe(429);
  });

  it("is removed with the organization when its last site is deleted, but not while another site remains", async () => {
    stubResend();
    const first = await configured("del_c", "Del Cascade", { fromAddress: "hi@grace.org" });
    expect((await postTest("del_c", first.orgId)).status).toBe(200);
    const second = await call("del_c", "/sites", jsonInit("POST", { orgName: "Del Cascade", slug: "del-cascade-2" }));
    expect(second.status).toBe(201);
    const secondId = ((await second.json()) as { site: { id: string; orgId: string } }).site;
    expect(secondId.orgId).toBe(first.orgId);

    expect((await call("del_c", `/sites/${first.id}`, { method: "DELETE" })).status).toBe(200);
    expect(await rowFor(first.orgId)).toBeDefined();

    expect((await call("del_c", `/sites/${secondId.id}`, { method: "DELETE" })).status).toBe(200);
    expect(await rowFor(first.orgId)).toBeUndefined();
    expect(await db().select().from(integrationEvents).where(eq(integrationEvents.orgId, first.orgId))).toEqual([]);
    expect(await dumpDatabase()).not.toContain(KEY);
  });
});

describe("contact form delivery through the organization's Resend", () => {
  const HOST = "sites.shofar.io";
  let ip = 0;

  async function publishedSite(user: string, orgName: string): Promise<TestSite> {
    const site = await makeSite(user, orgName);
    const doc = emptySiteDocument(orgName);
    const contact = doc.sections.find((s) => s.type === "contact");
    if (contact?.type === "contact") contact.email = "pastor@church.example";
    expect((await call(user, `/sites/${site.id}/document`, jsonInit("PUT", doc))).status).toBe(200);
    expect((await call(user, `/sites/${site.id}/publish`, { method: "POST" })).status).toBe(200);
    // The platform sender only emails a verified address; the organization's own sender is not gated.
    await verifyContactEmail(site.id, "pastor@church.example");
    return site;
  }

  function submit(site: TestSite, bindings: object = env) {
    ip += 1;
    return Promise.resolve(
      realApp.request(
        `https://${HOST}/${site.slug}/contact`,
        {
          method: "POST",
          redirect: "manual",
          headers: { "CF-Connecting-IP": `198.51.100.${ip}` },
          body: new URLSearchParams({ name: "Ada Visitor", email: "ada@example.com", message: "Hello there" }),
        },
        bindings,
      ),
    );
  }

  const messages = (siteId: string) => db().select().from(formSubmissions).where(eq(formSubmissions.siteId, siteId));

  /** A platform sender that must stay untouched when the organization has its own. */
  function platformBindings() {
    const cloudflareSend = vi.fn(async (_message: Record<string, string>) => ({ messageId: "cf_1" }));
    return { cloudflareSend, bindings: { ...env, EMAIL_PROVIDER: "cloudflare", EMAIL: { send: cloudflareSend } } };
  }

  it("sends through the organization's key and from address, records delivered_via, and never touches the platform sender", async () => {
    const resend = stubResend();
    const site = await publishedSite("ct_a", "Contact Org");
    expect((await putKey("ct_a", site.orgId)).status).toBe(200);
    expect((await putFrom("ct_a", site.orgId, { fromAddress: "hi@grace.org", fromName: "Grace Church" })).status).toBe(200);
    const platform = platformBindings();

    const res = await submit(site, platform.bindings);
    expect(res.status).toBe(303);

    const emails = resend.calls("https://api.resend.com/emails");
    expect(emails).toHaveLength(1);
    expect(resend.bearer(emails[0]!.init)).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(emails[0]!.init.body as string)).toMatchObject({
      from: '"Grace Church" <hi@grace.org>',
      to: ["pastor@church.example"],
      reply_to: "ada@example.com",
    });
    expect(platform.cloudflareSend).not.toHaveBeenCalled();

    const [row] = await messages(site.id);
    expect(row?.deliveredVia).toBe("organization");
    expect(row?.deliveredAt).toBeInstanceOf(Date);
    expect(row?.deliveryError).toBeNull();
  });

  it("does not fall back to the platform sender when the organization's Resend fails, and records the error", async () => {
    const resend = stubResend();
    const site = await publishedSite("ct_b", "Contact Failure");
    await putKey("ct_b", site.orgId);
    await putFrom("ct_b", site.orgId, { fromAddress: "hi@grace.org" });
    const platform = platformBindings();
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    resend.state.sendStatus = 403;
    resend.state.sendBody = { message: "domain not verified" };

    const res = await submit(site, platform.bindings);
    expect(res.status).toBe(303);
    expect(resend.calls("https://api.resend.com/emails")).toHaveLength(1);
    expect(platform.cloudflareSend).not.toHaveBeenCalled();

    const [row] = await messages(site.id);
    expect(row).toMatchObject({ deliveredVia: "organization", deliveredAt: null });
    expect(row?.deliveryError).toContain("403");
    expect(row?.deliveryError).toContain("domain not verified");
    expect(errorLog.mock.calls.flat().join(" ")).not.toContain(KEY);
    errorLog.mockRestore();
  });

  it("falls back to the platform only when the organization has no complete integration", async () => {
    const resend = stubResend();
    const site = await publishedSite("ct_c", "Contact Partial");
    await putKey("ct_c", site.orgId);
    const platform = platformBindings();

    // A key without a from address is not a usable sender yet.
    expect((await submit(site, platform.bindings)).status).toBe(303);
    expect(platform.cloudflareSend).toHaveBeenCalledTimes(1);
    expect(resend.calls("https://api.resend.com/emails")).toHaveLength(0);
    const [row] = await messages(site.id);
    expect(row).toMatchObject({ deliveredVia: "platform", deliveryError: null });
    expect(row?.deliveredAt).toBeInstanceOf(Date);
  });

  it("records the platform as the sender for organizations without an integration, and nothing in store-only mode", async () => {
    stubResend();
    const site = await publishedSite("ct_d", "Contact Platform");
    const platform = platformBindings();
    await submit(site, platform.bindings);
    await submit(site);
    const rows = await messages(site.id);
    expect(rows.map((r) => r.deliveredVia).sort()).toEqual([null, "platform"]);
  });

  it("records an error and does not use the platform sender when the stored key cannot be decrypted", async () => {
    const resend = stubResend();
    const site = await publishedSite("ct_e", "Contact Rotated");
    await putKey("ct_e", site.orgId);
    await putFrom("ct_e", site.orgId, { fromAddress: "hi@grace.org" });
    const platform = platformBindings();
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const before = resend.fn.mock.calls.length;

    const res = await submit(site, { ...platform.bindings, INTEGRATIONS_KEY: Buffer.alloc(32, 9).toString("base64") });
    expect(res.status).toBe(303);
    expect(resend.fn.mock.calls.length).toBe(before);
    expect(platform.cloudflareSend).not.toHaveBeenCalled();
    const [row] = await messages(site.id);
    expect(row).toMatchObject({ deliveredVia: "organization", deliveredAt: null });
    expect(row?.deliveryError).toContain("could not be read");
    errorLog.mockRestore();
  });
});
