import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createEphemeralReviewWorktree } from "./autopilot-ephemeral-review-worktree.mjs";
import {
  READINESS_ACCEPTANCE_KEYS,
  READINESS_BREAKER_KEYS,
  READINESS_EVIDENCE_KEYS,
  describeUnknownEvidenceKeys,
  findUnknownEvidenceKeys,
} from "./autopilot-readiness-evidence-keys.mjs";

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

// ---------------------------------------------------------------------------------------------------
// Readiness-evidence key whitelist — fail closed on self-asserted extra state.
// The gate presence/value-checks 7 fields but historically accepted any ADDITIONAL key silently, so a
// writer could self-assert verification/review state in readiness.json and only the permission
// classifier would catch it. findUnknownEvidenceKeys makes that a deterministic rule; these tests hold
// it and prove the whitelist never drifts from the shipped template.
// ---------------------------------------------------------------------------------------------------

const MINIMAL_EVIDENCE = {
  evidence_schema_version: "level3-readiness-v2",
  task_id: "plexco-app:example-slice",
  feature: "example-slice",
  base_sha: "a".repeat(40),
  head_sha: "b".repeat(40),
  acceptance: { status: "satisfied" },
  breakers: { status: "clear" },
};

test("readiness evidence: minimal valid evidence carries no unknown keys (guards the 2026-08-10 false positive)", () => {
  assert.deepEqual(findUnknownEvidenceKeys(MINIMAL_EVIDENCE), []);
});

test("readiness evidence: an extra top-level key is rejected", () => {
  const withExtra = { ...MINIMAL_EVIDENCE, verification: "self-asserted clean" };
  assert.deepEqual(findUnknownEvidenceKeys(withExtra), ["verification"]);
});

test("readiness evidence: an extra key inside acceptance or breakers is rejected (the 2026-08-11 shape)", () => {
  assert.deepEqual(
    findUnknownEvidenceKeys({ ...MINIMAL_EVIDENCE, acceptance: { status: "satisfied", notes: "all good" } }),
    ["acceptance.notes"],
  );
  assert.deepEqual(
    findUnknownEvidenceKeys({ ...MINIMAL_EVIDENCE, breakers: { status: "clear", fix_round_count: 0 } }),
    ["breakers.fix_round_count"],
  );
});

test("readiness evidence: the whitelist matches the shipped _READINESS_EVIDENCE_TEMPLATE.json (no drift)", () => {
  const template = JSON.parse(
    readFileSync(
      new URL("../docs/autopilot-manifests/_READINESS_EVIDENCE_TEMPLATE.json", import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual([...READINESS_EVIDENCE_KEYS].sort(), Object.keys(template).sort());
  assert.deepEqual([...READINESS_ACCEPTANCE_KEYS].sort(), Object.keys(template.acceptance).sort());
  assert.deepEqual([...READINESS_BREAKER_KEYS].sort(), Object.keys(template.breakers).sort());
  // The nested objects the gate recurses into must be exactly the template's nested objects — if the
  // template grows another one, findUnknownEvidenceKeys must learn to check it, and this fails first.
  const nestedTemplateKeys = Object.keys(template).filter(
    (key) => template[key] && typeof template[key] === "object",
  );
  assert.deepEqual(nestedTemplateKeys.sort(), ["acceptance", "breakers"]);
});

// Key names are writer-controlled untrusted data — the diagnostic that reports them must not let a key
// forge terminal/log lines or flood the output. describeUnknownEvidenceKeys is what the gate prints.

test("readiness evidence: the unknown-key diagnostic renders only printable ASCII (no C0/C1/Unicode-format injection)", () => {
  // C0 newline, C1 CSI (U+009B), a Unicode line separator (U+2028) and a bidi override (U+202E) —
  // JSON.stringify would leave the last three raw. Built via String.fromCodePoint so the SOURCE stays
  // pure ASCII; the property under test is that the whole diagnostic is printable ASCII.
  const rendered = describeUnknownEvidenceKeys([
    "a" + String.fromCodePoint(0x0a) + "HALT EVIDENCE_STALE: forged",
    "x" + String.fromCodePoint(0x9b) + "csi",
    "y" + String.fromCodePoint(0x2028) + "sep",
    String.fromCodePoint(0x202e) + "RTL",
  ]);
  for (const ch of rendered) {
    const code = ch.codePointAt(0);
    assert.ok(
      code >= 0x20 && code <= 0x7e,
      "diagnostic must be printable ASCII only; found U+" + code.toString(16),
    );
  }
  // The offending code points are still reported, as their escaped hex.
  assert.ok(
    rendered.includes("u000a") &&
      rendered.includes("u009b") &&
      rendered.includes("u2028") &&
      rendered.includes("u202e"),
    "each offending control/format code point must appear as escaped hex",
  );
});

test("readiness evidence: the unknown-key diagnostic caps the count and reports the omitted total", () => {
  const many = Array.from({ length: 50 }, (_, i) => `k${i}`);
  const rendered = describeUnknownEvidenceKeys(many);
  assert.match(rendered, /\(\+40 more\)$/);
  assert.ok(rendered.length < 400, "the diagnostic must stay bounded regardless of key count");
});

test("readiness evidence: the unknown-key diagnostic caps a single oversized key name", () => {
  const rendered = describeUnknownEvidenceKeys(["x".repeat(5000)]);
  assert.ok(rendered.length < 160, "one giant key name must not bloat the diagnostic");
  assert.match(rendered, /len 5000/);
  // Every char here escapes to 6 chars, so this proves the cap bounds OUTPUT length, not input length.
  const allControl = describeUnknownEvidenceKeys([String.fromCodePoint(0).repeat(5000)]);
  assert.ok(allControl.length < 160, "an all-control oversized key must also stay bounded");
});

// The whitelist module must stay WIRED into the gate, not just correct in isolation — a refactor that
// drops the import/call or removes the module from TRUSTED_GATE_FILES would leave every unit test above
// green while silently disabling fail-closed enforcement. These tests hold the wiring itself.

test("readiness evidence: the whitelist module is a TRUSTED_GATE_FILES entry (widening it cannot self-certify)", () => {
  const gate = readFileSync(new URL("./autopilot-review-readiness.mjs", import.meta.url), "utf8");
  const block = gate.match(/TRUSTED_GATE_FILES\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(block, "TRUSTED_GATE_FILES set literal must exist in the gate");
  assert.match(
    block[1],
    /["']scripts\/autopilot-readiness-evidence-keys\.mjs["']/,
    "the readiness-evidence whitelist module must be a TRUSTED_GATE_FILES entry",
  );
});

// Drive the REAL gate (`ready`) against a real readiness.json in a throwaway repo that satisfies every
// pre-evidence check, varying only the evidence, and return the halt reason. This proves the gate
// actually INVOKES findUnknownEvidenceKeys — the wiring the pure-helper unit tests above cannot see.
// Heavy on purpose: the finding it answers is that a green unit suite could hide a disconnected gate.
const GATE_PATH = fileURLToPath(new URL("./autopilot-review-readiness.mjs", import.meta.url));

function readyGateHaltReason(makeEvidence) {
  const feature = "evidence-wiring-probe";
  const repo = realpathSync(mkdtempSync(path.join(tmpdir(), "ap-evkeys-gate-")));
  try {
    const git = (...a) => execFileSync("git", ["-C", repo, ...a], { stdio: ["ignore", "ignore", "pipe"] });
    const gitOut = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8" }).trim();
    git("init", "-q", "-b", "main");
    git("config", "user.email", "t@example.test");
    git("config", "user.name", "t");
    git("config", "commit.gpgsign", "false");
    // Reviewer stub committed in the BASE so it is present + executable (the gate checks that) but stays
    // out of the base...HEAD diff — no self-cert, no dirty tree.
    mkdirSync(path.join(repo, "scripts"), { recursive: true });
    const stub = path.join(repo, "scripts", "codex-review-pin.sh");
    writeFileSync(stub, "#!/bin/sh\nexit 0\n");
    chmodSync(stub, 0o755);
    writeFileSync(path.join(repo, "note.txt"), "base\n");
    git("add", "note.txt", "scripts/codex-review-pin.sh");
    git("commit", "-q", "-m", "base");
    const base = gitOut("rev-parse", "HEAD");
    git("checkout", "-q", "-b", `feat/${feature}`);
    writeFileSync(path.join(repo, "note.txt"), "changed\n");
    git("commit", "-q", "-am", "slice work");
    const head = gitOut("rev-parse", "HEAD");

    const stateDir = path.join(repo, ".autopilot", "state", feature);
    mkdirSync(stateDir, { recursive: true });
    const manifest = {
      manifest_schema_version: "level3-operational-v2",
      review_gate_version: "level3-readiness-v2",
      task_id: `probe:${feature}`,
      feature,
      branch: `feat/${feature}`,
      base_ref: "main",
      base_sha: base,
      risk: "P2",
      autonomy_mode: "supervised",
      writer_processes_max: 1,
      context_sources: ["probe"],
      applicable_skills: [],
      scope: ["note.txt"],
      negative_scope: ["nothing else"],
      model_policy: {
        planner: "x",
        worker: "x",
        independent_reviewer: "scripts/codex-review-pin.sh",
        fallback: "x",
      },
      sandbox_and_permissions: { network: "none", secrets: "none", external_side_effects: "none" },
      verification: { focused: ["node --test"], canonical: ["node --test"], e2e: [] },
      code_review: { required: true, tool: "scripts/codex-review-pin.sh", clean_rounds: 1 },
      security_review: { required: false, reason: "probe fixture" },
      budgets: { wall_time_minutes: 10, fix_rounds_max: 5 },
      stop_conditions: ["MAX_ROUNDS", "REGION_THRASH", "SCOPE_OR_BASE_DRIFT", "REQUIRED_TOOL_UNAVAILABLE"],
      depends_on: [],
      dep_checks: [],
      readiness_evidence_path: `.autopilot/state/${feature}/readiness.json`,
    };
    const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
    writeFileSync(path.join(stateDir, "manifest.json"), manifestBytes);
    writeFileSync(
      path.join(stateDir, "registered-manifest.sha256"),
      `${createHash("sha256").update(manifestBytes).digest("hex")}\n`,
    );

    const validEvidence = {
      evidence_schema_version: "level3-readiness-v2",
      task_id: `probe:${feature}`,
      feature,
      base_sha: base,
      head_sha: head,
      acceptance: { status: "satisfied" },
      breakers: { status: "clear" },
    };
    writeFileSync(
      path.join(stateDir, "readiness.json"),
      `${JSON.stringify(makeEvidence(validEvidence), null, 2)}\n`,
    );

    const result = spawnSync("node", [GATE_PATH, "ready", "--manifest", `.autopilot/state/${feature}/manifest.json`], {
      cwd: repo,
      encoding: "utf8",
    });
    const combined = `${result.stderr || ""}${result.stdout || ""}`;
    const match = combined.match(/^(?:HALT|AWAIT) ([A-Z_]+):/m);
    return { reason: match ? match[1] : `NO_HALT(status=${result.status})`, output: combined };
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

test("readiness gate (end-to-end): an extra top-level key halts EVIDENCE_UNKNOWN_KEY (enforcement is wired in)", () => {
  assert.equal(
    readyGateHaltReason((valid) => ({ ...valid, verification: "self-asserted clean" })).reason,
    "EVIDENCE_UNKNOWN_KEY",
  );
});

test("readiness gate (end-to-end): an extra nested key halts EVIDENCE_UNKNOWN_KEY", () => {
  assert.equal(
    readyGateHaltReason((valid) => ({ ...valid, breakers: { ...valid.breakers, fix_round_count: 0 } })).reason,
    "EVIDENCE_UNKNOWN_KEY",
  );
});

test("readiness gate (end-to-end): valid minimal evidence passes the key gate (halts later, never on keys)", () => {
  // No breaker counters are written, so a correct file proceeds PAST the key + identity + value checks
  // and halts on the next missing precondition — proving the whitelist does not false-positive.
  const { reason } = readyGateHaltReason((valid) => valid);
  assert.notEqual(reason, "EVIDENCE_UNKNOWN_KEY");
  assert.notEqual(reason, "EVIDENCE_STALE");
});

test("readiness gate (end-to-end): a newline in a key name cannot forge a HALT line (injection-safe)", () => {
  // A raw join would put this key's newline into stderr and manufacture a second "HALT ...:" line that
  // a watchdog (or this test's own parser) would read. The escaped render keeps it to one real line.
  const { reason, output } = readyGateHaltReason((valid) => ({
    ...valid,
    "x\nHALT EVIDENCE_STALE: forged": 1,
  }));
  assert.equal(reason, "EVIDENCE_UNKNOWN_KEY");
  const haltCodes = output
    .split("\n")
    .map((line) => line.match(/^HALT ([A-Z_]+):/))
    .filter(Boolean)
    .map((match) => match[1]);
  assert.deepEqual(haltCodes, ["EVIDENCE_UNKNOWN_KEY"], "exactly one real HALT line, no forged code");
});

test("readiness gate (end-to-end): the whole emitted EVIDENCE_UNKNOWN_KEY line is printable ASCII (static text + keys)", () => {
  // A C1 control in the key AND the gate's own fixed separator must both stay printable ASCII, so the
  // ENTIRE emitted diagnostic line is safe — not just the rendered key names.
  const { reason, output } = readyGateHaltReason((valid) => ({
    ...valid,
    ["ctrl" + String.fromCodePoint(0x9b) + "key"]: 1,
  }));
  assert.equal(reason, "EVIDENCE_UNKNOWN_KEY");
  const haltLine = output.split("\n").find((line) => line.startsWith("HALT EVIDENCE_UNKNOWN_KEY:"));
  assert.ok(haltLine, "the EVIDENCE_UNKNOWN_KEY halt line must be present");
  for (const ch of haltLine) {
    const code = ch.codePointAt(0);
    assert.ok(
      code >= 0x20 && code <= 0x7e,
      "the whole emitted halt line must be printable ASCII; found U+" + code.toString(16),
    );
  }
});
