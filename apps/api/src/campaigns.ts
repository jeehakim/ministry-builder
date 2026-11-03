import {
  Campaign,
  campaignTotals,
  CampaignTranslation,
  GIFT_CSV_COLUMNS,
  ImageRef,
  MAX_AMOUNT_CENTS,
  MAX_GIFT_NOTE_CHARS,
  MAX_IMPORT_ROWS,
  parseAmountToCents,
  type CampaignTotals,
  type CampaignWithTotals,
  type Gift,
  type GiftInput,
} from "@ministry/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import { z } from "zod";
import { campaigns, gifts, type CampaignRow, type GiftRow } from "./db/schema";

type Db = ReturnType<typeof drizzle>;

/** Parses a JSON column, falling back to `fallback` when the stored text is unusable. */
function parseJson<T>(text: string | null, schema: z.ZodType<T, z.ZodTypeDef, unknown>, fallback: T): T {
  if (!text) return fallback;
  try {
    const parsed = schema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : fallback;
  } catch {
    return fallback;
  }
}

const SuggestedAmounts = z.array(z.number().int().positive());
const Translations = z.record(z.string(), CampaignTranslation);

/** A campaigns row as the API returns it (dates as ISO strings, JSON columns decoded). */
export function toCampaign(row: CampaignRow): Campaign {
  return {
    id: row.id,
    siteId: row.siteId,
    orgId: row.orgId,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    story: row.story,
    goalAmount: row.goalAmount,
    currency: row.currency,
    deadline: row.deadline ?? undefined,
    coverImage: parseJson<ImageRef | undefined>(row.coverImageJson, ImageRef, undefined),
    suggestedAmounts: parseJson(row.suggestedAmountsJson, SuggestedAmounts, []),
    giveUrl: row.giveUrl,
    giveLabel: row.giveLabel,
    donorWallEnabled: row.donorWallEnabled,
    thankYouMessage: row.thankYouMessage,
    status: row.status,
    translations: parseJson(row.translationsJson, Translations, {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toGift(row: GiftRow): Gift {
  return {
    id: row.id,
    campaignId: row.campaignId,
    amountCents: row.amountCents,
    currency: row.currency,
    source: row.source,
    donorName: row.donorName,
    donorEmail: row.donorEmail,
    public: row.public,
    note: row.note,
    receivedAt: row.receivedAt.toISOString(),
    recordedBy: row.recordedBy,
    thankYouSentAt: row.thankYouSentAt?.toISOString() ?? null,
    thankYouError: row.thankYouError,
    createdAt: row.createdAt.toISOString(),
  };
}

type RawTotals = { raised: number; count: number };

/** Sum and count of gifts for each campaign id, in one query. Campaigns without gifts are absent. */
export async function giftTotals(db: Db, campaignIds: string[]): Promise<Map<string, RawTotals>> {
  const out = new Map<string, RawTotals>();
  if (campaignIds.length === 0) return out;
  const rows = await db
    .select({
      campaignId: gifts.campaignId,
      raised: sql<number>`coalesce(sum(${gifts.amountCents}), 0)`,
      count: sql<number>`count(*)`,
    })
    .from(gifts)
    .where(inArray(gifts.campaignId, campaignIds))
    .groupBy(gifts.campaignId);
  for (const row of rows) out.set(row.campaignId, { raised: Number(row.raised), count: Number(row.count) });
  return out;
}

export function totalsFor(campaign: Pick<Campaign, "goalAmount" | "currency">, raw: RawTotals | undefined): CampaignTotals {
  return campaignTotals(raw?.raised ?? 0, raw?.count ?? 0, campaign);
}

/** Every campaign of a site (or only the given statuses), with totals, newest first. */
export async function loadCampaigns(
  db: Db,
  siteId: string,
  statuses?: Campaign["status"][],
): Promise<CampaignWithTotals[]> {
  const where = statuses ? and(eq(campaigns.siteId, siteId), inArray(campaigns.status, statuses)) : eq(campaigns.siteId, siteId);
  const rows = await db.select().from(campaigns).where(where);
  const totals = await giftTotals(
    db,
    rows.map((r) => r.id),
  );
  return rows
    .map(toCampaign)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))
    .map((c) => ({ ...c, totals: totalsFor(c, totals.get(c.id)) }));
}

// ---- CSV import ----------------------------------------------------------

export type ParsedRow = { row: number; gift: GiftInput };
export type RowError = { row: number; message: string };

/** RFC 4180-style parser: quoted fields, doubled quotes, CRLF or LF line ends. Returns rows of cells. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.startsWith("﻿") ? text.slice(1) : text;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  // Blank lines (a single empty cell) are skipped.
  return rows.filter((r) => !(r.length === 1 && r[0]?.trim() === ""));
}

const EMAIL = z.string().trim().email().max(200);
const TRUE_WORDS = new Set(["true", "yes", "y", "1", "public"]);
const FALSE_WORDS = new Set(["", "false", "no", "n", "0", "private"]);

/** "2026-03-01" or any ISO date-time; a bare date is taken as noon UTC so it stays on that day everywhere. */
function parseDate(text: string): string | null {
  const value = text.trim();
  if (value === "") return null;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00Z` : value;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
}

export type CsvImport = { ok: true; rows: ParsedRow[] } | { ok: false; errors: RowError[] };

/**
 * Validates a gifts CSV. The header names the columns (`GIFT_CSV_COLUMNS`, any order, case-insensitive;
 * only `amount` is required). Row numbers count from the first data row. Any error rejects the whole file,
 * so a partial import can never happen.
 */
export function parseGiftCsv(text: string): CsvImport {
  const rows = parseCsv(text);
  const header = rows[0];
  if (!header) return { ok: false, errors: [{ row: 0, message: "The file is empty" }] };
  const columns = header.map((h) => h.trim().toLowerCase());
  const index = (name: (typeof GIFT_CSV_COLUMNS)[number]) => columns.indexOf(name);
  if (index("amount") < 0) return { ok: false, errors: [{ row: 0, message: 'The header row needs an "amount" column' }] };
  const unknown = columns.filter((c) => !(GIFT_CSV_COLUMNS as readonly string[]).includes(c));
  if (unknown.length > 0) return { ok: false, errors: [{ row: 0, message: `Unknown column: ${unknown[0]}` }] };

  const data = rows.slice(1);
  if (data.length === 0) return { ok: false, errors: [{ row: 0, message: "No rows after the header" }] };
  if (data.length > MAX_IMPORT_ROWS) {
    return { ok: false, errors: [{ row: 0, message: `Too many rows (${data.length}); the limit is ${MAX_IMPORT_ROWS} per file` }] };
  }

  const cell = (cells: string[], name: (typeof GIFT_CSV_COLUMNS)[number]) => {
    const i = index(name);
    return i < 0 ? "" : (cells[i] ?? "").trim();
  };
  const parsed: ParsedRow[] = [];
  const errors: RowError[] = [];
  data.forEach((cells, i) => {
    const row = i + 1;
    const amountCents = parseAmountToCents(cell(cells, "amount"));
    if (amountCents === null) return errors.push({ row, message: `Bad amount "${cell(cells, "amount")}"` });
    if (amountCents > MAX_AMOUNT_CENTS) return errors.push({ row, message: "Amount is too large" });
    const name = cell(cells, "name");
    if (name.length > 120) return errors.push({ row, message: "Name is longer than 120 characters" });
    const emailText = cell(cells, "email");
    const email = emailText === "" ? "" : EMAIL.safeParse(emailText);
    if (email !== "" && !email.success) return errors.push({ row, message: `Bad email "${emailText}"` });
    const dateText = cell(cells, "date");
    const receivedAt = parseDate(dateText);
    if (dateText !== "" && receivedAt === null) return errors.push({ row, message: `Bad date "${dateText}"` });
    const sourceText = cell(cells, "source").toLowerCase();
    const source = sourceText === "" ? "external" : sourceText === "external" || sourceText === "offline" ? sourceText : null;
    if (source === null) return errors.push({ row, message: `Source must be "external" or "offline", not "${sourceText}"` });
    const publicText = cell(cells, "public").toLowerCase();
    const isPublic = TRUE_WORDS.has(publicText) ? true : FALSE_WORDS.has(publicText) ? false : null;
    if (isPublic === null) return errors.push({ row, message: `Public must be yes or no, not "${publicText}"` });
    const note = cell(cells, "note");
    if (note.length > MAX_GIFT_NOTE_CHARS) return errors.push({ row, message: `Note is longer than ${MAX_GIFT_NOTE_CHARS} characters` });
    parsed.push({
      row,
      gift: {
        amountCents,
        source,
        donorName: name,
        donorEmail: email === "" ? "" : email.data,
        public: isPublic,
        note,
        ...(receivedAt ? { receivedAt } : {}),
      },
    });
  });
  if (errors.length > 0) return { ok: false, errors: errors.slice(0, 50) };
  return { ok: true, rows: parsed };
}
