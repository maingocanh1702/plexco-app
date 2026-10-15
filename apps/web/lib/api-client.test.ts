import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError, CLIENT_BAD_RESPONSE, CLIENT_NETWORK_ERROR, apiFetch } from "./api-client";

function mockFetch(body: unknown, status = 200) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe("apiFetch", () => {
  it("returns envelope data and sends same-origin, no-store", async () => {
    const fn = mockFetch({ data: { ok: 1 }, error: null, meta: { requestId: "req_1" } });
    await expect(apiFetch<{ ok: number }>("/api/x")).resolves.toEqual({ ok: 1 });
    const [path, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe("/api/x");
    expect(init.credentials).toBe("same-origin");
    expect(init.cache).toBe("no-store");
  });

  it("attaches x-csrf-token on non-GET only, and serializes json", async () => {
    const fn = mockFetch({ data: {}, error: null, meta: { requestId: "r" } });
    await apiFetch("/api/x", { method: "POST", csrfToken: "secret", json: { a: 1 } });
    await apiFetch("/api/x", { csrfToken: "secret" });
    const [, post] = fn.mock.calls[0] as unknown as [string, RequestInit];
    const [, get] = fn.mock.calls[1] as unknown as [string, RequestInit];
    expect(new Headers(post.headers).get("x-csrf-token")).toBe("secret");
    expect(new Headers(post.headers).get("content-type")).toBe("application/json");
    expect(post.body).toBe('{"a":1}');
    expect(new Headers(get.headers).has("x-csrf-token")).toBe(false);
  });

  it("maps an error envelope to ApiClientError with code, message, status, requestId", async () => {
    mockFetch(
      {
        data: null,
        error: { code: "SLUG_TAKEN", message: "Slug is taken.", statusCode: 409 },
        meta: { requestId: "req_9" },
      },
      409,
    );
    const error = await apiFetch("/api/x").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({
      code: "SLUG_TAKEN",
      message: "Slug is taken.",
      statusCode: 409,
      requestId: "req_9",
    });
  });

  it("keeps the envelope's details on the ApiClientError (CLOSE_BLOCKED_OPEN_DEBT)", async () => {
    const details = { openBalancePlayers: [{ playerId: "p2", displayName: "Minh Trần" }] };
    mockFetch(
      {
        data: null,
        error: { code: "CLOSE_BLOCKED_OPEN_DEBT", message: "Còn nợ.", statusCode: 409, details },
        meta: { requestId: "req_d" },
      },
      409,
    );
    const error = await apiFetch("/api/x").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiClientError);
    expect((error as ApiClientError).details).toEqual(details);
    expect(error).toMatchObject({ code: "CLOSE_BLOCKED_OPEN_DEBT", statusCode: 409 });
  });

  it("a malformed details never becomes details: absent, null, a string, an array or a number", async () => {
    for (const details of [undefined, null, "oops", ["x"], 7]) {
      mockFetch(
        {
          data: null,
          error: { code: "CLOSE_BLOCKED_OPEN_DEBT", message: "m", statusCode: 409, details },
          meta: { requestId: "r" },
        },
        409,
      );
      const error = (await apiFetch("/api/x").catch((e: unknown) => e)) as ApiClientError;
      expect(error.details, String(details)).toBeUndefined();
      expect(error).toMatchObject({
        code: "CLOSE_BLOCKED_OPEN_DEBT",
        message: "m",
        requestId: "r",
      });
    }
  });

  it("an object details on any other code (STALE_VERSION, CANCEL_REQUIRES_REVIEW) is dropped", async () => {
    for (const code of ["STALE_VERSION", "CANCEL_REQUIRES_REVIEW", "SESSION_NOT_OPEN"]) {
      mockFetch(
        {
          data: null,
          error: { code, message: "m", statusCode: 409, details: { openBalancePlayers: [] } },
          meta: { requestId: "r" },
        },
        409,
      );
      const error = (await apiFetch("/api/x").catch((e: unknown) => e)) as ApiClientError;
      expect(error.details, code).toBeUndefined();
      expect(error).toMatchObject({ code, message: "m", requestId: "r" });
    }
  });

  it("a non-envelope response is CLIENT_BAD_RESPONSE, never a raw parse error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>502</html>", { status: 502 })),
    );
    await expect(apiFetch("/api/x")).rejects.toMatchObject({
      code: CLIENT_BAD_RESPONSE,
      statusCode: 502,
    });
  });

  it("a network failure is CLIENT_NETWORK_ERROR with status 0", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new TypeError("offline"))),
    );
    await expect(apiFetch("/api/x")).rejects.toMatchObject({
      code: CLIENT_NETWORK_ERROR,
      statusCode: 0,
    });
  });
});
