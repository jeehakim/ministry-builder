# Ministry Sites — working notes for Claude

- pnpm workspace. Run checks from the root: `pnpm typecheck`, `pnpm test`, `pnpm build`.
- `packages/schema` is the contract. Editor, AI adapter and templates all import `SiteDocument` from `@ministry/schema`; never redefine or widen it locally. New section types are appended to the discriminated union.
- Templates render to static HTML in the browser (`renderSite`) for preview and ZIP export. The one server-side render is `POST /sites/:id/publish` (small page, a few ms of CPU); keep everything else on the Workers free-plan budget: JSON, storage and outbound calls.
- AI goes through the provider adapter in `apps/api/src/ai/` (OpenAI today; add Anthropic as a second implementation, never call a provider from routes directly). Staff automation uses the `X-Staff-Token` header; the secret is set in the Worker, never in the repo.
- Hosted sites are served by the API Worker at `sites.shofar.io/<slug>/` from the `ministry-published` R2 bucket. Customer domains are Cloudflare for SaaS custom hostnames on the `shofar.io` zone (`apps/api/src/cloudflare.ts`, `domains` table); the one-time zone setup is in `apps/api/README.md`.
- No payment processing for the orgs' donations; link out to Zeffy/Givebutter/PayPal.
- Domains: `build.shofar.ai` (web) and `api.build.shofar.ai` (API) on the `shofar.ai` zone, part of the shofar.ai ecosystem next to `social.shofar.ai`; they share the shofar.ai Clerk application (Clerk is identity only, membership is in our tables). Hosted sites stay on `sites.shofar.io` (`<slug>.sites.shofar.io` is Phase 2). Zones `shofar.io` and `shofar.ai` are on the owner's Cloudflare account. Never hard-code the app origin: the API reads `ALLOWED_ORIGIN`, the web app `VITE_API_URL`.
- Plan and roadmap: `docs/PROPOSAL.md`. Market data: `docs/COMPETITORS.md`.
