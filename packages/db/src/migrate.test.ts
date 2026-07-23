import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureRoleExists, migrate } from "./migrate.js";

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
const MIGRATION_COUNT = 22; // 0000..0021 — must match rls-invariants.test.ts

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
