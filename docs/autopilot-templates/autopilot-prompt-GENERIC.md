# Autopilot Prompt — Compact Send-File (v0.6.0)

<!-- v0.6.0 (2026-06, design-probe gate): new breaker 26 DESIGN_PROBE_REQUIRED — change-class touching NL classification / fuzzy match / parsing MUST, before Step 1, write the chosen mechanism to .autopilot/state/<slug>/design-probe.md + STOP for founder confirm; mechanism must score/filter via a FINITE pre-existing set (corpus vocab / allowlist / closed enum), NEVER a hand-maintained blocklist/stopword list of neutral words (a filler-word blocklist is the fail signal: every round finds a new word class → guaranteed REGION_THRASH; use membership not enumeration). §6 prompt-authoring now requires embedding this gate for NL/fuzzy slices (prose "do a probe" doesn't self-enforce). Mirrors autopilot-invariants.md "DESIGN-PROBE for NL/fuzzy = a GATE". Incident: advisor-topic-tfidf TOPIC_COVERAGE_STOPWORDS thrashed rounds 4-6. -->
<!-- v0.5.9 (2026-06, lesson-capture hygiene): Post-merge cleanup now has an explicit LESSON CAPTURE step — capture new operating lessons via `add-lesson.sh` (never a raw append). Live bullet ≤340 chars / 1-3 sentences with an (arch: <slug>) tag; verbose forensic detail → `add-lesson --arch <slug>` into the NON-imported incident-archive. add-lesson now BLOCKS over-long bullets and WARNS when autopilot-invariants.md nears the 40k @import limit (Claude Code TRUNCATES past it → rules silently dropped). A lesson that SUPERSEDES/reverses an earlier one must REPLACE/fold the old bullet — never leave a rule and its negation in an always-applied file (the READY !codex_active guard + START/TIẾP-TỤC bookend both piled up contradictory bullets). Mirrors autopilot-invariants.md header + the lesson-propagation memory. -->
<!-- v0.5.8 (2026-06, transient-corpse triage): per-round review classification is now 3-way and verdict-first — a tiny no-verdict round is NOT reflexively auth-death. Order: (1) QUOTA sentinel → CODEX_QUOTA; (2) strip connector-noise lines (rmcp|mcp|transport::worker|TokenRefreshFailed, incl. invalid_grant/Invalid refresh token/Client ID… ON those lines) THEN grep survivors → only a non-rmcp survivor = CODEX_UNAVAILABLE auth-death (logout/login); (3) DEFAULT TRANSIENT (connector-noise-only / empty corpse) → RE-RUN the same round ONCE (no logout/login); recurs → CODEX_UNAVAILABLE as a PERSISTENT CONNECTOR problem (fix mcp_servers='{}' / comment connectors / newer bin), NOT account relogin. Fixes the false CODEX_UNAVAILABLE auth-death HALT on rmcp-only corpses (mid-run grep previously did NOT strip rmcp before the sentinel match). Mirrors autopilot-invariants.md "Codex auth-death vs TRANSIENT corpse". -->
<!-- v0.5.7 (2026-06, review fixes): §6 round-budget wording aligned to MAX_ROUNDS>5 hard stop (no "15+/~8 rounds"); risk self-check "tier < P0" → "tier is not P0"; READY precond 5 dry-run merge now index-free `git merge-tree` against origin/<DEFAULT_BRANCH> (a `git merge <BRANCH>` while ON the feature branch is a no-op = false READY); verdict_present() regex hardcoded (was a placeholder) AND word-bounded so a naked `FAIL` no longer matches `Failed`/`TokenRefreshFailed` (which would falsely report a verdict and suppress the auth-death HALT); model_auth_dead sentinel now includes `invalid_grant|Invalid refresh token` (a genuine non-rmcp occurrence is fatal — rmcp noise is still stripped first). -->


<!-- v0.5.6 (2026-06, one-turn-finish): §B.5 Merge/READY gate — added ONE-TURN FINISH rule: once the last clean round + verify starts, drive through scope-gate ready + READY report in the SAME turn; never yield at "tests passed — next is scope-gate ready" (that strands the slice + forces a manual nudge). STOP_AT_READY = stop AFTER ready is marked, never before. -->

<!-- v0.5.5 (2026-06, watchdog/decision-latency): added AWAIT-FOUNDER sentinel — when pausing for a non-HALT, non-READY founder decision (e.g. "authorize R7?"), write .autopilot/state/<slug>/AWAIT-FOUNDER-<reason>.txt BEFORE printing the question so out-of-band monitors (ap-watch) ping the founder instantly instead of after a stall timeout. Pairs with watchdog: READY/HALT/AWAIT/MAX_ROUNDS(frc≥cap) alert immediately; CODEX-AUTH detected by round-file CONTENT not size; alerts carry elapsed-since-START. -->
<!-- v0.5.1 (2026-06, credit-on-merge batch): §0 pre-scan (single-source grep + refuse-vs-handle); breakers 23 SECOND_SOURCE / 24 TABLE_GAP / 25 STATE_CONSERVATION. Full lessons in autopilot-invariants.md Captured-lessons. -->
<!-- v0.5.2 (2026-06, gendered-fees-a5): Review loop PER-ROUND auth-fatal HALT + stall/timeout guard (Pre-flight smoke catches auth death only at START; mid-run auth death made the review HANG, not HALT). Reset = codex logout && login (not login alone). Auth death is usually a TRANSIENT OpenAI-side token event — NOT concurrency or quota (≥6 concurrent xhigh reviews observed fine); do not change setup, just re-login. — L18. -->
<!-- v0.5.4 (2026-06, backlog-staleness audit): Post-merge cleanup block now REQUIRES flipping the backlog task to `merged` + capturing any deferred follow-up as a backlog block — runtime cleanup frees INFLIGHT but the hand-maintained backlog rots ("ready" while merged → wasted re-run). Grep `git log` before spinning a worktree for a "ready" task. — L24/L25. -->
<!-- v0.5.3 (2026-06, gendered-fees-a4): Pre-flight smoke now VERDICT-FIRST (same rule as the review loop): an auth-string is fatal only when NO model verdict is present, and rmcp/MCP connector noise (TokenRefreshFailed/invalid_grant from rmcp::transport::worker) is stripped before the auth-fatal grep. Before this, smoke HALTed on any auth-string even with a verdict present, so each run wasted 3-4 self-correcting bash rounds before Step 0. — L18b. -->


> Canonical file to open/send when authoring an autopilot run.
> This is the low-token runtime version. Full historical rationale is archived at
> `reference/autopilot-prompt-GENERIC.full.md`; read it only when changing the
> framework or investigating a template failure.
>
> Always-loaded invariants live in `autopilot-invariants.md` (kept under the 40k @import limit; verbose
> incident detail lives in `reference/autopilot-invariants-incident-archive.md`, which is NOT auto-imported).
> This prompt repeats only the gates needed for a self-contained run.

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
6. If a choke-point risks REGION_THRASH, ask the founder to pick the approach BEFORE writing the prompt: Option A (patch-in-place — likely hits the MAX_ROUNDS `>5` hard stop and HALTs incomplete) vs Option B (decision-table / deterministic refactor first — designed to converge within the `>5` cap). State the trade-off; do not silently choose. (No option may exceed the cap — `>5` is a hard stop, not a budget to negotiate.) For an NL-classification / fuzzy-match / parsing change-class specifically, the slice MUST embed a **DESIGN_PROBE gate** (breaker 26): before Step 1, write the chosen mechanism to `.autopilot/state/<slug>/design-probe.md` + STOP for founder confirm; the mechanism must score/filter via a finite pre-existing set (corpus vocab / allowlist / closed enum), NEVER a hand-maintained blocklist of neutral words. A prose "do a probe first" line does not self-enforce — make it a STOP gate.
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
  find .git -maxdepth 1 -name '*.lock' 2>/dev/null   # MUST print nothing (zsh-safe: a bare `ls .git/*.lock` errors `no matches found` on NOMATCH)
  [if parallel/worktree repo — HARD GATE, also on RE-RUN/REUSE:]
    # REGISTER-FIRST: the FIRST INFLIGHT/state-changing action — run it as early as the clean/branch checks
    # allow, and for a REUSED worktree register BEFORE any rebase/setup. Registering (drop+append) RESETS a
    # stale block to a fresh `in-flight` — so a slice RE-RUN inherits NO leftover `ready` from a prior attempt
    # (else the watchdog reads that stale `ready` and fires a false READY on a frc=0 / 0-commit session).
    # RE-RUN/REUSE is NOT exempt: if the worktree already exists, still run register FIRST. It also writes the
    # in-flight entry the watchdog keys on → START fires at t=0.
    scripts/autopilot-scope-gate register --manifest docs/autopilot-manifests/<TASK_SLUG>.json
  <runtime activate>
  which <required tools>             # MUST resolve
  [if Codex review required:]
    CODEX="${AUTOPILOT_CODEX_BIN:?HALT: set AUTOPILOT_CODEX_BIN to review-capable codex}"
    [ -x "$CODEX" ] || { echo "HALT CODEX_UNAVAILABLE: non-executable AUTOPILOT_CODEX_BIN"; exit 1; }
    smoke="$("$CODEX" review --base <DEFAULT_BRANCH> 2>&1)"
    [ "$(printf '%s' "$smoke" | wc -c)" -gt 0 ] || { echo "HALT CODEX_UNAVAILABLE: 0 bytes/wrong binary"; exit 1; }
    # VERDICT-FIRST gate (mirror the review-loop, L18): an auth-string in the output is only fatal when there is
    # NO real model verdict. rmcp/MCP connector noise (TokenRefreshFailed / invalid_grant / Invalid refresh token
    # emitted by `rmcp::transport::worker`) is NOT codex model-auth death — it appears even on healthy reviews.
    # So: (1) decide if a real verdict is present; (2) strip rmcp connector lines before grepping for auth-fatal;
    # (3) HALT only when an auth-fatal sentinel survives AND no verdict is present.
    # verdict_present: naked PASS/FAIL/FULL MUST be word-bounded — an unbounded `FAIL` matches
    # `Failed to refresh token` / `TokenRefreshFailed` and falsely reports a verdict, suppressing the HALT.
    verdict_present() {
      printf '%s' "$1" | grep -qiE '(^|[[:space:]])(FULL|PASS|FAIL)([[:space:]:.-]|$)|No (issues|findings)|Findings?:|Severity:|verdict'
    }
    model_auth_dead() {
      printf '%s' "$1" | grep -viE "rmcp|mcp|transport::worker|TokenRefreshFailed" \
        | grep -qiE "access token could not be refreshed|token_invalidated|invalid_grant|Invalid refresh token|session has ended|Please log ?in again|Client ID and client secret are required|codex_models_manager.*401"
    }
    if model_auth_dead "$smoke" && ! verdict_present "$smoke"; then
      echo "HALT CODEX_UNAVAILABLE: model auth dead (no verdict; reset: \"$CODEX\" logout && \"$CODEX\" login)"; exit 1
    fi
    # auth-string WITH a verdict, or rmcp-only noise -> connector noise, NOT fatal -> continue.
    # Never fall back to PATH `codex`, manual review, or Claude/Task sub-agent review.
  [if Auto-merge requested: yes:]
    confirm `.autopilot/maturity-ledger.md` shows <CHANGE_CLASS> mature with >=3 clean merged unchanged runs and tier P2.
  <VERIFY_CMD>                       # MUST be green on current <DEFAULT_BRANCH>
  Risk self-check: if in-scope files touch auth/token/billing/funding/transactions/migration/secret and tier is not P0 -> POLICY_MISMATCH HALT (those surfaces are P0 = not autopilot at all).
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
    - Connector noise (`rmcp|mcp|transport::worker|TokenRefreshFailed`, INCLUDING `invalid_grant`/`Invalid refresh
      token`/`Client ID and client secret are required` emitted ON those lines) is NEVER fatal by itself — it shows
      up on healthy reviews too. ALWAYS strip those lines BEFORE any sentinel grep.
    - PER-ROUND TRIAGE (after EACH round; verdict-first; do NOT hang/retry-silently — L18). A round whose TAIL has a
      real model verdict = valid (connector noise ignored). A round with NO verdict → classify IN ORDER, do NOT
      reflexively HALT as auth-death:
        1. QUOTA: grep `You've hit your usage limit|Review was interrupted|usage limit|try again at` -> HALT
           CODEX_QUOTA (wait for the stated reset; no re-run).
        2. AUTH-DEATH: strip connector-noise lines, THEN grep the SURVIVORS for `token_invalidated | invalid_grant |
           Invalid refresh token | access token could not be refreshed | Please log ?in again | Client ID and client
           secret are required` (typically a `codex_models_manager ... 401` line). A sentinel SURVIVES the strip ->
           HALT CODEX_UNAVAILABLE (auth death) -> reset `"$CODEX" logout && "$CODEX" login`, resume SAME branch.
           (An `invalid_grant` ON an rmcp line is stripped -> does NOT count; only a non-rmcp survivor is auth death.)
        3. TRANSIENT (DEFAULT — a tiny corpse that is ONLY connector noise / empty, no surviving sentinel, no quota
           string): NOT auth death -> RE-RUN the SAME round ONCE (no logout/login). If the re-run ALSO corpses with no
           verdict -> THEN HALT CODEX_UNAVAILABLE, but as a PERSISTENT CONNECTOR problem (fix: add `-c mcp_servers='{}'`,
           comment the failing connectors in `~/.codex/config.toml`, or point `$CODEX` at a newer codex bin) — NOT an
           account relogin. The Pre-flight smoke grep only catches auth death at START; this per-round triage handles
           mid-run death so the loop never waits forever.
    - STALL GUARD: wrap each `"$CODEX" review` with a timeout (`timeout`/`gtimeout`); a round file that stops growing
      for ~N min OR ends a few KB with no verdict-line -> run the PER-ROUND TRIAGE above (TRANSIENT = re-run once
      before any HALT), never an infinite wait.
    - RESET on mid-run auth death (founder): `"$CODEX" logout && "$CODEX" login` (re-login ALONE leaves stale
      state -> "Client ID and client secret are required"), then resume the SAME branch (code intact). This is
      almost always enough — auth death is usually a TRANSIENT OpenAI-side token event (refresh-token chain
      expiry / server session reset), independent of how many sessions or apps are open. Do NOT assume it is
      concurrency or quota and do NOT change the setup: empirically ≥6 concurrent xhigh codex reviews run fine,
      and heavy xhigh ran all week without issue, with the Codex app + IDE open. A single auth-death event is not
      a pattern; only if it RECURS quickly is rotation-across-concurrent-clients worth investigating (then stagger).
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
    5. dry-run merge onto the CURRENT <DEFAULT_BRANCH> tip is conflict-free. Do NOT run `git merge <BRANCH>`
       while checked out ON <BRANCH> — that is a no-op ("Already up to date") and gives a FALSE READY.
       From a linked worktree (can't checkout the default), use the index-free in-memory merge:
         git fetch origin <DEFAULT_BRANCH>
         git merge-tree --write-tree origin/<DEFAULT_BRANCH> <BRANCH>   # nonzero exit or "CONFLICT" → not mergeable, HALT
       (or, only from the MAIN checkout: git checkout <DEFAULT_BRANCH> && git pull --ff-only origin <DEFAULT_BRANCH>
        && git merge --no-commit --no-ff <BRANCH>; git merge --abort; git checkout <BRANCH>)
    6. if scope-gate manifest used, mark ready before READY report:
       scripts/autopilot-scope-gate ready --manifest docs/autopilot-manifests/<TASK_SLUG>.json

  ONE-TURN FINISH (do NOT yield before READY):
    Once the LAST review round is clean and you START the verify (<VERIFY_CMD>),
    you MUST drive through to READY in the SAME assistant turn — run <VERIFY_CMD>,
    then (if green) preconditions 3-5, then `scope-gate ready` (precond 6), then
    emit the READY report, then stop. Do NOT end your turn at "tests passed — next
    is scope-gate ready" and wait for the human to say "continue": that strands the
    slice one mechanical step short of READY and forces a manual nudge. STOP_AT_READY
    means stop AFTER `scope-gate ready` has run and the READY report is printed —
    never before. The only legitimate mid-finish stops are a HALT/breaker or an
    AWAIT-FOUNDER decision file; a clean verify is not one of them. (A long verify
    churn is not a reason to checkpoint-and-yield — keep going.)

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
  26. DESIGN_PROBE_REQUIRED (change-class touches NL classification / fuzzy match / parsing AND, before Step 1, there is no `.autopilot/state/<slug>/design-probe.md` + founder confirm — OR the chosen mechanism is a hand-maintained blocklist/stopword list of neutral words instead of a finite pre-existing set / corpus-vocab / allowlist → HALT before coding. A filler-word blocklist is the fail signal: every round finds a new word class → guaranteed REGION_THRASH. Switch to membership, e.g. "ignore query terms absent from the corpus vocab" not "enumerate stopwords". If no bounded mechanism clearly beats the status quo → recommend dropping the change.)

On HALT — emit forensic report; do not clean up branch/worktree
  FIRST write the forensic to a FILE so out-of-band monitors can see the HALT (the TUI report alone is
  invisible to them): write the block below to `.autopilot/state/<TASK_SLUG>/HALT-<REASON>.txt`
  (e.g. HALT-REGION_THRASH.txt) BEFORE printing it. The <REASON> must be the circuit-breaker token.
  Leave the file in place (do not clean up) until the founder resolves the HALT.
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

On AWAIT-FOUNDER — pausing for a decision that is NOT a circuit-breaker HALT and NOT READY
  Any time you STOP and wait for a founder choice that isn't a hard HALT or the READY report
  (e.g. "authorize one more review round?", "re-slice or merge as-is?", any yes/no only the founder
  can answer): BEFORE printing the question, write a one-line file
  `.autopilot/state/<TASK_SLUG>/AWAIT-FOUNDER-<short-reason>.txt` whose first line IS the question.
  Out-of-band monitors alert on AWAIT* immediately (same as HALT*), so the founder is pinged the
  instant you pause — not after a stall timeout. `rm` the file when you resume after their answer
  (it is also auto-cleared on DONE). READY still uses the normal READY report, not this sentinel.

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
  Post-merge cleanup (REQUIRED — do not skip, or the registry + backlog go stale):
    scripts/autopilot-scope-gate cleanup --manifest <MANIFEST>   # release the INFLIGHT reservation
    git worktree remove <WORKTREE> ; git branch -d <BRANCH>
    FLIP THE BACKLOG (AUTOMATED): run `scripts/autopilot-backlog-reconcile --fix` on the default branch — it derives
      merged-status from CODE (each task's `merged_probe: <file> :: <regex>` symbol that only exists once merged) and
      flips stale `planned/ready/blocked` → `merged`. This replaces the error-prone hand-flip; the hand-maintained
      status field rots otherwise (a stale "ready" later wastes a session re-running merged work). Every task block
      MUST carry a `merged_probe:` (add it when you author the task; without it the reconcile can't auto-verify). The
      watchdog runs `--check` to alert on drift; before spinning a worktree for a "ready" task, run the reconcile (or
      grep `git log <DEFAULT_BRANCH>`) to confirm it is genuinely unmerged.
    If this slice DEFERRED any follow-up, add a backlog `## task:` block for it NOW (status planned + defer
      reason + depends_on), so it is tracked rather than lost in this report's prose.
    LESSON CAPTURE (if this run produced a new operating lesson) — use `add-lesson.sh`, NEVER a raw append:
      - Short rule (1-3 sentences, <=340 chars) → `add-lesson "<rule>  (arch: <slug>)"`. The live invariants file
        is @imported into every session and Claude Code TRUNCATES it past 40k chars (rules silently dropped);
        add-lesson BLOCKS over-long bullets and WARNS as the file nears the limit.
      - Verbose forensic detail → `add-lesson --arch <slug> "<full write-up>"` (lands in the NOT-imported
        `reference/autopilot-invariants-incident-archive.md`); leave the matching `(arch: <slug>)` tag on the live bullet.
      - If the lesson SUPERSEDES/reverses an earlier rule, REPLACE or fold the old bullet — never leave a rule and
        its negation in an always-applied file (newest verdict wins; archive the superseded write-up).

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
