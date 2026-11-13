# Cutover runbook: build.shofar.io → build.shofar.ai

**Prepared:** 2026-11-13 · **Scope:** deploy `main` (PRs #3 to #8) and move the builder and its API to the shofar.ai zone. Hosted sites stay on `sites.shofar.io`.

The detailed reasoning behind each step is in `apps/api/README.md`, "Moving the builder to shofar.ai". This page is the ordered checklist with the facts checked today.

## What changes

| | Before (live now) | After |
|---|---|---|
| Editor | `build.shofar.io` | `build.shofar.ai` |
| API | `api.build.shofar.io` | `api.build.shofar.ai` |
| Hosted sites | `sites.shofar.io/<slug>/` | unchanged |
| Clerk application | builder-only app on `clerk.build.shofar.io` | the shofar.ai app on `clerk.shofar.ai` |
| Code | `a1ec287` plus the logo | `main` (security follow-ups, organizations, fundraising, AI-native editing, shofar.ai move, logo) |

## Facts checked on 2026-11-13

- `build.shofar.ai` and `api.build.shofar.ai` have no DNS records, so Wrangler can create them.
- **There are two Clerk applications on shofar.ai, not one.** `clerk.shofar.ai` is **"Shofar AI"** (home `shofar.ai`). `clerk.social.shofar.ai` is **"Shofar AI: Social"** (home `social.shofar.ai`). The merged code pins `clerk.shofar.ai`, so the builder joins "Shofar AI". It will not share a sign-in with social.shofar.ai until Social also moves to that app.
- Pending migrations 0007, 0008 and 0009 are additive: new tables, new columns with defaults, and two backfills (owner rows into `org_members`, `org_id` onto `ai_usage`). Nothing is dropped or rewritten.
- Production data to carry over: 1 organization (Bridge World Foundation), 1 published site, 2 user rows, 1 form message, no custom domains, no Resend integration.
- Secrets already on the API Worker: `CLERK_SECRET_KEY` (old app, to be replaced), `OPENAI_API_KEY`, `STAFF_API_TOKEN`, `INTEGRATIONS_KEY`. New: `CLERK_WEBHOOK_SECRET`.

## Decision before starting

**Which Clerk application?**
- **A. "Shofar AI" (`clerk.shofar.ai`). Recommended.** Works with the code as merged. The session cookie sits on `.shofar.ai`, so any app on that application shares the sign-in.
- **B. "Shofar AI: Social".** Needs a code change: `build.shofar.ai` added as a Clerk satellite domain and the CSP host changed. Pick it only if one sign-in with Social matters before Social can move.

The rest of this runbook assumes A.

## Downtime and rollback

- **Expected interruption:** a few minutes, between the API secret change (step 3) and the web deploy (step 5). Published sites keep serving the whole time, because hosting does not use Clerk.
- **Rollback:** redeploy commit `a1ec287` plus the logo to both Workers with the old routes, and put the old `CLERK_SECRET_KEY` back. The three migrations are additive, so the old code runs on the new schema. Keep the old key's value somewhere safe until the cutover is confirmed.

## Steps

Owner = you in a dashboard or terminal. Claude = I can run it once you say go.

| # | Who | Step | Check |
|---|---|---|---|
| 1 | Owner | In the "Shofar AI" Clerk application, production instance: copy `pk_live_…` and `sk_live_…`. Add `https://build.shofar.ai` to allowed origins and redirect URLs. | Publishable key decodes to `clerk.shofar.ai$` |
| 2 | Claude | Back up D1 (`wrangler d1 export`), then apply migrations 0007 to 0009 remotely. | Row counts unchanged; `org_members` has 1 owner row |
| 3 | Owner | `cd apps/api && npx wrangler secret put CLERK_SECRET_KEY` with the "Shofar AI" `sk_live_…`. **The editor sign-in stops working from here until step 5.** | — |
| 4 | Claude | Deploy the API from `main`. Wrangler attaches `api.build.shofar.ai`, keeps `sites.shofar.io`, detaches `api.build.shofar.io`. | `https://api.build.shofar.ai/health` is 200 and `sites.shofar.io/bridgeworld/` is 200 |
| 5 | Claude | Update `apps/web/.env.production` (new `pk_live_…`, `VITE_API_URL=https://api.build.shofar.ai`), build, and deploy the web app. Wrangler attaches `build.shofar.ai` and detaches `build.shofar.io`. | `https://build.shofar.ai` loads the sign-in page; no CSP errors in the console |
| 6 | Owner | Sign in on `build.shofar.ai` once with jeehakim@gmail.com, so the "Shofar AI" app knows the account. | Lands on an empty site list (expected, see 7) |
| 7 | Claude | Re-home Bridge World Foundation with the staff route `POST /orgs/:id/transfer` to your email. | It appears in your site list, opens, publishes |
| 8 | Owner | In "Shofar AI" Clerk: Webhooks → endpoint `https://api.build.shofar.ai/webhooks/clerk`, event `user.deleted`; then `npx wrangler secret put CLERK_WEBHOOK_SECRET` with its `whsec_…`. | Clerk's "Send test event" returns 200 |
| 9 | Claude | End-to-end smoke test: AI draft on a scratch site, translation, publish, contact form post, members page, a fundraising campaign; then delete the scratch site. | Each passes |
| 10 | Owner | Optional: on the `shofar.io` zone, a Redirect Rule `build.shofar.io/*` → `https://build.shofar.ai/${1}` (needs a proxied DNS record for `build.shofar.io`). | Old bookmarks redirect |
| 11 | Owner | After a week: delete the old builder Clerk application and its `clerk.build.shofar.io` DNS records. | — |

## Afterwards

- Update the README, CLAUDE.md and the in-app guides wherever they still mention `build.shofar.io`.
- If you later move Social onto "Shofar AI", the builder needs no change; both share the sign-in from then on.
