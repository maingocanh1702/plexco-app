import { describe, expect, it } from "vitest";
import { err, NO_STORE, ok } from "./api-envelope";

/**
 * Audit 2026-09-06 W-14 — every envelope is Cache-Control: no-store by default; GET
 * /api/auth/session returns the CSRF secret and nothing in the API is cacheable today.
 */
describe("api envelope — Cache-Control (audit W-14)", () => {
  it("ok() and err() both send no-store", async () => {
    expect(ok({ a: 1 }).headers.get("cache-control")).toBe(NO_STORE);
    expect(err("AUTH_REQUIRED", "x", 401).headers.get("cache-control")).toBe(NO_STORE);
  });

  it("a caller's explicit Cache-Control still wins (default, not override)", () => {
    const res = ok(null, { headers: { "cache-control": "private, max-age=5" } });
    expect(res.headers.get("cache-control")).toBe("private, max-age=5");
  });

  it("other init headers and the status are preserved", async () => {
    const res = ok({ x: 1 }, { status: 201, headers: { "x-extra": "1" } });
    expect(res.status).toBe(201);
    expect(res.headers.get("x-extra")).toBe("1");
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(err("FORBIDDEN", "no", 403).status).toBe(403);
    const body = (await res.json()) as {
      data: { x: number };
      error: null;
      meta: { requestId: string };
    };
    expect(body.data).toEqual({ x: 1 });
    expect(body.meta.requestId).toMatch(/^req_/);
  });
});

describe("api envelope — optional error details (DD-131 OD-1)", () => {
  it("without details the error object is exactly { code, message, statusCode } (byte-identical)", async () => {
    const body = (await err("SESSION_NOT_OPEN", "x", 409).json()) as {
      data: null;
      error: Record<string, unknown>;
    };
    expect(Object.keys(body.error)).toEqual(["code", "message", "statusCode"]);
    expect(JSON.stringify(body.error)).toBe(
      '{"code":"SESSION_NOT_OPEN","message":"x","statusCode":409}',
    );
  });

  it("with details they ride inside `error`, after the three base keys, and nowhere else", async () => {
    const details = {
      openBalancePlayers: [
        { playerId: "4c3a2e9e-0000-4000-8000-000000000001", displayName: "Lan" },
      ],
    };
    const res = err("CLOSE_BLOCKED_OPEN_DEBT", "owe", 409, details);
    expect(res.status).toBe(409);
    expect(res.headers.get("cache-control")).toBe(NO_STORE);
    const body = (await res.json()) as {
      data: null;
      error: Record<string, unknown>;
      meta: { requestId: string };
    };
    expect(body.data).toBeNull();
    expect(Object.keys(body.error)).toEqual(["code", "message", "statusCode", "details"]);
    expect(body.error.details).toEqual(details);
    expect(Object.keys(body.meta)).toEqual(["requestId"]);
  });
});
