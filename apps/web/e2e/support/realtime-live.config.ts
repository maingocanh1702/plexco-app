import { defineConfig, devices } from "@playwright/test";

/**
 * Config for the LOCAL-ONLY web live sync p95 (../realtime-live.spec.ts, readiness R-20). It starts
 * no web server: it drives the dev-login `next dev` named by REALTIME_LIVE_BASE_URL. Never in CI.
 */
export default defineConfig({
  testDir: "..",
  testMatch: "realtime-live.spec.ts",
  timeout: 300_000,
  expect: { timeout: 60_000 },
  reporter: [["list"]],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
