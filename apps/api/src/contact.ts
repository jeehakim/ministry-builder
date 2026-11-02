import { SiteDocument, siteLanguages } from "@ministry/schema";
import { and, count, eq, gte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { isContactEmailVerified } from "./contactEmail";
import { createSender } from "./email";
import { resolveOrgSender, type OrgSenderResolution } from "./email/orgSender";
import { contactNotification } from "./email/notification";
import { formSubmissions, siteVersions, sites } from "./db/schema";
import { newId } from "./ids";
import { errorFields, logError, requestIdFor } from "./log";
import { LANGUAGE_PATH_PATTERN } from "./published";
import type { Bindings } from "./types";

/** Limits for the public contact form. */
export const MAX_SUBMISSIONS_PER_IP = 5;
export const IP_WINDOW_MS = 10 * 60 * 1000;
export const MAX_SUBMISSIONS_PER_SITE = 30;
export const SITE_WINDOW_MS = 60 * 60 * 1000;

const MAX_BODY_BYTES = 64 * 1024;
const SEND_TIMEOUT_MS = 10_000;
const MAX_USER_AGENT = 300;
const MAX_DELIVERY_ERROR = 300;
/** Recorded instead of sending when the contact address has not confirmed it wants the site's messages. */
export const NOT_VERIFIED_ERROR = "address not verified";

// Something@something.tld with no whitespace and none of the characters that could add a second address.
const EMAIL_PATTERN = /^[^\s@<>(),;:\\"[\]]+@[^\s@<>(),;:\\"[\]]+\.[^\s@<>(),;:\\"[\]]+$/;

const NO_STORE = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

function page(status: number, title: string, body: string, extra: Record<string, string> = {}): Response {
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
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", ...NO_STORE, ...extra } });
}

function seeOther(location: string): Response {
  return new Response(null, { status: 303, headers: { Location: location, ...NO_STORE } });
}

/** Reads at most MAX_BODY_BYTES of the request body, whether or not it declares a length. */
async function readFormData(request: Request): Promise<FormData | "too_large" | "invalid"> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return "too_large";
  if (!request.body) return "invalid";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      return "too_large";
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return await new Response(bytes, { headers: { "Content-Type": request.headers.get("content-type") ?? "" } }).formData();
  } catch {
    return "invalid";
  }
}

function field(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

async function hashIp(ip: string, salt: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${ip}`));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Email send timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * POST /<slug>/contact on the sites host. `base` is the URL prefix of the site root ("/<slug>" on the
 * path form, "" on the subdomain form). Public and unauthenticated: it validates, rate limits, stores the
 * message and then tries to email it. A delivery failure never reaches the visitor.
 */
export async function handleContactSubmission(
  request: Request,
  env: Bindings,
  slug: string,
  base: string,
  requestId: string = requestIdFor(request),
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "POST", ...NO_STORE } });
  }

  const db = drizzle(env.DB);
  const [site] = await db
    .select({ id: sites.id, orgId: sites.orgId, currentVersionId: sites.currentVersionId })
    .from(sites)
    // Only live sites accept messages: a draft's address was never shown to anyone, so a post to it is abuse.
    .where(and(eq(sites.slug, slug), eq(sites.status, "published")))
    .limit(1);
  const [version] = site?.currentVersionId
    ? await db.select({ document: siteVersions.document }).from(siteVersions).where(eq(siteVersions.id, site.currentVersionId)).limit(1)
    : [];
  let parsed: ReturnType<typeof SiteDocument.safeParse> | null = null;
  try {
    parsed = version ? SiteDocument.safeParse(JSON.parse(version.document)) : null;
  } catch {
    parsed = null;
  }
  const doc = parsed?.success ? parsed.data : null;
  const recipient = doc?.sections.flatMap((s) => (s.type === "contact" && s.email.trim() ? [s.email.trim()] : []))[0];
  if (!site || !doc || !recipient) {
    return page(404, "Page not found", "This site does not accept messages.");
  }

  const form = await readFormData(request);
  if (form === "too_large") return page(413, "Message too large", "Please send a shorter message.");
  if (form === "invalid") return page(400, "Invalid form", "The form could not be read.");

  const primary = doc.meta.language;
  const requested = field(form, "_lang");
  const language = LANGUAGE_PATH_PATTERN.test(requested) && siteLanguages(doc).includes(requested) ? requested : primary;
  const thanks = language === primary ? `${base}/thanks/` : `${base}/${language}/thanks/`;

  // Bots fill the hidden field; they get the same answer as a real visitor and nothing is stored.
  if (field(form, "website")) return seeOther(thanks);

  const name = field(form, "name");
  const email = field(form, "email");
  const message = field(form, "message");
  if (name.length < 1 || name.length > 120) return page(400, "Check your name", "Your name must be 1 to 120 characters.");
  if (email.length < 3 || email.length > 200 || !EMAIL_PATTERN.test(email)) {
    return page(400, "Check your email", "Please enter a valid email address.");
  }
  if (message.length < 1 || message.length > 4000) return page(400, "Check your message", "Your message must be 1 to 4000 characters.");

  const ipHash = await hashIp(request.headers.get("CF-Connecting-IP") ?? "unknown", env.FORM_SALT || "ministry");
  const now = Date.now();
  const [[perIp], [perSite]] = await Promise.all([
    db
      .select({ n: count() })
      .from(formSubmissions)
      .where(and(eq(formSubmissions.ipHash, ipHash), gte(formSubmissions.createdAt, new Date(now - IP_WINDOW_MS)))),
    db
      .select({ n: count() })
      .from(formSubmissions)
      .where(and(eq(formSubmissions.siteId, site.id), gte(formSubmissions.createdAt, new Date(now - SITE_WINDOW_MS)))),
  ]);
  if ((perIp?.n ?? 0) >= MAX_SUBMISSIONS_PER_IP || (perSite?.n ?? 0) >= MAX_SUBMISSIONS_PER_SITE) {
    return page(429, "Too many messages", "Please wait a little while before sending another message.", { "Retry-After": "600" });
  }

  const id = newId("msg");
  await db.insert(formSubmissions).values({
    id,
    siteId: site.id,
    name,
    email,
    message,
    language,
    ipHash,
    userAgent: (request.headers.get("User-Agent") ?? "").slice(0, MAX_USER_AGENT),
  });

  // The organization's own Resend account wins when it is set up. If it then fails, the message is not
  // re-sent from the platform: their sender, their reputation, their error to fix. The platform sender,
  // on the other hand, only emails an address that confirmed the verification link for this site.
  const org = await resolveOrgSender(env, db, site.orgId);
  const platform = createSender(env);
  const choice: OrgSenderResolution = org ?? (platform ? { sender: platform } : null);
  const deliveredVia = org ? "organization" : "platform";
  if (!org && platform && !(await isContactEmailVerified(db, site.id, recipient))) {
    await db.update(formSubmissions).set({ deliveryError: NOT_VERIFIED_ERROR, deliveredVia }).where(eq(formSubmissions.id, id));
  } else if (choice) {
    try {
      if ("error" in choice) throw new Error(choice.error);
      await withTimeout(choice.sender.send(contactNotification({ orgName: doc.meta.orgName, name, email, message, language }, recipient)), SEND_TIMEOUT_MS);
      await db.update(formSubmissions).set({ deliveredAt: new Date(), deliveryError: null, deliveredVia }).where(eq(formSubmissions.id, id));
    } catch (err) {
      const reason = (err instanceof Error ? err.message : String(err)).slice(0, MAX_DELIVERY_ERROR);
      // The visitor's message and address never go to the log; the provider's reason is scrubbed first.
      logError("contact_email_failed", requestId, { site_id: site.id, message_id: id, via: deliveredVia, ...errorFields(err) });
      await db.update(formSubmissions).set({ deliveryError: reason, deliveredVia }).where(eq(formSubmissions.id, id));
    }
  }

  return seeOther(thanks);
}
