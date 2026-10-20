import { CLIENT_NETWORK_ERROR } from "./api-client";
import type { TFn } from "./i18n-client";

/**
 * The chat error mapping (L16 readiness section 5): ONE place that turns a failed chat call into what
 * the screen does. Input is the failure object of chat-api.ts ({ code, status }); the UI branches on
 * `code` only, and a 5xx infers nothing, not even under a known code. Every row is a row of the
 * section 5 tables, copy included (DF-9: one copy per code). A code in no table, an empty code,
 * CLIENT_BAD_RESPONSE and any 5xx fall to the generic fail-closed row of the action. All copy is a
 * literal t(vi, en) pair (HARD RULE 5); nothing is interpolated, so no message text, author label,
 * channel title or client id can reach a string built here, and nothing here logs or stores anything.
 */
export type ChatErrorAction =
  | "list" // 5.1: initial load and manual retry
  | "list-refetch" // 5.1: a live round, or any other refetch of the channel list
  | "history" // 5.2.1: initial load and older page
  | "history-refetch" // 5.2.1: a live refetch, or an edit-conflict refetch
  | "send" // 5.2.2
  | "edit" // 5.2.3
  | "delete" // 5.2.4
  | "read"; // 5.2.5: every failure is silent

export type ChatErrorState = "empty" | "error" | "offline";

/** The failure object of chat-api.ts ({ ok: false, code, status }) is assignable as it is. */
export interface ChatFailure {
  code: string;
  status: number;
}

export interface ChatErrorView {
  /** t(vi, en) copy; "" exactly when `silent`. */
  message: string;
  /** A manual Retry control is offered. There is never an automatic retry. */
  retry: boolean;
  /** Show nothing: no toast, no banner, no state change. */
  silent: boolean;
  /** The data-state of a list or history screen; null for the other actions and for a silent row. */
  state: ChatErrorState | null;
  /** Edit only: the editor stays open with the draft (false = it closes). */
  keepDraft: boolean;
}

type Copy = (t: TFn) => string;
interface Row {
  copy: Copy | null; // null = silent
  retry?: boolean;
  state?: ChatErrorState;
  keepDraft?: boolean;
}
interface Table {
  rows: ReadonlyMap<string, Row>;
  fallback: Row;
}

const NO_LIST: Copy = (t) =>
  t("Chưa có kênh trò chuyện nào bạn được xem.", "There are no chat channels you can read.");
const NO_ACCESS: Copy = (t) =>
  t("Bạn không có quyền xem kênh này.", "You do not have access to this channel.");
const AUTH: Copy = (t) =>
  t(
    "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.",
    "Your session has expired. Please sign in again.",
  );
const SUSPENDED: Copy = (t) => t("CLB đang bị tạm ngưng.", "This club is suspended.");
const RATE: Copy = (t) =>
  t(
    "Bạn thao tác quá nhanh. Vui lòng thử lại sau giây lát.",
    "You are going too fast. Please try again in a moment.",
  );
const OFFLINE: Copy = (t) => t("Bạn đang ngoại tuyến.", "You are offline.");
const GENERIC: Copy = (t) =>
  t("Đã có lỗi. Vui lòng thử lại.", "Something went wrong. Please try again.");
const NOT_SENT: Copy = (t) => t("Chưa gửi được.", "Not sent.");
const INVALID: Copy = (t) => t("Tin nhắn không hợp lệ.", "This message is not valid.");
const TOO_LARGE: Copy = (t) =>
  t(
    "Tin nhắn quá dài (tối đa 4.000 ký tự).",
    "This message is too long (4,000 characters at most).",
  );
const CAPABILITY: Copy = (t) =>
  t("Bạn không có quyền đăng tin trong kênh này.", "You cannot post in this channel.");
const REPLY_INVALID: Copy = (t) =>
  t(
    "Tin nhắn bạn trả lời không còn khả dụng.",
    "The message you replied to is no longer available.",
  );
const CSRF: Copy = (t) =>
  t("Trang đã cũ. Vui lòng tải lại trang.", "This page is out of date. Please reload it.");
const WINDOW_CLOSED: Copy = (t) =>
  t("Tin nhắn này không thể sửa nữa.", "This message can no longer be edited.");
const CONFLICT: Copy = (t) =>
  t(
    "Tin nhắn đã thay đổi; đã hiện bản mới nhất.",
    "This message changed; the latest version is shown.",
  );
const OWN_ONLY: Copy = (t) =>
  t("Bạn chỉ có thể xoá tin nhắn của mình.", "You can only delete your own messages.");

const SILENT: Row = { copy: null };
const SCREEN_FALLBACK: Row = { copy: GENERIC, state: "error", retry: true };

// Rows are keyed by code and read with Map#get, so a code named "constructor" or "__proto__" cannot
// hit an inherited property. "Retry" is true only where the table row says Retry or manual retry.
const LIST_ROWS = new Map<string, Row>([
  ["CHAT_FORBIDDEN", { copy: NO_LIST, state: "empty" }],
  ["AUTH_REQUIRED", { copy: AUTH, state: "error" }],
  ["TENANT_SUSPENDED", { copy: SUSPENDED, state: "error" }],
  ["CHAT_RATE_LIMITED", { copy: RATE, state: "error", retry: true }],
  [CLIENT_NETWORK_ERROR, { copy: OFFLINE, state: "offline", retry: true }],
]);
// 5.2.1 is 5.1 except that no access is an error screen, not an empty list.
const HISTORY_ROWS = new Map(LIST_ROWS).set("CHAT_FORBIDDEN", { copy: NO_ACCESS, state: "error" });

const TABLES: Record<ChatErrorAction, Table> = {
  list: { rows: LIST_ROWS, fallback: SCREEN_FALLBACK },
  // DF-4: a 429 on a refetch is a silent pause, never a toast and never "no new messages"
  "list-refetch": {
    rows: new Map(LIST_ROWS).set("CHAT_RATE_LIMITED", SILENT),
    fallback: SCREEN_FALLBACK,
  },
  history: { rows: HISTORY_ROWS, fallback: SCREEN_FALLBACK },
  "history-refetch": {
    rows: new Map(HISTORY_ROWS).set("CHAT_RATE_LIMITED", SILENT),
    fallback: SCREEN_FALLBACK,
  },
  // 5.2.2: a failed send keeps its optimistic row; Retry reuses the same clientMsgId and Discard is
  // always offered, so neither is modelled here.
  send: {
    rows: new Map<string, Row>([
      [CLIENT_NETWORK_ERROR, { copy: NOT_SENT, retry: true }],
      ["CHAT_RATE_LIMITED", { copy: RATE, retry: true }],
      ["INVALID_BODY", { copy: INVALID }],
      ["CHAT_MESSAGE_TOO_LARGE", { copy: TOO_LARGE }],
      ["CHAT_CAPABILITY_REQUIRED", { copy: CAPABILITY }],
      ["CHAT_REPLY_INVALID", { copy: REPLY_INVALID }],
      ["CSRF_INVALID", { copy: CSRF }],
      ["AUTH_REQUIRED", { copy: AUTH }],
      ["CHAT_FORBIDDEN", { copy: NO_ACCESS }],
      ["TENANT_SUSPENDED", { copy: SUSPENDED }],
      // the same id met a different body: a Retry would repeat it, so none is offered
      ["CHAT_IDEMPOTENCY_MISMATCH", { copy: GENERIC }],
    ]),
    fallback: { copy: GENERIC, retry: true },
  },
  edit: {
    rows: new Map<string, Row>([
      ["CHAT_EDIT_WINDOW_CLOSED", { copy: WINDOW_CLOSED }],
      ["CHAT_EDIT_CONFLICT", { copy: CONFLICT }], // never a blind retry: the caller refetches
      ["CHAT_CAPABILITY_REQUIRED", { copy: CAPABILITY }],
      ["INVALID_BODY", { copy: INVALID, keepDraft: true }],
      ["CHAT_MESSAGE_TOO_LARGE", { copy: TOO_LARGE, keepDraft: true }],
      ["CHAT_RATE_LIMITED", { copy: RATE, retry: true, keepDraft: true }],
      ["CSRF_INVALID", { copy: CSRF }],
      ["AUTH_REQUIRED", { copy: AUTH }],
      ["CHAT_FORBIDDEN", { copy: NO_ACCESS }],
      ["TENANT_SUSPENDED", { copy: SUSPENDED }],
    ]),
    fallback: { copy: GENERIC, keepDraft: true },
  },
  delete: {
    rows: new Map<string, Row>([
      ["CHAT_FORBIDDEN", { copy: OWN_ONLY }],
      ["CHAT_RATE_LIMITED", { copy: RATE, retry: true }],
      ["CSRF_INVALID", { copy: CSRF }],
      ["AUTH_REQUIRED", { copy: AUTH }],
      ["TENANT_SUSPENDED", { copy: SUSPENDED }],
    ]),
    fallback: { copy: GENERIC },
  },
  // 5.2.5: the badge never advances without a 200, so no failure is shown
  read: { rows: new Map(), fallback: SILENT },
};

export function describeChatError(
  action: ChatErrorAction,
  failure: ChatFailure,
  t: TFn,
): ChatErrorView {
  const { rows, fallback } = TABLES[action];
  // a 5xx infers nothing, whatever code it carries (the "500" of every default row)
  const row = (failure.status >= 500 ? undefined : rows.get(failure.code)) ?? fallback;
  return {
    message: row.copy ? row.copy(t) : "",
    retry: row.retry === true,
    silent: row.copy === null,
    state: row.state ?? null,
    keepDraft: row.keepDraft === true,
  };
}

const LIVE_OFF = new Set(["AUTH_REQUIRED", "CHAT_FORBIDDEN", "TENANT_SUSPENDED"]);

/**
 * 5.3: what a failed live round does. "off" = live stops for the view (the screen then shows its own
 * list or history row for the same failure; a failed send answering these codes means the same);
 * "pause" = the round returns true, a 30 s silent pause; "ignore" = the round ends, nothing inferred.
 */
export function liveRoundEffect(failure: ChatFailure): "off" | "pause" | "ignore" {
  if (failure.status >= 500) return "ignore";
  if (LIVE_OFF.has(failure.code)) return "off";
  return failure.code === "CHAT_RATE_LIMITED" ? "pause" : "ignore";
}

/** DF-5 (RO-L16-1): the composer's hint in an admins_only channel; the composer imports this one copy. */
export function chatAdminsOnlyHint(t: TFn): string {
  return t("Kênh này chỉ quản trị viên được đăng tin", "Only admins can post in this channel");
}
