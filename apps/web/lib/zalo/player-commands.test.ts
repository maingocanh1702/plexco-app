import { runWithLang } from "@plexco/core/i18n";
import { RosterMoneyError } from "@plexco/db";
import { describe, expect, it, vi } from "vitest";
import { log } from "../log";
import { formatSessionDate } from "../session-time";
import type { ParsedZaloCommand } from "./commands";
import {
  reply,
  replyIdForCode,
  runPlayerCommand,
  type PlayerCommandDeps,
  type ReplyId,
} from "./player-commands";

// Every reply path asserts this (HARD RULE 2, D3): no bank detail, QR or pay code ever renders.
const BANK = /bank|ngân hàng|\bstk\b|\bqr\b|số tài khoản|pay[_ ]?code|iban|swift/i;
const expectNoBankData = (text: string) => expect(text).not.toMatch(BANK);

const V = { ref: "REF", n: 3, N: 9, k: 2, p: 4, amount: "150.000đ" };

// prettier-ignore
const ROWS: [ReplyId, string, string][] = [
  ["R1", "Bạn đã có chỗ trong buổi REF.", "You have a place in REF."],
  ["R2", "Buổi REF đã đủ chỗ. Bạn đang ở danh sách chờ, vị trí 3.", "REF is full. You are on the waitlist, position 3."],
  ["R3", "Đã gửi yêu cầu tham gia buổi REF. Chủ kèo sẽ duyệt.", "Your request to join REF was sent. The host will review it."],
  ["R4", "Bạn đã có chỗ trong buổi này.", "You already have a place in this session."],
  ["R5", "Buổi chơi không nhận đăng ký.", "This session is not open for joining."],
  ["R6", "Bạn cần chủ kèo xem lại trước khi vào lại buổi này.", "The host needs to review this before you can rejoin."],
  ["R7", "Chưa tính được giá. Chưa có gì được ghi lại, vui lòng thử lại sau.", "The price could not be worked out. Nothing was saved; please try again later."],
  ["R8", "Bạn chưa là thành viên CLB này. Hãy liên hệ chủ CLB hoặc tham gia trên web Plexco.", "You are not a member of this club yet. Contact the host or join on the Plexco web app."],
  ["R9", "Danh sách này đã cũ. Gõ lại lệnh để xem danh sách mới.", "This list is out of date. Send the command again for a new list."],
  ["R10", "CLB tạm thời không nhận thao tác này.", "The club is not accepting this right now."],
  ["R11", "Bạn thao tác quá nhanh. Vui lòng thử lại sau.", "Too many requests. Please try again later."],
  ["R12", "Bạn đã rời buổi REF.", "You have left REF."],
  ["R13", "Bạn không thể tự rời buổi này, hãy nhờ chủ kèo.", "You cannot leave this session yourself; ask the host."],
  ["R14", "Bạn không có buổi nào để rời.", "You have no sessions to leave."],
  ["R15head", "Khoản cần trả của bạn tại CLB này:", "What you owe this club:"],
  ["R15item", "- REF: 150.000đ", "- REF: 150.000đ"],
  ["R15partial", " (đã trả một phần)", " (partly paid)"],
  ["R15total", "Tổng: 150.000đ", "Total: 150.000đ"],
  ["R15pay", "Vui lòng trả trực tiếp cho chủ kèo.", "Please pay the host directly."],
  ["R15more", "+2 khoản khác", "+2 more"],
  ["R16", "Bạn không có khoản nào cần trả.", "You have nothing to pay."],
  ["R17", "Hiện chưa xem được số tiền cần trả. Vui lòng thử lại sau hoặc hỏi chủ kèo.", "Your amount due is unavailable right now. Please try again later or ask the host."],
  ["R18", "Đã có lỗi. Vui lòng thử lại sau.", "Something went wrong. Please try again later."],
  ["R19", "Bạn cần liên kết tài khoản Plexco trước khi dùng lệnh này. Gõ /link để lấy mã liên kết.", "Link your Plexco account before using this command. Type /link to get a link code."],
  ["R20", "Số không hợp lệ — chọn từ 1 đến 9.", "Invalid number — choose 1 to 9."],
  ["R21", "Hiện không có buổi nào đang mở để bạn tham gia.", "There are no open sessions for you to join right now."],
  ["R22head", "Chọn buổi muốn tham gia (trả lời bằng số):", "Choose the session to join (reply with its number):"],
  ["R22row", "3. REF", "3. REF"],
  ["R22slots", " (còn 2 chỗ)", " (2 places left)"],
  ["R22full", " (đã đủ chỗ, vào danh sách chờ)", " (full: you join the waitlist)"],
  ["R22more", "Còn buổi khác, xem trên web Plexco.", "More sessions are on the Plexco web app."],
  ["leaveHead", "Chọn buổi muốn rời (trả lời bằng số):", "Choose the session to leave (reply with its number):"],
  ["leaveWait", " (danh sách chờ, vị trí 4)", " (waitlist, position 4)"],
];

describe("reply (readiness 4.7, the ONE mapping R-1..R-22, P-13, P-30)", () => {
  it.each(ROWS)("%s renders the exact vi and en copy", (id, vi, en) => {
    const got = [runWithLang("vi", () => reply(id, V)), runWithLang("en", () => reply(id, V))];
    expect(got).toEqual([vi, en]);
    got.forEach(expectNoBankData);
  });

  it("fills placeholders in one pass: a value is never re-expanded", () => {
    expect(runWithLang("en", () => reply("R2", { ref: "{n}", n: 5 }))).toBe(
      "{n} is full. You are on the waitlist, position 5.",
    );
  });
});

describe("replyIdForCode (4.7 codes; fail-closed default R-18)", () => {
  it("maps each pinned code and every other code to R-18", () => {
    // prettier-ignore
    const map = { ALREADY_JOINED: "R4", SESSION_NOT_JOINABLE: "R5", REJOIN_REQUIRES_REVIEW: "R6", CHARGE_DERIVATION_UNAVAILABLE: "R7", FORBIDDEN: "R8", SESSION_NOT_FOUND: "R9", PLAYER_NOT_FOUND: "R9", TENANT_SUSPENDED: "R10", LEAVE_REQUIRES_HOST: "R13", COMMAND_ID_CONFLICT: "R18", INVALID_INPUT: "R18", GENDER_FORBIDDEN: "R18", SESSION_NOT_OPEN: "R18", toString: "R18" };
    for (const [code, id] of Object.entries(map))
      expect([code, replyIdForCode(code)]).toEqual([code, id]);
  });
});

// Join-path replies carry no amount at all, so no one's debt can appear (lane STOP line, D3).
const expectSafe = (text: string) => {
  expectNoBankData(text);
  expect(text).not.toMatch(/\d\s?[đ₫]|vnd/i);
};
const AT = "2026-10-24T12:00:00.000Z"; // 19:00 in Asia/Ho_Chi_Minh: proves the session's own zone
const sid = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
const row = (i: number, slotsOpen: number | null, area: string | null = "Sân A") => ({
  sessionId: sid(i),
  startsAt: AT,
  timezone: "Asia/Ho_Chi_Minh",
  area,
  slotsOpen,
});
const JOIN: ParsedZaloCommand = { kind: "join", name: "join", args: [] };
const num = (token: string): ParsedZaloCommand => ({
  kind: "number",
  name: "number",
  args: [token],
});
const joined = (outcome: string, waitlistPosition: number | null = null) =>
  vi.fn(async () => ({
    outcome,
    playerId: "pl-1",
    waitlistPosition,
    requestId: null,
    replayed: false,
  }));
const unexpected = () => vi.fn(async () => Promise.reject(new Error("not stubbed")));
const makeDeps = (over: Record<string, unknown> = {}) =>
  ({
    gate: { linked: true, accountRef: "acc-1" },
    listJoinable: vi.fn(async () => ({
      member: true,
      sessions: [row(1, 2), row(2, 0, null), row(3, null)],
    })),
    listLeavable: unexpected(),
    saveContext: vi.fn(async () => ({ id: "ctx-1", version: 4 })),
    latestContext: vi.fn(async () => ({
      id: "ctx-1",
      version: 4,
      contextType: "join_list",
      itemCount: 3,
      live: true,
    })),
    claimContext: vi.fn(async () => ({
      contextType: "join_list",
      itemIds: [sid(1), sid(2), sid(3)],
    })),
    join: joined("active"),
    leave: unexpected(),
    throttled: vi.fn(async () => false),
    readCharges: unexpected(),
    payContext: unexpected(),
    classify: vi.fn(() => "PROCESSING_ERROR"),
    ...over,
  }) as unknown as PlayerCommandDeps;
const run = (cmd: ParsedZaloCommand, d: PlayerCommandDeps, lang: "vi" | "en" = "en") =>
  runWithLang(lang, () => runPlayerCommand(cmd, d));
const EN = (id: ReplyId, vars: Record<string, string | number> = {}) =>
  runWithLang("en", () => reply(id, vars));

describe("runPlayerCommand: /join and the number reply on a join_list context (4.3, 4.4, 4.7)", () => {
  it("R-19 when the gate is not linked: nothing else is read (T-4, T-5)", async () => {
    for (const cmd of [JOIN, num("1")]) {
      const d = makeDeps({ gate: { linked: false, accountRef: null } });
      const text = await run(cmd, d);
      expect(text).toBe(EN("R19"));
      expectSafe(text);
      for (const f of [
        d.listJoinable,
        d.saveContext,
        d.latestContext,
        d.throttled,
        d.claimContext,
        d.join,
      ])
        expect(f).not.toHaveBeenCalled();
    }
  });

  it("/join lists the rows with {ref} and slot suffixes and stores them as join_list (P-10, P-20, R-22)", async () => {
    const d = makeDeps();
    const en = await run(JOIN, d);
    const viText = await run(JOIN, makeDeps(), "vi");
    const [de, dv] = [
      formatSessionDate(AT, "Asia/Ho_Chi_Minh", "en"),
      formatSessionDate(AT, "Asia/Ho_Chi_Minh", "vi"),
    ];
    expect(en.split("\n")).toEqual([
      "Choose the session to join (reply with its number):",
      `1. ${de} · 19:00 · Sân A (2 places left)`,
      `2. ${de} · 19:00 (full: you join the waitlist)`,
      `3. ${de} · 19:00 · Sân A`,
    ]);
    expect(viText.split("\n")).toEqual([
      "Chọn buổi muốn tham gia (trả lời bằng số):",
      `1. ${dv} · 19:00 · Sân A (còn 2 chỗ)`,
      `2. ${dv} · 19:00 (đã đủ chỗ, vào danh sách chờ)`,
      `3. ${dv} · 19:00 · Sân A`,
    ]);
    expect(d.saveContext).toHaveBeenCalledWith("join_list", [sid(1), sid(2), sid(3)]);
    [en, viText].forEach(expectSafe);
  });

  it("a 10th row adds the more line and only the 9 shown ids are stored (RC-3, P-10)", async () => {
    const sessions = Array.from({ length: 10 }, (_, i) => row(i + 1, 1));
    const d = makeDeps({ listJoinable: vi.fn(async () => ({ member: true, sessions })) });
    const lines = (await run(JOIN, d)).split("\n");
    expect([lines.length, lines[9]?.startsWith("9. "), lines[10]]).toEqual([
      11,
      true,
      EN("R22more"),
    ]);
    expect(d.saveContext).toHaveBeenCalledWith(
      "join_list",
      sessions.slice(0, 9).map((s) => s.sessionId),
    );
    expectSafe(lines.join("\n"));
  });

  it("R-8 for a non-member and R-21 for an empty list; no context row (P-3, P-10)", async () => {
    for (const [list, id] of [
      [{ member: false }, "R8"],
      [{ member: true, sessions: [] }, "R21"],
    ] as const) {
      const d = makeDeps({ listJoinable: vi.fn(async () => list) });
      const text = await run(JOIN, d);
      expect(text).toBe(EN(id));
      expectSafe(text);
      expect(d.saveContext).not.toHaveBeenCalled();
    }
  });

  it("number: R-9 without a live join_list context, R-20 out of range or with a leading zero (P-5, T-7)", async () => {
    const cases: [Record<string, unknown>, string, string][] = [
      [{ latestContext: vi.fn(async () => null) }, "1", EN("R9")],
      [
        {
          latestContext: vi.fn(async () => ({
            id: "c",
            version: 1,
            contextType: "join_list",
            itemCount: 3,
            live: false,
          })),
        },
        "1",
        EN("R9"),
      ],
      [
        {
          latestContext: vi.fn(async () => ({
            id: "c",
            version: 1,
            contextType: "session_list",
            itemCount: 3,
            live: true,
          })),
        },
        "1",
        EN("R9"),
      ],
      [{}, "4", "Invalid number — choose 1 to 3."],
      [{}, "0", "Invalid number — choose 1 to 3."],
      [{}, "01", "Invalid number — choose 1 to 3."],
    ];
    for (const [over, token, want] of cases) {
      const d = makeDeps(over);
      const text = await run(num(token), d);
      expect([token, text]).toEqual([token, want]);
      expectSafe(text);
      for (const f of [d.throttled, d.claimContext, d.join]) expect(f).not.toHaveBeenCalled();
    }
  });

  it("R-11 when throttled: no claim and no join, so the context stays live (RC-6, P-26, T-23)", async () => {
    const d = makeDeps({ throttled: vi.fn(async () => true) });
    expect(await run(num("1"), d)).toBe(EN("R11"));
    expect(d.throttled).toHaveBeenCalledWith("join_list");
    for (const f of [d.claimContext, d.join]) expect(f).not.toHaveBeenCalled();
  });

  it("confirm claims the read version, joins the listed session and renders its state (R-1..R-3, T-6, T-8, T-16)", async () => {
    const ref = `${formatSessionDate(AT, "Asia/Ho_Chi_Minh", "en")} · 19:00`;
    const cases: [ReturnType<typeof joined>, string][] = [
      [joined("active"), `You have a place in ${ref}.`],
      [joined("waitlisted", 3), `${ref} is full. You are on the waitlist, position 3.`],
      [joined("requested"), `Your request to join ${ref} was sent. The host will review it.`],
    ];
    for (const [join, want] of cases) {
      const d = makeDeps({ join });
      const text = await run(num("2"), d);
      expect(text).toBe(want);
      expectSafe(text);
      expect(d.claimContext).toHaveBeenCalledWith({ id: "ctx-1", version: 4 });
      expect(join).toHaveBeenCalledWith(sid(2));
    }
  });

  it("confirm: R-9 on a lost claim or a session the live list no longer shows, R-8 for a lapsed member; no join", async () => {
    const cases: [Record<string, unknown>, ReplyId][] = [
      [{ claimContext: vi.fn(async () => null) }, "R9"],
      [{ listJoinable: vi.fn(async () => ({ member: true, sessions: [row(1, 2)] })) }, "R9"],
      [{ listJoinable: vi.fn(async () => ({ member: false })) }, "R8"],
    ];
    for (const [over, id] of cases) {
      const d = makeDeps(over);
      const text = await run(num("2"), d);
      expect(text).toBe(EN(id));
      expectSafe(text);
      expect(d.join).not.toHaveBeenCalled();
    }
  });

  it("codes map through the ONE table; R-18 codes and other throws log only {command, reason} (P-22, P-23, T-19)", async () => {
    const spy = vi.spyOn(log, "error").mockImplementation(() => {});
    const boom = new Error("boom: message text");
    const fails = (e: unknown) => vi.fn(async () => Promise.reject(e));
    const cases: [ParsedZaloCommand, Record<string, unknown>, ReplyId, string | null][] = [
      [num("1"), { join: fails(new RosterMoneyError("SESSION_NOT_JOINABLE", "x")) }, "R5", null],
      [
        num("1"),
        { join: fails(new RosterMoneyError("CHARGE_DERIVATION_UNAVAILABLE", "x")) },
        "R7",
        null,
      ],
      [
        num("1"),
        { join: fails(new RosterMoneyError("COMMAND_ID_CONFLICT", "x")) },
        "R18",
        "COMMAND_ID_CONFLICT",
      ],
      [num("1"), { join: fails(boom) }, "R18", "PROCESSING_ERROR"],
      [num("1"), { claimContext: fails(boom) }, "R18", "PROCESSING_ERROR"],
      [JOIN, { listJoinable: fails(boom) }, "R18", "PROCESSING_ERROR"],
    ];
    for (const [cmd, over, id, reason] of cases) {
      spy.mockClear();
      const d = makeDeps(over);
      const text = await run(cmd, d);
      expect(text).toBe(EN(id));
      expectSafe(text);
      expect(spy.mock.calls).toEqual(
        reason ? [["zalo_player_command_failed", { command: cmd.kind, reason }]] : [],
      );
      if (reason === "PROCESSING_ERROR") expect(d.classify).toHaveBeenCalledWith(boom);
      else expect(d.classify).not.toHaveBeenCalled();
    }
    spy.mockRestore();
  });
});
