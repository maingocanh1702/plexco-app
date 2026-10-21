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
  it("A-1, A-3: every row draws the venue the server sent, whatever its seat status", () => {
    // Option OFF (DD-139): the /me definer sends the venue on waitlisted and requested rows too.
    // The view has no status rule of its own: it draws what the row carries, in full, never trims.
    const row = (extra: Partial<MySession>) => ({ ...ACTIVE, ...extra }) as MySession;
    const rows = [
      ACTIVE,
      row({
        sessionId: "s-w",
        myStatus: "waitlisted",
        waitlistPosition: 3,
        area: "Đống Đa",
        venueName: "Sân Beta",
        venueAddress: "Tầng 2, nhà thi đấu Hoàng Văn Thụ, 124 đường Hoàng Hoa Thám, Hà Nội",
      }),
      row({
        sessionId: "s-p",
        myStatus: "pending",
        area: "Thanh Xuân",
        venueName: "Sân Gamma",
        venueAddress: "56 Nguyễn Trãi",
      }),
      row({
        sessionId: "s-u",
        myStatus: "mystery" as never,
        area: "Ba Đình",
        venueName: "Sân Delta",
        venueAddress: "7 Trần Hưng Đạo",
      }),
    ];
    const visible = text(render(ready(rows)));
    for (const r of rows) {
      expect(visible).toContain(r.venueName);
      expect(visible).toContain(r.venueAddress);
    }
    // The area line and the waitlist position stay as they were; an unknown status has no label.
    for (const area of ["Đống Đa", "Thanh Xuân", "Ba Đình"]) expect(visible).toContain(area);
    expect(visible).toContain("Waitlisted #3");
    expect(visible.match(/Confirmed|Waitlisted|Pending approval/g)).toHaveLength(3);
  });

  it("A-4: a row without a venue draws no venue text and no placeholder", () => {
    // Null = nothing typed, or the host hid it from this viewer: the row is then the venue row
    // minus the venue text and nothing takes its place. Each field stands on its own.
    const flat = (extra: Partial<MySession>) =>
      text(render(ready([{ ...ACTIVE, ...extra } as MySession])));
    const squash = (s: string) => s.replace(/ +/g, " ").trim();
    const bare = squash(flat({ venueName: null, venueAddress: null }));
    expect(bare).toContain("Cầu Giấy");
    expect(bare).not.toMatch(/Sân Alpha|Duy Tân/);
    expect(squash(flat({}).replace("Sân Alpha", "").replace("12 Duy Tân", ""))).toBe(bare);
    expect(squash(flat({ venueAddress: null }).replace("Sân Alpha", ""))).toBe(bare);
    expect(squash(flat({ venueName: null }).replace("12 Duy Tân", ""))).toBe(bare);
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

  it("CE-6 rows carry no action: no link and no button inside a card", () => {
    const cards =
      render(ready([ACTIVE, { ...ACTIVE, sessionId: "s-2" }])).match(/<li\b.*?<\/li>/g) ?? [];
    expect(cards).toHaveLength(2);
    for (const card of cards) expect(card).not.toMatch(/<a\b|<button\b/);
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
