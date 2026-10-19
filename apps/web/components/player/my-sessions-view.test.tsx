import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LangProvider } from "../../lib/i18n-client";
import type { MySession } from "../../lib/me-player-api";
import { MySessionsView } from "./my-sessions-view";
import type { PlayerState } from "./player-page";

// ApiErrorNotice calls useRouter(), and no app router is mounted in a static render.
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => {} }) }));

const ACTIVE: MySession = {
  sessionId: "session-9d2f",
  clubRef: "dev-club",
  clubLabel: "Dev Club",
  sportKey: "badminton",
  startsAt: "2026-11-02T11:30:00.000Z",
  endsAt: "2026-11-02T13:00:00.000Z",
  timezone: "Asia/Ho_Chi_Minh",
  area: "Cầu Giấy",
  myStatus: "active",
  waitlistPosition: null,
  venueName: "Sân Alpha",
  venueAddress: "12 Duy Tân",
};
type State = PlayerState<{ sessions: MySession[]; truncated: boolean }>;
const ready = (sessions: MySession[], truncated = false): State => ({
  status: "ready",
  data: { sessions, truncated },
});
const render = (state: State, lang: "vi" | "en" = "en") =>
  renderToStaticMarkup(
    <LangProvider lang={lang}>
      <MySessionsView state={state} onRetry={() => {}} />
    </LangProvider>,
  );
/** Visible text only: tags stripped, the entities React escapes decoded. */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
const stateOf = (html: string) => /data-state="([a-z]+)"/.exec(html)?.[1];

describe("MySessionsView", () => {
  it("venue only for an active seat", () => {
    // These rows carry a venue the SQL definer would have nulled: the view must not trust that (P-6).
    const leaky = (row: Partial<MySession>) =>
      ({
        ...ACTIVE,
        venueName: "Leaked Court",
        venueAddress: "1 Leak Street",
        ...row,
      }) as MySession;
    const rows = [
      ACTIVE,
      leaky({ sessionId: "s-w", myStatus: "waitlisted", waitlistPosition: 3, area: "Đống Đa" }),
      leaky({ sessionId: "s-p", myStatus: "pending", area: "Thanh Xuân" }),
      leaky({ sessionId: "s-u", myStatus: "mystery" as never, area: "Ba Đình" }),
    ];
    const visible = text(render(ready(rows)));
    expect(visible).toContain("Sân Alpha");
    expect(visible).toContain("12 Duy Tân");
    expect(visible).not.toContain("Leaked Court");
    expect(visible).not.toContain("Leak Street");
    // Waitlisted and pending: area (and the position) but no venue; an unknown status has no label.
    for (const area of ["Đống Đa", "Thanh Xuân", "Ba Đình"]) expect(visible).toContain(area);
    expect(visible).toContain("Waitlisted #3");
    expect(visible.match(/Confirmed|Waitlisted|Pending approval/g)).toHaveLength(3);
  });

  it("times show in the row's own zone, none hardcoded", () => {
    const newYork = { ...ACTIVE, sessionId: "s-ny", timezone: "America/New_York" };
    const visible = text(render(ready([ACTIVE, newYork])));
    expect(visible).toContain("18:30–20:00"); // Asia/Ho_Chi_Minh, UTC+7
    expect(visible).toContain("06:30–08:00"); // America/New_York on 2 Nov 2026, UTC-5
  });

  it("an unparseable time shows a dash, never a crash", () => {
    const visible = text(render(ready([{ ...ACTIVE, startsAt: "garbage" }])));
    expect(visible).toContain("—");
    expect(visible).not.toContain("Invalid");
  });

  it("shows sport, club and area; no id and no control", () => {
    const html = render(ready([ACTIVE, { ...ACTIVE, sessionId: "s-2", sportKey: "curling" }]));
    const visible = text(html);
    expect(stateOf(html)).toBe("ready");
    expect(visible).toContain("Badminton");
    expect(visible).toContain("Session"); // an unknown sport key gets the neutral label
    expect(visible).toContain("Dev Club");
    expect(html).not.toContain("session-9d2f");
    expect(html).not.toContain("dev-club");
    expect(html).not.toContain("<button"); // no leave or cancel control (O-2)
  });

  it("the truncated note shows only when the service capped the list", () => {
    expect(text(render(ready([ACTIVE], true)))).toContain("Not all items are shown");
    expect(text(render(ready([ACTIVE], false)))).not.toContain("Not all items are shown");
  });

  it("empty: a link to discovery", () => {
    const html = render(ready([]));
    expect(stateOf(html)).toBe("empty");
    expect(html).toContain('href="/discover"');
  });

  it("ignores non-whitelisted keys", () => {
    const injected = {
      ...ACTIVE,
      gender: "female",
      genderPrice: 99000,
      bankAccount: "9704-0000",
      qr: "data:image/png;base64,AAAA",
    } as MySession;
    const html = render(ready([injected]));
    for (const leak of ["female", "99.000", "9704-0000", "data:image"]) {
      expect(html).not.toContain(leak);
    }
  });

  it("renders vi and en", () => {
    const inVi = text(render(ready([ACTIVE]), "vi"));
    const inEn = text(render(ready([ACTIVE]), "en"));
    for (const word of ["Buổi chơi của tôi", "Đã có chỗ", "Cầu lông"]) expect(inVi).toContain(word);
    for (const word of ["My sessions", "Confirmed", "Badminton"]) expect(inEn).toContain(word);
  });
});
