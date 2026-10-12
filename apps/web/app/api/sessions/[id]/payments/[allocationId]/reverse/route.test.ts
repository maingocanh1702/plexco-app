import { reversePaymentAllocation, RosterMoneyError, authorize } from "@plexco/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { csrfOk, currentSession, rateLimited } from "../../../../../../../lib/session-cookies";
import { POST } from "./route";

vi.mock("@plexco/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@plexco/db")>();
  return {
    ...actual,
    createDb: vi.fn(() => ({
      pool: {},
      db: { execute: async () => ({ rows: [{ locale: "vi" }] }) },
    })),
    reversePaymentAllocation: vi.fn(),
    authorize: vi.fn(),
    withTenant: vi.fn(async (_db: unknown, _tenantId: string, fn: (tx: unknown) => unknown) =>
      fn({}),
    ),
  };
});

vi.mock("../../../../../../../lib/session-cookies", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../../../../lib/session-cookies")>();
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
    `https://plexco.app/api/sessions/${SESSION_ID}/payments/${OTHER_ID}/reverse?tenant=${tenant}`,
    {
      method: "POST",
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

describe("POST /api/sessions/:id/payments/:allocationId/reverse", () => {
  beforeEach(() => {
    vi.mocked(reversePaymentAllocation).mockResolvedValue({
      reversalId: SESSION_ID,
      allocationId: OTHER_ID,
      chargeId: SESSION_ID,
      amount: -100000,
      status: "open",
      replayed: false,
    });
  });

  it("reverses by path ids with the cookie actor and the body reason", async () => {
    const response = await POST(
      req({ commandId: "c1", reason: "wrong player" }),
      ctx({ allocationId: OTHER_ID }),
    );
    expect(response.status).toBe(200);
    expect(reversePaymentAllocation).toHaveBeenCalledWith(expect.anything(), {
      tenantId: TENANT,
      actorPersonId: ACTOR,
      commandId: "c1",
      sessionId: SESSION_ID,
      allocationId: OTHER_ID,
      reason: "wrong player",
    });
    expect((await envelope(response)).data).toEqual({
      reversal: {
        id: SESSION_ID,
        allocationId: OTHER_ID,
        chargeId: SESSION_ID,
        amount: -100000,
        chargeStatus: "open",
      },
      replayed: false,
    });
  });

  it.each([
    ["REVERSAL_EXCEEDS_EFFECTIVE", 409],
    ["REVERSAL_NOT_SUPPORTED", 409],
    ["NOT_FOUND", 404],
    ["SESSION_NOT_FOUND", 404],
    ["FORBIDDEN", 403],
    ["COMMAND_ID_CONFLICT", 409],
  ] as const)("maps %s to %i", async (code, status) => {
    vi.mocked(reversePaymentAllocation).mockRejectedValue(new RosterMoneyError(code, "internal"));
    const response = await POST(
      req({ commandId: "c1", reason: "r" }),
      ctx({ allocationId: OTHER_ID }),
    );
    expect(response.status).toBe(status);
    expect((await envelope(response)).error?.code).toBe(code);
  });

  it("an unexpected (non-domain) failure is NOT dressed up as a client error", async () => {
    vi.mocked(reversePaymentAllocation).mockRejectedValue(new Error("db down"));
    await expect(
      POST(req({ commandId: "c1", reason: "r" }), ctx({ allocationId: OTHER_ID })),
    ).rejects.toThrow("db down");
  });
});
