import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            // Deterministic AI provider, a low daily limit to exercise the quota, and a known staff token.
            AI_PROVIDER: "fake",
            AI_DAILY_LIMIT: "4",
            STAFF_API_TOKEN: "test-staff-token",
            // Custom domains: the Cloudflare API is stubbed in test/domains.test.ts.
            CLOUDFLARE_API_TOKEN: "test-cf-token",
            CLOUDFLARE_ZONE_ID: "zone-test",
          },
        },
      }),
    ],
    test: { include: ["test/**/*.test.ts"], setupFiles: ["./test/setup.ts"] },
  };
});
