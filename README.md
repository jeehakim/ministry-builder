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
- **Fast and accessible by default.** Sites are plain static HTML from reviewed templates. They load instantly on a phone and pass accessibility checks without extra work.
- **Free to host, forever.** Export a ZIP and drop it on [cloudflare.com/drop](https://cloudflare.com/drop), claim it into your own free Cloudflare account, and add your domain with free SSL. The site lives in *your* account, not ours.
- **Edit it next year.** Content is structured, so changing a service time is a one-field edit and a re-export, not a rebuild.
- **AI help on the way.** The roadmap adds a copilot that drafts your copy from rough notes, proposes two or three designs, writes alt text, and translates to a second language (Korean/English first).

## What works today (Phase 0)

- Sign in with [Clerk](https://clerk.com), or run with no keys at all in a local, browser-only mode
- Section editor with drag-and-drop ordering, show/hide, and per-section forms
- Live preview in a browser frame, desktop and phone widths
- Image upload with in-browser resize and WebP conversion, plus alt text
- One template, "Classic", with color, font, hero style, and corner options
- Light, dark, and system themes
- ZIP export and a guided publish flow for Cloudflare Drop
- API on Cloudflare Workers with D1 and R2, versioned saves, and tests that run in the Workers runtime

## Try it in two minutes

You need Node 22 and pnpm.

```bash
git clone https://github.com/jeehakim/ministry-builder.git && cd ministry-builder && pnpm install
```

```bash
pnpm --filter @ministry/web dev
```

Open http://localhost:5173. With no keys configured the editor runs in local mode: your site is saved in the browser and you can export a ZIP right away.

### With sign-in and the API

1. Create a free Clerk application and copy its publishable and secret keys.
2. `apps/web/.env`: set `VITE_CLERK_PUBLISHABLE_KEY` and `VITE_API_URL=http://localhost:8787`.
3. `apps/api/.dev.vars`: set `CLERK_SECRET_KEY`.
4. Run the API with a local database and bucket (no Cloudflare account needed yet):

```bash
pnpm --filter @ministry/api db:migrate:local
```

```bash
pnpm --filter @ministry/api dev
```

Both `.env` and `.dev.vars` are gitignored; the `.example` files next to them list every setting.

## Deploy your own copy

Everything runs on Cloudflare's free plan.

1. `wrangler d1 create ministry-sites` and paste the id into `apps/api/wrangler.jsonc`.
2. `wrangler r2 bucket create ministry-images`.
3. `wrangler secret put CLERK_SECRET_KEY` inside `apps/api`, then `pnpm --filter @ministry/api deploy`.
4. Build the web app with `pnpm --filter @ministry/web build` and deploy `apps/web/dist` as a Worker with static assets, or drop the folder on Cloudflare Drop.
5. Set `ALLOWED_ORIGIN` in `wrangler.jsonc` to your web app's URL.

See [apps/api/README.md](apps/api/README.md) for the details.

## How it is built

| Path | What |
|---|---|
| `packages/schema` | The Zod `SiteDocument` contract shared by the editor, the AI adapter, and the templates |
| `packages/templates` | React templates rendered to static HTML with inline CSS |
| `apps/web` | Vite + React 19, Tailwind v4, shadcn/ui, dnd-kit, motion, Clerk |
| `apps/api` | Hono on Cloudflare Workers, Drizzle + D1, R2, Clerk JWT verification |

The site document is the heart of the system. The editor edits it, templates render it, and the upcoming AI copilot produces it through structured output, so nothing downstream ever sees malformed data.

```bash
pnpm typecheck && pnpm test && pnpm build
```

## Roadmap

- **Phase 1, AI copilot.** Draft from notes, two or three design variations, per-field rewrites, alt text and SEO, bilingual output.
- **Phase 2, hosted tier.** For organizations that want it handled: hosting on our Cloudflare account, custom domains with SSL, forms that deliver, analytics, at a price a small non-profit can afford.
- **Phase 3, one-click publish.** Cloudflare's temporary-account flow so publishing is one click and a sign-up, no ZIP.
- **Then:** more templates, a done-for-you option, sponsored sites for the smallest ministries.

The full plan and the market research behind it are in [docs/PROPOSAL.md](docs/PROPOSAL.md) and [docs/COMPETITORS.md](docs/COMPETITORS.md).

## Contributing

Issues and pull requests are welcome, especially from people who run small non-profits and know what a page actually needs. Templates are the easiest place to start: add a folder under `packages/templates/src`, export it from the registry, and the editor picks it up.

Please keep every template fast, mobile-first, and accessible, and never add payment processing: giving stays with the platforms non-profits already trust.

## License

[MIT](LICENSE). Build on it, host it for your community, make it yours.
