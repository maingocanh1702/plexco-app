import {
  SessionUpdateAuthorizationError,
  SessionUpdateError,
  authorize,
  updateSession,
} from "@plexco/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { csrfOk, currentSession, rateLimited } from "../../../../lib/session-cookies";
import { PUT } from "./route";

vi.mock("@plexco/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@plexco/db")>();
  return {
    ...actual,
    // `db` needs a working `execute`: the route resolves the tenant's language through the REAL
    // tenantLocale (packages/db/src/tenant.ts), which calls db.execute. An empty `{}` threw
    // TypeError into tenantLocale's own catch, which logs a deliberately-loud anomaly line on
    // every single request. "vi" is exactly what that fallback already produced, so the resolved
    // language — and therefore every existing assertion — is unchanged.
    createDb: vi.fn(() => ({
      pool: {},
      db: { execute: async () => ({ rows: [{ locale: "vi" }] }) },
    })),
    updateSession: vi.fn(),
    authorize: vi.fn(),
    withTenant: vi.fn(async (_db: unknown, _tenantId: string, fn: (tx: unknown) => unknown) =>
      fn({}),
    ),
  };
});

vi.mock("../../../../lib/session-cookies", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../lib/session-cookies")>();
  return {
    ...actual,
    // This is the handle the route actually hands to tenantLocale, so `execute` must exist here
    // for the same reason as the createDb stub above — otherwise every request logs a false
    // anomaly. "vi" preserves the language the empty-stub fallback already resolved to.
    appDb: vi.fn(() => ({
      pool: {},
      db: { execute: async () => ({ rows: [{ locale: "vi" }] }) },
    })),
    currentSession: vi.fn(),
    csrfOk: vi.fn(),
    rateLimited: vi.fn(),
  };
});

process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";

const TENANT = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "33333333-3333-4333-8333-333333333333";

function req(body: unknown, tenant = TENANT): Request {
  return new Request(`https://plexco.app/api/sessions/${SESSION_ID}?tenant=${tenant}`, {
    method: "PUT",
    headers: { "content-type": "application/json", "x-csrf-token": "secret" },
    body: JSON.stringify(body),
  });
}
const ctx = (id = SESSION_ID) => ({ params: Promise.resolve({ id }) });

const envelope = async (response: Response) =>
  (await response.json()) as {
    data: Record<string, unknown> | null;
    error: { code: string; statusCode: number } | null;
  };

beforeEach(() => {
  // vitest does not clear mock call history between tests by default, and several cases below
  // assert the command was NEVER reached — without this they would pass on leftover calls.
  vi.clearAllMocks();
  vi.mocked(currentSession).mockResolvedValue({
    sessionId: "s",
    accountId: "a",
    personId: "p",
    csrfSecret: "secret",
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  vi.mocked(csrfOk).mockReturnValue(true);
  vi.mocked(rateLimited).mockResolvedValue(false);
  vi.mocked(authorize).mockResolvedValue({ allowed: true, role: "owner" });
  vi.mocked(updateSession).mockResolvedValue({
    sessionId: SESSION_ID,
    status: "open",
    version: 3,
    visibility: "private",
    replayed: false,
  });
});

describe("PUT /api/sessions/:id", () => {
  it("updates and returns the sibling DTO shape", async () => {
    const response = await PUT(req({ commandId: "cmd_1", area: "Cau Giay" }), ctx());
    expect(response.status).toBe(200);
    const { data } = await envelope(response);
    expect(data).toEqual({ session: { id: SESSION_ID, status: "open", version: 3 } });
  });

  // What the db stubs above are FOR. tenantLocale's catch logs on purpose — it means an error
  // class that must never be silent. A suite that emits it on every request is a suite where a
  // real one is invisible, so the absence of that line is pinned here rather than left to habit.
  it("resolves tenant language without logging a tenantLocale anomaly", async () => {
    const consoleError = vi.spyOn(console, "error");
    try {
      const response = await PUT(req({ commandId: "cmd_1", area: "Cau Giay" }), ctx());
      expect(response.status).toBe(200);
      expect(
        consoleError.mock.calls.filter((call) =>
          call.some((arg) => typeof arg === "string" && /\[tenantLocale\]/.test(arg)),
        ),
      ).toEqual([]);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("forwards ONLY the provided fields — an untouched field is absent, not null", async () => {
    await PUT(req({ commandId: "cmd_1", area: "Cau Giay" }), ctx());
    const [, params] = vi.mocked(updateSession).mock.calls[0]!;
    expect(params.input.area).toBe("Cau Giay");
    expect(Object.hasOwn(params.input, "venueName")).toBe(false);
    expect(Object.hasOwn(params.input, "priceAmount")).toBe(false);
  });

  it("forwards an explicit null as a real value (clear the field, not leave it alone)", async () => {
    await PUT(req({ commandId: "cmd_1", area: null, slotsMax: null }), ctx());
    const [, params] = vi.mocked(updateSession).mock.calls[0]!;
    expect(Object.hasOwn(params.input, "area")).toBe(true);
    expect(params.input.area).toBeNull();
    expect(params.input.slotsMax).toBeNull();
  });

  it("carries expectedVersion through for the optimistic-concurrency guard", async () => {
    await PUT(req({ commandId: "cmd_1", expectedVersion: 2, timezone: "Asia/Bangkok" }), ctx());
    expect(updateSession).toHaveBeenCalledWith(expect.anything(), {
      tenantId: TENANT,
      commandId: "cmd_1",
      actorPersonId: "p",
      input: { sessionId: SESSION_ID, expectedVersion: 2, timezone: "Asia/Bangkok" },
    });
  });

  it("accepts an empty change-set (idempotent no-op) as long as commandId is present", async () => {
    const response = await PUT(req({ commandId: "cmd_1" }), ctx());
    expect(response.status).toBe(200);
    const [, params] = vi.mocked(updateSession).mock.calls[0]!;
    expect(params.input).toEqual({ sessionId: SESSION_ID, expectedVersion: undefined });
  });

  it("denies a caller with no session-managing role and never reaches the command", async () => {
    vi.mocked(authorize).mockResolvedValue({ allowed: false, reason: "not_a_member" });
    const response = await PUT(req({ commandId: "cmd_1" }), ctx());
    expect(response.status).toBe(403);
    expect(updateSession).not.toHaveBeenCalled();
  });

  it("allows co_admin (DD-56 default preset includes session.manage)", async () => {
    vi.mocked(authorize).mockResolvedValue({ allowed: true, role: "co_admin" });
    const response = await PUT(req({ commandId: "cmd_1" }), ctx());
    expect(response.status).toBe(200);
  });

  it("does not touch another tenant's session (isolation)", async () => {
    vi.mocked(authorize).mockResolvedValue({ allowed: false, reason: "not_a_member" });
    const response = await PUT(req({ commandId: "cmd_1" }), ctx());
    expect(response.status).toBe(403);
    expect(updateSession).not.toHaveBeenCalled();
  });

  // codex round-01 [P1]. DED2 in session-service.test.ts pins this exactly: a replayed commandId
  // must return the stored result even when the RETRY payload is malformed, because dedup on
  // (tenant_id, command_id) runs BEFORE patch validation. Pre-rejecting here would report failure
  // for an update that already committed.
  it.each([
    [{ commandId: "cmd_1", priceAmount: "50000" }],
    [{ commandId: "cmd_1", visibility: "secret" }],
    [{ commandId: "cmd_1", startsAt: "nonsense" }],
    [{ commandId: "cmd_1", expectedVersion: null }],
  ])("forwards mistyped input %p to the command instead of pre-rejecting", async (body) => {
    const response = await PUT(req(body), ctx());
    expect(response.status).toBe(200);
    expect(updateSession).toHaveBeenCalledTimes(1);
  });

  it("replays a committed commandId whose retry carries expectedVersion: null (DED2)", async () => {
    vi.mocked(updateSession).mockResolvedValue({
      sessionId: SESSION_ID,
      status: "open",
      version: 3,
      visibility: "private",
      replayed: true,
    });
    const response = await PUT(req({ commandId: "cmd_1", expectedVersion: null }), ctx());
    expect(response.status).toBe(200);
    const [, params] = vi.mocked(updateSession).mock.calls[0]!;
    expect(params.input.expectedVersion).toBeNull();
  });

  it.each([
    ["SESSION_NOT_FOUND", 404],
    ["SESSION_NOT_OPEN", 409],
    ["STALE_VERSION", 409],
    ["CAPACITY_BELOW_ROSTER", 409],
    ["PRICE_CHANGE_REQUIRES_POLICY", 400],
    ["MISSING_DISCOVERY_FIELDS", 400],
    ["INVALID_TIME_RANGE", 400],
    ["COMMAND_ID_CONFLICT", 409],
  ] as const)("maps %s onto %i", async (code, status) => {
    vi.mocked(updateSession).mockRejectedValue(new SessionUpdateError(code, "internal detail"));
    const response = await PUT(req({ commandId: "cmd_1" }), ctx());
    expect(response.status).toBe(status);
    const { error } = await envelope(response);
    expect(error).toMatchObject({ code, statusCode: status });
  });

  it("maps the billing gate's denial of an OPEN update onto TENANT_SUSPENDED 403", async () => {
    vi.mocked(updateSession).mockRejectedValue(new SessionUpdateAuthorizationError());
    const response = await PUT(req({ commandId: "cmd_1" }), ctx());
    expect(response.status).toBe(403);
    const { error } = await envelope(response);
    expect(error).toMatchObject({ code: "TENANT_SUSPENDED", statusCode: 403 });
  });
});
