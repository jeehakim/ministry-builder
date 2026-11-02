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
| `GET /sites/:id` | owner or admin | `{ site, document }`; `site.messageCount` is the number of stored contact-form messages |
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
| `POST /sites/:id/ai/translate` | owner or admin | `AiTranslateRequest` -> `{ language, overlay }`; 400 for the primary language; saves the overlay into `translations[language]`, adds the language to `meta.languages` and moves the current version |
| `POST /sites/:id/publish` | owner or admin | Renders the current version into the `PUBLISHED` bucket; returns `{ url, publishedAt }` |
| `POST /sites/:id/unpublish` | owner or admin | Removes the published objects; site returns to `draft` |
| `GET /sites/:id/messages?limit=50` | owner or admin | `{ messages: [{ id, name, email, message, language, createdAt, deliveredAt, deliveryError }] }`, newest first (limit 1-200) |
| `DELETE /sites/:id/messages/:msgId` | owner or admin | Removes one stored message |
| `GET /admin/sites` | admin | Every site with org name, owner, status and published URL |
| `POST /orgs/:id/transfer` | admin | `{ email }`; looks the user up in Clerk and makes them the org owner |

AI routes answer 429 `{ error, used, limit, resetsAt }` over quota, 503 when no provider is configured, 502 on provider failure.

Published sites are served by this Worker on `PUBLIC_SITES_HOST` (`sites.shofar.io/<slug>/`, or `<slug>.sites.shofar.io/`) before CORS and auth run, from the `PUBLISHED` bucket only.

### Contact form

Published sites post their contact form to this Worker: `POST /<slug>/contact` on the path form, `POST /contact` on the subdomain form (public, no auth, answered before CORS). The form is only rendered when the site's contact section has an `email`. The endpoint:

- takes `name` (1-120), `email` (3-200), `message` (1-4000) and the hidden `_lang` (a language of the site, else the primary) as urlencoded or multipart data, and answers a small HTML page on `400`, `404` (unknown site or no contact email), `405` (anything but POST) and `413` (over 64 KB);
- treats a filled honeypot field `website` as a bot: it redirects like a success and stores nothing;
- allows 5 messages per visitor per 10 minutes and 30 per site per hour (`429`). The visitor is identified by a salted SHA-256 of `CF-Connecting-IP` (salt: the `FORM_SALT` var, default `ministry`); the raw address is never stored;
- stores the message in `form_submissions` first, then emails it to the contact address with the visitor as `Reply-To`, subject `[<org>] New message from <name>`. A delivery failure is logged and kept in `delivery_error`; the visitor still gets the redirect;
- answers `303` to the thank-you page that publishing writes next to each language page: `/<slug>/thanks/` or `/<slug>/<lang>/thanks/` (subdomain form: `/thanks/`, `/<lang>/thanks/`). All of these responses are `Cache-Control: no-store`.

Messages are personal data; deleting one is `DELETE /sites/:id/messages/:msgId`. They are kept until the owner deletes them (unpublishing does not remove them).

#### Email providers

`EMAIL_PROVIDER` (a var in `wrangler.jsonc`) chooses how notifications leave. `EMAIL_FROM` is the sender (default `forms@shofar.io`); its domain must be verified with the provider.

| `EMAIL_PROVIDER` | Needs | Notes |
|---|---|---|
| `none` (default) | nothing | Store-only: messages are saved and owners read them through `GET /sites/:id/messages` |
| `cloudflare` | the `send_email` binding named `EMAIL` | Cloudflare Email Sending (`env.EMAIL.send({ from, to, replyTo, subject, text, html })`). Needs a plan that includes it and the sender domain onboarded under Email Sending. Uncomment `"send_email": [{ "name": "EMAIL" }]` in `wrangler.jsonc` |
| `resend` | secret `RESEND_API_KEY` | Resend REST API (`POST https://api.resend.com/emails`). Verify the `EMAIL_FROM` domain in the Resend dashboard, then `npx wrangler secret put RESEND_API_KEY` |

A provider that is selected but missing its binding or key falls back to store-only. Providers live in `src/email/` behind the `EmailSender` interface.

Errors are `{ "error": string }`. A site you may not access answers 404, same as a missing one.

## Secrets on the deployed Worker

| Name | How to set | Used for |
|---|---|---|
| `CLERK_SECRET_KEY` | `npx wrangler secret put CLERK_SECRET_KEY`, or dashboard: Settings > Variables and Secrets > Add (type Secret) | Verifying Clerk session tokens |
| `OPENAI_API_KEY` | same, name `OPENAI_API_KEY` | AI copilot on OpenAI. Model comes from the `OPENAI_MODEL` var |
| `ANTHROPIC_API_KEY` | same, name `ANTHROPIC_API_KEY` | AI copilot on Claude (key from console.anthropic.com; a Claude.ai subscription does not work). Model comes from the `ANTHROPIC_MODEL` var (default `claude-opus-5-5`; set `claude-sonnet-5-5` or `claude-haiku-5-5` to spend less) |
| `RESEND_API_KEY` | same, name `RESEND_API_KEY` | Optional. Contact-form notification emails when `EMAIL_PROVIDER` is `resend` |
| `STAFF_API_TOKEN` | same, name `STAFF_API_TOKEN` | Optional. Requests with header `X-Staff-Token: <value>` act as the admin user `staff-bot` |

Without either AI key the AI routes answer 503. When only one key is set it is used; when both are set OpenAI wins unless the `AI_PROVIDER` var is `anthropic` (or `openai`). Setting `AI_PROVIDER` to a provider whose key is missing disables the copilot rather than falling back. Both adapters live in `src/ai/` behind the same `AiProvider` interface; the Anthropic one uses structured outputs (`output_config.format`) so the JSON matches the schema's shape, and both validate with Zod and allow one repair round.

`GET /health` returns `{ "ok": true, "ai": true|false }` (true when either AI key is present) so you can confirm a key is set without exposing it. Secrets added in the dashboard survive `wrangler deploy`; plain-text variables defined in `wrangler.jsonc` are the source of truth for non-secret settings.
