<!-- workflow-handoff: level3-operational -->
# Level 3 workflow handoff

> Read first for every new task/session/feature.
> Existing running sessions are explicitly out of scope.

```text
DEFAULT_FUTURE_WORKFLOW: LEVEL3_SUPERVISED_AUTONOMY
HUMAN_ROLE: MANAGER_OF_MANAGERS
DEFAULT_AUTONOMY_MODE: supervised
DEFAULT_STOP_MODE: STOP_AT_READY
AUTO_MERGE: off
```

## Authority

1. [`level3-workflow.md`](./level3-workflow.md) — canonical operational workflow.
2. [`autopilot-invariants.md`](./autopilot-invariants.md) — non-negotiable safety rules.
3. [`autopilot-prompt-GENERIC.md`](./autopilot-prompt-GENERIC.md) — worker contract.
4. [`orchestrator-usage.md`](./orchestrator-usage.md) — delegation and monitoring.
5. [`../autopilot-parallel-scope-gate.md`](../autopilot-parallel-scope-gate.md) — worktree/scope
   lifecycle as installed in this repository. Installed kit version: read it, do not trust a number
   copied into prose — `awk '/^# KIT_VERSION:/{print $3; exit}' scripts/autopilot-scope-gate`.
6. Project-local README/HANDOFF/AGENTS/CLAUDE docs — repository-specific context and stricter rules.

Project rules may be stricter, never weaker.

## Start a new task

1. Confirm the task is new, not a continuation of a currently running session.
2. Load the project handoff, live default-branch state and relevant code/docs/decisions.
3. Resolve the compact task contract from `level3-workflow.md`.
4. Derive risk and select `supervised|proactive_routine`.
5. Split only where slices are independently executable and verifiable.
6. Reserve one branch/worktree per writing slice.
7. **Generate the runtime manifest before registering.** The gate reads
   `.autopilot/state/<feature>/manifest.json`, which is per-run, gitignored and carries
   `manifest_schema_version: level3-operational-v2`. It is a different artifact from the tracked
   authored contract under `docs/autopilot-manifests/<slug>.json`, which must **never** carry that
   string — the validator pins the runtime path, so adding it to the tracked file breaks `register`
   instead of upgrading it. Copy the shape from `docs/autopilot-manifests/_TEMPLATE.json`. Omitting
   this step is what made `scope-gate ready` halt every slice in the repo until 2026-07-30; a slice
   that skips it does not get a weaker gate, it gets no gate.
8. Let the primary agent delegate, monitor, integrate and drive the task to `READY|AWAIT|HALT`.

The user supplies the outcome and material decisions; the primary agent owns normal sequencing and
child-agent prompts.

## Resume

- `AWAIT`: resume only after the named decision/context/authority arrives; revalidate live state.
- `READY`: no more implementation writes; perform outcome review and authorized landing only.
- `HALT`: terminal for that run. Preserve evidence and create a fresh successor task if needed.
- Existing pre-template session: finish under its original contract; do not retrofit it.

## Decision boundary

Ask the human only for:

- policy, priority or budget;
- a material product/design choice that cannot be derived;
- an exception to established rules;
- important external action such as merge, deploy, publish, delete or live mutation.

For ordinary implementation choices, choose the highest-benefit in-scope path and continue.

## Readiness

The template is operationally ready for a future task when:

- global instructions and this workflow are visible;
- the project exposes its verification commands and relevant context;
- worktree isolation is available;
- required independent review is callable;
- the complete required pack from `/ap-new` is committed and pushed on the origin base from which
  future worktrees start;
- the task contract and human boundary are explicit.

Optional enterprise control-plane, release-epoch, activation and certification docs are
Level-3+ hardening references. Their implementation/status markers do not block this operational
workflow and must not be used to report `LEVEL3_NOT_ACTIVATED` for an ordinary new task.
