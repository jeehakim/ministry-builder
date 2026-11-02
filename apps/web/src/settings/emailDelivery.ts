import type { IntegrationsResponse } from "@ministry/schema";
import { formatRelativeTime } from "../lib/time.ts";

export const RESEND_DOMAINS_URL = "https://resend.com/domains";

/** Longest display name the API accepts (`SetResendFromRequest.fromName`). */
const FROM_NAME_MAX = 80;

export interface SenderStatus {
  title: string;
  detail: string;
}

/** What the "delivered by" status card says for each value of `activeSender`. */
export function senderStatus(sender: IntegrationsResponse["activeSender"]): SenderStatus {
  switch (sender) {
    case "organization":
      return {
        title: "Your Resend account",
        detail: "Messages are emailed from your own domain through your Resend account. Every message is also kept in your inbox here.",
      };
    case "platform":
      return {
        title: "Ministry Sites (default)",
        detail: "We send your form messages from the shared Ministry Sites address. Every message is also kept in your inbox here.",
      };
    case "none":
      return {
        title: "Nothing yet (stored in your inbox only)",
        detail: "No email is being sent, so messages wait in the Messages inbox in the editor. Connect Resend below to receive them by email.",
      };
  }
}

/** "Key ending in …k4Q2" from the server's hint (or a longer string: only the last four characters are shown). */
export function formatKeyHint(hint: string): string {
  const tail = hint.trim().replace(/^(…|\.{3})/, "");
  if (tail === "") return "Key saved";
  return `Key ending in …${tail.slice(-4)}`;
}

/** The lowercased part after the last "@", or null when the address has no usable domain. */
export function emailDomain(address: string): string | null {
  const trimmed = address.trim();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0 || at === trimmed.length - 1) return null;
  return trimmed.slice(at + 1).toLowerCase();
}

export type Check = { ok: true } | { ok: false; message: string };

const EMAIL_SHAPE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

/** The From address must be well formed and sit on exactly one of the domains verified in Resend. */
export function checkFromAddress(address: string, verifiedDomains: readonly string[]): Check {
  const trimmed = address.trim();
  if (trimmed === "") return { ok: false, message: "Enter the address your messages should come from." };
  const domain = emailDomain(trimmed);
  if (!EMAIL_SHAPE.test(trimmed) || domain === null) return { ok: false, message: "Enter a valid email address, such as hello@mail.yourchurch.org." };
  if (verifiedDomains.length === 0) return { ok: false, message: "Verify a domain in Resend first, then come back to set the address." };
  if (!verifiedDomains.some((d) => d.trim().toLowerCase() === domain)) {
    return { ok: false, message: `${domain} is not verified in your Resend account. Use an address on: ${verifiedDomains.join(", ")}.` };
  }
  return { ok: true };
}

/** The display name goes into the From header, so keep out characters that could change its structure. */
export function checkFromName(name: string): Check {
  const trimmed = name.trim();
  if (trimmed.length > FROM_NAME_MAX) return { ok: false, message: `Keep the display name under ${FROM_NAME_MAX} characters.` };
  if (/[<>\r\n]/.test(trimmed)) return { ok: false, message: "The display name cannot contain < > or line breaks." };
  return { ok: true };
}

/** "Test sent 5 minutes ago". */
export function testSentText(iso: string, now: number = Date.now()): string {
  const when = formatRelativeTime(iso, now);
  return when === "" ? "Test sent" : `Test sent ${when}`;
}

/** What the test recipient field shows: whatever the user typed (even if emptied), else the site's contact email. */
export function defaultTestRecipient(typed: string | null, contactEmail: string | null): string {
  return typed ?? contactEmail ?? "";
}

/** Inline error text for a failed integrations call. Duck-typed on `status` so this file needs no API client import. */
export function integrationErrorMessage(err: unknown): string {
  const status = typeof err === "object" && err !== null && "status" in err ? err.status : undefined;
  if (status === 429) return "Too many attempts, try again in an hour";
  if (status === 503) return "Bring-your-own email is not enabled on this server";
  const message = typeof err === "object" && err !== null && "message" in err ? err.message : undefined;
  return typeof message === "string" && message !== "" ? message : "Something went wrong.";
}
