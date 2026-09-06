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
    const body = (await res.json()) as { data: { x: number }; error: null; meta: { requestId: string } };
    expect(body.data).toEqual({ x: 1 });
    expect(body.meta.requestId).toMatch(/^req_/);
  });
});
