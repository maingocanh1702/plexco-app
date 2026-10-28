import { expect, test } from "@playwright/test";
import { setTimeout as sleep } from "node:timers/promises";
import { paceSessionApi } from "./support/golden-path-helpers";
import { runHostSessionMoneyPath } from "./support/golden-path-host-steps";
import { TEST_TIMEOUT_MS } from "./support/golden-path-timeouts";
import { signedInPersonId, stagingGoldenPathOrigin } from "./support/staging-golden-path-guard";

/**
 * OPT-IN staging golden path of the Web MVP, for the OWNER persona only, run by the owner with
 * staging-golden-path.config.ts (headed). It never runs in CI: the default playwright.config.ts
 * ignores this file. The owner signs in BY HAND through the real Google flow in the open browser
 * window; the test types no password and reads no browser credential. Then the run's club is created
 * through onboarding and the SAME host steps as the local golden path run
 * (support/golden-path-host-steps.ts): draft, publish, roster, refused close, partial cash, refused
 * cancel, pay, reversal, pay, close. Its only data is the club and the session it creates.
 *
 * The local player, co-admin chat and member chat tests do not run here: staging has no product path
 * that gives a test account a membership or a co-admin role (backlog task
 * p5-staging-golden-path-player-and-chat-tests).
 *
 * Club creation is limited to 3 per account per hour; a refusal FAILS the run, as there is no seeded
 * club to fall back on. Session API calls are paced as in the local run (support/golden-path-helpers.ts).
 */
const ORIGIN = stagingGoldenPathOrigin(process.env); // the config's guard, again (defence in depth)
const SIGN_IN_WAIT_MS = 10 * 60_000; // the owner's time to sign in by hand
const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const noShot = () => Promise.resolve(); // staging takes no screenshots

test("staging owner golden path: Google sign-in by hand -> club -> session -> collect -> close", async ({
  browser,
}) => {
  test.setTimeout(TEST_TIMEOUT_MS + SIGN_IN_WAIT_MS);
  const run = Date.now().toString(36);
  const clubName = `Smoke CLB ${run}`;
  const alice = `An ${run}`;
  const bob = `Binh ${run}`;
  const venue = `San Smoke ${run}`;
  const address = `12 Duong Smoke ${run}, Quan 1`;
  const context = await browser.newContext({ baseURL: ORIGIN });
  try {
    const page = await context.newPage();

    await test.step("sign in by hand as the owner persona (Google)", async () => {
      await page.goto("/");
      const authorize = page.waitForRequest((req) =>
        req.url().startsWith(`${GOOGLE_AUTHORIZE_URL}?`),
      );
      await page
        .getByRole("link", { name: "Tiếp tục với Google" })
        .or(page.getByRole("link", { name: "Continue with Google" }))
        .click();
      // Before the owner acts: Google must send the owner back to THIS host (the server's APP_BASE_URL).
      const redirectUri = new URL((await authorize).url()).searchParams.get("redirect_uri");
      expect(redirectUri && new URL(redirectUri).origin, "the Google redirect_uri origin").toBe(
        ORIGIN,
      );
      console.log(
        `STAGING GOLDEN PATH: sign in by hand as the OWNER persona (the owner's Google test account) in the open browser window; waiting up to ${SIGN_IN_WAIT_MS / 60_000} min`,
      );
      // Signed in = GET /api/auth/session answers 200 with a personId; the URL proves nothing.
      const deadline = Date.now() + SIGN_IN_WAIT_MS;
      for (;;) {
        const at = new URL(page.url());
        if (at.origin === ORIGIN && at.searchParams.has("auth_error")) {
          throw new Error(
            `Google sign-in failed: the app answered auth_error=${at.searchParams.get("auth_error")}`,
          );
        }
        if (await signedInPersonId(page.request)) break;
        if (Date.now() > deadline) {
          throw new Error(
            `Google sign-in not proven within ${SIGN_IN_WAIT_MS / 60_000} min: GET /api/auth/session ` +
              "never answered 200 with a personId",
          );
        }
        await sleep(2_000);
      }
    });

    await paceSessionApi(page, 43); // the local host test's room (42 paced calls + 1)

    await test.step("create the run's club through onboarding (no seeded club on staging)", async () => {
      await page.goto("/onboarding/new-club");
      await expect(page.getByRole("heading", { name: "Tạo câu lạc bộ" })).toBeVisible();
      await page.getByLabel("Tên câu lạc bộ").fill(clubName);
      await expect(page.getByLabel("Đường dẫn câu lạc bộ")).toHaveValue(
        `smoke-clb-${run}`.toLowerCase(),
      );
      await page.getByRole("button", { name: "Tạo câu lạc bộ" }).click();
      const welcome = page.getByRole("heading", { name: "Chào mừng bạn!" });
      const throttled = page.getByText("Bạn thử quá nhiều lần. Vui lòng đợi một lát rồi thử lại.");
      await expect(welcome.or(throttled)).toBeVisible();
      if (await throttled.isVisible()) {
        throw new Error(
          "Club creation was refused by the tenant-create limit (3 per account per hour), so the " +
            "staging golden path was NOT proven; there is no seeded club to fall back on. Wait for " +
            "the hour window to pass, then run it again.",
        );
      }
      await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}$/);
    });

    await runHostSessionMoneyPath(page, { venue, address, alice, bob }, noShot);
  } finally {
    await context.close();
  }
});
