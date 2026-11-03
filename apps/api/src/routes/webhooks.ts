import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { errorFields, logError, requestIdOf } from "../log";
import { verifySvixSignature } from "../webhooks/svix";
import type { AppEnv } from "../types";
import { removeUserEverywhere } from "./orgs";

/** The slice of a Clerk event we act on. Everything else is acknowledged and ignored. */
const ClerkEvent = z.object({
  type: z.string(),
  data: z.object({ id: z.string().min(1).optional() }).passthrough(),
});

export const webhookRoutes = new Hono<AppEnv>();

/**
 * Clerk webhooks (Svix-signed). Point Clerk at `https://<api host>/webhooks/clerk`, subscribe to `user.deleted`,
 * and store the endpoint's signing secret as CLERK_WEBHOOK_SECRET. Without the secret the endpoint answers 503.
 */
webhookRoutes.post("/webhooks/clerk", bodyLimit({ maxSize: 64 * 1024, onError: (c) => c.json({ error: "Body too large" }, 413) }), async (c) => {
  const secret = c.env.CLERK_WEBHOOK_SECRET;
  if (!secret) return c.json({ error: "Webhooks are not configured on this server" }, 503);

  const body = await c.req.text();
  const valid = await verifySvixSignature(
    secret,
    { id: c.req.header("svix-id"), timestamp: c.req.header("svix-timestamp"), signature: c.req.header("svix-signature") },
    body,
  );
  if (!valid) return c.json({ error: "Invalid signature" }, 401);

  let event: z.infer<typeof ClerkEvent>;
  try {
    event = ClerkEvent.parse(JSON.parse(body));
  } catch (err) {
    logError("webhook_bad_payload", requestIdOf(c), errorFields(err));
    return c.json({ error: "Unreadable event" }, 400);
  }

  if (event.type === "user.deleted" && event.data.id) {
    const result = await removeUserEverywhere(drizzle(c.env.DB), event.data.id);
    return c.json({ ok: true, handled: true, ...result });
  }
  return c.json({ ok: true, handled: false });
});
