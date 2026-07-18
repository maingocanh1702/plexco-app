# AP-24 — Provider messaging limits and tier evidence

Read canonical `/Users/maingocanh/Projects/Claude template/autopilot/autopilot-prompt-GENERIC.md` and confirm
v0.6.0 or newer. Execute `docs/autopilot-infra-provider-limits-evidence.md` with manifest
`docs/autopilot-manifests/infra-provider-limits-evidence.json`.

Before any edit:

1. Confirm `pwd` is the exact `.autopilot/worktrees/infra-provider-limits-evidence` path and branch is
   `feat/infra-provider-limits-evidence`. If not, HALT; do not checkout branches in another tree.
2. Confirm this worktree's HEAD equals `main` and `origin/main`, and all authority artifacts came from that
   committed base. Never use local-only task files.
3. Re-register the manifest from this worktree, including on a re-run, then create `regions.log` and
   `fix-round-count.txt` under `.autopilot/state/infra-provider-limits-evidence/`.
4. Confirm the manifest scope is exactly `docs/standards/provider-limits-evidence.md` (a NEW file) and the
   dependency check passes.

Record current, attributable limits/tier constraints for Zalo Bot, Meta Messenger, SePay and ApiPay (message
quotas, send-window, App-Review/tier gates) from current primary provider sources. Evidence only — do not set
pricing, GTM or capacity decisions; do not invent numbers or enterprise capabilities. Fail closed on ambiguity.
P2 docs-only/manual merge: one FULL-base clean Codex round, verification green, scope-gate READY, then STOP.
Direct review output to the round file; never use `tee`, degraded review, or a substitute reviewer. Do not touch
code/config, migrations, secrets, provider resources, DNS or webhooks, and do not invoke another task.

Begin with Pre-flight, then Step 1.
