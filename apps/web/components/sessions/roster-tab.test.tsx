import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LangProvider } from "../../lib/i18n-client";
import type { RosterChargeDto, RosterPlayerDto, SessionDetailDto } from "../../lib/sessions-api";
import { RosterTab } from "./roster-tab";

const charge = (over: Partial<RosterChargeDto> = {}): RosterChargeDto => ({
  id: "c",
  amountDue: 50000,
  amountAllocated: 0,
  status: "open",
  effectiveAllocated: 0,
  remaining: 50000,
  allocations: [],
  ...over,
});
const player = (
  id: string,
  name: string,
  over: Partial<RosterPlayerDto> = {},
): RosterPlayerDto => ({
  id,
  membershipId: `m-${id}`,
  displayName: name,
  status: "active",
  joinedAt: "2026-10-01T00:00:00.000Z",
  waitlistPosition: null,
  charge: charge(),
  ...over,
});
const players = [
  player("p1", "Lan", {
    charge: charge({
      status: "partial",
      remaining: 30000,
      effectiveAllocated: 20000,
      allocations: [
        {
          id: "a1",
          source: "cash",
          amount: 20000,
          createdAt: "2026-10-02T03:00:00.000Z",
          reasonCode: "đợt 1",
          reversesAllocationId: null,
        },
      ],
    }),
  }),
  player("p2", "Minh", {
    charge: charge({ status: "paid", remaining: 0, effectiveAllocated: 50000 }),
  }),
  player("p3", "Hà", { status: "waitlisted", waitlistPosition: 2, charge: null }),
  player("p4", "Vy", { charge: charge({ status: "void", remaining: 0 }) }),
];
const session = (over: Partial<SessionDetailDto> = {}) =>
  ({
    id: "s1",
    status: "open",
    slotsMax: 12,
    players,
    guestNotes: [],
    counts: { active: 3, waitlisted: 1, guestNotes: 0, occupied: 3 },
    ...over,
  }) as unknown as SessionDetailDto;
const render = (s: SessionDetailDto, lang: "vi" | "en" = "vi") =>
  renderToStaticMarkup(
    <LangProvider lang={lang}>
      <RosterTab session={s} ctx={{ tenantId: "t", csrfToken: "x" }} onChanged={() => {}} />
    </LangProvider>,
  );

describe("RosterTab", () => {
  it("open session: payment checkbox only on payable rows, remove on active/waitlisted, ledger for rows with allocations", () => {
    const html = render(session());
    expect(html.match(/type="checkbox"/g)).toHaveLength(1); // only Lan has something left to pay
    expect(html).toContain("Chọn Lan để gạch nợ");
    expect(html).toContain("Không thu"); // void charge
    expect(html).toContain("Chờ #2");
    expect(html).toContain("Gỡ Hà");
    expect(html).toContain("Tiền mặt");
    expect(html).toContain("Hoàn tác khoản");
    expect(html).toContain("Thêm người chơi");
  });

  it("closed session: add/remove disabled with a described hint, payments still selectable", () => {
    const html = render(session({ status: "closed" }));
    expect(html).toContain("Chỉ thêm hoặc gỡ người chơi khi buổi đang mở.");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-describedby=[^>]*>Thêm người chơi/);
    expect(html).toContain('type="checkbox"');
    expect(html).not.toContain("Chỉ ghi nhận thanh toán khi buổi");
  });

  it("cancelled session: nothing is selectable and the payment hint is shown", () => {
    const html = render(session({ status: "cancelled" }));
    expect(html).not.toContain('type="checkbox"');
    expect(html).toContain("Chỉ ghi nhận thanh toán khi buổi đang mở hoặc đã đóng.");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Gạch nợ \(0\)/);
  });

  it("empty roster shows the empty state", () => {
    expect(render(session({ players: [] }))).toContain("Chưa có người chơi");
  });

  it("every string has an English twin (no Vietnamese leaks into en)", () => {
    const en = render(session(), "en");
    expect(en).toContain("Add player");
    expect(en).toContain("Record payment (0)");
    expect(en).toContain("Select Lan for payment");
    expect(en).toContain("Cash");
    expect(en).not.toContain("Gạch nợ");
    expect(en).not.toContain("Tiền mặt");
  });
});
