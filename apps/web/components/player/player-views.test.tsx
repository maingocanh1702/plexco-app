import type { ComponentType, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ApiClientError } from "../../lib/api-client";
import { LangProvider } from "../../lib/i18n-client";
import type { MyClub, MyJoinRequest } from "../../lib/me-player-api";
import { MeHubView } from "./me-hub-view";
import { MyChargesView } from "./my-charges-view";
import { MyClubsView } from "./my-clubs-view";
import { MyRequestsView } from "./my-requests-view";
import { MySessionsView } from "./my-sessions-view";
import type { PlayerState, ViewProps } from "./player-page";

// ApiErrorNotice calls useRouter(), and no app router is mounted in a static render.
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => {} }) }));

type Lang = "vi" | "en";
const view = (node: ReactNode, lang: Lang) =>
  renderToStaticMarkup(<LangProvider lang={lang}>{node}</LangProvider>);
/** Visible text only: tags stripped, the entities React escapes decoded. */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
const stateOf = (html: string) => /data-state="([a-z]+)"/.exec(html)?.[1];
const failure = (code: string, status: number) =>
  new ApiClientError(code, "server text", status, "req-1");

// The four list pages share one shell: the same loading, error and offline states on each (4.5.2).
const LISTS: [string, ComponentType<ViewProps<never>>][] = [
  ["My clubs", MyClubsView],
  ["My sessions", MySessionsView],
  ["My charges", MyChargesView],
  ["My join requests", MyRequestsView],
];

describe.each(LISTS)("%s states", (heading, View) => {
  const render = (state: PlayerState<never>) =>
    view(<View state={state} onRetry={() => {}} />, "en");

  it("loading: busy skeletons under the heading, no alert", () => {
    const html = render({ status: "loading" });
    expect(stateOf(html)).toBe("loading");
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain('role="alert"');
    expect(text(html)).toContain(heading);
  });

  it.each([
    { code: "RATE_LIMITED", status: 429 },
    { code: "SOMETHING_NEW", status: 500 },
  ])("error $code: an alert with Retry, never the server text", ({ code, status }) => {
    const html = render({ status: "error", error: failure(code, status) });
    expect(stateOf(html)).toBe("error");
    expect(html).toContain('role="alert"');
    expect(html).toContain("Try again");
    expect(html).not.toContain("server text");
  });

  it("error AUTH_REQUIRED: the sign-in action", () => {
    const html = render({ status: "error", error: failure("AUTH_REQUIRED", 401) });
    expect(html).toContain("Sign in again");
    expect(html).toContain('href="/"');
  });

  it("offline: a status notice with Retry and no data", () => {
    const html = render({ status: "offline" });
    expect(stateOf(html)).toBe("offline");
    expect(html).toContain('role="status"');
    expect(text(html)).toContain("You are offline");
    expect(html).toContain("Try again");
  });
});

describe("MeHubView", () => {
  const render = (online: boolean, lang: Lang = "en") => view(<MeHubView online={online} />, lang);
  const HREFS = ["/me/clubs", "/me/sessions", "/me/charges", "/me/requests"];
  const order = (html: string) => HREFS.map((href) => html.indexOf(`href="${href}"`));

  it("ready: the four links in order, nothing loading", () => {
    const html = render(true);
    expect(stateOf(html)).toBe("ready");
    expect(order(html).every((at) => at >= 0)).toBe(true);
    expect(order(html)).toEqual([...order(html)].sort((a, b) => a - b));
    expect(html).not.toContain("aria-busy");
  });

  it("offline: the state says so and the links stay", () => {
    const html = render(false);
    expect(stateOf(html)).toBe("offline");
    expect(order(html).every((at) => at >= 0)).toBe(true);
  });

  it("renders vi and en", () => {
    for (const word of ["Tài khoản của tôi", "CLB của tôi", "Yêu cầu tham gia"]) {
      expect(text(render(true, "vi"))).toContain(word);
    }
    for (const word of ["My account", "My clubs", "My requests"]) {
      expect(text(render(true, "en"))).toContain(word);
    }
  });
});

describe("MyClubsView", () => {
  const CLUBS: MyClub[] = [
    { clubRef: "club-a1", clubLabel: "Alpha Club", membershipStatus: "active" },
    { clubRef: "club-b2", clubLabel: "Beta Club", membershipStatus: "guest" },
    { clubRef: "club-c3", clubLabel: "Gamma Club", membershipStatus: null },
  ];
  const render = (clubs: MyClub[], truncated = false, lang: Lang = "en") =>
    view(
      <MyClubsView state={{ status: "ready", data: { clubs, truncated } }} onRetry={() => {}} />,
      lang,
    );

  it("ready: one card per club with its membership label; the slug is never shown", () => {
    const html = render(CLUBS);
    const visible = text(html);
    expect(stateOf(html)).toBe("ready");
    for (const label of ["Alpha Club", "Beta Club", "Gamma Club"]) expect(visible).toContain(label);
    expect(visible.match(/Member|Guest/g)).toHaveLength(2); // an unknown status has no label
    expect(visible).not.toContain("club-a1"); // only the Chat link's href carries the slug (CE-1)
  });

  it("the truncated note shows only when the service capped the list", () => {
    expect(text(render(CLUBS, true))).toContain("Not all items are shown");
    expect(text(render(CLUBS, false))).not.toContain("Not all items are shown");
  });

  it("empty: a link to discovery", () => {
    const html = render([]);
    expect(stateOf(html)).toBe("empty");
    expect(html).toContain('href="/discover"');
  });

  it("ignores non-whitelisted keys", () => {
    const injected = { ...CLUBS[0], gender: "female", bankAccount: "9704-0000" } as MyClub;
    const html = render([injected]);
    for (const leak of ["female", "9704-0000"]) expect(html).not.toContain(leak);
  });

  it("renders vi and en", () => {
    for (const word of ["CLB của tôi", "Thành viên", "Khách"]) {
      expect(text(render(CLUBS, false, "vi"))).toContain(word);
    }
    for (const word of ["My clubs", "Member", "Guest"]) {
      expect(text(render(CLUBS, false, "en"))).toContain(word);
    }
  });

  // L16c: the Chat entry is for an ACTIVE membership only. Each link as [href, label].
  const chatLinks = (html: string) =>
    [...html.matchAll(/<a [^>]*href="(\/me\/clubs\/[^"]*)"[^>]*>([^<]*)<\/a>/g)].map((m) =>
      m.slice(1),
    );

  it("CE-1/CE-4 an active row links to its chat with the encoded slug, labelled in vi and en", () => {
    const odd: MyClub = { clubRef: "a b/c", clubLabel: "Odd Club", membershipStatus: "active" };
    expect(chatLinks(render([...CLUBS, odd]))).toEqual([
      ["/me/clubs/club-a1/chat", "Chat"],
      ["/me/clubs/a%20b%2Fc/chat", "Chat"],
    ]);
    expect(chatLinks(render(CLUBS, false, "vi"))).toEqual([
      ["/me/clubs/club-a1/chat", "Trò chuyện"],
    ]);
  });

  it("CE-2/CE-3 a guest and any other status get no chat link, and their slug is not in the page", () => {
    const odd: MyClub = {
      clubRef: "club-d4",
      clubLabel: "Delta",
      membershipStatus: "mystery" as never,
    };
    const html = render([...CLUBS.slice(1), odd]); // guest, null, unknown
    expect(chatLinks(html)).toEqual([]);
    for (const slug of ["club-b2", "club-c3", "club-d4"]) expect(html).not.toContain(slug);
  });
});

describe("MyRequestsView", () => {
  const request = (n: number, over: Partial<MyJoinRequest>): MyJoinRequest => ({
    requestId: `request-${n}`,
    sessionId: `session-${n}`,
    clubRef: "dev-club",
    clubLabel: "Dev Club",
    startsAt: "2026-11-02T11:30:00.000Z",
    area: "Cầu Giấy",
    status: "pending",
    createdAt: "2026-10-30T08:00:00.000Z",
    decidedAt: null,
    expiresAt: null,
    ...over,
  });
  const ROWS = [
    request(1, { expiresAt: "2026-11-01T08:00:00.000Z" }),
    request(2, {
      status: "approved",
      decidedAt: "2026-10-31T08:00:00.000Z",
      expiresAt: "2026-11-01T08:00:00.000Z",
    }),
    request(3, { status: "rejected", decidedAt: "2026-10-31T09:00:00.000Z" }),
    request(4, { status: "mystery" as never }),
  ];
  const render = (requests: MyJoinRequest[], truncated = false, lang: Lang = "en") =>
    view(
      <MyRequestsView
        state={{ status: "ready", data: { requests, truncated } }}
        onRetry={() => {}}
      />,
      lang,
    );

  it("ready: status labels, decided only when set, expires only while pending", () => {
    const html = render(ROWS);
    const visible = text(html);
    expect(stateOf(html)).toBe("ready");
    expect(visible.match(/Pending|Approved|Rejected/g)).toHaveLength(3); // an unknown status has none
    expect(visible.match(/Requested:/g)).toHaveLength(4);
    expect(visible.match(/Decided:/g)).toHaveLength(2);
    expect(visible.match(/Expires:/g)).toHaveLength(1); // the approved row's expiry stays hidden
  });

  it("no cancel control and no id", () => {
    const html = render(ROWS);
    expect(html).not.toContain("<button");
    expect(text(html)).not.toMatch(/cancel|hủy/i);
    expect(html).not.toContain("request-1");
    expect(html).not.toContain("session-1");
  });

  it("the truncated note shows only when the service capped the list", () => {
    expect(text(render(ROWS, true))).toContain("Not all items are shown");
    expect(text(render(ROWS, false))).not.toContain("Not all items are shown");
  });

  it("empty: the none state", () => {
    const html = render([]);
    expect(stateOf(html)).toBe("empty");
    expect(text(html)).toContain("You have no join requests");
  });

  it("ignores non-whitelisted keys", () => {
    const injected = {
      ...ROWS[0],
      gender: "female",
      qr: "data:image/png;base64,AAAA",
    } as MyJoinRequest;
    const html = render([injected]);
    for (const leak of ["female", "data:image"]) expect(html).not.toContain(leak);
  });

  it("renders vi and en", () => {
    for (const word of ["Yêu cầu tham gia của tôi", "Đang chờ duyệt", "Đã gửi"]) {
      expect(text(render(ROWS, false, "vi"))).toContain(word);
    }
    for (const word of ["My join requests", "Pending", "Requested"]) {
      expect(text(render(ROWS, false, "en"))).toContain(word);
    }
  });

  it("CE-5 rows carry no action: no link and no button inside a card", () => {
    const cards = render(ROWS).match(/<li\b.*?<\/li>/g) ?? [];
    expect(cards).toHaveLength(ROWS.length);
    for (const card of cards) expect(card).not.toMatch(/<a\b|<button\b/);
  });
});
