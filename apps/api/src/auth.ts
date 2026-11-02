import { verifyToken } from "@clerk/backend";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { users } from "./db/schema";
import type { AppEnv, AuthUser } from "./types";

function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, token, ...rest] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token || rest.length > 0) return null;
  return token;
}

export const STAFF_USER_ID = "staff-bot";

/** Constant-time string compare. Hashing first gives both sides the same length, which timingSafeEqual requires. */
async function tokensMatch(given: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(given)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}

/**
 * Authenticates a request as the staff automation user (admin) when it carries the shared
 * X-Staff-Token. An unset or empty STAFF_API_TOKEN disables this path entirely.
 */
async function staffUser(c: Context<AppEnv>): Promise<AuthUser | null> {
  const expected = c.env.STAFF_API_TOKEN;
  const given = c.req.header("X-Staff-Token");
  if (!expected || !given || !(await tokensMatch(given, expected))) return null;
  await drizzle(c.env.DB)
    .insert(users)
    .values({ id: STAFF_USER_ID, email: null, role: "admin" })
    .onConflictDoUpdate({ target: users.id, set: { role: "admin" } });
  return { id: STAFF_USER_ID, email: null, role: "admin" };
}

/**
 * Makes the matching `users` row available as `c.var.user`. Accepts either the staff token
 * or a Clerk session JWT, which is verified here.
 */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const staff = await staffUser(c);
  if (staff) {
    c.set("user", staff);
    return next();
  }

  const token = bearerToken(c.req.header("Authorization"));
  if (!token) return c.json({ error: "Missing bearer token" }, 401);

  let claims: Awaited<ReturnType<typeof verifyToken>>;
  try {
    claims = await verifyToken(token, {
      secretKey: c.env.CLERK_SECRET_KEY,
      authorizedParties: [c.env.ALLOWED_ORIGIN],
    });
  } catch {
    return c.json({ error: "Invalid or expired token" }, 401);
  }

  const clerkId = claims.sub;
  const email = typeof claims["email"] === "string" ? claims["email"] : null;
  const db = drizzle(c.env.DB);

  const [existing] = await db.select().from(users).where(eq(users.id, clerkId)).limit(1);
  let user: AuthUser;
  if (!existing) {
    await db.insert(users).values({ id: clerkId, email }).onConflictDoNothing();
    const [created] = await db.select().from(users).where(eq(users.id, clerkId)).limit(1);
    if (!created) return c.json({ error: "Could not load user" }, 500);
    user = { id: created.id, email: created.email, role: created.role };
  } else {
    if (email && email !== existing.email) {
      await db.update(users).set({ email }).where(eq(users.id, clerkId));
    }
    user = { id: existing.id, email: email ?? existing.email, role: existing.role };
  }

  c.set("user", user);
  await next();
});
