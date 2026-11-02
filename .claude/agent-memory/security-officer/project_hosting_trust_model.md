---
name: project-hosting-trust-model
description: Trust boundaries of Ministry Sites hosting (shared sites.shofar.io origin, same-site with build.shofar.io) and features that were latent/disabled at the 2026-11-02 audit
metadata:
  type: project
---
Hosted tenant pages are served by the API Worker at sites.shofar.io/<slug>/ (path form, one shared origin for all tenants) and on customer domains. sites.shofar.io, build.shofar.io (SPA) and api.build.shofar.io are all the same *site* (registrable domain shofar.io), so SameSite gives no isolation and tenant pages can toss cookies onto .shofar.io.

At the 2026-11-02 audit (HEAD ca60359), these features existed in code but were off in wrangler.jsonc: contact email (EMAIL_PROVIDER="none") and custom domains (CLOUDFLARE_ZONE_ID=""). Their abuse findings (arbitrary unverified recipient email relay, unlimited custom hostnames / domain squatting) were rated latent Medium and become High when switched on.

**Why:** severity of tenant-content bugs depends on origin sharing; latent findings must be re-rated when config flips.
**How to apply:** re-check wrangler.jsonc vars before rating email/domain findings; treat any tenant-controlled HTML/CSS as hostile to every other tenant. See [[pattern-raw-strings-into-templates]].
