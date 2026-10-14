import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "./api-client";
import {
  createSession,
  getSession,
  listSessions,
  transitionSession,
  updateSession,
} from "./sessions-api";

const TENANT = "11111111-1111-4111-8111-111111111111";
const ctx = { tenantId: TENANT, csrfToken: "csrf-secret" };

function mockFetch(data: unknown, status = 200) {
  const fn = vi.fn(
    async () =>
      new Response(JSON.stringify({ data, error: null, meta: { requestId: "r1" } }), { status }),
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}
afterEach(() => vi.unstubAllGlobals());

const lastCall = (fn: ReturnType<typeof mockFetch>) => {
  const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
  return { url, init, headers: new Headers(init.headers) };
};

describe("sessions-api", () => {
  it("lists with tenant, status and cursor; no CSRF header on GET", async () => {
    const fn = mockFetch({ sessions: [], pageInfo: { hasMore: false, nextCursor: null } });
    await listSessions(TENANT, { status: "open", cursor: "abc", limit: 20 });
    const { url, headers } = lastCall(fn);
    expect(url).toBe(`/api/sessions?tenant=${TENANT}&status=open&cursor=abc&limit=20`);
    expect(headers.get("x-csrf-token")).toBeNull();
  });

  it("unwraps the detail envelope", async () => {
    mockFetch({ session: { id: "s1" } });
    await expect(getSession(TENANT, "s1")).resolves.toEqual({ id: "s1" });
  });

  it("create posts commandId + fields with the CSRF token", async () => {
    const fn = mockFetch({ session: { id: "s1", status: "draft", version: 1 } });
    await createSession(ctx, { commandId: "cmd-1", sportId: "sp", priceAmount: 0 });
    const { url, init, headers } = lastCall(fn);
    expect(url).toBe(`/api/sessions?tenant=${TENANT}`);
    expect(init.method).toBe("POST");
    expect(headers.get("x-csrf-token")).toBe("csrf-secret");
    expect(JSON.parse(init.body as string)).toEqual({
      commandId: "cmd-1",
      sportId: "sp",
      priceAmount: 0,
    });
  });

  it("update is a PUT to the session id; transitions post to /<action>", async () => {
    const fn = mockFetch({ session: { id: "s1", status: "open", version: 3 } });
    await updateSession(ctx, "s1", { commandId: "c", expectedVersion: 2, area: null });
    expect(lastCall(fn).init.method).toBe("PUT");
    const fn2 = mockFetch({ session: { id: "s1", status: "closed", version: 4 } });
    await transitionSession(ctx, "s1", "close", { commandId: "c2", expectedVersion: 3 });
    expect(lastCall(fn2).url).toBe(`/api/sessions/s1/close?tenant=${TENANT}`);
  });

  it("surfaces the envelope error code and requestId", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              data: null,
              error: { code: "STALE_VERSION", message: "reload", statusCode: 409 },
              meta: { requestId: "req-9" },
            }),
            { status: 409 },
          ),
      ),
    );
    const error = await transitionSession(ctx, "s1", "publish", {
      commandId: "c",
      expectedVersion: 1,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiClientError);
    expect((error as ApiClientError).code).toBe("STALE_VERSION");
    expect((error as ApiClientError).requestId).toBe("req-9");
  });
});
