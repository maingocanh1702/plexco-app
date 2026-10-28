import { expect, test, type Page } from "@playwright/test";
import {
  addPlayer,
  confirmTransition,
  expectToast,
  localInput,
  payCash,
  rosterRow,
} from "./golden-path-helpers";

export async function runHostSessionMoneyPath(
  page: Page,
  { venue, address, alice, bob }: { venue: string; address: string; alice: string; bob: string },
  shot: (name: string) => Promise<void>,
): Promise<void> {
  let sessionUrl = "";

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
}
