import { expect, test } from "@playwright/test";
import {
  addPlayer,
  confirmTransition,
  expectToast,
  localInput,
  paceSessionApi,
  payCash,
  rosterRow,
  screenshotter,
} from "./support/golden-path-helpers";

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
 */
const BASE = process.env.GOLDEN_PATH_BASE_URL;
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

  await test.step("sign in as the host persona (dev-login)", async () => {
    await page.goto("/dev-login");
    await expect(page.getByRole("note")).toContainText("CHỈ DÀNH CHO DEV");
    await page.getByRole("button", { name: /Chủ CLB/ }).click();
    // The landing differs by run: the first run drops the owner straight into the one club, later
    // runs (the owner now holds several clubs) land on the club chooser. Both are signed in, so
    // assert the session itself rather than the URL.
    await expect
      .poll(async () => {
        const body = await (await page.request.get("/api/auth/session")).json();
        return (body?.data?.tenants ?? []).map((t: { role: string }) => t.role);
      })
      .toContain("owner");
    await shot("signed-in");
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
    // POST /api/onboarding/start allows 3 clubs per account per hour (tenant-create bucket). Runs
    // 4+ inside the hour are refused with the rate-limit copy; that refusal is asserted, then the
    // run continues in the seeded Dev Club so the money path is still exercised.
    const welcome = page.getByRole("heading", { name: "Chào mừng bạn!" });
    const throttled = page.getByText("Bạn thử quá nhiều lần. Vui lòng đợi một lát rồi thử lại.");
    await expect(welcome.or(throttled)).toBeVisible();
    if (await throttled.isVisible()) {
      test.info().annotations.push({
        type: "club-create-throttled",
        description: "tenant-create limit (3/hour/account) hit: continued in the seeded Dev Club",
      });
      await shot("new-club-throttled");
      const body = await (await page.request.get("/api/auth/session")).json();
      const dev = (body.data.tenants as { tenantId: string; name: string }[]).find(
        (tenant) => tenant.name === "Dev Club",
      );
      expect(dev, "the seeded Dev Club is in the owner's session").toBeTruthy();
      await page.goto(`/c/${dev!.tenantId}`);
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
});
