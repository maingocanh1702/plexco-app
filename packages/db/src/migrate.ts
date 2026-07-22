import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

/**
 * SQL migration runner — the ONLY thing that applies packages/db/migrations.
 *
 * Contract (proven necessary by the fresh-apply pre-scan):
 *  - runs as the MIGRATION/owner role (DATABASE_URL_MIGRATION), never a runtime role;
 *  - applies files in filename order, EACH FILE IN ONE TRANSACTION — psql-style
 *    non-atomic half-applies (0006 once left public_sessions behind after an
 *    index error) must be impossible;
 *  - records applied files in schema_migrations (name + sha256); re-running is
 *    a no-op; a CHANGED already-applied file is a hard error (never edit an
 *    applied migration — expand→contract with a new file instead);
 *  - takes a pg advisory lock so concurrent deploys against the SAME database
 *    cannot interleave DDL. Advisory locks are DATABASE-scoped, so this does
 *    NOT serialise two runs bootstrapping DIFFERENT databases on one cluster,
 *    and gives ZERO protection to CLUSTER-GLOBAL objects such as roles;
 *  - before 0000 is applied, ensures the cluster-global runtime roles with a
 *    race-safe CREATE-ROLE-then-swallow-"already exists" idiom (ensureRoleExists)
 *    — the DATABASE-scoped lock above cannot serialise their creation across two
 *    databases on the same cluster, so the idiom, not the lock, makes it safe;
 *  - fails closed post-apply: at least one RLS policy must exist (guards the
 *    silent-DO-block-rollback class that once produced ZERO policies).
 */

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const ADVISORY_LOCK_KEY = 0x706c7863; // "plxc"

/**
 * Migration whose DO-block creates the runtime roles. The runner ensures those
 * roles itself BEFORE this file runs (see ensureRoleExists), gated on this name
 * not yet being recorded in schema_migrations — so a database that has already
 * applied 0000 keeps exactly today's privilege profile and never re-attempts a
 * CREATE ROLE on a routine run.
 */
const ROLES_MIGRATION = "0000_roles_extensions.sql";

/**
 * Cluster-global runtime roles created by 0000 (INV-1). The attributes below
 * MUST stay byte-identical to 0000's CREATE ROLE so that whichever side wins
 * the create leaves an identically-privileged role and 0000's own IF NOT EXISTS
 * block then finds it and skips.
 */
const RUNTIME_ROLES = ["app", "app_worker", "readonly"] as const;

/** A role name we are willing to interpolate into DDL — Postgres cannot bind an
 *  identifier as a parameter, so the name is validated instead of parameterised. */
const SAFE_ROLE_IDENT = /^[a-z_][a-z0-9_]*$/;

export interface MigrateResult {
  applied: string[];
  skipped: string[];
}

/**
 * Race-safe CREATE ROLE. Postgres has no `CREATE ROLE IF NOT EXISTS`, and roles
 * are CLUSTER-global while databases are not: two migrate() runs bootstrapping
 * two different databases on one cluster can both observe the role missing and
 * both issue CREATE ROLE. The EXCEPTION handler turns the loser into a no-op.
 *
 * The loser's error is one of TWO SQLSTATEs, both meaning "this role already
 * exists" — nothing else is swallowed:
 *   - duplicate_object (42710) — the explicit "role already exists" pre-check,
 *   - unique_violation (23505) — pg_authid's rolname unique index, hit when two
 *     backends both pass the pre-check at the same instant and collide on the
 *     insert. Under real concurrency THIS is the common one (measured ~50:1 over
 *     42710); catching only 42710 leaves the race the runner exists to fix able
 *     to abort a migration. Within a single `CREATE ROLE <name>` the only unique
 *     constraint that can fire is the role name, so 23505 here is unambiguous.
 * A genuinely different failure — e.g. insufficient_privilege (42501), which
 * Postgres checks BEFORE either collision — is neither code, so it propagates
 * and aborts the migration.
 *
 * Call OUTSIDE the per-file migration transaction (autocommit) so the role is
 * durable immediately, independent of any later BEGIN/COMMIT.
 */
export async function ensureRoleExists(client: pg.Client, role: string): Promise<void> {
  if (!SAFE_ROLE_IDENT.test(role)) {
    throw new Error(
      `migrate: refusing to CREATE ROLE with unsafe identifier ${JSON.stringify(role)}`,
    );
  }
  await client.query(
    `DO $$ BEGIN
       CREATE ROLE ${role} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
     EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL; END $$;`,
  );
}

export async function migrate(migrationUrl: string): Promise<MigrateResult> {
  if (!migrationUrl) {
    throw new Error("migrate: DATABASE_URL_MIGRATION is required (DDL-owner role)");
  }
  const client = new pg.Client({ connectionString: migrationUrl });
  await client.connect();
  const applied: string[] = [];
  const skipped: string[] = [];
  try {
    // DATABASE-scoped: serialises concurrent deploys against THIS database only.
    // It does NOT serialise cluster-global objects (roles) across databases —
    // those are made race-safe by ensureRoleExists below, not by this lock.
    await client.query("SELECT pg_advisory_lock($1)", [ADVISORY_LOCK_KEY]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        sha256 text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);

    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
    const seen = new Map<string, string>(
      (await client.query("SELECT name, sha256 FROM schema_migrations")).rows.map(
        (r: { name: string; sha256: string }) => [r.name, r.sha256],
      ),
    );

    // Ensure the cluster-global runtime roles BEFORE 0000 runs. Gated on 0000
    // not yet applied so an already-migrated database keeps exactly today's
    // privilege profile. Within that gate, only CREATE the roles that are
    // genuinely ABSENT: a cluster may have them PRE-PROVISIONED while the DDL
    // owner (DATABASE_URL_MIGRATION) is NOCREATEROLE, and Postgres checks the
    // CREATEROLE privilege BEFORE reporting the duplicate — so an unconditional
    // CREATE ROLE would abort on an already-present role (a regression versus
    // 0000's own IF NOT EXISTS skip). The residual check-to-create race for an
    // absent role is still covered by ensureRoleExists's swallow. These run in
    // autocommit (outside the per-file BEGIN/COMMIT below) so the roles are
    // durable even if a later migration file rolls back.
    if (!seen.has(ROLES_MIGRATION)) {
      const present = new Set<string>(
        (
          await client.query("SELECT rolname FROM pg_roles WHERE rolname = ANY($1::text[])", [
            [...RUNTIME_ROLES],
          ])
        ).rows.map((r: { rolname: string }) => r.rolname),
      );
      for (const role of RUNTIME_ROLES) {
        if (!present.has(role)) {
          await ensureRoleExists(client, role);
        }
      }
    }

    for (const file of files) {
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
      const sha = createHash("sha256").update(sql).digest("hex");
      const prior = seen.get(file);
      if (prior !== undefined) {
        if (prior !== sha) {
          throw new Error(
            `migrate: ${file} changed after being applied (sha mismatch) — ` +
              `applied migrations are immutable; add a NEW migration instead`,
          );
        }
        skipped.push(file);
        continue;
      }
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations(name, sha256) VALUES ($1, $2)", [
          file,
          sha,
        ]);
        await client.query("COMMIT");
        applied.push(file);
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(`migrate: ${file} failed and was rolled back: ${String(error)}`);
      }
    }

    // Fail closed: a schema where the RLS block silently rolled back must
    // never pass as migrated.
    const policies = await client.query("SELECT count(*)::int AS n FROM pg_policies");
    if ((policies.rows[0] as { n: number }).n === 0) {
      throw new Error("migrate: 0 RLS policies after apply — refusing to treat DB as migrated");
    }
    return { applied, skipped };
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY]).catch(() => {});
    await client.end();
  }
}

const invokedDirectly =
  process.argv[1]?.endsWith("migrate.ts") || process.argv[1]?.endsWith("migrate.js");
if (invokedDirectly) {
  migrate(process.env.DATABASE_URL_MIGRATION ?? "")
    .then((r) => {
      console.log(`[migrate] applied=${r.applied.length} skipped=${r.skipped.length}`);
      process.exit(0);
    })
    .catch((error) => {
      console.error("[migrate] failed", error);
      process.exit(1);
    });
}
