import { createSession, SessionCommandError, tenantsForPerson } from "@plexco/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { csrfOk, currentSession, rateLimited } from "../../../lib/session-cookies";
import { POST } from "./route";

// Real error classes, mocked command + membership reader. session-command-route itself is NOT
// mocked: every case below runs through the real auth/authz/rate-limit gate.
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
    createSession: vi.fn(),
    tenantsForPerson: vi.fn(),
  };
});

vi.mock("../../../lib/session-cookies", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/session-cookies")>();
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

// Production-shaped: createSession requires sportId to be a UUID. codex round-03 [P2] — the
// earlier fixture used "badminton", so the happy path asserted success for an input production
// would have rejected, and the mocked command hid it.
const SPORT_ID = "55555555-5555-4555-8555-555555555555";

const validBody = {
  commandId: "cmd_1",
  sportId: SPORT_ID,
  startsAt: "2026-09-01T10:00:00.000Z",
  endsAt: "2026-09-01T12:00:00.000Z",
  timezone: "Asia/Ho_Chi_Minh",
};

function req(body: unknown, tenant = TENANT): Request {
  return new Request(`https://plexco.app/api/sessions?tenant=${tenant}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": "secret" },
    body: JSON.stringify(body),
  });
}

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
  vi.mocked(tenantsForPerson).mockResolvedValue([{ tenantId: TENANT, role: "owner" }]);
  vi.mocked(createSession).mockResolvedValue({
    sessionId: SESSION_ID,
    status: "draft",
    visibility: "private",
    version: 1,
    replayed: false,
  });
});

describe("POST /api/sessions", () => {
  it("creates a draft and returns the pinned DTO", async () => {
    const response = await POST(req(validBody));
    expect(response.status).toBe(200);
    const { data, error } = await envelope(response);
    expect(error).toBeNull();
    expect(data).toEqual({ session: { id: SESSION_ID, status: "draft", version: 1 } });
  });

  // What the db stubs above are FOR. tenantLocale's catch logs on purpose — it means an error
  // class that must never be silent. A suite that emits it on every request is a suite where a
  // real one is invisible, so the absence of that line is pinned here rather than left to habit.
  it("resolves tenant language without logging a tenantLocale anomaly", async () => {
    const consoleError = vi.spyOn(console, "error");
    try {
      const response = await POST(req(validBody));
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

  it("forwards tenantId and commandId as trusted context, never from the body's own tenant", async () => {
    await POST(req({ ...validBody, tenantId: "99999999-9999-4999-8999-999999999999" }));
    expect(createSession).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tenantId: TENANT, commandId: "cmd_1" }),
    );
  });

  it("shapes the payload: ISO strings become Dates, optionals pass through", async () => {
    await POST(req({ ...validBody, priceAmount: 50000, slotsMax: 8, visibility: "public" }));
    const [, params] = vi.mocked(createSession).mock.calls[0]!;
    expect(params.input.startsAt).toBeInstanceOf(Date);
    expect(params.input.startsAt.toISOString()).toBe("2026-09-01T10:00:00.000Z");
    expect(params.input).toMatchObject({ priceAmount: 50000, slotsMax: 8, visibility: "public" });
  });

  it("delivers the COMPLETE required service input, production-shaped", async () => {
    await POST(req(validBody));
    const [, params] = vi.mocked(createSession).mock.calls[0]!;
    expect(params.input.sportId).toBe(SPORT_ID);
    expect(params.input.timezone).toBe("Asia/Ho_Chi_Minh");
    expect(params.input.startsAt.toISOString()).toBe("2026-09-01T10:00:00.000Z");
    expect(params.input.endsAt.toISOString()).toBe("2026-09-01T12:00:00.000Z");
  });

  it("does not call the command when the caller holds no session-managing role", async () => {
    vi.mocked(tenantsForPerson).mockResolvedValue([{ tenantId: TENANT, role: "member" }]);
    const response = await POST(req(validBody));
    expect(response.status).toBe(403);
    expect(createSession).not.toHaveBeenCalled();
  });

  it("allows co_admin (DD-56 default preset includes session.manage)", async () => {
    vi.mocked(tenantsForPerson).mockResolvedValue([{ tenantId: TENANT, role: "co_admin" }]);
    const response = await POST(req(validBody));
    expect(response.status).toBe(200);
    expect(createSession).toHaveBeenCalled();
  });

  it("does not call the command for another tenant (isolation)", async () => {
    vi.mocked(tenantsForPerson).mockResolvedValue([
      { tenantId: "44444444-4444-4444-8444-444444444444", role: "owner" },
    ]);
    const response = await POST(req(validBody));
    expect(response.status).toBe(403);
    expect(createSession).not.toHaveBeenCalled();
  });

  it("rejects a missing commandId with 400 and never reaches the command", async () => {
    // Command IDENTITY is still validated before dispatch — without it there is nothing to dedup
    // on, so this is not a patch-validation rejection.
    const response = await POST(req({ ...validBody, commandId: undefined }));
    expect(response.status).toBe(400);
    const { error } = await envelope(response);
    expect(error).toMatchObject({ code: "INVALID_BODY" });
    expect(createSession).not.toHaveBeenCalled();
  });

  // codex round-01 [P1]: dedup precedes patch validation inside the command (DD-117 D5), so the
  // route must NOT pre-reject a malformed field — otherwise a retry of an already-committed
  // create is told it failed after the mutation happened. These reach the command, which owns
  // the verdict and reports its own code.
  it.each([
    ["missing sportId", { ...validBody, sportId: undefined }],
    ["blank sportId", { ...validBody, sportId: "" }],
    ["missing startsAt", { ...validBody, startsAt: undefined }],
    ["unparseable startsAt", { ...validBody, startsAt: "nonsense" }],
    ["missing timezone", { ...validBody, timezone: undefined }],
    ["mistyped priceAmount", { ...validBody, priceAmount: "50000" }],
  ])("forwards %s to the command instead of pre-rejecting it", async (label, body) => {
    const response = await POST(req(body));
    expect(response.status, label).toBe(200);
    expect(createSession).toHaveBeenCalledTimes(1);
  });

  it("replays a committed commandId whose retry payload is malformed (DD-117 D5)", async () => {
    vi.mocked(createSession).mockResolvedValue({
      sessionId: SESSION_ID,
      status: "draft",
      visibility: "private",
      version: 1,
      replayed: true,
    });
    const response = await POST(req({ ...validBody, startsAt: null, timezone: 42 }));
    expect(response.status).toBe(200);
    const { data } = await envelope(response);
    expect(data).toEqual({ session: { id: SESSION_ID, status: "draft", version: 1 } });
  });

  it("does NOT pre-reject venueAddress — it is outside create's vocabulary, so it is ignored", async () => {
    // codex round-02 [P1]: refusing it pre-dispatch broke replay, because the ORIGINAL request
    // may have committed WITHOUT the field and the retry may carry it. Payload differences are
    // irrelevant to dedup (DD-117 D5), so this must reach the command and replay.
    const response = await POST(req({ ...validBody, venueAddress: "12 Nguyen Trai" }));
    expect(response.status).toBe(200);
    expect(createSession).toHaveBeenCalledTimes(1);
  });

  it("replays a committed create whose retry ADDS venueAddress (round-02 [P1] scenario)", async () => {
    vi.mocked(createSession).mockResolvedValue({
      sessionId: SESSION_ID,
      status: "draft",
      visibility: "private",
      version: 1,
      replayed: true,
    });
    const response = await POST(req({ ...validBody, venueAddress: "12 Nguyen Trai" }));
    expect(response.status).toBe(200);
    const { data } = await envelope(response);
    expect(data).toEqual({ session: { id: SESSION_ID, status: "draft", version: 1 } });
  });

  it("never forwards venueAddress into the create payload", async () => {
    await POST(req(validBody));
    const [, params] = vi.mocked(createSession).mock.calls[0]!;
    expect((params.input as unknown as Record<string, unknown>).venueAddress).toBeUndefined();
  });

  it.each([
    ["INVALID_TIME_RANGE", 400],
    ["SPORT_INACTIVE", 400],
    ["MISSING_DISCOVERY_FIELDS", 400],
    ["COMMAND_ID_CONFLICT", 409],
  ] as const)("maps the command's %s onto %i", async (code, status) => {
    vi.mocked(createSession).mockRejectedValue(new SessionCommandError(code, "internal detail"));
    const response = await POST(req(validBody));
    expect(response.status).toBe(status);
    const { error } = await envelope(response);
    expect(error).toMatchObject({ code, statusCode: status });
  });

  it("rethrows an unmapped internal failure instead of dressing it as a client error", async () => {
    vi.mocked(createSession).mockRejectedValue(new Error("pool exhausted"));
    await expect(POST(req(validBody))).rejects.toThrow("pool exhausted");
  });
});
