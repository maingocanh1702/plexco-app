import { expect, test } from "@playwright/test";
import { formatVnd } from "../lib/money";
import {
  LISTING_ID,
  NETWORK,
  PRICE,
  VENUE,
  fail,
  installPlayerApi,
  listing,
  myCharges,
  mySession,
  ok,
} from "./support/player-api-mock";

/**
 * L12 player pages in a real browser. Every /api call is mocked (support/player-api-mock.ts) and
 * the server only renders pages; the anonymous row installs no session at all.
 */
const DETAIL = `/discover/${LISTING_ID}`;
const JOIN = { name: "Tham gia", exact: true } as const;
const HIDDEN_VENUE = "Sân Bí Mật";
const PAY_WORDS = /pay|thanh toán|trả ngay|chuyển khoản|qr|ngân hàng|bank/i;

test("waitlisted player sees area and position, no venue", async ({ page }) => {
  await installPlayerApi(page, {
    // The injected venue keys are in no whitelist: the pages must drop them.
    discoverDetail: ok({ listing: listing({ venueName: HIDDEN_VENUE }) }),
    join: ok({
      join: { outcome: "waitlisted", waitlistPosition: 3 },
      replayed: false,
      venueName: HIDDEN_VENUE,
    }),
    meSessions: ok({
      sessions: [
        mySession(),
        mySession({
          sessionId: "sess-e2e-2",
          myStatus: "waitlisted",
          waitlistPosition: 3,
          area: "Thủ Đức",
          venueName: HIDDEN_VENUE,
          venueAddress: HIDDEN_VENUE,
        }),
        mySession({
          sessionId: "sess-e2e-3",
          myStatus: "pending",
          area: "Quận 1",
          venueName: HIDDEN_VENUE,
          venueAddress: HIDDEN_VENUE,
        }),
      ],
      truncated: false,
    }),
  });
  await page.goto(DETAIL);
  await page.getByRole("button", JOIN).click();
  await expect(page.getByText("Bạn đang trong danh sách chờ #3")).toBeVisible();
  await expect(page.locator("main")).not.toContainText(HIDDEN_VENUE);

  await page.getByRole("link", { name: "Xem buổi của tôi" }).click();
  await expect(page.locator("main")).toHaveAttribute("data-state", "ready");
  const seats = page.locator("main li");
  await expect(seats).toHaveCount(3);
  await expect(seats.filter({ hasText: "Đã có chỗ" })).toContainText(VENUE);
  await expect(seats.filter({ hasText: "Danh sách chờ #3" })).toContainText("Thủ Đức");
  await expect(seats.filter({ hasText: "Chờ duyệt" })).toContainText("Quận 1");
  await expect(page.locator("main")).not.toContainText(HIDDEN_VENUE);
});

test("anonymous discovery works with no session", async ({ page }) => {
  const api = await installPlayerApi(page, {}, { signedIn: false });
  await page.goto("/discover");
  await expect(page.locator("main")).toHaveAttribute("data-state", "ready");
  await page.getByRole("link", { name: "Xem chi tiết" }).click();
  await expect(page).toHaveURL(new RegExp(`${DETAIL}$`));
  await expect(page.getByRole("link", { name: /Đăng nhập để tham gia/ })).toBeVisible();
  await expect(page.getByRole("button", JOIN)).toHaveCount(0);
  expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(0);
});

test("join double tap sends one command id", async ({ page }) => {
  const api = await installPlayerApi(page);
  const release = api.holdNext("join");
  api.failNext("join", fail("RATE_LIMITED", 429)); // attempt 1 is held open, then refused (a 4xx)
  await page.goto(DETAIL);
  const join = page.getByRole("button", JOIN);
  await join.dblclick();
  const busy = page.getByRole("button", { name: "Đang gửi…" });
  await expect(busy).toHaveAttribute("aria-busy", "true");
  await expect(busy).toBeDisabled();
  await expect.poll(() => api.callsTo("join").length).toBe(1);
  release();

  // A 4xx on a fresh key applied nothing: the retry is a NEW command. Its reply is then lost.
  await expect(join).toBeEnabled();
  api.failNext("join", NETWORK);
  await join.click();
  await expect.poll(() => api.callsTo("join").length).toBe(2);

  // A lost reply may have been applied: the retry carries the SAME command id (the keeper stays
  // sticky once an attempt was uncertain, so a 4xx after a lost reply would not drop it either).
  await expect(join).toBeEnabled();
  await join.click();
  await expect(page.getByText("Bạn đã có chỗ trong buổi này.")).toBeVisible();

  const ids = api.callsTo("join").map((c) => c.body?.commandId);
  expect(ids).toHaveLength(3);
  expect(typeof ids[0]).toBe("string");
  expect(ids[1]).not.toBe(ids[0]);
  expect(ids[2]).toBe(ids[1]);
});

test("player journey discover -> join -> my sessions -> my charges", async ({ page }) => {
  const api = await installPlayerApi(page);
  await page.goto("/discover");
  await expect(page.locator("main")).toContainText(formatVnd(PRICE));
  await page.getByRole("link", { name: "Xem chi tiết" }).click();
  await page.getByRole("button", JOIN).click();
  await expect(page.getByText("Bạn đã có chỗ trong buổi này.")).toBeVisible();
  expect(api.callsTo("join")).toHaveLength(1);

  // The server now holds the seat and its charge.
  api.reply("meSessions", ok({ sessions: [mySession()], truncated: false }));
  api.reply("meCharges", ok(myCharges()));
  await page.getByRole("link", { name: "Xem buổi của tôi" }).click();
  await expect(page).toHaveURL(/\/me\/sessions$/);
  await expect(page.locator("main li")).toContainText(VENUE);
  await expect(
    page.locator("main").getByRole("button", { name: /rời|leave|hủy|cancel/i }),
  ).toHaveCount(0);

  await page.goto("/me/charges");
  await expect(page.locator("main")).toHaveAttribute("data-state", "ready");
  await expect(page.locator("main")).toContainText(formatVnd(PRICE));
});

test("no pay-now, QR or bank detail anywhere", async ({ page }) => {
  // Injected payment keys are in no whitelist: no screen may render them.
  const injected = {
    bankAccount: "Vietcombank 0011001234567",
    qrUrl: "https://qr.example.test/p.png",
  };
  await installPlayerApi(page, {
    discover: ok({ items: [listing(injected)], nextCursor: null }),
    discoverDetail: ok({ listing: listing(injected) }),
    meCharges: ok(myCharges(injected)),
  });
  for (const path of ["/discover", DETAIL, "/me/charges"]) {
    await page.goto(path);
    const main = page.locator("main");
    await expect(main).toHaveAttribute("data-state", "ready");
    await expect(main).toContainText(formatVnd(PRICE)); // the page rendered money before we look for payment UI
    await expect(main.getByRole("button", { name: PAY_WORDS })).toHaveCount(0);
    await expect(main.getByRole("link", { name: PAY_WORDS })).toHaveCount(0);
    await expect(main.locator("img, canvas")).toHaveCount(0);
    await expect(main).not.toContainText(/vietcombank|0011001234567|qr\.example/i);
  }
});
