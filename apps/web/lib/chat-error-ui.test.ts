import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CLIENT_BAD_RESPONSE } from "./api-client";
import {
  chatAdminsOnlyHint,
  describeChatError,
  liveRoundEffect,
  type ChatErrorAction as Action,
  type ChatErrorState,
} from "./chat-error-ui";

const en = (_vi: string, e: string) => e;
const both = (v: string, e: string) => `${v}|${e}`;
const AUTH = "Your session has expired. Please sign in again.";
const SUSP = "This club is suspended.";
const RATE = "You are going too fast. Please try again in a moment.";
const OFF = "You are offline.";
const GEN = "Something went wrong. Please try again.";
const NO_LIST = "There are no chat channels you can read.";
const NO_ACCESS = "You do not have access to this channel.";
const INVALID = "This message is not valid.";
const LARGE = "This message is too long (4,000 characters at most).";
const CAP = "You cannot post in this channel.";
const REPLY = "The message you replied to is no longer available.";
const CSRF = "This page is out of date. Please reload it.";
const CHANGED = "This message changed; the latest version is shown.";
const NO_MOD = "You cannot moderate this message.";
const REASON = "The reason or note is not valid.";

type Ui = ChatErrorState | "keep" | null; // read screens: data-state; edit: "keep" = editor stays open
type Case = [Action, string, string, boolean, Ui]; // action, "<HTTP> <code>", English copy ("" = silent), retry, ui
const same = (actions: Action[], key: string, msg: string, ui: Ui, retry = false): Case[] =>
  actions.map((a) => [a, key, msg, retry, ui]);
const READS: Action[] = ["list", "history", "list-refetch", "history-refetch"];

// Keys are the first column of the readiness section 5 tables.
const ROWS: Case[] = [
  ...same(["list", "list-refetch"], "403 CHAT_FORBIDDEN", NO_LIST, "empty"),
  ...same(["list", "history"], "429 CHAT_RATE_LIMITED", RATE, "error", true),
  ...same(["list", "history", "list-refetch"], "0 CLIENT_NETWORK_ERROR", OFF, "offline", true),
  ...same(["list", "history"], "400 INVALID_BODY", GEN, "error", true),
  ...same(["history", "history-refetch"], "403 CHAT_FORBIDDEN", NO_ACCESS, "error"),
  ...same(["list-refetch", "history-refetch", "read"], "429 CHAT_RATE_LIMITED", "", null),
  ["send", "0 CLIENT_NETWORK_ERROR", "Not sent.", true, null],
  ...same(["send", "delete"], "429 CHAT_RATE_LIMITED", RATE, null, true),
  ["send", "400 INVALID_BODY", INVALID, false, null],
  ["send", "413 CHAT_MESSAGE_TOO_LARGE", LARGE, false, null],
  ...same(["send", "edit"], "403 CHAT_CAPABILITY_REQUIRED", CAP, null),
  ["send", "409 CHAT_REPLY_INVALID", REPLY, false, null],
  ...same(["send", "edit"], "403 CHAT_FORBIDDEN", NO_ACCESS, null),
  ["send", "409 CHAT_IDEMPOTENCY_MISMATCH", GEN, false, null],
  ["edit", "409 CHAT_EDIT_WINDOW_CLOSED", "This message can no longer be edited.", false, null],
  ["edit", "409 CHAT_EDIT_CONFLICT", CHANGED, false, null],
  ["edit", "400 INVALID_BODY", INVALID, false, "keep"],
  ["edit", "413 CHAT_MESSAGE_TOO_LARGE", LARGE, false, "keep"],
  ["edit", "429 CHAT_RATE_LIMITED", RATE, true, "keep"],
  ["edit", "0 CLIENT_NETWORK_ERROR", GEN, false, "keep"],
  ["delete", "403 CHAT_FORBIDDEN", "You can only delete your own messages.", false, null],
  ["delete", "0 CLIENT_NETWORK_ERROR", GEN, false, null],
  ...same(READS, "401 AUTH_REQUIRED", AUTH, "error"),
  ...same(READS, "403 TENANT_SUSPENDED", SUSP, "error"),
  ...same(["send", "edit", "delete"], "401 AUTH_REQUIRED", AUTH, null),
  ...same(["send", "edit", "delete"], "403 TENANT_SUSPENDED", SUSP, null),
  ...same(["send", "edit", "delete"], "403 CSRF_INVALID", CSRF, null),
  ["read", "404 NOT_FOUND", "", false, null],
  ["read", "400 INVALID_BODY", "", false, null],
  ["read", "0 CLIENT_NETWORK_ERROR", "", false, null],
  // L16b readiness section 6, action "moderate", in the table's order. A changed reason or note is a
  // new command, so INVALID and the 409 mismatch offer no Retry; an unknown outcome keeps one.
  ["moderate", "403 CHAT_MODERATION_FORBIDDEN", NO_MOD, false, null],
  ["moderate", "422 CHAT_REASON_INVALID", REASON, false, null],
  ["moderate", "409 CHAT_IDEMPOTENCY_MISMATCH", GEN, false, null],
  ["moderate", "429 CHAT_RATE_LIMITED", RATE, true, null],
  ["moderate", "403 CSRF_INVALID", CSRF, false, null],
  ["moderate", "401 AUTH_REQUIRED", AUTH, false, null],
  ["moderate", "403 CHAT_FORBIDDEN", NO_ACCESS, false, null],
  ["moderate", "403 TENANT_SUSPENDED", SUSP, false, null],
  ["moderate", "0 CLIENT_NETWORK_ERROR", OFF, true, null],
  // the fallback row's named members (a code that is a row elsewhere is unknown here): fail closed
  ["moderate", "400 INVALID_BODY", GEN, true, null],
  ["moderate", "413 CHAT_MESSAGE_TOO_LARGE", GEN, true, null],
  ["moderate", "404 NOT_FOUND", GEN, true, null],
  ["moderate", "0 CLIENT_BAD_RESPONSE", GEN, true, null], // chat-api's 15 s timeout
  ["moderate", "500 CHAT_MODERATION_FORBIDDEN", GEN, true, null], // a 5xx never reads as a denial
];
// Unknown, empty, bad-response, prototype-named and 5xx answers (a known code under a 5xx included).
const UNKNOWN = [
  "400 SOMETHING_NEW",
  "400 ",
  "500 INTERNAL_ERROR",
  "500 CHAT_FORBIDDEN",
  "503 CHAT_RATE_LIMITED",
].concat([`200 ${CLIENT_BAD_RESPONSE}`, "400 constructor", "400 __proto__"]);
const FALLBACK: [Action, string, boolean, Ui][] = [
  ...READS.map((a): [Action, string, boolean, Ui] => [a, GEN, true, "error"]),
  ["send", GEN, true, null],
  ["edit", GEN, false, "keep"],
  ["delete", GEN, false, null],
  ["read", "", false, null],
  ["moderate", GEN, true, null], // the row stays as it is; the retry replays under the same commandId
];

const failure = (key: string) => {
  const [status = "0", code = ""] = key.split(" ");
  return { code, status: Number(status) };
};
const view = (message: string, retry: boolean, ui: Ui) => ({
  message,
  retry,
  silent: message === "",
  state: ui === "keep" ? null : ui,
  keepDraft: ui === "keep",
});

describe("chat error mapping", () => {
  it.each(ROWS)("%s %s", (action, key, message, retry, ui) => {
    expect(describeChatError(action, failure(key), en)).toStrictEqual(view(message, retry, ui));
    if (message) {
      // a real t(vi, en) pair: both halves present, never one string twice
      const [v, e] = describeChatError(action, failure(key), both).message.split("|");
      expect([e, v === e]).toStrictEqual([message, false]);
    }
  });

  it.each(FALLBACK)(
    "%s: an unknown, empty, bad-response or 5xx answer fails closed",
    (action, message, retry, ui) => {
      for (const key of UNKNOWN) {
        expect(describeChatError(action, failure(key), en), key).toStrictEqual(
          view(message, retry, ui),
        );
      }
    },
  );

  it("a failed live round: three codes turn live off, a 429 pauses, anything else is ignored", () => {
    const codes = ["AUTH_REQUIRED", "CHAT_FORBIDDEN", "TENANT_SUSPENDED"];
    expect(codes.map((code) => liveRoundEffect({ code, status: 403 }))).toStrictEqual([
      "off",
      "off",
      "off",
    ]);
    expect(liveRoundEffect({ code: "CHAT_RATE_LIMITED", status: 429 })).toBe("pause");
    for (const key of ["0 CLIENT_NETWORK_ERROR", "404 NOT_FOUND", ...UNKNOWN]) {
      expect(liveRoundEffect(failure(key)), key).toBe("ignore");
    }
  });

  it("the admins_only hint is one real t(vi, en) pair", () => {
    expect(chatAdminsOnlyHint(en)).toBe("Only admins can post in this channel");
    expect(chatAdminsOnlyHint((v) => v)).toBe("Kênh này chỉ quản trị viên được đăng tin");
  });

  it("moderate: the two new copy pairs (N13, N14) are exact t(vi, en) pairs", () => {
    const vi = (code: string, status: number) =>
      describeChatError("moderate", { code, status }, (v) => v).message;
    expect(vi("CHAT_MODERATION_FORBIDDEN", 403)).toBe(
      "Bạn không có quyền kiểm duyệt tin nhắn này.",
    );
    expect(vi("CHAT_REASON_INVALID", 422)).toBe("Lý do hoặc ghi chú không hợp lệ.");
  });

  it("the source logs nothing and touches no storage or cache", () => {
    const source = readFileSync(new URL("./chat-error-ui.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/console\.|localStorage|sessionStorage|indexedDB|caches\./i);
  });
});
