import { runWithLang } from "@plexco/core/i18n";
import { describe, expect, it } from "vitest";
import { reply, replyIdForCode, type ReplyId } from "./player-commands";

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
