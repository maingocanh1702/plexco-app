import { RosterMoneyError, authorize, hasLiveMembership, leaveSession } from "@plexco/db";
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
    leaveSession: vi.fn(),
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

function req(body: unknown, tenant = TENANT): Request {
  return new Request(`https://plexco.app/api/sessions/${SESSION_ID}/leave?tenant=${tenant}`, {
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(currentSession).mockResolvedValue({
    sessionId: "s",
    accountId: "a",
    personId: PERSON,
    csrfSecret: "secret",
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  vi.mocked(csrfOk).mockReturnValue(true);
  vi.mocked(rateLimited).mockResolvedValue(false);
  // A plain player: no session.manage anywhere, a live member of TENANT only (P-3).
  vi.mocked(authorize).mockResolvedValue({ allowed: false, reason: "not_permitted" });
  vi.mocked(hasLiveMembership).mockImplementation(async (_tx, tenantId) => tenantId === TENANT);
  vi.mocked(leaveSession).mockResolvedValue({
    playerId: PLAYER_ID,
    status: "left",
    replayed: false,
  });
});

describe("POST /api/sessions/:id/leave (L8 M9)", () => {
  it("DT-1: no session -> AUTH_REQUIRED 401; the command never runs", async () => {
    vi.mocked(currentSession).mockResolvedValue(null);
    const response = await POST(req({ commandId: "c1" }), ctx());
    expect(response.status).toBe(401);
    expect((await envelope(response)).error?.code).toBe("AUTH_REQUIRED");
    expect(leaveSession).not.toHaveBeenCalled();
  });

  it("DT-1: body personId / tenantId / playerId are ignored: the actor is the COOKIE person, the tenant is ?tenant=", async () => {
    const body = { commandId: "c1", personId: "evil", tenantId: OTHER_TENANT, playerId: "evil" };
    const response = await POST(req(body), ctx());
    expect(response.status).toBe(200);
    expect(leaveSession).toHaveBeenCalledWith(expect.anything(), {
      tenantId: TENANT,
      personId: PERSON,
      sessionId: SESSION_ID,
      commandId: "c1",
    });
    expect((await envelope(response)).data).toEqual({
      player: { id: PLAYER_ID, status: "left" },
      replayed: false,
    });
  });

  it("A-6: a member of club A sending ?tenant=B -> the one FORBIDDEN 403; the command never runs", async () => {
    const response = await POST(req({ commandId: "c1" }, OTHER_TENANT), ctx());
    expect(response.status).toBe(403);
    expect((await envelope(response)).error?.code).toBe("FORBIDDEN");
    expect(leaveSession).not.toHaveBeenCalled();
  });

  it("P-3: a non-member of ?tenant= -> FORBIDDEN 403; the command never runs", async () => {
    vi.mocked(hasLiveMembership).mockResolvedValue(false);
    const response = await POST(req({ commandId: "c1" }), ctx());
    expect(response.status).toBe(403);
    expect(leaveSession).not.toHaveBeenCalled();
  });

  it("P-24 (R1B-1/S1-1): the 21st leave in an hour by one person -> RATE_LIMITED 429 (session-leave 20/3600 s, checked before the tenant bucket); the tenant bucket is spared, another person still leaves", async () => {
    const counts = new Map<string, number>();
    vi.mocked(rateLimited).mockImplementation(async (key: string, limit = 20) => {
      counts.set(key, (counts.get(key) ?? 0) + 1);
      return counts.get(key)! > limit;
    });
    const statuses: number[] = [];
    for (let i = 1; i <= 21; i += 1) {
      statuses.push((await POST(req({ commandId: `c${i}` }), ctx())).status);
    }
    expect(statuses).toEqual([...Array<number>(20).fill(200), 429]);
    expect(rateLimited).toHaveBeenCalledWith(`session-leave:${PERSON}`, 20, 3600);
    expect(counts.get(`session-self-service:${TENANT}`)).toBe(20); // the 21st stopped first
  });

  it.each([
    ["LEAVE_REQUIRES_HOST", 409],
    ["PLAYER_NOT_FOUND", 404],
    ["SESSION_NOT_FOUND", 404],
    ["TENANT_SUSPENDED", 403],
    ["COMMAND_ID_CONFLICT", 409],
  ] as const)("maps %s to %i without leaking the internal detail", async (code, status) => {
    vi.mocked(leaveSession).mockRejectedValue(new RosterMoneyError(code, "internal detail"));
    const response = await POST(req({ commandId: "c1" }), ctx());
    expect(response.status).toBe(status);
    const { error } = await envelope(response);
    expect(error?.code).toBe(code);
    expect(error?.message).not.toContain("internal detail");
  });

  it("LEAVE_REQUIRES_HOST is PLAYER copy (P-4, P-17): ask the host, not the host-facing review pair", async () => {
    vi.mocked(leaveSession).mockRejectedValue(new RosterMoneyError("LEAVE_REQUIRES_HOST", "x"));
    const { error } = await envelope(await POST(req({ commandId: "c1" }), ctx()));
    expect([
      "Bạn không thể tự rời buổi này, hãy nhờ chủ kèo.",
      "You cannot leave this session yourself; ask the host.",
    ]).toContain(error?.message);
  });
});
