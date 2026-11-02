import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { users } from "../src/db/schema";
import { adminRoutes } from "../src/routes/admin";
import { aiRoutes } from "../src/routes/ai";
import { assetRoutes } from "../src/routes/assets";
import { domainRoutes } from "../src/routes/domains";
import { integrationRoutes } from "../src/routes/integrations";
import { messageRoutes } from "../src/routes/messages";
import { orgRoutes } from "../src/routes/orgs";
import { publishRoutes } from "../src/routes/publish";
import { siteRoutes } from "../src/routes/sites";
import { webhookRoutes } from "../src/routes/webhooks";
import type { AppEnv } from "../src/types";

/**
 * The real app verifies Clerk JWTs, which needs the network. Tests mount the same route
 * modules behind a stand-in middleware that trusts an `x-test-user: <id>[:admin]` header,
 * plus an optional `x-test-email` for the signed-in address (invitations match on it).
 */
const fakeAuth = createMiddleware<AppEnv>(async (c, next) => {
  const [id, roleHeader = "member"] = (c.req.header("x-test-user") ?? "").split(":");
  const role = roleHeader === "admin" ? "admin" : "member";
  if (!id) return c.json({ error: "unauthenticated" }, 401);
  const email = c.req.header("x-test-email") ?? null;
  const db = drizzle(c.env.DB);
  if (email) {
    await db.insert(users).values({ id, role, email }).onConflictDoUpdate({ target: users.id, set: { email } });
  } else {
    await db.insert(users).values({ id, role }).onConflictDoNothing();
  }
  c.set("user", { id, email, role });
  await next();
});

const app = new Hono<AppEnv>();
app.use("/sites", fakeAuth);
app.use("/sites/*", fakeAuth);
app.use("/ai/*", fakeAuth);
app.use("/admin/*", fakeAuth);
app.use("/orgs", fakeAuth);
app.use("/orgs/*", fakeAuth);
app.use("/invitations/:token/accept", fakeAuth);
app.route("/", siteRoutes);
app.route("/", assetRoutes);
app.route("/", aiRoutes);
app.route("/", publishRoutes);
app.route("/", domainRoutes);
app.route("/", messageRoutes);
app.route("/", integrationRoutes);
app.route("/", orgRoutes);
app.route("/", webhookRoutes);
app.route("/", adminRoutes);

export function call(
  user: string | null,
  path: string,
  init: RequestInit = {},
  bindings: object = env,
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (user) headers.set("x-test-user", user);
  return Promise.resolve(app.request(path, { ...init, headers }, bindings));
}

/** Like `call`, with the signed-in email the fake auth should report. */
export function callAs(user: string, email: string, path: string, init: RequestInit = {}, bindings: object = env): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("x-test-email", email);
  return call(user, path, { ...init, headers }, bindings);
}

export function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

export type TestSite = { id: string; slug: string; orgId: string; versionId: string };

export async function makeSite(user: string, orgName: string, slug?: string): Promise<TestSite> {
  const res = await call(user, "/sites", jsonInit("POST", slug ? { orgName, slug } : { orgName }));
  if (res.status !== 201) throw new Error(`createSite failed: ${res.status}`);
  const body = (await res.json()) as { site: { id: string; slug: string; orgId: string }; versionId: string };
  return { ...body.site, versionId: body.versionId };
}

/** Smallest bytes the upload route accepts as a PNG (it checks the magic bytes only). */
export const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

export async function uploadPng(user: string, siteId: string): Promise<{ id: string; key: string }> {
  const form = new FormData();
  form.set("file", new File([PNG_BYTES], "f.png", { type: "image/png" }));
  const res = await call(user, `/sites/${siteId}/assets`, { method: "POST", body: form });
  if (res.status !== 201) throw new Error(`upload failed: ${res.status}`);
  return (await res.json()) as { id: string; key: string };
}
