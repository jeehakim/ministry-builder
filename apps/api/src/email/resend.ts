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
