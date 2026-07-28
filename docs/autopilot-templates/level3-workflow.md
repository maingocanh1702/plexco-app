<!-- workflow-authority: level3-operational -->
# Level 3 workflow for future tasks

> **Canonical operational contract.**
> Source model:
> [Steps of AI Adoption — Step 3: Supervised autonomy](https://claude.ai/code/artifact/bfdfaef9-bc62-4dfe-ba9e-c58a26c9accf).
> Applies only to a task/session/feature opened after this template is installed or refreshed.
> It never changes, resumes or reclassifies a session that was already running.

```text
WORKFLOW_LEVEL: 3
WORKFLOW_MODE: supervised_autonomy
HUMAN_ROLE: manager_of_managers
DEFAULT_MERGE_MODE: human_approved
DEFAULT_STOP_MODE: STOP_AT_READY
```

## 1. What Level 3 means here

Level 3 is an operating model:

- Claude receives enough context from code, project docs and relevant decisions/discussions.
- The primary agent owns the outcome, decomposes the work and delegates bounded slices to agents.
- Every writing agent is isolated in its own worktree; two writers never share one worktree.
- Agents verify their own work with the repository's real build, tests, lint/typecheck and relevant
  end-to-end checks before asking for review.
- Code review is automatic by default; security review is automatic for security-sensitive changes
  and whenever the repository provides it.
- The primary agent monitors progress, resolves ordinary implementation choices and reports
  exceptions instead of asking the human to steer every step.
- Repeated, proven routines may be triggered proactively. New, ambiguous or high-risk work remains
  supervised.
- The human owns policy, priority, budget, material product decisions, exceptions, outcome review
  and merge/deploy authority.

The artifact's agent counts are a scale illustration, not an acceptance criterion. A tiny task does
not need artificial fan-out. Parallelism is used only when at least two slices are genuinely
independent.

## 2. Forward-only boundary

At the beginning of every new task, record:

```text
LEVEL3_WORKFLOW: required
TASK_START_STATE: new_after_template_effective
AUTONOMY_MODE: supervised|proactive_routine
```

An already-running session keeps its existing contract until it reaches a terminal state. It must
not be migrated in place. A follow-up created after termination is a new task and uses this
workflow.

No global activation watermark, release epoch or certification ceremony is required to use this
operational workflow. Those mechanisms may be added later as optional enterprise hardening, but
they cannot block an ordinary future task.

## 3. Required task contract

Before implementation, the primary agent creates or resolves this compact contract from the user
request and live repository:

```text
TASK_ID:
OUTCOME:
REPOSITORY_AND_BASE:
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
WORKTREE_PLAN:
VERIFICATION:
CODE_REVIEW:
SECURITY_REVIEW:
BUDGETS:
STOP_CONDITIONS:
DELIVERABLES:
```

Rules:

- Read the repository handoff/README and inspect live code before planning.
- Use code intelligence or focused search to identify symbols, callers and blast radius; do not read
  the whole repository by default.
- `CONTEXT_SOURCES` names exact code/docs/decision/discussion inputs. Missing material context is an
  `AWAIT_CONTEXT`, not permission to invent it.
- `APPLICABLE_SKILLS` names reusable instructions that must be loaded; new durable guidance is
  captured as a Skill or lazy reference after the task.
- `MODEL_POLICY` assigns planner/worker/reviewer roles and an explicit fallback. The mandatory
  independent code gate is the canonical pinned Codex wrapper; the implementing agent or a
  Claude/sub-agent review cannot replace it. Security-sensitive work also gets a security-focused
  pinned Codex round and any stricter project scanner.
- `SANDBOX_AND_PERMISSIONS` declares network, secrets, external side effects and approval
  boundaries before delegation.
- Scope is a ceiling. Each slice names one mechanism and an explicit negative scope.
- Dependencies form a directed graph. Parallel slices must be file-, invariant- and state-disjoint.
- The agent recommends the highest-benefit option when a decision is needed; it does not forward an
  unranked menu to the human.

## 4. Roles

### Human

The human supplies or approves only:

- desired outcome and priority;
- policy and non-negotiable constraints;
- budget or deadline ceilings;
- material product/design choices that cannot be derived;
- exceptions to established policy;
- final outcome review, merge, deployment or other important external action.

The human is not expected to write prompts for every child agent, monitor keystrokes or route normal
implementation steps.

### Primary agent

The primary agent:

- owns the task end to end;
- builds the context pack and task contract;
- derives risk and selects the autonomy mode;
- splits work into bounded slices;
- creates/delegates agents and monitors them;
- integrates findings and prevents scope collision;
- drives verification and review to a terminal result;
- reports outcomes, evidence, exceptions and next action.

### Child agents

Each child agent receives one bounded outcome, exact context, scope/negative scope, dependencies,
verification commands and stop conditions. A child may create further children only when that
delegation is bounded and does not create a second writer in the same worktree.

## 5. Lifecycle

```text
request
→ load project context
→ inspect live repository and dependencies
→ derive risk, decisions and autonomy mode
→ create task contract and slice graph
→ reserve one worktree per writing slice
→ delegate independent slices
→ implement + self-verify
→ automatic code review + relevant security review
→ fix within hard loop breakers
→ integrate and run full verification
→ READY | AWAIT | HALT
→ human outcome review / merge
→ capture reusable learning in docs, tests, Skills or routines
```

The primary agent continues while safe in-scope progress exists. It does not pause merely to ask
what to do next.

## 6. Risk and autonomy

| Risk | Typical work | Level-3 behavior |
|---|---|---|
| `P0` | Live production/control mutation, secrets, irreversible financial or privilege action | Analyse/prepare only; no tracked/product/external mutation; require explicit human execution authority |
| `P1` | Money, identity, auth, permission, schema/migration, destructive or shared choke point | Supervised, isolated, full verification, independent review, human merge |
| `P2` | Bounded product/code/tooling/docs change | Supervised by default; proactive only after the routine earns trust |
| `P3` | Read-only/report-only or unclassified | No tracked/product mutation; report plus ignored terminal telemetry |

`proactive_routine` is allowed only when all are true:

- the task class is narrow and repeatable;
- scope, tests, review and rollback/stop rules are encoded;
- recent comparable runs were successful without material human steering;
- the trigger and budget are authorized;
- current context and dependencies are fresh.

Any failed assumption, scope expansion, security uncertainty, missing context or repeated review
thrash drops the task back to supervised handling or HALT. Auto-merge is never implied by Level 3.

## 7. Worktree and delegation rules

- One writing slice = one branch + one worktree + at most one live writer.
- Use one cohesive slice by default. For multiple slices, the stable feature identity is
  `<task-slug>--<slice-slug>`; a one-slice task may use `<task-slug>`.
- The main worktree stays on the repository default branch.
- Create every feature worktree from the explicit, verified default-branch SHA.
- Read-only research/review agents may share source context but never mutate another writer's tree.
- Register parallel scope before writing when the repository has the scope gate.
- Use isolated databases, ports, caches and test state per worktree.
- Serialize slices that share a stateful invariant, migration order, generated artifact or mutable
  external system.
- A dependent slice starts only after its dependency is landed on a freshly pinned base. Each
  dependency carries a mandatory unique-symbol proof binding its dependency base, landed SHA and
  downstream base. Registry absence alone is not landing proof. Do not let a slice consume an
  unmerged sibling worktree implicitly.
- When two or more independent slices form one outcome, create an ephemeral no-push integration
  worktree from their common base, combine only the exact READY tips, run combined verification and
  discard it after evidence. This is integration evidence, not merge authority.
- Remove a worktree only after its terminal state and merge/disposition are verified.

## 8. Verification and review

Every code-writing slice must declare commands that the final readiness gate executes directly:

1. run focused tests for the changed behavior;
2. run the repository's canonical build/typecheck/lint/test command;
3. run production-shaped or end-to-end verification when the behavior crosses a real boundary;
4. inspect the exact diff against the pinned base;
5. receive an independent code review;
6. receive security review when the change touches trust boundaries, auth, secrets, permissions,
   external input, money or deployment.

The default independent reviewer is `scripts/codex-review-pin.sh`. The final gate invokes it
directly, binds every round to the current HEAD/base/diff and accepts only the exact clean verdict
marker. A trust-boundary slice runs a separate security-focused round through that wrapper;
project-native scanners augment it.

A review with any actionable finding is not clean. A clean review of an empty diff is not evidence.
If a required reviewer or verifier is unavailable, emit `HALT TOOL_UNAVAILABLE`; do not silently
downgrade the gate.

Loop breakers remain hard:

- more than five fix rounds → `HALT MAX_ROUNDS`;
- the same region in three consecutive rounds → `HALT REGION_THRASH`;
- findings spreading across the design → stop and re-slice rather than continue patching.

## 9. Terminal states

### READY

Use only when scope, verification and reviews are complete. Report:

- outcome;
- changed files/slices;
- tests/build/review/security evidence;
- remaining risks;
- exact merge/deploy action requiring the human.

A P1/P2 writing slice reaches READY only through its scope/readiness gate and worktree
`READY.txt`. A P0 prepare-only or P3 report-only task has no writer and makes no tracked, product or
external mutation; its only repo write is ignored local telemetry under the repo-root
`.autopilot/state/<task-slug>/READY.txt` after its non-mutating deliverable is complete.

### AWAIT

Use only for a concrete missing human decision, external authority or context that materially
changes the result. Preserve work safely, stop writers and provide one recommended option with
trade-offs and a binary resume condition.

Write `AWAIT-FOUNDER-<reason>.txt` in the current worktree state directory, or the repo-root task
state directory when no worktree exists.

### HALT

Use for a hard safety, scope, authority, tool or loop-breaker failure. State the exact reason,
forensic state and the condition for a fresh successor task. Do not keep patching after HALT.

Write `HALT-<REASON>.txt` in the same canonical state directory before reporting.

## 10. Learning loop

After a terminal task:

- turn a discovered bug into a regression test;
- record durable business/security decisions in project docs;
- move repeated operational guidance into a Skill or lazy-loaded reference;
- promote a task class to `proactive_routine` only from observed successful evidence;
- demote or tighten a routine after an exception;
- monitor cycle time, review rounds, human interventions, failures and cost where tooling exists.

The question after a failure is “what context, guardrail, test or routine was missing?”—not “who
failed to watch the agent closely enough?”

## 11. Readiness check

A repository is ready to run a new task with this workflow when:

- this contract and the global invariants are visible to the session;
- the repository has a handoff/README and canonical verification commands;
- worktree isolation is available;
- the task contract identifies context, scope, risk, slices and stop conditions;
- independent code review is callable for code-writing work;
- `/ap-init` reports `KIT_ON_ORIGIN: ready` and the current canonical complete pack is present on
  the pinned origin base: scope/readiness/reviewer,
  verified finish + read-only housekeeping scripts, scope guide, manifest/evidence templates and
  invariant catalog;
- the human merge/deploy boundary is explicit.

If a project lacks an optional automation such as proactive triggers, analytics or a security
scanner, it still runs Level 3 in supervised mode and records that capability as a follow-up. It
must not claim the missing automation ran.
