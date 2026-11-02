import { Hono } from "hono";
import { cors } from "hono/cors";
import { requireAuth } from "./auth";
import { serveSites } from "./hosting";
import { errorFields, logError, requestIdOf, scrub } from "./log";
import { adminRoutes } from "./routes/admin";
import { aiRoutes } from "./routes/ai";
import { assetRoutes } from "./routes/assets";
import { contactEmailRoutes } from "./routes/contactEmail";
import { domainRoutes } from "./routes/domains";
import { integrationRoutes } from "./routes/integrations";
import { messageRoutes } from "./routes/messages";
import { orgRoutes } from "./routes/orgs";
import { publishRoutes } from "./routes/publish";
import { siteRoutes } from "./routes/sites";
import { webhookRoutes } from "./routes/webhooks";
import { apiSecurityHeaders, requestContext } from "./security";
import type { AppEnv } from "./types";

const app = new Hono<AppEnv>();

app.use("*", requestContext);

// Published sites are public and static: answer them before CORS and auth ever run. They carry their
// own headers (see withHostedHeaders), so the API headers below only wrap what falls through.
app.use("*", serveSites);
app.use("*", apiSecurityHeaders);

app.use(
  "*",
  cors({
    origin: (origin, c) => (origin === c.env.ALLOWED_ORIGIN ? origin : null),
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Authorization", "Content-Type"],
    maxAge: 600,
  }),
);

// Reports which optional integrations are configured, never their values.
app.get("/health", (c) => c.json({ ok: true, ai: Boolean(c.env.OPENAI_API_KEY || c.env.ANTHROPIC_API_KEY) }));

// Everything under /sites, /ai, /admin and /orgs needs a signed-in user (or the staff token).
// GET /assets/*, GET /verify-contact/* (the link in a verification email), the invitation preview and the Clerk webhook (Svix-signed) stay public.
app.use("/sites", requireAuth);
app.use("/sites/*", requireAuth);
app.use("/ai/*", requireAuth);
app.use("/admin/*", requireAuth);
app.use("/orgs", requireAuth);
app.use("/orgs/*", requireAuth);
app.use("/invitations/:token/accept", requireAuth);

app.route("/", siteRoutes);
app.route("/", assetRoutes);
app.route("/", aiRoutes);
app.route("/", publishRoutes);
app.route("/", domainRoutes);
app.route("/", messageRoutes);
app.route("/", contactEmailRoutes);
app.route("/", integrationRoutes);
app.route("/", orgRoutes);
app.route("/", webhookRoutes);
app.route("/", adminRoutes);

app.notFound((c) => c.json({ error: "Not found" }, 404));
app.onError((err, c) => {
  // Name, scrubbed message and stack only: no request body, header or query string reaches the log.
  logError("unhandled_error", requestIdOf(c), {
    method: c.req.method,
    path: new URL(c.req.url).pathname,
    ...errorFields(err),
    stack: err instanceof Error && err.stack ? scrub(err.stack, 1500) : undefined,
  });
  return c.json({ error: "Internal server error" }, 500);
});

export default app;
