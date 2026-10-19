# Level 3 task-authoring template

Use this template to prepare a new task before launching writing agents.
Canonical behavior: [`level3-workflow.md`](./level3-workflow.md).

```text
TASK_ID: <repo-id:slug>
LEVEL3_WORKFLOW: required
TASK_START_STATE: new_after_template_effective

OUTCOME:
  <one observable result>

REPOSITORY_AND_BASE:
  repo: <absolute path or repo id>
  default_branch: <branch>
  base_sha: <full SHA>

CONTEXT_SOURCES:
  - <project README/HANDOFF>
  - <exact code paths/symbols>
  - <decision/wiki/discussion refs>

APPLICABLE_SKILLS:
  - <skill or none>

SCOPE:
  - <exact file/module/mechanism>

NEGATIVE_SCOPE:
  - <tempting adjacent subsystem that must not change>

RISK: <P0|P1|P2|P3>
AUTONOMY_MODE: <supervised|proactive_routine|autonomous_to_ready>

MODEL_POLICY:
  planner: <model/role>
  worker: <model/role>
  independent_reviewer: scripts/codex-review-pin.sh
  fallback: HALT_TOOL_UNAVAILABLE

SANDBOX_AND_PERMISSIONS:
  network: <allowed|restricted|none>
  secrets: <none|exact boundary>
  external_side_effects: <mocked|approval-required|exact allowed action>

HUMAN_DECISIONS_REQUIRED:
  - <none or exact material decision>

SLICE_GRAPH:
  - id: <slice>
    feature_id: <task-slug>|<task-slug>--<slice-slug>
    mechanism: <symbol/module>
    depends_on: []
    dep_checks: []
    parallel_safe_with: []

WORKTREE_PLAN:
  - slice: <slice>
    branch: feat/<feature-id>
    path: .autopilot/worktrees/<feature-id>
    base_sha: <full SHA>
    writer_processes_max: 1

VERIFICATION:
  focused:
    - <command>
  canonical:
    - <build/typecheck/lint/test command>
  e2e:
    - <exact executable command>
    # Use an empty list when no end-to-end check applies; record the reason in the task contract.

CODE_REVIEW:
  required: true
  tool: scripts/codex-review-pin.sh
  clean_rounds: <1|2>

SECURITY_REVIEW:
  required: <true|false>
  reason: <trust boundary or not applicable>
  tool: scripts/codex-review-pin.sh
  additional_scanner: <project scanner or none>

BUDGETS:
  wall_time_minutes: <n>
  fix_rounds_max: 5
  writer_processes_per_slice_max: 1
  token_or_cost_boundary: <value|unavailable>

STOP_CONDITIONS:
  - MAX_ROUNDS
  - REGION_THRASH
  - SCOPE_OR_BASE_DRIFT
  - MATERIAL_CONTEXT_OR_DECISION_MISSING
  - REQUIRED_TOOL_UNAVAILABLE

DELIVERABLES:
  - <code/docs/tests/artifact>
  - terminal evidence report
```

Authoring rules:

- Derive the contract from live repository truth, not the task title.
- Recommend one best material decision instead of an unranked option list.
- Use the smallest useful slice graph; do not create parallelism for appearance.
- Every dependency needs one same-order unique-symbol `dep_checks` proof with
  `feature/base_sha/landed_sha/file/symbol`; registry absence is not proof.
- Final verification and pinned review are executed/captured by the readiness gate, not asserted by
  the writer.
- A proactive routine needs existing evidence. Otherwise select `supervised`.
- Formal receipt/activation/certification fields may be added by a project that implements them,
  but they are not required by this operational template.
