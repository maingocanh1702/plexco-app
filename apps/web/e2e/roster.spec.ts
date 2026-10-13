import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { TENANT_ID, installApiMock, makeSession, signIn } from "./support/session-api-mock";

/**
 * Host roster + manual payments on the session detail (lane M2c-fe). /api/* is mocked
 * (e2e/support/roster-api-mock.ts mirrors the server contracts); no database is involved.
 */
const BASE = `/c/${TENANT_ID}/sessions`;
const alloc = (id: string, source: string, amount: number, reasonCode: string | null = null) => ({
  id,
  source,
  amount,
  createdAt: "2026-10-02T03:00:00.000Z",
  reasonCode,
  reversesAllocationId: null,
});
const player = (
  id: string,
  name: string,
  status: string,
  charge: unknown,
  pos: number | null = null,
) => ({
  id,
  membershipId: `m-${id}`,
  displayName: name,
  status,
  joinedAt: "2026-10-01T00:00:00.000Z",
  waitlistPosition: pos,
  charge,
});
const roster = () => [
  player("p1", "Lan Nguyễn", "active", {
    id: "c1",
    amountDue: 50000,
    amountAllocated: 50000,
    status: "paid",
    effectiveAllocated: 50000,
    remaining: 0,
    allocations: [alloc("a1", "cash", 50000)],
  }),
  player("p2", "Minh Trần", "active", {
    id: "c2",
    amountDue: 50000,
    amountAllocated: 20000,
    status: "partial",
    effectiveAllocated: 20000,
    remaining: 30000,
    allocations: [alloc("a2", "attested_transfer", 20000, "ck lần 1")],
  }),
  player("p3", "An Võ", "active", {
    id: "c3",
    amountDue: 50000,
    amountAllocated: 0,
    status: "open",
    effectiveAllocated: 0,
    remaining: 50000,
    allocations: [],
  }),
  player("p4", "Hà Phạm", "waitlisted", null, 1),
];
const sessions = () => [
  makeSession({ id: "r-open", status: "open", slotsMax: 4, players: roster() }),
  makeSession({ id: "r-closed", status: "closed", slotsMax: 4, players: roster() }),
  makeSession({ id: "r-cancelled", status: "cancelled", slotsMax: 4, players: roster() }),
];

test.beforeEach(async ({ context }) => {
  await signIn(context);
});

async function open(page: Page, id = "r-open") {
  const mock = await installApiMock(page, sessions());
  await page.goto(`${BASE}/${id}`);
  await expect(page.getByText("Lan Nguyễn")).toBeVisible();
  return mock;
}
const select = (page: Page, name: string) =>
  page.getByRole("checkbox", { name: `Chọn ${name} để gạch nợ` }).check();
const dialog = (page: Page) => page.getByRole("dialog");
const body = (call: { body: Record<string, unknown> | null }) => call.body!;

test.describe("add / remove", () => {
  test("host-add by name: active, then waitlisted when full; duplicate is explained", async ({
    page,
  }) => {
    const mock = await open(page);
    const add = async (name: string) => {
      await page.getByRole("button", { name: "Thêm người chơi" }).click();
      await page.getByLabel("Tên hiển thị").fill(name);
      await page.getByRole("button", { name: "Thêm", exact: true }).click();
    };
    await add("  Bình  ");
    await expect(page.getByRole("status").filter({ hasText: "Đã thêm Bình" })).toBeVisible();
    await expect(page.getByText("Bình", { exact: true })).toBeVisible();
    await add("Cúc");
    await expect(page.getByText("Cúc vào danh sách chờ (#2)")).toBeVisible();
    await add("Bình");
    await expect(page.locator("main").getByRole("alert")).toContainText(
      "Người chơi đã có trong buổi này.",
    );
    const posts = mock.callsTo("POST", /\/players$/);
    expect(Object.keys(body(posts[0]!)).sort()).toEqual(["commandId", "displayName"]);
    expect(body(posts[0]!).displayName).toBe("Bình"); // trimmed
  });

  test("remove with a note; a paid player is refused with the review explanation", async ({
    page,
  }) => {
    const mock = await open(page);
    await page.getByRole("button", { name: "Gỡ An Võ" }).click();
    await dialog(page).getByLabel("Ghi chú (không bắt buộc)").fill("báo nghỉ");
    await dialog(page).getByRole("button", { name: "Gỡ người chơi" }).click();
    await expect(page.getByText("Đã gỡ An Võ")).toBeVisible();
    await expect(page.getByText("Đã rời")).toBeVisible();
    const del = mock.callsTo("DELETE", /\/players\/p3$/);
    expect(body(del[0]!).note).toBe("báo nghỉ");

    await page.getByRole("button", { name: "Gỡ Lan Nguyễn" }).click();
    await dialog(page).getByRole("button", { name: "Gỡ người chơi" }).click();
    await expect(dialog(page).getByRole("alert")).toContainText("hãy hoàn tác trước khi xoá");
    await expect(dialog(page)).toContainText("đã thanh toán, cần xem xét");
  });
});

test.describe("mark-paid", () => {
  test("preview -> confirm for two players with one partial amount", async ({ page }) => {
    const mock = await open(page);
    await select(page, "An Võ");
    await select(page, "Minh Trần");
    await page.getByRole("button", { name: "Gạch nợ (2)" }).click();
    await dialog(page).getByRole("button", { name: "Xem trước" }).click();
    await expect(dialog(page).getByLabel("Số tiền cho An Võ")).toHaveValue(/50\.000/);
    const minh = dialog(page).getByLabel("Số tiền cho Minh Trần");
    await expect(minh).toHaveValue(/30\.000/);
    await minh.fill("10000"); // partial
    await dialog(page).getByRole("button", { name: "Xác nhận" }).click();
    await expect(dialog(page)).toContainText("Đã ghi nhận thanh toán");
    await dialog(page).getByRole("button", { name: "Xong" }).click();

    const calls = mock.callsTo("POST", /\/mark-paid$/);
    expect(body(calls[0]!).preview).toBe(true);
    const confirm = body(calls[1]!);
    expect(confirm).toMatchObject({ method: "cash", expectedTotal: 60000 });
    expect(confirm.items).toEqual([
      { playerId: "p2", amount: 10000 },
      { playerId: "p3", amount: 50000 },
    ]);
    await expect(page.getByText(/Còn .*20\.000.* \/ .*50\.000/)).toBeVisible(); // Minh after 10k
    await expect(page.getByRole("checkbox", { name: /Chọn An Võ/ })).toHaveCount(0); // paid in full
  });

  test("out-of-range amount is flagged inline; per-line server failure offers reload", async ({
    page,
  }) => {
    const mock = await open(page);
    await select(page, "Minh Trần");
    await page.getByRole("button", { name: "Gạch nợ (1)" }).click();
    await dialog(page).getByRole("button", { name: "Xem trước" }).click();
    const amount = dialog(page).getByLabel("Số tiền cho Minh Trần");
    await amount.fill("30001");
    await expect(dialog(page)).toContainText("Nhập số nguyên từ 1 đến");
    await dialog(page).getByRole("button", { name: "Xác nhận" }).click();
    expect(
      mock.callsTo("POST", /\/mark-paid$/).filter((c) => c.body!.preview !== true),
    ).toHaveLength(0);
    await amount.fill("30000");
    mock.failNext("mark-paid", {
      code: "ALLOCATION_EXCEEDS_FUNDS",
      message: "Số tiền vượt quá khoản còn thiếu.",
      statusCode: 409,
    });
    await dialog(page).getByRole("button", { name: "Xác nhận" }).click();
    await expect(dialog(page).getByRole("alert")).toContainText(
      "Số tiền vượt quá khoản còn thiếu.",
    );
    await dialog(page).getByRole("button", { name: "Tải lại dữ liệu" }).click();
    await expect(dialog(page)).toContainText("Gạch nợ cho 1 người"); // back to step 1
  });

  test("network loss keeps the command key and freezes the amounts; the retry replays", async ({
    page,
  }) => {
    const mock = await open(page);
    await select(page, "An Võ");
    await page.getByRole("button", { name: "Gạch nợ (1)" }).click();
    await dialog(page)
      .getByRole("radio", { name: /Chuyển khoản/ })
      .check();
    await dialog(page).getByRole("button", { name: "Xem trước" }).click();
    mock.failNext("mark-paid", "network");
    await dialog(page).getByRole("button", { name: "Xác nhận" }).click();
    await expect(dialog(page).getByLabel("Số tiền cho An Võ")).toHaveAttribute("readonly", "");
    await dialog(page).getByRole("button", { name: "Thử lại" }).click();
    await expect(dialog(page)).toContainText("Đã ghi nhận thanh toán");
    const ids = mock
      .callsTo("POST", /\/mark-paid$/)
      .filter((c) => c.body!.preview !== true)
      .map((c) => c.body!.commandId);
    expect(ids).toHaveLength(2);
    expect(ids[1]).toBe(ids[0]);
    expect(body(mock.callsTo("POST", /\/mark-paid$/).at(-1)!).method).toBe("attested_transfer");
  });
});

test.describe("ledger / reversal", () => {
  test("reverse a manual allocation with a required reason", async ({ page }) => {
    const mock = await open(page);
    await page.getByText(/Chi tiết thanh toán \(đã thu .*20\.000/).click();
    await expect(page.locator("details").getByText("Chuyển khoản (host xác nhận)")).toBeVisible();
    await expect(page.getByText("ck lần 1")).toBeVisible();
    await page.getByRole("button", { name: /Hoàn tác khoản .*20\.000/ }).click();
    await dialog(page).getByRole("button", { name: "Hoàn tác" }).click();
    await expect(dialog(page)).toContainText("Nhập lý do");
    await dialog(page).getByLabel("Lý do (bắt buộc)").fill("nhập nhầm");
    await dialog(page).getByRole("button", { name: "Hoàn tác" }).click();
    await expect(page.getByText(/Đã hoàn tác .*20\.000/)).toBeVisible();
    const call = mock.callsTo("POST", /\/payments\/a2\/reverse$/)[0]!;
    expect(body(call).reason).toBe("nhập nhầm");
    await expect(page.getByText(/Còn .*50\.000.* \/ .*50\.000/).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Hoàn tác khoản .*20\.000/ })).toHaveCount(0);
  });

  test("an admin without money.correct sees the permission explanation", async ({ page }) => {
    const mock = await open(page);
    await page.getByText(/Chi tiết thanh toán \(đã thu .*20\.000/).click();
    await page.getByRole("button", { name: /Hoàn tác khoản .*20\.000/ }).click();
    await dialog(page).getByLabel("Lý do (bắt buộc)").fill("nhập nhầm");
    mock.failNext("reverse", { code: "FORBIDDEN", message: "x", statusCode: 403 });
    await dialog(page).getByRole("button", { name: "Hoàn tác" }).click();
    await expect(dialog(page).getByRole("alert")).toContainText("money.correct");
  });
});

test.describe("status gates", () => {
  test("closed: add/remove disabled and explained, payments still possible", async ({ page }) => {
    await open(page, "r-closed");
    await expect(page.getByRole("button", { name: "Thêm người chơi" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Gỡ An Võ" })).toBeDisabled();
    await expect(page.getByText("Chỉ thêm hoặc gỡ người chơi khi buổi đang mở.")).toBeVisible();
    await select(page, "An Võ");
    await expect(page.getByRole("button", { name: "Gạch nợ (1)" })).toBeEnabled();
  });

  test("cancelled: nothing is actionable", async ({ page }) => {
    await open(page, "r-cancelled");
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Thêm người chơi" })).toBeDisabled();
    await expect(page.getByRole("button", { name: /Gạch nợ/ })).toBeDisabled();
    await expect(
      page.getByText("Chỉ ghi nhận thanh toán khi buổi đang mở hoặc đã đóng."),
    ).toBeVisible();
  });

  test("offline disables every write", async ({ page, context }) => {
    await open(page);
    await context.setOffline(true);
    await expect(page.getByText("Đang ngoại tuyến")).toBeVisible();
    await expect(page.getByRole("button", { name: "Thêm người chơi" })).toBeDisabled();
    await expect(page.getByRole("checkbox")).toHaveCount(0);
  });
});

for (const scheme of ["light", "dark"] as const) {
  for (const [name, width, height] of [
    ["375", 375, 812],
    ["1280", 1280, 800],
  ] as const) {
    test.describe(`axe ${scheme} ${name}`, () => {
      test.use({ colorScheme: scheme, viewport: { width, height } });
      const scan = async (page: Page) => {
        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
          .analyze();
        return results.violations
          .filter((v) => v.impact === "serious" || v.impact === "critical")
          .map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) }));
      };
      test("roster with ledger expanded", async ({ page }) => {
        await open(page);
        await page
          .getByText(/Chi tiết thanh toán/)
          .first()
          .click();
        expect(await scan(page)).toEqual([]);
      });
      test("mark-paid sheet: method step and review step", async ({ page }) => {
        await open(page);
        await select(page, "Minh Trần");
        await page.getByRole("button", { name: "Gạch nợ (1)" }).click();
        expect(await scan(page)).toEqual([]);
        await dialog(page).getByRole("button", { name: "Xem trước" }).click();
        await expect(dialog(page).getByLabel("Số tiền cho Minh Trần")).toBeVisible();
        expect(await scan(page)).toEqual([]);
      });
    });
  }
}
