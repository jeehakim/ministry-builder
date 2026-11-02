---
name: project-hosting-trust-model
description: Trust boundaries of Ministry Sites hosting (shared sites.shofar.io origin; the builder moved to build.shofar.ai, a different site) and features that were latent/disabled at the 2026-11-02 audit
metadata:
  type: project
---
Hosted tenant pages are served by the API Worker at sites.shofar.io/<slug>/ (path form, one shared origin for all tenants) and on customer domains. All tenants share that one site (registrable domain shofar.io), so SameSite gives no isolation between tenants and tenant pages can toss cookies onto .shofar.io. The builder (build.shofar.ai, SPA) and its API (api.build.shofar.ai) moved to the shofar.ai zone on 2026-11-02 (before that they were build.shofar.io / api.build.shofar.io, same site as the tenants): tenant cookies no longer reach them, and they share the shofar.ai Clerk application with social.shofar.ai, so a Clerk session cookie on .shofar.ai is shared by every shofar.ai app.

At the 2026-11-02 audit (HEAD ca60359), these features existed in code but were off in wrangler.jsonc: contact email (EMAIL_PROVIDER="none") and custom domains (CLOUDFLARE_ZONE_ID=""). Their abuse findings (arbitrary unverified recipient email relay, unlimited custom hostnames / domain squatting) were rated latent Medium and become High when switched on.

**Why:** severity of tenant-content bugs depends on origin sharing; latent findings must be re-rated when config flips.
**How to apply:** re-check wrangler.jsonc vars before rating email/domain findings; treat any tenant-controlled HTML/CSS as hostile to every other tenant. See [[pattern-raw-strings-into-templates]].
