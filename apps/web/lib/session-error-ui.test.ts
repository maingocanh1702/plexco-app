import { describe, expect, it } from "vitest";
import { ApiClientError, CLIENT_BAD_RESPONSE, CLIENT_NETWORK_ERROR } from "./api-client";
import {
  describeReverseError,
  describeSessionError,
  errorField,
  isDefiniteFailure,
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

  it("the reversal dialog explains FORBIDDEN as a missing money.correct grant; others unchanged", () => {
    const forbidden = describeReverseError(err("FORBIDDEN", "x", 403), en);
    expect(forbidden.message).toContain("money.correct");
    expect(forbidden.code).toBe("FORBIDDEN");
    expect(describeReverseError(err("REVERSAL_NOT_SUPPORTED", "nope", 409), en).message).toBe(
      "nope",
    );
  });
});
