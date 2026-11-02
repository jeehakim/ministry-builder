export type Bindings = {
  DB: D1Database;
  IMAGES: R2Bucket;
  /** Rendered sites served by the hosting handler. Never mixed with IMAGES. */
  PUBLISHED: R2Bucket;
  ALLOWED_ORIGIN: string;
  CLERK_SECRET_KEY: string;
  /** Chat model for the AI copilot when OpenAI is the provider (var). */
  OPENAI_MODEL: string;
  /** Claude model for the AI copilot when Anthropic is the provider (var); defaults to claude-opus-5-5. */
  ANTHROPIC_MODEL?: string;
  /** AI calls allowed per user per UTC day, as a string (var). */
  AI_DAILY_LIMIT: string;
  /** Hostname that serves published sites, e.g. "sites.shofar.io" (var). */
  PUBLIC_SITES_HOST: string;
  /**
   * "openai" or "anthropic" picks the provider explicitly (its key must be set); unset means
   * whichever key is set, OpenAI first. "fake" is the deterministic test provider; never set it in production.
   */
  AI_PROVIDER?: string;
  /** Secret. Shared token for staff automation (X-Staff-Token); authenticates as the admin user `staff-bot`. */
  STAFF_API_TOKEN?: string;
  /** Secret. Set in the dashboard (Settings > Variables and Secrets) or with `wrangler secret put`. Powers the AI copilot. */
  OPENAI_API_KEY?: string;
  /** Secret. Claude API key from console.anthropic.com; powers the AI copilot when chosen (see AI_PROVIDER). */
  ANTHROPIC_API_KEY?: string;
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
