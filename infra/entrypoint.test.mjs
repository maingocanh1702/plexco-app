// node --test infra/entrypoint.test.mjs  (needs /bin/sh and wc only: no real pnpm, database, docker or network)
// Runs the real entrypoint under /bin/sh (dash on CI and in the image) with a stub `pnpm` first on PATH, the role
// in PROCESS_ROLE (the App Specs' channel) and a fake DATABASE_URL_MIGRATION, then checks the exit status and the
// calls the stub logged.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { URL, fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("./entrypoint.sh", import.meta.url));
const FAKE = "postgres://fake@fake-host.invalid:5432/fake";
const RUNNER = "--filter @plexco/bot --fail-if-no-match exec tsx ../../packages/db/src/migrate.ts url=fake";
const PROVISION = "--filter @plexco/bot --fail-if-no-match provision:queue url=fake";

// Joined lines, not a template literal: the stub itself contains "${".
const STUB = [
  "#!/bin/sh",
  "# Stub pnpm: one log line per call (its argv, and whether DATABASE_URL_MIGRATION is the fake value; never the",
  "# value itself), then exits with STUB_RC_<call index>, default 0. The log file must exist (empty) before call 1.",
  'n=$(( $(wc -l < "$STUB_LOG") + 1 ))',
  'case "$n" in',
  '  1) rc="${STUB_RC_1:-0}" ;;',
  '  2) rc="${STUB_RC_2:-0}" ;;',
  "  *) rc=0 ;;",
  "esac",
  'if [ "${DATABASE_URL_MIGRATION:-}" = "$STUB_FAKE_URL" ]; then url=fake; else url=other; fi',
  'printf \'%s url=%s\\n\' "$*" "$url" >> "$STUB_LOG"',
  'exit "$rc"',
  "",
].join("\n");

// One temp dir per run for the stub and its log, removed afterwards. The child env is built here, never copied
// from process.env: the stub dir first on PATH, then fixed system dirs, so no real pnpm can be reached.
function run(role, codes) {
  const dir = mkdtempSync(path.join(tmpdir(), "entrypoint-"));
  try {
    const stub = path.join(dir, "pnpm");
    const log = path.join(dir, "calls.log");
    writeFileSync(stub, STUB);
    chmodSync(stub, 0o755);
    writeFileSync(log, "");
    const r = spawnSync("/bin/sh", [SCRIPT], {
      encoding: "utf8",
      env: {
        PATH: `${dir}:/usr/bin:/bin`,
        PROCESS_ROLE: role,
        DATABASE_URL_MIGRATION: FAKE,
        STUB_FAKE_URL: FAKE,
        STUB_LOG: log,
        ...codes,
      },
    });
    const calls = readFileSync(log, "utf8").split("\n").filter(Boolean);
    return { ...r, calls };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Every case: the exit status, the logged calls in order, the start line alone on stdout, and the fake
// credential in neither stream. Returns stderr for the case's own check.
function expectRun(role, codes, status, calls) {
  const r = run(role, codes);
  assert.equal(r.status, status);
  assert.deepEqual(r.calls, calls);
  assert.equal(r.stdout, `[entrypoint] starting role=${role}\n`);
  assert.ok(!r.stdout.includes(FAKE) && !r.stderr.includes(FAKE), "the fake credential reached a stream");
  return r.stderr;
}

test("T1 migrate: the migrations, then the queues with --fail-if-no-match, both with the credential", () => {
  assert.equal(expectRun("migrate", {}, 0, [RUNNER, PROVISION]), "");
});

// Codes 3 and 4, never 1: the script's status must be the failing call's own, not the unknown-role exit 1.
test("T2 migrate, the migrations fail: their own code, and provision is never called", () => {
  assert.equal(expectRun("migrate", { STUB_RC_1: "3" }, 3, [RUNNER]), "");
});

test("T3 migrate, provision fails after the migrations: provision's own code", () => {
  assert.equal(expectRun("migrate", { STUB_RC_2: "4" }, 4, [RUNNER, PROVISION]), "");
});

test("T4 provision role: unchanged, one call with its base argv and no --fail-if-no-match", () => {
  assert.equal(expectRun("provision", {}, 0, ["--filter @plexco/bot provision:queue url=fake"]), "");
});

test("T5 unknown role: exit 1, no call, stderr names the role and the five valid ones", () => {
  const stderr = expectRun("nope", {}, 1, []);
  assert.match(stderr, /: nope \(web\|discovery\|worker\|provision\|migrate\)/);
});
