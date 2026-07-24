# AP-30 — Session Management acceptance checklist publish retrace

Read canonical `/Users/maingocanh/Projects/Claude template/autopilot/autopilot-prompt-GENERIC.md` and confirm
v0.6.0 or newer. Execute `docs/autopilot-docs-session-acceptance-checklist-publish-retrace.md` with manifest
`docs/autopilot-manifests/docs-session-acceptance-checklist-publish-retrace.json`.

Before any edit:

1. Confirm `pwd` is the exact `.autopilot/worktrees/docs-session-acceptance-checklist-publish-retrace` path
   and branch is `feat/docs-session-acceptance-checklist-publish-retrace`. If not, HALT; do not checkout
   branches in another tree.
2. Confirm this worktree's HEAD equals `main` and `origin/main`, and all authority artifacts came from that
   committed base. Never use local-only task files.
3. Re-register the manifest from this worktree, including on a re-run, then create `regions.log` and
   `fix-round-count.txt` under `.autopilot/state/docs-session-acceptance-checklist-publish-retrace/`.
4. Confirm the manifest scope is exactly these five files: `docs/issues/session-management-acceptance-checklist.md`
   (existing file, edit only) plus this slice's own `docs/autopilot-manifests/docs-session-acceptance-checklist-publish-retrace.json`,
   `docs/autopilot-docs-session-acceptance-checklist-publish-retrace.md`, this launcher, and
   `docs/autopilot-backlog.md`; and the dependency (`docs-session-publish-contract`) is merged.

Re-trace the checklist ONLY against the local `feature_session_management.md` + `feature_session_management_tech.md`
specs (billing/PRD cross-references declared explicitly in the checklist's own Sources section) — no web, no
invention beyond the specs. This is documentation traceability, NOT authorization to build session code; the
substantive edit surface is one checklist markdown file, plus this slice's own manifest/slice-doc/launcher/
backlog bookkeeping. Fail closed: any referenced spec section missing/ambiguous → HALT, no completion marker.
P2 docs-only/manual merge: one FULL-base clean Codex round, verification green, scope-gate READY, then STOP.
Direct review output to the round file; never use `tee`, degraded review, or a substitute reviewer. Do not
touch code/config, migrations, secrets or schema, and do not invoke another task.

Begin with Pre-flight, then Step 1.
