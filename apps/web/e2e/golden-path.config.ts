import { defineConfig, devices } from "@playwright/test";
import {
  ACTION_TIMEOUT_MS,
  COMPILE_TIMEOUT_MS,
  TEST_TIMEOUT_MS,
} from "./support/golden-path-timeouts";

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
 * Environment (all documented in the runbook):
 *   GOLDEN_PATH_BASE_URL            required; the dev server's URL, port included (the spec skips without it)
 *   GOLDEN_PATH_SCREENSHOT_DIR      optional; saves one PNG per step
 *   GOLDEN_PATH_ALLOW_SEEDED_CLUB=1 optional; when the 3-clubs-per-hour limit refuses club creation, continue in
 *                                   the seeded Dev Club (a pass then does NOT prove club creation)
 */
export default defineConfig({
  testDir: ".",
  testMatch: "golden-path.spec.ts",
  // One long end-to-end flow against a real `next dev`: it compiles each route on first use and drops
  // idle ones after ~60 s. The budgets are generous on purpose (see support/golden-path-timeouts.ts).
  timeout: TEST_TIMEOUT_MS,
  // Must outlast one cold compile plus the API pacer's worst-case 60 s rate-limit hold.
  expect: { timeout: COMPILE_TIMEOUT_MS },
  reporter: "list",
  use: {
    trace: "retain-on-failure",
    actionTimeout: ACTION_TIMEOUT_MS,
    navigationTimeout: COMPILE_TIMEOUT_MS,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
