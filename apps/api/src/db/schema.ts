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

export type User = typeof users.$inferSelect;
export type Site = typeof sites.$inferSelect;
