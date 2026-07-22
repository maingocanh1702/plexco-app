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
