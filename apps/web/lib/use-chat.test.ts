import type { ChatChannelDto, ChatLiveMessageDto, ChatViewerDto } from "@plexco/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { editMessage, listChannels, listHistory, markRead, sendMessage } from "./chat-api";
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
    });
    expect(channelsView(ok([]), t, "list")).toEqual({ state: "empty", channels: [], error: null });
  });

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
