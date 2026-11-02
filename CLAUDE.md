# Ministry Sites — working notes for Claude

- pnpm workspace. Run checks from the root: `pnpm typecheck`, `pnpm test`, `pnpm build`.
- `packages/schema` is the contract. Editor, AI adapter and templates all import `SiteDocument` from `@ministry/schema`; never redefine or widen it locally. New section types are appended to the discriminated union.
- Templates render to static HTML in the browser (`renderSite`) for preview and ZIP export. The one server-side render is `POST /sites/:id/publish` (small page, a few ms of CPU); keep everything else on the Workers free-plan budget: JSON, storage and outbound calls.
- AI goes through the provider adapter in `apps/api/src/ai/` (OpenAI today; add Anthropic as a second implementation, never call a provider from routes directly). Staff automation uses the `X-Staff-Token` header; the secret is set in the Worker, never in the repo.
- Hosted sites are served by the API Worker at `sites.shofar.io/<slug>/` from the `ministry-published` R2 bucket.
- No payment processing for the orgs' donations; link out to Zeffy/Givebutter/PayPal.
- Domains: `build.shofar.io` (web), `api.build.shofar.io` (API), `<slug>.sites.shofar.io` (hosted sites, Phase 2). Zones `shofar.io` and `shofar.ai` are on the owner's Cloudflare account.
- Plan and roadmap: `docs/PROPOSAL.md`. Market data: `docs/COMPETITORS.md`.
