# @ministry/api

Cloudflare Worker (Hono + Drizzle/D1 + R2) behind the site builder. Clerk session JWTs authenticate every route except `GET /health` and `GET /assets/*`.

## Run locally

```sh
pnpm install                       # from the repo root (this is a workspace)
cp apps/api/.dev.vars.example apps/api/.dev.vars   # then set CLERK_SECRET_KEY
pnpm --filter @ministry/api db:migrate:local
pnpm --filter @ministry/api dev    # http://localhost:8787
```

Or from `apps/api`: `pnpm db:migrate:local` and `pnpm dev`. `ALLOWED_ORIGIN` (CORS) defaults to `http://localhost:5173`, the Vite dev server.

Other scripts: `pnpm typecheck`, `pnpm test` (Vitest inside the Workers runtime, Clerk is stubbed), `pnpm db:generate` (after editing `src/db/schema.ts`).

## Create the cloud resources

```sh
wrangler d1 create ministry-sites
wrangler r2 bucket create ministry-images
wrangler r2 bucket create ministry-published
```

Paste the `database_id` printed by the first command into `wrangler.jsonc` (`d1_databases[0].database_id`). Then:

```sh
wrangler d1 migrations apply ministry-sites --remote
wrangler secret put CLERK_SECRET_KEY
```

Set `vars.ALLOWED_ORIGIN` to `https://build.shofar.io` for production and uncomment the `routes` entry for `api.build.shofar.io`, then `pnpm deploy`.

## Routes

| Method and path | Auth | Notes |
|---|---|---|
| `GET /health` | no | `{ ok: true }` |
| `GET /sites` | yes | Sites in orgs the caller owns |
| `POST /sites` | yes | `{ orgName, slug? }`; creates org if needed, site, first version. 409 if the slug is taken |
| `GET /sites/:id` | owner or admin | `{ site, document }` |
| `PUT /sites/:id/document` | owner or admin | Body is a `SiteDocument`; returns `{ versionId }` |
| `GET /sites/:id/versions` | owner or admin | `{ versions: [{ id, createdAt }], currentVersionId }` |
| `POST /sites/:id/assets` | owner or admin | multipart `file` (JPEG, PNG, WebP, max 5 MB), optional `alt`, `width`, `height`; returns `{ id, key, url }` |
| `DELETE /sites/:id/assets/:assetId` | owner or admin | Removes the R2 object and the row |
| `GET /assets/*` | no | Streams from R2, cached for a year |
| `GET /ai/usage` | yes | `{ used, limit, resetsAt, available }`; the limit is per user per UTC day (`AI_DAILY_LIMIT`) |
| `POST /sites/:id/ai/draft` | owner or admin | `AiDraftRequest`; stores 1 or 3 variations as versions sharing a `variationGroupId` (does not move the current version) |
| `POST /sites/:id/ai/rewrite` | owner or admin | `AiRewriteRequest` -> `{ text }` |
| `POST /sites/:id/ai/theme` | owner or admin | `AiThemeRequest` -> `{ theme, rationale }` |
| `POST /sites/:id/ai/alt-text` | owner or admin | `{ assetKey }` (must be under `sites/<id>/`) -> `{ alt }` |
| `POST /sites/:id/publish` | owner or admin | Renders the current version into the `PUBLISHED` bucket; returns `{ url, publishedAt }` |
| `POST /sites/:id/unpublish` | owner or admin | Removes the published objects; site returns to `draft` |
| `GET /admin/sites` | admin | Every site with org name, owner, status and published URL |
| `POST /orgs/:id/transfer` | admin | `{ email }`; looks the user up in Clerk and makes them the org owner |

AI routes answer 429 `{ error, used, limit, resetsAt }` over quota, 503 when no provider is configured, 502 on provider failure.

Published sites are served by this Worker on `PUBLIC_SITES_HOST` (`sites.shofar.io/<slug>/`, or `<slug>.sites.shofar.io/`) before CORS and auth run, from the `PUBLISHED` bucket only.

Errors are `{ "error": string }`. A site you may not access answers 404, same as a missing one.

## Secrets on the deployed Worker

| Name | How to set | Used for |
|---|---|---|
| `CLERK_SECRET_KEY` | `npx wrangler secret put CLERK_SECRET_KEY`, or dashboard: Settings > Variables and Secrets > Add (type Secret) | Verifying Clerk session tokens |
| `OPENAI_API_KEY` | same, name `OPENAI_API_KEY` | AI copilot. Without it the AI routes answer 503. Model comes from the `OPENAI_MODEL` var |
| `STAFF_API_TOKEN` | same, name `STAFF_API_TOKEN` | Optional. Requests with header `X-Staff-Token: <value>` act as the admin user `staff-bot` |

`GET /health` returns `{ "ok": true, "ai": true|false }` so you can confirm the AI key is present without exposing it. Secrets added in the dashboard survive `wrangler deploy`; plain-text variables defined in `wrangler.jsonc` are the source of truth for non-secret settings.
