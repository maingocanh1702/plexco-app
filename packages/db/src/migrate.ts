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
 *  - takes the pg advisory lock so concurrent deploys cannot interleave DDL;
 *  - fails closed post-apply: at least one RLS policy must exist (guards the
 *    silent-DO-block-rollback class that once produced ZERO policies).
 */

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const ADVISORY_LOCK_KEY = 0x706c7863; // "plxc"

export interface MigrateResult {
  applied: string[];
  skipped: string[];
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
