import {
  closeSession,
  SessionCloseAuthorizationError,
  SessionCloseError,
  tenantsForPerson,
} from "@plexco/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { csrfOk, currentSession, rateLimited } from "../../../../../lib/session-cookies";
import { POST } from "./route";

vi.mock("@plexco/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@plexco/db")>();
  return {
    ...actual,
    // `db` needs a working `execute`: the route resolves the tenant's language through the REAL
    // tenantLocale (packages/db/src/tenant.ts), which calls db.execute. An empty `{}` throws
    // TypeError into tenantLocale's own catch, which logs a deliberately-loud anomaly line on
    // every single request.
    createDb: vi.fn(() => ({
      pool: {},
      db: { execute: async () => ({ rows: [{ locale: "vi" }] }) },
    })),
    closeSession: vi.fn(),
    tenantsForPerson: vi.fn(),
  };
});

vi.mock("../../../../../lib/session-cookies", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../../lib/session-cookies")>();
  return {
    ...actual,
    // The handle the route actually hands to tenantLocale, so `execute` must exist here for the
    // same reason as the createDb stub above.
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
  return new Request(`https://plexco.app/api/sessions/${SESSION_ID}/close?tenant=${tenant}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": "secret" },
    body: JSON.stringify(body),
  });
}
const ctx = (id = SESSION_ID) => ({ params: Promise.resolve({ id }) });

const envelope = async (response: Response) =>
  (await response.json()) as {
    data: Record<string, unknown> | null;
    error: { code: string; message: string; statusCode: number } | null;
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
  vi.mocked(tenantsForPerson).mockResolvedValue([{ tenantId: TENANT, role: "owner" }]);
  vi.mocked(closeSession).mockResolvedValue({
    sessionId: SESSION_ID,
    status: "closed",
    version: 3,
    replayed: false,
  });
});

describe("POST /api/sessions/:id/close", () => {
  it("closes and returns the pinned DTO", async () => {
    const response = await POST(req({ commandId: "cmd_1", expectedVersion: 2 }), ctx());
    expect(response.status).toBe(200);
    const { data } = await envelope(response);
    expect(data).toEqual({ session: { id: SESSION_ID, status: "closed", version: 3 } });
  });

  it("takes sessionId from the PATH and tenant/commandId from trusted context", async () => {
    await POST(req({ commandId: "cmd_1", expectedVersion: 2 }), ctx());
    expect(closeSession).toHaveBeenCalledWith(expect.anything(), {
      tenantId: TENANT,
      commandId: "cmd_1",
      input: { sessionId: SESSION_ID, expectedVersion: 2 },
    });
  });

  // A2. DD-117 D5: dedup is on (tenant_id, command_id) ONLY and runs BEFORE validation inside the
  // command, so a retry of an already-committed close must hand back the stored result. The route
  // must not pre-empt that with its own 400 — which is why expectedVersion is forwarded unchecked.
  it("returns the stored result for a replayed commandId rather than a 400", async () => {
    vi.mocked(closeSession).mockResolvedValue({
      sessionId: SESSION_ID,
      status: "closed",
      version: 3,
      replayed: true,
    });
    const response = await POST(req({ commandId: "cmd_1", expectedVersion: null }), ctx());
    expect(response.status).toBe(200);
    const { data } = await envelope(response);
    expect(data).toEqual({ session: { id: SESSION_ID, status: "closed", version: 3 } });
  });

  it("forwards a mistyped expectedVersion instead of pre-rejecting (dedup precedes validation)", async () => {
    const response = await POST(req({ commandId: "cmd_1", expectedVersion: "2" }), ctx());
    expect(response.status).toBe(200);
    expect(closeSession).toHaveBeenCalledTimes(1);
  });

  it("omits expectedVersion when absent (the no-op branch does not check it)", async () => {
    await POST(req({ commandId: "cmd_1" }), ctx());
    const [, params] = vi.mocked(closeSession).mock.calls[0]!;
    expect(params.input.expectedVersion).toBeUndefined();
  });

  it("forwards a non-UUID path id and lets the command fail it closed as SESSION_NOT_FOUND", async () => {
    vi.mocked(closeSession).mockRejectedValue(
      new SessionCloseError("SESSION_NOT_FOUND", "internal"),
    );
    const response = await POST(req({ commandId: "cmd_1" }), ctx("not-a-uuid"));
    expect(response.status).toBe(404);
    const [, params] = vi.mocked(closeSession).mock.calls[0]!;
    expect(params.input.sessionId).toBe("not-a-uuid");
  });

  it("denies a caller with no session-managing role and never reaches the command", async () => {
    vi.mocked(tenantsForPerson).mockResolvedValue([{ tenantId: TENANT, role: "member" }]);
    const response = await POST(req({ commandId: "cmd_1" }), ctx());
    expect(response.status).toBe(403);
    expect(closeSession).not.toHaveBeenCalled();
  });

  it("allows co_admin (DD-56 default preset includes session.manage)", async () => {
    vi.mocked(tenantsForPerson).mockResolvedValue([{ tenantId: TENANT, role: "co_admin" }]);
    const response = await POST(req({ commandId: "cmd_1" }), ctx());
    expect(response.status).toBe(200);
  });

  // A1: one case per member of CloseSessionErrorCode, not one happy path. Each asserts the REAL
  // code reaches the client — before this route existed, every one of these was a 500.
  it.each([
    ["SESSION_NOT_FOUND", 404],
    ["SESSION_NOT_OPEN", 409],
    ["STALE_VERSION", 409],
    ["CANCEL_REQUIRES_REVIEW", 400],
    ["COMMAND_ID_CONFLICT", 409],
  ] as const)("maps %s onto %i", async (code, status) => {
    vi.mocked(closeSession).mockRejectedValue(new SessionCloseError(code, "internal detail"));
    const response = await POST(req({ commandId: "cmd_1" }), ctx());
    expect(response.status).toBe(status);
    const { error } = await envelope(response);
    expect(error).toMatchObject({ code, statusCode: status });
  });

  it("maps the billing gate's denial onto TENANT_SUSPENDED 403", async () => {
    vi.mocked(closeSession).mockRejectedValue(new SessionCloseAuthorizationError());
    const response = await POST(req({ commandId: "cmd_1" }), ctx());
    expect(response.status).toBe(403);
    const { error } = await envelope(response);
    expect(error).toMatchObject({ code: "TENANT_SUSPENDED", statusCode: 403 });
  });

  // The money refusal is the reason this slice is P1, so its BODY is pinned too, not just its
  // status. The command distinguishes a charge (including a `void` one) from an active roster;
  // the response deliberately does not, because a caller who cannot already read the roster must
  // not learn a session's payment state from an error string. The command's own message
  // ("internal detail" here) is never echoed.
  it("never leaks WHY a close was refused for review", async () => {
    vi.mocked(closeSession).mockRejectedValue(
      new SessionCloseError("CANCEL_REQUIRES_REVIEW", "session has 3 charges totalling 450000"),
    );
    const response = await POST(req({ commandId: "cmd_1" }), ctx());
    const { error } = await envelope(response);
    expect(error?.message).not.toMatch(/charge|roster|450000|internal/i);
    expect(error?.message).toBe("Kèo này cần được xem xét trước khi đóng hoặc huỷ.");
  });
});
