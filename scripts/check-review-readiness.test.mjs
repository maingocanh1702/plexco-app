import assert from "node:assert/strict";
import process from "node:process";
import test from "node:test";

import {
  REVIEW_POLICY_VERSION,
  validatePolicyWiring,
  validateReviewDocument,
} from "./check-review-readiness.mjs";

const FULL_SHA = "a".repeat(40);

function block(overrides = {}) {
  const fields = {
    REVIEW_POLICY_VERSION,
    REVIEW_VERDICT: "NOT_CODE_READY",
    REVIEWED_AT: "2026-07-22",
    AUTHORITY_SHA: FULL_SHA,
    BASE_BRANCH: "main",
    TARGET_FILES: "\n  - docs/example.md",
    SLICE: "review-validator-core",
    IN_SCOPE: "canonical verdict parsing and validation",
    OUT_OF_SCOPE: "runtime code and schema",
    G1_DECISION: "PASS",
    G2_SPEC: "PASS",
    G3_DEPENDENCY: "PASS",
    G4_TEST: "FAIL",
    G5_SCOPE: "PASS",
    G6_EXTERNAL: "PASS",
    HARD_DEPENDENCIES: "none",
    PRIOR_SLICES: "none",
    OPEN_QUESTIONS_IN_SCOPE: "0",
    ENABLEMENT_ONLY_GATES: "none",
    LIVE_REPO_VERIFICATION: "PASS",
    CONTRACT_MATRIX: "PASS",
    CLOSURE_MATRIX: "FAIL",
    ACCEPTANCE_MATRIX: "FAIL",
    SECURITY_AND_MIGRATION_GATE: "PASS",
    IMPLEMENTATION_ARTIFACTS: "FAIL",
    FIRST_IMPLEMENTATION_STEP: "blocked pending validator tests",
    REMAINING_BLOCKERS:
      "\n  - blocker: validator tests are absent\n    owner: repository tooling\n    resolution: tests pass in CI",
    NEXT_REVIEW_TRIGGER: "validator test commit on main",
    ...overrides,
  };

  return Object.entries(fields)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
}

const CODE_READY_OVERRIDES = {
  REVIEW_VERDICT: "CODE_READY",
  G4_TEST: "PASS",
  CLOSURE_MATRIX: "PASS (12/12)",
  ACCEPTANCE_MATRIX: "PASS",
  IMPLEMENTATION_ARTIFACTS: "PASS",
  FIRST_IMPLEMENTATION_STEP: "run the validator implementation slice",
  REMAINING_BLOCKERS: "none",
  NEXT_REVIEW_TRIGGER: "implementation merged",
};

// Overrides that leave each verdict otherwise valid, so a SECURITY_AND_MIGRATION_GATE
// assertion is never masked by an unrelated verdict-shape error.
const VERDICT_FIXTURES = {
  PLAN_READY: { REVIEW_VERDICT: "PLAN_READY" },
  CODE_READY: CODE_READY_OVERRIDES,
  NOT_PLAN_READY: { REVIEW_VERDICT: "NOT_PLAN_READY" },
  NOT_CODE_READY: { REVIEW_VERDICT: "NOT_CODE_READY" },
};

const NA_REASON =
  "NOT_APPLICABLE  # program-control document: no migration, no security surface";

function document(verdictBlock, directive = "enforce", prefix = "") {
  return `<!-- review-readiness: ${directive} -->\n# Example\n${prefix}\n\`\`\`text\n${verdictBlock}\n\`\`\`\n`;
}

function errorsFor(content, file = "docs/example-readiness.md") {
  return validateReviewDocument({
    file,
    content,
    repoRoot: process.cwd(),
    gitCheck: false,
    checkPaths: false,
  }).errors;
}

test("accepts a complete fail-closed NOT_CODE_READY verdict", () => {
  assert.deepEqual(errorsFor(document(block())), []);
});

test("keeps agent instructions, package scripts, Claude hook, CI, and PR wiring synchronized", () => {
  assert.deepEqual(validatePolicyWiring(process.cwd()), []);
});

test("rejects a candidate review document without classification", () => {
  const errors = errorsFor("# Review findings\n", "docs/new-review.md");
  assert.ok(errors.some((error) => error.code === "DIRECTIVE_MISSING"));
});

test("allows an explicitly classified historical artifact", () => {
  assert.deepEqual(
    errorsFor(
      "<!-- review-readiness: historical -->\n# Old review\n",
      "docs/old-review.md",
    ),
    [],
  );
});

test("rejects short authority SHAs", () => {
  const errors = errorsFor(document(block({ AUTHORITY_SHA: "abc1234" })));
  assert.ok(errors.some((error) => error.code === "AUTHORITY_SHA"));
});

test("rejects wildcard target paths", () => {
  const errors = errorsFor(
    document(block({ TARGET_FILES: "\n  - docs/**/*.md" })),
  );
  assert.ok(errors.some((error) => error.code === "TARGET_FILES_GLOB"));
});

test("rejects stale policy versions", () => {
  const errors = errorsFor(
    document(block({ REVIEW_POLICY_VERSION: "1.1" })),
  );
  assert.ok(errors.some((error) => error.code === "POLICY_VERSION"));
});

test("rejects CODE_READY when any strict gate is not PASS", () => {
  const errors = errorsFor(
    document(
      block({
        REVIEW_VERDICT: "CODE_READY",
        G4_TEST: "PARTIAL",
        CLOSURE_MATRIX: "PASS",
        ACCEPTANCE_MATRIX: "PASS",
        IMPLEMENTATION_ARTIFACTS: "PASS",
        FIRST_IMPLEMENTATION_STEP: "run the validator implementation slice",
        REMAINING_BLOCKERS: "none",
        NEXT_REVIEW_TRIGGER: "implementation merged",
      }),
    ),
  );
  assert.ok(errors.some((error) => error.code === "CODE_READY_GATE"));
});

test("accepts strict CODE_READY only with all gates and 12/12 closure PASS", () => {
  const errors = errorsFor(
    document(
      block({
        REVIEW_VERDICT: "CODE_READY",
        G4_TEST: "PASS",
        CLOSURE_MATRIX: "PASS (12/12)",
        ACCEPTANCE_MATRIX: "PASS",
        IMPLEMENTATION_ARTIFACTS: "PASS",
        FIRST_IMPLEMENTATION_STEP: "run the validator implementation slice",
        REMAINING_BLOCKERS: "none",
        NEXT_REVIEW_TRIGGER: "implementation merged",
      }),
    ),
  );
  assert.deepEqual(errors, []);
});

test("rejects a final code-ready plan whose active verdict is not CODE_READY", () => {
  const errors = errorsFor(document(block(), "code-ready"));
  assert.ok(errors.some((error) => error.code === "PLAN_NOT_CODE_READY"));
});

test("accepts a final code-ready plan only after strict CODE_READY closure", () => {
  const errors = errorsFor(
    document(
      block({
        REVIEW_VERDICT: "CODE_READY",
        G4_TEST: "PASS",
        CLOSURE_MATRIX: "PASS (12/12)",
        ACCEPTANCE_MATRIX: "PASS",
        IMPLEMENTATION_ARTIFACTS: "PASS",
        FIRST_IMPLEMENTATION_STEP: "open the bounded implementation worktree",
        REMAINING_BLOCKERS: "none",
        NEXT_REVIEW_TRIGGER: "implementation merged",
      }),
      "code-ready",
    ),
  );
  assert.deepEqual(errors, []);
});

test("requires structured blockers and a next trigger for NOT_* verdicts", () => {
  const errors = errorsFor(
    document(
      block({
        REMAINING_BLOCKERS: "missing validator",
        NEXT_REVIEW_TRIGGER: "",
      }),
    ),
  );
  assert.ok(errors.some((error) => error.code === "FAIL_BLOCKERS"));
  assert.ok(errors.some((error) => error.code === "NEXT_REVIEW_TRIGGER"));
});

test("skips an explicitly historical block inside an enforced tracker", () => {
  const content = `<!-- review-readiness: enforce -->
# Tracker
<!-- review-verdict: historical -->
\`\`\`text
REVIEW_VERDICT: CODE_READY
AUTHORITY_SHA: short
\`\`\`

## Active
\`\`\`text
${block()}
\`\`\`
`;
  const result = validateReviewDocument({
    file: "docs/slice-readiness-verdicts.md",
    content,
    repoRoot: process.cwd(),
    gitCheck: false,
    checkPaths: false,
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.activeBlocks, 1);
});

test("accepts SECURITY_AND_MIGRATION_GATE NOT_APPLICABLE with a reason on PLAN_READY", () => {
  const errors = errorsFor(
    document(
      block({
        ...VERDICT_FIXTURES.PLAN_READY,
        SECURITY_AND_MIGRATION_GATE: NA_REASON,
      }),
    ),
  );
  assert.deepEqual(errors, []);
});

test("rejects SECURITY_AND_MIGRATION_GATE NOT_APPLICABLE without a reason", () => {
  for (const raw of ["NOT_APPLICABLE", "NOT_APPLICABLE  #", "NOT_APPLICABLE  #   "]) {
    const errors = errorsFor(
      document(
        block({
          ...VERDICT_FIXTURES.PLAN_READY,
          SECURITY_AND_MIGRATION_GATE: raw,
        }),
      ),
    );
    const reasonError = errors.find(
      (error) => error.code === "SECURITY_GATE_NOT_APPLICABLE_REASON",
    );
    assert.ok(reasonError, `expected a missing-reason error for ${JSON.stringify(raw)}`);
    assert.match(reasonError.message, /requires a reason on the same line/);
    // The verdict is PLAN_READY, so the reason is the only thing wrong.
    assert.deepEqual(
      errors.map((error) => error.code),
      ["SECURITY_GATE_NOT_APPLICABLE_REASON"],
    );
  }
});

test("rejects SECURITY_AND_MIGRATION_GATE NOT_APPLICABLE on a non-PLAN_READY verdict", () => {
  for (const verdict of ["CODE_READY", "NOT_PLAN_READY", "NOT_CODE_READY"]) {
    const errors = errorsFor(
      document(
        block({
          ...VERDICT_FIXTURES[verdict],
          SECURITY_AND_MIGRATION_GATE: NA_REASON,
        }),
      ),
    );
    const verdictError = errors.find(
      (error) => error.code === "SECURITY_GATE_NOT_APPLICABLE_VERDICT",
    );
    assert.ok(verdictError, `expected a verdict error for ${verdict}`);
    assert.match(verdictError.message, /allowed only on a PLAN_READY verdict/);
    assert.ok(verdictError.message.includes(verdict));
    // The reason is present, so the verdict is the only NOT_APPLICABLE complaint.
    assert.equal(
      errors.filter((error) => error.code === "SECURITY_GATE_NOT_APPLICABLE_REASON")
        .length,
      0,
    );
  }
});

test("leaves SECURITY_AND_MIGRATION_GATE PASS/PARTIAL/FAIL unchanged on every verdict", () => {
  for (const [verdict, overrides] of Object.entries(VERDICT_FIXTURES)) {
    for (const gate of ["PASS", "PARTIAL", "FAIL"]) {
      const errors = errorsFor(
        document(
          block({ ...overrides, SECURITY_AND_MIGRATION_GATE: gate }),
        ),
      );
      assert.equal(
        errors.filter((error) =>
          error.code.startsWith("SECURITY_GATE_NOT_APPLICABLE"),
        ).length,
        0,
        `${verdict}/${gate} must not raise a NOT_APPLICABLE error`,
      );
      assert.equal(
        errors.filter(
          (error) =>
            error.code === "ENUM" &&
            error.message.startsWith("SECURITY_AND_MIGRATION_GATE"),
        ).length,
        0,
        `${verdict}/${gate} must remain a valid enum member`,
      );

      const codeReadyGate = errors.filter(
        (error) =>
          error.code === "CODE_READY_GATE" &&
          error.message.includes("SECURITY_AND_MIGRATION_GATE"),
      ).length;
      if (verdict === "CODE_READY" && gate !== "PASS") {
        assert.equal(codeReadyGate, 1, `CODE_READY/${gate} must still fail the strict gate`);
      } else {
        assert.deepEqual(errors, [], `${verdict}/${gate} must validate clean`);
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Audit 2026-09-06 X-1: AUTHORITY pins were checked against the literal ref "main". A
// pull_request / feat/** checkout on CI has refs/remotes/origin/main and NO local main, and git
// does not DWIM merge-base's "main" onto origin/main — so every pinned verdict failed
// AUTHORITY_NOT_MAIN off-main. These tests build throwaway repos with node built-ins only.
// ---------------------------------------------------------------------------
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveMainRef } from "./check-review-readiness.mjs";

function git(cwd, ...args) {
  return execFileSync("git", ["--no-optional-locks", ...args], { cwd, stdio: "pipe" })
    .toString()
    .trim();
}

function makeRepoWithOneCommit() {
  const dir = mkdtempSync(join(tmpdir(), "rr-main-ref-"));
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "t@t");
  git(dir, "config", "user.name", "t");
  writeFileSync(join(dir, "f"), "x\n");
  git(dir, "add", "f");
  git(dir, "commit", "-q", "-m", "base");
  return { dir, sha: git(dir, "rev-parse", "HEAD") };
}

function reviewDoc(sha) {
  return document(block({ AUTHORITY_SHA: sha }));
}

test("resolveMainRef prefers refs/remotes/origin/main when no local main exists (the PR / feat/** checkout shape)", () => {
  const { dir, sha } = makeRepoWithOneCommit();
  try {
    // simulate actions/checkout on a PR: detached HEAD, origin/main present, local main gone
    git(dir, "update-ref", "refs/remotes/origin/main", sha);
    git(dir, "checkout", "-q", "--detach", sha);
    git(dir, "branch", "-D", "main");
    assert.throws(() => git(dir, "rev-parse", "--verify", "--quiet", "refs/heads/main^{commit}"));
    assert.equal(resolveMainRef(dir), "refs/remotes/origin/main");
    const { errors } = validateReviewDocument({
      file: "docs/example.md",
      content: reviewDoc(sha),
      repoRoot: dir,
      gitCheck: true,
      checkPaths: false,
    });
    assert.deepEqual(
      errors.filter((e) => e.code === "AUTHORITY_NOT_MAIN" || e.code === "MAIN_REF_UNRESOLVABLE"),
      [],
      `unexpected main-ref errors: ${JSON.stringify(errors)}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveMainRef falls back to a local main when there is no remote-tracking ref (the push-to-main checkout shape)", () => {
  const { dir } = makeRepoWithOneCommit();
  try {
    assert.equal(resolveMainRef(dir), "refs/heads/main");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a checkout with NEITHER ref reports MAIN_REF_UNRESOLVABLE — a named error, never a silent pass or a misleading AUTHORITY_NOT_MAIN", () => {
  const { dir, sha } = makeRepoWithOneCommit();
  try {
    git(dir, "checkout", "-q", "-b", "feat/x");
    git(dir, "branch", "-D", "main");
    assert.equal(resolveMainRef(dir), null);
    const { errors } = validateReviewDocument({
      file: "docs/example.md",
      content: reviewDoc(sha),
      repoRoot: dir,
      gitCheck: true,
      checkPaths: false,
    });
    assert.ok(errors.some((e) => e.code === "MAIN_REF_UNRESOLVABLE"), JSON.stringify(errors));
    assert.ok(!errors.some((e) => e.code === "AUTHORITY_NOT_MAIN"), JSON.stringify(errors));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a SHA that is on origin/main's history but not an ancestor of it still fails AUTHORITY_NOT_MAIN (the resolver did not weaken the check)", () => {
  const { dir, sha: base } = makeRepoWithOneCommit();
  try {
    git(dir, "update-ref", "refs/remotes/origin/main", base);
    git(dir, "checkout", "-q", "-b", "feat/y");
    writeFileSync(join(dir, "g"), "y\n");
    git(dir, "add", "g");
    git(dir, "commit", "-q", "-m", "not on main");
    const off = git(dir, "rev-parse", "HEAD");
    git(dir, "branch", "-D", "main");
    const { errors } = validateReviewDocument({
      file: "docs/example.md",
      content: reviewDoc(off),
      repoRoot: dir,
      gitCheck: true,
      checkPaths: false,
    });
    assert.ok(errors.some((e) => e.code === "AUTHORITY_NOT_MAIN"), JSON.stringify(errors));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
