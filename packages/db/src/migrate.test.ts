import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { format } from "node:util";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ensureRoleExists, logMigrationFailure, migrate } from "./migrate.js";
import {
  bootstrapJobDefiner,
  setupNonSuperuserOwnerContext,
  withJobDefinerLock,
} from "./test-harness.js";

// Redirect layer for the readdir/readFile-failure tests below.
// Defaults to the REAL implementation for every other test in this file (which read real migration
// files); only the two tests that explicitly reassign readdirImpl/readFileImpl for their own
// duration, then restore it, ever see a different one. Necessary because migrate.ts's own
// safeLogSummary marker is a private, unexported Symbol -- a hand-built Error cannot carry it, so
// proving what the REAL throw sites attach requires actually reaching them, and MIGRATIONS_DIR is a
// hardcoded module constant with no test-time override. Verified this redirect intercepts migrate.ts's
// own import (not just this file's) before trusting it.
const actualFsPromises =
  await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
// Narrowed to the ONE overload migrate.ts actually calls (readdir(dir): string[], readFile(path,
// "utf8"): string) -- avoids fighting node:fs/promises's full overload set, which this redirect layer
// has no need to preserve.
let readdirImpl: (dir: string) => Promise<string[]> = (dir) =>
  actualFsPromises.readdir(dir) as Promise<string[]>;
let readFileImpl: (filePath: string, encoding: "utf8") => Promise<string> = (filePath, encoding) =>
  actualFsPromises.readFile(filePath, encoding);
vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  return {
    ...actual,
    readdir: (dir: string) => readdirImpl(dir),
    readFile: (filePath: string, encoding: "utf8") => readFileImpl(filePath, encoding),
  };
});

/**
 * Migration-runner invariant suite for the CLUSTER-GLOBAL role race.
 *
 * The bug: migration 0000 creates the
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
const MIGRATION_COUNT = 28; // 0000..0027 — must match rls-invariants.test.ts

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

  // Regression: a FRESH database (0000 not applied, so
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
      // "privileged cluster-tier bootstrap" (task contract §4.1) and grants membership via the
      // session-GUC mechanism `pnpm db:bootstrap`/CI use for a distinct migration-role identity
      // `owner` needs no CREATEROLE to RECEIVE a grant, only to CREATE ROLE.
      await admin.query(`SET job_definer_bootstrap.migration_role = '${owner}'`);
      try {
        await bootstrapJobDefiner(admin);
      } finally {
        await admin.query(`RESET job_definer_bootstrap.migration_role`);
      }
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

  // ensureRoleExists is EXPORTED and `role` is a caller-supplied parameter -- today's only call
  // sites pass a static RUNTIME_ROLES string, but the function's own contract does not guarantee
  // that. The unsafe-identifier rejection message interpolated the rejected value into BOTH
  // .message and safeLogSummary, so a caller-controlled value would have reached the CLI's actual
  // log output through the channel the formatter unconditionally trusts -- exactly the class of
  // bug this whole allowlist exists to prevent, missed at this one throw site during an earlier
  // audit of every throw site's own shape.
  it("rejects an unsafe role identifier from reaching the CLI sink's actual output even though it is preserved in .message", async () => {
    const c = await connect(BASE!);
    const secret = "pii-marker@example.com;DROP ROLE app";
    try {
      let caught: unknown;
      try {
        await ensureRoleExists(c, secret);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(Error);
      // .message keeps the rejected value -- in-process/test visibility is unaffected by this fix.
      expect((caught as Error).message).toContain(secret);

      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      let printed: string;
      try {
        logMigrationFailure(caught);
        expect(spy).toHaveBeenCalledTimes(1);
        printed = format(...spy.mock.calls[0]!);
      } finally {
        spy.mockRestore();
      }
      expect(printed).toContain("unsafe identifier"); // safe summary: kept
      expect(printed).not.toContain(secret); // the negative proof
    } finally {
      await c.end();
    }
  });
});

describe("BR-5 0022 upgrade path: pre-existing claims survive the new lease-shape CHECK", () => {
  // On an already-migrated database, any row the OLD one-way claim_outbox_batch already claimed
  // has claimed_at NOT NULL and the brand-new lease_expires_at column NULL — the shape CHECK 0022
  // adds validates synchronously against EXISTING data on ADD CONSTRAINT, so without a backfill
  // this would abort the migration on any database that ever claimed an outbox event before
  // upgrading.
  //
  // An earlier version of this test ran the whole upgrade path as the superuser `admin`
  // connection, matching this file's OTHER BR-* tests' convention — but that
  // convention is exactly what masks the real defect for THIS specific statement: outbox_events
  // has FORCE RLS and the backfill UPDATE sets no tenant GUC, so under the task contract's own
  // stated production posture (a genuinely non-superuser, NOBYPASSRLS migration role —
  // setupNonSuperuserOwnerContext's whole reason to exist), that UPDATE would silently match zero
  // rows. Rebuilt on the non-superuser harness with a genuine CROSS-TENANT seed, so the assertion
  // actually proves the backfill sees every tenant's legacy rows despite FORCE RLS, not just
  // whichever one happens to match an absent GUC.
  it("backfills lease_expires_at across tenants for legacy claimed_at-only rows under a non-superuser migration owner, and the backfilled leases are immediately reclaimable", async () => {
    const ctx = await setupNonSuperuserOwnerContext("plexco_migrate_br5_legacy_claim");
    // ctx.superuser stays connected to the harness's OWN base database throughout (it exists for
    // cluster-level admin — CREATE ROLE/DATABASE/GRANT — not for querying data inside dbName); a
    // separate superuser connection INTO dbName is needed to seed/verify fixtures while
    // outbox_events' FORCE RLS is bypassed, matching this suite's own admin/`c` convention.
    const superuserInDb = await connect(url(ctx.dbName));
    try {
      // apply every migration BEFORE 0022 (numeric prefix < 22) as the NON-SUPERUSER owner —
      // simulates an already-migrated database on the PRE-0022 schema, run by the task contract's
      // own stated production migration-role posture.
      const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
      for (const f of files) {
        if (Number.parseInt(f.slice(0, 4), 10) >= 22) continue;
        await ctx.ownerPool.query(await readFile(path.join(MIGRATIONS_DIR, f), "utf8"));
      }

      // Seed a pre-existing claim under the OLD one-way claim_outbox_batch in TWO tenants —
      // backdated well past five minutes so the backfilled lease is already expired
      // (deterministically reclaimable), and cross-tenant so the backfill's RLS-safety is
      // actually exercised, not just its idempotency.
      const claimedAt = new Date(Date.now() - 3_600_000);
      const t = await superuserInDb.query(
        `INSERT INTO tenants (name, slug, status) VALUES
           ('BR5 A', 'br5-legacy-a', 'active'), ('BR5 B', 'br5-legacy-b', 'active') RETURNING id`,
      );
      const tenantA = (t.rows[0] as { id: string }).id;
      const tenantB = (t.rows[1] as { id: string }).id;
      const seedEvent = (tenantId: string) =>
        superuserInDb
          .query(
            `INSERT INTO outbox_events (tenant_id, aggregate_type, aggregate_id, sequence, type, payload, claimed_at)
             VALUES ($1, 'br5_test', gen_random_uuid(), 1, 'br5.legacy', '{}'::jsonb, $2) RETURNING id`,
            [tenantId, claimedAt],
          )
          .then((r) => (r.rows[0] as { id: string }).id);
      const eventIdA = await seedEvent(tenantA);
      const eventIdB = await seedEvent(tenantB);

      // job_definer must exist + be granted to THIS owner before 0022 asserts it — lock-protected
      // like every other first reach of 0022 in this suite (see withJobDefinerLock). Applying
      // 0022 raw (not via migrate()) as the non-superuser owner is the regression proof itself:
      // it must NOT throw on either tenant's pre-existing claimed row.
      await withJobDefinerLock(BASE!, async () => {
        await ctx.bootstrapJobDefinerForOwner();
        const sql0022 = await readFile(
          path.join(MIGRATIONS_DIR, "0022_job_claim_lease_core.sql"),
          "utf8",
        );
        await ctx.ownerPool.query(sql0022);
      });

      // Verify via the superuser connection too: outbox_events has FORCE RLS and ctx.ownerPool
      // (the plain migration owner, not job_definer) sets no tenant GUC, so it would see zero rows
      // here regardless of whether the backfill itself worked — that would be a false negative in
      // this ASSERTION, not evidence about the migration under test.
      const rows = await superuserInDb.query(
        `SELECT id, claimed_at, lease_expires_at FROM outbox_events WHERE id = ANY($1) ORDER BY id`,
        [[eventIdA, eventIdB]],
      );
      expect(rows.rows.length).toBe(2);
      for (const row of rows.rows as { claimed_at: Date; lease_expires_at: Date }[]) {
        expect(row.lease_expires_at.getTime()).toBe(row.claimed_at.getTime() + 5 * 60_000);
      }

      const worker = await ctx.connectAsWorker();
      const claimed = await worker.query(
        `SELECT event_id FROM claim_outbox_batch(100) WHERE event_id = ANY($1)`,
        [[eventIdA, eventIdB]],
      );
      expect(claimed.rows.length).toBe(2);
    } finally {
      await superuserInDb.end();
      await ctx.teardown();
    }
  }, 60_000);
});

describe("BR-6 0022 succeeds end to end when the migration role is NOINHERIT", () => {
  // Membership in job_definer (asserted in 0022 Step 1) only guarantees
  // SET ROLE job_definer is AVAILABLE — it does not automatically confer job_definer's privileges
  // unless the migration role is also INHERIT. INHERIT is the default and what every OTHER test
  // in this file uses via setupNonSuperuserOwnerContext, which is exactly why this bug (Step 4's
  // post-transfer REVOKE/GRANT on job_definer-owned functions failing "must be owner of function"
  // under NOINHERIT) was never caught before. NOINHERIT is a valid, more cautious production
  // posture. This proves Step 4's SET ROLE job_definer bracket actually runs as job_definer
  // regardless, by asserting app_worker can call a function whose EXECUTE grant that bracket set.
  it("app_worker can call claim_outbox_batch after the whole migration applies", async () => {
    const ctx = await setupNonSuperuserOwnerContext("plexco_migrate_br6_noinherit", {
      inherit: false,
    });
    try {
      await withJobDefinerLock(BASE!, async () => {
        await ctx.bootstrapJobDefinerForOwner();
        const res = await ctx.runMigration();
        expect(res.applied[res.applied.length - 1]).toBe("0027_resolve_tenant_status_locked.sql");
      });

      const worker = await ctx.connectAsWorker();
      const claimed = await worker.query(`SELECT * FROM claim_outbox_batch(1)`);
      expect(claimed.rows).toEqual([]);
    } finally {
      await ctx.teardown();
    }
  }, 60_000);
});

describe("BR-7 0023 upgrade path: pre-existing claims survive the new triple-shape CHECK", () => {
  // Same risk class BR-5 proved for 0022's lease_expires_at backfill: outbox_events has FORCE RLS
  // and 0023's claim_token backfill UPDATE sets no tenant GUC, so under a genuinely non-superuser
  // NOBYPASSRLS migration owner it would silently match zero rows across every tenant it lacks a
  // GUC for unless run via SET ROLE job_definer (exactly what 0023 does, mirroring 0022's own
  // backfill). Reproduced here with a real cross-tenant seed so the assertion proves the backfill
  // itself, not an absent-GUC false pass.
  it("backfills claim_token across tenants for legacy claimed_at-only rows under a non-superuser migration owner, and the backfilled token is immediately usable to ack", async () => {
    const ctx = await setupNonSuperuserOwnerContext("plexco_migrate_br7_legacy_claim");
    const superuserInDb = await connect(url(ctx.dbName));
    try {
      let eventIdA = "";
      let eventIdB = "";

      // Unlike BR-5 (which applies 0000-0021 OUTSIDE the lock, since none of them touch
      // job_definer), this loop applies 0000-0022 and 0022 itself asserts job_definer — so
      // bootstrap must run FIRST, and the whole sequence (bootstrap, 0000-0022, seed, 0023) shares
      // ONE lock hold like every other first reach of job_definer in this suite (see
      // withJobDefinerLock). Applying 0023 raw (not via migrate()) as the non-superuser owner is
      // the regression proof itself: it must NOT throw on either tenant's pre-existing row.
      await withJobDefinerLock(BASE!, async () => {
        await ctx.bootstrapJobDefinerForOwner();

        // apply every migration BEFORE 0023 (numeric prefix < 23) — simulates an already-migrated
        // database on the PRE-0023 schema (right after 0022).
        const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
        for (const f of files) {
          if (Number.parseInt(f.slice(0, 4), 10) >= 23) continue;
          await ctx.ownerPool.query(await readFile(path.join(MIGRATIONS_DIR, f), "utf8"));
        }

        // Seed a pre-existing claim under the pre-0023 claim_outbox_batch in TWO tenants — no
        // claim_token yet (the column does not exist before 0023 applies). Lease is still valid
        // (unlike BR-5's intentionally-expired backdating) because this test proves the backfilled
        // token is immediately usable for ack, not that the row is reclaimable.
        const t = await superuserInDb.query(
          `INSERT INTO tenants (name, slug, status) VALUES
             ('BR7 A', 'br7-legacy-a', 'active'), ('BR7 B', 'br7-legacy-b', 'active') RETURNING id`,
        );
        const tenantA = (t.rows[0] as { id: string }).id;
        const tenantB = (t.rows[1] as { id: string }).id;
        const claimedAt = new Date();
        const leaseExpiresAt = new Date(Date.now() + 5 * 60_000);
        const seedEvent = (tenantId: string) =>
          superuserInDb
            .query(
              `INSERT INTO outbox_events (tenant_id, aggregate_type, aggregate_id, sequence, type, payload, claimed_at, lease_expires_at)
               VALUES ($1, 'br7_test', gen_random_uuid(), 1, 'br7.legacy', '{}'::jsonb, $2, $3) RETURNING id`,
              [tenantId, claimedAt, leaseExpiresAt],
            )
            .then((r) => (r.rows[0] as { id: string }).id);
        eventIdA = await seedEvent(tenantA);
        eventIdB = await seedEvent(tenantB);

        const sql0023 = await readFile(
          path.join(MIGRATIONS_DIR, "0023_outbox_ack_marker.sql"),
          "utf8",
        );
        await ctx.ownerPool.query(sql0023);
      });

      const rows = await superuserInDb.query(
        `SELECT id, claim_token FROM outbox_events WHERE id = ANY($1) ORDER BY id`,
        [[eventIdA, eventIdB]],
      );
      expect(rows.rows.length).toBe(2);
      for (const row of rows.rows as { claim_token: string | null }[]) {
        expect(row.claim_token).not.toBeNull(); // backfilled across BOTH tenants despite FORCE RLS
      }

      // the backfilled token, together with the still-valid lease, is immediately usable to ack —
      // proving the backfill produced a real, functioning token, not just a CHECK-satisfying value.
      const rowA = (rows.rows as { id: string; claim_token: string }[]).find(
        (r) => r.id === eventIdA,
      )!;
      const worker = await ctx.connectAsWorker();
      const ackA = await worker.query(`SELECT ack_outbox_event($1, ARRAY[]::text[], $2) AS ok`, [
        eventIdA,
        rowA.claim_token,
      ]);
      expect((ackA.rows[0] as { ok: boolean }).ok).toBe(true);
    } finally {
      await superuserInDb.end();
      await ctx.teardown();
    }
  }, 60_000);
});

describe("setupNonSuperuserOwnerContext teardown", () => {
  // Closing connections alone left the scratch database, the cluster-global owner role, and its
  // job_definer membership behind — a LOGIN role with a fixed, known password and BYPASSRLS-via-
  // membership persisting on shared local clusters. Proves teardown now actually drops both.
  it("drops the scratch database and its privileged owner role", async () => {
    const ctx = await setupNonSuperuserOwnerContext("plexco_migrate_teardown_check");
    const { dbName, ownerRole } = ctx;
    await ctx.teardown();

    const admin = await connect(BASE!);
    try {
      const db = await admin.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [dbName]);
      expect(db.rows.length).toBe(0);
      const role = await admin.query(`SELECT 1 FROM pg_roles WHERE rolname = $1`, [ownerRole]);
      expect(role.rows.length).toBe(0);
    } finally {
      await admin.end();
    }
  }, 30_000);
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
 * cross-database cleanup. Must run inside withJobDefinerLock (the caller's job). Module-scoped
 * (not local to JCL-2/JCL-3's describe block) because the CLI failure-log sink tests below also
 * need a real job_definer-absent failure to exercise the real per-file throw site.
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

describe("JCL-2/JCL-3 job-core migration fails closed on job_definer preconditions", () => {
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

  it("preserve-caught-error: a migration failure's rethrown Error attaches the original as .cause", async () => {
    const ctx = await setupNonSuperuserOwnerContext("plexco_migrate_cause_preserved");
    try {
      await withJobDefinerLock(BASE!, () =>
        hideRealJobDefiner(ctx.superuser, async () => {
          let caught: unknown;
          try {
            await ctx.runMigration();
          } catch (error) {
            caught = error;
          }
          expect(caught).toBeInstanceOf(Error);
          expect((caught as Error).cause).toBeDefined();
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

  it("JCL-3b: job_definer already granted to a runtime role — migration fails closed even though the migration role's own membership is correct", async () => {
    const ctx = await setupNonSuperuserOwnerContext("plexco_migrate_jcl3b_runtimemember");
    try {
      await withJobDefinerLock(BASE!, async () => {
        await ctx.bootstrapJobDefinerForOwner();
        // Simulate a misconfiguration/unrelated process granting job_definer to a runtime role —
        // bypassing infra/postgres-init/01-job-definer.sql's OWN equivalent check entirely, so this
        // proves 0022's Step 1 check independently, not just the bootstrap's.
        await ctx.superuser.query(`GRANT job_definer TO app_worker`);
        try {
          await expect(ctx.runMigration()).rejects.toThrow(/app_worker|app\/app_worker\/readonly/i);
          await expectNoPartialJobCoreRow(ctx);
        } finally {
          await ctx.superuser.query(`REVOKE job_definer FROM app_worker`);
        }
      });
    } finally {
      await ctx.teardown();
    }
  }, 60_000);
});

/**
 * CLI failure-log sink: the CLI's console.error(error) sink, combined with migrate.ts:172
 * attaching { cause: error }, would have Node's default recursive .cause formatting print a real
 * pg.DatabaseError.detail to deployment logs — on a unique violation that field is the offending
 * row's ACTUAL VALUE (e.g. `Key (email)=(user@example.com) already exists.`), not schema
 * metadata. The mechanism went through several iterations before converging:
 *   - an explicit field allowlist (SAFE_STRUCTURED_LOG_FIELDS) applied before the value ever
 *     reaches console.error — but still returned the wrapping Error's `.message` verbatim.
 *   - Postgres's message/detail split only holds for integrity-constraint classes (23xxx) — for a
 *     data-exception class like 22P02, the value sits in the PRIMARY message, `.detail`
 *     undefined. formatMigrationFailureForLog stopped using ANY free-text message.
 *   - that fix discarded 100%-safe context along with the risky text (the migration filename on a
 *     per-file failure; the whole message on a direct/cause-less failure). Added throwMigrateError
 *     + safeLogSummary, a Symbol-keyed property the throw site attaches when it knows its own
 *     text is safe — separate from `.message`, which stays unchanged everywhere.
 *   - an error that never goes through any throwMigrateError call site at all (a connection
 *     failure, an advisory-lock/setup query, an fs error from readdir/readFile) has no `.cause` —
 *     the formatter only read structured fields from `.cause`, so this whole class lost even its
 *     safe fields (code/severity/etc.), which live directly on the error, not nested.
 *     formatMigrationFailureForLog now falls back to the top-level error's own fields when there
 *     is no `.cause`.
 *   - ensureRoleExists's unsafe-identifier rejection embedded a caller-supplied value into
 *     safeLogSummary — a throw-site bug, not the allowlist's.
 *   - the allowlist ITSELF was wrong. `constraint`/`table`/`column` were trusted as schema
 *     identifiers, but PL/pgSQL's `RAISE ... USING TABLE = <any expression>` (also COLUMN,
 *     CONSTRAINT) can set them to arbitrary data — verified live, not assumed. Removed from
 *     SAFE_STRUCTURED_LOG_FIELDS; see its own docblock for the full confirmation of which fields
 *     remain structurally safe and why.
 * Every failure shape this history surfaced is covered below — count and read the `it(...)`
 * blocks directly rather than trusting a number restated here (this exact restatement has gone
 * stale enough times in this file's own history to be the reason this sentence no longer states one).
 *
 * These tests assert on what logMigrationFailure actually PASSES TO console.error — not on
 * formatMigrationFailureForLog's return value alone — because the original defect was exactly
 * that gap: a correct formatter is not sufficient if the call site still hands the raw error
 * object to console.error alongside it (Node inspects every argument, not just the first).
 */
describe("CLI failure-log sink never prints row values from a real Postgres unique violation", () => {
  it("keeps Postgres-internal fields but drops the SQLSTATE code and the offending row value from console.error's actual output", async () => {
    const db = "plexco_migrate_sink_allowlist";
    await admin.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${db}`);
    const c = await connect(url(db));
    const secret = "pii-marker+unique-violation-probe@example.com";
    try {
      await c.query(`CREATE TABLE sink_probe (name text PRIMARY KEY)`);
      await c.query(`INSERT INTO sink_probe(name) VALUES ($1)`, [secret]);

      let dbError: unknown;
      try {
        await c.query(`INSERT INTO sink_probe(name) VALUES ($1)`, [secret]);
      } catch (error) {
        dbError = error;
      }

      // Measured (2026-08-01, live against this repo's Postgres) SPECIFICALLY for unique-violation
      // (23505): the DatabaseError's own .message is Postgres's generic summary; only .detail
      // carries the offending value. This does NOT generalize to every SQLSTATE class (see the
      // 22P02 test below, where the value sits in .message itself with .detail undefined) — which
      // is exactly why the sink no longer uses .message/.cause free text at all, for any class.
      expect((dbError as Error).message).not.toContain(secret);
      expect(String((dbError as { detail?: string }).detail)).toContain(secret);

      const wrapped = new Error(
        `migrate: 0099_sink_probe.sql failed and was rolled back: ${String(dbError)}`,
        { cause: dbError },
      );

      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      let printed: string;
      try {
        logMigrationFailure(wrapped);
        expect(spy).toHaveBeenCalledTimes(1);
        // node:util's format() is what Console actually calls to build the string it writes —
        // NOT String()/.toString(), which for an Error is only "name: message" and would hide
        // the exact defect this test exists to catch (Node's real formatter recursively renders
        // .cause and enumerable own properties for any non-string argument).
        printed = format(...spy.mock.calls[0]!);
      } finally {
        // mockRestore() also clears .mock.calls (mockReset + restore) — must run AFTER reading
        // the recorded call above, never before.
        spy.mockRestore();
      }
      // code/constraint/table/column are NOT in the allowlist (all settable via RAISE...USING --
      // see SAFE_STRUCTURED_LOG_FIELDS's own docblock). severity/routine/file/line
      // are Postgres-internal, never SQL-settable, and remain.
      expect(printed).toContain("severity=ERROR");
      expect(printed).not.toContain("code=");
      expect(printed).not.toContain(secret); // the negative proof
    } finally {
      await c.end();
      await admin.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
    }
  }, 30_000);

  it("keeps a data-exception error (22P02) out of console.error's actual output even though its offending value sits in the PRIMARY message, not .detail", async () => {
    const c = await connect(BASE!);
    const secret = "pii-in-primary-message-probe@example.com";
    try {
      let dbError: unknown;
      try {
        await c.query(`SELECT $1::integer`, [secret]);
      } catch (error) {
        dbError = error;
      }

      // Measured invariant this test proves (2026-08-01): for 22P02 (invalid_text_representation),
      // the offending value sits in the PRIMARY message, and .detail is undefined — the OPPOSITE
      // shape from the unique-violation test above. A sink that trusted "the message is always
      // safe, only .cause fields need filtering" leaks exactly here.
      expect((dbError as { code?: string }).code).toBe("22P02");
      expect((dbError as Error).message).toContain(secret);
      expect((dbError as { detail?: unknown }).detail).toBeUndefined();

      const wrapped = new Error(
        `migrate: 0099_sink_primary_message_probe.sql failed and was rolled back: ${String(dbError)}`,
        { cause: dbError },
      );

      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      let printed: string;
      try {
        logMigrationFailure(wrapped);
        expect(spy).toHaveBeenCalledTimes(1);
        printed = format(...spy.mock.calls[0]!);
      } finally {
        spy.mockRestore();
      }
      expect(printed).toContain("severity=ERROR"); // safe structured field: kept, Postgres-internal
      expect(printed).not.toContain("22P02"); // code is no longer in the allowlist
      expect(printed).not.toContain(secret); // the negative proof
    } finally {
      await c.end();
    }
  }, 30_000);

  // The message-stripping fix above was correct on safety but discarded USEFUL, SAFE information
  // along with the risky text — the migration filename (for a per-file failure) and the entire
  // message (for a direct, cause-less failure), even though both are 100% repo-controlled and
  // carry zero row-data risk. These two tests go through the REAL throw sites in migrate.ts (not
  // a hand-built error double, which cannot carry the private safeLogSummary marker) to prove
  // both are preserved without reopening the leak the prior two tests guard against.
  it("preserves the migration filename in the CLI sink's actual output on a per-file migration failure", async () => {
    const ctx = await setupNonSuperuserOwnerContext("plexco_migrate_filename_preserved");
    try {
      await withJobDefinerLock(BASE!, () =>
        hideRealJobDefiner(ctx.superuser, async () => {
          let caught: unknown;
          try {
            await ctx.runMigration();
          } catch (error) {
            caught = error;
          }
          expect(caught).toBeInstanceOf(Error);
          expect((caught as Error).cause).toBeDefined();

          const spy = vi.spyOn(console, "error").mockImplementation(() => {});
          let printed: string;
          try {
            logMigrationFailure(caught);
            expect(spy).toHaveBeenCalledTimes(1);
            printed = format(...spy.mock.calls[0]!);
          } finally {
            spy.mockRestore();
          }
          // The filename is a controlled, repo-known identifier (from readdir() on our own
          // migrations directory) — safe to print in full, and useful: without it, every per-file
          // failure log line looked identical regardless of which migration actually failed.
          expect(printed).toContain("0022_job_claim_lease_core.sql");
        }),
      );
      await expectNoPartialJobCoreRow(ctx);
    } finally {
      await ctx.teardown();
    }
  }, 60_000);

  it("preserves its own safe static message in full in the CLI sink's actual output on a direct failure with no per-file cause", async () => {
    let caught: unknown;
    try {
      await migrate("");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    // No .cause at all -- this throw site never caught a Postgres error, so there is nothing to
    // wrap. The whole message is static, repo-authored text with zero row-data risk.
    expect((caught as Error).cause).toBeUndefined();

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    let printed: string;
    try {
      logMigrationFailure(caught);
      expect(spy).toHaveBeenCalledTimes(1);
      printed = format(...spy.mock.calls[0]!);
    } finally {
      spy.mockRestore();
    }
    expect(printed).toContain("migrate: DATABASE_URL_MIGRATION is required (DDL-owner role)");
  }, 10_000);

  // An error that never reaches ANY throwMigrateError call site -- a connection failure, an
  // advisory-lock/setup query, or (here, reusing BR-4's own real scenario) ensureRoleExists's
  // un-swallowed insufficient_privilege -- propagates UNWRAPPED, with no .cause. The formatter
  // only read structured fields from .cause, so this whole class lost even its SAFE fields
  // (code/severity/...), which live directly on the error object, not nested under a cause that
  // does not exist here.
  it("surfaces its own safe structured fields in the CLI sink's actual output for a real unwrapped error with no .cause at all", async () => {
    const lowpriv = "plexco_migrate_sink_lowpriv";
    const target = "plexco_migrate_sink_target";
    await admin.query(`DROP ROLE IF EXISTS ${lowpriv}`);
    await admin.query(`DROP ROLE IF EXISTS ${target}`);
    await admin.query(`CREATE ROLE ${lowpriv} LOGIN NOSUPERUSER NOCREATEROLE PASSWORD 'x'`);
    const c = await connect(url(BASE_DB, lowpriv, "x"));
    try {
      let caught: unknown;
      try {
        await ensureRoleExists(c, target);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(Error);
      // The defect this test proves: genuinely no .cause -- ensureRoleExists never caught this
      // error to wrap it, it just propagated. severity/code live directly on `caught` itself.
      expect((caught as Error).cause).toBeUndefined();
      expect((caught as { code?: string }).code).toBe("42501"); // insufficient_privilege

      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      let printed: string;
      try {
        logMigrationFailure(caught);
        expect(spy).toHaveBeenCalledTimes(1);
        printed = format(...spy.mock.calls[0]!);
      } finally {
        spy.mockRestore();
      }
      // code is NOT in the allowlist (SQL-settable via RAISE...USING) -- severity is (Postgres-internal).
      expect(printed).toContain("severity=ERROR");
      expect(printed).not.toContain("code=");
    } finally {
      await c.end();
      await admin.query(`DROP ROLE IF EXISTS ${lowpriv}`);
      await admin.query(`DROP ROLE IF EXISTS ${target}`);
    }
  }, 60_000);

  // SAFE_STRUCTURED_LOG_FIELDS trusted constraint/table/column as schema identifiers, but
  // PL/pgSQL's RAISE ... USING TABLE/COLUMN/CONSTRAINT = <any expression> can set them to
  // arbitrary data -- confirmed against PostgreSQL's own documented RAISE USING option list
  // (plpgsql-errors-and-messages.html), not assumed. A real RAISE with TABLE set to a PII-shaped
  // marker, through a real query, captured as a real error -- not a hand-built double.
  it("keeps a table/column/constraint value set via RAISE ... USING out of the CLI sink's actual output", async () => {
    const c = await connect(BASE!);
    const secret = "pii-diagnostic-field@example.com";
    try {
      let dbError: unknown;
      try {
        await c.query(
          `DO $$ BEGIN RAISE EXCEPTION USING MESSAGE = 'synthetic failure', TABLE = '${secret}'; END $$;`,
        );
      } catch (error) {
        dbError = error;
      }
      expect(dbError).toBeInstanceOf(Error);
      // Measured invariant this test proves: RAISE ... USING TABLE sets .table to the exact
      // expression given -- not a real object name, and not previously excluded by this formatter.
      expect((dbError as { table?: string }).table).toBe(secret);
      expect((dbError as { code?: string }).code).toBe("P0001");
      // routine stays Postgres-internal (the PL/pgSQL executor itself), never caller-supplied --
      // confirms it remains safe to keep in the allowlist.
      expect((dbError as { routine?: string }).routine).toBe("exec_stmt_raise");

      const wrapped = new Error(
        `migrate: 0099_raise_using_probe.sql failed and was rolled back: ${String(dbError)}`,
        { cause: dbError },
      );

      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      let printed: string;
      try {
        logMigrationFailure(wrapped);
        expect(spy).toHaveBeenCalledTimes(1);
        printed = format(...spy.mock.calls[0]!);
      } finally {
        spy.mockRestore();
      }
      expect(printed).toContain("routine=exec_stmt_raise"); // safe structured field: kept
      expect(printed).not.toContain(secret); // the negative proof
      expect(printed).not.toContain("table="); // table is no longer in the allowlist AT ALL
      expect(printed).not.toContain("code="); // code is no longer in the allowlist either
    } finally {
      await c.end();
    }
  });

  // `code` was the last field kept by a per-field safety argument ("empirically bounded... too
  // short for PII") rather than the provenance test the rest of the allowlist now uses. RAISE ...
  // USING ERRCODE accepts ANY 5-character string, not just a real SQLSTATE -- a caller can set it
  // to a name-shaped value.
  it("keeps a name-shaped value set via RAISE ... USING ERRCODE out of the CLI sink's actual output", async () => {
    const c = await connect(BASE!);
    const secret = "ALICE";
    try {
      let dbError: unknown;
      try {
        await c.query(
          `DO $$ BEGIN RAISE EXCEPTION USING MESSAGE = 'synthetic failure', ERRCODE = '${secret}'; END $$;`,
        );
      } catch (error) {
        dbError = error;
      }
      expect(dbError).toBeInstanceOf(Error);
      // Measured invariant this test proves: RAISE ... USING ERRCODE accepts an arbitrary
      // 5-character string with no validation it names a real condition.
      expect((dbError as { code?: string }).code).toBe(secret);
      expect((dbError as { severity?: string }).severity).toBe("ERROR");

      const wrapped = new Error(
        `migrate: 0099_errcode_probe.sql failed and was rolled back: ${String(dbError)}`,
        { cause: dbError },
      );

      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      let printed: string;
      try {
        logMigrationFailure(wrapped);
        expect(spy).toHaveBeenCalledTimes(1);
        printed = format(...spy.mock.calls[0]!);
      } finally {
        spy.mockRestore();
      }
      expect(printed).toContain("severity=ERROR"); // safe structured field: kept, Postgres-internal
      expect(printed).not.toContain(secret); // the negative proof
      expect(printed).not.toContain("code="); // code is no longer in the allowlist AT ALL
    } finally {
      await c.end();
    }
  });

  // Removing `code` left readdir/readFile failures with NOTHING from SAFE_STRUCTURED_LOG_FIELDS --
  // severity/routine/file/line are all undefined on a real Node fs error (measured live before
  // trusting the finding). All recovered diagnostic value comes from safeLogSummary alone, which
  // is why the two throw sites below need DISTINCT, FULLY STATIC summaries -- a shared or
  // filename-interpolated summary would make the fix cosmetic (this file's own history:
  // ensureRoleExists's role and the structured allowlist both interpolated a "defensible" value
  // into a safe channel and both became findings).
  it("names its own site, with no path or interpolated value, on a readdir failure on the migrations directory", async () => {
    const originalReaddir = readdirImpl;
    readdirImpl = (async () => {
      throw Object.assign(
        new Error("ENOENT: no such file or directory, scandir '/private/probe'"),
        {
          code: "ENOENT",
          path: "/private/probe",
        },
      );
    }) as typeof readdirImpl;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    let printed: string;
    try {
      let caught: unknown;
      try {
        await migrate(BASE!);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).cause).toBeInstanceOf(Error);
      logMigrationFailure(caught);
      expect(spy).toHaveBeenCalledTimes(1);
      printed = format(...spy.mock.calls[0]!);
    } finally {
      readdirImpl = originalReaddir;
      spy.mockRestore();
    }
    expect(printed).toContain("failed to read the migrations directory");
    expect(printed).not.toContain("failed to read a migration file"); // names ITS OWN site, not the other
    expect(printed).not.toContain("/private/probe"); // no filesystem path
    expect(printed).not.toContain("ENOENT"); // no interpolated value from the underlying error
  });

  it("names its own site, with no path or interpolated value, on a readFile failure on a migration file", async () => {
    const originalReadFile = readFileImpl;
    readFileImpl = (async () => {
      throw Object.assign(
        new Error(
          "ENOENT: no such file or directory, open '/private/probe/0000_roles_extensions.sql'",
        ),
        { code: "ENOENT", path: "/private/probe/0000_roles_extensions.sql" },
      );
    }) as typeof readFileImpl;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    let printed: string;
    try {
      let caught: unknown;
      try {
        await migrate(BASE!);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).cause).toBeInstanceOf(Error);
      logMigrationFailure(caught);
      expect(spy).toHaveBeenCalledTimes(1);
      printed = format(...spy.mock.calls[0]!);
    } finally {
      readFileImpl = originalReadFile;
      spy.mockRestore();
    }
    expect(printed).toContain("failed to read a migration file");
    expect(printed).not.toContain("failed to read the migrations directory"); // names ITS OWN site
    expect(printed).not.toContain("0000_roles_extensions.sql"); // no filename interpolated
    expect(printed).not.toContain("/private/probe"); // no filesystem path
    expect(printed).not.toContain("ENOENT"); // no interpolated value from the underlying error
  });

  // A re-read of the instruction that produced the original await-wrapping fix found it was
  // scoped to "throw sites" when the actual property is "every await in migrate() that can reject
  // outside an already-wrapped region" -- readdir/readFile/connect were three instances of the
  // same gap, not the whole set. Full enumeration (16 awaits total, mechanically counted): 6 sites
  // below were unwrapped and are now wrapped, all with distinct fully-static safeLogSummary
  // strings, real error as .cause, no interpolation. Excluded: the finally block's
  // advisory-unlock/client.end() (a throw from finally masks the original error) and, found while
  // enumerating rather than assumed, ensureRoleExists's own call site (wrapping it risks
  // overwriting its OWN more-specific unsafe-identifier summary) and the per-file ROLLBACK call
  // (wrapping risks masking the original per-file failure the same way the finally block would)
  // -- both flagged to the owner rather than silently wrapped or silently skipped.
  //
  // Each test below intercepts ONE query via pg.Client.prototype.query (verified this reaches
  // migrate.ts's own client instance, not just this test file's calls, before trusting the pattern),
  // asserting the sink prints ONLY that site's own summary -- never another site's, never a path or any
  // interpolated value from the underlying error.
  function mockQuerySiteFailure(matchText: string, errorMessage: string) {
    const original = pg.Client.prototype.query;
    return vi.spyOn(pg.Client.prototype, "query").mockImplementation(function (
      this: pg.Client,
      ...args: unknown[]
    ) {
      const text = typeof args[0] === "string" ? args[0] : (args[0] as { text?: string })?.text;
      if (typeof text === "string" && text.includes(matchText)) {
        return Promise.reject(new Error(errorMessage));
      }
      return (original as (...a: unknown[]) => unknown).apply(this, args) as Promise<unknown>;
    });
  }

  const ALL_SITE_SUMMARIES = [
    "failed to connect to database",
    "failed to acquire the advisory lock",
    "failed to create the schema_migrations table",
    "failed to read the schema_migrations table",
    "failed to check for pre-provisioned runtime roles",
    "failed to count RLS policies after apply",
  ];

  async function expectOnlyOwnSummary(printed: string, ownSummary: string) {
    expect(printed).toContain(ownSummary);
    for (const other of ALL_SITE_SUMMARIES) {
      if (other !== ownSummary) expect(printed).not.toContain(other);
    }
  }

  it("names its own site, never the connection string, on a client.connect() failure", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    let printed: string;
    try {
      let caught: unknown;
      try {
        await migrate("postgres://plexco:wrongpass@127.0.0.1:1/nonexistent_probe_db");
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).cause).toBeInstanceOf(Error);
      logMigrationFailure(caught);
      expect(spy).toHaveBeenCalledTimes(1);
      printed = format(...spy.mock.calls[0]!);
    } finally {
      spy.mockRestore();
    }
    await expectOnlyOwnSummary(printed, "failed to connect to database");
    expect(printed).not.toContain("wrongpass");
    expect(printed).not.toContain("127.0.0.1:1");
    expect(printed).not.toContain("nonexistent_probe_db");
  });

  it("names its own site on a pg_advisory_lock failure", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const querySpy = mockQuerySiteFailure("pg_advisory_lock", "PROBE_LOCK_FAIL");
    let printed: string;
    try {
      let caught: unknown;
      try {
        await migrate(BASE!);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).cause).toBeInstanceOf(Error);
      logMigrationFailure(caught);
      expect(spy).toHaveBeenCalledTimes(1);
      printed = format(...spy.mock.calls[0]!);
    } finally {
      querySpy.mockRestore();
      spy.mockRestore();
    }
    await expectOnlyOwnSummary(printed, "failed to acquire the advisory lock");
    expect(printed).not.toContain("PROBE_LOCK_FAIL");
  });

  it("names its own site on a schema_migrations CREATE TABLE failure", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const querySpy = mockQuerySiteFailure(
      "CREATE TABLE IF NOT EXISTS schema_migrations",
      "PROBE_CREATE_FAIL",
    );
    let printed: string;
    try {
      let caught: unknown;
      try {
        await migrate(BASE!);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).cause).toBeInstanceOf(Error);
      logMigrationFailure(caught);
      expect(spy).toHaveBeenCalledTimes(1);
      printed = format(...spy.mock.calls[0]!);
    } finally {
      querySpy.mockRestore();
      spy.mockRestore();
    }
    await expectOnlyOwnSummary(printed, "failed to create the schema_migrations table");
    expect(printed).not.toContain("PROBE_CREATE_FAIL");
  });

  it("names its own site on a schema_migrations SELECT failure", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const querySpy = mockQuerySiteFailure(
      "SELECT name, sha256 FROM schema_migrations",
      "PROBE_SELECT_FAIL",
    );
    let printed: string;
    try {
      let caught: unknown;
      try {
        await migrate(BASE!);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).cause).toBeInstanceOf(Error);
      logMigrationFailure(caught);
      expect(spy).toHaveBeenCalledTimes(1);
      printed = format(...spy.mock.calls[0]!);
    } finally {
      querySpy.mockRestore();
      spy.mockRestore();
    }
    await expectOnlyOwnSummary(printed, "failed to read the schema_migrations table");
    expect(printed).not.toContain("PROBE_SELECT_FAIL");
  });

  it("names its own site on a pg_roles pre-check failure", async () => {
    // This query only runs when ROLES_MIGRATION (0000) has not yet been recorded -- BASE already has
    // every migration applied, so it would never reach this site. Needs a genuinely fresh database.
    const db = "plexco_migrate_sink_roles_precheck";
    await admin.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${db}`);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const querySpy = mockQuerySiteFailure(
      "SELECT rolname FROM pg_roles WHERE rolname = ANY",
      "PROBE_ROLES_FAIL",
    );
    let printed: string;
    try {
      let caught: unknown;
      try {
        await migrate(url(db));
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).cause).toBeInstanceOf(Error);
      logMigrationFailure(caught);
      expect(spy).toHaveBeenCalledTimes(1);
      printed = format(...spy.mock.calls[0]!);
    } finally {
      querySpy.mockRestore();
      spy.mockRestore();
      await admin.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
    }
    await expectOnlyOwnSummary(printed, "failed to check for pre-provisioned runtime roles");
    expect(printed).not.toContain("PROBE_ROLES_FAIL");
  });

  it("names its own site on a pg_policies count failure", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const querySpy = mockQuerySiteFailure(
      "SELECT count(*)::int AS n FROM pg_policies",
      "PROBE_POLICIES_FAIL",
    );
    let printed: string;
    try {
      let caught: unknown;
      try {
        await migrate(BASE!);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).cause).toBeInstanceOf(Error);
      logMigrationFailure(caught);
      expect(spy).toHaveBeenCalledTimes(1);
      printed = format(...spy.mock.calls[0]!);
    } finally {
      querySpy.mockRestore();
      spy.mockRestore();
    }
    await expectOnlyOwnSummary(printed, "failed to count RLS policies after apply");
    expect(printed).not.toContain("PROBE_POLICIES_FAIL");
  });
});

describe("job_definer bootstrap script itself fails closed on runtime-role targets", () => {
  // infra/postgres-init/01-job-definer.sql is advertised safe to re-run at ANY time, including
  // long after 0022 has already applied — when 0022's own Step 1 denylist (JCL-3b above) can never
  // run again to catch a bad grant. These prove the bootstrap script rejects the same class of
  // misuse independently, so a later `MIGRATION_ROLE=app_worker` re-run can never slip through.
  it("refuses to grant job_definer to a runtime role passed as the migration_role target", async () => {
    await withJobDefinerLock(BASE!, async () => {
      const admin = await connect(BASE!);
      try {
        await bootstrapJobDefiner(admin); // idempotent baseline: job_definer exists + correct
        await admin.query(`SET job_definer_bootstrap.migration_role = 'readonly'`);
        try {
          await expect(bootstrapJobDefiner(admin)).rejects.toThrow(/runtime role/i);
        } finally {
          await admin.query(`RESET job_definer_bootstrap.migration_role`);
        }
        const granted = await admin.query(
          `SELECT 1 FROM pg_auth_members am
             JOIN pg_roles m ON m.oid = am.member
             JOIN pg_roles r ON r.oid = am.roleid
            WHERE r.rolname = 'job_definer' AND m.rolname = 'readonly'`,
        );
        expect(granted.rows.length).toBe(0);
      } finally {
        await admin.end();
      }
    });
  }, 30_000);

  it("refuses to proceed at all when job_definer is already granted to a runtime role beforehand", async () => {
    await withJobDefinerLock(BASE!, async () => {
      const admin = await connect(BASE!);
      try {
        await bootstrapJobDefiner(admin); // idempotent baseline: job_definer exists + correct
        await admin.query(`GRANT job_definer TO app_worker`);
        try {
          await expect(bootstrapJobDefiner(admin)).rejects.toThrow(/already granted/i);
        } finally {
          await admin.query(`REVOKE job_definer FROM app_worker`);
        }
      } finally {
        await admin.end();
      }
    });
  }, 30_000);

  // The denylist above must never call pg_has_role directly on a runtime role name, because on
  // the documented fresh-cluster order (this bootstrap runs BEFORE migration 0000 creates
  // app/app_worker/readonly) that role name does not exist yet, and pg_has_role RAISES for an
  // absent role rather than returning false. This project's own shared dev/CI cluster always has
  // app/app_worker/readonly already created by an earlier migrate() run (they are cluster-global
  // and never dropped), so a full bootstrapJobDefiner() run can never reproduce a genuinely fresh
  // cluster without unsafely dropping roles a concurrent test file may depend on. Instead this
  // proves the underlying hazard AND the guard pattern (01-job-definer.sql now filters through
  // pg_roles before calling pg_has_role) directly, against a role name that is guaranteed never
  // to exist.
  it("pg_has_role on an absent role name raises rather than returning false — the exact hazard the fresh-cluster bootstrap must guard against", async () => {
    const admin = await connect(BASE!);
    try {
      const fakeRole = "zz_never_created_probe_role";
      await expect(
        admin.query(`SELECT pg_has_role('${fakeRole}', 'job_definer', 'MEMBER')`),
      ).rejects.toThrow(/does not exist/i);

      const guarded = await admin.query(
        `SELECT EXISTS (
           SELECT 1 FROM pg_roles WHERE rolname = $1 AND pg_has_role(rolname, 'job_definer', 'MEMBER')
         ) AS is_member`,
        [fakeRole],
      );
      expect((guarded.rows[0] as { is_member: boolean }).is_member).toBe(false);
    } finally {
      await admin.end();
    }
  }, 30_000);
});
