# AP-38 — six live CHECK constraints `schema.ts` never declared: close the reverse direction of AP-37

Read canonical `/Users/maingocanh/Projects/Claude template/autopilot/autopilot-prompt-GENERIC.md` — it is the
Level 3 worker contract and its own operational authority is `level3-workflow.md`. Do **not** look for a
version marker or a numbered section in it: earlier launchers told you to "confirm v0.6.1 or newer" and cite
"§0.1 trigger (N)", but the file was rewritten for Level 3 and now carries neither. Its six sections are
_Injected task contract · Role behavior · Start gate · Implementation loop · Terminal states · Non-negotiable
boundaries_. Tracked as backlog `kit-dead-citation-prompt-generic-sections` (P3); it does not change what you
must do here.

Execute manifest `docs/autopilot-manifests/db-undeclared-check-constraints-schema-mirror.json` — that manifest
is the whole execution contract. Read `_owner_decision`, `_direction_note` and `_scope_out` before anything
else. The mechanism it reuses is merged code: `packages/db/migrations/0025_check_constraint_naming_drift.sql`.

P2 · `schema-migration` · `manual_only` · auto-merge `false` · `2x_clean`. Own worktree at
`.autopilot/worktrees/db-undeclared-check-constraints-schema-mirror`, branch
`feat/db-undeclared-check-constraints-schema-mirror`. Never run from the repo root.

**Base is stated as a condition, not as a SHA.** The worktree must sit on an `origin/main` tip that already
contains this launcher and the manifest — which is self-verifying: if you can invoke `/ap-38-…` at all, the
file is in your tree. If it came back `Unknown command`, the worktree predates the launcher; fix it before
anything else with `git fetch origin && git reset --hard origin/main` (safe only while the branch has no
commits — check `git log --oneline main..HEAD` is empty first). A hard-pinned SHA here would go stale the
moment the launcher itself is amended, which is exactly the drift class this repo keeps paying for.

**PARALLELISM.** This slice holds `schema`. `deps-security-bump` (AP-39, eligible 2026-07-30) and
`eslint-10-migration` (eligible 2026-07-31) both hold `build-config` and touch neither `packages/db` nor
`pnpm-lock.yaml` from this side, so either may run alongside. Any slice that also holds `schema` must run
sequentially relative to this one.

## Hard authorization gate

Do not edit until all are true:

1. This launcher and the manifest are committed and pushed on `main`.
2. `git diff --stat main...HEAD` is empty in this worktree before you start.
3. The scope gate reports this slice as the `schema` holder and no other writer owns it.
4. `CODEX="${AUTOPILOT_CODEX_BIN:?HALT CODEX_UNAVAILABLE}"` resolves to an executable. The reviewer is a hard
   gate: if it cannot be invoked, `HALT TOOL_UNAVAILABLE` — never lower the gate to proceed.

## Preflight

1. `git rev-parse HEAD` in the worktree equals `git rev-parse origin/main`, and
   `ls .claude/commands/ap-38-*.md` resolves. If `main` moved after you branched, decide explicitly whether to
   reset or rebase — never continue silently on a stale base.
2. `.autopilot/state/db-undeclared-check-constraints-schema-mirror/` already contains `regions.log` and
   `fix-round-count.txt` from `scope-gate register`. Create `codex/` alongside them.
3. Green baseline BEFORE any edit — full CI list: `pnpm typecheck`, `pnpm format:check` (which is
   `prettier --check .` over the whole repo, not just changed files), `pnpm review:check`, `pnpm lint`,
   `pnpm build`, then the DB suite. Record the numbers; the baseline on `main@f88a2c8` was **561** workspace
   tests (core 132 · db 243 · web 146 · bot 40).
4. Postgres: `docker compose -f infra/docker-compose.yml up -d postgres`. **`psql` is not installed on the
   host** — reach it with `docker exec plexco-postgres-1 psql -U plexco -d <db>`. `pnpm db:bootstrap` shells
   out to `psql` and will fail on this machine; `job_definer` is cluster-global and already provisioned, which
   the green DB suite proves. Tests run with
   `DATABASE_URL_TEST=postgres://plexco:plexco_dev@localhost:5432/plexco_test`.
5. Re-read `packages/db/migrations/` for the live tail. It was `0025` (26 files) on 2026-07-29, so this is
   `0026` — but if it moved, renumber the file AND update the manifest `scope` and the backlog entry before
   you write anything.

## Why this slice exists

Six live CHECK constraints have no `check()` declaration in `schema.ts` at all:
`bank_accounts_webhook_status_check`, `channel_identities_status_check`, `messenger_pages_status_check`,
`oauth_transactions_provider_check`, `provider_connections_status_check`, `zalo_bots_status_check`. All six
enforce correctly in the live database — they were applied inline and unnamed by `0001`, `0003` and `0004` — so
nothing is broken today. The gap is in Drizzle's model, which does not represent them.

**This is the OPPOSITE direction from AP-37 and the two must not be conflated.** AP-37 renamed live
constraints to match names `schema.ts` already declared. This slice adds declarations for live constraints
`schema.ts` never described. AP-37's probe also closed the third and scariest direction by measurement:
**zero** constraints are declared but absent — there is no guard anyone believes is enforced that is actually
missing.

The owner decided (2026-07-29) to declare them under the repo's `_chk` convention and rename the live
constraints to match, in one monotonic migration. The cheaper option — declaring the existing auto-generated
`_check` names so no migration is needed — was considered and **rejected**: it inverts the principle AP-37
spent an entire slice establishing, that the declared name is the target and the database follows, and it
would leave 6 of 73 constraints named by Postgres's default while 67 are named by intent, with no way for a
future reader to tell deliberate from unfixed drift.

## Mandatory design probe — four items, then STOP

`design_probe_required: true`. Write
`.autopilot/state/db-undeclared-check-constraints-schema-mirror/design-probe.md` and **STOP for founder
confirmation before editing any file.** Measure against a real migrated database; do not copy numbers out of
the manifest.

**(a) Is it still exactly six, and are the names unchanged?** The original measurement is dated 2026-07-28,
**before `0025` merged**. `0025` declared these six out of scope — verify that exclusion held rather than
assuming it. If the count or any name has moved, say so and use what you measured.

**(b) The exact predicate of each one, from `pg_get_constraintdef`.** Never from memory and never inferred
from a sibling. Four of the six share one 6-value enum
(`connecting|registered|active|drift|error|revoked`) but **two do not**: `channel_identities_status` is
`(active|inactive)` and `oauth_transactions_provider` is the single value `'sepay'`. Treating all six alike is
precisely how two of them get written wrong while the tests stay green.

**(c) `oauth_transactions` is a DIFFERENT table from `auth_oauth_transactions`.** The former is the legacy
Sepay-only OAuth table (around `schema.ts:967`); the latter is the Google/Facebook login table, which is
already fully declared and correctly named. Read both definitions. Do not match on name.

**(d) The migration tail and the two test-count constants.** `MIGRATION_COUNT` is declared at
`packages/db/src/migrate.test.ts:34` and must stay in sync with `rls-invariants.test.ts`. Both need updating.

**If any measurement disagrees with anything written here or in the manifest, the measurement wins and you
record the disagreement.** This repo has already produced three successive wrong constraint counts — 27, then
47, then the correct 40 — and each one read as fact because it was specific.

## Boundaries that fail the slice

- **No predicate change.** Every rename must preserve `pg_get_constraintdef` byte-for-byte.
- **No `DROP CONSTRAINT` + `ADD CONSTRAINT`.** Use `ALTER TABLE … RENAME CONSTRAINT`. AP-37's codex round-01
  established why: `ADD CONSTRAINT` re-validates the predicate against every row while holding
  `ACCESS EXCLUSIVE`, and it forces you to hand-transcribe the predicate, which `RENAME` removes entirely.
  `UCC-9` greps for this — a single `ADD CONSTRAINT` fails the slice.
- **No new constraint.** All six already exist. Creating one is a behaviour change wearing a cleanup's
  clothes.
- **Do not touch** the 40 constraints `0025` renamed or the 27 that were always correct.
- No column, nullability, default, type, RLS, role or grant change. No edits to applied migrations
  `0000`–`0025`. No `--no-verify`, no source files outside the manifest `scope`.

## Acceptance and terminal state

`UCC-1..UCC-10` in the manifest are the contract. Two deserve emphasis: **`UCC-5`** closes **both** directions
permanently — every declared `check()` has a live constraint with the same predicate **and** every live CHECK
has a declaration, with the counts balancing — and **`UCC-6`** requires that guard to have been *seen to
fail*, by temporarily removing one declaration and observing a red test. A guard nobody has watched fail is a
guard nobody has tested.

Verify with the full CI list, then the mandatory independent review: `scripts/codex-review-pin.sh`, two
consecutive clean FULL-base rounds on the same HEAD. Loop breakers: `MAX_ROUNDS` 5, `REGION_THRASH` 3 rounds
touching the same region. End at **`READY | AWAIT | HALT`** and write the terminal marker into the state dir.
**Do not merge and do not push to `main`** — the owner merges via `scripts/ap-merge.sh`, which now runs
`autopilot-backlog-reconcile --fix` after push so the backlog status cannot rot.
