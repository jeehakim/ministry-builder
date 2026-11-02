import { z } from "zod";

/**
 * Bring-your-own integrations, scoped to an organization. Secrets never travel back to the
 * client: views carry only a hint (last characters) and status.
 */

/** Resend API keys look like re_xxxxxxxx_xxxxxxxxxxxxxxxx. */
export const RESEND_KEY_PATTERN = /^re_[A-Za-z0-9_]{8,}$/;

export const ResendIntegrationView = z.object({
  provider: z.literal("resend"),
  /** Last four characters of the stored key, e.g. "…k4Q2". */
  keyHint: z.string(),
  fromAddress: z.string().nullable(),
  /** Domains verified in the organization's Resend account, fetched with their key. */
  verifiedDomains: z.array(z.string()),
  /** ISO time of the last successful test email, or null. */
  testedAt: z.string().nullable(),
  lastError: z.string().nullable(),
  updatedAt: z.string(),
});
export type ResendIntegrationView = z.infer<typeof ResendIntegrationView>;

export const IntegrationsResponse = z.object({
  /** False when the server has no INTEGRATIONS_KEY secret; the UI then explains and disables entry. */
  encryptionAvailable: z.boolean(),
  /** What delivers contact-form email for this organization right now. */
  activeSender: z.enum(["organization", "platform", "none"]),
  resend: ResendIntegrationView.nullable(),
});
export type IntegrationsResponse = z.infer<typeof IntegrationsResponse>;

export const SetResendKeyRequest = z.object({
  apiKey: z.string().trim().regex(RESEND_KEY_PATTERN, "That does not look like a Resend API key"),
});
export type SetResendKeyRequest = z.infer<typeof SetResendKeyRequest>;

export const SetResendFromRequest = z.object({
  fromAddress: z.string().trim().email().max(200),
  /** Optional display name, e.g. "Grace Church". */
  fromName: z.string().trim().max(80).optional(),
});
export type SetResendFromRequest = z.infer<typeof SetResendFromRequest>;

export const SendTestEmailRequest = z.object({ to: z.string().trim().email().max(200) });
export type SendTestEmailRequest = z.infer<typeof SendTestEmailRequest>;
