#!/usr/bin/env node
/**
 * guard:dev-login — fail if the local-only dev-login switch is wired into anything that deploys or
 * runs in CI. Dev login (apps/web/lib/dev-login) must exist only under `next dev` on a developer
 * machine; the moment its flag appears in deploy or CI configuration, a deployed or CI process
 * could be started with it. The boot refusal in next.config.mjs would stop such a process, but
 * this guard keeps the flag from ever being committed there in the first place.
 *
 * Scanned (repo-relative, every file git tracks or would track, else a filesystem walk):
 *   infra/**, .github/workflows/**, any app*.yaml / app*.yml, any Dockerfile*
 * The guard's own files are excluded. The flag name is assembled at runtime so neither this file
 * nor the CI text has to contain it verbatim.
 *
 * Wired into `pnpm -w test` (root package.json `test`), which CI's `verify` job runs. Exit 0 = clean,
 * 1 = at least one hit (each printed as path:line), 2 = the scan itself failed.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/** The literal this guard forbids, assembled so this source never contains it verbatim. */
export const FORBIDDEN_FLAG = ["PLEXCO", "DEV", "LOGIN"].join("_");

const SELF = new Set([
  "scripts/check-dev-login-exclusion.mjs",
  "scripts/check-dev-login-exclusion.test.mjs",
]);
const SKIP_DIRS = new Set([".git", "node_modules", ".next", ".autopilot", ".pnpm-store"]);

/** true when a repo-relative POSIX path is one the guard must scan. */
export function isGuardedPath(relativePath) {
  if (SELF.has(relativePath)) return false;
  const base = relativePath.split("/").pop() ?? "";
  return (
    relativePath.startsWith("infra/") ||
    relativePath.startsWith(".github/workflows/") ||
    /^app.*\.ya?ml$/i.test(base) ||
    /^dockerfile/i.test(base)
  );
}

function walk(root, dir = root) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory())
      return SKIP_DIRS.has(entry.name) ? [] : walk(root, path.join(dir, entry.name));
    return entry.isFile()
      ? [path.relative(root, path.join(dir, entry.name)).split(path.sep).join("/")]
      : [];
  });
}

/** Tracked + untracked-not-ignored files when root is a git checkout, else every file on disk. */
export function listCandidateFiles(root) {
  try {
    const out = execFileSync(
      "git",
      ["-C", root, "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        maxBuffer: 64 * 1024 * 1024,
      },
    );
    // `git -C <subdir>` would list the enclosing repo's files relative to the subdir; insist the
    // root IS the top level so a fixture directory inside this repo is walked on its own.
    const top = execFileSync("git", ["-C", root, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (realpathSync(top) === realpathSync(root)) return out.split("\0").filter(Boolean);
  } catch {
    // not a git checkout: fall through to the walk
  }
  return walk(root);
}

/** Every occurrence of the forbidden flag in guarded files, as { file, line }. */
export function findDevLoginFlagLeaks(root, files = listCandidateFiles(root)) {
  const hits = [];
  for (const file of files) {
    if (!isGuardedPath(file)) continue;
    let text;
    try {
      text = readFileSync(path.join(root, file), "utf8");
    } catch {
      continue; // listed by git but deleted in the working tree
    }
    text.split(/\r?\n/).forEach((line, index) => {
      if (line.includes(FORBIDDEN_FLAG)) hits.push({ file, line: index + 1 });
    });
  }
  return hits;
}

function main() {
  // `--root <dir>` exists for the tests' planted fixture trees; CI runs it with no argument.
  const rootFlag = process.argv.indexOf("--root");
  const root =
    rootFlag > -1 && process.argv[rootFlag + 1]
      ? path.resolve(process.argv[rootFlag + 1])
      : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  let hits;
  try {
    hits = findDevLoginFlagLeaks(root);
  } catch (error) {
    console.error(
      `guard:dev-login: scan failed: ${error instanceof Error ? error.message : error}`,
    );
    process.exit(2);
  }
  if (hits.length > 0) {
    console.error(
      `guard:dev-login: the local-only dev-login flag must never appear in deploy or CI config ` +
        `(infra/**, .github/workflows/**, app*.y[a]ml, Dockerfile*). Found:`,
    );
    for (const hit of hits) console.error(`  ${hit.file}:${hit.line}`);
    process.exit(1);
  }
  console.log(
    "guard:dev-login: clean (no dev-login flag in infra/, workflows, app specs or Dockerfiles)",
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
