import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Process-level proof of the boot fail-closed: the REAL Next CLI entry, with PLEXCO_DEV_LOGIN in the
 * environment, exits non-zero with the dev-login message before compiling or listening.
 *
 * Covered here: the config-load refusal (assertDevLoginBootSafe), which writes nothing. Not run here:
 * `NODE_ENV=development next build` with the flag, refused by the webpack production-compile guard —
 * that run starts a real build and would clean a developer's live .next, so it is unit-tested
 * (env-policy.test.ts) and was measured by hand (exit 1, "[dev-login] refusing a production
 * compilation ...").
 */
const webRoot = fileURLToPath(new URL("../..", import.meta.url));
const nextBin = path.join(webRoot, "node_modules/next/dist/bin/next");
const distDir = path.join(webRoot, ".next");

function snapshotDist(): string {
  if (!existsSync(distDir)) return "absent";
  return readdirSync(distDir)
    .map((entry) => `${entry}:${statSync(path.join(distDir, entry)).mtimeMs}`)
    .sort()
    .join("|");
}

function runNext(args: string[], env: Record<string, string>) {
  return spawnSync(process.execPath, [nextBin, ...args], {
    cwd: webRoot,
    // A clean environment: no inherited NODE_ENV (vitest sets "test"), so each command applies
    // Next's own default (production for build/start) unless the case sets one.
    // Cast: Next's types make NODE_ENV required on ProcessEnv, and leaving it out is the point.
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      NEXT_TELEMETRY_DISABLED: "1",
      ...env,
    } as unknown as NodeJS.ProcessEnv,
    encoding: "utf8",
    timeout: 90_000,
  });
}

const REFUSAL =
  /\[dev-login\] PLEXCO_DEV_LOGIN is set while NODE_ENV is "(production|test)" — refusing to start/;

describe("boot refusal through the real `next` entry", () => {
  it.each([
    ["next build", ["build"], { PLEXCO_DEV_LOGIN: "1" }],
    ["next build (flag present but EMPTY)", ["build"], { PLEXCO_DEV_LOGIN: "" }],
    ["next start", ["start", "-p", "3399"], { PLEXCO_DEV_LOGIN: "1" }],
    ["next start (flag present but EMPTY)", ["start", "-p", "3399"], { PLEXCO_DEV_LOGIN: "" }],
    [
      "next dev under NODE_ENV=production",
      ["dev", "-p", "3398"],
      { PLEXCO_DEV_LOGIN: "1", NODE_ENV: "production" },
    ],
    [
      "next dev under NODE_ENV=test",
      ["dev", "-p", "3398"],
      { PLEXCO_DEV_LOGIN: "1", NODE_ENV: "test" },
    ],
  ])(
    "%s exits non-zero with the dev-login message and writes nothing",
    (_, args, env) => {
      const before = snapshotDist();
      const run = runNext(args, env);
      expect(run.error).toBeUndefined();
      expect(run.status).not.toBe(0);
      expect(`${run.stdout}\n${run.stderr}`).toMatch(REFUSAL);
      expect(snapshotDist()).toBe(before);
    },
    120_000,
  );
});
