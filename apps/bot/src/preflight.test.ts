import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import pg from "pg";
import { migrate } from "@plexco/db";
import { afterEach, describe, expect, it } from "vitest";
import { runPreflightChecks } from "./preflight.js";
import { provisionQueue } from "./provision-queue.js";
import { PGBOSS_INTERNAL_SEND_IT_QUEUE, QUEUES } from "./queues.js";

const execFileAsync = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKER_ENTRYPOINT = path.join(HERE, "worker.ts");
const TSX_BIN = path.join(HERE, "..", "node_modules", ".bin", "tsx");
const APP_WORKER_PASSWORD = "plexco_test_worker_jrd";
// codex round-04 [P2]: app_worker's password is CLUSTER-global, exactly like
// its role attributes and job_definer membership above. This file does NOT
// attempt to restore it after its own suite finishes: an earlier attempt at
// exactly that (an afterAll hook) introduced a WORSE race than the problem
// it solved — vitest runs test files concurrently, so this file's afterAll
// firing while dispatcher.test.ts's pool was still opening new connections
// mid-suite caused a live "password authentication failed" failure there,
// observed directly. Restoring safely would need coordination with every
// OTHER file/package that also authenticates as app_worker (packages/db's
// own suites included, out of this slice's scope) — not something a single
// file's teardown can do correctly. .env.example/infra/docker-compose.yml
// document re-running the bootstrap ALTER ROLE after any `pnpm -w test`
// instead, matching how packages/db's own tests already leave app_worker on
// a test password with no restore, unrelated to this slice.

// --- DB test setup, deliberately duplicated from packages/db/src/test-harness.ts's
// pattern rather than imported: test-harness.ts is not part of @plexco/db's public
// `exports` map (packages/db/package.json), and this manifest's declared scope does
// not include a change there or a new shared test-support file in apps/bot. Small
// enough (~50 lines) to keep local to each of the two test files that need it.

const JOB_DEFINER_BOOTSTRAP_SQL_PATH = path.join(
  HERE,
  "..",
  "..",
  "..",
  "infra",
  "postgres-init",
  "01-job-definer.sql",
);
// SAME key as packages/db/src/test-harness.ts's JOB_DEFINER_LOCK_KEY ("jobd") — this
// lock only protects job_definer (cluster-global) if every caller that bootstraps or
// migrates against it shares the identical advisory-lock key. A different key here
// would silently not coordinate with packages/db's own JCL-2/3 tests, which
// deliberately put job_definer into a broken state mid-run under this same lock.
const JOB_DEFINER_LOCK_KEY = 0x6a6f6264;

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
  await lockClient.connect();
  await lockClient.query("SELECT pg_advisory_lock($1)", [JOB_DEFINER_LOCK_KEY]);
  try {
    return await fn();
  } finally {
    await lockClient.query("SELECT pg_advisory_unlock($1)", [JOB_DEFINER_LOCK_KEY]).catch(() => {});
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

interface WorkerContext {
  migrationUrl: string;
  directUrl: string;
  teardown: () => Promise<void>;
}

async function setupWorkerContext(dbName: string): Promise<WorkerContext> {
  const base = process.env.DATABASE_URL_TEST;
  if (!base) {
    throw new Error(
      "DATABASE_URL_TEST is required (docker compose -f infra/docker-compose.yml up -d postgres; " +
        "export DATABASE_URL_TEST=postgres://plexco:plexco_dev@localhost:5432/plexco_test)",
    );
  }
  const admin = new pg.Client({ connectionString: base });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${dbName}`);

  const migrationUrl = testUrl(base, { db: dbName });
  await withJobDefinerLock(base, async () => {
    await bootstrapJobDefiner(admin);
    await migrate(migrationUrl);
  });
  await setAppWorkerPasswordRaceSafe(admin, APP_WORKER_PASSWORD);
  await admin.end();

  const directUrl = testUrl(base, {
    db: dbName,
    user: "app_worker",
    password: APP_WORKER_PASSWORD,
  });

  return {
    migrationUrl,
    directUrl,
    teardown: async () => {
      const cleanup = new pg.Client({ connectionString: base });
      await cleanup.connect();
      await cleanup.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await cleanup.end();
    },
  };
}

async function spawnWorker(
  directUrl: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const result = await execFileAsync(TSX_BIN, [WORKER_ENTRYPOINT], {
      env: { ...process.env, DATABASE_URL_DIRECT: directUrl },
      timeout: 15_000,
    });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

describe("runPreflightChecks", () => {
  let teardown: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await teardown?.();
    teardown = undefined;
  });

  it("JRD-1: passes when provision-queue ran after the queue was registered", async () => {
    const ctx = await setupWorkerContext("plexco_jrd_preflight_1");
    teardown = ctx.teardown;
    await provisionQueue(ctx.migrationUrl);

    const result = await runPreflightChecks(ctx.directUrl);

    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("JRD-2: FAILS when a registered queue has no pgboss partition, even though the schema/grants exist", async () => {
    const ctx = await setupWorkerContext("plexco_jrd_preflight_2");
    teardown = ctx.teardown;
    await provisionQueue(ctx.migrationUrl);

    // Undo just this ONE queue's provisioning (schema/base tables/grants stay
    // intact) via pg-boss's own delete_queue — precisely reproducing "this
    // queue is in QUEUES.ts but was never actually provisioned against this
    // database" without touching QUEUES.ts itself.
    const migration = new pg.Client({ connectionString: ctx.migrationUrl });
    await migration.connect();
    await migration.query("SELECT pgboss.delete_queue($1)", [QUEUES[0]]);
    await migration.end();

    const result = await runPreflightChecks(ctx.directUrl);

    expect(result.ok).toBe(false);
    expect(result.failures.some((f) => f.includes(QUEUES[0]!) && f.includes("no"))).toBe(true);
  });

  it("JSO-2: THE FENCE — FAILS when __pgboss__send-it's partition is absent, and NAMES it, instead of pg-boss silently swallowing its own createQueue error (timekeeper.js's empty try/catch)", async () => {
    const ctx = await setupWorkerContext("plexco_jso_preflight_fence");
    teardown = ctx.teardown;
    await provisionQueue(ctx.migrationUrl);

    const migration = new pg.Client({ connectionString: ctx.migrationUrl });
    await migration.connect();
    await migration.query("SELECT pgboss.delete_queue($1)", [PGBOSS_INTERNAL_SEND_IT_QUEUE]);
    await migration.end();

    const result = await runPreflightChecks(ctx.directUrl);

    expect(result.ok).toBe(false);
    expect(
      result.failures.some((f) => f.includes(PGBOSS_INTERNAL_SEND_IT_QUEUE) && f.includes("no")),
    ).toBe(true);
  });

  it("JRD-3: FAILS when app_worker is missing an asserted grant, even though the queue exists", async () => {
    const ctx = await setupWorkerContext("plexco_jrd_preflight_3");
    teardown = ctx.teardown;
    await provisionQueue(ctx.migrationUrl);

    const migration = new pg.Client({ connectionString: ctx.migrationUrl });
    await migration.connect();
    await migration.query("REVOKE SELECT ON pgboss.queue FROM app_worker");
    await migration.end();

    const result = await runPreflightChecks(ctx.directUrl);

    expect(result.ok).toBe(false);
    expect(result.failures.some((f) => f.includes("SELECT") && f.includes("pgboss.queue"))).toBe(
      true,
    );
  });

  it("FAILS when connected as the migration/superuser role instead of app_worker, even though every privilege trivially succeeds", async () => {
    const ctx = await setupWorkerContext("plexco_jrd_preflight_identity");
    teardown = ctx.teardown;
    await provisionQueue(ctx.migrationUrl);

    // ctx.migrationUrl is the superuser seat — has_*_privilege(current_user, ...)
    // is true for it on everything, exactly the misconfiguration this check
    // exists to catch (.env.example and the dev compose worker service both
    // currently point DATABASE_URL_DIRECT at this same credential).
    const result = await runPreflightChecks(ctx.migrationUrl);

    expect(result.ok).toBe(false);
    // session_user/current_user are both the superuser here, so the round-05
    // identity check fires (and returns early) before the name/pg_roles check
    // below it is ever reached — this test only proves that OUTER boundary;
    // the session_user-specifically-vs-current_user distinction is exercised
    // by its own dedicated test.
    expect(result.failures.some((f) => f.includes('expected both to be "app_worker"'))).toBe(true);
  });

  it("FAILS when current_user is switched to app_worker but session_user (who actually authenticated) is not", async () => {
    const ctx = await setupWorkerContext("plexco_jrd_preflight_session_user");
    teardown = ctx.teardown;
    await provisionQueue(ctx.migrationUrl);

    // Simulate the exact attack this check exists to catch: a connection
    // that AUTHENTICATES as the migration/superuser credential but sets
    // current_user to app_worker at connect time via a `-c role=` startup
    // option (libpq honors this via the `options` connection parameter) —
    // NOT by actually logging in as app_worker. Every privilege check keyed
    // off current_user alone would pass; session_user reveals the truth.
    const url = new URL(ctx.migrationUrl);
    url.searchParams.set("options", "-c role=app_worker");

    const result = await runPreflightChecks(url.toString());

    expect(result.ok).toBe(false);
    expect(
      result.failures.some(
        (f) => f.includes("session_user") && f.includes('current_user="app_worker"'),
      ),
    ).toBe(true);
  });

  it("FAILS when app_worker loses its only USAGE grant on a sequence — enumerated even though the ACL-filtered information_schema view would hide it", async () => {
    const ctx = await setupWorkerContext("plexco_jrd_preflight_sequence");
    teardown = ctx.teardown;
    await provisionQueue(ctx.migrationUrl);

    const migration = new pg.Client({ connectionString: ctx.migrationUrl });
    await migration.connect();
    // pg-boss 10.4.2 creates zero sequences of its own (every id defaults via
    // gen_random_uuid()) — seed one directly to exercise the enumeration path.
    await migration.query("CREATE SEQUENCE pgboss.jrd_test_seq");
    await migration.query("GRANT USAGE ON SEQUENCE pgboss.jrd_test_seq TO app_worker");
    await migration.end();

    const withGrant = await runPreflightChecks(ctx.directUrl);
    expect(withGrant.ok).toBe(true);

    const migration2 = new pg.Client({ connectionString: ctx.migrationUrl });
    await migration2.connect();
    await migration2.query("REVOKE USAGE ON SEQUENCE pgboss.jrd_test_seq FROM app_worker");
    await migration2.end();

    const withoutGrant = await runPreflightChecks(ctx.directUrl);
    expect(withoutGrant.ok).toBe(false);
    expect(withoutGrant.failures.some((f) => f.includes("jrd_test_seq"))).toBe(true);
  });

  it("FAILS when a queue's row survives but its partition table was dropped (detached from pgboss.job)", async () => {
    const ctx = await setupWorkerContext("plexco_jrd_preflight_partition");
    teardown = ctx.teardown;
    await provisionQueue(ctx.migrationUrl);

    const migration = new pg.Client({ connectionString: ctx.migrationUrl });
    await migration.connect();
    const partition = await migration.query<{ partition_name: string }>(
      "SELECT partition_name FROM pgboss.queue WHERE name = $1",
      [QUEUES[0]],
    );
    const partitionName = partition.rows[0]!.partition_name;
    // Drop only the partition table — the pgboss.queue row itself, and every
    // grant on it, stay exactly as provisionQueue() left them. Postgres
    // detaches an attached partition automatically as part of DROP TABLE.
    await migration.query(`DROP TABLE pgboss.${partitionName}`);
    await migration.end();

    const result = await runPreflightChecks(ctx.directUrl);

    expect(result.ok).toBe(false);
    expect(result.failures.some((f) => f.includes(QUEUES[0]!) && f.includes(partitionName))).toBe(
      true,
    );
  });

  it("JRD-4: preflight runs BEFORE boss.start() — no pg-boss startup work happens when it fails", async () => {
    const ctx = await setupWorkerContext("plexco_jrd_preflight_4");
    teardown = ctx.teardown;
    await provisionQueue(ctx.migrationUrl);
    const migration = new pg.Client({ connectionString: ctx.migrationUrl });
    await migration.connect();
    await migration.query("SELECT pgboss.delete_queue($1)", [QUEUES[0]]);
    await migration.end();

    const { code, stdout, stderr } = await spawnWorker(ctx.directUrl);

    expect(code).not.toBe(0);
    expect(stderr).toContain("[preflight] FAILED");
    // Not merely "the process exited" — proves boss.start() itself was never reached.
    expect(stdout).not.toContain("[worker] pg-boss started");
  });

  it("JRD-18: worker exits non-zero on a stale pgboss schema version — pg-boss's OWN check(), not this slice's preflight", async () => {
    const ctx = await setupWorkerContext("plexco_jrd_preflight_18");
    teardown = ctx.teardown;
    await provisionQueue(ctx.migrationUrl);

    // Corrupt ONLY the schema version, leaving everything preflight.ts itself
    // asserts (USAGE, the registered queue's row, every table/sequence grant)
    // fully correct — an absent schema would also be caught by preflight's
    // own assertSchemaUsage (has_schema_privilege raises on a missing
    // schema), which would prove nothing about the third-party boundary this
    // row exists to pin. A version mismatch on an otherwise-complete schema
    // is invisible to preflight.ts (it never reads pgboss.version) and can
    // only be caught by pg-boss's own contractor.check() inside boss.start().
    const migration = new pg.Client({ connectionString: ctx.migrationUrl });
    await migration.connect();
    await migration.query("UPDATE pgboss.version SET version = 1");
    await migration.end();

    const passesOnItsOwn = await runPreflightChecks(ctx.directUrl);
    expect(passesOnItsOwn.ok).toBe(true);

    const { code, stdout, stderr } = await spawnWorker(ctx.directUrl);

    expect(code).not.toBe(0);
    // NOT "[preflight] FAILED" — preflight passed; pg-boss's own check() is
    // what must reject this, inside boss.start(), caught by main()'s outer
    // catch as a fatal startup error.
    expect(stderr).not.toContain("[preflight] FAILED");
    expect(stderr).toContain("[worker] fatal");
    expect(stdout).not.toContain("[worker] pg-boss started");
  });
});

describe("preflight.ts — shipped source (static)", () => {
  it("JSO-4: contains ZERO role-attribute, ownership, excess-privilege or membership assertions — asserted structurally, not by observing that tests pass", async () => {
    // Verdict 22 cut this class after it consumed six codex rounds
    // (round-06 MAX_ROUNDS HALT: every finding added one more dimension of
    // "does app_worker have exactly the intended privilege set"). DD-90 Q6
    // asks this preflight to assert PRESENCE of required grants, never
    // ABSENCE of excess ones — that boundary must not creep back while this
    // slice extends the same file with a new fence assertion.
    const raw = await readFile(path.join(HERE, "preflight.ts"), "utf8");
    // Strip comments first: this file's own header/inline comments legitimately
    // NAME this cut class in prose (documenting why it's absent) — checking
    // against CODE only, not documentation, avoids flagging the very comments
    // that record the boundary this test exists to guard.
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    const forbiddenPatterns = [
      /pg_roles/, // role-attribute catalog (rolsuper/rolcreaterole/rolcreatedb/rolbypassrls/rolinherit)
      /rolsuper|rolcreaterole|rolcreatedb|rolbypassrls|rolcanlogin/,
      /pg_has_role/, // membership check
      /relowner|pg_get_userbyid/, // ownership check
      /job_definer/, // job_definer membership/ownership belongs to packages/db's own allowlist test, not this preflight
    ];
    for (const pattern of forbiddenPatterns) {
      expect(code).not.toMatch(pattern);
    }
  });
});
