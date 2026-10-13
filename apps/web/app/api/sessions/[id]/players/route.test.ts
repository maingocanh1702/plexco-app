import { addMemberToSession, RosterMoneyError, authorize } from "@plexco/db";
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
    addMemberToSession: vi.fn(),
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
const SESSION_ID = "33333333-3333-4333-8333-333333333333";
const ACTOR = "44444444-4444-4444-8444-444444444444";
const OTHER_ID = "55555555-5555-4555-8555-555555555555";

function req(body: unknown, tenant = TENANT): Request {
  return new Request(`https://plexco.app/api/sessions/${SESSION_ID}/players?tenant=${tenant}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": "secret" },
    body: JSON.stringify(body),
  });
}
const ctx = <T extends Record<string, string> = Record<string, never>>(extra?: T) =>
  ({ params: Promise.resolve({ id: SESSION_ID, ...extra }) }) as {
    params: Promise<{ id: string } & T>;
  };
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
    personId: ACTOR,
    csrfSecret: "secret",
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  vi.mocked(csrfOk).mockReturnValue(true);
  vi.mocked(rateLimited).mockResolvedValue(false);
  vi.mocked(authorize).mockResolvedValue({ allowed: true, role: "owner" });
});

describe("POST /api/sessions/:id/players", () => {
  beforeEach(() => {
    vi.mocked(addMemberToSession).mockResolvedValue({
      playerId: OTHER_ID,
      membershipId: OTHER_ID,
      status: "active",
      waitlistPosition: null,
      chargeId: SESSION_ID,
      replayed: false,
    });
  });

  it("host-add by membershipId: actor from the COOKIE, tenant/command from trusted context, DTO has ids only", async () => {
    const response = await POST(
      req({ commandId: "c1", membershipId: OTHER_ID, actorPersonId: "evil", tenantId: "evil" }),
      ctx(),
    );
    expect(response.status).toBe(200);
    expect(addMemberToSession).toHaveBeenCalledWith(expect.anything(), {
      tenantId: TENANT,
      actorPersonId: ACTOR,
      commandId: "c1",
      sessionId: SESSION_ID,
      member: { membershipId: OTHER_ID },
      source: "host_add",
    });
    const { data } = await envelope(response);
    expect(data).toEqual({
      player: {
        id: OTHER_ID,
        membershipId: OTHER_ID,
        status: "active",
        waitlistPosition: null,
        chargeId: SESSION_ID,
      },
      replayed: false,
    });
  });

  it("by displayName forwards only that key; sending both forwards both (the command rejects it)", async () => {
    await POST(req({ commandId: "c1", displayName: "Lan" }), ctx());
    expect(vi.mocked(addMemberToSession).mock.calls[0]![1].member).toEqual({ displayName: "Lan" });
    await POST(req({ commandId: "c2", displayName: "Lan", membershipId: OTHER_ID }), ctx());
    expect(vi.mocked(addMemberToSession).mock.calls[1]![1].member).toEqual({
      displayName: "Lan",
      membershipId: OTHER_ID,
    });
  });

  it.each([
    ["FORBIDDEN", 403],
    ["TENANT_SUSPENDED", 403],
    ["SESSION_NOT_FOUND", 404],
    ["PLAYER_NOT_FOUND", 404],
    ["SESSION_NOT_OPEN", 409],
    ["ALREADY_JOINED", 409],
    ["REJOIN_REQUIRES_REVIEW", 409],
    ["COMMAND_ID_CONFLICT", 409],
  ] as const)("maps %s to %i", async (code, status) => {
    vi.mocked(addMemberToSession).mockRejectedValue(new RosterMoneyError(code, "internal detail"));
    const response = await POST(req({ commandId: "c1", displayName: "x" }), ctx());
    expect(response.status).toBe(status);
    const { error } = await envelope(response);
    expect(error?.code).toBe(code);
    expect(error?.message).not.toContain("internal detail");
  });

  it("INVALID_INPUT collapses onto INVALID_BODY 400", async () => {
    vi.mocked(addMemberToSession).mockRejectedValue(new RosterMoneyError("INVALID_INPUT", "x"));
    const response = await POST(req({ commandId: "c1" }), ctx());
    expect(response.status).toBe(400);
    expect((await envelope(response)).error?.code).toBe("INVALID_BODY");
  });

  it("a non-string membershipId (null) is INVALID_BODY 400 and never reaches the command", async () => {
    const response = await POST(req({ commandId: "c1", membershipId: null }), ctx());
    expect(response.status).toBe(400);
    expect((await envelope(response)).error?.code).toBe("INVALID_BODY");
    expect(addMemberToSession).not.toHaveBeenCalled();
  });

  it("the shared gate still applies: no commandId -> 400, role gate denied -> 403, command never reached", async () => {
    expect((await POST(req({ displayName: "x" }), ctx())).status).toBe(400);
    vi.mocked(authorize).mockResolvedValue({ allowed: false, reason: "not_permitted" });
    expect((await POST(req({ commandId: "c1", displayName: "x" }), ctx())).status).toBe(403);
    expect(addMemberToSession).not.toHaveBeenCalled();
  });
});
