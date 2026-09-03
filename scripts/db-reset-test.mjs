#!/usr/bin/env node
/**
 * db:reset:test — drop and recreate the local Compose test database.
 *
 * WHY THIS EXISTS. packages/db/src/migrate.ts's P17 guard refuses to run when a migration file's
 * sha256 no longer matches the row recorded in schema_migrations, and it offers two cures: ship a
 * NEW forward migration if the old one has already shipped, or — if it is still unshipped and you
 * are iterating locally — "reset the test database". Until this script existed that second cure
 * named a path the repository had never built, at the exact moment a blocked developer is reaching
 * for `DELETE FROM schema_migrations`, which the same message forbids.
 *
 * WHAT DECIDES THE VICTIM, AND WHY THE URL NO LONGER DOES. Four review rounds each found a
 * different input that outranked this tool's guard, and they were one defect rather than four: the
 * tool claimed DATABASE_URL_TEST as its authority while executing through `docker compose exec`,
 * which is a different addressing system. Five things decide which database actually gets dropped —
 * the docker daemon, the compose project, the container, the executing role, and the database name —
 * and the URL supplies exactly one of them. Hardening the URL could never converge, because the
 * other four are not in the URL at all. An earlier revision narrowed the accepted URL set until it
 * was provably self-consistent, and was still wrong; that is the evidence the defect sat above the
 * grammar rather than inside it.
 *
 * So the URL is no longer an authority. This script now OWNS every input it acts on:
 *
 *   daemon    resolved endpoint must be a local unix socket, verified before acting
 *   project   pinned with `-p`, never inherited from COMPOSE_PROJECT_NAME
 *   container the service named in this repository's compose file
 *   role      passed explicitly with -U; nothing below supplies a competing default
 *   database  an explicit argument, defaulting to the canonical local test database
 *
 * DATABASE_URL_TEST is demoted to a cross-check: if set, its database NAME must match the target.
 * That is a claim this tool can keep. The previous one was not.
 *
 * There is exactly ONE addressing system left. `pg` is not used anywhere in this path — this script
 * imports no database driver and never has; it shells to the psql inside the pinned container, so
 * no host psql is required either.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * ABSOLUTE, resolved once from this file's own location. A relative `-f infra/docker-compose.yml`
 * is resolved against the process cwd, so cwd (and COMPOSE_PROJECT_DIRECTORY) would take part in
 * deciding WHICH compose file a destructive command reads. Measured: running with that relative
 * path from /tmp exits non-zero, file not found — the same mechanism silently reads a DIFFERENT
 * file from a directory where one happens to exist. Deciding the path here removes cwd from the
 * set of inputs, which is the same rule every other input in this file follows.
 */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const COMPOSE_FILE = path.join(REPO_ROOT, "infra", "docker-compose.yml");
const COMPOSE_SERVICE = "postgres";

/** Pinned to the `name:` in COMPOSE_FILE. Passed with -p so COMPOSE_PROJECT_NAME cannot redirect it. */
const COMPOSE_PROJECT = "plexco";

/** POSTGRES_USER in COMPOSE_FILE. Always sent as -U, so no layer below supplies its own default. */
const DEFAULT_ROLE = "plexco";

/** The canonical local test database (.env.example, .github/workflows/ci.yml). */
const DEFAULT_TEST_DB = "plexco_test";

/** Dropping a database requires being connected to a different one. */
const MAINTENANCE_DB = "postgres";

/**
 * Environment that can silently retarget a destructive command, removed from the child's env so the
 * invocation is decided by this file rather than by whatever the shell happens to carry.
 *
 * Stripping these is NOT sufficient alone, which is why assertLocalDockerEndpoint exists: the ACTIVE
 * CONTEXT lives in ~/.docker/config.json (`currentContext`), not in the environment. Measured on the
 * owner's machine — DOCKER_HOST and DOCKER_CONTEXT both unset, yet the effective context was
 * `desktop-linux`, not `default`. Hard-pinning `--context default` would have been wrong for the
 * same reason: on Docker Desktop `default` names /var/run/docker.sock while the daemon listens on
 * ~/.docker/run/docker.sock. So the endpoint is VERIFIED, never forced.
 */
const REDIRECTING_ENV = [
  "DOCKER_HOST",
  "DOCKER_CONTEXT",
  "COMPOSE_PROJECT_NAME",
  "COMPOSE_FILE",
  "COMPOSE_PROFILES",
  "COMPOSE_PROJECT_DIRECTORY",
];

/**
 * DOCKER_CONFIG is deliberately NOT in that list, and the reason is the general rule rather than a
 * judgement about that variable: the check and the action read the SAME DOCKER_CONFIG, so it cannot
 * make them disagree. What made them disagree was resolving the endpoint TWICE — once to verify and
 * again at exec. Now that the verified endpoint is carried into the invocation with -H, nothing is
 * resolved twice and DOCKER_CONFIG stops participating at all. Adding a pin for it later would be
 * redundant; if you think it is needed, the thing to check is whether some input has gone back to
 * being resolved twice.
 */

/** A plain SQL identifier. No quote character can appear, which is what makes quoting below safe. */
const PLAIN_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * PostgreSQL truncates identifiers to NAMEDATALEN-1 = 63 bytes, quoted or not. A 68-byte name
 * ending in `_test` truncates to 63 bytes that do NOT end in `_test`, so the server would drop a
 * database the suffix rule was written to forbid.
 */
const MAX_IDENTIFIER_BYTES = 63;

export function childEnv(env = process.env) {
  const copy = { ...env };
  for (const key of REDIRECTING_ENV) delete copy[key];
  return copy;
}

/**
 * The only thing standing between a mistyped argument and a destroyed development database. The
 * `_test` suffix is not invented here — .env.example and .github/workflows/ci.yml already name this
 * database plexco_test, so the guard describes a convention rather than imposing one.
 */
export function assertResettableTestDatabase(name) {
  if (typeof name !== "string" || name === "") {
    throw new Error("db:reset:test refuses to run: no database name was given.");
  }
  if (!PLAIN_IDENTIFIER.test(name)) {
    throw new Error(
      `db:reset:test refuses to destroy ${JSON.stringify(name)}: a database it will DROP must be ` +
        "a plain identifier (letters, digits, underscore; not starting with a digit) and must end " +
        "in _test. This name is not, so it never reaches SQL.",
    );
  }
  if (Buffer.byteLength(name, "utf8") > MAX_IDENTIFIER_BYTES) {
    throw new Error(
      `db:reset:test refuses to destroy "${name}": it is ${Buffer.byteLength(name, "utf8")} bytes, ` +
        `and PostgreSQL truncates identifiers to ${MAX_IDENTIFIER_BYTES}. The server would act on ` +
        "the truncated name, which is not the name checked here — and may not end in _test at all.",
    );
  }
  if (!name.endsWith("_test")) {
    throw new Error(
      `db:reset:test refuses to destroy "${name}": it only ever drops a database whose name ends ` +
        `in _test, and "${name}" does not.`,
    );
  }
  return name;
}

/** Reads the effective docker endpoint under the SAME env the child gets, and requires a local socket. */
export function assertLocalDockerEndpoint(runner = spawnSync) {
  const probe = runner("docker", ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"], {
    env: childEnv(),
    encoding: "utf8",
  });
  if (probe.error || probe.status !== 0) {
    throw new Error(
      "db:reset:test refuses to run: could not resolve the docker endpoint. Is the daemon up?\n" +
        `  docker compose -p ${COMPOSE_PROJECT} -f ${COMPOSE_FILE} up -d ${COMPOSE_SERVICE}\n` +
        "  (the -p is not decoration: without it compose names the project after the current\n" +
        "   directory, so the container this tool then looks for would not be the one you started)",
    );
  }
  const endpoint = String(probe.stdout ?? "").trim();
  if (!endpoint.startsWith("unix://")) {
    throw new Error(
      `db:reset:test refuses to run: the docker endpoint resolves to ${JSON.stringify(endpoint)}, ` +
        "which is not a local unix socket. This command runs DROP DATABASE and will only do so " +
        "against a local daemon.",
    );
  }
  return endpoint;
}

/**
 * Cross-check only, and deliberately a weak one: it compares the database NAME and nothing else.
 * It does NOT verify the URL's host, port, role or scheme, and it cannot — this tool always acts on
 * the local pinned Compose project regardless of what the URL says. Saying so is the point. A
 * message reading "your URL was verified" would restate the exact false claim that took four review
 * rounds to remove.
 */
export function crossCheckDatabaseUrl(url, targetDb) {
  if (!url) return { checked: false };
  let name;
  try {
    name = decodeURIComponent(new URL(String(url)).pathname).replace(/^\//, "");
  } catch {
    name = null;
  }
  if (name === targetDb) return { checked: true, name };

  // Echo the parsed name ONLY when it is provably a plain identifier. A credential pair cannot be
  // one -- ":" and "@" are not identifier characters, and neither are control characters -- so this
  // is a fail-closed echo rule rather than a hope. It exists because the previous revision sliced
  // the URL as text: for `postgres://user:PASSWORD@host:5432/` the "last path segment" became
  // `user:PASSWORD@host:5432`, and the refusal printed the password verbatim.
  const safe = typeof name === "string" && PLAIN_IDENTIFIER.test(name);
  const named = safe ? `names database "${name}"` : "does not name the target database";
  throw new Error(
    `db:reset:test refuses to run: DATABASE_URL_TEST ${named}, but the target is "${targetDb}".` +
      (safe ? "" : " (its value is not shown -- it may contain a password)") +
      "\n" +
      "  This compared NAMES ONLY. It did not verify that URL's host, port, role or scheme, and a " +
      "match would not have meant the URL was checked: this command always acts on the local " +
      `Compose project "${COMPOSE_PROJECT}" in ${COMPOSE_FILE}.\n` +
      "  Pass --db explicitly if you meant a different local test database.",
  );
}

export function parseArgs(argv) {
  const out = { db: DEFAULT_TEST_DB, user: DEFAULT_ROLE };
  for (let i = 0; i < argv.length; i += 1) {
    const eq = argv[i].indexOf("=");
    const flag = eq === -1 ? argv[i] : argv[i].slice(0, eq);
    if (flag !== "--db" && flag !== "--user") {
      throw new Error(
        `db:reset:test refuses to run: unknown argument ${JSON.stringify(argv[i])}. ` +
          "Usage: db:reset:test [--db <name>_test] [--user <role>]",
      );
    }
    let value;
    if (eq === -1) {
      value = argv[i + 1];
      i += 1;
    } else {
      value = argv[i].slice(eq + 1);
    }
    if (value === undefined) {
      throw new Error(`db:reset:test refuses to run: ${flag} needs a value.`);
    }
    if (flag === "--db") out.db = value;
    else out.user = value;
  }
  if (!PLAIN_IDENTIFIER.test(String(out.user ?? ""))) {
    throw new Error("db:reset:test refuses to run: --user must be a plain identifier.");
  }
  return out;
}

/**
 * argv for the compose exec, as an array: no shell, so nothing here can be word-split.
 *
 * `endpoint` is the value assertLocalDockerEndpoint already verified, and it is passed with -H so
 * the daemon that was CHECKED is the daemon that ACTS. Verifying and then letting docker re-resolve
 * the active context is a time-of-check/time-of-use gap: a context switch between the two calls
 * validates daemon A and drops a database on daemon B. It also made the check decorative, which is
 * precisely the failure class this tool was written to stop reproducing.
 *
 * -H is a docker GLOBAL flag and must precede the `compose` subcommand. Measured: `docker compose
 * -H ...` fails with "unknown shorthand flag: 'H' in -H". The regression test asserts the POSITION,
 * not merely the presence, because presence in the wrong place is a runtime failure, not a guard.
 */
export function buildResetArgv(dbName, user, endpoint) {
  if (typeof endpoint !== "string" || !endpoint.startsWith("unix://")) {
    throw new Error("db:reset:test refuses to run: no verified local docker endpoint to bind to.");
  }
  return [
    "-H",
    endpoint,
    "compose",
    // -p pins the project. Without it COMPOSE_PROJECT_NAME retargets the whole command: measured,
    // `COMPOSE_PROJECT_NAME=unrelated_target_probe` moved the resolved project off `plexco`.
    "-p",
    COMPOSE_PROJECT,
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
    // Two separate -c flags: psql wraps a single multi-statement -c in one implicit transaction, and
    // DROP DATABASE cannot run inside a transaction block.
    //
    // The identifier is QUOTED. PostgreSQL folds unquoted identifiers to lower case, so an unquoted
    // `DROP DATABASE PLEXCO_test` would destroy `plexco_test` — a different database from the one
    // this script validated and printed. Injection-safe because PLAIN_IDENTIFIER admits no quote.
    "-c",
    `DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`,
    "-c",
    `CREATE DATABASE "${dbName}"`,
  ];
}

function main(argv = process.argv.slice(2)) {
  let dbName;
  let user;
  let endpoint;
  try {
    const args = parseArgs(argv);
    dbName = assertResettableTestDatabase(args.db);
    user = args.user;
    endpoint = assertLocalDockerEndpoint();
    crossCheckDatabaseUrl(process.env.DATABASE_URL_TEST, dbName);
  } catch (error) {
    console.error(error.message);
    return 1;
  }

  // Name it before destroying it. A destructive tool that does not say what it is about to destroy
  // is one typo away from being the incident it was written to prevent.
  console.log(`db:reset:test — dropping and recreating database "${dbName}" as role "${user}"`);
  console.log(`  project "${COMPOSE_PROJECT}", service "${COMPOSE_SERVICE}" (${COMPOSE_FILE})`);

  const result = spawnSync("docker", buildResetArgv(dbName, user, endpoint), {
    stdio: "inherit",
    env: childEnv(),
  });
  if (result.error) {
    console.error(`db:reset:test could not run docker: ${result.error.message}`);
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
