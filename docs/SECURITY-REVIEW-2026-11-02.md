# Security review: Ministry Sites (HEAD ca60359, read-only)

Line numbers are for HEAD ca60359. Uncommitted work by another agent (security.ts, publishSafety.ts,
limits.ts, apps/web/public/_headers, hosting.ts) partly addresses findings 2, 4 and 9. It does not fix finding 1,
and none of it is committed. For the abuse and denial-of-service items I describe the weakness and the fix
but leave out step-by-step exploitation.

## Status (checked against `main` on 2026-11-02, after PR 7)

Line numbers below are those of HEAD ca60359 and no longer match the code. This table is the current state; the findings themselves are kept as written.

| # | Severity | Status | Where it stands |
|---|---|---|---|
| 1 | HIGH | Fixed | Theme colors and fonts are regex-constrained in `packages/schema/src/site.ts`, and `themeVars` escapes the characters that could close a style block (`packages/templates/src/util.ts`) |
| 2 | HIGH | Fixed in code | Sites per user, versions per site with pruning, storage per site and publishes per hour are enforced (`apps/api/src/limits.ts`, vars in `wrangler.jsonc`). A Cloudflare WAF rate-limit rule is still an owner-side dashboard step |
| 3 | MEDIUM | Fixed | Quota is reserved atomically before the provider call, with a global daily cap (`apps/api/src/ai/usage.ts`, PR 3) |
| 4 | MEDIUM | Mitigated | Hosted pages send `frame-ancestors 'none'`. The builder and its API moved to `build.shofar.ai` / `api.build.shofar.ai` (PR 7), a different registrable domain from `sites.shofar.io`. Tenants still share the one `sites.shofar.io` origin; per-tenant origins or a Public Suffix List entry were not pursued |
| 5 | MEDIUM | Fixed | The platform sender only emails a double-opted-in address (`contact_email_verifications`, PR 3) |
| 6 | MEDIUM | Fixed | TXT ownership proof before any Cloudflare call, per-site and per-user caps, unproved rows expire, only active rows are served (PR 3) |
| 7 | MEDIUM | Fixed | `apps/web/public/_headers` (CSP checked by `csp.test.ts`), `apps/api/src/security.ts` on API and hosted responses |
| 8 | LOW | Open | Count-then-insert, IPv6 keyed by full address, per-site cap fixed at 30 per hour (`apps/api/src/contact.ts`) |
| 9 | LOW | Open | SHA-256 with the `FORM_SALT` var (default `ministry`), no retention period, user agent kept. Set `FORM_SALT` in production until this is reworked |
| 10 | LOW | Partly fixed | Site deletion now clears `ai_usage` request and result text. The Clerk `user.deleted` webhook arrives with the organizations work (PR 4). No retention TTL |
| 11 | LOW | Fixed | Custom hostnames and domain rows are removed before the site rows (`apps/api/src/routes/sites.ts`) |
| 12 | LOW | Open | Draft `language` still has no length bound (`packages/schema/src/ai.ts`); `orgName` is fenced only in the alt-text prompt. Model output is validated against the strict schema, which closes the path into finding 1 |
| 13 | INFO | Open | One static staff token, no minimum length check, no audit trail of staff actions |
| 14 | INFO | Fixed | `workers_dev` and `preview_urls` are off in both `wrangler.jsonc` files |
| 15 | INFO | Fixed | `minimumReleaseAge` in `pnpm-workspace.yaml`; `shadcn` is a devDependency |

## Findings

[HIGH] 1. Stored XSS: theme values break out of `<style>` on the shared sites.shofar.io origin
LOCATION: packages/templates/src/util.ts:5 (themeVars); packages/schema/src/site.ts:27-32 (Theme fields are plain z.string()); packages/templates/src/index.tsx:96, :119
ATTACK PATH: A signed-in user saves a theme color or font value that closes the `<style>` element, through PUT /sites/:id/document, or through AI theme/draft output (routes/ai.ts:202, :274), which is checked against the same loose schema. Publishing writes their own markup and script into the hosted page. Confirmed with a PoC against the real renderer (scratchpad/poc.test.tsx).
IMPACT: Script runs for every visitor, on an origin shared by all tenants with no CSP or framing protection at HEAD, and, at the time of the review, on the same site as the builder and its API (then on build.shofar.io; since moved to build.shofar.ai, a different registrable domain, see apps/api/README.md "Moving the builder to shofar.ai"). This allows tampering with other tenants' pages (for example donation links), cookie tossing onto .shofar.io, and phishing that could get sites.shofar.io blocklisted for every tenant.
FIX: Constrain the schema: colors to `^#[0-9a-fA-F]{3,8}$` (or a small allowlist of rgb()/hsl() forms), fonts to `^[A-Za-z0-9 ,'"-]{1,200}$`. Also escape `<` inside themeVars. The in-flight CSP helps, but it does not fix the breakout: HTML injection (including meta refresh) still works, and the new href sanitizer never looks at theme fields.

[HIGH] 2. One account can use up the whole platform's free-plan resources
LOCATION: apps/api/src/routes/sites.ts:66 (no cap on sites per user); sites.ts:151-186 (every save of up to 1 MB stores a new version, with no pruning or rate limit); routes/assets.ts:51 (no upload quota); routes/publish.ts:52 (no publish rate limit)
ATTACK PATH: Nothing caps per-user consumption of storage or write operations. The D1, R2 and Worker limits on the free plan are shared by every tenant.
IMPACT: Saves, publishing and contact forms fail for everyone until the limits reset or storage is cleaned up.
FIX: Per-user rate limits (Workers Rate Limiting binding), caps on sites per user and versions per site with pruning, a per-site storage quota, a publish rate limit, and a Cloudflare WAF rate-limit rule. Finish, test and commit the in-flight limits.ts.

[MEDIUM] 3. AI daily quota: checked before the call, recorded after it
LOCATION: apps/api/src/routes/ai.ts:82 (check); ai.ts:215-236, :251, :271 (usage row inserted after the provider returns)
ATTACK PATH: Requests sent at the same time all pass the check before any usage is recorded.
IMPACT: The per-user daily limit does not hold, and the cost lands on the provider bill.
FIX: Reserve quota atomically before the call (a conditional insert of a pending usage row). Add a global daily cap and a hard spend limit on the provider project.

[MEDIUM] 4. All tenants share one origin, on the same registrable domain as the editor
LOCATION: apps/api/src/hosting.ts:196-220 (path form sites.shofar.io/<slug>/)
ATTACK PATH: Any content-injection bug on one tenant's page affects every tenant, and the editor and API are same-site.
IMPACT: Any future injection bug is cross-tenant. The in-flight `frame-ancestors 'self'` and `X-Frame-Options: SAMEORIGIN` still let one tenant frame another.
FIX: Give each tenant its own origin on a separate registrable domain, or add sites.shofar.io to the Public Suffix List. Use `frame-ancestors 'none'` on hosted pages.

[MEDIUM, latent while EMAIL_PROVIDER="none"] 5. Contact-form email goes to an address nobody verified
LOCATION: apps/api/src/contact.ts:131 (recipient taken from the document); hosting.ts:146, :212 (unpublished sites accepted)
ATTACK PATH: Once email is enabled, a site owner can point the contact address at a third party and have form content mailed from forms@shofar.io.
IMPACT: Spam or phishing sent through the platform, which damages shofar.io's sending reputation.
FIX: Only send to a verified address (the owner's verified Clerk email, or a double-opt-in contact address). Add per-owner daily caps, and require the site to be published.

[MEDIUM, latent while CLOUDFLARE_ZONE_ID=""] 6. Custom domains: no cap, no ownership proof
LOCATION: apps/api/src/routes/domains.ts:87-139; hosting.ts:133-153 (serves a domain from its D1 row without checking verifiedAt)
ATTACK PATH: Anyone can register another organisation's hostname first, or register many hostnames. A hostname whose DNS still points at sites.shofar.io can be claimed, and a certificate is issued automatically.
IMPACT: Domain squatting (the real owner gets 409 for good, because pending rows never expire), the Cloudflare for SaaS quota gets used up or billed, and takeover of dangling CNAMEs.
FIX: Limit domains per site and per user. Require TXT ownership verification before activation. Expire unverified rows after a few days. Check verifiedAt and SSL status before serving.

[MEDIUM] 7. No security headers at HEAD
LOCATION: apps/web has no committed public/_headers; hosting.ts:122 (hosted pages send only nosniff); apps/api/src/index.ts (API JSON sends no nosniff and no no-store)
ATTACK PATH: The editor can be framed (clickjacking of actions like site deletion), and there is no CSP as a second layer on the SPA or hosted pages.
IMPACT: Defense in depth is missing.
FIX: Commit and verify the in-flight headers. On hosted pages, use `frame-ancestors 'none'` rather than `'self'`.

[LOW] 8. Contact-form rate limit has gaps
LOCATION: apps/api/src/contact.ts:159-183
ATTACK PATH: The count and the insert are separate steps. IPv6 is keyed by the full address. The per-site cap is fixed at 30 per hour.
IMPACT: Bursts get past the limit, and anyone can fill up a site's form so real visitors are refused.
FIX: Key IPv6 by /64, make the check and insert atomic, and consider Turnstile.

[LOW] 9. The stored IP hash can be reversed
LOCATION: apps/api/src/contact.ts:92-95, :157; apps/api/src/types.ts:56 (FORM_SALT is a plain var, default "ministry")
ATTACK PATH: Anyone with D1 read access and the known salt can hash the whole IPv4 space and match the stored values.
IMPACT: Visitor IP addresses (personal data) can be recovered, and they are kept indefinitely along with the user agent.
FIX: Use HMAC with a secret key that rotates, clear ipHash after the rate-limit window, and set a retention period for submissions.

[LOW] 10. Deleting a site leaves data behind
LOCATION: apps/api/src/routes/sites.ts:217
ATTACK PATH: Not an attack: the data simply stays after deletion.
IMPACT: ai_usage keeps request and result text (up to 4000 characters of the owner's notes). There is no account deletion path, and every version of a site is kept forever.
FIX: Clear requestJson and resultJson on site delete. Add a retention TTL and handle Clerk's user.deleted webhook.

[LOW] 11. Deleting a site that has a custom domain fails partway
LOCATION: apps/api/migrations/0004_tranquil_lady_vermin.sql:11 (domains foreign key has no cascade); routes/sites.ts:206-227
ATTACK PATH: Not an attack: a reliability bug. R2 objects are deleted first, then the database batch fails on the foreign key.
IMPACT: A half-deleted site, and the user cannot finish deleting it.
FIX: Remove the Cloudflare hostnames and domain rows first.

[LOW] 12. Prompt injection
LOCATION: apps/api/src/ai/prompts.ts:57, :96; packages/schema/src/ai.ts:36 (language has no length limit)
ATTACK PATH: Every model input is the caller's own data, so this is self-injection only. Draft `language` and `orgName` go into the prompt without fencing.
IMPACT: Low on its own. Model output feeds finding 1.
FIX: Bound and validate `language`, and validate model output against the strict schema.

[INFO] 13. Staff token is all-powerful
LOCATION: apps/api/src/auth.ts:32-41
ATTACK PATH: No exploitation path, given a strong secret. One static token is admin across every tenant, with no scoping, expiry or audit trail.
IMPACT: The blast radius if it leaks.
FIX: Use per-purpose tokens with rotation, log staff actions, and require at least 32 random bytes.

[INFO] 14. workers.dev is not turned off
LOCATION: apps/api/wrangler.jsonc
ATTACK PATH: No exploitation path. The API and the custom-domain lookup may be reachable on *.workers.dev.
IMPACT: An extra, unintended entry point.
FIX: Set `"workers_dev": false` and `"preview_urls": false`.

[INFO] 15. Dependency hygiene
LOCATION: apps/web/package.json
ATTACK PATH: No exploitation path. `cn@0.5.2` (maintained by shadcn) was published the same day and is pulled in through a caret range. The `shadcn` CLI is a runtime dependency. The lockfile pins integrity hashes, and pnpm 10 blocks install scripts.
IMPACT: Supply-chain exposure to brand-new releases.
FIX: Set pnpm `minimumReleaseAge`, and move `shadcn` to devDependencies.

## Already good
- Every /sites/:id route goes through loadAuthorizedSite, which allows the owner or an admin and returns 404 otherwise. Assets, messages and domains are scoped by site id. GET /sites is filtered by owner. Admin routes check the admin role, which comes from D1, not the JWT.
- Clerk tokens are verified with authorizedParties. The staff token is compared in constant time and is disabled when unset. CORS uses an exact origin match and does not allow X-Staff-Token.
- Uploads check type against an allowlist and the magic bytes, keys are server-generated UUIDs, GET keys must match a strict pattern, nosniff is set, and SVG is not allowed.
- R2 is well isolated: publish copies only the site's own assets, AI image keys are scope-checked, hosting paths are regex-gated (no traversal), and the published bucket is separate from IMAGES.
- React 19.3 server rendering escapes text and blocks javascript: URLs. JSON-LD escapes `<`, and the head meta tags are escaped.
- Editor previews are sandboxed without allow-scripts, so finding 1 does not run inside the builder app.
- Email header fields are made single-line, CR/LF is rejected and the HTML is escaped. Form bodies are capped at 64 KB, and there is a honeypot field.
- Translation strips href, email, phone and formEndpoint from what goes to the model, and the overlay is forced back to the source's shape.
- I found no secrets in the repo or its history. There is no SSRF path: every outbound fetch goes to a fixed host. The agent config (.claude/launch.json, CLAUDE.md) is benign, with no hooks or .mcp.json.

VERDICT: BLOCK SHIP. Finding 1 is a stored XSS that any free account can exploit in production right now, on an origin shared by every tenant.
