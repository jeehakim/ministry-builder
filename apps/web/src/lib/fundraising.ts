import { formatMoney, GIFT_CSV_COLUMNS, MAX_SUGGESTED_AMOUNTS, parseAmountToCents, type CampaignStatus, type CampaignTotals } from "@ministry/schema";

/** localStorage key of the organization the dashboard last showed. */
export const ORG_STORAGE_KEY = "ministry.dashboard.org";

export interface OrgChoice {
  id: string;
  name: string;
}

/** The organizations behind a list of sites, in first-seen order, one entry per id. */
export function orgsFromSites(sites: { orgId: string; orgName: string }[]): OrgChoice[] {
  const seen = new Map<string, OrgChoice>();
  for (const site of sites) if (!seen.has(site.orgId)) seen.set(site.orgId, { id: site.orgId, name: site.orgName });
  return [...seen.values()];
}

/**
 * Which organization the dashboard shows: the one named in the URL when it exists, else the one
 * remembered from last time, else the first. Null when there are none.
 */
export function resolveOrg(orgs: OrgChoice[], requested: string | null, remembered: string | null): string | null {
  for (const candidate of [requested, remembered]) {
    if (candidate && orgs.some((o) => o.id === candidate)) return candidate;
  }
  return orgs[0]?.id ?? null;
}

export const STATUS_LABELS: Record<CampaignStatus, string> = { draft: "Draft", active: "Active", closed: "Closed" };

export const STATUS_HINTS: Record<CampaignStatus, string> = {
  draft: "Not on the site. Edit freely.",
  active: "Published with the site: a page at /give/<slug>/ and a card in the Give section.",
  closed: "Page and card come down on the next publish. Gifts stay recorded.",
};

/** "$2,510 of $5,000 · 50%" or, without a goal, "$2,510 raised". */
export function progressText(totals: CampaignTotals): string {
  const raised = formatMoney(totals.raisedAmount, totals.currency);
  if (totals.goalAmount <= 0) return `${raised} raised`;
  return `${raised} of ${formatMoney(totals.goalAmount, totals.currency)} · ${totals.percent}%`;
}

/** Minor units to the text shown in a money input: "25" or "12.50". */
export function centsToText(cents: number): string {
  if (cents <= 0) return "";
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

/** Suggested amounts as one editable line: "25, 50, 100". */
export function amountsToText(amounts: number[]): string {
  return amounts.map(centsToText).join(", ");
}

/** The line back into minor units; `error` names the first entry that is not an amount. */
export function textToAmounts(text: string): { amounts: number[]; error: string | null } {
  const parts = text
    .split(/[,\n;]/)
    .map((p) => p.trim())
    .filter(Boolean);
  const amounts: number[] = [];
  for (const part of parts) {
    const cents = parseAmountToCents(part);
    if (cents === null) return { amounts, error: `"${part}" is not an amount` };
    if (!amounts.includes(cents)) amounts.push(cents);
  }
  if (amounts.length > MAX_SUGGESTED_AMOUNTS) return { amounts, error: `At most ${MAX_SUGGESTED_AMOUNTS} suggested amounts` };
  return { amounts, error: null };
}

/** A goal typed as text: empty means no goal. */
export function textToGoal(text: string): { goal: number; error: string | null } {
  const trimmed = text.trim();
  if (trimmed === "") return { goal: 0, error: null };
  const cents = parseAmountToCents(trimmed);
  return cents === null ? { goal: 0, error: "The goal must be an amount such as 5000" } : { goal: cents, error: null };
}

/** The public address of a campaign page, when the site is published. */
export function campaignPublicUrl(publishedUrl: string | null, slug: string): string | null {
  if (!publishedUrl) return null;
  const root = publishedUrl.endsWith("/") ? publishedUrl : `${publishedUrl}/`;
  return `${root}give/${encodeURIComponent(slug)}/`;
}

export interface PublishState {
  label: "Live" | "Not published" | "Site not published" | "Needs a publish";
  detail: string;
}

/**
 * What a visitor can see right now. `publishedAt` is the site's last publish; `updatedAt` the campaign's
 * last save. A campaign saved after the site was last published is not live until the next publish.
 */
export function publishState(status: CampaignStatus, publishedAt: string | null, updatedAt: string): PublishState {
  if (status !== "active") return { label: "Not published", detail: STATUS_HINTS[status] };
  if (!publishedAt) return { label: "Site not published", detail: "Publish the site from the editor to put this campaign online." };
  if (Date.parse(updatedAt) > Date.parse(publishedAt)) {
    return { label: "Needs a publish", detail: "Changes since the last publish are not online yet. Publish the site again." };
  }
  return { label: "Live", detail: "Totals on the page update each time the site is published." };
}

/** A starter CSV that matches what the import expects. */
export function giftCsvTemplate(): string {
  return `${GIFT_CSV_COLUMNS.join(",")}\n25,Maria Lopez,maria@example.org,2026-01-15,external,yes,\n100,,,2026-01-20,offline,no,Cash at the service\n`;
}
