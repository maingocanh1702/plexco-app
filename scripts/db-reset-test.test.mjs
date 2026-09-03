import test from "node:test";
import assert from "node:assert/strict";

import {
  assertResettableTestDatabase,
  buildResetArgv,
  databaseNameFromUrl,
  resolveResetTarget,
} from "./db-reset-test.mjs";

// The whole point of this script is that it runs DROP DATABASE. The guard is the only thing
// standing between a mistyped environment variable and a destroyed development database, so it
// is tested as the primary behaviour rather than as an edge case.

test("refuses the development database, naming it", () => {
  assert.throws(
    () => assertResettableTestDatabase("plexco"),
    (error) => {
      assert.match(error.message, /plexco/);
      assert.match(error.message, /_test/);
      return true;
    },
    "a name not ending in _test must be refused — `plexco` is the DEV database",
  );
});

test("refuses the maintenance database", () => {
  assert.throws(() => assertResettableTestDatabase("postgres"));
});

test("refuses a name that merely contains _test without ending in it", () => {
  assert.throws(() => assertResettableTestDatabase("plexco_test_backup"));
  assert.throws(() => assertResettableTestDatabase("plexco_testing"));
});

test("refuses names that are not plain identifiers", () => {
  // Belt and braces: the executed statement interpolates the name, so anything that is not a
  // bare identifier is refused before it can reach SQL.
  assert.throws(() => assertResettableTestDatabase('plexco_test"; DROP DATABASE plexco; --'));
  assert.throws(() => assertResettableTestDatabase("plexco test"));
  assert.throws(() => assertResettableTestDatabase("9plexco_test"));
  assert.throws(() => assertResettableTestDatabase(""));
  assert.throws(() => assertResettableTestDatabase(undefined));
});

test("accepts the canonical test database", () => {
  assert.equal(assertResettableTestDatabase("plexco_test"), "plexco_test");
});

// Both cases below defeated the guard before code-review round 1. Neither is hypothetical: the
// probe that produced them ran against the shipped function and it accepted both.

test("refuses a name longer than PostgreSQL's 63-byte identifier limit", () => {
  // 68 bytes. The server truncates to 63, and those 63 bytes do NOT end in _test — so the guard
  // would have approved one name while the server destroyed a different, unqualified one.
  const overlong = "a".repeat(63) + "_test";
  assert.equal(overlong.slice(0, 63).endsWith("_test"), false, "premise: truncation drops _test");
  assert.throws(() => assertResettableTestDatabase(overlong), /63|truncat/i);
});

test("a mixed-case name is emitted quoted, so the server cannot fold it to another database", () => {
  // libpq sends the URL's dbname verbatim, so `PLEXCO_test` is a real, distinct database name.
  // Unquoted DDL would fold it to `plexco_test` and destroy the wrong one.
  assert.equal(assertResettableTestDatabase("PLEXCO_test"), "PLEXCO_test");
  const argv = buildResetArgv("PLEXCO_test", "plexco");
  assert.ok(
    argv.includes('DROP DATABASE IF EXISTS "PLEXCO_test" WITH (FORCE)'),
    "DROP must quote the identifier exactly",
  );
  assert.ok(argv.includes('CREATE DATABASE "PLEXCO_test"'), "CREATE must quote the identifier");
  for (const arg of argv) {
    assert.ok(!/DATABASE (IF EXISTS )?PLEXCO_test/.test(arg), "no unquoted identifier may survive");
  }
});

// The script always executes inside the local Compose service. If it validated only the database
// NAME, a url naming another host would pass and then get a same-named LOCAL database dropped in
// its place -- neither doing what was asked nor leaving the machine alone. Probed against the
// shipped code before this guard existed; all three below were accepted.

test("refuses a url pointing at another host instead of substituting the local cluster", () => {
  assert.throws(
    () => resolveResetTarget("postgres://plexco:pw@prod-db.example.com:5432/customers_test"),
    (error) => {
      assert.match(error.message, /prod-db\.example\.com/);
      assert.match(error.message, /will NOT drop a same-named database locally/);
      return true;
    },
  );
});

test("refuses a non-postgres protocol", () => {
  assert.throws(() => resolveResetTarget("https://example.invalid/plexco_test"), /postgres/);
});

test("refuses a port other than the one Compose publishes", () => {
  assert.throws(() => resolveResetTarget("postgres://plexco@localhost:6543/plexco_test"), /6543/);
});

test("resolves the canonical local url, and the executor consumes only that result", () => {
  const target = resolveResetTarget("postgres://plexco:plexco_dev@localhost:5432/plexco_test");
  assert.deepEqual(target, { dbName: "plexco_test", user: "plexco" });
  // An implicit port is the libpq default, which is the port Compose publishes.
  assert.deepEqual(resolveResetTarget("postgres://plexco@127.0.0.1/plexco_test"), {
    dbName: "plexco_test",
    user: "plexco",
  });
  const argv = buildResetArgv(target.dbName, target.user);
  assert.ok(argv.includes('DROP DATABASE IF EXISTS "plexco_test" WITH (FORCE)'));
});

test("the suffix rule still applies through the resolver, not only to a bare name", () => {
  assert.throws(
    () => resolveResetTarget("postgres://plexco@localhost:5432/plexco"),
    /only ever drops a database whose name ends/,
  );
});

test("reads the database name out of both pinned urls", () => {
  // .env.example:56 and .github/workflows/ci.yml:34 — both end in _test, which is what makes
  // the suffix rule a description of the existing convention rather than a new constraint.
  assert.equal(
    databaseNameFromUrl("postgres://plexco:plexco_dev@localhost:5432/plexco_test"),
    "plexco_test",
  );
  assert.equal(
    databaseNameFromUrl("postgres://plexco:plexco_test@localhost:5432/plexco_test"),
    "plexco_test",
  );
});
