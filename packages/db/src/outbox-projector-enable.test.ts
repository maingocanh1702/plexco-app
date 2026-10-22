/**
 * Lane L24, unit U2 (rows EN-1..EN-8; unit U2b appends EN-9..EN-15 and reuses the helpers): the owner
 * enable CLI (scripts/outbox-projector-enable.mjs, enableProjector) against a REAL per-file database.
 * Rows and design: docs/sessions/web-mvp-phase3-readiness-p3-outbox-projector-enable-no-loss.md 3.2, 6.3.
 *
 * The loss being repaired: an event produced while its projector is off is acked by the worker's own
 * definers with the required set of that moment, '{}' (claim_outbox_batch -> outbox_required_projectors ->
 * ack_outbox_event), so it never gets a delivery row. Each row below owns a projector of its own
 * (en<N>_test, routed for its own aggregate type) because the CLI scans the full history: one row's events
 * never reach another row's projector. EN-4 alone uses the three seeded projectors, disables them again and
 * leaves its own events' pending rows behind (no dispatcher runs here). Ages are set on the DB clock.
 */
import { spawnSync } from "node:child_process";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error -- the owner CLI is an untyped .mjs; the three exports used here are typed below
import * as cli from "../../../scripts/outbox-projector-enable.mjs";
import { setupRlsTestContext, withJobDefinerLock, type RlsTestContext } from "./test-harness.js";

type EnableSummary = {
  projector: string;
  changed: boolean;
  prepared: number;
  expired_age: number;
  expired_cap: number;
  rebuilt_sessions: number;
};
type Why = "age" | "cap";
const enableProjector = cli.enableProjector as (
  client: pg.Client,
  projector: string,
) => Promise<EnableSummary>;
const BACKFILL_MAX_ROWS = cli.BACKFILL_MAX_ROWS as number;
const BACKFILL_MAX_AGE_MINUTES = cli.BACKFILL_MAX_AGE_MINUTES as number;

const DB_NAME = "plexco_outbox_projector_enable";
const BASE = process.env.DATABASE_URL_TEST!;
const HOUR = 3_600_000;
const EXPIRED = "projector_delivery_expired";
let ctx: RlsTestContext;

beforeAll(async () => {
  ctx = await setupRlsTestContext(DB_NAME);
});
afterAll(async () => {
  await ctx?.teardown();
});

type Row = Record<string, unknown>;
const rows = async (sql: string, params: unknown[] = []) =>
  (await ctx.owner.query(sql, params)).rows as Row[];
const one = async (sql: string, params: unknown[] = []) => (await rows(sql, params))[0]!;
const worker = (sql: string, params: unknown[] = []) => ctx.workerPool.query(sql, params);
const byEvent = (a: Row, b: Row) => String(a.event_id).localeCompare(String(b.event_id));
const byJob = (a: Row, b: Row) => String(a.job_id).localeCompare(String(b.job_id));

/** The registry test's owner path: superuser seat + SET LOCAL ROLE job_definer, under the jobd reader lock. */
async function ownerPath<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  return withJobDefinerLock(BASE, async () => {
    await ctx.owner.query("BEGIN");
    try {
      await ctx.owner.query("SET LOCAL ROLE job_definer");
      const result = await fn(ctx.owner);
      await ctx.owner.query("COMMIT");
      return result;
    } catch (error) {
      await ctx.owner.query("ROLLBACK");
      throw error;
    }
  });
}

/** The raw switch; outbox_projector_set_enabled(name, false) is the DD-134 rollback. */
const setEnabled = (name: string, enabled: boolean) =>
  ownerPath(async (c) => {
    const r = await c.query("SELECT outbox_projector_set_enabled($1, $2) AS changed", [
      name,
      enabled,
    ]);
    return r.rows[0].changed as boolean;
  });

/** The CLI's enable as the CLI runs it: a plain owner seat (it sets job_definer itself), under the reader lock. */
const enable = (projector: string, client: pg.Client = ctx.owner) =>
  withJobDefinerLock(BASE, () => enableProjector(client, projector));

/** The summary of a run on `projector`: changed and zero counts unless `counts` says otherwise. */
const summary = (projector: string, counts: Partial<EnableSummary> = {}): EnableSummary => ({
  projector,
  changed: true,
  prepared: 0,
  expired_age: 0,
  expired_cap: 0,
  rebuilt_sessions: 0,
  ...counts,
});

/** A second owner seat into this file's database: a plain pg.Client, the CLI's own connection shape. */
async function ownerSeat(): Promise<pg.Client> {
  const url = new URL(BASE);
  url.pathname = `/${DB_NAME}`;
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  return client;
}

/** The event type this file's events carry unless a row names another; its own projectors route it. */
const EVENT_TYPE = "en.test.event";

/**
 * A projector of this file's own, seeded disabled, routed for EVENT_TYPE on one aggregate type. The route
 * names the type because outbox_projector_routes_wildcard_chk (0056) allows a NULL event_type only for
 * web_realtime.
 */
async function addProjector(name: string, aggregateType: string): Promise<void> {
  await ownerPath(async (c) => {
    const r = await c.query("INSERT INTO outbox_projectors (name) VALUES ($1) RETURNING enabled", [
      name,
    ]);
    expect(r.rows[0].enabled).toBe(false);
    await c.query(
      "INSERT INTO outbox_projector_routes (projector, aggregate_type, event_type) VALUES ($1, $2, $3)",
      [name, aggregateType, EVENT_TYPE],
    );
  });
}

/** `n` events of one type for a tenant, created now on the DB clock; ids in the order returned. */
async function seed(aggregateType: string, n: number, tenantId = ctx.tenantA, type = EVENT_TYPE) {
  const r = await rows(
    `INSERT INTO outbox_events (tenant_id, aggregate_type, aggregate_id, sequence, type, payload)
     SELECT $1::uuid, $2::text, gen_random_uuid(), 1, $3::text, '{"k": "v"}'::jsonb
       FROM generate_series(1, $4::int)
     RETURNING id`,
    [tenantId, aggregateType, type, n],
  );
  return r.map((x) => x.id as string);
}
const seedOne = async (aggregateType: string, tenantId = ctx.tenantA, type = EVENT_TYPE) =>
  (await seed(aggregateType, 1, tenantId, type))[0]!;

/** Ages events on the DB clock: ids[i] gets created_at = now() - `minutes` minutes - i * `stepSeconds` s. */
async function age(ids: string[], minutes: number, stepSeconds = 0): Promise<void> {
  await ctx.owner.query(
    `UPDATE outbox_events o
        SET created_at = now() - make_interval(mins => $2::int, secs => ($3::int * (x.ord - 1))::float8)
       FROM unnest($1::uuid[]) WITH ORDINALITY AS x(id, ord)
      WHERE o.id = x.id`,
    [ids, minutes, stepSeconds],
  );
}

/**
 * The worker's cycle while the projector is off: claim through the real definers, read the required set
 * ('{}' for every event of `ids`) and ack with it. Events in `keep` stay claimed (live lease) and unacked;
 * their claim tokens are returned. Any other claimable event is acked the same way, keeping the queue clean.
 */
async function drain(ids: string[], keep: string[] = []): Promise<Map<string, string>> {
  const todo = new Set(ids);
  const tokens = new Map<string, string>();
  for (let round = 0; todo.size > 0; round += 1) {
    const claimed = (await worker("SELECT * FROM claim_outbox_batch(100)")).rows as {
      event_id: string;
      claim_token: string;
    }[];
    if (round > 20 || claimed.length === 0)
      throw new Error(`never claimed: ${[...todo].join(", ")}`);
    for (const { event_id: id, claim_token: token } of claimed) {
      todo.delete(id);
      if (keep.includes(id)) {
        tokens.set(id, token);
        continue;
      }
      const set = (await worker("SELECT outbox_required_projectors($1) AS p", [id])).rows[0]
        .p as string[];
      if (ids.includes(id)) expect(set).toEqual([]);
      const ack = await worker("SELECT ack_outbox_event($1, $2, $3) AS ok", [id, set, token]);
      expect(ack.rows[0].ok).toBe(true);
    }
  }
  return tokens;
}

/** The projector's delivery rows for `ids`, by event id. */
const deliveries = async (projector: string, ids: string[]) =>
  (
    await rows(
      "SELECT event_id, status, attempts FROM projector_deliveries WHERE projector = $1 AND event_id = ANY($2::uuid[])",
      [projector, ids],
    )
  ).sort(byEvent);
/** What a backfill prepares: one fresh pending row per event. */
const pending = (ids: string[]) =>
  ids.map((id) => ({ event_id: id, status: "pending", attempts: 0 })).sort(byEvent);
/** The prepare audit job_prepare_projector_delivery writes (0022:312), counted for one event. */
const preparedAudits = async (id: string) =>
  (
    await rows(
      "SELECT 1 FROM job_audit_events WHERE job_id = $1 AND starts_with(reason, 'projector_delivery_prepared')",
      [id],
    )
  ).length;

/**
 * Asserts the projector's expiry records for `ids` exactly: one per expected event, with that event's
 * tenant_id, actor 'owner', fn_name 'outbox_projector_enable', reason '<prefix>:age' or ':cap', and ONE
 * operation_id shared by the run that wrote them (pass only one run's ids).
 */
async function expectRecords(projector: string, ids: string[], expected: [string, string, Why][]) {
  const got = (
    await rows(
      `SELECT job_id, tenant_id, actor, reason, fn_name, operation_id FROM job_audit_events
        WHERE starts_with(reason, $1) AND job_id = ANY($2::uuid[])`,
      [`${EXPIRED}:${projector}:`, ids],
    )
  ).sort(byJob);
  const operationId = got[0]?.operation_id;
  if (got.length > 0) expect(operationId).toEqual(expect.any(String));
  expect(got).toEqual(
    expected
      .map(([id, tenantId, why]) => ({
        job_id: id,
        tenant_id: tenantId,
        actor: "owner",
        reason: `${EXPIRED}:${projector}:${why}`,
        fn_name: "outbox_projector_enable",
        operation_id: operationId,
      }))
      .sort(byJob),
  );
}

describe("EN-1..EN-8 the owner enable CLI reaches events acked while their projector was off", () => {
  it("EN-1: acked '{}' while off: 29 minutes old -> one pending row (attempts 0, prepare audit), 31 -> one ':age' record and no row; the same on a re-enable after a disable (S2)", async () => {
    expect(BACKFILL_MAX_AGE_MINUTES).toBe(30);
    await addProjector("en1_test", "en1_test_aggregate");
    const within = await seedOne("en1_test_aggregate");
    const beyond = await seedOne("en1_test_aggregate");
    await drain([within, beyond]);
    await age([within], BACKFILL_MAX_AGE_MINUTES - 1);
    await age([beyond], BACKFILL_MAX_AGE_MINUTES + 1);
    expect(await enable("en1_test")).toEqual(summary("en1_test", { prepared: 1, expired_age: 1 }));
    expect(await deliveries("en1_test", [within, beyond])).toEqual(pending([within]));
    expect(await preparedAudits(within)).toBe(1);
    expect(await preparedAudits(beyond)).toBe(0);
    await expectRecords("en1_test", [within, beyond], [[beyond, ctx.tenantA, "age"]]);

    // S2: the DD-134 rollback, events produced and acked while off again, then the CLI re-enables.
    expect(await setEnabled("en1_test", false)).toBe(true);
    const within2 = await seedOne("en1_test_aggregate");
    const beyond2 = await seedOne("en1_test_aggregate");
    await drain([within2, beyond2]);
    await age([within2], BACKFILL_MAX_AGE_MINUTES - 1);
    await age([beyond2], BACKFILL_MAX_AGE_MINUTES + 1);
    expect(await enable("en1_test")).toEqual(summary("en1_test", { prepared: 1, expired_age: 1 }));
    // the first run's pending row survived the disable untouched (DD-134 keeps pending rows)
    expect(await deliveries("en1_test", [within, beyond, within2, beyond2])).toEqual(
      pending([within, within2]),
    );
    await expectRecords("en1_test", [within2, beyond2], [[beyond2, ctx.tenantA, "age"]]);
    await expectRecords("en1_test", [within, beyond], [[beyond, ctx.tenantA, "age"]]);
  });

  it("EN-2: more than BACKFILL_MAX_ROWS acked in-window candidates -> the newest are prepared, the rest ':cap'; the summary counts match", async () => {
    expect(BACKFILL_MAX_ROWS).toBe(200);
    const extra = 3;
    await addProjector("en2_test", "en2_test_aggregate");
    const ids = await seed("en2_test_aggregate", BACKFILL_MAX_ROWS + extra);
    await drain(ids);
    await age(ids, 1, 5); // ids[i] is 1 minute + 5 i seconds old: all inside the bound, ids[0] the newest
    expect(60 + 5 * (ids.length - 1)).toBeLessThan(BACKFILL_MAX_AGE_MINUTES * 60);
    expect(await enable("en2_test")).toEqual(
      summary("en2_test", { prepared: BACKFILL_MAX_ROWS, expired_cap: extra }),
    );
    expect(await deliveries("en2_test", ids)).toEqual(pending(ids.slice(0, BACKFILL_MAX_ROWS)));
    await expectRecords(
      "en2_test",
      ids,
      ids.slice(BACKFILL_MAX_ROWS).map((id): [string, string, Why] => [id, ctx.tenantA, "cap"]),
    );
  }, 60_000);

  it("EN-3: a second run is a no-op: changed=false, zero counts, still one row or one record per (event, projector)", async () => {
    await addProjector("en3_test", "en3_test_aggregate");
    const within = await seedOne("en3_test_aggregate");
    const beyond = await seedOne("en3_test_aggregate");
    await drain([within, beyond]);
    await age([beyond], BACKFILL_MAX_AGE_MINUTES + 1);
    expect(await enable("en3_test")).toEqual(summary("en3_test", { prepared: 1, expired_age: 1 }));
    expect(await enable("en3_test")).toEqual(summary("en3_test", { changed: false }));
    expect(await deliveries("en3_test", [within, beyond])).toEqual(pending([within]));
    expect(await preparedAudits(within)).toBe(1);
    await expectRecords("en3_test", [within, beyond], [[beyond, ctx.tenantA, "age"]]);
  });

  it("EN-4: only routed types are candidates: a zalo_dm non-route gets neither, the web_realtime wildcard covers session types, tenant-aggregate public_sessions types are candidates", async () => {
    const seeded = ["zalo_dm", "web_realtime", "public_sessions"];
    const zalo = await one(
      `SELECT aggregate_type, coalesce(event_type, 'en4.zalo.event') AS event_type FROM outbox_projector_routes
        WHERE projector = 'zalo_dm' ORDER BY event_type NULLS LAST LIMIT 1`,
    );
    const tenantRoute = await one(
      `SELECT coalesce(event_type, 'en4.tenant.event') AS event_type FROM outbox_projector_routes
        WHERE projector = 'public_sessions' AND aggregate_type = 'tenant' ORDER BY event_type NULLS LAST LIMIT 1`,
    );
    const notRouted = "en4.not.routed";
    expect(
      await rows(
        `SELECT 1 FROM outbox_projector_routes WHERE projector = 'zalo_dm' AND aggregate_type = 'session'
            AND (event_type IS NULL OR event_type = $1)`,
        [notRouted],
      ),
    ).toEqual([]);
    const sessionEvent = await seedOne("session", ctx.tenantA, notRouted);
    const zaloEvent = await seedOne(
      String(zalo.aggregate_type),
      ctx.tenantA,
      String(zalo.event_type),
    );
    const tenantEvent = await seedOne("tenant", ctx.tenantA, String(tenantRoute.event_type));
    const unrouted = await seedOne("en4_unrouted_aggregate");
    const all = [sessionEvent, zaloEvent, tenantEvent, unrouted];
    await drain(all);
    try {
      for (const p of seeded) expect((await enable(p)).changed).toBe(true);
      const has = async (p: string) => (await deliveries(p, all)).map((r) => r.event_id);
      expect(await has("zalo_dm")).toContain(zaloEvent);
      expect(await has("zalo_dm")).not.toContain(sessionEvent);
      expect(await has("web_realtime")).toContain(sessionEvent);
      expect(await has("public_sessions")).toContain(tenantEvent);
      for (const p of seeded) {
        expect(await has(p)).not.toContain(unrouted);
        await expectRecords(p, all, []);
      }
    } finally {
      for (const p of seeded) await setEnabled(p, false);
    }
  }, 30_000);

  it("EN-5: an event claimed (live lease) but unacked at the scan is a candidate: a row, never a record; its later ack without the projector still succeeds", async () => {
    await addProjector("en5_test", "en5_test_aggregate");
    const inflight = await seedOne("en5_test_aggregate");
    const tokens = await drain([inflight], [inflight]);
    expect(
      await one(
        "SELECT acked_at, lease_expires_at > now() AS live FROM outbox_events WHERE id = $1",
        [inflight],
      ),
    ).toEqual({ acked_at: null, live: true });
    expect(await enable("en5_test")).toEqual(summary("en5_test", { prepared: 1 }));
    expect(await deliveries("en5_test", [inflight])).toEqual(pending([inflight]));
    await expectRecords("en5_test", [inflight], []);
    const ack = await worker("SELECT ack_outbox_event($1, $2, $3) AS ok", [
      inflight,
      [],
      tokens.get(inflight),
    ]);
    expect(ack.rows[0].ok).toBe(true);
    expect(await deliveries("en5_test", [inflight])).toEqual(pending([inflight]));
    await expectRecords("en5_test", [inflight], []);
  });

  it("EN-6: an event with any row for the projector (pending, failed, delivered, dlq) gets no prepare and no record, even past the bound", async () => {
    await addProjector("en6_test", "en6_test_aggregate");
    expect(await setEnabled("en6_test", true)).toBe(true);
    const ids: string[] = [];
    for (const outcome of ["delivered", "retry", "dlq", null] as const) {
      const id = await seedOne("en6_test_aggregate");
      ids.push(id);
      await worker("SELECT job_prepare_projector_delivery($1, $2)", [id, "en6_test"]);
      if (outcome === null) continue;
      const claim = await worker("SELECT * FROM claim_projector_delivery_batch($1, 1)", [
        "en6_test",
      ]);
      await worker("SELECT complete_projector_delivery($1, $2, $3, $4, $5, NULL, $6)", [
        id,
        "en6_test",
        claim.rows[0].claim_token,
        outcome,
        outcome === "retry" ? new Date(Date.now() + HOUR) : null,
        outcome === "delivered" ? null : "test_terminal",
      ]);
    }
    expect(await setEnabled("en6_test", false)).toBe(true);
    await drain(ids);
    await age(ids.slice(0, 2), BACKFILL_MAX_AGE_MINUTES + 1);
    const before = await deliveries("en6_test", ids);
    expect(before.map((r) => r.status).sort()).toEqual(["delivered", "dlq", "failed", "pending"]);
    expect(await enable("en6_test")).toEqual(summary("en6_test"));
    expect(await deliveries("en6_test", ids)).toEqual(before);
    await expectRecords("en6_test", ids, []);
  });

  it("EN-7: two CLI runs at once on two owner seats -> still one row or one record per (event, projector)", async () => {
    await addProjector("en7_test", "en7_test_aggregate");
    const ids = await seed("en7_test_aggregate", 4);
    await drain(ids);
    await age(ids.slice(2), BACKFILL_MAX_AGE_MINUTES + 1);
    const seats = [await ownerSeat(), await ownerSeat()];
    const runs = await withJobDefinerLock(BASE, () =>
      Promise.all(seats.map((seat) => enableProjector(seat, "en7_test"))),
    ).finally(() => Promise.all(seats.map((seat) => seat.end())));
    expect(runs.filter((r) => r.changed)).toHaveLength(1);
    expect(runs.reduce((n, r) => n + r.prepared, 0)).toBe(2);
    expect(runs.reduce((n, r) => n + r.expired_age, 0)).toBe(2);
    expect(await deliveries("en7_test", ids)).toEqual(pending(ids.slice(0, 2)));
    await expectRecords(
      "en7_test",
      ids,
      ids.slice(2).map((id): [string, string, Why] => [id, ctx.tenantA, "age"]),
    );
  }, 30_000);

  it("EN-8: one run over two tenants writes each record with its own event's tenant_id", async () => {
    await addProjector("en8_test", "en8_test_aggregate");
    const a = await seedOne("en8_test_aggregate", ctx.tenantA);
    const b = await seedOne("en8_test_aggregate", ctx.tenantB);
    const bWithin = await seedOne("en8_test_aggregate", ctx.tenantB);
    await drain([a, b, bWithin]);
    await age([a, b], BACKFILL_MAX_AGE_MINUTES + 1);
    expect(await enable("en8_test")).toEqual(summary("en8_test", { prepared: 1, expired_age: 2 }));
    await expectRecords(
      "en8_test",
      [a, b, bWithin],
      [
        [a, ctx.tenantA, "age"],
        [b, ctx.tenantB, "age"],
      ],
    );
    expect(await deliveries("en8_test", [a, b, bWithin])).toEqual(pending([bWithin]));
  });
});

/** The per-file database's owner URL: the CLI gets it only through its child environment. */
function ownerUrl(): string {
  const url = new URL(BASE);
  url.pathname = `/${DB_NAME}`;
  return url.toString();
}

type CliRun = { status: number | null; stdout: string; stderr: string };

/**
 * `node scripts/outbox-projector-enable.mjs <args>` as the runbook runs it: cwd = the repo root, the owner
 * credential only in the child's DATABASE_URL_MIGRATION (`url`; "" leaves it unset), under the reader lock.
 */
const runCli = (args: string[], url = ownerUrl()): Promise<CliRun> =>
  withJobDefinerLock(BASE, async () => {
    const run = spawnSync(process.execPath, ["scripts/outbox-projector-enable.mjs", ...args], {
      cwd: new URL("../../../", import.meta.url),
      env: { ...process.env, DATABASE_URL_MIGRATION: url },
      encoding: "utf8",
      timeout: 30_000,
    });
    return { status: run.status, stdout: run.stdout, stderr: run.stderr };
  });

/** Neither stream of a CLI run carries the owner URL, its password or any of `texts`. */
function expectNoSecret(run: CliRun, ...texts: string[]): void {
  const url = ownerUrl();
  const secrets = [url, decodeURIComponent(new URL(url).password), ...texts].filter(Boolean);
  for (const stream of [run.stdout, run.stderr]) {
    for (const secret of secrets) expect(stream).not.toContain(secret);
  }
}

const isEnabled = async (name: string) =>
  (await one("SELECT enabled FROM outbox_projectors WHERE name = $1", [name])).enabled;

/** The DD-134 disable on the superuser seat, for a caller that already holds the reader lock. */
async function disableInsideLock(name: string): Promise<void> {
  await ctx.owner.query("BEGIN");
  try {
    await ctx.owner.query("SET LOCAL ROLE job_definer");
    await ctx.owner.query("SELECT outbox_projector_set_enabled($1, false)", [name]);
    await ctx.owner.query("COMMIT");
  } catch (error) {
    await ctx.owner.query("ROLLBACK");
    throw error;
  }
}

/** A public_sessions route of the session aggregate (0056 names its event type: no wildcard). */
const sessionRouteType = async () =>
  String(
    (
      await one(
        `SELECT event_type FROM outbox_projector_routes
          WHERE projector = 'public_sessions' AND aggregate_type = 'session' ORDER BY event_type LIMIT 1`,
      )
    ).event_type,
  );

/** What the public_sessions rebuild projects (D7): the candidates of every tenant with an outbox event. */
const rebuildCandidates = () =>
  ownerPath(async (c) =>
    (
      await c.query(
        `SELECT s AS id FROM (SELECT DISTINCT tenant_id FROM outbox_events) t,
                public_sessions_tenant_candidates(t.tenant_id) AS s`,
      )
    ).rows.map((r) => r.id as string),
  );

const isPublic = async (sessionId: string) =>
  (await rows("SELECT 1 FROM public_sessions WHERE id = $1", [sessionId])).length === 1;

/** Audit rows other than the CLI's records and the switch's own: what a rebuild would add. */
const otherAudits = async () =>
  Number(
    (
      await one(
        `SELECT count(*) AS n FROM job_audit_events
          WHERE fn_name IS DISTINCT FROM 'outbox_projector_enable'
            AND fn_name IS DISTINCT FROM 'outbox_projector_set_enabled'`,
      )
    ).n,
  );

describe("EN-9..EN-15 the owner enable CLI rebuilds, refuses, recovers and prints counts only", () => {
  // EN-12 (A5 kept): outbox-projector-registry.test.ts runs in the same locked command; nothing here asserts on it.

  it("EN-9: public_sessions is rebuilt from canonical state: a session published while off, its event past the bound -> ':age' record and public after the run (rebuilt_sessions counts it); one cancelled while off -> its public row deleted; the rebuild writes no audit row", async () => {
    const type = await sessionRouteType();
    const tenantId = String(
      (
        await one(
          `INSERT INTO tenants (name, slug, public_alias, public_alias_status)
           VALUES ('EN9 Club', 'en9-club', 'CLB EN9', 'approved') RETURNING id`,
        )
      ).id,
    );
    // public-sessions-projector.test.ts's open public session, minimum columns
    const openSession = async () =>
      String(
        (
          await one(
            `INSERT INTO sessions (tenant_id, sport_id, starts_at, ends_at, timezone, venue_name, venue_address,
               area, price_amount, slots_max, visibility, join_policy, status)
             VALUES ($1, $2, now() + interval '1 day', now() + interval '26 hours', 'Asia/Ho_Chi_Minh',
               'EN9 Venue', '1 Public Street', 'Quan 7', 50000, 10, 'public', 'open', 'open')
             RETURNING id`,
            [tenantId, ctx.badmintonSportId],
          )
        ).id,
      );
    const cancelled = await openSession();
    await worker("SELECT public_sessions_project_session($1, NULL)", [cancelled]); // public while it ran
    expect(await isPublic(cancelled)).toBe(true);
    await ctx.owner.query("UPDATE sessions SET status = 'cancelled' WHERE id = $1", [cancelled]);
    const published = await openSession();
    const events = [
      await seedOne("session", tenantId, type),
      await seedOne("session", tenantId, type),
    ];
    await drain(events);
    await age(events, BACKFILL_MAX_AGE_MINUTES + 1);
    expect(await isPublic(published)).toBe(false);
    const candidates = await rebuildCandidates();
    expect(candidates).toContain(published);
    const auditsBefore = await otherAudits();
    try {
      expect(await enable("public_sessions")).toEqual(
        summary("public_sessions", { expired_age: 2, rebuilt_sessions: candidates.length }),
      );
      expect(await isPublic(published)).toBe(true);
      expect(await isPublic(cancelled)).toBe(false);
      expect(await deliveries("public_sessions", events)).toEqual([]);
      await expectRecords(
        "public_sessions",
        events,
        events.map((id): [string, string, Why] => [id, tenantId, "age"]),
      );
      expect(await otherAudits()).toBe(auditsBefore);
    } finally {
      await setEnabled("public_sessions", false);
    }
  }, 30_000);

  it("EN-9 (rejected alias): a club whose alias was rejected while off keeps no stale public row: its row, public while it ran, is gone after the run, as 0067's writer decides (no approved alias -> not listable -> no row); the event past the bound gets one ':age' record; the rebuild writes no audit row", async () => {
    const tenantId = String(
      (
        await one(
          `INSERT INTO tenants (name, slug, public_alias, public_alias_status)
           VALUES ('EN9R Club', 'en9r-club', 'CLB EN9R', 'approved') RETURNING id`,
        )
      ).id,
    );
    // EN-9's open public session, minimum columns: listable in every way but the alias
    const sessionId = String(
      (
        await one(
          `INSERT INTO sessions (tenant_id, sport_id, starts_at, ends_at, timezone, venue_name, venue_address,
             area, price_amount, slots_max, visibility, join_policy, status)
           VALUES ($1, $2, now() + interval '1 day', now() + interval '26 hours', 'Asia/Ho_Chi_Minh',
             'EN9R Venue', '2 Public Street', 'Quan 7', 50000, 10, 'public', 'open', 'open')
           RETURNING id`,
          [tenantId, ctx.badmintonSportId],
        )
      ).id,
    );
    await worker("SELECT public_sessions_project_session($1, NULL)", [sessionId]); // public while it ran
    expect(await isPublic(sessionId)).toBe(true);
    // while off: public-sessions-projector.test.ts PSP-4's rejection; the view hides the club, the row stays
    await ctx.owner.query("UPDATE tenants SET public_alias_status = 'rejected' WHERE id = $1", [
      tenantId,
    ]);
    const event = await seedOne("tenant", tenantId, "tenant.public_alias_rejected");
    await drain([event]);
    await age([event], BACKFILL_MAX_AGE_MINUTES + 1);
    expect(await isPublic(sessionId)).toBe(true); // stale until a rebuild
    const candidates = await rebuildCandidates();
    expect(candidates).toContain(sessionId);
    const tenantRows = async () =>
      Number(
        (await one("SELECT count(*) AS n FROM public_sessions WHERE tenant_id = $1", [tenantId])).n,
      );
    const auditsBefore = await otherAudits();
    try {
      expect(await enable("public_sessions")).toEqual(
        summary("public_sessions", { expired_age: 1, rebuilt_sessions: candidates.length }),
      );
      expect(await tenantRows()).toBe(0);
      expect(await deliveries("public_sessions", [event])).toEqual([]);
      await expectRecords("public_sessions", [event], [[event, tenantId, "age"]]);
      expect(await otherAudits()).toBe(auditsBefore);
    } finally {
      await setEnabled("public_sessions", false);
    }
  }, 30_000);

  it("EN-10: refusals exit 2 with nothing written (bad arguments before connecting, an unknown projector, a disable between the two transactions); success prints ONE JSON line of the summary keys; no credential or payload in either stream", async () => {
    await addProjector("en10_test", "en10_test_aggregate");
    const within = await seedOne("en10_test_aggregate");
    const beyond = await seedOne("en10_test_aggregate");
    const payloadText = "en10 payload text the CLI never prints";
    await ctx.owner.query(
      "UPDATE outbox_events SET payload = jsonb_build_object('text', $2::text) WHERE id = $1",
      [within, payloadText],
    );
    await drain([within, beyond]);
    await age([beyond], BACKFILL_MAX_AGE_MINUTES + 1);
    const nothingWritten = async () => {
      expect(await isEnabled("en10_test")).toBe(false);
      expect(await deliveries("en10_test", [within, beyond])).toEqual([]);
      await expectRecords("en10_test", [within, beyond], []);
    };

    // Argument errors are refused before connecting: with DATABASE_URL_MIGRATION unset ("") a run that got
    // past parsing ends in exit 1 instead. A DSN argument is one of them: the connection is environment only.
    const badArgs = [
      [],
      ["enable", "--projector", "Bad-Name"],
      ["enable", "--projector", "en10_test", ownerUrl()],
    ];
    for (const args of badArgs) {
      const run = await runCli(args, "");
      expect([run.status, run.stdout]).toEqual([2, ""]);
      expect(run.stderr).toMatch(/^refused: invalid_argument: /);
      expectNoSecret(run);
    }
    const unset = await runCli(["enable", "--projector", "en10_test"], "");
    expect([unset.status, unset.stdout]).toEqual([1, ""]);
    expect(unset.stderr).toContain("DATABASE_URL_MIGRATION is not set");
    const unknown = await runCli(["enable", "--projector", "en10_unknown"]);
    expect([unknown.status, unknown.stdout]).toEqual([2, ""]);
    expect(unknown.stderr).toContain("refused: projector_not_found: en10_unknown");
    expectNoSecret(unknown);
    await nothingWritten();

    // projector_disabled: a disable commits between transaction 1 (the enable) and transaction 2 (the
    // backfill). The seam is the CLI's own client, whose first COMMIT ends transaction 1; main() maps every
    // Refusal to exit 2, as the unknown-projector run above shows.
    const seat = await ownerSeat();
    const send = seat.query.bind(seat) as (
      sql: string,
      params?: unknown[],
    ) => Promise<pg.QueryResult>;
    let commits = 0;
    Object.assign(seat, {
      query: async (sql: string, params?: unknown[]) => {
        const result = await send(sql, params);
        if (sql === "COMMIT") {
          commits += 1;
          if (commits === 1) await disableInsideLock("en10_test");
        }
        return result;
      },
    });
    try {
      await expect(enable("en10_test", seat)).rejects.toMatchObject({
        name: "Refusal",
        code: "projector_disabled",
      });
    } finally {
      await seat.end();
    }
    expect(commits).toBe(1);
    await nothingWritten();

    const run = await runCli(["enable", "--projector", "en10_test"]);
    expect(run.status, run.stderr).toBe(0);
    const [line, ...rest] = run.stdout.split("\n");
    expect(rest).toEqual([""]); // exactly one line
    // exactly the 3.2 step 4 keys: the projector name, the changed flag and counts (no operation_id)
    expect(JSON.parse(line!)).toStrictEqual(summary("en10_test", { prepared: 1, expired_age: 1 }));
    expectNoSecret(run, payloadText);
  }, 60_000);

  it("EN-11: a raw enable (the old path, no backfill) then the CLI -> changed=false, the in-bound event prepared, the older one ':age', the rebuild run", async () => {
    const type = await sessionRouteType();
    const within = await seedOne("session", ctx.tenantA, type);
    const beyond = await seedOne("session", ctx.tenantA, type);
    await drain([within, beyond]);
    await age([beyond], BACKFILL_MAX_AGE_MINUTES + 1);
    try {
      expect(await setEnabled("public_sessions", true)).toBe(true);
      expect(await deliveries("public_sessions", [within, beyond])).toEqual([]);
      const candidates = await rebuildCandidates();
      expect(candidates.length).toBeGreaterThan(0);
      expect(await enable("public_sessions")).toEqual(
        summary("public_sessions", {
          changed: false,
          prepared: 1,
          expired_age: 1,
          rebuilt_sessions: candidates.length,
        }),
      );
      expect(await deliveries("public_sessions", [within, beyond])).toEqual(pending([within]));
      await expectRecords("public_sessions", [within, beyond], [[beyond, ctx.tenantA, "age"]]);
    } finally {
      await setEnabled("public_sessions", false);
    }
  }, 30_000);

  it("EN-13: an unacked routed event older than the bound -> exit 2 unacked_backlog with the count only; the projector stays disabled, no row, no record; the same refusal once it is enabled raw, nothing written", async () => {
    await addProjector("en13_test", "en13_test_aggregate");
    const stuck = await seedOne("en13_test_aggregate");
    await age([stuck], BACKFILL_MAX_AGE_MINUTES + 1);
    const refused = async () => {
      const run = await runCli(["enable", "--projector", "en13_test"]);
      expect([run.status, run.stdout]).toEqual([2, ""]);
      expect(run.stderr).toMatch(/^refused: unacked_backlog: 1 routed events are unacked/);
      expect(run.stderr).not.toContain(stuck);
      expectNoSecret(run);
      expect(await deliveries("en13_test", [stuck])).toEqual([]);
      await expectRecords("en13_test", [stuck], []);
    };
    await refused();
    expect(await isEnabled("en13_test")).toBe(false);
    try {
      expect(await setEnabled("en13_test", true)).toBe(true);
      await refused();
      expect(await isEnabled("en13_test")).toBe(true);
    } finally {
      await setEnabled("en13_test", false); // a later drain acks `stuck` with '{}'
    }
  }, 30_000);

  it("EN-14: an unacked in-window candidate beyond the cap gets a delivery row, never a record; the newest BACKFILL_MAX_ROWS acked are prepared, the rest ':cap' (AM5)", async () => {
    const extra = 2;
    await addProjector("en14_test", "en14_test_aggregate");
    const acked = await seed("en14_test_aggregate", BACKFILL_MAX_ROWS + extra);
    await drain(acked);
    await age(acked, 1, 5); // all inside the bound, acked[0] the newest
    const lagging = await seedOne("en14_test_aggregate"); // never claimed: unacked
    await age([lagging], BACKFILL_MAX_AGE_MINUTES - 5); // older than every acked one, inside the bound
    expect(60 + 5 * (acked.length - 1)).toBeLessThan((BACKFILL_MAX_AGE_MINUTES - 5) * 60);
    try {
      expect(await enable("en14_test")).toEqual(
        summary("en14_test", { prepared: BACKFILL_MAX_ROWS + 1, expired_cap: extra }),
      );
      expect(await deliveries("en14_test", [...acked, lagging])).toEqual(
        pending([...acked.slice(0, BACKFILL_MAX_ROWS), lagging]),
      );
      await expectRecords(
        "en14_test",
        [...acked, lagging],
        acked.slice(BACKFILL_MAX_ROWS).map((id): [string, string, Why] => [id, ctx.tenantA, "cap"]),
      );
    } finally {
      await setEnabled("en14_test", false); // `lagging` stays unacked: a later drain acks it with '{}'
    }
  }, 60_000);

  it("EN-15: the way forward after unacked_backlog: a worker cycle acks the old events with '{}', then the CLI succeeds and records each ':age'", async () => {
    await addProjector("en15_test", "en15_test_aggregate");
    const old = await seed("en15_test_aggregate", 2);
    await age(old, BACKFILL_MAX_AGE_MINUTES + 1);
    const refused = await runCli(["enable", "--projector", "en15_test"]);
    expect([refused.status, refused.stdout]).toEqual([2, ""]);
    expect(refused.stderr).toContain("refused: unacked_backlog: 2 routed events");
    expect(await isEnabled("en15_test")).toBe(false);
    await drain(old); // the cycle the runbook waits for: the projector is off, so each ack carries '{}'
    const run = await runCli(["enable", "--projector", "en15_test"]);
    expect(run.status, run.stderr).toBe(0);
    expect(JSON.parse(run.stdout)).toStrictEqual(summary("en15_test", { expired_age: 2 }));
    expect(await deliveries("en15_test", old)).toEqual([]);
    await expectRecords(
      "en15_test",
      old,
      old.map((id): [string, string, Why] => [id, ctx.tenantA, "age"]),
    );
  }, 30_000);
});
