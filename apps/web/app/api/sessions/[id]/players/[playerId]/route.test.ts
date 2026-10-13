import { removePlayerFromSession, RosterMoneyError, authorize } from "@plexco/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { csrfOk, currentSession, rateLimited } from "../../../../../../lib/session-cookies";
import { DELETE } from "./route";

vi.mock("@plexco/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@plexco/db")>();
  return {
    ...actual,
    createDb: vi.fn(() => ({
      pool: {},
      db: { execute: async () => ({ rows: [{ locale: "vi" }] }) },
    })),
    removePlayerFromSession: vi.fn(),
    authorize: vi.fn(),
    withTenant: vi.fn(async (_db: unknown, _tenantId: string, fn: (tx: unknown) => unknown) =>
      fn({}),
    ),
  };
});

vi.mock("../../../../../../lib/session-cookies", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../../../lib/session-cookies")>();
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
  return new Request(
    `https://plexco.app/api/sessions/${SESSION_ID}/players/${OTHER_ID}?tenant=${tenant}`,
    {
      method: "DELETE",
      headers: { "content-type": "application/json", "x-csrf-token": "secret" },
      body: JSON.stringify(body),
    },
  );
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

describe("DELETE /api/sessions/:id/players/:playerId", () => {
  beforeEach(() => {
    vi.mocked(removePlayerFromSession).mockResolvedValue({ playerId: OTHER_ID, replayed: false });
  });

  it("removes via path ids, actor from the cookie, commandId from the DELETE body", async () => {
    const response = await DELETE(req({ commandId: "c1" }), ctx({ playerId: OTHER_ID }));
    expect(response.status).toBe(200);
    expect(removePlayerFromSession).toHaveBeenCalledWith(expect.anything(), {
      tenantId: TENANT,
      actorPersonId: ACTOR,
      commandId: "c1",
      sessionId: SESSION_ID,
      playerId: OTHER_ID,
    });
    expect((await envelope(response)).data).toEqual({
      player: { id: OTHER_ID, status: "left" },
      replayed: false,
    });
  });

  it("REMOVE_REQUIRES_REVIEW (paid player) is a 409 with the pinned code", async () => {
    vi.mocked(removePlayerFromSession).mockRejectedValue(
      new RosterMoneyError("REMOVE_REQUIRES_REVIEW", "x"),
    );
    const response = await DELETE(req({ commandId: "c1" }), ctx({ playerId: OTHER_ID }));
    expect(response.status).toBe(409);
    expect((await envelope(response)).error?.code).toBe("REMOVE_REQUIRES_REVIEW");
  });

  it("PLAYER_NOT_FOUND is a 404; a missing commandId never reaches the command", async () => {
    vi.mocked(removePlayerFromSession).mockRejectedValue(
      new RosterMoneyError("PLAYER_NOT_FOUND", "x"),
    );
    expect((await DELETE(req({ commandId: "c1" }), ctx({ playerId: "junk" }))).status).toBe(404);
    vi.mocked(removePlayerFromSession).mockClear();
    expect((await DELETE(req({}), ctx({ playerId: OTHER_ID }))).status).toBe(400);
    expect(removePlayerFromSession).not.toHaveBeenCalled();
  });
});
