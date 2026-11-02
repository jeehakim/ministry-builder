import { Hono } from "hono";
import { cors } from "hono/cors";
import { requireAuth } from "./auth";
import { serveSites } from "./hosting";
import { adminRoutes } from "./routes/admin";
import { aiRoutes } from "./routes/ai";
import { assetRoutes } from "./routes/assets";
import { messageRoutes } from "./routes/messages";
import { publishRoutes } from "./routes/publish";
import { siteRoutes } from "./routes/sites";
import type { AppEnv } from "./types";

const app = new Hono<AppEnv>();

// Published sites are public and static: answer them before CORS and auth ever run.
app.use("*", serveSites);

app.use(
  "*",
  cors({
    origin: (origin, c) => (origin === c.env.ALLOWED_ORIGIN ? origin : null),
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Authorization", "Content-Type"],
    maxAge: 600,
  }),
);

// Reports which optional integrations are configured, never their values.
app.get("/health", (c) => c.json({ ok: true, ai: Boolean(c.env.OPENAI_API_KEY || c.env.ANTHROPIC_API_KEY) }));

// Everything under /sites, /ai, /admin and /orgs needs a signed-in user (or the staff token).
// GET /assets/* stays public.
app.use("/sites", requireAuth);
app.use("/sites/*", requireAuth);
app.use("/ai/*", requireAuth);
app.use("/admin/*", requireAuth);
app.use("/orgs/*", requireAuth);

app.route("/", siteRoutes);
app.route("/", assetRoutes);
app.route("/", aiRoutes);
app.route("/", publishRoutes);
app.route("/", messageRoutes);
app.route("/", adminRoutes);

app.notFound((c) => c.json({ error: "Not found" }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "Internal server error" }, 500);
});

export default app;
