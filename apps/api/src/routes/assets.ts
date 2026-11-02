import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { loadAuthorizedSite } from "../access";
import { assets } from "../db/schema";
import { newId } from "../ids";
import { limitsFor } from "../limits";
import type { AppEnv } from "../types";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
/** Multipart framing overhead on top of the file itself. */
const MAX_BODY_BYTES = MAX_FILE_BYTES + 64 * 1024;

const ALLOWED_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;
type AllowedType = keyof typeof ALLOWED_TYPES;

const KEY_PATTERN = /^sites\/[A-Za-z0-9_-]+\/[0-9a-f-]{36}\.(?:jpg|png|webp)$/;

function isAllowedType(type: string): type is AllowedType {
  return Object.hasOwn(ALLOWED_TYPES, type);
}

/** The declared content type is client-controlled, so confirm it against the file's magic bytes. */
function matchesMagicBytes(type: AllowedType, b: Uint8Array): boolean {
  switch (type) {
    case "image/jpeg":
      return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    case "image/png":
      return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
    case "image/webp":
      // "RIFF" .... "WEBP"
      return (
        b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
        b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
      );
  }
}

function optionalDimension(value: unknown): number | null {
  if (typeof value !== "string" || value === "") return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n <= 20000 ? n : null;
}

export const assetRoutes = new Hono<AppEnv>();

assetRoutes.post(
  "/sites/:id/assets",
  bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => c.json({ error: "File too large (max 5 MB)" }, 413) }),
  async (c) => {
    const db = drizzle(c.env.DB);
    const site = await loadAuthorizedSite(db, c.var.user, c.req.param("id"));
    if (!site) return c.json({ error: "Site not found" }, 404);

    const form = await c.req.parseBody().catch(() => null);
    if (!form) return c.json({ error: "Body must be multipart/form-data" }, 400);
    const file = form["file"];
    if (!(file instanceof File)) return c.json({ error: "Missing file field" }, 400);
    if (file.size === 0) return c.json({ error: "File is empty" }, 400);
    if (file.size > MAX_FILE_BYTES) return c.json({ error: "File too large (max 5 MB)" }, 413);
    if (!isAllowedType(file.type)) return c.json({ error: "Only JPEG, PNG and WebP images are allowed" }, 415);

    const bytes = await file.arrayBuffer();
    if (!matchesMagicBytes(file.type, new Uint8Array(bytes, 0, Math.min(12, bytes.byteLength)))) {
      return c.json({ error: "File content does not match its declared type" }, 415);
    }

    // Storage per site is the sum of what its uploads weigh; refuse the file that would push it over.
    const { maxSiteStorageBytes } = limitsFor(c.env);
    const [stored] = await db
      .select({ total: sql<number>`coalesce(sum(${assets.bytes}), 0)` })
      .from(assets)
      .where(eq(assets.siteId, site.id));
    if ((stored?.total ?? 0) + bytes.byteLength > maxSiteStorageBytes) {
      return c.json({ error: "Site storage limit reached. Delete unused images first.", limit: maxSiteStorageBytes }, 413);
    }

    const key = `sites/${site.id}/${crypto.randomUUID()}.${ALLOWED_TYPES[file.type]}`;
    const alt = typeof form["alt"] === "string" ? form["alt"].slice(0, 500) : "";
    const id = newId("ast");

    await c.env.IMAGES.put(key, bytes, { httpMetadata: { contentType: file.type } });
    try {
      await db.insert(assets).values({
        id,
        siteId: site.id,
        r2Key: key,
        alt,
        width: optionalDimension(form["width"]),
        height: optionalDimension(form["height"]),
        bytes: bytes.byteLength,
        contentType: file.type,
      });
    } catch (err) {
      await c.env.IMAGES.delete(key);
      throw err;
    }

    return c.json({ id, key, url: `/assets/${key}` }, 201);
  },
);

assetRoutes.delete("/sites/:id/assets/:assetId", async (c) => {
  const db = drizzle(c.env.DB);
  const site = await loadAuthorizedSite(db, c.var.user, c.req.param("id"));
  if (!site) return c.json({ error: "Site not found" }, 404);

  const [asset] = await db
    .select()
    .from(assets)
    .where(and(eq(assets.id, c.req.param("assetId")), eq(assets.siteId, site.id)))
    .limit(1);
  if (!asset) return c.json({ error: "Asset not found" }, 404);

  await c.env.IMAGES.delete(asset.r2Key);
  await db.delete(assets).where(eq(assets.id, asset.id));
  return c.json({ ok: true });
});

/** Public: keys contain a random UUID, so they are unguessable. */
assetRoutes.get("/assets/*", async (c) => {
  let key: string;
  try {
    key = decodeURIComponent(c.req.path.slice("/assets/".length));
  } catch {
    return c.json({ error: "Not found" }, 404);
  }
  if (!KEY_PATTERN.test(key)) return c.json({ error: "Not found" }, 404);

  const object = await c.env.IMAGES.get(key, { onlyIf: c.req.raw.headers });
  if (!object) return c.json({ error: "Not found" }, 404);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("ETag", object.httpEtag);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Cross-Origin-Resource-Policy", "cross-origin");

  // With `onlyIf`, R2 returns an object without a body when the precondition (If-None-Match) fails.
  if (!("body" in object)) return new Response(null, { status: 304, headers });
  return new Response(object.body, { headers });
});
