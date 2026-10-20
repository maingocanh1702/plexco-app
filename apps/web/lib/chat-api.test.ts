import { readFileSync } from "node:fs";
import type { ChatChannelDto, ChatLiveMessageDto, ChatTombstoneDto } from "@plexco/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CLIENT_BAD_RESPONSE, CLIENT_NETWORK_ERROR } from "./api-client";
import * as chatApi from "./chat-api";
import {
  deleteMessage,
  editMessage,
  listChannels,
  listHistory,
  markRead,
  moderateMessage,
  sendMessage,
} from "./chat-api";

const TENANT = "11111111-1111-4111-8111-111111111111";
const CHANNEL = "22222222-2222-4222-8222-222222222222";
const MESSAGE = "33333333-3333-4333-8333-333333333333";
const CLIENT_MSG = "44444444-4444-4444-8444-444444444444";
const REPLY = "55555555-5555-4555-8555-555555555555";
const COMMAND = "88888888-8888-4888-8888-888888888888";
const CTX = { tenantId: TENANT, csrfToken: "csrf-secret" };
const CURSOR = "v1.MjAyNi0xMC0yMCAxMDowMDowMC4xMjM0NTYrMDB8YWJj";

const CHANNEL_ROW: ChatChannelDto = {
  id: CHANNEL,
  title: "General",
  sortOrder: 0,
  isDefault: true,
  postPolicy: "all_members",
  unreadCount: 3,
};
const LIVE_ROW: ChatLiveMessageDto = {
  id: MESSAGE,
  channelId: CHANNEL,
  authorType: "person",
  mine: true,
  authorLabel: "An",
  body: "hello",
  replyToMessageId: null,
  editedAt: null,
  editCount: 0,
  tombstone: null,
  createdAt: "2026-10-20T10:00:00.000Z",
};
const TOMBSTONE_ROW: ChatTombstoneDto = {
  id: REPLY,
  channelId: CHANNEL,
  createdAt: "2026-10-20T09:00:00.000Z",
  tombstone: "author_deleted",
};
const SEND_OK = { id: MESSAGE, createdAt: "2026-10-20T10:00:00.000Z", duplicate: false };
const EDIT_OK = { id: MESSAGE, editCount: 1, editedAt: "2026-10-20T10:01:00.000Z", changed: true };
const DELETE_OK = { id: MESSAGE, authorDeletedAt: "2026-10-20T10:02:00.000Z", changed: true };
// The viewer a club admin gets from GET /api/chat/channels (L15b), and the all-false fail-closed one.
const VIEWER = { canModerate: true, canPostRestricted: false };
const NO_FLAGS = { canModerate: false, canPostRestricted: false };
// The moderation route answers exactly these three keys (never a body or another moderator).
const MODERATE_OK = { messageId: MESSAGE, moderationState: "hidden", changed: true };
// createdAt is deliberately not monotonic: the server's page order is kept, never re-sorted.
const PAGE = {
  messages: [
    TOMBSTONE_ROW,
    LIVE_ROW,
    { ...LIVE_ROW, id: "66666666-6666-4666-8666-666666666666", createdAt: "2026-10-20T08:00:00Z" },
    {
      ...TOMBSTONE_ROW,
      id: "77777777-7777-4777-8777-777777777777",
      tombstone: "moderation_hidden",
    },
  ],
  nextCursor: CURSOR,
};

const envelope = (data: unknown) =>
  JSON.stringify({ data, error: null, meta: { requestId: "req_1" } });
const errorBody = (code: unknown, status: number) =>
  JSON.stringify({
    data: null,
    error: { code, message: "server text", statusCode: status },
    meta: { requestId: "req_1" },
  });

function stub(respond: () => Response | Promise<Response>) {
  const fn = vi.fn(async (_path: string, _init: RequestInit) => respond());
  vi.stubGlobal("fetch", fn);
  return fn;
}
const answer = (data: unknown) => stub(() => new Response(envelope(data), { status: 200 }));

/** What apiFetch handed to fetch for call `index`: the URL parts, the method, headers and JSON body. */
function sent(fn: { mock: { calls: unknown[][] } }, index = 0) {
  const [path, init] = fn.mock.calls[index] as [string, RequestInit];
  return {
    url: new URL(path, "http://localhost"),
    method: init.method,
    headers: new Headers(init.headers),
    body: typeof init.body === "string" ? (JSON.parse(init.body) as unknown) : undefined,
    signal: init.signal,
  };
}

// A failed call returns exactly {ok, code, status}, so no server text or row content leaks.
const failed = (code: string, status: number) => ({ ok: false, code, status });
const bad = (status: number) => failed(CLIENT_BAD_RESPONSE, status);
const res = (body: string | null, status: number) => () => new Response(body, { status });
const live = (patch: object) => ({ ...LIVE_ROW, ...patch });
const chan = (patch: object) => ({ ...CHANNEL_ROW, ...patch });
const without = (row: object, key: string) =>
  Object.fromEntries(Object.entries(row).filter(([k]) => k !== key));
const channels = (row: unknown) => ({ channels: [row] });
const history = (row: unknown) => ({ messages: [LIVE_ROW, row], nextCursor: null });

const CHANNEL_PATH = `/api/chat/channels/${CHANNEL}`;
// Expected request bodies; send/edit pass copies, so the client cannot mutate the expectation.
const SEND_BODY = { clientMsgId: CLIENT_MSG, body: "hello" };
const EDIT_BODY = { body: "edited", expectedEditCount: 0 };
// A hide for a reason that takes no note: the note goes out as an explicit JSON null, never "".
const HIDE_BODY = {
  action: "hide",
  reasonCode: "spam",
  reasonNote: null,
  commandId: COMMAND,
} as const;
const readChannels = () => listChannels(TENANT);
const readHistory = () => listHistory(TENANT, CHANNEL);
const send = () => sendMessage(CTX, CHANNEL, { ...SEND_BODY });
const edit = () => editMessage(CTX, CHANNEL, MESSAGE, { ...EDIT_BODY });
const remove = () => deleteMessage(CTX, CHANNEL, MESSAGE);
const read = () => markRead(CTX, CHANNEL, MESSAGE);
const moderate = () => moderateMessage(CTX, CHANNEL, MESSAGE, { ...HIDE_BODY });

// [name, method, path, call, answer data, expected request body]
const CALL_ROWS: [string, string, string, () => Promise<unknown>, unknown, unknown?][] = [
  [
    "listChannels",
    "GET",
    "/api/chat/channels",
    readChannels,
    { channels: [CHANNEL_ROW], viewer: VIEWER },
  ],
  ["listHistory", "GET", `${CHANNEL_PATH}/messages`, readHistory, PAGE],
  ["sendMessage", "POST", `${CHANNEL_PATH}/messages`, send, SEND_OK, SEND_BODY],
  ["editMessage", "PATCH", `${CHANNEL_PATH}/messages/${MESSAGE}`, edit, EDIT_OK, EDIT_BODY],
  ["deleteMessage", "DELETE", `${CHANNEL_PATH}/messages/${MESSAGE}`, remove, DELETE_OK],
  ["markRead", "POST", `${CHANNEL_PATH}/read`, read, {}, { throughMessageId: MESSAGE }],
  [
    "moderateMessage",
    "POST",
    `${CHANNEL_PATH}/messages/${MESSAGE}/moderation`,
    moderate,
    MODERATE_OK,
    HIDE_BODY,
  ],
];
const CALLS = CALL_ROWS.map(([name, method, path, run, data, body]) => ({
  name,
  method,
  path,
  run,
  data,
  body,
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("chat api request shape", () => {
  it.each(CALLS)(
    "$name: $method $path with the tenant and nothing else in the query",
    async ({ run, method, path, body, data }) => {
      const fn = answer(data);
      await expect(run()).resolves.toStrictEqual({ ok: true, data });
      const call = sent(fn);
      expect(call.method).toBe(method);
      expect(call.url.pathname).toBe(path);
      expect([...call.url.searchParams.entries()]).toStrictEqual([["tenant", TENANT]]);
      expect(call.body).toStrictEqual(body);
    },
  );

  it.each(CALLS)("$name: x-csrf-token only on a mutation", async ({ run, method, data }) => {
    const fn = answer(data);
    await run();
    expect(sent(fn).headers.get("x-csrf-token")).toBe(method === "GET" ? null : CTX.csrfToken);
  });

  it("omits the header without a session token (the server then answers CSRF_INVALID)", async () => {
    const fn = answer(DELETE_OK);
    await deleteMessage({ tenantId: TENANT, csrfToken: "" }, CHANNEL, MESSAGE);
    expect(sent(fn).headers.has("x-csrf-token")).toBe(false);
  });

  it("sends clientMsgId and body untouched, and a reply id only when given", async () => {
    const fn = answer(SEND_OK);
    const body = "  /help \n"; // no trim, and a leading slash stays plain text
    await sendMessage(CTX, CHANNEL, { clientMsgId: CLIENT_MSG, body });
    await sendMessage(CTX, CHANNEL, { clientMsgId: CLIENT_MSG, body, replyToMessageId: REPLY });
    expect(sent(fn, 0).body).toStrictEqual({ clientMsgId: CLIENT_MSG, body });
    expect(sent(fn, 1).body).toStrictEqual({
      clientMsgId: CLIENT_MSG,
      body,
      replyToMessageId: REPLY,
    });
    expect(sent(fn, 0).headers.get("content-type")).toBe("application/json");
  });

  it("a retry resends the identical id and body, and a duplicate answer is a success", async () => {
    const fn = answer({ ...SEND_OK, duplicate: true });
    const input = { clientMsgId: CLIENT_MSG, body: "again" };
    const first = await sendMessage(CTX, CHANNEL, input);
    const retry = await sendMessage(CTX, CHANNEL, input);
    expect(sent(fn, 1).body).toStrictEqual(sent(fn, 0).body);
    expect(first).toStrictEqual({ ok: true, data: { ...SEND_OK, duplicate: true } });
    expect(retry).toStrictEqual(first);
  });

  it("encodes the id path segments", async () => {
    const fn = answer(DELETE_OK);
    await deleteMessage(CTX, "a/b", "c?d");
    expect(sent(fn).url.pathname).toBe("/api/chat/channels/a%2Fb/messages/c%3Fd");
  });
});

describe("chat api history paging", () => {
  it("passes nextCursor back verbatim and never sends a limit", async () => {
    const fn = answer(PAGE);
    await listHistory(TENANT, CHANNEL, CURSOR);
    const { url } = sent(fn);
    expect(url.search).toBe(`?tenant=${TENANT}&cursor=${CURSOR}`);
    expect(url.searchParams.has("limit")).toBe(false);
  });

  it("a cursor with reserved characters survives intact and cannot add a parameter", async () => {
    const odd = "v1.a+b/c=d&limit=5 é";
    const fn = answer(PAGE);
    await listHistory(TENANT, CHANNEL, odd);
    const { url } = sent(fn);
    expect(url.searchParams.get("cursor")).toBe(odd);
    expect(url.searchParams.has("limit")).toBe(false);
  });

  it("a null cursor is the first page", async () => {
    const fn = answer({ messages: [], nextCursor: null });
    await listHistory(TENANT, CHANNEL, null);
    expect(sent(fn).url.search).toBe(`?tenant=${TENANT}`);
  });

  it("keeps the server's page order and accepts every valid row variant", async () => {
    answer(PAGE);
    const result = await listHistory(TENANT, CHANNEL);
    if (!result.ok) throw new Error("expected ok");
    expect(result.data.messages.map((m) => m.id)).toStrictEqual(PAGE.messages.map((m) => m.id));
    answer({
      messages: [
        live({ authorType: "system", authorLabel: null, replyToMessageId: REPLY }),
        live({ authorType: "assistant", editedAt: PAGE.messages[0]!.createdAt, editCount: 2 }),
      ],
      nextCursor: null,
    });
    await expect(listHistory(TENANT, CHANNEL)).resolves.toMatchObject({ ok: true });
    answer({
      channels: [chan({ postPolicy: "admins_only", unreadCount: 0 }), chan({ unreadCount: 100 })],
    });
    await expect(listChannels(TENANT)).resolves.toMatchObject({ ok: true });
  });
});

describe("chat api viewer flags (L15b)", () => {
  const withViewer = (viewer: unknown) => ({ channels: [CHANNEL_ROW], viewer });
  const listed = (viewer: unknown) => ({ ok: true, data: { channels: [CHANNEL_ROW], viewer } });

  it.each([
    VIEWER,
    NO_FLAGS,
    { canModerate: false, canPostRestricted: true },
    { canModerate: true, canPostRestricted: true },
  ])("a valid viewer %j is returned beside the channels", async (viewer) => {
    answer(withViewer(viewer));
    await expect(listChannels(TENANT)).resolves.toStrictEqual(listed(viewer));
  });

  // Whatever is wrong with `viewer`, the list still answers and no flag is granted: no partial trust
  // (a valid `true` beside a malformed flag is dropped too) and never an error that hides the channels.
  const CLOSED: [string, unknown][] = [
    ["a missing viewer", { channels: [CHANNEL_ROW] }],
    ["a null viewer", withViewer(null)],
    ["a string viewer", withViewer("yes")],
    ["a boolean viewer", withViewer(true)],
    ["an array viewer", withViewer([true, true])],
    ["an empty viewer", withViewer({})],
    ["a viewer missing canPostRestricted", withViewer({ canModerate: true })],
    ["a viewer missing canModerate", withViewer({ canPostRestricted: true })],
    ["a string canModerate", withViewer({ canModerate: "true", canPostRestricted: true })],
    ["a numeric canModerate", withViewer({ canModerate: 1, canPostRestricted: true })],
    ["a null canPostRestricted", withViewer({ canModerate: true, canPostRestricted: null })],
    [
      "an extra key inside viewer",
      withViewer({ canModerate: true, canPostRestricted: true, role: "owner" }),
    ],
  ];
  it.each(CLOSED)("%s: both flags false, the channel list still answers", async (_name, data) => {
    answer(data);
    await expect(listChannels(TENANT)).resolves.toStrictEqual(listed(NO_FLAGS));
  });

  it("drops every other data key: the answer carries exactly channels and viewer", async () => {
    answer({ ...withViewer(VIEWER), total: 1, role: "owner" });
    await expect(listChannels(TENANT)).resolves.toStrictEqual(listed(VIEWER));
  });

  it("a valid viewer never loosens the channel guard: a bad row still rejects the list", async () => {
    answer({ channels: [chan({ createdBy: "x" })], viewer: VIEWER });
    await expect(listChannels(TENANT)).resolves.toStrictEqual(bad(200));
  });
});

describe("chat api moderation call", () => {
  it("sends exactly the four keys untouched: a note verbatim, a null note as null", async () => {
    const fn = answer(MODERATE_OK);
    const reasonNote = "  synthetic moderation note  "; // padded on purpose: the sheet trims, this layer does not
    await moderateMessage(CTX, CHANNEL, MESSAGE, {
      action: "restore",
      reasonCode: "other",
      reasonNote,
      commandId: COMMAND,
    });
    await moderate();
    expect(sent(fn, 0).body).toStrictEqual({
      action: "restore",
      reasonCode: "other",
      reasonNote,
      commandId: COMMAND,
    });
    expect(sent(fn, 1).body).toStrictEqual(HIDE_BODY);
    expect(sent(fn, 0).headers.get("content-type")).toBe("application/json");
  });

  it("only the four keys go on the wire, whatever else the caller's object carries", async () => {
    const fn = answer(MODERATE_OK);
    const wide = { ...HIDE_BODY, messageText: "synthetic body", authorLabel: "An" };
    await moderateMessage(CTX, CHANNEL, MESSAGE, wide);
    expect(sent(fn).body).toStrictEqual(HIDE_BODY);
  });

  it("a retry resends the identical commandId and body; a no-op answer is a success", async () => {
    const fn = answer({ ...MODERATE_OK, changed: false });
    const first = await moderate();
    const retry = await moderate();
    expect(sent(fn, 1).body).toStrictEqual(sent(fn, 0).body);
    expect(first).toStrictEqual({ ok: true, data: { ...MODERATE_OK, changed: false } });
    expect(retry).toStrictEqual(first);
  });

  it("accepts the restore answer (visible)", async () => {
    answer({ ...MODERATE_OK, moderationState: "visible" });
    await expect(moderate()).resolves.toStrictEqual({
      ok: true,
      data: { ...MODERATE_OK, moderationState: "visible" },
    });
  });

  it("keeps the note and the commandId out of the URL: ?tenant= and encoded ids only", async () => {
    const fn = answer(MODERATE_OK);
    const reasonNote = "synthetic-note-token";
    const input = { action: "hide", reasonCode: "other", reasonNote, commandId: COMMAND } as const;
    await moderateMessage(CTX, "a/b", "c?d", input);
    const { url } = sent(fn);
    expect(url.pathname).toBe("/api/chat/channels/a%2Fb/messages/c%3Fd/moderation");
    expect([...url.searchParams.entries()]).toStrictEqual([["tenant", TENANT]]);
    expect(url.href).not.toContain(reasonNote);
    expect(url.href).not.toContain(COMMAND);
  });

  it.each([
    [403, "CHAT_MODERATION_FORBIDDEN"],
    [409, "CHAT_IDEMPOTENCY_MISMATCH"],
    [422, "CHAT_REASON_INVALID"],
    [429, "CHAT_RATE_LIMITED"],
  ])(
    "%i %s is surfaced verbatim with its status, never read as a success",
    async (status, code) => {
      stub(() => new Response(errorBody(code, status), { status }));
      await expect(moderate()).resolves.toStrictEqual(failed(code, status));
    },
  );
});

const ERROR_CODES: [number, string][] = [
  [401, "AUTH_REQUIRED"],
  [403, "CHAT_FORBIDDEN"],
  [403, "TENANT_SUSPENDED"],
  [403, "CSRF_INVALID"],
  [403, "CHAT_CAPABILITY_REQUIRED"],
  [400, "INVALID_BODY"],
  [404, "NOT_FOUND"],
  [409, "CHAT_REPLY_INVALID"],
  [409, "CHAT_IDEMPOTENCY_MISMATCH"],
  [409, "CHAT_EDIT_WINDOW_CLOSED"],
  [409, "CHAT_EDIT_CONFLICT"],
  [413, "CHAT_MESSAGE_TOO_LARGE"],
  [429, "CHAT_RATE_LIMITED"],
];

describe("chat api envelope errors", () => {
  it.each(ERROR_CODES)("%i %s is surfaced verbatim with its status", async (status, code) => {
    stub(() => new Response(errorBody(code, status), { status }));
    const input = { clientMsgId: CLIENT_MSG, body: "x" };
    // toStrictEqual: exactly {ok, code, status}, so the server's message text never leaks through
    await expect(sendMessage(CTX, CHANNEL, input)).resolves.toStrictEqual(failed(code, status));
  });

  it.each(CALLS)("$name: an error envelope is a result, never a throw", async ({ run }) => {
    stub(() => new Response(errorBody("CHAT_RATE_LIMITED", 429), { status: 429 }));
    await expect(run()).resolves.toStrictEqual(failed("CHAT_RATE_LIMITED", 429));
  });
});

const FAIL_CLOSED: [string, () => Response, ReturnType<typeof failed>][] = [
  ["a 500 with an HTML body", res("<html>bad gateway</html>", 500), bad(500)],
  ["a 500 with an empty body", res(null, 500), bad(500)],
  ["a 200 with a non-JSON body", res("not json", 200), bad(200)],
  ["a 200 envelope without data", res(envelope(null), 200), bad(200)],
  [
    "an error envelope without a code",
    res(JSON.stringify({ data: null, error: { message: "x", statusCode: 400 }, meta: {} }), 400),
    bad(400),
  ],
  ["an error envelope with a non-string code", res(errorBody(42, 400), 400), bad(400)],
  ["an error envelope with an empty code", res(errorBody("", 429), 429), bad(429)],
  [
    "a network failure",
    () => {
      throw new TypeError("Failed to fetch");
    },
    failed(CLIENT_NETWORK_ERROR, 0),
  ],
];

describe("chat api fails closed", () => {
  it.each(FAIL_CLOSED)("%s on every call", async (_name, respond, expected) => {
    for (const call of CALLS) {
      stub(respond);
      await expect(call.run()).resolves.toStrictEqual(expected);
    }
  });

  it.each(CALLS)("$name: a 15 s timeout is CLIENT_BAD_RESPONSE, status 0", async ({ run }) => {
    const clock = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(clock.signal);
    const fn = stub(
      () =>
        new Promise<Response>((_resolve, reject) => {
          clock.signal.addEventListener("abort", () =>
            reject(new DOMException("timed out", "TimeoutError")),
          );
        }),
    );
    const settled = expect(run()).resolves.toStrictEqual(bad(0));
    expect(timeout).toHaveBeenCalledWith(15_000);
    expect(sent(fn).signal).toBe(clock.signal);
    clock.abort();
    await settled;
  });
});

const REJECTED: [string, () => Promise<unknown>, unknown][] = [
  ["a channel with an extra key", readChannels, channels(chan({ createdBy: "x" }))],
  ["a channel missing unreadCount", readChannels, channels(without(CHANNEL_ROW, "unreadCount"))],
  ["a channel with an unknown postPolicy", readChannels, channels(chan({ postPolicy: "x" }))],
  ["a channel with a negative unreadCount", readChannels, channels(chan({ unreadCount: -1 }))],
  ["a channel with a string unreadCount", readChannels, channels(chan({ unreadCount: "3" }))],
  ["a channel with a numeric isDefault", readChannels, channels(chan({ isDefault: 1 }))],
  ["a channel with a fractional sortOrder", readChannels, channels(chan({ sortOrder: 1.5 }))],
  ["a channel list that is not an array", readChannels, { channels: CHANNEL_ROW }],
  ["a live message with a person identifier", readHistory, history(live({ authorPersonId: "p" }))],
  ["a live message with a string mine", readHistory, history(live({ mine: "yes" }))],
  ["a live message with a string editCount", readHistory, history(live({ editCount: "1" }))],
  ["a live message with an unknown authorType", readHistory, history(live({ authorType: "bot" }))],
  ["a live message missing authorLabel", readHistory, history(without(LIVE_ROW, "authorLabel"))],
  ["a live message missing tombstone", readHistory, history(without(LIVE_ROW, "tombstone"))],
  ["a live message with a null body", readHistory, history(live({ body: null }))],
  [
    "a live message with a tombstone kind",
    readHistory,
    history(live({ tombstone: "author_deleted" })),
  ],
  ["a tombstone carrying a body", readHistory, history({ ...TOMBSTONE_ROW, body: "secret text" })],
  ["a tombstone carrying a label", readHistory, history({ ...TOMBSTONE_ROW, authorLabel: "name" })],
  ["a tombstone missing channelId", readHistory, history(without(TOMBSTONE_ROW, "channelId"))],
  ["a tombstone with an unknown kind", readHistory, history({ ...TOMBSTONE_ROW, tombstone: "x" })],
  ["a row that is not an object", readHistory, history("message")],
  ["a page with an extra key", readHistory, { ...PAGE, total: 4 }],
  ["a page with an empty nextCursor", readHistory, { ...PAGE, nextCursor: "" }],
  ["a page with a numeric nextCursor", readHistory, { ...PAGE, nextCursor: 5 }],
  ["a page without nextCursor", readHistory, { messages: [] }],
  ["a page whose messages are not an array", readHistory, { messages: "x", nextCursor: null }],
  ["a send result with an extra key", send, { ...SEND_OK, body: "echo" }],
  ["a send result with a string duplicate", send, { ...SEND_OK, duplicate: "false" }],
  ["an edit result without editedAt", edit, without(EDIT_OK, "editedAt")],
  ["an edit result with a negative editCount", edit, { ...EDIT_OK, editCount: -1 }],
  ["a delete result without changed", remove, without(DELETE_OK, "changed")],
  ["a delete result with a null authorDeletedAt", remove, { ...DELETE_OK, authorDeletedAt: null }],
  ["a read result with a key", read, { ok: true }],
  ["a read result that is an array", read, []],
  ["a moderation result with an extra key", moderate, { ...MODERATE_OK, body: "previous text" }],
  ["a moderation result naming a moderator", moderate, { ...MODERATE_OK, moderatorId: "p" }],
  [
    "a moderation result with an unknown moderationState",
    moderate,
    { ...MODERATE_OK, moderationState: "removed" },
  ],
  [
    "a moderation result with a null moderationState",
    moderate,
    { ...MODERATE_OK, moderationState: null },
  ],
  ["a moderation result with a string changed", moderate, { ...MODERATE_OK, changed: "true" }],
  ["a moderation result without changed", moderate, without(MODERATE_OK, "changed")],
  ["a moderation result with an empty messageId", moderate, { ...MODERATE_OK, messageId: "" }],
  ["a moderation result that is an array", moderate, []],
];

describe("chat api exact-key guards", () => {
  it.each(REJECTED)("rejects %s as CLIENT_BAD_RESPONSE", async (_name, run, data) => {
    answer(data);
    // toStrictEqual: only {ok, code, status} comes back, never a rejected row's content
    await expect(run()).resolves.toStrictEqual(bad(200));
  });
});

describe("chat api scope", () => {
  it("exports exactly the seven chat calls: no stream path", () => {
    expect(Object.keys(chatApi).sort()).toStrictEqual([
      "deleteMessage",
      "editMessage",
      "listChannels",
      "listHistory",
      "markRead",
      "moderateMessage",
      "sendMessage",
    ]);
  });

  it("the source has no console call, no browser storage and no stream", () => {
    const source = readFileSync(new URL("./chat-api.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(
      /console\.|localStorage|sessionStorage|indexedDB|EventSource|CHAT_STREAM/i,
    );
  });
});
