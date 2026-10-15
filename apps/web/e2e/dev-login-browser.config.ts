import { defineConfig, devices } from "@playwright/test";

/**
 * Config for the OPT-IN real-browser dev-login spec only (dev-login-browser.spec.ts). It starts no
 * web server: it drives an already running `next dev -H 127.0.0.1` with dev-login enabled, named by
 * DEV_LOGIN_E2E_BASE_URL. The main playwright.config.ts cannot be used for this because it always
 * boots `next start` on the production build, and `next dev` writes the same .next directory.
 *
 *   DEV_LOGIN_E2E_BASE_URL=http://localhost:3311 \
 *     pnpm --filter @plexco/web exec playwright test --config e2e/dev-login-browser.config.ts
 */
export default defineConfig({
  testDir: ".",
  testMatch: "dev-login-browser.spec.ts",
  timeout: 60_000,
  reporter: "list",
  use: { trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
