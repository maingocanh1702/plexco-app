import { deleteGuestNote, SessionGuestNoteError, tenantsForPerson } from "@plexco/db";
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
    deleteGuestNote: vi.fn(),
    tenantsForPerson: vi.fn(),
  };
});

vi.mock("../../../../../../lib/session-cookies", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../../../lib/session-cookies")>();
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
  return new Request(
    `https://plexco.app/api/sessions/${SESSION_ID}/guest-notes/${NOTE_ID}?tenant=${tenant}`,
    {
      method: "DELETE",
      headers: { "content-type": "application/json", "x-csrf-token": "secret" },
      body: JSON.stringify(body),
    },
  );
}
const ctx = (id = SESSION_ID, noteId = NOTE_ID) => ({ params: Promise.resolve({ id, noteId }) });

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
  vi.mocked(deleteGuestNote).mockResolvedValue({
    noteId: NOTE_ID,
    sessionId: SESSION_ID,
    replayed: false,
  });
});

describe("DELETE /api/sessions/:id/guest-notes/:noteId", () => {
  it("deletes and returns the pinned DTO", async () => {
    const response = await DELETE(req({ commandId: "cmd_1" }), ctx());
    expect(response.status).toBe(200);
    const { data } = await envelope(response);
    expect(data).toEqual({ guestNote: { id: NOTE_ID, sessionId: SESSION_ID, deleted: true } });
  });

  it("returns the same DTO for a replayed commandId", async () => {
    vi.mocked(deleteGuestNote).mockResolvedValue({
      noteId: NOTE_ID,
      sessionId: SESSION_ID,
      replayed: true,
    });
    const response = await DELETE(req({ commandId: "cmd_1" }), ctx());
    expect(response.status).toBe(200);
    const { data } = await envelope(response);
    expect(data).toEqual({ guestNote: { id: NOTE_ID, sessionId: SESSION_ID, deleted: true } });
  });

  it("takes BOTH ids from the PATH and the actor from the session cookie", async () => {
    await DELETE(req({ commandId: "cmd_1" }), ctx());
    expect(deleteGuestNote).toHaveBeenCalledWith(expect.anything(), {
      tenantId: TENANT,
      commandId: "cmd_1",
      actorPersonId: PERSON_ID,
      input: { sessionId: SESSION_ID, noteId: NOTE_ID },
    });
  });

  it("forwards a non-UUID noteId and lets the command fail it closed", async () => {
    vi.mocked(deleteGuestNote).mockRejectedValue(
      new SessionGuestNoteError("GUEST_NOTE_NOT_FOUND", "internal"),
    );
    const response = await DELETE(req({ commandId: "cmd_1" }), ctx(SESSION_ID, "not-a-uuid"));
    expect(response.status).toBe(404);
    const [, params] = vi.mocked(deleteGuestNote).mock.calls[0]!;
    expect(params.input.noteId).toBe("not-a-uuid");
  });

  it("denies a caller with no session-managing role and never reaches the command", async () => {
    vi.mocked(tenantsForPerson).mockResolvedValue([{ tenantId: TENANT, role: "member" }]);
    const response = await DELETE(req({ commandId: "cmd_1" }), ctx());
    expect(response.status).toBe(403);
    expect(deleteGuestNote).not.toHaveBeenCalled();
  });

  it("denies a caller from a DIFFERENT tenant with the same 403, never a 404", async () => {
    vi.mocked(tenantsForPerson).mockResolvedValue([{ tenantId: OTHER_TENANT, role: "owner" }]);
    const response = await DELETE(req({ commandId: "cmd_1" }), ctx());
    expect(response.status).toBe(403);
    const { error } = await envelope(response);
    expect(error).toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
    expect(deleteGuestNote).not.toHaveBeenCalled();
  });

  it("rejects a missing commandId before the command runs", async () => {
    const response = await DELETE(req({}), ctx());
    expect(response.status).toBe(400);
    expect(deleteGuestNote).not.toHaveBeenCalled();
  });

  // BE unit row #81 at the HTTP boundary: deleting someone else's note is a 403 NOT_NOTE_CREATOR,
  // which must stay distinguishable from the 404 a missing note gets — both are spec-pinned in §3.
  it.each([
    ["GUEST_NOTE_NOT_FOUND", 404],
    ["NOT_NOTE_CREATOR", 403],
    ["SESSION_NOT_FOUND", 404],
    ["COMMAND_ID_CONFLICT", 409],
  ] as const)("maps %s onto %i", async (code, status) => {
    vi.mocked(deleteGuestNote).mockRejectedValue(
      new SessionGuestNoteError(code, "internal detail"),
    );
    const response = await DELETE(req({ commandId: "cmd_1" }), ctx());
    expect(response.status).toBe(status);
    const { error } = await envelope(response);
    expect(error).toMatchObject({ code, statusCode: status });
    expect(error?.message).not.toMatch(/internal detail/);
  });

  it("lets a non-domain fault surface as a fault, never as a client error", async () => {
    vi.mocked(deleteGuestNote).mockRejectedValue(new Error("connection terminated"));
    await expect(DELETE(req({ commandId: "cmd_1" }), ctx())).rejects.toThrow(
      "connection terminated",
    );
  });

  // BE spec §3 Rate Limits (feature_session_management_tech.md:601) pins delete to 10/min PER
  // USER, not per tenant and NOT per session (contrast the create sibling, which is also
  // per-session). Codex review finding: a fixed bucket literal here let the choke-point's
  // `${bucket}:${tenantId}` key collapse to one counter shared by every actor in the tenant.
  describe("rate-limit bucket scoping (codex review finding)", () => {
    function deleteBucketKeys(): string[] {
      return vi
        .mocked(rateLimited)
        .mock.calls.map((call) => call[0])
        .filter((key) => key.startsWith("session-guest-note-delete:"));
    }

    it("never uses the bare un-scoped literal as the bucket", async () => {
      await DELETE(req({ commandId: "cmd_1" }), ctx());
      const keys = deleteBucketKeys();
      expect(keys).toHaveLength(1);
      expect(keys[0]).not.toBe("session-guest-note-delete");
    });

    it("gives two different actors two different buckets", async () => {
      await DELETE(req({ commandId: "cmd_1" }), ctx());
      vi.mocked(currentSession).mockResolvedValue({
        sessionId: "s2",
        accountId: "b",
        personId: OTHER_PERSON_ID,
        csrfSecret: "secret",
        expiresAt: new Date(Date.now() + 3_600_000),
      });
      await DELETE(req({ commandId: "cmd_2" }), ctx());

      const [keyA, keyB] = deleteBucketKeys();
      expect(keyA).toContain(PERSON_ID);
      expect(keyB).toContain(OTHER_PERSON_ID);
      expect(keyA).not.toBe(keyB);
    });

    // Contrast with create: the spec pins delete per-user ONLY, so the SAME actor deleting notes
    // on two different sessions must share ONE bucket, not get two.
    it("gives the SAME actor on two different sessions the SAME bucket", async () => {
      await DELETE(req({ commandId: "cmd_1" }), ctx(SESSION_ID));
      await DELETE(req({ commandId: "cmd_2" }), ctx(OTHER_SESSION_ID));

      const [keyA, keyB] = deleteBucketKeys();
      expect(keyA).toBe(keyB);
    });
  });
});
