import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, type Page, type Route } from "@playwright/test";
import type { ChatChannelDto, ChatLiveMessageDto, ChatTombstoneDto } from "@plexco/core";
import { fail, ok, type Reply } from "./player-api-mock";
import { TENANT_ID, installApiMock, signIn, type RecordedCall } from "./session-api-mock";

const ROUTES = {
  channels: ["GET", /^\/api\/chat\/channels$/],
  history: ["GET", /^\/api\/chat\/channels\/[^/]+\/messages$/],
  send: ["POST", /^\/api\/chat\/channels\/[^/]+\/messages$/],
  edit: ["PATCH", /^\/api\/chat\/channels\/[^/]+\/messages\/[^/]+$/],
  remove: ["DELETE", /^\/api\/chat\/channels\/[^/]+\/messages\/[^/]+$/],
  read: ["POST", /^\/api\/chat\/channels\/[^/]+\/read$/],
} as const satisfies Record<string, readonly [string, RegExp]>;
/** The stubbable routes; moderation and any other /api/chat path answer 500 E2E_NOT_STUBBED. */
export type ChatRouteKey = keyof typeof ROUTES;
const KEYS = Object.keys(ROUTES) as ChatRouteKey[];

/** Lowercase v4-shaped uuids: the chat stream parser accepts lowercase ids only. */
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
export const CHANNEL_ID = id(1);
export const ADMINS_CHANNEL_ID = id(2);
/** peer/mine fill the default history (peer newest); sent/live/gone are spare ids for a spec. */
export const MESSAGE_ID = { peer: id(11), mine: id(12), sent: id(13), live: id(14), gone: id(15) };
/** Rare tokens on purpose: the privacy e2e searches whole bundles for them. */
export const TITLE = { general: "Chung Qx7", admins: "Thông báo Zk4" } as const;
export const LABEL = { peer: "Lan Vq3", me: "Minh Jt5" } as const;

/** Fixtures carry exactly the DTO keys (the client's exact-key guards reject any other shape). */
export const channel = (over: Partial<ChatChannelDto> = {}): ChatChannelDto => ({
  id: CHANNEL_ID,
  title: TITLE.general,
  sortOrder: 0,
  isDefault: true,
  postPolicy: "all_members",
  unreadCount: 0,
  ...over,
});
export const message = (over: Partial<ChatLiveMessageDto> = {}): ChatLiveMessageDto => ({
  id: MESSAGE_ID.peer,
  channelId: CHANNEL_ID,
  authorType: "person",
  mine: false,
  authorLabel: LABEL.peer,
  body: "Chiều nay mọi người có tới sớm không?",
  replyToMessageId: null,
  editedAt: null,
  editCount: 0,
  tombstone: null,
  createdAt: ago(2),
  ...over,
});
export const tombstone = (over: Partial<ChatTombstoneDto> = {}): ChatTombstoneDto => ({
  id: MESSAGE_ID.gone,
  channelId: CHANNEL_ID,
  createdAt: ago(3),
  tombstone: "author_deleted",
  ...over,
});

const ready = (privileged: boolean): Record<ChatRouteKey, Reply> => ({
  channels: ok({
    channels: [
      channel(),
      channel({
        id: ADMINS_CHANNEL_ID,
        title: TITLE.admins,
        isDefault: false,
        postPolicy: "admins_only",
      }),
    ],
    viewer: { canModerate: privileged, canPostRestricted: privileged },
  }),
  history: ok({
    messages: [
      message(),
      message({ id: MESSAGE_ID.mine, mine: true, authorLabel: LABEL.me, body: "Mình tới sớm nhé" }),
    ],
    nextCursor: null,
  }),
  send: ok({ id: MESSAGE_ID.sent, createdAt: ago(0), duplicate: false }),
  edit: ok({ id: MESSAGE_ID.mine, editCount: 1, editedAt: ago(0), changed: true }),
  remove: ok({ id: MESSAGE_ID.mine, authorDeletedAt: ago(0), changed: true }),
  read: ok({}),
});

/** The one chat stream frame: a refetch hint, never content. */
export type ChatFrame = { type: "chat.message"; channelId: string; messageId: string };
/** What installChatApi returns: recorded calls, standing and one-shot replies, the held SSE stream. */
export type ChatApi = Awaited<ReturnType<typeof installChatApi>>;

/** Fulfils a Reply in the {data, error, meta} envelope; "network" drops the connection. */
function answer(route: Route, reply: Reply) {
  if (reply === "network") return route.abort("internetdisconnected");
  if ("raw" in reply) return route.fulfill({ status: reply.raw, body: "" });
  const failed = "error" in reply;
  return route.fulfill({
    status: failed ? reply.error.statusCode : 200,
    contentType: "application/json",
    body: JSON.stringify({
      data: failed ? null : reply.data,
      error: failed ? reply.error : null,
      meta: { requestId: "req-e2e" },
    }),
  });
}

/** installApiMock's session reply for a persona; like the real route it lists admin rows only. */
const session = (persona: string, locale: string) =>
  ok({
    personId: "p-e2e",
    expiresAt: "2099-01-01T00:00:00.000Z",
    csrfToken: "e2e-csrf-secret",
    tenants:
      persona === "member"
        ? []
        : [
            {
              tenantId: TENANT_ID,
              role: persona,
              slug: null,
              name: "CLB Cầu Lông Test",
              timezone: "Asia/Ho_Chi_Minh",
              locale,
            },
          ],
  });

/** Held local SSE server behind GET /api/chat/subscribe, as realtime-stream-mock.ts does. */
async function installChatStream(page: Page) {
  const held: ServerResponse[] = [];
  const urls: string[] = [];
  const server = createServer((_request, response) => {
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    });
    response.write(": hb\n\n");
    held.push(response);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  page.once("close", () => server.close() && server.closeAllConnections());
  const { port } = server.address() as AddressInfo;
  await page.route("**/api/chat/subscribe**", (route) => {
    urls.push(route.request().url());
    return route.continue({ url: `http://127.0.0.1:${port}/subscribe` });
  });
  return {
    urls,
    async push(frame: ChatFrame) {
      await expect.poll(() => held.length).toBeGreaterThan(0);
      held.at(-1)!.write(`data: ${JSON.stringify(frame)}\n\n`);
    },
  };
}

/** Signs in as `persona`, answers /api/chat (`replies` over the defaults), holds one SSE stream. */
export async function installChatApi(
  page: Page,
  replies: Partial<Record<ChatRouteKey, Reply>> = {},
  opts: { persona?: "owner" | "co_admin" | "member"; locale?: "vi" | "en" } = {},
) {
  const { persona = "owner", locale = "vi" } = opts;
  await signIn(page.context());
  await installApiMock(page, [], { locale });
  if (persona !== "owner")
    await page.route("**/api/auth/session", (route) => answer(route, session(persona, locale)));
  // owner and co_admin hold both chat capabilities (preset 0047:85-86); a plain member neither
  const standing: Partial<Record<ChatRouteKey, Reply>> = {
    ...ready(persona !== "member"),
    ...replies,
  };
  const once: Partial<Record<ChatRouteKey, Reply[]>> = {};
  let cursorReply: Reply | undefined; // answers every history request that carries a cursor
  const holds: Partial<Record<ChatRouteKey, Promise<void>[]>> = {};
  const calls: (RecordedCall & { key: ChatRouteKey })[] = [];
  const stream = await installChatStream(page);

  // Registered after the stream route: it sees every /api/chat request first and hands subscribe on.
  await page.route("**/api/chat/**", async (route) => {
    const request = route.request();
    const { pathname, searchParams } = new URL(request.url());
    if (pathname === "/api/chat/subscribe") return route.fallback();
    const method = request.method();
    const key = KEYS.find((k) => ROUTES[k][0] === method && ROUTES[k][1].test(pathname));
    if (!key) return answer(route, fail("E2E_NOT_STUBBED", 500));
    const body = request.postDataJSON() as Record<string, unknown> | null;
    calls.push({ key, method, path: pathname, query: searchParams, body });

    await holds[key]?.shift();
    const older = key === "history" && searchParams.has("cursor") ? cursorReply : undefined;
    return answer(
      route,
      older ?? once[key]?.shift() ?? standing[key] ?? fail("E2E_NOT_STUBBED", 500),
    );
  });
  return {
    calls,
    callsTo: (key: ChatRouteKey) => calls.filter((c) => c.key === key),
    reply: (key: ChatRouteKey, reply: Reply) => (standing[key] = reply),
    replyOlder: (reply: Reply) => (cursorReply = reply),
    failNext: (key: ChatRouteKey, reply: Reply) => (once[key] ??= []).push(reply),
    holdNext(key: ChatRouteKey) {
      let release: () => void = () => {};
      (holds[key] ??= []).push(new Promise<void>((resolve) => (release = resolve)));
      return release;
    },
    stream,
  };
}
