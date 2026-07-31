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

### Authoring a manifest — read the validator before you write the field

Four manifest fields are checked by code you can read in under a minute. Every one of them was authored
wrong in a single slice (Plexco `authorize-tenant-action-core`, 2026-07-30) by someone who knew the
policy and skipped the source. The writer caught all four at register time; none reached the reviewer.

| Field | Read this first | What goes wrong otherwise |
|---|---|---|
| `invariants` | the catalog's `<!-- catalog:start -->` block | Plausible-sounding tokens that do not exist → `HALT INVARIANT_UNKNOWN` |
| `verification.*` | `runVerificationGroup()` in the readiness script | Each string is SPAWNED as a shell command. Prose fails every attempt |
| `scope` | the gate's out-of-scope check | Directories are rejected; a missing path becomes `SCOPE_DRIFT` mid-run |
| `code_review.clean_rounds` | your own risk tier | `1` on an authorization or money boundary is a review budget, not a gate |

The unifying failure is not carelessness about any one field. It is writing a **declaration** without
reading the **thing that validates it** — and each of those things was one grep away. In review mode
this same author is rigorous; in authoring mode they infer the adjacent-plausible value instead of
checking. Treat authoring as review of a document you have not written yet.

### An empty query result is evidence about your query first

The invariant-token error survived two attempts to catch it. Both greps were written for backticked
tokens; the catalog stores `token — description` with an em-dash and no backticks. Both returned
nothing, and nothing was read as *the catalog is empty* rather than *my pattern is wrong* — so the
author proceeded on invented tokens twice.

When a query over a file you did not write returns zero rows, the first hypothesis is that the query is
wrong, not that the world is empty. Confirm the shape before concluding the content: print a few raw
lines, or assert a token you already know is present. A search that cannot fail loudly is a search that
lies quietly — and "no results" is the most confident-looking lie a tool can tell you.

### Registration mechanics — four facts that each cost a real slice to learn

These are not advice. Each one halted a live slice on first contact, and none of them is discoverable
from the manifest alone.

**`register` requires `HEAD === base_sha` exactly.** It is designed to be called *before* any commit
exists, so the reservation is taken while a scope collision is still cheap. If your branch already
carries commits — a successor slice inheriting a predecessor's work, for example — you must reset to
the base, register, then restore. Anchor the tip with a tag *before* resetting so the commits are
never unreachable, and restore by tag rather than by raw SHA.

**The runtime manifest is hash-locked the moment you register.** `register` writes
`<STATE_DIR>/registered-manifest.sha256`; `ready` halts with `MANIFEST_DRIFT` if the file is missing
**or** its contents differ. Deleting the hash file does not bypass the check — it is fail-closed both
ways. Practical consequence: **anything in the manifest that can go stale will force a full
close-and-re-register cycle.** Write `verification` as properties, never pinned literals; see
`_verification_rule` in `manifests/_TEMPLATE.json`.

**The authored contract and the runtime manifest are different artifacts with different lifetimes.**
`docs/autopilot-manifests/<task-slug>.json` is tracked, is the human contract, and must **never**
carry `manifest_schema_version` — the validator pins the runtime path, so adding it there makes
`register` halt with `CONTRACT_INVALID`. `.autopilot/state/<feature>/manifest.json` is the per-run
runtime manifest, is gitignored, and carries the full v2 field set. If your slice needs to amend its
own contract mid-flight, put the authored file in `scope` and amend it inside your diff — that lands
the contract change with the change it describes and needs no commit on the default branch.

**`ap-finish.sh` runs from the repository root, not from the worktree it removes.** It resolves the
root via `git rev-parse --git-common-dir`, so you never need a throwaway worktree to close a
reservation. `--authorized-close --reason <text>` retains the branch; only the worktree and the
reservation go.

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

## Deciding for the project — the precedence order

Default: **decide, record the reasoning and the runner-up, continue.** The protection against a wrong
call is not that you asked; it is that the decision is visible and reversible at the merge boundary,
which the owner still controls. Asking mid-slice buys little that merge review does not already buy.

"Best for the project" is only meaningful against a stated order. Use this one, highest first. Where two
options differ at any level, the higher level decides and the lower ones do not vote.

1. **Fail-closed and least-privilege.** Never trade these for anything below. Unknown state denies.
   An error never collapses into allow. An allowlist beats a denylist. No new write path is opened
   without an owner for both set and clear.
2. **Correctness under concurrency and partial failure.** A design that is right only when nothing
   races is not right. Prefer the option whose failure mode is a refusal, not a silent wrong answer.
3. **Reversibility.** Between two acceptable options, take the one that is cheaper to undo. This is
   what makes autonomous decisions safe at all — preserve it deliberately.
4. **No debt that depends on memory.** An exception someone must remember to clean up is worse than a
   narrower fix that needs no memory, even if the narrower one is uglier. If an exception is
   unavoidable, it carries a named owner and an expiry, never a global relaxation.
5. **Deadline and buffer.** Spend the scarce resource on the expensive part. Do the hard, risky work
   while the buffer is large; leave routine work for later, when it is cheap.
6. **Scope minimalism.** No unrelated upgrade, cleanup or refactor rides along, however tempting.
   A slice that also does something else is two slices reviewed as one.
7. **Newness and tidiness.** Lowest priority. "Latest" is not a reason. Neither is symmetry.

**Escalate to the owner only when one of these is true:**

- the action is irreversible outside your worktree — deploy, external side effect, data migration on
  live data, anything spending money or making a commitment to a third party;
- it changes what the product IS: scope, priority, what a user gets;
- it contradicts a decision already recorded in the repo — you may argue against one, but you may not
  quietly overrule it;
- the project has genuinely never expressed a preference and levels 1–4 do not separate the options.
  In that case ask ONCE and get the answer written into the decision log, so the same question is
  derivable next time instead of being asked again.

Everything else you decide. Record it where the reviewer will see it, name the option you rejected and
why, and make the reversal cheap. A decision you can point at is worth more than a question you deferred.

**What this does not automate, and should not:** it does not let you price a novel risk trade-off the
project has no position on, and it does not let you skip levels 1 and 2 because a deadline is close. If
you find yourself reasoning "security is fine here because we are in a hurry", that is level 5 trying to
outvote level 1, and it is exactly the failure this order exists to prevent.

## Before stopping to ask, check whether a decision actually exists

Stopping costs the owner's attention, and on a deadline it costs the very buffer the stop is meant to
protect. So the bar is not "would confirmation be nice" — it is whether an answer exists that you cannot
derive.

**A question belongs to the owner only if its answer depends on something not derivable from the
contract:** a preference, a risk appetite, a business priority, or an authority you do not hold. If the
answer follows from facts you measured plus constraints already written down, decide it, act, and report
the reasoning so it can be overturned cheaply.

Two real cases from the same repo, three days apart, show the line:

- **Owner's call.** `deps-security-bump` hit a package whose only patch was a breaking major that broke
  a consumer at runtime. The options were: accept a red advisory scan for a few days, leave an
  ignore-entry someone must remember to clean up, or force the major and fix the fallout. Those price
  different risks against each other. No amount of measurement chooses between them.
- **Not the owner's call.** `eslint-10-migration` finished its design probe and stopped to ask whether to
  use the already-eligible version its own manifest had PRE-AUTHORIZED, or wait 17 hours for a newer
  patch. The deadline was in the contract. The fallback version was in the contract. The probe added no
  fact that changed either. The stop transferred work upward and spent buffer on a question the contract
  had already answered.

The second one had a mandatory design-probe gate in its manifest — copied from the first, where that
gate existed because a genuine decision sat behind it. **A gate inherited without its reason becomes a
ritual**, and a ritual stop is indistinguishable from a real one until someone reads both contracts.
When you write a probe gate into a manifest, name the decision it protects. If you cannot name one,
the gate is a checkpoint, not a decision point: run the probe, record it, and continue.

If you do stop, make it cheap to answer: state your recommendation first, the one fact that would change
it, and what you will do if no answer arrives. "Which of these four?" with no recommendation is the
expensive shape.

## When a gate fires correctly, never edit what you feed it

A gate reads inputs you control: the manifest's `scope`, its `invariants`, the terminal-signal files in
the state dir, the declared `verification`. When a check fires, exactly one of those inputs is the
cheapest thing in reach — and changing it makes the symptom disappear without touching the cause.

That move is forbidden even with diagnostic intent. "I widened `scope` to see what fired next" and "I
widened `scope` to get past this" are the same action and produce the same artifact; the gate cannot
tell them apart, and neither can the next person reading the run. Observed twice in one day on Plexco:
a writer widened a manifest scope to step past a correctly-raised `SCOPE_DRIFT` (blocked by the
permission layer, self-reported, reverted), and an orchestrator considered deleting a durable HALT file
to resume a run. Neither was malicious. Both were the path of least resistance from a correct signal.

The tell is simple: **if your next edit would make the check pass without changing what the check is
about, stop.** Report the blocker with its exact text and the smallest real fix. A gate you can talk
your way past is not a gate — it is a delay, and every future run inherits the precedent you set.

Diagnosing is still allowed; do it read-only. Read the gate's source to learn what it compares, run it
against a scratch fixture outside the reservation, or reason from its error text. What you may not do
is write a value you already know to be false into a file the gate trusts.

## Non-negotiable boundaries

- No force-push, `git add -A`, silent scope expansion or destructive cleanup of unrelated WIP.
- One worktree and one live writer per writing slice.
- P0 live actions are preparation-only without explicit human execution authority.
- Level 3 does not imply auto-merge or permission to perform external important actions.
- Optional formal activation/certification machinery never blocks this operational worker.
