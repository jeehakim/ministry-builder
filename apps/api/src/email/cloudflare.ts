import type { EmailBinding } from "../types";
import type { EmailSender } from "./sender";

/** Cloudflare Email Sending through the `send_email` Workers binding. */
export function cloudflareSender(binding: EmailBinding, from: string): EmailSender {
  return {
    async send(msg) {
      const result = await binding.send({
        from,
        to: msg.to,
        ...(msg.replyTo ? { replyTo: msg.replyTo } : {}),
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
      });
      const id = result && typeof result === "object" ? (result as { messageId?: unknown }).messageId : undefined;
      return typeof id === "string" ? { id } : {};
    },
  };
}
