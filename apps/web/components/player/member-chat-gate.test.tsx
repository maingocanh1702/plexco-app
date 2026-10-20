import type { ChatChannelDto } from "@plexco/core";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LangProvider } from "../../lib/i18n-client";
import type { SessionDto } from "../../lib/session-dto";
import { FALLBACK_TIMEZONE } from "../../lib/session-time";
import { useChatChannel, useChatChannels } from "../../lib/use-chat";
import { type UseSession, useSessionContext } from "../../lib/use-session";
import { TenantZoneContext, useTenantContext } from "../../lib/use-tenant-context";
import { ChannelList } from "../chat/channel-list";
import { ChannelView } from "../chat/channel-view";

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

const html = (node: ReactNode) =>
  renderToStaticMarkup(<LangProvider lang="en">{node}</LangProvider>);

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

// Every link a chat screen renders (the channel list rows or the channel's back link).
const hrefsOf = (node: ReactNode) => {
  vi.mocked(useChatChannels).mockReturnValue({
    state: "ready",
    channels: [channel],
    error: null,
    refresh: async () => {},
  });
  vi.mocked(useChatChannel).mockReturnValue(chatChannel);
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
