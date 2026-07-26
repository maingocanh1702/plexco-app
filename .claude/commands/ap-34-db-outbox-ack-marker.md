# AP-34 — Job-infra slice 2a: completion/ack marker for `outbox_events`

Read canonical `/Users/maingocanh/Projects/Claude template/autopilot/autopilot-prompt-GENERIC.md` and confirm
v0.6.1 or newer. Execute manifest `docs/autopilot-manifests/db-outbox-ack-marker.json` — that manifest is the
whole execution contract. The DB contract it extends is merged code:
`packages/db/migrations/0022_job_claim_lease_core.sql` plus `docs/autopilot-db-job-claim-lease-core.md`
§4.2/§4.3. Do not re-author either here.

P1 · `schema-migration` · `manual_only` · auto-merge `false` · `2x_clean`. Own worktree at
`.autopilot/worktrees/db-outbox-ack-marker`, branch `feat/db-outbox-ack-marker`. Never run from the repo root.

## Why this slice exists

`0022:166-181` is a `HARD BLOCKING REQUIREMENT` written by name for the dispatcher slice. Read it verbatim
before anything else — if its text has changed on synced main, the premise has changed and you HALT. In short:
the five-minute lease is crash recovery only, a processed event has no ack path, so its lease expires, it looks
like a crashed claim, and it is reclaimed forever. Reclaim runs before new claims and `ORDER BY created_at`
prefers the oldest, so done events starve newer ones. `job_audit_events` grows with every cycle because 0022
deliberately has no `UNIQUE(job_id)`.

## Preflight

1. Worktree from the current `origin/main` tip; verify both SHAs match.
2. `scripts/autopilot-scope-gate register --manifest docs/autopilot-manifests/db-outbox-ack-marker.json`
3. Create `.autopilot/state/db-outbox-ack-marker/codex/`, `regions.log`, `fix-round-count.txt`.
4. `CODEX="${AUTOPILOT_CODEX_BIN:?HALT CODEX_UNAVAILABLE}"`, must be executable. No PATH `codex`, no substitute
   reviewer.
5. Green baseline before edits — `pnpm install --frozen-lockfile`, Postgres up, then
   `DATABASE_URL_TEST=... pnpm -w test` and the full CI list `typecheck`, `format:check`, `review:check`,
   `lint`, `build`. Run all of them; `format:check` is `prettier --check .` over the whole repo. Any failure is
   `PREFLIGHT_REGRESSION`.
6. Re-verify the live migration tail. `0023` assumes the tail is `0022`. If it moved, renumber the file AND
   update the manifest `scope`/`merged_probe` and the backlog entry BEFORE `scope-gate register` — never
   renumber from inside the worktree after registering, and never edit an applied migration to tidy numbering.

## Mandatory design probe — the granularity question is the point

`design_probe_required: true`. Write `.autopilot/state/db-outbox-ack-marker/design-probe.md` pinning the four
items in the manifest `_design_probe`, then **STOP for founder confirmation**. Item (b) is why this gate exists:

> An outbox event can fan out to MANY projectors, and `job_prepare_projector_delivery` is per
> `(event, projector)`. Is an event acked when the dispatcher has prepared delivery for ONE projector, or only
> when EVERY registered projector has one?

Acking on the first prepare is **correct today** — exactly one placeholder projector exists — and **silently
wrong** the moment a second projector is registered. Today's shape hides the difference, so do not pick the
convenient answer. If the answer is fan-out completion, state where the registry of required projectors lives,
because it does not exist yet; if that registry is a prerequisite, say so and HALT rather than inventing one.

Also record measured facts: the exact text of `outbox_events_lease_shape_chk` and
`outbox_events_producer_lease_boundary_chk`, both partial index definitions (`idx_outbox_unclaimed`,
`idx_outbox_expired_lease`), and `claim_outbox_batch`'s reclaim-then-claim ordering. Any mismatch with the
manifest → `HALT-DESIGN_UNFIT.txt`.

## Boundaries that fail the slice

Neither existing CHECK may be weakened or dropped — extend, never replace. `app_worker` keeps EXECUTE-only
access with zero direct DML on `outbox_events`; the ack function follows the 0022 pattern exactly, owned by
`job_definer` with a fixed `search_path`, `REVOKE ALL FROM PUBLIC`, and `GRANT EXECUTE` to `app_worker` only.
Remember 0022's own trap: `CREATE OR REPLACE` does NOT change a function's owner, so re-owning
`claim_outbox_batch` must be explicit if you replace it. Migrations `0000`–`0022` stay byte-identical. No
worker, queue, handler, cron, producer or projector wiring — that is slice 2b.

Run `OAM-1..OAM-10` against real PostgreSQL with a real `app_worker` seat. `OAM-2` is the row this slice exists
for: seed several acked-and-expired older events plus one newer unacked event, call `claim_outbox_batch`, and
the newer event must be returned. Then two consecutive FULL-base clean Codex rounds on the same HEAD, persisted
to `codex/round-NN.txt`; apply the five-round and region-thrash breakers. Emit `READY_FOR_MANUAL_MERGE` and
stop — do not merge, do not tear down the worktree, do not start slice 2b.

Begin with Pre-flight, then the design probe.
