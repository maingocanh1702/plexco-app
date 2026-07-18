# AP-26 — Auth D0/D1 implementation packet (docs-only)

Read canonical `/Users/maingocanh/Projects/Claude template/autopilot/autopilot-prompt-GENERIC.md` and confirm
v0.6.0 or newer. Execute `docs/autopilot-docs-auth-d0-d1-implementation-packet.md` with manifest
`docs/autopilot-manifests/docs-auth-d0-d1-implementation-packet.json`.

Before any edit:

1. Confirm `pwd` is the exact `.autopilot/worktrees/docs-auth-d0-d1-implementation-packet` path and branch is
   `feat/docs-auth-d0-d1-implementation-packet`. If not, HALT; do not checkout branches in another tree.
2. Confirm this worktree's HEAD equals `main` and `origin/main`, and all authority artifacts (DD-80 in
   `docs/standards/decisions.md`, approved B0 probe, web_auth tech v2.8 acceptance matrices, both
   `auth-s4-d*` manifests) exist at that committed base. Never use local-only authority docs — if any is
   missing on this HEAD, HALT `AUTHORITY_NOT_ON_MAIN`.
3. Re-register the manifest from this worktree, including on a re-run, then create `regions.log` and
   `fix-round-count.txt` under `.autopilot/state/docs-auth-d0-d1-implementation-packet/`.
4. Confirm the manifest scope is exactly the manifest itself plus `docs/auth-d0-d1-implementation-packet.md`.

Follow the canonical read order in the task contract before writing anything. This is P2 docs-only/manual
merge: one FULL-base clean Codex round, verification green, scope-gate READY, then STOP. Direct review output
to the round file; never use `tee`, degraded review, or a substitute reviewer. Do not touch packages/, apps/,
migrations, secrets, Reviewed specs, decisions.md, or the verdicts file. Any authority conflict is
`HALT-AUTHORITY_AMBIGUOUS`, never a local design decision. This packet does not authorize P0 auth codegen.

Begin with Pre-flight, then Step 1.
