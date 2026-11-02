# Ministry Sites — AI landing pages for non-profits

A Shofar Ministry project. Small non-profits and ministries describe their
organization, attach a few photos, and get a fast, accessible landing page
they can edit forever and host for free on their own Cloudflare account, or
on the hosted tier at `build.shofar.io`.

See [docs/PROPOSAL.md](docs/PROPOSAL.md) for the product and business plan and
[docs/COMPETITORS.md](docs/COMPETITORS.md) for market benchmarks.

## Layout

| Path | What |
|---|---|
| `packages/schema` | `@ministry/schema` — the Zod `SiteDocument` contract shared by editor, AI and templates |
| `packages/templates` | `@ministry/templates` — React templates rendered to static HTML (`renderSite`) |
| `apps/web` | `@ministry/web` — Vite + React editor with live preview, image upload, ZIP export, Clerk sign-in |
| `apps/api` | `@ministry/api` — Hono Worker on Cloudflare: Clerk JWT auth, D1 (Drizzle), R2 images |

## Prerequisites

- Node 22+ and pnpm 10 (`corepack enable`)
- A Cloudflare account (both `shofar.io` and `shofar.ai` live there) and `wrangler` logged in for deploys
- A Clerk application (free tier). Optional for local work: the editor runs in a
  no-login "local mode" when `VITE_CLERK_PUBLISHABLE_KEY` is unset.

## Run locally

```bash
pnpm install
```

```bash
pnpm --filter @ministry/web dev
```

That opens the editor on http://localhost:5173 in local mode (documents in
localStorage, images in memory). To run against the API:

1. Copy `apps/api/.dev.vars.example` to `apps/api/.dev.vars` and set `CLERK_SECRET_KEY`.
2. Copy `apps/web/.env.example` to `apps/web/.env` and set `VITE_CLERK_PUBLISHABLE_KEY` and `VITE_API_URL=http://localhost:8787`.
3. `pnpm --filter @ministry/api db:migrate:local` then `pnpm --filter @ministry/api dev`.

## Checks

```bash
pnpm typecheck
```

```bash
pnpm test
```

```bash
pnpm build
```

## Domains

- Platform web app: `build.shofar.io`
- Platform API: `api.build.shofar.io`
- Hosted customer sites (Phase 2): `<slug>.sites.shofar.io` by default, custom domains via Cloudflare for SaaS

## Phases

Phase 0 (this scaffold): sign-in, one template, section editor, live preview,
image upload, ZIP export, Cloudflare Drop guide. Phase 1 adds the AI copilot
and variations; Phase 2 the hosted tier and billing; Phase 3 the one-click
claim flow. Details in the proposal.
