import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sessions } from "../schema.js";
import {
  createSession,
  SessionCommandError,
  type CreateSessionInputPayload,
} from "./session-service.js";
import { tenantRepo, withTenant } from "./tenant.js";
import { setupRlsTestContext, type RlsTestContext } from "./test-harness.js";

// Real-PG tests for CreateSession. Runs as the `app` role via the RLS harness, so
// grants, tenant_isolation and the outbox producer boundary CHECK are exercised
// against live Postgres (DATABASE_URL_TEST required).

let ctx: RlsTestContext;
let inactiveSportId: string;
let seq = 0;
const cmdId = () => `cmd-${seq++}`;
const t9 = new Date("2026-09-01T09:00:00Z");
const t11 = new Date("2026-09-01T11:00:00Z");

const input = (over: Partial<CreateSessionInputPayload> = {}): CreateSessionInputPayload => ({
  sportId: ctx.badmintonSportId,
  startsAt: t9,
  endsAt: t11,
  timezone: "Asia/Ho_Chi_Minh",
  priceAmount: 120000,
  ...over,
});

// createSession as tenant A with a fresh (or explicit) commandId.
const create = (over: Partial<CreateSessionInputPayload> = {}, commandId = cmdId()) =>
  createSession(ctx.appDb.db, { tenantId: ctx.tenantA, commandId, input: input(over) });
// createSession with a deliberately malformed payload (bypasses the TS types).
const createBad = (over: Record<string, unknown>) =>
  createSession(ctx.appDb.db, {
    tenantId: ctx.tenantA,
    commandId: cmdId(),
    input: { ...input(), ...over } as unknown as CreateSessionInputPayload,
  });

// owner (superuser) helpers for assertions — bypass RLS to see every tenant's rows.
const row = async (text: string, params: unknown[] = []) =>
  (await ctx.owner.query(text, params)).rows[0];
const rows = async (text: string, params: unknown[] = []) =>
  (await ctx.owner.query(text, params)).rows;
const counts = () =>
  row(`SELECT (SELECT count(*)::int FROM sessions) s,
              (SELECT count(*)::int FROM outbox_events) o,
              (SELECT count(*)::int FROM processed_commands) p`);

async function expectReject(run: () => Promise<unknown>, code: string): Promise<void> {
  const before = await counts();
  const err = await run().catch((e: unknown) => e);
  expect(err).toBeInstanceOf(SessionCommandError);
  expect((err as SessionCommandError).code).toBe(code);
  expect(await counts()).toEqual(before);
}

beforeAll(async () => {
  ctx = await setupRlsTestContext("plexco_session_service_v2_check");
  const r = await ctx.owner.query(
    `INSERT INTO sports (key, name, active) VALUES ('inactive-test-sport', 'Inactive', false) RETURNING id`,
  );
  inactiveSportId = (r.rows[0] as { id: string }).id;
}, 120_000);

afterAll(async () => {
  await ctx?.teardown();
});

describe("createSession", () => {
  it("A1: creates a FIELD-COMPLETE draft, one session.created outbox row and one processed_commands row", async () => {
    const commandId = cmdId();
    // Set every optional field so a dropped/misrouted/defaulted column (e.g. price -> 0) is caught.
    const in0 = input({
      area: "Quận 1",
      venueName: "Sân A",
      slotsMax: 6,
      joinPolicy: "approval",
      priceAmount: 90000,
    });
    const result = await createSession(ctx.appDb.db, {
      tenantId: ctx.tenantA,
      commandId,
      input: in0,
    });
    expect(result).toMatchObject({
      replayed: false,
      status: "draft",
      version: 1,
      visibility: "private",
    });

    const s = await row(
      `SELECT sport_id, starts_at, ends_at, timezone, area, venue_name, price_amount, slots_max,
              visibility, join_policy, status, version, tenant_id FROM sessions WHERE id = $1`,
      [result.sessionId],
    );
    expect(s).toMatchObject({
      sport_id: in0.sportId,
      timezone: in0.timezone,
      area: "Quận 1",
      venue_name: "Sân A",
      price_amount: 90000,
      slots_max: 6,
      visibility: "private",
      join_policy: "approval",
      status: "draft",
      version: 1,
      tenant_id: ctx.tenantA,
    });
    expect(new Date(s.starts_at).getTime()).toBe(in0.startsAt.getTime());
    expect(new Date(s.ends_at).getTime()).toBe(in0.endsAt.getTime());

    const ob = await rows(
      `SELECT aggregate_type, sequence, type, payload, claimed_at, acked_at
         FROM outbox_events WHERE aggregate_id = $1`,
      [result.sessionId],
    );
    expect(ob).toHaveLength(1);
    expect(ob[0]).toMatchObject({
      aggregate_type: "session",
      sequence: 1,
      type: "session.created",
      claimed_at: null,
      acked_at: null,
    });
    // exact toEqual = the payload is the whitelist and ONLY the whitelist (no PII/venue).
    expect(ob[0].payload).toEqual({
      session_id: result.sessionId,
      tenant_id: ctx.tenantA,
      visibility: "private",
    });

    const pc = await row(
      `SELECT count(*)::int c, max(command_type) t FROM processed_commands WHERE tenant_id = $1 AND command_id = $2`,
      [ctx.tenantA, commandId],
    );
    expect(pc).toMatchObject({ c: 1, t: "CreateSession" });
  });

  it("A2: a public create carries visibility=public in the outbox payload", async () => {
    const r = await create({ visibility: "public", area: "Quận 1", slotsMax: 8 });
    expect(r.visibility).toBe("public");
    const ob = await row(`SELECT payload FROM outbox_events WHERE aggregate_id = $1`, [
      r.sessionId,
    ]);
    expect(ob.payload.visibility).toBe("public");
  });

  it("Validation: every field is presence/type/domain-checked; each returns a typed error, zero mutation", async () => {
    const MDF = "MISSING_DISCOVERY_FIELDS";
    const pub = { visibility: "public", area: "Quận 1", slotsMax: 8 };
    const bad: Array<[Record<string, unknown>, string]> = [
      [{ sportId: undefined }, "SPORT_INACTIVE"],
      [{ sportId: "not-a-uuid" }, "SPORT_INACTIVE"],
      [{ sportId: inactiveSportId }, "SPORT_INACTIVE"],
      [{ startsAt: undefined }, "INVALID_TIME_RANGE"],
      [{ endsAt: new Date("invalid") }, "INVALID_TIME_RANGE"],
      [{ startsAt: new Date(-8.64e15) }, "INVALID_TIME_RANGE"], // pre-4713BC, unstorable
      [{ startsAt: t11, endsAt: t9 }, "INVALID_TIME_RANGE"],
      [{ timezone: undefined }, "INVALID_TIMEZONE"],
      [{ timezone: "Mars/Olympus" }, "INVALID_TIMEZONE"],
      [{ visibility: "secret" }, "INVALID_VISIBILITY"],
      [{ joinPolicy: "invite" }, "INVALID_JOIN_POLICY"],
      [{ priceAmount: -1 }, "INVALID_PRICE"],
      [{ priceAmount: 1.5 }, "INVALID_PRICE"],
      [{ priceAmount: 2_147_483_648 }, "INVALID_PRICE"],
      [{ slotsMax: 0 }, "INVALID_SLOTS"],
      [{ slotsMax: 2.5 }, "INVALID_SLOTS"],
      [{ area: 123 }, "INVALID_TEXT_FIELD"],
      [{ venueName: 123 }, "INVALID_TEXT_FIELD"],
      [{ area: "has\u0000nul" }, "INVALID_TEXT_FIELD"],
      [{ venueName: "\u0000" }, "INVALID_TEXT_FIELD"],
      [{ startsAt: t9, endsAt: t9 }, "INVALID_TIME_RANGE"],
      [{ ...pub, area: null }, MDF],
      [{ ...pub, slotsMax: null }, MDF],
      [{ ...pub, sportId: undefined }, MDF],
      [{ ...pub, startsAt: undefined }, MDF],
    ];
    for (const [over, code] of bad) {
      await expectReject(() => createBad(over), code);
    }
  });

  it("Null, array, or primitive input -> INVALID_INPUT (typed), zero mutation", async () => {
    for (const badInput of [null, [], 42]) {
      await expectReject(
        () =>
          createSession(ctx.appDb.db, {
            tenantId: ctx.tenantA,
            commandId: cmdId(),
            input: badInput as unknown as CreateSessionInputPayload,
          }),
        "INVALID_INPUT",
      );
    }
  });

  it("C1/OBS1: a replayed commandId returns the stored result and writes zero new rows", async () => {
    const commandId = cmdId();
    const first = await create({}, commandId);
    expect(first.replayed).toBe(false);
    const afterFirst = await counts();
    const replay = await create({}, commandId);
    expect(replay).toMatchObject({ replayed: true, sessionId: first.sessionId });
    expect(await counts()).toEqual(afterFirst);
    const ob = await row(`SELECT count(*)::int c FROM outbox_events WHERE aggregate_id = $1`, [
      first.sessionId,
    ]);
    expect(ob.c).toBe(1);
  });

  it("C2: concurrent duplicates (mixed-case tenant uuid) -> one wins, one dedups, no unique violation (sync-engine #2)", async () => {
    const commandId = cmdId();
    // Second call spells the SAME tenant uuid upper-case: without the ::uuid lock-key
    // canonicalization the two hash apart, both pass the read, and one hits a raw 23505.
    const up = { tenantId: ctx.tenantA.toUpperCase(), commandId, input: input() };
    const [a, b] = await Promise.all([create({}, commandId), createSession(ctx.appDb.db, up)]);
    expect(a.sessionId).toBe(b.sessionId);
    expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
    const r = await row(
      `SELECT (SELECT count(*)::int FROM sessions WHERE id = $1) s,
              (SELECT count(*)::int FROM outbox_events WHERE aggregate_id = $1) o,
              (SELECT count(*)::int FROM processed_commands WHERE tenant_id = $2 AND command_id = $3) p`,
      [a.sessionId, ctx.tenantA, commandId],
    );
    expect(r).toMatchObject({ s: 1, o: 1, p: 1 });
  });

  it("Concurrent foreign command (same id, different type) fails closed with COMMAND_ID_CONFLICT, not a raw 23505", async () => {
    // The v2 lock is command-type-INDEPENDENT: hold the SAME global lock under a foreign
    // command row, and createSession must serialize behind it, then dedup deterministically.
    const commandId = cmdId();
    const client = await ctx.appPool.connect();
    let pending: Promise<unknown> | undefined;
    try {
      await client.query("BEGIN");
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [ctx.tenantA]);
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtextextended('processed-command:' || $1 || ':' || $2, 0))`,
        [ctx.tenantA, commandId],
      );
      await client.query(
        `INSERT INTO processed_commands (tenant_id, command_id, command_type) VALUES ($1, $2, 'PublishSession')`,
        [ctx.tenantA, commandId],
      );
      pending = createSession(ctx.appDb.db, {
        tenantId: ctx.tenantA,
        commandId,
        input: input(),
      }).then(
        () => new Error("expected COMMAND_ID_CONFLICT"),
        (e: unknown) => e,
      );
      // Wait until a backend IN THIS DATABASE is demonstrably blocked on an advisory lock
      // before releasing — scoped to current_database() so a parallel test file's waiter
      // cannot produce a false positive, and so a regressed lock key (no wait) fails here.
      let blocked = false;
      for (let i = 0; i < 300 && !blocked; i += 1) {
        const w = await ctx.owner.query(
          `SELECT count(*)::int n FROM pg_stat_activity
             WHERE datname = current_database()
               AND wait_event_type = 'Lock' AND wait_event = 'advisory'`,
        );
        blocked = (w.rows[0] as { n: number }).n > 0;
        if (!blocked) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      await client.query("COMMIT"); // release the lock; the foreign row is now committed
      expect(blocked).toBe(true);
      const err = await pending;
      pending = undefined;
      expect(err).toBeInstanceOf(SessionCommandError);
      expect((err as SessionCommandError).code).toBe("COMMAND_ID_CONFLICT");
    } finally {
      // Release the advisory lock FIRST (rollback is a no-op after COMMIT) so a failure
      // before COMMIT cannot leave the pending createSession blocked here forever.
      await client.query("ROLLBACK").catch(() => undefined);
      if (pending) await pending.catch(() => undefined);
      client.release();
    }
  });

  it("Ledger: a foreign command_type, malformed or domain-invalid result fails closed", async () => {
    // Sequential path: processed_commands is keyed only by (tenant_id, command_id); a row
    // owned by another command, or a CreateSession row that is unusable OR type-valid but
    // domain-invalid (non-UUID id, unknown visibility, version 0), must not be replayed.
    const id = "00000000-0000-0000-0000-000000000000";
    const ok = { sessionId: id, visibility: "private", status: "draft", version: 1 };
    const cases: Array<[string, unknown]> = [
      ["PublishSession", { published: true }],
      ["CreateSession", null],
      ["CreateSession", { ...ok, sessionId: "not-a-uuid" }],
      ["CreateSession", { ...ok, visibility: "secret" }],
      ["CreateSession", { ...ok, version: 0 }],
    ];
    for (const [commandType, result] of cases) {
      const commandId = cmdId();
      await ctx.owner.query(
        `INSERT INTO processed_commands (tenant_id, command_id, command_type, result_ref) VALUES ($1, $2, $3, $4)`,
        [ctx.tenantA, commandId, commandType, result === null ? null : JSON.stringify(result)],
      );
      await expectReject(() => create({}, commandId), "COMMAND_ID_CONFLICT");
    }
  });

  it("Replay returns only the four declared fields, never extra stored keys", async () => {
    const commandId = cmdId();
    const sessionId = "11111111-1111-1111-1111-111111111111";
    const clean = { sessionId, visibility: "private", status: "draft", version: 1 };
    await ctx.owner.query(
      `INSERT INTO processed_commands (tenant_id, command_id, command_type, result_ref) VALUES ($1, $2, 'CreateSession', $3)`,
      [ctx.tenantA, commandId, JSON.stringify({ ...clean, secret: "leak" })],
    );
    const r = await create({}, commandId);
    expect(r).toEqual({ ...clean, replayed: true });
  });

  it("SEC1: a draft in tenant A is invisible to tenant B (RLS, no tenant predicate)", async () => {
    const created = await create();
    expect(
      await tenantRepo(ctx.appDb.db, ctx.tenantB).sessions.getById(created.sessionId),
    ).toBeNull();
    // Query by id ALONE under tenant B's GUC (no tenant_id filter): only the RLS read
    // policy can hide tenant A's row, so 0 rows proves isolation, not an explicit filter.
    const seenByB = await withTenant(ctx.appDb.db, ctx.tenantB, (tx) =>
      tx.select({ id: sessions.id }).from(sessions).where(eq(sessions.id, created.sessionId)),
    );
    expect(seenByB).toHaveLength(0);
  });

  it("SEC2: tenant comes from trusted context, never the payload", async () => {
    await expect(
      createSession(ctx.appDb.db, { tenantId: "not-a-uuid", commandId: cmdId(), input: input() }),
    ).rejects.toThrow(/UUID/);
    const created = await createSession(ctx.appDb.db, {
      tenantId: ctx.tenantA,
      commandId: cmdId(),
      input: { ...input(), tenant_id: ctx.tenantB } as unknown as CreateSessionInputPayload,
    });
    const r = await row(`SELECT tenant_id FROM sessions WHERE id = $1`, [created.sessionId]);
    expect(r.tenant_id).toBe(ctx.tenantA);
  });
});
