import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  ROSTER_PLAYERS,
  TENANT_ID,
  installApiMock,
  makeSession,
  signIn,
  type ApiMock,
} from "./support/session-api-mock";

/**
 * Host session workspace (lane M2b). The browser is the only subject: /api/* is mocked with
 * page.route and the server's single DB lookup is answered by e2e/support/fake-postgres.mjs, so
 * these run with no database and are deterministic.
 */
const DAY = 86_400_000;
const BASE = `/c/${TENANT_ID}/sessions`;

const upcoming = makeSession({ id: "s-open", status: "open", version: 3, players: ROSTER_PLAYERS });
const draft = makeSession({
  id: "s-draft",
  status: "draft",
  version: 2,
  startsAt: new Date(Date.now() + 5 * DAY).toISOString(),
  endsAt: new Date(Date.now() + 5 * DAY + 2 * 3_600_000).toISOString(),
});
const closed = makeSession({
  id: "s-closed",
  status: "closed",
  startsAt: new Date(Date.now() - 4 * DAY).toISOString(),
  endsAt: new Date(Date.now() - 4 * DAY + 2 * 3_600_000).toISOString(),
});
const cancelled = makeSession({
  id: "s-cancelled",
  status: "cancelled",
  venueName: "Sân đã huỷ",
  startsAt: new Date(Date.now() - 2 * DAY).toISOString(),
  endsAt: new Date(Date.now() - 2 * DAY + 2 * 3_600_000).toISOString(),
});
const pastOpen = makeSession({
  id: "s-past-open",
  status: "open",
  venueName: "Sân quá khứ",
  startsAt: new Date(Date.now() - 1 * DAY).toISOString(),
  endsAt: new Date(Date.now() - 1 * DAY + 2 * 3_600_000).toISOString(),
});
const fixtures = () => [upcoming, draft, closed, cancelled, pastOpen];

test.beforeEach(async ({ context }) => {
  await signIn(context);
});

const card = (page: Page, id: string) => page.locator(`a[href$="/sessions/${id}"]`);

async function open(page: Page, path: string, sessions = fixtures(), locale: "vi" | "en" = "vi") {
  const mock = await installApiMock(page, sessions, { locale });
  await page.goto(`${BASE}${path}`);
  return mock;
}

// A <dialog> opened with showModal() lives in the top layer: documentElement.scrollWidth never
// counts it, so the fit is measured on the dialog element itself.
async function expectDialogFits(page: Page) {
  const dialog = page.getByRole("dialog");
  const fit = await dialog.evaluate((d) => {
    const box = d.getBoundingClientRect();
    const rights = Array.from(d.querySelectorAll("li")).map(
      (li) => li.getBoundingClientRect().right,
    );
    return {
      top: box.top,
      bottom: box.bottom,
      left: box.left,
      right: box.right,
      vw: document.documentElement.clientWidth,
      vh: window.innerHeight,
      noXOverflow: d.scrollWidth <= d.clientWidth,
      maxItemRight: rights.length ? Math.max(...rights) : 0,
    };
  });
  expect(fit.noXOverflow, "dialog scrollWidth <= clientWidth").toBe(true);
  expect(fit.left).toBeGreaterThanOrEqual(0);
  expect(fit.right).toBeLessThanOrEqual(fit.vw + 0.5);
  expect(fit.top, "dialog top inside the viewport").toBeGreaterThanOrEqual(0);
  expect(fit.bottom, "dialog bottom inside the viewport").toBeLessThanOrEqual(fit.vh + 0.5);
  expect(fit.maxItemRight, "no name runs past the dialog").toBeLessThanOrEqual(fit.right + 0.5);
}

test.describe("list", () => {
  test("shows a loading skeleton, then cards with sport, venue, price and active/slots", async ({
    page,
  }) => {
    const mock = await installApiMock(page, fixtures());
    mock.listDelayMs = 500;
    await page.goto(BASE);
    await expect(page.locator('[aria-busy="true"]')).toBeVisible();
    const cardEl = card(page, "s-open");
    await expect(cardEl).toBeVisible();
    await expect(cardEl).toContainText("Cầu lông");
    await expect(cardEl).toContainText("50.000\u0111"); // DD-128 OD-4b: dots, direct lowercase d-stroke
    await expect(cardEl).toContainText("2/12 chỗ"); // 2 active players of 12
    await expect(cardEl).toContainText("Đang mở");
  });

  test("tabs: Sắp tới hides past open sessions; Nháp lists drafts; Đã đóng merges closed + cancelled", async ({
    page,
  }) => {
    await open(page, "");
    const items = page.locator("main ul li");
    const tabs = page.getByRole("group", { name: "Lọc buổi chơi" });
    await expect(tabs.getByRole("button", { name: "Tất cả" })).toHaveAttribute(
      "aria-current",
      "true",
    );

    await tabs.getByRole("button", { name: "Sắp tới" }).click();
    // Open filter is server-side; "upcoming" additionally drops the open session that already started.
    await expect(items).toHaveCount(1);
    await expect(card(page, "s-open")).toBeVisible();
    await expect(page.getByText("Sân quá khứ")).toHaveCount(0);

    await tabs.getByRole("button", { name: "Nháp" }).click();
    await expect(items).toHaveCount(1);
    await expect(card(page, "s-draft")).toBeVisible();

    await tabs.getByRole("button", { name: "Đã đóng" }).click();
    await expect(items).toHaveCount(2);
    await expect(card(page, "s-closed")).toBeVisible();
    await expect(card(page, "s-cancelled")).toBeVisible();
    // newest first across the two merged status streams
    await expect(items.first()).toContainText("Sân đã huỷ");
  });

  test("empty state offers a create CTA", async ({ page }) => {
    await open(page, "", []);
    await expect(page.getByRole("heading", { name: "Chưa có buổi chơi nào" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Tạo buổi mới", exact: true })).toHaveAttribute(
      "href",
      `${BASE}/new`,
    );
  });

  test("error state (non-envelope 502) fails closed with a generic message and retry recovers", async ({
    page,
  }) => {
    let fail = true;
    await installApiMock(page, fixtures());
    await page.route(/\/api\/sessions\?/, (route) => {
      if (!fail) return route.fallback();
      return route.fulfill({ status: 502, contentType: "text/html", body: "<h1>Bad gateway</h1>" });
    });
    await page.goto(BASE);
    const alert = page.locator("main").getByRole("alert");
    await expect(alert).toContainText("Đã có lỗi không mong muốn");
    await expect(alert).not.toContainText("Bad gateway");
    fail = false;
    await alert.getByRole("button", { name: "Thử lại" }).click();
    await expect(card(page, "s-open")).toBeVisible();
  });

  test("load more pages with the cursor", async ({ page }) => {
    const many = Array.from({ length: 25 }, (_, i) =>
      makeSession({
        id: `m-${i}`,
        venueName: `Sân ${i}`,
        startsAt: new Date(Date.now() + (i + 1) * DAY).toISOString(),
        endsAt: new Date(Date.now() + (i + 1) * DAY + 3_600_000).toISOString(),
      }),
    );
    await open(page, "", many);
    await expect(page.locator("main ul li")).toHaveCount(20);
    await page.getByRole("button", { name: "Tải thêm" }).click();
    await expect(page.locator("main ul li")).toHaveCount(25);
    await expect(page.getByRole("button", { name: "Tải thêm" })).toHaveCount(0);
  });

  test("switching tabs while load-more is in flight never shows the old tab's rows", async ({
    page,
  }) => {
    const many = Array.from({ length: 25 }, (_, i) =>
      makeSession({
        id: `r-${i}`,
        venueName: `Sân ${i}`,
        startsAt: new Date(Date.now() + (i + 1) * DAY).toISOString(),
        endsAt: new Date(Date.now() + (i + 1) * DAY + 3_600_000).toISOString(),
      }),
    );
    const mock = await open(page, "", [...many, draft]);
    await expect(page.locator("main ul li")).toHaveCount(20);
    mock.moreDelayMs = 800;
    await page.getByRole("button", { name: "Tải thêm" }).click();
    await page
      .getByRole("group", { name: "Lọc buổi chơi" })
      .getByRole("button", { name: "Nháp" })
      .click();
    await expect(card(page, "s-draft")).toBeVisible();
    await page.waitForTimeout(1200); // let the stale page resolve
    await expect(page.locator("main ul li")).toHaveCount(1);
    await expect(card(page, "r-0")).toHaveCount(0);
  });

  test("offline: last loaded snapshot with a banner; sign-out wipes it", async ({ page }) => {
    const mock = await open(page, "");
    await expect(card(page, "s-open")).toBeVisible();
    mock.failNext("list", "network");
    await page.reload();
    await expect(page.getByRole("status").filter({ hasText: "offline" })).toContainText(
      "dữ liệu đã lưu",
    );
    await expect(card(page, "s-open")).toBeVisible();
    const keys = await page.evaluate(() =>
      Object.keys(localStorage).filter((k) => k.startsWith("plx-snap:")),
    );
    expect(keys.length).toBeGreaterThan(0);
  });

  test("offline with no snapshot shows an error with retry (never blank)", async ({ page }) => {
    const mock = await installApiMock(page, fixtures());
    mock.failNext("list", "network");
    await page.goto(BASE);
    await expect(page.locator("main").getByRole("alert")).toContainText("Không có kết nối mạng");
    await page.locator("main").getByRole("alert").getByRole("button", { name: "Thử lại" }).click();
    await expect(card(page, "s-open")).toBeVisible();
  });

  const snapshotKeys = (page: Page) =>
    page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("plx-snap:")));

  test("AUTH_REQUIRED from the API sends the host to the landing page and wipes snapshots", async ({
    page,
    context,
  }) => {
    const mock = await installApiMock(page, fixtures());
    await page.goto(BASE);
    await expect(card(page, "s-open")).toBeVisible();
    expect(await snapshotKeys(page)).not.toEqual([]);
    mock.failNext("list", { code: "AUTH_REQUIRED", message: "Chưa đăng nhập.", statusCode: 401 });
    await context.clearCookies(); // a real 401 means the cookie is gone; keeps "/" signed-out
    await page
      .getByRole("group", { name: "Lọc buổi chơi" })
      .getByRole("button", { name: "Nháp" })
      .click();
    await expect(page).toHaveURL(/\/$/);
    expect(await snapshotKeys(page)).toEqual([]);
  });

  test("an expired cookie (server redirect to the landing page) also wipes snapshots", async ({
    page,
    context,
  }) => {
    await installApiMock(page, fixtures());
    await page.goto(BASE);
    await expect(card(page, "s-open")).toBeVisible();
    await context.clearCookies();
    await page.reload();
    await expect(page).toHaveURL(/\/$/);
    await expect.poll(() => snapshotKeys(page)).toEqual([]);
  });
});

test.describe("create", () => {
  async function fillValid(page: Page) {
    await page.getByLabel("Môn thể thao").selectOption({ label: "Cầu lông" });
    await page.getByLabel("Bắt đầu").fill("2030-10-20T18:30");
    await page.getByLabel("Kết thúc").fill("2030-10-20T20:00");
    await page.getByLabel("Tên sân / địa điểm").fill("Sân A");
    await page.getByLabel("Giá mỗi người (VND)").fill("75000");
  }

  test("validates client-side: end before start, public needs area + finite slots", async ({
    page,
  }) => {
    await open(page, "/new");
    await fillValid(page);
    await page.getByLabel("Kết thúc").fill("2030-10-20T18:00");
    await page.getByRole("button", { name: "Tạo bản nháp" }).click();
    const summary = page.locator("main").getByRole("alert");
    await expect(summary).toContainText("Thời gian kết thúc phải sau thời gian bắt đầu");
    await expect(page.getByLabel("Kết thúc")).toHaveAttribute("aria-invalid", "true");

    await page.getByLabel("Kết thúc").fill("2030-10-20T20:00");
    await page.getByLabel("Hiển thị").selectOption("public");
    await page.getByRole("button", { name: "Tạo bản nháp" }).click();
    await expect(page.locator("main").getByRole("alert")).toContainText(
      "Kèo công khai cần có khu vực",
    );
    await expect(page.locator("main").getByRole("alert")).toContainText("số chỗ giới hạn");
  });

  test("submits ISO with the club's offset + one commandId, then opens the new draft's detail", async ({
    page,
  }) => {
    const mock = await open(page, "/new");
    await fillValid(page);
    await page.getByLabel("Địa chỉ").fill("1 Nguyễn Văn Linh");
    await page.getByRole("button", { name: "Tạo bản nháp" }).click();
    await expect(page).toHaveURL(new RegExp(`${BASE}/new-1$`));
    await expect(page.getByRole("heading", { level: 1, name: "Cầu lông" })).toBeVisible();
    await expect(page.getByText("Nháp", { exact: true })).toBeVisible();
    const [call] = mock.callsTo("POST", /^\/api\/sessions$/);
    expect(call!.query.get("tenant")).toBe(TENANT_ID);
    expect(call!.body).toMatchObject({
      startsAt: "2030-10-20T18:30:00+07:00",
      endsAt: "2030-10-20T20:00:00+07:00",
      timezone: "Asia/Ho_Chi_Minh",
      priceAmount: 75000,
      slotsMax: null,
      visibility: "private",
      venueName: "Sân A",
      venueAddress: "1 Nguyễn Văn Linh",
    });
    expect(String(call!.body!.commandId)).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("an uncertain failure (network) retries with the SAME commandId; a definite one does not", async ({
    page,
  }) => {
    const mock = await open(page, "/new");
    await fillValid(page);
    mock.failNext("create", "network");
    await page.getByRole("button", { name: "Tạo bản nháp" }).click();
    await expect(page.locator("main").getByRole("alert")).toContainText("Không có kết nối mạng");
    mock.failNext("create", {
      code: "SPORT_INACTIVE",
      message: "Môn thể thao không khả dụng.",
      statusCode: 400,
    });
    await page.locator("main").getByRole("alert").getByRole("button", { name: "Thử lại" }).click();
    await expect(page.locator("main").getByRole("alert").first()).toContainText(
      "Môn thể thao không khả dụng.",
    );
    await page.getByRole("button", { name: "Tạo bản nháp" }).click();
    await expect(page).toHaveURL(new RegExp(`${BASE}/new-1$`));
    const ids = mock.callsTo("POST", /^\/api\/sessions$/).map((c) => c.body!.commandId);
    expect(ids).toHaveLength(3);
    expect(ids[1]).toBe(ids[0]); // retry after network loss reuses the key
    expect(ids[2]).not.toBe(ids[1]); // after a definite 4xx the next attempt is a new command
  });
});

test.describe("detail", () => {
  test("open session: header, roster with charges, details tab, action bar", async ({ page }) => {
    await open(page, "/s-open");
    await expect(page.getByRole("heading", { level: 1, name: "Cầu lông" })).toBeVisible();
    await expect(page.getByText("Phiên bản 3")).toBeVisible();
    await expect(page.getByText("Lan Nguyễn")).toBeVisible();
    await expect(page.getByText("Đã thanh toán")).toBeVisible();
    await expect(page.getByText("Trả một phần")).toBeVisible();
    await expect(page.getByText("Chờ #1")).toBeVisible();
    await expect(page.getByText("Chỗ trống")).toBeVisible();
    // One capacity ratio: occupied (active players) over the cap, same numerator as the list card.
    await expect(page.getByText("Đã có chỗ")).toBeVisible();
    await expect(page.getByText("2/12", { exact: true })).toBeVisible();
    for (const name of ["Sửa", "Đóng buổi", "Huỷ buổi"]) {
      await expect(
        page.getByRole("link", { name }).or(page.getByRole("button", { name })),
      ).toBeVisible();
    }
    await expect(page.getByRole("button", { name: "Đăng kèo" })).toHaveCount(0);
    await page.getByRole("tab", { name: "Chi tiết" }).click();
    await expect(page.getByRole("tabpanel")).toContainText("Sân Phú Mỹ Hưng");
    await expect(page.getByRole("tabpanel")).toContainText("Asia/Ho_Chi_Minh");
  });

  test("tabs are keyboard operable (arrow keys)", async ({ page }) => {
    await open(page, "/s-open");
    await page.getByRole("tab", { name: "Người chơi" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "Chi tiết" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByRole("tab", { name: "Chi tiết" })).toBeFocused();
  });

  test("closed and cancelled sessions are view-only", async ({ page }) => {
    await open(page, "/s-closed");
    await expect(page.getByText("Buổi này chỉ để xem.")).toBeVisible();
    await expect(page.getByRole("button", { name: /Đăng kèo|Đóng buổi|Huỷ/ })).toHaveCount(0);
    await open(page, "/s-cancelled");
    await expect(page.getByText("Buổi này chỉ để xem.")).toBeVisible();
  });

  test("unknown session id: SESSION_NOT_FOUND renders a message with a way back", async ({
    page,
  }) => {
    await open(page, "/nope");
    await expect(page.locator("main").getByRole("alert")).toContainText(
      "Không tìm thấy buổi chơi này",
    );
    await expect(page.getByRole("link", { name: "Về danh sách" })).toBeVisible();
  });

  test("publish: confirm dialog, success refetches as Open, focus is sane", async ({ page }) => {
    const mock = await open(page, "/s-draft");
    const opener = page.getByRole("button", { name: "Đăng kèo" });
    await opener.click();
    const dialog = page.getByRole("dialog", { name: "Đăng kèo này?" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    await dialog.getByRole("button", { name: "Đăng kèo" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("Đã đăng kèo.")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
    await expect(page.getByText("Đang mở", { exact: true })).toBeVisible();
    const [call] = mock.callsTo("POST", /\/publish$/);
    expect(call!.body).toMatchObject({ expectedVersion: 2 });
    expect(call!.body).toHaveProperty("commandId");
  });

  test("Escape closes the dialog and returns focus to the opener; Back button too", async ({
    page,
  }) => {
    await open(page, "/s-draft");
    const opener = page.getByRole("button", { name: "Đăng kèo" });
    await opener.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(opener).toBeFocused();
    await opener.click();
    await page.getByRole("dialog").getByRole("button", { name: "Quay lại" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
  });

  test("a second Escape while the command is in flight cannot hide the busy dialog", async ({
    page,
  }) => {
    const mock = await open(page, "/s-draft");
    const release = mock.holdNext("publish");
    await page.getByRole("button", { name: "Đăng kèo" }).click();
    const dialog = page.getByRole("dialog", { name: "Đăng kèo này?" });
    await dialog.getByRole("button", { name: "Đăng kèo" }).click();
    await expect(dialog.getByRole("button", { name: "Đang xử lý…" })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    release();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("Đã đăng kèo.")).toBeVisible();
  });

  test("dialog traps focus: Tab cycles inside it", async ({ page }) => {
    await open(page, "/s-draft");
    await page.getByRole("button", { name: "Đăng kèo" }).click();
    const dialog = page.getByRole("dialog");
    for (let i = 0; i < 4; i += 1) {
      await page.keyboard.press("Tab");
      expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    }
  });

  test("STALE_VERSION: message + inline reload refetches the new version", async ({ page }) => {
    const mock = await open(page, "/s-draft");
    await expect(page.getByText("Phiên bản 2")).toBeVisible(); // page loaded at v2 before the "other editor" bumps it
    mock.state.find((s) => s.id === "s-draft")!.version = 9; // someone else edited it
    await page.getByRole("button", { name: "Đăng kèo" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Đăng kèo" }).click();
    const alert = page.getByRole("dialog").getByRole("alert");
    await expect(alert).toContainText("Kèo vừa được cập nhật");
    await alert.getByRole("button", { name: "Tải lại dữ liệu" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(page.getByText("Phiên bản 9")).toBeVisible();
  });

  test("SESSION_NOT_OPEN and CANCEL_REQUIRES_REVIEW show the server's catalog message", async ({
    page,
  }) => {
    const mock = await open(page, "/s-open");
    mock.failNext("close", {
      code: "SESSION_NOT_OPEN",
      message: "Kèo không ở trạng thái cho phép thao tác này.",
      statusCode: 409,
    });
    await page.getByRole("button", { name: "Đóng buổi" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Đóng buổi" }).click();
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
      "không ở trạng thái cho phép",
    );
    await page.keyboard.press("Escape");

    mock.failNext("cancel", {
      code: "CANCEL_REQUIRES_REVIEW",
      message: "Kèo này cần được xem xét trước khi huỷ.",
      statusCode: 400,
    });
    await page.getByRole("button", { name: "Huỷ buổi" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Huỷ buổi" }).click();
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText("cần được xem xét");
  });

  test.describe("close / cancel refusals (DD-131 OD-1)", () => {
    const DEBT = {
      code: "CLOSE_BLOCKED_OPEN_DEBT",
      message: "Còn người chơi chưa trả đủ tiền — thu đủ trước khi đóng kèo.",
      statusCode: 409,
      details: {
        // The BE sends ids + names only; these amount-like extras make the "no amount is shown"
        // assertions able to fail if the UI ever started rendering whatever the payload holds.
        openBalancePlayers: [
          { playerId: "p2", displayName: "Minh Trần", remaining: 150000, amount: "150.000đ" },
          { playerId: "p9", displayName: null, remaining: 90000, amount: "90.000đ" },
        ],
      },
    };
    // The BE's English text for CLOSE_BLOCKED_OPEN_DEBT, verbatim (session-command-route.ts).
    const DEBT_EN_MESSAGE =
      "Some players have not paid in full — collect their payments before closing the session.";
    // The status badge in the header: the visible state of the session (not the mock's own memory).
    const statusBadge = (page: Page, label: string) =>
      page.locator("main header").getByText(label, { exact: true });
    const confirmClose = async (page: Page) => {
      await page.getByRole("button", { name: "Đóng buổi" }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Đóng buổi" }).click();
    };

    test("CLOSE_BLOCKED_OPEN_DEBT: names the players, stays in place, the roster button works", async ({
      page,
    }) => {
      const mock = await open(page, "/s-open");
      await page.getByRole("tab", { name: "Chi tiết" }).click(); // prove the button brings Roster forward
      mock.failNext("close", DEBT);
      await confirmClose(page);
      const dialog = page.getByRole("dialog");
      const alert = dialog.getByRole("alert");
      await expect(alert).toContainText("Còn người chơi chưa trả đủ tiền");
      await expect(alert).toContainText("Người chơi còn thiếu tiền:");
      await expect(alert.getByRole("listitem")).toHaveText(["Minh Trần", "(chưa đặt tên)"]);
      await expect(alert).not.toContainText("p2"); // ids are never text
      // no amount is shown or invented, although the payload carries amount-like fields
      for (const amount of ["150", "90.000", "remaining"]) {
        await expect(alert).not.toContainText(amount);
      }
      await expect(alert.getByRole("button")).toHaveCount(1); // domain code: no reload / retry
      // stay in place: dialog open, command still available, the visible state is still Open
      await expect(dialog.getByRole("button", { name: "Đóng buổi" })).toBeEnabled();
      await expect(statusBadge(page, "Đang mở")).toBeVisible();
      expect(mock.callsTo("POST", /\/s-open\/close$/)).toHaveLength(1);

      await alert.getByRole("button", { name: "Mở danh sách người chơi" }).click();
      await expect(dialog).toBeHidden();
      await expect(page.getByRole("tab", { name: "Người chơi" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await expect(page.getByText("Minh Trần")).toBeVisible();
      // focus follows the request: the Roster tab, not the action-bar button that opened the dialog
      await expect(page.getByRole("tab", { name: "Người chơi" })).toBeFocused();
      await expect(statusBadge(page, "Đang mở")).toBeVisible();
      expect(mock.callsTo("POST", /\/s-open\/close$/)).toHaveLength(1); // nothing was re-sent
      await expect(page.getByText("Đã đóng buổi.")).toHaveCount(0);
      // and after a reload the refetched session is still Open (the refusal changed nothing)
      await page.reload();
      await expect(statusBadge(page, "Đang mở")).toBeVisible();
      await expect(statusBadge(page, "Đã đóng")).toHaveCount(0);
    });

    test("a missing, empty or malformed list shows the generic message only (fail closed)", async ({
      page,
    }) => {
      const mock = await open(page, "/s-open");
      const bad: unknown[] = [
        undefined,
        { openBalancePlayers: [] },
        { openBalancePlayers: [{ displayName: "no id" }] },
        { openBalancePlayers: "Minh" },
      ];
      for (const details of bad) {
        mock.failNext("close", { ...DEBT, details });
        await confirmClose(page);
        const alert = page.getByRole("dialog").getByRole("alert");
        await expect(alert).toContainText("Còn người chơi chưa trả đủ tiền");
        await expect(alert.getByRole("listitem")).toHaveCount(0);
        await expect(alert).not.toContainText("Người chơi còn thiếu tiền");
        await expect(alert.getByRole("button")).toHaveCount(0);
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog")).toBeHidden();
      }
      expect(mock.state.find((s) => s.id === "s-open")!.status).toBe("open");
    });

    test("CANCEL_REQUIRES_REVIEW: a generic hint (reverse payments, remove players), no claim which applies", async ({
      page,
    }) => {
      const mock = await open(page, "/s-open");
      mock.failNext("cancel", {
        code: "CANCEL_REQUIRES_REVIEW",
        message: "Kèo này cần được xem xét trước khi huỷ.",
        statusCode: 400,
      });
      await page.getByRole("button", { name: "Huỷ buổi" }).click();
      // The confirm body states the OD-1 remedy up front, without the stale "must be reviewed" copy.
      const dialog = page.getByRole("dialog");
      await expect(dialog).toContainText(
        "hãy hoàn tác các khoản thanh toán đó và gỡ người chơi trước khi huỷ",
      );
      await expect(dialog).not.toContainText("xem xét");
      await dialog.getByRole("button", { name: "Huỷ buổi" }).click();
      const alert = page.getByRole("dialog").getByRole("alert");
      await expect(alert).toContainText("Kèo này cần được xem xét trước khi huỷ.");
      // same order as REMOVE_REQUIRES_REVIEW: reverse the recorded payments first, then remove players
      await expect(alert).toContainText(
        "Hoàn tác các khoản thanh toán đã ghi trước, rồi gỡ từng người chơi khỏi danh sách",
      );
      await expect(alert.getByRole("listitem")).toHaveCount(0);
      await expect(statusBadge(page, "Đang mở")).toBeVisible();
      await alert.getByRole("button", { name: "Mở danh sách người chơi" }).click();
      await expect(page.getByRole("dialog")).toBeHidden();
      await expect(page.getByRole("tab", { name: "Người chơi" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await expect(page.getByRole("tab", { name: "Người chơi" })).toBeFocused();
      await expect(statusBadge(page, "Đang mở")).toBeVisible();
      await page.reload();
      await expect(statusBadge(page, "Đang mở")).toBeVisible();
    });

    test("CANCEL_REQUIRES_REVIEW on a DRAFT (anomaly): the server message only, no roster hint or button", async ({
      page,
    }) => {
      const mock = await open(page, "/s-draft");
      mock.failNext("cancel", {
        code: "CANCEL_REQUIRES_REVIEW",
        message: "Kèo này cần được xem xét trước khi huỷ.",
        statusCode: 400,
      });
      await page.getByRole("button", { name: "Huỷ nháp" }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Huỷ nháp" }).click();
      const alert = page.getByRole("dialog").getByRole("alert");
      await expect(alert).toContainText("Kèo này cần được xem xét trước khi huỷ.");
      // a draft's roster cannot be edited: pointing at it would be a dead end
      await expect(alert).not.toContainText("Hoàn tác");
      await expect(alert).not.toContainText("gỡ từng người chơi");
      await expect(alert.getByRole("button")).toHaveCount(0);
      await expect(statusBadge(page, "Nháp")).toBeVisible();
      await page.reload();
      await expect(statusBadge(page, "Nháp")).toBeVisible();
    });

    test("the cancel confirm body is status-aware: open states the OD-1 remedy, a draft only confirms the discard", async ({
      page,
    }) => {
      await open(page, "/s-open");
      await page.getByRole("button", { name: "Huỷ buổi" }).click();
      await expect(page.getByRole("dialog")).toContainText(
        "Buổi sẽ chuyển sang Đã huỷ và không thể hoàn tác. Nếu buổi còn người chơi đang tham gia hoặc khoản thanh toán đã ghi, hãy hoàn tác các khoản thanh toán đó và gỡ người chơi trước khi huỷ.",
      );

      // a draft cannot carry players or payments by design: its discard copy never mentions them
      await open(page, "/s-draft");
      await page.getByRole("button", { name: "Huỷ nháp" }).click();
      const draftDialog = page.getByRole("dialog");
      await expect(draftDialog.getByRole("heading", { name: "Huỷ bản nháp này?" })).toBeVisible();
      await expect(draftDialog).toContainText(
        "Bản nháp sẽ chuyển sang Đã huỷ và không thể hoàn tác.",
      );
      await expect(draftDialog).not.toContainText("người chơi");
      await expect(draftDialog).not.toContainText("thanh toán");

      await open(page, "/s-draft", fixtures(), "en");
      await page.getByRole("button", { name: "Discard draft" }).click();
      const draftDialogEn = page.getByRole("dialog");
      await expect(draftDialogEn).toContainText(
        "The draft becomes Cancelled and this cannot be undone.",
      );
      await expect(draftDialogEn).not.toContainText("players");
      await expect(draftDialogEn).not.toContainText("payments");
    });

    for (const viewport of [
      { width: 375, height: 667 },
      { width: 1280, height: 800 },
    ]) {
      test(`a long owing list scrolls inside the dialog: 31 names incl. a 120-char unbroken one, ${viewport.width}x${viewport.height}`, async ({
        page,
      }) => {
        await page.setViewportSize(viewport);
        const longName = "Nguyễn".repeat(20); // 120 characters, no space to break at
        expect(longName).toHaveLength(120);
        const names = [...Array.from({ length: 30 }, (_, i) => `Người chơi số ${i + 1}`), longName];
        const mock = await open(page, "/s-open");
        mock.failNext("close", {
          ...DEBT,
          details: {
            openBalancePlayers: names.map((displayName, i) => ({
              playerId: `p${i + 1}`,
              displayName,
            })),
          },
        });
        await confirmClose(page);
        const dialog = page.getByRole("dialog");
        const alert = dialog.getByRole("alert");
        await expect(alert.getByRole("listitem")).toHaveCount(31);
        // title, server message and the actions stay on screen; the whole dialog is inside the viewport
        await expect(dialog.getByRole("heading", { name: "Đóng buổi này?" })).toBeInViewport();
        await expect(alert.getByText("Còn người chơi chưa trả đủ tiền")).toBeInViewport();
        await expect(dialog.getByRole("button", { name: "Quay lại" })).toBeInViewport();
        await expectDialogFits(page);
        // the list is capped and scrolls on its own; the last (unbroken) name is reachable
        const list = alert.getByRole("list");
        const overflowing = await list.evaluate((el) => el.scrollHeight > el.clientHeight);
        expect(overflowing, "the list must scroll internally, not stretch the dialog").toBe(true);
        await list.evaluate((el) => el.scrollTo(0, el.scrollHeight));
        const last = alert.getByRole("listitem").last();
        await expect(last).toHaveText(longName);
        await expect(last).toBeInViewport();
        const inside = await last.evaluate((li) => {
          const ul = li.closest("ul")!.getBoundingClientRect();
          const box = li.getBoundingClientRect();
          return box.top >= ul.top - 1 && box.bottom <= ul.bottom + 1 && box.right <= ul.right + 1;
        });
        expect(inside, "the last name sits inside the list's own box").toBe(true);
        // A block <li> never grows past its <ul>, so the box checks above stay green even when the
        // unbroken name is merely clipped behind a horizontal scrollbar inside the list. scrollWidth
        // is what exposes that: neither the list nor any item may have content wider than its box.
        // Strict <= (no sub-pixel tolerance): scrollWidth/clientWidth are both integer-rounded.
        const horizontal = await list.evaluate((ul) => ({
          list: { scrollWidth: ul.scrollWidth, clientWidth: ul.clientWidth },
          items: Array.from(ul.querySelectorAll("li")).map((li) => ({
            scrollWidth: li.scrollWidth,
            clientWidth: li.clientWidth,
          })),
        }));
        expect(
          horizontal.list.scrollWidth,
          "the list has no horizontal scroll (overflow-wrap breaks the unbroken name)",
        ).toBeLessThanOrEqual(horizontal.list.clientWidth);
        expect(horizontal.items).toHaveLength(31);
        for (const item of horizontal.items) {
          expect(item.scrollWidth, "no item's content is wider than its box").toBeLessThanOrEqual(
            item.clientWidth,
          );
        }
        await expectDialogFits(page);
        await expect(dialog.getByRole("heading", { name: "Đóng buổi này?" })).toBeInViewport();
      });
    }

    test("English club: the refusal copy has an English twin", async ({ page }) => {
      const mock = await open(page, "/s-open", fixtures(), "en");
      mock.failNext("close", { ...DEBT, message: DEBT_EN_MESSAGE });
      await page.getByRole("button", { name: "Close", exact: true }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Close session" }).click();
      const alert = page.getByRole("dialog").getByRole("alert");
      await expect(alert).toContainText(DEBT_EN_MESSAGE);
      await expect(alert).toContainText("Players with an open balance:");
      await expect(alert.getByRole("button", { name: "Open the roster" })).toBeVisible();
      await expect(alert).not.toContainText("Người chơi");
    });

    for (const scheme of ["light", "dark"] as const) {
      for (const viewport of [
        { name: "375x812", width: 375, height: 812 },
        { name: "1280x800", width: 1280, height: 800 },
      ]) {
        test(`axe + layout: close refusal open, ${scheme} ${viewport.name}`, async ({ page }) => {
          await page.setViewportSize({ width: viewport.width, height: viewport.height });
          await page.emulateMedia({ colorScheme: scheme });
          const mock = await open(page, "/s-open");
          mock.failNext("close", DEBT);
          await confirmClose(page);
          const alert = page.getByRole("dialog").getByRole("alert");
          await expect(alert.getByRole("listitem")).toHaveCount(2);
          await expectDialogFits(page);
          const results = await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
            .analyze();
          expect(
            results.violations
              .filter((v) => v.impact === "serious" || v.impact === "critical")
              .map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
          ).toEqual([]);
        });
      }
    }
  });

  test("unknown error code fails closed: generic message + requestId, never raw server text", async ({
    page,
  }) => {
    const mock = await open(page, "/s-open");
    mock.failNext("close", {
      code: "BRAND_NEW_CODE",
      message: "internal stack detail",
      statusCode: 500,
    });
    await page.getByRole("button", { name: "Đóng buổi" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Đóng buổi" }).click();
    const alert = page.getByRole("dialog").getByRole("alert");
    await expect(alert).toContainText("Đã có lỗi không mong muốn");
    await expect(alert).toContainText("req-e2e-err");
    await expect(alert).not.toContainText("internal stack detail");
  });

  test("close and cancel succeed and flip the status", async ({ page }) => {
    await open(page, "/s-open");
    await page.getByRole("button", { name: "Đóng buổi" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Đóng buổi" }).click();
    await expect(page.getByText("Đã đóng buổi.")).toBeVisible();
    await expect(page.getByText("Buổi này chỉ để xem.")).toBeVisible();

    await open(page, "/s-draft");
    await page.getByRole("button", { name: "Huỷ nháp" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Huỷ nháp" }).click();
    await expect(page.getByText("Đã huỷ bản nháp.")).toBeVisible();
    await expect(page.getByText("Đã huỷ", { exact: true })).toBeVisible();
  });

  test("an open session that already started cannot be edited (mirrors the BE past-guard)", async ({
    page,
  }) => {
    await open(page, "/s-past-open");
    await expect(page.getByRole("button", { name: "Sửa" })).toBeDisabled();
    await expect(page.getByText("Buổi đã bắt đầu nên không sửa được nữa.")).toBeVisible();
  });

  test("past-start guards: open session cannot be cancelled (close stays), past draft cannot be published", async ({
    page,
  }) => {
    const pastDraft = makeSession({
      id: "s-past-draft",
      status: "draft",
      startsAt: new Date(Date.now() - DAY).toISOString(),
      endsAt: new Date(Date.now() - DAY + 2 * 3_600_000).toISOString(),
    });
    await open(page, "/s-past-open", [...fixtures(), pastDraft]);
    await expect(page.getByRole("button", { name: "Huỷ buổi" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Đóng buổi" })).toBeEnabled();
    await expect(page.getByText(/hãy đóng buổi/)).toBeVisible();
    await page.goto(`${BASE}/s-past-draft`);
    await expect(page.getByRole("button", { name: "Đăng kèo" })).toBeDisabled();
    await expect(page.getByText(/sửa giờ trước khi đăng/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Huỷ nháp" })).toBeEnabled();
  });
});

test.describe("edit", () => {
  test("prefills, explains open-session rules, and PUTs only changed fields with expectedVersion", async ({
    page,
  }) => {
    const mock = await open(page, "/s-open/edit");
    await expect(page.getByLabel("Giá mỗi người (VND)")).toHaveValue("50.000");
    await expect(page.getByLabel("Bắt đầu")).not.toHaveValue("");
    await expect(page.getByText("Buổi đang mở: bạn đổi được")).toBeVisible();
    await page.getByLabel("Địa chỉ").fill("1 Nguyễn Văn Linh");
    await page.getByRole("button", { name: "Lưu thay đổi" }).click();
    await expect(page).toHaveURL(new RegExp(`${BASE}/s-open$`));
    const [call] = mock.callsTo("PUT", /\/api\/sessions\/s-open$/);
    expect(call!.body).toMatchObject({ venueAddress: "1 Nguyễn Văn Linh", expectedVersion: 3 });
    expect(Object.keys(call!.body!).sort()).toEqual([
      "commandId",
      "expectedVersion",
      "venueAddress",
    ]);
  });

  test("no changes sends no command", async ({ page }) => {
    const mock = await open(page, "/s-draft/edit");
    await page.getByRole("button", { name: "Lưu thay đổi" }).click();
    await expect(page).toHaveURL(new RegExp(`${BASE}/s-draft$`));
    expect(mock.callsTo("PUT", /.*/)).toHaveLength(0);
  });

  test("capacity below roster is shown on the slots field", async ({ page }) => {
    const mock = await open(page, "/s-open/edit");
    await page.getByLabel("Số chỗ tối đa").fill("1");
    mock.failNext("update", {
      code: "CAPACITY_BELOW_ROSTER",
      message: "Sức chứa nhỏ hơn số người đã tham gia.",
      statusCode: 409,
    });
    await page.getByRole("button", { name: "Lưu thay đổi" }).click();
    await expect(page.getByLabel("Số chỗ tối đa")).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("main").getByRole("alert").first()).toContainText(
      "Sức chứa nhỏ hơn số người đã tham gia",
    );
  });

  test("STALE_VERSION on save offers a reload that re-prefills the form", async ({ page }) => {
    const mock = await open(page, "/s-open/edit");
    await expect(page.getByLabel("Giá mỗi người (VND)")).toHaveValue("50.000"); // loaded at v3
    mock.state.find((s) => s.id === "s-open")!.version = 7;
    await page.getByLabel("Địa chỉ").fill("Somewhere");
    await page.getByRole("button", { name: "Lưu thay đổi" }).click();
    await expect(page.locator("main").getByRole("alert").first()).toContainText(
      "Kèo vừa được cập nhật",
    );
    await page.getByRole("button", { name: "Tải lại dữ liệu" }).click();
    await expect(page.getByLabel("Địa chỉ")).toHaveValue("");
    await page.getByLabel("Địa chỉ").fill("Somewhere");
    await page.getByRole("button", { name: "Lưu thay đổi" }).click();
    await expect(page).toHaveURL(new RegExp(`${BASE}/s-open$`));
  });

  test("closed sessions cannot be edited", async ({ page }) => {
    await open(page, "/s-closed/edit");
    await expect(page.getByRole("heading", { name: "Không thể sửa buổi này" })).toBeVisible();
  });
});

test.describe("visibility toggle", () => {
  const pub = makeSession({ id: "s-public", visibility: "public", version: 5 });
  const noArea = makeSession({ id: "s-no-area", area: null });
  const noSlots = makeSession({ id: "s-no-slots", slotsMax: null });
  const noBoth = makeSession({ id: "s-no-both", area: null, slotsMax: null });
  const all = () => [...fixtures(), pub, noArea, noSlots, noBoth]; // never grow fixtures() itself
  const MISSING = "Thiếu thông tin bắt buộc để công khai kèo.";
  const MISSING_ERR = { code: "MISSING_DISCOVERY_FIELDS", message: MISSING, statusCode: 400 };
  // Not "Đang ngoại tuyến": roster.spec.ts:566 finds the roster hint by that text in strict mode.
  const OFFLINE_HINT = "Bạn đang offline — chưa thể đổi chế độ hiển thị.";
  const LEAD = "Chưa thể công khai buổi này: ";
  const TO_PUBLIC = "Chuyển sang Công khai";
  const stateLine = (page: Page) => page.getByText(/^(Hiển thị|Visibility): /);
  const refusal = (page: Page) => page.locator("main").getByRole("alert");
  const toggle = (page: Page, name = TO_PUBLIC) => page.getByRole("button", { name, exact: true });
  const confirmIn = (page: Page, name = TO_PUBLIC) =>
    page.getByRole("dialog").getByRole("button", { name, exact: true }).click();
  const describedBy = async (page: Page) =>
    page.locator(`[id="${await toggle(page).getAttribute("aria-describedby")}"]`);
  const puts = (mock: ApiMock, id: string) =>
    mock.calls.filter((c) => c.method === "PUT" && c.path === `/api/sessions/${id}`);
  const stored = (mock: ApiMock, id: string) => mock.state.find((s) => s.id === id)!;
  const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

  test("E1+E2: no optimistic state; toast, refetch and focus after the PUT", async ({ page }) => {
    const mock = await open(page, "/s-open", all());
    await expect(stateLine(page)).toHaveText("Hiển thị: Riêng tư");
    const release = mock.holdNext("update");
    await toggle(page).click();
    const dialog = page.getByRole("dialog", { name: "Công khai buổi này?" });
    await expect(dialog).toContainText("Buổi sẽ chuyển sang Công khai.");
    await confirmIn(page);
    await expect(dialog.getByRole("button", { name: "Đang xử lý…" })).toBeDisabled();
    await expect(stateLine(page)).toHaveText("Hiển thị: Riêng tư"); // nothing before the server
    await expect(page.getByText("Đã chuyển sang Công khai.")).toHaveCount(0);
    release();
    await expect(page.getByText("Đã chuyển sang Công khai.")).toBeVisible();
    await expect(stateLine(page)).toHaveText("Hiển thị: Công khai");
    await expect(toggle(page, "Chuyển về Riêng tư")).toBeFocused();
    const [put] = puts(mock, "s-open");
    expect(Object.keys(put!.body!).sort()).toEqual(["commandId", "expectedVersion", "visibility"]);
    expect(put!.body).toMatchObject({ visibility: "public", expectedVersion: 3 });
  });

  test("E1+E3: a public session confirms the flip to private", async ({ page }) => {
    const mock = await open(page, "/s-public", all());
    await expect(stateLine(page)).toHaveText("Hiển thị: Công khai");
    await toggle(page, "Chuyển về Riêng tư").click();
    await expect(page.getByRole("dialog", { name: "Chuyển buổi này về Riêng tư?" })).toBeVisible();
    await confirmIn(page, "Chuyển về Riêng tư");
    await expect(page.getByText("Đã chuyển về Riêng tư.")).toBeVisible();
    await expect(stateLine(page)).toHaveText("Hiển thị: Riêng tư");
    const [put] = puts(mock, "s-public");
    expect(put!.body).toMatchObject({ visibility: "private", expectedVersion: 5 });
  });

  test("E4: no area: refused locally, nothing sent, the link focuses it", async ({ page }) => {
    const mock = await open(page, "/s-no-area", all());
    await toggle(page).click();
    await expect(refusal(page)).toHaveText(LEAD + "Kèo công khai cần có khu vực.");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(puts(mock, "s-no-area")).toHaveLength(0);
    const link = page.getByRole("link", { name: "Bổ sung thông tin" });
    await expect(link).toHaveAttribute("href", `${BASE}/s-no-area/edit#area`);
    await link.click();
    await expect(page.getByLabel("Khu vực")).toBeFocused();
  });

  test("E5: no slots links #slots (checkbox focus); both gaps link #area", async ({ page }) => {
    await open(page, "/s-no-slots", all());
    await toggle(page).click();
    await expect(refusal(page)).toHaveText(LEAD + "Kèo công khai cần số chỗ giới hạn.");
    const link = page.getByRole("link", { name: "Bổ sung thông tin" });
    await expect(link).toHaveAttribute("href", `${BASE}/s-no-slots/edit#slots`);
    await link.click();
    await expect(page.getByLabel("Không giới hạn số chỗ")).toBeFocused();
    await open(page, "/s-no-both", all());
    await toggle(page).click();
    await expect(refusal(page)).toContainText("cần có khu vực. Kèo công khai cần số chỗ giới hạn.");
    await expect(link).toHaveAttribute("href", `${BASE}/s-no-both/edit#area`);
  });

  test("E6: a server refusal changes nothing; the next try is a new command", async ({ page }) => {
    const mock = await open(page, "/s-open", all());
    mock.failNext("update", MISSING_ERR);
    await toggle(page).click();
    await confirmIn(page);
    const alert = page.getByRole("dialog").getByRole("alert");
    await expect(alert).toContainText(MISSING);
    await expect(alert.getByRole("link")).toHaveAttribute("href", `${BASE}/s-open/edit`);
    await expect(stateLine(page)).toHaveText("Hiển thị: Riêng tư");
    stored(mock, "s-open").area = "  "; // now the mock's own MISSING_DISCOVERY_FIELDS rule answers
    await confirmIn(page);
    await expect.poll(() => puts(mock, "s-open").length).toBe(2);
    await expect(alert).toContainText(MISSING);
    const [first, second] = puts(mock, "s-open").map((c) => c.body!.commandId);
    expect(second).not.toBe(first);
    expect(stored(mock, "s-open")).toMatchObject({ visibility: "private", version: 3 });
  });

  test("E7: STALE_VERSION reloads, closes the dialog, shows the new version", async ({ page }) => {
    const mock = await open(page, "/s-open", all());
    await expect(page.getByText("Phiên bản 3")).toBeVisible();
    stored(mock, "s-open").version = 9;
    await toggle(page).click();
    await confirmIn(page);
    const alert = page.getByRole("dialog").getByRole("alert");
    await expect(alert).toContainText("Kèo vừa được cập nhật");
    await alert.getByRole("button", { name: "Tải lại dữ liệu" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByText("Phiên bản 9")).toBeVisible();
  });

  test("E8: a network failure retries with the SAME commandId", async ({ page }) => {
    const mock = await open(page, "/s-open", all());
    mock.failNext("update", "network");
    await toggle(page).click();
    await confirmIn(page);
    const alert = page.getByRole("dialog").getByRole("alert");
    await expect(alert).toContainText("Không có kết nối mạng");
    await alert.getByRole("button", { name: "Thử lại" }).click();
    await expect(page.getByText("Đã chuyển sang Công khai.")).toBeVisible();
    const ids = puts(mock, "s-open").map((c) => c.body!.commandId);
    expect(ids).toHaveLength(2);
    expect(ids[1]).toBe(ids[0]);
  });

  test("E9: offline: disabled with its own hint; online: enabled", async ({ page, context }) => {
    await open(page, "/s-open", all());
    await context.setOffline(true);
    await expect(toggle(page)).toBeDisabled();
    await expect(await describedBy(page)).toHaveText(OFFLINE_HINT);
    await context.setOffline(false);
    await expect(toggle(page)).toBeEnabled();
  });

  test("E10: past start: disabled with its hint; terminal: no toggle", async ({ page }) => {
    await open(page, "/s-past-open", all());
    await expect(toggle(page)).toBeDisabled();
    await expect(await describedBy(page)).toHaveText(
      "Buổi đã bắt đầu nên không đổi được chế độ hiển thị nữa.",
    );
    for (const id of ["s-closed", "s-cancelled"]) {
      await open(page, `/${id}`, all());
      await expect(page.getByText("Buổi này chỉ để xem.")).toBeVisible();
      await expect(stateLine(page)).toHaveCount(0);
      await expect(page.getByRole("button", { name: /Công khai|Riêng tư/ })).toHaveCount(0);
    }
  });

  test("E11: an English club gets the English copy", async ({ page }) => {
    await open(page, "/s-open", all(), "en");
    await expect(stateLine(page)).toHaveText("Visibility: Private");
    await toggle(page, "Make public").click();
    await confirmIn(page, "Make public");
    await expect(page.getByText("The session is now public.")).toBeVisible();
    await open(page, "/s-no-area", all(), "en");
    await toggle(page, "Make public").click();
    await expect(refusal(page)).toContainText("A public session needs an area.");
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`E12: axe + layout, five states, 375x812 ${scheme}`, async ({ page, context }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.emulateMedia({ colorScheme: scheme });
      const check = async (state: string, inDialog = false) => {
        if (inDialog) await expectDialogFits(page);
        const width = await page.evaluate(() => [
          document.documentElement.scrollWidth,
          document.documentElement.clientWidth,
        ]);
        expect(width[0], `${state}: no horizontal page scroll`).toBeLessThanOrEqual(width[1]!);
        const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
        const blocking = violations.filter(
          (v) => v.impact === "serious" || v.impact === "critical",
        );
        expect(blocking.map((v) => [state, v.id, v.nodes.map((n) => n.target)])).toEqual([]);
      };
      const mock = await open(page, "/s-open", all());
      const release = mock.holdNext("update");
      await toggle(page).click();
      await confirmIn(page);
      await expect(page.getByRole("dialog").getByText("Đang xử lý…")).toBeVisible();
      await check("busy", true);
      release();
      await expect(page.getByText("Đã chuyển sang Công khai.")).toBeVisible();
      (await open(page, "/s-open", all())).failNext("update", MISSING_ERR);
      await toggle(page).click();
      await confirmIn(page);
      await expect(page.getByRole("dialog").getByRole("alert")).toContainText(MISSING);
      await check("server error", true);
      await open(page, "/s-no-area", all());
      await toggle(page).click();
      await expect(refusal(page)).toBeVisible();
      await check("refusal");
      await open(page, "/s-past-open", all());
      await expect(toggle(page)).toBeDisabled();
      await check("past start");
      await open(page, "/s-open", all());
      await context.setOffline(true);
      await expect(toggle(page)).toBeDisabled();
      await check("offline");
      await context.setOffline(false);
    });
  }
});

test.describe("language", () => {
  test("an English club renders the screens in English", async ({ page }) => {
    await open(page, "", fixtures(), "en");
    await expect(page.getByRole("heading", { level: 1, name: "Sessions" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Upcoming" })).toBeVisible();
    await expect(page.getByRole("link", { name: "+ New session" })).toBeVisible();
  });
});

const SCHEMES = ["light", "dark"] as const;
const VIEWPORTS = [
  { name: "375x812", width: 375, height: 812 },
  { name: "1280x800", width: 1280, height: 800 },
];
const SCREENS: { name: string; path: string; ready: (page: Page) => Promise<void> }[] = [
  {
    name: "list",
    path: "",
    ready: (p) => card(p, "s-open").waitFor(),
  },
  { name: "new", path: "/new", ready: (p) => p.getByLabel("Giá mỗi người (VND)").waitFor() },
  { name: "detail", path: "/s-open", ready: (p) => p.getByText("Lan Nguyễn").waitFor() },
  {
    name: "edit",
    path: "/s-draft/edit",
    ready: (p) => p.getByLabel("Giá mỗi người (VND)").waitFor(),
  },
];

for (const scheme of SCHEMES) {
  for (const viewport of VIEWPORTS) {
    test.describe(`axe ${scheme} ${viewport.name}`, () => {
      test.use({
        colorScheme: scheme,
        viewport: { width: viewport.width, height: viewport.height },
      });
      for (const screen of SCREENS) {
        test(screen.name, async ({ page }) => {
          await open(page, screen.path);
          await screen.ready(page);
          const results = await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
            .analyze();
          const blocking = results.violations.filter(
            (v) => v.impact === "serious" || v.impact === "critical",
          );
          expect(
            blocking.map((v) => ({
              id: v.id,
              impact: v.impact,
              nodes: v.nodes.map((n) => n.target),
            })),
          ).toEqual([]);
        });
      }
    });
  }
}

test("axe: confirm dialog open (bottom sheet at 375, dark)", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ colorScheme: "dark" });
  await open(page, "/s-draft");
  await page.getByRole("button", { name: "Đăng kèo" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    results.violations.filter((v) => v.impact === "serious" || v.impact === "critical"),
  ).toEqual([]);
});

export type { ApiMock };
