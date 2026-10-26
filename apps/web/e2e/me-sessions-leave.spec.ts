import { expect, test, type Page } from "@playwright/test";
import { installPlayerApi, mySession, ok } from "./support/player-api-mock";
import { TENANT_ID } from "./support/session-api-mock";

/**
 * The leave control of /me/sessions, stubbed with the real envelopes, statuses and headers (no DB,
 * no lock). A seat row lists NO tenant: it comes only from the chat-context stub, which answers 200
 * for the ACTIVE club (club-e2e) and 404 for any other one (the guest club, club-e2e-2).
 */
const ACTIVE = "club-e2e";
const HOST_ONLY = "Bạn không thể tự rời buổi này, hãy nhờ chủ kèo.";
const envelope = (data: unknown, error: unknown) =>
  JSON.stringify({ data, error, meta: { requestId: "req-e2e" } });
const GRANT = envelope({ tenantId: TENANT_ID, timezone: "Asia/Ho_Chi_Minh" }, null);
const DENY = envelope(null, { code: "NOT_FOUND", message: "Không tìm thấy.", statusCode: 404 });
const BODY = {
  200: envelope({ player: { id: "pl-e2e-1", status: "left" }, replayed: false }, null),
  409: envelope(null, { code: "LEAVE_REQUIRES_HOST", message: HOST_ONLY, statusCode: 409 }),
};
/** One scripted answer per POST: a status, or "abort" = the request never reaches the server. */
type Reply = keyof typeof BODY | "abort";
type Leave = { path: string; tenant: string | null; csrf: string | undefined; body: unknown };
const COMMAND = { commandId: expect.stringMatching(/^.+$/) }; // the whole body: a non-empty id

/** One row per `area`, so a test names the row it means; the venue is null unless the seat is active. */
const NO_VENUE = { venueName: null, venueAddress: null } as const;
const GUEST = { clubRef: "club-e2e-2", clubLabel: "CLB Khách Test" } as const;
const WAITING = { myStatus: "waitlisted", waitlistPosition: 2, ...NO_VENUE } as const;
const PENDING = { myStatus: "pending", clubRef: "club-e2e-3", ...NO_VENUE } as const;
const ROWS = [
  mySession({ area: "Quận 1" }), // an active seat of the active club
  mySession({ ...WAITING, sessionId: "sess-e2e-2", area: "Quận 2" }), // a waitlisted seat of it
  mySession({ ...GUEST, sessionId: "sess-e2e-3", area: "Quận 3" }), // a seat of the guest club
  mySession({ ...PENDING, sessionId: "sess-e2e-4", area: "Quận 4" }), // a request: no seat yet
];

/**
 * Opens /me/sessions signed in. `replies` scripts the leave POSTs in order (an unscripted one is
 * aborted); `hold` delays every reply; a 200 also drops that row from the NEXT list read.
 */
async function open(page: Page, replies: Reply[] = [], hold: Promise<void> = Promise.resolve()) {
  const api = await installPlayerApi(page, {
    meSessions: ok({ sessions: ROWS, truncated: false }),
  });
  const urls: string[] = [];
  const leaves: Leave[] = [];
  page.on("request", (request) => urls.push(new URL(request.url()).pathname));
  await page.route(
    (url) => /^\/api\/me\/clubs\/[^/]+\/chat-context$/.test(url.pathname),
    (route) => {
      const granted = new URL(route.request().url()).pathname.split("/")[4] === ACTIVE;
      return route.fulfill({
        status: granted ? 200 : 404,
        body: granted ? GRANT : DENY,
        contentType: "application/json",
        headers: { "cache-control": "private, no-store" },
      });
    },
  );
  await page.route(
    (url) => /^\/api\/sessions\/[^/]+\/leave$/.test(url.pathname),
    async (route) => {
      const request = route.request();
      const { pathname, searchParams } = new URL(request.url());
      leaves.push({
        path: pathname,
        tenant: searchParams.get("tenant"),
        csrf: request.headers()["x-csrf-token"],
        body: request.postDataJSON() as unknown,
      });
      const reply = replies[leaves.length - 1] ?? "abort";
      await hold;
      if (reply === "abort") return route.abort("failed");
      if (reply === 200) {
        const rest = ROWS.filter((r) => !pathname.includes(`/${r.sessionId}/`));
        api.reply("meSessions", ok({ sessions: rest, truncated: false }));
      }
      return route.fulfill({ status: reply, body: BODY[reply], contentType: "application/json" });
    },
  );
  await page.goto("/me/sessions");
  return { leaves, urls };
}

const leave = (page: Page) => page.getByRole("button", { name: "Rời buổi", exact: true });
const press = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
const row = (page: Page, area: string) => page.getByRole("listitem").filter({ hasText: area });
const said = (page: Page) => page.getByText("Bạn đã rời buổi này.");
/** Opens the first control (Quận 1) to its confirm step and returns the Confirm button. */
async function arm(page: Page) {
  await leave(page).first().click();
  return press(page, "Xác nhận");
}
/** The page does not poll: 500 ms without traffic means every read has landed. */
const settle = (page: Page) => page.waitForLoadState("networkidle");
const contexts = (urls: string[]) =>
  urls
    .filter((p) => p.endsWith("/chat-context"))
    .map((p) => p.split("/")[4])
    .sort();

test.describe("my sessions leave control", () => {
  test("fan-out: only the seat rows of the active club get the control; one read per seat club", async ({
    page,
  }) => {
    const { urls } = await open(page);
    await expect(leave(page)).toHaveCount(2);
    await settle(page);
    await expect(row(page, "Quận 1").getByRole("button")).toHaveText("Rời buổi");
    await expect(row(page, "Quận 2").getByRole("button")).toHaveText("Rời buổi");
    await expect(row(page, "Quận 3")).toBeVisible(); // the guest club answered 404: fail closed
    await expect(row(page, "Quận 3").getByRole("button")).toHaveCount(0);
    await expect(row(page, "Quận 4")).toBeVisible(); // pending: no control, and its club is not read
    await expect(row(page, "Quận 4").getByRole("button")).toHaveCount(0);
    expect(contexts(urls)).toEqual(["club-e2e", "club-e2e-2"]);
    expect(urls.filter((p) => p === "/api/auth/session")).toHaveLength(1); // one read for the list
  });

  test("leave 200: one POST with { commandId } and the CSRF header, then the reloaded list", async ({
    page,
  }) => {
    const { leaves, urls } = await open(page, [200]);
    await (await arm(page)).click();
    await expect(said(page)).toBeVisible();
    await expect(leave(page)).toHaveCount(1); // the reloaded list keeps only Quận 2's control...
    await expect(row(page, "Quận 1")).toHaveCount(0); // ...and no longer has the left seat
    await settle(page);
    const path = "/api/sessions/sess-e2e-1/leave";
    expect(leaves).toEqual([{ path, tenant: TENANT_ID, csrf: "e2e-csrf-secret", body: COMMAND }]);
    expect(contexts(urls)).toEqual(["club-e2e", "club-e2e-2"]); // no second read of a club already read
  });

  test("409 LEAVE_REQUIRES_HOST: the host-only alert, the row stays, no retry control", async ({
    page,
  }) => {
    const { leaves } = await open(page, [409]);
    await (await arm(page)).click();
    const seat = row(page, "Quận 1");
    await expect(seat.getByRole("alert")).toHaveText(HOST_ONLY);
    await expect(seat.getByRole("button")).toHaveCount(0); // neither Try again nor Confirm: final
    expect(leaves).toHaveLength(1);
  });

  test("an aborted POST is uncertain: Try again replays the SAME commandId", async ({ page }) => {
    const { leaves } = await open(page, ["abort", 200]);
    await (await arm(page)).click();
    await press(page, "Thử lại").click(); // the shared mapper's CLIENT_NETWORK_ERROR notice
    await expect(said(page)).toBeVisible();
    expect(leaves.map((l) => l.body)).toEqual([COMMAND, leaves[0]?.body]);
  });

  test("double tap on Confirm sends exactly one POST", async ({ page }) => {
    let release = () => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { leaves } = await open(page, [200], hold);
    await (await arm(page)).dblclick();
    await expect.poll(() => leaves.length).toBe(1);
    release();
    await expect(said(page)).toBeVisible();
    expect(leaves).toHaveLength(1);
  });

  test("offline: Confirm is disabled and no POST is sent", async ({ page }) => {
    const { leaves } = await open(page);
    const confirm = await arm(page);
    await page.context().setOffline(true);
    await expect(confirm).toBeDisabled();
    await confirm.click({ force: true });
    await page.waitForTimeout(250); // a POST would have reached the route by now
    expect(leaves).toHaveLength(0);
  });
});
