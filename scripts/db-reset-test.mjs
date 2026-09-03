#!/usr/bin/env node
/**
 * db:reset:test — drop and recreate the test database named by DATABASE_URL_TEST.
 *
 * WHY THIS EXISTS. packages/db/src/migrate.ts's P17 guard refuses to run when a migration file's
 * sha256 no longer matches the row recorded in schema_migrations, and it offers two cures: ship a
 * NEW forward migration if the old one has already shipped, or — if it is still unshipped and you
 * are iterating locally — "reset the test database". Until this script existed, that second cure
 * named a path the repository had never built, at the exact moment a blocked developer is reaching
 * for `DELETE FROM schema_migrations`, which the same message forbids. The forbidden shortcut was
 * one line and always worked; the sanctioned one was a hand-typed DROP/CREATE pair, repeated once
 * per edit round. That asymmetry is the defect this closes: the rule was carrying work the tooling
 * should do.
 *
 * WHY THE CONTAINER. `pnpm db:bootstrap` shells out to a host `psql`, which is not declared as a
 * dev dependency and is not present on a machine that only has Docker — the measured second half
 * of the same friction. This script therefore routes through the psql already inside the compose
 * postgres service, the route infra/docker-compose.yml documents on its worker notes. No host
 * psql, no new package dependency.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not touch the per-suite `plexco_*` databases the RLS
 * harness creates. Those are dropped and recreated by setupRlsTestContext on every run, so they
 * cannot accumulate a stale schema_migrations row, and their names do not end in _test, so the
 * guard below would refuse them anyway. One narrow contract beats a tool that quietly widens.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const COMPOSE_FILE = "infra/docker-compose.yml";
const COMPOSE_SERVICE = "postgres";

/** Dropping a database requires being connected to a different one. */
const MAINTENANCE_DB = "postgres";

/** A plain SQL identifier — what may be interpolated into DDL without quoting games. */
const PLAIN_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * fileURLToPath, never `new URL(url).pathname` on a file URL: the latter stays percent-encoded and
 * a repo path containing a space ("Plexco app") then fails to match. For the DATABASE_URL_TEST
 * database name the decode is the point — a name that decodes to something which is not a plain
 * identifier must reach the guard and be refused, not be silently normalised.
 */
export function databaseNameFromUrl(url) {
  return decodeURIComponent(new URL(url).pathname).replace(/^\//, "");
}

/**
 * The only thing standing between a mistyped environment variable and a destroyed development
 * database. Fail closed: anything not provably a throwaway test database is refused.
 *
 * The `_test` suffix is not a new constraint invented here — .env.example and
 * .github/workflows/ci.yml both already name this database `plexco_test`. The guard describes the
 * convention that already exists, which is why it can be strict without breaking anyone.
 */
export function assertResettableTestDatabase(name) {
  if (typeof name !== "string" || name === "") {
    throw new Error(
      "db:reset:test refuses to run: DATABASE_URL_TEST names no database. It must end in _test, " +
        "e.g. postgres://plexco:plexco_dev@localhost:5432/plexco_test",
    );
  }
  if (!PLAIN_IDENTIFIER.test(name)) {
    throw new Error(
      `db:reset:test refuses to destroy ${JSON.stringify(name)}: a database it will DROP must be ` +
        "a plain identifier (letters, digits, underscore; not starting with a digit) and must " +
        "end in _test. This name is not, so it never reaches SQL.",
    );
  }
  if (!name.endsWith("_test")) {
    throw new Error(
      `db:reset:test refuses to destroy "${name}": it only ever drops a database whose name ends ` +
        `in _test, and "${name}" does not. If you meant the test database, point ` +
        "DATABASE_URL_TEST at it (e.g. .../plexco_test). If you really meant this one, drop it " +
        "yourself — this script will not do it for you.",
    );
  }
  return name;
}

/** argv for the compose exec, as an array: no shell, so nothing here can be word-split. */
export function buildResetArgv(dbName, user) {
  return [
    "compose",
    "-f",
    COMPOSE_FILE,
    "exec",
    "-T",
    COMPOSE_SERVICE,
    "psql",
    "-U",
    user,
    "-d",
    MAINTENANCE_DB,
    "-v",
    "ON_ERROR_STOP=1",
    // Two separate -c flags, not one string with two statements: psql wraps a single multi-statement
    // -c in one implicit transaction, and DROP DATABASE cannot run inside a transaction block.
    "-c",
    `DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`,
    "-c",
    `CREATE DATABASE ${dbName}`,
  ];
}

function main() {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) {
    console.error(
      "db:reset:test refuses to run: DATABASE_URL_TEST is not set.\n" +
        "  local: export DATABASE_URL_TEST=postgres://plexco:plexco_dev@localhost:5432/plexco_test",
    );
    return 1;
  }

  let dbName;
  let user;
  try {
    dbName = assertResettableTestDatabase(databaseNameFromUrl(url));
    user = new URL(url).username || "plexco";
  } catch (error) {
    console.error(error.message);
    return 1;
  }

  // Name it before destroying it. A destructive tool that does not say what it is about to destroy
  // is one typo away from being the incident it was written to prevent.
  console.log(`db:reset:test — dropping and recreating database "${dbName}" as role "${user}"`);
  console.log(`  via ${COMPOSE_SERVICE} in ${COMPOSE_FILE} (no host psql required)`);

  const result = spawnSync("docker", buildResetArgv(dbName, user), { stdio: "inherit" });
  if (result.error) {
    console.error(
      `db:reset:test could not run docker: ${result.error.message}\n` +
        `  is the cluster up? docker compose -f ${COMPOSE_FILE} up -d ${COMPOSE_SERVICE}`,
    );
    return 1;
  }
  if (result.status !== 0) {
    console.error(`db:reset:test failed: docker compose exec exited ${result.status}`);
    return result.status ?? 1;
  }

  console.log(`db:reset:test — "${dbName}" is empty; the next run re-applies every migration.`);
  return 0;
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) process.exit(main());
