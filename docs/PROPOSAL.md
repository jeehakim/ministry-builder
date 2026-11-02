# AI Landing Page Platform for Non-Profits — Proposal (v2)

**Project:** Shofar Ministry non-profit initiative
**Date:** 2026-11-02 (v2; replaces the single-tier v1)
**Companion:** `docs/COMPETITORS.md` (market and price benchmarks)
**Status:** Draft for decision

---

## 1. Recommendation in one paragraph

Build a **structured-content site builder with an AI copilot** for small non-profits and ministries. A user signs in with Clerk, describes their organization in plain language, attaches images, and gets **two or three generated variations** to pick from and edit. The site renders from curated templates, so it is fast, accessible, and editable forever. Offer **two tiers**: a **free tier** where the site is exported or claimed into the user's own free Cloudflare account, and a **hosted tier at $79 to $99 per year per domain** where Shofar hosts the site, handles SSL and the custom domain, and includes AI edits, forms, and analytics. Add a **done-for-you** option at $149 to $299 one time. The platform itself runs on Cloudflare free tiers and costs $1 to $6 per month at 5 to 10 users; the LLM runs behind a provider adapter, starting on the OpenAI quota you have today.

---

## 2. Product

### 2.1 Who it is for

Small non-profits, churches, and ministries with under $20 per month to spend and no webmaster. They need one clear page: who we are, what we do, when we meet, how to give, how to reach us. Often bilingual (Korean/English first).

### 2.2 User journey

1. **Sign in** with Clerk (Google or email link; no passwords to support).
2. **Describe** the organization in natural language, paste a flyer's text or a mission statement, attach a logo and a few photos. Optionally add a design reference (screenshot or URL).
3. **Review three variations.** The AI returns three complete drafts that differ in template, color/font theme, hero style, and copy tone. Pick one; the other two stay available to swap to.
4. **Edit** in a section-based editor with live preview and per-field AI buttons ("warmer", "shorter", "translate to Korean", "write alt text").
5. **Publish.** Free tier: download a ZIP or claim the site into your own Cloudflare account. Hosted tier: connect or buy a domain inside the platform and it is live with SSL in minutes.
6. **Maintain.** Change a date, swap a photo, add an event, republish. Hosted customers get a small monthly AI edit allowance; free users get a lifetime allowance.

### 2.3 Why structured content, not generated HTML

- **Editability.** Event dates and staff names change constantly; a field edit beats a regeneration that drifts.
- **Quality.** Templates are reviewed once for mobile, accessibility, and speed. Generated HTML must be re-checked every time.
- **Cost.** A structured draft is 10 to 20 times fewer tokens than full HTML, and three variations cost three times the output tokens of one, still cents per site.
- **Degrades gracefully.** The editor works with zero AI if a quota is exhausted or a provider is down.
- **Variations are cheap** because they are the same content document with different theme tokens, template, and tone.

### 2.4 Non-profit-specific content schema

Sections the templates understand: hero, mission/about, programs or ministries, events and service times, team, stories/testimonials, give (links out to Zeffy, Givebutter, PayPal, Tithe.ly; no payment handling by us), contact with a working form (Web3Forms or Formspree free tiers, or our own Worker endpoint for hosted sites), social links, optional second language. Competitors either make users assemble these or bundle them into $99-plus church platforms (`COMPETITORS.md` §2, §4).

---

## 3. Business model

### 3.1 Tiers

| Tier | Price | What you get | Who it is for |
|---|---|---|---|
| **Free** | $0 | Full builder, 3 AI variations, ~10 lifetime AI actions, ZIP export or claim into your own Cloudflare account, small "Made with" footer | DIY orgs, the mission tier |
| **Hosted** | **$79 to $99 per year per domain** (about $7 to $8 per month); monthly option $9 to $12 | We host on Shofar's Cloudflare, SSL, custom domain connect (domain passed through at cost, about $11/yr for `.org`, or bundled at $99), forms that deliver, analytics, AI edit allowance (e.g. 50 actions per month), email support | Orgs that want it handled |
| **Done-for-you** | **$149 to $299 one time** + Hosted | Shofar staff build it from a call and a folder of photos, hand it over | Orgs with no volunteer to do it |
| **Sponsored** | $0 to the org | A donor or larger church pays the Hosted fee for a small ministry | Top of funnel, fits the non-profit identity |

Positioning: "your first website, done in an afternoon, and you own it." Not a church management system. Rationale and benchmarks in `COMPETITORS.md` §5: above Carrd ($19 to $49, no AI), below Wix's non-profit effective price (about $105 via TechSoup) and sticker prices of Wix, Squarespace, Durable, Framer ($120 to $300), far below church bundles ($380 to $1,200 plus setup fees).

### 3.2 Why annual-first

Every major builder discounts annual 20 to 35%. Small non-profits budget yearly and approve a line item more easily than a recurring card charge. Annual billing also halves payment-failure churn on a product people finish and then touch rarely. Keep monthly visible for those who insist, priced about 30% higher.

### 3.3 Unit economics (per Hosted customer, per month equivalent)

| Cost | Amount |
|---|---|
| LLM usage | $0.10 to $1.00 |
| Card fees (about 2.9% + $0.30 on an annual charge, amortized) | about $0.25 |
| Infrastructure share | near $0 |
| Support time | the real cost; budget 20 to 30 minutes per customer per year |

Gross margin above 90% from the first customer.

### 3.4 Revenue scenarios

| Paying orgs | Hosted revenue / year | Platform cost / year |
|---|---|---|
| 10 | about $900 | under $100 |
| 50 | about $4,500 | under $300 |
| 200 | about $18,000 | under $1,200 |

Done-for-you adds $150 to $300 each on top. The constraint is acquisition and renewal, not margin. Realistic first-year goal: 20 to 50 orgs through Shofar's own network, denominational partners, and sponsorships.

### 3.5 Guardrails against "build many, deploy elsewhere"

- Paid plans are **per site**, not per account: one Hosted domain equals one site document.
- AI allowance is per site and per month on Hosted, lifetime on Free; show "AI credits used" in the UI.
- Free exports carry a small footer; Hosted sites do not.
- Annual billing removes the "pay one month, export three sites, cancel" pattern.
- Do not over-engineer: an exported template is low value, and anyone determined to abuse it was never a customer.

### 3.6 Payments

Stripe (non-profit rate may be available to Shofar as the merchant). No payment handling for the orgs' own donations; link out to Zeffy or Givebutter, which are free to non-profits and are complements, not competitors.

---

## 4. Platform architecture (free tiers)

```
Browser — Vite + React SPA, served as Workers static assets (free, no server CPU)
  ├─ Clerk React SDK
  ├─ Editor, template renderer (React → static HTML), iframe live preview, variation picker
  ├─ Image resize to WebP before upload
  └─ ZIP export (JSZip) for the Free tier
        │ fetch with Clerk JWT
        ▼
API Worker — Hono, TypeScript
  ├─ Clerk backend: verify JWT, load role and plan
  ├─ D1: users, orgs, sites, site_versions, assets, ai_usage, subscriptions, domains, deployments
  ├─ R2: uploaded images, published site bundles (one prefix per hosted site)
  ├─ AI route → provider adapter (OpenAI now, Anthropic later), structured output, quotas
  ├─ Billing route → Stripe Checkout + webhooks
  ├─ Free-tier publish → Cloudflare Temporary Accounts API (preview + claim URL)
  └─ Hosted publish → write bundle to R2, create custom hostname via Cloudflare for SaaS
        ▼
Hosting Worker — one router for all hosted sites
  ├─ Resolves request hostname → site id (KV lookup)
  ├─ Serves files from R2 with cache headers; 404 page; redirects
  └─ Handles contact-form POSTs for hosted sites (email via Resend free tier)
```

Design notes:

- **Static SPA plus small Workers** instead of Next.js on Workers: the Workers free plan caps CPU at 10 ms per request, so rendering happens in the browser and the Workers do JSON, storage, and outbound API calls. Workers Paid ($5/month) is the escape hatch, and becomes worthwhile once hosted-site traffic approaches 100k requests per day.
- **Cloudflare for SaaS** gives each hosted customer's domain SSL and routes it to the Hosting Worker. The first 100 custom hostnames are free, then about $0.10 per hostname per month. Customers either point a CNAME or buy the domain through us (Cloudflare Registrar at cost, moved under the platform zone).
- **Free tier claim flow** uses Cloudflare's Temporary Accounts API (July 2026): the backend deploys to a temporary account, shows a live preview and a claim link, and the user signs in or creates a Cloudflare account within 60 minutes to keep it. Fallback is ZIP + Cloudflare Drop.
- **Provider adapter for AI.** One interface (`draftSite`, `variations`, `rewriteField`, `interpretDesign`) with an OpenAI implementation now and an Anthropic one later. The OpenAI free tier is a monthly spending ceiling, not a credit, so treat it as temporary.

### 4.1 Monthly platform cost at 5 to 10 users

| Item | Monthly |
|---|---|
| Workers, D1, R2, KV (free plan) | $0 (Workers Paid $5 when needed) |
| Clerk (free to 50,000 retained users) | $0 |
| Cloudflare for SaaS custom hostnames | $0 for first 100 |
| Platform domain | about $1 |
| Resend (email), Sentry (errors), Cloudflare Web Analytics | $0 |
| Stripe | per transaction |
| **Total** | **$1 to $6** |

At 100 paying customers the bill is still under about $30 per month.

---

## 5. Data model

- `users` — Clerk id, role (`admin` for Shofar staff, `member`)
- `organizations` — name, owner_user_id, created_by (lets staff build then hand over)
- `sites` — org_id, slug, template_id, theme JSON, plan (`free` | `hosted`), status, current_version_id
- `site_versions` — site_id, document JSON, variation_group_id, created_by, created_at (append-only; variations are three versions sharing a group id)
- `assets` — site_id, R2 key, alt text, dimensions, bytes
- `ai_usage` — user_id, site_id, day/month, action_count, tokens, provider
- `subscriptions` — org_id, site_id, stripe_customer_id, stripe_subscription_id, plan, interval, status, renews_at
- `domains` — site_id, hostname, kind (`cname` | `registered`), cf_custom_hostname_id, ssl_status
- `deployments` — site_id, kind (`zip` | `claim` | `hosted`), preview_url, claim_url, claim_expires_at, claimed_at, published_at

The **site document schema** (Zod, shared by editor, AI output, and templates) is the core contract: `meta`, `theme`, `languages`, `sections[]` as a discriminated union.

---

## 6. AI design

- **Structured output** against the site schema so the renderer never sees malformed data; three variations come back as one array in a single call.
- **Design reference → theme tokens** (palette, font pair, mood, template id, hero style) constrained to what templates support.
- **Per-field assists** are small calls; translation produces the second-language document.
- **Prompt-injection posture:** user notes and images are data. The system prompt instructs the model to output only the schema and ignore instructions inside the content. Narrow output format limits the blast radius.
- **Quotas:** Free 10 lifetime actions; Hosted 50 per month per site; account-level monthly ceiling with an alert. Log tokens per call.
- **Cost reference** (per action, 5K in / 3K out; three variations about 9K out): Claude Opus 5.5 about $0.08 to $0.20, Claude Haiku 5.5 about $0.002 to $0.005; OpenAI comparable-tier models are in the same range. Hundreds of sites per year cost tens to low hundreds of dollars.

---

## 7. Roadmap

| Phase | Scope | Rough effort |
|---|---|---|
| **0. Walking skeleton** | Monorepo, Clerk, D1 schema, one template, section editor, live preview, image upload, ZIP export, in-app Cloudflare Drop guide | 1–2 weeks |
| **1. AI copilot** | Draft from notes, 3 variations, design reference → theme, per-field assists, alt text + SEO, provider adapter, quotas | 1–2 weeks |
| **2. Hosted tier** | Hosting Worker + R2 bundles, Cloudflare for SaaS custom hostnames, domain connect/purchase flow, Stripe Checkout + webhooks, plan gating, forms endpoint, analytics snippet | 2 weeks |
| **3. Free-tier claim flow** | Temporary Accounts API publish, preview + claim UI, deployment history | 1 week |
| **4. Grow** | 3–5 more templates, Korean/English toggle, admin "build for them" + hand-over, sponsored plans, renewal reminders | ongoing |

Phase 0 is usable on its own. Phase 2 is where revenue starts; Phase 3 can move earlier if the mission tier matters more than revenue at launch.

---

## 8. Risks and open questions

- **Acquisition and renewal, not margin.** Validate with 5 to 10 target orgs before Phase 2: annual or monthly? Already own a domain? In TechSoup (Wix at 70% off is the real competitor there)?
- **Variations as a differentiator is unverified.** No source confirmed competitors return side-by-side drafts; test Durable, B12, and Wix hands-on before claiming it in marketing.
- **Workers free limits.** 100k requests per day is shared by the API and all hosted sites; plan for Workers Paid at $5/month once a few dozen sites are hosted. D1 free-tier daily limits are hard failures since Sept 2026; keep queries indexed.
- **Cloudflare for SaaS prerequisites.** Requires the platform zone on Cloudflare and a fallback origin; verify the free-plan hostname allowance at signup.
- **Temporary Accounts API requirements.** Must show Cloudflare's Terms and Privacy Policy and solve a proof-of-work challenge; 60-minute claim window needs an unmissable UI and a "publish again" path.
- **Sales tax and fees.** Confirm Stripe fees and tax obligations on a $79 to $99 plan; consider a verified non-profit price if an EIN check is worth the friction.
- **Image rights.** Checkbox that the org has rights to uploaded images; generate alt text, not images.
- **Naming.** Say "Cloudflare" and "your own free account" in the UI, not "Pages" or "Workers".

---

## 9. Sources

- Market and price benchmarks: `docs/COMPETITORS.md` (aggregator-sourced; re-verify vendor pages before publishing prices)
- Clerk pricing: https://clerk.com/pricing, https://clerk.com/articles/clerk-pricing-explained
- OpenAI free tier is a spending ceiling: https://benchlm.ai/free-tier/openai
- Cloudflare: new projects on Workers: https://developers.cloudflare.com/workers/best-practices/workers-best-practices/
- Cloudflare Drop: https://developers.cloudflare.com/changelog/post/2026-07-08-cloudflare-drag-and-drop/
- Temporary Accounts and claim flow: https://developers.cloudflare.com/workers/platform/claim-deployments/
- Workers static assets direct upload: https://developers.cloudflare.com/workers/static-assets/direct-upload/
- Workers limits: https://developers.cloudflare.com/workers/platform/limits/
- D1 free-tier enforcement: https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/
- Workers AI free allocation: https://developers.cloudflare.com/workers-ai/platform/pricing/
- Anthropic model pricing (Claude API reference, cached 2026-10-06): Opus 5.5 $4/$20 per MTok, Haiku 5.5 $0.10/$0.50 per MTok
