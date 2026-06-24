# Autopilot Prompt Template — Compact Companion (v0.5.0)

> This is the low-token authoring companion. It explains how to choose and fill
> the canonical send-file: `autopilot-prompt-GENERIC.md`.
>
> Do not paste this file into an autopilot run. If you need the old long rationale,
> incident log, or lineage, open `reference/autopilot-prompt-template.full.md`.

---

## 1. Load Order

Use the smallest file that answers the current need:

1. Running or authoring a prompt: `autopilot-prompt-GENERIC.md`.
2. Need always-on rules: `autopilot-invariants.md`.
3. Need maintenance/debug workflow template: `ai-maintenance-cost-playbook.template.md`.
4. Need rationale/history: `reference/*.full.md`.

The root files are optimized for token cost. The `reference/` files are archival.

---

## 2. Prompt Shape

Every send-file prompt keeps this order:

1. Task + repo path + mode.
2. Risk header.
3. Context labelled `NOT for execution`.
4. Scope discipline.
5. Design contract when a choke-point or derived aggregate is touched.
6. Required reading.
7. Pre-flight hard gate.
8. Anti-patterns.
9. Numbered steps.
10. Optional TDD gate.
11. Atomic commit plan.
12. Optional inline Codex review.
13. Merge/READY gate.
14. Circuit breakers.
15. HALT and final report variants.

Close with: `Begin with Pre-flight, then Step 1.`

---

## 3. Risk And Authority

| Tier | Codegen | Review | Merge |
| --- | --- | --- | --- |
| P0 | No | Manual workflow | Founder only |
| P1 | Yes | 2 consecutive FULL-base Codex clean rounds on current HEAD | STOP_AT_READY |
| P2 pilot | Yes | 1 FULL clean if `Codex review: 1x_clean`; else not_applicable only for low-risk | STOP_AT_READY |
| P2 mature | Yes | 2 consecutive FULL-base clean when auto-merge is requested | Auto-merge only if explicit opt-in + mature ledger + verify green + clean tree |

Default safe rule: if unclear, pick the higher tier and STOP_AT_READY.

Class maturity is per repo and per change class:

```text
<CHANGE_CLASS> | tier | clean_ready_runs_merged_unchanged: <n> | status: pilot|mature
```

Increment only when founder merges READY unchanged. Reset if founder has to fix the branch.

---

## 4. Scope Rules

Scope is a ceiling, not a target:

- Aim for the largest cohesive slice expected clean in <=2 fix rounds.
- Keep one risk tier per prompt.
- Ceiling is roughly <=3 modules / ~300 LOC.
- Do not split a cohesive low-risk change only to make each run tiny.
- Do split when one state crosses many interactions, a change mixes core with edge cases, or findings spread across many regions until MAX_ROUNDS.

Parallel work requires a manifest and scope gate:

```bash
scripts/autopilot-scope-gate register --manifest docs/autopilot-manifests/<slug>.json
```

Manifest must declare `feature`, `branch`, `base_ref`, `risk`, `scope`, `invariants`, and dependency checks.
Unknown invariant token, missing dependency, or active scope/invariant collision is a HALT.

When using worktrees, always name the base:

```bash
git worktree add <path> -b feat/<slug> <DEFAULT_BRANCH>
git -C <path> log -1 --oneline   # verify it matches default-branch HEAD
```

---

## 5. Design Contract Triggers

Paste a decision table before codegen when touching:

- matcher/parser/router/auth primitives;
- money, credit, identity, permissions, refunds, external events;
- a helper called by many flows;
- derived aggregates such as totals, balances, counts, status;
- mirrored logic across multiple adapters/transports.

Required content:

```text
Reuse-scan:
Decision table:
  <input class> -> <deterministic outcome>
  <input class> -> <fail-closed/manual outcome>
  <else>        -> <existing path>
Data format pin:
Invariants:
```

Hard rules:

- self-generated data uses deterministic key lookup;
- arbitrary human input may use fuzzy matching;
- stronger deterministic signal must not fall through to weaker fuzzy path;
- one derived aggregate has one canonical field/helper;
- mirrored adapter logic belongs in shared core;
- money/data fail closed.

If reusing a choke-point primitive, run Step 0 design-probe against the old primitive first. Structural failure means DESIGN_UNFIT HALT, not "patch around it".

---

## 6. Review Gate

Codex review is external cross-model review. It cannot be replaced by manual review or Claude/Task sub-agents.

Minimum valid setup:

```bash
CODEX="${AUTOPILOT_CODEX_BIN:?HALT: set AUTOPILOT_CODEX_BIN}"
[ -x "$CODEX" ] || exit 1
```

Never fall back to PATH `codex`.

A review round counts only when all hold:

- it writes `.autopilot/state/<task>/codex/round-NN.txt`;
- it reviews the committed current HEAD;
- it has no model-auth fatal;
- it ends with a real model verdict;
- it is FULL-base when counted toward final clean target.

Use incremental review for fixes:

1. Round 1 FULL against `<DEFAULT_BRANCH>`.
2. Fix rounds against `$LAST_REVIEWED_SHA`.
3. Final confirmation FULL against `<DEFAULT_BRANCH>`.

---

## 7. Loop Breakers

Step 1 must create:

```bash
: > .autopilot/state/<task>/regions.log
echo 0 > .autopilot/state/<task>/fix-round-count.txt
```

Every fix round:

- append `file:function` for each finding to `regions.log`;
- increment and echo `fix-round-count.txt`;
- HALT at `>5`;
- HALT if the same file is flagged in >=3 consecutive rounds with distinct findings.

Interpretation:

- same region repeats -> design smell, converge or redesign;
- findings spread across many regions -> slice too broad, split after MAX_ROUNDS;
- any finding means the round is not clean, including P2.

---

## 8. Final Reports

READY means safe for founder review, not merged:

- branch still exists;
- push to default branch not run;
- >=1 real commit exists;
- tree clean;
- verify green;
- review artifacts listed;
- verdict lines embedded;
- counter files exist;
- scope-gate marked ready if manifest was used.

COMPLETE is only valid after authorized squash block, push, and branch deletion succeed.

Founder verify-on-disk before trusting READY:

```bash
git branch --show-current
git log <DEFAULT_BRANCH>..HEAD --oneline
git diff --stat <DEFAULT_BRANCH>...HEAD
git status --short
ls .autopilot/state/<task>/regions.log .autopilot/state/<task>/fix-round-count.txt
```

---

## 9. When To Open The Full Archive

Open `reference/autopilot-prompt-template.full.md` when:

- updating the framework version or genealogy;
- auditing why a rule exists;
- recovering old wording from pre-v0.5.0;
- comparing compact rules against historical incidents.
