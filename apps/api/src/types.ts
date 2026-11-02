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
