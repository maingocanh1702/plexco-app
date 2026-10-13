import { describe, expect, it } from "vitest";

import {
  API_ERROR_CODES,
  isApiErrorCode,
  type ApiEnvelope,
  type ApiError,
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
    // to announce — still unshipped, still gated by DD-56 clause 1. Those return to this registry
    // with their route, exactly as CANCEL_REQUIRES_REVIEW just did. Claiming full §3 coverage
    // would imply this test guards codes nothing can currently emit.
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
    for (const code of [
      "CANCEL_REQUIRES_REVIEW",
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
  it("registers the five literals the connect and webhook routes emit", () => {
    for (const code of [
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
  });
});
