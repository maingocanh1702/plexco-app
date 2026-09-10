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

/** The 4-digit ordinal every migration filename starts with (`0039_…sql`). */
const MIGRATION_ORDINAL = /^(\d{4})_/;

/**
 * Audit 2026-09-06 D-11: the runner applied files "in filename order" but never refused a file
 * numbered BELOW one already applied — a branch merging `0031b`/a renumbered file after `0038`
 * had landed would apply out of order, silently, and every later reader would trust the ordinal.
 * Two static facts are checked before anything touches the database:
 *   1. every .sql file carries a 4-digit ordinal and no ordinal appears twice on disk;
 *   2. every NOT-yet-applied file is numbered above the highest applied file.
 * Pure so it can be unit-tested without Postgres; migrate() calls it with the real inputs.
 */
export function assertMonotonicMigrationOrder(files: string[], applied: Iterable<string>): void {
  const ordinalOf = (f: string): string => {
    const m = MIGRATION_ORDINAL.exec(f);
    if (!m) throw new Error(`migrate: ${f} does not start with a 4-digit ordinal`);
    return m[1]!;
  };
  const seenOrdinals = new Map<string, string>();
  for (const f of files) {
    const o = ordinalOf(f);
    const dup = seenOrdinals.get(o);
    if (dup !== undefined) {
      throw new Error(`migrate: duplicate migration ordinal ${o}: ${dup} and ${f}`);
    }
    seenOrdinals.set(o, f);
  }
  const appliedSet = new Set(applied);
  let highestApplied: string | null = null;
  for (const name of appliedSet) {
    const o = MIGRATION_ORDINAL.exec(name)?.[1];
    if (o !== undefined && (highestApplied === null || o > highestApplied)) highestApplied = o;
  }
  if (highestApplied === null) return;
  for (const f of files) {
    if (appliedSet.has(f)) continue;
    // `<=`, not `<`. A pending file is by definition not the applied one, so an ordinal EQUAL to
    // the applied tail means two DIFFERENT migrations share that number — e.g. 0040_original.sql
    // is recorded in the ledger but a checkout carries 0040_replacement.sql instead. The on-disk
    // duplicate scan above cannot see that (only one 0040 is present), and `<` waved it through,
    // so the ledger would end up with two different files numbered 0040 and two databases built
    // from the same repo would diverge. Renaming an applied migration is the mutation this guard
    // exists to refuse.
    if (ordinalOf(f) <= highestApplied) {
      throw new Error(
        `migrate: out-of-order migration ${f} — numbered at or below already-applied ordinal ` +
          `${highestApplied}; renumber it above the current tail (applied migrations are immutable)`,
      );
    }
  }
}

/** Caller-supplied SAFE summary for CLI logging, keyed by Error identity — separate from
 *  `.message`, which stays exactly what every throw site already sets (existing tests assert on
 *  its content, e.g. /job_definer/i). Only the throw site knows whether its own text is safe: a
 *  static, repo-authored string (or one interpolating only a controlled identifier like a
 *  migration filename) is always safe; the raw text of a caught Postgres error is not, since some
 *  SQLSTATE classes put the offending row's value directly in the primary message. Held in a
 *  module-private WeakMap rather than a property on the Error itself: a property is reachable by
 *  any code holding the Error, because Object.getOwnPropertySymbols() enumerates own symbol keys
 *  regardless of whether the Symbol was ever exported. A WeakMap has no such surface — nothing
 *  enumerates its entries, and code without a reference to safeLogSummaries itself cannot read or
 *  write one. */
const safeLogSummaries = new WeakMap<Error, string>();

/** Throws an Error whose `.message`/`.cause` are exactly what the caller passes (unchanged
 *  contract), plus a `safeLogSummary` the CLI's log formatter can trust without re-deriving it. */
function throwMigrateError(message: string, safeLogSummary: string, options?: ErrorOptions): never {
  const error = new Error(message, options);
  safeLogSummaries.set(error, safeLogSummary);
  throw error;
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
    // role is a caller-supplied parameter of an EXPORTED function -- today's only call sites pass
    // one of the three static RUNTIME_ROLES strings, but the function's own contract does not
    // guarantee that, so it cannot be treated as a controlled identifier the way a migration
    // filename is. .message keeps the rejected value for in-process/test visibility; safeLogSummary
    // does not, matching every other throw site's rule (interpolate only what is provably safe).
    const message = `migrate: refusing to CREATE ROLE with unsafe identifier ${JSON.stringify(role)}`;
    throwMigrateError(message, "migrate: refusing to CREATE ROLE with an unsafe identifier");
  }
  await client.query(
    `DO $$ BEGIN
       CREATE ROLE ${role} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
     EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL; END $$;`,
  );
}

export async function migrate(migrationUrl: string): Promise<MigrateResult> {
  if (!migrationUrl) {
    const message = "migrate: DATABASE_URL_MIGRATION is required (DDL-owner role)";
    throwMigrateError(message, message);
  }
  const client = new pg.Client({ connectionString: migrationUrl });
  try {
    await client.connect();
  } catch (error) {
    // Never interpolate migrationUrl or any part of it -- unlike the filename question in Exception 3,
    // there is no defensible case to interpolate here: a connection string can carry credentials.
    throwMigrateError(
      `migrate: failed to connect to database: ${String(error)}`,
      "migrate: failed to connect to database",
      { cause: error },
    );
  }
  const applied: string[] = [];
  const skipped: string[] = [];
  try {
    // DATABASE-scoped: serialises concurrent deploys against THIS database only.
    // It does NOT serialise cluster-global objects (roles) across databases —
    // those are made race-safe by ensureRoleExists below, not by this lock.
    try {
      await client.query("SELECT pg_advisory_lock($1)", [ADVISORY_LOCK_KEY]);
    } catch (error) {
      throwMigrateError(
        `migrate: failed to acquire the advisory lock: ${String(error)}`,
        "migrate: failed to acquire the advisory lock",
        { cause: error },
      );
    }
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          name text PRIMARY KEY,
          sha256 text NOT NULL,
          applied_at timestamptz NOT NULL DEFAULT now()
        )`);
    } catch (error) {
      throwMigrateError(
        `migrate: failed to create the schema_migrations table: ${String(error)}`,
        "migrate: failed to create the schema_migrations table",
        { cause: error },
      );
    }

    let files: string[];
    try {
      files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
    } catch (error) {
      // Node fs errors (ENOENT etc.) never carry severity/routine/file/line, so all recovered
      // diagnostic value comes from safeLogSummary alone -- kept fully static and distinct from
      // readFile's below so an operator can tell which site failed. See negative_scope for the rule.
      const message = `migrate: failed to read the migrations directory: ${String(error)}`;
      throwMigrateError(message, "migrate: failed to read the migrations directory", {
        cause: error,
      });
    }
    let schemaMigrationsRows: { name: string; sha256: string }[];
    try {
      schemaMigrationsRows = (await client.query("SELECT name, sha256 FROM schema_migrations"))
        .rows;
    } catch (error) {
      throwMigrateError(
        `migrate: failed to read the schema_migrations table: ${String(error)}`,
        "migrate: failed to read the schema_migrations table",
        { cause: error },
      );
    }
    const seen = new Map<string, string>(schemaMigrationsRows.map((r) => [r.name, r.sha256]));
    // Static ordering guard (audit D-11) — refuses a duplicate ordinal on disk or a pending file
    // numbered below the applied tail, BEFORE any file is applied. The message names only
    // repo-controlled filenames, so it is safe to surface as-is.
    try {
      assertMonotonicMigrationOrder(files, seen.keys());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throwMigrateError(message, message, { cause: error });
    }

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
      let pgRolesRows: { rolname: string }[];
      try {
        pgRolesRows = (
          await client.query("SELECT rolname FROM pg_roles WHERE rolname = ANY($1::text[])", [
            [...RUNTIME_ROLES],
          ])
        ).rows;
      } catch (error) {
        throwMigrateError(
          `migrate: failed to check for pre-provisioned runtime roles: ${String(error)}`,
          "migrate: failed to check for pre-provisioned runtime roles",
          { cause: error },
        );
      }
      const present = new Set<string>(pgRolesRows.map((r) => r.rolname));
      for (const role of RUNTIME_ROLES) {
        if (!present.has(role)) {
          await ensureRoleExists(client, role);
        }
      }
    }

    for (const file of files) {
      let sql: string;
      try {
        sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
      } catch (error) {
        // Distinct from readdir's summary above, deliberately -- same reasoning, same constraint
        // (fully static, no filename interpolation even though `file` is repo-controlled).
        const message = `migrate: failed to read a migration file: ${String(error)}`;
        throwMigrateError(message, "migrate: failed to read a migration file", { cause: error });
      }
      const sha = createHash("sha256").update(sql).digest("hex");
      const prior = seen.get(file);
      if (prior !== undefined) {
        if (prior !== sha) {
          // The condition above is correct and stays exactly as it is. What follows is only about
          // the guard being able to say WHY it fired — three readers with three different needs,
          // deliberately not one string reused three times:
          //
          //   .cause          the measurement that failed. Present mostly so this failure can name
          //                   itself: with no cause it surfaced through whichever unrelated
          //                   assertion walked a cause chain first, as "expected undefined to be
          //                   an instance of Error" — a sentence naming no migration, no digest
          //                   and no invariant.
          //   .message        the rule and both remedies. Free to interpolate `prior` because the
          //                   CLI never reads .message: formatMigrationFailureForLog builds its
          //                   line from safeLogSummary and nothing else.
          //   safeLogSummary  the CLI line. Under the log-provenance allowlist it may carry `file`
          //                   (a repo-known identifier) but NOT `prior`, which is a
          //                   schema_migrations ROW VALUE. `sha` is locally computed and would
          //                   pass, but one digest with nothing to compare it against tells an
          //                   operator nothing — so the log carries NEITHER and points at the
          //                   error. Symmetric, and no per-value provenance judgement gets
          //                   smuggled into the safe channel.
          //
          // Both remedies, because the guard fires in two situations whose fixes are opposite and
          // the older text named only the first: a migration that has SHIPPED is corrected by a
          // new forward migration, while an UNSHIPPED one being iterated on locally is fixed by
          // resetting the test database (core-db-architecture-principles.md P17 records both).
          // The local case is the one that actually costs time, and "add a NEW migration instead"
          // is the wrong advice for it. The forbidden shortcut is named explicitly because this
          // error is precisely where someone reaches for it.
          const cause = new Error(
            `sha256 mismatch for ${file}: schema_migrations recorded ${prior}, ` +
              `the file on disk hashes to ${sha}`,
          );
          const message =
            `migrate: ${file} changed after being applied (sha mismatch) — ` +
            `schema_migrations recorded ${prior}, the file on disk hashes to ${sha}. ` +
            `Applied migrations are immutable (P17, forward-only): if this migration has already ` +
            `shipped, add a NEW forward migration; if it is still unshipped and you are iterating ` +
            `locally, reset the test database. Never edit or delete schema_migrations rows to ` +
            `force a pass.`;
          throwMigrateError(
            message,
            `migrate: ${file} changed after being applied — applied migrations are immutable ` +
              `(P17, forward-only): add a NEW forward migration, or reset the database if the ` +
              `file is still unshipped. Never edit or delete schema_migrations rows to force a ` +
              `pass. The error's cause carries both digests.`,
            { cause },
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
        // safeLogSummary keeps the migration filename — a controlled, repo-known identifier,
        // never row data — but excludes String(error): the actual pg error's text, which for some
        // SQLSTATE classes (e.g. 22P02) embeds the offending row's value directly.
        throwMigrateError(
          `migrate: ${file} failed and was rolled back: ${String(error)}`,
          `migrate: ${file} failed and was rolled back`,
          { cause: error },
        );
      }
    }

    // Fail closed: a schema where the RLS block silently rolled back must
    // never pass as migrated.
    let policies: pg.QueryResult;
    try {
      policies = await client.query("SELECT count(*)::int AS n FROM pg_policies");
    } catch (error) {
      throwMigrateError(
        `migrate: failed to count RLS policies after apply: ${String(error)}`,
        "migrate: failed to count RLS policies after apply",
        { cause: error },
      );
    }
    if ((policies.rows[0] as { n: number }).n === 0) {
      const message = "migrate: 0 RLS policies after apply — refusing to treat DB as migrated";
      throwMigrateError(message, message);
    }
    return { applied, skipped };
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY]).catch(() => {});
    await client.end();
  }
}

/** Builds a log line for a migration failure from ONLY the throw site's own pre-vetted
 *  safeLogSummary (see throwMigrateError) — falls back to a generic string if absent. Never
 *  Postgres's raw message/detail text, and never any field read directly off the error or its
 *  cause, structured or otherwise, regardless of the object's type or shape. */
export function formatMigrationFailureForLog(error: unknown): string {
  return error instanceof Error && safeLogSummaries.has(error)
    ? safeLogSummaries.get(error)!
    : "migrate: a migration step failed";
}

/** The CLI's actual failure sink, exported so tests can spy on the real console.error call
 *  (what it prints) rather than only on formatMigrationFailureForLog's return value (what it
 *  computes) — those are different questions, and the PII risk lives in the former. */
export function logMigrationFailure(error: unknown): void {
  console.error("[migrate] failed:", formatMigrationFailureForLog(error));
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
      logMigrationFailure(error);
      process.exit(1);
    });
}
