# AP-55 — tenant-capability-authority-core--m01-capability-schema-migration: DD-56 registry / grants / audit storage

Milestone 1 of 3 for `tenant-capability-authority-core` (plan: `ap3/features/tenant-routing-authz/PLAN.md`,
merged PR #30). Creates the three DD-56 tables the `authorize(action, actor, target)` primitive (M2) will
read and the seven-route switch (M3) will depend on. Schema only — **no authorization decision is made in
this slice.**

```text
LEVEL3_WORKFLOW: required
TASK_START_STATE: new_after_template_effective
AUTONOMY_MODE: supervised
RISK: P1 (schema-migration)
```

## Read before you write

1. `docs/autopilot-manifests/tenant-capability-authority-core--m01-capability-schema-migration.json` —
   the slice contract. Read the whole file: `_scope_note` (two test files PLAN.md forgot),
   `_design_decision_non_delegable_storage_rejection` (one additive trigger the pinned DDL lacks),
   `negative_scope`, `verification`, `stop_conditions`.
2. `ap3/features/tenant-routing-authz/PLAN.md` — §"What already exists", §Milestone 1, §"Owner answers"
   (2026-09-20: seed exactly 17 keys; DD-51/DD-53 are NOT registry rows).
3. `docs/features/BE/feature_tenant_routing_authz_tech.md` — `:119-171` the pinned DDL (copy verbatim,
   then add what §"Additions" below lists), `:387-407` the action matrix that IS the seed, `:525-530`
   the test-ownership fence (which rows are yours).
4. `packages/db/migrations/0009_rls_policies_grants.sql:52-54` — the `tenant_isolation` policy body to
   reuse for both tenant-scoped tables (the spec pins ENABLE/FORCE/REVOKE only; you author the policy).
5. `packages/db/migrations/0022_job_claim_lease_core.sql:146-157` — the append-only trigger precedent.
6. `packages/db/src/migrate.ts` header comment — sha256 guard, ordinal rules, why you never renumber.
7. `packages/db/src/test-harness.ts` + `packages/db/src/authorization.test.ts` — the harness and the
   local `seedTenant()` pattern your test file follows. Do not build a new harness.
8. `docs/autopilot-manifests/chat-dm-safety-authority-core.json` — the last DB slice of this exact
   shape (migration + schema mirror + invariant test + literal bumps); its `_scope_note` is why
   `migrate.test.ts` and `rls-invariants.test.ts` are in your scope.

## Additions to the pinned DDL (contract-authorized, not deviations)

- **RLS policy bodies** for `tenant_capability_grants` and `tenant_capability_grant_audit`:
  `CREATE POLICY tenant_isolation ON <table> USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (same)`.
- **Non-delegable storage rejection** (BE spec `:527`, test #25 storage half): trigger
  `forbid_non_delegable_capability_grant()` `BEFORE INSERT OR UPDATE ON tenant_capability_grants`,
  raising `ERRCODE = 'check_violation'` when the referenced action's `delegable` is not `true`.
- **Seed**: exactly these 17 `action_key`s, with `co_admin_default` / `delegable` / `authority_class`
  read off the matrix rows — `session.manage content.manage member.manage_routine member.ban money.read
  money.mark_paid money.correct money.refund money.waive_or_void bank_account.manage
  connector.secret_manage billing.manage chat.channel.manage chat.channel.post_restricted
  chat.message.moderate chat.member.mute role.manage`. `authority_class` mapping: preset rows →
  `preset`; the six delegable rows → `owner_grantable`; `role.manage` → `owner_only`. Nothing gets
  `platform_admin_only` — those two matrix rows are not seeded (owner decision).

## The four things that are easy to get subtly wrong

**Do not grant `app` anything it must not have.** `tenant_capability_actions`: `REVOKE ALL ... FROM
PUBLIC, app, app_worker, readonly` — no DML, no SELECT for runtime roles; M2's SECURITY DEFINER reads it.
`tenant_capability_grants`: `REVOKE INSERT, UPDATE, DELETE FROM app` — the writer command is a
follow-up task, not this slice. Your test asserts both with `has_table_privilege`.

**Do not leave FORCE RLS without a policy and call it "secure".** With FORCE and no policy the owner
role is locked out of its own table too and every later migration/test that touches it fails in a
confusing way. Author the policy, then prove isolation with two tenants under `app.tenant_id`.

**Do not bump the literals by hand-editing a number you did not read.** `migrate.test.ts:44`
`MIGRATION_COUNT` and `rls-invariants.test.ts` (`:70`, `:73`, `:1755`, `:1760`, `:2038`, `:4517-4520`)
pin `47` / `0046_rate_limit_bounded_cleanup.sql`. Re-read them at implementation time — the line
numbers above are a 2026-09-20 measurement. Nothing else in those files changes.

**Do not write decision tests.** Rows #21–#24, #26–#28, #32 test `authorize()` — that is M2. If you
find yourself importing anything named `authorize`, stop. Your file proves: registry grant posture,
grants RLS isolation + no direct `app` write, non-delegable rejection, audit immutability (`UPDATE` and
`DELETE` both raise `restrict_violation`), the partial-unique active-grant index, the
`expires_at > granted_at` check, and that the seeded registry is **exactly** the 17-key set (assert the
set, not just the count).

## Registration mechanics

- Verify `main == origin/main`; pin `base_sha` from `git rev-parse origin/main` (full SHA, never a
  short one — the review wrapper rejects it).
- `register` requires `HEAD === base_sha`. Register before your first commit.
- Generate the runtime manifest into
  `.autopilot/state/tenant-capability-authority-core--m01-capability-schema-migration/manifest.json`
  from `docs/autopilot-manifests/_TEMPLATE.json`, copying the authored contract into it.
- `0047` is **provisional**: `ls packages/db/migrations/*.sql | sort | tail -3` first. If the number
  is taken, correct `scope` in both manifests and re-register — never renumber below an applied file.
- Worktree `.autopilot/worktrees/tenant-capability-authority-core--m01-capability-schema-migration`,
  branch `feat/tenant-capability-authority-core--m01-capability-schema-migration`, one writer.
- Tests run natively with `NODE_ENV=test` and
  `DATABASE_URL_TEST=postgres://plexco:plexco_dev@localhost:5432/plexco_test` against docker
  `plexco-postgres-1`. Drop leftover `plexco_*` scratch databases before and after the canonical run.
- `ap-finish.sh` runs from the repository root, not from the worktree it removes.

## Steps

1. Verify repo identity, `main == origin/main`, pin `base_sha`. Re-derive the migration tail.
2. Create worktree + branch, register the scope gate, create `regions.log` and `fix-round-count.txt`.
3. Write the migration first: pinned DDL verbatim (`:119-171`) + the additions above, header comment
   citing DD-56 amendment #3 clause 5 and the owner's 17-key decision. Apply it and confirm all three
   tables, two trigger functions, both policies, the partial index and 17 seed rows exist before touching
   TypeScript.
4. Mirror the three tables into `packages/db/schema.ts`, pattern-matched against `tenant_admins`
   (`schema.ts:787-801` at authoring), every constraint explicitly named (the generic CND guard in
   `rls-invariants.test.ts` needs it).
5. Add `packages/db/src/tenant-capability-schema.test.ts` covering the full list in §"four things" above.
   Negative-proof rows are the point of this slice; do not ship happy-path only.
6. Bump the migration-count/tail literals in `migrate.test.ts` and `rls-invariants.test.ts`. If a
   generic per-table guard in `rls-invariants.test.ts` fails for the new tables, satisfy it in the
   migration/schema — do not weaken the guard.
7. Document the three tables + two triggers in `packages/db/README.md` per its per-migration convention.
8. Run every `verification.focused` command, then the full `canonical` list including the real-Postgres
   suite. `git status --porcelain --untracked-files=all` must be empty afterwards (readiness halts
   `WORKTREE_DIRTY` on untracked files too).
9. Commit, then run the gate: `scripts/autopilot-scope-gate ready --manifest
   .autopilot/state/tenant-capability-authority-core--m01-capability-schema-migration/manifest.json`.
   2 consecutive clean code-review rounds AND 1 clean security round, every round with
   `--base <full base_sha>` (never `HEAD^`). Ask the security round specifically about: the exact grant
   set on all three tables, both RLS policy bodies, the non-delegable trigger, audit immutability.
10. Stop at `READY | AWAIT | HALT`. Do not merge. Do not start M2 in this worktree.

## Decisions already made — do not AWAIT on these

| # | Question | Decision |
|---|---|---|
| D1 | Seed DD-51 / DD-53 rows? | No. Exactly 17 tenant-scoped keys (owner, 2026-09-20, PLAN.md §Owner answers). |
| D2 | Storage-level rejection of non-delegable grants? | Yes, trigger (contract `_design_decision_non_delegable_storage_rejection`). |
| D3 | RLS policy body for the two tenant tables? | `0009` `tenant_isolation` idiom, both USING and WITH CHECK. |
| D4 | `migrate.test.ts` / `rls-invariants.test.ts` in scope? | Yes, literal bumps only. |

A genuinely new question (e.g. a generic guard that cannot be satisfied without touching a file outside
scope) is an `AWAIT` with one recommended option — not a scope expansion.
