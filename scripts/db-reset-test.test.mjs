import test from "node:test";
import assert from "node:assert/strict";

import {
  assertLocalDockerEndpoint,
  assertResettableTestDatabase,
  buildResetArgv,
  childEnv,
  crossCheckDatabaseUrl,
  parseArgs,
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

test("the compose project is pinned, and the identifier is quoted", () => {
  const argv = buildResetArgv("plexco_test", "plexco");
  const p = argv.indexOf("-p");
  assert.ok(p !== -1, "project must be pinned with -p");
  assert.equal(argv[p + 1], "plexco");
  // Measured: COMPOSE_PROJECT_NAME=unrelated_target_probe moved the resolved project off `plexco`.
  // -p is what makes that ineffective.
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
  });
  for (const key of [
    "DOCKER_HOST",
    "DOCKER_CONTEXT",
    "COMPOSE_PROJECT_NAME",
    "COMPOSE_FILE",
    "COMPOSE_PROFILES",
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
