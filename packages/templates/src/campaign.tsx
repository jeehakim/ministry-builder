import type { ImageRef, Section } from "@ministry/schema";
import { formatMoney } from "@ministry/schema";
import { uiStrings } from "./i18n";
import type { CampaignCard, RenderOptions } from "./types";

type GiveSection = Extract<Section, { type: "give" }>;

/**
 * The campaigns a Give section shows: the ones it names, in its order, or every active campaign
 * when it names none. Ids the section names that no longer exist are skipped.
 */
export function campaignsFor(section: GiveSection, options: RenderOptions): CampaignCard[] {
  const all = options.campaigns ?? [];
  if (section.campaigns.length === 0) return all;
  const byId = new Map(all.map((c) => [c.id, c]));
  return section.campaigns.flatMap((id) => {
    const card = byId.get(id);
    return card ? [card] : [];
  });
}

/** Deadline as a short date in the page language; the raw string if it cannot be parsed. */
export function formatDeadline(deadline: string, language: string): string {
  const date = new Date(`${deadline}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return deadline;
  try {
    return date.toLocaleDateString(language, { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
  } catch {
    return date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
  }
}

/** Server-rendered progress bar: no script, the width is inline CSS set from the percent. */
export function Progress({
  raisedAmount,
  goalAmount,
  percent,
  giftCount,
  currency,
  language,
  deadline,
}: {
  raisedAmount: number;
  goalAmount: number;
  percent: number;
  giftCount?: number;
  currency: string;
  language: string;
  deadline?: string;
}) {
  const t = uiStrings(language);
  const raised = formatMoney(raisedAmount, currency, language);
  return (
    <div className="progress-block">
      {goalAmount > 0 ? (
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={`${percent}%`}>
          <span style={{ width: `${percent}%` }} />
        </div>
      ) : null}
      <p className="progress-text">
        <span>
          <strong>{raised}</strong> {t.raised}
          {goalAmount > 0 ? ` ${t.ofGoal} ${formatMoney(goalAmount, currency, language)}` : ""}
        </span>
        {giftCount !== undefined && giftCount > 0 ? (
          <span>
            {giftCount} {giftCount === 1 ? t.gift : t.gifts}
          </span>
        ) : null}
      </p>
      {deadline ? (
        <p className="progress-deadline">
          {t.ends} {formatDeadline(deadline, language)}
        </p>
      ) : null}
    </div>
  );
}

/** Cards for the Give section, shared by every template. Renders nothing without campaigns. */
export function CampaignCards({ section, options }: { section: GiveSection; options: RenderOptions }) {
  const cards = campaignsFor(section, options);
  if (cards.length === 0) return null;
  const language = options.language ?? "en";
  const t = uiStrings(language);
  return (
    <div className={`campaigns${cards.length > 2 ? " many" : ""}`}>
      {cards.map((c) => (
        <a className="campaign-card" key={c.id} href={c.href}>
          {c.coverImage ? <img src={options.imageUrl(c.coverImage)} alt={c.coverImage.alt} /> : null}
          <span className="in">
            <strong className="title">{c.title}</strong>
            {c.summary ? <span className="summary">{c.summary}</span> : null}
            <Progress raisedAmount={c.raisedAmount} goalAmount={c.goalAmount} percent={c.percent} currency={c.currency} language={language} />
            <span className="more">{t.viewCampaign} →</span>
          </span>
        </a>
      ))}
    </div>
  );
}

/** Every cover image the cards of a document would show, for bundling. */
export function campaignImages(options: Pick<RenderOptions, "campaigns">): ImageRef[] {
  return (options.campaigns ?? []).flatMap((c) => (c.coverImage ? [c.coverImage] : []));
}

/** CSS for the Give-section cards and the progress bar; each template's stylesheet appends it. */
export const CAMPAIGN_CSS = `.campaigns{display:grid;gap:20px;margin-top:28px;text-align:left}
@media(min-width:640px){.campaigns{grid-template-columns:repeat(2,1fr)}}
@media(min-width:960px){.campaigns.many{grid-template-columns:repeat(3,1fr)}}
.campaign-card{display:flex;flex-direction:column;background:#fff;color:#1a1a1a;border:1px solid rgba(0,0,0,.08);border-radius:var(--radius);overflow:hidden;text-decoration:none;box-shadow:0 1px 2px rgba(0,0,0,.05)}
.campaign-card:hover{box-shadow:0 6px 18px rgba(0,0,0,.1)}
.campaign-card img{width:100%;aspect-ratio:16/9;object-fit:cover}
.campaign-card .in{display:flex;flex:1;flex-direction:column;gap:10px;padding:18px}
.campaign-card .title{font-family:var(--heading-font);font-size:1.15rem;line-height:1.25}
.campaign-card .summary{opacity:.85;font-size:.95rem}
.campaign-card .more{margin-top:auto;font-weight:600;color:var(--primary)}
.progress-block{display:grid;gap:6px}
.progress{height:10px;border-radius:999px;background:rgba(0,0,0,.1);overflow:hidden}
.progress>span{display:block;height:100%;background:var(--accent);border-radius:999px}
.progress-text{display:flex;justify-content:space-between;gap:8px;margin:0;font-size:.9rem}
.progress-deadline{margin:0;font-size:.85rem;opacity:.75}
`;
