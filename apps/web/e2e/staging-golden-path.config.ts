import { defineConfig, devices } from "@playwright/test";
import { ACTION_TIMEOUT_MS, COMPILE_TIMEOUT_MS } from "./support/golden-path-timeouts";
import { stagingGoldenPathOrigin } from "./support/staging-golden-path-guard";

/**
 * Config for the OPT-IN staging golden path (staging-golden-path.spec.ts): the owner persona signs in
 * by hand through the real Google flow in a headed browser, against the staging deployment only. It
 * never runs in CI: the default playwright.config.ts lists the spec in `testIgnore`, and no workflow
 * references this file. The guard runs HERE, at module load, before any browser starts: a missing
 * opt-in or a host that is not staging stops the run with its refusal. Nothing is kept: every
 * recording option below is off, and the test's output dir is removed when the test ends. Owner's
 * command (staging section of docs/runbooks/local-mvp-smoke.md):
 *
 *   STAGING_GOLDEN_PATH=1 STAGING_BASE_URL=https://staging.plexco.app \
 *     pnpm --filter @plexco/web exec playwright test --config e2e/staging-golden-path.config.ts
 */
const ORIGIN = stagingGoldenPathOrigin(process.env);

export default defineConfig({
  testDir: ".",
  testMatch: "staging-golden-path.spec.ts",
  // a second attempt would sign in again and create a second club against the 3-per-hour limit
  retries: 0,
  workers: 1,
  // the pacer's worst-case 60 s hold, as in golden-path.config.ts (staging compiles nothing)
  expect: { timeout: COMPILE_TIMEOUT_MS },
  reporter: "list",
  preserveOutput: "never",
  use: {
    baseURL: ORIGIN,
    headless: false,
    trace: "off",
    screenshot: "off",
    video: "off",
    actionTimeout: ACTION_TIMEOUT_MS,
    navigationTimeout: COMPILE_TIMEOUT_MS,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
