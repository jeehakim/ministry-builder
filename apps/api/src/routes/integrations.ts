import {
  SendTestEmailRequest,
  SetResendFromRequest,
  SetResendKeyRequest,
  type IntegrationsResponse,
  type ResendIntegrationView,
} from "@ministry/schema";
import { asc, and, eq, gte, lt, sql } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { requireOrgRole } from "../access";
import { DecryptionError, decryptSecret, encryptSecret, isEncryptionAvailable } from "../crypto";
import { integrationEvents, orgIntegrations, type OrgIntegration, type Organization } from "../db/schema";
import { createSender } from "../email";
import { emailDomain, formatFrom, isSafeDisplayName } from "../email/from";
import { listVerifiedResendDomains, resendSender, ResendKeyRejectedError, ResendUnavailableError } from "../email/resend";
import { recordOrgEvent } from "../events";
import { newId } from "../ids";
import { errorFields, logError, requestIdOf, scrub } from "../log";
import type { AppEnv } from "../types";

/** Attempts per organization per rolling hour. Failed attempts count: the limit exists to stop key guessing. */
export const MAX_KEY_ATTEMPTS_PER_HOUR = 10;
export const MAX_TEST_EMAILS_PER_HOUR = 5;
const WINDOW_MS = 60 * 60 * 1000;
const MAX_LAST_ERROR = 300;

const NOT_ENABLED = "Integrations are not enabled on this server";
const KEY_REJECTED = "Resend rejected this key";

type Ctx = Context<AppEnv>;

/** Organization secrets and status: nothing here may be stored by a browser or an intermediary. */
export const integrationRoutes = new Hono<AppEnv>();
const noStore = async (c: Ctx, next: () => Promise<void>) => {
  await next();
  c.res.headers.set("Cache-Control", "no-store");
};
integrationRoutes.use("/orgs/:id/integrations", noStore);
integrationRoutes.use("/orgs/:id/integrations/*", noStore);

function parseDomains(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((d): d is string => typeof d === "string") : [];
  } catch {
    return [];
  }
}

/** The row as the client may see it: a hint and status, never the key or its ciphertext. */
function resendView(row: OrgIntegration): ResendIntegrationView {
  return {
    provider: "resend",
    keyHint: `…${row.keyHint}`,
    fromAddress: row.fromAddress,
    verifiedDomains: parseDomains(row.verifiedDomainsJson),
    testedAt: row.testedAt?.toISOString() ?? null,
    lastError: row.lastError,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function integrationsResponse(env: AppEnv["Bindings"], row: OrgIntegration | undefined): IntegrationsResponse {
  const activeSender = row?.fromAddress ? "organization" : createSender(env) ? "platform" : "none";
  return { encryptionAvailable: isEncryptionAvailable(env), activeSender, resend: row ? resendView(row) : null };
}

async function loadRow(db: DrizzleD1Database, orgId: string): Promise<OrgIntegration | undefined> {
  const [row] = await db.select().from(orgIntegrations).where(eq(orgIntegrations.orgId, orgId)).limit(1);
  return row;
}

/**
 * Any member may read the integration status; writes need an admin or owner (403 otherwise).
 * 404 when the organization is missing or the caller is not a member; 503 for writes when the server cannot encrypt.
 */
async function authorize(c: Ctx, db: DrizzleD1Database, write: boolean): Promise<Organization | Response> {
  const access = await requireOrgRole(c, db, c.req.param("id") ?? "", write ? "admin" : "viewer");
  if (access instanceof Response) return access;
  if (write && !isEncryptionAvailable(c.env)) return c.json({ error: NOT_ENABLED }, 503);
  return access.org;
}

/**
 * Takes one slot of an hourly limit, atomically (the count and the insert are one statement, so
 * concurrent requests cannot both pass). Returns null on success, else the seconds until a slot frees up.
 */
async function takeSlot(db: DrizzleD1Database, orgId: string, kind: "key_attempt" | "test_email", limit: number): Promise<number | null> {
  const now = Date.now();
  const since = now - WINDOW_MS;
  const inserted = await db.run(sql`
    INSERT INTO integration_events (id, org_id, kind, created_at)
    SELECT ${newId("ievt")}, ${orgId}, ${kind}, ${now}
    WHERE (SELECT count(*) FROM integration_events WHERE org_id = ${orgId} AND kind = ${kind} AND created_at >= ${since}) < ${limit}`);
  if (inserted.meta.changes > 0) {
    await db.delete(integrationEvents).where(and(eq(integrationEvents.orgId, orgId), lt(integrationEvents.createdAt, new Date(now - 24 * WINDOW_MS))));
    return null;
  }
  const recent = await db
    .select({ createdAt: integrationEvents.createdAt })
    .from(integrationEvents)
    .where(and(eq(integrationEvents.orgId, orgId), eq(integrationEvents.kind, kind), gte(integrationEvents.createdAt, new Date(since))))
    .orderBy(asc(integrationEvents.createdAt));
  const blocking = recent[recent.length - limit];
  return Math.max(1, Math.ceil(((blocking?.createdAt.getTime() ?? now) + WINDOW_MS - now) / 1000));
}

function limited(c: Ctx, what: string, limit: number, retryAfter: number): Response {
  return c.json({ error: `Too many ${what} (${limit} per hour). Try again later.`, limit, retryAfterSeconds: retryAfter }, 429, {
    "Retry-After": String(retryAfter),
  });
}

/** A provider error as text safe to store and show: the key itself and anything key-shaped or address-shaped is masked. */
function sanitizeError(err: unknown, apiKey: string): string {
  const raw = err instanceof Error ? err.message : "Unknown error";
  return scrub(raw.split(apiKey).join("[key]"), MAX_LAST_ERROR);
}

const limit4k = bodyLimit({ maxSize: 4 * 1024, onError: (c) => c.json({ error: "Body too large" }, 413) });

integrationRoutes.get("/orgs/:id/integrations", async (c) => {
  const db = drizzle(c.env.DB);
  const org = await authorize(c, db, false);
  if (org instanceof Response) return org;
  return c.json(integrationsResponse(c.env, await loadRow(db, org.id)));
});

integrationRoutes.put("/orgs/:id/integrations/resend/key", limit4k, async (c) => {
  const db = drizzle(c.env.DB);
  const org = await authorize(c, db, true);
  if (org instanceof Response) return org;

  const parsed = SetResendKeyRequest.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, 400);
  const apiKey = parsed.data.apiKey;

  const retryAfter = await takeSlot(db, org.id, "key_attempt", MAX_KEY_ATTEMPTS_PER_HOUR);
  if (retryAfter !== null) return limited(c, "key attempts", MAX_KEY_ATTEMPTS_PER_HOUR, retryAfter);

  let verifiedDomains: string[];
  try {
    verifiedDomains = await listVerifiedResendDomains(apiKey);
  } catch (err) {
    if (err instanceof ResendKeyRejectedError) return c.json({ error: KEY_REJECTED }, 400);
    if (err instanceof ResendUnavailableError) {
      logError("resend_unavailable", requestIdOf(c), { org_id: org.id, ...errorFields(err) });
      return c.json({ error: err.message }, 502);
    }
    throw err;
  }

  const existing = await loadRow(db, org.id);
  // A new key may belong to another Resend account; keep the from address only if its domain is still verified there.
  const keepFrom = existing?.fromAddress ? verifiedDomains.includes(emailDomain(existing.fromAddress) ?? "") : false;
  const fields = {
    encryptedKey: await encryptSecret(c.env, apiKey, org.id),
    keyHint: apiKey.slice(-4),
    fromAddress: keepFrom ? (existing?.fromAddress ?? null) : null,
    fromName: keepFrom ? (existing?.fromName ?? null) : null,
    verifiedDomainsJson: JSON.stringify(verifiedDomains),
    testedAt: null,
    lastError: null,
    updatedAt: new Date(),
  };
  await db
    .insert(orgIntegrations)
    .values({ id: newId("oint"), orgId: org.id, provider: "resend", ...fields })
    .onConflictDoUpdate({ target: orgIntegrations.orgId, set: fields });
  await recordOrgEvent(db, { orgId: org.id, actorUserId: c.var.user.id, action: "integration.connected", target: "resend", detail: { keyHint: fields.keyHint } });
  return c.json(integrationsResponse(c.env, await loadRow(db, org.id)));
});

integrationRoutes.put("/orgs/:id/integrations/resend/from", limit4k, async (c) => {
  const db = drizzle(c.env.DB);
  const org = await authorize(c, db, true);
  if (org instanceof Response) return org;

  const parsed = SetResendFromRequest.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, 400);
  const { fromAddress, fromName } = parsed.data;
  if (fromName && !isSafeDisplayName(fromName)) return c.json({ error: 'The display name cannot contain quotes, angle brackets or backslashes' }, 400);
  const domain = emailDomain(fromAddress);
  if (!domain) return c.json({ error: "That does not look like an email address" }, 400);

  const row = await loadRow(db, org.id);
  if (!row) return c.json({ error: "Add your Resend API key first" }, 409);

  let apiKey: string;
  try {
    apiKey = await decryptSecret(c.env, row.encryptedKey, org.id);
  } catch (err) {
    if (!(err instanceof DecryptionError)) throw err;
    logError("integration_decrypt_failed", requestIdOf(c), { org_id: org.id });
    return c.json({ error: "The stored key could not be read. Enter your Resend API key again." }, 409);
  }

  // Refresh first: the customer may have verified the domain in Resend a minute ago.
  let verifiedDomains: string[];
  try {
    verifiedDomains = await listVerifiedResendDomains(apiKey);
  } catch (err) {
    if (err instanceof ResendKeyRejectedError) {
      await db.update(orgIntegrations).set({ lastError: KEY_REJECTED, updatedAt: new Date() }).where(eq(orgIntegrations.id, row.id));
      return c.json({ error: KEY_REJECTED }, 400);
    }
    if (err instanceof ResendUnavailableError) {
      logError("resend_unavailable", requestIdOf(c), { org_id: org.id, ...errorFields(err) });
      return c.json({ error: err.message }, 502);
    }
    throw err;
  }

  if (!verifiedDomains.includes(domain)) {
    await db
      .update(orgIntegrations)
      .set({ verifiedDomainsJson: JSON.stringify(verifiedDomains), updatedAt: new Date() })
      .where(eq(orgIntegrations.id, row.id));
    return c.json({ error: `${domain} is not a verified domain in your Resend account. Verify it in Resend first.` }, 400);
  }

  await db
    .update(orgIntegrations)
    .set({
      fromAddress,
      fromName: fromName || null,
      verifiedDomainsJson: JSON.stringify(verifiedDomains),
      // A test only vouches for the address it was sent from.
      testedAt: null,
      lastError: null,
      updatedAt: new Date(),
    })
    .where(eq(orgIntegrations.id, row.id));
  await recordOrgEvent(db, { orgId: org.id, actorUserId: c.var.user.id, action: "integration.updated", target: "resend", detail: { fromAddress } });
  return c.json(integrationsResponse(c.env, await loadRow(db, org.id)));
});

integrationRoutes.post("/orgs/:id/integrations/resend/test", limit4k, async (c) => {
  const db = drizzle(c.env.DB);
  const org = await authorize(c, db, true);
  if (org instanceof Response) return org;

  const parsed = SendTestEmailRequest.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, 400);

  const row = await loadRow(db, org.id);
  if (!row) return c.json({ error: "Add your Resend API key first" }, 409);
  if (!row.fromAddress) return c.json({ error: "Choose a from address first" }, 409);

  let apiKey: string;
  try {
    apiKey = await decryptSecret(c.env, row.encryptedKey, org.id);
  } catch (err) {
    if (!(err instanceof DecryptionError)) throw err;
    logError("integration_decrypt_failed", requestIdOf(c), { org_id: org.id });
    return c.json({ error: "The stored key could not be read. Enter your Resend API key again." }, 409);
  }

  const retryAfter = await takeSlot(db, org.id, "test_email", MAX_TEST_EMAILS_PER_HOUR);
  if (retryAfter !== null) return limited(c, "test emails", MAX_TEST_EMAILS_PER_HOUR, retryAfter);

  try {
    await resendSender(apiKey, formatFrom(row.fromAddress, row.fromName)).send({
      to: parsed.data.to,
      subject: "Test email from Ministry Sites",
      text: "This is a test email from Ministry Sites.\n\nYour Resend account is connected. Messages from your website's contact form will arrive from this address.\n",
      html: '<!doctype html>\n<html><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#1a1a1a"><p>This is a test email from Ministry Sites.</p><p>Your Resend account is connected. Messages from your website\'s contact form will arrive from this address.</p></body></html>\n',
    });
  } catch (err) {
    const reason = sanitizeError(err, apiKey);
    logError("integration_test_email_failed", requestIdOf(c), { org_id: org.id, ...errorFields(err) });
    await db.update(orgIntegrations).set({ lastError: reason, updatedAt: new Date() }).where(eq(orgIntegrations.id, row.id));
    return c.json({ error: `Resend could not send the test email: ${reason}` }, 502);
  }

  await db.update(orgIntegrations).set({ testedAt: new Date(), lastError: null, updatedAt: new Date() }).where(eq(orgIntegrations.id, row.id));
  return c.json(integrationsResponse(c.env, await loadRow(db, org.id)));
});

// Deleting needs no encryption: it must stay possible after INTEGRATIONS_KEY is removed or rotated.
integrationRoutes.delete("/orgs/:id/integrations/resend", async (c) => {
  const db = drizzle(c.env.DB);
  const access = await requireOrgRole(c, db, c.req.param("id") ?? "", "admin");
  if (access instanceof Response) return access;
  const org = access.org;
  await db.delete(orgIntegrations).where(eq(orgIntegrations.orgId, org.id));
  await recordOrgEvent(db, { orgId: org.id, actorUserId: c.var.user.id, action: "integration.disconnected", target: "resend" });
  return c.json(integrationsResponse(c.env, undefined));
});
