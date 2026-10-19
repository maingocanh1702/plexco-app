import { describe, expect, it } from "vitest";

import {
  API_ERROR_CODES,
  GENDER_VALUES,
  isApiErrorCode,
  type ApiEnvelope,
  type ApiError,
  type JoinSessionResultDto,
  type PendingJoinRequestDto,
} from "./api-contract.js";

describe("API_ERROR_CODES registry", () => {
  it("has no duplicates", () => {
    expect(new Set(API_ERROR_CODES).size).toBe(API_ERROR_CODES.length);
  });

  it("is sorted (registry rule: keep the list sorted)", () => {
    expect([...API_ERROR_CODES]).toEqual([...API_ERROR_CODES].sort());
  });

  it("codes are SCREAMING_SNAKE_CASE", () => {
    for (const code of API_ERROR_CODES) {
      expect(code).toMatch(/^[A-Z][A-Z0-9_]*$/);
    }
  });

  it("registers every literal the FIVE shipped session routes can emit", () => {
    // Scoped deliberately, and NOT "every literal in §3" as an earlier revision claimed
    // (codex round-02 [P3]): §3 also pins INVALID_CHANNEL and SESSION_ALREADY_ENDED, which belong
    // to announce. They returned to this registry with the announce route (DD-56 deferral (b),
    // DD-134 (f)) and are asserted by the announce test below, exactly as CANCEL_REQUIRES_REVIEW
    // returned with its route.
    //
    // THREE became FIVE when the close and cancel routes shipped, and that is the whole reason
    // CANCEL_REQUIRES_REVIEW appears below: the earlier revision of this comment named it as an
    // example of a code still awaiting its route. The commands have thrown it since 2026-08-26;
    // until those routes existed nothing could put it on the wire.
    //
    // The routes cannot emit a code that is not here: err() is typed to ApiErrorCode, and
    // mapSessionCommandError now narrows through isApiErrorCode instead of casting, so an
    // unregistered code fails closed to a 500 rather than reaching a client. Losing one of these
    // would silently downgrade a spec-pinned response to a generic error.
    //
    // CLOSE_BLOCKED_OPEN_DEBT joined with DD-131 OD-1 (pending in PR #51): close's open-debt refusal.
    // CANCEL_REQUIRES_REVIEW stays: cancel still emits it, close no longer does.
    for (const code of [
      "CANCEL_REQUIRES_REVIEW",
      "CLOSE_BLOCKED_OPEN_DEBT",
      "CAPACITY_BELOW_OCCUPANCY",
      "CAPACITY_BELOW_ROSTER",
      "COMMAND_ID_CONFLICT",
      "INVALID_TIME_RANGE",
      "MISSING_DISCOVERY_FIELDS",
      "PRICE_CHANGE_REQUIRES_POLICY",
      "SESSION_NOT_FOUND",
      "SESSION_NOT_OPEN",
      "SPORT_INACTIVE",
      "STALE_VERSION",
      "TENANT_SUSPENDED",
    ]) {
      expect(isApiErrorCode(code)).toBe(true);
    }
  });

  it("registers every literal the announce route can emit (DD-56 deferral (b), DD-134 (f))", () => {
    // ANNOUNCE_DELIVERY_DISABLED is the DB-truth delivery guard's refusal (proposed, A-D1).
    for (const code of [
      "ANNOUNCE_DELIVERY_DISABLED",
      "COMMAND_ID_CONFLICT",
      "INVALID_CHANNEL",
      "SESSION_ALREADY_ENDED",
      "SESSION_NOT_FOUND",
      "SESSION_NOT_OPEN",
      "TENANT_SUSPENDED",
    ]) {
      expect(isApiErrorCode(code)).toBe(true);
    }
  });

  it("registers every literal the M2c roster / mark-paid / reversal routes can emit", () => {
    for (const code of [
      "ALLOCATION_EXCEEDS_FUNDS",
      "ALLOCATION_NOT_FOUND",
      "ALREADY_JOINED",
      "CHARGE_ALREADY_SETTLED",
      "CHARGE_NOT_PAYABLE",
      "MARK_PAID_TOTAL_MISMATCH",
      "PLAYER_NOT_FOUND",
      "REJOIN_REQUIRES_REVIEW",
      "REMOVE_REQUIRES_REVIEW",
      "REVERSAL_EXCEEDS_EFFECTIVE",
      "REVERSAL_NOT_SUPPORTED",
    ]) {
      expect(isApiErrorCode(code), code).toBe(true);
    }
  });

  // The two guest-note routes (POST /api/sessions/:id/guest-notes, DELETE …/:noteId) shipped with
  // the same additive two-file edit CANCEL_REQUIRES_REVIEW made: a code is registered when
  // something can actually emit it. These six are pinned by §3 of
  // docs/features/BE/feature_session_management_tech.md (lines 317-325) and are emitted by
  // apps/web/lib/session-guest-note-route.ts. Collapsing them onto FORBIDDEN/NOT_FOUND would lose
  // the distinction §3 draws — e.g. NOT_NOTE_CREATOR (403, someone else's note) vs
  // GUEST_NOTE_NOT_FOUND (404, no such note in this tenant).
  //
  // The invite-side literals §3 also pins — FOLLOW_REQUIRED, ALREADY_JOINED, MEMBER_BLOCKED,
  // PLAYER_NOT_FOUND, PLAYER_NOT_PENDING — are deliberately NOT here: InviteFriend/Approve/Reject
  // need person_follows/person_blocks and a `pending` player status, none of which exist. They
  // return with their commands.
  it("registers every literal the two shipped guest-note routes can emit", () => {
    for (const code of [
      "GUEST_NOTE_LIMIT_REACHED",
      "GUEST_NOTE_NOT_FOUND",
      "INVITE_NOT_ALLOWED",
      "NOT_NOTE_CREATOR",
      "PLAYER_NOT_ACTIVE",
      "SESSION_FULL",
    ]) {
      expect(isApiErrorCode(code)).toBe(true);
    }
  });
});

describe("Zalo ingress codes (M3a)", () => {
  it("registers the literals the connect and webhook routes add", () => {
    for (const code of [
      "CONNECT_SUPERSEDED",
      "INVALID_WEBHOOK_SECRET",
      "WEBHOOK_PAYLOAD_MALFORMED",
      "WEBHOOK_RATE_LIMITED",
      "ZALO_TOKEN_INVALID",
      "RATE_LIMITED",
    ]) {
      expect(isApiErrorCode(code)).toBe(true);
    }
  });
});

describe("isApiErrorCode", () => {
  it("accepts every registered code", () => {
    for (const code of API_ERROR_CODES) {
      expect(isApiErrorCode(code)).toBe(true);
    }
  });

  it("rejects unknown strings and non-strings", () => {
    expect(isApiErrorCode("NOPE_NOT_A_CODE")).toBe(false);
    expect(isApiErrorCode("")).toBe(false);
    expect(isApiErrorCode(undefined)).toBe(false);
    expect(isApiErrorCode(null)).toBe(false);
    expect(isApiErrorCode(42)).toBe(false);
  });
});

describe("ApiEnvelope shape (compile-time contract lock)", () => {
  it("matches docs/channels/web/README.md §7 success + error examples", () => {
    const success = {
      data: { hello: "world" },
      error: null,
      meta: { requestId: "req_x" },
    } satisfies ApiEnvelope<{ hello: string }>;

    const failure = {
      data: null,
      error: {
        code: "CSRF_INVALID",
        message: "Yêu cầu không hợp lệ",
        statusCode: 403,
      } satisfies ApiError,
      meta: { requestId: "req_y" },
    } satisfies ApiEnvelope<never>;

    expect(success.error).toBeNull();
    expect(failure.data).toBeNull();
    expect(failure.error.statusCode).toBe(403);
    // `details` is optional: an error without it still satisfies ApiError, unchanged.
    expect("details" in failure.error).toBe(false);
  });

  it("types CLOSE_BLOCKED_OPEN_DEBT's details as ids + display names only (DD-131 OD-1)", () => {
    const blocked = {
      code: "CLOSE_BLOCKED_OPEN_DEBT",
      message: "Còn người chơi chưa trả đủ tiền — thu đủ trước khi đóng kèo.",
      statusCode: 409,
      details: {
        openBalancePlayers: [
          { playerId: "4c3a2e9e-0000-4000-8000-000000000001", displayName: "Lan" },
          { playerId: "4c3a2e9e-0000-4000-8000-000000000002", displayName: null },
        ],
      },
    } satisfies ApiError;
    // Compile-time half: an amount (or any other key) on an entry fails `tsc` through `satisfies`
    // (excess-property check); the runtime half pins the exact key set of every entry.
    for (const entry of blocked.details.openBalancePlayers) {
      expect(Object.keys(entry).sort()).toEqual(["displayName", "playerId"]);
    }
  });
});

describe("account <-> Zalo link codes (M3b)", () => {
  it("registers the four literals POST /api/me/link emits", () => {
    for (const code of [
      "LINK_CODE_INVALID",
      "LINK_CODE_RATE_LIMITED",
      "LINK_UNAVAILABLE",
      "MERGE_REQUIRES_REVIEW",
    ]) {
      expect(isApiErrorCode(code)).toBe(true);
    }
  });
});

describe("linked channels (M4)", () => {
  it("registers the literal POST /api/me/channels/:id/detach emits", () => {
    expect(isApiErrorCode("CHANNEL_NOT_LINKED")).toBe(true);
  });
});

describe("player self-join (M9)", () => {
  it("registers the five literals the join, leave and join-request routes emit", () => {
    for (const code of [
      "JOIN_REQUEST_NOT_FOUND",
      "LEAVE_REQUIRES_HOST",
      "REQUEST_DECIDED",
      "REQUEST_EXPIRED",
      "SESSION_NOT_JOINABLE",
    ]) {
      expect(isApiErrorCode(code)).toBe(true);
    }
  });

  it("types a pending join request as request id + display name + created_at only (no money, no contact)", () => {
    const pending = [
      {
        requestId: "4c3a2e9e-0000-4000-8000-000000000011",
        displayName: "Lan",
        createdAt: "2026-10-17T05:00:00.000Z",
      },
      {
        requestId: "4c3a2e9e-0000-4000-8000-000000000012",
        displayName: null,
        createdAt: "2026-10-17T05:01:00.000Z",
      },
    ] satisfies PendingJoinRequestDto[];
    // Compile-time half: any other key (an amount, a phone, a person id) fails `tsc` through
    // `satisfies`; the runtime half pins the exact key set of every entry.
    for (const entry of pending) {
      expect(Object.keys(entry).sort()).toEqual(["createdAt", "displayName", "requestId"]);
    }
  });

  it("types the join result with no amount and no venue (P-18), the same four keys for every outcome", () => {
    const results = [
      {
        outcome: "active",
        playerId: "4c3a2e9e-0000-4000-8000-000000000021",
        waitlistPosition: null,
        requestId: null,
      },
      {
        outcome: "waitlisted",
        playerId: "4c3a2e9e-0000-4000-8000-000000000022",
        waitlistPosition: 3,
        requestId: null,
      },
      {
        outcome: "requested",
        playerId: null,
        waitlistPosition: null,
        requestId: "4c3a2e9e-0000-4000-8000-000000000023",
      },
    ] satisfies JoinSessionResultDto[];
    for (const result of results) {
      expect(Object.keys(result).sort()).toEqual([
        "outcome",
        "playerId",
        "requestId",
        "waitlistPosition",
      ]);
    }
  });
});

describe("gender pricing (M9, DD-39)", () => {
  it("registers the three literals of feature_user_settings_tech.md :113, :163, :164", () => {
    for (const code of ["CHARGE_DERIVATION_UNAVAILABLE", "GENDER_FORBIDDEN", "INVALID_GENDER"]) {
      expect(isApiErrorCode(code)).toBe(true);
    }
  });

  it("pins GENDER_VALUES to the DD-39 value set, in its order", () => {
    expect([...GENDER_VALUES]).toEqual(["male", "female", "other", "undisclosed"]);
  });
});

describe("in-app chat codes (M10, L14 readiness 4.6; feature_inapp_chat_tech.md section 3)", () => {
  it("registers the twelve CHAT_* codes verbatim and the three reused chat-service codes", () => {
    const added = [
      "CHAT_CAPABILITY_REQUIRED",
      "CHAT_DUP_MESSAGE",
      "CHAT_EDIT_CONFLICT",
      "CHAT_EDIT_WINDOW_CLOSED",
      "CHAT_FORBIDDEN",
      "CHAT_IDEMPOTENCY_MISMATCH",
      "CHAT_MESSAGE_TOO_LARGE",
      "CHAT_MODERATION_FORBIDDEN",
      "CHAT_RATE_LIMITED",
      "CHAT_REASON_INVALID",
      "CHAT_REPLY_INVALID",
      "CHAT_SAFETY_BLOCKED",
    ];
    for (const code of [...added, "INVALID_BODY", "NOT_FOUND", "TENANT_SUSPENDED"]) {
      expect(API_ERROR_CODES, code).toContain(code);
      expect(isApiErrorCode(code), code).toBe(true);
    }
  });
});
