import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The process-level tests of docs/sessions/web-mvp-phase5-readiness-p5-db-tls-ca-required.md (section 5,
// P1-P8): the boot check and the worker, provision and migrate start paths, each spawned as the image
// starts it (apps/bot's tsx, cwd apps/bot) with an env built from scratch, never a copy of process.env.
// No test reaches a database: the remote URL names a placeholder host, and every refusal comes first.

const BOT = new URL("../../../apps/bot/", import.meta.url);
const TSX = fileURLToPath(new URL("node_modules/.bin/tsx", BOT));
const CHECK = "../../packages/db/src/pg-ssl-boot-check.ts";
const HOST = "db.example.invalid";
const MARKER = "pw-marker-l89";
const REMOTE = `postgres://app:${MARKER}@${HOST}:25060/plexco?sslmode=require`;
const LOOPBACK = `postgres://app:${MARKER}@127.0.0.1:5432/plexco`;
const PROD = { NODE_ENV: "production" };

function start(script: string, names: Record<string, string>) {
  const r = spawnSync(TSX, [script], {
    cwd: BOT,
    encoding: "utf8",
    timeout: 20_000,
    env: {
      PATH: process.env.PATH,
      ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}),
      ...names,
    },
  });
  expect(r.error).toBeUndefined();
  return r;
}

function expectNoLeak(r: { stdout: string; stderr: string }) {
  for (const leak of [HOST, MARKER, REMOTE]) expect(r.stdout + r.stderr).not.toContain(leak);
}

describe("pg-ssl-boot-check: web and discovery refuse at boot, before next start", () => {
  it.each([
    ["P1 production web with a remote DATABASE_URL and no CA refuses", { DATABASE_URL: REMOTE }],
    [
      "P2 production discovery with a remote DISCOVERY_DATABASE_URL and no CA refuses",
      { DISCOVERY_DATABASE_URL: REMOTE },
    ],
    [
      "P3 a loopback DATABASE_URL does not hide a remote DISCOVERY_DATABASE_URL",
      { DATABASE_URL: LOOPBACK, DISCOVERY_DATABASE_URL: REMOTE },
    ],
  ])("%s", (_name, names) => {
    const r = start(CHECK, { ...PROD, ...names });
    expect(r.status).toBe(1);
    // One line: the tag and the helper's own message, which names the variable.
    expect(r.stderr).toMatch(/^\[pg-ssl-boot-check\] DATABASE_CA_CERT [^\n]+\n$/);
    expect(r.stdout).toBe("");
    expectNoLeak(r);
  });

  it.each([
    [
      "P4 production with loopback URLs only starts",
      { ...PROD, DATABASE_URL: LOOPBACK, DISCOVERY_DATABASE_URL: LOOPBACK },
    ],
    [
      "P4 development with remote URLs starts as today",
      { NODE_ENV: "development", DATABASE_URL: REMOTE, DISCOVERY_DATABASE_URL: REMOTE },
    ],
  ])("%s", (_name, names) => {
    const r = start(CHECK, names);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
    expect(r.stdout).toBe("");
  });

  it("P5 the boot check calls the helper and holds no copy of the rule and no constructor", () => {
    const src = readFileSync(new URL("./pg-ssl-boot-check.ts", import.meta.url), "utf8");
    expect(src).toContain("pgSslConnectionConfig(");
    for (const copy of ['"production"', "localhost", "127.", "::1"])
      expect(src).not.toContain(copy);
    expect(src).not.toMatch(/\bnew\b/);
  });
});

// The roles that read their DB URL at start need no boot check: the helper refuses there first.
// A missing refusal would still exit 1 (on DNS), so the stderr content is the assertion.
describe("pg-ssl-boot-check: worker, provision and migrate already refuse at start", () => {
  it.each([
    [
      "P6 the worker refuses before preflight",
      "src/worker.ts",
      "DATABASE_URL_DIRECT",
      "[worker] fatal",
      "[preflight] passed",
    ],
    [
      "P7 provision refuses before any queue",
      "src/provision-queue.ts",
      "DATABASE_URL_MIGRATION",
      "[provision-queue] failed",
      "provisioned",
    ],
    [
      "P8 migrate refuses before any migration",
      "../../packages/db/src/migrate.ts",
      "DATABASE_URL_MIGRATION",
      "[migrate] failed:",
      "[migrate] applied=",
    ],
  ])("%s", (_name, script, name, tag, done) => {
    const r = start(script, { ...PROD, [name]: REMOTE });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(tag);
    expect(r.stderr).toContain("DATABASE_CA_CERT");
    expect(r.stdout).not.toContain(done);
    expectNoLeak(r);
  });
});
