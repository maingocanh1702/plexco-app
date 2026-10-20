import { expect, test, type Page } from "@playwright/test";
import * as mock from "./support/chat-api-mock";
import { NETWORK, fail, ok } from "./support/player-api-mock";
import { TENANT_ID } from "./support/session-api-mock";

/** L16 chat UI in a real browser; every /api/chat call is mocked (support/chat-api-mock.ts). */
const LIST = `/c/${TENANT_ID}/chat`;
const VIEW = `${LIST}/${mock.CHANNEL_ID}`;
const MINE = "Mình tới sớm nhé"; // the body of the mock's own history row
const SENT = "Em ra sân lúc 18h";
const EDITED = "Mình tới sớm nhé, 15 phút";
const CURSOR = "v1.b2xkZXI"; // the real format is "v1." + base64url (lib/chat-route.ts)
const MODERATION = /hide|restore|moderat|ẩn tin|khôi phục|kiểm duyệt/i;
const viewer = { canModerate: true, canPostRestricted: true };
const page1 = (...messages: object[]) => ok({ messages, nextCursor: null });
const unread = (n: number) => ok({ channels: [mock.channel({ unreadCount: n })], viewer });
type Replies = Parameters<typeof mock.installChatApi>[1];
type Role = "owner" | "co_admin" | "member";

/** Opens `url` in English: the tenant locale and the remembered plx-lang agree. */
async function open(page: Page, url: string, replies: Replies = {}, role: Role = "owner") {
  await page.addInitScript(() => window.localStorage.setItem("plx-lang", "en"));
  const chat = await mock.installChatApi(page, replies, { persona: role, locale: "en" });
  await page.goto(url);
  return chat;
}
const field = (page: Page) => page.getByRole("textbox", { name: "Message", exact: true });
const press = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
const rows = (page: Page) => page.getByRole("log").getByRole("listitem");
const mine = (page: Page) => rows(page).filter({ hasText: MINE });

test.describe("chat web UI (mocked API)", () => {
  test("send: pending while the POST is held, then confirmed", async ({ page }) => {
    const chat = await open(page, VIEW);
    const release = chat.holdNext("send");
    await field(page).fill(SENT);
    await press(page, "Send").click();
    await expect(page.getByText("Sending...")).toBeVisible();
    release();
    await expect(page.getByText("Sending...")).toHaveCount(0);
    await expect(rows(page).filter({ hasText: SENT })).toHaveCount(1);
  });

  test("failed send shows Retry; Retry reuses the same clientMsgId", async ({ page }) => {
    const chat = await open(page, VIEW);
    chat.failNext("send", NETWORK);
    await field(page).fill(SENT);
    await press(page, "Send").click();
    await expect(page.getByRole("alert").filter({ hasText: "Not sent." })).toBeVisible();
    await press(page, "Retry").click();
    await expect.poll(() => chat.callsTo("send").length).toBe(2);
    const [first, again] = chat.callsTo("send").map((call) => JSON.stringify(call.body));
    expect(first).toMatch(/client_?msg_?id/i);
    expect(first).toContain(SENT);
    expect(again).toBe(first);
    await expect(page.getByText("Sending...")).toHaveCount(0);
    await expect(rows(page).filter({ hasText: SENT })).toHaveCount(1);
    expect(chat.callsTo("send")).toHaveLength(2);
  });

  test("edit own: a closed window shows the 5.2.3 message", async ({ page }) => {
    const chat = await open(page, VIEW);
    chat.failNext("edit", fail("CHAT_EDIT_WINDOW_CLOSED", 409));
    await mine(page).getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByRole("textbox", { name: "Edit" }).fill(EDITED);
    await press(page, "Save").click();
    await expect(page.getByText("This message can no longer be edited.")).toBeVisible();
    expect(chat.callsTo("edit")).toHaveLength(1);
  });

  test("tombstones render only the removed text", async ({ page }) => {
    const hidden = mock.tombstone({ id: mock.MESSAGE_ID.live, tombstone: "moderation_hidden" });
    await open(page, VIEW, { history: page1(hidden, mock.message(), mock.tombstone()) });
    const gone = rows(page).filter({ hasText: "Message removed." });
    await expect(gone).toHaveText(["Message removed.", "Message removed."]);
    await expect(rows(page)).toHaveCount(3);
  });

  test("older page AUTH_REQUIRED: the screen takes its own error row", async ({ page }) => {
    const history = ok({ messages: [mock.message()], nextCursor: CURSOR });
    const chat = await open(page, VIEW, { history });
    chat.replyOlder(fail("AUTH_REQUIRED", 401)); // only a request carrying the cursor gets it
    await expect.poll(() => chat.callsTo("history").length).toBe(2);
    await press(page, "Show older messages").click();
    await expect(page.locator("[data-state]")).toHaveAttribute("data-state", "error");
    await expect(page.getByRole("link", { name: "Sign in again" })).toBeVisible();
    expect(chat.callsTo("history").at(-1)?.query.get("cursor")).toBe(CURSOR);
  });

  for (const status of [500, 200]) {
    const name = status === 200 ? "read posts on mount" : `unread badge after a ${status} read`;
    test(name, async ({ page }) => {
      const chat = await open(page, LIST, { channels: unread(3) });
      const title = mock.TITLE.general;
      const general = page.getByRole("link", { name: title });
      await expect(general).toHaveText(/3\s*unread/);
      if (status === 500) chat.failNext("read", fail("INTERNAL_ERROR", 500));
      await general.click();
      await expect.poll(() => chat.callsTo("read").length).toBeGreaterThan(0);
      // The list shows only what the server returns: its cursor moves on a 200 read, never on a 500.
      if (status === 200) chat.reply("channels", unread(0));
      else await page.waitForTimeout(500);
      await page.getByRole("link", { name: "Go back" }).click();
      if (status === 500) await expect(general).toHaveText(/3\s*unread/);
      else await expect(page.getByRole("link", { name: title, exact: true })).toBeVisible();
    });
  }

  for (const role of ["owner", "co_admin"] as const) {
    test(`${role}: only Edit, Delete (own) and Reply; no moderation`, async ({ page }) => {
      const urls: string[] = [];
      page.on("request", (request) => urls.push(request.url()));
      await open(page, VIEW, {}, role);
      await expect(rows(page)).toHaveCount(2);
      const names = await page.getByRole("log").getByRole("button").allInnerTexts();
      expect(names.sort()).toEqual(["Delete", "Edit", "Reply", "Reply"]);
      await expect(page.getByRole("button", { name: MODERATION })).toHaveCount(0);
      await expect(page.getByRole("menuitem", { name: MODERATION })).toHaveCount(0);
      await expect(page.getByRole("link", { name: MODERATION })).toHaveCount(0);
      expect(urls.filter((url) => url.includes("/moderation"))).toEqual([]);
    });
  }

  test("plain member: the club workspace shows No access (no member chat entry yet)", async ({
    page,
  }) => {
    const urls: string[] = [];
    page.on("request", (request) => urls.push(request.url()));
    await open(page, LIST, {}, "member");
    // The shell's 403 stays vi: it cannot read the locale of a club the session does not list.
    await expect(page.getByRole("heading", { name: "Không có quyền truy cập" })).toBeVisible();
    expect(urls.filter((url) => url.includes("/api/chat"))).toEqual([]);
  });

  test("admins_only hint keeps the composer usable; nav entry links to chat", async ({ page }) => {
    const history = page1(mock.message({ channelId: mock.ADMINS_CHANNEL_ID }));
    await open(page, `${LIST}/${mock.ADMINS_CHANNEL_ID}`, { history }, "co_admin");
    await expect(page.getByText("Only admins can post in this channel")).toBeVisible();
    await field(page).fill("Cho mình hỏi chút");
    await expect(press(page, "Send")).toBeEnabled();
    const entry = page.getByRole("link", { name: "Chat", exact: true }).first();
    await expect(entry).toHaveAttribute("href", LIST);
  });

  test("live: a stream frame refetches; the frame renders nothing", async ({ page }) => {
    const chat = await open(page, VIEW);
    await expect(rows(page)).toHaveCount(2);
    const history = () => chat.callsTo("history").length;
    await expect.poll(history).toBe(2); // the load and the stream-open refetch are done
    const own = mock.message({ id: mock.MESSAGE_ID.mine, mine: true, body: MINE });
    const fresh = mock.message({ id: mock.MESSAGE_ID.live, body: "Mình ra sân rồi nhé" });
    chat.reply("history", page1(fresh, mock.message(), own)); // the same two rows plus the new one
    // the frame names an id that the refetched page does not hold, so a row can only come from the page
    await chat.stream.push({
      type: "chat.message",
      channelId: mock.CHANNEL_ID,
      messageId: mock.MESSAGE_ID.sent,
    });
    await expect.poll(history).toBe(3);
    await expect(page.getByText(fresh.body)).toBeVisible();
    await expect(rows(page)).toHaveCount(3);
  });

  test("delete own: Go back sends nothing, Delete sends one DELETE", async ({ page }) => {
    const chat = await open(page, VIEW);
    const dialog = page.getByRole("dialog", { name: "Delete this message?" });
    const del = () => mine(page).getByRole("button", { name: "Delete", exact: true });
    await del().click();
    await dialog.getByRole("button", { name: "Go back" }).click();
    await expect(dialog).toBeHidden();
    expect(chat.callsTo("remove")).toHaveLength(0);
    await del().click();
    await dialog.getByRole("button", { name: "Delete", exact: true }).click();
    await expect.poll(() => chat.callsTo("remove").length).toBe(1);
    await expect(page.getByText("Message removed.")).toBeVisible();
    await expect(page.getByText(MINE)).toHaveCount(0);
  });

  test("privacy: no cached chat URL; no chat text, label, title or id leaks", async ({ page }) => {
    const logged: string[] = []; // every console text and request URL, searched like the caches
    page.on("console", (entry) => logged.push(entry.text()));
    page.on("request", (request) => logged.push(request.url()));
    const chat = await open(page, VIEW);
    const worker = () =>
      page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.state);
    await expect.poll(worker, { timeout: 15_000 }).toBe("activated");
    await page.reload();
    const controlled = () => page.evaluate(() => navigator.serviceWorker.controller !== null);
    await expect.poll(controlled).toBe(true);
    await field(page).fill(SENT);
    await press(page, "Send").click();
    await mine(page).getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByRole("textbox", { name: "Edit" }).fill(EDITED);
    await press(page, "Save").click();
    await expect.poll(() => chat.callsTo("edit").length).toBe(1);
    expect(chat.callsTo("send")).toHaveLength(1);
    const clientMsgId = String(chat.callsTo("send")[0]?.body?.clientMsgId);
    expect(clientMsgId).toMatch(/^[0-9a-f-]{36}$/); // a real uuid, never "undefined"
    await page.waitForTimeout(500);
    const { names, entries } = await page.evaluate(async () => {
      const names = [...Object.entries(localStorage), ...Object.entries(sessionStorage)].flat();
      const entries: [string, string][] = []; // [url, body] of every cached response
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        for (const request of await cache.keys())
          entries.push([request.url, (await (await cache.match(request))?.text()) ?? ""]);
      }
      return { names, entries };
    });
    expect(await page.evaluate(async () => (await indexedDB.databases()).length)).toBe(0);
    // A cached static chunk holds the client's route literal; only a cached /api/chat URL or storage entry leaks.
    const named = [...names, ...entries.map(([url]) => url)];
    expect(named.filter((name) => name.includes("/api/chat"))).toEqual([]);
    const all = [...named, ...entries.map(([, body]) => body), ...logged].join("\n");
    const chatText = [mock.message().body, MINE, SENT, EDITED, clientMsgId];
    const secrets = [...chatText, ...Object.values(mock.TITLE), ...Object.values(mock.LABEL)];
    expect(secrets.filter((text) => all.includes(text))).toEqual([]);
  });
});
