import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { requireSiteRole } from "../access";
import {
  isContactEmailVerified,
  MAX_VERIFICATION_SENDS_PER_DAY,
  newVerificationToken,
  nextSendCount,
  normalizeEmail,
  sendAllowed,
  VERIFY_LINK_TTL_MS,
} from "../contactEmail";
import { contactEmailVerifications, organizations, sites, type ContactEmailVerification } from "../db/schema";
import { createSender } from "../email";
import { contactVerificationEmail } from "../email/verification";
import { newId } from "../ids";
import { errorFields, logError, requestIdOf } from "../log";
import type { AppEnv, Bindings } from "../types";

// Something@something.tld with no whitespace and none of the characters that could add a second address.
const EMAIL_PATTERN = /^[^\s@<>(),;:\\"[\]]+@[^\s@<>(),;:\\"[\]]+\.[^\s@<>(),;:\\"[\]]+$/;
const TOKEN_PATTERN = /^[0-9a-f]{64}$/;
const SEND_TIMEOUT_MS = 10_000;
const NO_STORE = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

const VerifyBody = z.object({ email: z.string().min(3).max(200) });

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

function page(status: number, title: string, body: string): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;color:#1a1a1a}main{max-width:28rem;padding:1.5rem;text-align:center}</style>
</head>
<body>
<main>
<h1>${escapeHtml(title)}</h1>
<p>${escapeHtml(body)}</p>
</main>
</body>
</html>
`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", ...NO_STORE } });
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Email send timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Where the verification link points: this API's public hostname, else the origin the request came in on. */
export function verifyLinkBase(env: Pick<Bindings, "PUBLIC_API_HOST">, requestUrl: string): string {
  return env.PUBLIC_API_HOST ? `https://${env.PUBLIC_API_HOST}` : new URL(requestUrl).origin;
}

function statusView(email: string, row: ContactEmailVerification | undefined, enabled: boolean) {
  return {
    email,
    /** True when the contact form may email this address. */
    verified: row?.verifiedAt !== null && row?.verifiedAt !== undefined,
    verifiedAt: row?.verifiedAt?.toISOString() ?? null,
    /** When the last verification email went out, null if none was ever sent. */
    sentAt: row && !row.verifiedAt ? row.sentAt.toISOString() : null,
    /** False in store-only mode: no email leaves the server, so verification is moot. */
    enabled,
  };
}

/**
 * Double opt-in for the address a site's contact form delivers to. The owner asks for a verification
 * email (authenticated), the recipient opens the link (public), and only then does `contact.ts` email
 * messages there. Store-only mode (no email provider) needs none of this.
 */
export const contactEmailRoutes = new Hono<AppEnv>();

contactEmailRoutes.get("/sites/:id/contact-email", async (c) => {
  const db = drizzle(c.env.DB);
  const access = await requireSiteRole(c, db, c.req.param("id"), "viewer");
  if (access instanceof Response) return access;
  const { site } = access;
  const email = normalizeEmail(c.req.query("email") ?? "");
  if (!EMAIL_PATTERN.test(email)) return c.json({ error: "email is required" }, 400);
  const [row] = await db
    .select()
    .from(contactEmailVerifications)
    .where(and(eq(contactEmailVerifications.siteId, site.id), eq(contactEmailVerifications.email, email)))
    .limit(1);
  return c.json(statusView(email, row, createSender(c.env) !== null));
});

contactEmailRoutes.post(
  "/sites/:id/contact-email/verify",
  bodyLimit({ maxSize: 4 * 1024, onError: (c) => c.json({ error: "Body too large" }, 413) }),
  async (c) => {
    const db = drizzle(c.env.DB);
    const access = await requireSiteRole(c, db, c.req.param("id"), "editor");
    if (access instanceof Response) return access;
    const { site } = access;
    const parsed = VerifyBody.safeParse(await c.req.json().catch(() => null));
    const email = parsed.success ? normalizeEmail(parsed.data.email) : "";
    if (!EMAIL_PATTERN.test(email)) return c.json({ error: "Enter a valid email address" }, 400);

    const sender = createSender(c.env);
    if (!sender) {
      return c.json({ error: "Email delivery is not enabled on this server. Messages are kept in your inbox instead." }, 503);
    }

    const [existing] = await db
      .select()
      .from(contactEmailVerifications)
      .where(and(eq(contactEmailVerifications.siteId, site.id), eq(contactEmailVerifications.email, email)))
      .limit(1);
    if (existing?.verifiedAt) return c.json(statusView(email, existing, true));

    const now = new Date();
    if (existing && !sendAllowed(existing, now)) {
      return c.json(
        { error: `Only ${MAX_VERIFICATION_SENDS_PER_DAY} verification emails a day can go to one address. Check the inbox and its spam folder.` },
        429,
      );
    }

    const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, site.orgId)).limit(1);
    const token = newVerificationToken();
    const link = `${verifyLinkBase(c.env, c.req.url)}/verify-contact/${token}`;
    try {
      await withTimeout(
        sender.send(contactVerificationEmail({ orgName: org?.name ?? "", link, expiresInDays: VERIFY_LINK_TTL_MS / (24 * 60 * 60 * 1000) }, email)),
        SEND_TIMEOUT_MS,
      );
    } catch (err) {
      // The address never reaches the log; the provider's reason is scrubbed.
      logError("contact_verification_email_failed", requestIdOf(c), { site_id: site.id, ...errorFields(err) });
      return c.json({ error: "The verification email could not be sent. Please try again in a moment." }, 502);
    }

    // The row is written after the send, so a provider failure leaves no half-state behind.
    const row: ContactEmailVerification = existing
      ? { ...existing, token, sentAt: now, sendCount: nextSendCount(existing, now) }
      : { id: newId("cev"), siteId: site.id, email, token, sentAt: now, sendCount: 1, verifiedAt: null, createdAt: now };
    if (existing) {
      await db
        .update(contactEmailVerifications)
        .set({ token, sentAt: now, sendCount: row.sendCount })
        .where(eq(contactEmailVerifications.id, existing.id));
    } else {
      await db.insert(contactEmailVerifications).values(row);
    }
    return c.json(statusView(email, row, true));
  },
);

/** Public: the link in the verification email. Marks the address verified for its site. */
contactEmailRoutes.get("/verify-contact/:token", async (c) => {
  const token = c.req.param("token");
  if (!TOKEN_PATTERN.test(token)) return page(404, "Link not recognised", "This verification link is not valid.");
  const db = drizzle(c.env.DB);
  const [row] = await db
    .select({ verification: contactEmailVerifications, orgName: organizations.name })
    .from(contactEmailVerifications)
    .innerJoin(sites, eq(contactEmailVerifications.siteId, sites.id))
    .innerJoin(organizations, eq(sites.orgId, organizations.id))
    .where(eq(contactEmailVerifications.token, token))
    .limit(1);
  if (!row) return page(404, "Link not recognised", "This verification link is not valid. Ask for a new one from the site editor.");
  const { verification } = row;
  if (verification.verifiedAt) {
    return page(200, "Already confirmed", `Messages from the ${row.orgName} website are delivered to ${verification.email}.`);
  }
  if (Date.now() - verification.sentAt.getTime() > VERIFY_LINK_TTL_MS) {
    return page(410, "Link expired", "This verification link has expired. Ask for a new one from the site editor.");
  }
  await db.update(contactEmailVerifications).set({ verifiedAt: new Date() }).where(eq(contactEmailVerifications.id, verification.id));
  return page(200, "Address confirmed", `Messages from the ${row.orgName} website will now be delivered to ${verification.email}.`);
});

export { isContactEmailVerified };
