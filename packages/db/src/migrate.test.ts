import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureRoleExists, migrate } from "./migrate.js";
import {
  bootstrapJobDefiner,
  setupNonSuperuserOwnerContext,
  withJobDefinerLock,
} from "./test-harness.js";

/**
 * Migration-runner invariant suite for the CLUSTER-GLOBAL role race.
 *
 * The bug (Codex auth-onboarding-v3 round-08): migration 0000 creates the
 * app / app_worker / readonly roles with a check-then-act DO block. Roles are
 * cluster-global while databases are not, so two migrate() runs bootstrapping
 * two DIFFERENT databases on the SAME cluster can both see "role missing" and
 * both CREATE — the loser dies with "role already exists" (duplicate_object, or
 * unique_violation on pg_authid when both pass the pre-check at once). The
 * runner-level fix ensures the roles up front with a race-safe CREATE-then-
 * swallow-"already exists" idiom, gated on 0000 not yet applied.
 *
 * Needs DATABASE_URL_TEST = a SUPERUSER url on a throwaway cluster. Every db
 * and every helper role created here is prefixed `plexco_migrate_` so it can
 * never collide with the rls / auth / waitlist suites (which share the
 * app/app_worker/readonly roles and their own `plexco_*_check` databases) when
 * vitest runs the files in parallel.
 */

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const MIGRATION_COUNT = 23; // 0000..0022 — must match rls-invariants.test.ts

const BASE = process.env.DATABASE_URL_TEST;
if (!BASE) {
  throw new Error(
    "DATABASE_URL_TEST is required for the migrate suite (CI sets it; locally: " +
      "docker compose -f infra/docker-compose.yml up -d postgres and export " +
      "DATABASE_URL_TEST=postgres://plexco:plexco_dev@localhost:5432/plexco_test)",
  );
}
const BASE_DB = new URL(BASE).pathname.replace(/^\//, "");

/** Build a connection url onto `db`, optionally as a different role. */
function url(db: string, user?: string, password?: string): string {
  const u = new URL(BASE!);
  u.pathname = `/${db}`;
  if (user) {
    u.username = user;
    u.password = password ?? "";
  }
  return u.toString();
}

async function connect(connectionString: string): Promise<pg.Client> {
  const c = new pg.Client({ connectionString });
  await c.connect();
  return c;
}

async function roleCount(admin: pg.Client, role: string): Promise<number> {
  const { rows } = await admin.query(`SELECT count(*)::int AS n FROM pg_roles WHERE rolname = $1`, [
    role,
  ]);
  return (rows[0] as { n: number }).n;
}

let admin: pg.Client;

beforeAll(async () => {
  admin = await connect(BASE!);
  // job_definer is cluster-global and must exist (correctly) before ANY migrate() call in this
  // file reaches 0022, which only asserts it. Safe unlocked here: this runs once, before every
  // JCL-2/3 test below (the only tests in this suite that put it into a broken state, and they
  // all hold withJobDefinerLock for that window) — see withJobDefinerLock's doc comment.
  await bootstrapJobDefiner(admin);
}, 120_000);

afterAll(async () => {
  await admin?.end();
});

describe("BR-1 race-safe cluster-global role creation", () => {
  // Deterministic: an ABSENT throwaway role, N connections racing to create it.
  // Proves the collision-swallow path itself (not left to CI cold-start luck),
  // safely — it never touches the shared app/app_worker/readonly roles.
  it("N concurrent creates of an absent role all succeed; role exists exactly once", async () => {
    const race = "plexco_migrate_race";
    const N = 8;
    for (let iter = 0; iter < 5; iter++) {
      await admin.query(`DROP ROLE IF EXISTS ${race}`);
      const clients = await Promise.all(Array.from({ length: N }, () => connect(BASE!)));
      try {
        const results = await Promise.allSettled(clients.map((c) => ensureRoleExists(c, race)));
        const rejected = results.filter((r) => r.status === "rejected");
        expect(
          rejected,
          `no create should escape: ${rejected
            .map((r) => String((r as PromiseRejectedResult).reason))
            .join(" | ")}`,
        ).toEqual([]);
        expect(await roleCount(admin, race)).toBe(1);
      } finally {
        await Promise.all(clients.map((c) => c.end()));
      }
    }
    await admin.query(`DROP ROLE IF EXISTS ${race}`);
  }, 60_000);

  // Production-shaped: N full migrate() runs bootstrapping N fresh databases on
  // one cluster, concurrently, repeated. All must succeed with every role intact.
  it("N concurrent migrate() bootstrapping fresh databases all succeed, roles intact", async () => {
    const N = 3;
    for (let iter = 0; iter < 2; iter++) {
      const dbs = Array.from({ length: N }, (_, i) => `plexco_migrate_conc_${iter}_${i}`);
      for (const db of dbs) {
        await admin.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
        await admin.query(`CREATE DATABASE ${db}`);
      }
      try {
        const results = await Promise.allSettled(dbs.map((db) => migrate(url(db))));
        for (const r of results) {
          if (r.status === "rejected") {
            throw new Error(`concurrent migrate rejected: ${String(r.reason)}`);
          }
          expect(r.value.applied.length).toBe(MIGRATION_COUNT);
        }
        for (const role of ["app", "app_worker", "readonly"]) {
          expect(await roleCount(admin, role), `${role} must exist exactly once`).toBe(1);
        }
      } finally {
        for (const db of dbs) {
          await admin.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
        }
      }
    }
  }, 180_000);
});

describe("BR-2 applied migrations stay immutable", () => {
  it("0000's recorded sha256 equals the file on disk, and a changed applied file is rejected", async () => {
    const db = "plexco_migrate_immut";
    await admin.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${db}`);
    try {
      await migrate(url(db));

      const fileSql = await readFile(
        path.join(MIGRATIONS_DIR, "0000_roles_extensions.sql"),
        "utf8",
      );
      const fileSha = createHash("sha256").update(fileSql).digest("hex");

      const c = await connect(url(db));
      try {
        const rec = await c.query(
          `SELECT sha256 FROM schema_migrations WHERE name = '0000_roles_extensions.sql'`,
        );
        // The runner recorded 0000 by the hash of the on-disk file — the role
        // ensure runs OUTSIDE 0000 and does not alter what 0000 records.
        expect((rec.rows[0] as { sha256: string }).sha256).toBe(fileSha);

        // Simulate 0000 having been applied with different bytes.
        await c.query(
          `UPDATE schema_migrations SET sha256 = 'tampered' WHERE name = '0000_roles_extensions.sql'`,
        );
      } finally {
        await c.end();
      }

      await expect(migrate(url(db))).rejects.toThrow(/changed after being applied/);
    } finally {
      await admin.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
    }
  }, 60_000);
});

describe("BR-3 role ensure is gated + only creates genuinely-absent roles", () => {
  it("re-migrating an already-applied database needs no CREATEROLE", async () => {
    const db = "plexco_migrate_gate";
    const norole = "plexco_migrate_norole";
    await admin.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${db}`);
    await admin.query(`DROP ROLE IF EXISTS ${norole}`);
    await admin.query(`CREATE ROLE ${norole} LOGIN NOSUPERUSER NOCREATEROLE PASSWORD 'x'`);
    try {
      // First run: gate OPEN (0000 not applied) → roles ensured, 0000 recorded.
      const first = await migrate(url(db));
      expect(first.applied.length).toBe(MIGRATION_COUNT);

      // Give the NOCREATEROLE role everything the runner needs EXCEPT CREATEROLE.
      const g = await connect(url(db));
      try {
        await g.query(`GRANT ALL ON SCHEMA public TO ${norole}`);
        await g.query(`GRANT ALL ON ALL TABLES IN SCHEMA public TO ${norole}`);
      } finally {
        await g.end();
      }

      // Second run as NOCREATEROLE: gate CLOSED (0000 applied) → ensure skipped
      // → no CREATE ROLE attempted → succeeds with everything skipped. If the
      // gate were broken the ensure would run CREATE ROLE app and Postgres would
      // reject it with insufficient_privilege before this resolves.
      const second = await migrate(url(db, norole, "x"));
      expect(second.applied).toEqual([]);
      expect(second.skipped.length).toBe(MIGRATION_COUNT);
    } finally {
      await admin.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
      await admin.query(`DROP ROLE IF EXISTS ${norole}`);
    }
  }, 60_000);

  // Regression for codex round-01 [P1]: a FRESH database (0000 not applied, so
  // the gate is OPEN) on a cluster where the roles are already provisioned and
  // the DDL owner is NOCREATEROLE. The ensure step must skip CREATE ROLE for the
  // already-present roles — an unconditional CREATE would abort here because
  // Postgres checks CREATEROLE before the duplicate, a regression versus 0000's
  // own IF NOT EXISTS skip.
  it("a fresh database with pre-provisioned roles needs no CREATEROLE", async () => {
    const db = "plexco_migrate_preprov";
    const owner = "plexco_migrate_owner";
    await admin.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
    await admin.query(`DROP ROLE IF EXISTS ${owner}`);
    // Runtime roles pre-provisioned out of band (e.g. managed Postgres) …
    for (const role of ["app", "app_worker", "readonly"]) {
      await ensureRoleExists(admin, role);
    }
    // … and the DDL owner is a least-privilege NOCREATEROLE role owning the db.
    await admin.query(`CREATE ROLE ${owner} LOGIN NOSUPERUSER NOCREATEROLE PASSWORD 'x'`);
    await admin.query(`CREATE DATABASE ${db} OWNER ${owner}`);
    try {
      // job_definer is ALSO cluster-global and pre-provisioned out of band — 0022 asserts
      // membership but never creates it, so a NOCREATEROLE owner (this test's whole point)
      // could never self-bootstrap it. The privileged `admin` connection stands in for the
      // "privileged cluster-tier bootstrap" (task contract §4.1) and grants membership directly;
      // `owner` needs no CREATEROLE to RECEIVE a grant, only to CREATE ROLE.
      await bootstrapJobDefiner(admin);
      await admin.query(`GRANT job_definer TO ${owner}`);
      const res = await migrate(url(db, owner, "x"));
      expect(res.applied.length).toBe(MIGRATION_COUNT);
    } finally {
      await admin.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
      await admin.query(`DROP ROLE IF EXISTS ${owner}`);
    }
  }, 60_000);
});

describe("BR-4 only the role-already-exists race codes are swallowed", () => {
  // ensureRoleExists swallows exactly duplicate_object (42710) and unique_violation
  // (23505) — the two ways a concurrent CREATE ROLE reports "already exists". Any
  // OTHER SQLSTATE must still propagate and abort the migration.
  it("insufficient_privilege from CREATE ROLE propagates and does not create the role", async () => {
    const lowpriv = "plexco_migrate_lowpriv";
    const target = "plexco_migrate_target";
    await admin.query(`DROP ROLE IF EXISTS ${lowpriv}`);
    await admin.query(`DROP ROLE IF EXISTS ${target}`);
    await admin.query(`CREATE ROLE ${lowpriv} LOGIN NOSUPERUSER NOCREATEROLE PASSWORD 'x'`);
    const c = await connect(url(BASE_DB, lowpriv, "x"));
    try {
      // lowpriv lacks CREATEROLE → CREATE ROLE raises insufficient_privilege
      // (42501, checked before the duplicate check), NOT duplicate_object — so
      // the DO block does not swallow it and ensureRoleExists must reject.
      await expect(ensureRoleExists(c, target)).rejects.toThrow(/permission denied/i);
      expect(await roleCount(admin, target)).toBe(0);
    } finally {
      await c.end();
      await admin.query(`DROP ROLE IF EXISTS ${lowpriv}`);
      await admin.query(`DROP ROLE IF EXISTS ${target}`);
    }
  }, 60_000);

  it("refuses an unsafe role identifier before issuing any DDL", async () => {
    const c = await connect(BASE!);
    try {
      await expect(ensureRoleExists(c, "app; DROP ROLE readonly")).rejects.toThrow(
        /unsafe identifier/,
      );
    } finally {
      await c.end();
    }
  });
});

/**
 * JCL-2/JCL-3 — the 0022 job-core migration's own fail-closed assertions (task contract §4.1
 * step 1). Every migrate() call above runs as `plexco`, a real Postgres SUPERUSER — superusers
 * bypass RLS *and* every ACL/membership check unconditionally, so a migration run this way can
 * never observe "job_definer is missing", "job_definer has the wrong attributes", or "the
 * migration role lacks job_definer membership" as failures (see design-probe.md). These tests use
 * setupNonSuperuserOwnerContext for a genuinely NOSUPERUSER NOBYPASSRLS DDL owner instead.
 *
 * job_definer is CLUSTER-global, so the "absent" / "wrong attribute" sub-cases deliberately put
 * it into a broken state — that MUST run under withJobDefinerLock (see its doc comment) so it can
 * never overlap a sibling test file's own bootstrap+migrate. JCL-3 (missing membership) does not
 * touch job_definer's own state at all — it bootstraps via a DIFFERENT role (`ctx.superuser`, not
 * the owner under test), which is a normal idempotent/correct bootstrap and needs no lock.
 */
describe("JCL-2/JCL-3 job-core migration fails closed on job_definer preconditions", () => {
  async function expectNoPartialJobCoreRow(ctx: { ownerPool: pg.Pool }): Promise<void> {
    const rec = await ctx.ownerPool.query(
      `SELECT 1 FROM schema_migrations WHERE name = '0022_job_claim_lease_core.sql'`,
    );
    expect(rec.rows.length).toBe(0);
  }

  /**
   * A real job_definer accumulates GRANT dependents (schema USAGE, function ownership) in every
   * database any test has bootstrapped it into — Postgres tracks role dependencies CLUSTER-wide
   * (pg_shdepend), so `DROP ROLE job_definer` fails with "cannot be dropped because some objects
   * depend on it" the moment ANY other suite has ever bootstrapped it, which is the common case.
   * Renaming instead of dropping sidesteps this entirely: dependencies are tracked by OID, so a
   * rename-away/rename-back round trip preserves every one of them, in every database, with zero
   * cross-database cleanup. Must run inside withJobDefinerLock (the caller's job).
   */
  async function hideRealJobDefiner(superuser: pg.Client, fn: () => Promise<void>): Promise<void> {
    const existing = await superuser.query(`SELECT 1 FROM pg_roles WHERE rolname = 'job_definer'`);
    const hadRealRole = existing.rows.length > 0;
    if (hadRealRole) {
      await superuser.query(`ALTER ROLE job_definer RENAME TO job_definer_hidden_for_test`);
    }
    try {
      await fn();
    } finally {
      if (hadRealRole) {
        await superuser.query(`ALTER ROLE job_definer_hidden_for_test RENAME TO job_definer`);
      }
    }
  }

  it("JCL-2a: job_definer absent — migration fails, 0022 is not recorded", async () => {
    const ctx = await setupNonSuperuserOwnerContext("plexco_migrate_jcl2_absent");
    try {
      await withJobDefinerLock(BASE!, () =>
        hideRealJobDefiner(ctx.superuser, async () => {
          await expect(ctx.runMigration()).rejects.toThrow(/job_definer/i);
        }),
      );
      await expectNoPartialJobCoreRow(ctx);
    } finally {
      await ctx.teardown();
    }
  }, 60_000);

  it("JCL-2b: job_definer with a wrong attribute — migration fails, 0022 is not recorded", async () => {
    const ctx = await setupNonSuperuserOwnerContext("plexco_migrate_jcl2_wrongattr");
    try {
      await withJobDefinerLock(BASE!, () =>
        hideRealJobDefiner(ctx.superuser, async () => {
          // LOGIN instead of NOLOGIN — the exact drift the bootstrap's own attribute check
          // rejects (infra/postgres-init/01-job-definer.sql); the migration's assertion must too.
          await ctx.superuser.query(
            `CREATE ROLE job_definer LOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION`,
          );
          try {
            await expect(ctx.runMigration()).rejects.toThrow(/job_definer/i);
          } finally {
            // Freshly created for this test, zero dependents (the migration failed before any
            // grant) — safe to drop outright, restoring "absent" for hideRealJobDefiner's restore.
            await ctx.superuser.query(`DROP ROLE job_definer`);
          }
        }),
      );
      await expectNoPartialJobCoreRow(ctx);
    } finally {
      await ctx.teardown();
    }
  }, 60_000);

  it("JCL-3: job_definer correct but not granted to the migration owner — ownership transfer fails closed", async () => {
    const ctx = await setupNonSuperuserOwnerContext("plexco_migrate_jcl3_nomembership");
    try {
      // Bootstrap via the SUPERUSER connection, not ctx.bootstrapJobDefinerForOwner(): job_definer
      // ends up correct and granted to `plexco` (CURRENT_USER for ctx.superuser), never to
      // ctx.ownerRole. Idempotent/correct — no lock needed (see describe-block doc comment).
      await bootstrapJobDefiner(ctx.superuser);
      await expect(ctx.runMigration()).rejects.toThrow(/job_definer/i);
      await expectNoPartialJobCoreRow(ctx);
    } finally {
      await ctx.teardown();
    }
  }, 60_000);
});
