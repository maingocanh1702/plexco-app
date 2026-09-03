import test from "node:test";
import assert from "node:assert/strict";

import { assertResettableTestDatabase, buildResetArgv, resolveResetTarget } from "./db-reset-test.mjs";

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
      // The host is NOT echoed back — the value carries a password. The message still has to say
      // what the tool will not do, or a reader concludes the guard is merely fussy about spelling.
      assert.match(error.message, /will NOT drop a same-named database locally/);
      assert.ok(!error.message.includes("prod-db.example.com"), "must not echo the supplied value");
      return true;
    },
  );
});

test("refuses a non-postgres protocol", () => {
  assert.throws(() => resolveResetTarget("https://example.invalid/plexco_test"), /postgres/);
});

test("refuses connection-string query overrides, which outrank the authority", () => {
  // pg-connection-string applies ?host=/?port=/?user= on top of the authority, so this URL reads
  // as LOCAL to a WHATWG parser and REMOTE to the connection layer.
  assert.throws(
    () =>
      resolveResetTarget(
        "postgres://plexco:pw@localhost:5432/plexco_test?host=prod-db.example.com&port=6543",
      ),
    /query string or fragment/,
  );
  assert.throws(
    () => resolveResetTarget("postgres://plexco@localhost:5432/plexco_test#frag"),
    /query string or fragment/,
  );
});

test("no error path echoes the connection string", () => {
  // DATABASE_URL_TEST carries a password; an error is exactly where it leaks.
  // Assert on the VALUES this call was given, not on a generic "user:" substring: the refusal for
  // query strings legitimately contains the placeholder `postgres://user:password@localhost...` as
  // guidance, and a blunter assertion fails on that placeholder while telling you nothing about
  // whether a real credential escaped.
  const pw = "SENTINEL_PASSWORD";
  const usr = "SENTINEL_USER";
  const cases = [
    `not a url ${usr}:${pw}`,
    `https://${usr}:${pw}@example.invalid/plexco_test`,
    `postgres://${usr}:${pw}@prod-db.example.invalid:5432/plexco_test`,
    `postgres://${usr}:${pw}@localhost:5432/plexco_test?host=elsewhere`,
    `postgres://${usr}:${pw}@localhost:5432/plexco`,
  ];
  for (const url of cases) {
    assert.throws(
      () => resolveResetTarget(url),
      (error) => {
        assert.ok(!error.message.includes(pw), `password leaked for: ${url.slice(0, 28)}`);
        assert.ok(!error.message.includes(usr), `username leaked for: ${url.slice(0, 28)}`);
        return true;
      },
    );
  }
});

test("refuses a port other than the one Compose publishes", () => {
  assert.throws(() => resolveResetTarget("postgres://plexco@localhost:6543/plexco_test"), /RULE/);
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

test("resolves both pinned urls to the same target", () => {
  // .env.example:56 and .github/workflows/ci.yml:34 — both end in _test, which is what makes the
  // suffix rule a description of the existing convention rather than a new constraint.
  for (const url of [
    "postgres://plexco:plexco_dev@localhost:5432/plexco_test",
    "postgres://plexco:plexco_test@localhost:5432/plexco_test",
  ]) {
    assert.deepEqual(resolveResetTarget(url), { dbName: "plexco_test", user: "plexco" });
  }
});

// The grammar is the entire endpoint check, so its ANCHORS are load-bearing. JavaScript's `$` is
// not trusted from memory here: both newline cases are measured. A pattern that let a trailing
// newline through would accept a database name the executor then quotes into DDL.
test("the grammar is anchored against trailing and embedded newlines", () => {
  assert.throws(() => resolveResetTarget("postgres://localhost:5432/plexco_test\n"), /RULE/);
  assert.throws(() => resolveResetTarget("postgres://localhost:5432/plexco\n_test"), /RULE/);
  assert.throws(() => resolveResetTarget("\npostgres://localhost:5432/plexco_test"), /RULE/);
  assert.throws(
    () => resolveResetTarget("postgres://localhost:5432/plexco_test\npostgres://x/y_test"),
    /RULE/,
  );
});

// Percent-encoding is refused everywhere, which is the property that makes every parser read an
// accepted string identically. The socket case is the one that was MEASURED diverging: WHATWG
// reports the literal "%2Fvar%2Frun%2Fpostgresql" while pg-connection-string decodes it to the
// local unix socket "/var/run/postgresql".
test("refuses percent-encoded hosts, including the unix-socket form", () => {
  assert.throws(() => resolveResetTarget("postgres://%2Fvar%2Frun%2Fpostgresql/plexco_test"), /RULE/);
  assert.throws(() => resolveResetTarget("postgres://loc%61lhost/plexco_test"), /RULE/);
  assert.throws(() => resolveResetTarget("postgres://localhost%2Fx/plexco_test"), /RULE/);
});

test("refuses options PostgreSQL itself accepts, and says so rather than just rejecting", () => {
  for (const q of ["sslmode=require", "application_name=x", "connect_timeout=5"]) {
    assert.throws(
      () => resolveResetTarget(`postgres://plexco@localhost:5432/plexco_test?${q}`),
      (error) => {
        assert.match(error.message, /RULE:/, "must name the rule");
        assert.match(error.message, /INCLUDING options PostgreSQL itself accepts/);
        assert.match(error.message, /Do NOT widen this pattern/);
        return true;
      },
    );
  }
});

test("refuses ::1, whose bracketed and bare spellings differ between parsers", () => {
  assert.throws(() => resolveResetTarget("postgres://[::1]:5432/plexco_test"), /RULE/);
});
