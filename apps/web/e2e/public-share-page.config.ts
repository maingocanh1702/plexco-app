import { defineConfig, devices } from "@playwright/test";
import * as timeouts from "./support/golden-path-timeouts";

// LOCAL-ONLY, never run in CI: its one caller, public-share-page-proof.sh, sets SHARE_PROOF_BASE_URL, and only then
// is ONE `next dev` server (the default role) started in apps/web on 127.0.0.1:3000. No discovery-role server: the
// first run (2026-10-26) with a second `next dev` on 3001 sharing apps/web/.next (Next 15.5 has no dev lock) failed
// at the dev-login (auth.dev_login.unhandled, a TypeError); a separate distDir needs next.config.mjs, outside the
// lane. The discovery role's allowlist entry is pinned by lib/request-policy.test.ts (RO-L39-1 item 3).

export default defineConfig({
  testDir: ".",
  testMatch: "public-share-page.proof.ts",
  timeout: timeouts.TEST_TIMEOUT_MS,
  expect: { timeout: timeouts.COMPILE_TIMEOUT_MS },
  use: {
    trace: "retain-on-failure",
    actionTimeout: timeouts.ACTION_TIMEOUT_MS,
    navigationTimeout: timeouts.COMPILE_TIMEOUT_MS,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.SHARE_PROOF_BASE_URL
    ? {
        command: "pnpm exec next dev -H 127.0.0.1 -p 3000",
        url: "http://127.0.0.1:3000/dev-login",
        cwd: "..",
        timeout: 240_000,
        reuseExistingServer: false,
      }
    : undefined,
});
