import type { OrgEventAction } from "@ministry/schema";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { orgEvents } from "./db/schema";

export interface OrgEventInput {
  orgId: string;
  /** Null when the system acted (a webhook, a scheduled job). */
  actorUserId: string | null;
  action: OrgEventAction;
  target?: string | null;
  /** Small, secret-free specifics. Serialized as JSON and truncated. */
  detail?: Record<string, unknown>;
}

const MAX_DETAIL_CHARS = 2000;

function serializeDetail(detail: Record<string, unknown> | undefined): string | null {
  if (!detail) return null;
  const json = JSON.stringify(detail);
  return json.length > MAX_DETAIL_CHARS ? JSON.stringify({ truncated: true }) : json;
}

let sequence = 0;

/**
 * Time-ordered ids: the millisecond, a per-isolate counter, then random bytes. `created_at` defaults to whole
 * seconds, so listing by (created_at, id) descending keeps events written in the same second in order.
 */
export function newEventId(now: number = Date.now()): string {
  sequence = (sequence + 1) % 1_679_616; // base-36 "zzzz"
  return `evt_${now.toString(36).padStart(9, "0")}${sequence.toString(36).padStart(4, "0")}_${crypto.randomUUID().slice(0, 8)}`;
}

/** The insert statement for an audit event, so a route can batch it with the change it records. */
export function orgEventInsert(db: DrizzleD1Database, event: OrgEventInput) {
  const now = new Date();
  return db.insert(orgEvents).values({
    id: newEventId(now.getTime()),
    createdAt: now,
    orgId: event.orgId,
    actorUserId: event.actorUserId,
    action: event.action,
    target: event.target ?? null,
    detailJson: serializeDetail(event.detail),
  });
}

/** Writes one audit event. Never throws into the caller's main flow: a lost audit line must not fail the action. */
export async function recordOrgEvent(db: DrizzleD1Database, event: OrgEventInput): Promise<void> {
  try {
    await orgEventInsert(db, event);
  } catch (err) {
    console.error(JSON.stringify({ event: "org_event_failed", action: event.action, org_id: event.orgId, error: err instanceof Error ? err.name : "unknown" }));
  }
}
