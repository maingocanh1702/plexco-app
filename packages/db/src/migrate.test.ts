import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
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
const MIGRATION_COUNT = 24; // 0000..0023 — must match rls-invariants.test.ts

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
      // "privileged cluster-tier bootstrap" (task contract §4.1) and grants membership via the
      // session-GUC mechanism `pnpm db:bootstrap`/CI use for a distinct migration-role identity
      // (codex round-06 [P1]); `owner` needs no CREATEROLE to RECEIVE a grant, only to CREATE ROLE.
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
});

describe("BR-5 0022 upgrade path: pre-existing claims survive the new lease-shape CHECK", () => {
  // codex round-01 [P1]: on an already-migrated database, any row the OLD one-way
  // claim_outbox_batch already claimed has claimed_at NOT NULL and the brand-new
  // lease_expires_at column NULL — the shape CHECK 0022 adds validates synchronously against
  // EXISTING data on ADD CONSTRAINT, so without a backfill this would abort the migration on any
  // database that ever claimed an outbox event before upgrading.
  //
  // codex round-06 [P1]: the FIRST version of this test ran the whole upgrade path as the
  // superuser `admin` connection, matching this file's OTHER BR-* tests' convention — but that
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
  // codex round-08 [P2]: membership in job_definer (asserted in 0022 Step 1) only guarantees
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
        expect(res.applied[res.applied.length - 1]).toBe("0023_outbox_ack_marker.sql");
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

describe("setupNonSuperuserOwnerContext teardown (codex round-07 [P1])", () => {
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

  it("JCL-3b: job_definer already granted to a runtime role — migration fails closed even though the migration role's own membership is correct (codex round-07 [P1])", async () => {
    const ctx = await setupNonSuperuserOwnerContext("plexco_migrate_jcl3b_runtimemember");
    try {
      await withJobDefinerLock(BASE!, async () => {
        await ctx.bootstrapJobDefinerForOwner();
        // Simulate a misconfiguration/unrelated process granting job_definer to a runtime role —
        // bypassing infra/postgres-init/01-job-definer.sql's OWN equivalent check entirely (round-08
        // [P1]), so this proves 0022's Step 1 check independently, not just the bootstrap's.
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

describe("job_definer bootstrap script itself fails closed on runtime-role targets (codex round-08 [P1])", () => {
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

  // codex round-09 [P1]: the denylist above must never call pg_has_role directly on a runtime
  // role name, because on the documented fresh-cluster order (this bootstrap runs BEFORE
  // migration 0000 creates app/app_worker/readonly) that role name does not exist yet, and
  // pg_has_role RAISES for an absent role rather than returning false. This project's own shared
  // dev/CI cluster always has app/app_worker/readonly already created by an earlier migrate()
  // run (they are cluster-global and never dropped), so a full bootstrapJobDefiner() run can
  // never reproduce a genuinely fresh cluster without unsafely dropping roles a concurrent test
  // file may depend on. Instead this proves the underlying hazard AND the guard pattern
  // (01-job-definer.sql now filters through pg_roles before calling pg_has_role) directly,
  // against a role name that is guaranteed never to exist.
  it("pg_has_role on an absent role name raises rather than returning false — the exact hazard the fresh-cluster bootstrap must guard against (codex round-09 [P1])", async () => {
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
