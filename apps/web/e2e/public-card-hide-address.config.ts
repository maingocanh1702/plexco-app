import { defineConfig, devices } from "@playwright/test";
import {
  ACTION_TIMEOUT_MS,
  COMPILE_TIMEOUT_MS,
  TEST_TIMEOUT_MS,
} from "./support/golden-path-timeouts";

/**
 * LOCAL-ONLY config for the public card proof (public-card-hide-address.spec.ts), never run in CI: the
 * default playwright.config.ts lists the spec in `testIgnore`, and no workflow names this file. Its one
 * caller, apps/web/e2e/public-card-hide-address-proof.sh, sets PUBLIC_CARD_PROOF_BASE_URL; only then does
 * this config start `next dev -H 127.0.0.1 -p 3000` in apps/web, inheriting the runner's env (no NODE_ENV).
 */
export default defineConfig({
  testDir: ".",
  testMatch: "public-card-hide-address.spec.ts",
  timeout: TEST_TIMEOUT_MS,
  expect: { timeout: COMPILE_TIMEOUT_MS },
  reporter: "list",
  use: {
    trace: "retain-on-failure",
    actionTimeout: ACTION_TIMEOUT_MS,
    navigationTimeout: COMPILE_TIMEOUT_MS,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.PUBLIC_CARD_PROOF_BASE_URL
    ? {
        command: "pnpm exec next dev -H 127.0.0.1 -p 3000",
        cwd: "..",
        url: "http://127.0.0.1:3000/dev-login",
        timeout: 240_000,
        reuseExistingServer: false,
        stdout: "pipe",
        stderr: "pipe",
      }
    : undefined,
});
