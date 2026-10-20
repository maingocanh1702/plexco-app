import type { ChatChannelDto } from "@plexco/core";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { err, ok } from "../../lib/api-envelope";
import { LangProvider } from "../../lib/i18n-client";
import type { SessionDto } from "../../lib/session-dto";
import { FALLBACK_TIMEZONE } from "../../lib/session-time";
import { useChatChannel, useChatChannels } from "../../lib/use-chat";
import { type UseSession, useSessionContext } from "../../lib/use-session";
import { TenantZoneContext, useTenantContext } from "../../lib/use-tenant-context";
import { ChannelList } from "../chat/channel-list";
import { ChannelView } from "../chat/channel-view";
import {
  type GateState,
  MemberChatGate,
  MemberChatGateView,
  startChatContextLoad,
} from "./member-chat-gate";

vi.mock("../../lib/use-session", () => ({ useSessionContext: vi.fn() }));
vi.mock("../../lib/use-chat", () => ({ useChatChannel: vi.fn(), useChatChannels: vi.fn() }));
vi.mock("../chat/composer", () => ({ Composer: () => null }));
vi.mock("../chat/message-list", () => ({ MessageList: () => null }));

// Real shapes only: GET /api/auth/session (lib/session-dto.ts) lists a plain member's tenants as [],
// the channels route returns ChatChannelDto, and the hooks return what lib/use-chat.ts returns.
const sessionOf = (tenants: SessionDto["tenants"]): UseSession => {
  const session: SessionDto = {
    personId: "p1",
    expiresAt: "2026-10-21T00:00:00.000Z",
    csrfToken: "csrf",
    tenants,
  };
  return { state: { status: "ready", session }, status: "ready", session, refresh: async () => {} };
};
const adminTenant = (tenantId: string, timezone: string): SessionDto["tenants"][number] => ({
  tenantId,
  role: "owner",
  name: "Club",
  slug: "club",
  timezone,
  locale: "en",
});
const channel: ChatChannelDto = {
  id: "c1",
  title: "Alpha",
  sortOrder: 0,
  isDefault: false,
  postPolicy: "all_members",
  unreadCount: 0,
};
const chatChannel: ReturnType<typeof useChatChannel> = {
  state: "ready",
  messages: [],
  pending: [],
  error: null,
  hasOlder: false,
  reload: vi.fn(),
  loadOlder: vi.fn(),
  send: vi.fn(),
  retry: vi.fn(),
  discard: vi.fn(),
  edit: vi.fn(),
  remove: vi.fn(),
};

const html = (node: ReactNode, lang: "vi" | "en" = "en") =>
  renderToStaticMarkup(<LangProvider lang={lang}>{node}</LangProvider>);

// The zone the real useTenantContext resolves for "t1", under an optional TenantZoneContext provider.
const Zone = () => <>{useTenantContext("t1").timezone}</>;
const zoneOf = (session: UseSession, provided?: string) => {
  vi.mocked(useSessionContext).mockReturnValue(session);
  const zone = <Zone />;
  return html(
    provided ? (
      <TenantZoneContext.Provider value={provided}>{zone}</TenantZoneContext.Provider>
    ) : (
      zone
    ),
  );
};

const mockChat = () => {
  vi.mocked(useChatChannels).mockReturnValue({
    state: "ready",
    channels: [channel],
    error: null,
    refresh: async () => {},
  });
  vi.mocked(useChatChannel).mockReturnValue(chatChannel);
};

// Every link a chat screen renders (the channel list rows or the channel's back link).
const hrefsOf = (node: ReactNode) => {
  mockChat();
  return [...html(node).matchAll(/href="([^"]*)"/g)].map((m) => m[1] ?? "");
};

describe("seams", () => {
  const X = "America/New_York";
  const Y = "Asia/Tokyo";
  const member = sessionOf([]); // a plain member's session lists no tenant
  const MEMBER_PATH = "/me/clubs/club-slug/chat";

  it("TZ-1 a session tenant and no provider: the session tenant's zone", () => {
    expect(zoneOf(sessionOf([adminTenant("t1", X)]))).toBe(X);
  });

  it("TZ-2 an unknown tenant and no provider: the default zone", () => {
    expect(zoneOf(sessionOf([adminTenant("other", X)]))).toBe(FALLBACK_TIMEZONE);
  });

  it("TZ-3 no session tenant (a member) and a provider: the provided zone", () => {
    expect(zoneOf(member, Y)).toBe(Y);
  });

  it("TZ-4 a session tenant and a provider: the session tenant's zone wins", () => {
    expect(zoneOf(sessionOf([adminTenant("t1", X)]), Y)).toBe(X);
  });

  it("BP-1 ChannelList without basePath links the admin path", () => {
    expect(hrefsOf(<ChannelList tenantId="t1" />)).toEqual(["/c/t1/chat/c1"]);
  });

  it("BP-2 ChannelView without basePath: the back link is the admin path", () => {
    expect(hrefsOf(<ChannelView tenantId="t1" channelId="c1" />)).toEqual(["/c/t1/chat"]);
  });

  it("BP-3 ChannelList with a member basePath links under /me/clubs/<slug>/chat", () => {
    const list = <ChannelList tenantId="t1" basePath={MEMBER_PATH} />;
    expect(hrefsOf(list)).toEqual([`${MEMBER_PATH}/c1`]);
  });

  it("BP-4 ChannelView with a member basePath: the back link is /me/clubs/<slug>/chat", () => {
    const channelView = <ChannelView tenantId="t1" channelId="c1" basePath={MEMBER_PATH} />;
    expect(hrefsOf(channelView)).toEqual([MEMBER_PATH]);
  });
});

// The effect cannot run without a DOM (the suite renders to static markup), so the load is driven
// through startChatContextLoad, exactly as the mount effect calls it, and each state through the view.
describe("MemberChatGate", () => {
  const SLUG = "club-slug";
  const MEMBER = `/me/clubs/${SLUG}/chat`;
  const TENANT = "0f8e7c0e-5b1a-4c3d-9e2f-1a2b3c4d5e6f";
  const ctx = { tenantId: TENANT, timezone: "Asia/Tokyo" };
  const ready: GateState = { status: "ready", ...ctx };
  const denied: GateState = { status: "denied" };
  const failed: GateState = { status: "error", signIn: false };
  const signIn: GateState = { status: "error", signIn: true };
  const noStore = { "cache-control": "private, no-store" };
  // What the route and its gate answer (chat-context/route.ts, me-route-gate.ts), through the real envelope helpers.
  const answers = {
    200: () => ok(ctx, { headers: noStore }),
    404: () => {
      const deny = err("NOT_FOUND", "Không tìm thấy.", 404);
      deny.headers.set("cache-control", "private, no-store");
      return deny;
    },
    401: () => err("AUTH_REQUIRED", "Chưa đăng nhập.", 401),
    429: () => err("RATE_LIMITED", "Quá nhiều yêu cầu — đợi.", 429),
    500: () => new Response(null, { status: 500, headers: noStore }), // the route's 500 body is EMPTY
  };
  const fetchMock = vi.fn<typeof fetch>();
  const reply = (make: () => Response) => fetchMock.mockImplementationOnce(async () => make());
  const hang = () =>
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("x", "AbortError")),
          );
        }),
    );
  const settle = (clubRef = SLUG) =>
    new Promise<GateState>((done) => {
      startChatContextLoad(clubRef, done);
    });
  const view = (state: GateState, channelId?: string) => (
    <MemberChatGateView state={state} clubRef={SLUG} channelId={channelId} onRetry={() => {}} />
  );
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    fetchMock.mockReset();
  });

  it("CG-1 loading: the first render is the status line in one main, with no read yet", () => {
    expect(html(<MemberChatGate clubRef={SLUG} />)).toContain('role="status">Loading…');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("CG-2 a 404 is denied: the client's own pair in vi and en, never the server's message", async () => {
    reply(answers[404]);
    const state = await settle();
    expect(state).toEqual(denied);
    const [vi_, en] = [html(view(state), "vi"), html(view(state))];
    expect(vi_).toContain("Bạn không mở được trò chuyện của CLB này.");
    expect(en).toContain("You cannot open this club&#x27;s chat.");
    expect(vi_ + en).not.toMatch(/Không tìm thấy|Not found/);
  });

  it("CG-3 a 500 with an empty body is an error with Retry, and a second load refetches", async () => {
    reply(answers[500]);
    const state = await settle();
    expect(state).toEqual(failed);
    const out = html(view(state));
    expect(out).toContain('role="alert"');
    expect(out).toContain("Could not load the chat.");
    expect(out).toContain(">Retry</button>");
    expect(html(view(state), "vi")).toContain("Không tải được trò chuyện.");
    expect(html(view(state), "vi")).toContain(">Thử lại</button>");
    expect(out).not.toContain('href="/"');
    reply(answers[200]); // what Retry triggers: the effect stops the old read and starts a new one
    expect(await settle()).toEqual(ready);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["401", answers[401], signIn],
    ["429", answers[429], failed],
    ["a proxy 403 page", () => new Response("Forbidden", { status: 403 }), denied],
    ["a proxy 502 page", () => new Response("Bad Gateway", { status: 502 }), failed],
  ])("CG-3b %s maps to its state", async (_name, make, expected) => {
    reply(make);
    expect(await settle()).toEqual(expected);
  });

  it("CG-3c the sign-in state links the sign-in path the chat components use", () => {
    expect(html(view(signIn))).toContain('href="/"');
    expect(html(view(signIn))).toContain(">Retry</button>");
  });

  it("CG-4 a network error is an error state", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    expect(await settle()).toEqual(failed);
  });

  it("CG-5 no answer for 15 s aborts the read: an error state, and not before", async () => {
    vi.useFakeTimers();
    hang();
    let state: GateState | undefined;
    startChatContextLoad(SLUG, (s) => {
      state = s;
    });
    await vi.advanceTimersByTimeAsync(14_999);
    expect(state).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(state).toEqual(failed);
  });

  it.each([
    [{ ...ctx, extra: 1 }],
    [{ tenantId: TENANT }],
    [{ tenantId: "not-a-uuid", timezone: "Asia/Tokyo" }],
    [{ tenantId: TENANT, timezone: "" }],
    [{ tenantId: 7, timezone: "Asia/Tokyo" }],
    [null],
    [[ctx]],
  ])("CG-6 a 200 with the data %j is an error", async (data) => {
    reply(() => ok(data, { headers: noStore }));
    expect(await settle()).toEqual(failed);
  });

  it("CG-7 ready: the L16 list for the route's tenant under member links, no tenant id in the markup", async () => {
    reply(answers[200]);
    const state = await settle();
    expect(state).toEqual(ready);
    expect(hrefsOf(view(state))).toEqual([`${MEMBER}/c1`]);
    expect(useChatChannels).toHaveBeenLastCalledWith(TENANT);
    expect(html(view(state))).not.toContain(TENANT);
  });

  it("CG-8 with a channelId: the L16 channel view, its back link is the member list", () => {
    expect(hrefsOf(view(ready, "c1"))).toEqual([MEMBER]);
    expect(useChatChannel).toHaveBeenLastCalledWith(TENANT, "c1");
  });

  it("CG-9 the route's zone reaches useTenantContext for a member session", () => {
    vi.mocked(useSessionContext).mockReturnValue(sessionOf([]));
    const seen: string[] = [];
    vi.mocked(useChatChannels).mockImplementation((id) => {
      seen.push(useTenantContext(id).timezone);
      return { state: "ready", channels: [channel], error: null, refresh: async () => {} };
    });
    html(view(ready));
    expect(seen).toEqual(["Asia/Tokyo"]);
  });

  it("CG-10 the read is one GET of the encoded path: no query, no body, no csrf header", async () => {
    reply(answers[200]);
    await settle("a b/ü");
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/me/clubs/a%20b%2F%C3%BC/chat-context");
    expect([init?.method, init?.body]).toEqual(["GET", undefined]);
    expect(new Headers(init?.headers).has("x-csrf-token")).toBe(false);
  });

  it("CG-11 stop (an unmount) aborts the read and no state update follows", async () => {
    hang();
    const seen = vi.fn();
    const stop = startChatContextLoad(SLUG, seen);
    const signal = fetchMock.mock.calls[0]?.[1]?.signal;
    expect(signal?.aborted).toBe(false);
    stop();
    expect(signal?.aborted).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seen).not.toHaveBeenCalled();
  });

  it("CG-12 nothing is written to localStorage or sessionStorage", async () => {
    const store = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn() };
    vi.stubGlobal("localStorage", store);
    vi.stubGlobal("sessionStorage", store);
    reply(answers[200]);
    mockChat();
    for (const state of [await settle(), denied, failed, signIn]) html(view(state));
    expect(Object.values(store).flatMap((fn) => fn.mock.calls)).toEqual([]);
  });

  it("CG-13 exactly one <main> in every state", () => {
    mockChat();
    const loading: GateState = { status: "loading" };
    const states: [GateState, string?][] = [
      [loading],
      [denied],
      [failed],
      [signIn],
      [ready],
      [ready, "c1"],
    ];
    for (const [state, channelId] of states) {
      expect(html(view(state, channelId)).match(/<main/g)).toHaveLength(1);
    }
  });
});
