import { and, eq, isNotNull } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { contactEmailVerifications } from "./db/schema";

/** A verification link is honoured for this long after it was sent. */
export const VERIFY_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Verification emails one site may send to one address per day. */
export const MAX_VERIFICATION_SENDS_PER_DAY = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The form every stored contact address takes, so lookups never miss on case or whitespace. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** True when `email` has a verified row for the site: the only addresses the contact form ever emails. */
export async function isContactEmailVerified(db: DrizzleD1Database, siteId: string, email: string): Promise<boolean> {
  const [row] = await db
    .select({ id: contactEmailVerifications.id })
    .from(contactEmailVerifications)
    .where(
      and(
        eq(contactEmailVerifications.siteId, siteId),
        eq(contactEmailVerifications.email, normalizeEmail(email)),
        isNotNull(contactEmailVerifications.verifiedAt),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/** 256 random bits as hex: the whole secret of the verification link. */
export function newVerificationToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Whether another verification email may go out now, given the row's send history. */
export function sendAllowed(row: { sentAt: Date; sendCount: number }, now: Date): boolean {
  if (now.getTime() - row.sentAt.getTime() >= DAY_MS) return true;
  return row.sendCount < MAX_VERIFICATION_SENDS_PER_DAY;
}

/** The send count after one more email: reset once the last send is a day old. */
export function nextSendCount(row: { sentAt: Date; sendCount: number }, now: Date): number {
  return now.getTime() - row.sentAt.getTime() >= DAY_MS ? 1 : row.sendCount + 1;
}
