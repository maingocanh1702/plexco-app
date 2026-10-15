import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  FORBIDDEN_FLAG,
  findDevLoginFlagLeaks,
  isGuardedPath,
  listCandidateFiles,
} from "./check-dev-login-exclusion.mjs";

const SCRIPT = fileURLToPath(new URL("./check-dev-login-exclusion.mjs", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

function fixture(files) {
  const root = mkdtempSync(path.join(tmpdir(), "dev-login-guard-"));
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), content);
  }
  return root;
}

const PLANTED = {
  "infra/fly.toml": `[env]\n  ${FORBIDDEN_FLAG} = "1"\n`,
  "infra/docker-compose.yml": `services:\n  web:\n    environment:\n      ${FORBIDDEN_FLAG}: "1"\n`,
  ".github/workflows/deploy.yml": `env:\n  FOO: bar\n  ${FORBIDDEN_FLAG}: 1\n`,
  ".do/app.yaml": `envs:\n- key: ${FORBIDDEN_FLAG}\n  value: "1"\n`,
  "deploy/app-staging.yml": `x: ${FORBIDDEN_FLAG}\n`,
  Dockerfile: `FROM node:22\nENV ${FORBIDDEN_FLAG}=1\n`,
  "apps/bot/Dockerfile.worker": `ARG ${FORBIDDEN_FLAG}\n`,
};
// The flag is LEGITIMATE in these: app code, docs and the local env template are not deploy config.
const ALLOWED = {
  "README.md": `${FORBIDDEN_FLAG}=1 pnpm --filter @plexco/web exec next dev\n`,
  ".env.example": `# ${FORBIDDEN_FLAG}=1\n`,
  "apps/web/lib/dev-login/env-policy.mjs": `export const F = "${FORBIDDEN_FLAG}";\n`,
  "docs/deploy.md": `${FORBIDDEN_FLAG}\n`,
  "infra-notes/x.yml": `${FORBIDDEN_FLAG}\n`,
};

test("the forbidden literal is the dev-login flag", () => {
  assert.equal(FORBIDDEN_FLAG, "PLEXCO" + "_DEV_LOGIN");
});

test("isGuardedPath: exactly infra/**, .github/workflows/**, app*.y[a]ml, Dockerfile*, minus the guard", () => {
  for (const file of Object.keys(PLANTED)) assert.equal(isGuardedPath(file), true, file);
  for (const file of Object.keys(ALLOWED)) assert.equal(isGuardedPath(file), false, file);
  assert.equal(isGuardedPath("scripts/check-dev-login-exclusion.mjs"), false);
  assert.equal(isGuardedPath("scripts/check-dev-login-exclusion.test.mjs"), false);
  assert.equal(isGuardedPath("infra/postgres-init/01-job-definer.sql"), true);
});

test("a planted occurrence in every guarded location is found, with its line", () => {
  const root = fixture({ ...PLANTED, ...ALLOWED });
  try {
    const hits = findDevLoginFlagLeaks(root);
    assert.deepEqual(hits.map((hit) => hit.file).sort(), Object.keys(PLANTED).sort());
    assert.deepEqual(
      hits.find((hit) => hit.file === ".github/workflows/deploy.yml"),
      {
        file: ".github/workflows/deploy.yml",
        line: 3,
      },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a clean tree has no hits (the flag outside deploy/CI config is fine)", () => {
  const root = fixture({ "infra/fly.toml": '[env]\n  PROCESS_ROLE = "web"\n', ...ALLOWED });
  try {
    assert.deepEqual(findDevLoginFlagLeaks(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the git listing path finds a committed occurrence too", () => {
  const root = fixture({ "infra/Dockerfile": `ENV ${FORBIDDEN_FLAG}=1\n` });
  try {
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["add", "."], { cwd: root });
    // A file that only the walk would see proves the git listing is the one in use.
    mkdirSync(path.join(root, "node_modules/x"), { recursive: true });
    writeFileSync(path.join(root, ".gitignore"), "ignored/\n");
    mkdirSync(path.join(root, "ignored/infra"), { recursive: true });
    writeFileSync(path.join(root, "ignored/infra/Dockerfile"), `ENV ${FORBIDDEN_FLAG}=1\n`);
    assert.deepEqual(listCandidateFiles(root).sort(), [".gitignore", "infra/Dockerfile"]);
    assert.deepEqual(findDevLoginFlagLeaks(root), [{ file: "infra/Dockerfile", line: 1 }]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI: exit 1 on a planted tree, printing path:line; exit 0 on a clean tree", () => {
  const planted = fixture(PLANTED);
  const clean = fixture(ALLOWED);
  try {
    const bad = spawnSync(process.execPath, [SCRIPT, "--root", planted], { encoding: "utf8" });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /infra\/fly\.toml:2/);
    assert.match(bad.stderr, /Dockerfile:2/);
    const good = spawnSync(process.execPath, [SCRIPT, "--root", clean], { encoding: "utf8" });
    assert.equal(good.status, 0, good.stderr);
  } finally {
    rmSync(planted, { recursive: true, force: true });
    rmSync(clean, { recursive: true, force: true });
  }
});

test("this repository is clean right now (the same run CI's verify performs)", () => {
  const run = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8", cwd: REPO_ROOT });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /guard:dev-login: clean/);
});
