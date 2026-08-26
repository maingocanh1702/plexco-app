import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sessions } from "../schema.js";
import {
  createSession,
  publishSession,
  announceSession,
  updateSession,
  SessionCommandError,
  SessionPublishAuthorizationError,
  SessionPublishError,
  SessionAnnounceError,
  SessionAnnounceAuthorizationError,
  SessionUpdateError,
  SessionUpdateAuthorizationError,
  closeSession,
  SessionCloseError,
  SessionCloseAuthorizationError,
  type CloseSessionInputPayload,
  type CreateSessionInputPayload,
  type PublishSessionInputPayload,
  type AnnounceSessionInputPayload,
  type AnnounceSessionResult,
  type AnnounceChannel,
  type UpdateSessionInputPayload,
  type UpdateSessionResult,
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

// AnnounceSession -- request an announcement of an OPEN session to a linked channel (contract AN1,
// SEC1, DED1). Real-PG, app role via the RLS harness. announce_session is DENY-path: a suspended
// tenant is refused (unlike close/cancel, which are deferred). announce does not change status.
describe("announceSession", () => {
  const future = () => new Date(Date.now() + 24 * 3600 * 1000);
  const CH: AnnounceChannel = "zalo"; // a recognised logical channel type (see AnnounceChannel)

  async function seedTenant(tenantStatus: string, subStatus: string | "missing"): Promise<string> {
    const unique = randomUUID();
    const t = await ctx.owner.query(
      `INSERT INTO tenants (name, slug, status) VALUES ($1, $2, $3) RETURNING id`,
      [`Announce Test ${unique}`, `announce-test-${unique}`, tenantStatus],
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

  async function seedSession(
    tenantId: string,
    status: string,
  ): Promise<{ sessionId: string; version: number }> {
    const startsAt = future();
    const s = await ctx.owner.query(
      `INSERT INTO sessions (tenant_id, sport_id, starts_at, ends_at, timezone, area, slots_max, visibility, status)
       VALUES ($1, $2, $3, $4, 'Asia/Ho_Chi_Minh', 'Quan 1', 8, 'private', $5)
       RETURNING id, version`,
      [
        tenantId,
        ctx.badmintonSportId,
        startsAt,
        new Date(startsAt.getTime() + 2 * 3600 * 1000),
        status,
      ],
    );
    const r = s.rows[0] as { id: string; version: number };
    return { sessionId: r.id, version: r.version };
  }

  const announce = (tenantId: string, input: AnnounceSessionInputPayload, commandId = cmdId()) =>
    announceSession(ctx.appDb.db, { tenantId, commandId, input });

  const outboxFor = (sessionId: string) =>
    rows(
      `SELECT aggregate_type, sequence, type, payload, claimed_at, acked_at
         FROM outbox_events WHERE aggregate_id = $1 ORDER BY sequence`,
      [sessionId],
    );
  const sessionRow = (sessionId: string) =>
    row(`SELECT status, version FROM sessions WHERE id = $1`, [sessionId]);

  async function expectAnnounceReject(
    run: () => Promise<unknown>,
    code: string,
    sessionId: string,
  ): Promise<void> {
    const before = await sessionRow(sessionId);
    const beforeOutbox = await outboxFor(sessionId);
    const err = await run().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SessionAnnounceError);
    expect((err as SessionAnnounceError).code).toBe(code);
    expect(await sessionRow(sessionId)).toEqual(before);
    expect(await outboxFor(sessionId)).toEqual(beforeOutbox);
  }

  it("AN1: announces an open session -- one session.announcement_requested outbox row, no status change, ledger row", async () => {
    const tenantId = await seedTenant("active", "active");
    const { sessionId, version } = await seedSession(tenantId, "open");
    const commandId = cmdId();

    const result = await announce(tenantId, { sessionId, channel: CH }, commandId);

    expect(result).toEqual({ sessionId, channel: CH, replayed: false });
    // no status change, no version bump -- announce does not mutate the session
    expect(await sessionRow(sessionId)).toEqual({ status: "open", version });

    const events = await outboxFor(sessionId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      aggregate_type: "session",
      sequence: 1,
      type: "session.announcement_requested",
      payload: { session_id: sessionId, channel: CH },
      claimed_at: null,
      acked_at: null,
    });

    const pc = await row(
      `SELECT command_type, result_ref FROM processed_commands WHERE tenant_id = $1 AND command_id = $2`,
      [tenantId, commandId],
    );
    expect(pc).toMatchObject({
      command_type: "AnnounceSession",
      result_ref: { sessionId, channel: CH },
    });
  });

  it("SESSION_NOT_OPEN: a draft / closed / cancelled session cannot be announced (zero mutation)", async () => {
    const tenantId = await seedTenant("active", "active");
    for (const status of ["draft", "closed", "cancelled"]) {
      const { sessionId } = await seedSession(tenantId, status);
      await expectAnnounceReject(
        () => announce(tenantId, { sessionId, channel: CH }),
        "SESSION_NOT_OPEN",
        sessionId,
      );
    }
  });

  it("in-progress open session (started, not yet ended) is announceable -- the ends_at guard is strictly narrower than a starts_at cutoff and does not block a valid late-join invite", async () => {
    const tenantId = await seedTenant("active", "active");
    // starts_at in the past, ends_at in the future -- seeded on the DB clock the guard reads.
    const s = await ctx.owner.query(
      `INSERT INTO sessions (tenant_id, sport_id, starts_at, ends_at, timezone, area, slots_max, visibility, status)
       VALUES ($1, $2, clock_timestamp() - interval '1 hour', clock_timestamp() + interval '1 hour',
               'Asia/Ho_Chi_Minh', 'Quan 1', 8, 'private', 'open')
       RETURNING id`,
      [tenantId, ctx.badmintonSportId],
    );
    const sessionId = (s.rows[0] as { id: string }).id;
    const result = await announce(tenantId, { sessionId, channel: CH });
    expect(result).toEqual({ sessionId, channel: CH, replayed: false });
    expect(await outboxFor(sessionId)).toHaveLength(1);
  });

  it("SESSION_ALREADY_ENDED: an open session whose ends_at has passed cannot be announced (auto-expiry is not built, so it stays 'open') -- zero mutation, and distinct from SESSION_NOT_OPEN", async () => {
    const tenantId = await seedTenant("active", "active");
    // both timestamps in the past on the DB clock -- an ended-but-still-open row.
    const s = await ctx.owner.query(
      `INSERT INTO sessions (tenant_id, sport_id, starts_at, ends_at, timezone, area, slots_max, visibility, status)
       VALUES ($1, $2, clock_timestamp() - interval '4 hours', clock_timestamp() - interval '2 hours',
               'Asia/Ho_Chi_Minh', 'Quan 1', 8, 'private', 'open')
       RETURNING id`,
      [tenantId, ctx.badmintonSportId],
    );
    const sessionId = (s.rows[0] as { id: string }).id;
    await expectAnnounceReject(
      () => announce(tenantId, { sessionId, channel: CH }),
      "SESSION_ALREADY_ENDED",
      sessionId,
    );
  });

  it("TENANT_SUSPENDED: a suspended tenant cannot announce (deny-path) -- zero mutation, no event", async () => {
    // Same fixture where close_session would be ALLOWED (DD-110 D2); announce is deny-path, so it
    // is REFUSED. This is the exact behavioural contrast between the two DD-110 halves.
    const tenantId = await seedTenant("suspended", "active");
    const { sessionId, version } = await seedSession(tenantId, "open");
    const err = await announce(tenantId, { sessionId, channel: CH }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SessionAnnounceAuthorizationError);
    expect((err as SessionAnnounceAuthorizationError).code).toBe("TENANT_SUSPENDED");
    expect(await sessionRow(sessionId)).toEqual({ status: "open", version });
    expect(await outboxFor(sessionId)).toHaveLength(0);
  });

  it("TENANT_SUSPENDED: a tenant whose SUBSCRIPTION is suspended is also refused", async () => {
    const tenantId = await seedTenant("active", "suspended");
    const { sessionId } = await seedSession(tenantId, "open");
    const err = await announce(tenantId, { sessionId, channel: CH }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SessionAnnounceAuthorizationError);
    expect(await outboxFor(sessionId)).toHaveLength(0);
  });

  it("INVALID_CHANNEL: anything outside the closed channel enum is rejected before any mutation (empty, raw id, unknown platform, wrong case, non-string)", async () => {
    const tenantId = await seedTenant("active", "active");
    const { sessionId } = await seedSession(tenantId, "open");
    // A raw destination id ("zalo-group-abc123") -- the would-be cross-tenant target codex round-01
    // flagged -- an unknown platform, a wrong-case value, empty, and non-strings are ALL refused.
    for (const badChannel of [
      "",
      "zalo-group-abc123",
      "whatsapp",
      "ZALO",
      42,
      null,
      undefined,
      {},
    ]) {
      const err = await announce(tenantId, {
        sessionId,
        channel: badChannel as unknown as AnnounceChannel,
      }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SessionAnnounceError);
      expect((err as SessionAnnounceError).code).toBe("INVALID_CHANNEL");
    }
    expect(await outboxFor(sessionId)).toHaveLength(0); // no event emitted for any rejected channel
  });

  it("SESSION_NOT_FOUND: an unknown sessionId, and a malformed payload, fail closed", async () => {
    const tenantId = await seedTenant("active", "active");
    const missingErr = await announce(tenantId, { sessionId: randomUUID(), channel: CH }).catch(
      (e: unknown) => e,
    );
    expect(missingErr).toBeInstanceOf(SessionAnnounceError);
    expect((missingErr as SessionAnnounceError).code).toBe("SESSION_NOT_FOUND");

    for (const badInput of [null, 42, [], { channel: CH }, { sessionId: "nope", channel: CH }]) {
      const err = await announceSession(ctx.appDb.db, {
        tenantId,
        commandId: cmdId(),
        input: badInput as unknown as AnnounceSessionInputPayload,
      }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SessionAnnounceError);
      expect((err as SessionAnnounceError).code).toBe("SESSION_NOT_FOUND");
    }
  });

  it("DED1: replaying the same commandId returns the stored envelope, no second event", async () => {
    const tenantId = await seedTenant("active", "active");
    const { sessionId } = await seedSession(tenantId, "open");
    const commandId = cmdId();

    const first = await announce(tenantId, { sessionId, channel: CH }, commandId);
    expect(first).toMatchObject({ replayed: false, sessionId, channel: CH });

    const replay = await announce(tenantId, { sessionId, channel: CH }, commandId);
    expect(replay).toEqual({ sessionId, channel: CH, replayed: true });
    expect(await outboxFor(sessionId)).toHaveLength(1); // still exactly one request
  });

  it("authz beats replay: a successful announce, then suspension, then replaying the same commandId -> TENANT_SUSPENDED and still exactly one event (authz runs before dedup)", async () => {
    const tenantId = await seedTenant("active", "active");
    const { sessionId } = await seedSession(tenantId, "open");
    const commandId = cmdId();

    const first = await announce(tenantId, { sessionId, channel: CH }, commandId);
    expect(first.replayed).toBe(false);

    // suspend the tenant AFTER the successful announce
    await ctx.owner.query(`UPDATE tenants SET status = 'suspended' WHERE id = $1`, [tenantId]);

    // replay the SAME commandId: the upfront gate (before dedup) refuses, so the stored envelope is
    // NEVER replayed for a now-suspended tenant and no second event is emitted.
    const err = await announce(tenantId, { sessionId, channel: CH }, commandId).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(SessionAnnounceAuthorizationError);
    expect((err as SessionAnnounceAuthorizationError).code).toBe("TENANT_SUSPENDED");
    expect(await outboxFor(sessionId)).toHaveLength(1); // no replay event emitted
  });

  it("COMMAND_ID_CONFLICT: a commandId reused for a different session or a different channel fails closed", async () => {
    const tenantId = await seedTenant("active", "active");
    const a = await seedSession(tenantId, "open");
    const b = await seedSession(tenantId, "open");
    const commandId = cmdId();

    await announce(tenantId, { sessionId: a.sessionId, channel: CH }, commandId);
    // same commandId, different session -> not a replay of A -> conflict, B untouched
    await expectAnnounceReject(
      () => announce(tenantId, { sessionId: b.sessionId, channel: CH }, commandId),
      "COMMAND_ID_CONFLICT",
      b.sessionId,
    );
    // same commandId, same session, DIFFERENT (but valid) channel -> also a conflict (exact-request
    // idempotency: the stored channel was "zalo", so a "messenger" replay is not that request)
    const err = await announce(
      tenantId,
      { sessionId: a.sessionId, channel: "messenger" },
      commandId,
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SessionAnnounceError);
    expect((err as SessionAnnounceError).code).toBe("COMMAND_ID_CONFLICT");
  });

  it("COMMAND_ID_CONFLICT: a foreign command_type under this commandId fails closed -- never replayed as an announce, zero new outbox and the foreign ledger row untouched", async () => {
    const tenantId = await seedTenant("active", "active");
    const { sessionId } = await seedSession(tenantId, "open");
    const commandId = cmdId();
    // A foreign ledger row (a CreateSession result) squats this commandId.
    await ctx.owner.query(
      `INSERT INTO processed_commands (tenant_id, command_id, command_type, result_ref) VALUES ($1, $2, 'CreateSession', $3)`,
      [
        tenantId,
        commandId,
        JSON.stringify({ sessionId, visibility: "private", status: "draft", version: 1 }),
      ],
    );
    await expectAnnounceReject(
      () => announce(tenantId, { sessionId, channel: CH }, commandId),
      "COMMAND_ID_CONFLICT",
      sessionId,
    );
    // the foreign row is not overwritten by an announce envelope
    const pc = await row(
      `SELECT command_type FROM processed_commands WHERE tenant_id = $1 AND command_id = $2`,
      [tenantId, commandId],
    );
    expect(pc).toEqual({ command_type: "CreateSession" });
  });

  it("COMMAND_ID_CONFLICT: an AnnounceSession ledger row with a corrupt/domain-invalid result_ref fails closed (never replayed) -- zero new outbox", async () => {
    const tenantId = await seedTenant("active", "active");
    const { sessionId } = await seedSession(tenantId, "open");
    // Type-valid (AnnounceSession) but result_ref fails isStoredAnnounceResult: null, non-object,
    // missing sessionId, non-UUID sessionId, and an unrecognised channel are ALL corrupt -> conflict.
    const corrupt: unknown[] = [
      null,
      42,
      {},
      { channel: CH },
      { sessionId: "not-a-uuid", channel: CH },
      { sessionId, channel: "whatsapp" },
    ];
    for (const result of corrupt) {
      const commandId = cmdId();
      await ctx.owner.query(
        `INSERT INTO processed_commands (tenant_id, command_id, command_type, result_ref) VALUES ($1, $2, 'AnnounceSession', $3)`,
        [tenantId, commandId, result === null ? null : JSON.stringify(result)],
      );
      await expectAnnounceReject(
        () => announce(tenantId, { sessionId, channel: CH }, commandId),
        "COMMAND_ID_CONFLICT",
        sessionId,
      );
    }
  });

  it("SEC1: cross-tenant -- announcing another tenant's session is invisible under RLS (SESSION_NOT_FOUND)", async () => {
    const owner = await seedTenant("active", "active");
    const attacker = await seedTenant("active", "active");
    const { sessionId } = await seedSession(owner, "open");
    await expectAnnounceReject(
      () => announce(attacker, { sessionId, channel: CH }),
      "SESSION_NOT_FOUND",
      sessionId,
    );
  });

  // Deterministic barrier: find whichever backend is blocked specifically by `holderPid` (mirrors the
  // publishSession CONC tests). announceSession opens its own tx via db.transaction(), so the test has
  // no direct handle on its pool connection -- discover the blocked waiter via pg_blocking_pids.
  async function waitUntilBlockedBy(holderPid: number): Promise<void> {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const r = await rows(
        `SELECT pid FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND $1 = ANY(pg_blocking_pids(pid))`,
        [holderPid],
      );
      if (r.length > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
    throw new Error(`no backend became blocked by holder ${holderPid} within 5s`);
  }

  it("CONC: FOR UPDATE serializes per-session outbox allocation -- a concurrent announce blocks on a session-row-lock holder and then takes the NEXT sequence (a FOR SHARE read would coexist and collide on outbox_agg_seq_uq)", async () => {
    const tenantId = await seedTenant("active", "active");
    const { sessionId } = await seedSession(tenantId, "open");
    const holder = await ctx.superuserDb.pool.connect();
    let pending: Promise<AnnounceSessionResult> | undefined;
    let committed = false;
    try {
      await holder.query("BEGIN");
      const holderPid = (await holder.query("SELECT pg_backend_pid() AS pid")).rows[0]
        .pid as number;
      // Holder takes a SHARE lock on the session row -- exactly what a concurrent announce would hold
      // if announce used a FOR SHARE read -- and seeds an uncommitted seq-1 announcement row. announce
      // B's FOR UPDATE must CONFLICT with this SHARE lock and block; a FOR SHARE read would coexist and
      // (reading the pre-commit MAX=0) collide on seq 1.
      await holder.query("SELECT id FROM sessions WHERE id = $1 FOR SHARE", [sessionId]);
      await holder.query(
        `INSERT INTO outbox_events (tenant_id, aggregate_type, aggregate_id, sequence, type, payload)
         VALUES ($1, 'session', $2, 1, 'session.announcement_requested', $3::jsonb)`,
        [tenantId, sessionId, JSON.stringify({ session_id: sessionId, channel: "zalo" })],
      );

      pending = announce(tenantId, { sessionId, channel: "messenger" });
      // If announce used FOR SHARE it would NOT block here, so this wait is what discriminates the fix
      // from the bug: it throws if the concurrent announce never blocks on the holder's lock.
      await waitUntilBlockedBy(holderPid);

      await holder.query("COMMIT"); // release the SHARE lock and make seq 1 visible
      committed = true;
      const result = await pending;
      pending = undefined;
      expect(result).toMatchObject({ sessionId, channel: "messenger", replayed: false });

      const events = await outboxFor(sessionId);
      const seqs = events.map((e) => (e as { sequence: number }).sequence).sort((x, y) => x - y);
      expect(seqs).toEqual([1, 2]); // both requests persisted, consecutive, no collision
      const bRow = events.find(
        (e) => (e as { payload: { channel?: string } }).payload.channel === "messenger",
      );
      expect((bRow as { sequence: number }).sequence).toBe(2);
    } finally {
      // If anything above threw before COMMIT, the holder still holds the SHARE lock and `pending` is
      // blocked. Roll back to release the lock (skipped once committed) so the awaited announce can
      // settle, then release -- otherwise teardown closes the app pool while this connection still
      // holds the lock and deadlocks (codex round-01 [P1]).
      if (!committed) await holder.query("ROLLBACK").catch(() => undefined);
      if (pending) await pending.catch(() => undefined);
      holder.release();
    }
  });

  it("REG-CLOCK: a lock wait spanning ends_at rejects with SESSION_ALREADY_ENDED -- proves the SEPARATE post-lock clock_timestamp() query (a now()/tx-start or in-query clock read would enqueue an announcement after ends_at)", async () => {
    // Mirrors publishSession's REG-CLOCK2 for the ends_at freshness guard. announce reads
    // `ends_at <= clock_timestamp()` in a SEPARATE query AFTER acquiring the row lock. now()
    // (frozen at transaction start) or a clock read inside the blocking locked SELECT would
    // measure the PRE-wait time: a request blocked on the row lock while ends_at passes during
    // the wait would then wrongly enqueue an announcement for an already-ended session. Engineer
    // the race: a holder owns the row's FOR UPDATE lock; the real announce blocks behind it; the
    // holder sets ends_at to a DB-clock-relative near-future instant (future relative to announce's
    // earlier tx-start, so a frozen clock sees not-ended), waits until it has passed, then releases.
    // Only the post-lock clock_timestamp() sees the post-wait time and rejects.
    const tenantId = await seedTenant("active", "active");
    // starts_at in the past so the holder can push ends_at to ~now without violating
    // CHECK (ends_at > starts_at); ends_at initially future -> in-progress, announceable.
    const s = await ctx.owner.query(
      `INSERT INTO sessions (tenant_id, sport_id, starts_at, ends_at, timezone, area, slots_max, visibility, status)
       VALUES ($1, $2, clock_timestamp() - interval '2 hours', clock_timestamp() + interval '1 hour',
               'Asia/Ho_Chi_Minh', 'Quan 1', 8, 'private', 'open')
       RETURNING id`,
      [tenantId, ctx.badmintonSportId],
    );
    const sessionId = (s.rows[0] as { id: string }).id;
    const commandId = cmdId();
    const holder = await ctx.superuserDb.pool.connect();
    let pending: Promise<AnnounceSessionResult> | undefined;
    let committed = false;
    try {
      await holder.query("BEGIN");
      const holderPid = (await holder.query("SELECT pg_backend_pid() AS pid")).rows[0]
        .pid as number;
      await holder.query("SELECT id FROM sessions WHERE id = $1 FOR UPDATE", [sessionId]);

      // start the real announce; its session FOR UPDATE blocks behind the holder
      pending = announce(tenantId, { sessionId, channel: CH }, commandId).then(
        (r) => r,
        (e: unknown) => e as AnnounceSessionResult,
      );
      // throws if the concurrent announce never blocks -- discriminates the guard from the bug
      await waitUntilBlockedBy(holderPid);

      // announce is blocked; its tx has started but has NOT read ends_at yet. The holder owns the
      // row, so in ONE statement it sets ends_at to a DB-clock-relative near-future instant --
      // future BY CONSTRUCTION, and future relative to announce's EARLIER tx-start, so a frozen
      // now() would see not-ended and wrongly enqueue; only the post-lock clock_timestamp() rejects.
      const establish = await holder.query(
        `UPDATE sessions SET ends_at = clock_timestamp() + interval '500 milliseconds'
           WHERE id = $1 RETURNING (ends_at > clock_timestamp()) AS still_future`,
        [sessionId],
      );
      expect((establish.rows[0] as { still_future: boolean }).still_future).toBe(true);

      // Poll the DB's own clock against the just-established ends_at until it has definitely passed
      // (no app clock, no fixed sleep -- mirrors REG-CLOCK2). 5s deadline like waitUntilBlockedBy.
      const pollDeadline = Date.now() + 5000;
      let passed = false;
      while (Date.now() < pollDeadline) {
        const check = await holder.query(
          `SELECT (clock_timestamp() >= ends_at) AS passed FROM sessions WHERE id = $1`,
          [sessionId],
        );
        if ((check.rows[0] as { passed: boolean }).passed) {
          passed = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 15));
      }
      expect(passed).toBe(true); // sanity: the poll itself must have succeeded within budget

      await holder.query("COMMIT"); // release; announce's FOR UPDATE proceeds
      committed = true;
      const result = await pending;
      pending = undefined;
      expect(result).toBeInstanceOf(SessionAnnounceError);
      expect((result as unknown as SessionAnnounceError).code).toBe("SESSION_ALREADY_ENDED");
      // no announcement enqueued, no command recorded
      expect(await outboxFor(sessionId)).toHaveLength(0);
      const pc = await rows(
        `SELECT 1 FROM processed_commands WHERE tenant_id = $1 AND command_id = $2`,
        [tenantId, commandId],
      );
      expect(pc).toHaveLength(0);
    } finally {
      if (!committed) await holder.query("ROLLBACK").catch(() => undefined);
      if (pending) await pending.catch(() => undefined);
      holder.release();
    }
  });
});

// Real-PG tests for UpdateSession (a partial field mutation of a draft/open
// session). Each test seeds a DEDICATED tenant so global row counts never
// cross-contaminate; assertions are scoped by session_id / aggregate_id.
// UpdateSession gives authorizeTenantAction('update_open_session') its production
// caller: DENY-when-suspended for an OPEN session, while a DRAFT is DD-105-exempt
// and never calls the resolver (U6, the DD-110 D4 negative test).
describe("updateSession", () => {
  const future = () => new Date(Date.now() + 24 * 3600 * 1000);

  async function seedTenant(tenantStatus: string, subStatus: string | "missing"): Promise<string> {
    const unique = randomUUID();
    const t = await ctx.owner.query(
      `INSERT INTO tenants (name, slug, status) VALUES ($1, $2, $3) RETURNING id`,
      [`Update Test ${unique}`, `update-test-${unique}`, tenantStatus],
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

  // Seed a session row directly (owner conn, bypasses RLS for setup). Default is an
  // 'open' private session with discovery fields present.
  async function seedSession(
    tenantId: string,
    over: {
      status?: string;
      visibility?: "private" | "public";
      area?: string | null;
      slotsMax?: number | null;
      priceAmount?: number;
      startsAt?: Date;
    } = {},
  ): Promise<{ sessionId: string; version: number }> {
    const startsAt = over.startsAt ?? future();
    const s = await ctx.owner.query(
      `INSERT INTO sessions (tenant_id, sport_id, starts_at, ends_at, timezone, area, slots_max, visibility, price_amount, status)
       VALUES ($1, $2, $3, $4, 'Asia/Ho_Chi_Minh', $5, $6, $7, $8, $9)
       RETURNING id, version`,
      [
        tenantId,
        ctx.badmintonSportId,
        startsAt,
        new Date(startsAt.getTime() + 2 * 3600 * 1000),
        over.area === undefined ? "Quận 1" : over.area,
        over.slotsMax === undefined ? 8 : over.slotsMax,
        over.visibility ?? "private",
        over.priceAmount ?? 120000,
        over.status ?? "open",
      ],
    );
    const r = s.rows[0] as { id: string; version: number };
    return { sessionId: r.id, version: r.version };
  }

  // person -> membership -> ACTIVE player, for the capacity roster. Returns playerId.
  async function seedActivePlayer(tenantId: string, sessionId: string): Promise<string> {
    const unique = randomUUID();
    const p = await ctx.owner.query(`INSERT INTO persons (display_name) VALUES ($1) RETURNING id`, [
      `P ${unique}`,
    ]);
    const personId = (p.rows[0] as { id: string }).id;
    const m = await ctx.owner.query(
      `INSERT INTO memberships (tenant_id, person_id, status) VALUES ($1, $2, 'active') RETURNING id`,
      [tenantId, personId],
    );
    const membershipId = (m.rows[0] as { id: string }).id;
    const pl = await ctx.owner.query(
      `INSERT INTO players (tenant_id, session_id, membership_id, status) VALUES ($1, $2, $3, 'active') RETURNING id`,
      [tenantId, sessionId, membershipId],
    );
    return (pl.rows[0] as { id: string }).id;
  }

  // A charge on an active player (default status 'open' = unpaid). An EXISTING
  // non-void charge is what fail-closes a price change (edge #4/#5, DD-117).
  async function seedCharge(
    tenantId: string,
    sessionId: string,
    over: { status?: string; amountDue?: number } = {},
  ): Promise<void> {
    const playerId = await seedActivePlayer(tenantId, sessionId);
    await ctx.owner.query(
      `INSERT INTO charges (tenant_id, session_id, player_id, amount_due, status) VALUES ($1, $2, $3, $4, $5)`,
      [tenantId, sessionId, playerId, over.amountDue ?? 120000, over.status ?? "open"],
    );
  }

  const update = (tenantId: string, input: UpdateSessionInputPayload, commandId = cmdId()) =>
    updateSession(ctx.appDb.db, { tenantId, commandId, input });

  const sessionState = (sessionId: string) =>
    row(
      `SELECT status, version, visibility, price_amount, slots_max, area FROM sessions WHERE id = $1`,
      [sessionId],
    );
  const updatedEvents = (sessionId: string) =>
    rows(
      `SELECT type, sequence, payload FROM outbox_events WHERE aggregate_id = $1 ORDER BY sequence`,
      [sessionId],
    );

  // Project a session into the public read model as the async projector would, so the guarded
  // view public_session_share_v serves it (a live, non-expired row). DD-12 fence test scaffolding.
  async function projectToPublic(sessionId: string, tenantId: string): Promise<void> {
    await ctx.owner.query(
      `INSERT INTO public_sessions
         (id, session_id, tenant_id, sport_key, starts_at, ends_at, area,
          price_amount, slots_open, club_display_name, join_policy, expires_at)
       VALUES ($1, $1, $2, 'badminton', now() + interval '1 day',
          now() + interval '1 day' + interval '2 hours', 'Quận 1', 120000, 4, 'Club A', 'open',
          now() + interval '1 day')`,
      [sessionId, tenantId],
    );
  }
  // The guarded public view (discovery role); denies IMMEDIATELY when a fence is raised.
  const viewHasSession = async (sessionId: string): Promise<boolean> =>
    (
      await ctx.readonlyPool.query(`SELECT 1 FROM public_session_share_v WHERE session_id = $1`, [
        sessionId,
      ])
    ).rows.length > 0;
  // The base public_sessions row still present (proves the async projector has NOT run yet).
  const baseStillProjected = async (sessionId: string): Promise<boolean> =>
    (await ctx.owner.query(`SELECT 1 FROM public_sessions WHERE session_id = $1`, [sessionId])).rows
      .length > 0;
  const fenceReason = async (sessionId: string): Promise<string | null> =>
    (
      (
        await ctx.owner.query(`SELECT reason FROM public_projection_fences WHERE target_id = $1`, [
          sessionId,
        ])
      ).rows[0] as { reason: string } | undefined
    )?.reason ?? null;

  async function expectUpdateReject(run: () => Promise<unknown>, code: string): Promise<void> {
    const err = await run().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SessionUpdateError);
    expect((err as SessionUpdateError).code).toBe(code);
  }

  it("U1: mutates fields on an OPEN session, bumps version, emits one session.updated with changed_fields", async () => {
    const tenantId = await seedTenant("active", "active");
    const { sessionId, version } = await seedSession(tenantId, {
      area: "Quận 1",
      slotsMax: 8,
      priceAmount: 120000,
    });
    const result = await update(tenantId, {
      sessionId,
      expectedVersion: version,
      area: "Quận 3",
      priceAmount: 90000,
    });
    expect(result).toMatchObject({
      sessionId,
      status: "open",
      version: version + 1,
      replayed: false,
    });
    const st = await sessionState(sessionId);
    expect(st).toMatchObject({
      status: "open",
      version: version + 1,
      area: "Quận 3",
      price_amount: 90000,
    });
    const evs = await updatedEvents(sessionId);
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({ type: "session.updated" });
    // EXACT payload shape (§4): {session_id, changed_fields[]} — NO tenant_id (that is the
    // outbox row's own column). changed_fields are the changed snake_case column names.
    const payload = (evs[0] as { payload: Record<string, unknown> }).payload;
    expect(Object.keys(payload).sort()).toEqual(["changed_fields", "session_id"]);
    expect(payload.session_id).toBe(sessionId);
    expect([...(payload.changed_fields as string[])].sort()).toEqual(["area", "price_amount"]);
  });

  it("U-ALLFIELDS: a single update maps ALL ten editable fields to their columns, with exact changed_fields (no field silently dropped)", async () => {
    const tenantId = await seedTenant("active", "active");
    // Seed a PRIVATE open session at known defaults (timezone Asia/Ho_Chi_Minh, venue NULL,
    // join_policy 'open'); every one of the ten editable fields below differs from current.
    const { sessionId, version } = await seedSession(tenantId, {
      status: "open",
      visibility: "private",
      area: "Quận 1",
      slotsMax: 8,
      priceAmount: 120000,
      startsAt: new Date(Date.now() + 24 * 3600 * 1000),
    });
    const newStarts = new Date(Date.now() + 48 * 3600 * 1000);
    const newEnds = new Date(newStarts.getTime() + 3 * 3600 * 1000);
    const result = await update(tenantId, {
      sessionId,
      expectedVersion: version,
      startsAt: newStarts,
      endsAt: newEnds,
      timezone: "Asia/Bangkok",
      priceAmount: 200000,
      slotsMax: 12,
      visibility: "public", // area + finite slots present, so discovery passes
      area: "Quận 5",
      venueName: "Sân Cầu Lông A",
      venueAddress: "123 Đường Lê Lợi",
      joinPolicy: "approval",
    });
    expect(result).toMatchObject({
      sessionId,
      status: "open",
      version: version + 1,
      replayed: false,
    });
    // Every column persisted to its new value (query the FULL row, not just sessionState's six).
    const full = (await row(
      `SELECT starts_at, ends_at, timezone, price_amount, slots_max, visibility, area,
              venue_name, venue_address, join_policy, version, status
         FROM sessions WHERE id = $1`,
      [sessionId],
    )) as {
      starts_at: string;
      ends_at: string;
      timezone: string;
      price_amount: number;
      slots_max: number;
      visibility: string;
      area: string;
      venue_name: string;
      venue_address: string;
      join_policy: string;
      version: number;
      status: string;
    };
    expect(new Date(full.starts_at).getTime()).toBe(newStarts.getTime());
    expect(new Date(full.ends_at).getTime()).toBe(newEnds.getTime());
    expect(full.timezone).toBe("Asia/Bangkok");
    expect(full.price_amount).toBe(200000);
    expect(full.slots_max).toBe(12);
    expect(full.visibility).toBe("public");
    expect(full.area).toBe("Quận 5");
    expect(full.venue_name).toBe("Sân Cầu Lông A");
    expect(full.venue_address).toBe("123 Đường Lê Lợi");
    expect(full.join_policy).toBe("approval");
    expect(full.version).toBe(version + 1);
    expect(full.status).toBe("open");
    // session.updated changed_fields lists ALL ten snake_case columns, exactly; plus the
    // visibility flip emits session.visibility_changed. Both payloads are asserted exactly.
    const evs = await updatedEvents(sessionId);
    expect(evs.map((e) => (e as { type: string }).type)).toEqual([
      "session.updated",
      "session.visibility_changed",
    ]);
    const updPayload = (evs[0] as { payload: Record<string, unknown> }).payload;
    expect(Object.keys(updPayload).sort()).toEqual(["changed_fields", "session_id"]);
    expect(updPayload.session_id).toBe(sessionId);
    expect([...(updPayload.changed_fields as string[])].sort()).toEqual([
      "area",
      "ends_at",
      "join_policy",
      "price_amount",
      "slots_max",
      "starts_at",
      "timezone",
      "venue_address",
      "venue_name",
      "visibility",
    ]);
    const visPayload = (evs[1] as { payload: Record<string, unknown> }).payload;
    expect(Object.keys(visPayload).sort()).toEqual(["new_visibility", "session_id"]);
    expect(visPayload.new_visibility).toBe("public");
  });

  it("U2: STALE_VERSION on expected_version mismatch, zero mutation", async () => {
    const tenantId = await seedTenant("active", "active");
    const { sessionId, version } = await seedSession(tenantId);
    await expectUpdateReject(
      () => update(tenantId, { sessionId, expectedVersion: version + 9, area: "X" }),
      "STALE_VERSION",
    );
    expect(await sessionState(sessionId)).toMatchObject({ version });
    expect(await updatedEvents(sessionId)).toHaveLength(0);
  });

  it("U-VERSION: expected_version is MANDATORY on the mutate branch — a non-empty change with NO version is STALE_VERSION, zero mutation", async () => {
    const tenantId = await seedTenant("active", "active");
    const { sessionId, version } = await seedSession(tenantId, { area: "Quận 1" });
    await expectUpdateReject(
      () => update(tenantId, { sessionId, area: "Quận 8" }),
      "STALE_VERSION",
    );
    expect(await sessionState(sessionId)).toMatchObject({ version, area: "Quận 1" });
    expect(await updatedEvents(sessionId)).toHaveLength(0);
  });

  it("U3: CAPACITY_BELOW_ROSTER when reducing slots_max below the active roster, zero mutation", async () => {
    const tenantId = await seedTenant("active", "active");
    const { sessionId, version } = await seedSession(tenantId, { slotsMax: 8 });
    await seedActivePlayer(tenantId, sessionId);
    await seedActivePlayer(tenantId, sessionId); // active roster = 2
    await expectUpdateReject(
      () => update(tenantId, { sessionId, expectedVersion: version, slotsMax: 1 }),
      "CAPACITY_BELOW_ROSTER",
    );
    expect(await sessionState(sessionId)).toMatchObject({ version, slots_max: 8 });
    expect(await updatedEvents(sessionId)).toHaveLength(0);
  });

  it("U4: PRICE_CHANGE_REQUIRES_POLICY when price changes with an existing charge, zero mutation (fail-closed, DD-117)", async () => {
    const tenantId = await seedTenant("active", "active");
    const { sessionId, version } = await seedSession(tenantId, { priceAmount: 120000 });
    await seedCharge(tenantId, sessionId, { status: "open" });
    await expectUpdateReject(
      () => update(tenantId, { sessionId, expectedVersion: version, priceAmount: 90000 }),
      "PRICE_CHANGE_REQUIRES_POLICY",
    );
    expect(await sessionState(sessionId)).toMatchObject({ version, price_amount: 120000 });
    expect(await updatedEvents(sessionId)).toHaveLength(0);
  });

  it("U-VOID: a price change REQUIRES policy even when the only charge is void — no status exemption (edge #4 'existing charges', DD-117 fail-closed)", async () => {
    const tenantId = await seedTenant("active", "active");
    const { sessionId, version } = await seedSession(tenantId, { priceAmount: 120000 });
    // The charge-existence probe matches ANY charge on the session, including a `void` one: the
    // Reviewed session contract edge #4 requires policy for a price change with "existing charges"
    // (no void carve-out), and DD-117 D3 authorizes the charge branch only as a fail-closed refuse.
    // So a void-only charge REFUSES too -- money never moves silently.
    await seedCharge(tenantId, sessionId, { status: "void" });
    await expectUpdateReject(
      () => update(tenantId, { sessionId, expectedVersion: version, priceAmount: 90000 }),
      "PRICE_CHANGE_REQUIRES_POLICY",
    );
    expect(await sessionState(sessionId)).toMatchObject({ version, price_amount: 120000 });
    expect(await updatedEvents(sessionId)).toHaveLength(0);
  });

  it("U5: TENANT_SUSPENDED when updating an OPEN session while suspended (update_open_session, under lock)", async () => {
    const tenantId = await seedTenant("active", "suspended");
    const { sessionId, version } = await seedSession(tenantId, { status: "open" });
    const err = await update(tenantId, { sessionId, area: "X" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SessionUpdateAuthorizationError);
    expect((err as SessionUpdateAuthorizationError).code).toBe("TENANT_SUSPENDED");
    expect(await sessionState(sessionId)).toMatchObject({ version });
    expect(await updatedEvents(sessionId)).toHaveLength(0);
  });

  it("U6: DD-110 D4 negative — updating a DRAFT while suspended SUCCEEDS (authorizeTenantAction NOT called for a draft; DD-105)", async () => {
    const tenantId = await seedTenant("active", "suspended");
    const { sessionId, version } = await seedSession(tenantId, { status: "draft" });
    const result = await update(tenantId, { sessionId, expectedVersion: version, area: "Quận 5" });
    expect(result).toMatchObject({
      sessionId,
      status: "draft",
      version: version + 1,
      replayed: false,
    });
    expect(await sessionState(sessionId)).toMatchObject({
      status: "draft",
      version: version + 1,
      area: "Quận 5",
    });
  });

  it("U7: SESSION_NOT_OPEN when updating a closed or cancelled session", async () => {
    const tenantId = await seedTenant("active", "active");
    for (const status of ["closed", "cancelled"]) {
      const { sessionId, version } = await seedSession(tenantId, { status });
      await expectUpdateReject(
        () => update(tenantId, { sessionId, area: "X" }),
        "SESSION_NOT_OPEN",
      );
      expect(await sessionState(sessionId)).toMatchObject({ version });
    }
  });

  it("U8: MISSING_DISCOVERY_FIELDS when flipping to public without area/slots_max, zero mutation", async () => {
    const tenantId = await seedTenant("active", "active");
    const { sessionId, version } = await seedSession(tenantId, {
      visibility: "private",
      area: null,
      slotsMax: null,
    });
    await expectUpdateReject(
      () => update(tenantId, { sessionId, expectedVersion: version, visibility: "public" }),
      "MISSING_DISCOVERY_FIELDS",
    );
    expect(await sessionState(sessionId)).toMatchObject({ version, visibility: "private" });
    expect(await updatedEvents(sessionId)).toHaveLength(0);
  });

  it("U9: idempotent no-op when the effective change-set is empty — no version bump, no event, wins a stale version", async () => {
    const tenantId = await seedTenant("active", "active");
    const { sessionId, version } = await seedSession(tenantId, {
      area: "Quận 1",
      priceAmount: 120000,
    });
    // Every provided field already equals current -> empty change-set -> no-op. A
    // STALE expected_version is NOT checked on the no-op branch (mirror publish).
    const commandId = cmdId();
    const noop = { sessionId, expectedVersion: version + 5, area: "Quận 1", priceAmount: 120000 };
    const result = await update(tenantId, noop, commandId);
    expect(result).toMatchObject({ sessionId, status: "open", version, replayed: false });
    expect(await sessionState(sessionId)).toMatchObject({ version });
    expect(await updatedEvents(sessionId)).toHaveLength(0);
    // The no-op PERSISTED its dedup row: replaying the SAME request returns the stored
    // envelope (replayed=true), still zero mutation and no event.
    const replay = await update(tenantId, noop, commandId);
    expect(replay).toMatchObject({ sessionId, status: "open", version, replayed: true });
    expect(await sessionState(sessionId)).toMatchObject({ version });
    expect(await updatedEvents(sessionId)).toHaveLength(0);
  });

  it("DED1: a replayed commandId for the same session returns the stored envelope REGARDLESS of the patch (commandId-only dedup, DD-117 D5); a different session or a foreign command_type conflicts", async () => {
    const tenantId = await seedTenant("active", "active");
    const { sessionId, version } = await seedSession(tenantId);
    const commandId = cmdId();
    const first = await update(
      tenantId,
      { sessionId, expectedVersion: version, area: "Quận 7" },
      commandId,
    );
    expect(first).toMatchObject({ version: version + 1, replayed: false });
    // Same commandId, SAME session -> replay the stored envelope, zero new mutation. Dedup is
    // on (tenant_id, command_id) ONLY (like create/publish/announce), so the replay returns the
    // FIRST result even when the patch DIFFERS: the caller owns commandId uniqueness per distinct
    // request, and NO request fingerprint is stored (DD-117 D5 — a hash of the location fields in
    // this delete-surviving ledger would be dictionary-recoverable PII).
    const replaySame = await update(
      tenantId,
      { sessionId, expectedVersion: version, area: "Quận 7" },
      commandId,
    );
    expect(replaySame).toMatchObject({ version: version + 1, replayed: true });
    const replayDifferentPatch = await update(
      tenantId,
      { sessionId, expectedVersion: version, area: "DIFFERENT" },
      commandId,
    );
    expect(replayDifferentPatch).toMatchObject({ version: version + 1, replayed: true });
    // Same commandId, DIFFERENT session -> collision (the stored envelope's sessionId does not
    // match): the operation identity differs, so this is a genuine idempotency-key reuse.
    const other = await seedSession(tenantId);
    await expectUpdateReject(
      () =>
        update(
          tenantId,
          { sessionId: other.sessionId, expectedVersion: other.version, area: "Z" },
          commandId,
        ),
      "COMMAND_ID_CONFLICT",
    );
    // A commandId owned by a FOREIGN command_type in the shared processed_commands ledger
    // never replays through updateSession -> COMMAND_ID_CONFLICT (fail-closed, edge #3).
    const foreignCmd = cmdId();
    await ctx.owner.query(
      `INSERT INTO processed_commands (tenant_id, command_id, command_type, result_ref)
       VALUES ($1, $2, 'CreateSession', $3)`,
      [
        tenantId,
        foreignCmd,
        JSON.stringify({ sessionId, visibility: "private", status: "draft", version: 1 }),
      ],
    );
    await expectUpdateReject(
      () => update(tenantId, { sessionId, expectedVersion: version, area: "Q" }, foreignCmd),
      "COMMAND_ID_CONFLICT",
    );
    // Exactly ONE session.updated on the first session — both replays and the conflicts added
    // none, proving the different-patch replay short-circuited with zero mutation.
    expect(await updatedEvents(sessionId)).toHaveLength(1);
  });

  it("DED2: a replayed commandId for an already-committed update returns the stored result even when the RETRY payload is MALFORMED (dedup precedes patch validation, DD-117 D5)", async () => {
    const tenantId = await seedTenant("active", "active");
    const { sessionId, version } = await seedSession(tenantId);
    const commandId = cmdId();
    const first = await update(
      tenantId,
      { sessionId, expectedVersion: version, area: "Quận 7" },
      commandId,
    );
    expect(first).toMatchObject({ version: version + 1, replayed: false });
    // The client retries the SAME commandId but its payload is now MALFORMED (a serialization
    // glitch: null expected_version, then a garbage timezone). Because dedup is on
    // (tenant_id, command_id) and runs BEFORE patch validation, the committed operation's
    // result is returned — never a spurious error for an operation that already succeeded.
    const replayNullVer = await update(
      tenantId,
      { sessionId, expectedVersion: null as unknown as number, area: "Quận 7" },
      commandId,
    );
    expect(replayNullVer).toMatchObject({ version: version + 1, replayed: true });
    const replayBadTz = await update(
      tenantId,
      { sessionId, expectedVersion: version, timezone: "Not/AZone" },
      commandId,
    );
    expect(replayBadTz).toMatchObject({ version: version + 1, replayed: true });
    // Still exactly one mutation — the malformed replays neither errored nor mutated.
    expect(await updatedEvents(sessionId)).toHaveLength(1);
  });

  it("SEC1: cannot update another tenant's session (RLS FORCE — tenant_id from context, never payload)", async () => {
    const tenantA = await seedTenant("active", "active");
    const tenantB = await seedTenant("active", "active");
    const { sessionId, version } = await seedSession(tenantA, { status: "open" });
    // tenant B sends tenant A's session id -> invisible under B's GUC -> not found.
    await expectUpdateReject(() => update(tenantB, { sessionId, area: "X" }), "SESSION_NOT_FOUND");
    expect(await sessionState(sessionId)).toMatchObject({ version });
  });

  it("U-PAST: SESSION_NOT_OPEN when updating an OPEN session whose starts_at has passed (edge #11 past-guard), zero mutation", async () => {
    const tenantId = await seedTenant("active", "active");
    // Auto-close is not built, so an open session past its starts_at persists as 'open'.
    const { sessionId, version } = await seedSession(tenantId, {
      status: "open",
      startsAt: new Date(Date.now() - 24 * 3600 * 1000),
    });
    await expectUpdateReject(() => update(tenantId, { sessionId, area: "X" }), "SESSION_NOT_OPEN");
    expect(await sessionState(sessionId)).toMatchObject({ version });
    expect(await updatedEvents(sessionId)).toHaveLength(0);
  });

  // Deterministic barrier (mirrors publishSession's REG-CLOCK2 helper): wait until at least
  // `min` backends are blocked TRANSITIVELY by `holderPid`. With a row FOR UPDATE, only the
  // FIRST waiter waits on the holder's XID directly; a SECOND waiter queues behind the first
  // (a LockTuple wait), so pg_blocking_pids reports the holder only for the first waiter. A
  // recursive closure over the blocking graph therefore counts BOTH: writer A (blocked by the
  // holder) and writer B (blocked by A, itself blocked by the holder). updateSession opens its
  // own tx, so `min=2` proves both competing writers reached the lock barrier before release.
  async function waitUntilSomeoneBlockedByHolder(holderPid: number, min = 1): Promise<void> {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const { rows } = await ctx.owner.query(
        `WITH RECURSIVE reach AS (
           SELECT pid FROM pg_stat_activity
             WHERE wait_event_type = 'Lock' AND $1 = ANY(pg_blocking_pids(pid))
           UNION
           SELECT a.pid FROM pg_stat_activity a
             JOIN reach r ON r.pid = ANY(pg_blocking_pids(a.pid))
             WHERE a.wait_event_type = 'Lock'
         )
         SELECT count(*)::int AS c FROM reach`,
        [holderPid],
      );
      if (Number((rows[0] as { c: number }).c) >= min) return;
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
    throw new Error(`fewer than ${min} backend(s) blocked by holder ${holderPid} within 5s`);
  }

  it("REG-CLOCK-UPDATE: a lock wait spanning starts_at rejects with SESSION_NOT_OPEN — proves the SEPARATE post-lock clock_timestamp() past-guard (not now()/a same-statement clock)", async () => {
    // Mirror publish REG-CLOCK2 for update's past-guard: hold the session row's FOR
    // UPDATE lock on a separate connection, start the REAL update (it blocks), let
    // starts_at pass in real wall-clock time WHILE blocked, then release. now()/tx-start
    // is frozen before the wait and a same-statement clock reads a pre-wait time; only
    // the separate post-lock clock_timestamp() query sees the post-wait instant and rejects.
    const tenantId = await seedTenant("active", "active");
    const { sessionId, version } = await seedSession(tenantId, {
      status: "open",
      startsAt: new Date(Date.now() + 3600 * 1000), // placeholder; operative value set below
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

      // The real update blocks on this row's FOR UPDATE, behind the holder.
      pending = update(tenantId, { sessionId, area: "Quận 9" }).then(
        (r) => r,
        (e: unknown) => e,
      );
      await waitUntilSomeoneBlockedByHolder(holderPid);

      // update's tx has begun but has NOT read starts_at (the past-guard runs only after
      // it acquires the lock). The holder owns the row, so it sets starts_at now, in ONE
      // statement, to a DB-clock-relative near-future value — future relative to update's
      // own (earlier) transaction start, so a frozen now() would see not-past and wrongly
      // mutate; only the post-lock clock query rejects. RETURNING evaluates the new row.
      const establish = await holder.query(
        `UPDATE sessions SET starts_at = clock_timestamp() + interval '500 milliseconds'
           WHERE id = $1 RETURNING (starts_at > clock_timestamp()) AS still_future`,
        [sessionId],
      );
      expect((establish.rows[0] as { still_future: boolean }).still_future).toBe(true);

      // Poll the DATABASE clock (no app clock) until the just-set starts_at has passed.
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

      await holder.query("COMMIT"); // release; update's FOR UPDATE proceeds
      const result = await pending;
      pending = undefined;
      expect(result).toBeInstanceOf(SessionUpdateError);
      expect((result as SessionUpdateError).code).toBe("SESSION_NOT_OPEN");
      // zero mutation: version unchanged, no session.updated event.
      expect(await sessionState(sessionId)).toMatchObject({ version });
      expect(await updatedEvents(sessionId)).toHaveLength(0);
    } finally {
      await holder.query("ROLLBACK").catch(() => undefined);
      if (pending) await pending.catch(() => undefined);
      holder.release();
    }
  });

  it("U-RACE: two competing writers sharing the initial version -> exactly one success and one STALE_VERSION (post-FOR UPDATE optimistic guard, spec :739)", async () => {
    const tenantId = await seedTenant("active", "active");
    const { sessionId, version } = await seedSession(tenantId, { status: "open" });
    // Gate BOTH writers behind a holder's FOR UPDATE so the race is DETERMINISTIC: they are
    // in-flight and contend on the session row's post-lock version check, never accidentally
    // sequential. The holder only HOLDS the row (no mutation), so on release the version is
    // still `version`; the two writers then serialize on FOR UPDATE -- exactly one reads
    // `version` (succeeds, bumps to version+1) and the other then reads version+1 (its
    // expectedVersion is now stale -> STALE_VERSION). Distinct patches (area A vs B) so the
    // LOSER always has a non-empty change-set and thus reaches the mandatory version guard.
    const holder = await ctx.appPool.connect();
    let a: Promise<unknown> | undefined;
    let b: Promise<unknown> | undefined;
    try {
      await holder.query("BEGIN");
      await holder.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      await holder.query(`SELECT id FROM sessions WHERE id = $1 FOR UPDATE`, [sessionId]);
      const holderPid = (
        (await holder.query(`SELECT pg_backend_pid() AS pid`)).rows[0] as { pid: number }
      ).pid;
      // Two real updateSession commands, both claiming the SAME initial version, each a distinct
      // commandId (so their per-command advisory locks do not serialize -- only the session
      // FOR UPDATE does). Capture both outcomes (never reject) so neither leaks.
      a = update(tenantId, { sessionId, expectedVersion: version, area: "A" }).then(
        (r) => r,
        (e: unknown) => e,
      );
      b = update(tenantId, { sessionId, expectedVersion: version, area: "B" }).then(
        (r) => r,
        (e: unknown) => e,
      );
      // Wait until BOTH writers are in the holder's lock-wait graph before releasing. If we
      // released after only ONE was blocked, the loser could instead start AFTER the winner
      // committed and see version+1 pre-lock -- a sequential path a faulty pre-lock version
      // check would also pass. Requiring both blocked proves the loser read the row UNDER the
      // FOR UPDATE it lost, so its rejection exercises the POST-lock re-check specifically.
      await waitUntilSomeoneBlockedByHolder(holderPid, 2);
      await holder.query("COMMIT"); // release; the two writers now serialize on FOR UPDATE
      const results = await Promise.all([a, b]);
      a = undefined;
      b = undefined;
      const successes = results.filter(
        (r) => !(r instanceof SessionUpdateError),
      ) as UpdateSessionResult[];
      const failures = results.filter(
        (r): r is SessionUpdateError => r instanceof SessionUpdateError,
      );
      expect(successes).toHaveLength(1);
      expect(failures).toHaveLength(1);
      expect(successes[0]!).toMatchObject({ version: version + 1, replayed: false });
      expect(failures[0]!.code).toBe("STALE_VERSION");
      // One mutation, one event: the version advanced by exactly one.
      expect(await sessionState(sessionId)).toMatchObject({ version: version + 1 });
      expect(await updatedEvents(sessionId)).toHaveLength(1);
    } finally {
      await holder.query("ROLLBACK").catch(() => undefined);
      if (a) await a;
      if (b) await b;
      holder.release();
    }
  });

  it("U-SETPAST: cannot SET starts_at to a past value on an OPEN session (effective past-fence), zero net mutation", async () => {
    const tenantId = await seedTenant("active", "active");
    const { sessionId, version } = await seedSession(tenantId, { status: "open" }); // future starts_at
    // ends_at stays future, so the ends>starts guard passes; only the effective past-fence catches it.
    await expectUpdateReject(
      () =>
        update(tenantId, {
          sessionId,
          expectedVersion: version,
          startsAt: new Date(Date.now() - 24 * 3600 * 1000),
        }),
      "SESSION_NOT_OPEN",
    );
    // The whole transaction rolled back: version unchanged (the UPDATE bumped it, then the
    // fence threw), and no session.updated event.
    expect(await sessionState(sessionId)).toMatchObject({ version });
    expect(await updatedEvents(sessionId)).toHaveLength(0);
  });

  it("U-BADVER: a malformed expected_version on a NEW command (ledger miss) is rejected (STALE_VERSION), even on a would-be no-op", async () => {
    const tenantId = await seedTenant("active", "active");
    const { sessionId, version } = await seedSession(tenantId, { area: "Quận 1" });
    // Each call uses a FRESH commandId -> a ledger MISS, so the patch IS validated (validation
    // runs after the dedup miss). area equals current -> WOULD be a no-op, but a malformed
    // version is rejected before the no-op branch. Includes explicit null and an int4-overflow
    // (> 2147483647) — both fail closed. (A malformed REPLAY of an existing commandId returns
    // the stored result instead — see DED2.)
    const bads: unknown[] = [
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      0,
      -1,
      "3",
      null,
      2_147_483_648,
    ];
    for (const bad of bads) {
      await expectUpdateReject(
        () =>
          update(tenantId, {
            sessionId,
            expectedVersion: bad as number,
            area: "Quận 1",
          }),
        "STALE_VERSION",
      );
    }
    expect(await sessionState(sessionId)).toMatchObject({ version, area: "Quận 1" });
    expect(await updatedEvents(sessionId)).toHaveLength(0);
  });

  it("U-PII: the processed_commands ledger stores NO request content — only the returned envelope, no venue/area PII and no PII-derivative hash (DD-117 D5, BRD NFR-P1)", async () => {
    const tenantId = await seedTenant("active", "active");
    const { sessionId, version } = await seedSession(tenantId);
    const secretVenue = "SECRET-VENUE-Nguyễn-Huệ-42";
    const secretAddr = "SECRET-ADDR-123-Lê-Lợi-Q1";
    const secretArea = "SECRET-AREA-Quận-Bí-Mật";
    const commandId = cmdId();
    await update(
      tenantId,
      {
        sessionId,
        expectedVersion: version,
        venueName: secretVenue,
        venueAddress: secretAddr,
        area: secretArea,
      },
      commandId,
    );
    // processed_commands rows survive session deletion. Dedup is commandId-only (DD-117 D5): the
    // ledger stores ONLY the returned envelope {sessionId, status, version, visibility} and NO
    // request content — not the raw location PII, and not a fingerprint/hash of it (an unkeyed
    // hash over low-entropy location fields would be dictionary-recoverable after deletion).
    const pc = await row(
      `SELECT result_ref::text AS rr FROM processed_commands WHERE tenant_id = $1 AND command_id = $2`,
      [tenantId, commandId],
    );
    const rr = (pc as { rr: string }).rr;
    // No raw PII, in whole or in fragment.
    expect(rr).not.toContain(secretVenue);
    expect(rr).not.toContain(secretAddr);
    expect(rr).not.toContain(secretArea);
    expect(rr).not.toContain("Nguyễn-Huệ");
    expect(rr).not.toContain("Lê-Lợi");
    expect(rr).not.toContain("Bí-Mật");
    // No PII-DERIVATIVE value either: the stored envelope is EXACTLY the four returned keys, with
    // no fingerprint/hash key of any kind, and no 64-char sha256-shaped digest anywhere in the row.
    const stored = JSON.parse(rr) as Record<string, unknown>;
    expect(Object.keys(stored).sort()).toEqual(["sessionId", "status", "version", "visibility"]);
    expect(stored.sessionId).toBe(sessionId);
    expect(rr).not.toMatch(/[0-9a-f]{64}/);
  });

  it("U-CORRUPT: a stored envelope with an out-of-int4 version fails closed (COMMAND_ID_CONFLICT), never replayed as an impossible version", async () => {
    const tenantId = await seedTenant("active", "active");
    const { sessionId, version } = await seedSession(tenantId);
    const commandId = cmdId();
    const req = { sessionId, expectedVersion: version, area: "Quận X" };
    // A REAL update first stores a VALID envelope for this command...
    const first = await update(tenantId, req, commandId);
    expect(first).toMatchObject({ replayed: false });
    // ...then corrupt ONLY the stored version to 2^31 (exceeds sessions.version's int4 domain).
    // Dedup matches on (tenant_id, command_id) + sessionId, so ONLY the int4 upper-bound guard in
    // isStoredUpdateResult can reject the replay (a valid envelope would otherwise REPLAY) — this
    // is why isStoredUpdateResult adds the upper bound over isStoredCreateResult.
    await ctx.owner.query(
      `UPDATE processed_commands
          SET result_ref = jsonb_set(result_ref, '{version}', '2147483648'::jsonb)
        WHERE tenant_id = $1 AND command_id = $2`,
      [tenantId, commandId],
    );
    // Replaying now hits the corrupt envelope: isStoredUpdateResult fails closed on the
    // out-of-int4 version -> COMMAND_ID_CONFLICT, never a replay of an impossible version.
    await expectUpdateReject(() => update(tenantId, req, commandId), "COMMAND_ID_CONFLICT");
  });

  it("U-VIS: a visibility transition emits session.updated AND session.visibility_changed (§4 Events)", async () => {
    const tenantId = await seedTenant("active", "active");
    // private OPEN session WITH discovery fields so the -> public flip passes edge #7/#12.
    const { sessionId, version } = await seedSession(tenantId, {
      status: "open",
      visibility: "private",
      area: "Quận 1",
      slotsMax: 8,
    });
    const result = await update(tenantId, {
      sessionId,
      expectedVersion: version,
      visibility: "public",
    });
    expect(result).toMatchObject({ visibility: "public", version: version + 1 });
    const evs = await updatedEvents(sessionId);
    expect(evs.map((e) => (e as { type: string }).type)).toEqual([
      "session.updated",
      "session.visibility_changed",
    ]);
    // session.updated: EXACT {session_id, changed_fields:[visibility]} — no extra field.
    const updEv = evs[0] as { payload: Record<string, unknown> };
    expect(Object.keys(updEv.payload).sort()).toEqual(["changed_fields", "session_id"]);
    expect(updEv.payload.session_id).toBe(sessionId);
    expect(updEv.payload.changed_fields).toEqual(["visibility"]);
    // session.visibility_changed: assert the EXACT key-set {session_id, new_visibility}. This is
    // a privacy-sensitive projector signal, so an accidental EXTRA field (e.g. leaked PII) must
    // fail the test — toMatchObject would silently accept it.
    const visEv = evs[1] as { payload: Record<string, unknown> };
    expect(Object.keys(visEv.payload).sort()).toEqual(["new_visibility", "session_id"]);
    expect(visEv.payload.session_id).toBe(sessionId);
    expect(visEv.payload.new_visibility).toBe("public");
  });

  it("U-FENCE: public->private on an OPEN session raises the immediate-deny fence in-tx; the guarded view denies IMMEDIATELY (DD-12), before any projector", async () => {
    const tenantId = await seedTenant("active", "active");
    const { sessionId, version } = await seedSession(tenantId, {
      status: "open",
      visibility: "public",
      area: "Quận 1",
      slotsMax: 8,
    });
    // Project it to the public read model (as the async projector would) so the guarded view serves it.
    await projectToPublic(sessionId, tenantId);
    expect(await viewHasSession(sessionId)).toBe(true); // discoverable BEFORE the change
    const result = await update(tenantId, {
      sessionId,
      expectedVersion: version,
      visibility: "private",
    });
    expect(result).toMatchObject({ visibility: "private", version: version + 1 });
    // The fence is raised in the SAME transaction, with the exact 0033 reason literal.
    expect(await fenceReason(sessionId)).toBe("visibility_private");
    // Immediate deny: the base public_sessions row still exists (the async projector has NOT run),
    // but the guarded view anti-joins the fence, so discovery stops RIGHT AWAY.
    expect(await baseStillProjected(sessionId)).toBe(true);
    expect(await viewHasSession(sessionId)).toBe(false);
  });

  it("U-FENCE-DRAFT: a DRAFT public->private ALSO raises the fence (unconditional, no status gate); private->private raises nothing", async () => {
    const tenantId = await seedTenant("active", "active");
    // (a) draft->private: the fence PRODUCER raises on EVERY public->private, regardless of status
    // (owner ruling 2026-08-25; DD-12 literal). "A draft is never publicly served" is a projector
    // assumption, not a schema guarantee (public_session_share_v has no sessions.status predicate),
    // so the producer does not depend on it -> the draft DOES raise the fence.
    const draft = await seedSession(tenantId, {
      status: "draft",
      visibility: "public",
      area: "Quận 1",
      slotsMax: 8,
    });
    await update(tenantId, {
      sessionId: draft.sessionId,
      expectedVersion: draft.version,
      visibility: "private",
    });
    expect(await fenceReason(draft.sessionId)).toBe("visibility_private");
    // (b) private->private on an OPEN session: NOT a visibility change -> no fence (a real area
    // change still applies, so the update is not a no-op).
    const priv = await seedSession(tenantId, {
      status: "open",
      visibility: "private",
      area: "Quận 1",
      slotsMax: 8,
    });
    const r = await update(tenantId, {
      sessionId: priv.sessionId,
      expectedVersion: priv.version,
      visibility: "private",
      area: "Quận 9",
    });
    expect(r).toMatchObject({ version: priv.version + 1 });
    expect(await fenceReason(priv.sessionId)).toBeNull();
  });
});

describe("closeSession (B1 of the split)", () => {
  const future = () => new Date(Date.now() + 24 * 3600 * 1000);
  const past = () => new Date(Date.now() - 24 * 3600 * 1000);

  async function seedTenant(tenantStatus: string, subStatus: string | "missing"): Promise<string> {
    const unique = randomUUID();
    const t = await ctx.owner.query(
      `INSERT INTO tenants (name, slug, status) VALUES ($1, $2, $3) RETURNING id`,
      [`CloseCancel ${unique}`, `close-cancel-${unique}`, tenantStatus],
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

  async function seedSession(
    tenantId: string,
    over: { status?: string; visibility?: "private" | "public"; startsAt?: Date } = {},
  ): Promise<{ sessionId: string; version: number }> {
    const startsAt = over.startsAt ?? future();
    const s = await ctx.owner.query(
      `INSERT INTO sessions (tenant_id, sport_id, starts_at, ends_at, timezone, area, slots_max, visibility, price_amount, status)
       VALUES ($1, $2, $3, $4, 'Asia/Ho_Chi_Minh', 'Quận 1', 8, $5, 120000, $6)
       RETURNING id, version`,
      [
        tenantId,
        ctx.badmintonSportId,
        startsAt,
        new Date(startsAt.getTime() + 2 * 3600 * 1000),
        over.visibility ?? "private",
        over.status ?? "open",
      ],
    );
    const r = s.rows[0] as { id: string; version: number };
    return { sessionId: r.id, version: r.version };
  }

  // person -> membership -> ACTIVE player + an (open, unpaid) charge — the roster/charge an
  // obligation-termination refuses on (edge #5 / #28).
  // A roster player at a given status (default active). Returns the player id so a charge can be
  // attached to a NON-active player (a charge-only anomaly: hasCharges yet active roster = 0).
  async function seedRosterPlayer(
    tenantId: string,
    sessionId: string,
    playerStatus = "active",
  ): Promise<string> {
    const unique = randomUUID();
    const p = await ctx.owner.query(`INSERT INTO persons (display_name) VALUES ($1) RETURNING id`, [
      `P ${unique}`,
    ]);
    const personId = (p.rows[0] as { id: string }).id;
    const m = await ctx.owner.query(
      `INSERT INTO memberships (tenant_id, person_id, status) VALUES ($1, $2, 'active') RETURNING id`,
      [tenantId, personId],
    );
    const membershipId = (m.rows[0] as { id: string }).id;
    // players_status_chk / 0014: status='waitlisted' <=> waitlist_position IS NOT NULL.
    const waitlistPosition = playerStatus === "waitlisted" ? 1 : null;
    const pl = await ctx.owner.query(
      `INSERT INTO players (tenant_id, session_id, membership_id, status, waitlist_position) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [tenantId, sessionId, membershipId, playerStatus, waitlistPosition],
    );
    return (pl.rows[0] as { id: string }).id;
  }

  async function seedCharge(
    tenantId: string,
    sessionId: string,
    {
      chargeStatus = "open",
      playerStatus = "active",
    }: { chargeStatus?: string; playerStatus?: string } = {},
  ): Promise<void> {
    const playerId = await seedRosterPlayer(tenantId, sessionId, playerStatus);
    await ctx.owner.query(
      `INSERT INTO charges (tenant_id, session_id, player_id, amount_due, status) VALUES ($1, $2, $3, 120000, $4)`,
      [tenantId, sessionId, playerId, chargeStatus],
    );
  }

  async function projectToPublic(sessionId: string, tenantId: string): Promise<void> {
    await ctx.owner.query(
      `INSERT INTO public_sessions
         (id, session_id, tenant_id, sport_key, starts_at, ends_at, area,
          price_amount, slots_open, club_display_name, join_policy, expires_at)
       VALUES ($1, $1, $2, 'badminton', now() + interval '1 day',
          now() + interval '1 day' + interval '2 hours', 'Quận 1', 120000, 4, 'Club A', 'open',
          now() + interval '1 day')`,
      [sessionId, tenantId],
    );
  }
  const viewHasSession = async (sessionId: string): Promise<boolean> =>
    (
      await ctx.readonlyPool.query(`SELECT 1 FROM public_session_share_v WHERE session_id = $1`, [
        sessionId,
      ])
    ).rows.length > 0;
  const fenceReason = async (sessionId: string): Promise<string | null> =>
    (
      (
        await ctx.owner.query(`SELECT reason FROM public_projection_fences WHERE target_id = $1`, [
          sessionId,
        ])
      ).rows[0] as { reason: string } | undefined
    )?.reason ?? null;

  const sessionState = (sessionId: string) =>
    row(`SELECT status, version FROM sessions WHERE id = $1`, [sessionId]);
  const sessionEvents = (sessionId: string) =>
    rows(`SELECT type, payload FROM outbox_events WHERE aggregate_id = $1 ORDER BY sequence`, [
      sessionId,
    ]);

  const close = (tenantId: string, input: CloseSessionInputPayload, commandId = cmdId()) =>
    closeSession(ctx.appDb.db, { tenantId, commandId, input });

  async function expectCloseReject(run: () => Promise<unknown>, code: string): Promise<void> {
    const err = await run().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SessionCloseError);
    expect((err as SessionCloseError).code).toBe(code);
  }

  // Wait until at least `min` backends sit (transitively) in the holder's lock-wait graph — the
  // recursive reach mirrors updateSession's U-RACE helper so C-RACE releases only once BOTH closers
  // are blocked under the same FOR UPDATE they will contend on (per-describe copy: helpers do not
  // cross describe scopes).
  async function waitUntilBlockedByHolder(holderPid: number, min = 1): Promise<void> {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const { rows } = await ctx.owner.query(
        `WITH RECURSIVE reach AS (
           SELECT pid FROM pg_stat_activity
             WHERE wait_event_type = 'Lock' AND $1 = ANY(pg_blocking_pids(pid))
           UNION
           SELECT a.pid FROM pg_stat_activity a
             JOIN reach r ON r.pid = ANY(pg_blocking_pids(a.pid))
             WHERE a.wait_event_type = 'Lock'
         )
         SELECT count(*)::int AS c FROM reach`,
        [holderPid],
      );
      if (Number((rows[0] as { c: number }).c) >= min) return;
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
    throw new Error(`fewer than ${min} backend(s) blocked by holder ${holderPid} within 5s`);
  }

  // ---------------------------- CloseSession ----------------------------

  it("C1: closes an OPEN session -> closed, version+1, one session.closed event, processed_commands row", async () => {
    const tenantId = await seedTenant("active", "active");
    const { sessionId, version } = await seedSession(tenantId, { status: "open" });
    const result = await close(tenantId, { sessionId, expectedVersion: version });
    expect(result).toMatchObject({
      sessionId,
      status: "closed",
      version: version + 1,
      replayed: false,
    });
    expect(await sessionState(sessionId)).toMatchObject({ status: "closed", version: version + 1 });
    const evs = await sessionEvents(sessionId);
    expect(evs).toHaveLength(1);
    expect((evs[0] as { type: string }).type).toBe("session.closed");
    const payload = (evs[0] as { payload: Record<string, unknown> }).payload;
    expect(Object.keys(payload).sort()).toEqual(["close_reason", "session_id"]);
    expect(payload).toMatchObject({ session_id: sessionId, close_reason: "manual" });
  });

  it("C2: closing a DRAFT is SESSION_NOT_OPEN (only open -> closed), zero mutation", async () => {
    const tenantId = await seedTenant("active", "active");
    const { sessionId, version } = await seedSession(tenantId, { status: "draft" });
    await expectCloseReject(
      () => close(tenantId, { sessionId, expectedVersion: version }),
      "SESSION_NOT_OPEN",
    );
    expect(await sessionState(sessionId)).toMatchObject({ status: "draft", version });
    expect(await sessionEvents(sessionId)).toHaveLength(0);
  });

  it("C3: closing a CANCELLED session is SESSION_NOT_OPEN", async () => {
    const tenantId = await seedTenant("active", "active");
    const { sessionId, version } = await seedSession(tenantId, { status: "cancelled" });
    await expectCloseReject(
      () => close(tenantId, { sessionId, expectedVersion: version }),
      "SESSION_NOT_OPEN",
    );
  });

  it("C-NOOP: closing an already-CLOSED session is an idempotent no-op (version unchanged, no duplicate event; no expected_version needed)", async () => {
    const tenantId = await seedTenant("active", "active");
    const { sessionId, version } = await seedSession(tenantId, { status: "closed" });
    const result = await close(tenantId, { sessionId }); // no expectedVersion — no-op wins
    expect(result).toMatchObject({ status: "closed", version, replayed: false });
    expect(await sessionEvents(sessionId)).toHaveLength(0);
  });

  it("C-VER: STALE_VERSION on expected_version mismatch; and STALE_VERSION when omitted on the mutate branch (edge #26)", async () => {
    const tenantId = await seedTenant("active", "active");
    const a = await seedSession(tenantId, { status: "open" });
    await expectCloseReject(
      () => close(tenantId, { sessionId: a.sessionId, expectedVersion: a.version + 9 }),
      "STALE_VERSION",
    );
    const b = await seedSession(tenantId, { status: "open" });
    await expectCloseReject(() => close(tenantId, { sessionId: b.sessionId }), "STALE_VERSION");
    expect(await sessionState(a.sessionId)).toMatchObject({ status: "open", version: a.version });
  });

  it("C-CHARGE: closing a session with ANY charge is CANCEL_REQUIRES_REVIEW (fail-closed, edge #5), zero mutation", async () => {
    const tenantId = await seedTenant("active", "active");
    const { sessionId, version } = await seedSession(tenantId, { status: "open" });
    await seedCharge(tenantId, sessionId);
    await expectCloseReject(
      () => close(tenantId, { sessionId, expectedVersion: version }),
      "CANCEL_REQUIRES_REVIEW",
    );
    expect(await sessionState(sessionId)).toMatchObject({ status: "open", version });
    expect(await sessionEvents(sessionId)).toHaveLength(0);
  });

  it("C-STALE-CHARGE: a STALE close request against a session WITH a charge is STALE_VERSION, NOT CANCEL_REQUIRES_REVIEW — closeSession checks the version before the money guard", async () => {
    const tenantId = await seedTenant("active", "active");
    const { sessionId, version } = await seedSession(tenantId, { status: "open" });
    await seedCharge(tenantId, sessionId);
    await expectCloseReject(
      () => close(tenantId, { sessionId, expectedVersion: version + 9 }),
      "STALE_VERSION",
    );
    expect(await sessionState(sessionId)).toMatchObject({ status: "open", version });
    expect(await sessionEvents(sessionId)).toHaveLength(0);
  });

  it("C-VOID: a session whose ONLY charge is `void` STILL blocks close — sessionHasCharges has NO status filter (fail-closed money posture, DD-117); CANCEL_REQUIRES_REVIEW, zero mutation, no event", async () => {
    const tenantId = await seedTenant("active", "active");
    const { sessionId, version } = await seedSession(tenantId, { status: "open" });
    await seedCharge(tenantId, sessionId, { chargeStatus: "void" });
    await expectCloseReject(
      () => close(tenantId, { sessionId, expectedVersion: version }),
      "CANCEL_REQUIRES_REVIEW",
    );
    expect(await sessionState(sessionId)).toMatchObject({ status: "open", version });
    expect(await sessionEvents(sessionId)).toHaveLength(0);
  });

  it("C-SUSPENDED: closing an OPEN session while the SUBSCRIPTION is suspended SUCCEEDS (DD-110 D2 obligation-termination — the one relaxed cell)", async () => {
    const tenantId = await seedTenant("active", "suspended"); // subscription (billing) suspended
    const { sessionId, version } = await seedSession(tenantId, { status: "open" });
    const result = await close(tenantId, { sessionId, expectedVersion: version });
    expect(result).toMatchObject({ status: "closed", version: version + 1 });
  });

  it("C-SUSPENDED-TENANT: closing while the TENANT (abuse/ToS axis) is suspended SUCCEEDS — DD-110 D2 allows the suspended cell on BOTH axes, incl. an abuse tenant terminating its own session (codex round-4 [P1])", async () => {
    const tenantId = await seedTenant("suspended", "active"); // tenant-root suspended
    const { sessionId, version } = await seedSession(tenantId, { status: "open" });
    const result = await close(tenantId, { sessionId, expectedVersion: version });
    expect(result).toMatchObject({ status: "closed", version: version + 1 });
  });

  it("C-CANCELLED-TENANT: closing while the TENANT is CANCELLED (terminated account) is DENIED — DD-110 D2 authorizes only the suspended cell; cancelled stays fail-closed", async () => {
    const tenantId = await seedTenant("cancelled", "active"); // tenant-root cancelled
    const { sessionId, version } = await seedSession(tenantId, { status: "open" });
    const err = await close(tenantId, { sessionId, expectedVersion: version }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(SessionCloseAuthorizationError);
    expect((err as SessionCloseAuthorizationError).code).toBe("TENANT_SUSPENDED");
    expect(await sessionState(sessionId)).toMatchObject({ status: "open", version });
  });

  it("C-PAST: closing an OPEN session whose starts_at has PASSED SUCCEEDS — close has NO past-guard (unlike cancel)", async () => {
    const tenantId = await seedTenant("active", "active");
    const { sessionId, version } = await seedSession(tenantId, {
      status: "open",
      startsAt: past(),
    });
    const result = await close(tenantId, { sessionId, expectedVersion: version });
    expect(result).toMatchObject({ status: "closed", version: version + 1 });
  });

  it("C-FENCE: closing raises the DD-12 fence ('closed', unconditional); the guarded view denies IMMEDIATELY", async () => {
    const tenantId = await seedTenant("active", "active");
    const { sessionId, version } = await seedSession(tenantId, {
      status: "open",
      visibility: "public",
    });
    await projectToPublic(sessionId, tenantId);
    expect(await viewHasSession(sessionId)).toBe(true);
    await close(tenantId, { sessionId, expectedVersion: version });
    expect(await fenceReason(sessionId)).toBe("closed");
    expect(await viewHasSession(sessionId)).toBe(false);
  });

  it("C-FENCE-PRIVATE: closing a PRIVATE session that carries a STALE public projection STILL raises the fence — the raise is unconditional, NOT gated on prior visibility (guarded view denies)", async () => {
    const tenantId = await seedTenant("active", "active");
    const { sessionId, version } = await seedSession(tenantId, {
      status: "open",
      visibility: "private",
    });
    // A stale public_sessions row on a PRIVATE session (e.g. left behind after a public→private flip
    // before the async projector converged). The fence must fire regardless of the session's own
    // visibility, so the stale projection is denied immediately.
    await projectToPublic(sessionId, tenantId);
    expect(await viewHasSession(sessionId)).toBe(true);
    await close(tenantId, { sessionId, expectedVersion: version });
    expect(await fenceReason(sessionId)).toBe("closed");
    expect(await viewHasSession(sessionId)).toBe(false);
  });

  it("C-DED: replaying the same commandId for the same session returns the stored envelope; a different session, a foreign command_type, or a CORRUPT same-type envelope all conflict", async () => {
    const tenantId = await seedTenant("active", "active");
    const { sessionId, version } = await seedSession(tenantId, { status: "open" });
    const commandId = cmdId();
    const first = await close(tenantId, { sessionId, expectedVersion: version }, commandId);
    expect(first).toMatchObject({ version: version + 1, replayed: false });
    const replay = await close(tenantId, { sessionId, expectedVersion: version }, commandId);
    expect(replay).toMatchObject({ version: version + 1, replayed: true });
    const other = await seedSession(tenantId, { status: "open" });
    await expectCloseReject(
      () =>
        close(tenantId, { sessionId: other.sessionId, expectedVersion: other.version }, commandId),
      "COMMAND_ID_CONFLICT",
    );
    const foreignCmd = cmdId();
    await ctx.owner.query(
      `INSERT INTO processed_commands (tenant_id, command_id, command_type, result_ref)
       VALUES ($1, $2, 'CreateSession', $3)`,
      [
        tenantId,
        foreignCmd,
        JSON.stringify({ sessionId, visibility: "private", status: "draft", version: 1 }),
      ],
    );
    await expectCloseReject(
      () => close(tenantId, { sessionId, expectedVersion: version }, foreignCmd),
      "COMMAND_ID_CONFLICT",
    );
    // Same command_type (CloseSession) but a CORRUPT stored envelope (version past INT4_MAX) →
    // isStoredCloseResult rejects it → COMMAND_ID_CONFLICT (never trusts a malformed prior result).
    const corruptCmd = cmdId();
    await ctx.owner.query(
      `INSERT INTO processed_commands (tenant_id, command_id, command_type, result_ref)
       VALUES ($1, $2, 'CloseSession', $3)`,
      [tenantId, corruptCmd, JSON.stringify({ sessionId, status: "closed", version: 2147483648 })],
    );
    await expectCloseReject(
      () => close(tenantId, { sessionId, expectedVersion: version }, corruptCmd),
      "COMMAND_ID_CONFLICT",
    );
    expect(await sessionEvents(sessionId)).toHaveLength(1);
  });

  it("C-SEC: cannot close another tenant's session (RLS FORCE — tenant_id from context)", async () => {
    const tenantA = await seedTenant("active", "active");
    const tenantB = await seedTenant("active", "active");
    const { sessionId, version } = await seedSession(tenantA, { status: "open" });
    await expectCloseReject(
      () => close(tenantB, { sessionId, expectedVersion: version }),
      "SESSION_NOT_FOUND",
    );
    expect(await sessionState(sessionId)).toMatchObject({ status: "open", version });
  });

  it("C-NOOP-BADVER: no-op wins over int4 validity (finding #1 / edge #27) — an already-closed session with a MALFORMED expectedVersion (0, below the int4 min of 1) still no-op-succeeds because the int4 check runs AFTER the terminal no-op; the SAME 0 on an OPEN session reaches the mutate branch and is STALE_VERSION, proving the ordering", async () => {
    const tenantId = await seedTenant("active", "active");
    // (a) already-closed + malformed expectedVersion 0 -> the terminal no-op branch catches it FIRST,
    //     so it succeeds with the unchanged version and emits no event (the int4 guard never runs).
    const closed = await seedSession(tenantId, { status: "closed" });
    const noop = await close(tenantId, { sessionId: closed.sessionId, expectedVersion: 0 });
    expect(noop).toMatchObject({ status: "closed", version: closed.version, replayed: false });
    expect(await sessionEvents(closed.sessionId)).toHaveLength(0);
    // (b) the SAME malformed 0 on an OPEN session passes the no-op + transition guards and reaches the
    //     mutate branch, where the int4 check rejects it -> STALE_VERSION, zero mutation. Same input,
    //     opposite outcome: the ONLY difference is whether the no-op branch fired first (finding #1).
    const open = await seedSession(tenantId, { status: "open" });
    await expectCloseReject(
      () => close(tenantId, { sessionId: open.sessionId, expectedVersion: 0 }),
      "STALE_VERSION",
    );
    expect(await sessionState(open.sessionId)).toMatchObject({
      status: "open",
      version: open.version,
    });
  });

  it("C-RACE: two competing closers sharing the initial version -> exactly one real close (one session.closed event, version+1); the loser reads the now-closed row under FOR UPDATE and idempotently no-ops (NOT STALE_VERSION, NOT a double event) — competing-writer coverage mirroring updateSession's U-RACE", async () => {
    const tenantId = await seedTenant("active", "active");
    const { sessionId, version } = await seedSession(tenantId, { status: "open" });
    // Gate BOTH closers behind a holder's FOR UPDATE so the race is DETERMINISTIC: they are in-flight
    // and contend on the same session row, never accidentally sequential. The holder only HOLDS the
    // row (no mutation), so on release the version is still `version`; the two closers then serialize
    // on FOR UPDATE. Unlike updateSession's U-RACE (distinct patches -> loser hits STALE_VERSION),
    // close's loser sees status='closed' after the winner commits and takes the idempotent no-op
    // branch — so BOTH resolve successfully, but only ONE mutates and emits an event.
    const holder = await ctx.appPool.connect();
    let a: Promise<unknown> | undefined;
    let b: Promise<unknown> | undefined;
    try {
      await holder.query("BEGIN");
      await holder.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      await holder.query(`SELECT id FROM sessions WHERE id = $1 FOR UPDATE`, [sessionId]);
      const holderPid = (
        (await holder.query(`SELECT pg_backend_pid() AS pid`)).rows[0] as { pid: number }
      ).pid;
      // Two real closeSession commands, both claiming the SAME initial version, each a distinct
      // commandId (so their per-command advisory locks do not serialize — only the session FOR UPDATE
      // does). Capture both outcomes (never reject) so neither leaks.
      a = close(tenantId, { sessionId, expectedVersion: version }).then(
        (r) => r,
        (e: unknown) => e,
      );
      b = close(tenantId, { sessionId, expectedVersion: version }).then(
        (r) => r,
        (e: unknown) => e,
      );
      // Require BOTH blocked before releasing: proves the loser read the row UNDER the FOR UPDATE it
      // lost, so its no-op exercises the POST-lock terminal-state re-check, not a pre-lock sequential
      // path a faulty guard would also pass.
      await waitUntilBlockedByHolder(holderPid, 2);
      await holder.query("COMMIT"); // release; the two closers now serialize on FOR UPDATE
      const results = await Promise.all([a, b]);
      a = undefined;
      b = undefined;
      // Neither errored: one real close, one idempotent no-op — both report the terminal {closed, v+1}.
      const failures = results.filter((r) => r instanceof SessionCloseError);
      expect(failures).toHaveLength(0);
      for (const r of results) {
        expect(r).toMatchObject({
          sessionId,
          status: "closed",
          version: version + 1,
          replayed: false,
        });
      }
      // Exactly ONE mutation + ONE event: the no-op wrote nothing.
      expect(await sessionState(sessionId)).toMatchObject({
        status: "closed",
        version: version + 1,
      });
      expect(await sessionEvents(sessionId)).toHaveLength(1);
    } finally {
      await holder.query("ROLLBACK").catch(() => undefined);
      if (a) await a;
      if (b) await b;
      holder.release();
    }
  });
});
