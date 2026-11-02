export type Bindings = {
  DB: D1Database;
  IMAGES: R2Bucket;
  ALLOWED_ORIGIN: string;
  CLERK_SECRET_KEY: string;
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
