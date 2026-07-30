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

## Task contract

Resolved per `level3-workflow.md` §2 and §3. Earlier launchers (AP-33…AP-37) carried this information as
prose only; declaring it as the canonical block is the point of the Level 3 upgrade, because a field that is
absent is visibly absent whereas a field buried in a paragraph is not.

**This slice deliberately runs the pre-v2 manifest shape — do not "fix" that.** `manifest_schema_version:
level3-operational-v2` is not a label you add to the tracked manifest: the validator fail-closes unless the
manifest physically sits at `.autopilot/state/<feature>/manifest.json` (`autopilot-review-readiness.mjs:297-300`),
and `.autopilot/*` is gitignored. v2 is a **runtime, per-run** artifact copied from the authored contract; the
file under `docs/autopilot-manifests/` is the authored contract and is a different role, not an older version
of the same thing. Flipping the string here would `HALT CONTRACT_INVALID` at `register`.
Two further reasons not to touch it mid-flight: this slice already registered under the old shape, so `ready`
would take the v2 branch while `register` left no `registered-manifest.sha256` snapshot; and the
review-readiness gate is **already active anyway** — `autopilot-scope-gate:335` sets `REVIEW_REQUIRED=1`
whenever `scripts/autopilot-review-readiness.mjs` exists on the base ref, regardless of schema version.
First v2 run is assigned to AP-39; the full measurement is recorded in backlog
`manifest-v2-runtime-adoption`.

```text
LEVEL3_WORKFLOW: required
TASK_START_STATE: new_after_template_effective

TASK_ID: plexco-app:db-undeclared-check-constraints-schema-mirror
OUTCOME: schema.ts and pg_constraint agree in BOTH directions for all CHECK constraints, and a test makes
  that agreement impossible to break silently again.
REPOSITORY_AND_BASE: plexco-app · main · base = the origin/main tip containing this launcher (condition, not
  a pinned SHA — see the base note above)
CONTEXT_SOURCES:
  - docs/autopilot-manifests/db-undeclared-check-constraints-schema-mirror.json  (execution contract)
  - packages/db/migrations/0025_check_constraint_naming_drift.sql               (mechanism precedent)
  - packages/db/migrations/0014_players_waitlist.sql                           (first fix of this class)
  - packages/db/schema.ts · packages/db/src/{rls-invariants,migrate}.test.ts
  - docs/slice-readiness-verdicts.md Verdict 27                                 (why counts are distrusted)
  - live pg_constraint / pg_get_constraintdef                                   (the only ground truth)
APPLICABLE_SKILLS: none — no output-format or domain skill applies; this is SQL + Drizzle + tests.
SCOPE: exactly the manifest `scope` array (6 paths). Nothing else.
NEGATIVE_SCOPE: see "Boundaries that fail the slice" below — predicate change, DROP+ADD, creating a
  constraint, the 40 renamed by 0025, the 27 always-correct, any column/type/RLS/role/grant change, any
  edit to applied migrations 0000-0025, any file outside `scope`.
RISK: P2
AUTONOMY_MODE: supervised
MODEL_POLICY: this session is planner and single writer; independent reviewer is
  scripts/codex-review-pin.sh (pinned wrapper, not a Claude sub-agent — a self-review does not satisfy the
  gate). Reviewer unavailable ⇒ HALT TOOL_UNAVAILABLE.
SANDBOX_AND_PERMISSIONS: local only. Network: none required beyond an already-running local Postgres.
  Secrets: none. External side effects: none. No push to main, no merge, no branch deletion.
HUMAN_DECISIONS_REQUIRED: one, already made — `_chk` naming + a rename migration over the cheaper
  no-migration option (owner, 2026-07-29; recorded in the manifest `_owner_decision`). One more is
  pending by construction: founder confirmation of the design probe before any edit.
SLICE_GRAPH: single slice, no fan-out. depends_on: []. Runs after 0025 (merged) but does not depend on it
  as code — 0025 only surfaced the finding.
WORKTREE_PLAN: .autopilot/worktrees/db-undeclared-check-constraints-schema-mirror on branch
  feat/db-undeclared-check-constraints-schema-mirror. One worktree, one writer. Root worktree stays on main.
VERIFICATION:
  focused:   the new UCC tests in packages/db/src/rls-invariants.test.ts + migrate.test.ts
  canonical: pnpm typecheck · pnpm format:check · pnpm review:check · pnpm lint · pnpm build · DB suite
             with DATABASE_URL_TEST (baseline 561 workspace tests on main@f88a2c8)
  e2e:       none — this crosses no service or network boundary
  diff:      inspect `git diff main...HEAD` against the manifest `scope` before declaring READY
CODE_REVIEW: required · scripts/codex-review-pin.sh · 2 consecutive clean FULL-base rounds, same HEAD
SECURITY_REVIEW: not required — no auth, secret, permission, money, external input or deployment surface.
  RENAME CONSTRAINT is a catalog metadata change and alters no predicate. If the probe finds otherwise
  (e.g. a money-path table in the set), that judgement is void: add a security round and say why.
BUDGETS: fix_rounds_max 5 · region_thrash 3 · no wall-clock or cost ceiling set by the owner
STOP_CONDITIONS: MAX_ROUNDS · REGION_THRASH · SCOPE_OR_BASE_DRIFT · TOOL_UNAVAILABLE ·
  MATERIAL_CONTEXT_OR_DECISION_MISSING · plus the manifest `_stop_conditions` (count ≠ 6, a name moved, a
  pg_get_constraintdef differs before/after, UCC-5 counts not balancing, a pre-existing violating row)
DELIVERABLES: migration 0026 · schema.ts declarations · UCC-1..UCC-10 tests · updated MIGRATION_COUNT in
  both test files · design-probe.md · codex round logs · terminal marker file
```

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
consecutive clean FULL-base rounds on the same HEAD. A review with any actionable finding is not clean; a
clean review of an empty diff is not evidence. Loop breakers: `MAX_ROUNDS` 5, `REGION_THRASH` 3 rounds
touching the same region, and findings spreading across the design ⇒ stop and re-slice rather than keep
patching.

End at exactly one of **`READY | AWAIT | HALT`** and write the marker file with the name `level3-workflow.md`
§9 specifies, into `.autopilot/state/db-undeclared-check-constraints-schema-mirror/`:

| Terminal | File | When |
|---|---|---|
| `READY` | `READY.txt` | Scope, verification and both clean review rounds complete. Report outcome, changed files, test/build/review evidence, remaining risks, and the exact merge action the owner must take. |
| `AWAIT` | `AWAIT-FOUNDER-<reason>.txt` | One concrete missing decision/authority/context that materially changes the result. Preserve work, stop writing, give ONE recommended option with trade-offs and a binary resume condition. The design-probe stop uses this. |
| `HALT` | `HALT-<REASON>.txt` | Hard safety/scope/authority/tool/loop-breaker failure. State exact reason, forensic state, and the condition for a fresh successor task. Do not keep patching after HALT. |

Use these exact names. The repo currently has both `AWAIT-FOUNDER-ready-for-manual-merge.txt` (correct shape)
and `READY_FOR_MANUAL_MERGE.txt` (matches no shape) from earlier slices — that inconsistency is why the name
is pinned here rather than left to judgement.

**Do not merge and do not push to `main`** — the owner merges via `scripts/ap-merge.sh`, which now runs
`autopilot-backlog-reconcile --fix` after push so the backlog status cannot rot.

Then close the learning loop (`level3-workflow.md` §10): the discovered defect is already becoming a
regression test via `UCC-5`/`UCC-6`, so state explicitly in the terminal report **what context or guardrail
was missing** that let six constraints stay undeclared through 25 migrations — that sentence is the
deliverable, not a formality.
