import {
  announceSession,
  SessionAnnounceAuthorizationError,
  SessionAnnounceError,
  authorize,
} from "@plexco/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { csrfOk, currentSession, rateLimited } from "../../../../../lib/session-cookies";
import { POST } from "./route";

// The tenant language the stubbed db handles answer (switched per test for the vi / en copy).
const lang = vi.hoisted(() => ({ locale: "vi" }));

vi.mock("@plexco/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@plexco/db")>();
  return {
    ...actual,
    // `db.execute` answers tenantLocale (see publish/route.test.ts for why it must exist).
    createDb: vi.fn(() => ({
      pool: {},
      db: { execute: async () => ({ rows: [{ locale: lang.locale }] }) },
    })),
    announceSession: vi.fn(),
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
    appDb: vi.fn(() => ({
      pool: {},
      db: { execute: async () => ({ rows: [{ locale: lang.locale }] }) },
    })),
    currentSession: vi.fn(),
    csrfOk: vi.fn(),
    rateLimited: vi.fn(),
  };
});

process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";

const TENANT = "11111111-1111-4111-8111-111111111111";
const PERSON = "22222222-2222-4222-8222-222222222222";
const SESSION_ID = "33333333-3333-4333-8333-333333333333";
const DISABLED = "ANNOUNCE_DELIVERY_DISABLED";

/** POSTs commandId cmd_1 + `channel` (+ `extra` body keys) for SESSION_ID; returns the envelope. */
async function announce(channel: unknown = "zalo", extra: Record<string, unknown> = {}) {
  const url = `https://plexco.app/api/sessions/${SESSION_ID}/announce?tenant=${TENANT}`;
  const request = new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": "secret" },
    body: JSON.stringify({ commandId: "cmd_1", channel, ...extra }),
  });
  const response = await POST(request, { params: Promise.resolve({ id: SESSION_ID }) });
  const text = await response.text();
  const body = JSON.parse(text) as {
    data: Record<string, unknown> | null;
    error: { code: string; statusCode: number; message: string } | null;
  };
  return { status: response.status, text, ...body };
}
const refuse = () =>
  vi.mocked(announceSession).mockRejectedValue(new SessionAnnounceError(DISABLED, "internal"));

beforeEach(() => {
  vi.clearAllMocks();
  lang.locale = "vi";
  vi.mocked(currentSession).mockResolvedValue({
    sessionId: "s",
    accountId: "a",
    personId: PERSON,
    csrfSecret: "secret",
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  vi.mocked(csrfOk).mockReturnValue(true);
  vi.mocked(rateLimited).mockResolvedValue(false);
  vi.mocked(authorize).mockResolvedValue({ allowed: true, role: "owner" });
  // The command's own result only: no mock here claims or reports a delivery.
  const result = { sessionId: SESSION_ID, channel: "zalo" as const, replayed: false };
  vi.mocked(announceSession).mockResolvedValue(result);
});

describe("POST /api/sessions/:id/announce", () => {
  it("R-T1 a resolved command -> 200 with exactly {announced: true, channel} (no replayed key), bucket session-announce", async () => {
    for (const replayed of [false, true]) {
      const result = { sessionId: SESSION_ID, channel: "zalo" as const, replayed };
      vi.mocked(announceSession).mockResolvedValue(result);
      const { status, data, error } = await announce();
      expect([status, data, error]).toEqual([200, { announced: true, channel: "zalo" }, null]);
    }
    // A-D7: 10/min per tenant, the publish precedent.
    expect(rateLimited).toHaveBeenCalledWith(`session-announce:${TENANT}`, 10, 60);
  });

  it("R-T2 the requester is the cookie person only; a body naming another person is ignored", async () => {
    const other = "44444444-4444-4444-8444-444444444444";
    await announce("zalo", { requested_by_person_id: other, requestedByPersonId: other });
    expect(announceSession).toHaveBeenCalledTimes(1);
    expect(announceSession).toHaveBeenCalledWith(expect.anything(), {
      tenantId: TENANT,
      commandId: "cmd_1",
      requestedByPersonId: PERSON,
      input: { sessionId: SESSION_ID, channel: "zalo" },
    });
  });

  it.each([
    ["vi", "Chưa thể gửi thông báo: hệ thống gửi tin đang tắt."],
    ["en", "Announcements can't be delivered right now: message delivery is off."],
  ])(
    "R-T3 ANNOUNCE_DELIVERY_DISABLED -> 409, data null, no announced key (%s)",
    async (locale, message) => {
      lang.locale = locale;
      refuse();
      const { status, data, error, text } = await announce();
      expect([status, data, text.includes("announced")]).toEqual([409, null, false]);
      expect(error).toMatchObject({ code: DISABLED, statusCode: 409, message });
    },
  );

  it.each([
    ["INVALID_CHANNEL", 400, "messenger"],
    ["SESSION_ALREADY_ENDED", 409, "zalo"],
    ["SESSION_NOT_OPEN", 409, "zalo"],
    ["SESSION_NOT_FOUND", 404, "zalo"],
    ["COMMAND_ID_CONFLICT", 409, "zalo"],
    ["TENANT_SUSPENDED", 403, "zalo"],
  ] as const)("R-T4 %s -> %i", async (code, statusCode, channel) => {
    vi.mocked(announceSession).mockRejectedValue(
      code === "TENANT_SUSPENDED"
        ? new SessionAnnounceAuthorizationError()
        : new SessionAnnounceError(code, "x"),
    );
    const { status, data, error } = await announce(channel);
    expect([status, data]).toEqual([statusCode, null]);
    expect(error).toMatchObject({ code, statusCode });
    // The channel reaches the command unvalidated: the command owns the zalo-only rule (A-D4).
    expect(vi.mocked(announceSession).mock.calls[0]![1].input.channel).toBe(channel);
  });

  it("R-T5 a caller without session.manage -> FORBIDDEN 403; the command is never called", async () => {
    vi.mocked(authorize).mockResolvedValue({ allowed: false, reason: "not_a_member" });
    const { status, error } = await announce();
    expect([status, error?.code]).toEqual([403, "FORBIDDEN"]);
    expect(announceSession).not.toHaveBeenCalled();
  });

  it("R-T6 OUTBOX_DISPATCH_SCHEDULE_ENABLED=true in the web env changes nothing: a refusal is still 409", async () => {
    vi.stubEnv("OUTBOX_DISPATCH_SCHEDULE_ENABLED", "true");
    try {
      refuse();
      const { status, error } = await announce();
      expect([status, error?.code]).toEqual([409, DISABLED]);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
