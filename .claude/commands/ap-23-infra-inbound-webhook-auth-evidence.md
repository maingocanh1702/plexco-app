# AP-23 — Inbound webhook verification contract evidence

Read canonical `/Users/maingocanh/Projects/Claude template/autopilot/autopilot-prompt-GENERIC.md` and confirm
v0.6.0 or newer. Execute `docs/autopilot-infra-inbound-webhook-auth-evidence.md` with manifest
`docs/autopilot-manifests/infra-inbound-webhook-auth-evidence.json`.

Before any edit:

1. Confirm `pwd` is the exact `.autopilot/worktrees/infra-inbound-webhook-auth-evidence` path and branch is
   `feat/infra-inbound-webhook-auth-evidence`. If not, HALT; do not checkout branches in another tree.
2. Confirm this worktree's HEAD equals `main` and `origin/main`, and all authority artifacts came from that
   committed base. Never use local-only task files.
3. Re-register the manifest from this worktree, including on a re-run, then create `regions.log` and
   `fix-round-count.txt` under `.autopilot/state/infra-inbound-webhook-auth-evidence/`.
4. Confirm the manifest scope is exactly `docs/standards/webhook-verification-matrix.md` (a NEW file) and the
   dependency check passes.

Document only the INBOUND webhook verification contract per provider (signature header, algorithm, raw-body vs
parsed, replay/timestamp window) from current primary provider sources. This is the opposite direction from
AP-22 outbound egress — do not conflate them. Never record, echo or handle a secret VALUE; document the
verification ALGORITHM/contract only. Fail closed on ambiguity. P2 docs-only/manual merge: one FULL-base clean
Codex round, verification green, scope-gate READY, then STOP. Direct review output to the round file; never use
`tee`, degraded review, or a substitute reviewer. Do not touch code/config, migrations, secrets, provider
resources, DNS or webhooks, and do not invoke another task.

Begin with Pre-flight, then Step 1.
