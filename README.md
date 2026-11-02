<p align="center">
  <img src="docs/screenshots/editor-light.jpg#gh-light-mode-only" alt="Ministry Sites editor: section list on the left, live preview on the right" width="820">
  <img src="docs/screenshots/editor-dark.jpg#gh-dark-mode-only" alt="Ministry Sites editor in dark mode" width="820">
</p>

<h1 align="center">Ministry Sites</h1>

<p align="center">
  <strong>Free, beautiful landing pages for non-profits and ministries.</strong><br>
  Describe your organization, add a few photos, pick a design, and publish to Cloudflare's free plan.<br>
  No monthly fee. No lock-in. You own the site.
</p>

<p align="center">
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <img alt="Built with TypeScript" src="https://img.shields.io/badge/TypeScript-strict-3178c6.svg">
  <img alt="Runs on Cloudflare" src="https://img.shields.io/badge/runs%20on-Cloudflare-f38020.svg">
</p>

---

## Why this exists

Most small churches, charities, and community groups have a Facebook page and a prayer. A real website costs $15 to $25 a month on the usual builders, or $100 a month on church platforms, and someone still has to build it.

Ministry Sites is a project of [Shofar Ministry](https://shofar.io) to change that:

- **A page that fits non-profits.** Mission, programs, service times and events, team, stories, a Give section that links to your existing donation platform, and a contact form. Nothing you have to invent.
- **AI that writes with you.** Describe the organization in your own words, get three complete page designs to choose from, polish any line, translate the whole site, and never have a fact invented.
- **Fast and accessible by default.** Sites are plain static HTML from reviewed templates, no scripts. They load instantly on a phone and pass accessibility checks without extra work.
- **Free to host, forever.** Publish on Ministry Sites in one click, or export a ZIP and drop it on [cloudflare.com/drop](https://cloudflare.com/drop) and own the hosting yourself. Either way there is no monthly fee for the page.
- **Edit it next year.** Content is structured, so changing a service time is a one-field edit and a republish, not a rebuild.

## What it does

**Build**
- Sign in with [Clerk](https://clerk.com), or run with no keys at all in a local, browser-only mode
- Section editor with drag-and-drop ordering, show/hide, per-section forms and image upload with in-browser resize to WebP
- Live preview in a browser frame, desktop and phone widths, light and dark themes
- Three templates (Classic, Modern, Bold) with color, font, hero style and corner options

**AI copilot** (OpenAI today, Claude via `ANTHROPIC_API_KEY`)
- Draft the whole page from notes, with one or three variations to compare side by side
- Per-field assists: improve, shorten, warm up, translate, or a custom instruction
- Alt text for images, a theme from a design reference, full-site translation
- A daily allowance per user; every call logs model, tokens, inputs and what it produced

**Languages**
- Any number of languages per site; translations are overlays on the primary content so images, links and layout stay shared
- Each language publishes at its own path with a switcher, `hreflang` alternates and `Content-Language`

**Publish and host**
- One-click publish to `sites.shofar.io/<slug>/`, served from R2 by the API Worker, with thank-you pages, `robots.txt`, `sitemap.xml`, canonical and Open Graph tags
- Custom domains through Cloudflare for SaaS (main domain plus redirect domains) with automatic certificates
- Self-host route: ZIP export plus a guided Cloudflare Drop flow; the exported form still delivers through the platform

**Contact form and inbox**
- A localized contact form on every language page; messages are stored and shown in a Messages inbox with delivery status and reply
- Delivery by email through Cloudflare Email Sending or Resend (pluggable; store-only until one is configured)
- Honeypot, validation, per-visitor and per-site rate limits; the address is never printed on the page unless the owner chooses to

**Operate**
- Staff automation (`X-Staff-Token`) for build-for-them sites and hand-over to a customer by email
- In-app guides for the AI copilot, publishing and custom domains
- Security headers on the app, API and hosted sites; per-user and per-site limits; full site deletion

## Try it in two minutes

You need Node 22 and pnpm.

```bash
git clone https://github.com/jeehakim/ministry-builder.git && cd ministry-builder && pnpm install
```

```bash
pnpm --filter @ministry/web dev
```

Open http://localhost:5173. With no keys configured the editor runs in local mode: your site is saved in the browser and you can export a ZIP right away.

### With sign-in, AI and the API

1. Create a Clerk application and copy its keys: publishable key into `apps/web/.env` as `VITE_CLERK_PUBLISHABLE_KEY`, secret key into `apps/api/.dev.vars` as `CLERK_SECRET_KEY`.
2. Optionally add `OPENAI_API_KEY` (or `ANTHROPIC_API_KEY`) to `apps/api/.dev.vars` for the copilot.
3. Run the API with a local database and bucket (no Cloudflare account needed yet):

```bash
pnpm --filter @ministry/api db:migrate:local
```

```bash
pnpm --filter @ministry/api dev
```

Both `.env` and `.dev.vars` are gitignored; the `.example` files next to them list every setting.

## Deploy your own copy

Everything runs on Cloudflare's free plan.

1. `wrangler d1 create ministry-sites` and paste the id into `apps/api/wrangler.jsonc`; create the buckets with `wrangler r2 bucket create ministry-images` and `wrangler r2 bucket create ministry-published`.
2. Apply migrations: `wrangler d1 migrations apply ministry-sites --remote` inside `apps/api`.
3. Secrets on the API Worker with `wrangler secret put`: `CLERK_SECRET_KEY`, and optionally `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `STAFF_API_TOKEN`, `CLOUDFLARE_API_TOKEN` (custom domains).
4. Set your hostnames in both `wrangler.jsonc` files (`routes` with `custom_domain: true`), `ALLOWED_ORIGIN`, `PUBLIC_SITES_HOST` and `PUBLIC_API_HOST`, the API and Clerk hosts in `apps/web/src/lib/csp.ts` (then regenerate the policy line in `apps/web/public/_headers`), and build the web app with `VITE_CLERK_PUBLISHABLE_KEY` and `VITE_API_URL` in `apps/web/.env.production`.
5. `pnpm --filter @ministry/api deploy` and `pnpm --filter @ministry/web deploy`.

[apps/api/README.md](apps/api/README.md) covers every variable and secret, email providers, and the one-time Cloudflare for SaaS setup for custom domains.

## How it is built

| Path | What |
|---|---|
| `packages/schema` | The Zod `SiteDocument` contract (sections, theme, languages, translation overlays) and the AI request/response types |
| `packages/templates` | React templates rendered to static HTML with inline CSS; shared contact form, language switcher, thank-you page, SEO head |
| `apps/web` | Vite + React 19, Tailwind v4, shadcn/ui, dnd-kit, motion, Clerk; editor, AI UI, inbox, guides |
| `apps/api` | Hono on Cloudflare Workers: Clerk JWT auth, Drizzle + D1, R2, AI provider adapter, publishing and hosting, contact form, email senders |

The site document is the heart of the system. The editor edits it, the AI produces it through structured output, templates render it, and publishing writes one static page per language.

```bash
pnpm typecheck && pnpm test && pnpm build
```

## Costs

| Piece | Plan | Cost |
|---|---|---|
| Workers, D1, R2, KV | Cloudflare free | $0 (100k requests/day shared by the API and hosted sites; Workers Paid at $5/month removes the cap) |
| Clerk | free tier | $0 |
| Custom domains | Cloudflare for SaaS | first 100 hostnames free |
| Email delivery | Resend free tier or Cloudflare Email Sending (Workers Paid) | $0 or $5/month |
| AI | OpenAI or Anthropic, per token | about $0.01 to $0.05 per site drafted, cents per edit |

## Roadmap

- Billing for the hosted tier (Stripe), sponsored sites, done-for-you flow
- One-click claim into the customer's own Cloudflare account (Temporary Accounts API)
- More templates and section types; ZIP export of every language
- Enrichment sources for the copilot (non-profit registries, licensed stock photos)

Plan: [docs/PROPOSAL.md](docs/PROPOSAL.md). The market and pricing research it cites is not part of the repository.

## Contributing

Issues and pull requests are welcome, especially from people who run small non-profits and know what a page actually needs. Templates are the easiest place to start: add a folder under `packages/templates/src`, export it from the registry, and the editor picks it up.

Please keep every template fast, mobile-first, and accessible, and never add payment processing: giving stays with the platforms non-profits already trust.

## License

[MIT](LICENSE). Build on it, host it for your community, make it yours.
