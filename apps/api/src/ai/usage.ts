import type { AiAction } from "@ministry/schema";
import { and, count, eq, gt, gte, or, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { aiUsage } from "../db/schema";
import { newId } from "../ids";
import type { AiCallUsage } from "./provider";
import type { Bindings } from "../types";

const DEFAULT_DAILY_LIMIT = 30;
const DEFAULT_ORG_DAILY_LIMIT = 100;
const DEFAULT_GLOBAL_DAILY_LIMIT = 2000;
/**
 * A `pending` row older than this no longer counts: the Worker that reserved it died before the
 * provider answered, so the slot would otherwise stay taken until midnight.
 */
export const PENDING_TTL_MS = 10 * 60 * 1000;

function positiveInt(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** AI calls allowed per user per UTC day, from the AI_DAILY_LIMIT var. */
export function dailyLimit(env: Pick<Bindings, "AI_DAILY_LIMIT">): number {
  return positiveInt(env.AI_DAILY_LIMIT, DEFAULT_DAILY_LIMIT);
}

/** AI calls allowed per organization per UTC day (all members together), from the AI_DAILY_LIMIT_ORG var. */
export function orgDailyLimit(env: Pick<Bindings, "AI_DAILY_LIMIT_ORG">): number {
  return positiveInt(env.AI_DAILY_LIMIT_ORG, DEFAULT_ORG_DAILY_LIMIT);
}

/** AI calls allowed across every user per UTC day, from the AI_GLOBAL_DAILY_LIMIT var. */
export function globalDailyLimit(env: Pick<Bindings, "AI_GLOBAL_DAILY_LIMIT">): number {
  return positiveInt(env.AI_GLOBAL_DAILY_LIMIT, DEFAULT_GLOBAL_DAILY_LIMIT);
}

/** The current UTC day: its start and the next midnight, when the quota resets. */
export function utcDayWindow(now: Date = new Date()): { start: Date; resetsAt: Date } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return { start, resetsAt: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

/** Rows that count against today's quota: finished calls, and reservations younger than PENDING_TTL_MS. */
function countsToday(now: Date) {
  return and(
    gte(aiUsage.createdAt, utcDayWindow(now).start),
    or(eq(aiUsage.status, "done"), gt(aiUsage.createdAt, new Date(now.getTime() - PENDING_TTL_MS))),
  );
}

export async function usedToday(db: DrizzleD1Database, userId: string, now: Date = new Date()): Promise<number> {
  const [row] = await db
    .select({ used: count() })
    .from(aiUsage)
    .where(and(eq(aiUsage.userId, userId), countsToday(now)));
  return row?.used ?? 0;
}

/** Calls made today by every member of the organization together. */
export async function orgUsedToday(db: DrizzleD1Database, orgId: string, now: Date = new Date()): Promise<number> {
  const [row] = await db
    .select({ used: count() })
    .from(aiUsage)
    .where(and(eq(aiUsage.orgId, orgId), countsToday(now)));
  return row?.used ?? 0;
}

export async function usedTodayByEveryone(db: DrizzleD1Database, now: Date = new Date()): Promise<number> {
  const [row] = await db.select({ used: count() }).from(aiUsage).where(countsToday(now));
  return row?.used ?? 0;
}

export type Reservation =
  | { ok: true; id: string }
  | { ok: false; reason: "user"; used: number; limit: number }
  | { ok: false; reason: "organization"; used: number; limit: number }
  | { ok: false; reason: "global"; used: number; limit: number };

/**
 * Takes one slot of today's quota for `userId`, or reports which limit is full. The check and the
 * insert are a single statement (`INSERT ... SELECT ... WHERE count < limit`), so two requests that
 * arrive together cannot both pass a check that only one of them should: SQLite runs statements one
 * at a time, and D1 serialises writes to the database.
 */
export async function reserveUsage(
  db: DrizzleD1Database,
  input: { userId: string; siteId: string; orgId: string; action: AiAction; userLimit: number; orgLimit: number; globalLimit: number },
  now: Date = new Date(),
): Promise<Reservation> {
  const id = newId("aiu");
  const dayStart = utcDayWindow(now).start.getTime();
  const pendingSince = now.getTime() - PENDING_TTL_MS;
  const counted = sql`created_at >= ${dayStart} AND (status = 'done' OR created_at > ${pendingSince})`;
  const result = await db.run(sql`
    INSERT INTO ai_usage (id, user_id, site_id, org_id, action, provider, model, status, created_at)
    SELECT ${id}, ${input.userId}, ${input.siteId}, ${input.orgId}, ${input.action}, 'pending', 'pending', 'pending', ${now.getTime()}
    WHERE (SELECT COUNT(*) FROM ai_usage WHERE user_id = ${input.userId} AND ${counted}) < ${input.userLimit}
      AND (SELECT COUNT(*) FROM ai_usage WHERE org_id = ${input.orgId} AND ${counted}) < ${input.orgLimit}
      AND (SELECT COUNT(*) FROM ai_usage WHERE ${counted}) < ${input.globalLimit}
  `);
  if (result.meta.changes > 0) return { ok: true, id };

  // Nothing was inserted: find out which limit refused the request, for the error message.
  // The organization's quota is the budget; the per-user limit guards against one member spending it all.
  const [used, org, everyone] = await Promise.all([usedToday(db, input.userId, now), orgUsedToday(db, input.orgId, now), usedTodayByEveryone(db, now)]);
  if (used >= input.userLimit) return { ok: false, reason: "user", used, limit: input.userLimit };
  if (org >= input.orgLimit) return { ok: false, reason: "organization", used: org, limit: input.orgLimit };
  return { ok: false, reason: "global", used: everyone, limit: input.globalLimit };
}

/** The values that turn a reservation into a finished call. Apply with `db.update(aiUsage).set(...)`. */
export function completedUsage(usage: AiCallUsage, trail: { requestJson: string | null; resultJson: string | null }) {
  return {
    status: "done" as const,
    provider: usage.provider,
    model: usage.model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    requestJson: trail.requestJson,
    resultJson: trail.resultJson,
  };
}

/** Gives the slot back: the provider never answered, so nothing was spent. */
export async function releaseUsage(db: DrizzleD1Database, id: string): Promise<void> {
  await db.delete(aiUsage).where(and(eq(aiUsage.id, id), eq(aiUsage.status, "pending")));
}
