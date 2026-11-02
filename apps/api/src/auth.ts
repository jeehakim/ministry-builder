import { verifyToken } from "@clerk/backend";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { createMiddleware } from "hono/factory";
import { users } from "./db/schema";
import type { AppEnv, AuthUser } from "./types";

function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, token, ...rest] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token || rest.length > 0) return null;
  return token;
}

/** Verifies the Clerk session JWT and makes the matching `users` row available as `c.var.user`. */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
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
