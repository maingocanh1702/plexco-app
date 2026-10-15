import { expect, test, type Request } from "@playwright/test";

/**
 * OPT-IN, LOCAL ONLY: a real Chromium signs in through dev-login on `next dev`. It cannot run in CI
 * (e2e-web serves the production build, where dev-login does not exist, with no database), so it is
 * skipped unless DEV_LOGIN_E2E_BASE_URL names a running dev server with the gate open:
 *   1. a local database, migrated, opted in by a superuser (or a role granted SET ON PARAMETER
 *      plexco.dev_login): ALTER DATABASE <db> SET plexco.dev_login = 'on'; and seeded (`pnpm dev:seed`);
 *   2. PLEXCO_DEV_LOGIN=1 TRUSTED_INGRESS_PROVIDER=direct DB_EXPECTED_ROLE=app KMS_PROVIDER=local
 *      DATABASE_URL=<app-role URL> ENCRYPTION_KEY=<seed key> next dev -H 127.0.0.1 -p 3311
 *   3. DEV_LOGIN_E2E_BASE_URL=http://localhost:3311 \
 *        pnpm --filter @plexco/web exec playwright test --config e2e/dev-login-browser.config.ts
 *      (its own config: the main one boots `next start`, and `next dev` shares the .next directory).
 * What it proves that no unit test can: the browser itself sends a real Origin (never "null") on
 * the form POST and on its 307 re-send, so sameOriginRequest() accepts the login.
 */
const BASE = process.env.DEV_LOGIN_E2E_BASE_URL;
test.skip(!BASE, "opt-in: set DEV_LOGIN_E2E_BASE_URL to a dev server with dev-login enabled");
test.use({ baseURL: BASE });

async function originsOf(posts: Request[]): Promise<string[]> {
  return Promise.all(
    posts.map(
      async (post) =>
        `${new URL(post.url()).pathname} ${(await post.allHeaders())["origin"] ?? "(no origin)"}`,
    ),
  );
}

test("a persona button signs the browser in as that persona: owner, then player", async ({
  page,
}) => {
  const posts: Request[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    const devLoginPost = path === "/api/dev/login" || path === "/internal-dev-login/session";
    if (request.method() === "POST" && devLoginPost) posts.push(request);
  });

  await page.goto("/dev-login");
  await expect(page.getByRole("note")).toContainText("CHỈ DÀNH CHO DEV");
  await page.getByRole("button", { name: /Chủ CLB/ }).click();
  // `/` routes a signed-in owner of exactly one club straight into it.
  await page.waitForURL(/\/c\/[0-9a-f-]{36}/);
  const owner = await (await page.request.get("/api/auth/session")).json();
  expect(owner.data.tenants).toEqual([
    expect.objectContaining({ name: "Dev Club", role: "owner" }),
  ]);

  const origin = new URL(page.url()).origin;
  expect(await originsOf(posts)).toEqual([
    `/api/dev/login ${origin}`,
    `/internal-dev-login/session ${origin}`,
  ]);

  // Switching persona rotates the session; the player administers no club.
  posts.length = 0;
  await page.goto("/dev-login");
  await page.getByRole("button", { name: /Người chơi/ }).click();
  await page.waitForURL(/\/onboarding\/new-club/);
  const player = await (await page.request.get("/api/auth/session")).json();
  expect(player.data.tenants).toEqual([]);
  expect(player.data.personId).not.toBe(owner.data.personId);
  expect(await originsOf(posts)).toEqual([
    `/api/dev/login ${origin}`,
    `/internal-dev-login/session ${origin}`,
  ]);
});
