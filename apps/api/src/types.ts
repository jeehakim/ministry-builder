export type Bindings = {
  DB: D1Database;
  IMAGES: R2Bucket;
  /** Rendered sites served by the hosting handler. Never mixed with IMAGES. */
  PUBLISHED: R2Bucket;
  ALLOWED_ORIGIN: string;
  CLERK_SECRET_KEY: string;
  /** Chat model for the AI copilot (var). */
  OPENAI_MODEL: string;
  /** AI calls allowed per user per UTC day, as a string (var). */
  AI_DAILY_LIMIT: string;
  /** Hostname that serves published sites, e.g. "sites.shofar.io" (var). */
  PUBLIC_SITES_HOST: string;
  /** Hostname of this API, e.g. "api.build.shofar.io" (var). Requests for it skip the custom-domain lookup. */
  PUBLIC_API_HOST?: string;
  /** Proxied hostname on the shofar.io zone that customers CNAME their domain to (var). */
  CUSTOM_HOSTNAME_CNAME_TARGET?: string;
  /** Zone id of shofar.io, where custom hostnames are created (var). */
  CLOUDFLARE_ZONE_ID?: string;
  /** Secret. API token with "SSL and Certificates: Edit" on the shofar.io zone. Enables custom domains. */
  CLOUDFLARE_API_TOKEN?: string;
  /** Set to "fake" in tests to use the deterministic provider. Never set in production. */
  AI_PROVIDER?: string;
  /** Secret. Shared token for staff automation (X-Staff-Token); authenticates as the admin user `staff-bot`. */
  STAFF_API_TOKEN?: string;
  /** Secret. Set in the dashboard (Settings > Variables and Secrets) or with `wrangler secret put`. Powers the AI copilot. */
  OPENAI_API_KEY?: string;
};

export type AuthUser = {
  id: string;
  email: string | null;
  role: "admin" | "member";
};

export type AppEnv = {
  Bindings: Bindings;
  Variables: { user: AuthUser };
};
