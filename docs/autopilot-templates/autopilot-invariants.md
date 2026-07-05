# Autopilot operating invariants — ALWAYS APPLY (all projects)

> Auto-loaded into every Claude Code session via `~/.claude/CLAUDE.md` (@import). These are the
> non-negotiable rules distilled from incidents. Full rationale: `autopilot-prompt-GENERIC.md`.
> When running ANY autopilot/feature task, apply these even if the per-task prompt doesn't repeat them.

## Merge / authority
- Default **STOP_AT_READY**. **P0** → don't codegen with autopilot. **P1** → manual_only, NEVER auto-merge.
  P2 auto-merge only if class is `mature` (≥3 in ledger) AND prompt opts in explicitly.
- NEVER `git push --force`. NEVER touch out-of-scope files/modules/branches. NEVER `git add -A` (stage per-file).

## Review gate
- Cross-model review = **`$CODEX` (AUTOPILOT_CODEX_BIN) ONLY**. NEVER substitute a Claude/Task sub-agent.
- A round counts only if it wrote `round-NN.txt` AND ends with a real model verdict (no auth-fatal). P1 = 2 FULL clean.

## Loop control — counters are FILES, not prose (incident: a run hit 12 rounds)
- **Step 1 MUST create** `.autopilot/state/<task>/regions.log` and `fix-round-count.txt`.
- Each fix round: append finding `file:function` to regions.log, increment the counter, echo it.
- `fix-round-count > 5` → **MAX_ROUNDS HALT** — a HARD stop, not advisory. The round loop MUST exit at >5 even
  if findings are still "real" and distinct; do NOT "just one more round" (incident: credit-autoapply ran to 8).
- Same file flagged ≥3 consecutive rounds → **REGION_THRASH HALT**.
- Thrash = a DESIGN smell → **converge to a clean design, do NOT keep patching edges**.
- **Distinct findings that keep SPREADING across many files/regions round after round** (not the same region) =
  the SLICE is too big / under-specified, not thrash → still HALT at MAX_ROUNDS and **split the feature**, don't grind on.
- **The "clean round" bar is CLASS-AWARE, not one bar for every finding.** P0/P1 on a money-path / RLS / PII /
  auth-privilege surface → keep the strict bar: converge to ZERO open findings, 2 consecutive FULL-base clean
  rounds, no relaxation, ever. P2 (style/edge-case) findings confined to NL-parsing / formatting / other
  non-security surfaces → gate on "no OPEN P0/P1 AND no NEW P1+ for 2 consecutive rounds"; a lingering P2 there
  does NOT block merge — file it to `docs/autopilot-backlog.md` as a tracked item instead. Never extend the
  relaxed P2 gate to an auth/money/RLS/PII finding — those stay at the strict bar regardless of how the
  reviewer labels severity. (decided 2026-07-05, phase1-fable5 resume: the S4b/S2c NL-parsing P2 tail was
  cascade-blocking the whole dependency DAG over edge-case severity that didn't warrant it, while the same
  leniency must never extend to auth findings — see DECISIONS.md.)

## Design contract (choke-points & derived data)
- **Single source of truth for a derived aggregate** (money totals, counts, balances): one canonical field +
  one helper; every consumer reads it. NEVER re-derive per call site with its own formula (that's the #1 thrash source).
- **Self-generated data → deterministic key** (id/code), exact lookup — fuzzy only for arbitrary human input.
- **Mirrored logic across ≥2 transports/adapters → extract one shared core**; adapters stay thin.
- Touching a matcher/parser/router/choke-point primitive: **reuse-scan** first, then a **decision-table** with no
  silent fall-through; if reusing a primitive, **design-probe** the hardest cases against it first (unfit → HALT).
- Money/data: **fail-closed** — "can't prove it's 0/safe" → block, never silently treat as 0.
- **State (money/credit/identity) mutated across MANY code paths** (markPaid + deposit + merge + refund +
  host-exempt + transports…) → pin a decision-table per interaction AND **split into core + edge slices UP FRONT**.
  A monolith touching one state across N flows makes review surface a new distinct edge every round (credit-autoapply: 8 rounds, 12 files).

## Scope & parallelism
- Scope is a **ceiling** (~≤3 modules / ~300 LOC), not a target; don't over-split cohesive low-risk work.
- Parallel sessions = **one git worktree per feature** (never two writers in one tree) + Pre-flight
  `scripts/autopilot-scope-gate register --manifest …` (HALT on scope/invariant/dep collision). DB_PATH per worktree.
  - **`git worktree add … -b feat/<slug> main` MUST name the base (`main`)** — without it, the branch forks
    from the repo's CURRENT HEAD (often a stale/forensic feature branch), not main. Verify `git log -1` == main after.
  - A stopped/HALTed feature stays `in-flight` in the registry → its replacement collides. `cleanup --feature <slug>`
    (or `--manifest`) the dead one first; the gate is right to block until you do.
- **Commit infra/docs to `main`, not onto a feature branch** (else it rides the feature = SCOPE_DRIFT and main lacks it).
- **Commit new artifacts immediately** — untracked files get wiped by another session's `git clean`.

## Trust nothing un-verified
- Founder **verify-on-disk** before believing READY: right branch, ≥1 real commit, `git diff --stat` = declared
  scope only, clean tree, counters exist. Self-reported "READY/clean" without artifacts on disk is not trusted.

## Captured lessons (auto-appended via `lesson` / add-lesson.sh — newest last)
<!-- lessons below this line auto-apply to every project next session -->
- Re-slice a thrashed/HALTed feature FRESH from main (new worktree, base main); use the old branch as read-only reference, never resume on it (it carries entangled edge commits).  _(2026-06-19)_
- RECOMPUTING money state across MIXED payment types (credit+cash+transfer+webhook) when an input changes (fee change / payment arrives) is a choke-point → own slice with a FULL decision-table for every payment-combo BEFORE code; if you must ship sooner, NARROW fail-closed (touch only players with `paid_amount IS NULL` = zero money recorded — can't wipe real money), defer the already-paid cases to a separate slice. Don't bundle mixed-recompute into another slice (it spawns a new edge every round).  _(2026-06-20, credit E3 retry-after-fee)_
- A review round with ANY finding is NOT "clean" — "2 consecutive clean" means ZERO findings; "P2 only" is NOT clean. A P2 that touches a money/data path, or that the reviewer itself says "fix before merging", is NOT deferrable (usually a 1-line fix). Verify the gate by READING the actual `round-NN.txt` verdict lines, never the agent's "clean/READY" summary — agents under-rate money P2s as deferrable.  _(2026-06-20, credit E3 round-08: agent called it "clean, P2 only" but the P2 was a wrong-refund-amount money bug codex flagged fix-before-merge)_
- Verify the merge landed on main (grep the new symbol = 1) BEFORE any branch -D / worktree remove — never cleanup an unmerged branch; a deleted unmerged branch is only recoverable via reflog/dangling commit  _(2026-06-20)_
