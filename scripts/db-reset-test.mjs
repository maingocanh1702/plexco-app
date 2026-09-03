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

/** A plain SQL identifier. No quote character can appear, which is what makes quoting below safe. */
const PLAIN_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * PostgreSQL truncates identifiers to NAMEDATALEN-1 = 63 bytes, and it does so whether or not they
 * are quoted. That makes the length a correctness rule for THIS tool rather than a limit worth
 * inheriting silently: a 68-byte name ending in `_test` truncates to 63 bytes that do NOT end in
 * `_test`, so the server would drop a database the suffix rule was written to forbid. Verified by
 * probe before this guard existed — the old code accepted exactly that name.
 */
const MAX_IDENTIFIER_BYTES = 63;

/**
 * THE ONE SHAPE THIS TOOL ACCEPTS. Membership in this grammar is the entire endpoint check.
 *
 * WHY A GRAMMAR AND NOT A PARSER. An earlier revision ran the WHATWG URL parser to EXTRACT a host
 * and compared that to a list of literals. That extraction was a second parser, and it disagreed
 * with the one `pg` uses: `postgres:` is not a WHATWG "special scheme", so its host is opaque —
 * not percent-decoded — while pg-connection-string does decode it. Measured, with no query string
 * involved:
 *
 *     postgres://%2Fvar%2Frun%2Fpostgresql/plexco_test
 *       WHATWG .hostname -> "%2Fvar%2Frun%2Fpostgresql"   (looks like an unknown remote host)
 *       pg-connection-string -> "/var/run/postgresql"     (a unix socket, i.e. local)
 *
 * That revision happened to refuse this, but only because the encoded form failed to match the
 * literals — safe by accident, and an accident that survives only until the literals change.
 *
 * THE PROPERTY THIS GRAMMAR ENFORCES, which is the reason the guard is sound: a string matching it
 * contains NO percent-encoding, NO query and NO fragment anywhere. Those are the only constructs
 * through which two connection-string parsers were observed to disagree, so every parser reads an
 * accepted string the same way. Soundness is a property of the accepted SET, not of any parser.
 *
 * Nothing here is extracted and then re-interpreted: `resolveResetTarget` returns this pattern's own
 * captures, and no other code path derives the database name or user. Over-refusal is deliberate and
 * costs nothing — a developer types `localhost` plainly. `::1` is not accepted because the bracketed
 * and bare spellings are written differently by different parsers, and supporting it buys nothing.
 *
 * Explicit character classes only, no `.`, and no `\s` shorthand in the anchored positions: `$` in
 * JavaScript must not be trusted from memory to reject a trailing newline. Both the trailing-newline
 * and embedded-newline cases are pinned by tests rather than argued about here.
 */
const CANONICAL_URL =
  /^postgres(?:ql)?:\/\/(?:([A-Za-z0-9_]+)(?::([^%@/?#\r\n\t ]*))?@)?(?:localhost|127\.0\.0\.1)(?::5432)?\/([A-Za-z_][A-Za-z0-9_]*)$/;

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
  if (Buffer.byteLength(name, "utf8") > MAX_IDENTIFIER_BYTES) {
    throw new Error(
      `db:reset:test refuses to destroy "${name}": it is ` +
        `${Buffer.byteLength(name, "utf8")} bytes, and PostgreSQL truncates identifiers to ` +
        `${MAX_IDENTIFIER_BYTES}. The server would act on the truncated name, which is not the ` +
        "name checked here — and may not end in _test at all.",
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

/**
 * Resolve DATABASE_URL_TEST into the exact thing the executor will act on, refusing anything it
 * cannot honour. Everything downstream reads THIS result and nothing re-derives from the raw url,
 * so "what was validated" and "what gets dropped" cannot drift apart — which is the only reason
 * the two previous defects in this file were possible.
 */
export function resolveResetTarget(url) {
  const match = typeof url === "string" ? CANONICAL_URL.exec(url) : null;
  if (!match) {
    // Names the RULE, not just the rejection. A message that only says "rejected" invites the next
    // reader to widen the pattern until their URL passes; this one states what the tool accepts and
    // why the refusals that look excessive are deliberate. The value is never echoed -- it carries a
    // password, and an error is exactly where that reaches a terminal, a CI log or a bug report.
    throw new Error(
      "db:reset:test refuses to run: DATABASE_URL_TEST does not match the one shape this tool " +
        "accepts (value not shown).\n" +
        "  RULE: postgres://[user[:password]@](localhost|127.0.0.1)[:5432]/<name>_test\n" +
        "  Anything else is refused, INCLUDING options PostgreSQL itself accepts -- sslmode=, " +
        "application_name=, connect_timeout=, a unix-socket host, ::1, percent-encoding, or any " +
        "query string or fragment.\n" +
        "  That is deliberate. This command runs DROP DATABASE, and the guard will not reimplement " +
        "libpq precedence rules to decide which extras are harmless: query parameters were measured " +
        "overriding the host, and a percent-encoded host was measured decoding to a unix socket. " +
        "The accepted set has no percent-encoding, no query and no fragment, which is exactly why " +
        "every parser reads it identically.\n" +
        "  If your URL names another machine: this tool will NOT drop a same-named database locally " +
        "to stand in for a remote one. Reset that database with the tools of the environment that " +
        "owns it.\n" +
        "  Need one of those options? Use psql directly. Do NOT widen this pattern.",
    );
  }
  // The pattern's own captures ARE the target. Nothing re-derives the name or the user from the raw
  // string, so there is no second reading that could disagree with this one.
  const [, user, , dbName] = match;
  return { dbName: assertResettableTestDatabase(dbName), user: user || "plexco" };
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
    //
    // The identifier is QUOTED, and that is a correctness fix rather than style. libpq passes the
    // connection URL's dbname to the server verbatim, with no case folding, so `.../PLEXCO_test`
    // names a database literally called `PLEXCO_test`. An UNQUOTED `DROP DATABASE PLEXCO_test`
    // would fold to `plexco_test` and destroy a DIFFERENT database from the one this script
    // validated and printed. Quoting makes the DDL agree with the connection, which is the whole
    // contract. Lowercasing the name instead would have kept that disagreement and merely hidden
    // it. Embedding the name is injection-safe because PLAIN_IDENTIFIER admits no quote character.
    "-c",
    `DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`,
    "-c",
    `CREATE DATABASE "${dbName}"`,
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
    ({ dbName, user } = resolveResetTarget(url));
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
