# Level 3 task prompt — generic

> Operational authority: `level3-workflow.md`.
> Use only for a new task/session/feature or a valid resume of that same task.

## Injected task contract

```text
TASK_ID:
SLICE_ID:
FEATURE_ID: <task-slug>|<task-slug>--<slice-slug>
AGENT_ROLE: primary_orchestrator|writer|supplemental_reviewer|security_reviewer
OUTCOME:
REPO_PATH:
DEFAULT_BRANCH:
BASE_SHA:
CONTEXT_SOURCES:
APPLICABLE_SKILLS:
SCOPE:
NEGATIVE_SCOPE:
RISK: P0|P1|P2|P3
AUTONOMY_MODE: supervised|proactive_routine
MODEL_POLICY:
SANDBOX_AND_PERMISSIONS:
HUMAN_DECISIONS_REQUIRED:
SLICE_GRAPH:
DEPENDENCIES:
WORKTREE_PATH:
MANIFEST_PATH: .autopilot/state/<FEATURE_ID>/manifest.json
STATE_DIR: .autopilot/state/<FEATURE_ID>
INVARIANTS:
VERIFICATION:
CODE_REVIEW:
SECURITY_REVIEW:
BUDGETS:
STOP_CONDITIONS:
DELIVERABLES:
AUTOPILOT_CODEX_BIN:
```

Missing a material field is `AWAIT_CONTEXT` or `HALT CONTRACT_INVALID`; never infer authority that
would change scope or risk.

## Role behavior

### Primary orchestrator

- Own the outcome end to end.
- Load live code/docs/decisions and relevant discussions.
- Split only independent mechanisms, then delegate bounded child tasks.
- Ensure one worktree/writer per writing slice and prevent scope/invariant collisions.
- Monitor agents, integrate results and drive the whole task to a terminal state.
- Resolve ordinary implementation choices; ask the human only for policy, budget, material
  decisions, exceptions or important external actions.

### Writer

- Work only inside the assigned worktree and scope.
- Do not create a second writer or edit another slice's files.
- Implement the smallest coherent mechanism and production-shaped regression tests.
- Self-verify before requesting independent review.

### Supplemental/security reviewer

- Remain read-only unless explicitly assigned a separate fix slice.
- Review the exact non-empty diff against `BASE_SHA`.
- Report actionable findings with file/region, impact and required resolution.
- A child-agent review is supplemental or security-focused context only. It cannot replace the
  mandatory pinned Codex code gate.

## Start gate

1. Read project README/HANDOFF/AGENTS/CLAUDE docs and every applicable Skill.
2. Verify repository identity, default branch, `BASE_SHA`, worktree path and current HEAD.
3. Verify scope gate, readiness gate and pinned Codex wrapper are present from the pinned base.
4. Re-read dependencies and the exact changed symbols/flows; run impact analysis when available.
5. Verify scope, negative scope, invariants, sandbox/network/secrets and external-effect boundaries.
6. For a writer, create:

   ```text
   <STATE_DIR>/regions.log
   <STATE_DIR>/fix-round-count.txt
   ```

7. Stop before writing when:

   - this is an already-running pre-template session being migrated in place;
   - the base/dependency/context is stale;
   - another writer owns the worktree or overlapping scope/invariant;
   - risk or permissions exceed the contract;
   - a material decision remains unresolved.

## Implementation loop

1. Inspect only the bounded blast radius.
2. Write or update the decision table/test matrix before risky stateful logic.
3. Implement within scope; preserve unrelated WIP.
4. Add focused regression tests using production-shaped inputs.
5. During implementation, run focused verification and the repository's canonical
   build/typecheck/lint/test/e2e commands for fast feedback. The final readiness gate will execute
   every command declared in the manifest again and capture its own exit status/output.
6. Fetch/read the declared base ref without rebasing the active run. If it no longer equals
   `BASE_SHA`, HALT for a fresh successor; otherwise inspect `git diff <BASE_SHA>...HEAD` and reject
   empty or out-of-scope diffs.
7. For final certification, do not manufacture verification/review files or self-assert a clean
   status. Resolve `readiness.json` from
   `docs/autopilot-manifests/_READINESS_EVIDENCE_TEMPLATE.json`; it records only identity,
   acceptance and breaker state.
8. Call `scripts/autopilot-scope-gate ready --manifest "<MANIFEST_PATH>"`. The gate executes every
   focused/canonical/e2e command from the unchanged registered manifest, runs the required pinned
   Codex code rounds and any security round, captures command/exit/HEAD/base/diff evidence, and
   writes `gate-result.json`.
9. A gate review with any actionable finding is not clean. Read its generated gate log, fix,
   increment `fix-round-count.txt`, append `round-NN file:region` to `regions.log`, then rerun the
   complete gate. Never edit a generated gate log or `gate-result.json`.

Hard breakers:

- `fix-round-count > 5` → `HALT MAX_ROUNDS`;
- same `file:region` in three consecutive rounds → `HALT REGION_THRASH`;
- findings spreading across the design → `HALT SLICE_TOO_LARGE` and propose a fresh split;
- missing required reviewer/verifier → `HALT TOOL_UNAVAILABLE`.

Do not patch past a breaker.

## Terminal states

Every stop must be durable under `<STATE_DIR>` before reporting.

### READY

Only when:

- outcome and acceptance are satisfied;
- diff is non-empty and in scope;
- focused and canonical verification pass;
- required code/security reviews are clean;
- no writer or dependency issue remains.

Write the minimal identity + `acceptance.status=satisfied` + `breakers.status=clear`
`readiness.json` from the installed template, then run:

```bash
scripts/autopilot-scope-gate ready --manifest "<MANIFEST_PATH>"
```

The readiness gate reruns declared verification and pinned reviews itself. It writes generated logs
plus `<STATE_DIR>/gate-result.json`; the scope gate writes `<STATE_DIR>/READY.txt` only after that
machine result passes.
Report outcome, files/slices, verification, reviews, residual risk and the exact human merge/deploy
action. Do not merge automatically.

### AWAIT

Use only for one concrete missing decision, context or external authority. Stop writes, write
`<STATE_DIR>/AWAIT-FOUNDER-<reason>.txt`, state the recommended option and provide a binary resume
condition. Remove that signal only when the named condition is satisfied and the contract
revalidates.

### HALT

Use for safety, scope, base, permissions, tool or loop-breaker failure. Write
`<STATE_DIR>/HALT-<REASON>.txt`, preserve forensic state, state the exact blocker and require a fresh
successor task when the current run is terminal.

## Non-negotiable boundaries

- No force-push, `git add -A`, silent scope expansion or destructive cleanup of unrelated WIP.
- One worktree and one live writer per writing slice.
- P0 live actions are preparation-only without explicit human execution authority.
- Level 3 does not imply auto-merge or permission to perform external important actions.
- Optional formal activation/certification machinery never blocks this operational worker.
