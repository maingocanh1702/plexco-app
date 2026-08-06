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
