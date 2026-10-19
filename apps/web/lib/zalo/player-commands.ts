import { getLang, t } from "@plexco/core/i18n";
import { RosterMoneyError } from "@plexco/db";
import type {
  claimZaloReplyContext,
  JoinableSessionsResult,
  JoinSessionResult,
  LeavableSeat,
  LeaveSessionResult,
  readLatestZaloReplyContext,
  readMyCharges,
  readZaloPayContext,
  RosterMoneyErrorCode,
} from "@plexco/db";
import { log } from "../log";
import { formatSessionDate, formatSessionTime } from "../session-time";
import type { ParsedZaloCommand } from "./commands";

/** M9 Zalo /join, /leave, /pay and number replies (readiness 4.4-4.7); rendered inside runWithLang. */
export type ZaloListType = "join_list" | "leave_list";

/** Injected by process-event.ts, bound to handle.db/pool, bot, identity.personId and the P-6 id. */
export interface PlayerCommandDeps {
  gate: { linked: boolean; accountRef: string | null };
  listJoinable: () => Promise<JoinableSessionsResult>;
  listLeavable: () => Promise<LeavableSeat[]>;
  saveContext: (contextType: ZaloListType, itemIds: string[]) => Promise<unknown>;
  latestContext: () => ReturnType<typeof readLatestZaloReplyContext>;
  claimContext: (ctx: { id: string; version: number }) => ReturnType<typeof claimZaloReplyContext>;
  join: (sessionId: string) => Promise<JoinSessionResult>;
  leave: (sessionId: string) => Promise<LeaveSessionResult>;
  throttled: (contextType: ZaloListType) => Promise<boolean>;
  readCharges: (accountRef: string) => ReturnType<typeof readMyCharges>;
  payContext: (sessionIds: string[]) => ReturnType<typeof readZaloPayContext>;
  classify: (error: unknown) => string;
}

// The ONE mapping (4.7, RC-5): [vi, en] per row, one row per line so each pair reads side by side.
// prettier-ignore
const REPLY = {
  R1: ["Bạn đã có chỗ trong buổi {ref}.", "You have a place in {ref}."],
  R2: ["Buổi {ref} đã đủ chỗ. Bạn đang ở danh sách chờ, vị trí {n}.", "{ref} is full. You are on the waitlist, position {n}."],
  R3: ["Đã gửi yêu cầu tham gia buổi {ref}. Chủ kèo sẽ duyệt.", "Your request to join {ref} was sent. The host will review it."],
  R4: ["Bạn đã có chỗ trong buổi này.", "You already have a place in this session."],
  R5: ["Buổi chơi không nhận đăng ký.", "This session is not open for joining."],
  R6: ["Bạn cần chủ kèo xem lại trước khi vào lại buổi này.", "The host needs to review this before you can rejoin."],
  R7: ["Chưa tính được giá. Chưa có gì được ghi lại, vui lòng thử lại sau.", "The price could not be worked out. Nothing was saved; please try again later."],
  R8: ["Bạn chưa là thành viên CLB này. Hãy liên hệ chủ CLB hoặc tham gia trên web Plexco.", "You are not a member of this club yet. Contact the host or join on the Plexco web app."],
  R9: ["Danh sách này đã cũ. Gõ lại lệnh để xem danh sách mới.", "This list is out of date. Send the command again for a new list."],
  R10: ["CLB tạm thời không nhận thao tác này.", "The club is not accepting this right now."],
  R11: ["Bạn thao tác quá nhanh. Vui lòng thử lại sau.", "Too many requests. Please try again later."],
  R12: ["Bạn đã rời buổi {ref}.", "You have left {ref}."],
  R13: ["Bạn không thể tự rời buổi này, hãy nhờ chủ kèo.", "You cannot leave this session yourself; ask the host."],
  R14: ["Bạn không có buổi nào để rời.", "You have no sessions to leave."],
  R15head: ["Khoản cần trả của bạn tại CLB này:", "What you owe this club:"],
  R15item: ["- {ref}: {amount}", "- {ref}: {amount}"],
  R15partial: [" (đã trả một phần)", " (partly paid)"],
  R15total: ["Tổng: {amount}", "Total: {amount}"],
  R15pay: ["Vui lòng trả trực tiếp cho chủ kèo.", "Please pay the host directly."],
  R15more: ["+{k} khoản khác", "+{k} more"],
  R16: ["Bạn không có khoản nào cần trả.", "You have nothing to pay."],
  R17: ["Hiện chưa xem được số tiền cần trả. Vui lòng thử lại sau hoặc hỏi chủ kèo.", "Your amount due is unavailable right now. Please try again later or ask the host."],
  R18: ["Đã có lỗi. Vui lòng thử lại sau.", "Something went wrong. Please try again later."],
  R19: ["Bạn cần liên kết tài khoản Plexco trước khi dùng lệnh này. Gõ /link để lấy mã liên kết.", "Link your Plexco account before using this command. Type /link to get a link code."],
  R20: ["Số không hợp lệ — chọn từ 1 đến {N}.", "Invalid number — choose 1 to {N}."],
  R21: ["Hiện không có buổi nào đang mở để bạn tham gia.", "There are no open sessions for you to join right now."],
  R22head: ["Chọn buổi muốn tham gia (trả lời bằng số):", "Choose the session to join (reply with its number):"],
  R22row: ["{n}. {ref}", "{n}. {ref}"],
  R22slots: [" (còn {k} chỗ)", " ({k} places left)"],
  R22full: [" (đã đủ chỗ, vào danh sách chờ)", " (full: you join the waitlist)"],
  R22more: ["Còn buổi khác, xem trên web Plexco.", "More sessions are on the Plexco web app."],
  leaveHead: ["Chọn buổi muốn rời (trả lời bằng số):", "Choose the session to leave (reply with its number):"],
  leaveWait: [" (danh sách chờ, vị trí {p})", " (waitlist, position {p})"],
} as const;

export type ReplyId = keyof typeof REPLY;

/** Renders one row with t(vi, en); placeholders are filled in one pass, values never re-expanded. */
export function reply(id: ReplyId, vars: Record<string, string | number> = {}): string {
  const [vi, en] = REPLY[id];
  return t(vi, en).replace(/\{(\w+)\}/g, (m, k: string) => String(vars[k] ?? m));
}

// prettier-ignore
const BY_CODE = new Map<RosterMoneyErrorCode, ReplyId>([
  ["ALREADY_JOINED", "R4"], ["SESSION_NOT_JOINABLE", "R5"], ["REJOIN_REQUIRES_REVIEW", "R6"],
  ["CHARGE_DERIVATION_UNAVAILABLE", "R7"], ["FORBIDDEN", "R8"], ["SESSION_NOT_FOUND", "R9"],
  ["PLAYER_NOT_FOUND", "R9"], ["TENANT_SUSPENDED", "R10"], ["LEAVE_REQUIRES_HOST", "R13"],
]);

/** A RosterMoneyError code's 4.7 row; any other code is R-18 (fail closed, P-22). */
export function replyIdForCode(code: string): ReplyId {
  return BY_CODE.get(code as RosterMoneyErrorCode) ?? "R18";
}

const ref = (s: { startsAt: string; timezone: string; area: string | null }, l = getLang()) =>
  `${formatSessionDate(s.startsAt, s.timezone, l)} · ${formatSessionTime(s.startsAt, s.timezone, l)}${s.area ? ` · ${s.area}` : ""}`;
const slots = (k: number | null) =>
  k === 0 ? reply("R22full") : k && k > 0 ? reply("R22slots", { k }) : "";
const OUTCOME = { active: "R1", waitlisted: "R2", requested: "R3" } as const;

async function joinList(deps: PlayerCommandDeps): Promise<string> {
  const list = await deps.listJoinable();
  if (!list.member || list.sessions.length === 0) return reply(list.member ? "R21" : "R8");
  const shown = list.sessions.slice(0, 9);
  const ids = shown.map((s) => s.sessionId);
  await deps.saveContext("join_list", ids);
  const rows = shown.map((s, i) => reply("R22row", { n: i + 1, ref: ref(s) }) + slots(s.slotsOpen));
  return [reply("R22head"), ...rows].concat(list.sessions[9] ? reply("R22more") : []).join("\n");
}

async function numberReply(token: string, deps: PlayerCommandDeps): Promise<string> {
  const ctx = await deps.latestContext();
  if (!ctx?.live || ctx.contextType !== "join_list") return reply("R9");
  if (!/^[1-9]\d*$/.test(token) || +token > ctx.itemCount)
    return reply("R20", { N: ctx.itemCount });
  if (await deps.throttled(ctx.contextType)) return reply("R11");
  const list = await deps.listJoinable();
  if (!list.member) return reply("R8");
  const claimed = await deps.claimContext({ id: ctx.id, version: ctx.version });
  const row = list.sessions.find((s) => s.sessionId === claimed?.itemIds[+token - 1]);
  if (!row) return reply("R9");
  const r = await deps.join(row.sessionId);
  return reply(OUTCOME[r.outcome], { ref: ref(row), n: r.waitlistPosition ?? "" });
}

/** join/leave/pay/number: the gate first (R-19), then one fail-closed catch (P-22, P-23). */
export async function runPlayerCommand(cmd: ParsedZaloCommand, deps: PlayerCommandDeps) {
  if (deps.gate.linked !== true) return reply("R19");
  try {
    if (cmd.kind === "join") return await joinList(deps);
    if (cmd.kind === "number") return await numberReply(cmd.args[0] ?? "", deps);
    return reply("R18");
  } catch (error) {
    const id = error instanceof RosterMoneyError ? replyIdForCode(error.code) : "R18";
    const reason = error instanceof RosterMoneyError ? error.code : deps.classify(error);
    if (id === "R18") log.error("zalo_player_command_failed", { command: cmd.kind, reason });
    return reply(id);
  }
}
