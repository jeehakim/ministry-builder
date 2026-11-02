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
| `POST /sites` | yes | `{ orgName, slug? }`; creates org if needed, site, first version. 409 if the slug is taken, 429 at the per-user site limit (admins exempt) |
| `GET /sites/:id` | owner or admin | `{ site, document }`; `site.messageCount` is the number of stored contact-form messages |
| `PUT /sites/:id/document` | owner or admin | Body is a `SiteDocument`; returns `{ versionId }`. Prunes the oldest versions beyond `MAX_VERSIONS_PER_SITE` |
| `GET /sites/:id/versions` | owner or admin | `{ versions: [{ id, createdAt }], currentVersionId }` |
| `POST /sites/:id/assets` | owner or admin | multipart `file` (JPEG, PNG, WebP, max 5 MB), optional `alt`, `width`, `height`; returns `{ id, key, url }`. 413 when the site would exceed `MAX_SITE_STORAGE_BYTES` |
| `DELETE /sites/:id/assets/:assetId` | owner or admin | Removes the R2 object and the row |
| `GET /assets/*` | no | Streams from R2, cached for a year |
| `GET /ai/usage` | yes | `{ used, limit, resetsAt, available }`; the limit is per user per UTC day (`AI_DAILY_LIMIT`) |
| `POST /sites/:id/ai/draft` | owner or admin | `AiDraftRequest`; stores 1 or 3 variations as versions sharing a `variationGroupId` (does not move the current version) |
| `POST /sites/:id/ai/rewrite` | owner or admin | `AiRewriteRequest` -> `{ text }` |
| `POST /sites/:id/ai/theme` | owner or admin | `AiThemeRequest` -> `{ theme, rationale }` |
| `POST /sites/:id/ai/alt-text` | owner or admin | `{ assetKey }` (must be under `sites/<id>/`) -> `{ alt }` |
| `POST /sites/:id/ai/translate` | owner or admin | `AiTranslateRequest` -> `{ language, overlay }`; 400 for the primary language; saves the overlay into `translations[language]`, adds the language to `meta.languages` and moves the current version |
| `POST /sites/:id/publish` | owner or admin | Renders the current version into the `PUBLISHED` bucket (pages, thank-you pages, a page per active campaign at `give/<slug>/` in every language with cards in the Give section, `robots.txt`, `sitemap.xml`); returns `{ url, publishedAt }`. 429 with `Retry-After` past `MAX_PUBLISHES_PER_HOUR` |
| `POST /sites/:id/unpublish` | owner or admin | Removes the published objects; site returns to `draft` |
| `GET /sites/:id/domains` | owner or admin | `{ domains, cnameTarget, enabled }`; each domain has `hostname`, `kind`, `sslStatus`, `ownershipVerifiedAt`, `verifiedAt`, `active`, `expiresAt` and the `txt` and `dns` records to create. Also deletes unproved domains older than 7 days (any site) |
| `POST /sites/:id/domains` | owner or admin | `{ hostname, kind?: "primary" \| "redirect" }`; records the domain with a fresh ownership token and returns `{ domain }` (201). Nothing is created at Cloudflare yet. 400 bad hostname, 409 taken or second primary, 429 over `MAX_DOMAINS_PER_SITE` or `MAX_DOMAINS_PER_USER` (admins exempt from the latter), 503 not configured |
| `POST /sites/:id/domains/:domainId/refresh` | owner or admin | Looks up `_ministry-verify.<hostname>` TXT over DNS-over-HTTPS until it carries the token, then creates the Cloudflare custom hostname, then re-reads its verification and certificate status; returns `{ domain, txtFound }`. 502 resolver or Cloudflare error |
| `DELETE /sites/:id/domains/:domainId` | owner or admin | Removes the custom hostname at Cloudflare (if one was created), then the row |
| `GET /sites/:id/contact-email?email=` | owner or admin | `{ email, verified, verifiedAt, sentAt, enabled }`: whether the contact form may email this address; `enabled` is false in store-only mode |
| `POST /sites/:id/contact-email/verify` | owner or admin | `{ email }`; emails a verification link through the configured sender and returns the same status. 429 past 5 sends per address per day, 502 send failed, 503 store-only mode |
| `GET /verify-contact/:token` | no | The link in the verification email: marks the address verified for its site and answers a small HTML page (404 unknown, 410 expired after 7 days) |
| `GET /sites/:id/messages?limit=50` | owner or admin | `{ messages: [{ id, name, email, message, language, createdAt, deliveredAt, deliveryError }] }`, newest first (limit 1-200) |
| `DELETE /sites/:id/messages/:msgId` | owner or admin | Removes one stored message |
| `GET /orgs/:id/integrations` | org owner or admin | `IntegrationsResponse`: `{ encryptionAvailable, activeSender: "organization" \| "platform" \| "none", resend: { keyHint, fromAddress, verifiedDomains, testedAt, lastError, updatedAt } \| null }`. Never contains the key or its ciphertext |
| `PUT /orgs/:id/integrations/resend/key` | org owner or admin | `{ apiKey }`; checks the key against Resend (`GET /domains`), stores it encrypted and the verified domains. 400 malformed key or "Resend rejected this key", 429 past 10 attempts per hour, 502 Resend unreachable, 503 integrations disabled |
| `PUT /orgs/:id/integrations/resend/from` | org owner or admin | `{ fromAddress, fromName? }`; the address's domain must be verified in the organization's Resend account (the list is refreshed first). 400 otherwise, 409 without a key |
| `POST /orgs/:id/integrations/resend/test` | org owner or admin | `{ to }`; sends a short test email through the organization's key and address. Sets `testedAt`, or `lastError` and answers 502. 429 past 5 per hour, 409 without key or address |
| `DELETE /orgs/:id/integrations/resend` | org owner or admin | Removes the stored key and settings; contact email goes back to the platform sender |
| `GET /sites/:id/campaigns` | owner or admin | `{ campaigns: CampaignWithTotals[] }` (newest first; totals from the gifts table) |
| `GET /orgs/:id/campaigns` | org owner or admin | Every campaign of the organization across its sites, each with `siteSlug`, plus `sites: [{ id, slug, published }]` |
| `POST /sites/:id/campaigns` | owner or admin | `CampaignInput`; the slug derives from the title when omitted (suffix on a clash; 409 for an explicit taken slug). 400 for a cover image that is not this site's upload or a translation language the site lacks. Returns `{ campaign }` (201) |
| `GET` / `PUT` / `DELETE /sites/:id/campaigns/:cid` | owner or admin | Read, replace (`CampaignInput`; the slug cannot change) or delete (with its gifts) one campaign |
| `GET /sites/:id/campaigns/:cid/totals` | owner or admin | `{ raisedAmount, giftCount, goalAmount, currency, percent }`, minor units |
| `GET /sites/:id/campaigns/:cid/gifts?limit=200` | owner or admin | `{ gifts, totals }`, newest first (limit 1-2000) |
| `POST /sites/:id/campaigns/:cid/gifts` | owner or admin | `GiftInput`; dedupes the donor by email per organization and, with an email and a configured sender, emails the campaign's thank-you note (outcome on `thankYouSentAt` / `thankYouError`, never a failure). Returns `{ gift, totals }` (201) |
| `DELETE /sites/:id/campaigns/:cid/gifts/:gid` | owner or admin | `{ ok, totals }` |
| `POST /sites/:id/campaigns/:cid/gifts/import` | owner or admin | `{ csv }` or a `text/csv` body with columns `amount` (required), `name`, `email`, `date`, `source`, `public`, `note`; at most 2000 rows. All rows are validated first: 400 `{ imported: 0, errors: [{ row, message }], totals }` imports nothing. No thank-you emails |
| `POST /sites/:id/campaigns/:cid/ai/story` | owner or admin | `AiCampaignStoryRequest` -> `{ title, summary, story }` (counts against the AI quota) |
| `POST /sites/:id/campaigns/:cid/ai/thank-you` | owner or admin | `AiThankYouRequest` -> `{ message }` with a `{{name}}` placeholder |
| `GET /admin/sites` | admin | Every site with org name, owner, status and published URL |
| `POST /orgs/:id/transfer` | admin | `{ email }`; looks the user up in Clerk and makes them the org owner |

AI routes answer 429 `{ error, used, limit, resetsAt }` over quota, 503 when no provider is configured, 502 on provider failure.

#### AI quota

Every AI call reserves its slot before the provider is called: a single `INSERT ... SELECT ... WHERE count < limit` writes a `pending` row into `ai_usage` only if both today's per-user count (`AI_DAILY_LIMIT`, default 30) and today's platform-wide count (`AI_GLOBAL_DAILY_LIMIT`, default 2000) are under their limits, so simultaneous requests cannot overshoot either one. The row becomes `done` with the real token counts once the provider answers, and is deleted again when the provider fails (nothing was spent). A `pending` row older than 10 minutes stops counting, so a Worker that died mid-call does not hold the slot until midnight. `GET /ai/usage` counts the same rows.

The global cap is a backstop, not a budget: set a **hard spend limit on the provider project** as well (OpenAI: *Settings > Limits > Monthly budget* with a hard limit; Anthropic: *Console > Plans & billing > spend limits*), sized to the global cap times the dearest call, so a bug or a leaked key cannot run up a bill.

Published sites are served by this Worker before CORS and auth run, from the `PUBLISHED` bucket only. A request host is resolved in this order: a customer domain from the `domains` table (a `primary` domain serves the site at `/`, its language pages at `/<lang>/`, the thank-you pages at `/thanks/` and `/<lang>/thanks/`, campaign pages at `/give/<campaign>/` and `/<lang>/give/<campaign>/`, and takes contact-form posts at `/contact`; a `redirect` domain answers 301 to the primary), then `PUBLIC_SITES_HOST` (`sites.shofar.io/<slug>/`) and its subdomain form (`<slug>.sites.shofar.io/`). `PUBLIC_API_HOST` is never looked up as a customer domain. Published pages contain only document-relative links (`relativizeRootLinks` in `src/published.ts` enforces it), so the same `index.html` works at `/` and at `/<slug>/`.

### Contact form

Published sites post their contact form to this Worker: `POST /<slug>/contact` on the path form, `POST /contact` on the subdomain form (public, no auth, answered before CORS). The form is only rendered when the site's contact section has an `email`. The endpoint:

- takes `name` (1-120), `email` (3-200), `message` (1-4000) and the hidden `_lang` (a language of the site, else the primary) as urlencoded or multipart data, and answers a small HTML page on `400`, `404` (unknown site or no contact email), `405` (anything but POST) and `413` (over 64 KB);
- treats a filled honeypot field `website` as a bot: it redirects like a success and stores nothing;
- allows 5 messages per visitor per 10 minutes and 30 per site per hour (`429`). The visitor is identified by a salted SHA-256 of `CF-Connecting-IP` (salt: the `FORM_SALT` var, default `ministry`); the raw address is never stored;
- stores the message in `form_submissions` first, then emails it to the contact address with the visitor as `Reply-To`, subject `[<org>] New message from <name>`. A delivery failure is logged and kept in `delivery_error`; the visitor still gets the redirect. `delivered_via` records which sender handled it (`organization` or `platform`; null in store-only mode), see "Organization email" below;
- from the platform sender, only emails an address that has confirmed it wants the messages (`contact_email_verifications`, see "Verifying the contact address"). Until then the message is stored with `delivery_error` = `address not verified`. An organization sending through its own Resend account is responsible for its own recipients, so that path is not gated; in store-only mode nothing is emailed anyway;
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

#### Organization email (bring your own Resend)

An organization can connect its own Resend account so contact-form email leaves from its own domain and reputation instead of the platform's. Routes are under `/orgs/:id/integrations` (table above); only the organization's owner or an admin can use them (anyone else gets 404), and every response is `Cache-Control: no-store`.

Setup flow: `PUT .../resend/key` with the API key, then `PUT .../resend/from` with an address on a domain the organization verified in Resend, then `POST .../resend/test`.

- **Key check.** The key must match `RESEND_KEY_PATTERN` and is verified by calling `GET https://api.resend.com/domains` with it; Resend answering 401 or 403 means `400 "Resend rejected this key"`. That call needs a full-access key, so a sending-only key is rejected too. Domains with status `verified` are stored (`verified_domains_json`) and offered back as `verifiedDomains`. Replacing the key keeps the from address only if its domain is still verified in the new account, and clears `testedAt`.
- **Encryption at rest.** The key is stored as AES-256-GCM ciphertext (`src/crypto.ts`) in `org_integrations.encrypted_key`, formatted `v1.<iv>.<ciphertext+tag>` (base64url). The organization id is the GCM additional authenticated data, so a ciphertext copied to another organization's row will not decrypt. Only the last four characters (`key_hint`) are kept in the clear. The key is never returned, never logged (`src/log.ts` masks `re_...` tokens in error text), and decrypted only to call Resend.
- **The server secret.** `INTEGRATIONS_KEY` is base64 of 32 random bytes. Generate and set it once:

  ```bash
  openssl rand -base64 32 | npx wrangler secret put INTEGRATIONS_KEY
  ```

  For `wrangler dev`, put the same kind of value in `.dev.vars`. Without it (or if it is not exactly 32 bytes) `GET` reports `encryptionAvailable: false` and the key, from and test routes answer `503 { "error": "Integrations are not enabled on this server" }`; nothing is stored. `DELETE` keeps working so an owner can always remove a stored key. **Do not change or lose `INTEGRATIONS_KEY` once organizations have stored keys**: their ciphertexts stop decrypting, their contact email fails with a delivery error until they enter the key again, and there is no re-encryption path yet.
- **Delivery.** For each contact-form message the Worker looks up the site's organization. If it has a key and a from address, the message goes through Resend with that key and address (`src/email/orgSender.ts`, reusing `resendSender(apiKey, from)`) and `form_submissions.delivered_via` is `organization`. If that send fails, or the key cannot be decrypted, the error is kept in `delivery_error` and the message is **not** re-sent from the platform sender: their sender, their reputation. With no integration, or a key but no from address yet, the platform sender is used (`delivered_via` is `platform`), or nothing in store-only mode.
- **Limits.** 10 key attempts and 5 test emails per organization per rolling hour, failures included, counted in `integration_events` (claimed atomically; rows older than a day are pruned). Deleting the integration does not reset them. Resend calls time out after 8 seconds.
- **Cleanup.** The integration row and its counters are deleted with the organization (when its last site is deleted).
- **Display names.** `fromName` may not contain quotes, angle brackets, backslashes or control characters; the From header is `"Name" <address>`.

#### Verifying the contact address

The address in a site's contact section is typed by the site owner, so with the platform sender enabled it would otherwise mail form content from `forms@shofar.io` to anyone the owner named. Delivery through the platform sender therefore needs a double opt-in per site and address: the owner clicks *Send verification email* next to the Email field (`POST /sites/:id/contact-email/verify`), the recipient opens the link (`GET /verify-contact/<token>`, public, token valid 7 days, replaced on every resend), and from then on messages for that address are emailed. At most 5 verification emails a day go to one address from one site. Verifications are deleted with the site. Changing the contact address starts over for the new one. An organization that sends through its own Resend account (above) is not gated: its sender, its recipients.

Errors are `{ "error": string }`. A site you may not access answers 404, same as a missing one.

## Limits and safety

### Limits (vars in `wrangler.jsonc`)

Values are strings. A missing, zero, negative or non-numeric value falls back to the default.

| Var | Default | Enforced in | When exceeded |
|---|---|---|---|
| `MAX_SITES_PER_USER` | `10` | `POST /sites` | 429. Counts every site in organizations the user owns; admins are exempt |
| `MAX_SITE_STORAGE_BYTES` | `104857600` (100 MB) | `POST /sites/:id/assets` | 413. Sum of `assets.bytes` for the site plus the new file; the file is not stored |
| `MAX_VERSIONS_PER_SITE` | `500` | `PUT /sites/:id/document` | No error: after the save, the oldest versions are deleted until the site is back at the limit. The current version and the newest 50 are never deleted, so a site can sit above the limit if everything older is protected |
| `MAX_PUBLISHES_PER_HOUR` | `20` | `POST /sites/:id/publish` | 429 with `Retry-After` (seconds until a slot frees) per site per rolling hour |
| `MAX_DOMAINS_PER_SITE` | `3` | `POST /sites/:id/domains` | 429. Every domain of the site, primary and redirects, proved or not |
| `MAX_DOMAINS_PER_USER` | `10` | `POST /sites/:id/domains` | 429. Domains across every site in organizations the user owns; admins are exempt |
| `AI_DAILY_LIMIT` | `30` | every `POST .../ai/*` | 429 `{ used, limit, resetsAt }` per user per UTC day (see *AI quota*) |
| `AI_GLOBAL_DAILY_LIMIT` | `2000` | every `POST .../ai/*` | 429 for every user for the rest of the UTC day; logged as `ai_global_limit_reached` |

The per-file upload limit stays a constant of 5 MB (`src/routes/assets.ts`). The publish count lives in the `publish_events` table (one row per attempt that passed validation; rows older than a day are deleted on the next publish of that site), because publishing does not create a `site_versions` row. Apply the new migration (`wrangler d1 migrations apply ministry-sites --remote`) before deploying. For the site, storage, version, publish and domain limits the count is read before the write, so two simultaneous requests can overshoot by one; that is accepted. The AI limits are reserved atomically (see *AI quota*).

### Response headers

Every API response (`src/security.ts`) carries `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, `Permissions-Policy: camera=(), microphone=(), geolocation=()` and, over HTTPS, `Strict-Transport-Security: max-age=31536000; includeSubDomains`. Routes under `/sites`, `/ai`, `/admin` and `/orgs` (errors included) also send `Cache-Control: no-store`.

Published-site responses (pages, images, thank-you and error pages, redirects, form answers, `robots.txt`, `sitemap.xml`) carry nosniff, the same `Referrer-Policy`, `X-Frame-Options: SAMEORIGIN`, HSTS and a Content-Security-Policy:

```
default-src 'none'; img-src 'self' data: https:; style-src 'unsafe-inline'; font-src 'self'; form-action 'self' https://<PUBLIC_SITES_HOST>; base-uri 'none'; frame-ancestors 'self'
```

There is no `script-src`, so no script runs on a published page (the templates emit none; the JSON-LD block is inert data). HSTS has `includeSubDomains` only on `PUBLIC_SITES_HOST` and its subdomains; on a customer domain it is `max-age=31536000` alone, because the customer's other subdomains are not ours to force onto HTTPS. A page whose contact section has a custom `formEndpoint` on https gets that origin added to `form-action` (publishing records it in the page's object metadata as `formOrigins`).

### Link safety at publish

`sanitizeDocumentForPublish` (`src/publishSafety.ts`) runs on the localized document of every language before rendering. A link survives only if its `href` is `http`, `https`, `mailto`, `tel`, a `#fragment` or a relative path without `..`; scheme checks ignore case, leading whitespace and embedded control characters (`  JaVa\tScRiPt:` is dropped). A link object with any other `href` is removed from its section, and a contact `formEndpoint` that fails the same test is cleared. Control characters are stripped from every string (tab, newline and carriage return stay in free text).

### robots.txt and sitemap.xml

Publishing writes `robots.txt` and `sitemap.xml` next to `index.html`, and hosting serves them like any other object (`/<slug>/robots.txt`, `<slug>.sites.shofar.io/robots.txt`, `/robots.txt` on a customer domain). `robots.txt` allows everything and names the sitemap; `sitemap.xml` lists the primary page and each language page with absolute URLs and `xhtml:link` hreflang alternates (plus `x-default`). All URLs, and the canonical/hreflang/Open Graph URLs in the pages (`RenderOptions.canonicalUrl`), are built from `PUBLIC_SITES_HOST` and the slug, so on a customer domain they still point at the sites-host address. Sites published before this change get both files on their next publish.

### Logging

Error lines are one JSON object with `event` and `request_id` (the `cf-ray` header, else a UUID; `src/log.ts`). Logs never contain tokens, secrets, email bodies, visitor addresses or documents: error messages go through `scrub` (masks JWTs, bearer tokens, API keys and email addresses, and truncates), and upstream AI SDK errors are logged by class and status only. AI call logs stay `action`, `provider`, `model`, token counts and latency.

## Secrets on the deployed Worker

| Name | How to set | Used for |
|---|---|---|
| `CLERK_SECRET_KEY` | `npx wrangler secret put CLERK_SECRET_KEY`, or dashboard: Settings > Variables and Secrets > Add (type Secret) | Verifying Clerk session tokens |
| `OPENAI_API_KEY` | same, name `OPENAI_API_KEY` | AI copilot on OpenAI. Model comes from the `OPENAI_MODEL` var |
| `ANTHROPIC_API_KEY` | same, name `ANTHROPIC_API_KEY` | AI copilot on Claude (key from console.anthropic.com; a Claude.ai subscription does not work). Model comes from the `ANTHROPIC_MODEL` var (default `claude-opus-5-5`; set `claude-sonnet-5-5` or `claude-haiku-5-5` to spend less) |
| `RESEND_API_KEY` | same, name `RESEND_API_KEY` | Optional. Contact-form notification emails when `EMAIL_PROVIDER` is `resend` |
| `INTEGRATIONS_KEY` | `openssl rand -base64 32 \| npx wrangler secret put INTEGRATIONS_KEY` | Optional. Encrypts organizations' own Resend API keys at rest (see "Organization email"). Without it the integration routes answer 503. Never rotate casually: stored keys stop decrypting |
| `STAFF_API_TOKEN` | same, name `STAFF_API_TOKEN` | Optional. Requests with header `X-Staff-Token: <value>` act as the admin user `staff-bot` |
| `CLOUDFLARE_API_TOKEN` | same, name `CLOUDFLARE_API_TOKEN` | Optional. Custom domains (see below). Without it, or without the `CLOUDFLARE_ZONE_ID` var, the domain routes answer 503 and the editor hides the add form |

Without either AI key the AI routes answer 503. When only one key is set it is used; when both are set OpenAI wins unless the `AI_PROVIDER` var is `anthropic` (or `openai`). Setting `AI_PROVIDER` to a provider whose key is missing disables the copilot rather than falling back. Both adapters live in `src/ai/` behind the same `AiProvider` interface; the Anthropic one uses structured outputs (`output_config.format`) so the JSON matches the schema's shape, and both validate with Zod and allow one repair round.

`GET /health` returns `{ "ok": true, "ai": true|false }` (true when either AI key is present) so you can confirm a key is set without exposing it. Secrets added in the dashboard survive `wrangler deploy`; plain-text variables defined in `wrangler.jsonc` are the source of truth for non-secret settings.
## Custom domains (Cloudflare for SaaS)

A customer's domain (for example `bridgeworldfoundation.org`) becomes a **custom hostname** on the `shofar.io` zone. Cloudflare issues the certificate, terminates TLS and hands the request to this Worker, which looks the host up in the `domains` table. The first 100 custom hostnames on the zone are free. One-time setup on the owner's Cloudflare account, all in the `shofar.io` zone:

1. **Enable Cloudflare for SaaS**: zone > SSL/TLS > Custom Hostnames > Enable.
2. **Fallback origin**: create a proxied DNS record for an "originless" hostname, e.g. `AAAA  sites-origin  100::` (proxied, orange cloud), then on the Custom Hostnames page enter `sites-origin.shofar.io` under *Fallback Origin* and add it. Wait for its status to show *Active*. Custom hostname traffic is routed to this record; the Worker route below is what actually answers it.
3. **Worker route** so the Worker runs for requests that arrive on customer hostnames (a Workers custom domain only covers its own hostname): zone > Workers Routes > Add route, pattern `*/*`, Worker `ministry-api`. Cloudflare's guidance for Workers as a SaaS origin is this catch-all plus exclusions: add routes `build.shofar.io/*` with Worker *None* and any other hostname on the zone that must not pass through the API Worker. Re-check `https://build.shofar.io` after saving. (The alternative is one route per customer hostname, e.g. `bridgeworldfoundation.org/*`; the API does not create those.)
4. **CNAME target**: customers point their domain at `CUSTOM_HOSTNAME_CNAME_TARGET` (`sites.shofar.io` by default, which is already a proxied record on the zone). Any proxied hostname on the zone works; change the var if you want a dedicated one such as `customers.shofar.io`.
5. **API token**: My Profile > API Tokens > Create Token > Custom token with permission **Zone > SSL and Certificates > Edit**, zone resource *Include > Specific zone > shofar.io*. Store it as the `CLOUDFLARE_API_TOKEN` secret (`npx wrangler secret put CLOUDFLARE_API_TOKEN`). Wrangler's OAuth login does not cover DNS or SSL, so this token is needed even when deploys work.
6. **Zone id**: zone Overview page, right column, *Zone ID*. Paste it into `vars.CLOUDFLARE_ZONE_ID` in `wrangler.jsonc`.

What the customer does, at their DNS provider (the editor shows both records):

1. **Prove ownership**: `TXT _ministry-verify.<their hostname>` with the value `ministry-verify=<token>` the editor shows (a random token per domain, stored in `domains.verification_token`). *Check status* (`POST .../refresh`) looks the record up over DNS-over-HTTPS (`https://cloudflare-dns.com/dns-query`); the bare token is accepted too. Nothing is created at Cloudflare before this record is found, so a hostname cannot be squatted, a dangling CNAME cannot be taken over, and the custom-hostname quota is not spent on unproved names. A domain whose record never appears is deleted after 7 days (on the next list or add, for any site), which frees the hostname for its real owner.
2. **Route traffic**: `CNAME <their hostname> -> sites.shofar.io`. For a root domain (`example.org` rather than `www.example.org`) the provider must support CNAME at the apex (Cloudflare DNS does; otherwise ALIAS/ANAME), because an A record to our IPs is not a supported setup without apex proxying.

The refresh that finds the TXT record creates the custom hostname; once the CNAME resolves, Cloudflare verifies the hostname and issues the certificate over HTTP validation with no further action, and later refreshes pull the result. A domain is live (`active`) when ownership is proved, the hostname status is `active` and `ssl.status` is `active`; the hosting handler serves a customer domain only in that state and answers 404 otherwise, redirect domains included.

Bridge World Foundation: add `bridgeworldfoundation.org` as the main domain and `bridgeworld.foundation` (and `www.` forms) as redirects; redirects answer 301 to the main domain with the path preserved.

### Subdomain form (`<slug>.sites.shofar.io`)

The hosting handler already serves `<slug>.sites.shofar.io/`, but nothing routes there yet. On the `shofar.io` zone add a proxied wildcard record `CNAME  *.sites  sites.shofar.io` and a Workers route `*.sites.shofar.io/*` -> `ministry-api` (unnecessary if the `*/*` route above exists). Universal SSL covers `shofar.io` and `*.shofar.io` only; a second-level wildcard like `*.sites.shofar.io` needs an Advanced Certificate (ACM, about $10/month) or Total TLS. Until one is bought, keep linking to the path form, which `PUBLIC_SITES_HOST` already produces.
