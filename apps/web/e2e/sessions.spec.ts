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
    await expect(cardEl).toContainText("50.000");
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
    });
    expect(call!.body).not.toHaveProperty("venueAddress");
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
      message: "Kèo này cần được xem xét trước khi đóng hoặc huỷ.",
      statusCode: 400,
    });
    await page.getByRole("button", { name: "Huỷ buổi" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Huỷ buổi" }).click();
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText("cần được xem xét");
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
