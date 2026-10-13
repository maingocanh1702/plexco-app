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
  const add = async (page: Page, name: string) => {
    await page.getByRole("button", { name: "Thêm người chơi" }).click();
    await page.getByLabel("Tên hiển thị").fill(name);
    await page.getByRole("button", { name: "Thêm", exact: true }).click();
  };

  test("host-add by name: active, then waitlisted when full; the body is exactly commandId + name", async ({
    page,
  }) => {
    const mock = await open(page);
    await add(page, "  Bình  ");
    await expect(page.getByRole("status").filter({ hasText: "Đã thêm Bình" })).toBeVisible();
    await expect(page.getByText("Bình", { exact: true })).toBeVisible();
    await add(page, "Cúc");
    await expect(page.getByText("Cúc vào danh sách chờ (#2)")).toBeVisible();
    const posts = mock.callsTo("POST", /\/players$/);
    expect(Object.keys(body(posts[0]!)).sort()).toEqual(["commandId", "displayName"]);
    expect(body(posts[0]!).displayName).toBe("Bình"); // trimmed
  });

  test("an injected ALREADY_JOINED is explained and the next attempt is a NEW command", async ({
    page,
  }) => {
    const mock = await open(page);
    mock.failNext("add", {
      code: "ALREADY_JOINED",
      message: "Người chơi đã có trong buổi này.",
      statusCode: 409,
    });
    await add(page, "Bình");
    await expect(page.locator("main").getByRole("alert")).toContainText(
      "Người chơi đã có trong buổi này.",
    );
    await page.getByLabel("Tên hiển thị").fill("Bình 2");
    await page.getByRole("button", { name: "Thêm", exact: true }).click();
    await expect(page.getByText("Đã thêm Bình 2")).toBeVisible();
    const ids = mock.callsTo("POST", /\/players$/).map((c) => body(c).commandId);
    expect(ids).toHaveLength(2);
    expect(ids[1]).not.toBe(ids[0]); // a 4xx is definite: the key is dropped
  });

  test("a lost reply freezes the name; the retry replays (one member, replayed:true)", async ({
    page,
  }) => {
    const mock = await open(page);
    mock.failNext("add", "lost-response"); // the server APPLIES the add, the reply never arrives
    await add(page, "Bình");
    await expect(page.getByLabel("Tên hiển thị")).toHaveAttribute("readonly", "");
    const replay = page.waitForResponse(
      (r) => r.request().method() === "POST" && /\/players$/.test(new URL(r.url()).pathname),
    );
    await page.getByRole("button", { name: "Thử lại" }).click();
    expect((await (await replay).json()).data.replayed).toBe(true);
    await expect(page.getByText("Đã thêm Bình")).toBeVisible();
    const ids = mock.callsTo("POST", /\/players$/).map((c) => body(c).commandId);
    expect(ids).toHaveLength(2);
    expect(ids[1]).toBe(ids[0]);
    const members = (mock.state[0]!.players as { displayName: string }[]).filter(
      (p) => p.displayName === "Bình",
    );
    expect(members).toHaveLength(1);
  });

  test("remove sends only the command key; a paid player is refused with the reverse-first copy", async ({
    page,
  }) => {
    const mock = await open(page);
    await page.getByRole("button", { name: "Gỡ An Võ" }).click();
    await expect(dialog(page).getByLabel("Ghi chú (không bắt buộc)")).toHaveCount(0);
    await dialog(page).getByRole("button", { name: "Gỡ người chơi" }).click();
    await expect(page.getByText("Đã gỡ An Võ")).toBeVisible();
    await expect(page.getByText("Đã rời")).toBeVisible();
    const del = mock.callsTo("DELETE", /\/players\/p3$/);
    expect(Object.keys(body(del[0]!))).toEqual(["commandId"]);

    await page.getByRole("button", { name: "Gỡ Lan Nguyễn" }).click();
    await dialog(page).getByRole("button", { name: "Gỡ người chơi" }).click();
    await expect(dialog(page).getByRole("alert")).toContainText(
      "Hãy hoàn tác thanh toán trước rồi mới gỡ.",
    );
    // OD-5 also holds for the retry: a 4xx is definite, so the second press is a NEW command
    await dialog(page).getByRole("button", { name: "Gỡ người chơi" }).click();
    const ids = mock.callsTo("DELETE", /\/players\/p1$/).map((c) => body(c).commandId);
    expect(ids).toHaveLength(2);
    expect(ids[1]).not.toBe(ids[0]);
  });
});

test.describe("mark-paid", () => {
  test("preview -> confirm for two players with one partial amount", async ({ page }) => {
    const mock = await open(page);
    await select(page, "An Võ");
    await select(page, "Minh Trần");
    await page.getByRole("button", { name: "Gạch nợ (2)" }).click();
    await dialog(page).getByRole("button", { name: "Xem trước" }).click();
    // step change announced: focus lands on the FIRST line (roster order: Minh before An Võ)
    await expect(dialog(page).getByLabel("Số tiền cho Minh Trần")).toBeFocused();
    await expect(dialog(page).getByLabel("Số tiền cho An Võ")).toHaveValue(/50\.000/);
    const minh = dialog(page).getByLabel("Số tiền cho Minh Trần");
    await expect(minh).toHaveValue(/30\.000/);
    await minh.fill("10000"); // partial
    await dialog(page).getByRole("button", { name: "Xác nhận" }).click();
    await expect(dialog(page)).toContainText("Đã ghi nhận thanh toán");
    await expect(
      dialog(page).getByRole("list", { name: "Kết quả ghi nhận thanh toán" }),
    ).toBeFocused();
    await dialog(page).getByRole("button", { name: "Xong" }).click();

    const calls = mock.callsTo("POST", /\/mark-paid$/);
    expect(body(calls[0]!).preview).toBe(true);
    const confirm = body(calls[1]!);
    expect(confirm).toMatchObject({ method: "cash", expectedTotal: 60000 });
    expect(confirm.commandId).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/)); // a real key, not a placeholder
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
    await expect(dialog(page).locator("p", { hasText: "Tổng cộng" })).toContainText("—");
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

  test("Go back on the review step returns to the method step without closing", async ({
    page,
  }) => {
    await open(page);
    await select(page, "An Võ");
    await page.getByRole("button", { name: "Gạch nợ (1)" }).click();
    await dialog(page).getByRole("button", { name: "Xem trước" }).click();
    await expect(dialog(page).getByLabel("Số tiền cho An Võ")).toBeVisible();
    await dialog(page).getByRole("button", { name: "Quay lại" }).click();
    await expect(dialog(page)).toContainText("Gạch nợ cho 1 người");
    await dialog(page).getByRole("button", { name: "Quay lại" }).click();
    await expect(dialog(page)).toBeHidden();
    // reopening starts clean at step 1 (no flash of the previous run)
    await page.getByRole("button", { name: "Gạch nợ (1)" }).click();
    await expect(dialog(page)).toContainText("Hình thức thanh toán");
  });

  test("a lost reply keeps the command key and freezes the amounts; the retry replays", async ({
    page,
  }) => {
    const mock = await open(page);
    await select(page, "An Võ");
    await page.getByRole("button", { name: "Gạch nợ (1)" }).click();
    await dialog(page)
      .getByRole("radio", { name: /Chuyển khoản/ })
      .check();
    await dialog(page).getByRole("button", { name: "Xem trước" }).click();
    mock.failNext("mark-paid", "lost-response"); // applied server-side, the reply is lost
    await dialog(page).getByRole("button", { name: "Xác nhận" }).click();
    await expect(dialog(page).getByLabel("Số tiền cho An Võ")).toHaveAttribute("readonly", "");
    const replay = page.waitForResponse(
      (r) => r.request().method() === "POST" && /\/mark-paid$/.test(new URL(r.url()).pathname),
    );
    await dialog(page).getByRole("button", { name: "Thử lại" }).click();
    expect((await (await replay).json()).data.replayed).toBe(true);
    await expect(dialog(page)).toContainText("Đã ghi nhận thanh toán");
    const ids = mock
      .callsTo("POST", /\/mark-paid$/)
      .filter((c) => c.body!.preview !== true)
      .map((c) => c.body!.commandId);
    expect(ids).toHaveLength(2);
    expect(ids[1]).toBe(ids[0]);
    expect(body(mock.callsTo("POST", /\/mark-paid$/).at(-1)!).method).toBe("attested_transfer");
    const p3 = mock.state[0]!.players.find((p) => (p as { id: string }).id === "p3") as {
      charge: { allocations: unknown[] };
    };
    expect(p3.charge.allocations).toHaveLength(1); // replayed, not applied twice
  });
});

test.describe("ledger / reversal", () => {
  test("reverse a manual allocation with a required reason", async ({ page }) => {
    const mock = await open(page);
    await page.getByText(/Chi tiết thanh toán \(đã thu .*20\.000/).click();
    await expect(page.locator("details").getByText("Chuyển khoản (chủ xác nhận)")).toBeVisible();
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

test.describe("ledger time zone", () => {
  // The session is in Asia/Ho_Chi_Minh; the browser deliberately is not.
  test.use({ timezoneId: "America/Los_Angeles" });
  test("rows show the SESSION zone (03:00Z = 10:00 in Ho Chi Minh), not the browser zone", async ({
    page,
  }) => {
    await open(page);
    await page.getByText(/Chi tiết thanh toán \(đã thu .*20\.000/).click();
    const row = page.locator("details li").filter({ hasText: "ck lần 1" });
    await expect(row).toContainText("10:00");
    await expect(row).not.toContainText("20:00");
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
    // every aria-describedby on a disabled write control points at an element that exists
    for (const name of ["Thêm người chơi", "Gỡ An Võ", /Gạch nợ/]) {
      const id = await page.getByRole("button", { name }).first().getAttribute("aria-describedby");
      expect(id, String(name)).toBeTruthy();
      await expect(page.locator(`[id="${id}"]`)).toContainText("Đang ngoại tuyến");
    }
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
