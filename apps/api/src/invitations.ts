import type { Bindings } from "./types";

/** How long an invitation link works. */
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Invitations an organization may send per rolling day, failed sends included. */
export const MAX_INVITATIONS_PER_DAY = 20;
/** Shape of a token as it appears in a link (32 random bytes, base64url). */
export const INVITATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,48}$/;

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A fresh token. It is emailed once and never stored: the database keeps only its hash. */
export function newInvitationToken(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

/** SHA-256 of the token as lowercase hex, which is what `org_invitations.token_hash` holds. */
export async function hashInvitationToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** "jane.doe@example.org" becomes "j***@example.org": enough to recognise, not enough to harvest. */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  return `${email[0]}***${email.slice(at)}`;
}

/** The link the invitee opens, on the web app's origin (ALLOWED_ORIGIN), so a domain move needs no code change. */
export function invitationLink(env: Pick<Bindings, "ALLOWED_ORIGIN">, token: string): string {
  return `${env.ALLOWED_ORIGIN.replace(/\/+$/, "")}/invite/${token}`;
}
