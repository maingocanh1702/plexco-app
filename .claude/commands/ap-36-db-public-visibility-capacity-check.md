# AP-36 — DB CHECK: a public session may not be unlimited

Read canonical `/Users/maingocanh/Projects/Claude template/autopilot/autopilot-prompt-GENERIC.md` and confirm
v0.6.1 or newer. Execute manifest `docs/autopilot-manifests/db-public-visibility-capacity-check.json` — that
manifest is the whole execution contract. The authority it acts on is
`docs/features/BE/feature_session_management_tech.md:120`, which already names the predicate and its status; do
not re-derive it here.

P1 · `schema-migration` · `manual_only` · auto-merge `false` · `2x_clean`. Own worktree at
`.autopilot/worktrees/db-public-visibility-capacity-check`, branch
`feat/db-public-visibility-capacity-check`. Never run from the repo root.

**RUNS IN PARALLEL** with `job-schedule-outbox-dispatch` (AP-35). Safe only while this slice stays
`packages/db`-only: it holds `schema` + `marketplace`, AP-35 holds `retry-liveness`, and the file sets are
disjoint. Touching anything under `apps/bot` collides immediately.

## Hard authorization gate

Do not register or edit until all are true:

1. This launcher, the manifest and a strict `CODE_READY` verdict for `db-public-visibility-capacity-check` are
   committed and pushed on `main`, and the verdict's `AUTHORITY_SHA` is an ancestor of `origin/main`.
2. `packages/db/schema.ts` on `origin/main` still contains `sessions_vis_chk` and `sessions_slots_chk` — verify
   by probe, not by reading this file.
3. `git diff --stat main...HEAD` is empty before branch creation, and the scope gate reports no active `schema`
   or `marketplace` holder.

## Preflight

1. Worktree from the current `origin/main` tip; verify both SHAs match.
2. `scripts/autopilot-scope-gate register --manifest docs/autopilot-manifests/db-public-visibility-capacity-check.json`
3. Create `.autopilot/state/db-public-visibility-capacity-check/codex/`, `regions.log`, `fix-round-count.txt`.
4. `CODEX="${AUTOPILOT_CODEX_BIN:?HALT CODEX_UNAVAILABLE}"`, must be executable. No PATH `codex`, no substitute
   reviewer.
5. Green baseline before edits — full CI list, `format:check` is `prettier --check .` over the whole repo. Any
   failure is `PREFLIGHT_REGRESSION`.
6. Re-verify the live migration tail. `0024` assumes the tail is `0023`. If it moved, renumber the file AND
   update the manifest `scope`/`merged_probe` and the backlog entry BEFORE `scope-gate register` — never
   renumber from inside the worktree after registering, and never edit an applied migration to tidy numbering.

## Why this slice exists

A row with `visibility='public'` and `slots_max IS NULL` is an invalid state the database currently permits.
PRD E#7 requires public sessions to have finite capacity; `NULL` means unlimited and is valid only for
non-public. Today that is enforced only at the `SessionService` choke-point, so a fixture, a legacy row or a
direct write creates a row nothing rejects.

The reason it matters beyond tidiness: the invalid state is **invisible to event-driven repair**. Marketplace
edge #15 skips such a row and purges its projection — but only when the projector **evaluates** the session.
A bypassing writer flipping an already-projected public session from finite `slots_max` to `NULL` emits no
event, so the projector never revisits it and a stale-but-now-invalid projection **stays publicly visible**.
Unit test #26 places the row into a batch by hand, proving behaviour-when-reached, not that every invalid row
is reached. Verdict 20 recorded this as an `ENABLEMENT_ONLY` gate on the public projector.

## Mandatory design probe — item (a) is a trap that looks like diligence

`design_probe_required: true`. Write `.autopilot/state/db-public-visibility-capacity-check/design-probe.md`
pinning the four items in the manifest `_design_probe`, then **STOP for founder confirmation**.

Item (a): the reflex is `ADD CONSTRAINT ... NOT VALID` followed immediately by `VALIDATE CONSTRAINT`, because
that pairing reads as the careful expand-only idiom. **It is not, here.** `NOT VALID` skips existing rows;
`VALIDATE` then scans them and **fails** if any violate. Both statements in one migration therefore have
exactly the same failure mode as adding the constraint outright — while looking cautious. **Measure first**:
count rows where `visibility='public' AND slots_max IS NULL` in whatever environments are reachable. Then pin
one shape and state its failure mode out loud:

- validate in the same migration, because the count is provably zero **and** a test keeps it zero; or
- add `NOT VALID` only, deferring `VALIDATE` to a later slice with a written remediation step; or
- remediate in-migration — which needs an explicit owner decision about what a public unlimited session should
  **become**, and is not yours to pick.

Do not choose the shape that looks safest. Choose the one whose failure mode you can state in one sentence.

## Boundaries that fail the slice

`slots_max` stays **nullable** — unlimited remains valid for non-public sessions, and narrowing the column is a
different, breaking change. Neither `sessions_vis_chk` nor `sessions_slots_chk` may be weakened or replaced:
add a third constraint alongside them, following the `sessions_*_chk` naming. Migrations `0000`–`0023` stay
byte-identical. No RLS, role or grant change. No `public_sessions` shape change — the eight missing DD-41
discovery fields and the stale `skillLevel` column are real drift, and they are **not this slice**. Nothing
under `apps/bot`.

And do not let "evaluate candidate (c) first" quietly become "the gap is closed". Probe item (d) exists to make
you name what survives the CHECK — in particular, a projection written **before** this migration can still be
serving stale public data, because the constraint prevents new invalid rows but purges nothing.

Run `PVC-1..PVC-8` against real PostgreSQL. `PVC-2` is the one a too-broad constraint breaks: private with
`NULL slots_max` must still succeed. `PVC-6` is the one that catches a migration which would fail on real data
but passes its own suite on an empty table. Then two consecutive FULL-base clean Codex rounds on the same HEAD,
persisted to `codex/round-NN.txt`; apply the five-round and region-thrash breakers. Emit
`READY_FOR_MANUAL_MERGE` and stop — do not merge, do not tear down the worktree.

Begin with Pre-flight, then the design probe.
