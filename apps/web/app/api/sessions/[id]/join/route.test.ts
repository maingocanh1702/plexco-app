import { RosterMoneyError, authorize, hasLiveMembership, joinSession } from "@plexco/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { csrfOk, currentSession, rateLimited } from "../../../../../lib/session-cookies";
import { POST } from "./route";

vi.mock("@plexco/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@plexco/db")>();
  return {
    ...actual,
    createDb: vi.fn(() => ({
      pool: {},
      db: { execute: async () => ({ rows: [{ locale: "vi" }] }) },
    })),
    joinSession: vi.fn(),
    hasLiveMembership: vi.fn(),
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
    appDb: vi.fn(() => ({ pool: {}, db: { execute: async () => ({ rows: [{ locale: "vi" }] }) } })),
    currentSession: vi.fn(),
    csrfOk: vi.fn(),
    rateLimited: vi.fn(),
  };
});

process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";

const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "22222222-2222-4222-8222-222222222222";
const SESSION_ID = "33333333-3333-4333-8333-333333333333";
const PERSON = "44444444-4444-4444-8444-444444444444";
const PLAYER_ID = "55555555-5555-4555-8555-555555555555";
const OTHER_PERSON = "66666666-6666-4666-8666-666666666666";

function req(body: unknown, tenant = TENANT): Request {
  return new Request(`https://plexco.app/api/sessions/${SESSION_ID}/join?tenant=${tenant}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": "secret" },
    body: JSON.stringify(body),
  });
}
const ctx = () => ({ params: Promise.resolve({ id: SESSION_ID }) });
const envelope = async (response: Response) =>
  (await response.json()) as {
    data: Record<string, unknown> | null;
    error: { code: string; message: string; statusCode: number } | null;
  };
const signedIn = (personId: string) =>
  vi.mocked(currentSession).mockResolvedValue({
    sessionId: "s",
    accountId: `account-${personId}`,
    personId,
    csrfSecret: "secret",
    expiresAt: new Date(Date.now() + 3_600_000),
  });

beforeEach(() => {
  vi.clearAllMocks();
  signedIn(PERSON);
  vi.mocked(csrfOk).mockReturnValue(true);
  vi.mocked(rateLimited).mockResolvedValue(false);
  // A plain player: no session.manage anywhere, a live member of TENANT only (P-3).
  vi.mocked(authorize).mockResolvedValue({ allowed: false, reason: "not_permitted" });
  vi.mocked(hasLiveMembership).mockImplementation(async (_tx, tenantId) => tenantId === TENANT);
  vi.mocked(joinSession).mockResolvedValue({
    outcome: "active",
    playerId: PLAYER_ID,
    waitlistPosition: null,
    requestId: null,
    replayed: false,
  });
});

describe("POST /api/sessions/:id/join (L8 M9)", () => {
  it("DT-1: no session -> AUTH_REQUIRED 401; the command never runs", async () => {
    vi.mocked(currentSession).mockResolvedValue(null);
    const response = await POST(req({ commandId: "c1" }), ctx());
    expect(response.status).toBe(401);
    expect((await envelope(response)).error?.code).toBe("AUTH_REQUIRED");
    expect(joinSession).not.toHaveBeenCalled();
  });

  it("DT-1: body personId / tenantId / sessionId are ignored: the actor is the COOKIE person, the tenant is ?tenant=, no guest minting", async () => {
    const body = {
      commandId: "c1",
      personId: OTHER_PERSON,
      tenantId: OTHER_TENANT,
      sessionId: "x",
    };
    const response = await POST(req(body), ctx());
    expect(response.status).toBe(200);
    expect(joinSession).toHaveBeenCalledWith(expect.anything(), {
      tenantId: TENANT,
      personId: PERSON,
      sessionId: SESSION_ID,
      commandId: "c1",
    });
    expect(vi.mocked(hasLiveMembership).mock.calls.map((call) => call.slice(1))).toEqual([
      [TENANT, PERSON],
    ]);
  });

  it("DT-11: the 11th join in an hour by one person -> RATE_LIMITED 429 (session-join 10/3600 s); the tenant bucket is spared, another person still joins", async () => {
    const counts = new Map<string, number>();
    vi.mocked(rateLimited).mockImplementation(async (key: string, limit = 10) => {
      counts.set(key, (counts.get(key) ?? 0) + 1);
      return counts.get(key)! > limit;
    });
    const statuses: number[] = [];
    let last: Response | undefined;
    for (let i = 1; i <= 11; i += 1) {
      last = await POST(req({ commandId: `c${i}` }), ctx());
      statuses.push(last.status);
    }
    expect(statuses).toEqual([...Array<number>(10).fill(200), 429]);
    expect((await envelope(last!)).error?.code).toBe("RATE_LIMITED");
    expect(joinSession).toHaveBeenCalledTimes(10);
    expect(rateLimited).toHaveBeenCalledWith(`session-join:${PERSON}`, 10, 3600);
    expect(counts.get(`session-self-service:${TENANT}`)).toBe(10);
    signedIn(OTHER_PERSON);
    expect((await POST(req({ commandId: "c12" }), ctx())).status).toBe(200);
  });

  it("A-6: a member of club A sending ?tenant=B -> the one FORBIDDEN 403; the command never runs", async () => {
    const response = await POST(req({ commandId: "c1" }, OTHER_TENANT), ctx());
    expect(response.status).toBe(403);
    expect((await envelope(response)).error?.code).toBe("FORBIDDEN");
    expect(hasLiveMembership).toHaveBeenCalledWith(expect.anything(), OTHER_TENANT, PERSON);
    expect(joinSession).not.toHaveBeenCalled();
  });

  it("P-3: a non-member of ?tenant= -> FORBIDDEN 403 before the person bucket is spent", async () => {
    vi.mocked(hasLiveMembership).mockResolvedValue(false);
    const response = await POST(req({ commandId: "c1" }), ctx());
    expect(response.status).toBe(403);
    expect((await envelope(response)).error?.code).toBe("FORBIDDEN");
    expect(joinSession).not.toHaveBeenCalled();
    expect(rateLimited).not.toHaveBeenCalledWith(`session-join:${PERSON}`, 10, 3600);
  });

  it.each([
    ["active", PLAYER_ID, null, null],
    ["waitlisted", PLAYER_ID, 3, null],
    ["requested", null, null, PLAYER_ID],
  ] as const)(
    "P-18: outcome %s carries the four DTO keys only: no amount, no venue, even when the service returns more",
    async (outcome, playerId, waitlistPosition, requestId) => {
      const leaky = { amountDue: 100000, venue: "Sân A", chargeId: PLAYER_ID };
      vi.mocked(joinSession).mockResolvedValue({
        ...{ outcome, playerId, waitlistPosition, requestId, replayed: true },
        ...leaky,
      } as Awaited<ReturnType<typeof joinSession>>);
      const { data } = await envelope(await POST(req({ commandId: "c1" }), ctx()));
      expect(data).toEqual({
        join: { outcome, playerId, waitlistPosition, requestId },
        replayed: true,
      });
      expect(JSON.stringify(data)).not.toMatch(/amount|venue|charge|Sân/i);
    },
  );

  it.each([
    ["SESSION_NOT_JOINABLE", 400],
    ["SESSION_NOT_FOUND", 404],
    ["TENANT_SUSPENDED", 403],
    ["REJOIN_REQUIRES_REVIEW", 409],
    ["COMMAND_ID_CONFLICT", 409],
  ] as const)("maps %s to %i without leaking the internal detail", async (code, status) => {
    vi.mocked(joinSession).mockRejectedValue(new RosterMoneyError(code, "internal detail"));
    const response = await POST(req({ commandId: "c1" }), ctx());
    expect(response.status).toBe(status);
    const { error } = await envelope(response);
    expect(error?.code).toBe(code);
    expect(error?.message).not.toContain("internal detail");
  });

  it("SESSION_NOT_JOINABLE carries the P-17 copy pair", async () => {
    vi.mocked(joinSession).mockRejectedValue(new RosterMoneyError("SESSION_NOT_JOINABLE", "x"));
    const { error } = await envelope(await POST(req({ commandId: "c1" }), ctx()));
    expect(["Buổi chơi không nhận đăng ký.", "This session is not open for joining."]).toContain(
      error?.message,
    );
  });
});
