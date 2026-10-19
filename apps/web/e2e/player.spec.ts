import { expect, test, type Page } from "@playwright/test";
import { formatVnd } from "../lib/money";
import {
  LISTING_ID,
  NETWORK,
  PRICE,
  READY,
  SCREENS,
  VENUE,
  fail,
  installPlayerApi,
  listing,
  myCharges,
  mySession,
  ok,
  putScreenInState,
  type Reply,
  type RouteKey,
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

// ---- B-15 error mapping, B-16 offline, and two rows no unit test can cover (no DOM renderer) ----

const RETRY = { name: "Thử lại", exact: true } as const;
const RATE = "Bạn thao tác quá nhanh. Đợi một lát rồi thử lại.";
/** Player data the mock serves: on no error or offline screen (nothing is cached, P-16). */
const PLAYER_DATA = /Cầu lông tối thứ 5|Nguyễn Văn An|CLB Cầu Lông Test/;
/** The reads of R 4.5.2: the screen and the route it reads. The join button posts instead. */
const READS: Record<string, RouteKey> = {
  "discover list": "discover",
  "discover detail": "discoverDetail",
  "me clubs": "meClubs",
  "me sessions": "meSessions",
  "me charges": "meCharges",
  "me requests": "meRequests",
  "host requests tab": "hostRequests",
};
const ROUTE: Record<string, RouteKey> = { ...READS, "join button": "join" };
const routeOf = (screen: string): RouteKey => {
  const route = ROUTE[screen];
  if (!route) throw new Error(`${screen} has no route`);
  return route;
};
const only = (route: RouteKey, reply: Reply) =>
  ({ [route]: reply }) as Partial<Record<RouteKey, Reply>>;
const readyReply = (screen: string, route: RouteKey): Reply => {
  const reply = SCREENS[screen]?.cells.ready?.replies?.[route] ?? READY[route];
  if (!reply) throw new Error(`${screen} has no ready reply`);
  return reply;
};
/** Two animation frames: React has applied what the page just received (a negative needs a settle). */
const settle = (page: Page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );

type Follow = "retry" | "discover-link" | "sessions-link" | "none";
const MAPS: [
  screen: string,
  code: string,
  status: number,
  text: string,
  state: "error" | "empty",
  follow: Follow,
][] = [
  [
    "discover list",
    "DISCOVERY_RATE_LIMITED",
    429,
    "Bạn tìm quá nhanh. Đợi một lát rồi thử lại.",
    "error",
    "retry",
  ],
  [
    "discover detail",
    "NOT_FOUND",
    404,
    "Kèo này không còn hoặc không tồn tại.",
    "empty",
    "discover-link",
  ],
  ["join button", "ALREADY_JOINED", 409, "Bạn đã có tên trong buổi này.", "error", "sessions-link"],
  ["me clubs", "RATE_LIMITED", 429, RATE, "error", "retry"],
  ["me sessions", "RATE_LIMITED", 429, RATE, "error", "retry"],
  ["me charges", "RATE_LIMITED", 429, RATE, "error", "retry"],
  ["me requests", "RATE_LIMITED", 429, RATE, "error", "retry"],
  [
    "host requests tab",
    "FORBIDDEN",
    403,
    "Bạn không có quyền thực hiện thao tác này ở CLB này.",
    "error",
    "none",
  ],
];

for (const [screen, code, status, text, state, follow] of MAPS) {
  test(`${screen} maps ${code}`, async ({ page }) => {
    const route = routeOf(screen);
    const { api, root } = await putScreenInState(
      page,
      screen,
      state,
      only(route, fail(code, status)),
    );
    await expect(root).toHaveAttribute("data-state", state);
    await expect(root.getByText(text)).toBeVisible();
    if (route !== "join") await expect(root.getByText(PLAYER_DATA)).toHaveCount(0); // the join page keeps its listing
    if (follow === "retry") {
      // Retry repeats the same read (the discovery filters stay) and now shows data.
      if (screen === "discover list") await expect(page.getByLabel("Khu vực")).toBeVisible();
      api.reply(route, readyReply(screen, route));
      await root.getByRole("button", RETRY).click();
      await expect(root).toHaveAttribute("data-state", "ready");
      const reads = api.callsTo(route);
      expect(reads).toHaveLength(2);
      expect(reads[1]?.query.toString()).toBe(reads[0]?.query.toString());
    } else if (follow === "discover-link") {
      await expect(root.locator('a[href="/discover"]').first()).toBeVisible();
    } else if (follow === "sessions-link") {
      await expect(root.getByRole("link", { name: "Xem buổi của tôi" })).toHaveAttribute(
        "href",
        "/me/sessions",
      );
    } else {
      // FORBIDDEN: no list, and nothing to press again.
      await expect(root.getByRole("button", { name: /Thử lại|Tải lại dữ liệu/ })).toHaveCount(0);
      await expect(root.locator("li")).toHaveCount(0);
    }
  });
}

for (const [screen, route] of Object.entries(ROUTE)) {
  test(`${screen} unknown and network fail closed`, async ({ page }) => {
    const { api, root } = await putScreenInState(
      page,
      screen,
      "error",
      only(route, fail("E2E_UNKNOWN_CODE", 418)),
    );
    // An unknown code: the generic text with its reference, a Retry, and no player data.
    await expect(root).toHaveAttribute("data-state", "error");
    await expect(root.getByText("Mã tham chiếu")).toBeVisible();
    await expect(root.getByText("req-e2e")).toBeVisible();
    if (route !== "join") await expect(root.getByText(PLAYER_DATA)).toHaveCount(0);
    // CLIENT_NETWORK_ERROR while the browser is still online.
    api.reply(route, NETWORK);
    await root.getByRole("button", RETRY).click();
    if (route === "join") {
      // Inline: a known code (no reference), and the Retry that follows replays the SAME command id.
      await expect(root.getByRole("alert")).toBeVisible();
      await expect(root.getByText("Mã tham chiếu")).toHaveCount(0);
      api.reply(route, readyReply(screen, route));
      await root.getByRole("button", RETRY).click();
      await expect(root.getByText("Bạn đã có chỗ trong buổi này.")).toBeVisible();
      const posts = api.callsTo("join");
      expect(posts).toHaveLength(3);
      expect(posts[2]?.body?.commandId).toBe(posts[1]?.body?.commandId);
    } else {
      await expect(root).toHaveAttribute("data-state", "offline");
      await expect(root.getByRole("status")).toContainText("offline");
      await expect(root.getByRole("alert")).toHaveCount(0);
      await expect(root.getByRole("button", RETRY)).toBeVisible();
      await expect(root.getByText(PLAYER_DATA)).toHaveCount(0);
    }
  });
}

for (const [screen, route] of Object.entries(READS)) {
  test(`${screen} offline`, async ({ page }) => {
    // The API is aborted (route.abort("internetdisconnected")): the offline state, a Retry, no cached data.
    const { api, root } = await putScreenInState(page, screen, "offline");
    await expect(root).toHaveAttribute("data-state", "offline");
    await expect(root.getByRole("button", RETRY)).toBeVisible();
    await expect(root.getByText(PLAYER_DATA)).toHaveCount(0);
    await expect(root.locator("li")).toHaveCount(0);
    // The browser itself goes offline: Retry keeps the offline state and caches nothing.
    await page.context().setOffline(true);
    await root.getByRole("button", RETRY).click();
    await expect(root).toHaveAttribute("data-state", "offline");
    await expect(root.getByText(PLAYER_DATA)).toHaveCount(0);
    // Back online: Retry reads again, and only now is there data.
    await page.context().setOffline(false);
    api.reply(route, readyReply(screen, route));
    await root.getByRole("button", RETRY).click();
    await expect(root).toHaveAttribute("data-state", "ready");
  });
}

test("me hub offline", async ({ page }) => {
  // The hub reads nothing: MeFrame's offline banner, and the four links stay.
  const { root } = await putScreenInState(page, "me hub", "offline");
  await expect(root).toHaveAttribute("data-state", "offline");
  await expect(root.locator('a[href^="/me/"]')).toHaveCount(4);
});

test("join button offline", async ({ page }) => {
  const { api, root } = await putScreenInState(page, "join button", "offline");
  await expect(root).toHaveAttribute("data-state", "offline");
  await expect(page.getByRole("button", JOIN)).toBeDisabled();
  await expect(root.getByText("Bạn đang offline. Kết nối lại để tham gia.")).toBeVisible();
  expect(api.callsTo("join")).toHaveLength(0);
  await page.context().setOffline(false);
  await expect(root).toHaveAttribute("data-state", "ready");
  await expect(page.getByRole("button", JOIN)).toBeEnabled();
});

test("join offline retry sends no POST", async ({ page }) => {
  const api = await installPlayerApi(page);
  api.failNext("join", NETWORK); // the first press is lost
  await page.goto(DETAIL);
  await page.getByRole("button", JOIN).click();
  const retry = page.locator("main").getByRole("alert").getByRole("button", RETRY);
  await expect(retry).toBeVisible();
  await page.context().setOffline(true);
  await expect(page.getByRole("button", JOIN)).toBeDisabled(); // useOnlineStatus has seen it
  await retry.click(); // offline: nothing may be sent
  await settle(page);
  expect(api.callsTo("join")).toHaveLength(1);
  // Online again, the same Retry sends exactly one more POST, with the same command id.
  await page.context().setOffline(false);
  await expect(page.getByRole("button", JOIN)).toBeEnabled();
  await retry.click();
  await expect(page.getByText("Bạn đã có chỗ trong buổi này.")).toBeVisible();
  const posts = api.callsTo("join");
  expect(posts).toHaveLength(2);
  expect(posts[1]?.body?.commandId).toBe(posts[0]?.body?.commandId);
});

test("stale load more shows no error under a new list", async ({ page }) => {
  const api = await installPlayerApi(page, {
    discover: ok({ items: [listing()], nextCursor: "c1" }),
  });
  await page.goto("/discover");
  const main = page.locator("main");
  await expect(main).toHaveAttribute("data-state", "ready");
  const release = api.holdNext("discover");
  await main.getByRole("button", { name: "Tải thêm" }).click(); // load more (cursor c1) stays open
  await expect.poll(() => api.callsTo("discover").length).toBe(2);
  expect(api.callsTo("discover")[1]?.query.get("cursor")).toBe("c1");
  // A new filter replaces the list while the old page is still in flight.
  const fresh = listing({ publicListingId: "pl-new", title: "Kèo lọc mới" });
  api.reply("discover", ok({ items: [fresh], nextCursor: "c2" }));
  await page.getByLabel("Khu vực").fill("Quận 1");
  await main.getByRole("button", { name: "Lọc", exact: true }).click();
  await expect(main.getByText("Kèo lọc mới")).toBeVisible();
  // The old page now fails: that error belongs to a list that is gone.
  api.failNext("discover", fail("INTERNAL_ERROR", 500));
  const stale = page.waitForResponse(
    (r) => r.url().includes("/api/discover") && r.status() === 500,
  );
  release();
  await stale;
  await settle(page);
  await expect(main.getByRole("alert")).toHaveCount(0);
  await expect(main.getByRole("button", { name: "Tải thêm" })).toBeEnabled();
});
