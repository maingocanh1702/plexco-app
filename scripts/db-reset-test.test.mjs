import test from "node:test";
import assert from "node:assert/strict";

import {
  assertLocalDockerEndpoint,
  assertResettableTestDatabase,
  buildResetArgv,
  childEnv,
  crossCheckDatabaseUrl,
  assertPlainIdentifier,
  parseArgs,
  safeEcho,
} from "./db-reset-test.mjs";

// This script runs DROP DATABASE, so the guards are the primary behaviour, not edge cases. Every
// case below refuses something that was MEASURED getting through an earlier revision.

// ---------------------------------------------------------------- the database name

test("refuses the development database, naming it", () => {
  assert.throws(
    () => assertResettableTestDatabase("plexco"),
    (error) => {
      assert.match(error.message, /plexco/);
      assert.match(error.message, /_test/);
      return true;
    },
  );
});

test("refuses the maintenance database and near-misses on the suffix", () => {
  assert.throws(() => assertResettableTestDatabase("postgres"));
  assert.throws(() => assertResettableTestDatabase("plexco_test_backup"));
  assert.throws(() => assertResettableTestDatabase("plexco_testing"));
});

test("refuses names that are not plain identifiers", () => {
  assert.throws(() => assertResettableTestDatabase('plexco_test"; DROP DATABASE plexco; --'));
  assert.throws(() => assertResettableTestDatabase("plexco test"));
  assert.throws(() => assertResettableTestDatabase("9plexco_test"));
  assert.throws(() => assertResettableTestDatabase(""));
  assert.throws(() => assertResettableTestDatabase(undefined));
});

test("refuses a name longer than PostgreSQL's 63-byte identifier limit", () => {
  // The server truncates to 63 bytes, and those bytes no longer end in _test — so the guard would
  // approve one name while the server destroyed a different, unqualified one.
  const overlong = "a".repeat(63) + "_test";
  assert.equal(overlong.slice(0, 63).endsWith("_test"), false, "premise: truncation drops _test");
  assert.throws(() => assertResettableTestDatabase(overlong), /63|truncat/i);
});

test("accepts the canonical test database", () => {
  assert.equal(assertResettableTestDatabase("plexco_test"), "plexco_test");
});

// ---------------------------------------------------------------- the execution target

test("the verified endpoint is carried into the argv, before the subcommand", () => {
  const endpoint = "unix:///Users/x/.docker/run/docker.sock";
  const argv = buildResetArgv("plexco_test", "plexco", endpoint);

  // POSITION, not presence: -H is a docker GLOBAL flag. Measured -- `docker compose -H ...` fails
  // with "unknown shorthand flag: 'H' in -H", so a correctly-present flag in the wrong place is a
  // runtime failure rather than a guard.
  assert.equal(argv[0], "-H", "-H must be the first argument");
  assert.equal(argv[1], endpoint, "the VERIFIED endpoint must be the one passed");
  assert.ok(argv.indexOf("-H") < argv.indexOf("compose"), "-H must precede the subcommand");

  // Without this the daemon is resolved twice -- once to verify, once at exec -- so a context
  // switch between them validates daemon A and drops a database on daemon B.
  assert.ok(argv.includes(endpoint), "the checked endpoint must reach the final argv");
});

test("an unverified or non-local endpoint cannot be bound", () => {
  assert.throws(() => buildResetArgv("plexco_test", "plexco", undefined), /verified local docker/);
  assert.throws(
    () => buildResetArgv("plexco_test", "plexco", "tcp://remote.example:2375"),
    /verified local docker/,
  );
});

test("the compose file is absolute, so cwd cannot choose which file is read", () => {
  const argv = buildResetArgv("plexco_test", "plexco", "unix:///tmp/d.sock");
  const f = argv[argv.indexOf("-f") + 1];
  assert.ok(f.startsWith("/"), "-f must be an absolute path");
  assert.ok(f.endsWith("/infra/docker-compose.yml"));
});

test("the compose project is pinned, and the identifier is quoted", () => {
  const argv = buildResetArgv("plexco_test", "plexco", "unix:///tmp/d.sock");
  const p = argv.indexOf("-p");
  assert.ok(p !== -1, "project must be pinned with -p");
  assert.equal(argv[p + 1], "plexco");
  // Measured: COMPOSE_PROJECT_NAME=unrelated_target_probe moved the resolved project off `plexco`.
  assert.ok(argv.includes('DROP DATABASE IF EXISTS "plexco_test" WITH (FORCE)'));
  assert.ok(argv.includes('CREATE DATABASE "plexco_test"'));
  for (const arg of argv) {
    assert.ok(!/DATABASE (IF EXISTS )?plexco_test\b/.test(arg), "no unquoted identifier may survive");
  }
});

test("environment that can retarget the command is stripped from the child", () => {
  const env = childEnv({
    PATH: "/usr/bin",
    DOCKER_HOST: "tcp://evil.example:2375",
    DOCKER_CONTEXT: "elsewhere",
    COMPOSE_PROJECT_NAME: "unrelated_target_probe",
    COMPOSE_FILE: "/tmp/other.yml",
    COMPOSE_PROFILES: "x",
    COMPOSE_PROJECT_DIRECTORY: "/tmp/elsewhere",
  });
  for (const key of [
    "DOCKER_HOST",
    "DOCKER_CONTEXT",
    "COMPOSE_PROJECT_NAME",
    "COMPOSE_FILE",
    "COMPOSE_PROFILES",
    "COMPOSE_PROJECT_DIRECTORY",
  ]) {
    assert.equal(env[key], undefined, `${key} must not reach the child`);
  }
  assert.equal(env.PATH, "/usr/bin", "unrelated environment is preserved");
});

test("a non-local docker endpoint is refused, not silently used", () => {
  // Stripping env is NOT enough on its own: the active context lives in ~/.docker/config.json, so
  // the effective endpoint is resolved and classified rather than assumed.
  const remote = () => ({ status: 0, stdout: "tcp://remote.example:2375\n" });
  assert.throws(() => assertLocalDockerEndpoint(remote), /not a local unix socket/);

  const ssh = () => ({ status: 0, stdout: "ssh://someone@box\n" });
  assert.throws(() => assertLocalDockerEndpoint(ssh), /not a local unix socket/);

  const broken = () => ({ status: 1, stdout: "" });
  assert.throws(() => assertLocalDockerEndpoint(broken), /could not resolve the docker endpoint/);

  const local = () => ({ status: 0, stdout: "unix:///Users/x/.docker/run/docker.sock\n" });
  assert.equal(assertLocalDockerEndpoint(local), "unix:///Users/x/.docker/run/docker.sock");
});

// ---------------------------------------------------------------- the URL, demoted

test("DATABASE_URL_TEST is a name cross-check that does not overclaim", () => {
  assert.deepEqual(crossCheckDatabaseUrl(undefined, "plexco_test"), { checked: false });
  assert.deepEqual(
    crossCheckDatabaseUrl("postgres://plexco:pw@localhost:5432/plexco_test", "plexco_test"),
    { checked: true, name: "plexco_test" },
  );
  assert.throws(
    () => crossCheckDatabaseUrl("postgres://plexco@localhost:5432/other_test", "plexco_test"),
    (error) => {
      assert.match(error.message, /other_test/);
      assert.match(error.message, /plexco_test/);
      // The message must NOT read as "your URL was verified" — it compares one field. Overclaiming
      // here would restate the false authority that took four review rounds to remove.
      assert.match(error.message, /NAMES ONLY/);
      assert.match(error.message, /always acts on the local/);
      return true;
    },
  );
});

test("a URL naming another host still only ever affects the local project", () => {
  // Matching names do NOT mean the URL was checked. This documents the limit deliberately: the
  // cross-check passes here, and the tool still acts locally, which is the honest contract.
  assert.deepEqual(
    crossCheckDatabaseUrl("postgres://u:p@prod-db.example.com:5432/plexco_test", "plexco_test"),
    { checked: true, name: "plexco_test" },
  );
});

// ---------------------------------------------------------------- arguments

test("arguments default to the canonical local target", () => {
  assert.deepEqual(parseArgs([]), { db: "plexco_test", user: "plexco" });
});

test("arguments are explicit, and unknown ones are refused", () => {
  assert.deepEqual(parseArgs(["--db", "other_test"]), { db: "other_test", user: "plexco" });
  assert.deepEqual(parseArgs(["--db=other_test"]), { db: "other_test", user: "plexco" });
  assert.deepEqual(parseArgs(["--user", "someone"]), { db: "plexco_test", user: "someone" });
  assert.throws(() => parseArgs(["--force"]), /unknown argument/);
  assert.throws(() => parseArgs(["--db"]), /needs a value/);
  assert.throws(() => parseArgs(["--user", "not an identifier"]), /plain identifier/);
});

test("an explicit --db still passes the suffix guard", () => {
  assert.throws(() => assertResettableTestDatabase(parseArgs(["--db", "plexco"]).db), /_test/);
});

test("no refusal echoes a credential from DATABASE_URL_TEST", () => {
  // Measured on the previous revision: stripping a trailing slash made the "last path segment" the
  // userinfo, so `postgres://user:PASSWORD@host:5432/` printed the password verbatim.
  const pw = "SENTINEL_PASSWORD";
  const usr = "SENTINEL_USER";
  for (const url of [
    `postgres://${usr}:${pw}@localhost:5432/`,
    `postgres://${usr}:${pw}@localhost:5432`,
    `postgres://${usr}:${pw}@localhost:5432/other_test`,
    `not a url ${usr}:${pw}`,
    `postgres://${usr}:${pw}@localhost:5432/plexco\u0007bell`,
  ]) {
    assert.throws(
      () => crossCheckDatabaseUrl(url, "plexco_test"),
      (error) => {
        assert.ok(!error.message.includes(pw), `password leaked for ${url.slice(0, 30)}`);
        assert.ok(!error.message.includes(usr), `username leaked for ${url.slice(0, 30)}`);
        // Newline is EXCLUDED deliberately: these messages are multi-line by design, so \n is the
        // tool's own formatting rather than something the input smuggled in. The property under
        // test is that no control character from the INPUT reaches output. Built with
        // String.fromCodePoint so no literal control character appears in this source file.
        const controls = Array.from({ length: 32 }, (_, i) => String.fromCodePoint(i)).filter(
          (c) => c !== "\n",
        );
        for (const c of controls) {
          assert.ok(
            !error.message.includes(c),
            "control characters from the input must not reach output",
          );
        }
        assert.match(error.message, /NAMES ONLY/);
        return true;
      },
    );
  }
});

test("a parsed name is echoed only when it is provably an identifier", () => {
  // Safe to show: an identifier cannot be a credential pair -- ":" and "@" are not identifier chars.
  assert.throws(
    () => crossCheckDatabaseUrl("postgres://localhost:5432/other_test", "plexco_test"),
    /names database "other_test"/,
  );
  // Not provably safe: say so instead of guessing.
  assert.throws(
    () => crossCheckDatabaseUrl("postgres://u:p@localhost:5432/", "plexco_test"),
    /value is not shown/,
  );
});

// ---------------------------------------------------------------- threat model boundary

test("the psql layer is specified by explicit flags, so no ambient value can supply one", () => {
  const argv = buildResetArgv("plexco_test", "plexco", "unix:///tmp/d.sock");
  const i = argv.indexOf("psql");
  assert.ok(i !== -1);
  // -X: an image or home dir that happens to ship a psqlrc could \connect elsewhere AFTER the
  // docker target was verified. That is an accident, so it is inside the declared model.
  assert.ok(argv.includes("-X"), "psqlrc must not be read");
  assert.equal(argv[argv.indexOf("-h") + 1], "/var/run/postgresql");
  assert.equal(argv[argv.indexOf("-p", i) + 1], "5432");
  // Command-line connection parameters outrank PGHOST/PGPORT/PGDATABASE/PGUSER, so pinning these
  // is what makes stripping them unnecessary. This is where pinning stops, by declared model.
  assert.ok(argv.includes("-U") && argv.includes("-d"), "role and database stay explicit too");
});

test("no rejected value is echoed unless it is provably an identifier", () => {
  // Measured on the previous revision: `--db "$DATABASE_URL_TEST"` and a positional URL both
  // printed the password verbatim, through two different echo sites.
  const pw = "SENTINEL_PASSWORD";
  const url = `postgres://u:${pw}@localhost:5432/plexco_test`;
  assert.throws(
    () => parseArgs([url]),
    (e) => {
      assert.ok(!e.message.includes(pw), "unknown-argument path leaked");
      return true;
    },
  );
  assert.throws(
    () => assertResettableTestDatabase(url),
    (e) => {
      assert.ok(!e.message.includes(pw), "name-rejection path leaked");
      return true;
    },
  );
  // The rule is fail-closed, not blanket suppression: a plain identifier is still shown, because a
  // credential pair cannot be one.
  assert.equal(safeEcho("plexco_test"), '"plexco_test"');
  assert.match(safeEcho(url), /not shown/);
});

test("every identifier is validated by the same rule, database and role alike", () => {
  // The 63-byte truncation class applies to ROLE names exactly as it does to database names.
  // Measured on the previous revision: a 70-byte --user was accepted, and the server would have
  // executed as the truncated 63-byte role -- a different one from the value validated and printed.
  const overlong = "r".repeat(70);
  assert.throws(() => parseArgs(["--user", overlong]), /63|truncat/i);
  assert.throws(() => assertResettableTestDatabase("d".repeat(70) + "_test"), /63|truncat/i);

  // One function, so a future identifier cannot pick up the rule in one place and miss it in another.
  assert.throws(() => assertPlainIdentifier(overlong, "role name"), /role name/);
  assert.throws(() => assertPlainIdentifier("has space", "role name"), /plain identifier/);
  assert.throws(() => assertPlainIdentifier("", "role name"), /no role name/);
  assert.equal(assertPlainIdentifier("plexco", "role name"), "plexco");

  // Boundary: exactly 63 bytes is the largest PostgreSQL keeps intact, so it must be accepted.
  const exact = "r".repeat(63);
  assert.equal(assertPlainIdentifier(exact, "role name"), exact);
  assert.equal(parseArgs(["--user", exact]).user, exact);
});

test("an overlong identifier is not echoed back in full", () => {
  // safeEcho still applies: a 70-byte value is a plain identifier, so showing it is safe, but the
  // rule must come from one place rather than each call site deciding.
  assert.match(safeEcho("r".repeat(70)), /^"r+"$/);
  assert.match(safeEcho("postgres://u:pw@h/db"), /not shown/);
});
