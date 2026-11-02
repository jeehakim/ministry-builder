import { AI_ACTIONS } from "@ministry/schema";
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`);

export const users = sqliteTable("users", {
  /** Clerk user id. */
  id: text("id").primaryKey(),
  email: text("email"),
  role: text("role", { enum: ["admin", "member"] })
    .notNull()
    .default("member"),
  createdAt: createdAt(),
});

export const organizations = sqliteTable(
  "organizations",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id),
    /** Lets staff build a site and hand the org over to its owner later. */
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("organizations_owner_user_id_idx").on(t.ownerUserId), index("organizations_created_by_idx").on(t.createdBy)],
);

export const sites = sqliteTable(
  "sites",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    slug: text("slug").notNull(),
    templateId: text("template_id").notNull(),
    plan: text("plan", { enum: ["free", "hosted"] })
      .notNull()
      .default("free"),
    status: text("status").notNull().default("draft"),
    /** Points at site_versions.id. Deliberately not a foreign key: it would be circular with site_versions.site_id. */
    currentVersionId: text("current_version_id"),
    /** Set while the site is live on the public sites host; both cleared on unpublish. */
    publishedAt: integer("published_at", { mode: "timestamp_ms" }),
    publishedPath: text("published_path"),
    createdAt: createdAt(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [uniqueIndex("sites_slug_unique").on(t.slug), index("sites_org_id_idx").on(t.orgId)],
);

/** Append-only. Variations are several versions sharing a variation_group_id. */
export const siteVersions = sqliteTable(
  "site_versions",
  {
    id: text("id").primaryKey(),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id),
    /** JSON-encoded SiteDocument. */
    document: text("document").notNull(),
    variationGroupId: text("variation_group_id"),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("site_versions_site_id_created_at_idx").on(t.siteId, t.createdAt), index("site_versions_created_by_idx").on(t.createdBy)],
);

export const assets = sqliteTable(
  "assets",
  {
    id: text("id").primaryKey(),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id),
    r2Key: text("r2_key").notNull(),
    alt: text("alt").notNull().default(""),
    width: integer("width"),
    height: integer("height"),
    bytes: integer("bytes").notNull(),
    contentType: text("content_type").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("assets_site_id_idx").on(t.siteId), uniqueIndex("assets_r2_key_unique").on(t.r2Key)],
);

/** One row per AI call, written after the provider answers. The daily quota counts these rows. */
export const aiUsage = sqliteTable(
  "ai_usage",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    siteId: text("site_id").references(() => sites.id),
    action: text("action", { enum: AI_ACTIONS }).notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    /** User-supplied inputs (notes, instruction, language…) as JSON, truncated. Never the system prompt or secrets. */
    requestJson: text("request_json"),
    /** What the call produced: a version/group id, or the returned text/theme/alt as JSON, truncated. */
    resultJson: text("result_json"),
    createdAt: createdAt(),
  },
  (t) => [index("ai_usage_user_id_created_at_idx").on(t.userId, t.createdAt)],
);

/**
 * A contact-form message from a visitor of a published site. Stored before any email is attempted,
 * so a delivery failure never loses a message. `ip_hash` is a salted SHA-256, never the raw address.
 */
export const formSubmissions = sqliteTable(
  "form_submissions",
  {
    id: text("id").primaryKey(),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id),
    name: text("name").notNull(),
    email: text("email").notNull(),
    message: text("message").notNull(),
    language: text("language").notNull(),
    ipHash: text("ip_hash").notNull(),
    userAgent: text("user_agent").notNull().default(""),
    /** Set when the notification email was accepted by the provider. */
    deliveredAt: integer("delivered_at", { mode: "timestamp_ms" }),
    /** Why the notification email failed; null while undelivered-but-not-failed (store-only mode). */
    deliveryError: text("delivery_error"),
    /** Which sender the notification went through (or was attempted through): the organization's own Resend account or the platform's. Null in store-only mode. */
    deliveredVia: text("delivered_via", { enum: ["organization", "platform"] }),
    createdAt: createdAt(),
  },
  (t) => [
    index("form_submissions_site_id_created_at_idx").on(t.siteId, t.createdAt),
    index("form_submissions_ip_hash_created_at_idx").on(t.ipHash, t.createdAt),
  ],
);

/**
 * Customer domains attached to a hosted site (Cloudflare for SaaS custom hostnames).
 * One `primary` serves the site at `/`; any `redirect` answers 301 to the primary.
 */
export const domains = sqliteTable(
  "domains",
  {
    id: text("id").primaryKey(),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id),
    /** Lowercase, no trailing dot. Unique across every site. */
    hostname: text("hostname").notNull(),
    kind: text("kind", { enum: ["primary", "redirect"] }).notNull(),
    /** Id of the custom hostname in the shofar.io zone, null while the Cloudflare call has not succeeded. */
    cfCustomHostnameId: text("cf_custom_hostname_id"),
    /** Cloudflare's certificate status: pending_validation, pending_issuance, pending_deployment, active, ... */
    sslStatus: text("ssl_status").notNull().default("pending"),
    /** Set once Cloudflare reports the hostname as active (the customer's CNAME points at us). */
    verifiedAt: integer("verified_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [uniqueIndex("domains_hostname_unique").on(t.hostname), index("domains_site_id_idx").on(t.siteId)],
);

/**
 * One row per publish attempt that passed validation. The per-site hourly publish limit counts these
 * rows (site_versions cannot: publishing does not create a version). Rows older than a day are pruned
 * on the next publish of the same site.
 */
export const publishEvents = sqliteTable(
  "publish_events",
  {
    id: text("id").primaryKey(),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("publish_events_site_id_created_at_idx").on(t.siteId, t.createdAt)],
);

/**
 * An organization's own email provider account (bring your own Resend). The API key is stored only as
 * AES-256-GCM ciphertext bound to the organization id (see crypto.ts); `key_hint` is its last four characters.
 * At most one row per organization.
 */
export const orgIntegrations = sqliteTable(
  "org_integrations",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    provider: text("provider", { enum: ["resend"] })
      .notNull()
      .default("resend"),
    /** `v1.<iv>.<ciphertext+tag>`. Never returned by any route. */
    encryptedKey: text("encrypted_key").notNull(),
    keyHint: text("key_hint").notNull(),
    fromAddress: text("from_address"),
    fromName: text("from_name"),
    /** JSON array of domain names that were verified in the organization's Resend account when last fetched. */
    verifiedDomainsJson: text("verified_domains_json").notNull().default("[]"),
    testedAt: integer("tested_at", { mode: "timestamp_ms" }),
    lastError: text("last_error"),
    createdAt: createdAt(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [uniqueIndex("org_integrations_org_id_unique").on(t.orgId)],
);

/**
 * One row per attempt to store a key or send a test email, so the hourly limits can be counted.
 * Not tied to org_integrations: key attempts happen before a row exists, and a delete must not reset the limit.
 * Rows older than a day are pruned on the next attempt for the same organization.
 */
export const integrationEvents = sqliteTable(
  "integration_events",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    kind: text("kind", { enum: ["key_attempt", "test_email"] }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("integration_events_org_id_kind_created_at_idx").on(t.orgId, t.kind, t.createdAt)],
);

/**
 * A fundraising campaign of a site (platform design, section 3, phase A). Published at
 * `<site>/give/<slug>/` in every site language; gifts are recorded by staff, never processed here.
 * Money columns are integers in the currency's minor unit.
 */
export const campaigns = sqliteTable(
  "campaigns",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull().default(""),
    story: text("story").notNull().default(""),
    goalAmount: integer("goal_amount").notNull().default(0),
    currency: text("currency").notNull().default("USD"),
    /** ISO date (YYYY-MM-DD) or null. */
    deadline: text("deadline"),
    /** JSON-encoded ImageRef or null. */
    coverImageJson: text("cover_image_json"),
    /** JSON array of minor-unit integers. */
    suggestedAmountsJson: text("suggested_amounts_json").notNull().default("[]"),
    giveUrl: text("give_url").notNull().default(""),
    giveLabel: text("give_label").notNull().default(""),
    donorWallEnabled: integer("donor_wall_enabled", { mode: "boolean" }).notNull().default(false),
    thankYouMessage: text("thank_you_message").notNull().default(""),
    status: text("status", { enum: ["draft", "active", "closed"] })
      .notNull()
      .default("draft"),
    /** JSON object of translation overlays keyed by language code. */
    translationsJson: text("translations_json").notNull().default("{}"),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [uniqueIndex("campaigns_site_id_slug_unique").on(t.siteId, t.slug), index("campaigns_org_id_idx").on(t.orgId)],
);

/** A person who gave, deduplicated by email within an organization (the seed of the People module). */
export const donors = sqliteTable(
  "donors",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull().default(""),
    /** Lowercase. */
    email: text("email").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("donors_org_id_email_unique").on(t.orgId, t.email)],
);

/**
 * One recorded gift. `external` came through the organization's processor (recorded by hand or CSV),
 * `offline` was cash or a check. The platform never moves money, so there is no payment reference here.
 */
export const gifts = sqliteTable(
  "gifts",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaigns.id),
    donorId: text("donor_id").references(() => donors.id),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull(),
    source: text("source", { enum: ["external", "offline"] }).notNull(),
    donorName: text("donor_name").notNull().default(""),
    donorEmail: text("donor_email").notNull().default(""),
    /** The donor agreed to be named on the donor wall. */
    public: integer("public", { mode: "boolean" }).notNull().default(false),
    note: text("note").notNull().default(""),
    receivedAt: integer("received_at", { mode: "timestamp_ms" }).notNull(),
    recordedBy: text("recorded_by")
      .notNull()
      .references(() => users.id),
    /** Set when the thank-you email was accepted by the sender; null when none was attempted. */
    thankYouSentAt: integer("thank_you_sent_at", { mode: "timestamp_ms" }),
    thankYouError: text("thank_you_error"),
    createdAt: createdAt(),
  },
  (t) => [index("gifts_campaign_id_received_at_idx").on(t.campaignId, t.receivedAt), index("gifts_org_id_idx").on(t.orgId), index("gifts_donor_id_idx").on(t.donorId)],
);

export type User = typeof users.$inferSelect;
export type Site = typeof sites.$inferSelect;
export type Organization = typeof organizations.$inferSelect;
export type Domain = typeof domains.$inferSelect;
export type OrgIntegration = typeof orgIntegrations.$inferSelect;
export type CampaignRow = typeof campaigns.$inferSelect;
export type GiftRow = typeof gifts.$inferSelect;
