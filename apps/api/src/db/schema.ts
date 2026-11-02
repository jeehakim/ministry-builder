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

export type User = typeof users.$inferSelect;
export type Site = typeof sites.$inferSelect;
export type Organization = typeof organizations.$inferSelect;
export type Domain = typeof domains.$inferSelect;
