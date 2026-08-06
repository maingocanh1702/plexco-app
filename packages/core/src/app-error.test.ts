import { describe, expect, it } from "vitest";

import { toAppError } from "./app-error.js";

describe("toAppError — network case", () => {
  it("null/undefined input (fetch threw, no response) → network", () => {
    expect(toAppError(null)).toEqual({ kind: "network" });
    expect(toAppError(undefined)).toEqual({ kind: "network" });
  });
});

describe("toAppError — statusCode → sealed kind", () => {
  const cases: Array<[number, string]> = [
    [400, "validation"],
    [401, "unauthorized"],
    [403, "forbidden"],
    [404, "notFound"],
    [500, "server"],
    [503, "server"],
    [599, "server"],
  ];
  for (const [statusCode, kind] of cases) {
    it(`${statusCode} → ${kind}`, () => {
      expect(toAppError({ error: { statusCode } }).kind).toBe(kind);
    });
  }

  it("unlisted 4xx fails closed to unknown — incl. 429 (no rate-limit kind in the sealed set yet)", () => {
    expect(toAppError({ error: { statusCode: 429 } }).kind).toBe("unknown");
    expect(toAppError({ error: { statusCode: 418 } }).kind).toBe("unknown");
  });

  it("missing/non-numeric statusCode → unknown, never a softer bucket", () => {
    expect(toAppError({ error: {} }).kind).toBe("unknown");
    expect(toAppError({ error: { statusCode: "403" } }).kind).toBe("unknown");
  });
});

describe("toAppError — field passthrough at the trust boundary", () => {
  it("keeps registered code, message, statusCode, requestId", () => {
    expect(
      toAppError({
        error: { code: "CSRF_INVALID", message: "Yêu cầu không hợp lệ", statusCode: 403 },
        meta: { requestId: "req_abc" },
      }),
    ).toEqual({
      kind: "forbidden",
      code: "CSRF_INVALID",
      message: "Yêu cầu không hợp lệ",
      statusCode: 403,
      requestId: "req_abc",
    });
  });

  it("drops a code not in API_ERROR_CODES (keeps message for logging)", () => {
    const mapped = toAppError({
      error: { code: "TOTALLY_NEW_CODE", message: "x", statusCode: 400 },
    });
    expect(mapped.code).toBeUndefined();
    expect(mapped.message).toBe("x");
    expect(mapped.kind).toBe("validation");
  });

  it("drops non-string message and non-string requestId", () => {
    const mapped = toAppError({
      error: { statusCode: 500, message: 42 },
      meta: { requestId: 7 },
    });
    expect(mapped).toEqual({ kind: "server", statusCode: 500 });
  });

  it("input without an error object (mis-called on a success envelope) → unknown", () => {
    expect(toAppError({ error: null })).toEqual({ kind: "unknown" });
    expect(toAppError({})).toEqual({ kind: "unknown" });
  });
});
