import { z } from "zod";
import { ImageRef } from "./site.ts";

/**
 * Fundraising campaigns (platform design, section 3, phase A). A campaign belongs to a site and its
 * organization, is published at `<site>/give/<slug>/` in every site language, and links OUT to the
 * processor the organization already uses. The platform never holds money: gifts are records staff
 * enter by hand or import, so the progress bar and donor wall can be rendered.
 *
 * Money is always an integer in the currency's minor unit (cents for USD): `goalAmount`,
 * `suggestedAmounts` and `amountCents` all follow that rule.
 */

export const CAMPAIGN_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
export const CURRENCY_PATTERN = /^[A-Z]{3}$/;
/** ISO date, e.g. "2026-12-31". No time: a deadline is a day, shown in the visitor's own zone. */
export const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** Only https links may be published as the giving target. */
export const GIVE_URL_PATTERN = /^https:\/\/[^\s]+$/i;

export const MAX_STORY_CHARS = 8000;
export const MAX_SUGGESTED_AMOUNTS = 6;
/** Largest single amount accepted, in minor units (one hundred million). */
export const MAX_AMOUNT_CENTS = 100_000_000_00;
export const MAX_GIFT_NOTE_CHARS = 500;
export const MAX_THANK_YOU_CHARS = 2000;
/** Rows one CSV import may carry. */
export const MAX_IMPORT_ROWS = 2000;

export const CAMPAIGN_STATUSES = ["draft", "active", "closed"] as const;
export const CampaignStatus = z.enum(CAMPAIGN_STATUSES);
export type CampaignStatus = z.infer<typeof CampaignStatus>;

export const GIFT_SOURCES = ["external", "offline"] as const;
export const GiftSource = z.enum(GIFT_SOURCES);
export type GiftSource = z.infer<typeof GiftSource>;

const amountCents = z.number().int().positive().max(MAX_AMOUNT_CENTS);

/** The translatable strings of a campaign, one overlay per language (like the site's `translations`). */
export const CampaignTranslation = z.object({
  title: z.string().max(120).optional(),
  summary: z.string().max(300).optional(),
  story: z.string().max(MAX_STORY_CHARS).optional(),
  thankYouMessage: z.string().max(MAX_THANK_YOU_CHARS).optional(),
});
export type CampaignTranslation = z.infer<typeof CampaignTranslation>;

/** What the owner edits. The server adds `id`, the site and timestamps. */
export const CampaignInput = z.object({
  /** URL segment under /give/. Derived from the title when omitted on create; fixed afterwards. */
  slug: z.string().regex(CAMPAIGN_SLUG_PATTERN, "Use lowercase letters, digits and hyphens").optional(),
  title: z.string().trim().min(1, "Give the campaign a title").max(120),
  /** One or two sentences shown on the card in the Give section. */
  summary: z.string().max(300).default(""),
  /** Plain text, paragraphs separated by a blank line. AI can draft it from a brief. */
  story: z.string().max(MAX_STORY_CHARS).default(""),
  /** Minor units (cents). Zero means "no goal": the page shows the total raised without a bar. */
  goalAmount: z.number().int().nonnegative().max(MAX_AMOUNT_CENTS).default(0),
  currency: z.string().regex(CURRENCY_PATTERN, "Three-letter currency code").default("USD"),
  deadline: z.string().regex(ISO_DATE_PATTERN, "Use a date like 2026-12-31").optional(),
  coverImage: ImageRef.optional(),
  /** Minor units. Rendered as buttons that open the giving link with the amount in the URL. */
  suggestedAmounts: z.array(amountCents).max(MAX_SUGGESTED_AMOUNTS).default([]),
  /** The processor's giving page (Zeffy, Givebutter, PayPal, Tithe.ly ...). Empty while being set up. */
  giveUrl: z.union([z.literal(""), z.string().regex(GIVE_URL_PATTERN, "The giving link must start with https://").max(2000)]).default(""),
  /** Label of the main give button. */
  giveLabel: z.string().max(60).default(""),
  /** Show the names of donors who agreed to be listed. */
  donorWallEnabled: z.boolean().default(false),
  /** Sent to donors with an email address when a gift is recorded by hand. Empty uses the built-in text. */
  thankYouMessage: z.string().max(MAX_THANK_YOU_CHARS).default(""),
  status: CampaignStatus.default("draft"),
  translations: z.record(z.string(), CampaignTranslation).default({}),
});
export type CampaignInput = z.infer<typeof CampaignInput>;

export const Campaign = CampaignInput.extend({
  id: z.string(),
  siteId: z.string(),
  orgId: z.string(),
  slug: z.string().regex(CAMPAIGN_SLUG_PATTERN),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Campaign = z.infer<typeof Campaign>;

/** Sum of recorded gifts, computed by the server. */
export const CampaignTotals = z.object({
  raisedAmount: z.number().int().nonnegative(),
  giftCount: z.number().int().nonnegative(),
  goalAmount: z.number().int().nonnegative(),
  currency: z.string(),
  /** 0 to 100, capped; 0 when there is no goal. */
  percent: z.number().int().min(0).max(100),
});
export type CampaignTotals = z.infer<typeof CampaignTotals>;

export const CampaignWithTotals = Campaign.extend({ totals: CampaignTotals });
export type CampaignWithTotals = z.infer<typeof CampaignWithTotals>;

export const CampaignListResponse = z.object({ campaigns: z.array(CampaignWithTotals) });
export type CampaignListResponse = z.infer<typeof CampaignListResponse>;

export const CampaignResponse = z.object({ campaign: CampaignWithTotals });
export type CampaignResponse = z.infer<typeof CampaignResponse>;

const email = z.string().trim().email().max(200);

/** A gift entered by staff: received through the processor ("external") or by cash/check ("offline"). */
export const GiftInput = z.object({
  amountCents,
  source: GiftSource.default("offline"),
  donorName: z.string().trim().max(120).default(""),
  donorEmail: z.union([z.literal(""), email]).default(""),
  /** The donor agreed to appear on the donor wall. */
  public: z.boolean().default(false),
  note: z.string().max(MAX_GIFT_NOTE_CHARS).default(""),
  /** ISO date-time; defaults to now. */
  receivedAt: z.string().datetime({ offset: true }).optional(),
});
export type GiftInput = z.infer<typeof GiftInput>;

export const Gift = z.object({
  id: z.string(),
  campaignId: z.string(),
  amountCents: z.number().int(),
  currency: z.string(),
  source: GiftSource,
  donorName: z.string(),
  donorEmail: z.string(),
  public: z.boolean(),
  note: z.string(),
  receivedAt: z.string(),
  recordedBy: z.string(),
  /** When the thank-you email was accepted by the sender; null when not sent (no address, no sender, or import). */
  thankYouSentAt: z.string().nullable(),
  thankYouError: z.string().nullable(),
  createdAt: z.string(),
});
export type Gift = z.infer<typeof Gift>;

export const GiftListResponse = z.object({ gifts: z.array(Gift), totals: CampaignTotals });
export type GiftListResponse = z.infer<typeof GiftListResponse>;

export const GiftResponse = z.object({ gift: Gift, totals: CampaignTotals });
export type GiftResponse = z.infer<typeof GiftResponse>;

/** Body of POST .../gifts/import: the CSV text itself (header row required, see `GIFT_CSV_COLUMNS`). */
export const GiftImportRequest = z.object({ csv: z.string().min(1).max(2 * 1024 * 1024) });
export type GiftImportRequest = z.infer<typeof GiftImportRequest>;

/** Accepted header names, case-insensitive. `amount` is in major units ("25" or "25.50"); `date` is ISO or YYYY-MM-DD. */
export const GIFT_CSV_COLUMNS = ["amount", "name", "email", "date", "source", "public", "note"] as const;

export const GiftImportResponse = z.object({
  imported: z.number().int().nonnegative(),
  /** Row numbers (1 = first data row) with the reason each was skipped. Nothing is imported when any row fails. */
  errors: z.array(z.object({ row: z.number().int().positive(), message: z.string() })),
  totals: CampaignTotals,
});
export type GiftImportResponse = z.infer<typeof GiftImportResponse>;

// ---- AI --------------------------------------------------------------

export const AiCampaignStoryRequest = z.object({
  /** What the campaign is for, who it helps, the goal and timing. */
  brief: z.string().trim().min(10).max(4000),
  language: z.string().min(2).max(10).default("en"),
});
export type AiCampaignStoryRequest = z.infer<typeof AiCampaignStoryRequest>;

export const AiCampaignStoryResponse = z.object({
  title: z.string().min(1).max(120),
  summary: z.string().max(300),
  story: z.string().min(1).max(MAX_STORY_CHARS),
});
export type AiCampaignStoryResponse = z.infer<typeof AiCampaignStoryResponse>;

export const AiThankYouRequest = z.object({
  /** Tone or details to include, e.g. "mention the winter shelter opening in January". */
  notes: z.string().max(1000).default(""),
  language: z.string().min(2).max(10).default("en"),
});
export type AiThankYouRequest = z.infer<typeof AiThankYouRequest>;

export const AiThankYouResponse = z.object({ message: z.string().min(1).max(MAX_THANK_YOU_CHARS) });
export type AiThankYouResponse = z.infer<typeof AiThankYouResponse>;

// ---- Helpers shared by the apps and the templates ----------------------

/** Percent of the goal reached, 0 to 100, 0 without a goal. */
export function campaignPercent(raisedAmount: number, goalAmount: number): number {
  if (goalAmount <= 0) return 0;
  return Math.max(0, Math.min(100, Math.floor((raisedAmount / goalAmount) * 100)));
}

export function campaignTotals(raisedAmount: number, giftCount: number, campaign: Pick<CampaignInput, "goalAmount" | "currency">): CampaignTotals {
  return { raisedAmount, giftCount, goalAmount: campaign.goalAmount, currency: campaign.currency, percent: campaignPercent(raisedAmount, campaign.goalAmount) };
}

/** Minor-unit integer as "$1,250" or "$12.50" (no cents when the amount is whole). Falls back to a plain number for unknown currencies. */
export function formatMoney(amountCents: number, currency: string, locale = "en-US"): string {
  const whole = amountCents % 100 === 0;
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(amountCents / 100);
  } catch {
    return `${(amountCents / 100).toFixed(whole ? 0 : 2)} ${currency}`;
  }
}

/** "12.50", "$1,200", "1200" -> minor units; null for anything that is not a positive amount. */
export function parseAmountToCents(input: string): number | null {
  const cleaned = input.replace(/[\s,$€£¥₩]/g, "");
  if (!/^\d+(?:\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole = "0", fraction = ""] = cleaned.split(".");
  const cents = Number.parseInt(whole, 10) * 100 + Number.parseInt((fraction + "00").slice(0, 2), 10);
  return cents > 0 && cents <= MAX_AMOUNT_CENTS ? cents : null;
}

export function campaignSlugFromTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return slug || "campaign";
}

/**
 * The giving link with the campaign (and optionally the amount in major units) added as query
 * parameters, so the processor's form or export can attribute the gift. Returns null when the
 * link is not an https URL.
 */
export function giveLink(giveUrl: string, campaignSlug: string, amountCents?: number): string | null {
  if (!GIVE_URL_PATTERN.test(giveUrl)) return null;
  try {
    const url = new URL(giveUrl);
    if (url.protocol !== "https:") return null;
    url.searchParams.set("campaign", campaignSlug);
    if (amountCents !== undefined && amountCents > 0) {
      url.searchParams.set("amount", amountCents % 100 === 0 ? String(amountCents / 100) : (amountCents / 100).toFixed(2));
    }
    return url.toString();
  } catch {
    return null;
  }
}

/** "Maria Lopez" -> "Maria L."; "Maria" -> "Maria"; blank -> "Anonymous". Never prints a full surname. */
export function donorDisplayName(fullName: string, anonymous = "Anonymous"): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  if (!first) return anonymous;
  const last = parts.length > 1 ? parts[parts.length - 1] : undefined;
  const initial = last ? [...last][0] : undefined;
  return initial ? `${first} ${initial.toUpperCase()}.` : first;
}

/** The campaign with its text replaced by the overlay for `lang`; the primary language returns it unchanged. */
export function localizeCampaign<T extends CampaignInput>(campaign: T, lang: string, primaryLanguage: string): T {
  if (lang === primaryLanguage) return campaign;
  const overlay = campaign.translations[lang];
  if (!overlay) return campaign;
  return {
    ...campaign,
    title: overlay.title ?? campaign.title,
    summary: overlay.summary ?? campaign.summary,
    story: overlay.story ?? campaign.story,
    thankYouMessage: overlay.thankYouMessage ?? campaign.thankYouMessage,
  };
}
