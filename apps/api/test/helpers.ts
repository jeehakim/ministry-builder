import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { contactEmailVerifications, domains, users } from "../src/db/schema";
import { newId } from "../src/ids";
import { adminRoutes } from "../src/routes/admin";
import { aiRoutes } from "../src/routes/ai";
import { assetRoutes } from "../src/routes/assets";
import { campaignRoutes } from "../src/routes/campaigns";
import { contactEmailRoutes } from "../src/routes/contactEmail";
import { domainRoutes } from "../src/routes/domains";
import { integrationRoutes } from "../src/routes/integrations";
import { messageRoutes } from "../src/routes/messages";
import { publishRoutes } from "../src/routes/publish";
import { siteRoutes } from "../src/routes/sites";
import type { AppEnv } from "../src/types";

/**
 * The real app verifies Clerk JWTs, which needs the network. Tests mount the same route
 * modules behind a stand-in middleware that trusts an `x-test-user: <id>[:admin]` header.
 */
const fakeAuth = createMiddleware<AppEnv>(async (c, next) => {
  const [id, roleHeader = "member"] = (c.req.header("x-test-user") ?? "").split(":");
  const role = roleHeader === "admin" ? "admin" : "member";
  if (!id) return c.json({ error: "unauthenticated" }, 401);
  await drizzle(c.env.DB).insert(users).values({ id, role }).onConflictDoNothing();
  c.set("user", { id, email: null, role });
  await next();
});

const app = new Hono<AppEnv>();
app.use("/sites", fakeAuth);
app.use("/sites/*", fakeAuth);
app.use("/ai/*", fakeAuth);
app.use("/admin/*", fakeAuth);
app.use("/orgs/*", fakeAuth);
app.route("/", siteRoutes);
app.route("/", assetRoutes);
app.route("/", aiRoutes);
app.route("/", campaignRoutes);
app.route("/", publishRoutes);
app.route("/", domainRoutes);
app.route("/", messageRoutes);
app.route("/", contactEmailRoutes);
app.route("/", integrationRoutes);
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

/** Inserts a domain row that is already live (ownership proved, hostname active, certificate deployed). */
export async function insertActiveDomain(siteId: string, hostname: string, kind: "primary" | "redirect" = "primary"): Promise<string> {
  const id = newId("dom");
  const now = new Date();
  await drizzle(env.DB).insert(domains).values({
    id,
    siteId,
    hostname,
    kind,
    cfCustomHostnameId: `cfh_${id}`,
    sslStatus: "active",
    verifiedAt: now,
    verificationToken: "0123456789abcdef0123456789abcdef",
    ownershipVerifiedAt: now,
  });
  return id;
}

/** Marks `email` as a verified contact address for the site, as if its owner had opened the link. */
export async function verifyContactEmail(siteId: string, email: string): Promise<void> {
  await drizzle(env.DB).insert(contactEmailVerifications).values({
    id: newId("cev"),
    siteId,
    email: email.trim().toLowerCase(),
    token: crypto.randomUUID().replace(/-/g, "").repeat(2),
    verifiedAt: new Date(),
  });
}
