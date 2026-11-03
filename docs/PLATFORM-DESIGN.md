# Ministry Builder — platform design: AI-native editing, organizations, fundraising

**Date:** 2026-11-02 · **Status:** proposal for the next three build rounds · **Companion:** `PROPOSAL.md`, `SECURITY-REVIEW-2026-11-02.md`

---

## 1. AI-native editing

### What's wrong today

The copilot works, but it lives in buttons: a "Draft with AI" button that regenerates the whole page, and small sparkle menus per field. A returning user who wants to "make the About section warmer and add a youth camp" has no single place to say that, and the big button does too much.

### What the better builders do

- Duda regenerates **one section** from a hover button ([source](https://resources.duda.co/product-updates/new-let-ai-generate-the-perfect-section-for-your-page)); Hostinger's builder takes targeted prompts per block ([source](https://geekchamp.com/?p=864125)); Wix generates new sections in place ([source](https://support.wix.com/en/article/wix-editor-generating-page-sections-with-ai)). Users complain when regeneration wipes manual edits ([source](https://tooliverse.ai/tools/wix-ai)).
- AI-native product guidance for 2026 converges on three rules: put AI **where the user already is** rather than in a side chat ([source](https://www.boundev.ai/blog/ai-native-ux-design-saas-products)), offer actions **based on the current selection** ([source](https://aiindigo.com/blog/beyond-the-chatbot-5-ai-native-ux-patterns-for-modern-document-apps)), and make every AI action a **reviewable, reversible checkpoint** ([source](https://www.lazarev.agency/articles/saas-trends-2026)).

### Design

**Principle: the AI edits the thing you're looking at, shows you the change, and never touches anything else.**

1. **AI-first start.** A new site opens on a full-screen "Tell us about your organization" step (notes, language, optional reference). The three variations appear before the editor does. The manual editor is the *second* path, not the default. Returning users land in the editor as today.

2. **Ask AI, scoped to the selection.** One input, always visible at the bottom of the sidebar, with a chip showing the scope: *Hero*, *About*, *Site & design*, or *Whole page*. Selecting a section in the list or clicking it in the preview sets the scope. Typing "warmer, and mention childcare" edits only that section. Typing "add a section about the youth camp in July" inserts a new section after the current one. ⌘K opens the same input from anywhere.

3. **Proposed changes, not silent edits.** Every AI result comes back as a **change set**: the sections it would change, with before/after highlighted in the preview (changed sections get a thin accent outline and a "Proposed" tag). The user clicks **Apply**, **Try again**, or **Discard**. Applied changes are one Undo away. Nothing the user typed is overwritten without that click. This fixes the Wix complaint directly.

4. **Section options.** In a section's inspector: **3 options for this section** regenerates only that section three ways (tone, length, structure) shown as cards, keeping the rest of the page untouched. This replaces "regenerate the whole page" for the 90% case.

5. **Nudges instead of discovery problems.** The AI should not need to be found:
   - Empty or thin fields show a ghost prompt inside the field: *"Write this with AI →"*.
   - A **Suggestions** indicator in the header lists concrete, one-click improvements computed from the document (no model call): "2 images have no alt text", "About is under 40 words", "No contact email", "Hero has no button", "Add an English version". Each opens the right scope with the instruction prefilled.
   - After a draft is applied, a three-step checklist appears once: *Add photos · Check contact details · Publish*.

6. **Transparency.** The usage pill stays; the change-set view names the scope and the model; the audit trail already records inputs and outputs per call.

### API changes (small)

- `POST /sites/:id/ai/edit` `{ instruction, scope: { kind: "section", id } | { kind: "meta" } | { kind: "theme" } | { kind: "page" }, options?: 1 | 3 }` → `{ changes: [{ sectionId | "meta" | "theme", before, after, label? }] }`. The model receives only the scoped content plus a one-line page summary, so it is faster and cheaper than a draft (about 1k tokens).
- `POST /sites/:id/ai/add-section` `{ instruction, afterSectionId? }` → `{ section }`.
- Suggestions are computed client-side from the document; no endpoint.
- Quota: edits count as one action; three options count as one.

### Editor changes

- `AskAiBar` (scope chip, input, submit) pinned to the sidebar bottom; ⌘K shortcut.
- `ChangeSetReview` overlay with Apply / Try again / Discard; preview outlines proposed sections.
- Section inspector gains "3 options for this section".
- `SuggestionsMenu` in the header; ghost prompts in empty fields.
- `StartWithAi` first-run screen for new sites.

---

## 2. Organizations and multi-tenancy

### Audit of what exists (2026-11-02)

| Rule | Status |
|---|---|
| Every site, version, asset, message, publish event, domain and integration belongs to an organization | Yes |
| Every route checks owner-or-admin through one helper (`access.ts`) before touching a site or org | Yes, tested (non-owner gets 404) |
| Listing is scoped to the caller's organizations | Yes |
| Published files are isolated by site id in R2; hosting resolves by slug or verified host | Yes |
| Staff admin is a separate role; staff token is constant-time compared | Yes |
| AI quota | Per organization per day (`AI_DAILY_LIMIT_ORG`), with the per-user limit as a guard; `ai_usage.org_id` |
| Organization has members, roles, invitations | Yes: `org_members` with owner/admin/editor/viewer, hashed-token email invitations (`org_invitations`), role-aware checks in `access.ts` |
| Switch between organizations | Yes: org switcher in the app headers backed by `GET /orgs`; Home lists the current organization's sites |
| Account deletion / Clerk user.deleted webhook | Yes: `POST /webhooks/clerk` (Svix-verified) removes memberships, anonymizes the email, promotes a replacement owner |
| Audit log of who changed what | Yes: `org_events`, shown under Settings > Activity |

The rows above were "No" until the organizations work landed (see `apps/api/README.md`, "Organizations and roles"). Still open from the target model: `slug`, `plan` and `limits` on the organization, org-scoped URLs (`/o/<slug>/...`), and the staff console.

### Target model

- **Organization** (exists) gains `slug`, `plan` (`free` | `hosted` | `sponsored`), `limits` (sites, storage, AI actions per day, members), `settings_json`.
- **Members**: `org_members (org_id, user_id, role, invited_by, joined_at)` with roles **owner** (billing, delete, transfer), **admin** (everything but billing/delete), **editor** (content, publish, messages), **viewer** (read-only, see messages). One owner minimum; ownership transfer replaces today's admin-only transfer route.
- **Invitations**: `org_invitations (org_id, email, role, token_hash, expires_at, accepted_at)`; sent through the platform sender; accepting binds the Clerk user who signs in with that email.
- **Org context in the app**: an org switcher in the header; the URL carries the org slug (`/o/<slug>/sites/...`); every API call is `/orgs/:orgId/...` or carries the org via the site. The current per-site routes keep working.
- **Quotas per organization** (AI actions, sites, storage) with a per-user cap as a secondary guard; `ai_usage` gains `org_id`.
- **Audit log**: `org_events (org_id, actor_user_id, action, target, created_at)` for membership, publish, domain, integration and deletion events; shown in Settings.
- **Identity stays with Clerk; membership stays ours.** Clerk Organizations would give invitations and UI for free, but tie plans, roles and limits to a vendor's model and pricing; our own tables keep the fundraising and future modules on the same membership. Clerk's `user.deleted` webhook removes memberships and anonymizes rows.
- **Staff console**: `/admin` list of organizations, plan changes, impersonation-free support (view as viewer), sponsored-site grants.

Isolation rule for every new module: **every row has `org_id`, every query filters by it, every route resolves the org through `access.ts` first.** The fundraising module below is written against that rule.

---

## 3. From landing pages to an all-in-one non-profit platform

Modules, in the order they create value for a small non-profit, each a separate app area sharing the organization, members, hosting and AI:

1. **Sites** (shipped): the public face.
2. **Fundraising** (next): campaigns and giving pages that live on the same site and domain.
3. **Events**: sign-ups and reminders, published to the site's Events section automatically.
4. **People**: a simple CRM of donors, volunteers and members, fed by forms, gifts and sign-ups.
5. **Updates**: email newsletters to People, through the same sender.

### Fundraising MVP

**Goal:** a non-profit launches a campaign in ten minutes, shares one link, sees progress, and thanks donors, without the platform ever holding money.

- **Campaign**: title, story (AI-drafted from a brief, like a page section), goal, deadline, cover image, suggested amounts, optional matching note. Published at `…/<slug>/give/<campaign>/` and surfaced as a card in the site's Give section, in every language.
- **Giving**: phase A links out to the processor the org already uses (Zeffy, Givebutter, PayPal, Tithe.ly) with the campaign in the URL; staff record offline and external gifts by hand or CSV. Phase B adds **Stripe Connect Standard** so card gifts go directly to the org's own Stripe account, with the platform taking no cut and holding no funds; recurring gifts and receipts come with it. Billing for the hosted plan (Stripe Billing) is a separate, later piece as agreed.
- **Progress and donors**: live progress bar, optional donor wall with opt-in names, thank-you emails through the configured sender, exports.
- **Data**: `campaigns`, `gifts (org_id, campaign_id, amount, currency, source: external|offline|stripe, external_ref, donor_id, created_at)`, `donors` (People), `campaign_updates`.
- **AI**: draft the story, write the thank-you, translate the campaign, suggest a goal from past campaigns.
- **Trust**: every gift page carries the org's legal name and EIN (from the registry lookup proposed earlier), a privacy note, and the processor's own secure checkout.

### Sequencing

| Round | Scope | Depends on |
|---|---|---|
| A | AI-native editing (section 1) | nothing |
| B | Organizations: members, roles, invitations, switcher, org quotas, audit log | nothing; lands before fundraising |
| C | Fundraising MVP phase A | B |
| D | Stripe Connect for gifts; Stripe Billing for plans | C, and the decision to charge |

A and B can run in parallel; C waits for B so gifts are org-scoped from the first row.
