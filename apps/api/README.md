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
| `GET /sites?orgId=` | yes | Sites in every organization the caller belongs to (each with `orgId` and the caller's `role`), or one organization's with `orgId` |
| `POST /sites` | yes | `{ orgName, slug? }` creates a new organization (caller becomes owner), the site and its first version; `{ orgId, orgName?, slug? }` adds a site to an existing organization (admin or owner there; `orgName` defaults to the organization's name). 409 if the slug is taken, 429 at the per-user site limit (platform admins exempt) |
| `GET /sites/:id` | viewer | `{ site, document }`; `site.role` is the caller's role, `site.messageCount` the number of stored contact-form messages |
| `PUT /sites/:id/document` | editor | Body is a `SiteDocument`; returns `{ versionId }`. Prunes the oldest versions beyond `MAX_VERSIONS_PER_SITE` |
| `GET /sites/:id/versions` | viewer | `{ versions: [{ id, createdAt }], currentVersionId }` |
| `POST /sites/:id/assets` | editor | multipart `file` (JPEG, PNG, WebP, max 5 MB), optional `alt`, `width`, `height`; returns `{ id, key, url }`. 413 when the site would exceed `MAX_SITE_STORAGE_BYTES` |
| `DELETE /sites/:id/assets/:assetId` | editor | Removes the R2 object and the row |
| `GET /assets/*` | no | Streams from R2, cached for a year |
| `GET /ai/usage?orgId=` | yes | `{ used, limit, resetsAt, available, organization? }`; the limit is per user per UTC day (`AI_DAILY_LIMIT`); with `orgId` (an organization the caller belongs to) `organization` carries that organization's `{ used, limit }` (`AI_DAILY_LIMIT_ORG`) |
| `POST /sites/:id/ai/draft` | editor | `AiDraftRequest`; stores 1 or 3 variations as versions sharing a `variationGroupId` (does not move the current version) |
| `POST /sites/:id/ai/rewrite` | editor | `AiRewriteRequest` -> `{ text }` |
| `POST /sites/:id/ai/theme` | editor | `AiThemeRequest` -> `{ theme, rationale }` |
| `POST /sites/:id/ai/alt-text` | editor | `{ assetKey }` (must be under `sites/<id>/`) -> `{ alt }` |
| `POST /sites/:id/ai/translate` | editor | `AiTranslateRequest` -> `{ language, overlay }`; 400 for the primary language; saves the overlay into `translations[language]`, adds the language to `meta.languages` and moves the current version |
| `POST /sites/:id/publish` | editor | Renders the current version into the `PUBLISHED` bucket (pages, thank-you pages, `robots.txt`, `sitemap.xml`); returns `{ url, publishedAt }`. 429 with `Retry-After` past `MAX_PUBLISHES_PER_HOUR` |
| `POST /sites/:id/unpublish` | editor | Removes the published objects; site returns to `draft` |
| `GET /sites/:id/domains` | viewer | `{ domains, cnameTarget, enabled }`; each domain has `hostname`, `kind`, `sslStatus`, `verifiedAt`, `active` and the `dns` record to create |
| `POST /sites/:id/domains` | admin | `{ hostname, kind?: "primary" \| "redirect" }`; creates a Cloudflare for SaaS custom hostname and returns `{ domain }` (201). 400 bad hostname, 409 taken or second primary, 502 Cloudflare error, 503 not configured |
| `POST /sites/:id/domains/:domainId/refresh` | admin | Re-reads verification and certificate status from Cloudflare; returns `{ domain }` |
| `DELETE /sites/:id/domains/:domainId` | admin | Removes the custom hostname at Cloudflare, then the row |
| `GET /sites/:id/messages?limit=50` | viewer | `{ messages: [{ id, name, email, message, language, createdAt, deliveredAt, deliveryError }] }`, newest first (limit 1-200) |
| `DELETE /sites/:id/messages/:msgId` | editor | Removes one stored message |
| `GET /orgs/:id/integrations` | viewer | `IntegrationsResponse`: `{ encryptionAvailable, activeSender: "organization" \| "platform" \| "none", resend: { keyHint, fromAddress, verifiedDomains, testedAt, lastError, updatedAt } \| null }`. Never contains the key or its ciphertext |
| `PUT /orgs/:id/integrations/resend/key` | admin | `{ apiKey }`; checks the key against Resend (`GET /domains`), stores it encrypted and the verified domains. 400 malformed key or "Resend rejected this key", 429 past 10 attempts per hour, 502 Resend unreachable, 503 integrations disabled |
| `PUT /orgs/:id/integrations/resend/from` | admin | `{ fromAddress, fromName? }`; the address's domain must be verified in the organization's Resend account (the list is refreshed first). 400 otherwise, 409 without a key |
| `POST /orgs/:id/integrations/resend/test` | admin | `{ to }`; sends a short test email through the organization's key and address. Sets `testedAt`, or `lastError` and answers 502. 429 past 5 per hour, 409 without key or address |
| `DELETE /orgs/:id/integrations/resend` | admin | Removes the stored key and settings; contact email goes back to the platform sender |
| `GET /orgs` | yes | `{ orgs: [{ id, name, role, createdAt }] }`: the caller's organizations |
| `GET /orgs/:id/members` | viewer | `{ members: [{ userId, email, role, invitedBy, joinedAt }], invitations }`; pending invitations are listed for admins and owners only |
| `PATCH /orgs/:id/members/:userId` | admin | `{ role }` -> `{ member }`. Granting or removing the owner role needs an owner; 409 when it would leave no owner |
| `DELETE /orgs/:id/members/:userId` | admin, or the member themself | Removes the membership. Removing an owner needs an owner; 409 for the last owner |
| `POST /orgs/:id/invitations` | admin | `{ email, role: "viewer" \| "editor" \| "admin" }` -> `{ invitation, delivery, link? }` (201). Emails a link through the platform sender (`delivery: "email"`), or returns the link when no sender is configured (`"link"`). 409 already a member, 429 past 20 per organization per rolling day, 502 when the email cannot be sent |
| `DELETE /orgs/:id/invitations/:invitationId` | admin | Revokes a pending invitation |
| `GET /invitations/:token` | no | `{ orgName, role, inviterEmail, email (masked), expiresAt }`; 404 when unknown, expired or used |
| `POST /invitations/:token/accept` | yes | Joins the organization; the signed-in email must match the invited address (403). Never lowers a role the member already holds -> `{ orgId, orgName, role }` |
| `POST /orgs/:id/transfer-ownership` | owner | `{ userId }` (a member); they become owner, the caller steps down to admin -> `{ orgId, ownerUserId }` |
| `GET /orgs/:id/events?limit=100` | viewer | `{ events: [{ id, action, actorUserId, actorEmail, target, detail, createdAt }] }`, newest first (limit 1-500) |
| `POST /webhooks/clerk` | Svix signature | Clerk webhook endpoint; handles `user.deleted` (see "Organizations and roles"). 401 bad signature, 503 without `CLERK_WEBHOOK_SECRET` |
| `GET /admin/sites` | platform admin | Every site with org name, owner, status and published URL |
| `POST /orgs/:id/transfer` | platform admin | `{ email }`; staff hand-over: looks the user up in Clerk, makes them an owner member and removes every previous owner from the organization |

The Auth column names the lowest organization role that may call the route (see "Organizations and roles"); a non-member gets 404, a member with a lower role 403 `{ error, role }`. Platform admins (and the staff token) act as owners everywhere.

AI routes answer 429 `{ error, scope: "user" \| "organization", used, limit, resetsAt }` over quota, 503 when no provider is configured, 502 on provider failure.

### Organizations and roles

Membership is ours, identity is Clerk's. `org_members (org_id, user_id, role, invited_by, joined_at)` is the source of truth for access; `organizations.owner_user_id` stays in step as the primary owner (listings, the sites-per-user limit). Migration `0007` creates the tables and backfills an owner membership for every existing organization owner, and copies `sites.org_id` onto `ai_usage.org_id`.

| Role | May |
|---|---|
| `viewer` | Read sites, versions, messages, domains, integration status, members and the activity log |
| `editor` | Viewer, plus edit content, upload images, use AI, publish and unpublish, delete messages |
| `admin` | Editor, plus add sites, invite and remove members, change non-owner roles, manage domains and integrations |
| `owner` | Everything, including delete sites, grant or remove the owner role and transfer ownership |

Every route resolves its site or organization through `src/access.ts` (`requireSiteRole`, `requireOrgRole`) before touching data. An organization always keeps at least one owner. An organization is created by the first `POST /sites` without `orgId` and deleted with its last site, members, invitations and events included.

**Invitations.** `POST /orgs/:id/invitations` stores only the SHA-256 of a 32-byte token (`org_invitations.token_hash`), valid for 7 days, and emails `<ALLOWED_ORIGIN>/invite/<token>` through the platform sender (`EMAIL_PROVIDER`). Re-inviting an address replaces its pending link. The web app's `/invite/:token` page shows the public preview and lets the invitee sign in and accept; accepting binds the Clerk user whose email matches. The per-day cap counts `member.invited` audit events, so revoking frees no slots.

**AI quota.** Each call is checked against the caller's `AI_DAILY_LIMIT` (default 30) and then the organization's `AI_DAILY_LIMIT_ORG` (default 100, all members together, counted on `ai_usage.org_id`); both reset at midnight UTC.

**Activity log.** `org_events (org_id, actor_user_id, action, target, detail_json, created_at)` records membership changes (`member.invited`, `member.joined`, `member.role_changed`, `member.removed`, `invitation.revoked`, `ownership.transferred`), `site.published`, `site.unpublished`, `site.deleted`, `domain.added`, `domain.removed` and `integration.connected` / `updated` / `disconnected`. `actor_user_id` is null when the system acted. Details never contain secrets (an integration event keeps the key hint only).

**Clerk `user.deleted` webhook.** In the Clerk dashboard add an endpoint `https://<api host>/webhooks/clerk` subscribed to `user.deleted`, then store its signing secret: `npx wrangler secret put CLERK_WEBHOOK_SECRET` (value `whsec_…`). Signatures are verified with the Svix scheme (`src/webhooks/svix.ts`: HMAC-SHA256 over `id.timestamp.body`, 5-minute tolerance, several `v1,` entries accepted during rotation). On `user.deleted` the account's memberships are removed with a `member.removed` event (`reason: account_deleted`), its `users.email` is set to null, and content stays with its organizations; where it was the last owner, the longest-standing admin (else editor, else viewer) is promoted to owner. Other event types are acknowledged and ignored.

Published sites are served by this Worker before CORS and auth run, from the `PUBLISHED` bucket only. A request host is resolved in this order: a customer domain from the `domains` table (a `primary` domain serves the site at `/`, its language pages at `/<lang>/`, the thank-you pages at `/thanks/` and `/<lang>/thanks/`, and takes contact-form posts at `/contact`; a `redirect` domain answers 301 to the primary), then `PUBLIC_SITES_HOST` (`sites.shofar.io/<slug>/`) and its subdomain form (`<slug>.sites.shofar.io/`). `PUBLIC_API_HOST` is never looked up as a customer domain. Published pages contain only document-relative links (`relativizeRootLinks` in `src/published.ts` enforces it), so the same `index.html` works at `/` and at `/<slug>/`.

### Contact form

Published sites post their contact form to this Worker: `POST /<slug>/contact` on the path form, `POST /contact` on the subdomain form (public, no auth, answered before CORS). The form is only rendered when the site's contact section has an `email`. The endpoint:

- takes `name` (1-120), `email` (3-200), `message` (1-4000) and the hidden `_lang` (a language of the site, else the primary) as urlencoded or multipart data, and answers a small HTML page on `400`, `404` (unknown site or no contact email), `405` (anything but POST) and `413` (over 64 KB);
- treats a filled honeypot field `website` as a bot: it redirects like a success and stores nothing;
- allows 5 messages per visitor per 10 minutes and 30 per site per hour (`429`). The visitor is identified by a salted SHA-256 of `CF-Connecting-IP` (salt: the `FORM_SALT` var, default `ministry`); the raw address is never stored;
- stores the message in `form_submissions` first, then emails it to the contact address with the visitor as `Reply-To`, subject `[<org>] New message from <name>`. A delivery failure is logged and kept in `delivery_error`; the visitor still gets the redirect. `delivered_via` records which sender handled it (`organization` or `platform`; null in store-only mode), see "Organization email" below;
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

An organization can connect its own Resend account so contact-form email leaves from its own domain and reputation instead of the platform's. Routes are under `/orgs/:id/integrations` (table above); any member can read the status, admins and owners can change it (non-members get 404), and every response is `Cache-Control: no-store`.

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
| `AI_DAILY_LIMIT` | `30` | AI routes | 429 `scope: "user"`; calls per user per UTC day |
| `AI_DAILY_LIMIT_ORG` | `100` | AI routes | 429 `scope: "organization"`; calls per organization per UTC day, all members together |

The per-file upload limit stays a constant of 5 MB (`src/routes/assets.ts`). The publish count lives in the `publish_events` table (one row per attempt that passed validation; rows older than a day are deleted on the next publish of that site), because publishing does not create a `site_versions` row. Apply the new migration (`wrangler d1 migrations apply ministry-sites --remote`) before deploying. Counts are read before the write, so two simultaneous requests can overshoot a limit by one; that is accepted.

### Response headers

Every API response (`src/security.ts`) carries `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, `Permissions-Policy: camera=(), microphone=(), geolocation=()` and, over HTTPS, `Strict-Transport-Security: max-age=31536000; includeSubDomains`. Routes under `/sites`, `/ai`, `/admin`, `/orgs`, `/invitations` and `/webhooks` (errors included) also send `Cache-Control: no-store`.

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
| `CLERK_WEBHOOK_SECRET` | same, name `CLERK_WEBHOOK_SECRET` | Optional. Signing secret of the Clerk webhook endpoint (`whsec_…`); enables `POST /webhooks/clerk` (see "Organizations and roles") |

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

What the customer does: create `CNAME <their hostname> -> sites.shofar.io` at their DNS provider (the editor shows this). For a root domain (`example.org` rather than `www.example.org`) the provider must support CNAME at the apex (Cloudflare DNS does; otherwise ALIAS/ANAME), because an A record to our IPs is not a supported setup without apex proxying. Once the CNAME resolves, Cloudflare verifies the hostname and issues the certificate over HTTP validation with no further action; *Check status* in the editor (`POST .../refresh`) pulls the result. A domain is live when both the hostname status and `ssl.status` are `active`.

Bridge World Foundation: add `bridgeworldfoundation.org` as the main domain and `bridgeworld.foundation` (and `www.` forms) as redirects; redirects answer 301 to the main domain with the path preserved.

### Subdomain form (`<slug>.sites.shofar.io`)

The hosting handler already serves `<slug>.sites.shofar.io/`, but nothing routes there yet. On the `shofar.io` zone add a proxied wildcard record `CNAME  *.sites  sites.shofar.io` and a Workers route `*.sites.shofar.io/*` -> `ministry-api` (unnecessary if the `*/*` route above exists). Universal SSL covers `shofar.io` and `*.shofar.io` only; a second-level wildcard like `*.sites.shofar.io` needs an Advanced Certificate (ACM, about $10/month) or Total TLS. Until one is bought, keep linking to the path form, which `PUBLIC_SITES_HOST` already produces.
