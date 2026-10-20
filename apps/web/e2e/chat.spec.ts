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
const MODERATION = /hide|restore|moderat|ẩn tin|khôi phục|kiểm duyệt/i;
const viewer = { canModerate: true, canPostRestricted: true };
const page1 = (...messages: object[]) => ok({ messages, nextCursor: null });
const unread = (n: number) => ok({ channels: [mock.channel({ unreadCount: n })], viewer });
type Replies = Parameters<typeof mock.installChatApi>[1];
type Role = "owner" | "member";

/** Opens `url` in English: the tenant locale and the remembered plx-lang agree. */
async function open(page: Page, url: string, replies: Replies = {}, role: Role = "owner") {
  await page.addInitScript(() => window.localStorage.setItem("plx-lang", "en"));
  const chat = await mock.installChatApi(page, replies, { role, locale: "en" });
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

  for (const status of [500, 200]) {
    test(`unread badge after a ${status} read`, async ({ page }) => {
      const chat = await open(page, LIST, { channels: unread(3) });
      const general = page.getByRole("link", { name: /Chung/ });
      await expect(general).toHaveText(/3\s*unread/);
      if (status === 500) chat.failNext("read", fail("INTERNAL_ERROR", 500));
      await general.click();
      await expect.poll(() => chat.callsTo("read").length).toBeGreaterThan(0);
      // The list shows only what the server returns: its cursor moves on a 200 read, never on a 500.
      if (status === 200) chat.reply("channels", unread(0));
      else await page.waitForTimeout(500);
      await page.getByRole("link", { name: "Go back" }).click();
      if (status === 500) await expect(general).toHaveText(/3\s*unread/);
      else await expect(page.getByRole("link", { name: "Chung", exact: true })).toBeVisible();
    });
  }

  for (const role of ["owner", "member"] as const) {
    test(`${role}: only Edit, Delete (own) and Reply; no moderation`, async ({ page }) => {
      const urls: string[] = [];
      page.on("request", (request) => urls.push(request.url()));
      await open(page, VIEW, {}, role);
      await expect(rows(page)).toHaveCount(2);
      const names = await page.getByRole("log").getByRole("button").allInnerTexts();
      expect(names.sort()).toEqual(["Delete", "Edit", "Reply", "Reply"]);
      await expect(page.locator("button, a").filter({ hasText: MODERATION })).toHaveCount(0);
      expect(urls.filter((url) => url.includes("/moderation"))).toEqual([]);
    });
  }

  test("admins_only hint keeps the composer usable; nav entry links to chat", async ({ page }) => {
    const history = page1(mock.message({ channelId: mock.ADMINS_CHANNEL_ID }));
    await open(page, `${LIST}/${mock.ADMINS_CHANNEL_ID}`, { history }, "member");
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

  test("privacy: no chat URL, text or author label in caches or storage", async ({ page }) => {
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
    await page.waitForTimeout(500);
    const { names, entries } = await page.evaluate(async () => {
      const names = [...Object.entries(localStorage), ...Object.entries(sessionStorage)].flat();
      const entries: [string, string][] = []; // [url, body] of every cached response
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        for (const request of await cache.keys())
          entries.push([request.url, (await (await cache.match(request))?.text()) ?? ""]);
      }
      names.push(...(await indexedDB.databases()).map((db) => db.name ?? ""));
      return { names, entries };
    });
    // A cached static chunk holds the client's route literal; only a cached /api/chat URL or storage entry leaks.
    const named = [...names, ...entries.map(([url]) => url)];
    expect(named.filter((name) => name.includes("/api/chat"))).toEqual([]);
    const all = [...named, ...entries.map(([, body]) => body)].join("\n");
    const secrets = [mock.message().body, MINE, SENT, EDITED];
    expect(secrets.filter((text) => all.includes(text))).toEqual([]);
    expect(all).not.toMatch(/\b(Lan|Minh)\b/);
  });
});
