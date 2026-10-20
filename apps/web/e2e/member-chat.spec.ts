import { expect, test, type Page } from "@playwright/test";
import * as mock from "./support/chat-api-mock";
import { SCREENS, installPlayerApi, ok } from "./support/player-api-mock";
import { TENANT_ID } from "./support/session-api-mock";

/**
 * L16c member chat, mocked with the real shapes: a member session lists NO tenant, so the tenant id
 * comes only from the chat-context route stubbed below (real envelope, statuses and headers).
 */
const SLUG = "club-e2e"; // the ACTIVE club of the clubs mock; its guest club is club-e2e-2
const ROOT = `/me/clubs/${SLUG}/chat`;
const VIEW = `${ROOT}/${mock.CHANNEL_ID}`;
const CLUB_LABEL = "CLB Cầu Lông Test"; // the clubs mock's label of the active club
const SENT = "Em ra sân lúc 18h";
const envelope = (data: unknown, error: unknown) =>
  JSON.stringify({ data, error, meta: { requestId: "req-e2e" } });
const GRANT = envelope({ tenantId: TENANT_ID, timezone: "Asia/Ho_Chi_Minh" }, null);
const DENY = envelope(null, { code: "NOT_FOUND", message: "Không tìm thấy.", statusCode: 404 });
type Replies = Parameters<typeof mock.installChatApi>[1];

/** chat-context: 200 for the active club, ONE 404 body for any other slug; `failures` go first. */
async function stubContext(page: Page, failures: number[]) {
  const slugs: string[] = [];
  await page.route("**/api/me/clubs/*/chat-context", (route) => {
    const slug = new URL(route.request().url()).pathname.split("/")[4] ?? "";
    slugs.push(slug);
    const status = failures.shift() ?? (slug === SLUG ? 200 : 404);
    const headers = { "cache-control": "private, no-store" };
    if (status === 500) return route.fulfill({ status, headers }); // the real 500: no body, no content-type
    const body = status === 200 ? GRANT : DENY;
    return route.fulfill({ status, body, headers, contentType: "application/json" });
  });
  return slugs;
}

/** Opens `url` as a signed-in plain member, in English (the stored language, as chat.spec.ts). */
async function open(page: Page, url: string, replies: Replies = {}, failures: number[] = []) {
  await page.addInitScript(() => window.localStorage.setItem("plx-lang", "en"));
  const chat = await mock.installChatApi(page, replies, { persona: "member", locale: "en" });
  await installPlayerApi(page, SCREENS["me clubs"]?.cells.ready?.replies, { signedIn: false });
  const slugs = await stubContext(page, failures);
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto(url);
  return { chat, slugs, requests };
}
const field = (page: Page) => page.getByRole("textbox", { name: "Message", exact: true });
const press = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
const rows = (page: Page) => page.getByRole("log").getByRole("listitem");
const club = (page: Page, label: string) => page.getByRole("listitem").filter({ hasText: label });
const state = (page: Page) => page.locator("main[data-state]"); // the gate's root, not the L16 div
const chatCalls = (requests: string[]) => requests.filter((url) => url.includes("/api/chat"));

test("ME-1 /me/clubs: the Chat entry is on the active row only", async ({ page }) => {
  await open(page, "/me/clubs");
  await expect(club(page, "CLB Khách Test")).toBeVisible(); // loaded: the next check is not vacuous
  await expect(club(page, "CLB Khách Test").getByRole("link")).toHaveCount(0);
  const entry = club(page, CLUB_LABEL).getByRole("link", { name: "Chat", exact: true });
  await expect(entry).toHaveAttribute("href", ROOT);
});

test("ME-2/3 the entry opens the list under /me; a channel opens and sends", async ({ page }) => {
  const { chat } = await open(page, "/me/clubs");
  await club(page, CLUB_LABEL).getByRole("link", { name: "Chat", exact: true }).click();
  await expect(page).toHaveURL(ROOT);
  const general = page.getByRole("link", { name: mock.TITLE.general });
  await expect(general).toHaveAttribute("href", VIEW);
  await general.click();
  await expect(page).toHaveURL(VIEW);
  await field(page).fill(SENT);
  await press(page, "Send").click();
  await expect(rows(page).filter({ hasText: SENT })).toHaveCount(1);
  expect(chat.callsTo("send")).toHaveLength(1);
  // the member session lists no tenant: every chat call names the one the context route returned
  expect(new Set(chat.calls.map((call) => call.query.get("tenant")))).toEqual(new Set([TENANT_ID]));
});

test("ME-4 live: a stream frame refetches the history, renders nothing", async ({ page }) => {
  const { chat } = await open(page, VIEW);
  await expect(rows(page)).toHaveCount(2);
  const history = () => chat.callsTo("history").length;
  await expect.poll(history).toBe(2); // the load and the stream-open refetch are done
  const streamed = chat.stream.urls.map((url) => new URL(url).searchParams.get("tenant"));
  expect(new Set(streamed)).toEqual(new Set([TENANT_ID])); // the SSE subscribe is not in chat.calls
  const fresh = mock.message({ id: mock.MESSAGE_ID.live, body: "Mình ra sân rồi nhé" });
  const own = mock.message({ id: mock.MESSAGE_ID.mine, mine: true }); // the load's second row
  chat.reply("history", ok({ messages: [fresh, mock.message(), own], nextCursor: null }));
  // the frame names an id the refetched page does not hold: a row can only come from the page
  const messageId = mock.MESSAGE_ID.sent;
  await chat.stream.push({ type: "chat.message", channelId: mock.CHANNEL_ID, messageId });
  await expect.poll(history).toBe(3);
  await expect(page.getByText(fresh.body)).toBeVisible();
  await expect(rows(page)).toHaveCount(3); // the three fetched rows, none from the frame itself
});

for (const slug of ["club-e2e-2", "no-such-club"]) {
  test(`ME-5 deny: ${slug} shows the client's own copy, no chat request`, async ({ page }) => {
    const { slugs, requests } = await open(page, `/me/clubs/${slug}/chat`);
    await expect(state(page)).toHaveAttribute("data-state", "denied");
    await expect(page.getByText("You cannot open this club's chat.")).toBeVisible();
    await expect(page.getByText(/Không tìm thấy|Not found/)).toHaveCount(0); // never the server's text
    expect(slugs).toEqual([slug]); // one read, no retry loop
    expect(chatCalls(requests)).toEqual([]);
  });
}

test("ME-5 error: ONE 500 shows Retry; Retry reads again and the list loads", async ({ page }) => {
  const { slugs } = await open(page, ROOT, {}, [500]);
  await expect(state(page)).toHaveAttribute("data-state", "error");
  const alert = page.getByRole("alert").filter({ hasText: "Could not load the chat." });
  await expect(alert).toBeVisible();
  await press(page, "Retry").click();
  await expect(page.getByRole("link", { name: mock.TITLE.general })).toBeVisible();
  expect(slugs).toEqual([SLUG, SLUG]);
});

test("ME-6 privacy: no tenant id, label or chat text leaks anywhere", async ({ page }) => {
  const logged: string[] = []; // console text and request URLs, searched like the caches
  const urls: string[] = [];
  page.on("console", (entry) => logged.push(entry.text()));
  page.on("framenavigated", (frame) => urls.push(frame.url()));
  const { chat, requests } = await open(page, "/me/clubs"); // the club label is on this page
  await club(page, CLUB_LABEL).getByRole("link", { name: "Chat", exact: true }).click();
  await page.getByRole("link", { name: mock.TITLE.general }).click();
  await expect(page).toHaveURL(VIEW);
  const worker = () =>
    page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.state);
  await expect.poll(worker, { timeout: 15_000 }).toBe("activated");
  await page.reload();
  const controlled = () => page.evaluate(() => navigator.serviceWorker.controller !== null);
  await expect.poll(controlled).toBe(true);
  await field(page).fill(SENT);
  await press(page, "Send").click();
  await expect(rows(page).filter({ hasText: SENT })).toHaveCount(1);
  expect(chat.callsTo("send")).toHaveLength(1);
  const { names, entries, where } = await page.evaluate(async () => {
    const names = [...Object.entries(localStorage), ...Object.entries(sessionStorage)].flat();
    const entries: [string, string][] = []; // [url, body] of every cached response
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys())
        entries.push([request.url, (await (await cache.match(request))?.text()) ?? ""]);
    }
    return { names, entries, where: `${location.href}\n${JSON.stringify(history.state)}` };
  });
  expect(await page.evaluate(async () => (await indexedDB.databases()).length)).toBe(0);
  expect(entries.map(([url]) => new URL(url).pathname)).toContain("/offline"); // control: not vacuous
  // the chat API's own request URLs carry ?tenant=<uuid> by design (as on /c/**): cut there only
  for (const url of requests) {
    const bare = new URL(url).pathname.startsWith("/api/chat/") ? url.replace(TENANT_ID, "") : url;
    logged.push(bare, ...new URL(bare).searchParams.values()); // the query values, decoded
  }
  expect(urls.filter((url) => url.includes("?"))).toEqual([]); // the slug and channel id only
  const named = [...names, ...entries.map(([url]) => url)];
  expect(named.filter((name) => /\/api\/(chat|me)\//.test(name))).toEqual([]);
  const all = [...named, ...entries.map(([, body]) => body), ...logged, ...urls, where].join("\n");
  const secrets = [TENANT_ID, CLUB_LABEL, SENT, mock.message().body];
  secrets.push(...Object.values(mock.TITLE), ...Object.values(mock.LABEL));
  expect(secrets.filter((text) => all.includes(text))).toEqual([]);
});
