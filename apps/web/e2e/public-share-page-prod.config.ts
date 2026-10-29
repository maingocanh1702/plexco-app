import { defineConfig, devices } from "@playwright/test";
import * as timeouts from "./support/golden-path-timeouts";

// LOCAL-ONLY, never run in CI: its one caller is phase 2 of public-share-page-proof.sh, which builds
// apps/web and sets SHARE_PROOF_BASE_URL; only then is ONE `next start` server (the default role,
// NODE_ENV production) started in apps/web on 127.0.0.1:3000. Tracing is off: the run carries phase
// 1's session token in the logout's Cookie header, and a recording keeps every request header.

export default defineConfig({
  testDir: ".",
  testMatch: "public-share-page-prod.proof.ts",
  timeout: timeouts.TEST_TIMEOUT_MS,
  expect: { timeout: timeouts.COMPILE_TIMEOUT_MS },
  use: {
    trace: "off",
    actionTimeout: timeouts.ACTION_TIMEOUT_MS,
    navigationTimeout: timeouts.COMPILE_TIMEOUT_MS,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.SHARE_PROOF_BASE_URL
    ? {
        command: "pnpm exec next start -H 127.0.0.1 -p 3000",
        url: "http://127.0.0.1:3000/healthz",
        cwd: "..",
        timeout: 120_000,
        reuseExistingServer: false,
      }
    : undefined,
});
