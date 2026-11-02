import { emptySiteDocument } from "@ministry/schema";
import { env } from "cloudflare:workers";
import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSender } from "../src/email";
import { formSubmissions } from "../src/db/schema";
import realApp from "../src/index";
import type { Bindings } from "../src/types";
import { call, jsonInit, makeSite, type TestSite } from "./helpers";

const HOST = "sites.shofar.io";
const db = () => drizzle(env.DB);

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Requests go through the real app so the hosting handler runs first, exactly as in production. */
function hosted(url: string, init?: RequestInit, bindings: object = env): Promise<Response> {
  return Promise.resolve(realApp.request(url, init, bindings));
}

let ipCounter = 0;
/** Each test gets its own visitor address so the per-IP rate limit never leaks between tests. */
function freshIp(): string {
  ipCounter += 1;
  return `203.0.113.${ipCounter}`;
}

type ContactOptions = { email?: string; es?: boolean; publish?: boolean };

async function contactSite(user: string, orgName: string, options: ContactOptions = {}): Promise<TestSite> {
  const { email = "owner@example.org", es = false, publish = true } = options;
  const site = await makeSite(user, orgName);
  const doc = emptySiteDocument(orgName);
  const contact = doc.sections.find((s) => s.type === "contact");
  if (contact?.type === "contact") contact.email = email;
  expect((await call(user, `/sites/${site.id}/document`, jsonInit("PUT", doc))).status).toBe(200);
  if (es) expect((await call(user, `/sites/${site.id}/ai/translate`, jsonInit("POST", { language: "es" }))).status).toBe(200);
  if (publish) expect((await call(user, `/sites/${site.id}/publish`, { method: "POST" })).status).toBe(200);
  return site;
}

function submit(site: TestSite, fields: Record<string, string>, init: { ip?: string; bindings?: object; subdomain?: boolean; headers?: Record<string, string> } = {}) {
  const url = init.subdomain ? `https://${site.slug}.${HOST}/contact` : `https://${HOST}/${site.slug}/contact`;
  return hosted(
    url,
    {
      method: "POST",
      redirect: "manual",
      headers: { "CF-Connecting-IP": init.ip ?? freshIp(), "User-Agent": "contact-test", ...init.headers },
      body: new URLSearchParams(fields),
    },
    init.bindings,
  );
}

const VALID = { name: "Ada Visitor", email: "ada@example.com", message: "Hello there" };

async function rows(siteId: string) {
  return db().select().from(formSubmissions).where(eq(formSubmissions.siteId, siteId)).orderBy(desc(formSubmissions.createdAt));
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

describe("contact form endpoint", () => {
  it("stores the submission and redirects to the primary thank-you page without caching", async () => {
    const site = await contactSite("form_a", "Form Org");
    const ip = freshIp();
    const res = await submit(site, { ...VALID, name: "  Ada Visitor  ", _lang: "en" }, { ip });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`/${site.slug}/thanks/`);
    expect(res.headers.get("cache-control")).toBe("no-store");

    const [row, ...others] = await rows(site.id);
    expect(others).toHaveLength(0);
    expect(row).toMatchObject({ name: "Ada Visitor", email: "ada@example.com", message: "Hello there", language: "en", userAgent: "contact-test" });
    expect(row?.deliveredAt).toBeNull();
    expect(row?.deliveryError).toBeNull();
    // The raw address is never stored; the hash is salted SHA-256.
    expect(row?.ipHash).toBe(await sha256(`ministry:${ip}`));
    expect(JSON.stringify(row)).not.toContain(ip);
  });

  it("redirects to the language thank-you page for another site language and falls back to the primary for unknown ones", async () => {
    const site = await contactSite("form_b", "Form Languages", { es: true });
    const es = await submit(site, { ...VALID, _lang: "es" });
    expect(es.status).toBe(303);
    expect(es.headers.get("location")).toBe(`/${site.slug}/es/thanks/`);
    const fr = await submit(site, { ...VALID, _lang: "fr" });
    expect(fr.headers.get("location")).toBe(`/${site.slug}/thanks/`);
    const evil = await submit(site, { ...VALID, _lang: "../x" });
    expect(evil.headers.get("location")).toBe(`/${site.slug}/thanks/`);
    const missing = await submit(site, VALID);
    expect(missing.headers.get("location")).toBe(`/${site.slug}/thanks/`);

    expect((await rows(site.id)).map((r) => r.language).sort()).toEqual(["en", "en", "en", "es"]);
  });

  it("uses root-relative thank-you paths on the subdomain form", async () => {
    const site = await contactSite("form_c", "Form Subdomain", { es: true });
    const primary = await submit(site, VALID, { subdomain: true });
    expect(primary.status).toBe(303);
    expect(primary.headers.get("location")).toBe("/thanks/");
    const es = await submit(site, { ...VALID, _lang: "es" }, { subdomain: true });
    expect(es.headers.get("location")).toBe("/es/thanks/");
  });

  it("accepts multipart form data", async () => {
    const site = await contactSite("form_d", "Form Multipart");
    const form = new FormData();
    for (const [key, value] of Object.entries(VALID)) form.set(key, value);
    const res = await hosted(`https://${HOST}/${site.slug}/contact`, {
      method: "POST",
      redirect: "manual",
      headers: { "CF-Connecting-IP": freshIp() },
      body: form,
    });
    expect(res.status).toBe(303);
    expect(await rows(site.id)).toHaveLength(1);
  });

  it("answers a filled honeypot like a success but stores nothing", async () => {
    const site = await contactSite("form_e", "Form Honeypot");
    const res = await submit(site, { ...VALID, website: "http://spam.example" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`/${site.slug}/thanks/`);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await rows(site.id)).toHaveLength(0);
  });

  it("rejects invalid input with a 400 page and stores nothing", async () => {
    const site = await contactSite("form_f", "Form Validation");
    const bad: Record<string, string>[] = [
      { ...VALID, name: "   " },
      { ...VALID, name: "n".repeat(121) },
      { ...VALID, email: "not-an-email" },
      { ...VALID, email: "a@b" },
      { ...VALID, email: "a@b.com, evil@c.com" },
      { ...VALID, email: `${"a".repeat(200)}@example.com` },
      { ...VALID, message: "  " },
      { ...VALID, message: "m".repeat(4001) },
      { name: "Only name" },
    ];
    for (const fields of bad) {
      const res = await submit(site, fields);
      expect(res.status, JSON.stringify(fields).slice(0, 80)).toBe(400);
      expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
    expect(await rows(site.id)).toHaveLength(0);

    // The limits themselves are inclusive.
    const edge = await submit(site, { name: "n".repeat(120), email: "a@b.co", message: "m".repeat(4000) });
    expect(edge.status).toBe(303);
  });

  it("rejects oversized bodies and unreadable content types", async () => {
    const site = await contactSite("form_g", "Form Size");
    const big = await submit(site, { ...VALID, message: "x".repeat(70 * 1024) });
    expect(big.status).toBe(413);
    const json = await hosted(`https://${HOST}/${site.slug}/contact`, {
      method: "POST",
      headers: { "content-type": "application/json", "CF-Connecting-IP": freshIp() },
      body: JSON.stringify(VALID),
    });
    expect(json.status).toBe(400);
    expect(await rows(site.id)).toHaveLength(0);
  });

  it("limits each visitor to 5 submissions per 10 minutes and each site to 30 per hour", async () => {
    const site = await contactSite("form_h", "Form Limits");
    const ip = freshIp();
    for (let i = 0; i < 5; i++) expect((await submit(site, VALID, { ip })).status).toBe(303);
    const limited = await submit(site, VALID, { ip });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(limited.headers.get("cache-control")).toBe("no-store");
    expect(await rows(site.id)).toHaveLength(5);
    // Another visitor is unaffected.
    expect((await submit(site, VALID)).status).toBe(303);

    // Rows older than the window stop counting.
    const oldIp = freshIp();
    const oldHash = await sha256(`ministry:${oldIp}`);
    const eleven = new Date(Date.now() - 11 * 60 * 1000);
    await db()
      .insert(formSubmissions)
      .values(
        Array.from({ length: 5 }, (_, i) => ({ id: `msg_old_${oldHash.slice(0, 6)}_${i}`, siteId: site.id, name: "n", email: "a@b.co", message: "m", language: "en", ipHash: oldHash, createdAt: eleven })),
      );
    expect((await submit(site, VALID, { ip: oldIp })).status).toBe(303);

    // Site-wide: fill the hour with 30 messages from distinct visitors.
    const crowded = await contactSite("form_h2", "Form Crowded");
    // D1 caps bound variables per statement, so insert in small batches.
    for (let start = 0; start < 30; start += 5) {
      await db()
        .insert(formSubmissions)
        .values(
          Array.from({ length: 5 }, (_, i) => ({ id: `msg_crowd_${start + i}`, siteId: crowded.id, name: "n", email: "a@b.co", message: "m", language: "en", ipHash: `hash-${start + i}` })),
        );
    }
    expect((await submit(crowded, VALID)).status).toBe(429);
    expect(await rows(crowded.id)).toHaveLength(30);
  });

  it("answers 404 when the site is unknown or its contact section has no email, and 405 for GET", async () => {
    const noEmail = await contactSite("form_i", "Form No Email", { email: "" });
    expect((await submit(noEmail, VALID)).status).toBe(404);
    expect(await rows(noEmail.id)).toHaveLength(0);

    const ghost = await hosted(`https://${HOST}/no-such-site/contact`, { method: "POST", body: new URLSearchParams(VALID) });
    expect(ghost.status).toBe(404);

    const site = await contactSite("form_i2", "Form Get");
    const get = await hosted(`https://${HOST}/${site.slug}/contact`);
    expect(get.status).toBe(405);
    expect(get.headers.get("allow")).toBe("POST");
    expect(get.headers.get("cache-control")).toBe("no-store");
    // Other POST targets on the sites host stay read-only.
    expect((await hosted(`https://${HOST}/${site.slug}/`, { method: "POST" })).status).toBe(405);
  });

  it("accepts messages for a site that is not published", async () => {
    const draft = await contactSite("form_j", "Form Draft", { publish: false });
    const res = await submit(draft, VALID);
    expect(res.status).toBe(303);
    expect(await rows(draft.id)).toHaveLength(1);
  });
});

describe("contact form email delivery", () => {
  const resend = { ...env, EMAIL_PROVIDER: "resend", RESEND_API_KEY: "re_test_key", EMAIL_FROM: "Ministry Sites <forms@shofar.io>" };

  it("sends through Resend to the contact email with the visitor as reply-to and marks the row delivered", async () => {
    const fetchStub = vi.fn(async () => Response.json({ id: "re_123" }));
    vi.stubGlobal("fetch", fetchStub);
    const site = await contactSite("mail_a", "Mail Org", { email: "pastor@church.example" });
    const res = await submit(site, { name: "Ada <b>Bold</b>", email: "ada@example.com", message: "Line one\n<script>alert(1)</script>" }, { bindings: resend });
    expect(res.status).toBe(303);

    expect(fetchStub).toHaveBeenCalledTimes(1);
    const [url, init] = fetchStub.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer re_test_key");
    const sent = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(sent).toMatchObject({
      from: "Ministry Sites <forms@shofar.io>",
      to: ["pastor@church.example"],
      reply_to: "ada@example.com",
      subject: "[Mail Org] New message from Ada <b>Bold</b>",
    });
    expect(sent["text"]).toContain("Line one");
    // Visitor text is escaped in the HTML body.
    expect(sent["html"]).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(sent["html"]).not.toContain("<script>");
    expect(sent["html"]).not.toContain("<b>Bold</b>");

    const [row] = await rows(site.id);
    expect(row?.deliveredAt).toBeInstanceOf(Date);
    expect(row?.deliveryError).toBeNull();
  });

  it("keeps the message, records the error and still redirects when delivery fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ message: "domain not verified" }, { status: 403 })));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const site = await contactSite("mail_b", "Mail Failure");
    const res = await submit(site, VALID, { bindings: resend });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`/${site.slug}/thanks/`);

    const [row] = await rows(site.id);
    expect(row?.deliveredAt).toBeNull();
    expect(row?.deliveryError).toContain("403");
    expect(row?.deliveryError).toContain("domain not verified");
    expect(errorLog).toHaveBeenCalled();
    expect(errorLog.mock.calls.flat().join(" ")).not.toContain(VALID.email);
    errorLog.mockRestore();
  });

  it("records a network failure from the provider as a delivery error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("fetch failed"))));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const site = await contactSite("mail_c", "Mail Network");
    expect((await submit(site, VALID, { bindings: resend })).status).toBe(303);
    expect((await rows(site.id))[0]?.deliveryError).toBe("fetch failed");
    errorLog.mockRestore();
  });

  it("sends through the Cloudflare binding with the default from address", async () => {
    const send = vi.fn(async (_message: Record<string, string>) => ({ messageId: "cf_1" }));
    const site = await contactSite("mail_d", "Mail Cloudflare", { email: "boss@example.org" });
    const bindings = { ...env, EMAIL_PROVIDER: "cloudflare", EMAIL: { send }, EMAIL_FROM: undefined };
    expect((await submit(site, VALID, { bindings })).status).toBe(303);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toMatchObject({
      from: "forms@shofar.io",
      to: "boss@example.org",
      replyTo: "ada@example.com",
      subject: "[Mail Cloudflare] New message from Ada Visitor",
    });
    expect((await rows(site.id))[0]?.deliveredAt).toBeInstanceOf(Date);
  });

  it("runs in store-only mode when no provider is configured and never calls out", async () => {
    const fetchStub = vi.fn(async () => Response.json({}));
    vi.stubGlobal("fetch", fetchStub);
    const site = await contactSite("mail_e", "Mail Store Only");
    expect(env.EMAIL_PROVIDER).toBe("none");
    expect((await submit(site, VALID)).status).toBe(303);
    expect(fetchStub).not.toHaveBeenCalled();
    const [row] = await rows(site.id);
    expect(row?.deliveredAt).toBeNull();
    expect(row?.deliveryError).toBeNull();
  });

  it("createSender needs both the provider name and its credentials", () => {
    const base: Pick<Bindings, "EMAIL" | "EMAIL_PROVIDER" | "EMAIL_FROM" | "RESEND_API_KEY"> = {};
    const binding = { send: async () => ({}) };
    expect(createSender(base)).toBeNull();
    expect(createSender({ ...base, EMAIL_PROVIDER: "none", EMAIL: binding, RESEND_API_KEY: "k" })).toBeNull();
    expect(createSender({ ...base, EMAIL_PROVIDER: "cloudflare" })).toBeNull();
    expect(createSender({ ...base, EMAIL_PROVIDER: "cloudflare", EMAIL: binding })).not.toBeNull();
    expect(createSender({ ...base, EMAIL_PROVIDER: "resend" })).toBeNull();
    expect(createSender({ ...base, EMAIL_PROVIDER: "resend", RESEND_API_KEY: "k" })).not.toBeNull();
  });
});

describe("thank-you pages", () => {
  it("are written at publish for every language and the form posts to the right relative action", async () => {
    const site = await contactSite("thanks_a", "Thanks Org", { es: true });
    const get = async (path: string) => {
      const object = await env.PUBLISHED.get(`published/${site.id}/${path}`);
      expect(object, path).not.toBeNull();
      return object!.text();
    };

    const primary = await get("index.html");
    expect(primary).toContain('action="contact"');
    expect(primary).not.toContain('action="../contact"');
    expect(primary).toContain('name="_lang" value="en"');
    const spanish = await get("es/index.html");
    expect(spanish).toContain('action="../contact"');
    expect(spanish).toContain('name="_lang" value="es"');

    const thanks = await get("thanks/index.html");
    expect(thanks).toContain('<html lang="en">');
    expect(thanks).toContain("Thank you");
    expect(thanks).toContain('href="../"');
    const thanksEs = await get("es/thanks/index.html");
    expect(thanksEs).toContain('<html lang="es">');
    expect(thanksEs).toContain("Gracias");
    expect(thanksEs).toContain('href="../"');
    expect((await env.PUBLISHED.head(`published/${site.id}/thanks/index.html`))?.customMetadata).toEqual({ language: "en" });
  });

  it("are served by the hosting handler on both URL forms, uncached, and 404 for unpublished languages", async () => {
    const site = await contactSite("thanks_b", "Thanks Hosting", { es: true });
    for (const [url, lang, text] of [
      [`https://${HOST}/${site.slug}/thanks/`, "en", "Thank you"],
      [`https://${HOST}/${site.slug}/es/thanks/`, "es", "Gracias"],
      [`https://${site.slug}.${HOST}/thanks/`, "en", "Thank you"],
      [`https://${site.slug}.${HOST}/es/thanks/`, "es", "Gracias"],
    ] as const) {
      const res = await hosted(url);
      expect(res.status, url).toBe(200);
      expect(res.headers.get("content-type"), url).toBe("text/html; charset=utf-8");
      expect(res.headers.get("cache-control"), url).toBe("no-store");
      expect(res.headers.get("content-language"), url).toBe(lang);
      expect(res.headers.get("x-content-type-options"), url).toBe("nosniff");
      expect(await res.text(), url).toContain(text);
    }

    const redirected = await hosted(`https://${HOST}/${site.slug}/es/thanks?x=1`, { redirect: "manual" });
    expect(redirected.status).toBe(301);
    expect(redirected.headers.get("location")).toBe(`/${site.slug}/es/thanks/?x=1`);
    for (const url of [`https://${HOST}/${site.slug}/fr/thanks/`, `https://${HOST}/${site.slug}/fr/thanks`, `https://${HOST}/${site.slug}/EN/thanks/`]) {
      expect((await hosted(url, { redirect: "manual" })).status, url).toBe(404);
    }
  });

  it("are removed again when a language leaves the document or the site is unpublished", async () => {
    const site = await contactSite("thanks_c", "Thanks Cleanup");
    await env.PUBLISHED.put(`published/${site.id}/fr/thanks/index.html`, "old");
    await env.PUBLISHED.put(`published/${site.id}/fr/index.html`, "old");
    expect((await call("thanks_c", `/sites/${site.id}/publish`, { method: "POST" })).status).toBe(200);
    expect(await env.PUBLISHED.head(`published/${site.id}/fr/thanks/index.html`)).toBeNull();
    expect(await env.PUBLISHED.head(`published/${site.id}/thanks/index.html`)).not.toBeNull();

    expect((await call("thanks_c", `/sites/${site.id}/unpublish`, { method: "POST" })).status).toBe(200);
    expect((await env.PUBLISHED.list({ prefix: `published/${site.id}/` })).objects).toHaveLength(0);
  });
});

describe("owner access to messages", () => {
  it("lists newest first with a limit, counts them in GET /sites/:id and deletes one", async () => {
    const site = await contactSite("own_a", "Owner Messages");
    const base = Date.now() - 60_000;
    await db()
      .insert(formSubmissions)
      .values(
        ["first", "second", "third"].map((name, i) => ({
          id: `msg_own_${i}`,
          siteId: site.id,
          name,
          email: `${name}@example.com`,
          message: `${name} message`,
          language: "en",
          ipHash: "h",
          createdAt: new Date(base + i * 1000),
        })),
      );

    const list = (await (await call("own_a", `/sites/${site.id}/messages`)).json()) as { messages: Record<string, unknown>[] };
    expect(list.messages.map((m) => m["name"])).toEqual(["third", "second", "first"]);
    expect(Object.keys(list.messages[0] ?? {}).sort()).toEqual(["createdAt", "deliveredAt", "deliveryError", "email", "id", "language", "message", "name"]);
    expect(list.messages[0]).toMatchObject({ id: "msg_own_2", email: "third@example.com", message: "third message", language: "en", deliveredAt: null, deliveryError: null });
    expect(Number.isNaN(Date.parse(String(list.messages[0]?.["createdAt"])))).toBe(false);

    const limited = (await (await call("own_a", `/sites/${site.id}/messages?limit=2`)).json()) as { messages: unknown[] };
    expect(limited.messages).toHaveLength(2);
    const clamped = (await (await call("own_a", `/sites/${site.id}/messages?limit=abc`)).json()) as { messages: unknown[] };
    expect(clamped.messages).toHaveLength(3);

    const detail = (await (await call("own_a", `/sites/${site.id}`)).json()) as { site: { messageCount: number } };
    expect(detail.site.messageCount).toBe(3);

    const del = await call("own_a", `/sites/${site.id}/messages/msg_own_1`, { method: "DELETE" });
    expect(del.status).toBe(200);
    expect(await del.json()).toEqual({ ok: true });
    const after = (await (await call("own_a", `/sites/${site.id}/messages`)).json()) as { messages: { id: string }[] };
    expect(after.messages.map((m) => m.id)).toEqual(["msg_own_2", "msg_own_0"]);
    expect((await call("own_a", `/sites/${site.id}/messages/msg_own_1`, { method: "DELETE" })).status).toBe(404);
  });

  it("answers 404 to non-owners, lets admins in and never deletes across sites", async () => {
    const site = await contactSite("own_b", "Private Messages");
    const other = await contactSite("own_c", "Other Messages");
    expect((await submit(site, VALID)).status).toBe(303);
    const [row] = await rows(site.id);

    expect((await call("own_x", `/sites/${site.id}/messages`)).status).toBe(404);
    expect((await call("own_x", `/sites/${site.id}/messages/${row?.id}`, { method: "DELETE" })).status).toBe(404);
    expect((await call(null, `/sites/${site.id}/messages`)).status).toBe(401);
    // The message belongs to another site, so the other owner cannot reach it through their own site id.
    expect((await call("own_c", `/sites/${other.id}/messages/${row?.id}`, { method: "DELETE" })).status).toBe(404);
    expect(await rows(site.id)).toHaveLength(1);

    const asAdmin = (await (await call("root:admin", `/sites/${site.id}/messages`)).json()) as { messages: unknown[] };
    expect(asAdmin.messages).toHaveLength(1);
  });
});
