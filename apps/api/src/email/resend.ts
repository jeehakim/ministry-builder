import type { EmailSender } from "./sender";

const RESEND_URL = "https://api.resend.com/emails";
const TIMEOUT_MS = 8000;

/** Resend (https://resend.com/docs/api-reference/emails/send-email) over plain fetch. */
export function resendSender(apiKey: string, from: string): EmailSender {
  return {
    async send(msg) {
      const res = await fetch(RESEND_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from,
          to: [msg.to],
          ...(msg.replyTo ? { reply_to: msg.replyTo } : {}),
          subject: msg.subject,
          text: msg.text,
          html: msg.html,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const detail = body && typeof body === "object" ? (body as { message?: unknown }).message : undefined;
        throw new Error(`Resend responded ${res.status}${typeof detail === "string" ? `: ${detail}` : ""}`);
      }
      const id = body && typeof body === "object" ? (body as { id?: unknown }).id : undefined;
      return typeof id === "string" ? { id } : {};
    },
  };
}

const RESEND_DOMAINS_URL = "https://api.resend.com/domains";

/** Resend answered 401 or 403: the key is wrong, revoked, or lacks permission to list domains. */
export class ResendKeyRejectedError extends Error {
  constructor() {
    super("Resend rejected this key");
    this.name = "ResendKeyRejectedError";
  }
}

/** Resend could not be reached or answered something unusable (network, timeout, 5xx, bad body). */
export class ResendUnavailableError extends Error {
  constructor(detail: string) {
    super(`Could not reach Resend: ${detail}`);
    this.name = "ResendUnavailableError";
  }
}

/**
 * Names of the domains with status "verified" in the account that owns `apiKey` (lowercase, sorted).
 * Doubles as the key check: listing domains needs a full-access key, so a sending-only key is rejected too.
 * Throws ResendKeyRejectedError or ResendUnavailableError.
 */
export async function listVerifiedResendDomains(apiKey: string): Promise<string[]> {
  let res: Response;
  try {
    res = await fetch(RESEND_DOMAINS_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new ResendUnavailableError(err instanceof Error && err.name === "TimeoutError" ? "the request timed out" : "the request failed");
  }
  if (res.status === 401 || res.status === 403) throw new ResendKeyRejectedError();
  if (!res.ok) throw new ResendUnavailableError(`Resend responded ${res.status}`);
  const body: unknown = await res.json().catch(() => null);
  const data = body && typeof body === "object" ? (body as { data?: unknown }).data : undefined;
  if (!Array.isArray(data)) throw new ResendUnavailableError("unexpected response");
  const names = data.flatMap((d: unknown) => {
    if (!d || typeof d !== "object") return [];
    const { name, status } = d as { name?: unknown; status?: unknown };
    return status === "verified" && typeof name === "string" && name ? [name.toLowerCase()] : [];
  });
  return [...new Set(names)].sort();
}
