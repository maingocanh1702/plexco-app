# AP-32 — User Settings 0014 merge-state reconcile

Read canonical `/Users/maingocanh/Projects/Claude template/autopilot/autopilot-prompt-GENERIC.md` and confirm
v0.6.1 or newer. Execute manifest
`docs/autopilot-manifests/docs-user-settings-0014-merge-state-reconcile.json` — that manifest is the whole
contract; this slice has no separate slice-doc.

`design_probe_required: false`, deliberately, against the v0.6.1 §0.1 classifier: this slice makes no mechanism
choice, has no create branch, no money math, no destructive op, no schema/migration and no divergence from a
ratified sibling — it corrects factual merge-state claims against git history. One-line test ("does this slice
have a decision a mechanical mirror would get WRONG?") answers no. The two known traps are covered by
acceptance rows US14-4 and US14-6, not by a design decision.

Before any edit:

1. Confirm `pwd` is the exact `.autopilot/worktrees/docs-user-settings-0014-merge-state-reconcile` path and
   branch is `feat/docs-user-settings-0014-merge-state-reconcile`. If not, HALT; never checkout branches in
   another tree.
2. Confirm this worktree's HEAD equals `main` and `origin/main`, and that every authority artifact came from
   that committed base — the manifest is on `main` at `cc77610`, Verdict 21 at `3b12e43`. Never use local-only
   task files.
3. Re-register the manifest from this worktree, including on a re-run, then create `regions.log` and
   `fix-round-count.txt` under `.autopilot/state/docs-user-settings-0014-merge-state-reconcile/`.
4. Confirm the manifest scope is exactly two files — `docs/features/BE/feature_user_settings_tech.md` (existing,
   edit only) and this slice's own manifest — and that the dependency
   `docs-0014-merge-status-repo-wide-reconcile` is merged.
5. Run `_evidence_rules` BEFORE editing: re-check the live migration tail (`ls packages/db/migrations/*.sql |
   tail -1`) and re-verify that every object the doc calls genuinely-new is still absent from
   `packages/db/migrations/` and `packages/db/schema.ts`. If the tail moved, use the real tail and update
   `merged_probe`. If any genuinely-new object has landed, HALT — that is a different defect and must be
   reported, not silently edited.

Correct the five stale current-state lines (10, 14, 61, 65, 67) per `_scope_in`, then bump the header version
and add ONE changelog row at the TOP of the descending table. Two traps, both fatal if missed: the numbering
GUIDANCE ("next monotonic after the synced tail") is correct policy and must survive — never hard-code a
number; and `channel_identities.username_enc` from `0001` is a DIFFERENT column from the proposed
`persons.username`, so do not "fix" the genuinely-new list on the strength of that grep hit. This is
documentation reconcile, NOT authorization to build user-settings code: Status stays Draft, Implementation
stays Not started, and no DD is resolved. Fail closed: any claim you cannot verify against git → HALT, no
completion marker.

P2 docs-only / manual merge: one FULL-base clean Codex round, verification green, scope-gate READY, then STOP.
Direct review output to the round file; never use `tee`, a degraded review, or a substitute reviewer. Do not
touch code, config, migrations, secrets or schema, and do not invoke another task.

Begin with Pre-flight, then Step 1.
