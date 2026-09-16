import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import pg from "pg";
import PgBoss from "pg-boss";
import { migrate } from "@plexco/db";
import { describe, expect, it, vi } from "vitest";
import { withTestContext } from "./test-harness.js";
import {
  isOutboxDispatchScheduleEnabled,
  registerOutboxDispatchSchedule,
  resolveOutboxDispatchEnablement,
} from "./worker.js";
import { productionStubDeliver } from "./dispatcher.js";
import { provisionQueue } from "./provision-queue.js";
import { QUEUE_SCHEMA } from "./queue.js";
import {
  OUTBOX_DISPATCH_CRON,
  OUTBOX_DISPATCH_QUEUE,
  PGBOSS_INTERNAL_SEND_IT_QUEUE,
} from "./queues.js";
import { REQUIRED_PROJECTORS, runDispatchCycle } from "./dispatcher.js";

const execFileAsync = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKER_ENTRYPOINT = path.join(HERE, "worker.ts");
const TSX_BIN = path.join(HERE, "..", "node_modules", ".bin", "tsx");
const APP_WORKER_PASSWORD = "plexco_test_worker_jrd";
// Deliberately the SAME constant preflight.test.ts/dispatcher.test.ts use — app_worker's
// password is a CLUSTER-global role attribute, and vitest runs test files concurrently
// (see preflight.test.ts's header comment for the full rationale). Using a different value
// here would race with those files' own setup, whichever runs last would silently break the
// others' already-open connections.

// --- DB test setup, duplicated from preflight.test.ts/dispatcher.test.ts's identical pattern
// (itself mirroring packages/db/src/test-harness.ts) rather than factored into a shared helper
// — see preflight.test.ts's header comment for why: test-harness.ts is not part of @plexco/db's
// public exports map. Only the joined test-operation wrapper is shared.

const JOB_DEFINER_BOOTSTRAP_SQL_PATH = path.join(
  HERE,
  "..",
  "..",
  "..",
  "infra",
  "postgres-init",
  "01-job-definer.sql",
);
const JOB_DEFINER_LOCK_KEY = 0x6a6f6264; // "jobd" — must match packages/db/src/test-harness.ts's key.

async function bootstrapJobDefiner(client: pg.Client): Promise<void> {
  const sql = await readFile(JOB_DEFINER_BOOTSTRAP_SQL_PATH, "utf8");
  try {
    await client.query(sql);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function withJobDefinerLock<T>(base: string, fn: () => Promise<T>): Promise<T> {
  const lockClient = new pg.Client({ connectionString: base });
  try {
    await lockClient.connect();
    await lockClient.query("SELECT pg_advisory_lock($1)", [JOB_DEFINER_LOCK_KEY]);
    return await fn();
  } finally {
    // Closing the session releases its advisory lock, including on failed setup.
    await lockClient.end();
  }
}

async function setAppWorkerPasswordRaceSafe(client: pg.Client, password: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await client.query(`ALTER ROLE app_worker WITH LOGIN PASSWORD '${password}'`);
      return;
    } catch (error) {
      if (String(error).includes("tuple concurrently updated") && attempt < 10) {
        await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
        continue;
      }
      throw error;
    }
  }
}

function testUrl(base: string, opts: { db?: string; user?: string; password?: string }): string {
  const url = new URL(base);
  if (opts.db) url.pathname = `/${opts.db}`;
  if (opts.user) {
    url.username = opts.user;
    url.password = opts.password ?? "";
  }
  return url.toString();
}

interface ScheduleTestContext {
  migrationUrl: string;
  directUrl: string;
  /** superuser seat — fixture seeding and direct-state verification ONLY. */
  verify: pg.Client;
  teardown: () => Promise<void>;
}

async function setupScheduleContext(dbName: string): Promise<ScheduleTestContext> {
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
    password: APP_WORKER_PASSWORD,
  });
  let created = false;
  let verify: pg.Client | undefined;
  const teardown = async () => {
    const closed = await Promise.allSettled([verify?.end()]);
    const errors = closed
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
    await setAppWorkerPasswordRaceSafe(admin, APP_WORKER_PASSWORD);
    verify = new pg.Client({ connectionString: migrationUrl });
    await verify.connect();
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
  return { migrationUrl, directUrl, verify: verify!, teardown };
}

async function seedTenant(client: pg.Client): Promise<string> {
  const suffix = Math.random().toString(36).slice(2);
  const result = await client.query<{ id: string }>(
    "INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id",
    [`JSO Test Tenant ${suffix}`, `jso-test-${suffix}`],
  );
  return result.rows[0]!.id;
}

async function seedOutboxEvent(client: pg.Client, tenantId: string): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO outbox_events (tenant_id, aggregate_type, aggregate_id, sequence, type, payload)
     VALUES ($1, 'jso_test_aggregate', gen_random_uuid(), 1, 'jso.test.event', '{}'::jsonb)
     RETURNING id`,
    [tenantId],
  );
  return result.rows[0]!.id;
}

it(
  "cleans the schedule database and acquired clients when setup fails after CREATE",
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
        if (args[0] === "SELECT pg_advisory_lock($1)") return Promise.reject(failure);
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
      const dbName = "plexco_bot_schedule_setup_failure";
      await expect(setupScheduleContext(dbName)).rejects.toBe(failure);
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

describe("isOutboxDispatchScheduleEnabled", () => {
  it('enables only on the exact string "true"', () => {
    expect(isOutboxDispatchScheduleEnabled("true")).toBe(true);
  });

  it("fails closed on unset, empty, and every near-miss value — never treats garbage as opt-in", () => {
    expect(isOutboxDispatchScheduleEnabled(undefined)).toBe(false);
    expect(isOutboxDispatchScheduleEnabled("")).toBe(false);
    expect(isOutboxDispatchScheduleEnabled("TRUE")).toBe(false);
    expect(isOutboxDispatchScheduleEnabled("True")).toBe(false);
    expect(isOutboxDispatchScheduleEnabled("1")).toBe(false);
    expect(isOutboxDispatchScheduleEnabled("yes")).toBe(false);
    expect(isOutboxDispatchScheduleEnabled("false")).toBe(false);
    expect(isOutboxDispatchScheduleEnabled(" true")).toBe(false);
    expect(isOutboxDispatchScheduleEnabled("true ")).toBe(false);
    expect(isOutboxDispatchScheduleEnabled("garbage")).toBe(false);
  });
});

describe("registerOutboxDispatchSchedule", () => {
  it(
    "JSO-1: enabled=true creates a pgboss.schedule row for OUTBOX_DISPATCH_QUEUE with the pinned cron expression — called directly, independent of process.env, so this cannot pass vacuously off a test-environment flag",
    withTestContext(
      () => setupScheduleContext("plexco_jso_schedule_1"),
      async (ctx) => {
        await provisionQueue(ctx.migrationUrl);

        const boss = new PgBoss({
          connectionString: ctx.directUrl,
          schema: QUEUE_SCHEMA,
          migrate: false,
        });
        try {
          await boss.start();
          await registerOutboxDispatchSchedule(boss, true);

          const row = await ctx.verify.query<{ name: string; cron: string }>(
            "SELECT name, cron FROM pgboss.schedule WHERE name = $1",
            [OUTBOX_DISPATCH_QUEUE],
          );
          expect(row.rows).toHaveLength(1);
          expect(row.rows[0]!.cron).toBe(OUTBOX_DISPATCH_CRON);
        } finally {
          await boss.stop({ graceful: true, wait: true });
        }
      },
    ),
  );

  it(
    "enabled=false registers no schedule row — the flag genuinely gates the mechanism, not just a log line",
    withTestContext(
      () => setupScheduleContext("plexco_jso_schedule_1b"),
      async (ctx) => {
        await provisionQueue(ctx.migrationUrl);

        const boss = new PgBoss({
          connectionString: ctx.directUrl,
          schema: QUEUE_SCHEMA,
          migrate: false,
        });
        try {
          await boss.start();
          await registerOutboxDispatchSchedule(boss, false);

          const row = await ctx.verify.query("SELECT name FROM pgboss.schedule WHERE name = $1", [
            OUTBOX_DISPATCH_QUEUE,
          ]);
          expect(row.rows).toHaveLength(0);
        } finally {
          await boss.stop({ graceful: true, wait: true });
        }
      },
    ),
  );

  it(
    "reconciles, not just skips: disabling after a prior enabled run REMOVES the persisted schedule row (codex round-01 [P1]) — pg-boss's own timekeeper fires an existing row regardless of this flag, so a rollback that only skipped re-registering would leave the old schedule live",
    withTestContext(
      () => setupScheduleContext("plexco_jso_schedule_1c"),
      async (ctx) => {
        await provisionQueue(ctx.migrationUrl);

        const boss = new PgBoss({
          connectionString: ctx.directUrl,
          schema: QUEUE_SCHEMA,
          migrate: false,
        });
        try {
          await boss.start();
          await registerOutboxDispatchSchedule(boss, true);
          const enabled = await ctx.verify.query(
            "SELECT name FROM pgboss.schedule WHERE name = $1",
            [OUTBOX_DISPATCH_QUEUE],
          );
          expect(enabled.rows).toHaveLength(1);

          await registerOutboxDispatchSchedule(boss, false);
          const disabled = await ctx.verify.query(
            "SELECT name FROM pgboss.schedule WHERE name = $1",
            [OUTBOX_DISPATCH_QUEUE],
          );
          expect(disabled.rows).toHaveLength(0);
        } finally {
          await boss.stop({ graceful: true, wait: true });
        }
      },
    ),
  );

  it(
    "JSO-5: the leader-election write path (timekeeper's trySetCronTime -> UPDATE pgboss.version.cron_on) works from the real app_worker seat",
    withTestContext(
      () => setupScheduleContext("plexco_jso_schedule_5"),
      async (ctx) => {
        await provisionQueue(ctx.migrationUrl);

        const before = Date.now();
        const boss = new PgBoss({
          connectionString: ctx.directUrl,
          schema: QUEUE_SCHEMA,
          migrate: false,
          // Tightened only to make this test fast and deterministic — production
          // relies on pg-boss's own default (30s), unchanged by this slice.
          cronMonitorIntervalSeconds: 1,
        });
        try {
          await boss.start();
          await new Promise((resolve) => setTimeout(resolve, 2500));

          const result = await ctx.verify.query<{ cron_on: Date | null }>(
            "SELECT cron_on FROM pgboss.version",
          );
          const cronOn = result.rows[0]!.cron_on;
          expect(cronOn).not.toBeNull();
          expect(cronOn!.getTime()).toBeGreaterThanOrEqual(before - 1000);
        } finally {
          await boss.stop({ graceful: true, wait: true });
        }
      },
    ),
  );

  it(
    "JSO-6: enqueuing through __pgboss__send-it — the SAME internal queue timekeeper.cron() uses, not a shortcut into the real queue (codex round-01 [P2]) — actually drives runDispatchCycle end to end: claimed, prepared, acked",
    withTestContext(
      () => setupScheduleContext("plexco_jso_schedule_6"),
      async (ctx) => {
        await provisionQueue(ctx.migrationUrl);
        const tenantId = await seedTenant(ctx.verify);
        const eventId = await seedOutboxEvent(ctx.verify, tenantId);

        const boss = new PgBoss({
          connectionString: ctx.directUrl,
          schema: QUEUE_SCHEMA,
          migrate: false,
          // Tightened so pg-boss's OWN internal __pgboss__send-it worker (armed
          // automatically by boss.start(), since `schedule` defaults true and
          // this repo never overrides it) fans out promptly instead of waiting
          // its 5s default (attorney.js).
          cronWorkerIntervalSeconds: 1,
        });
        const workerPool = new pg.Pool({ connectionString: ctx.directUrl });
        try {
          await boss.start();
          await registerOutboxDispatchSchedule(boss, true);

          let resolveHandled: (summary: { claimedEvents: number; ackedEvents: number }) => void;
          const handled = new Promise<{ claimedEvents: number; ackedEvents: number }>((resolve) => {
            resolveHandled = resolve;
          });

          await boss.work(OUTBOX_DISPATCH_QUEUE, { pollingIntervalSeconds: 1 }, async () => {
            const summary = await runDispatchCycle(workerPool, {
              deliver: async () => ({ result: "delivered" }),
              requiredProjectors: REQUIRED_PROJECTORS,
            });
            resolveHandled(summary);
          });

          // timekeeper.cron() (pg-boss internals, timekeeper.js) never inserts
          // into the real queue directly — it inserts INTO __pgboss__send-it:
          // `{ name: QUEUES.SEND_IT, data: { name, data, ...options },
          // singletonKey: name, singletonSeconds: 60 }`. Mirror that shape
          // exactly here, through the SAME public boss.send() API, so this test
          // exercises pg-boss's own already-running __pgboss__send-it worker
          // (registered inside timekeeper.start(): manager.work(QUEUES.SEND_IT,
          // ..., (jobs) => manager.insert(jobs.map(i => i.data)))) — the exact
          // fan-out mechanism this slice's fence exists to protect — rather
          // than bypassing it with a direct send to the real queue.
          await boss.send(
            PGBOSS_INTERNAL_SEND_IT_QUEUE,
            { name: OUTBOX_DISPATCH_QUEUE, data: {} },
            { singletonKey: OUTBOX_DISPATCH_QUEUE, singletonSeconds: 60 },
          );

          const summary = await Promise.race([
            handled,
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error("timed out waiting for dispatch handler")), 8000),
            ),
          ]);

          expect(summary.claimedEvents).toBe(1);
          expect(summary.ackedEvents).toBe(1);

          const delivery = await ctx.verify.query<{ status: string }>(
            "SELECT status FROM projector_deliveries WHERE event_id = $1",
            [eventId],
          );
          expect(delivery.rows).toHaveLength(1);
          expect(delivery.rows[0]!.status).toBe("delivered");
        } finally {
          try {
            await boss.stop({ graceful: true, wait: true });
          } finally {
            await workerPool.end();
          }
        }
      },
    ),
  );
});

/**
 * codex round-02 [P1]: unschedule() alone only stops FUTURE sends. Whether
 * this process even LISTENS on OUTBOX_DISPATCH_QUEUE is a separate question
 * — main() must gate boss.work() registration on the same flag, so a stray
 * or raced job sits inert instead of driving productionStubDeliver. Proven
 * against the REAL spawned entrypoint (matching JRD-4/JRD-18's pattern in
 * preflight.test.ts), not just the exported helper in isolation.
 */
async function spawnWorkerBriefly(
  directUrl: string,
  extraEnv: Record<string, string> = {},
): Promise<{ stdout: string; stderr: string }> {
  try {
    await execFileAsync(TSX_BIN, [WORKER_ENTRYPOINT], {
      env: { ...process.env, DATABASE_URL_DIRECT: directUrl, ...extraEnv },
      timeout: 3000,
    });
    throw new Error("worker exited on its own — expected a timeout-triggered SIGTERM instead");
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string };
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

describe("main() — boss.work() registration (spawned process)", () => {
  it(
    "does NOT register a boss.work() consumer for OUTBOX_DISPATCH_QUEUE when the schedule flag is disabled (codex round-02 [P1])",
    withTestContext(
      () => setupScheduleContext("plexco_jso_worker_gate_off"),
      async (ctx) => {
        await provisionQueue(ctx.migrationUrl);

        // codex round-03 [P2]: explicitly override, don't just omit — an empty
        // extraEnv still INHERITS OUTBOX_DISPATCH_SCHEDULE_ENABLED from
        // process.env via the spread in spawnWorkerBriefly, so a developer or CI
        // shell that happens to export it "true" would silently flip this
        // "disabled" case to the enabled path and fail for no code regression.
        const { stdout } = await spawnWorkerBriefly(ctx.directUrl, {
          OUTBOX_DISPATCH_SCHEDULE_ENABLED: "",
        });

        expect(stdout).toContain("[worker] pg-boss started");
        expect(stdout).toContain(
          "[worker] outbox dispatch worker not registered (schedule disabled)",
        );
      },
    ),
  );

  /**
   * This assertion inverted with the X-3 fix. The flag alone used to be enough to register the
   * schedule and a boss.work() consumer; the audit showed the comment justifying that ("no
   * producer inserts outbox_events") had rotted — session-service.ts emits eight event types —
   * while the only configured deliverer is still productionStubDeliver, which acks then DLQs
   * every row terminally. So worker.ts now refuses the pair even with the flag on, and says why.
   *
   * When a real projector replaces the stub (backlog projector-real-replace-stub), `deliver` stops
   * being productionStubDeliver, resolveOutboxDispatchEnablement returns enabled, and THIS test
   * flips back to asserting registration — that lane owns the flip. The unit-level matrix for the
   * decision itself lives in the resolveOutboxDispatchEnablement describe below.
   */
  it(
    "REFUSES to register the schedule even with the flag enabled, while the deliverer is still the stub (audit X-3)",
    withTestContext(
      () => setupScheduleContext("plexco_jso_worker_gate_on"),
      async (ctx) => {
        await provisionQueue(ctx.migrationUrl);

        const { stdout } = await spawnWorkerBriefly(ctx.directUrl, {
          OUTBOX_DISPATCH_SCHEDULE_ENABLED: "true",
        });

        expect(stdout).toContain("[worker] pg-boss started");
        expect(stdout).toContain("[worker] outbox dispatch schedule OFF — ");
        expect(stdout).toContain("productionStubDeliver");
        expect(stdout).not.toContain("outbox dispatch schedule registered");
        // and, because "off" must mean this process never touches dispatch at all, no consumer either
        expect(stdout).toContain(
          "[worker] outbox dispatch worker not registered (schedule disabled)",
        );
      },
    ),
  );
});

describe("resolveOutboxDispatchEnablement (audit 2026-09-06 X-3)", () => {
  it("is off when the flag is off, whatever the deliverer", () => {
    expect(
      resolveOutboxDispatchEnablement(undefined, async () => ({ result: "delivered" })),
    ).toMatchObject({
      enabled: false,
    });
  });
  it("REFUSES to enable with the flag on while the deliverer is productionStubDeliver — producers exist and the stub DLQs terminally", () => {
    const r = resolveOutboxDispatchEnablement("true", productionStubDeliver);
    expect(r.enabled).toBe(false);
    expect(r.reason).toMatch(/productionStubDeliver/);
  });
  it("enables with the flag on and a real deliverer", () => {
    expect(resolveOutboxDispatchEnablement("true", async () => ({ result: "delivered" }))).toEqual({
      enabled: true,
      reason: null,
    });
  });
});

/**
 * Audit 2026-09-06 B-4 — the direct-run guard compares module URL to the entry script URL
 * instead of `argv[1].endsWith("worker.ts")`, which was false for any compiled path (the worker
 * would import, do nothing, and exit 0).
 */
describe("isDirectRun (audit B-4)", () => {
  it("is true only when the entry script IS this module, for .ts and compiled .js alike", async () => {
    const { isDirectRun } = await import("./direct-run.js");
    const { pathToFileURL } = await import("node:url");
    const tsUrl = pathToFileURL("/app/apps/bot/src/worker.ts").href;
    const jsUrl = pathToFileURL("/app/apps/bot/dist/worker.js").href;
    expect(isDirectRun(tsUrl, "/app/apps/bot/src/worker.ts")).toBe(true);
    expect(isDirectRun(jsUrl, "/app/apps/bot/dist/worker.js")).toBe(true);
    // The old check: a compiled entry does not end in "worker.ts" — it must still count.
    expect("/app/apps/bot/dist/worker.js".endsWith("worker.ts")).toBe(false);
    // Imported from a test (argv[1] is the runner), or no argv at all → not a direct run.
    expect(isDirectRun(tsUrl, "/app/node_modules/vitest/dist/cli.js")).toBe(false);
    expect(isDirectRun(tsUrl, undefined)).toBe(false);
    // A different module with the same basename is not this module.
    expect(isDirectRun(tsUrl, "/elsewhere/worker.ts")).toBe(false);
  });

  it("importing worker.ts from this test did NOT run main() (the guard is what keeps this suite alive)", async () => {
    const mod = await import("./worker.js");
    expect(typeof mod.registerOutboxDispatchSchedule).toBe("function");
    expect(mod.SHUTDOWN_GRACE_MS).toBeLessThan(mod.SHUTDOWN_DEADLINE_MS);
    expect(mod.SHUTDOWN_GRACE_MS).toBeGreaterThanOrEqual(10_000);
  });
});
