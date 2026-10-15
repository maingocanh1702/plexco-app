import { defineConfig, devices } from "@playwright/test";

/**
 * Config for the OPT-IN, LOCAL-ONLY golden-path spec (golden-path.spec.ts). It starts no web server:
 * it drives an already running `next dev -H 127.0.0.1` with dev-login enabled, on a dedicated local
 * database, named by GOLDEN_PATH_BASE_URL. It never runs in CI: the default playwright.config.ts
 * lists it in `testIgnore`, and no workflow references it. docs/runbooks/local-mvp-smoke.md has the
 * full setup (database, migrations, role passwords, seed, server) and the command:
 *
 *   GOLDEN_PATH_BASE_URL=http://localhost:3000 \
 *     pnpm --filter @plexco/web exec playwright test --config e2e/golden-path.config.ts
 *
 * Optional: GOLDEN_PATH_SCREENSHOT_DIR=<dir> saves one PNG per step (off when unset).
 */
export default defineConfig({
  testDir: ".",
  testMatch: "golden-path.spec.ts",
  // one long end-to-end flow against a real dev server (first-compile of each route is slow)
  timeout: 240_000,
  // 75 s: the spec's API pacer (support/golden-path-helpers.ts) may hold one request up to a full
  // 60 s rate-limit window, and the assertion waiting on that request must outlast it.
  expect: { timeout: 75_000 },
  reporter: "list",
  use: { trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
