# AP-28 — Auth D1 implementation packet + DD-38/39 readiness (docs-only, split 2/2)

HOLD. Run ONLY after both current D0 slices are merged to `origin/main`: the dep_checks require
`packages/db/migrations/0015_auth_revoke_account.sql` with `auth_revoke_all_web_sessions` and
`apps/web/app/api/auth/logout-all/route.ts` with `revokeAllWebSessions`. The historical
`AUTH_D0_PACKET_COMPLETE` marker is not runtime dependency evidence. If either probe is absent, stop before
creating a worktree or registering the scope gate.

Read canonical `/Users/maingocanh/Projects/Claude template/autopilot/autopilot-prompt-GENERIC.md` and confirm
v0.6.0 or newer. Execute `docs/autopilot-docs-auth-d1-packet.md` with manifest
`docs/autopilot-manifests/docs-auth-d1-packet.json`.

Before any edit:

1. Confirm `pwd` is the exact `.autopilot/worktrees/docs-auth-d1-packet` path and branch is
   `feat/docs-auth-d1-packet`. If not, HALT; do not checkout branches in another tree.
2. Confirm this worktree's HEAD equals `main` and `origin/main`, and all authority artifacts exist at
   that committed base: decisions.md DD-80 v1.88, B0 amendment v1.88 plus the v1.86 AAD-handoff notes,
   tech v2.10 acceptance D1-1..15, verdicts v0.7 current D0a/D0b order, both D0 merged probes, and all
   `auth-s4-d*` manifests. Never use local-only authority docs — if any is missing on this HEAD,
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
