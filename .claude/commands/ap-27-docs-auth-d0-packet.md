# AP-27 — Auth D0 implementation packet (docs-only, split 1/2)

> **DISABLED / SUPERSEDED — DO NOT EXECUTE OR REGISTER.** AP-27 already merged, and its v1.86 packet is historical. Current authority is DD-80 v1.88 plus `docs/g3-revoke-all-concurrency-probe-seed.md`; use the separately scoped P0 manual-only D0a/D0b contracts. Stop here without creating a worktree, counter, sentinel, branch, or scope-gate reservation.

Read canonical `/Users/maingocanh/Projects/Claude template/autopilot/autopilot-prompt-GENERIC.md` and confirm
v0.6.0 or newer. Execute `docs/autopilot-docs-auth-d0-packet.md` with manifest
`docs/autopilot-manifests/docs-auth-d0-packet.json`.

Before any edit:

1. Confirm `pwd` is the exact `.autopilot/worktrees/docs-auth-d0-packet` path and branch is
   `feat/docs-auth-d0-packet`. If not, HALT; do not checkout branches in another tree.
2. Confirm this worktree's HEAD equals `main` and `origin/main`, and all authority artifacts exist at
   that committed base: decisions.md row "DD-80 defect fix v4" (v1.86), B0 §6 amendment v1.86 +
   §3.3/§4 v1.86 notes, tech v2.9b rows D0-12/D0-13, verdicts v0.6, manifest
   `auth-s4-d0-revoke-core.json` including `apps/web/lib/session-cookies.ts` in scope. Never use
   local-only authority docs — if any is missing on this HEAD, HALT `AUTHORITY_NOT_ON_MAIN`.
3. Re-register the manifest from this worktree, including on a re-run, then create FRESH
   `regions.log` and `fix-round-count.txt` under `.autopilot/state/docs-auth-d0-packet/` (new slice —
   the AP-26 round budget does not carry over).
4. Confirm the manifest scope is exactly the manifest itself plus `docs/auth-d0-implementation-packet.md`.

Reference monolith: read ONLY via `git show cab0c2a:docs/auth-d0-d1-implementation-packet.md`. NEVER
checkout/merge/rebase `feat/docs-auth-d0-d1-implementation-packet` anywhere.

Follow the canonical read order in the task contract before writing anything. This is P2 docs-only/manual
merge: one FULL-base clean Codex round, verification green, scope-gate READY, then STOP. Review via
`export AUTOPILOT_CODEX_BIN="/Users/maingocanh/Projects/Bestminton Club Payment check bot/scripts/codex-review-pin.sh"`
then `"$AUTOPILOT_CODEX_BIN" review --base main > .autopilot/state/docs-auth-d0-packet/round-NN.txt 2>&1`;
verify `git diff --stat main...HEAD` is non-empty BEFORE trusting any clean; never use `tee`, a raw codex
binary, degraded review, or a substitute reviewer. Do not touch packages/, apps/, migrations, secrets,
Reviewed specs, decisions.md, or the verdicts file. Any authority conflict is `HALT-AUTHORITY_AMBIGUOUS`,
never a local design decision. This packet does not authorize P0 auth codegen.

Model continuity: the pinned chain is `claude-fable-5` -> `claude-sonnet-5` (effort `xhigh`); no other model.
On a resume after a usage-limit block, first re-run steps 1-4 above (they are idempotent), read
`.autopilot/state/docs-auth-d0-packet/` and existing commits to locate the exact stopping point, append one
line `MODEL_SWITCH: <from> -> <to> @ <UTC time>` to `regions.log` if the model changed, and continue the
SAME slice from that point. A model switch never relaxes any gate.

Begin with Pre-flight, then Step 1.
