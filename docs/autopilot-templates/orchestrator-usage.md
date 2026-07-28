<!-- workflow-guide: level3-orchestrator -->
# Level 3 orchestrator usage

The primary agent is the manager of managers. It owns the outcome; child agents own bounded
slices. Canonical contract: [`level3-workflow.md`](./level3-workflow.md).

## Start

```text
/ap-new <slug> <outcome>
```

The orchestrator loads project context, derives the task contract and risk, chooses supervised or
earned proactive mode, then builds a dependency graph.

## Delegation decision

Delegate when a slice:

- has one clear mechanism and observable result;
- has exact context, scope and negative scope;
- can use its own explicit-base worktree;
- can be verified independently;
- does not share a mutable invariant or external state with a parallel writer.

Do not delegate merely to increase agent count. A small cohesive change may remain one slice.

## Child brief

Every child receives:

```text
outcome
base SHA + worktree
context sources + Skills
scope + negative scope
dependencies + invariants
risk + sandbox/permission boundary
verification
code/security review
budgets + stop conditions
```

Writers never share a worktree. Read-only researchers/reviewers may run concurrently without write
authority.

## Monitoring

The orchestrator:

- follows dependency readiness and scope reservations;
- notices `READY|AWAIT|HALT`, stalls and tool failures;
- integrates results at message/terminal boundaries;
- prevents a child from widening scope or substituting self-review;
- continues other independent work while one child waits;
- asks the human only when a material decision, authority or external action is actually required.

When a child reports an issue, first verify on disk. Do not trust a prose READY without the exact
diff, tests and review artifacts.

## Review and integration

1. Require focused and canonical verification per slice.
2. Require the pinned Codex code gate and applicable security-focused Codex/project review.
3. Resolve findings inside hard breaker limits.
4. Re-read the combined diff and dependency interfaces.
5. Run repository-wide verification proportional to risk.
6. Produce one integrated terminal report.

The orchestrator may delegate supplemental/security review, testing or research. The final
readiness gate executes the declared commands and mandatory pinned Codex rounds directly, binding
its generated logs to HEAD/base/diff; neither the writer nor another Claude sub-agent substitutes
for it.

For multiple independent READY slices, the orchestrator builds an ephemeral no-push integration
worktree from the common base, combines only those exact tips and runs combined verification.
Dependent slices wait for their dependency to land, then start from a fresh pinned base. Each
dependency has a mandatory unique-symbol proof binding its original base and landed SHA to that
fresh downstream base; absence from the runtime registry is never enough.

## Human boundary

Escalate:

- policy or priority conflict;
- material product/design decision not derivable from authority;
- budget/permission exception;
- merge, deploy, publish, deletion or live mutation;
- HALT that requires a fresh task.

Do not escalate routine file choices, normal debugging sequence or agent routing.

## Terminal report

```text
LEVEL3_TASK_RESULT: READY|AWAIT|HALT
OUTCOME:
SLICES:
VERIFICATION:
CODE_REVIEW:
SECURITY_REVIEW:
HUMAN_INTERVENTIONS:
RESIDUAL_RISK:
NEXT_ACTION:
LEARNING_CAPTURED:
```

Optional formal control-plane/certification fields may be appended by projects that implement
them. They are not required for the supervised operational workflow.
