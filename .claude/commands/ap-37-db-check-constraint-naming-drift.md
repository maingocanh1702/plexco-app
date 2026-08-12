# AP-37 — 27 unnamed CHECK constraints: make `schema.ts` and `pg_constraint` agree

Read canonical `/Users/maingocanh/Projects/Claude template/autopilot/autopilot-prompt-GENERIC.md` and confirm
v0.6.1 or newer. Execute manifest `docs/autopilot-manifests/db-check-constraint-naming-drift.json` — that
manifest is the whole execution contract. The precedent it mirrors is merged code: `0014:44-50` and `:78-80`.

P1 · `schema-migration` · `manual_only` · auto-merge `false` · `2x_clean`. Own worktree at
`.autopilot/worktrees/db-check-constraint-naming-drift`, branch `feat/db-check-constraint-naming-drift`. Never
run from the repo root.

**RUNS IN PARALLEL** with `job-schedule-outbox-dispatch` (AP-35, in flight). Safe only while this slice stays
`packages/db`-only: it holds `schema`, AP-35 holds `retry-liveness`, and the file sets are disjoint. Touching
anything under `apps/bot` collides. It DOES share `schema` with
`docs-session-capacity-chk-landed-reconcile` — those two must run sequentially relative to each other.

## Hard authorization gate

Do not register or edit until all are true:

1. This launcher, the manifest and a strict `CODE_READY` verdict for `db-check-constraint-naming-drift` are
   committed and pushed on `main`, and the verdict's `AUTHORITY_SHA` is an ancestor of `origin/main`.
2. `packages/db/migrations/0014_players_waitlist.sql` on `origin/main` contains `players_status_chk` — verify
   by probe, not by reading this file.
3. `git diff --stat main...HEAD` is empty before branch creation, and the scope gate reports no active `schema`
   holder.

## Preflight

1. Worktree from the current `origin/main` tip; verify both SHAs match.
2. Register with the RUNTIME manifest, never the authored contract. Hand-write
   `.autopilot/state/db-check-constraint-naming-drift/manifest.json` from
   `docs/autopilot-manifests/_TEMPLATE.json`, filling it from the authored contract
   `docs/autopilot-manifests/db-check-constraint-naming-drift.json` and deriving `base_sha` from the live
   `origin/main` tip — never copying `base_sha` out of the authored file. Then:
   `scripts/autopilot-scope-gate register --manifest .autopilot/state/db-check-constraint-naming-drift/manifest.json`
   Verify `.autopilot/state/db-check-constraint-naming-drift/registered-manifest.sha256` EXISTS before
   doing anything else. The gate writes that file only when the manifest carries
   `manifest_schema_version`, which the authored contract is forbidden to carry — pass the authored path
   and it silently skips the hash-lock, raises no error, and still prints `registered:`. No hash-lock file
   means no hash-lock.
3. Create `.autopilot/state/db-check-constraint-naming-drift/codex/`, `regions.log`, `fix-round-count.txt`.
4. `CODEX="${AUTOPILOT_CODEX_BIN:?HALT CODEX_UNAVAILABLE}"`, must be executable.
5. Green baseline before edits — full CI list; `format:check` is `prettier --check .` over the whole repo.
6. Re-verify the live migration tail. `0025` assumes the tail is `0024`. If it moved, renumber the file AND
   update the manifest `scope`/`merged_probe` and the backlog entry BEFORE `scope-gate register`.

## Why this slice exists

`schema.ts` declares 63 named CHECK constraints. A large fraction of them do not exist in a migrated database
under the declared name, because `0002`–`0008` wrote their CHECKs inline and unnamed and PostgreSQL auto-named
them. `sessions_vis_chk` is really `sessions_visibility_check`. This is not a correctness bug — every
constraint fires and enforces correctly under its real name — it is a trap for everything downstream, and it
has already sprung twice: `db-public-visibility-capacity-check`'s PVC-3 found it while writing tests, and
Verdict 25 asserted two of those names as facts "measured" when what was measured was `schema.ts`'s source
text. The autopilot `dep_checks` mechanism cannot catch it: `scope-gate` resolves them with `git show` plus
grep, so for a database object it cannot distinguish DECLARED from APPLIED.

`0014` fixed exactly this for `players` and documented it. Nobody swept the rest.

## Mandatory design probe — four items, and (a) is a scope decision, not a formality

`design_probe_required: true`. Write `.autopilot/state/db-check-constraint-naming-drift/design-probe.md`
pinning the four items in the manifest `_design_probe`, then **STOP for founder confirmation**.

**Item (a) — do not inherit a scope from prose.** The backlog entry that opened this originally said "sessions'
five constraints". That number came from whatever PVC-3 happened to touch, not from a measurement. Static
analysis at `03a134e` puts the real extent at **27 inline CHECKs across 23 tables**. **Measure it yourself and
report your own number** — if your catalog query disagrees with 27, the catalog wins and you say so. Then
decide the boundary: all of them, the money-path subset, or `sessions` only with the rest deferred. A partial
sweep leaves the identical trap live for every table it skips.

**Item (b) — derive the auto-names, never pattern-match them.** PostgreSQL uses `<table>_<column>_check` for a
column constraint and `<table>_check` for a table constraint, **with a numeric suffix on collision** — so a
table with two unnamed table-level CHECKs has `sessions_check` and `sessions_check1`, and which is which
depends on declaration order. Query `pg_constraint` on a freshly migrated database, pin the real
`(conname, pg_get_constraintdef)` pairs, and match each to its `schema.ts` counterpart **by predicate**. If any
live predicate DIFFERS from the `schema.ts` one, that is a separate finding: report it, do not silently rename
over it.

**Item (c) — 13 of the 27 are money-path** (`charges`, `bank_transactions`, `payment_allocations`,
`bank_accounts`). Verify that `migrate.ts` really runs each file in a single transaction rather than assuming
it, then state it — that is what makes DROP-then-ADD atomic and rules out a window where a money table is
unconstrained. Any money-path predicate mismatch is a HALT, not something to reconcile inside a rename slice.

**Item (d) — how the 28th is prevented.** A sweep without a guard has a shelf life; `0014` proved that by
fixing one table and letting the class return. Propose the guard, say what it costs on each future migration,
and say where it fails loudly.

## Boundaries that fail the slice

**No predicate change of any kind.** A rename that also alters what a constraint accepts is a different slice
and a money-path risk. No column, nullability, default or type change. No RLS, role or grant change.
`sessions_public_capacity_chk` from `0024` is already correctly named and must not be touched. Migrations
`0000`–`0024` stay byte-identical. Nothing outside `packages/db`. And `schema.ts`'s declared names are the
**target**, not the thing to change — do not regenerate it from the database.

Run `CND-1..CND-10` against real PostgreSQL. `CND-4` is the row that separates this from a catalog edit: for
each renamed constraint, attempt the violation it exists to reject and assert it still fails. `CND-7` requires
proving the guard **has been seen to fail** — introduce a deliberately unnamed CHECK in the test and assert it
is caught. A guard nobody has watched fail is not a guard. Then two consecutive FULL-base clean Codex rounds on
the same HEAD; apply the five-round and region-thrash breakers. Emit `READY_FOR_MANUAL_MERGE` and stop.

Begin with Pre-flight, then the design probe.
