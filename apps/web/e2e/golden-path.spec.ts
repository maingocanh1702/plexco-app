import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { formatVnd } from "../lib/money";
import {
  addPlayer,
  confirmTransition,
  expectToast,
  localInput,
  paceSessionApi,
  payCash,
  rosterRow,
  screenshotter,
  signInAsPersona,
} from "./support/golden-path-helpers";
import {
  NOT_PROVEN_ANNOTATION,
  NOT_PROVEN_MESSAGE,
} from "./support/golden-path-not-proven-reporter";
import { COMPILE_TIMEOUT_MS } from "./support/golden-path-timeouts";
import { warmUpDevServer } from "./support/golden-path-warmup";

/**
 * OPT-IN, LOCAL ONLY golden path of the Web MVP: a host signs in with dev-login, creates a club
 * through onboarding, creates + publishes a session, collects money (partial, full, reversal) and
 * closes it. It never runs in CI (the default playwright.config.ts ignores this file; there is no
 * production build or database there) and it is skipped unless GOLDEN_PATH_BASE_URL names a running
 * `next dev -H 127.0.0.1` with dev-login enabled on a dedicated, migrated, seeded local database.
 * Setup and command: docs/runbooks/local-mvp-smoke.md.
 *
 * Re-runnable without cleanup: the club, its address and the player names carry a per-run suffix.
 * All assertions are on the real vi copy (the club's locale is vi).
 *
 * A PASS means the whole path ran, club creation included. Club creation is limited to 3 per
 * account per hour; when it is refused the spec FAILS by default. Only the explicit opt-in
 * GOLDEN_PATH_ALLOW_SEEDED_CLUB=1 continues in the seeded Dev Club and prints a loud line (the list
 * reporter shows stdout, not annotations) that club creation was NOT proven: once when it happens, and
 * again as the very last output, below the "1 passed" summary (support/golden-path-not-proven-reporter.ts).
 */
const BASE = process.env.GOLDEN_PATH_BASE_URL;
const ALLOW_SEEDED_CLUB = process.env.GOLDEN_PATH_ALLOW_SEEDED_CLUB === "1";
test.skip(!BASE, "opt-in: set GOLDEN_PATH_BASE_URL to a dev server with dev-login enabled");
test.use({ baseURL: BASE });

test("host golden path: club -> session -> publish -> collect (partial, reversal) -> close", async ({
  page,
}) => {
  const run = Date.now().toString(36);
  const clubName = `Smoke CLB ${run}`;
  const alice = `An ${run}`;
  const bob = `Binh ${run}`;
  const venue = `San Smoke ${run}`;
  const address = `12 Duong Smoke ${run}, Quan 1`;
  const shot = screenshotter(page);
  await paceSessionApi(page); // keep under the per-account API ceiling, also across back-to-back runs
  let sessionUrl = "";
  let devTenantId = "";

  await test.step("sign in as the host persona (dev-login)", async () => {
    await page.goto("/dev-login");
    await expect(page.getByRole("note")).toContainText("CHỈ DÀNH CHO DEV");
    await page.getByRole("button", { name: /Chủ CLB/ }).click();
    // The landing differs by run: the first run drops the owner straight into the one club, later
    // runs (the owner now holds several clubs) land on the club chooser. Both are signed in, so
    // assert the session itself rather than the URL.
    // The owner persona always holds the seeded Dev Club; that is read from the clubs' names (the
    // web never reads a role property, DD-56), not from a role field.
    await expect
      .poll(async () => {
        const res = await page.request.get("/api/auth/session", { timeout: COMPILE_TIMEOUT_MS });
        const body = await res.json();
        const tenants: { tenantId: string; name: string | null }[] = body?.data?.tenants ?? [];
        devTenantId = tenants.find((t) => t.name === "Dev Club")?.tenantId ?? "";
        return tenants.map((t) => t.name);
      })
      .toContain("Dev Club");
    // The post-login page first shows only a spinner while the session loads; the screenshot is of
    // the real page: the club chooser (several clubs) or the club home (the one club).
    await expect(
      page
        .getByRole("heading", { name: "Chọn câu lạc bộ" })
        .or(page.getByRole("heading", { name: "Chào mừng bạn!" })),
    ).toBeVisible();
    await shot("signed-in");
  });

  await test.step("warm up the dev server (compile every route the flow uses)", async () => {
    expect(devTenantId, "the seeded Dev Club's tenant id").toBeTruthy();
    await warmUpDevServer(page, devTenantId);
  });

  await test.step("create a club through onboarding", async () => {
    await page.goto("/onboarding/new-club");
    await expect(page.getByRole("heading", { name: "Tạo câu lạc bộ" })).toBeVisible();
    await page.getByLabel("Tên câu lạc bộ").fill(clubName);
    // the address (slug) is derived from the name as the host types
    await expect(page.getByLabel("Đường dẫn câu lạc bộ")).toHaveValue(
      `smoke-clb-${run}`.toLowerCase(),
    );
    await shot("new-club-filled");
    await page.getByRole("button", { name: "Tạo câu lạc bộ" }).click();
    // POST /api/onboarding/start allows 3 clubs per account per hour (tenant-create bucket); the 4th
    // is refused with the rate-limit copy. A refusal means club creation was NOT proven, so it fails
    // the run unless GOLDEN_PATH_ALLOW_SEEDED_CLUB=1 opts into the seeded Dev Club.
    const welcome = page.getByRole("heading", { name: "Chào mừng bạn!" });
    const throttled = page.getByText("Bạn thử quá nhiều lần. Vui lòng đợi một lát rồi thử lại.");
    await expect(welcome.or(throttled)).toBeVisible();
    if (await throttled.isVisible()) {
      await shot("new-club-throttled");
      if (!ALLOW_SEEDED_CLUB) {
        throw new Error(
          "Club creation was refused by the tenant-create limit (3 per account per hour), so the " +
            "full golden path was NOT proven. Wait for the hour window to pass, or use a fresh " +
            "scratch database (runbook steps 2-6), or set GOLDEN_PATH_ALLOW_SEEDED_CLUB=1 to " +
            "continue in the seeded Dev Club WITHOUT proving club creation.",
        );
      }
      console.log(NOT_PROVEN_MESSAGE);
      test.info().annotations.push({
        type: NOT_PROVEN_ANNOTATION,
        description: "tenant-create limit (3/hour/account) hit: continued in the seeded Dev Club",
      });
      expect(devTenantId, "the seeded Dev Club is in the owner's session").toBeTruthy();
      await page.goto(`/c/${devTenantId}`);
    }
    await expect(welcome).toBeVisible();
    await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}$/);
    await shot("club-home");
  });

  await test.step("create a draft session (venue name + address, price 100.000)", async () => {
    await page.getByRole("link", { name: "+ Tạo buổi mới" }).click();
    await expect(page.getByRole("heading", { name: "Tạo buổi chơi mới" })).toBeVisible();
    const sport = page.getByLabel("Môn thể thao");
    // the first real sport after the "— Chọn môn —" placeholder
    await expect(sport.locator("option")).not.toHaveCount(1);
    await sport.selectOption({ index: 1 });
    await page.getByLabel("Bắt đầu").fill(localInput(2, 18));
    await page.getByLabel("Kết thúc").fill(localInput(2, 20));
    await page.getByLabel("Tên sân / địa điểm").fill(venue);
    await page.getByLabel("Địa chỉ", { exact: true }).fill(address);
    await page.getByLabel("Giá mỗi người (VND)").fill("100000");
    await expect(page.getByLabel("Giá mỗi người (VND)")).toHaveValue("100.000");
    await shot("new-session-filled");
    await page.getByRole("button", { name: "Tạo bản nháp" }).click();
    await page.waitForURL(/\/sessions\/[0-9a-f-]{36}$/);
    sessionUrl = page.url();
    await expect(page.getByText("Nháp", { exact: true })).toBeVisible();
    await page.getByRole("tab", { name: "Chi tiết" }).click();
    const details = page.getByRole("tabpanel");
    await expect(details).toContainText(venue);
    await expect(details).toContainText(address);
    await expect(details).toContainText("100.000đ");
    await page.getByRole("tab", { name: "Người chơi" }).click();
    await shot("session-draft");
  });

  await test.step("publish the session", async () => {
    await page.getByRole("button", { name: "Đăng kèo", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Đăng kèo này?");
    await dialog.getByRole("button", { name: "Đăng kèo", exact: true }).click();
    await expectToast(page, "Đã đăng kèo.");
    await expect(page.getByText("Đang mở", { exact: true })).toBeVisible();
    await shot("session-open");
  });

  await test.step("add two players; each owes the full 100.000đ", async () => {
    await addPlayer(page, alice);
    await addPlayer(page, bob);
    for (const name of [alice, bob]) {
      await expect(rosterRow(page, name)).toContainText("Còn 100.000đ / 100.000đ");
      await expect(rosterRow(page, name)).toContainText("Chưa thanh toán");
    }
    await shot("roster-two-players");
  });

  await test.step("close is refused while players owe (CLOSE_BLOCKED_OPEN_DEBT)", async () => {
    const dialog = await confirmTransition(page, "close");
    const alert = dialog.getByRole("alert");
    await expect(alert).toContainText("Còn người chơi chưa trả đủ tiền");
    await expect(alert).toContainText("Người chơi còn thiếu tiền:");
    await expect(alert.getByRole("listitem").filter({ hasText: alice })).toBeVisible();
    await expect(alert.getByRole("listitem").filter({ hasText: bob })).toBeVisible();
    await shot("close-blocked-open-debt");
    await dialog.getByRole("button", { name: "Mở danh sách người chơi" }).click();
    await expect(dialog).toBeHidden();
  });

  await test.step("collect a PARTIAL cash payment (40.000đ) from the first player", async () => {
    expect(await payCash(page, alice, "40000")).toBe("40.000");
    await expect(rosterRow(page, alice)).toContainText("Còn 60.000đ / 100.000đ");
    await expect(rosterRow(page, alice)).toContainText("Trả một phần");
    await shot("alice-partly-paid");
  });

  await test.step("cancel is refused while money is recorded (CANCEL_REQUIRES_REVIEW)", async () => {
    const dialog = await confirmTransition(page, "cancel");
    const alert = dialog.getByRole("alert");
    await expect(alert).toContainText("Kèo này cần được xem xét trước khi huỷ.");
    await expect(alert).toContainText("Hoàn tác các khoản thanh toán đã ghi trước");
    await shot("cancel-requires-review");
    await dialog.getByRole("button", { name: "Mở danh sách người chơi" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("Đang mở", { exact: true })).toBeVisible();
  });

  await test.step("collect the rest from the first player and everything from the second", async () => {
    expect(await payCash(page, alice)).toBe("60.000"); // default = the remaining balance
    await expect(rosterRow(page, alice)).toContainText("Đã thanh toán");
    expect(await payCash(page, bob)).toBe("100.000");
    await expect(rosterRow(page, bob)).toContainText("Đã thanh toán");
    await shot("both-paid");
  });

  await test.step("reverse the 60.000đ payment: the balance is open again", async () => {
    const row = rosterRow(page, alice);
    await row.getByText(/Chi tiết thanh toán/).click();
    await row.getByRole("button", { name: `Hoàn tác khoản 60.000đ của ${alice}` }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Hoàn tác khoản thanh toán?");
    await dialog.getByLabel("Lý do (bắt buộc)").fill("Smoke: nhập nhầm");
    await dialog.getByRole("button", { name: "Hoàn tác", exact: true }).click();
    await expectToast(page, `Đã hoàn tác 60.000đ của ${alice}`);
    await expect(rosterRow(page, alice)).toContainText("Còn 60.000đ / 100.000đ");
    await expect(rosterRow(page, alice)).toContainText("Trả một phần");
    await shot("alice-reversed");
  });

  await test.step("pay the reopened balance again", async () => {
    expect(await payCash(page, alice)).toBe("60.000");
    await expect(rosterRow(page, alice)).toContainText("Đã thanh toán");
    await expect(rosterRow(page, bob)).toContainText("Đã thanh toán");
  });

  await test.step("close succeeds and the session shows as closed", async () => {
    await confirmTransition(page, "close");
    await expectToast(page, "Đã đóng buổi.");
    await expect(page.getByText("Đã đóng", { exact: true })).toBeVisible();
    await expect(page.getByText("Buổi này chỉ để xem.")).toBeVisible();
    await shot("session-closed");
    // a fresh load (server truth, not client state) still shows it closed
    await page.goto(sessionUrl);
    await expect(page.getByText("Đã đóng", { exact: true })).toBeVisible();
  });

  // The "NOT proven" line is repeated after the reporter summary by golden-path-not-proven-reporter.ts
  // (it keys off the annotation above); a console.log here would still print BEFORE "1 passed".
});

/**
 * Player golden path (L12, M9; readiness RC-4): the owner publishes an OPEN session in the seeded Dev
 * Club, the seeded player is seated through the merged member join route, and the player's own pages
 * show it: /me/sessions with its venue and /me/charges with the charge through formatVnd. Same opt-in,
 * same config and same local-only rule as the host test above. There is no leave step.
 *
 * The seat is a test-only call made by this test with the player's own cookie, CSRF token and one
 * commandId: no UI control, never the host roster add (a display name, never matched to a member,
 * DD-85), no projector row, no dispatch. The join route allows 10 joins per person per hour.
 * Re-runnable without cleanup: the venue carries a per-run suffix, and the charge is counted before
 * and after the join because earlier runs leave their own open 100.000đ charges on the seeded player.
 *
 * /discover is NOT run here and nothing below asserts anything about it: public_sessions has no app
 * write path and its projector row stays disabled locally (RC-0c). The mocked e2e (player.spec.ts)
 * covers discover -> join; runbook section 9 row 18 covers the empty page by hand.
 */
const PLAYER_LEG_NOT_RUN =
  "PLAYER GOLDEN PATH NOT RUN: the seeded player is not a Dev Club member (readiness O-5)";
const PAY_WORDS = /pay|thanh toán|trả ngay|chuyển khoản|qr|ngân hàng|bank/i;

test("player golden path: published session -> my sessions -> my charges", async ({ page }) => {
  const run = Date.now().toString(36);
  const venue = `San Nguoi Choi ${run}`;
  const price = formatVnd(100000);
  const shot = screenshotter(page);
  await paceSessionApi(page); // the owner's session API calls spend the per-account ceiling
  // Opens a /me page and returns its <main> once it left loading; an error or offline state fails here.
  const settled = async (path: string) => {
    await page.goto(path);
    const main = page.locator("main[data-state]");
    await expect(main).toHaveAttribute("data-state", /^(ready|empty|error|offline)$/);
    expect(await main.getAttribute("data-state"), `${path} settled`).toMatch(/^(ready|empty)$/);
    return main;
  };
  // The open 100.000đ charges listed under "Dev Club" on /me/charges (earlier runs leave their own).
  const devCharges = async () => {
    const main = await settled("/me/charges");
    const items = main
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Dev Club", exact: true }) })
      .getByRole("listitem")
      .filter({ hasText: price });
    return { main, items };
  };

  const published = await test.step("the owner publishes an open session in Dev Club", async () => {
    const owner = await signInAsPersona(page, /Chủ CLB/);
    const tenantId = owner.tenants.find((t) => t.name === "Dev Club")?.tenantId ?? "";
    expect(tenantId, "the seeded Dev Club's tenant id").toBeTruthy();
    await page.goto(`/c/${tenantId}/sessions/new`);
    await expect(page.getByRole("heading", { name: "Tạo buổi chơi mới" })).toBeVisible();
    const sport = page.getByLabel("Môn thể thao");
    // the first real sport after the "— Chọn môn —" placeholder
    await expect(sport.locator("option")).not.toHaveCount(1);
    await sport.selectOption({ index: 1 });
    await page.getByLabel("Bắt đầu").fill(localInput(2, 18));
    await page.getByLabel("Kết thúc").fill(localInput(2, 20));
    await page.getByLabel("Tên sân / địa điểm").fill(venue);
    await page.getByLabel("Địa chỉ", { exact: true }).fill(`34 Duong Smoke ${run}, Quan 3`);
    await page.getByLabel(/^Khu vực/).fill(`Khu Smoke ${run}`);
    await page.getByLabel("Giá mỗi người (VND)").fill("100000");
    await page.getByLabel(/^Cách tham gia/).selectOption("open");
    await page.getByRole("button", { name: "Tạo bản nháp" }).click();
    await page.waitForURL(/\/sessions\/[0-9a-f-]{36}$/);
    const sessionId = /\/sessions\/([0-9a-f-]{36})$/.exec(page.url())?.[1] ?? "";
    expect(sessionId, "the session id in the host URL").toBeTruthy();
    await page.getByRole("button", { name: "Đăng kèo", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Đăng kèo này?");
    await dialog.getByRole("button", { name: "Đăng kèo", exact: true }).click();
    await expectToast(page, "Đã đăng kèo.");
    await expect(page.getByText("Đang mở", { exact: true })).toBeVisible();
    await shot("player-leg-session-open");
    return { tenantId, sessionId };
  });

  const player =
    await test.step("sign in as the player; pre-check: a Dev Club member", async () => {
      const { csrfToken } = await signInAsPersona(page, /Người chơi/);
      const clubs = await settled("/me/clubs");
      const devClub = clubs
        .getByRole("listitem")
        .filter({ hasText: "Dev Club" })
        .filter({ hasText: "Thành viên" });
      return { csrfToken, isMember: (await devClub.count()) > 0 };
    });
  // Binary pre-check (readiness O-5): the seed is not edited here, the leg is reported NOT RUN instead.
  if (!player.isMember) console.log(PLAYER_LEG_NOT_RUN);
  test.skip(!player.isMember, PLAYER_LEG_NOT_RUN);

  const chargesBefore = await (await devCharges()).items.count();

  await test.step("seat the player through the member join route (test-only call)", async () => {
    const join = await page.request.post(
      `/api/sessions/${published.sessionId}/join?tenant=${published.tenantId}`,
      {
        headers: { "x-csrf-token": player.csrfToken },
        data: { commandId: randomUUID() },
        timeout: COMPILE_TIMEOUT_MS,
      },
    );
    const text = await join.text();
    expect(join.status(), text).toBe(200);
    expect(JSON.parse(text).data.join.outcome).toBe("active");
  });

  await test.step("my sessions: an active seat in the session, with its venue", async () => {
    const main = await settled("/me/sessions");
    expect(await main.getAttribute("data-state"), "the player has a session").toBe("ready");
    const row = main.getByRole("listitem").filter({ hasText: venue });
    await expect(row).toBeVisible();
    await expect(row).toContainText("Đã có chỗ");
    await expect(row).toContainText("Dev Club");
    await shot("player-my-sessions");
  });

  await test.step("my charges: one more open 100.000đ charge in Dev Club, no pay UI", async () => {
    const { main, items } = await devCharges();
    expect(await items.count(), `charges listing ${price} in Dev Club`).toBe(chargesBefore + 1);
    // No pay-now, QR or bank detail on a page that did render money.
    await expect(main.getByRole("button", { name: PAY_WORDS })).toHaveCount(0);
    await expect(main.getByRole("link", { name: PAY_WORDS })).toHaveCount(0);
    await expect(main.locator("img, canvas")).toHaveCount(0);
    await expect(main).not.toContainText(/qr|ngân hàng|bank|chuyển khoản/i);
    await shot("player-my-charges");
  });
});

test("chat golden path: two members chat live, the unread badge advances and clears", async ({
  page,
  browser,
}) => {
  const run = Date.now().toString(36);
  const textOne = `golden chat ${run} one`;
  const textTwo = `golden chat ${run} two`;
  const owner = await signInAsPersona(page, /Chủ CLB/);
  const tenantId = owner.tenants.find((t) => t.name === "Dev Club")?.tenantId ?? "";
  expect(tenantId, "the seeded Dev Club's tenant id").toBeTruthy();
  await page.goto(`/c/${tenantId}/chat`);
  const ownerLink = page.getByRole("link", { name: /^Kênh chung/ });
  await expect(ownerLink).toHaveAttribute("href", /^\/c\/[^/]+\/chat\/[^/]+$/);
  expect(await ownerLink.getAttribute("href")).toContain(`/c/${tenantId}/chat/`);
  const channelId = (await ownerLink.getAttribute("href"))?.split("/").pop();

  // /c/[tenantId] is the admin workspace: the two chatters are the owner and the co_admin.
  const coAdminContext = await browser.newContext({ baseURL: BASE });
  try {
    const coAdmin = await coAdminContext.newPage();
    await signInAsPersona(coAdmin, /Đồng quản trị/);
    await coAdmin.goto(`/c/${tenantId}/chat`);
    const coAdminLink = coAdmin.getByRole("link", { name: /^Kênh chung/ });
    await expect(coAdminLink).toBeVisible(); // the list left loading
    // Unread count from the badge text ("3 tin chưa đọc", "100+ tin chưa đọc"); no badge means 0.
    const unread = async () =>
      Number(/([0-9]+)[+]? *tin chưa đọc/.exec((await coAdminLink.textContent()) ?? "")?.[1] ?? 0);
    const before = await unread();
    expect(before, "under 100 unread").toBeLessThan(100); // a "100+" badge parses as 100
    // The co-admin's read-cursor POST; register it BEFORE the action that fires it.
    const readCursor = () =>
      coAdmin.waitForResponse(
        (r) =>
          r.request().method() === "POST" &&
          r.url().includes(`/api/chat/channels/${channelId}/read`),
      );
    const send = async (text: string) => {
      await page.getByRole("textbox", { name: "Tin nhắn", exact: true }).fill(text);
      await page.getByRole("button", { name: "Gửi", exact: true }).click();
    };

    await ownerLink.click();
    await send(textOne);
    // No reload: the SSE event refetches the co-admin's list and the badge advances by one.
    await expect.poll(unread, { timeout: 15_000 }).toBe(before + 1);

    // Opening the channel shows the message and moves the read cursor (200).
    const firstRead = readCursor();
    await coAdminLink.click();
    expect((await firstRead).status(), "read cursor after opening the channel").toBe(200);
    const messages = coAdmin.getByRole("log").getByRole("listitem");
    await expect(messages.filter({ hasText: textOne })).toBeVisible();

    // A live message shows up without a reload and advances the cursor again.
    const secondRead = readCursor();
    await send(textTwo);
    await expect(messages.filter({ hasText: textTwo })).toBeVisible({ timeout: 15_000 });
    expect((await secondRead).status(), "read cursor after a live message").toBe(200);

    // Back in the list the successful cursor calls have cleared the badge.
    await coAdmin.getByRole("link", { name: "Quay lại" }).click();
    await expect.poll(unread, { timeout: 15_000 }).toBe(0);
  } finally {
    await coAdminContext.close();
  }
});

const MEMBER_CHAT_NOT_RUN =
  "MEMBER CHAT GOLDEN PATH NOT RUN: the seeded player is not a Dev Club member (L12 readiness O-5)";

test("member chat golden path: member and admin chat live", async ({ page, browser }) => {
  const run = Date.now().toString(36);
  const [fromMember, fromAdmin] = [`golden member ${run} one`, `golden member ${run} two`];
  const owner = await signInAsPersona(page, /Chủ CLB/);
  const tenantId = owner.tenants.find((t) => t.name === "Dev Club")?.tenantId ?? "";
  expect(tenantId, "the seeded Dev Club's tenant id").toBeTruthy();
  const memberContext = await browser.newContext({ baseURL: BASE });
  try {
    const member = await memberContext.newPage();
    await signInAsPersona(member, /Người chơi/);
    await member.goto("/me/clubs");
    const main = member.locator("main[data-state]");
    await expect(main).toHaveAttribute("data-state", /^(ready|empty|error|offline)$/);
    expect(await main.getAttribute("data-state"), "/me/clubs settled").toMatch(/^(ready|empty)$/);
    const club = member.getByRole("listitem").filter({ hasText: "Dev Club" });
    const devClub = club.filter({ hasText: "Thành viên" });
    const isMember = (await devClub.count()) > 0;
    // Binary pre-check as the player leg (L12 readiness O-5): no seed edit, the leg is NOT RUN.
    if (!isMember) console.log(MEMBER_CHAT_NOT_RUN);
    test.skip(!isMember, MEMBER_CHAT_NOT_RUN);

    // The member enters through the Chat entry on the club row, never through /c/ (admin workspace).
    await devClub.getByRole("link", { name: /^(Trò chuyện|Chat)$/ }).click();
    await expect(member).toHaveURL(/\/me\/clubs\/dev-club\/chat$/);
    const channel = (p: typeof page) => p.getByRole("link", { name: /^Kênh chung/ });
    await expect(channel(member)).toHaveAttribute("href", /^\/me\/clubs\/dev-club\/chat\/[^/]+$/);
    await channel(member).click();
    await page.goto(`/c/${tenantId}/chat`);
    let reads = 0; // the admin view's history GETs: the load and the stream-open refetch (as ME-4)
    page.on("response", (res) => {
      if (res.request().method() === "GET" && res.url().includes("/messages?")) reads += 1;
    });
    await channel(page).click();
    await expect.poll(() => reads, { timeout: 15_000 }).toBeGreaterThanOrEqual(2); // admin view live
    const log = (p: typeof page) => p.getByRole("log").getByRole("listitem");
    const send = async (p: typeof page, text: string) => {
      await p.getByRole("textbox", { name: "Tin nhắn", exact: true }).fill(text);
      await p.getByRole("button", { name: "Gửi", exact: true }).click();
    };
    await send(member, fromMember); // GP-M1: the member's message reaches the admin, no reload
    await expect(log(page).filter({ hasText: fromMember })).toBeVisible({ timeout: 15_000 });
    await send(page, fromAdmin); // GP-M2: and the admin's message reaches the member
    await expect(log(member).filter({ hasText: fromAdmin })).toBeVisible({ timeout: 15_000 });
  } finally {
    await memberContext.close();
  }
});
