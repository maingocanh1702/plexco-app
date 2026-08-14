import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sessions } from "../schema.js";
import {
  createSession,
  publishSession,
  SessionCommandError,
  SessionPublishAuthorizationError,
  SessionPublishError,
  type CreateSessionInputPayload,
  type PublishSessionInputPayload,
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

// Real-PG tests for PublishSession (draft -> open). Each test seeds a DEDICATED
// tenant so global row counts never cross-contaminate; assertions are scoped by
// session_id / aggregate_id. Publish is the FIRST production caller of
// authorizeTenantAction and the real billing-visibility boundary (DD-105), so the
// tenant MUST carry an active subscription for a publish to be allowed — a bare
// tenant (no subscription row) fails closed (case 4), which the AUTHZ tests exploit.
describe("publishSession", () => {
  const future = () => new Date(Date.now() + 24 * 3600 * 1000);
  const past = () => new Date(Date.now() - 24 * 3600 * 1000);

  // A dedicated tenant + subscription, seeded via the owner connection (bypasses
  // RLS for setup only), mirroring authorization.test.ts's seedTenant.
  async function seedTenant(tenantStatus: string, subStatus: string | "missing"): Promise<string> {
    const unique = randomUUID();
    const t = await ctx.owner.query(
      `INSERT INTO tenants (name, slug, status) VALUES ($1, $2, $3) RETURNING id`,
      [`Publish Test ${unique}`, `publish-test-${unique}`, tenantStatus],
    );
    const tenantId = (t.rows[0] as { id: string }).id;
    if (subStatus !== "missing") {
      await ctx.owner.query(
        `INSERT INTO subscriptions (tenant_id, plan_key, plan_version, status, period_start, period_end)
         VALUES ($1, 'free', 1, $2, now(), now() + interval '30 days')`,
        [tenantId, subStatus],
      );
    }
    return tenantId;
  }

  // Seed a tenant whose subscription is ELIGIBLE for the Daily Lifecycle Job's
  // past_due -> suspended step (billing #36/#36a): a PAID plan (host_pro, price
  // 250000 > 0), status='past_due', grace_end already elapsed. `past_due` is itself
  // an ALLOWED publish state (only 'suspended' blocks — active/past_due/trialing OK),
  // so publish proceeds until the job's claim suspends the row mid-race. Owner conn.
  async function seedEligibleTenant(): Promise<string> {
    const unique = randomUUID();
    const t = await ctx.owner.query(
      `INSERT INTO tenants (name, slug, status) VALUES ($1, $2, 'active') RETURNING id`,
      [`Publish Elig ${unique}`, `publish-elig-${unique}`],
    );
    const tenantId = (t.rows[0] as { id: string }).id;
    await ctx.owner.query(
      `INSERT INTO subscriptions
         (tenant_id, plan_key, plan_version, status, period_start, period_end, grace_end)
       VALUES ($1, 'host_pro', 1, 'past_due',
               now() - interval '40 days', now() - interval '10 days', now() - interval '1 day')`,
      [tenantId],
    );
    return tenantId;
  }

  // The Daily Lifecycle Job's EXACT eligible-row claim (billing #36/#36a): a paid
  // plan (plans.price > 0) JOINed, status='past_due', grace elapsed, claimed
  // `FOR UPDATE OF s SKIP LOCKED` (the job's own claim shape). Locks only the
  // subscription row. Run on a privileged connection — the job is not the app role.
  const jobClaimSql = `SELECT s.tenant_id FROM subscriptions s
       JOIN plans p ON p.plan_key = s.plan_key AND p.version = s.plan_version
      WHERE p.price > 0 AND s.status = 'past_due' AND s.grace_end <= now() AND s.tenant_id = $1
      FOR UPDATE OF s SKIP LOCKED`;

  // Insert a draft session directly via the owner connection with an explicit
  // starts_at/visibility/area/slots_max — avoids depending on createSession's own
  // validation here (publish is the unit under test). Injects tenant_id explicitly.
  async function seedDraft(
    tenantId: string,
    over: {
      status?: string;
      startsAt?: Date;
      visibility?: "private" | "public";
      area?: string | null;
      slotsMax?: number | null;
    } = {},
  ): Promise<{ sessionId: string; version: number }> {
    const s = await ctx.owner.query(
      `INSERT INTO sessions (tenant_id, sport_id, starts_at, ends_at, timezone, area, slots_max, visibility, status)
       VALUES ($1, $2, $3, $4, 'Asia/Ho_Chi_Minh', $5, $6, $7, $8)
       RETURNING id, version`,
      [
        tenantId,
        ctx.badmintonSportId,
        over.startsAt ?? future(),
        new Date((over.startsAt ?? future()).getTime() + 2 * 3600 * 1000),
        over.area === undefined ? "Quận 1" : over.area,
        over.slotsMax === undefined ? 8 : over.slotsMax,
        over.visibility ?? "private",
        over.status ?? "draft",
      ],
    );
    const r = s.rows[0] as { id: string; version: number };
    return { sessionId: r.id, version: r.version };
  }

  const publish = (tenantId: string, input: PublishSessionInputPayload, commandId = cmdId()) =>
    publishSession(ctx.appDb.db, { tenantId, commandId, input });

  const outboxFor = (sessionId: string) =>
    rows(
      `SELECT aggregate_type, sequence, type, payload, claimed_at, acked_at
         FROM outbox_events WHERE aggregate_id = $1 ORDER BY sequence`,
      [sessionId],
    );
  const sessionRow = (sessionId: string) =>
    row(`SELECT status, version, visibility FROM sessions WHERE id = $1`, [sessionId]);
  const pcCount = (tenantId: string, commandId: string) =>
    row(
      `SELECT count(*)::int c, max(command_type) t FROM processed_commands WHERE tenant_id = $1 AND command_id = $2`,
      [tenantId, commandId],
    );

  // expect a rejection scoped to one session: the session/outbox/pc for THAT id is
  // untouched. (global counts() is unsafe here — sibling tests share the db.)
  async function expectPublishReject(
    run: () => Promise<unknown>,
    code: string,
    sessionId: string,
  ): Promise<void> {
    const before = await sessionRow(sessionId);
    const err = await run().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SessionPublishError);
    expect((err as SessionPublishError).code).toBe(code);
    expect(await sessionRow(sessionId)).toEqual(before);
    expect(await outboxFor(sessionId)).toHaveLength(0);
  }

  // Deterministic barrier (mirrors authorization.test.ts): find whichever backend
  // is blocked specifically by `holderPid`. publishSession opens its own tx, so the
  // test has no direct handle on which pool connection drizzle uses.
  async function waitUntilSomeoneBlockedByHolder(holderPid: number): Promise<void> {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const { rows } = await ctx.owner.query(
        `SELECT pid FROM pg_stat_activity
           WHERE wait_event_type = 'Lock' AND $1 = ANY(pg_blocking_pids(pid))`,
        [holderPid],
      );
      if (rows.length > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
    throw new Error(`no backend became blocked by holder ${holderPid} within 5s`);
  }

  it("A1: publishes a private draft — status open, version bumped, one session.published outbox, one processed_commands row", async () => {
    const tenantId = await seedTenant("active", "active");
    const { sessionId, version } = await seedDraft(tenantId);
    const commandId = cmdId();
    const result = await publish(tenantId, { sessionId }, commandId);

    expect(result).toMatchObject({
      replayed: false,
      status: "open",
      visibility: "private",
      sessionId,
    });
    expect(result.version).toBe(version + 1);

    const s = await sessionRow(sessionId);
    expect(s).toMatchObject({ status: "open", visibility: "private", version: version + 1 });

    const ob = await outboxFor(sessionId);
    expect(ob).toHaveLength(1);
    expect(ob[0]).toMatchObject({
      aggregate_type: "session",
      sequence: 1,
      type: "session.published",
      claimed_at: null,
      acked_at: null,
    });
    // exact toEqual = payload is the whitelist and ONLY the whitelist (no roster/PII/venue).
    expect(ob[0].payload).toEqual({
      session_id: sessionId,
      tenant_id: tenantId,
      visibility: "private",
    });

    const pc = await pcCount(tenantId, commandId);
    expect(pc).toMatchObject({ c: 1, t: "PublishSession" });
  });

  it("A2: publishes a public draft (discovery complete) — outbox payload carries visibility=public", async () => {
    const tenantId = await seedTenant("active", "active");
    const { sessionId } = await seedDraft(tenantId, {
      visibility: "public",
      area: "Quận 3",
      slotsMax: 10,
    });
    const r = await publish(tenantId, { sessionId });
    expect(r.visibility).toBe("public");
    const ob = await outboxFor(sessionId);
    expect(ob[0].payload.visibility).toBe("public");
  });

  it("SEQ1: createSession -> publishSession on the SAME aggregate writes session.created (sequence 1) then session.published (sequence 2), in that order", async () => {
    // Every OTHER publish test seeds its draft directly via seedDraft(), which
    // proves publishSession's own behavior but never proves the create->publish
    // PAIR the contract claims (session.created seq 1, session.published seq 2 on
    // one aggregate). Drive the REAL createSession here, then the real publish.
    //
    // codex round-03 [P1]: the module-level input() fixture's startsAt is a FIXED
    // calendar date (t9, shared with every createSession-only test above, none of
    // which ever call publish). This test does call publish, which rejects a
    // past-start draft -- so unlike its siblings, it would start failing the
    // moment "today" passes that fixed date. Use future(), relative to the real
    // clock at run time, instead of the shared fixture's startsAt/endsAt.
    const tenantId = await seedTenant("active", "active");
    const seqStart = future();
    const created = await createSession(ctx.appDb.db, {
      tenantId,
      commandId: cmdId(),
      input: input({ startsAt: seqStart, endsAt: new Date(seqStart.getTime() + 2 * 3600 * 1000) }),
    });
    expect(created).toMatchObject({ replayed: false, status: "draft" });

    const published = await publish(tenantId, { sessionId: created.sessionId });
    expect(published).toMatchObject({ replayed: false, status: "open" });

    const ob = await outboxFor(created.sessionId);
    expect(ob).toHaveLength(2);
    expect(ob.map((e) => ({ type: e.type, sequence: e.sequence }))).toEqual([
      { type: "session.created", sequence: 1 },
      { type: "session.published", sequence: 2 },
    ]);
  });

  it("B1: publishing (a new commandId) against an already-open session is an idempotent no-op — no status/version change, no duplicate event, but its own processed_commands row", async () => {
    const tenantId = await seedTenant("active", "active");
    const { sessionId } = await seedDraft(tenantId);
    const first = await publish(tenantId, { sessionId });
    const afterFirst = await sessionRow(sessionId);
    // a DIFFERENT commandId on the now-open session -> no-op success, no duplicate event
    const noopCommandId = cmdId();
    const noop = await publish(tenantId, { sessionId }, noopCommandId);
    expect(noop).toMatchObject({ replayed: false, status: "open", version: first.version });
    expect(await sessionRow(sessionId)).toEqual(afterFirst);
    expect(await outboxFor(sessionId)).toHaveLength(1); // still just the publish event
    // the no-op DID record its own dedup row (so a later replay of THIS id short-circuits)
    const pc = await pcCount(tenantId, noopCommandId);
    expect(pc).toMatchObject({ c: 1, t: "PublishSession" });
  });

  it("B2: publishing a closed or cancelled session -> SESSION_NOT_OPEN, zero mutation", async () => {
    const tenantId = await seedTenant("active", "active");
    for (const status of ["closed", "cancelled"]) {
      const { sessionId } = await seedDraft(tenantId, { status });
      await expectPublishReject(
        () => publish(tenantId, { sessionId }),
        "SESSION_NOT_OPEN",
        sessionId,
      );
    }
  });

  it("B3: publishing a past-start draft -> SESSION_NOT_OPEN, zero mutation", async () => {
    const tenantId = await seedTenant("active", "active");
    const { sessionId } = await seedDraft(tenantId, { startsAt: past() });
    await expectPublishReject(
      () => publish(tenantId, { sessionId }),
      "SESSION_NOT_OPEN",
      sessionId,
    );
  });

  it("REG-CLOCK1: the past-start cutoff reads the DATABASE clock, not the application clock — a skewed Date.now() must not affect the decision", async () => {
    // Regression for the app-clock/DB-clock split (HALT-MAX_ROUNDS.txt finding #1):
    // an earlier implementation compared starts_at against Date.now(). Seed the
    // draft BEFORE stubbing Date.now() so starts_at is a real near-future instant
    // per the actual DB clock, then skew the APPLICATION clock far into the future.
    // A guard reading Date.now() would see startsAt (near future) <= Date.now()
    // (year 2099) and wrongly reject an otherwise-publishable session; the fixed
    // guard reads starts_at <= clock_timestamp() via a Postgres query, so it is
    // unaffected by the stub and still sees the session as not-yet-started.
    const tenantId = await seedTenant("active", "active");
    const { sessionId } = await seedDraft(tenantId, { startsAt: future() });
    const skewed = vi
      .spyOn(Date, "now")
      .mockReturnValue(new Date("2099-01-01T00:00:00Z").getTime());
    try {
      const result = await publish(tenantId, { sessionId });
      expect(result).toMatchObject({ status: "open" });
    } finally {
      skewed.mockRestore();
    }
  });

  it("REG-CLOCK2: a lock wait spanning starts_at uses the time AFTER the wait -- proves the SEPARATE post-lock clock_timestamp() query, not just the swap from now()", async () => {
    // codex round-02 [P1]: now()/transaction_timestamp() is FIXED at transaction
    // start, so a lock wait spanning starts_at breaks a same-statement now() check.
    // The first fix attempt swapped to clock_timestamp() in the SAME locked SELECT
    // -- this test caught that this is ALSO wrong: measured directly against real
    // Postgres, clock_timestamp() sitting in the same statement as the LockRows
    // node returns the PRE-wait time too, not the moment the row is produced after
    // the wait. Only a genuinely separate, subsequent statement (issued after the
    // FOR UPDATE above has already resolved) measures the real post-wait instant --
    // which is what the implementation now does. Engineer the race: hold the
    // session row's FOR UPDATE lock on a separate connection, start the REAL
    // publish (it blocks behind the holder), let starts_at pass in real wall-clock
    // time WHILE it is still blocked, then release -- the post-lock query must
    // observe the post-wait time and correctly reject the now-past-start draft.
    // v3 finding 2: establish starts_at ONLY AFTER publish is confirmed blocked,
    // not as a pre-seed. The v2 design pre-seeded starts_at = dbNow + 400ms before
    // connect/BEGIN/lock/publish-start/block-detection ran, then asserted "still
    // future" AFTER all that overhead -- so on a slow runner the 400ms could be
    // consumed by setup and the precondition would flake on CORRECT code (round-05's
    // poll only hardened the LATER wait, not this earlier window). Below, the holder
    // already owns the row lock when publish blocks, so it sets starts_at in one
    // statement relative to the DB clock at that moment: future BY CONSTRUCTION, with
    // no earlier window for overhead to eat.
    const tenantId = await seedTenant("active", "active");
    // Placeholder starts_at only; the operative value is set below, after the block.
    const { sessionId } = await seedDraft(tenantId, {
      startsAt: new Date(Date.now() + 3600 * 1000),
    });
    const holder = await ctx.appPool.connect();
    let pending: Promise<unknown> | undefined;
    try {
      await holder.query("BEGIN");
      await holder.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      await holder.query(`SELECT id FROM sessions WHERE id = $1 FOR UPDATE`, [sessionId]);
      const holderPid = (
        (await holder.query(`SELECT pg_backend_pid() AS pid`)).rows[0] as { pid: number }
      ).pid;

      // start the real publish; its own session FOR UPDATE blocks behind the holder
      pending = publish(tenantId, { sessionId }).then(
        (r) => r,
        (e: unknown) => e,
      );
      await waitUntilSomeoneBlockedByHolder(holderPid);

      // Publish is now blocked on THIS row's FOR UPDATE (held by the holder); its
      // transaction has started but has NOT yet read starts_at (the past-start query
      // runs only after it acquires the lock). The holder owns the row, so it sets
      // starts_at now, in ONE statement, to a DB-clock-relative near-future value --
      // future BY CONSTRUCTION, no dependence on prior setup overhead (v3 finding 2).
      // It is also future relative to publish's own transaction start (which began
      // before this UPDATE), so a same-statement/frozen clock would see not-past and
      // wrongly publish; only the correct post-lock clock_timestamp() query sees the
      // post-wait time and rejects. RETURNING evaluates against the just-updated row.
      const establish = await holder.query(
        `UPDATE sessions SET starts_at = clock_timestamp() + interval '500 milliseconds'
           WHERE id = $1 RETURNING (starts_at > clock_timestamp()) AS still_future`,
        [sessionId],
      );
      expect((establish.rows[0] as { still_future: boolean }).still_future).toBe(true);

      // codex round-05 [P2]: a fixed sleep is a guess -- on a slow/loaded runner it
      // could turn a real bug into a flaky pass, or release before the boundary on a
      // fast one. Poll the DATABASE's own clock against the row's just-established
      // starts_at (re-read each iteration, no app clock) until it has definitely
      // passed; the 5s outer deadline mirrors waitUntilSomeoneBlockedByHolder.
      const pollDeadline = Date.now() + 5000;
      let passed = false;
      while (Date.now() < pollDeadline) {
        const check = await holder.query(
          `SELECT (clock_timestamp() >= starts_at) AS passed FROM sessions WHERE id = $1`,
          [sessionId],
        );
        if ((check.rows[0] as { passed: boolean }).passed) {
          passed = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 15));
      }
      expect(passed).toBe(true); // sanity: the poll itself must have succeeded within budget

      await holder.query("COMMIT"); // release; publish's FOR UPDATE proceeds
      const result = await pending;
      pending = undefined;
      expect(result).toBeInstanceOf(SessionPublishError);
      expect((result as SessionPublishError).code).toBe("SESSION_NOT_OPEN");
    } finally {
      await holder.query("ROLLBACK").catch(() => undefined);
      if (pending) await pending.catch(() => undefined);
      holder.release();
    }
  });

  it("REG-CLOCK3: a successful publish's updated_at reflects the time AFTER a lock wait, not transaction-start time (codex round-03 [P2])", async () => {
    // The same transaction-stable now() problem REG-CLOCK2 found for isPastStart
    // also applied to the UPDATE's updated_at: a lock-delayed publish could stamp
    // an audit timestamp from BEFORE the wait, moving updated_at backward relative
    // to a concurrent writer that committed during the wait. Engineer the same
    // kind of race as REG-CLOCK2 (hold the row's FOR UPDATE lock, start a real
    // publish, wait while it is blocked, release) and assert updated_at lands AT
    // OR AFTER the moment we started waiting to release -- a frozen
    // transaction-start value would land at (or before) transaction start, well
    // before that point.
    const tenantId = await seedTenant("active", "active");
    const { sessionId } = await seedDraft(tenantId);
    const holder = await ctx.appPool.connect();
    let pending: Promise<unknown> | undefined;
    try {
      await holder.query("BEGIN");
      await holder.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      await holder.query(`SELECT id FROM sessions WHERE id = $1 FOR UPDATE`, [sessionId]);
      const holderPid = (
        (await holder.query(`SELECT pg_backend_pid() AS pid`)).rows[0] as { pid: number }
      ).pid;

      pending = publish(tenantId, { sessionId }).then(
        (r) => r,
        (e: unknown) => e,
      );
      await waitUntilSomeoneBlockedByHolder(holderPid);

      // codex round-04 [P2]: the reference instant must come from the DATABASE's
      // own clock too -- comparing a DB-generated updated_at against Date.now()
      // would fail on a host where the DB clock trails the application host, an
      // unrelated environment issue rather than evidence of the bug this test
      // exists to catch. The holder already holds this row's lock and can read
      // clock_timestamp() in its own open transaction without blocking on itself.
      const beforeRelease = new Date(
        (await holder.query(`SELECT clock_timestamp() AS now`)).rows[0].now as string,
      );
      await new Promise((resolve) => setTimeout(resolve, 500));
      await holder.query("COMMIT");
      const result = await pending;
      pending = undefined;
      expect(result).toMatchObject({ status: "open" });

      const stored = await row(`SELECT updated_at FROM sessions WHERE id = $1`, [sessionId]);
      expect(new Date(stored.updated_at as string).getTime()).toBeGreaterThanOrEqual(
        beforeRelease.getTime(),
      );
    } finally {
      await holder.query("ROLLBACK").catch(() => undefined);
      if (pending) await pending.catch(() => undefined);
      holder.release();
    }
  });

  it("B4: publishing a public draft missing area / finite slots_max -> MISSING_DISCOVERY_FIELDS, zero mutation", async () => {
    const tenantId = await seedTenant("active", "active");
    // slots_max NULL is unrepresentable for a public row (sessions_public_capacity_chk),
    // so seed the public draft with a blank area — the field publish must re-validate.
    const { sessionId } = await seedDraft(tenantId, {
      visibility: "public",
      area: "   ",
      slotsMax: 8,
    });
    await expectPublishReject(
      () => publish(tenantId, { sessionId }),
      "MISSING_DISCOVERY_FIELDS",
      sessionId,
    );
  });

  it("B5: publishing a session id absent in tenant context -> SESSION_NOT_FOUND, zero mutation", async () => {
    const tenantId = await seedTenant("active", "active");
    const ghost = randomUUID();
    const err = await publish(tenantId, { sessionId: ghost }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SessionPublishError);
    expect((err as SessionPublishError).code).toBe("SESSION_NOT_FOUND");
    expect(await outboxFor(ghost)).toHaveLength(0);
  });

  it("AUTHZ1: publishing when the tenant is billing-suspended -> TENANT_SUSPENDED, zero mutation, no event (DD-105 boundary)", async () => {
    const tenantId = await seedTenant("suspended", "active");
    const { sessionId, version } = await seedDraft(tenantId);
    const err = await publish(tenantId, { sessionId }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SessionPublishAuthorizationError);
    expect((err as SessionPublishAuthorizationError).code).toBe("TENANT_SUSPENDED");
    // fail-closed: the draft stays a draft, no session.published emitted
    expect(await sessionRow(sessionId)).toMatchObject({ status: "draft", version });
    expect(await outboxFor(sessionId)).toHaveLength(0);
  });

  it("AUTHZ2: tenant active but SUBSCRIPTION suspended or cancelled -> TENANT_SUSPENDED (fail-closed 2-step union)", async () => {
    for (const subStatus of ["suspended", "cancelled"]) {
      const tenantId = await seedTenant("active", subStatus);
      const { sessionId } = await seedDraft(tenantId);
      const err = await publish(tenantId, { sessionId }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SessionPublishAuthorizationError);
      expect(await sessionRow(sessionId)).toMatchObject({ status: "draft" });
      expect(await outboxFor(sessionId)).toHaveLength(0);
    }
  });

  it("AUTHZ3: tenant active but MISSING subscription row -> TENANT_SUSPENDED (case 4 fail-closed)", async () => {
    const tenantId = await seedTenant("active", "missing");
    const { sessionId } = await seedDraft(tenantId);
    const err = await publish(tenantId, { sessionId }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SessionPublishAuthorizationError);
    expect(await outboxFor(sessionId)).toHaveLength(0);
  });

  it("AUTHZ4: authz beats REPLAY — a tenant suspended AFTER a successful publish gets TENANT_SUSPENDED on replay, not the stored success (§4 step 1, authz before dedup)", async () => {
    const tenantId = await seedTenant("active", "active");
    const { sessionId } = await seedDraft(tenantId);
    const commandId = cmdId();
    const first = await publish(tenantId, { sessionId }, commandId);
    expect(first.replayed).toBe(false);
    // suspend the tenant, then replay the SAME commandId
    await ctx.owner.query(`UPDATE tenants SET status = 'suspended' WHERE id = $1`, [tenantId]);
    const err = await publish(tenantId, { sessionId }, commandId).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SessionPublishAuthorizationError);
    expect((err as SessionPublishAuthorizationError).code).toBe("TENANT_SUSPENDED");
    // still exactly one event/ledger row — the suspended replay mutated nothing
    expect(await outboxFor(sessionId)).toHaveLength(1);
    expect((await pcCount(tenantId, commandId)).c).toBe(1);
  });

  it("AUTHZ5: authz beats NO-OP — a NEW commandId against an already-open session in a now-suspended tenant gets TENANT_SUSPENDED, and writes no ledger row (authz wins no-op)", async () => {
    const tenantId = await seedTenant("active", "active");
    const { sessionId } = await seedDraft(tenantId);
    await publish(tenantId, { sessionId }); // now open, active
    await ctx.owner.query(`UPDATE tenants SET status = 'suspended' WHERE id = $1`, [tenantId]);
    const newCommandId = cmdId();
    const err = await publish(tenantId, { sessionId }, newCommandId).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SessionPublishAuthorizationError);
    // the no-op path did NOT run (authz fail-fast beat it): no processed_commands row for the new id
    expect((await pcCount(tenantId, newCommandId)).c).toBe(0);
    // and still exactly the one publish event from before the suspend
    expect(await outboxFor(sessionId)).toHaveLength(1);
  });

  it("CONC1 (job-first, competing writer): a suspend-transition holding the subscription FOR UPDATE makes publishSession BLOCK on its locking billing read, then observe the fresh 'suspended' value and DENY — zero mutation, no event (billing #36 shape through publishSession)", async () => {
    // v3 finding 1 (reviewer-mandated, gate-attempt-01): exercise the Daily Lifecycle
    // Job's EXACT eligible-row predicate, not a free/active surrogate. billing #36 is
    // incorporated into THIS slice by feature_session_management_tech.md:542 ("build
    // slice phai tu chung minh implementation thoa bang billing test #36"), so the
    // earlier deferral was withdrawn. The job (a privileged writer) claims its eligible
    // row (paid host_pro price>0, past_due, grace elapsed) with its own FOR UPDATE SKIP
    // LOCKED claim shape, then commits past_due->suspended WHILE publish is blocked;
    // publishSession's locking billing read (FOR SHARE) must BLOCK behind that claim,
    // read the freshly-suspended value, and DENY -- proving the lock serializes end to
    // end through publishSession under the real eligibility predicate.
    //
    // WHICH check serializes (gate-attempt-03 [P1]): both the upfront authz (step 2) and
    // the under-lock re-check (step 9) call the SAME authorizeTenantAction, whose FOR SHARE
    // is retained to commit (authorization.ts:41). So publish blocks at the FIRST call, and
    // the block/deny here IS the #36 locking-serialization acceptance criterion. These tests
    // do NOT isolate step 9 from step 2 -- impossible under the helper's lock retention, an
    // authority/helper-slice design point out of this slice's scope. See the contract §2
    // step 9 note.
    const tenantId = await seedEligibleTenant();
    const { sessionId, version } = await seedDraft(tenantId);
    // Privileged holder = the Daily Lifecycle Job (not the app role; it JOINs plans).
    const holder = await ctx.superuserDb.pool.connect();
    try {
      await holder.query("BEGIN");
      // The job claims its eligible row with its EXACT predicate + claim shape. A
      // returned row PROVES the fixture is job-eligible; the FOR UPDATE holds it so
      // publish's FOR SHARE must block behind it.
      const claimed = await holder.query(jobClaimSql, [tenantId]);
      expect(claimed.rows).toHaveLength(1); // fixture matches the job's exact eligibility predicate
      const holderPid = (
        (await holder.query(`SELECT pg_backend_pid() AS pid`)).rows[0] as { pid: number }
      ).pid;

      // start publish — its billing read (FOR SHARE) will block behind the holder; not awaited yet
      const pending = publish(tenantId, { sessionId }).then(
        () => new Error("expected TENANT_SUSPENDED"),
        (e: unknown) => e,
      );
      await waitUntilSomeoneBlockedByHolder(holderPid);

      // the suspend commits WHILE publish is blocked on the lock
      await holder.query(`UPDATE subscriptions SET status = 'suspended' WHERE tenant_id = $1`, [
        tenantId,
      ]);
      await holder.query("COMMIT");

      const err = await pending;
      expect(err).toBeInstanceOf(SessionPublishAuthorizationError);
      expect((err as SessionPublishAuthorizationError).code).toBe("TENANT_SUSPENDED");
      // fail-closed: the draft stayed a draft, no session.published emitted
      expect(await sessionRow(sessionId)).toMatchObject({ status: "draft", version });
      expect(await outboxFor(sessionId)).toHaveLength(0);
    } finally {
      await holder.query("ROLLBACK").catch(() => undefined);
      holder.release();
    }
  });

  it("CONC2 (publish-first, real in-flight): while a REAL publishSession is blocked at its outbox insert (past its authoritative billing lock + session update), a competing subscription FOR UPDATE SKIP LOCKED claim defers — then publish completes with status open + exactly one event", async () => {
    // Drive the REAL publishSession, not a surrogate. Barrier: hold
    // `LOCK TABLE outbox_events IN ACCESS EXCLUSIVE MODE` in a separate tx. publishSession
    // reaches its `INSERT INTO outbox_events` only AFTER it has passed the authoritative
    // under-lock billing re-check (subscriptions FOR SHARE) and done the draft->open UPDATE,
    // so while it is parked at the barrier it is demonstrably holding those billing locks.
    // A competing job-shape `FOR UPDATE SKIP LOCKED` claim on the subscription must then
    // return zero rows (deferred). Release the barrier and the real publish commits.
    // v3 finding 1: the tenant is the job's EXACT eligible row (paid past_due, grace
    // elapsed), and the competing claim uses the job's real predicate + claim shape.
    const tenantId = await seedEligibleTenant();
    const { sessionId, version } = await seedDraft(tenantId);
    // Dedicated superuser connection for the barrier (ctx.owner is a single already-open
    // Client; superuserDb.pool hands out fresh connections, and superuser may LOCK TABLE).
    const barrier = await ctx.superuserDb.pool.connect();
    let pending: Promise<unknown> | undefined;
    try {
      await barrier.query("BEGIN");
      await barrier.query(`LOCK TABLE outbox_events IN ACCESS EXCLUSIVE MODE`);
      const barrierPid = (
        (await barrier.query(`SELECT pg_backend_pid() AS pid`)).rows[0] as { pid: number }
      ).pid;

      // start the real publish; it will block at the outbox insert behind the barrier
      pending = publish(tenantId, { sessionId }).then(
        (r) => r,
        (e: unknown) => e,
      );
      await waitUntilSomeoneBlockedByHolder(barrierPid);

      // the real publisher is now parked past its billing lock + session update: the job's
      // EXACT eligible-row claim (JOIN plans price>0, past_due, grace elapsed, FOR UPDATE
      // SKIP LOCKED) defers -- publish still holds FOR SHARE on that subscription row.
      const claim = await ctx.owner.query(jobClaimSql, [tenantId]);
      expect(claim.rows).toHaveLength(0); // deferred -- the real in-flight publish holds the lock

      await barrier.query("COMMIT"); // release the barrier; the publish insert proceeds
      const result = await pending;
      pending = undefined;
      expect(result).toMatchObject({ status: "open", version: version + 1 });
    } finally {
      await barrier.query("ROLLBACK").catch(() => undefined);
      if (pending) await pending.catch(() => undefined);
      barrier.release();
    }
    expect(await sessionRow(sessionId)).toMatchObject({ status: "open", version: version + 1 });
    expect(await outboxFor(sessionId)).toHaveLength(1);
  });

  it("CC1/OBS1: a replayed commandId returns the stored envelope and writes exactly one session.published, none on replay", async () => {
    const tenantId = await seedTenant("active", "active");
    const { sessionId } = await seedDraft(tenantId);
    const commandId = cmdId();
    const first = await publish(tenantId, { sessionId }, commandId);
    expect(first.replayed).toBe(false);
    const replay = await publish(tenantId, { sessionId }, commandId);
    expect(replay).toMatchObject({ replayed: true, sessionId, status: "open" });
    // exactly one event total, exactly one processed_commands row
    expect(await outboxFor(sessionId)).toHaveLength(1);
    const pc = await pcCount(tenantId, commandId);
    expect(pc.c).toBe(1);
  });

  it("CC1b: concurrent duplicate publish calls (same commandId, submitted via Promise.all) -> one fresh result, one replay, exactly one event, one ledger row", async () => {
    // The sequential CC1/OBS1 test above would still pass even if the advisory lock
    // were removed or mis-keyed -- it never gives two calls a chance to race. Drive
    // both calls concurrently (mirrors createSession's own C2 test) so a broken lock
    // would surface as a raw unique-constraint violation instead of a clean
    // one-wins/one-dedups outcome.
    const tenantId = await seedTenant("active", "active");
    const { sessionId } = await seedDraft(tenantId);
    const commandId = cmdId();
    const [a, b] = await Promise.all([
      publish(tenantId, { sessionId }, commandId),
      publish(tenantId, { sessionId }, commandId),
    ]);
    expect(a.sessionId).toBe(sessionId);
    expect(b.sessionId).toBe(sessionId);
    expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
    expect(await outboxFor(sessionId)).toHaveLength(1);
    expect((await pcCount(tenantId, commandId)).c).toBe(1);
  });

  it("CC2: a commandId owned by a different command_type fails closed with COMMAND_ID_CONFLICT, not a raw 23505 or a false replay", async () => {
    const tenantId = await seedTenant("active", "active");
    const { sessionId, version } = await seedDraft(tenantId);
    const commandId = cmdId();
    // A foreign ledger row under this commandId (e.g. a CreateSession result).
    await ctx.owner.query(
      `INSERT INTO processed_commands (tenant_id, command_id, command_type, result_ref) VALUES ($1, $2, 'CreateSession', $3)`,
      [
        tenantId,
        commandId,
        JSON.stringify({ sessionId, visibility: "private", status: "draft", version }),
      ],
    );
    await expectPublishReject(
      () => publish(tenantId, { sessionId }, commandId),
      "COMMAND_ID_CONFLICT",
      sessionId,
    );
  });

  it("CC2b: a PublishSession ledger row with a corrupt/domain-invalid result fails closed (never replayed)", async () => {
    const tenantId = await seedTenant("active", "active");
    const { sessionId } = await seedDraft(tenantId);
    const cases: unknown[] = [
      null,
      { sessionId: "not-a-uuid", visibility: "private", status: "open", version: 1 },
      { sessionId, visibility: "secret", status: "open", version: 1 },
      { sessionId, visibility: "private", status: "draft", version: 1 }, // status must be 'open' for a publish result
      { sessionId, visibility: "private", status: "open", version: 0 },
    ];
    for (const result of cases) {
      const commandId = cmdId();
      await ctx.owner.query(
        `INSERT INTO processed_commands (tenant_id, command_id, command_type, result_ref) VALUES ($1, $2, 'PublishSession', $3)`,
        [tenantId, commandId, result === null ? null : JSON.stringify(result)],
      );
      await expectPublishReject(
        () => publish(tenantId, { sessionId }, commandId),
        "COMMAND_ID_CONFLICT",
        sessionId,
      );
    }
  });

  it("CC2c: replay is bound to the requested session — reusing a commandId for session B after publishing session A fails closed, B stays draft (does not replay A's success)", async () => {
    const tenantId = await seedTenant("active", "active");
    const a = await seedDraft(tenantId);
    const b = await seedDraft(tenantId);
    const commandId = cmdId();
    // publish A with the commandId (succeeds, stores A's result under that id)
    const pubA = await publish(tenantId, { sessionId: a.sessionId }, commandId);
    expect(pubA.status).toBe("open");
    // reuse the SAME commandId to publish B — the stored result is for A, not B:
    // fail-closed COMMAND_ID_CONFLICT, NOT a false replay of A's success.
    await expectPublishReject(
      () => publish(tenantId, { sessionId: b.sessionId }, commandId),
      "COMMAND_ID_CONFLICT",
      b.sessionId,
    );
    // B is untouched (still a draft, no event); A unchanged (one publish event)
    expect(await sessionRow(b.sessionId)).toMatchObject({ status: "draft" });
    expect(await outboxFor(b.sessionId)).toHaveLength(0);
    expect(await outboxFor(a.sessionId)).toHaveLength(1);
  });

  it("CC2d: an UPPER-CASE session id publishes and REPLAYS correctly — the id is canonicalized, so a replay is not a false COMMAND_ID_CONFLICT", async () => {
    const tenantId = await seedTenant("active", "active");
    const { sessionId } = await seedDraft(tenantId);
    const upper = sessionId.toUpperCase();
    const commandId = cmdId();
    const first = await publish(tenantId, { sessionId: upper }, commandId);
    expect(first).toMatchObject({ replayed: false, status: "open", sessionId }); // canonical lower-case returned
    // replay the SAME upper-case request -> replays the stored success, not a conflict
    const replay = await publish(tenantId, { sessionId: upper }, commandId);
    expect(replay).toMatchObject({ replayed: true, sessionId, status: "open" });
    expect(await outboxFor(sessionId)).toHaveLength(1);
  });

  it("VER1: expectedVersion mismatch on a live draft -> STALE_VERSION, zero mutation; and expectedVersion match publishes", async () => {
    const tenantId = await seedTenant("active", "active");
    const { sessionId, version } = await seedDraft(tenantId);
    await expectPublishReject(
      () => publish(tenantId, { sessionId, expectedVersion: version + 99 }),
      "STALE_VERSION",
      sessionId,
    );
    // the correct version publishes
    const ok = await publish(tenantId, { sessionId, expectedVersion: version });
    expect(ok).toMatchObject({ status: "open", version: version + 1 });
  });

  it("VER1b: expectedVersion is ignored on an already-open session, both omitted and a stale value -- idempotency wins over version", async () => {
    const tenantId = await seedTenant("active", "active");
    const { sessionId } = await seedDraft(tenantId);
    const first = await publish(tenantId, { sessionId });
    // omitted expectedVersion on the now-open session -> no-op success (goal reached)
    const noopOmitted = await publish(tenantId, { sessionId });
    expect(noopOmitted).toMatchObject({ status: "open", version: first.version });
    // a STALE expectedVersion on the now-open session -> still no-op success
    const noopStale = await publish(tenantId, { sessionId, expectedVersion: 999 });
    expect(noopStale).toMatchObject({ status: "open", version: first.version });
    expect(await outboxFor(sessionId)).toHaveLength(1);
  });

  it("Replay returns only the four declared fields, never extra stored keys", async () => {
    const tenantId = await seedTenant("active", "active");
    const commandId = cmdId();
    const sessionId = randomUUID();
    const clean = { sessionId, visibility: "private", status: "open", version: 1 };
    // Seed the ledger row DIRECTLY with an extra key baked into result_ref -- a
    // normal publish+replay never introduces one, so the assertion below would pass
    // even if the implementation were regressed to spread the stored object instead
    // of explicitly projecting the four declared fields (mirrors createSession's own
    // equivalent test).
    await ctx.owner.query(
      `INSERT INTO processed_commands (tenant_id, command_id, command_type, result_ref) VALUES ($1, $2, 'PublishSession', $3)`,
      [tenantId, commandId, JSON.stringify({ ...clean, secret: "leak" })],
    );
    const r = await publish(tenantId, { sessionId }, commandId);
    expect(r).toEqual({ ...clean, replayed: true });
  });

  it("SEC1: a session published in tenant A is invisible to tenant B; B cannot publish A's session (RLS)", async () => {
    const tenantA = await seedTenant("active", "active");
    const tenantB = await seedTenant("active", "active");
    const { sessionId } = await seedDraft(tenantA);
    await publish(tenantA, { sessionId }); // A publishes its own session -> now open
    // tenant B cannot see the row under its own GUC -> publish resolves SESSION_NOT_FOUND
    const err = await publish(tenantB, { sessionId }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SessionPublishError);
    expect((err as SessionPublishError).code).toBe("SESSION_NOT_FOUND");
    // and a direct read by id under tenant B's GUC returns 0 rows (RLS, no tenant filter)
    const seenByB = await withTenant(ctx.appDb.db, tenantB, (tx) =>
      tx.select({ id: sessions.id }).from(sessions).where(eq(sessions.id, sessionId)),
    );
    expect(seenByB).toHaveLength(0);
    // A's now-open session is untouched by B's attempt
    expect(await sessionRow(sessionId)).toMatchObject({ status: "open" });
  });

  it("SEC2: tenantId comes from trusted context (non-UUID rejected before any work)", async () => {
    await expect(
      publishSession(ctx.appDb.db, {
        tenantId: "not-a-uuid",
        commandId: cmdId(),
        input: { sessionId: randomUUID() },
      }),
    ).rejects.toThrow(/UUID/);
  });

  it("Malformed input (null / array / non-string or non-UUID sessionId) -> SESSION_NOT_FOUND (typed), never a raw TypeError", async () => {
    const tenantId = await seedTenant("active", "active");
    const bad: unknown[] = [
      null,
      [],
      42,
      { sessionId: 123 },
      { sessionId: ["x"] },
      { sessionId: "nope" },
      {},
    ];
    for (const badInput of bad) {
      const err = await publishSession(ctx.appDb.db, {
        tenantId,
        commandId: cmdId(),
        input: badInput as unknown as PublishSessionInputPayload,
      }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SessionPublishError);
      expect((err as SessionPublishError).code).toBe("SESSION_NOT_FOUND");
    }
  });
});
