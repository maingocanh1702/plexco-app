import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  assertLocalDockerEndpoint,
  assertResettableTestDatabase,
  assertContainerMatchesCompose,
  assertContainerMountsExpectedVolume,
  buildComposeConfigArgv,
  buildConfigHashArgv,
  expectedDataVolume,
  buildContainerIdArgv,
  buildResetArgv,
  parseConfigHash,
  resolveComposeFile,
  resolveVerifiedContainerId,
  childEnv,
  crossCheckDatabaseUrl,
  assertPlainIdentifier,
  parseArgs,
  safeArgEcho,
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
  const argv = buildResetArgv("plexco_test", "plexco", endpoint, "c0ffee123456");

  // POSITION, not presence: -H is a docker GLOBAL flag. Measured -- `docker compose -H ...` fails
  // with "unknown shorthand flag: 'H' in -H", so a correctly-present flag in the wrong place is a
  // runtime failure rather than a guard.
  assert.equal(argv[0], "-H", "-H must be the first argument");
  assert.equal(argv[1], endpoint, "the VERIFIED endpoint must be the one passed");
  assert.ok(argv.indexOf("-H") < argv.indexOf("exec"), "-H must precede the subcommand");

  // Without this the daemon is resolved twice -- once to verify, once at exec -- so a context
  // switch between them validates daemon A and drops a database on daemon B.
  assert.ok(argv.includes(endpoint), "the checked endpoint must reach the final argv");
});

test("an unverified or non-local endpoint cannot be bound", () => {
  assert.throws(() => buildResetArgv("plexco_test", "plexco", undefined, "c0ffee123456"), /verified local docker/);
  assert.throws(
    () => buildResetArgv("plexco_test", "plexco", "tcp://remote.example:2375", "c0ffee123456"),
    /verified local docker/,
  );
});

test("the compose file is absolute, so cwd cannot choose which file is read", () => {
  // The compose file and project select the CONTAINER, so they live on the resolution call now.
  const argv = buildContainerIdArgv("unix:///tmp/d.sock");
  const f = argv[argv.indexOf("-f") + 1];
  assert.ok(f.startsWith("/"), "-f must be an absolute path");
  assert.ok(f.endsWith("/infra/docker-compose.yml"));
});

test("the compose project is pinned, and the identifier is quoted", () => {
  // Project pin is on the resolution call, which is what finds the container to verify.
  const resolve = buildContainerIdArgv("unix:///tmp/d.sock");
  const p = resolve.indexOf("-p");
  assert.ok(p !== -1, "project must be pinned with -p");
  assert.equal(resolve[p + 1], "plexco");
  const argv = buildResetArgv("plexco_test", "plexco", "unix:///tmp/d.sock", "c0ffee123456");
  // Measured: COMPOSE_PROJECT_NAME=unrelated_target_probe moved the resolved project off `plexco`.
  assert.ok(argv.includes('DROP DATABASE IF EXISTS "plexco_test" WITH (FORCE)'));
  assert.ok(argv.includes('CREATE DATABASE "plexco_test" TEMPLATE template0'));
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
  assert.throws(() => parseArgs(["--user", "someone"]), /unknown argument "--user"/);
  assert.throws(() => parseArgs(["--force"]), /unknown argument/);
  assert.throws(() => parseArgs(["--db"]), /needs a value/);
  assert.throws(() => parseArgs(["--user", "root"]), /unknown argument "--user"/);
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
  const argv = buildResetArgv("plexco_test", "plexco", "unix:///tmp/d.sock", "c0ffee123456");
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
  assert.throws(() => assertResettableTestDatabase("d".repeat(70) + "_test"), /63|truncat/i);

  // One function, so a future identifier cannot pick up the rule in one place and miss it in another.
  assert.throws(() => assertPlainIdentifier(overlong, "role name"), /role name/);
  assert.throws(() => assertPlainIdentifier("has space", "role name"), /plain identifier/);
  assert.throws(() => assertPlainIdentifier("", "role name"), /no role name/);
  assert.equal(assertPlainIdentifier("plexco", "role name"), "plexco");

  // Boundary: exactly 63 bytes is the largest PostgreSQL keeps intact, so it must be accepted.
  const exact = "r".repeat(63);
  assert.equal(assertPlainIdentifier(exact, "role name"), exact);
});

test("safeEcho shows a plain identifier in full and withholds anything else", () => {
  // safeEcho still applies: a 70-byte value is a plain identifier, so showing it is safe, but the
  // rule must come from one place rather than each call site deciding.
  assert.match(safeEcho("r".repeat(70)), /^"r+"$/);
  assert.match(safeEcho("postgres://u:pw@h/db"), /not shown/);
});

// ---------------------------------------------------------------- the container selector

const LABELS = (project, files, hash = "HASH_CURRENT") =>
  JSON.stringify({
    "com.docker.compose.project": project,
    "com.docker.compose.project.config_files": files,
    "com.docker.compose.config-hash": hash,
  });

test("a stale container under matching labels is refused", () => {
  // Labels are how compose FINDS a container, not proof it is the right one. A container left from
  // another checkout or an older configuration carries the same project+service labels and would
  // have received the forced DROP DATABASE.
  assert.throws(
    () => assertContainerMatchesCompose(LABELS("plexco", "/elsewhere/docker-compose.yml"), "HASH_CURRENT"),
    /exactly this one compose file/,
  );
  assert.throws(
    () => assertContainerMatchesCompose(LABELS("other_project", "/anything.yml"), "HASH_CURRENT"),
    /compose project/,
  );
  assert.throws(() => assertContainerMatchesCompose("not json", "HASH_CURRENT"), /compose labels/);
});

test("the destructive call names the verified container, not a label selector", () => {
  const argv = buildResetArgv("plexco_test", "plexco", "unix:///tmp/d.sock", "abc123def456");
  assert.equal(argv[0], "-H");
  assert.equal(argv[2], "exec", "must be `docker exec <id>`, not `compose exec <service>`");
  assert.ok(argv.includes("abc123def456"), "the verified container id must reach the argv");
  assert.ok(!argv.includes("compose"), "label-based selection must not remain on the destructive call");
  assert.throws(
    () => buildResetArgv("plexco_test", "plexco", "unix:///tmp/d.sock", ""),
    /verified container id/,
  );
});

test("resolution refuses when no container is running, and when it is the wrong one", () => {
  const none = () => ({ status: 0, stdout: "" });
  assert.throws(() => resolveVerifiedContainerId("unix:///tmp/d.sock", none), /no running/);

  const calls = [];
  const stale = (_cmd, args) => {
    calls.push(args);
    return args.includes("ps")
      ? { status: 0, stdout: "staleid123\n" }
      : { status: 0, stdout: LABELS("plexco", "/other/docker-compose.yml") };
  };
  assert.throws(() => resolveVerifiedContainerId("unix:///tmp/d.sock", stale), /exactly this one compose file/);
  assert.ok(calls[0].includes("ps"), "resolution asks compose for the id first");
});

test("a SAME-PATH container from an older configuration is refused", () => {
  // Path and project are not identity. A container created earlier from the SAME file, under a
  // previous version of it -- another volume, another image -- carries identical project and
  // config_files labels and passed every check before the config hash was bound.
  const composeFile = buildContainerIdArgv("unix:///tmp/d.sock")[
    buildContainerIdArgv("unix:///tmp/d.sock").indexOf("-f") + 1
  ];
  assert.throws(
    () => assertContainerMatchesCompose(LABELS("plexco", composeFile, "HASH_OLD"), "HASH_CURRENT"),
    /older version of this compose configuration/,
  );
  // Same path, same project, CURRENT hash -> accepted.
  assert.equal(
    assertContainerMatchesCompose(LABELS("plexco", composeFile, "HASH_CURRENT"), "HASH_CURRENT"),
    true,
  );
  // A missing expected hash must not silently pass.
  assert.throws(
    () => assertContainerMatchesCompose(LABELS("plexco", composeFile, "HASH_CURRENT"), ""),
    /older version of this compose configuration/,
  );
});

test("the config hash is read from compose, and a service-only line is rejected", () => {
  const argv = buildConfigHashArgv("unix:///tmp/d.sock");
  assert.ok(argv.includes("--hash=postgres"));
  assert.ok(argv.indexOf("-H") < argv.indexOf("compose"));
  assert.equal(parseConfigHash("postgres  abc123def\n"), "abc123def");
  assert.throws(() => parseConfigHash("postgres\n"), /configuration hash/);
  assert.throws(() => parseConfigHash(""), /configuration hash/);
});

test("resolution refuses a same-path container whose configuration has moved on", () => {
  const composeFile = buildContainerIdArgv("unix:///tmp/d.sock")[
    buildContainerIdArgv("unix:///tmp/d.sock").indexOf("-f") + 1
  ];
  const runner = (_cmd, args) => {
    if (args.includes("ps")) return { status: 0, stdout: "staleid\n" };
    if (args.some((a) => String(a).startsWith("--hash="))) {
      return { status: 0, stdout: "postgres  HASH_CURRENT\n" };
    }
    return { status: 0, stdout: LABELS("plexco", composeFile, "HASH_OLD") };
  };
  assert.throws(
    () => resolveVerifiedContainerId("unix:///tmp/d.sock", runner),
    /older version of this compose configuration/,
  );
});

test("a container built with an override file is refused, even at the same service hash", () => {
  // Measured: an override remapping the pgdata volume produced the SAME postgres service hash, so
  // the hash check does not catch it. Membership ("contains the canonical file") is the same error
  // as substring matching, one level up -- the reset could land in another volume entirely.
  const argv = buildContainerIdArgv("unix:///tmp/d.sock");
  const canonical = argv[argv.indexOf("-f") + 1];
  assert.equal(assertContainerMatchesCompose(LABELS("plexco", canonical), "HASH_CURRENT"), true);
  assert.throws(
    () => assertContainerMatchesCompose(LABELS("plexco", `${canonical},/tmp/override.yml`), "HASH_CURRENT"),
    /exactly this one compose file/,
  );
  assert.throws(
    () => assertContainerMatchesCompose(LABELS("plexco", `/tmp/override.yml,${canonical}`), "HASH_CURRENT"),
    /exactly this one compose file/,
  );
});

// ---------------------------------------------------------------- the mount, which is the resource

const CONFIG = (volumeName) =>
  JSON.stringify({
    services: { postgres: { volumes: [{ source: "pgdata", target: "/var/lib/postgresql/data" }] } },
    volumes: { pgdata: { name: volumeName } },
  });
const MOUNTS = (volumeName) =>
  JSON.stringify([
    { Destination: "/docker-entrypoint-initdb.d", Name: "" },
    { Destination: "/var/lib/postgresql/data", Name: volumeName },
  ]);

test("a container on a different physical volume is refused, at an identical service hash", () => {
  // Measured on Compose v2.39: renaming volumes.pgdata.name changes the resolved physical volume
  // and leaves the postgres service hash byte-identical. Labels, hash and file set all still match,
  // so this is the check that catches it -- and it is the last one, because the volume is not a
  // description of the blast radius, it IS the blast radius.
  assert.equal(expectedDataVolume(CONFIG("plexco_pgdata")), "plexco_pgdata");
  assert.equal(assertContainerMountsExpectedVolume(MOUNTS("plexco_pgdata"), "plexco_pgdata"), true);
  assert.throws(
    () => assertContainerMountsExpectedVolume(MOUNTS("alternate_pgdata"), "plexco_pgdata"),
    /stores its data on volume/,
  );
});

test("a missing or unreadable mount refuses rather than passing", () => {
  assert.throws(
    () => assertContainerMountsExpectedVolume(JSON.stringify([{ Destination: "/elsewhere" }]), "v"),
    /no mount at/,
  );
  assert.throws(() => assertContainerMountsExpectedVolume("not json", "v"), /could not read/);
  assert.throws(() => expectedDataVolume("not json"), /resolved compose config/);
  assert.throws(
    () => expectedDataVolume(JSON.stringify({ services: { postgres: { volumes: [] } } })),
    /declares no volume at/,
  );
  assert.throws(
    () => expectedDataVolume(CONFIG(undefined)),
    /does not resolve a physical name/,
  );
});

test("the compose config is resolved through the same pinned endpoint, project and file", () => {
  const argv = buildComposeConfigArgv("unix:///tmp/d.sock");
  assert.equal(argv[0], "-H");
  assert.ok(argv.indexOf("-H") < argv.indexOf("compose"));
  assert.equal(argv[argv.indexOf("-p") + 1], "plexco");
  assert.ok(argv[argv.indexOf("-f") + 1].endsWith("/infra/docker-compose.yml"));
  assert.ok(argv.includes("--format") && argv.includes("json"));
});

// ---------------------------------------------------------------- worktree portability

test("the compose authority is the main worktree, not the running checkout", () => {
  // Every writing slice in this repository runs in a linked worktree, and the primary use case for
  // this command -- an unshipped migration being iterated on -- happens there. Resolving the
  // compose file from the running checkout rejected the shared container, because the service hash
  // includes the bind-mount source and that carries the checkout path.
  const linked = (_cmd, args) =>
    args.includes("--git-common-dir")
      ? { status: 0, stdout: "/repo/.git\n" }
      : { status: 1, stdout: "" };
  assert.equal(
    resolveComposeFile(linked, "/repo/.autopilot/worktrees/slice--v9/scripts"),
    "/repo/infra/docker-compose.yml",
    "a linked worktree must resolve the MAIN checkout's compose file",
  );

  // From the main checkout the answer is the same file. --path-format=absolute is requested so a
  // relative answer is never interpreted; anything non-absolute falls back rather than guessing.
  const main = (_cmd, args) =>
    args.includes("--git-common-dir") ? { status: 0, stdout: "/repo/.git\n" } : { status: 1, stdout: "" };
  assert.equal(resolveComposeFile(main, "/repo/scripts"), "/repo/infra/docker-compose.yml");

  const relative = () => ({ status: 0, stdout: ".git\n" });
  assert.equal(
    resolveComposeFile(relative, "/repo/scripts"),
    "/repo/infra/docker-compose.yml",
    "a non-absolute answer must fall back, not be resolved against a guess",
  );

  // Not a git checkout: fall back to this script's own tree rather than guessing.
  const nogit = () => ({ status: 128, stdout: "", error: new Error("not a repo") });
  assert.equal(resolveComposeFile(nogit, "/somewhere/scripts"), "/somewhere/infra/docker-compose.yml");
});

test("an opaque postgres URL is never echoed, even though its pathname looks like an identifier", () => {
  // `postgres:SENTINEL_PASSWORD` parses, and its pathname satisfies PLAIN_IDENTIFIER -- so the
  // safe-echo rule printed a secret. Identifier syntax proves TERMINAL safety, not that a value is
  // not a credential. Only a hierarchical postgres URL has a pathname that means "database".
  const pw = "SENTINEL_PASSWORD";
  for (const url of [`postgres:${pw}`, `postgresql:${pw}`, `postgres:${pw}@h/db`]) {
    assert.throws(
      () => crossCheckDatabaseUrl(url, "plexco_test"),
      (e) => {
        assert.ok(!e.message.includes(pw), `leaked for ${url.slice(0, 24)}`);
        assert.match(e.message, /value is not shown/);
        return true;
      },
    );
  }
  // A hierarchical URL still names the database, which is the useful half of the rule.
  assert.throws(
    () => crossCheckDatabaseUrl("postgres://host/other_test", "plexco_test"),
    /names database "other_test"/,
  );
});

// ---------------------------------------------------------------- structural, not per-site

test("EVERY child process is spawned with the neutralised environment", () => {
  // This is a source-level assertion on purpose. The rule "children must not inherit redirecting
  // variables" was already implemented and used at 7 of 8 spawn sites; the miss was a git probe
  // added in a later round, and GIT_DIR then redirected the compose authority that every other
  // guard derives from. Fixing that one call site would leave the NEXT new spawn free to repeat it.
  // Asserting the property over the whole file is what makes the rule structural instead of a
  // habit -- the same move as putting the identifier rule in one function.
  const src = readFileSync(fileURLToPath(new URL("./db-reset-test.mjs", import.meta.url)), "utf8");
  const lines = src.split("\n");
  const offenders = [];
  lines.forEach((line, i) => {
    if (!/\b(runner|spawnSync)\(/.test(line)) return;
    if (/function (childEnv|spawnSync)/.test(line)) return;
    const window = lines.slice(i, i + 8).join("\n");
    if (!/env:\s*childEnv\(\)/.test(window)) offenders.push(`${i + 1}: ${line.trim()}`);
  });
  assert.deepEqual(offenders, [], `spawn sites missing env: childEnv() ->\n${offenders.join("\n")}`);
  // Guard the guard: if the call shape changes and this finds nothing, the test is vacuous.
  const spawnCount = lines.filter((l) => /\b(runner|spawnSync)\(/.test(l)).length;
  assert.ok(spawnCount >= 7, `expected to find the spawn sites, found ${spawnCount}`);
});

test("git's redirecting variables are neutralised like docker's", () => {
  const env = childEnv({
    PATH: "/usr/bin",
    GIT_DIR: "/tmp/other/.git",
    GIT_WORK_TREE: "/tmp/other",
    GIT_COMMON_DIR: "/tmp/other/.git",
    GIT_CEILING_DIRECTORIES: "/tmp",
  });
  for (const k of ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_CEILING_DIRECTORIES"]) {
    assert.equal(env[k], undefined, `${k} must not reach the child`);
  }
  assert.equal(env.PATH, "/usr/bin");
});

// ---------------------------------------------------------------- last-round guards

test("there is no role override: DROP needs ownership, CREATE needs CREATEDB", () => {
  // PostgreSQL lets a database OWNER drop it, but CREATE DATABASE requires SUPERUSER or CREATEDB.
  // A NOCREATEDB owner passed every other guard, dropped the database, and could not recreate it --
  // destroying data with no way to restore it. The override bought nothing, so it is gone rather
  // than guarded by a capability probe that would be one more thing to keep correct.
  assert.deepEqual(parseArgs([]), { db: "plexco_test", user: "plexco" });
  assert.throws(() => parseArgs(["--user", "anyone"]), /unknown argument "--user"/);
  assert.throws(() => parseArgs(["--user=anyone"]), /unknown argument "--user"/);
  // The pinned role is still the compose service's POSTGRES_USER and still reaches psql as -U.
  const argv = buildResetArgv("plexco_test", "plexco", "unix:///tmp/d.sock", "cid");
  assert.equal(argv[argv.indexOf("-U") + 1], "plexco");
});

test("the recreated database is created from template0, not template1", () => {
  // A bare CREATE DATABASE clones template1, which on a long-lived developer cluster can carry
  // site-local objects -- including a stale schema_migrations. That would defeat the whole command:
  // the next run finds rows it did not write and the P17 guard fires again.
  const argv = buildResetArgv("plexco_test", "plexco", "unix:///tmp/d.sock", "cid");
  assert.ok(
    argv.includes('CREATE DATABASE "plexco_test" TEMPLATE template0'),
    "CREATE must name template0 explicitly",
  );
  for (const arg of argv) {
    assert.ok(!/CREATE DATABASE "[^"]+"$/.test(String(arg)), "no bare CREATE may survive");
  }
});

test("a flag name is echoed, a value is not", () => {
  assert.equal(safeArgEcho("--user"), '"--user"');
  assert.equal(safeArgEcho("--db"), '"--db"');
  assert.match(safeArgEcho("postgres://u:pw@h/d"), /not shown/);
  assert.match(safeArgEcho("-rf"), /not shown/);
});
