import { describe, expect, it } from "vitest";
import { ApiClientError, CLIENT_BAD_RESPONSE, CLIENT_NETWORK_ERROR } from "./api-client";
import {
  describePlayerError,
  describeReverseError,
  describeSessionError,
  errorField,
  isDefiniteFailure,
  openBalancePlayersOf,
} from "./session-error-ui";

const en = (_vi: string, e: string) => e;
const err = (code: string, message = "server text", status = 400) =>
  new ApiClientError(code, message, status, "req-1");

describe("describeSessionError", () => {
  it("shows the envelope message for pinned domain codes", () => {
    const v = describeSessionError(
      err("CAPACITY_BELOW_ROSTER", "Sức chứa nhỏ hơn số người đã tham gia.", 409),
      en,
    );
    expect(v).toMatchObject({
      message: "Sức chứa nhỏ hơn số người đã tham gia.",
      action: "none",
      known: true,
    });
  });

  it("every code in the BE catalog is known and carries its own message", () => {
    for (const code of [
      "CANCEL_REQUIRES_REVIEW",
      "CLOSE_BLOCKED_OPEN_DEBT",
      "CAPACITY_BELOW_OCCUPANCY",
      "CAPACITY_BELOW_ROSTER",
      "COMMAND_ID_CONFLICT",
      "INVALID_TIME_RANGE",
      "MISSING_DISCOVERY_FIELDS",
      "PRICE_CHANGE_REQUIRES_POLICY",
      "SESSION_NOT_OPEN",
      "SPORT_INACTIVE",
      "STALE_VERSION",
      "TENANT_SUSPENDED",
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
      const v = describeSessionError(err(code, `msg ${code}`), en);
      expect(v.known, code).toBe(true);
      expect(v.message, code).toBe(`msg ${code}`);
    }
  });

  it("STALE_VERSION offers reload", () => {
    expect(describeSessionError(err("STALE_VERSION", "reload", 409), en).action).toBe("reload");
  });

  it("AUTH_REQUIRED means sign-in; pre-tenant codes use client t(), not the Vietnamese server text", () => {
    const v = describeSessionError(err("AUTH_REQUIRED", "Chưa đăng nhập.", 401), en);
    expect(v.action).toBe("sign-in");
    expect(v.message).not.toContain("Chưa");
    expect(describeSessionError(err("FORBIDDEN", "Bạn không có quyền", 403), en).message).toContain(
      "not allowed",
    );
    expect(describeSessionError(err("CSRF_INVALID", "x", 403), en).action).toBe("reload");
    expect(describeSessionError(err("RATE_LIMITED", "x", 429), en).action).toBe("retry");
    expect(describeSessionError(err("INVALID_BODY"), en).known).toBe(true);
    expect(describeSessionError(err("SESSION_NOT_FOUND", "x", 404), en).action).toBe("none");
  });

  it("network failure offers retry", () => {
    const v = describeSessionError(
      new ApiClientError(CLIENT_NETWORK_ERROR, "Network request failed", 0),
      en,
    );
    expect(v.action).toBe("retry");
    expect(v.message).toContain("connection");
  });

  it("FAILS CLOSED on an unknown code, a non-envelope response and non-API errors: generic text + requestId, never the raw server string", () => {
    const unknown = describeSessionError(err("TOTALLY_NEW", "raw internal detail", 500), en);
    expect(unknown).toMatchObject({ known: false, requestId: "req-1", action: "retry" });
    expect(unknown.message).not.toContain("raw internal detail");
    expect(
      describeSessionError(new ApiClientError(CLIENT_BAD_RESPONSE, "Unexpected response", 502), en)
        .known,
    ).toBe(false);
    expect(describeSessionError(new TypeError("boom"), en).known).toBe(false);
    expect(describeSessionError(err("STALE_VERSION", "   ", 409), en).known).toBe(false); // empty message
  });

  it("pins field-specific codes to a field", () => {
    expect(errorField("INVALID_TIME_RANGE")).toBe("endsAt");
    expect(errorField("CAPACITY_BELOW_ROSTER")).toBe("slotsMax");
    expect(errorField("PRICE_CHANGE_REQUIRES_POLICY")).toBe("priceAmount");
    expect(errorField("STALE_VERSION")).toBeNull();
  });
});

describe("isDefiniteFailure (when may a commandId be discarded)", () => {
  it("4xx envelope errors are definite", () => {
    expect(isDefiniteFailure(err("STALE_VERSION", "x", 409))).toBe(true);
    expect(isDefiniteFailure(err("INVALID_BODY", "x", 400))).toBe(true);
    expect(isDefiniteFailure(err("RATE_LIMITED", "x", 429))).toBe(true);
  });
  it("network loss, bad responses, 5xx and non-API errors are uncertain: keep the key", () => {
    expect(isDefiniteFailure(new ApiClientError(CLIENT_NETWORK_ERROR, "x", 0))).toBe(false);
    expect(isDefiniteFailure(new ApiClientError(CLIENT_BAD_RESPONSE, "x", 400))).toBe(false);
    expect(isDefiniteFailure(err("INTERNAL_ERROR", "x", 500))).toBe(false);
    expect(isDefiniteFailure(new TypeError("boom"))).toBe(false);
  });
});

describe("roster / payment errors", () => {
  it("balance-changed codes offer a reload, the rest just explain", () => {
    for (const code of [
      "ALLOCATION_EXCEEDS_FUNDS",
      "CHARGE_ALREADY_SETTLED",
      "MARK_PAID_TOTAL_MISMATCH",
      "REVERSAL_EXCEEDS_EFFECTIVE",
    ]) {
      expect(describeSessionError(err(code, "m", 409), en).action, code).toBe("reload");
    }
    for (const code of ["ALREADY_JOINED", "REJOIN_REQUIRES_REVIEW", "REMOVE_REQUIRES_REVIEW"]) {
      expect(describeSessionError(err(code, "m", 409), en).action, code).toBe("none");
    }
  });

  it("OD-5: REMOVE_REQUIRES_REVIEW shows the server's pinned envelope message (one source, no client copy)", () => {
    const vi = (v: string) => v;
    const pinned = "Người chơi đã có thanh toán — hãy hoàn tác trước khi xoá.";
    const e = err("REMOVE_REQUIRES_REVIEW", pinned, 409);
    expect(describeSessionError(e, en)).toMatchObject({
      message: pinned, // the tenant-language envelope text, not a client t() override
      action: "none",
      known: true,
    });
    expect(describeSessionError(e, vi).message).toBe(pinned);
  });

  it("OD-5: the reversal dialog explains FORBIDDEN as owner-only, no internal permission key; others unchanged", () => {
    const vi = (v: string) => v;
    const forbidden = describeReverseError(err("FORBIDDEN", "x", 403), en);
    expect(forbidden.message).toBe(
      "Only the club owner can reverse a payment. Ask the club owner to do it.",
    );
    expect(describeReverseError(err("FORBIDDEN", "x", 403), vi).message).toBe(
      "Chỉ chủ CLB mới hoàn tác được thanh toán. Hãy nhờ chủ CLB thực hiện.",
    );
    expect(forbidden.code).toBe("FORBIDDEN");
    expect(describeReverseError(err("REVERSAL_NOT_SUPPORTED", "nope", 409), en).message).toBe(
      "nope",
    );
  });

  it("T-3: CHARGE_DERIVATION_UNAVAILABLE shows the server's gender-free message; a 503 is not definite", () => {
    const pinned = "The price could not be worked out. Nothing was saved; please try again later.";
    const e = err("CHARGE_DERIVATION_UNAVAILABLE", pinned, 503);
    expect(describeSessionError(e, en)).toMatchObject({
      code: "CHARGE_DERIVATION_UNAVAILABLE",
      message: pinned,
      known: true,
    });
    // zero writes behind it, so the retry reuses the same commandId (DD-117 D5)
    expect(isDefiniteFailure(e)).toBe(false);
  });

  it("T-11: GENDER_FORBIDDEN keeps the generic fail-closed rendering, never the server text", () => {
    const v = describeSessionError(err("GENDER_FORBIDDEN", "This action is not allowed.", 403), en);
    expect(v).toMatchObject({ known: false, action: "retry" });
    expect(v.message).toBe("Something unexpected went wrong. Try again later.");
  });
});

// [code, vi, en, action] for every live readiness 4.5.1 row (E-1 to E-14; E-8 and E-9 are withdrawn).
const L12_CODES = [
  ["NOT_FOUND", "Kèo này không còn hoặc không tồn tại.", "This game is no longer listed.", "none"],
  [
    "INVALID_FILTER",
    "Bộ lọc không hợp lệ. Hãy đặt lại bộ lọc.",
    "That filter is not valid. Reset the filters.",
    "none",
  ],
  [
    "DISCOVERY_RATE_LIMITED",
    "Bạn tìm quá nhanh. Đợi một lát rồi thử lại.",
    "Too many searches. Wait a moment and try again.",
    "retry",
  ],
  [
    "SESSION_NOT_JOINABLE",
    "Buổi này hiện không nhận người tham gia.",
    "This session is not taking players right now.",
    "reload",
  ],
  ["ALREADY_JOINED", "Bạn đã có tên trong buổi này.", "You are already in this session.", "reload"],
  [
    "REJOIN_REQUIRES_REVIEW",
    "Cần xem lại các khoản thanh toán trước đó rồi mới tham gia lại được.",
    "Earlier payments need review before rejoining.",
    "none",
  ],
  [
    "CHARGE_DERIVATION_UNAVAILABLE",
    "Chưa thể thực hiện lúc này. Vui lòng thử lại sau ít phút.",
    "This can't be done right now. Please try again in a few minutes.",
    "retry",
  ],
  [
    "REQUEST_DECIDED",
    "Yêu cầu này đã được xử lý.",
    "This request has already been decided.",
    "reload",
  ],
  ["REQUEST_EXPIRED", "Yêu cầu này đã hết hạn.", "This request has expired.", "reload"],
  [
    "JOIN_REQUEST_NOT_FOUND",
    "Không tìm thấy yêu cầu này.",
    "This request was not found.",
    "reload",
  ],
  ["TENANT_SUSPENDED", "CLB này đang tạm ngưng.", "This club is suspended.", "none"],
  [
    "COMMAND_ID_CONFLICT",
    "Thao tác bị trùng. Tải lại trang rồi thử lại.",
    "Duplicate action. Reload the page and try again.",
    "reload",
  ],
] as const;

describe("describePlayerError (L12 player screens)", () => {
  it("describePlayerError maps the L12 codes", () => {
    for (const [code, viText, enText, action] of L12_CODES) {
      const e = err(code, "Server text in the club's language.", 409);
      expect(describePlayerError(e, en), code).toEqual({
        code,
        message: enText,
        action,
        requestId: "req-1",
        known: true,
      });
      expect(describePlayerError(e, (v) => v).message, code).toBe(viText);
    }
  });

  it("delegates every other code, network and bad-response failures and unknowns to describeSessionError", () => {
    const codes = ["AUTH_REQUIRED", "FORBIDDEN", "CSRF_INVALID", "RATE_LIMITED", "INVALID_BODY"];
    codes.push("SESSION_NOT_FOUND", "GENDER_FORBIDDEN", "LEAVE_REQUIRES_HOST", "PLAYER_NOT_FOUND");
    codes.push("SOMETHING_NEW", "constructor");
    const delegated: unknown[] = codes.map((code) => err(code, "x", 400));
    delegated.push(new ApiClientError(CLIENT_NETWORK_ERROR, "Network request failed", 0));
    delegated.push(new ApiClientError(CLIENT_BAD_RESPONSE, "Unexpected response", 502));
    delegated.push(new Error("boom"));
    for (const e of delegated) {
      expect(describePlayerError(e, en)).toEqual(describeSessionError(e, en));
    }
  });

  it("keeps the exact fail-closed texts for unknown, bad-response and network failures", () => {
    const generic = "Something unexpected went wrong. Try again later.";
    const unknownCode = err("SOMETHING_NEW", "x", 400);
    const badResponse = new ApiClientError(CLIENT_BAD_RESPONSE, "Unexpected response", 502);
    for (const e of [unknownCode, badResponse]) {
      expect(describePlayerError(e, en)).toMatchObject({
        message: generic,
        action: "retry",
        known: false,
      });
    }
    const offline = new ApiClientError(CLIENT_NETWORK_ERROR, "Network request failed", 0);
    expect(describePlayerError(offline, en)).toMatchObject({
      message: "No connection. Check your network and try again.",
      action: "retry",
    });
  });

  it("charge derivation copy is neutral", () => {
    const e = err("CHARGE_DERIVATION_UNAVAILABLE", "The price could not be worked out.", 503);
    for (const t of [(v: string) => v, en]) {
      const view = describePlayerError(e, t);
      expect(view.message.normalize("NFC").toLowerCase()).not.toMatch(/giới tính|gender|giá|price/);
      expect(view.action).toBe("retry");
    }
  });
});

describe("CLOSE_BLOCKED_OPEN_DEBT (DD-131 OD-1)", () => {
  const debt = (details?: unknown) =>
    new ApiClientError(
      "CLOSE_BLOCKED_OPEN_DEBT",
      "Còn người chơi chưa trả đủ tiền.",
      409,
      "req-1",
      details as never,
    );
  const two = {
    openBalancePlayers: [
      { playerId: "p2", displayName: "Minh Trần" },
      { playerId: "p5", displayName: null },
    ],
  };

  it("is a known domain code: the server message, stay in place (no reload, no retry)", () => {
    expect(describeSessionError(debt(two), en)).toMatchObject({
      code: "CLOSE_BLOCKED_OPEN_DEBT",
      message: "Còn người chơi chưa trả đủ tiền.",
      action: "none",
      known: true,
    });
    expect(isDefiniteFailure(debt(two))).toBe(true); // 409: a fresh command key next time
  });

  it("lists the players by id and name, a missing name stays null", () => {
    expect(openBalancePlayersOf(debt(two))).toEqual([
      { playerId: "p2", displayName: "Minh Trần" },
      { playerId: "p5", displayName: null },
    ]);
    expect(
      openBalancePlayersOf(debt({ openBalancePlayers: [{ playerId: "p1", displayName: "  " }] })),
    ).toEqual([{ playerId: "p1", displayName: null }]);
  });

  it("never reads anything but id + name: an amount the server might add is dropped", () => {
    const withAmount = {
      openBalancePlayers: [{ playerId: "p2", displayName: "Minh", remaining: 30000 }],
    };
    expect(openBalancePlayersOf(debt(withAmount))).toEqual([
      { playerId: "p2", displayName: "Minh" },
    ]);
  });

  it("repeated playerId is shown once (unique React key)", () => {
    const dup = {
      openBalancePlayers: [
        { playerId: "p2", displayName: "Minh" },
        { playerId: "p2", displayName: "Minh" },
      ],
    };
    expect(openBalancePlayersOf(debt(dup))).toHaveLength(1);
  });

  it("missing / empty / malformed details -> [] (generic message only, fail closed)", () => {
    const bad: unknown[] = [
      undefined,
      {},
      { openBalancePlayers: [] },
      { openBalancePlayers: "p2" },
      { openBalancePlayers: {} },
      { openBalancePlayers: [null] },
      { openBalancePlayers: ["p2"] },
      { openBalancePlayers: [{ displayName: "x" }] },
      { openBalancePlayers: [{ playerId: "", displayName: "x" }] },
      { openBalancePlayers: [{ playerId: 7, displayName: "x" }] },
      { openBalancePlayers: [{ playerId: "p1", displayName: 7 }] },
      // one bad entry voids the whole list: a partial list would read as "only these owe"
      { openBalancePlayers: [{ playerId: "p1", displayName: "ok" }, { displayName: "x" }] },
    ];
    for (const details of bad) {
      expect(openBalancePlayersOf(debt(details)), JSON.stringify(details)).toEqual([]);
    }
  });

  it("only CLOSE_BLOCKED_OPEN_DEBT carries a list: other codes and non-API errors give []", () => {
    const other = new ApiClientError("CANCEL_REQUIRES_REVIEW", "m", 400, "r", two as never);
    expect(openBalancePlayersOf(other)).toEqual([]);
    expect(openBalancePlayersOf(new Error("x"))).toEqual([]);
    expect(openBalancePlayersOf(null)).toEqual([]);
  });

  it("CANCEL_REQUIRES_REVIEW stays a known domain code carrying the server's (cancel-only) message", () => {
    expect(
      describeSessionError(
        err("CANCEL_REQUIRES_REVIEW", "Kèo này cần được xem xét trước khi huỷ.", 400),
        en,
      ),
    ).toMatchObject({
      message: "Kèo này cần được xem xét trước khi huỷ.",
      action: "none",
      known: true,
    });
  });
});
