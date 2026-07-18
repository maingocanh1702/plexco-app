# AP-22 — DD-04 fixed-egress compatibility evidence

Read canonical `/Users/maingocanh/Projects/Claude template/autopilot/autopilot-prompt-GENERIC.md` and confirm
v0.6.0 or newer. Execute `docs/autopilot-infra-egress-compatibility-evidence.md` with manifest
`docs/autopilot-manifests/infra-egress-compatibility-evidence.json`.

Before any edit:

1. Confirm `pwd` is the exact `.autopilot/worktrees/infra-egress-compatibility-evidence` path and branch is
   `feat/infra-egress-compatibility-evidence`. If not, HALT; do not checkout branches in another tree.
2. Confirm this worktree's HEAD equals `main` and `origin/main`, and all authority artifacts came from that
   committed base. Never use local-only task files.
3. Re-register the manifest from this worktree, including on a re-run, then create `regions.log` and
   `fix-round-count.txt` under `.autopilot/state/infra-egress-compatibility-evidence/`.
4. Confirm the manifest scope is exactly `docs/standards/environments-setup.md` and the dependency check passes.

Use current primary provider sources and fail closed on ambiguity. This is P2 docs-only/manual merge: one
FULL-base clean Codex round, verification green, scope-gate READY, then STOP. Direct review output to the round
file; never use `tee`, degraded review, or a substitute reviewer. Do not invoke AP-21 or touch code/config,
migrations, secrets, provider resources, DNS or webhooks.

Begin with Pre-flight, then Step 1.
