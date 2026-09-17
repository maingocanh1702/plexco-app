import { randomUUID } from "node:crypto";
import { createWebSession, rateLimitCheck, revokeWebSession } from "@plexco/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  seedPersonAccount,
  setupRlsTestContext,
  type RlsTestContext,
} from "../../../packages/db/src/test-harness.js";
import { POST } from "../app/api/sessions/[id]/guest-notes/route";
import { DELETE } from "../app/api/sessions/[id]/guest-notes/[noteId]/route";
import { POST as createSession } from "../app/api/sessions/route";
import { PUT as updateSession } from "../app/api/sessions/[id]/route";
import { POST as publishSession } from "../app/api/sessions/[id]/publish/route";
import { POST as closeSession } from "../app/api/sessions/[id]/close/route";
import { POST as cancelSession } from "../app/api/sessions/[id]/cancel/route";
import { appDb, hashToken, resetDbRoleViolationForTests } from "./session-cookies";

const cookieJar = vi.hoisted(() => ({ token: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (cookieJar.token ? { value: cookieJar.token } : undefined),
  }),
}));

let ctx: RlsTestContext;
let runtime: ReturnType<typeof appDb> | undefined;
type Actor = { accountId: string; personId: string; token: string; csrf: string };
type Envelope = {
  data: {
    guestNote: { id: string; sessionId: string; remainingNotes?: number; deleted?: boolean };
  } | null;
  error: { code: string; message: string } | null;
};
const unpack = (response: Response): Promise<Envelope> => response.json();

beforeAll(async () => {
  ctx = await setupRlsTestContext(`plexco_guest_note_routes_${process.pid}`);
  const url = ctx.appPool.options.connectionString;
  if (typeof url !== "string") throw new Error("Missing isolated app connection string");
  vi.stubEnv("DATABASE_URL", url);
  vi.stubEnv("DB_EXPECTED_ROLE", "app");
  resetDbRoleViolationForTests();
  runtime = appDb();
  const { rows } = await runtime.pool.query(
    `SELECT current_user, session_user, rolsuper, rolbypassrls,
            nullif(current_setting('app.tenant_id', true), '') AS tenant
     FROM pg_roles WHERE rolname = current_user`,
  );
  expect(rows).toEqual([
    {
      current_user: "app",
      session_user: "app",
      rolsuper: false,
      rolbypassrls: false,
      tenant: null,
    },
  ]);
}, 120_000);

afterAll(async () => {
  try {
    await runtime?.close();
  } finally {
    resetDbRoleViolationForTests();
    try {
      await ctx?.teardown();
    } finally {
      vi.unstubAllEnvs();
    }
  }
}, 120_000);

async function seedSession(tenantId = ctx.tenantA): Promise<string> {
  const { rows } = await ctx.owner.query<{ id: string }>(
    `INSERT INTO sessions (tenant_id, sport_id, starts_at, ends_at, timezone, slots_max,
                           visibility, price_amount, status, allow_player_invite)
     VALUES ($1, $2, now() + interval '1 day', now() + interval '1 day 2 hours',
             'Asia/Ho_Chi_Minh', 20, 'private', 120000, 'open', true) RETURNING id`,
    [tenantId, ctx.badmintonSportId],
  );
  return rows[0]!.id;
}

async function seedActor(
  sessionId?: string,
  status: "active" | "left" | "waitlisted" = "active",
  tenantId = ctx.tenantA,
): Promise<Actor> {
  const actor = await seedPersonAccount(ctx.owner, randomUUID());
  const { rows } = await ctx.owner.query<{ id: string }>(
    `INSERT INTO memberships (tenant_id, person_id, status) VALUES ($1, $2, 'active') RETURNING id`,
    [tenantId, actor.personId],
  );
  if (sessionId) {
    await ctx.owner.query(
      `INSERT INTO players (tenant_id, session_id, membership_id, status, waitlist_position)
       VALUES ($1, $2, $3, $4, $5)`,
      [tenantId, sessionId, rows[0]!.id, status, status === "waitlisted" ? 1 : null],
    );
  }
  const token = randomUUID();
  const csrf = randomUUID();
  await createWebSession(runtime!.pool, {
    accountId: actor.accountId,
    tokenHash: hashToken(token),
    csrfSecret: csrf,
    ttlSeconds: 3600,
  });
  return { ...actor, token, csrf };
}

function request(actor: Actor, tenantId: string, body: Record<string, unknown>, method = "POST") {
  cookieJar.token = actor.token;
  return new Request(`https://plexco.app/api/sessions?tenant=${tenantId}`, {
    method,
    headers: { "content-type": "application/json", "x-csrf-token": actor.csrf },
    body: JSON.stringify({ commandId: randomUUID(), ...body }),
  });
}

const postNote = (
  actor: Actor,
  id: string,
  body: Record<string, unknown> = {},
  tenant = ctx.tenantA,
) =>
  POST(request(actor, tenant, { guestName: "Synthetic guest", ...body }), {
    params: Promise.resolve({ id }),
  });
const deleteNote = (
  actor: Actor,
  id: string,
  noteId: string,
  commandId = randomUUID(),
  tenant = ctx.tenantA,
) =>
  DELETE(request(actor, tenant, { commandId }, "DELETE"), {
    params: Promise.resolve({ id, noteId }),
  });

async function snapshot(sessionId: string) {
  const notes = await ctx.owner.query(
    `SELECT id, tenant_id, created_by_person_id, guest_name, note FROM session_guest_notes
     WHERE session_id = $1 ORDER BY id`,
    [sessionId],
  );
  const events = await ctx.owner.query(
    `SELECT type, payload FROM outbox_events WHERE aggregate_id = $1 ORDER BY sequence`,
    [sessionId],
  );
  const commands = await ctx.owner.query(
    `SELECT command_id, command_type, result_ref FROM processed_commands
     WHERE result_ref->>'sessionId' = $1 ORDER BY command_id`,
    [sessionId],
  );
  return { notes: notes.rows, events: events.rows, commands: commands.rows };
}

async function expectError(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  const result = await unpack(response);
  expect(result.data).toBeNull();
  expect(result.error?.code).toBe(code);
  return result.error!;
}

async function buckets(actor: Actor) {
  const { rows } = await ctx.owner.query<{ bucket: string }>(
    `SELECT bucket FROM rate_limit_hits WHERE bucket LIKE $1 OR bucket LIKE $2 ORDER BY bucket`,
    [`%${actor.personId}%`, `%${actor.accountId}%`],
  );
  return rows.map((row) => row.bucket);
}

async function removePlayer(actor: Actor, sessionId: string) {
  await ctx.owner.query(
    `DELETE FROM players WHERE session_id = $1 AND membership_id IN
     (SELECT id FROM memberships WHERE person_id = $2)`,
    [sessionId, actor.personId],
  );
}

async function blockedRequest(
  lockSql: string,
  values: string[],
  start: () => Promise<Response>,
  mutate: () => Promise<void>,
): Promise<Response> {
  let pending: Promise<Response> | undefined;
  let transaction = false;
  try {
    await ctx.owner.query("BEGIN");
    transaction = true;
    await ctx.owner.query(lockSql, values);
    const { rows: holder } = await ctx.owner.query<{ pid: number }>(
      "SELECT pg_backend_pid() AS pid",
    );
    const pid = holder[0]!.pid;
    pending = start();
    void pending.catch(() => {}); // Re-thrown below, after the lock is released.
    let blocked = false;
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const { rows } = await ctx.superuserDb.pool.query(
        `SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND usename = 'app'
         AND wait_event_type = 'Lock' AND $1 = ANY(pg_blocking_pids(pid))`,
        [pid],
      );
      if (rows.length > 0) {
        blocked = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
    expect(blocked, "the real app request must wait on this exact holder").toBe(true);
    await mutate();
    await ctx.owner.query("COMMIT");
    transaction = false;
    return await pending;
  } finally {
    try {
      if (transaction) await ctx.owner.query("ROLLBACK");
    } finally {
      await pending?.catch(() => {});
    }
  }
}

describe("guest-note HTTP routes through real app-role authentication and commands", () => {
  it("an ordinary player without a tenant-admin role creates through the real POST", async () => {
    const sessionId = await seedSession();
    const actor = await seedActor(sessionId);
    const commandId = randomUUID();
    const response = await postNote(
      actor,
      sessionId.toUpperCase(),
      {
        commandId,
        actorPersonId: randomUUID(),
        tenantId: ctx.tenantB,
        sessionId: randomUUID(),
      },
      ctx.tenantA.toUpperCase(),
    );
    expect(response.status).toBe(200);
    const result = await unpack(response);
    expect(result.error).toBeNull();
    const noteId = result.data!.guestNote.id;
    expect(result.data).toEqual({ guestNote: { id: noteId, sessionId, remainingNotes: 2 } });
    const state = await snapshot(sessionId);
    expect(state.notes).toHaveLength(1);
    expect(state.notes[0]).toMatchObject({ id: noteId, created_by_person_id: actor.personId });
    expect(state.events).toEqual([
      {
        type: "guest_note.created",
        payload: {
          session_id: sessionId,
          note_id: noteId,
          created_by_person_id: actor.personId,
          note_count: 1,
        },
      },
    ]);
    expect(state.commands).toEqual([
      {
        command_id: commandId,
        command_type: "CreateGuestNote",
        result_ref: {
          noteId,
          sessionId,
          actorPersonId: actor.personId,
          remainingNotes: 2,
        },
      },
    ]);
    expect(
      JSON.stringify({ result, events: state.events, commands: state.commands }),
    ).not.toContain("Synthetic guest");
    expect(await buckets(actor)).toContain(
      `session-guest-note-create:${actor.personId}:${sessionId}:${ctx.tenantA}`,
    );
    const { rows } = await runtime!.pool.query(
      "SELECT nullif(current_setting('app.tenant_id', true), '') AS tenant",
    );
    expect(rows).toEqual([{ tenant: null }]);
  });

  it.each(["left", "waitlisted"] as const)(
    "resolves a %s player's association but refuses a fresh create",
    async (status) => {
      const id = await seedSession();
      const actor = await seedActor(id, status);
      await expectError(await postNote(actor, id), 403, "PLAYER_NOT_ACTIVE");
      expect(await snapshot(id)).toEqual({ notes: [], events: [], commands: [] });
      expect(await buckets(actor)).toHaveLength(2);
    },
  );

  it.each([
    "membership only",
    "stranger",
    "other session",
    "foreign pairing",
    "unknown",
    "malformed",
  ])("denies %s without spending target quota or reading the body", async (kind) => {
    const id = await seedSession();
    const actor = await seedActor(
      kind === "foreign pairing" ? id : kind === "other session" ? await seedSession() : undefined,
    );
    if (kind === "stranger")
      await ctx.owner.query("DELETE FROM memberships WHERE person_id = $1", [actor.personId]);
    const path = kind === "unknown" ? randomUUID() : kind === "malformed" ? "bad-id" : id;
    const tenant = kind === "foreign pairing" ? ctx.tenantB : ctx.tenantA;
    for (const method of ["POST", "DELETE"]) {
      const req = request(actor, tenant, {}, method);
      const response =
        method === "POST"
          ? await POST(req, { params: Promise.resolve({ id: path }) })
          : await DELETE(req, { params: Promise.resolve({ id: path, noteId: randomUUID() }) });
      expect(await expectError(response, 403, "FORBIDDEN")).toMatchObject({
        message: "Bạn không có quyền với CLB này.",
      });
      expect(req.bodyUsed).toBe(false);
    }
    expect(await buckets(actor)).toEqual(Array(2).fill(`session-actor:${actor.accountId}`));
    expect(await snapshot(id)).toEqual({ notes: [], events: [], commands: [] });
  });

  it("allows a creator without a player row to delete in a closed session", async () => {
    const id = await seedSession();
    const actor = await seedActor(id);
    const created = await unpack(await postNote(actor, id));
    const noteId = created.data!.guestNote.id;
    await removePlayer(actor, id);
    await ctx.owner.query("DELETE FROM processed_commands WHERE result_ref->>'sessionId' = $1", [
      id,
    ]);
    await ctx.owner.query("UPDATE sessions SET status = 'closed' WHERE id = $1", [id]);
    const commandId = randomUUID();
    const response = await deleteNote(actor, id, noteId, commandId);
    expect(response.status).toBe(200);
    expect((await unpack(response)).data).toEqual({
      guestNote: { id: noteId, sessionId: id, deleted: true },
    });
    const state = await snapshot(id);
    expect(state.notes).toEqual([]);
    expect(state.events).toHaveLength(2);
    expect(state.events[1]).toEqual({
      type: "guest_note.deleted",
      payload: {
        session_id: id,
        note_id: noteId,
        deleted_by_person_id: actor.personId,
        occupancy_after: 0,
      },
    });
    expect(state.commands).toHaveLength(1);
    expect(state.commands).toContainEqual({
      command_id: commandId,
      command_type: "DeleteGuestNote",
      result_ref: {
        noteId,
        sessionId: id,
        actorPersonId: actor.personId,
      },
    });
  });

  it.each(["associated player", "admin"])(
    "does not let another %s delete the creator's note",
    async (kind) => {
      const id = await seedSession();
      const author = await seedActor(id);
      const noteId = (await unpack(await postNote(author, id))).data!.guestNote.id;
      const peer = await seedActor(kind === "admin" ? undefined : id);
      if (kind === "admin")
        await ctx.owner.query(
          "INSERT INTO tenant_admins(tenant_id, platform, platform_user_lookup_hash, role) VALUES ($1, 'web', $2, 'admin')",
          [ctx.tenantA, peer.personId],
        );
      const before = await snapshot(id);
      await expectError(await deleteNote(peer, id, noteId), 403, "NOT_NOTE_CREATOR");
      expect(await snapshot(id)).toEqual(before);
    },
  );

  it.each(["other session", "foreign tenant", "unknown note"])(
    "hides a note from %s even from an associated caller",
    async (kind) => {
      const id = await seedSession();
      const actor = await seedActor(id);
      const otherTenant = kind === "foreign tenant" ? ctx.tenantB : ctx.tenantA;
      const otherId = await seedSession(otherTenant);
      const victim = await seedActor(otherId, "active", otherTenant);
      const noteId = (await unpack(await postNote(victim, otherId, {}, otherTenant))).data!
        .guestNote.id;
      const before = await snapshot(otherId);
      await expectError(
        await deleteNote(actor, id, kind === "unknown note" ? randomUUID() : noteId),
        404,
        "GUEST_NOTE_NOT_FOUND",
      );
      expect(await snapshot(otherId)).toEqual(before);
      expect(await snapshot(id)).toEqual({ notes: [], events: [], commands: [] });
    },
  );

  it.each(["POST", "DELETE"])(
    "keeps %s replay actor-bound when a peer steals the key",
    async (method) => {
      const id = await seedSession();
      const author = await seedActor(id);
      const commandId = randomUUID();
      const created = await unpack(
        await postNote(author, id, method === "POST" ? { commandId } : {}),
      );
      const noteId = created.data!.guestNote.id;
      if (method === "DELETE")
        expect((await deleteNote(author, id, noteId, commandId)).status).toBe(200);
      const before = await snapshot(id);
      for (const associated of [false, true]) {
        const peer = await seedActor(associated ? id : undefined);
        const response =
          method === "POST"
            ? await postNote(peer, id, { commandId })
            : await deleteNote(peer, id, noteId, commandId);
        await expectError(
          response,
          associated ? 409 : 403,
          associated ? "COMMAND_ID_CONFLICT" : "FORBIDDEN",
        );
        if (!associated) expect(await buckets(peer)).toEqual([`session-actor:${peer.accountId}`]);
        expect(await snapshot(id)).toEqual(before);
      }
    },
  );

  it.each(["command type", "session", "delete note"])(
    "rejects replay with a mismatched %s after proving the caller's own association",
    async (kind) => {
      const id = await seedSession();
      const actor = await seedActor(id);
      const commandId = randomUUID();
      const noteId = (await unpack(await postNote(actor, id, { commandId }))).data!.guestNote.id;
      let response: Response;
      let otherId: string | undefined;
      if (kind === "delete note") {
        const deleteKey = randomUUID();
        expect((await deleteNote(actor, id, noteId, deleteKey)).status).toBe(200);
        response = await deleteNote(actor, id, randomUUID(), deleteKey);
      } else if (kind === "session") {
        otherId = await seedSession();
        await ctx.owner.query(
          `INSERT INTO players(tenant_id, session_id, membership_id, status)
         SELECT tenant_id, $1, id, 'active' FROM memberships WHERE person_id = $2`,
          [otherId, actor.personId],
        );
        response = await postNote(actor, otherId, { commandId });
      } else response = await deleteNote(actor, id, noteId, commandId);
      await expectError(response, 409, "COMMAND_ID_CONFLICT");
      const state = await snapshot(id);
      expect(state.commands).toHaveLength(kind === "delete note" ? 2 : 1);
      expect(state.events).toHaveLength(kind === "delete note" ? 2 : 1);
      if (otherId) expect(await snapshot(otherId)).toEqual({ notes: [], events: [], commands: [] });
    },
  );

  it.each(["other command", "other session"])(
    "does not accept retained receipts for %s as routing authority",
    async (kind) => {
      const id = await seedSession();
      const actor = await seedActor();
      const commandId = randomUUID();
      await ctx.owner.query(
        "INSERT INTO processed_commands(tenant_id, command_id, command_type, result_ref) VALUES ($1, $2, $3, $4)",
        [
          ctx.tenantA,
          commandId,
          kind === "other command" ? "CreateSession" : "CreateGuestNote",
          {
            sessionId: kind === "other session" ? await seedSession() : id,
            actorPersonId: actor.personId,
            noteId: randomUUID(),
            remainingNotes: 2,
          },
        ],
      );
      const before = await snapshot(id);
      await expectError(await postNote(actor, id, { commandId }), 403, "FORBIDDEN");
      await expectError(await deleteNote(actor, id, randomUUID(), commandId), 403, "FORBIDDEN");
      expect(await snapshot(id)).toEqual(before);
      expect(await buckets(actor)).toEqual(Array(2).fill(`session-actor:${actor.accountId}`));
    },
  );

  it("rechecks active-player permission after waiting for the session lock", async () => {
    const id = await seedSession();
    const actor = await seedActor(id);
    const response = await blockedRequest(
      "SELECT id FROM sessions WHERE id = $1 FOR UPDATE",
      [id],
      () => postNote(actor, id),
      async () => {
        await ctx.owner.query("UPDATE players SET status = 'left' WHERE session_id = $1", [id]);
      },
    );
    await expectError(response, 403, "PLAYER_NOT_ACTIVE");
    expect(await snapshot(id)).toEqual({ notes: [], events: [], commands: [] });
  }, 15_000);

  it.each(["POST", "DELETE"])(
    "replays %s while association rows disappear, then through ledger-only context",
    async (method) => {
      const id = await seedSession();
      const actor = await seedActor(id);
      const commandId = randomUUID();
      const created = await unpack(
        await postNote(actor, id, method === "POST" ? { commandId } : {}),
      );
      const noteId = created.data!.guestNote.id;
      const original =
        method === "POST" ? created : await unpack(await deleteNote(actor, id, noteId, commandId));
      if (method === "DELETE") {
        await ctx.owner.query(
          "DELETE FROM processed_commands WHERE result_ref->>'sessionId' = $1 AND command_type = 'CreateGuestNote'",
          [id],
        );
      }
      const before = await snapshot(id);
      const retry = () =>
        method === "POST"
          ? postNote(actor, id, { commandId, guestName: null })
          : deleteNote(actor, id, noteId, commandId);
      const response = await blockedRequest(
        "SELECT pg_advisory_xact_lock(hashtextextended('processed-command:' || $1::uuid::text || ':' || $2, 0))",
        [ctx.tenantA, commandId],
        retry,
        async () => {
          await ctx.owner.query("DELETE FROM session_guest_notes WHERE session_id = $1", [id]);
          await removePlayer(actor, id);
        },
      );
      expect(response.status).toBe(200);
      expect(await unpack(response)).toMatchObject({ data: original.data, error: null });
      const afterRemoval = await retry();
      expect(afterRemoval.status).toBe(200);
      expect(await unpack(afterRemoval)).toMatchObject({ data: original.data, error: null });
      expect(await snapshot(id)).toEqual({ ...before, notes: [] });
    },
    15_000,
  );

  it.each([
    ["create", createSession],
    ["update", updateSession],
    ["publish", publishSession],
    ["close", closeSession],
    ["cancel", cancelSession],
  ] as const)("keeps the %s host command closed to a guest-note player", async (_, handler) => {
    const id = await seedSession();
    const actor = await seedActor(id);
    const req = request(actor, ctx.tenantA, {
      guestNoteSessionId: id,
      actorPersonId: actor.personId,
      tenantId: ctx.tenantA,
    });
    await expectError(await handler(req, { params: Promise.resolve({ id }) }), 403, "FORBIDDEN");
    expect(req.bodyUsed).toBe(false);
    expect(await buckets(actor)).toEqual([`session-actor:${actor.accountId}`]);
    expect(await snapshot(id)).toEqual({ notes: [], events: [], commands: [] });
    expect(
      (await ctx.owner.query("SELECT status, version FROM sessions WHERE id = $1", [id])).rows,
    ).toEqual([{ status: "open", version: 1 }]);
  });

  it.each(["missing", "revoked", "expired", "csrf"])(
    "refuses a %s real session before rate or association work",
    async (kind) => {
      const id = await seedSession();
      const actor = await seedActor(id);
      if (kind === "revoked") await revokeWebSession(runtime!.pool, hashToken(actor.token));
      if (kind === "expired")
        await ctx.owner.query(
          "UPDATE web_sessions SET expires_at = now() - interval '1 hour' WHERE token_hash = $1",
          [hashToken(actor.token)],
        );
      for (const method of ["POST", "DELETE"]) {
        const req = request(actor, ctx.tenantA, {}, method);
        if (kind === "missing") cookieJar.token = undefined;
        if (kind === "csrf") req.headers.set("x-csrf-token", "wrong");
        const response =
          method === "POST"
            ? await POST(req, { params: Promise.resolve({ id }) })
            : await DELETE(req, { params: Promise.resolve({ id, noteId: randomUUID() }) });
        await expectError(
          response,
          kind === "csrf" ? 403 : 401,
          kind === "csrf" ? "CSRF_INVALID" : "AUTH_REQUIRED",
        );
        expect(req.bodyUsed).toBe(false);
      }
      expect(await buckets(actor)).toEqual([]);
      expect(await snapshot(id)).toEqual({ notes: [], events: [], commands: [] });
    },
  );

  it.each(["actor", "create", "delete-global"])(
    "enforces the real %s quota at its existing scope",
    async (kind) => {
      const id = await seedSession(ctx.tenantB);
      const actor = await seedActor(id, "active", ctx.tenantB);
      await ctx.owner.query("UPDATE tenants SET locale = 'en' WHERE id = $1", [ctx.tenantB]);
      const bucket =
        kind === "actor"
          ? `session-actor:${actor.accountId}`
          : kind === "create"
            ? `session-guest-note-create:${actor.personId}:${id}:${ctx.tenantB}`
            : `session-guest-note-delete-global:${actor.personId}`;
      const limit = kind === "actor" ? 60 : 10;
      for (let i = 0; i < limit - (kind === "delete-global" ? 1 : 0); i++) {
        expect(await rateLimitCheck(runtime!.pool, bucket, limit, 60)).toBe(true);
      }
      if (kind === "delete-global") {
        const otherId = await seedSession();
        await ctx.owner.query(
          `WITH m AS (INSERT INTO memberships(tenant_id, person_id) VALUES ($1, $2) RETURNING id)
         INSERT INTO players(tenant_id, session_id, membership_id, status) SELECT $1, $3, id, 'active' FROM m`,
          [ctx.tenantA, actor.personId, otherId],
        );
        await expectError(
          await deleteNote(actor, otherId, randomUUID()),
          404,
          "GUEST_NOTE_NOT_FOUND",
        );
      }
      const response =
        kind === "delete-global"
          ? await deleteNote(actor, id, randomUUID(), randomUUID(), ctx.tenantB)
          : await postNote(actor, id.toUpperCase(), {}, ctx.tenantB.toUpperCase());
      expect(await expectError(response, 429, "RATE_LIMITED")).toMatchObject({
        message: kind === "actor" ? "Quá nhiều yêu cầu — đợi." : "Too many requests — wait.",
      });
      if (kind === "actor") expect(await buckets(actor)).toEqual(Array(60).fill(bucket));
      expect(await snapshot(id)).toEqual({ notes: [], events: [], commands: [] });
    },
  );

  it("uses the trusted tenant's English for body and domain errors", async () => {
    const id = await seedSession(ctx.tenantB);
    const actor = await seedActor(id, "left", ctx.tenantB);
    await ctx.owner.query("UPDATE tenants SET locale = 'en' WHERE id = $1", [ctx.tenantB]);
    const req = request(actor, ctx.tenantB, { commandId: null });
    expect(
      await expectError(await POST(req, { params: Promise.resolve({ id }) }), 400, "INVALID_BODY"),
    ).toMatchObject({ message: "Missing commandId." });
    expect(
      await expectError(await postNote(actor, id, {}, ctx.tenantB), 403, "PLAYER_NOT_ACTIVE"),
    ).toMatchObject({ message: "You are not an active player in this session." });
    expect(await snapshot(id)).toEqual({ notes: [], events: [], commands: [] });
  });
});
