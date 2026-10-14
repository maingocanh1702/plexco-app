import { defineConfig, devices } from "@playwright/test";

/**
 * Browser E2E for the signed-out surface, PWA assets, accessibility and the host session
 * screens. The server is a real production build (`next build && next start`), because the
 * service worker only registers in production.
 *
 * DATABASE_URL points at e2e/support/fake-postgres.mjs, a wire-protocol stub that answers ONLY the
 * session lookup (for the one cookie token the session specs set) and rejects every other
 * statement. With no cookie `currentSession()` returns before `appDb()` is called, so signed-out
 * specs still prove their paths never need a database: any query from them would fail loudly.
 * Workspace specs mock every /api call in the browser (page.route); nothing real is persisted.
 */
const PORT = Number(process.env.E2E_PORT ?? 3217);
// CI builds in its own step (clearer logs) and sets E2E_SKIP_BUILD=1 so only `next start` runs here.
const START = `pnpm exec next start -p ${PORT}`;
const PG_PORT = Number(process.env.E2E_PG_PORT ?? 3218);

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
  webServer: [
    {
      command: "node e2e/support/fake-postgres.mjs",
      port: PG_PORT,
      timeout: 30_000,
      reuseExistingServer: !process.env.CI,
      env: { E2E_PG_PORT: String(PG_PORT) },
    },
    {
      command: process.env.E2E_SKIP_BUILD ? START : `pnpm run build && ${START}`,
      url: `http://127.0.0.1:${PORT}/healthz`,
      timeout: 300_000,
      reuseExistingServer: !process.env.CI,
      env: {
        DATABASE_URL: `postgres://app:unused@127.0.0.1:${PG_PORT}/e2e`,
        LOG_LEVEL: "error",
      },
    },
  ],
});
