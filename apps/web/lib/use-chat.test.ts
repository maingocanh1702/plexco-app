import type { ChatChannelDto } from "@plexco/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { listChannels } from "./chat-api";
import {
  CHAT_STREAM,
  channelsRound,
  channelsView,
  createStaleChannels,
  onChannelsRefresh,
  refreshChannels,
  type ChannelsView,
} from "./use-chat";

vi.mock("./chat-api", () => ({ listChannels: vi.fn() }));

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
const ok = (channels: ChatChannelDto[]) => ({ ok: true as const, data: { channels } });
const fail = (code: string, status: number) => ({ ok: false as const, code, status });
const event = (channelId = CH) => ({ kind: "event" as const, message: { ...frame, channelId } });

describe("CHAT_STREAM: a frame is only a refetch hint", () => {
  it("is the chat path with no dedupe (chat frames carry no version)", () => {
    expect(CHAT_STREAM.path).toBe("/api/chat/subscribe");
    expect(CHAT_STREAM.dedupe).toBeUndefined();
  });

  it("parses exactly {type, channelId, messageId} with lowercase uuid ids", () => {
    expect(CHAT_STREAM.parse(frame)).toEqual(frame);
  });

  it.each([
    ["an extra key", { ...frame, body: "hi" }],
    ["another type", { ...frame, type: "chat.edit" }],
    ["a numeric channel id", { ...frame, channelId: 7 }],
    ["a null message id", { ...frame, messageId: null }],
    ["an uppercase id", { ...frame, channelId: CH.toUpperCase() }],
    ["a missing key", { type: "chat.message", channelId: CH }],
    ["an array", [frame]],
    ["null", null],
  ])("drops a frame with %s", (_name, data) => {
    expect(CHAT_STREAM.parse(data)).toBeNull();
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
      vi.mocked(listChannels).mockResolvedValue(fail(code, 403));
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
