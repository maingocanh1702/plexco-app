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
 * THE SIX SELECTORS -- the completeness criterion, stated against the CALL PATH.
 *
 * Each line says what actually gets SELECTED, not what gets passed. That distinction is not
 * pedantry: the previous revision's header read "container: the service named in this repository's
 * compose file", which is true of the argument and false of the selection -- compose resolves a
 * container by LABEL at exec time -- and that wording let "naming is not pinning" survive four
 * rounds of re-reading. Describe the selection or the bug hides in the description.
 *
 *   daemon      the endpoint resolved once, checked to be a local unix socket, carried in -H
 *   project     the literal `plexco`, carried in -p, never inherited from the environment
 *   compose file an absolute path derived from this file's location, carried in -f
 *   container   the container ID resolved from that project+file and verified to belong to THIS
 *               compose configuration before exec -- labels alone are not identity
 *   role        the value in -U; libpq ranks explicit parameters above PGUSER, so nothing else wins
 *   database    the value in -d and in the quoted DDL, from --db, validated as an identifier
 *
 * WHY SIX AND WHY THAT IS ANSWERABLE. Four earlier revisions each claimed a closed set and each was
 * refuted, because they enumerated CONFIGURATION -- environment variables, URL constructs, parser
 * behaviours -- and configuration is unbounded. This list enumerates the CALL PATH instead, which
 * the code itself bounds: every selector is something buildResetArgv must decide in order to
 * construct a command at all. "Is the set closed?" is then answered by reading the function, not by
 * predicting what configuration exists on some machine.
 *
 * THE STOPPING RULE. With those six pinned, the accident model is DECLARED COVERED. A later finding
 * that is inside the threat model but is NOT one of these six selectors goes to the backlog as a
 * row -- record it, cite this clause, continue. It does not get a fix round. Without this rule the
 * lane inherits a fresh budget and the same appetite that spent five rounds; with it, "when do we
 * stop" has an answer written down before the work rather than discovered at the breaker.
 *
 * DATABASE_URL_TEST is demoted to a cross-check: if set, its database NAME must match the target.
 * That is a claim this tool can keep. The previous one was not.
 *
 * THREAT MODEL -- read this before adding another guard.
 *
 * This tool defends against MISDIRECTION BY UNINTENDED LOCAL CONFIGURATION. Concretely: a stale or
 * switched docker context, a COMPOSE_PROJECT_NAME left over in a shell, the wrong working directory
 * against a relative compose path, a DATABASE_URL_TEST aimed somewhere unexpected, a mistyped --db.
 * Those are what actually destroy a developer's database, and each has a pin above.
 *
 * It does NOT defend against an adversary who already controls the host, the container images, or
 * ~/.docker. That adversary does not need this script; they have a shell. Hardening against them
 * here buys nothing and has no natural stopping point -- the command traverses docker CLI, compose,
 * container, psql and libpq, every layer is configurable, so an unbounded adversary yields a finding
 * per layer forever. Three consecutive review rounds did exactly that before this paragraph existed.
 *
 * HOW TO USE THIS WHEN A NEW FINDING ARRIVES:
 *   inside the model  (unintended local configuration)        -> a real defect, fix it
 *   outside the model (needs host/image/~/.docker compromise) -> not a defect; it is a
 *                                                                threat-model disagreement. Cite
 *                                                                this paragraph, record the finding
 *                                                                and the clause that excludes it,
 *                                                                and do not harden.
 *
 * HOW TO PIN, WITHOUT ENUMERATING -- the operational half of the model above.
 *
 * The model alone does not settle every case. A leftover PGSERVICE or PGDATABASE in a dev shell is
 * an ACCIDENT, so it sits inside the model, and there are unboundedly many such variables: that is
 * the enumeration trap again in different clothes, and it is what cost this file three review rounds.
 *
 * The tie-breaker: PREFER OVERRIDING AT THE CALL YOU ALREADY CONSTRUCT OVER ENUMERATING THE
 * ENVIRONMENT. An argument you already pass costs nothing and needs no list of variables to stay
 * correct. A channel earns its own decision only when it CANNOT be overridden by an argument you
 * already pass.
 *
 * That is the whole reason -X, -h and -p are here while a PG* strip is not: libpq ranks explicit
 * connection parameters above environment variables, so -h and -p already beat PGHOST and PGPORT,
 * and stripping them would be a pin that changes nothing. Same reasoning retired DOCKER_CONFIG.
 * The variables that ARE stripped (REDIRECTING_ENV) are exactly the ones docker and compose read
 * with no argument available to outrank them.
 *
 * REVISION TRIGGER -- this model is NOT permanent. It holds BECAUSE the tool only ever targets a
 * local compose project and refuses any endpoint that is not a unix socket. If anyone lets this
 * script target a remote or CI database, the model is VOID and must be rewritten BEFORE that change
 * lands: a remote target reintroduces a network adversary that none of these pins address. Do not
 * inherit this paragraph across that change without redoing it.
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

/** The unix socket directory inside the postgres image; pinned so PGHOST cannot supply one. */
const CONTAINER_SOCKET_DIR = "/var/run/postgresql";

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

/**
 * Echo a rejected value ONLY when it is provably a plain identifier. Anything else is summarised.
 * A connection string cannot be an identifier -- ":" and "@" are not identifier characters -- so
 * this is a fail-closed rule rather than a guess. It exists because `--db "$DATABASE_URL_TEST"` and
 * a positional URL both printed the password verbatim; measured with a sentinel on both paths.
 */
export function safeEcho(value) {
  return typeof value === "string" && PLAIN_IDENTIFIER.test(value)
    ? `"${value}"`
    : "the supplied value (not shown -- it may contain a password)";
}

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
/**
 * ONE validator for EVERY identifier that reaches PostgreSQL — database and role alike.
 *
 * It exists as a shared function rather than a repeated check because the previous revision applied
 * the 63-byte rule to the database name and not to --user, and a 70-byte role was accepted: the
 * server truncates it and executes as a DIFFERENT role from the one validated and printed. That is
 * the same aliasing class, and the reason it was missed is that the rule lived in one call site
 * instead of one function. Anything that becomes an identifier goes through here.
 */
export function assertPlainIdentifier(value, what) {
  if (typeof value !== "string" || value === "") {
    throw new Error(`db:reset:test refuses to run: no ${what} was given.`);
  }
  if (!PLAIN_IDENTIFIER.test(value)) {
    throw new Error(
      `db:reset:test refuses to use ${safeEcho(value)} as a ${what}: it must be a plain identifier ` +
        "(letters, digits, underscore; not starting with a digit), so it never reaches SQL.",
    );
  }
  if (Buffer.byteLength(value, "utf8") > MAX_IDENTIFIER_BYTES) {
    throw new Error(
      `db:reset:test refuses to use ${safeEcho(value)} as a ${what}: it is ` +
        `${Buffer.byteLength(value, "utf8")} bytes, and PostgreSQL truncates identifiers to ` +
        `${MAX_IDENTIFIER_BYTES}. The server would act on the truncated value, which is not the one ` +
        "checked here.",
    );
  }
  return value;
}

export function assertResettableTestDatabase(name) {
  assertPlainIdentifier(name, "database name");
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
        `db:reset:test refuses to run: unknown argument ${safeEcho(argv[i])}. ` +
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
  // Same validator as the database name: role identifiers truncate at 63 bytes too.
  assertPlainIdentifier(out.user, "role name");
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
    // -X: do not read psqlrc. An image or home directory that happens to ship one could \\connect
    // elsewhere after the docker target was verified -- an accident, so inside the model.
    "-X",
    // The psql/libpq layer is now specified entirely by explicit flags. Command-line connection
    // parameters take precedence over PGHOST/PGPORT/PGDATABASE/PGUSER, so those cannot override
    // these; stripping them as well would be a redundant pin of the kind this file already declines
    // to add (see the DOCKER_CONFIG note). This is where the pinning STOPS, and the reason is the
    // declared threat model above, not exhaustion: anything deeper needs a compromised image.
    "-h",
    CONTAINER_SOCKET_DIR,
    "-p",
    "5432",
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
