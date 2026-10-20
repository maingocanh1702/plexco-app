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

type Ui = ChatErrorState | "keep" | null; // read screens: data-state; edit: "keep" = editor stays open
type Case = [Action, string, string, boolean, Ui]; // action, "<HTTP> <code>", English copy ("" = silent), retry, ui
const same = (actions: Action[], key: string, msg: string, ui: Ui): Case[] =>
  actions.map((a) => [a, key, msg, false, ui]);

// Keys are the first column of the readiness section 5 tables.
const ROWS: Case[] = [
  ["list", "403 CHAT_FORBIDDEN", NO_LIST, false, "empty"],
  ["list", "429 CHAT_RATE_LIMITED", RATE, true, "error"],
  ["list", "0 CLIENT_NETWORK_ERROR", OFF, true, "offline"],
  ["list", "400 INVALID_BODY", GEN, true, "error"],
  ["history", "403 CHAT_FORBIDDEN", NO_ACCESS, false, "error"],
  ["history", "429 CHAT_RATE_LIMITED", RATE, true, "error"],
  ["history", "0 CLIENT_NETWORK_ERROR", OFF, true, "offline"],
  ["history", "400 INVALID_BODY", GEN, true, "error"],
  ["list-refetch", "429 CHAT_RATE_LIMITED", "", false, null],
  ["list-refetch", "403 CHAT_FORBIDDEN", NO_LIST, false, "empty"],
  ["list-refetch", "0 CLIENT_NETWORK_ERROR", OFF, true, "offline"],
  ["history-refetch", "429 CHAT_RATE_LIMITED", "", false, null],
  ["history-refetch", "403 CHAT_FORBIDDEN", NO_ACCESS, false, "error"],
  ["send", "0 CLIENT_NETWORK_ERROR", "Not sent.", true, null],
  ["send", "429 CHAT_RATE_LIMITED", RATE, true, null],
  ["send", "400 INVALID_BODY", INVALID, false, null],
  ["send", "413 CHAT_MESSAGE_TOO_LARGE", LARGE, false, null],
  ["send", "403 CHAT_CAPABILITY_REQUIRED", CAP, false, null],
  ["send", "409 CHAT_REPLY_INVALID", REPLY, false, null],
  ["send", "403 CHAT_FORBIDDEN", NO_ACCESS, false, null],
  ["send", "409 CHAT_IDEMPOTENCY_MISMATCH", GEN, false, null],
  ["edit", "409 CHAT_EDIT_WINDOW_CLOSED", "This message can no longer be edited.", false, null],
  [
    "edit",
    "409 CHAT_EDIT_CONFLICT",
    "This message changed; the latest version is shown.",
    false,
    null,
  ],
  ["edit", "403 CHAT_CAPABILITY_REQUIRED", CAP, false, null],
  ["edit", "400 INVALID_BODY", INVALID, false, "keep"],
  ["edit", "413 CHAT_MESSAGE_TOO_LARGE", LARGE, false, "keep"],
  ["edit", "429 CHAT_RATE_LIMITED", RATE, true, "keep"],
  ["edit", "403 CHAT_FORBIDDEN", NO_ACCESS, false, null],
  ["edit", "0 CLIENT_NETWORK_ERROR", GEN, false, "keep"],
  ["delete", "403 CHAT_FORBIDDEN", "You can only delete your own messages.", false, null],
  ["delete", "429 CHAT_RATE_LIMITED", RATE, true, null],
  ["delete", "0 CLIENT_NETWORK_ERROR", GEN, false, null],
  ...same(
    ["list", "history", "list-refetch", "history-refetch"],
    "401 AUTH_REQUIRED",
    AUTH,
    "error",
  ),
  ...same(
    ["list", "history", "list-refetch", "history-refetch"],
    "403 TENANT_SUSPENDED",
    SUSP,
    "error",
  ),
  ...same(["send", "edit", "delete"], "401 AUTH_REQUIRED", AUTH, null),
  ...same(["send", "edit", "delete"], "403 TENANT_SUSPENDED", SUSP, null),
  ...same(["send", "edit", "delete"], "403 CSRF_INVALID", CSRF, null),
  ...[
    "429 CHAT_RATE_LIMITED",
    "404 NOT_FOUND",
    "400 INVALID_BODY",
    "0 CLIENT_NETWORK_ERROR",
  ].flatMap((key) => same(["read"], key, "", null)),
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
  ...(["list", "list-refetch", "history", "history-refetch"] as const).map(
    (a): [Action, string, boolean, Ui] => [a, GEN, true, "error"],
  ),
  ["send", GEN, true, null],
  ["edit", GEN, false, "keep"],
  ["delete", GEN, false, null],
  ["read", "", false, null],
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

  it("the source logs nothing and touches no storage or cache", () => {
    const source = readFileSync(new URL("./chat-error-ui.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/console\.|localStorage|sessionStorage|indexedDB|caches\./i);
  });
});
