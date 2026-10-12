import { defineConfig, devices } from "@playwright/test";

/**
 * Browser E2E for the signed-out surface, PWA assets and accessibility. The server is a real
 * production build (`next build && next start`), because the service worker only registers in
 * production. DATABASE_URL points at an unreachable host on purpose: with no session cookie
 * `currentSession()` returns before `appDb()` is called, so these specs prove the signed-out
 * paths never need a database (a spec failing with ECONNREFUSED means that property regressed).
 */
const PORT = Number(process.env.E2E_PORT ?? 3217);
// CI builds in its own step (clearer logs) and sets E2E_SKIP_BUILD=1 so only `next start` runs here.
const START = `pnpm exec next start -p ${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: process.env.E2E_SKIP_BUILD ? START : `pnpm exec next build && ${START}`,
    url: `http://127.0.0.1:${PORT}/healthz`,
    timeout: 300_000,
    reuseExistingServer: !process.env.CI,
    env: {
      DATABASE_URL: "postgres://app:unused@127.0.0.1:1/none",
      LOG_LEVEL: "error",
    },
  },
});
