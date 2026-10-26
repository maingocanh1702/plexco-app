import {
  publishSession,
  SessionPublishAuthorizationError,
  SessionPublishError,
  authorize,
} from "@plexco/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { csrfOk, currentSession, rateLimited } from "../../../../../lib/session-cookies";
import { POST } from "./route";

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
    publishSession: vi.fn(),
    authorize: vi.fn(),
    withTenant: vi.fn(async (_db: unknown, _tenantId: string, fn: (tx: unknown) => unknown) =>
      fn({}),
    ),
  };
});

vi.mock("../../../../../lib/session-cookies", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../../lib/session-cookies")>();
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
  return new Request(`https://plexco.app/api/sessions/${SESSION_ID}/publish?tenant=${tenant}`, {
    method: "POST",
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
  vi.mocked(publishSession).mockResolvedValue({
    sessionId: SESSION_ID,
    status: "open",
    visibility: "public",
    version: 2,
    replayed: false,
  });
});

describe("POST /api/sessions/:id/publish", () => {
  it("publishes and returns the pinned DTO", async () => {
    const response = await POST(req({ commandId: "cmd_1", expectedVersion: 1 }), ctx());
    expect(response.status).toBe(200);
    const { data } = await envelope(response);
    expect(data).toEqual({ session: { id: SESSION_ID, status: "open", version: 2 } });
  });

  // What the db stubs above are FOR. tenantLocale's catch logs on purpose — it means an error
  // class that must never be silent. A suite that emits it on every request is a suite where a
  // real one is invisible, so the absence of that line is pinned here rather than left to habit.
  it("resolves tenant language without logging a tenantLocale anomaly", async () => {
    const consoleError = vi.spyOn(console, "error");
    try {
      const response = await POST(req({ commandId: "cmd_1", expectedVersion: 1 }), ctx());
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

  it("takes sessionId from the PATH and tenant/commandId from trusted context", async () => {
    await POST(req({ commandId: "cmd_1", expectedVersion: 1 }), ctx());
    expect(publishSession).toHaveBeenCalledWith(expect.anything(), {
      tenantId: TENANT,
      commandId: "cmd_1",
      actorPersonId: "p",
      input: { sessionId: SESSION_ID, expectedVersion: 1 },
    });
  });

  it("omits expectedVersion when absent (the no-op branch does not check it)", async () => {
    await POST(req({ commandId: "cmd_1" }), ctx());
    const [, params] = vi.mocked(publishSession).mock.calls[0]!;
    expect(params.input.expectedVersion).toBeUndefined();
  });

  it("forwards a mistyped expectedVersion instead of pre-rejecting (dedup precedes validation)", async () => {
    // codex round-01 [P1]: a retry of an already-committed publish must replay, not 400.
    const response = await POST(req({ commandId: "cmd_1", expectedVersion: "1" }), ctx());
    expect(response.status).toBe(200);
    expect(publishSession).toHaveBeenCalledTimes(1);
  });

  it("forwards a non-UUID path id and lets the command fail it closed as SESSION_NOT_FOUND", async () => {
    vi.mocked(publishSession).mockRejectedValue(
      new SessionPublishError("SESSION_NOT_FOUND", "internal"),
    );
    const response = await POST(req({ commandId: "cmd_1" }), ctx("not-a-uuid"));
    expect(response.status).toBe(404);
    const [, params] = vi.mocked(publishSession).mock.calls[0]!;
    expect(params.input.sessionId).toBe("not-a-uuid");
  });

  it("denies a caller with no session-managing role and never reaches the command", async () => {
    vi.mocked(authorize).mockResolvedValue({ allowed: false, reason: "not_a_member" });
    const response = await POST(req({ commandId: "cmd_1" }), ctx());
    expect(response.status).toBe(403);
    expect(publishSession).not.toHaveBeenCalled();
  });

  it("allows co_admin (DD-56 default preset includes session.manage)", async () => {
    vi.mocked(authorize).mockResolvedValue({ allowed: true, role: "co_admin" });
    const response = await POST(req({ commandId: "cmd_1" }), ctx());
    expect(response.status).toBe(200);
  });

  it.each([
    ["SESSION_NOT_FOUND", 404],
    ["SESSION_NOT_OPEN", 409],
    ["STALE_VERSION", 409],
    ["MISSING_DISCOVERY_FIELDS", 400],
    ["COMMAND_ID_CONFLICT", 409],
  ] as const)("maps %s onto %i", async (code, status) => {
    vi.mocked(publishSession).mockRejectedValue(new SessionPublishError(code, "internal detail"));
    const response = await POST(req({ commandId: "cmd_1" }), ctx());
    expect(response.status).toBe(status);
    const { error } = await envelope(response);
    expect(error).toMatchObject({ code, statusCode: status });
  });

  it("maps the billing gate's denial onto TENANT_SUSPENDED 403", async () => {
    vi.mocked(publishSession).mockRejectedValue(new SessionPublishAuthorizationError());
    const response = await POST(req({ commandId: "cmd_1" }), ctx());
    expect(response.status).toBe(403);
    const { error } = await envelope(response);
    expect(error).toMatchObject({ code: "TENANT_SUSPENDED", statusCode: 403 });
  });
});
