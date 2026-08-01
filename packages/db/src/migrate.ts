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

/** Marker property carrying a caller-supplied SAFE summary for CLI logging — separate from
 *  `.message`, which stays exactly what every throw site already sets (existing tests assert on
 *  its content, e.g. /job_definer/i). Only the throw site knows whether its own text is safe: a
 *  static, repo-authored string (or one interpolating only a controlled identifier like a
 *  migration filename) is always safe; the raw text of a caught Postgres error is not, since some
 *  SQLSTATE classes put the offending row's value directly in the primary message. */
const SAFE_LOG_SUMMARY = Symbol("safeLogSummary");

interface WithSafeLogSummary {
  [SAFE_LOG_SUMMARY]?: string;
}

/** Throws an Error whose `.message`/`.cause` are exactly what the caller passes (unchanged
 *  contract), plus a `safeLogSummary` the CLI's log formatter can trust without re-deriving it. */
function throwMigrateError(message: string, safeLogSummary: string, options?: ErrorOptions): never {
  const error: Error & WithSafeLogSummary = new Error(message, options);
  error[SAFE_LOG_SUMMARY] = safeLogSummary;
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

    let files: string[];
    try {
      files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
    } catch (error) {
      // Node fs errors (ENOENT etc.) never carry severity/routine/file/line -- SAFE_STRUCTURED_LOG_FIELDS
      // surfaces nothing for an unwrapped one, and .cause contributes zero characters to the log line as
      // a result. All recovered diagnostic value comes from safeLogSummary alone, which is why it is kept
      // fully static and distinct from readFile's below -- an operator can tell which site failed without
      // interpolating anything (this file's own history: ensureRoleExists's role, then the structured
      // allowlist, both interpolated a "defensible" value into a safe channel and both became findings).
      const message = `migrate: failed to read the migrations directory: ${String(error)}`;
      throwMigrateError(message, "migrate: failed to read the migrations directory", {
        cause: error,
      });
    }
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
          const message =
            `migrate: ${file} changed after being applied (sha mismatch) — ` +
            `applied migrations are immutable; add a NEW migration instead`;
          throwMigrateError(message, message);
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
    const policies = await client.query("SELECT count(*)::int AS n FROM pg_policies");
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

/** The test for this allowlist is PROVENANCE, not a per-field safety argument: keep a field only if
 *  Postgres's own C-level error machinery populates it, never a value any SQL statement can set (via
 *  RAISE ... USING or otherwise) — `code`, `constraint`, `table`, `column`, `schema`, `datatype`,
 *  `detail`, `hint`, `internalQuery`, `where`, `message` are all settable and excluded on that basis
 *  alone, not because any one of them was individually measured unsafe. Two of this allowlist's own
 *  fields (`constraint`/`table`/`column`, then `code`) were kept after being argued individually safe
 *  and later disproven live via RAISE ... USING; do not re-add a field by arguing it is safe today —
 *  add it only if it fails this test. What is lost: the failure category in the log line itself.
 *  safeLogSummary (the migration filename) plus the SQL in the repo still let an operator debug by
 *  reproducing the failure. */
const SAFE_STRUCTURED_LOG_FIELDS = ["severity", "routine", "file", "line"] as const;

/** Builds a log line for a migration failure from ONLY pre-vetted safe sources — never Postgres's
 *  raw message/detail text. Two sources feed it: (1) `safeLogSummary`, set by the THROW SITE itself
 *  (see throwMigrateError) — every migrate.ts throw site knows whether its own message is static
 *  repo text or a controlled identifier like a migration filename, so it is trusted here without
 *  re-deriving it; falls back to a generic string if absent (e.g. a connection failure or an
 *  advisory-lock/setup query, which propagate UNWRAPPED, with no `.cause`, straight out of migrate()
 *  — readdir/readFile are NOT examples of this: both go through throwMigrateError, see below). (2) the
 *  allowlisted structured fields — read from `.cause` when present (a per-file failure was caught and
 *  wrapped), otherwise read directly off the top-level error itself, for an unwrapped pg.DatabaseError.
 *  A Node fs error (ENOENT etc.) does NOT carry these fields — measured live, severity/routine/file/line
 *  are all undefined on one — which is why readdir/readFile are wrapped via throwMigrateError instead of
 *  relying on this fallback; without safeLogSummary, an unwrapped fs error would print the bare generic
 *  fallback with no diagnostic content at all. Neither source ever includes
 *  `.message`/`String(error)` verbatim: Postgres's message/detail split only holds for integrity-
 *  constraint classes (23xxx) -- for a data-exception class like 22P02 (invalid_text_representation),
 *  the offending value sits directly in the PRIMARY message, e.g. `invalid input syntax for type
 *  integer: "user@example.com"`, with `.detail` undefined. `.message`/`.cause` on the Error object
 *  itself are untouched; this only affects what the CLI prints. */
export function formatMigrationFailureForLog(error: unknown): string {
  const safeSummary =
    error instanceof Error && typeof (error as WithSafeLogSummary)[SAFE_LOG_SUMMARY] === "string"
      ? (error as WithSafeLogSummary)[SAFE_LOG_SUMMARY]!
      : "migrate: a migration step failed";
  const cause = error instanceof Error ? error.cause : undefined;
  const fieldSource =
    cause && typeof cause === "object"
      ? (cause as Record<string, unknown>)
      : error && typeof error === "object"
        ? (error as Record<string, unknown>)
        : undefined;
  const safeParts = SAFE_STRUCTURED_LOG_FIELDS.filter(
    (field) => fieldSource?.[field] !== undefined,
  ).map((field) => `${field}=${String(fieldSource![field])}`);
  return safeParts.length > 0 ? `${safeSummary} [${safeParts.join(" ")}]` : safeSummary;
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
