import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate } from "@plexco/db";
import { describe, expect, it, vi } from "vitest";
import { withTestContext } from "./test-harness.js";
import {
  ROLE_PW,
  bootstrapJobDefiner,
  setAppWorkerPasswordRaceSafe,
  testUrl,
  withJobDefinerLock,
  type TestRolePasswordLease,
} from "./test-db.js";
import {
  ATTEMPTS_EXHAUSTED,
  ZALO_DM_MAX_AGE_MINUTES,
  ZALO_DM_UNTIL_SESSION_START,
  completionArgs,
  isReadableEventTime,
  normalizeErrorCode,
  runDispatchCycle,
  zaloDmAgeVerdict,
  zaloDmDeliveryAge,
  zaloDmPromotionStart,
  zaloDmStartVerdict,
  type DeliverFn,
} from "./dispatcher.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// The 0056 registry decides which projectors an event needs: every fixture registers this one,
// enabled, for the jrd test event type, and each cycle passes it in its own projector map.
const TEST_PROJECTOR = "jrd_test_projector";
const only = (deliver: DeliverFn) => new Map([[TEST_PROJECTOR, deliver]]);
// app_worker's password is CLUSTER-global: ROLE_PW.app_worker, leased for the fixture's lifetime
// (setAppWorkerPasswordRaceSafe) and restored by the last participant on the cluster.

// --- DB test setup: the stateless job_definer helpers now live in ./test-db.ts
// (shared with preflight.test.ts and schedule.test.ts); this file still owns its
// own DB fixtures below.

interface DispatcherTestContext {
  /** app_worker seat — the only identity production code ever calls the five granted functions as. */
  workerPool: pg.Pool;
  /** superuser seat — test fixture seeding and direct-state verification ONLY, never used to call
   *  the granted functions (that would prove nothing about app_worker's actual access). */
  verify: pg.Client;
  teardown: () => Promise<void>;
}

async function setupDispatcherContext(dbName: string): Promise<DispatcherTestContext> {
  const base = process.env.DATABASE_URL_TEST;
  if (!base) {
    throw new Error(
      "DATABASE_URL_TEST is required (docker compose -f infra/docker-compose.yml up -d postgres; " +
        "export DATABASE_URL_TEST=postgres://plexco:plexco_dev@localhost:5432/plexco_test)",
    );
  }
  const admin = new pg.Client({ connectionString: base });
  const migrationUrl = testUrl(base, { db: dbName });
  const directUrl = testUrl(base, {
    db: dbName,
    user: "app_worker",
    password: ROLE_PW.app_worker,
  });
  let created = false;
  let verify: pg.Client | undefined;
  let workerPool: pg.Pool | undefined;
  let passwords: TestRolePasswordLease | undefined;
  const teardown = async () => {
    const closed = await Promise.allSettled([workerPool?.end(), verify?.end()]);
    const released = await Promise.allSettled([passwords?.release()]); // after app_worker closed
    const errors = [...closed, ...released]
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason);
    if (errors.length) throw new AggregateError(errors, "Failed to close fixture connections");
    if (!created) return;
    const cleanup = new pg.Client({ connectionString: base });
    try {
      await cleanup.connect();
      await cleanup.query(`DROP DATABASE IF EXISTS ${dbName}`);
      created = false;
    } finally {
      await cleanup.end();
    }
  };

  const errors: unknown[] = [];
  try {
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${dbName}`);
    await admin.query(`CREATE DATABASE ${dbName}`);
    created = true;
    await withJobDefinerLock(base, async () => {
      await bootstrapJobDefiner(admin);
      await migrate(migrationUrl);
    });
    passwords = await setAppWorkerPasswordRaceSafe(base);
    verify = new pg.Client({ connectionString: migrationUrl });
    await verify.connect();
    await verify.query("INSERT INTO outbox_projectors (name, enabled) VALUES ($1, true)", [
      TEST_PROJECTOR,
    ]);
    await verify.query(
      "INSERT INTO outbox_projector_routes (projector, aggregate_type, event_type) VALUES ($1, 'jrd_test_aggregate', 'jrd.test.event')",
      [TEST_PROJECTOR],
    );
    workerPool = new pg.Pool({ connectionString: directUrl });
  } catch (error) {
    errors.push(error);
  } finally {
    await admin.end().catch((error: unknown) => errors.push(error));
  }
  if (errors.length) {
    await teardown().catch((error: unknown) => errors.push(error));
    throw errors.length === 1
      ? errors[0]
      : new AggregateError(errors, "Fixture setup and cleanup failed");
  }
  return { workerPool: workerPool!, verify: verify!, teardown };
}

async function seedTenant(client: pg.Client): Promise<string> {
  const suffix = Math.random().toString(36).slice(2);
  const result = await client.query<{ id: string }>(
    "INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id",
    [`JRD Test Tenant ${suffix}`, `jrd-test-${suffix}`],
  );
  return result.rows[0]!.id;
}

async function seedOutboxEvent(client: pg.Client, tenantId: string): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO outbox_events (tenant_id, aggregate_type, aggregate_id, sequence, type, payload)
     VALUES ($1, 'jrd_test_aggregate', gen_random_uuid(), 1, 'jrd.test.event', '{}'::jsonb)
     RETURNING id`,
    [tenantId],
  );
  return result.rows[0]!.id;
}

describe("DD-146 zalo_dm delivery age check (L31)", () => {
  const unreadable = { expired: true, ageSeconds: "unreadable" };

  it("DA-1: zaloDmAgeVerdict delivers inside and at the bound (strict >), expires past it, and expires every unreadable reading", () => {
    expect(ZALO_DM_MAX_AGE_MINUTES).toBe(60);
    expect(zaloDmAgeVerdict(3599)).toEqual({ expired: false, ageSeconds: 3599 });
    expect(zaloDmAgeVerdict(3600)).toEqual({ expired: false, ageSeconds: 3600 });
    expect(zaloDmAgeVerdict(3600.001)).toEqual({ expired: true, ageSeconds: 3600.001 });
    for (const raw of [NaN, Infinity, -Infinity, "3700", null, undefined]) {
      expect(zaloDmAgeVerdict(raw), String(raw)).toEqual(unreadable);
    }
    expect(isReadableEventTime(new Date())).toBe(true);
    for (const value of [new Date("not a date"), new Date().toISOString(), Date.now(), null]) {
      expect(isReadableEventTime(value), String(value)).toBe(false);
    }
  });

  it("DA-1: zaloDmDeliveryAge issues no SQL for an unreadable time and exactly one DB-clock query otherwise", async () => {
    const calls: unknown[][] = [];
    let rows: unknown[] = [];
    const db = {
      query: async (...args: unknown[]) => {
        calls.push(args);
        return { rows };
      },
    };
    const age = (createdAt: unknown) => zaloDmDeliveryAge(db as unknown as pg.Pool, createdAt);

    expect(await age(new Date("not a date"))).toEqual(unreadable);
    expect(await age(new Date().toISOString())).toEqual(unreadable);
    expect(calls).toHaveLength(0);

    const createdAt = new Date(Date.now() - 61 * 60_000);
    rows = [{ age_s: 3601 }];
    expect(await age(createdAt)).toEqual({ expired: true, ageSeconds: 3601 });
    expect(calls).toEqual([
      ["SELECT date_part('epoch', clock_timestamp() - $1::timestamptz) AS age_s", [createdAt]],
    ]);
    rows = [{ age_s: 3600 }];
    expect(await age(createdAt)).toEqual({ expired: false, ageSeconds: 3600 });
    rows = [];
    expect(await age(createdAt)).toEqual(unreadable);
    rows = [{ age_s: "3601" }];
    expect(await age(createdAt)).toEqual(unreadable);
    expect(calls).toHaveLength(4);
  });

  it(
    "DA-1b: as app_worker the database returns the age as a JS number on its own clock (a string would expire every DM as unreadable)",
    withTestContext(
      () => setupDispatcherContext("plexco_jrd_dispatcher_da1b"),
      async (ctx) => {
        // seeded on the database clock: the age is measured there, so a container clock that
        // drifts from the host's (after a laptop sleep) cannot move it out of 590..900
        const seeded = await ctx.workerPool.query<{ t: Date }>(
          "SELECT clock_timestamp() - interval '10 minutes' AS t",
        );
        const createdAt = seeded.rows[0]!.t;
        const verdict = await zaloDmDeliveryAge(ctx.workerPool, createdAt);
        expect(verdict.expired).toBe(false);
        expect(typeof verdict.ageSeconds).toBe("number");
        expect(verdict.ageSeconds).toBeGreaterThanOrEqual(590);
        expect(verdict.ageSeconds).toBeLessThanOrEqual(900);
      },
    ),
  );
});

describe("DD-146 amendment: player.promoted stays deliverable until the session start (L34)", () => {
  const before = (secondsToStart: number) => ({
    rule: "until_session_start",
    expired: false,
    secondsToStart,
  });
  const after = (secondsAgo: number | "unreadable") => ({
    rule: "until_session_start",
    expired: true,
    secondsAgo,
  });

  it("PSD-7: zaloDmStartVerdict delivers only before the start and expires at it, after it and on every unreadable reading", () => {
    expect(ZALO_DM_UNTIL_SESSION_START).toEqual(["player.promoted"]);
    expect(zaloDmStartVerdict(1)).toEqual(before(1));
    expect(zaloDmStartVerdict(0)).toEqual(after(0));
    expect(zaloDmStartVerdict(-1)).toEqual(after(1));
    // the record prints whole seconds rounded up: 0.4 s late is 1 s, 1.6 s late is 2 s
    expect(zaloDmStartVerdict(-0.4)).toEqual(after(1));
    expect(zaloDmStartVerdict(-1.6)).toEqual(after(2));
    for (const raw of [null, undefined, "1", NaN, Infinity, -Infinity]) {
      expect(zaloDmStartVerdict(raw), String(raw)).toEqual(after("unreadable"));
    }
  });

  it("PSD-7: zaloDmPromotionStart sends the one 0071 read with the event id and claim token and maps its row", async () => {
    const calls: unknown[][] = [];
    let rows: unknown[] = [];
    const db = {
      query: async (...args: unknown[]) => {
        calls.push(args);
        return { rows };
      },
    };
    const eventId = randomUUID();
    const claimToken = randomUUID();
    const read = () => zaloDmPromotionStart(db as unknown as pg.Pool, eventId, claimToken);

    expect(await read()).toBeNull();
    rows = [{ seconds_to_start: 5 }];
    expect(await read()).toEqual(before(5));
    rows = [{ seconds_to_start: null }];
    expect(await read()).toEqual(after("unreadable"));
    const sql = "SELECT * FROM zalo_dm_promotion_seconds_to_start($1, $2)";
    expect(calls).toEqual([
      [sql, [eventId, claimToken]],
      [sql, [eventId, claimToken]],
      [sql, [eventId, claimToken]],
    ]);
  });

  it(
    "PSD-9: as app_worker the 0071 read is allowed (EXECUTE) and returns null for an event with no live claim",
    withTestContext(
      () => setupDispatcherContext("plexco_jrd_dispatcher_psd9"),
      async (ctx) => {
        const who = await ctx.workerPool.query<{ u: string }>("SELECT current_user AS u");
        expect(who.rows[0]!.u).toBe("app_worker");
        // zero rows, not a permission error: random ids match no claimed zalo_dm delivery
        await expect(
          zaloDmPromotionStart(ctx.workerPool, randomUUID(), randomUUID()),
        ).resolves.toBeNull();
      },
    ),
  );
});

it(
  "cleans the dispatcher database and acquired clients when setup fails after CREATE",
  withTestContext(
    async () => {
      const failure = new Error("injected advisory-lock acquisition failure");
      const originalQuery = pg.Client.prototype.query;
      const connects = vi.spyOn(pg.Client.prototype, "connect");
      const ends = vi.spyOn(pg.Client.prototype, "end");
      const query = vi.spyOn(pg.Client.prototype, "query").mockImplementation(function (
        this: pg.Client,
        ...args
      ) {
        if (String(args[0]).includes("advisory_lock")) return Promise.reject(failure);
        return Reflect.apply(originalQuery, this, args);
      });
      return {
        failure,
        connects,
        ends,
        teardown: async () => {
          query.mockRestore();
          connects.mockRestore();
          ends.mockRestore();
        },
      };
    },
    async ({ failure, connects, ends }) => {
      const dbName = "plexco_bot_dispatcher_setup_failure";
      await expect(setupDispatcherContext(dbName)).rejects.toBe(failure);
      expect(connects.mock.contexts).toHaveLength(3); // admin, lock, cleanup
      expect(ends.mock.contexts).toEqual(expect.arrayContaining(connects.mock.contexts));
      expect(ends).toHaveBeenCalledTimes(3);
      const check = new pg.Client({ connectionString: process.env.DATABASE_URL_TEST });
      try {
        await check.connect();
        const result = await check.query("SELECT datname FROM pg_database WHERE datname = $1", [
          dbName,
        ]);
        expect(result.rows).toEqual([]);
      } finally {
        await check.end();
      }
    },
  ),
);

describe("dispatcher.ts and the 0056 worker modules — shipped source (static)", () => {
  // A25 (JRD-5 extended): every SQL string these modules send is one call of an allowed definer
  // (or the LISTEN of the wake loop), named in a double-quoted literal, and names no table.
  const SQL_FILES = [
    "dispatcher.ts",
    "projector-registry.ts",
    "outbox-wake.ts",
    "draft-expiry-job.ts",
    "projectors/index.ts",
    "projectors/web-realtime.ts",
    "projectors/zalo-dm.ts",
    "projectors/public-sessions.ts",
  ];
  it("JRD-5: the shipped modules issue ZERO SQL outside the granted definers, and touch no table", async () => {
    const allowed =
      /^SELECT (\*\s+FROM\s+)?(claim_outbox_batch|public_sessions_project_session|public_sessions_tenant_candidates|public_sessions_sweep_expired|claim_projector_delivery_batch|outbox_claimed_event|job_expire_stale_drafts|zalo_dm_delivery_targets|zalo_dm_record_recipient|zalo_dm_promotion_seconds_to_start)\(|^SELECT (job_prepare_projector_delivery|ack_outbox_event|complete_projector_delivery|outbox_required_projectors|projector_is_enabled)\(|^SELECT pg_notify\('web_realtime', \$1\)$|^SELECT date_part\('epoch', clock_timestamp\(\) - \$1::timestamptz\) AS age_s$|^LISTEN outbox_wake$/;
    const tables = [
      "outbox_events",
      "projector_deliveries",
      "job_audit_events",
      "outbox_projectors",
      "outbox_projector_routes",
      "job_worker_heartbeats",
      "sessions",
      "players",
      "charges",
    ];
    let total = 0;
    for (const file of SQL_FILES) {
      const source = await readFile(path.join(HERE, file), "utf8");
      const queryCalls = [...source.matchAll(/\.query(?:<[^>]*>)?\(\s*"([^"]+)"/g)].map(
        (m) => m[1]!,
      );
      // every .query( call carries its SQL as a literal the extraction above can see
      expect(source.match(/\.query(?:<[^>]*>)?\(/g)?.length ?? 0, file).toBe(queryCalls.length);
      total += queryCalls.length;
      for (const sql of queryCalls) {
        expect(sql, file).toMatch(allowed);
        for (const table of tables) expect(sql, file).not.toMatch(new RegExp(`\\b${table}\\b`));
      }
    }
    expect(total).toBeGreaterThan(0); // sanity: the extraction pattern actually matched something
  });

  it("JRD-12: no INSERT into outbox_events exists in any shipped file", async () => {
    const shippedFiles = [
      ...SQL_FILES,
      "preflight.ts",
      "worker.ts",
      "queues.ts",
      "queue.ts",
      "provision-queue.ts",
      "heartbeat.ts",
    ];
    for (const file of shippedFiles) {
      const source = await readFile(path.join(HERE, file), "utf8");
      expect(source).not.toMatch(/INSERT\s+INTO\s+outbox_events/i);
    }
  });
});

describe("runDispatchCycle", () => {
  it(
    "JRD-6: prepare is idempotent — the same (event_id, projector) prepared twice yields one delivery row",
    withTestContext(
      () => setupDispatcherContext("plexco_jrd_dispatcher_6"),
      async (ctx) => {
        const tenantId = await seedTenant(ctx.verify);
        const eventId = await seedOutboxEvent(ctx.verify, tenantId);

        await ctx.workerPool.query("SELECT job_prepare_projector_delivery($1, $2)", [
          eventId,
          TEST_PROJECTOR,
        ]);
        await ctx.workerPool.query("SELECT job_prepare_projector_delivery($1, $2)", [
          eventId,
          TEST_PROJECTOR,
        ]);

        const rows = await ctx.verify.query(
          "SELECT status, attempts FROM projector_deliveries WHERE event_id = $1 AND projector = $2",
          [eventId, TEST_PROJECTOR],
        );
        expect(rows.rows).toHaveLength(1);
        expect(rows.rows[0].status).toBe("pending");
        expect(rows.rows[0].attempts).toBe(0);
      },
    ),
  );

  it(
    "JRD-7: delivered path — complete with the exact token transitions to delivered, attempts increments once, token/lease cleared",
    withTestContext(
      () => setupDispatcherContext("plexco_jrd_dispatcher_7"),
      async (ctx) => {
        const tenantId = await seedTenant(ctx.verify);
        const eventId = await seedOutboxEvent(ctx.verify, tenantId);

        const deliver: DeliverFn = async () => ({ result: "delivered", providerRef: "jrd-7-ref" });
        const summary = await runDispatchCycle(ctx.workerPool, { projectors: only(deliver) });

        expect(summary.claimedEvents).toBe(1);
        expect(summary.ackedEvents).toBe(1);
        expect(summary.processedDeliveries).toBe(1);

        const row = await ctx.verify.query(
          "SELECT status, attempts, claim_token, lease_expires_at, provider_ref FROM projector_deliveries WHERE event_id=$1 AND projector=$2",
          [eventId, TEST_PROJECTOR],
        );
        expect(row.rows[0].status).toBe("delivered");
        expect(row.rows[0].attempts).toBe(1);
        expect(row.rows[0].claim_token).toBeNull();
        expect(row.rows[0].lease_expires_at).toBeNull();
        expect(row.rows[0].provider_ref).toBe("jrd-7-ref");
      },
    ),
  );

  it(
    "DA-2: the DD-146 age check is zalo_dm only: an event past the bound for another projector is delivered once, as today",
    withTestContext(
      () => setupDispatcherContext("plexco_jrd_dispatcher_da2"),
      async (ctx) => {
        const tenantId = await seedTenant(ctx.verify);
        const eventId = await seedOutboxEvent(ctx.verify, tenantId);
        const backdated = await ctx.verify.query<{ past: boolean }>(
          `UPDATE outbox_events SET created_at = now() - make_interval(mins => $2) WHERE id = $1
           RETURNING created_at < now() - make_interval(mins => $3) AS past`,
          [eventId, ZALO_DM_MAX_AGE_MINUTES + 5, ZALO_DM_MAX_AGE_MINUTES],
        );
        expect(backdated.rows[0]!.past).toBe(true); // non-vacuous: the event is past the bound

        const outcome = { result: "delivered", providerRef: "da-2-ref" } as const;
        const deliver = vi.fn<DeliverFn>(async () => outcome);
        const summary = await runDispatchCycle(ctx.workerPool, { projectors: only(deliver) });

        expect(deliver).toHaveBeenCalledTimes(1);
        expect(summary.processedDeliveries).toBe(1);
        const row = await ctx.verify.query(
          "SELECT status, attempts, provider_ref FROM projector_deliveries WHERE event_id=$1 AND projector=$2",
          [eventId, TEST_PROJECTOR],
        );
        expect(row.rows[0].status).toBe("delivered");
        expect(row.rows[0].attempts).toBe(1);
        expect(row.rows[0].provider_ref).toBe("da-2-ref");
        // L44-c3: a non-zalo_dm job is passed unchanged: no deadline key at all, not an undefined one
        expect("deliveryDeadlineMs" in deliver.mock.calls[0]![0]).toBe(false);
      },
    ),
  );

  it(
    "JRD-8: retry path — 'retry' moves to failed; re-claimable only once due; the stale token cannot complete after re-claim",
    withTestContext(
      () => setupDispatcherContext("plexco_jrd_dispatcher_8"),
      async (ctx) => {
        const tenantId = await seedTenant(ctx.verify);
        const eventId = await seedOutboxEvent(ctx.verify, tenantId);
        await ctx.workerPool.query("SELECT job_prepare_projector_delivery($1, $2)", [
          eventId,
          TEST_PROJECTOR,
        ]);

        const claim1 = await ctx.workerPool.query<{ claim_token: string }>(
          "SELECT claim_token FROM claim_projector_delivery_batch($1, $2)",
          [TEST_PROJECTOR, 10],
        );
        const token1 = claim1.rows[0]!.claim_token;

        const nextAttemptAt = new Date(Date.now() + 60_000);
        const completed = await ctx.workerPool.query<{ complete_projector_delivery: boolean }>(
          "SELECT complete_projector_delivery($1,$2,$3,'retry',$4,NULL,'jrd_8_retry')",
          [eventId, TEST_PROJECTOR, token1, nextAttemptAt],
        );
        expect(completed.rows[0]!.complete_projector_delivery).toBe(true);

        let row = await ctx.verify.query(
          "SELECT status, attempts, claim_token, error_code FROM projector_deliveries WHERE event_id=$1 AND projector=$2",
          [eventId, TEST_PROJECTOR],
        );
        expect(row.rows[0].status).toBe("failed");
        expect(row.rows[0].attempts).toBe(1);
        expect(row.rows[0].claim_token).toBeNull();
        expect(row.rows[0].error_code).toBe("jrd_8_retry");

        // not yet due — must NOT be re-claimable.
        const notDueClaim = await ctx.workerPool.query(
          "SELECT * FROM claim_projector_delivery_batch($1, $2)",
          [TEST_PROJECTOR, 10],
        );
        expect(notDueClaim.rows).toHaveLength(0);

        // simulate the retry becoming due.
        await ctx.verify.query(
          "UPDATE projector_deliveries SET next_attempt_at = now() - interval '1 second' WHERE event_id=$1 AND projector=$2",
          [eventId, TEST_PROJECTOR],
        );
        const claim2 = await ctx.workerPool.query<{ claim_token: string }>(
          "SELECT claim_token FROM claim_projector_delivery_batch($1, $2)",
          [TEST_PROJECTOR, 10],
        );
        expect(claim2.rows).toHaveLength(1);
        const token2 = claim2.rows[0]!.claim_token;
        expect(token2).not.toBe(token1);

        // the STALE (pre-reclaim) token must not be able to complete anymore.
        const staleComplete = await ctx.workerPool.query<{ complete_projector_delivery: boolean }>(
          "SELECT complete_projector_delivery($1,$2,$3,'delivered',NULL,NULL,NULL)",
          [eventId, TEST_PROJECTOR, token1],
        );
        expect(staleComplete.rows[0]!.complete_projector_delivery).toBe(false);

        row = await ctx.verify.query(
          "SELECT status, claim_token FROM projector_deliveries WHERE event_id=$1 AND projector=$2",
          [eventId, TEST_PROJECTOR],
        );
        expect(row.rows[0].status).toBe("claimed");
        expect(row.rows[0].claim_token).toBe(token2);
      },
    ),
  );

  it(
    "JRD-9: dlq path — terminal; no further claim or completion succeeds",
    withTestContext(
      () => setupDispatcherContext("plexco_jrd_dispatcher_9"),
      async (ctx) => {
        const tenantId = await seedTenant(ctx.verify);
        const eventId = await seedOutboxEvent(ctx.verify, tenantId);
        await ctx.workerPool.query("SELECT job_prepare_projector_delivery($1, $2)", [
          eventId,
          TEST_PROJECTOR,
        ]);
        const claim1 = await ctx.workerPool.query<{ claim_token: string }>(
          "SELECT claim_token FROM claim_projector_delivery_batch($1,$2)",
          [TEST_PROJECTOR, 10],
        );
        const token = claim1.rows[0]!.claim_token;

        const completed = await ctx.workerPool.query<{ complete_projector_delivery: boolean }>(
          "SELECT complete_projector_delivery($1,$2,$3,'dlq',NULL,NULL,'jrd_9_dlq')",
          [eventId, TEST_PROJECTOR, token],
        );
        expect(completed.rows[0]!.complete_projector_delivery).toBe(true);

        const row = await ctx.verify.query(
          "SELECT status FROM projector_deliveries WHERE event_id=$1 AND projector=$2",
          [eventId, TEST_PROJECTOR],
        );
        expect(row.rows[0].status).toBe("dlq");

        const reclaim = await ctx.workerPool.query(
          "SELECT * FROM claim_projector_delivery_batch($1,$2)",
          [TEST_PROJECTOR, 10],
        );
        expect(reclaim.rows).toHaveLength(0);

        const recomplete = await ctx.workerPool.query<{ complete_projector_delivery: boolean }>(
          "SELECT complete_projector_delivery($1,$2,$3,'delivered',NULL,NULL,NULL)",
          [eventId, TEST_PROJECTOR, token],
        );
        expect(recomplete.rows[0]!.complete_projector_delivery).toBe(false);
      },
    ),
  );

  it(
    "a completion superseded by a reclaim mid-flight is counted as staleCompletionSkips, not processedDeliveries",
    withTestContext(
      () => setupDispatcherContext("plexco_jrd_dispatcher_stale_completion"),
      async (ctx) => {
        const tenantId = await seedTenant(ctx.verify);
        await seedOutboxEvent(ctx.verify, tenantId);

        const deliver: DeliverFn = async (job) => {
          // Simulate another worker reclaiming this row WHILE delivery was in
          // flight: expire the lease and let a raw claim reissue a fresh token
          // before THIS call's own complete_projector_delivery runs with the
          // now-superseded one runDispatchCycle is still holding.
          await ctx.verify.query(
            "UPDATE projector_deliveries SET lease_expires_at = now() - interval '1 second' WHERE event_id=$1 AND projector=$2",
            [job.eventId, job.projector],
          );
          await ctx.workerPool.query(
            "SELECT claim_token FROM claim_projector_delivery_batch($1, $2)",
            [job.projector, 10],
          );
          return { result: "delivered" };
        };

        const summary = await runDispatchCycle(ctx.workerPool, { projectors: only(deliver) });

        expect(summary.staleCompletionSkips).toBe(1);
        expect(summary.processedDeliveries).toBe(0);
      },
    ),
  );

  // audit 2026-09-06 B-1: complete_projector_delivery RAISES 22023 on a malformed outcome
  // (error_code not ^[a-z][a-z0-9_]{0,63}$, or retry with a non-future next_attempt_at). That
  // call sat OUTSIDE the deliver() try/catch, so one bad outcome aborted the cycle with the
  // row still claimed — and reclaim-expired-first + ORDER BY event_id handed the SAME row back
  // first on the next cycle, forever. Reproduced before the fix: runDispatchCycle rejected
  // with SQLSTATE 22023 and the delivery stayed `claimed`.
  /**
   * The bound() hardening exists because a throw in the LOG line happens before
   * complete_projector_delivery and would leave the delivery claimed — the B-1 failure mode. The
   * helper's own unit table is above; this drives a projector that returns a non-string errorCode
   * through the real cycle, so the claim is about the cycle rather than about the helper.
   */
  it(
    "JRD-BOUND: a projector returning a NON-STRING error code still completes the cycle (the log line cannot abort it)",
    withTestContext(
      () => setupDispatcherContext("plexco_jrd_dispatcher_nonstring_code"),
      async (ctx) => {
        const tenantId = await seedTenant(ctx.verify);
        const eventId = await seedOutboxEvent(ctx.verify, tenantId);

        const deliver: DeliverFn = async () => ({ result: "dlq", errorCode: 42 }) as never;
        const summary = await runDispatchCycle(ctx.workerPool, { projectors: only(deliver) });

        expect(summary.processedDeliveries).toBe(1); // the cycle finished instead of throwing
        const rows = await ctx.verify.query<{ status: string; error_code: string | null }>(
          "SELECT status, error_code FROM projector_deliveries WHERE event_id = $1",
          [eventId],
        );
        expect(rows.rows[0]?.status).toBe("dlq");
        expect(rows.rows[0]?.error_code).toBe("malformed_error_code"); // in-grammar, delivery closed
      },
    ),
  );

  it(
    "audit B-1: a projector returning an UPPERCASE error code (dlq) does not abort the cycle — the code is normalised, the row ends dlq, and the next row is still delivered",
    withTestContext(
      () => setupDispatcherContext("plexco_jrd_dispatcher_bad_grammar_dlq"),
      async (ctx) => {
        const tenantId = await seedTenant(ctx.verify);
        const eventA = await seedOutboxEvent(ctx.verify, tenantId);
        const eventB = await seedOutboxEvent(ctx.verify, tenantId);

        let callCount = 0;
        const deliver: DeliverFn = async () => {
          callCount += 1;
          if (callCount === 1) return { result: "dlq", errorCode: "ECONNRESET" };
          return { result: "delivered" };
        };

        const summary = await runDispatchCycle(ctx.workerPool, { projectors: only(deliver) });
        expect(callCount).toBe(2);
        expect(summary.processedDeliveries).toBe(2);

        const rows = await ctx.verify.query<{
          event_id: string;
          status: string;
          error_code: string | null;
        }>(
          "SELECT event_id, status, error_code FROM projector_deliveries WHERE event_id = ANY($1) ORDER BY event_id",
          [[eventA, eventB]],
        );
        const byStatus = Object.fromEntries(rows.rows.map((r) => [r.status, r]));
        expect(byStatus["dlq"]?.error_code).toBe("econnreset");
        expect(byStatus["delivered"]).toBeDefined();
        // nothing is left claimed — the head-of-line block is gone
        const claimed = await ctx.verify.query(
          "SELECT 1 FROM projector_deliveries WHERE event_id = ANY($1) AND status = 'claimed'",
          [[eventA, eventB]],
        );
        expect(claimed.rows).toHaveLength(0);
      },
    ),
  );

  it(
    "A23: the dispatcher schedules each retry at 15 s x 2^attempts (a projector's nextAttemptAt is ignored) and dead-letters the 8th failure as attempts_exhausted",
    withTestContext(
      () => setupDispatcherContext("plexco_jrd_dispatcher_retry_schedule"),
      async (ctx) => {
        const tenantId = await seedTenant(ctx.verify);
        const eventId = await seedOutboxEvent(ctx.verify, tenantId);
        const seen: number[] = [];
        const deliver: DeliverFn = async (job) => {
          seen.push(job.attempts);
          return {
            result: "retry",
            errorCode: "Provider_Timeout",
            nextAttemptAt: new Date(0),
          } as never;
        };
        const row = async () =>
          (
            await ctx.verify.query<{
              status: string;
              attempts: number;
              error_code: string;
              wait: number;
            }>(
              `SELECT status, attempts, error_code,
                      round(extract(epoch FROM next_attempt_at - clock_timestamp()))::int AS wait
                 FROM projector_deliveries WHERE event_id = $1`,
              [eventId],
            )
          ).rows[0]!;
        for (const [attempts, wait] of [15, 30, 60, 120, 240, 480, 960].entries()) {
          await runDispatchCycle(ctx.workerPool, { projectors: only(deliver) });
          const r = await row();
          expect(r).toMatchObject({
            status: "failed",
            attempts: attempts + 1,
            error_code: "provider_timeout",
          });
          expect(Math.abs(r.wait - wait)).toBeLessThanOrEqual(2);
          await ctx.verify.query(
            "UPDATE projector_deliveries SET next_attempt_at = now() - interval '1 second' WHERE event_id = $1",
            [eventId],
          );
        }
        expect(
          (await runDispatchCycle(ctx.workerPool, { projectors: only(deliver) }))
            .processedDeliveries,
        ).toBe(1);
        expect(await row()).toMatchObject({
          status: "dlq",
          attempts: 8,
          error_code: ATTEMPTS_EXHAUSTED,
        });
        expect(seen).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
      },
    ),
  );

  it(
    "codex round-07: a deliver() that throws for one row does not abort delivery of the rest (no head-of-line blocking)",
    withTestContext(
      () => setupDispatcherContext("plexco_jrd_dispatcher_deliver_throws"),
      async (ctx) => {
        const tenantId = await seedTenant(ctx.verify);
        const eventA = await seedOutboxEvent(ctx.verify, tenantId);
        const eventB = await seedOutboxEvent(ctx.verify, tenantId);

        let callCount = 0;
        const deliver: DeliverFn = async () => {
          callCount += 1;
          if (callCount === 1) {
            throw new Error("simulated deliver() crash — violates the DeliveryOutcome contract");
          }
          return { result: "delivered" };
        };

        const summary = await runDispatchCycle(ctx.workerPool, { projectors: only(deliver) });

        // Both rows were attempted — the throw on the first did not abort the
        // loop before claiming/attempting the second.
        expect(callCount).toBe(2);
        expect(summary.processedDeliveries).toBe(2);
        expect(summary.staleCompletionSkips).toBe(0);

        const rows = await ctx.verify.query<{
          event_id: string;
          status: string;
          error_code: string | null;
        }>(
          "SELECT event_id, status, error_code FROM projector_deliveries WHERE event_id = ANY($1)",
          [[eventA, eventB]],
        );
        // codex round-09 [P1]: an untyped throw fails closed to 'dlq', not
        // 'retry' — retrying an ambiguous failure risks a duplicate external
        // side effect if the throw happened after the provider already
        // accepted the request.
        const dlqd = rows.rows.filter((r) => r.status === "dlq");
        const delivered = rows.rows.filter((r) => r.status === "delivered");
        expect(dlqd).toHaveLength(1);
        expect(dlqd[0]!.error_code).toBe("deliver_threw");
        expect(delivered).toHaveLength(1);
      },
    ),
  );

  it(
    "codex round-07: claims one delivery at a time, never a whole batch upfront",
    withTestContext(
      () => setupDispatcherContext("plexco_jrd_dispatcher_fresh_lease"),
      async (ctx) => {
        const tenantId = await seedTenant(ctx.verify);
        await seedOutboxEvent(ctx.verify, tenantId);
        await seedOutboxEvent(ctx.verify, tenantId);
        await seedOutboxEvent(ctx.verify, tenantId);

        // If claim_projector_delivery_batch claimed all 3 rows upfront (the old
        // design), every delivery would observe 0 sibling rows still 'pending'.
        // One-at-a-time claiming means the count strictly decreases across
        // calls: 2 pending when the 1st delivery runs, 1 for the 2nd, 0 for the
        // 3rd — direct, order-independent evidence of the claim-then-deliver
        // interleaving, not just "the lease happened to still look fresh."
        const pendingCountsAtEachDelivery: number[] = [];
        const deliver: DeliverFn = async () => {
          const stillPending = await ctx.verify.query<{ count: string }>(
            "SELECT count(*) FROM projector_deliveries WHERE projector = $1 AND status = 'pending'",
            [TEST_PROJECTOR],
          );
          pendingCountsAtEachDelivery.push(Number(stillPending.rows[0]!.count));
          return { result: "delivered" };
        };

        await runDispatchCycle(ctx.workerPool, { projectors: only(deliver) });

        expect(pendingCountsAtEachDelivery.slice().sort((a, b) => b - a)).toEqual([2, 1, 0]);
      },
    ),
  );

  it(
    "codex round-09: a stale completion stops phase 2 for that projector this cycle, instead of immediately reclaiming (and re-delivering) the same slow row",
    withTestContext(
      () => setupDispatcherContext("plexco_jrd_dispatcher_stale_stops_cycle"),
      async (ctx) => {
        const tenantId = await seedTenant(ctx.verify);
        await seedOutboxEvent(ctx.verify, tenantId);
        await seedOutboxEvent(ctx.verify, tenantId);

        let callCount = 0;
        const deliver: DeliverFn = async (job) => {
          callCount += 1;
          // Simulate THIS row's own lease expiring while deliver() was still
          // in flight (delivery took longer than five minutes) — no other
          // claimant involved, just this row's own lease aging out mid-call.
          // claim_projector_delivery_batch's reclaim-expired-first step would
          // hand back this SAME row on an immediate re-claim, since deliver()
          // being slow doesn't stop being slow on retry.
          await ctx.verify.query(
            "UPDATE projector_deliveries SET lease_expires_at = now() - interval '1 second' WHERE event_id=$1 AND projector=$2",
            [job.eventId, job.projector],
          );
          return { result: "delivered" };
        };

        const summary = await runDispatchCycle(ctx.workerPool, { projectors: only(deliver) });

        // Only the first row was ever attempted — the stale completion it
        // produced stopped phase 2 for this projector before claiming the
        // second row at all this cycle.
        expect(callCount).toBe(1);
        expect(summary.staleCompletionSkips).toBe(1);
        expect(summary.processedDeliveries).toBe(0);

        const stillPending = await ctx.verify.query<{ count: string }>(
          "SELECT count(*) FROM projector_deliveries WHERE projector = $1 AND status = 'pending'",
          [TEST_PROJECTOR],
        );
        expect(Number(stillPending.rows[0]!.count)).toBe(1);
      },
    ),
  );

  it(
    "a projector disabled mid-cycle reads no further envelope, so the cycle stops it after the delivery in hand",
    withTestContext(
      () => setupDispatcherContext("plexco_jrd_dispatcher_disable_mid_cycle"),
      async (ctx) => {
        const tenantId = await seedTenant(ctx.verify);
        for (let i = 0; i < 3; i += 1) await seedOutboxEvent(ctx.verify, tenantId);
        let calls = 0;
        const deliver: DeliverFn = async () => {
          calls += 1; // the owner disables the projector while this delivery is in hand
          await ctx.verify.query("UPDATE outbox_projectors SET enabled = false WHERE name = $1", [
            TEST_PROJECTOR,
          ]);
          return { result: "delivered" };
        };
        const summary = await runDispatchCycle(ctx.workerPool, { projectors: only(deliver) });
        expect(calls).toBe(1);
        expect(summary).toMatchObject({ processedDeliveries: 1, leaseLostSkips: 1 });
        const left = await ctx.verify.query<{ status: string }>(
          "SELECT status FROM projector_deliveries WHERE projector = $1 ORDER BY status",
          [TEST_PROJECTOR],
        );
        expect(left.rows.map((r) => r.status)).toEqual(["claimed", "delivered", "pending"]);
      },
    ),
  );

  it(
    "JRD-10: expired lease is reclaimed on the next claim, and job_audit_events shows more than one row for that job_id",
    withTestContext(
      () => setupDispatcherContext("plexco_jrd_dispatcher_10"),
      async (ctx) => {
        const tenantId = await seedTenant(ctx.verify);
        const eventId = await seedOutboxEvent(ctx.verify, tenantId);

        const claim1 = await ctx.workerPool.query<{ event_id: string }>(
          "SELECT * FROM claim_outbox_batch(10)",
        );
        expect(claim1.rows.some((r) => r.event_id === eventId)).toBe(true);

        await ctx.verify.query(
          "UPDATE outbox_events SET lease_expires_at = now() - interval '1 second' WHERE id=$1",
          [eventId],
        );

        const claim2 = await ctx.workerPool.query<{ event_id: string }>(
          "SELECT * FROM claim_outbox_batch(10)",
        );
        expect(claim2.rows.some((r) => r.event_id === eventId)).toBe(true);

        const audit = await ctx.verify.query<{ reason: string }>(
          "SELECT reason FROM job_audit_events WHERE job_id=$1 ORDER BY created_at",
          [eventId],
        );
        expect(audit.rows.length).toBeGreaterThan(1);
        expect(audit.rows.map((r) => r.reason)).toContain("outbox_lease_reclaimed");
      },
    ),
  );

  it(
    "JRD-11: app_worker has ZERO direct DML on outbox_events, projector_deliveries and job_audit_events",
    withTestContext(
      () => setupDispatcherContext("plexco_jrd_dispatcher_11"),
      async (ctx) => {
        // codex round-04-class race, caught empirically (not by codex itself —
        // found by re-running this suite repeatedly after the round-04 fix):
        // job_definer membership is CLUSTER-global, and app_worker is INHERIT
        // (0000's default), so while migrate.test.ts's JCL-3b or bootstrap-refusal
        // test holds `GRANT job_definer TO app_worker` (a breaker window, even briefly),
        // app_worker AUTOMATICALLY exercises job_definer's own
        // `GRANT SELECT, UPDATE ON outbox_events` (0022) in EVERY database on
        // the cluster — including whichever throwaway database THIS test
        // happens to be using at that exact moment — turning the expected
        // "permission denied" into a real, if RLS-filtered-to-zero-rows,
        // successful SELECT. withJobDefinerLock's setup-time use only protects
        // bootstrap/migrate; a test asserting app_worker's access is currently
        // minimal must ALSO hold it for its own assertion window, or it can
        // observe a sibling test's transient elevation.
        const base = process.env.DATABASE_URL_TEST!;
        await withJobDefinerLock(base, async () => {
          for (const table of [
            "outbox_events",
            "projector_deliveries",
            "job_audit_events",
          ] as const) {
            await expect(ctx.workerPool.query(`SELECT * FROM ${table} LIMIT 1`)).rejects.toThrow(
              /permission denied/,
            );
          }
        });
      },
    ),
  );

  it(
    "JRD-15: ack closes the loop — an acked event is never returned by claim_outbox_batch again, even after its lease expires",
    withTestContext(
      () => setupDispatcherContext("plexco_jrd_dispatcher_15"),
      async (ctx) => {
        const tenantId = await seedTenant(ctx.verify);
        const eventId = await seedOutboxEvent(ctx.verify, tenantId);

        const summary = await runDispatchCycle(ctx.workerPool, {
          projectors: only(async () => ({ result: "delivered" })),
        });
        expect(summary.ackedEvents).toBe(1);

        const acked = await ctx.verify.query("SELECT acked_at FROM outbox_events WHERE id=$1", [
          eventId,
        ]);
        expect(acked.rows[0].acked_at).not.toBeNull();

        await ctx.verify.query(
          "UPDATE outbox_events SET lease_expires_at = now() - interval '1 second' WHERE id=$1",
          [eventId],
        );

        const reclaim = await ctx.workerPool.query<{ event_id: string }>(
          "SELECT * FROM claim_outbox_batch(10)",
        );
        expect(reclaim.rows.some((r) => r.event_id === eventId)).toBe(false);
      },
    ),
  );

  it(
    "JRD-16: stale-token path — a superseded claimant's ack returns false, acked_at stays NULL, nothing raises",
    withTestContext(
      () => setupDispatcherContext("plexco_jrd_dispatcher_16"),
      async (ctx) => {
        const tenantId = await seedTenant(ctx.verify);
        const eventId = await seedOutboxEvent(ctx.verify, tenantId);

        const claim1 = await ctx.workerPool.query<{ claim_token: string }>(
          "SELECT claim_token FROM claim_outbox_batch(10)",
        );
        const staleToken = claim1.rows[0]!.claim_token;

        // force a second claimant to reclaim mid-flight.
        await ctx.verify.query(
          "UPDATE outbox_events SET lease_expires_at = now() - interval '1 second' WHERE id=$1",
          [eventId],
        );
        const claim2 = await ctx.workerPool.query<{ claim_token: string }>(
          "SELECT claim_token FROM claim_outbox_batch(10)",
        );
        const currentToken = claim2.rows[0]!.claim_token;
        expect(currentToken).not.toBe(staleToken);

        // the FIRST (now-superseded) handler prepares+attempts ack with its stale token.
        await ctx.workerPool.query("SELECT job_prepare_projector_delivery($1, $2)", [
          eventId,
          TEST_PROJECTOR,
        ]);
        const ackResult = await ctx.workerPool.query<{ ack_outbox_event: boolean }>(
          "SELECT ack_outbox_event($1, $2, $3) AS ack_outbox_event",
          [eventId, [TEST_PROJECTOR], staleToken],
        );
        expect(ackResult.rows[0]!.ack_outbox_event).toBe(false);

        const row = await ctx.verify.query("SELECT acked_at FROM outbox_events WHERE id=$1", [
          eventId,
        ]);
        expect(row.rows[0].acked_at).toBeNull();

        // dispatcher.ts's own branch on this exact boolean has no throw in the
        // false path (see runDispatchCycle's phase 1: `if (acked) {...} else {
        // summary.staleTokenSkips += 1 }`) — this test proves the SQL contract
        // that branch relies on; the branch itself is verified by inspection,
        // since forcing runDispatchCycle's OWN internal ack call onto a stale
        // token would require a second concurrent actor racing it mid-call,
        // which is not something a single-process test can do deterministically.
      },
    ),
  );

  it(
    "JRD-17a: fan-out completeness is exercised — ack_outbox_event RAISES when a required projector was never prepared (not satisfied by only one projector registered)",
    withTestContext(
      () => setupDispatcherContext("plexco_jrd_dispatcher_17a"),
      async (ctx) => {
        const tenantId = await seedTenant(ctx.verify);
        const eventId = await seedOutboxEvent(ctx.verify, tenantId);
        const requiredProjectors = [TEST_PROJECTOR, "second_test_projector"];

        await ctx.workerPool.query("SELECT job_prepare_projector_delivery($1, $2)", [
          eventId,
          TEST_PROJECTOR,
        ]);
        // deliberately do NOT prepare "second_test_projector".

        const claim = await ctx.workerPool.query<{ claim_token: string }>(
          "SELECT claim_token FROM claim_outbox_batch(10)",
        );
        const token = claim.rows[0]!.claim_token;

        await expect(
          ctx.workerPool.query("SELECT ack_outbox_event($1, $2, $3)", [
            eventId,
            requiredProjectors,
            token,
          ]),
        ).rejects.toThrow(/missing prepared delivery/);
      },
    ),
  );

  it(
    "JRD-17b: runDispatchCycle does not swallow a thrown error from within phase 1 — it propagates out of the cycle",
    withTestContext(
      () => setupDispatcherContext("plexco_jrd_dispatcher_17b"),
      async (ctx) => {
        const tenantId = await seedTenant(ctx.verify);
        const eventId = await seedOutboxEvent(ctx.verify, tenantId);
        // Phase 1 reads the event's required set right after the claim. Withdrawing app_worker's
        // EXECUTE on that definer in THIS throwaway database (a per-database ACL) makes it raise;
        // the error must leave the cycle unchanged and the event must stay unacked. A denial is a
        // negative-privilege assertion, so it holds the jobd reader lock (C10).
        await ctx.verify.query(
          "REVOKE EXECUTE ON FUNCTION outbox_required_projectors(uuid) FROM app_worker",
        );
        await withJobDefinerLock(process.env.DATABASE_URL_TEST!, () =>
          expect(
            runDispatchCycle(ctx.workerPool, {
              projectors: only(async () => ({ result: "delivered" })),
            }),
          ).rejects.toMatchObject({ code: "42501" }),
        );
        const acked = await ctx.verify.query("SELECT acked_at FROM outbox_events WHERE id = $1", [
          eventId,
        ]);
        expect(acked.rows[0].acked_at).toBeNull();
      },
    ),
  );
});

describe("audit B-1: outcome grammar normalisation is enforced once, in completionArgs", () => {
  it("normalizeErrorCode lower-cases, replaces non-grammar chars, bounds to 64 and never yields a leading digit or empty code", () => {
    expect(normalizeErrorCode("ECONNRESET")).toBe("econnreset");
    expect(normalizeErrorCode("Provider-Timeout 504")).toBe("provider_timeout_504");
    expect(normalizeErrorCode("")).toBe("malformed_error_code");
    expect(normalizeErrorCode("5xx")).toBe("malformed_error_code");
    expect(normalizeErrorCode(undefined)).toBe("malformed_error_code");
    expect(normalizeErrorCode("a".repeat(100))).toHaveLength(64);
    for (const sample of ["ECONNRESET", "x y", "ok_code", "Ω", "9"]) {
      expect(normalizeErrorCode(sample)).toMatch(/^[a-z][a-z0-9_]{0,63}$/);
    }
  });

  it("a NON-STRING raw error code is described, never coerced with .slice() — the log line must not abort the cycle", async () => {
    const { boundRawErrorCode, completionArgs, RAW_ERROR_CODE_LOG_MAX } =
      await import("./dispatcher.js");
    // DeliveryOutcome says `errorCode: string`; a projector is external code that can send
    // anything, and completionArgs passes the raw value straight through on retry/dlq. Bounding
    // it must therefore never assume a string: throwing here happens BEFORE
    // complete_projector_delivery and leaves the delivery claimed — the B-1 failure mode.
    for (const bad of [42, true, null, undefined, { a: 1 }, [1, 2], Symbol("s"), 10n]) {
      expect(() => boundRawErrorCode(bad as never)).not.toThrow();
    }
    // Every shape, driven through the REAL path the dispatcher takes: completionArgs first
    // (which is what passes the raw value straight through on retry/dlq), then the bound.
    const shapes: [unknown, string][] = [
      [42, "42"],
      [true, "true"],
      [10n, "10"],
      [null, "[null]"],
      [undefined, "[undefined]"],
      [{ a: 1 }, "[object]"],
      [[1], "[array]"],
      [Symbol("s"), "[symbol]"],
      [() => "x", "[function]"],
    ];
    for (const [raw, described] of shapes) {
      for (const outcome of [
        { result: "dlq", errorCode: raw } as never,
        { result: "retry", errorCode: raw } as never,
      ]) {
        const args = completionArgs(outcome, 0);
        expect(() => boundRawErrorCode(args.rawErrorCode as never)).not.toThrow();
        expect(boundRawErrorCode(args.rawErrorCode as never)).toBe(described);
        expect(args.errorCode).toBe("malformed_error_code"); // and the STORED code stays in-grammar
      }
    }
    // oversized strings are still cut, with the overflow named
    const long = "x".repeat(RAW_ERROR_CODE_LOG_MAX + 10);
    expect(boundRawErrorCode(long)).toBe(`${"x".repeat(RAW_ERROR_CODE_LOG_MAX)}…[+10]`);
  });

  it("delivered passes providerRef through untouched and carries no error code", () => {
    expect(completionArgs({ result: "delivered", providerRef: "ref-1" }, 0)).toEqual({
      result: "delivered",
      nextAttemptAt: null,
      providerRef: "ref-1",
      errorCode: null,
      rawErrorCode: null,
    });
  });
});

/**
 * Audit 2026-09-06 X-5 (last part) — worker business liveness through the 0041 definer, called
 * as app_worker (the only identity the worker ever has), with the table itself ungranted.
 */
describe("job_worker_heartbeat / job_worker_liveness (0041)", () => {
  async function setupHeartbeatDirectory() {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "plexco-hb-"));
    return { tmp, teardown: () => rm(tmp, { recursive: true, force: true }) };
  }

  async function setupHeartbeatContext(dbName: string) {
    const directory = await setupHeartbeatDirectory();
    try {
      const ctx = await setupDispatcherContext(dbName);
      return {
        ctx,
        tmp: directory.tmp,
        teardown: async () => {
          try {
            await ctx.teardown();
          } finally {
            await directory.teardown();
          }
        },
      };
    } catch (error) {
      await directory.teardown();
      throw error;
    }
  }

  it(
    "app_worker can tick and read liveness through the definers, but has NO privilege on the table",
    withTestContext(
      () => setupHeartbeatContext("plexco_bot_heartbeat_0041"),
      async ({ ctx, tmp }) => {
        const { heartbeatOnce } = await import("./heartbeat.js");
        const file = path.join(tmp, ".heartbeat-test");
        const lines: string[] = [];

        const ok = await heartbeatOnce({
          pool: ctx.workerPool,
          id: "hb-test-1",
          pid: 4242,
          file,
          log: (l) => lines.push(l),
        });
        expect(ok).toBe(true);
        expect(lines).toEqual([]);
        const written = await readFile(file, "utf8");
        expect(() => new Date(written.trim()).toISOString()).not.toThrow();

        const live = await ctx.workerPool.query<{ worker_id: string; pid: number; alive: boolean }>(
          "SELECT worker_id, pid, alive FROM job_worker_liveness()",
        );
        expect(live.rows).toEqual([{ worker_id: "hb-test-1", pid: 4242, alive: true }]);

        // A second tick from the SAME pid keeps started_at; a new pid restarts it.
        const before = await ctx.verify.query<{ started_at: Date }>(
          "SELECT started_at FROM job_worker_heartbeats WHERE worker_id = 'hb-test-1'",
        );
        await heartbeatOnce({ pool: ctx.workerPool, id: "hb-test-1", pid: 4242, file });
        const same = await ctx.verify.query<{ started_at: Date }>(
          "SELECT started_at FROM job_worker_heartbeats WHERE worker_id = 'hb-test-1'",
        );
        expect(same.rows[0]!.started_at.getTime()).toBe(before.rows[0]!.started_at.getTime());
        await heartbeatOnce({ pool: ctx.workerPool, id: "hb-test-1", pid: 4243, file });
        const restarted = await ctx.verify.query<{ started_at: Date; pid: number }>(
          "SELECT started_at, pid FROM job_worker_heartbeats WHERE worker_id = 'hb-test-1'",
        );
        expect(restarted.rows[0]!.pid).toBe(4243);
        expect(restarted.rows[0]!.started_at.getTime()).toBeGreaterThan(
          before.rows[0]!.started_at.getTime(),
        );

        // D-12 (A12): the tick records the gate it was given; omitted = NULL, which never counts.
        const scheduleLive = async () =>
          (await ctx.workerPool.query("SELECT outbox_dispatch_schedule_live() AS v")).rows[0].v;
        expect(await scheduleLive()).toBe(false);
        await heartbeatOnce({
          pool: ctx.workerPool,
          id: "hb-test-2",
          pid: 7,
          file,
          scheduleEnabled: true,
        });
        const flags = await ctx.verify.query(
          "SELECT worker_id, schedule_enabled FROM job_worker_heartbeats ORDER BY worker_id",
        );
        expect(flags.rows).toEqual([
          { worker_id: "hb-test-1", schedule_enabled: null },
          { worker_id: "hb-test-2", schedule_enabled: true },
        ]);
        expect(await scheduleLive()).toBe(true);
        await ctx.verify.query("DELETE FROM job_worker_heartbeats WHERE worker_id = 'hb-test-2'");

        // Staleness: an old tick reads as not alive.
        await ctx.verify.query(
          "UPDATE job_worker_heartbeats SET last_seen_at = clock_timestamp() - interval '5 minutes' WHERE worker_id = 'hb-test-1'",
        );
        const stale = await ctx.workerPool.query<{ alive: boolean }>(
          "SELECT alive FROM job_worker_liveness()",
        );
        expect(stale.rows[0]!.alive).toBe(false);

        // No table grant: the definer is the only door (read under the reader lock, as JRD-11).
        const heartbeats = () => ctx.workerPool.query("SELECT * FROM job_worker_heartbeats");
        await withJobDefinerLock(process.env.DATABASE_URL_TEST!, () =>
          expect(heartbeats()).rejects.toMatchObject({ code: "42501" }),
        );
        await expect(
          ctx.workerPool.query("SELECT job_worker_heartbeat($1, 'h', 1)", ["x".repeat(129)]),
        ).rejects.toMatchObject({ code: "22023" });
      },
    ),
  );

  it(
    "a failed DB tick is reported, not thrown, rolls back, releases the client, and leaves the file untouched",
    withTestContext(setupHeartbeatDirectory, async ({ tmp }) => {
      const { heartbeatOnce } = await import("./heartbeat.js");
      const lines: string[] = [];
      const seen: string[] = [];
      let released = 0;
      const deadPool = {
        connect: async () => ({
          query: async (text: string) => {
            seen.push(String(text));
            if (String(text).includes("job_worker_heartbeat"))
              throw new Error("connection refused");
            return { rows: [] };
          },
          release: () => {
            released++;
          },
        }),
      } as unknown as pg.Pool;
      const file = path.join(tmp, ".heartbeat-test-dead");
      expect(
        await heartbeatOnce({
          pool: deadPool,
          id: "dead",
          pid: 1,
          file,
          log: (l) => lines.push(l),
        }),
      ).toBe(false);
      expect(lines[0]).toMatch(/heartbeat failed: connection refused/);
      expect(seen).toContain("ROLLBACK");
      expect(released).toBe(1); // never leaks a pooled client, which is the dispatcher's pool
      await expect(readFile(file, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    }),
  );

  it(
    "each tick bounds itself with a transaction-local statement timeout (never a session-level SET on a pooled client)",
    withTestContext(setupHeartbeatDirectory, async ({ tmp }) => {
      const { heartbeatOnce, HEARTBEAT_STATEMENT_TIMEOUT_MS } = await import("./heartbeat.js");
      const seen: string[] = [];
      const pool = {
        connect: async () => ({
          query: async (text: string) => {
            seen.push(String(text));
            return { rows: [{}] };
          },
          release: () => {},
        }),
      } as unknown as pg.Pool;
      const file = path.join(tmp, ".heartbeat-test-timeout");
      expect(await heartbeatOnce({ pool, id: "t", pid: 1, file })).toBe(true);
      expect(seen[0]).toBe("BEGIN");
      expect(seen[1]).toBe(`SET LOCAL statement_timeout = ${HEARTBEAT_STATEMENT_TIMEOUT_MS}`);
      expect(seen[3]).toBe("COMMIT");
    }),
  );

  /**
   * The observer must not starve the observed. setInterval fires on a wall clock, not on
   * completion: against a database that accepts connections but never settles queries, an
   * unguarded loop stacks one checked-out client per tick on the DISPATCHER's pool.
   */
  it(
    "startHeartbeat keeps at most one tick in flight against a hung database",
    withTestContext(setupHeartbeatDirectory, async ({ tmp }) => {
      const { startHeartbeat } = await import("./heartbeat.js");
      let connects = 0;
      const hungPool = {
        connect: async () => {
          connects++;
          return { query: () => new Promise(() => {}), release: () => {} };
        },
      } as unknown as pg.Pool;
      const file = path.join(tmp, ".heartbeat-test-hung");
      const stop = startHeartbeat({ pool: hungPool, id: "h", pid: 1, file }, 20);
      await new Promise((r) => setTimeout(r, 200));
      stop();
      expect(connects).toBe(1);
      await expect(readFile(file, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    }),
  );

  it(
    "stop() suppresses the file write of a tick that was already in flight (no green probe into a started shutdown)",
    withTestContext(setupHeartbeatDirectory, async ({ tmp }) => {
      const { startHeartbeat } = await import("./heartbeat.js");
      let answer: (() => void) | undefined;
      const pool = {
        connect: async () => ({
          query: (text: string) =>
            String(text).includes("job_worker_heartbeat")
              ? new Promise((res) => {
                  answer = () => res({ rows: [{}] } as never);
                })
              : Promise.resolve({ rows: [] }),
          release: () => {},
        }),
      } as unknown as pg.Pool;
      const file = path.join(tmp, ".heartbeat-test-stop");
      const stop = startHeartbeat({ pool, id: "s", pid: 1, file }, 10_000);
      await new Promise((r) => setTimeout(r, 40));
      stop(); // shutdown begins while the tick is still waiting on the database
      answer?.(); // the database answers afterwards
      await new Promise((r) => setTimeout(r, 40));
      await expect(readFile(file, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    }),
  );

  it(
    "the heartbeat row set is self-pruning at 30 days, so job_worker_liveness cannot drift into mostly-dead output",
    withTestContext(
      () => setupHeartbeatContext("plexco_bot_heartbeat_prune"),
      async ({ ctx }) => {
        await ctx.verify.query(
          `INSERT INTO job_worker_heartbeats(worker_id, hostname, pid, started_at, last_seen_at)
       VALUES ('gone-40d', 'old', 9, now() - interval '40 days', now() - interval '40 days'),
              ('kept-20d', 'old', 9, now() - interval '20 days', now() - interval '20 days')`,
        );
        await ctx.workerPool.query("SELECT job_worker_heartbeat($1, $2, $3)", ["live", "h", 7]);
        const { rows } = await ctx.verify.query<{ worker_id: string }>(
          `SELECT worker_id FROM job_worker_heartbeats ORDER BY worker_id`,
        );
        expect(rows.map((r) => r.worker_id)).toEqual(["kept-20d", "live"]);
      },
    ),
  );
});

describe("heartbeat helpers (pure)", () => {
  // The helper must return what the Dockerfile's `[ $(( now - mtime )) -le 90 ]` returns,
  // including for a future-dated file (writer/probe clock skew): only the shell runs in
  // production, so a stricter helper would be a test that lies about the deployed probe.
  it("heartbeatFresh: within 90 s is fresh, older is not, future-dated matches the shell (fresh)", async () => {
    const { heartbeatFresh, HEARTBEAT_STALE_MS, heartbeatFilePath, workerId } =
      await import("./heartbeat.js");
    const now = new Date("2026-09-06T00:01:30Z");
    expect(heartbeatFresh(new Date("2026-09-06T00:00:00Z"), now)).toBe(true);
    expect(heartbeatFresh(new Date("2026-09-05T23:59:59Z"), now)).toBe(false);
    expect(heartbeatFresh(new Date("2026-09-06T00:02:00Z"), now)).toBe(true);
    expect(HEARTBEAT_STALE_MS).toBe(90_000);
    expect(heartbeatFilePath({})).toBe("/tmp/plexco-worker-heartbeat");
    expect(heartbeatFilePath({ WORKER_HEARTBEAT_FILE: " /run/hb " })).toBe("/run/hb");
    expect(workerId({ WORKER_ID: "w-1" })).toBe("w-1");
    expect(workerId({ WORKER_ID: "x".repeat(200) })).toHaveLength(128);
  });
});
