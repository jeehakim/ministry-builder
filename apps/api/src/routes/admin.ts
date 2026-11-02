import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { organizations, sites, users } from "../db/schema";
import { publishedUrlFor } from "../published";
import type { AppEnv } from "../types";

const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  if (c.var.user.role !== "admin") return c.json({ error: "Admin access required" }, 403);
  await next();
});

const TransferBody = z.object({ email: z.string().trim().toLowerCase().email().max(254) });

const ClerkUsers = z.union([z.array(z.object({ id: z.string().min(1) })), z.object({ data: z.array(z.object({ id: z.string().min(1) })) })]);

/** Finds the Clerk user id for an email, or null when no such user exists. Throws on Clerk/network failure. */
async function findClerkUserId(secretKey: string, email: string): Promise<string | null> {
  const url = new URL("https://api.clerk.com/v1/users");
  url.searchParams.set("email_address", email);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${secretKey}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Clerk user lookup failed with status ${res.status}`);
  const parsed = ClerkUsers.parse(await res.json());
  const list = Array.isArray(parsed) ? parsed : parsed.data;
  return list[0]?.id ?? null;
}

export const adminRoutes = new Hono<AppEnv>();

adminRoutes.use("/admin/*", requireAdmin);
adminRoutes.use("/orgs/*", requireAdmin);

adminRoutes.get("/admin/sites", async (c) => {
  const rows = await drizzle(c.env.DB)
    .select({
      id: sites.id,
      slug: sites.slug,
      orgId: organizations.id,
      orgName: organizations.name,
      ownerUserId: organizations.ownerUserId,
      templateId: sites.templateId,
      status: sites.status,
      publishedAt: sites.publishedAt,
      publishedPath: sites.publishedPath,
      createdAt: sites.createdAt,
      updatedAt: sites.updatedAt,
    })
    .from(sites)
    .innerJoin(organizations, eq(sites.orgId, organizations.id))
    .orderBy(desc(sites.updatedAt));
  return c.json({
    sites: rows.map(({ publishedPath, ...row }) => ({ ...row, publishedUrl: publishedUrlFor(c.env, publishedPath) })),
  });
});

/** Hands an organization (and with it all its sites) to the person who owns the given email in Clerk. */
adminRoutes.post(
  "/orgs/:id/transfer",
  bodyLimit({ maxSize: 4 * 1024, onError: (c) => c.json({ error: "Body too large" }, 413) }),
  async (c) => {
    const body: unknown = await c.req.json().catch(() => undefined);
    const parsed = TransferBody.safeParse(body);
    if (!parsed.success) return c.json({ error: "email is required and must be a valid address" }, 400);
    const { email } = parsed.data;

    const db = drizzle(c.env.DB);
    const orgId = c.req.param("id");
    const [org] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, orgId)).limit(1);
    if (!org) return c.json({ error: "Organization not found" }, 404);

    let ownerUserId: string | null;
    try {
      ownerUserId = await findClerkUserId(c.env.CLERK_SECRET_KEY, email);
    } catch (err) {
      console.error("Clerk user lookup failed", err);
      return c.json({ error: "Could not look up the user in Clerk" }, 502);
    }
    if (!ownerUserId) return c.json({ error: "No user with that email" }, 404);

    await db.batch([
      db
        .insert(users)
        .values({ id: ownerUserId, email })
        .onConflictDoUpdate({ target: users.id, set: { email } }),
      db.update(organizations).set({ ownerUserId }).where(eq(organizations.id, orgId)),
    ]);
    return c.json({ orgId, ownerUserId });
  },
);
