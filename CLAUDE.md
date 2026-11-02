# Ministry Sites — working notes for Claude

- pnpm workspace. Run checks from the root: `pnpm typecheck`, `pnpm test`, `pnpm build`.
- `packages/schema` is the contract. Editor, AI adapter and templates all import `SiteDocument` from `@ministry/schema`; never redefine or widen it locally. New section types are appended to the discriminated union.
- Templates render to static HTML in the browser (`renderSite`). Keep the Workers on the free plan: no server-side React rendering, Workers do JSON, storage and outbound calls only.
- No payment processing for the orgs' donations; link out to Zeffy/Givebutter/PayPal.
- Domains: `build.shofar.io` (web), `api.build.shofar.io` (API), `<slug>.sites.shofar.io` (hosted sites, Phase 2). Zones `shofar.io` and `shofar.ai` are on the owner's Cloudflare account.
- Plan and roadmap: `docs/PROPOSAL.md`. Market data: `docs/COMPETITORS.md`.
