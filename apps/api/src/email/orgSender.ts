import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { decryptSecret } from "../crypto";
import { orgIntegrations } from "../db/schema";
import type { Bindings } from "../types";
import { formatFrom } from "./from";
import { resendSender } from "./resend";
import type { EmailSender } from "./sender";

/**
 * What the organization chose for its contact-form email:
 * - null: no usable integration (no row, or no from address yet); the platform sender applies.
 * - { sender }: send through the organization's own Resend account.
 * - { error }: they chose their own sender but it cannot be built (the key cannot be decrypted).
 *   The caller records the error and does not fall back to the platform sender.
 */
export type OrgSenderResolution = { sender: EmailSender } | { error: string } | null;

export async function resolveOrgSender(
  env: Pick<Bindings, "INTEGRATIONS_KEY">,
  db: DrizzleD1Database,
  orgId: string,
): Promise<OrgSenderResolution> {
  const [row] = await db.select().from(orgIntegrations).where(eq(orgIntegrations.orgId, orgId)).limit(1);
  if (!row?.fromAddress) return null;
  try {
    const apiKey = await decryptSecret(env, row.encryptedKey, orgId);
    return { sender: resendSender(apiKey, formatFrom(row.fromAddress, row.fromName)) };
  } catch {
    return { error: "The organization's email key could not be read; re-enter it in Integrations" };
  }
}
