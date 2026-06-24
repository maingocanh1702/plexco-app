# Autopilot Prompt — Compact Send-File (v0.5.1)

<!-- v0.5.1 (2026-06, credit-on-merge batch): §0 pre-scan (single-source grep + refuse-vs-handle); breakers 23 SECOND_SOURCE / 24 TABLE_GAP / 25 STATE_CONSERVATION. Full lessons in autopilot-invariants.md Captured-lessons. -->


> Canonical file to open/send when authoring an autopilot run.
> This is the low-token runtime version. Full historical rationale is archived at
> `reference/autopilot-prompt-GENERIC.full.md`; read it only when changing the
> framework or investigating a template failure.
>
> Always-loaded invariants live in `autopilot-invariants.md`. This prompt repeats
> only the gates needed for a self-contained run.

---

## 0. Authoring Checklist

Before writing a new prompt:

1. SYNC-FIRST: list manifests, read `.autopilot/INFLIGHT.md`, read backlog, grep the feature/symbol across `docs/`.
2. Re-derive callers/interfaces/domain rules from the current `base_ref`, not memory or an old agent report.
3. Pick one risk tier: P0 = no codegen; P1 = manual_only + 2 clean; P2 = manual unless mature + explicit opt-in.
4. Keep scope cohesive and bounded: largest slice expected clean in <=2 fix rounds, ceiling about <=3 modules / ~300 LOC.
5. Choke-point / state-mutating slice → ~30' PRE-SCAN before codegen (front-load the diagnosis; cheaper than discovering it via HALTs):
   - Single-source scan: grep the base for an existing canonical helper for the value you need → CONSUME it (no 2nd source). Absent + ≥2 consumers → creating it is the slice's first deliverable. Long-lived branch → re-check the base before rebasing (the helper may have landed → else DESIGN_UNFIT, re-slice not rebase).
   - Choke-point scan: list functions mutating state from ≥2 sources → don't bundle them with clean paths.
   - Refuse-vs-handle UP FRONT: a large-combinatorial sub-case (merge/combine two state records across N×M states) → default fail-closed REFUSE in core + a separate tabled edge slice; handle inline only if the combo space is tiny.
   - Table-first: paste the full decision table before codegen; design-probe when reusing a primitive; after the FIRST thrash, write the table from `regions.log` instead of re-scoping again.
6. If a choke-point risks REGION_THRASH, ask the founder to pick the round-budget BEFORE writing the prompt: Option A (patch-in-place, may hit 15+ rounds) vs Option B (decision-table/deterministic refactor first, ~8 rounds). State the trade-off; do not silently choose.
7. Scale verification to risk (state/money-mutating → independent review; notice-only / genuinely-clean → quick diff-grep). Run mechanical multi-step git via the agent, not pasted prose+bash into a raw shell.

Placeholder convention:

- `<REPO_PATH>` absolute repo path.
- `<DEFAULT_BRANCH>` actual default branch, usually `main`.
- `<BRANCH>` feature branch.
- `<TASK_SLUG>` state dir slug.
- `<CHANGE_CLASS>` maturity ledger class.
- `<VERIFY_CMD>` full local verify command with CI-equivalent env.

---

## 1. Pasteable Prompt

```text
Task: <ONE-LINE OUTCOME> — <bugfix|feature|refactor|docs>

You are working in <REPO_PATH> on <ONE-LINE PRODUCT CONTEXT>.
NO prior conversation context. This prompt is self-contained.

Mode: AUTOPILOT — single feature branch `<BRANCH>`, inline review per risk header,
then STOP_AT_READY by default. Squash-merge ONLY if the Risk header explicitly
grants `Auto-merge requested: yes` and all merge gates pass. Pause only on named
circuit breakers.

Risk header (REQUIRED)
  Risk tier:          <P0 | P1 | P2>
  Change class:       <CHANGE_CLASS>
  Merge policy:       <manual_only | auto_merge_after_2x_codex_clean>
  Auto-merge requested: <yes | no>
  Autopilot maturity: <pilot (<3 clean READY runs merged unchanged for this class)
                       | mature (>=3 for this class, from .autopilot/maturity-ledger.md)>
  Codex review:       <not_applicable | 1x_clean | 2x_consecutive_clean>

  Policy:
   * P0 -> STOP. Do not codegen with autopilot; switch to manual workflow.
   * P1 -> merge_policy MUST be manual_only; requires 2 consecutive FULL-base clean Codex rounds.
   * P2 pilot -> manual_only; 1 FULL clean when Codex review=1x_clean; not_applicable only for low-risk classes.
   * P2 mature -> auto-merge allowed only when prompt opts in AND ledger shows mature AND 2 FULL clean rounds AND verify green AND clean tree.
   * Any contradiction -> POLICY_MISMATCH HALT before work.

Context (NOT for execution; 2-5 lines)
  Origin: <incident/ticket/decision>
  Root cause or goal: <short>
  Why now: <short>

Scope discipline
  Positive scope: ONLY <exact outcome/files/modules>.
  Negative scope: Do NOT touch <out-of-scope files/modules/branches>.
  Documented-out: <future work> lives at <doc/backlog>, do not start it here.
  Scope sizing: keep one risk tier; ceiling about <=3 modules / ~300 LOC; do not over-split cohesive low-risk work.

Design contract (REQUIRED for matcher/parser/router/auth/state/money/identity/choke-point changes)
  Reuse-scan first: search existing choke-point behavior before designing a new path.
  Decision table — every input class maps to one deterministic outcome, no silent fall-through:
    <input class A> -> <outcome>
    <input class B> -> <outcome>
    <else>          -> <existing/manual/fail-closed path>
  Data format pin: exact field/string/memo consumed or emitted, and which existing branch receives it.
  Invariants:
    - self-generated data uses deterministic id/code lookup, not fuzzy matching;
    - mirrored logic across >=2 adapters goes into shared core; adapters stay thin;
    - derived aggregate uses one canonical field/helper; no per-call-site formula;
    - money/data fail closed when safe/zero cannot be proven.

Required reading (after Pre-flight, before branch/code)
  1. `<path>` — focus: <symbol/section/line>
  2. `<path>` — tests/style
  3. `<path>` — docs/rules if relevant

Pre-flight gate (HARD GATE)
  cd <REPO_PATH>
  git status --short                 # MUST be clean
  git branch --show-current          # MUST be <DEFAULT_BRANCH>
  git fetch origin && git pull --ff-only origin <DEFAULT_BRANCH>
  ls .git/*.lock 2>/dev/null         # MUST be empty
  [if parallel/worktree repo:]
    scripts/autopilot-scope-gate register --manifest docs/autopilot-manifests/<TASK_SLUG>.json
  <runtime activate>
  which <required tools>             # MUST resolve
  [if Codex review required:]
    CODEX="${AUTOPILOT_CODEX_BIN:?HALT: set AUTOPILOT_CODEX_BIN to review-capable codex}"
    [ -x "$CODEX" ] || { echo "HALT CODEX_UNAVAILABLE: non-executable AUTOPILOT_CODEX_BIN"; exit 1; }
    smoke="$("$CODEX" review --base <DEFAULT_BRANCH> 2>&1)"
    printf '%s' "$smoke" | grep -qiE "access token could not be refreshed|Review was interrupted|token_invalidated|session has ended|Please log ?in again" \
      && { echo "HALT CODEX_UNAVAILABLE: model auth dead"; exit 1; }
    [ "$(printf '%s' "$smoke" | wc -c)" -gt 0 ] || { echo "HALT CODEX_UNAVAILABLE: 0 bytes/wrong binary"; exit 1; }
    # Never fall back to PATH `codex`, manual review, or Claude/Task sub-agent review.
  [if Auto-merge requested: yes:]
    confirm `.autopilot/maturity-ledger.md` shows <CHANGE_CLASS> mature with >=3 clean merged unchanged runs and tier P2.
  <VERIFY_CMD>                       # MUST be green on current <DEFAULT_BRANCH>
  Risk self-check: if in-scope files touch auth/token/billing/funding/transactions/migration/secret and tier < P0 -> POLICY_MISMATCH HALT.
  ALL must pass. If any fails -> HALT and report. Do not proceed.

Anti-patterns (NEVER)
  * `git push --force`.
  * `git add -A` or `git add .`; stage per file.
  * Touch out-of-scope files/modules/branches.
  * Add type-ignore/lint-ignore without founder approval.
  * Substitute `$CODEX review` with manual or same-model sub-agent review.
  * Count an unpersisted review; every counted round writes `.autopilot/state/<TASK_SLUG>/codex/round-NN.txt`.
  * Reach READY with uncommitted changes or a dirty tree.

Step 1 — create branch + state files
  git checkout -b <BRANCH>
  git rev-parse HEAD > /tmp/<TASK_SLUG>-base-sha.txt
  mkdir -p .autopilot/state/<TASK_SLUG>/codex
  : > .autopilot/state/<TASK_SLUG>/regions.log
  echo 0 > .autopilot/state/<TASK_SLUG>/fix-round-count.txt

[Required when reusing a choke-point primitive]
Step 0 — design-probe old primitive before production edits
  - Run the 2-3 hardest real cases against the existing primitive unchanged.
  - Record result in `.autopilot/state/<TASK_SLUG>/design-probe.md`.
  - If structurally unfit -> DESIGN_UNFIT HALT; do not implement on top of it.

[Optional when outcome is verifiable]
Step 2 — failing test first
  - Add focused regression test(s), with at least one production-shaped input.
  - Run tests-only command; they MUST fail on current <DEFAULT_BRANCH>.
  - If they pass unexpectedly -> TDD_ORACLE_VIOLATED HALT.

Step 3..N — implement atomically
  - Make the minimum scoped change.
  - Run relevant verify.
  - Stage per file and commit a logical change.
  - After every commit: branch must be <BRANCH>, HEAD must advance, tree must be clean unless the next scoped commit is immediate.

Review loop (include when Codex review is 1x_clean or 2x_consecutive_clean)
  Before round 1:
    git diff --stat <DEFAULT_BRANCH>...HEAD
    # Every file must be in declared scope; unexpected file -> SCOPE_DRIFT HALT.
  Round 1 FULL:
    "$CODEX" review --base <DEFAULT_BRANCH> 2>&1 | tee .autopilot/state/<TASK_SLUG>/codex/round-01.txt
    LAST_REVIEWED_SHA="$(git rev-parse HEAD)"
  Round validity:
    - Counts only if round-NN.txt exists, has no model-auth fatal, and ends with a real model verdict.
    - Skill preamble text such as "GitNexus / Review Output Format" is not a fake signal by itself.
    - rmcp/MCP TokenRefreshFailed noise is not fatal unless the model verdict is missing.
  Fix rounds:
    - Batch-fix all P0/P1, and P2 when in scope or money/data sensitive.
    - Append each finding `file:function` to regions.log.
    - Increment `.autopilot/state/<TASK_SLUG>/fix-round-count.txt` and echo it.
    - If counter >5 -> MAX_ROUNDS HALT.
    - If same file is flagged in >=3 consecutive rounds with distinct findings -> REGION_THRASH HALT.
    - Run <VERIFY_CMD>, commit fix, then review incrementally:
      "$CODEX" review --base $LAST_REVIEWED_SHA 2>&1 | tee .autopilot/state/<TASK_SLUG>/codex/round-NN.txt
      LAST_REVIEWED_SHA="$(git rev-parse HEAD)"
  Confirmation:
    - When incremental is clean, run FULL `--base <DEFAULT_BRANCH>` again.
    - Required clean target:
      P1: 2 consecutive FULL-base clean rounds on current HEAD.
      P2 pilot with 1x_clean: 1 FULL-base clean round.
      P2 mature auto-merge: 2 consecutive FULL-base clean rounds on current HEAD.
    - Any finding in FULL confirmation starts a fix round.

Merge / READY gate
  Preconditions for READY or COMPLETE:
    1. <VERIFY_CMD> green.
    2. Codex target met, or Codex review=not_applicable.
    3. branch has >=1 commit ahead of <DEFAULT_BRANCH>.
    4. working tree clean; all scoped fixes committed.
    5. dry-run merge from fresh <DEFAULT_BRANCH> succeeds:
       git merge --no-commit --no-ff <BRANCH> && git merge --abort
    6. if scope-gate manifest used, mark ready before READY report:
       scripts/autopilot-scope-gate ready --manifest docs/autopilot-manifests/<TASK_SLUG>.json

  Default STOP_AT_READY:
    P1 and P2 pilot always stop at READY_FOR_MANUAL_MERGE.
    P2 mature also stops unless Auto-merge requested=yes and all auto-merge gates hold.

  Squash block (ONLY when explicitly authorized):
    git checkout <DEFAULT_BRANCH>
    git pull --ff-only origin <DEFAULT_BRANCH>
    git merge --no-commit --no-ff <BRANCH> && git merge --abort
    git merge --squash <BRANCH>
    git commit -m "<type>(<scope>): <title>

    <body: what changed, why, Codex validation, test count, next steps>"
    git push origin <DEFAULT_BRANCH>
    git branch -D <BRANCH>
    # If push rejected -> PUSH_REJECTED HALT. Never force-push.

Circuit breakers (HALT on any)
  1. PREFLIGHT_REGRESSION
  2. PUSH_REJECTED
  3. TDD_ORACLE_VIOLATED
  4. VERIFY_REGRESSION
  5. ARCH_FINDING
  6. SECURITY_FINDING
  7. RECURRING_FINDING
  8. TYPE_IGNORE_PROPOSED
  9. MAX_ROUNDS
  10. TOOL_ERROR_2X
  11. CONTEXT_BUDGET_70
  12. POLICY_MISMATCH
  13. WRONG_BRANCH_HEAD
  14. MERGE_GATE_FAIL
  15. STALE_REVIEW
  16. REGION_THRASH
  17. CODEX_UNAVAILABLE
  18. SCOPE_DRIFT
  19. DESIGN_UNFIT
  20. SCOPE_COLLISION
  21. DEP_MISSING
  22. INVARIANT_UNKNOWN
  23. SECOND_SOURCE        (real/derived value re-derived inline instead of the canonical single-source helper)
  24. TABLE_GAP           (a reachable input combo not in the decision table → fix the TABLE, not patch code)
  25. STATE_CONSERVATION  (Σ value/ledger in != out across the op; or auto-destructive on uncertainty — auto-refund/auto-delete/assert-unknown-amount)

On HALT — emit forensic report; do not clean up branch/worktree
  HALT — <TASK_SLUG> circuit broken.
  Step/Round:
  Trigger:
  Branch:
  HEAD:
  Detail:
  State:
    - commits since base
    - files changed
    - Codex artifacts
    - last verify
  Requesting founder input on:

Final report — emit exactly one variant

  Variant A — READY (default)
  AUTOPILOT <TASK_SLUG> — READY_FOR_MANUAL_MERGE
  Change class: <CHANGE_CLASS> (ledger: <n>/3 clean -> pilot|mature)
  Branch <BRANCH>: still exists
  Push origin/<DEFAULT_BRANCH>: NOT RUN
  Files changed:
  Codex review:
    Rounds:
    Final clean target:
    Artifacts: .autopilot/state/<TASK_SLUG>/codex/round-*.txt
  Artifact-verify:
    - last clean round files:
    - paste final verdict line from each:
    - grep auth-fatal over round files MUST be empty:
    - review base SHA and HEAD reviewed match current HEAD:
  Local verification:
  Decisions needing founder review:
  Post-merge smoke checklist:
  Suggested merge:
    git checkout <DEFAULT_BRANCH>
    git pull --ff-only origin <DEFAULT_BRANCH>
    git merge --squash <BRANCH>
    git commit -m "<type>(<scope>): <title>"
    git push origin <DEFAULT_BRANCH>

  Variant B — COMPLETE (only when authorized squash block ran)
  AUTOPILOT <TASK_SLUG> — COMPLETE
  Squash commit:
  Branch <BRANCH>: DELETED
  Push origin/<DEFAULT_BRANCH>: OK
  Ledger:

Begin with Pre-flight, then Step 1.
```

---

## 2. When To Open The Full Archive

Open `reference/autopilot-prompt-GENERIC.full.md` only when:

- changing the framework itself;
- investigating why a compact rule exists;
- reconstructing an old incident or version lineage;
- needing the long merge-train script or mega/multi-phase variant.
