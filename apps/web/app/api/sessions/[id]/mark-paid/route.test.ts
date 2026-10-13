import { markPaid, RosterMoneyError, authorize } from "@plexco/db";
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
    markPaid: vi.fn(),
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
  return new Request(`https://plexco.app/api/sessions/${SESSION_ID}/mark-paid?tenant=${tenant}`, {
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

const LINE = {
  playerId: OTHER_ID,
  chargeId: SESSION_ID,
  amountDue: 100000,
  effectiveBefore: 0,
  remaining: 100000,
  amount: 100000,
};

describe("POST /api/sessions/:id/mark-paid", () => {
  beforeEach(() => {
    vi.mocked(markPaid).mockResolvedValue({
      preview: true,
      replayed: false,
      method: "cash",
      total: 100000,
      lines: [LINE],
    });
  });

  it("preview: only a literal `true` previews; the response carries per-line remaining and the total", async () => {
    const response = await POST(
      req({
        commandId: "throwaway",
        preview: true,
        method: "cash",
        items: [{ playerId: OTHER_ID }],
      }),
      ctx(),
    );
    expect(response.status).toBe(200);
    const params = vi.mocked(markPaid).mock.calls[0]![1];
    expect(params).toMatchObject({
      tenantId: TENANT,
      actorPersonId: ACTOR,
      sessionId: SESSION_ID,
      preview: true,
      method: "cash",
    });
    expect(params).not.toHaveProperty("expectedTotal");
    expect((await envelope(response)).data).toMatchObject({
      preview: true,
      total: 100000,
      lines: [LINE],
    });
  });

  it("confirm: preview:'true' (string) or absent is a CONFIRM; expectedTotal and note are forwarded unvalidated", async () => {
    await POST(
      req({
        commandId: "c1",
        preview: "true",
        method: "attested_transfer",
        items: [{ playerId: OTHER_ID, amount: 5 }],
        expectedTotal: 5,
        note: "CK",
      }),
      ctx(),
    );
    expect(vi.mocked(markPaid).mock.calls[0]![1]).toMatchObject({
      commandId: "c1",
      preview: false,
      method: "attested_transfer",
      expectedTotal: 5,
      note: "CK",
      items: [{ playerId: OTHER_ID, amount: 5 }],
    });
  });

  it("never takes actor or tenant from the body", async () => {
    await POST(
      req({
        commandId: "c1",
        method: "cash",
        items: [],
        actorPersonId: "evil",
        tenantId: "evil",
        createdBy: "evil",
      }),
      ctx(),
    );
    const params = vi.mocked(markPaid).mock.calls[0]![1];
    expect(params.actorPersonId).toBe(ACTOR);
    expect(params.tenantId).toBe(TENANT);
  });

  it.each([
    ["ALLOCATION_EXCEEDS_FUNDS", 409],
    ["CHARGE_ALREADY_SETTLED", 409],
    ["CHARGE_NOT_PAYABLE", 409],
    ["MARK_PAID_TOTAL_MISMATCH", 409],
    ["PLAYER_NOT_FOUND", 404],
    ["SESSION_NOT_FOUND", 404],
    ["FORBIDDEN", 403],
    ["TENANT_SUSPENDED", 403],
    ["COMMAND_ID_CONFLICT", 409],
  ] as const)("maps %s to %i", async (code, status) => {
    vi.mocked(markPaid).mockRejectedValue(new RosterMoneyError(code, "internal"));
    const response = await POST(req({ commandId: "c1", method: "cash", items: [] }), ctx());
    expect(response.status).toBe(status);
    expect((await envelope(response)).error?.code).toBe(code);
  });

  it("is rate limited per tenant at 30/min (bucket + limit) and a 429 never reaches the command", async () => {
    await POST(req({ commandId: "c1", method: "cash", items: [] }), ctx());
    expect(rateLimited).toHaveBeenCalledWith(`session-mark-paid:${TENANT}`, 30, 60);
    vi.mocked(markPaid).mockClear();
    vi.mocked(rateLimited).mockResolvedValue(true);
    expect((await POST(req({ commandId: "c1", method: "cash", items: [] }), ctx())).status).toBe(
      429,
    );
    expect(markPaid).not.toHaveBeenCalled();
  });
});
