import type {
  ChatChannelDto,
  ChatLiveMessageDto,
  ChatMessageDto,
  ChatTombstoneDto,
  ChatViewerDto,
} from "@plexco/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  editMessage,
  listChannels,
  listHistory,
  markRead,
  moderateMessage,
  sendMessage,
  type ChatModerateInput,
} from "./chat-api";
import { LIVE_PAUSE_MS, createRealtimeHub, type EventSourceLike } from "./use-realtime";
import {
  CHAT_STREAM,
  READ_GAP_MS,
  channelRound,
  channelsRound,
  channelsView,
  createStaleChannels,
  editAttempt,
  historyView,
  moderateAttempt,
  onChannelsRefresh,
  readThrough,
  refreshChannels,
  sendAttempt,
  type ChannelState,
  type ChannelUpdate,
  type ChannelsView,
  type PendingMessage,
  type ReadState,
} from "./use-chat";

vi.mock("./chat-api", () => ({
  listChannels: vi.fn(),
  listHistory: vi.fn(),
  sendMessage: vi.fn(),
  editMessage: vi.fn(),
  markRead: vi.fn(),
  moderateMessage: vi.fn(),
}));

const t = (_vi: string, en: string): string => en;
const CH = "0b8f2c1e-4d3a-4f6b-9c1d-2e3f4a5b6c7d";
const frame = {
  type: "chat.message" as const,
  channelId: CH,
  messageId: "9a7e1d2c-3b4a-4c5d-8e6f-7a8b9c0d1e2f",
};
const channel: ChatChannelDto = {
  id: CH,
  title: "Club",
  sortOrder: 0,
  isDefault: false,
  postPolicy: "admins_only",
  unreadCount: 3,
};
// listChannels (chat-api.ts) always resolves {channels, viewer}: both flags false unless the answer proved otherwise
const NO_VIEWER: ChatViewerDto = { canModerate: false, canPostRestricted: false };
const ok = (channels: ChatChannelDto[], viewer: ChatViewerDto = NO_VIEWER) => ({
  ok: true as const,
  data: { channels, viewer },
});
const fail = (code: string, status: number) => ({ ok: false as const, code, status });
const event = (channelId = CH) => ({ kind: "event" as const, message: { ...frame, channelId } });

describe("CHAT_STREAM: a frame is only a refetch hint", () => {
  it("is the chat path with no dedupe (chat frames carry no version)", () => {
    expect(CHAT_STREAM.path).toBe("/api/chat/subscribe");
    expect(CHAT_STREAM.dedupe).toBeUndefined();
  });

  it("parses exactly {type, channelId, messageId} with lowercase uuid ids", () => {
    expect(CHAT_STREAM.parse(JSON.stringify(frame))).toEqual(frame);
  });

  it.each([
    ["an extra key", JSON.stringify({ ...frame, body: "hi" })],
    ["another type", JSON.stringify({ ...frame, type: "chat.edit" })],
    ["a numeric channel id", JSON.stringify({ ...frame, channelId: 7 })],
    ["a null message id", JSON.stringify({ ...frame, messageId: null })],
    ["an uppercase id", JSON.stringify({ ...frame, channelId: CH.toUpperCase() })],
    ["a missing key", JSON.stringify({ type: "chat.message", channelId: CH })],
    ["an array", JSON.stringify([frame])],
    ["null", JSON.stringify(null)],
    ["the object itself, not the raw string", frame],
    ["malformed JSON", "{"],
  ])("drops a frame with %s", (_name, data) => {
    expect(CHAT_STREAM.parse(data)).toBeNull();
  });

  it("through the hub: the raw data string reaches the listener as a resync, then the event", () => {
    const src: EventSourceLike = { onopen: null, onmessage: null, onerror: null, close: vi.fn() };
    const hub = createRealtimeHub({
      create: () => src,
      now: () => 0,
      setTimeout: () => 0,
      clearTimeout: vi.fn(),
      random: () => 0,
    });
    const seen: unknown[] = [];
    hub.subscribe("t1", (signal) => seen.push(signal), CHAT_STREAM);
    src.onopen?.();
    src.onmessage?.({ data: JSON.stringify(frame) });
    expect(seen).toEqual([{ kind: "resync" }, { kind: "event", message: frame }]);
  });
});

describe("channel list live round", () => {
  beforeEach(() => vi.mocked(listChannels).mockReset());

  function setup() {
    const stale = createStaleChannels();
    const applied: ChannelsView[] = [];
    const run = () =>
      channelsRound({ tenantId: "t1", t, stale, apply: (view) => applied.push(view) });
    return { stale, applied, run };
  }

  it("coalesces hints: two frames, one round, one list refetch; nothing pending, none", async () => {
    vi.mocked(listChannels).mockResolvedValue(ok([channel]));
    const { stale, applied, run } = setup();
    expect(stale.accept(event())).toBe(true);
    expect(stale.accept(event("1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f"))).toBe(true);
    expect(await run()).toBe(false);
    expect(listChannels).toHaveBeenCalledTimes(1);
    expect(listChannels).toHaveBeenCalledWith("t1");
    expect(applied.map((view) => view.state)).toEqual(["ready"]);
    expect(await run()).toBe(false);
    expect(listChannels).toHaveBeenCalledTimes(1);
  });

  it("a resync marks every channel stale and refetches", async () => {
    vi.mocked(listChannels).mockResolvedValue(ok([channel]));
    const { stale, run } = setup();
    expect(stale.accept({ kind: "resync" })).toBe(true);
    await run();
    expect(listChannels).toHaveBeenCalledTimes(1);
  });

  it("a round carries the fresh viewer: a capability revoked server-side is gone from the next list", async () => {
    const granted: ChatViewerDto = { canModerate: true, canPostRestricted: true };
    vi.mocked(listChannels)
      .mockResolvedValueOnce(ok([channel], granted))
      .mockResolvedValueOnce(ok([channel]));
    const { stale, applied, run } = setup();
    for (let round = 0; round < 2; round += 1) {
      stale.accept(event());
      await run();
    }
    expect(applied.map((view) => view.viewer)).toEqual([granted, NO_VIEWER]);
  });

  it("a rate-limited round pauses silently (true, nothing shown); the catch-up refetches", async () => {
    vi.mocked(listChannels)
      .mockResolvedValueOnce(fail("CHAT_RATE_LIMITED", 429))
      .mockResolvedValueOnce(ok([channel]));
    const { stale, applied, run } = setup();
    stale.accept(event());
    expect(await run()).toBe(true);
    expect(applied).toEqual([]);
    expect(await run()).toBe(false);
    expect(listChannels).toHaveBeenCalledTimes(2);
    expect(applied.map((view) => view.state)).toEqual(["ready"]);
  });

  it.each(["AUTH_REQUIRED", "CHAT_FORBIDDEN", "TENANT_SUSPENDED"])(
    "%s turns live off: the round shows that code's row",
    async (code) => {
      vi.mocked(listChannels).mockResolvedValue(fail(code, code === "AUTH_REQUIRED" ? 401 : 403));
      const { stale, applied, run } = setup();
      stale.accept(event());
      expect(await run()).toBe(false);
      expect(applied).toHaveLength(1);
      expect(applied[0]?.error?.code).toBe(code);
      expect(applied[0]?.channels).toEqual([]);
      expect(applied[0]?.viewer).toEqual(NO_VIEWER);
    },
  );

  it("any other failure ends the round with nothing inferred", async () => {
    vi.mocked(listChannels).mockResolvedValue(fail("CLIENT_NETWORK_ERROR", 0));
    const { stale, applied, run } = setup();
    stale.accept(event());
    expect(await run()).toBe(false);
    expect(applied).toEqual([]);
  });
});

describe("channelsView: the list states", () => {
  it("is ready with the channels in the server's order, empty with none", () => {
    expect(channelsView(ok([channel]), t, "list")).toEqual({
      state: "ready",
      channels: [channel],
      error: null,
      viewer: NO_VIEWER,
    });
    expect(channelsView(ok([]), t, "list")).toEqual({
      state: "empty",
      channels: [],
      error: null,
      viewer: NO_VIEWER,
    });
  });

  it("carries the viewer of an ok answer as parsed, for a first load and a refetch", () => {
    const viewer: ChatViewerDto = { canModerate: true, canPostRestricted: false };
    expect(channelsView(ok([channel], viewer), t, "list").viewer).toEqual(viewer);
    expect(channelsView(ok([], viewer), t, "list-refetch").viewer).toEqual(viewer);
  });

  it.each([
    ["CHAT_FORBIDDEN", 403],
    ["AUTH_REQUIRED", 401],
    ["CHAT_RATE_LIMITED", 429],
    ["CLIENT_NETWORK_ERROR", 0],
    ["SOMETHING_NEW", 400],
  ])(
    "%s (%i): a non-ok answer gives both flags false, offline too, over a viewer who could",
    (code, status) => {
      const prev: ChannelsView = {
        state: "ready",
        channels: [channel],
        error: null,
        viewer: { canModerate: true, canPostRestricted: true },
      };
      expect(channelsView(fail(code, status), t, "list", prev).viewer).toEqual(NO_VIEWER);
    },
  );

  it.each([
    ["CHAT_FORBIDDEN", 403, "empty", false],
    ["AUTH_REQUIRED", 401, "error", false],
    ["CHAT_RATE_LIMITED", 429, "error", true],
    ["CLIENT_NETWORK_ERROR", 0, "offline", true],
    ["SOMETHING_NEW", 400, "error", true],
    ["CHAT_FORBIDDEN", 500, "error", true],
  ])("%s (%i) renders as %s, retry %s, and clears the list", (code, status, state, retry) => {
    const view = channelsView(fail(code, status), t, "list");
    expect(view).toMatchObject({ state, channels: [], error: { code, retry } });
    expect(view.error?.message).not.toBe("");
  });
});

const T = "7c1d9a4e-2b3f-4c5d-8e6a-1b2c3d4e5f60";
const M1 = "1a2b3c4d-0000-4000-8000-000000000001";
const CM = "c0ffee00-0000-4000-8000-000000000001";
const call = { ctx: { tenantId: T, csrfToken: "tok" }, channelId: CH, t };
const msg = (id: string) =>
  ({ id, channelId: CH, body: "hi", editCount: 0, tombstone: null }) as ChatLiveMessageDto;
const view = (over: Partial<ChannelState> = {}) =>
  ({
    state: "ready",
    messages: [],
    nextCursor: null,
    error: null,
    pending: [],
    off: false,
    ...over,
  }) as ChannelState;
const entry: PendingMessage = { clientMsgId: CM, body: "hi", failed: null };
const sent = (id: string, duplicate = false) => ({
  ok: true as const,
  data: { id, createdAt: "t", duplicate },
});
const rs = (over: Partial<ReadState> = {}): ReadState => ({
  lastId: null,
  nextAt: 0,
  busy: false,
  ...over,
});
const roundDeps = (stale = createStaleChannels(), applied: ChannelUpdate[] = []) => ({
  ...{ tenantId: T, channelId: CH, t, stale },
  apply: (u: ChannelUpdate) => void applied.push(u),
});

describe("channel view: send, edit, read cursor and live rounds", () => {
  beforeEach(() => vi.resetAllMocks());

  it("confirms an optimistic send once, a duplicate answer too, and retries with the same clientMsgId", async () => {
    vi.mocked(sendMessage)
      .mockResolvedValueOnce(fail("CLIENT_NETWORK_ERROR", 0))
      .mockResolvedValue(sent(M1, true));
    const failed = (await sendAttempt({ ...call, entry }))(view({ pending: [entry] }));
    expect(failed.pending[0]?.failed).toMatchObject({ message: "Not sent.", retry: true });
    const done = (await sendAttempt({ ...call, entry: { ...entry, failed: null } }))(failed);
    expect(done.pending).toEqual([]);
    expect(done.messages).toMatchObject([{ id: M1, body: "hi", mine: true }]);
    expect((await sendAttempt({ ...call, entry }))(done).messages).toHaveLength(1);
    const posted = vi.mocked(sendMessage).mock.calls.map((c) => c[2]);
    expect(posted).toEqual([1, 2, 3].map(() => ({ clientMsgId: CM, body: "hi" })));
  });

  it.each([
    ["CHAT_EDIT_WINDOW_CLOSED", "This message can no longer be edited.", false],
    ["CHAT_EDIT_CONFLICT", "This message changed; the latest version is shown.", true],
  ])(
    "edit 409 %s shows its message; a conflict refetches, nothing retries",
    async (code, message, refetch) => {
      vi.mocked(editMessage).mockResolvedValue(fail(code, 409));
      expect(await editAttempt({ ...call, message: msg(M1), body: "x" })).toMatchObject({
        error: { code, message },
        refetch,
      });
      expect(editMessage).toHaveBeenCalledTimes(1);
      expect(editMessage).toHaveBeenCalledWith(call.ctx, CH, M1, {
        body: "x",
        expectedEditCount: 0,
      });
    },
  );

  it.each([
    [false, {}, 0],
    [true, { lastId: M1 }, 0],
    [true, { busy: true }, 0],
    [true, {}, 1],
  ])("markRead on a visible=%s tab with %j sends %i call(s)", async (visible, over, calls) => {
    vi.mocked(markRead).mockResolvedValue({ ok: true, data: {} });
    const outcome = await readThrough(call.ctx, CH, M1, visible, rs(over), () => 0);
    expect(outcome).toBe(calls === 0 ? "skip" : "read");
    expect(markRead).toHaveBeenCalledTimes(calls);
  });

  it.each([
    [{ ok: true as const, data: {} }, M1, 1, READ_GAP_MS, "read"],
    [fail("CHAT_RATE_LIMITED", 429), null, 0, LIVE_PAUSE_MS, "failed"],
    [fail("NOT_FOUND", 404), null, 0, READ_GAP_MS, "failed"],
    [fail("CHAT_FORBIDDEN", 403), null, 0, READ_GAP_MS, "skip"],
  ])(
    "markRead outcome %j: cursor %s, %i list refresh(es), wait %i",
    async (result, lastId, refreshes, wait, outcome) => {
      vi.mocked(markRead).mockResolvedValue(result);
      const refresh = vi.fn();
      const off = onChannelsRefresh(T, refresh);
      const state = rs();
      const got = await readThrough(call.ctx, CH, M1, true, state, () => 1000);
      off();
      expect(got).toBe(outcome);
      expect(state).toEqual({ lastId, nextAt: 1000 + wait, busy: false });
      expect(refresh).toHaveBeenCalledTimes(refreshes);
    },
  );

  it.each([
    ["a frame for this channel", event(CH), 1],
    ["a resync", { kind: "resync" as const }, 1],
    ["a frame for another channel", event(T), 0],
  ])("a round after %s refetches the newest page %i time(s)", async (_name, signal, fetches) => {
    vi.mocked(listHistory).mockResolvedValue({
      ok: true,
      data: { messages: [msg(M1)], nextCursor: null },
    });
    const stale = createStaleChannels();
    const applied: ChannelUpdate[] = [];
    stale.accept(signal);
    expect(await channelRound(roundDeps(stale, applied))).toBe(false);
    expect(vi.mocked(listHistory).mock.calls).toEqual(fetches ? [[T, CH]] : []);
    expect(applied).toHaveLength(fetches);
  });

  it("a 429 round pauses silently and marks everything for the catch-up", async () => {
    vi.mocked(listHistory).mockResolvedValue(fail("CHAT_RATE_LIMITED", 429));
    const stale = createStaleChannels();
    const applied: ChannelUpdate[] = [];
    stale.accept(event());
    expect(await channelRound(roundDeps(stale, applied))).toBe(true);
    expect([applied.length, stale.take()?.all]).toEqual([0, true]);
  });

  it.each([
    ["AUTH_REQUIRED", 401],
    ["CHAT_FORBIDDEN", 403],
    ["TENANT_SUSPENDED", 403],
  ])("%s turns live off", async (code, status) => {
    vi.mocked(listHistory).mockResolvedValue(fail(code, status));
    vi.mocked(sendMessage).mockResolvedValue(fail(code, status));
    const stale = createStaleChannels();
    const applied: ChannelUpdate[] = [];
    stale.accept(event());
    await channelRound(roundDeps(stale, applied));
    expect(applied[0]?.(view())).toMatchObject({ state: "error", messages: [], error: { code } });
    expect((await sendAttempt({ ...call, entry }))(view({ pending: [entry] })).off).toBe(true);
  });

  it("a network error on a refetch keeps the shown list and messages, offline with its row", () => {
    const shown: ChannelsView = { state: "ready", channels: [channel], error: null };
    const next = channelsView(fail("CLIENT_NETWORK_ERROR", 0), t, "list", shown);
    expect(next).toMatchObject({
      state: "offline",
      channels: [channel],
      error: { code: "CLIENT_NETWORK_ERROR" },
    });
    expect(channelsView(fail("CLIENT_NETWORK_ERROR", 0), t, "list").channels).toEqual([]);
    const kept = historyView(
      fail("CLIENT_NETWORK_ERROR", 0),
      t,
      "history-refetch",
      view({ messages: [msg(M1)] }),
    );
    expect(kept).toMatchObject({ state: "offline", messages: [{ id: M1 }] });
  });
});

// Moderation fixtures: the FULL real DTOs (api-contract.ts ChatLiveMessageDto and ChatTombstoneDto), synthetic text only
const M2 = "1a2b3c4d-0000-4000-8000-000000000002";
const M3 = "1a2b3c4d-0000-4000-8000-000000000003";
const SYNTHETIC_AT = "2026-10-20T03:00:00.000Z";
const live = (id: string, over: Partial<ChatLiveMessageDto> = {}): ChatLiveMessageDto => ({
  id,
  channelId: CH,
  authorType: "person",
  mine: false,
  authorLabel: "Synthetic Author",
  body: "synthetic body",
  replyToMessageId: null,
  editedAt: null,
  editCount: 0,
  tombstone: null,
  createdAt: SYNTHETIC_AT,
  ...over,
});
const gone = (id: string, kind: ChatTombstoneDto["tombstone"]): ChatTombstoneDto => ({
  id,
  channelId: CH,
  createdAt: SYNTHETIC_AT,
  tombstone: kind,
});
const rows = (...messages: ChatMessageDto[]): ChannelState => view({ messages });
const HIDE: ChatModerateInput = {
  action: "hide",
  reasonCode: "spam",
  reasonNote: null,
  commandId: "c0ffee00-0000-4000-8000-0000000000a1",
};
const RESTORE: ChatModerateInput = {
  action: "restore",
  reasonCode: "other",
  reasonNote: "synthetic note",
  commandId: "c0ffee00-0000-4000-8000-0000000000a2",
};
// the real 200 of the moderation route (ChatModerateResult): {messageId, moderationState, changed}
const moderated = (id: string, moderationState: "hidden" | "visible", changed = true) => ({
  ok: true as const,
  data: { messageId: id, moderationState, changed },
});
const moderate = (state: ChannelState, input: ChatModerateInput, id = M2) =>
  moderateAttempt({ ...call, messageId: id, input, read: () => state });
const mid = (n: number) => `1a2b3c4d-0000-4000-8000-${String(n).padStart(12, "0")}`;
// the REAL cursor shape (chat-route.ts encodeChatCursor: v1. + base64url of "<timestamptz text>|<uuid>")
const cursorOf = (id: string) =>
  `v1.${Buffer.from(`2026-10-20 03:00:00.123456+00|${id}`, "utf8").toString("base64url")}`;
// the real 200 of GET /messages (ChatHistoryPage): {messages, nextCursor}
const pageOf = (messages: ChatMessageDto[], nextCursor: string | null) => ({
  ok: true as const,
  data: { messages, nextCursor },
});
const MORE = pageOf([live(M1)], cursorOf(M1)); // a newest page with an older page behind it

describe("moderateAttempt: hide and restore one message", () => {
  beforeEach(() => vi.resetAllMocks());

  it.each([
    ["D1", true],
    ["D11", false],
  ])(
    "%s: hide with changed:%s renders the exact 4-key moderation_hidden tombstone",
    async (_row, changed) => {
      vi.mocked(moderateMessage).mockResolvedValue(moderated(M2, "hidden", changed));
      const target = live(M2, { body: "hidden-body-xyz", authorLabel: "Hidden Author xyz" });
      const before = rows(live(M1), target, live(M3));
      const done = await moderate(before, HIDE);
      expect(done).toMatchObject({ error: null, refetch: false });
      const after = done.update(before).messages;
      expect(after[1]).toEqual(gone(M2, "moderation_hidden"));
      expect(Object.keys(after[1] ?? {}).sort()).toEqual([
        "channelId",
        "createdAt",
        "id",
        "tombstone",
      ]);
      expect(JSON.stringify(after[1])).not.toMatch(/hidden-body-xyz|Hidden Author xyz/);
      expect([after[0], after[2]]).toEqual([before.messages[0], before.messages[2]]);
      expect(moderateMessage).toHaveBeenCalledTimes(1);
      expect(moderateMessage).toHaveBeenCalledWith(call.ctx, CH, M2, HIDE);
      expect(listHistory).not.toHaveBeenCalled();
    },
  );

  it("hide rewrites only a loaded live row: an author_deleted tombstone stays, an unloaded id changes nothing", async () => {
    vi.mocked(moderateMessage).mockResolvedValue(moderated(M2, "hidden"));
    const deleted = rows(live(M1), gone(M2, "author_deleted"));
    expect((await moderate(deleted, HIDE)).update(deleted).messages).toEqual(deleted.messages);
    const unloaded = rows(live(M1), live(M3));
    expect((await moderate(unloaded, HIDE)).update(unloaded).messages).toEqual(unloaded.messages);
  });

  it.each([true, false])(
    "D2: restore with changed:%s resolves on the newest page: one GET, the server's row, no further page",
    async (changed) => {
      vi.mocked(moderateMessage).mockResolvedValue(moderated(M2, "visible", changed));
      vi.mocked(listHistory).mockResolvedValue(pageOf([live(M1), live(M2)], cursorOf(mid(9))));
      const before = rows(live(M1), gone(M2, "moderation_hidden"));
      const done = await moderate(before, RESTORE);
      expect(done).toMatchObject({ error: null, refetch: false }); // the walk is the only refetch
      expect(done.update(before).messages).toEqual([live(M1), live(M2)]);
      expect(moderateMessage).toHaveBeenCalledWith(call.ctx, CH, M2, RESTORE);
      expect(vi.mocked(listHistory).mock.calls).toEqual([[T, CH]]); // the non-null cursor stays unused
    },
  );

  it("D2: a restore on an older page walks with the received cursor and only replaces loaded rows", async () => {
    vi.mocked(moderateMessage).mockResolvedValue(moderated(M2, "visible"));
    vi.mocked(listHistory)
      .mockResolvedValueOnce(MORE)
      .mockResolvedValueOnce(pageOf([live(M2), live(M3), live(mid(4))], cursorOf(M3)));
    const loaded = rows(live(M1), gone(M2, "moderation_hidden"), live(M3));
    const before = { ...loaded, nextCursor: cursorOf(M3) };
    const done = await moderate(before, RESTORE);
    expect(listHistory).toHaveBeenNthCalledWith(1, T, CH);
    expect(listHistory).toHaveBeenNthCalledWith(2, T, CH, cursorOf(M1)); // as received, byte for byte
    expect(done.update(before).messages).toEqual([live(M1), live(M2), live(M3)]); // M4 not inserted
    expect(done.update(before).nextCursor).toBe(cursorOf(M3));
    expect(done).toMatchObject({ error: null, refetch: false });
  });

  it.each([
    ["an older page answering CLIENT_NETWORK_ERROR", [MORE, fail("CLIENT_NETWORK_ERROR", 0)]],
    ["an older page answering CHAT_RATE_LIMITED", [MORE, fail("CHAT_RATE_LIMITED", 429)]],
    ["a null cursor on the newest page", [pageOf([live(M1)], null)]],
    ["the newest page answering AUTH_REQUIRED", [fail("AUTH_REQUIRED", 401)]],
  ])("D2 stop: %s ends the walk silently and the tombstone stays", async (_stop, answers) => {
    vi.mocked(moderateMessage).mockResolvedValue(moderated(M2, "visible"));
    for (const answer of answers) vi.mocked(listHistory).mockResolvedValueOnce(answer);
    const before = rows(live(M1), gone(M2, "moderation_hidden"));
    const done = await moderate(before, RESTORE);
    expect(done).toMatchObject({ error: null, refetch: false });
    expect(done.update(before).messages[1]).toEqual(gone(M2, "moderation_hidden"));
    expect(listHistory).toHaveBeenCalledTimes(answers.length);
  });

  it("D2 stop: a newest page that no longer joins the loaded rows drops the id, so no older page is asked for", async () => {
    vi.mocked(moderateMessage).mockResolvedValue(moderated(M2, "visible"));
    vi.mocked(listHistory).mockResolvedValueOnce(pageOf([live(mid(7))], cursorOf(mid(7))));
    const before = rows(live(M1), gone(M2, "moderation_hidden"));
    const done = await moderate(before, RESTORE);
    expect(done.update(before).messages).toEqual([live(mid(7))]); // historyView's own rule, as refetchNewest
    expect(listHistory).toHaveBeenCalledTimes(1);
  });

  it("D2 ceiling: the walk makes at most 20 GETs, the newest page included, and the tombstone stays", async () => {
    vi.mocked(moderateMessage).mockResolvedValue(moderated(M2, "visible"));
    let served = 0;
    vi.mocked(listHistory).mockImplementation(async () => {
      served += 1;
      return pageOf([live(M1)], cursorOf(mid(100 + served)));
    });
    const before = rows(live(M1), gone(M2, "moderation_hidden"));
    const done = await moderate(before, RESTORE);
    const calls = vi.mocked(listHistory).mock.calls;
    expect(calls).toHaveLength(20);
    expect(calls[19]?.[2]).toBe(cursorOf(mid(119))); // 19 hops, each with the cursor the page before sent
    expect(done.update(before).messages[1]).toEqual(gone(M2, "moderation_hidden"));
  });

  it.each([
    ["CHAT_MODERATION_FORBIDDEN", 403, "You cannot moderate this message.", false],
    ["CHAT_REASON_INVALID", 422, "The reason or note is not valid.", false],
    ["CHAT_IDEMPOTENCY_MISMATCH", 409, "Something went wrong. Please try again.", false],
    ["CHAT_RATE_LIMITED", 429, "You are going too fast. Please try again in a moment.", true],
    ["CLIENT_NETWORK_ERROR", 0, "You are offline.", true],
    ["CHAT_DB_ERROR:UNKNOWN", 500, "Something went wrong. Please try again.", true],
    ["CLIENT_BAD_RESPONSE", 200, "Something went wrong. Please try again.", true],
  ])(
    "%s (%i) on hide and on restore: its row, no change, no refetch, never success",
    async (code, status, message, retry) => {
      vi.mocked(moderateMessage).mockResolvedValue(fail(code, status));
      const before = rows(live(M2), gone(M3, "moderation_hidden"));
      const hide = await moderate(before, HIDE, M2);
      const restore = await moderate(before, RESTORE, M3);
      for (const done of [hide, restore]) {
        expect(done.error).toMatchObject({ code, message, retry });
        expect(done.refetch).toBe(false);
        expect(done.update(before)).toBe(before);
      }
      expect(vi.mocked(moderateMessage).mock.calls).toEqual([
        [call.ctx, CH, M2, HIDE],
        [call.ctx, CH, M3, RESTORE],
      ]);
      expect(listHistory).not.toHaveBeenCalled();
    },
  );

  it("a retry reaches moderateMessage with the same commandId and the identical input", async () => {
    vi.mocked(moderateMessage)
      .mockResolvedValueOnce(fail("CLIENT_NETWORK_ERROR", 0))
      .mockResolvedValueOnce(moderated(M2, "hidden"));
    const before = rows(live(M2));
    const first = await moderate(before, HIDE);
    expect(first.error).toMatchObject({ code: "CLIENT_NETWORK_ERROR", retry: true });
    const second = await moderate(before, HIDE);
    expect(second.error).toBeNull();
    expect(second.update(before).messages).toEqual([gone(M2, "moderation_hidden")]);
    // the commandId is only ever the caller's: two attempts, one key, one identical body
    expect(vi.mocked(moderateMessage).mock.calls.map((c) => c[3])).toEqual([HIDE, HIDE]);
  });
});

describe("refreshChannels: what the read call triggers", () => {
  it("reaches only the mounted lists of that tenant, until they unmount", () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = onChannelsRefresh("t1", a);
    const offB = onChannelsRefresh("t2", b);
    refreshChannels("t1");
    expect([a.mock.calls.length, b.mock.calls.length]).toEqual([1, 0]);
    offA();
    refreshChannels("t1");
    expect(a).toHaveBeenCalledTimes(1);
    offB();
  });
});
