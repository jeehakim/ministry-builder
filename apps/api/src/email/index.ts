import type { Bindings } from "../types";
import { cloudflareSender } from "./cloudflare";
import { resendSender } from "./resend";
import type { EmailSender } from "./sender";

export type { EmailMessage, EmailSender } from "./sender";

export const DEFAULT_EMAIL_FROM = "forms@shofar.io";

/**
 * The configured sender, or null for store-only mode (messages are saved, nothing is emailed).
 * A provider that is selected but not fully configured also yields null rather than guessing.
 */
export function createSender(
  env: Pick<Bindings, "EMAIL" | "EMAIL_PROVIDER" | "EMAIL_FROM" | "RESEND_API_KEY">,
): EmailSender | null {
  const from = env.EMAIL_FROM?.trim() || DEFAULT_EMAIL_FROM;
  if (env.EMAIL_PROVIDER === "cloudflare" && env.EMAIL) return cloudflareSender(env.EMAIL, from);
  if (env.EMAIL_PROVIDER === "resend" && env.RESEND_API_KEY) return resendSender(env.RESEND_API_KEY, from);
  return null;
}
