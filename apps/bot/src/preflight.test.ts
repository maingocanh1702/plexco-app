import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
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
import { runPreflightChecks } from "./preflight.js";
import { provisionQueue } from "./provision-queue.js";
import { PGBOSS_INTERNAL_SEND_IT_QUEUE, QUEUES } from "./queues.js";

const execFileAsync = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKER_ENTRYPOINT = path.join(HERE, "worker.ts");
const TSX_BIN = path.join(HERE, "..", "node_modules", ".bin", "tsx");
// app_worker's password is CLUSTER-global: ROLE_PW.app_worker, leased for the fixture's lifetime
// (setAppWorkerPasswordRaceSafe) and restored by the last participant on the cluster.

// --- DB test setup: the stateless job_definer helpers now live in ./test-db.ts
// (shared with dispatcher.test.ts and schedule.test.ts); this file still owns its
// own DB fixtures below.

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
  const migrationUrl = testUrl(base, { db: dbName });
  const directUrl = testUrl(base, {
    db: dbName,
    user: "app_worker",
    password: ROLE_PW.app_worker,
  });
  let created = false;
  let passwords: TestRolePasswordLease | undefined;
  const teardown = async () => {
    await passwords?.release(); // spawned workers and runPreflightChecks have finished by now
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
  return { migrationUrl, directUrl, teardown };
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

it(
  "cleans the preflight database and acquired clients when setup fails after CREATE",
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
      const dbName = "plexco_bot_preflight_setup_failure";
      await expect(setupWorkerContext(dbName)).rejects.toBe(failure);
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

describe("runPreflightChecks", () => {
  it(
    "JRD-1: passes when provision-queue ran after the queue was registered",
    withTestContext(
      () => setupWorkerContext("plexco_jrd_preflight_1"),
      async (ctx) => {
        await provisionQueue(ctx.migrationUrl);
        await provisionQueue(ctx.migrationUrl); // repeat provisioning must preserve runtime access

        const result = await runPreflightChecks(ctx.directUrl);

        expect(result.failures).toEqual([]);
        expect(result.ok).toBe(true);
      },
    ),
  );

  it(
    "JRD-2: FAILS when a registered queue has no pgboss partition, even though the schema/grants exist",
    withTestContext(
      () => setupWorkerContext("plexco_jrd_preflight_2"),
      async (ctx) => {
        await provisionQueue(ctx.migrationUrl);

        // Undo just this ONE queue's provisioning (schema/base tables/grants stay
        // intact) via pg-boss's own delete_queue — precisely reproducing "this
        // queue is in QUEUES.ts but was never actually provisioned against this
        // database" without touching QUEUES.ts itself.
        const migration = new pg.Client({ connectionString: ctx.migrationUrl });
        try {
          await migration.connect();
          await migration.query("SELECT pgboss.delete_queue($1)", [QUEUES[0]]);
        } finally {
          await migration.end();
        }

        const result = await runPreflightChecks(ctx.directUrl);

        expect(result.ok).toBe(false);
        expect(result.failures.some((f) => f.includes(QUEUES[0]!) && f.includes("no"))).toBe(true);
      },
    ),
  );

  it(
    "JSO-2: THE FENCE — FAILS when __pgboss__send-it's partition is absent, and NAMES it, instead of pg-boss silently swallowing its own createQueue error (timekeeper.js's empty try/catch)",
    withTestContext(
      () => setupWorkerContext("plexco_jso_preflight_fence"),
      async (ctx) => {
        await provisionQueue(ctx.migrationUrl);

        const migration = new pg.Client({ connectionString: ctx.migrationUrl });
        try {
          await migration.connect();
          await migration.query("SELECT pgboss.delete_queue($1)", [PGBOSS_INTERNAL_SEND_IT_QUEUE]);
        } finally {
          await migration.end();
        }

        const result = await runPreflightChecks(ctx.directUrl);

        expect(result.ok).toBe(false);
        expect(
          result.failures.some(
            (f) => f.includes(PGBOSS_INTERNAL_SEND_IT_QUEUE) && f.includes("no"),
          ),
        ).toBe(true);
      },
    ),
  );

  it(
    "JRD-3: FAILS when app_worker is missing an asserted grant, even though the queue exists",
    withTestContext(
      () => setupWorkerContext("plexco_jrd_preflight_3"),
      async (ctx) => {
        await provisionQueue(ctx.migrationUrl);

        const migration = new pg.Client({ connectionString: ctx.migrationUrl });
        try {
          await migration.connect();
          await migration.query("REVOKE SELECT ON pgboss.queue FROM app_worker");
        } finally {
          await migration.end();
        }

        const result = await runPreflightChecks(ctx.directUrl);

        expect(result.ok).toBe(false);
        expect(
          result.failures.some((f) => f.includes("SELECT") && f.includes("pgboss.queue")),
        ).toBe(true);
      },
    ),
  );

  it(
    "FAILS when connected as the migration/superuser role instead of app_worker, even though every privilege trivially succeeds",
    withTestContext(
      () => setupWorkerContext("plexco_jrd_preflight_identity"),
      async (ctx) => {
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
        expect(result.failures.some((f) => f.includes('expected both to be "app_worker"'))).toBe(
          true,
        );
      },
    ),
  );

  it(
    "FAILS when current_user is switched to app_worker but session_user (who actually authenticated) is not",
    withTestContext(
      () => setupWorkerContext("plexco_jrd_preflight_session_user"),
      async (ctx) => {
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
      },
    ),
  );

  it(
    "FAILS when app_worker loses its only USAGE grant on a sequence — enumerated even though the ACL-filtered information_schema view would hide it",
    withTestContext(
      () => setupWorkerContext("plexco_jrd_preflight_sequence"),
      async (ctx) => {
        await provisionQueue(ctx.migrationUrl);

        const migration = new pg.Client({ connectionString: ctx.migrationUrl });
        try {
          await migration.connect();
          // pg-boss 10.4.2 creates zero sequences of its own (every id defaults via
          // gen_random_uuid()) — seed one directly to exercise the enumeration path.
          await migration.query("CREATE SEQUENCE pgboss.jrd_test_seq");
          await migration.query("GRANT USAGE ON SEQUENCE pgboss.jrd_test_seq TO app_worker");
        } finally {
          await migration.end();
        }

        const withGrant = await runPreflightChecks(ctx.directUrl);
        expect(withGrant.ok).toBe(true);

        const migration2 = new pg.Client({ connectionString: ctx.migrationUrl });
        try {
          await migration2.connect();
          await migration2.query("REVOKE USAGE ON SEQUENCE pgboss.jrd_test_seq FROM app_worker");
        } finally {
          await migration2.end();
        }

        const withoutGrant = await runPreflightChecks(ctx.directUrl);
        expect(withoutGrant.ok).toBe(false);
        expect(withoutGrant.failures.some((f) => f.includes("jrd_test_seq"))).toBe(true);
      },
    ),
  );

  it(
    "FAILS when a queue's row survives but its partition table was dropped (detached from pgboss.job)",
    withTestContext(
      () => setupWorkerContext("plexco_jrd_preflight_partition"),
      async (ctx) => {
        await provisionQueue(ctx.migrationUrl);

        const migration = new pg.Client({ connectionString: ctx.migrationUrl });
        let partitionName: string;
        try {
          await migration.connect();
          const partition = await migration.query<{ partition_name: string }>(
            "SELECT partition_name FROM pgboss.queue WHERE name = $1",
            [QUEUES[0]],
          );
          partitionName = partition.rows[0]!.partition_name;
          // Drop only the partition table — the pgboss.queue row itself, and every
          // grant on it, stay exactly as provisionQueue() left them. Postgres
          // detaches an attached partition automatically as part of DROP TABLE.
          await migration.query(`DROP TABLE pgboss.${partitionName}`);
        } finally {
          await migration.end();
        }

        const result = await runPreflightChecks(ctx.directUrl);

        expect(result.ok).toBe(false);
        expect(
          result.failures.some((f) => f.includes(QUEUES[0]!) && f.includes(partitionName)),
        ).toBe(true);
      },
    ),
  );

  it(
    "JRD-4: preflight runs BEFORE boss.start() — no pg-boss startup work happens when it fails",
    withTestContext(
      () => setupWorkerContext("plexco_jrd_preflight_4"),
      async (ctx) => {
        await provisionQueue(ctx.migrationUrl);
        const migration = new pg.Client({ connectionString: ctx.migrationUrl });
        try {
          await migration.connect();
          await migration.query("SELECT pgboss.delete_queue($1)", [QUEUES[0]]);
        } finally {
          await migration.end();
        }

        const { code, stdout, stderr } = await spawnWorker(ctx.directUrl);

        expect(code).not.toBe(0);
        expect(stderr).toContain("[preflight] FAILED");
        // Not merely "the process exited" — proves boss.start() itself was never reached.
        expect(stdout).not.toContain("[worker] pg-boss started");
      },
    ),
  );

  it(
    "JRD-18: worker exits non-zero on a stale pgboss schema version — pg-boss's OWN check(), not this slice's preflight",
    withTestContext(
      () => setupWorkerContext("plexco_jrd_preflight_18"),
      async (ctx) => {
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
        try {
          await migration.connect();
          await migration.query("UPDATE pgboss.version SET version = 1");
        } finally {
          await migration.end();
        }

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
      },
    ),
  );
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
