import { defineConfig, devices } from "@playwright/test";
import * as timeouts from "./support/golden-path-timeouts";

// LOCAL-ONLY, never run in CI: its one caller, public-share-page-proof.sh, sets SHARE_PROOF_BASE_URL, and only then
// are two `next dev` servers started in apps/web: the default role on 127.0.0.1:3000 and the discovery role on
// 127.0.0.1:3001 (the spec uses that URL). Followed for the role: it is env-only (middleware.ts:40 reads
// process.env.PROCESS_ROLE through parseProcessRole; package.json has no role script), so the second entry sets it
// and webServer.env merges over the inherited env, which keeps DISCOVERY_DATABASE_URL.
// ponytail: both servers share apps/web/.next (Next 15.5 has no dev lock); on a collision build once and `next start`.
const nextDev = (port: number, path: string) => ({
  command: `pnpm exec next dev -H 127.0.0.1 -p ${port}`,
  url: `http://127.0.0.1:${port}${path}`,
  cwd: "..",
  timeout: 240_000,
  reuseExistingServer: false,
});

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
    ? [
        nextDev(3000, "/dev-login"),
        { ...nextDev(3001, "/healthz"), env: { PROCESS_ROLE: "discovery" } },
      ]
    : undefined,
});
