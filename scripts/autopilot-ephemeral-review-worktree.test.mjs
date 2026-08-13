import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createEphemeralReviewWorktree } from "./autopilot-ephemeral-review-worktree.mjs";

// Build a throwaway repo that mimics a FEATURE worktree: a committed tree, PLUS a gitignored
// .autopilot/state/<feature>/pending-review-finding.json — the exact contamination vector the fix
// isolates. Returns the repo root, its HEAD, and the pointer path.
function makeFeatureWorktree() {
  const root = mkdtempSync(path.join(tmpdir(), "ap-review-feat-"));
  const git = (...a) => execFileSync("git", ["-C", root, ...a], { stdio: ["ignore", "ignore", "pipe"] });
  const gitOut = (...a) => execFileSync("git", ["-C", root, ...a], { encoding: "utf8" }).trim();
  git("init", "-q");
  git("config", "user.email", "t@example.test");
  git("config", "user.name", "t");
  git("config", "commit.gpgsign", "false");
  writeFileSync(path.join(root, ".gitignore"), ".autopilot/\n");
  writeFileSync(path.join(root, "tracked.txt"), "source under review\n");
  git("add", ".gitignore", "tracked.txt");
  git("commit", "-q", "-m", "init");
  const head = gitOut("rev-parse", "HEAD");
  // The vector: gitignored prior-round state living inside the feature worktree.
  const stateDir = path.join(root, ".autopilot", "state", "feat");
  mkdirSync(stateDir, { recursive: true });
  const pointer = path.join(stateDir, "pending-review-finding.json");
  writeFileSync(pointer, '{"round":1,"artifact":"gate-attempt-01-code-review-round-01.txt"}\n');
  return { root, head, pointer };
}

// The acceptance test the owner mandated: assert FILE REACHABILITY directly, never "codex returned
// CLEAN". Deterministic (pure git + fs, no reviewer). Passes only for the right reason — because a
// clean checkout genuinely excludes gitignored state while including the tracked tree at HEAD.
test("reviewer worktree cannot reach pending-review-finding.json; the gate still can", () => {
  const feat = makeFeatureWorktree();
  const wt = createEphemeralReviewWorktree(feat.root, feat.head);
  try {
    // 1) UNREACHABLE to the reviewer: the pointer and the whole .autopilot/state tree are absent.
    assert.equal(
      existsSync(path.join(wt.path, ".autopilot", "state", "feat", "pending-review-finding.json")),
      false,
      "the reviewer's tree must not contain the prior-round pointer",
    );
    assert.equal(
      existsSync(path.join(wt.path, ".autopilot", "state")),
      false,
      "the reviewer's tree must not contain .autopilot/state at all",
    );
    // 2) STILL A VALID REVIEW TARGET: tracked source present, HEAD identical, diff resolvable.
    assert.equal(existsSync(path.join(wt.path, "tracked.txt")), true, "tracked source must be present");
    assert.equal(
      execFileSync("git", ["-C", wt.path, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      feat.head,
      "the reviewer worktree must be at the reviewed HEAD",
    );
    // 3) The GATE still reaches the pointer in the feature worktree (enforcement input preserved).
    assert.equal(existsSync(feat.pointer), true, "the gate must still reach the pointer in the feature worktree");
  } finally {
    wt.cleanup();
    rmSync(feat.root, { recursive: true, force: true });
  }
});

test("cleanup removes the ephemeral worktree and is idempotent", () => {
  const feat = makeFeatureWorktree();
  const wt = createEphemeralReviewWorktree(feat.root, feat.head);
  assert.equal(existsSync(wt.path), true);
  wt.cleanup();
  assert.equal(existsSync(wt.path), false, "cleanup must remove the worktree directory");
  wt.cleanup(); // idempotent — must not throw
  rmSync(feat.root, { recursive: true, force: true });
});

test("a failed worktree creation cleans up its temp dir (no leak)", () => {
  const feat = makeFeatureWorktree();
  const before = readdirSync(tmpdir()).filter((n) => n.startsWith("ap-review-wt-")).length;
  // An unresolvable HEAD makes `git worktree add` throw AFTER mkdtempSync created the temp dir; the
  // helper's transactional cleanup must remove it, so no ap-review-wt-* dir is left behind.
  assert.throws(() => createEphemeralReviewWorktree(feat.root, "0".repeat(40)));
  const after = readdirSync(tmpdir()).filter((n) => n.startsWith("ap-review-wt-")).length;
  assert.equal(after, before, "a failed creation must leave no ap-review-wt-* temp dir behind");
  rmSync(feat.root, { recursive: true, force: true });
});

test("the gate protects the isolation helper as a trusted gate file (no helper-only self-cert bypass)", () => {
  const gate = readFileSync(new URL("./autopilot-review-readiness.mjs", import.meta.url), "utf8");
  const block = gate.match(/TRUSTED_GATE_FILES\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(block, "TRUSTED_GATE_FILES set literal must exist in the gate");
  assert.match(
    block[1],
    /["']scripts\/autopilot-ephemeral-review-worktree\.mjs["']/,
    "the isolation helper must be a TRUSTED_GATE_FILES entry so a helper-only change cannot self-certify",
  );
});
