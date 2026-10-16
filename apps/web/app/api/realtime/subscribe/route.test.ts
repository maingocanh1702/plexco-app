import { EventEmitter } from "node:events";
import { authorize, readSessionRealtimeEvent, resolveWebSession } from "@plexco/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SECURITY_HEADERS } from "../../../../next.config.mjs";
import { buildNonceCsp, pathAllowedForRole } from "../../../../lib/request-policy";
import { currentSession, rateLimited } from "../../../../lib/session-cookies";
import * as routeModule from "./route";
import { GET } from "./route";

// GET /api/realtime/subscribe (lane L5): the decision table rows 1-5 at the wire, A9, A17-A19.
// The real read gate, listener and stream run; only @plexco/db, the cookie layer and the pool's
// LISTEN client are stubbed.
vi.mock("@plexco/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@plexco/db")>();
  return {
    ...actual,
    authorize: vi.fn(),
    readSessionRealtimeEvent: vi.fn(),
    resolveWebSession: vi.fn(),
    withTenant: vi.fn(async (_db: unknown, _tenantId: string, fn: (tx: unknown) => unknown) =>
      fn({}),
    ),
  };
});
const pg = vi.hoisted(() => ({ clients: [] as { emitter: EventEmitter; released: number }[] }));
vi.mock("../../../../lib/session-cookies", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../lib/session-cookies")>();
  const connect = async () => {
    const emitter = new EventEmitter();
    const client = { emitter, released: 0 };
    pg.clients.push(client);
    return {
      query: async () => ({ rows: [] }),
      on: (event: string, fn: (...args: unknown[]) => void) => emitter.on(event, fn),
      release: () => {
        client.released += 1;
      },
    };
  };
  return {
    ...actual,
    appDb: vi.fn(() => ({
      pool: { connect },
      db: { execute: async () => ({ rows: [{ locale: "vi" }] }) },
    })),
    currentSession: vi.fn(),
    rateLimited: vi.fn(),
  };
});
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: "raw-token" }) }),
}));

const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const EVENT = "33333333-3333-4333-8333-333333333333";
const SESSION = "44444444-4444-4444-8444-444444444444";
const live = {
  sessionId: "s",
  accountId: "a",
  personId: "p",
  csrfSecret: "c",
  expiresAt: new Date(),
};
const aborts: AbortController[] = [];

function subscribe(tenant: string | null = TENANT) {
  const abort = new AbortController();
  aborts.push(abort);
  const query = tenant === null ? "" : `?tenant=${tenant}`;
  return GET(
    new Request(`https://plexco.app/api/realtime/subscribe${query}`, { signal: abort.signal }),
  );
}
const body = async (r: Response) =>
  (await r.json()) as { data: null; error: { code: string; message: string; statusCode: number } };
const text = async (reader: ReadableStreamDefaultReader<Uint8Array>) => {
  const { done, value } = await reader.read();
  return done ? null : new TextDecoder().decode(value);
};
const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  pg.clients.length = 0; // per-test LISTEN clients: no assertion depends on test order
  vi.mocked(currentSession).mockResolvedValue(live);
  vi.mocked(resolveWebSession).mockResolvedValue(live);
  vi.mocked(rateLimited).mockResolvedValue(false);
  vi.mocked(authorize).mockResolvedValue({ allowed: true, role: "admin" });
  vi.mocked(readSessionRealtimeEvent).mockResolvedValue({
    type: "session.updated",
    sessionId: SESSION,
    version: 9,
  });
});
afterEach(async () => {
  for (const abort of aborts.splice(0)) abort.abort();
  await flush();
  vi.useRealTimers();
});

describe("GET /api/realtime/subscribe decision table", () => {
  it("row 1 / A1: no session cookie -> 401 AUTH_REQUIRED, no stream opened", async () => {
    vi.mocked(currentSession).mockResolvedValue(null);
    const r = await subscribe();
    expect(r.status).toBe(401);
    expect((await body(r)).error).toEqual({
      code: "AUTH_REQUIRED",
      message: "Chưa đăng nhập.",
      statusCode: 401,
    });
    vi.mocked(currentSession).mockResolvedValue(live);
    vi.mocked(resolveWebSession).mockResolvedValue(null);
    expect((await body(await subscribe())).error.code).toBe("AUTH_REQUIRED");
    expect(pg.clients).toHaveLength(0);
  });

  it("row 2 / A2: non-member, foreign or unknown tenant -> one identical 403 body", async () => {
    vi.mocked(authorize).mockResolvedValue({ allowed: false } as never);
    const a = await subscribe(TENANT);
    const b = await subscribe(OTHER);
    expect([a.status, b.status]).toEqual([403, 403]);
    const [ea, eb] = [(await body(a)).error, (await body(b)).error];
    expect(ea).toEqual(eb);
    expect(ea).toEqual({
      code: "FORBIDDEN",
      message: "Bạn không có quyền với CLB này.",
      statusCode: 403,
    });
  });

  it("R-17: a missing or malformed tenant is the existing 400 INVALID_BODY", async () => {
    for (const tenant of [null, "nope"]) {
      const r = await subscribe(tenant);
      expect(r.status).toBe(400);
      expect((await body(r)).error.code).toBe("INVALID_BODY");
    }
  });

  it("row 3 / A3, A19: an authorized subscriber gets event-stream headers and one id-only frame", async () => {
    const r = await subscribe();
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    expect(r.headers.get("cache-control")).toBe("no-store, no-transform");
    expect(r.headers.get("x-accel-buffering")).toBe("no");
    const reader = r.body!.getReader();
    await flush();
    expect(await text(reader)).toBe(": hb\n\n");
    pg.clients.at(-1)!.emitter.emit("notification", { channel: "web_realtime", payload: EVENT });
    await flush();
    expect(await text(reader)).toBe(
      `data: {"type":"session.updated","sessionId":"${SESSION}","version":9}\n\n`,
    );
  });

  it("row 5 / A5: the 6th concurrent stream of one account is 429; closing one admits a new one", async () => {
    const open = [];
    for (let i = 0; i < 5; i += 1) open.push(await subscribe());
    expect(open.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    const sixth = await subscribe();
    expect(sixth.status).toBe(429);
    expect((await body(sixth)).error).toEqual({
      code: "RATE_LIMITED",
      message: "Quá nhiều yêu cầu — đợi.",
      statusCode: 429,
    });
    aborts[0]!.abort();
    await flush();
    expect((await subscribe()).status).toBe(200);
  });

  it("row 4 / A9: heartbeat every 25 s re-checks access; a revoked subscriber is closed, sent nothing", async () => {
    const reader = (await subscribe()).body!.getReader();
    await flush();
    expect(await text(reader)).toBe(": hb\n\n");
    const checks = vi.mocked(resolveWebSession).mock.calls.length;
    await vi.advanceTimersByTimeAsync(25_000);
    expect(await text(reader)).toBe(": hb\n\n");
    expect(vi.mocked(resolveWebSession).mock.calls.length).toBe(checks + 1);
    vi.mocked(authorize).mockResolvedValue({ allowed: false } as never);
    pg.clients.at(-1)!.emitter.emit("notification", { channel: "web_realtime", payload: EVENT });
    await vi.advanceTimersByTimeAsync(25_000);
    expect(await text(reader)).toBeNull();
  });

  it("R-11: the server ends a stream after 15 minutes", async () => {
    const reader = (await subscribe()).body!.getReader();
    await flush();
    expect(await text(reader)).toBe(": hb\n\n");
    // A reading client: one heartbeat per 25 s, still open at 14 min 35 s.
    for (let beat = 1; beat < 36; beat += 1) {
      await vi.advanceTimersByTimeAsync(25_000);
      expect(await text(reader)).toBe(": hb\n\n");
    }
    await vi.advanceTimersByTimeAsync(25_000);
    const rest: string[] = [];
    for (let chunk = await text(reader); chunk !== null; chunk = await text(reader))
      rest.push(chunk);
    expect(rest.length).toBeLessThanOrEqual(1);
    expect(rest.every((c) => c === ": hb\n\n")).toBe(true);
  });
});

describe("route surface (A17, A18)", () => {
  it("exports only GET and the two config fields", () => {
    expect(Object.keys(routeModule).sort()).toEqual(["GET", "dynamic", "runtime"]);
    expect(routeModule.runtime).toBe("nodejs");
    expect(routeModule.dynamic).toBe("force-dynamic");
  });

  it("is served by the web role and refused by the discovery role", () => {
    expect(pathAllowedForRole("/api/realtime/subscribe", "web")).toBe(true);
    expect(pathAllowedForRole("/api/realtime/subscribe", "discovery")).toBe(false);
  });

  it("no CSP in either mode restricts a same-origin EventSource", () => {
    const csp = SECURITY_HEADERS.find((h: { key: string }) => h.key === "Content-Security-Policy");
    for (const policy of [csp!.value as string, buildNonceCsp("bm9uY2U=")]) {
      expect(policy).not.toMatch(/(^|;\s*)(default-src|connect-src)\b/);
    }
  });
});
