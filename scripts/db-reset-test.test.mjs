import test from "node:test";
import assert from "node:assert/strict";

import { assertResettableTestDatabase, databaseNameFromUrl } from "./db-reset-test.mjs";

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
