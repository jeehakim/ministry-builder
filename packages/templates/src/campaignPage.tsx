import { renderToStaticMarkup } from "react-dom/server";
import { formatMoney, giveLink, SiteDocument, type CampaignInput, type CampaignTotals, type ImageRef } from "@ministry/schema";
import { Progress } from "./campaign";
import { uiStrings } from "./i18n";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { paragraphs } from "./util";
import { getTemplate } from "./registry";
import type { LanguageLink } from "./types";

/** The campaign as the page shows it: already localized by the caller. */
export type CampaignPageInput = Pick<
  CampaignInput,
  "title" | "summary" | "story" | "goalAmount" | "currency" | "deadline" | "coverImage" | "suggestedAmounts" | "giveUrl" | "giveLabel" | "donorWallEnabled" | "status"
> & { slug: string };

export interface CampaignPageOptions {
  imageUrl: (ref: ImageRef) => string;
  /** Link back to the site's page in the same language, relative to the campaign page. */
  siteHref: string;
  canonicalUrl?: string;
  languageLinks?: LanguageLink[];
  /** Display names of donors who opted in ("Maria L."), newest first. Shown only when the campaign enables the wall. */
  donorWall?: string[];
}

export interface RenderedCampaignPage {
  html: string;
  images: ImageRef[];
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

const CAMPAIGN_PAGE_CSS = `.cp{max-width:760px;margin:0 auto;padding:16px 20px 64px}
.cp-top{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px 24px;padding:12px 0 28px}
.cp-top .brand{display:flex;align-items:center;gap:10px;text-decoration:none;color:inherit;font-family:var(--heading-font);font-weight:700;font-size:1.1rem}
.cp-top .brand img{height:36px;width:auto}
.cp-cover{width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:var(--radius);margin-bottom:28px}
.cp .eyebrow{display:block;font-size:.8rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--primary);margin-bottom:12px}
.cp h1{font-size:clamp(2rem,5vw,3rem);margin:0 0 .4em}
.cp .summary{font-size:1.2rem;opacity:.85;margin:0 0 24px}
.cp-progress{margin:0 0 28px;padding:20px;border:1px solid rgba(0,0,0,.1);border-radius:var(--radius);background:rgba(0,0,0,.025)}
.cp-progress .progress-text{font-size:1rem}
.cp-amounts{display:flex;flex-wrap:wrap;gap:10px;margin:16px 0 12px}
.cp-amounts a{padding:10px 18px;border:2px solid var(--primary);border-radius:var(--radius);color:var(--primary);text-decoration:none;font-weight:600}
.cp-amounts a:hover{background:var(--primary);color:#fff}
.cp-give{display:inline-block;padding:14px 26px;background:var(--accent);color:#111;border-radius:var(--radius);font-weight:700;text-decoration:none}
.cp-give:hover{filter:brightness(1.08)}
.cp-closed{margin:0;font-weight:600}
.cp-story{font-size:1.05rem;margin-bottom:36px}
.cp-wall h2{font-size:1.3rem}
.cp-wall ul{list-style:none;padding:0;margin:0;display:flex;flex-wrap:wrap;gap:8px}
.cp-wall li{padding:6px 12px;border-radius:999px;background:rgba(0,0,0,.06);font-size:.95rem}
.cp-foot{opacity:.7;font-size:.9rem;padding-top:40px}
.cp-foot a{color:inherit}
`;

function CampaignBody({ doc, campaign, totals, options }: { doc: SiteDocument; campaign: CampaignPageInput; totals: CampaignTotals; options: CampaignPageOptions }) {
  const language = doc.meta.language;
  const t = uiStrings(language);
  const open = campaign.status === "active";
  const mainLink = giveLink(campaign.giveUrl, campaign.slug);
  const wall = campaign.donorWallEnabled ? (options.donorWall ?? []) : [];
  return (
    <>
      <header className="cp-top">
        <a className="brand" href={options.siteHref}>
          {doc.meta.logo ? <img src={options.imageUrl(doc.meta.logo)} alt="" /> : null}
          <span>{doc.meta.orgName}</span>
        </a>
        <LanguageSwitcher links={options.languageLinks} />
      </header>
      <main>
        {campaign.coverImage ? <img className="cp-cover" src={options.imageUrl(campaign.coverImage)} alt={campaign.coverImage.alt} /> : null}
        <span className="eyebrow">{t.campaign}</span>
        <h1>{campaign.title}</h1>
        {campaign.summary ? <p className="summary">{campaign.summary}</p> : null}

        <section className="cp-progress" aria-label={t.raised}>
          <Progress
            raisedAmount={totals.raisedAmount}
            goalAmount={totals.goalAmount}
            percent={totals.percent}
            giftCount={totals.giftCount}
            currency={totals.currency}
            language={language}
            deadline={campaign.deadline}
          />
          {open && mainLink ? (
            <>
              {campaign.suggestedAmounts.length ? (
                <div className="cp-amounts">
                  {campaign.suggestedAmounts.map((amount) => {
                    const href = giveLink(campaign.giveUrl, campaign.slug, amount);
                    return href ? (
                      <a key={amount} href={href} target="_blank" rel="noopener">
                        {t.giveAmount} {formatMoney(amount, campaign.currency, language)}
                      </a>
                    ) : null;
                  })}
                </div>
              ) : null}
              <a className="cp-give" href={mainLink} target="_blank" rel="noopener">
                {campaign.giveLabel || t.giveNow}
              </a>
            </>
          ) : null}
          {!open ? <p className="cp-closed">{t.campaignClosed}</p> : null}
        </section>

        <div className="cp-story">{paragraphs(campaign.story).map((p, i) => <p key={i}>{p}</p>)}</div>

        {wall.length ? (
          <section className="cp-wall" aria-label={t.donorWall}>
            <h2>{t.donorWall}</h2>
            <ul>
              {wall.map((name, i) => (
                <li key={i}>{name}</li>
              ))}
            </ul>
          </section>
        ) : null}
      </main>
      <footer className="cp-foot">
        <a href={options.siteHref}>← {t.back}</a> · © {new Date().getFullYear()} {doc.meta.orgName}
      </footer>
    </>
  );
}

/**
 * A complete campaign page in the site's theme and language. Static: the progress bar is rendered
 * from `totals`, so the page is re-rendered when the site is published again. `input` must already be
 * localized (title, story) for `doc.meta.language`.
 */
export function renderCampaignPage(docInput: SiteDocument, campaign: CampaignPageInput, totals: CampaignTotals, options: CampaignPageOptions): RenderedCampaignPage {
  const doc = SiteDocument.parse(docInput);
  const template = getTemplate(doc.theme.templateId);
  const body = renderToStaticMarkup(<CampaignBody doc={doc} campaign={campaign} totals={totals} options={options} />);
  const title = `${campaign.title} — ${doc.meta.orgName}`;
  const description = campaign.summary || paragraphs(campaign.story)[0]?.slice(0, 160) || doc.meta.description;
  const lines: string[] = [];
  for (const l of options.languageLinks ?? []) {
    lines.push(`<link rel="alternate" hreflang="${escapeHtml(l.code)}" href="${escapeHtml(absolute(l.href, options.canonicalUrl))}">`);
  }
  if (options.canonicalUrl) {
    lines.push(`<link rel="canonical" href="${escapeHtml(options.canonicalUrl)}">`);
    lines.push(
      `<meta property="og:type" content="website">`,
      `<meta property="og:site_name" content="${escapeHtml(doc.meta.orgName)}">`,
      `<meta property="og:title" content="${escapeHtml(title)}">`,
      `<meta property="og:description" content="${escapeHtml(description)}">`,
      `<meta property="og:url" content="${escapeHtml(options.canonicalUrl)}">`,
    );
    const image = campaign.coverImage ?? doc.meta.logo;
    if (image) lines.push(`<meta property="og:image" content="${escapeHtml(absolute(options.imageUrl(image), options.canonicalUrl))}">`);
  }
  const html = `<!doctype html>
<html lang="${escapeHtml(doc.meta.language)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta name="theme-color" content="${escapeHtml(doc.theme.primary)}">
${lines.join("\n")}
<style>${template.css(doc.theme)}
${CAMPAIGN_PAGE_CSS}</style>
</head>
<body>
<div class="cp">
${body}
</div>
</body>
</html>
`;
  const images: ImageRef[] = [];
  if (doc.meta.logo) images.push(doc.meta.logo);
  if (campaign.coverImage) images.push(campaign.coverImage);
  return { html, images };
}

function absolute(href: string, base: string | undefined): string {
  if (!base) return href;
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}
