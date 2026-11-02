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
| `GET /sites/:id/domains` | owner or admin | `{ domains, cnameTarget, enabled }`; each domain has `hostname`, `kind`, `sslStatus`, `verifiedAt`, `active` and the `dns` record to create |
| `POST /sites/:id/domains` | owner or admin | `{ hostname, kind?: "primary" \| "redirect" }`; creates a Cloudflare for SaaS custom hostname and returns `{ domain }` (201). 400 bad hostname, 409 taken or second primary, 502 Cloudflare error, 503 not configured |
| `POST /sites/:id/domains/:domainId/refresh` | owner or admin | Re-reads verification and certificate status from Cloudflare; returns `{ domain }` |
| `DELETE /sites/:id/domains/:domainId` | owner or admin | Removes the custom hostname at Cloudflare, then the row |
| `GET /admin/sites` | admin | Every site with org name, owner, status and published URL |
| `POST /orgs/:id/transfer` | admin | `{ email }`; looks the user up in Clerk and makes them the org owner |

AI routes answer 429 `{ error, used, limit, resetsAt }` over quota, 503 when no provider is configured, 502 on provider failure.

Published sites are served by this Worker before CORS and auth run, from the `PUBLISHED` bucket only. A request host is resolved in this order: a customer domain from the `domains` table (a `primary` domain serves the site at `/`, a `redirect` domain answers 301 to the primary), then `PUBLIC_SITES_HOST` (`sites.shofar.io/<slug>/`) and its subdomain form (`<slug>.sites.shofar.io/`). `PUBLIC_API_HOST` is never looked up as a customer domain. Published pages contain only document-relative links (`relativizeRootLinks` in `src/published.ts` enforces it), so the same `index.html` works at `/` and at `/<slug>/`.

Errors are `{ "error": string }`. A site you may not access answers 404, same as a missing one.

## Secrets on the deployed Worker

| Name | How to set | Used for |
|---|---|---|
| `CLERK_SECRET_KEY` | `npx wrangler secret put CLERK_SECRET_KEY`, or dashboard: Settings > Variables and Secrets > Add (type Secret) | Verifying Clerk session tokens |
| `OPENAI_API_KEY` | same, name `OPENAI_API_KEY` | AI copilot. Without it the AI routes answer 503. Model comes from the `OPENAI_MODEL` var |
| `STAFF_API_TOKEN` | same, name `STAFF_API_TOKEN` | Optional. Requests with header `X-Staff-Token: <value>` act as the admin user `staff-bot` |
| `CLOUDFLARE_API_TOKEN` | same, name `CLOUDFLARE_API_TOKEN` | Optional. Custom domains (see below). Without it, or without the `CLOUDFLARE_ZONE_ID` var, the domain routes answer 503 and the editor hides the add form |

`GET /health` returns `{ "ok": true, "ai": true|false }` so you can confirm the AI key is present without exposing it. Secrets added in the dashboard survive `wrangler deploy`; plain-text variables defined in `wrangler.jsonc` are the source of truth for non-secret settings.

## Custom domains (Cloudflare for SaaS)

A customer's domain (for example `bridgeworldfoundation.org`) becomes a **custom hostname** on the `shofar.io` zone. Cloudflare issues the certificate, terminates TLS and hands the request to this Worker, which looks the host up in the `domains` table. The first 100 custom hostnames on the zone are free. One-time setup on the owner's Cloudflare account, all in the `shofar.io` zone:

1. **Enable Cloudflare for SaaS**: zone > SSL/TLS > Custom Hostnames > Enable.
2. **Fallback origin**: create a proxied DNS record for an "originless" hostname, e.g. `AAAA  sites-origin  100::` (proxied, orange cloud), then on the Custom Hostnames page enter `sites-origin.shofar.io` under *Fallback Origin* and add it. Wait for its status to show *Active*. Custom hostname traffic is routed to this record; the Worker route below is what actually answers it.
3. **Worker route** so the Worker runs for requests that arrive on customer hostnames (a Workers custom domain only covers its own hostname): zone > Workers Routes > Add route, pattern `*/*`, Worker `ministry-api`. Cloudflare's guidance for Workers as a SaaS origin is this catch-all plus exclusions: add routes `build.shofar.io/*` with Worker *None* and any other hostname on the zone that must not pass through the API Worker. Re-check `https://build.shofar.io` after saving. (The alternative is one route per customer hostname, e.g. `bridgeworldfoundation.org/*`; the API does not create those.)
4. **CNAME target**: customers point their domain at `CUSTOM_HOSTNAME_CNAME_TARGET` (`sites.shofar.io` by default, which is already a proxied record on the zone). Any proxied hostname on the zone works; change the var if you want a dedicated one such as `customers.shofar.io`.
5. **API token**: My Profile > API Tokens > Create Token > Custom token with permission **Zone > SSL and Certificates > Edit**, zone resource *Include > Specific zone > shofar.io*. Store it as the `CLOUDFLARE_API_TOKEN` secret (`npx wrangler secret put CLOUDFLARE_API_TOKEN`). Wrangler's OAuth login does not cover DNS or SSL, so this token is needed even when deploys work.
6. **Zone id**: zone Overview page, right column, *Zone ID*. Paste it into `vars.CLOUDFLARE_ZONE_ID` in `wrangler.jsonc`.

What the customer does: create `CNAME <their hostname> -> sites.shofar.io` at their DNS provider (the editor shows this). For a root domain (`example.org` rather than `www.example.org`) the provider must support CNAME at the apex (Cloudflare DNS does; otherwise ALIAS/ANAME), because an A record to our IPs is not a supported setup without apex proxying. Once the CNAME resolves, Cloudflare verifies the hostname and issues the certificate over HTTP validation with no further action; *Check status* in the editor (`POST .../refresh`) pulls the result. A domain is live when both the hostname status and `ssl.status` are `active`.

Bridge World Foundation: add `bridgeworldfoundation.org` as the main domain and `bridgeworld.foundation` (and `www.` forms) as redirects; redirects answer 301 to the main domain with the path preserved.

### Subdomain form (`<slug>.sites.shofar.io`)

The hosting handler already serves `<slug>.sites.shofar.io/`, but nothing routes there yet. On the `shofar.io` zone add a proxied wildcard record `CNAME  *.sites  sites.shofar.io` and a Workers route `*.sites.shofar.io/*` -> `ministry-api` (unnecessary if the `*/*` route above exists). Universal SSL covers `shofar.io` and `*.shofar.io` only; a second-level wildcard like `*.sites.shofar.io` needs an Advanced Certificate (ACM, about $10/month) or Total TLS. Until one is bought, keep linking to the path form, which `PUBLIC_SITES_HOST` already produces.
