# AP-28 — Auth D1 implementation packet + DD-38/39 readiness (docs-only, split 2/2)

Run ONLY after `docs-auth-d0-packet` (AP-27) is merged to main — the dep_check requires
`docs/auth-d0-implementation-packet.md` with marker `AUTH_D0_PACKET_COMPLETE` on the base, and the shared
`auth`/`schema` invariants make the scope gate rightly block while AP-27 is in-flight.

Read canonical `/Users/maingocanh/Projects/Claude template/autopilot/autopilot-prompt-GENERIC.md` and confirm
v0.6.0 or newer. Execute `docs/autopilot-docs-auth-d1-packet.md` with manifest
`docs/autopilot-manifests/docs-auth-d1-packet.json`.

Before any edit:

1. Confirm `pwd` is the exact `.autopilot/worktrees/docs-auth-d1-packet` path and branch is
   `feat/docs-auth-d1-packet`. If not, HALT; do not checkout branches in another tree.
2. Confirm this worktree's HEAD equals `main` and `origin/main`, and all authority artifacts exist at
   that committed base: decisions.md row "DD-80 defect fix v4" (v1.86), B0 §3.3/§4 v1.86 AAD-handoff
   notes + §8.3 v1.85 per-lane finalizer, tech v2.9b acceptance D1-1..15, verdicts v0.6 Verdict 4,
   both `auth-s4-d*` manifests, and `docs/auth-d0-implementation-packet.md` with marker
   `AUTH_D0_PACKET_COMPLETE`. Never use local-only authority docs — if any is missing on this HEAD,
   HALT `AUTHORITY_NOT_ON_MAIN`.
3. Re-register the manifest from this worktree, including on a re-run, then create FRESH
   `regions.log` and `fix-round-count.txt` under `.autopilot/state/docs-auth-d1-packet/` (new slice —
   the AP-26 round budget does not carry over).
4. Confirm the manifest scope is exactly the manifest itself plus `docs/auth-d1-implementation-packet.md`.

Reference monolith: read ONLY via `git show cab0c2a:docs/auth-d0-d1-implementation-packet.md`. NEVER
checkout/merge/rebase `feat/docs-auth-d0-d1-implementation-packet` anywhere.

Follow the canonical read order in the task contract before writing anything. This is P2 docs-only/manual
merge: one FULL-base clean Codex round, verification green, scope-gate READY, then STOP. Review via
`export AUTOPILOT_CODEX_BIN="/Users/maingocanh/Projects/Bestminton Club Payment check bot/scripts/codex-review-pin.sh"`
then `"$AUTOPILOT_CODEX_BIN" review --base main > .autopilot/state/docs-auth-d1-packet/round-NN.txt 2>&1`;
verify `git diff --stat main...HEAD` is non-empty BEFORE trusting any clean; never use `tee`, a raw codex
binary, degraded review, or a substitute reviewer. Do not touch packages/, apps/, migrations, secrets,
Reviewed specs, decisions.md, or the verdicts file. Any authority conflict is `HALT-AUTHORITY_AMBIGUOUS`,
never a local design decision. This packet does not authorize P0 auth codegen.

Model continuity: the pinned chain is `claude-fable-5` -> `claude-sonnet-5` (effort `xhigh`); no other model.
On a resume after a usage-limit block, first re-run steps 1-4 above (they are idempotent), read
`.autopilot/state/docs-auth-d1-packet/` and existing commits to locate the exact stopping point, append one
line `MODEL_SWITCH: <from> -> <to> @ <UTC time>` to `regions.log` if the model changed, and continue the
SAME slice from that point. A model switch never relaxes any gate.

Begin with Pre-flight, then Step 1.
