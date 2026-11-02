import { and, count, eq, gte } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { aiUsage } from "../db/schema";
import type { Bindings } from "../types";

const DEFAULT_DAILY_LIMIT = 30;
const DEFAULT_ORG_DAILY_LIMIT = 100;

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

/** The current UTC day: its start and the next midnight, when the quota resets. */
export function utcDayWindow(now: Date = new Date()): { start: Date; resetsAt: Date } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return { start, resetsAt: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

export async function usedToday(db: DrizzleD1Database, userId: string, now: Date = new Date()): Promise<number> {
  const [row] = await db
    .select({ used: count() })
    .from(aiUsage)
    .where(and(eq(aiUsage.userId, userId), gte(aiUsage.createdAt, utcDayWindow(now).start)));
  return row?.used ?? 0;
}

/** Calls made today by every member of the organization together. */
export async function orgUsedToday(db: DrizzleD1Database, orgId: string, now: Date = new Date()): Promise<number> {
  const [row] = await db
    .select({ used: count() })
    .from(aiUsage)
    .where(and(eq(aiUsage.orgId, orgId), gte(aiUsage.createdAt, utcDayWindow(now).start)));
  return row?.used ?? 0;
}
