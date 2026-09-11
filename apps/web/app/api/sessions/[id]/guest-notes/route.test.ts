import { createGuestNote, SessionGuestNoteError, tenantsForPerson } from "@plexco/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { csrfOk, currentSession, rateLimited } from "../../../../../lib/session-cookies";
import { POST } from "./route";

vi.mock("@plexco/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@plexco/db")>();
  return {
    ...actual,
    // `db` needs a working `execute`: the route resolves the tenant's language through the REAL
    // tenantLocale (packages/db/src/tenant.ts), which calls db.execute. Same stub as the close
    // route's test, and for the same reason.
    createDb: vi.fn(() => ({
      pool: {},
      db: { execute: async () => ({ rows: [{ locale: "vi" }] }) },
    })),
    createGuestNote: vi.fn(),
    tenantsForPerson: vi.fn(),
  };
});

vi.mock("../../../../../lib/session-cookies", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../../lib/session-cookies")>();
  return {
    ...actual,
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
const OTHER_TENANT = "22222222-2222-4222-8222-222222222222";
const SESSION_ID = "33333333-3333-4333-8333-333333333333";
const NOTE_ID = "44444444-4444-4444-8444-444444444444";
const PERSON_ID = "55555555-5555-4555-8555-555555555555";
const OTHER_PERSON_ID = "66666666-6666-4666-8666-666666666666";
const OTHER_SESSION_ID = "77777777-7777-4777-8777-777777777777";

function req(body: unknown, tenant = TENANT): Request {
  return new Request(`https://plexco.app/api/sessions/${SESSION_ID}/guest-notes?tenant=${tenant}`, {
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
  vi.clearAllMocks();
  vi.mocked(currentSession).mockResolvedValue({
    sessionId: "s",
    accountId: "a",
    personId: PERSON_ID,
    csrfSecret: "secret",
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  vi.mocked(csrfOk).mockReturnValue(true);
  vi.mocked(rateLimited).mockResolvedValue(false);
  vi.mocked(tenantsForPerson).mockResolvedValue([{ tenantId: TENANT, role: "owner" }]);
  vi.mocked(createGuestNote).mockResolvedValue({
    noteId: NOTE_ID,
    sessionId: SESSION_ID,
    remainingNotes: 2,
    replayed: false,
  });
});

describe("POST /api/sessions/:id/guest-notes", () => {
  it("creates and returns the pinned DTO, remainingNotes included (BE unit row #78)", async () => {
    const response = await POST(req({ commandId: "cmd_1", guestName: "Khách A" }), ctx());
    expect(response.status).toBe(200);
    const { data } = await envelope(response);
    expect(data).toEqual({
      guestNote: { id: NOTE_ID, sessionId: SESSION_ID, remainingNotes: 2 },
    });
  });

  // The DTO deliberately does NOT echo guestName/note. They are the caller's own payload and are
  // never stored in processed_commands.result_ref (DD-117 D5 keeps request content — here a
  // non-member's name — out of the idempotency ledger), so a REPLAY could not return them and the
  // two responses would differ. One shape for both paths. remainingNotes IS in both shapes: the
  // command stores it in the ledger precisely so the replay can answer with the original number.
  it("returns the same DTO for a replayed commandId", async () => {
    vi.mocked(createGuestNote).mockResolvedValue({
      noteId: NOTE_ID,
      sessionId: SESSION_ID,
      remainingNotes: 2,
      replayed: true,
    });
    const response = await POST(req({ commandId: "cmd_1", guestName: "Khách A" }), ctx());
    expect(response.status).toBe(200);
    const { data } = await envelope(response);
    expect(data).toEqual({
      guestNote: { id: NOTE_ID, sessionId: SESSION_ID, remainingNotes: 2 },
    });
  });

  // The route must not recompute or invent the number — a zero from the command is a real answer
  // (the author just spent their third note) and has to survive to the caller.
  it("passes remainingNotes through verbatim, including 0", async () => {
    vi.mocked(createGuestNote).mockResolvedValue({
      noteId: NOTE_ID,
      sessionId: SESSION_ID,
      remainingNotes: 0,
      replayed: false,
    });
    const { data } = await envelope(
      await POST(req({ commandId: "cmd_1", guestName: "Khách A" }), ctx()),
    );
    expect(data).toEqual({
      guestNote: { id: NOTE_ID, sessionId: SESSION_ID, remainingNotes: 0 },
    });
  });

  it("takes sessionId from the PATH, actor from the session cookie, tenant/commandId from context", async () => {
    await POST(req({ commandId: "cmd_1", guestName: "Khách A", note: "Bạn của Nam" }), ctx());
    expect(createGuestNote).toHaveBeenCalledWith(expect.anything(), {
      tenantId: TENANT,
      commandId: "cmd_1",
      actorPersonId: PERSON_ID,
      input: { sessionId: SESSION_ID, guestName: "Khách A", note: "Bạn của Nam" },
    });
  });

  // Dedup precedes validation inside the command (DD-117 D5), so the route forwards whatever the
  // client sent rather than pre-rejecting a retry of an already-committed create.
  it("forwards a mistyped guestName instead of pre-rejecting", async () => {
    const response = await POST(req({ commandId: "cmd_1", guestName: 42 }), ctx());
    expect(response.status).toBe(200);
    expect(createGuestNote).toHaveBeenCalledTimes(1);
    const [, params] = vi.mocked(createGuestNote).mock.calls[0]!;
    expect(params.input.guestName).toBe(42);
  });

  it("omits note when absent, and forwards an explicit null", async () => {
    await POST(req({ commandId: "cmd_1", guestName: "Khách A" }), ctx());
    expect(vi.mocked(createGuestNote).mock.calls[0]![1].input.note).toBeUndefined();
    await POST(req({ commandId: "cmd_2", guestName: "Khách A", note: null }), ctx());
    expect(vi.mocked(createGuestNote).mock.calls[1]![1].input.note).toBeNull();
  });

  it("denies a caller with no session-managing role and never reaches the command", async () => {
    vi.mocked(tenantsForPerson).mockResolvedValue([{ tenantId: TENANT, role: "member" }]);
    const response = await POST(req({ commandId: "cmd_1", guestName: "Khách A" }), ctx());
    expect(response.status).toBe(403);
    expect(createGuestNote).not.toHaveBeenCalled();
  });

  it("denies a caller who belongs to a DIFFERENT tenant with the same 403, never a 404", async () => {
    vi.mocked(tenantsForPerson).mockResolvedValue([{ tenantId: OTHER_TENANT, role: "owner" }]);
    const response = await POST(req({ commandId: "cmd_1", guestName: "Khách A" }), ctx());
    expect(response.status).toBe(403);
    const { error } = await envelope(response);
    expect(error).toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
    expect(createGuestNote).not.toHaveBeenCalled();
  });

  it("rejects a missing commandId before the command runs", async () => {
    const response = await POST(req({ guestName: "Khách A" }), ctx());
    expect(response.status).toBe(400);
    expect(createGuestNote).not.toHaveBeenCalled();
  });

  // One case per code createGuestNote can raise. Each asserts the SPEC-pinned literal and status
  // reach the client instead of being collapsed onto FORBIDDEN/NOT_FOUND or dressed up as a 500.
  // Statuses come verbatim from docs/features/BE/feature_session_management_tech.md §3.
  it.each([
    ["SESSION_NOT_FOUND", 404],
    ["SESSION_NOT_OPEN", 409],
    ["INVITE_NOT_ALLOWED", 403],
    ["PLAYER_NOT_ACTIVE", 403],
    ["GUEST_NOTE_LIMIT_REACHED", 400],
    ["SESSION_FULL", 409],
    ["COMMAND_ID_CONFLICT", 409],
  ] as const)("maps %s onto %i", async (code, status) => {
    vi.mocked(createGuestNote).mockRejectedValue(
      new SessionGuestNoteError(code, "internal detail"),
    );
    const response = await POST(req({ commandId: "cmd_1", guestName: "Khách A" }), ctx());
    expect(response.status).toBe(status);
    const { error } = await envelope(response);
    expect(error).toMatchObject({ code, statusCode: status });
    expect(error?.message).not.toMatch(/internal detail/);
  });

  it("collapses the narrow INVALID_INPUT variant onto the registered INVALID_BODY 400", async () => {
    vi.mocked(createGuestNote).mockRejectedValue(
      new SessionGuestNoteError("INVALID_INPUT", "guest_name must be 1..100 characters"),
    );
    const response = await POST(req({ commandId: "cmd_1", guestName: "" }), ctx());
    expect(response.status).toBe(400);
    const { error } = await envelope(response);
    expect(error).toMatchObject({ code: "INVALID_BODY", statusCode: 400 });
  });

  it("lets a non-domain fault surface as a fault, never as a client error", async () => {
    vi.mocked(createGuestNote).mockRejectedValue(new Error("connection terminated"));
    await expect(POST(req({ commandId: "cmd_1", guestName: "Khách A" }), ctx())).rejects.toThrow(
      "connection terminated",
    );
  });

  // BE spec §3 Rate Limits (feature_session_management_tech.md:600) pins create to 10/min PER
  // USER PER SESSION, not per tenant. Codex review finding: a fixed bucket literal here let the
  // choke-point's `${bucket}:${tenantId}` key collapse to one counter shared by every actor in the
  // tenant. These assert the actual string handed to the (mocked) rate limiter, not just behavior.
  describe("rate-limit bucket scoping (codex review finding)", () => {
    function createBucketKeys(): string[] {
      return vi
        .mocked(rateLimited)
        .mock.calls.map((call) => call[0])
        .filter((key) => key.startsWith("session-guest-note-create:"));
    }

    it("never uses the bare un-scoped literal as the bucket", async () => {
      await POST(req({ commandId: "cmd_1", guestName: "Khách A" }), ctx());
      const keys = createBucketKeys();
      expect(keys).toHaveLength(1);
      expect(keys[0]).not.toBe("session-guest-note-create");
    });

    it("gives two different actors on the SAME session two different buckets", async () => {
      await POST(req({ commandId: "cmd_1", guestName: "Khách A" }), ctx());
      vi.mocked(currentSession).mockResolvedValue({
        sessionId: "s2",
        accountId: "b",
        personId: OTHER_PERSON_ID,
        csrfSecret: "secret",
        expiresAt: new Date(Date.now() + 3_600_000),
      });
      await POST(req({ commandId: "cmd_2", guestName: "Khách B" }), ctx());

      const [keyA, keyB] = createBucketKeys();
      expect(keyA).toContain(PERSON_ID);
      expect(keyB).toContain(OTHER_PERSON_ID);
      expect(keyA).not.toBe(keyB);
    });

    it("gives the SAME actor on two different sessions two different buckets", async () => {
      await POST(req({ commandId: "cmd_1", guestName: "Khách A" }), ctx(SESSION_ID));
      await POST(req({ commandId: "cmd_2", guestName: "Khách A" }), ctx(OTHER_SESSION_ID));

      const [keyA, keyB] = createBucketKeys();
      expect(keyA).toContain(SESSION_ID);
      expect(keyB).toContain(OTHER_SESSION_ID);
      expect(keyA).not.toBe(keyB);
    });
  });
});
