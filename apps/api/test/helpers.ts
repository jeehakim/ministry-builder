import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { users } from "../src/db/schema";
import { assetRoutes } from "../src/routes/assets";
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
app.route("/", siteRoutes);
app.route("/", assetRoutes);

export function call(user: string | null, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (user) headers.set("x-test-user", user);
  return Promise.resolve(app.request(path, { ...init, headers }, env));
}

export function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}
