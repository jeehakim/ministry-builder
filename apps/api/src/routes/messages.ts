import { and, count, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { requireSiteRole } from "../access";
import { formSubmissions } from "../db/schema";
import type { AppEnv } from "../types";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** Contact-form messages left by visitors of a site, readable only by its owner (or an admin). */
export const messageRoutes = new Hono<AppEnv>();

messageRoutes.get("/sites/:id/messages", async (c) => {
  const db = drizzle(c.env.DB);
  const access = await requireSiteRole(c, db, c.req.param("id"), "viewer");
  if (access instanceof Response) return access;
  const { site } = access;

  const requested = Number.parseInt(c.req.query("limit") ?? "", 10);
  const limit = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), MAX_LIMIT) : DEFAULT_LIMIT;

  const messages = await db
    .select({
      id: formSubmissions.id,
      name: formSubmissions.name,
      email: formSubmissions.email,
      message: formSubmissions.message,
      language: formSubmissions.language,
      createdAt: formSubmissions.createdAt,
      deliveredAt: formSubmissions.deliveredAt,
      deliveryError: formSubmissions.deliveryError,
    })
    .from(formSubmissions)
    .where(eq(formSubmissions.siteId, site.id))
    .orderBy(desc(formSubmissions.createdAt), desc(formSubmissions.id))
    .limit(limit);
  return c.json({ messages });
});

messageRoutes.delete("/sites/:id/messages/:msgId", async (c) => {
  const db = drizzle(c.env.DB);
  const access = await requireSiteRole(c, db, c.req.param("id"), "editor");
  if (access instanceof Response) return access;
  const { site } = access;

  const [message] = await db
    .select({ id: formSubmissions.id })
    .from(formSubmissions)
    .where(and(eq(formSubmissions.id, c.req.param("msgId")), eq(formSubmissions.siteId, site.id)))
    .limit(1);
  if (!message) return c.json({ error: "Message not found" }, 404);

  await db.delete(formSubmissions).where(eq(formSubmissions.id, message.id));
  return c.json({ ok: true });
});

/** Total stored messages for a site, shown as a badge in the editor. */
export async function countMessages(db: ReturnType<typeof drizzle>, siteId: string): Promise<number> {
  const [row] = await db.select({ n: count() }).from(formSubmissions).where(eq(formSubmissions.siteId, siteId));
  return row?.n ?? 0;
}
