import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_VERIFICATION_SENDS_PER_DAY, VERIFY_LINK_TTL_MS } from "../src/contactEmail";
import { contactEmailVerifications } from "../src/db/schema";
import realApp from "../src/index";
import { call, jsonInit, makeSite } from "./helpers";

const API = "https://api.build.shofar.io";
const resend = { ...env, EMAIL_PROVIDER: "resend", RESEND_API_KEY: "re_test_key", EMAIL_FROM: "Ministry Sites <forms@shofar.io>" };
const db = () => drizzle(env.DB);

type Status = { email: string; verified: boolean; verifiedAt: string | null; sentAt: string | null; enabled: boolean };

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Records every email Resend would have sent, so tests can pull the verification link out of it. */
function stubResend() {
  const sent: { to: string[]; subject: string; text: string; html: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      sent.push(JSON.parse(init?.body as string));
      return Response.json({ id: `re_${sent.length}` });
    }),
  );
  return sent;
}

function linkIn(text: string): string {
  const match = /https:\/\/\S+\/verify-contact\/[0-9a-f]{64}/.exec(text);
  if (!match) throw new Error(`no verification link in: ${text}`);
  return match[0];
}

function open(url: string, bindings: object = env): Promise<Response> {
  return Promise.resolve(realApp.request(url, {}, bindings));
}

async function status(user: string, siteId: string, email: string, bindings: object = resend): Promise<Status> {
  const res = await call(user, `/sites/${siteId}/contact-email?email=${encodeURIComponent(email)}`, {}, bindings);
  expect(res.status).toBe(200);
  return (await res.json()) as Status;
}

describe("contact email verification", () => {
  it("emails a link through the configured sender and marks the address verified when it is opened", async () => {
    const sent = stubResend();
    const site = await makeSite("cev_a", "Verify Org");
    expect(await status("cev_a", site.id, "Pastor@Church.example")).toMatchObject({ email: "pastor@church.example", verified: false, sentAt: null, enabled: true });

    const res = await call("cev_a", `/sites/${site.id}/contact-email/verify`, jsonInit("POST", { email: " Pastor@Church.example " }), resend);
    expect(res.status).toBe(200);
    expect((await res.json()) as Status).toMatchObject({ email: "pastor@church.example", verified: false, enabled: true });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: ["pastor@church.example"], subject: "Confirm the contact address for Verify Org" });
    const link = linkIn(sent[0]!.text);
    expect(link.startsWith(`${API}/verify-contact/`)).toBe(true);
    expect(sent[0]!.html).toContain(link);
    expect((await status("cev_a", site.id, "pastor@church.example")).sentAt).not.toBeNull();

    const page = await open(link);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(page.headers.get("cache-control")).toBe("no-store");
    expect(await page.text()).toContain("Address confirmed");

    const after = await status("cev_a", site.id, "pastor@church.example");
    expect(after.verified).toBe(true);
    expect(after.verifiedAt).not.toBeNull();
    // Opening it again is harmless, and asking to verify again sends nothing.
    expect(await (await open(link)).text()).toContain("Already confirmed");
    const again = await call("cev_a", `/sites/${site.id}/contact-email/verify`, jsonInit("POST", { email: "pastor@church.example" }), resend);
    expect(((await again.json()) as Status).verified).toBe(true);
    expect(sent).toHaveLength(1);
  });

  it("refuses unknown, malformed and expired links without changing anything", async () => {
    const sent = stubResend();
    const site = await makeSite("cev_b", "Expiry Org");
    await call("cev_b", `/sites/${site.id}/contact-email/verify`, jsonInit("POST", { email: "late@example.org" }), resend);
    const link = linkIn(sent[0]!.text);

    expect((await open(`${API}/verify-contact/not-a-token`)).status).toBe(404);
    expect((await open(`${API}/verify-contact/${"0".repeat(64)}`)).status).toBe(404);
    // Nobody signed in is needed, but the page is never cached or indexed.
    const unknown = await open(`${API}/verify-contact/${"f".repeat(64)}`);
    expect(unknown.headers.get("cache-control")).toBe("no-store");

    await db()
      .update(contactEmailVerifications)
      .set({ sentAt: new Date(Date.now() - VERIFY_LINK_TTL_MS - 1000) })
      .where(eq(contactEmailVerifications.siteId, site.id));
    const expired = await open(link);
    expect(expired.status).toBe(410);
    expect((await status("cev_b", site.id, "late@example.org")).verified).toBe(false);

    // A resend issues a fresh token; the old link stays dead.
    await call("cev_b", `/sites/${site.id}/contact-email/verify`, jsonInit("POST", { email: "late@example.org" }), resend);
    expect((await open(link)).status).toBe(404);
    expect((await open(linkIn(sent[1]!.text))).status).toBe(200);
  });

  it("caps verification emails per address per day and answers 503 in store-only mode", async () => {
    const sent = stubResend();
    const site = await makeSite("cev_c", "Cap Org");
    const ask = (bindings: object = resend) =>
      call("cev_c", `/sites/${site.id}/contact-email/verify`, jsonInit("POST", { email: "busy@example.org" }), bindings);
    for (let i = 0; i < MAX_VERIFICATION_SENDS_PER_DAY; i++) expect((await ask()).status).toBe(200);
    const capped = await ask();
    expect(capped.status).toBe(429);
    expect(sent).toHaveLength(MAX_VERIFICATION_SENDS_PER_DAY);

    // A day later the counter starts over.
    await db()
      .update(contactEmailVerifications)
      .set({ sentAt: new Date(Date.now() - 25 * 60 * 60 * 1000) })
      .where(eq(contactEmailVerifications.siteId, site.id));
    expect((await ask()).status).toBe(200);

    expect((await ask(env)).status).toBe(503);
    expect((await status("cev_c", site.id, "busy@example.org", env)).enabled).toBe(false);
  });

  it("validates input, keeps the row out when the send fails, and hides other people's sites", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ message: "no" }, { status: 500 })));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const site = await makeSite("cev_d", "Input Org");
    const verify = (body: unknown, user = "cev_d") => call(user, `/sites/${site.id}/contact-email/verify`, jsonInit("POST", body), resend);
    expect((await verify({ email: "nope" })).status).toBe(400);
    expect((await verify({})).status).toBe(400);
    expect((await verify({ email: "a@b.co" }, "cev_other")).status).toBe(404);
    expect((await call("cev_d", `/sites/${site.id}/contact-email`, {}, resend)).status).toBe(400);
    expect((await call("cev_other", `/sites/${site.id}/contact-email?email=a@b.co`, {}, resend)).status).toBe(404);
    expect((await call(null, `/sites/${site.id}/contact-email?email=a@b.co`, {}, resend)).status).toBe(401);

    const failed = await verify({ email: "owner@example.org" });
    expect(failed.status).toBe(502);
    expect(await db().select().from(contactEmailVerifications).where(eq(contactEmailVerifications.siteId, site.id))).toHaveLength(0);
    expect(errorLog.mock.calls.flat().join(" ")).not.toContain("owner@example.org");
    errorLog.mockRestore();
  });

  it("removes the verification rows with the site", async () => {
    stubResend();
    const site = await makeSite("cev_e", "Delete Org");
    await call("cev_e", `/sites/${site.id}/contact-email/verify`, jsonInit("POST", { email: "gone@example.org" }), resend);
    expect(await db().select().from(contactEmailVerifications).where(eq(contactEmailVerifications.siteId, site.id))).toHaveLength(1);
    expect((await call("cev_e", `/sites/${site.id}`, { method: "DELETE" })).status).toBe(200);
    expect(await db().select().from(contactEmailVerifications).where(eq(contactEmailVerifications.siteId, site.id))).toHaveLength(0);
  });
});
