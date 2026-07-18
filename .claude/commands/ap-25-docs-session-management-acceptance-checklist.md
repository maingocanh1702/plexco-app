# AP-25 — Session Management acceptance checklist (issue-ready)

Read canonical `/Users/maingocanh/Projects/Claude template/autopilot/autopilot-prompt-GENERIC.md` and confirm
v0.6.0 or newer. Execute `docs/autopilot-docs-session-management-acceptance-checklist.md` with manifest
`docs/autopilot-manifests/docs-session-management-acceptance-checklist.json`.

Before any edit:

1. Confirm `pwd` is the exact `.autopilot/worktrees/docs-session-management-acceptance-checklist` path and
   branch is `feat/docs-session-management-acceptance-checklist`. If not, HALT; do not checkout branches in
   another tree.
2. Confirm this worktree's HEAD equals `main` and `origin/main`, and all authority artifacts came from that
   committed base. Never use local-only task files.
3. Re-register the manifest from this worktree, including on a re-run, then create `regions.log` and
   `fix-round-count.txt` under `.autopilot/state/docs-session-management-acceptance-checklist/`.
4. Confirm the manifest scope is exactly `docs/issues/session-management-acceptance-checklist.md` (a NEW file)
   and the dependency check passes.

Derive the checklist ONLY from the local `feature_session_management.md` + `feature_session_management_tech.md`
specs — no web, no invention beyond the specs, every item traceable to a spec section. This is documentation
traceability, NOT authorization to build session code; scope is one checklist markdown file. Fail closed: any
referenced spec section missing/ambiguous → HALT, no completion marker. P2 docs-only/manual merge: one FULL-base
clean Codex round, verification green, scope-gate READY, then STOP. Direct review output to the round file; never
use `tee`, degraded review, or a substitute reviewer. Do not touch code/config, migrations, secrets or schema,
and do not invoke another task.

Begin with Pre-flight, then Step 1.
