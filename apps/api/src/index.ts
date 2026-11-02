import { Hono } from "hono";
import { cors } from "hono/cors";
import { requireAuth } from "./auth";
import { assetRoutes } from "./routes/assets";
import { siteRoutes } from "./routes/sites";
import type { AppEnv } from "./types";

const app = new Hono<AppEnv>();

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

app.get("/health", (c) => c.json({ ok: true }));

// Everything under /sites needs a signed-in user. GET /assets/* stays public.
app.use("/sites", requireAuth);
app.use("/sites/*", requireAuth);

app.route("/", siteRoutes);
app.route("/", assetRoutes);

app.notFound((c) => c.json({ error: "Not found" }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "Internal server error" }, 500);
});

export default app;
