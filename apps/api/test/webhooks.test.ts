import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";
import { orgMembers, organizations, users } from "../src/db/schema";
import realApp from "../src/index";
import { signSvix, verifySvixSignature } from "../src/webhooks/svix";
import { call, makeSite } from "./helpers";

const SECRET = env.CLERK_WEBHOOK_SECRET!;
const db = () => drizzle(env.DB);

async function post(body: string, headers: Record<string, string | undefined>, bindings: object = env): Promise<Response> {
  const h = new Headers({ "content-type": "application/json" });
  for (const [k, v] of Object.entries(headers)) if (v !== undefined) h.set(k, v);
  return realApp.request("/webhooks/clerk", { method: "POST", headers: h, body }, bindings);
}

async function signed(body: string, at: number = Math.floor(Date.now() / 1000), secret = SECRET) {
  const s = await signSvix(secret, `msg_${crypto.randomUUID()}`, at, body);
  return { "svix-id": s.id, "svix-timestamp": s.timestamp, "svix-signature": s.signature };
}

async function addMember(orgId: string, userId: string, role: "owner" | "admin" | "editor" | "viewer", email: string | null = null) {
  await db().insert(users).values({ id: userId, email }).onConflictDoUpdate({ target: users.id, set: { email } });
  await db().insert(orgMembers).values({ orgId, userId, role, invitedBy: null });
}

async function roleOf(orgId: string, userId: string) {
  const [row] = await db()
    .select({ role: orgMembers.role })
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)))
    .limit(1);
  return row?.role ?? null;
}

describe("Svix signature verification", () => {
  it("accepts a correct signature and refuses tampering, stale timestamps and other secrets", async () => {
    const body = JSON.stringify({ type: "x", data: {} });
    const now = 1_800_000_000_000;
    const headers = await signSvix(SECRET, "msg_1", now / 1000, body);
    expect(await verifySvixSignature(SECRET, headers, body, now)).toBe(true);
    expect(await verifySvixSignature(SECRET, headers, body + " ", now)).toBe(false);
    expect(await verifySvixSignature(SECRET, { ...headers, id: "msg_2" }, body, now)).toBe(false);
    expect(await verifySvixSignature(SECRET, headers, body, now + 6 * 60 * 1000)).toBe(false);
    expect(await verifySvixSignature(SECRET, headers, body, now - 6 * 60 * 1000)).toBe(false);
    expect(await verifySvixSignature("whsec_b3RoZXItc2VjcmV0", headers, body, now)).toBe(false);
    expect(await verifySvixSignature(SECRET, { ...headers, signature: "v0,abc" }, body, now)).toBe(false);
    expect(await verifySvixSignature(SECRET, { ...headers, signature: undefined }, body, now)).toBe(false);
    expect(await verifySvixSignature("whsec_###", headers, body, now)).toBe(false);
    // Several entries during a rotation: any valid one passes.
    expect(await verifySvixSignature(SECRET, { ...headers, signature: `v1,AAAA ${headers.signature}` }, body, now)).toBe(true);
  });
});

describe("POST /webhooks/clerk", () => {
  it("refuses unsigned, badly signed and stale requests, and is off without a secret", async () => {
    const body = JSON.stringify({ type: "user.deleted", data: { id: "nobody" } });
    expect((await post(body, {})).status).toBe(401);
    expect((await post(body, { ...(await signed(body)), "svix-signature": "v1,bogus" })).status).toBe(401);
    expect((await post(body, await signed(body, Math.floor(Date.now() / 1000) - 3600))).status).toBe(401);
    expect((await post(body, await signed(body), { ...env, CLERK_WEBHOOK_SECRET: "" })).status).toBe(503);
    expect((await post("not json", await signed("not json"))).status).toBe(400);
  });

  it("acknowledges other event types without acting", async () => {
    const body = JSON.stringify({ type: "user.created", data: { id: "someone" } });
    const res = await post(body, await signed(body));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, handled: false });
  });

  it("removes a deleted account's memberships, anonymizes its email, promotes a replacement owner and keeps the content", async () => {
    const site = await makeSite("wh_owner", "Webhook Org");
    await db().update(users).set({ email: "owner@example.org" }).where(eq(users.id, "wh_owner"));
    await addMember(site.orgId, "wh_admin", "admin", "admin@example.org");
    await addMember(site.orgId, "wh_viewer", "viewer", "viewer@example.org");
    const other = await makeSite("wh_other_owner", "Other Webhook Org");
    await addMember(other.orgId, "wh_owner", "editor", "owner@example.org");

    const body = JSON.stringify({ type: "user.deleted", object: "event", data: { id: "wh_owner", deleted: true, object: "user" } });
    const res = await post(body, await signed(body));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, handled: true, organizations: 2 });

    expect(await roleOf(site.orgId, "wh_owner")).toBeNull();
    expect(await roleOf(other.orgId, "wh_owner")).toBeNull();
    expect(await roleOf(site.orgId, "wh_admin")).toBe("owner");
    expect(await roleOf(other.orgId, "wh_other_owner")).toBe("owner");
    const [org] = await db().select({ ownerUserId: organizations.ownerUserId }).from(organizations).where(eq(organizations.id, site.orgId));
    expect(org?.ownerUserId).toBe("wh_admin");
    const [user] = await db().select({ email: users.email }).from(users).where(eq(users.id, "wh_owner"));
    expect(user?.email).toBeNull();

    // The site and its versions are still there for the team.
    expect((await call("wh_admin", `/sites/${site.id}`)).status).toBe(200);
    expect((await call("wh_owner", `/sites/${site.id}`)).status).toBe(404);
    const events = (await (await call("wh_viewer", `/orgs/${site.orgId}/events`)).json()) as { events: { action: string; actorUserId: string | null; detail: Record<string, unknown> | null }[] };
    expect(events.events.map((e) => e.action)).toEqual(["member.role_changed", "member.removed"]);
    expect(events.events[1]).toMatchObject({ actorUserId: null, detail: { email: "owner@example.org", role: "owner", reason: "account_deleted" } });

    // Delivered twice (Svix retries): nothing more to do, still 200.
    const again = await post(body, await signed(body));
    expect(await again.json()).toEqual({ ok: true, handled: true, organizations: 0 });
  });

  it("leaves an organization with no remaining members reachable by staff only", async () => {
    const site = await makeSite("wh_solo", "Solo Org");
    const body = JSON.stringify({ type: "user.deleted", data: { id: "wh_solo" } });
    expect((await post(body, await signed(body))).status).toBe(200);
    expect(await roleOf(site.orgId, "wh_solo")).toBeNull();
    expect((await call("wh_staff:admin", `/sites/${site.id}`)).status).toBe(200);
    const [org] = await db().select({ ownerUserId: organizations.ownerUserId }).from(organizations).where(eq(organizations.id, site.orgId));
    expect(org?.ownerUserId).toBe("wh_solo");
  });
});
