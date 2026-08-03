# AP-45 — dd38-dd86-chat-schema-core: root chat-schema migration slice

`chat_channels`/`chat_members`/`chat_messages` final shape + DM read adapter + RLS/policies +
read-helper owner/grants + invariant tests. Root of the DD-38/DD-86 chat schema tree.

## ⛔ Do not register yet — read this section first

This slice hard-depends on two prerequisite slices that **do not exist as their own backlog entry,
manifest, or launcher today**: `chat-definer-role-provisioning` (creates the `chat_definer` role) and
`chat-dm-safety-authority-core` (creates `dm_safety_enabled()`/`chat_pair_blocked()`/
`assert_dm_allowed()`). This is not a collision-avoidance dependency — **this slice's own migration
calls `dm_safety_enabled()` and does `ALTER FUNCTION ... OWNER TO chat_definer`**, so it cannot even
apply without both landed first. Before doing anything else:

1. `grep -n "chat-definer-role-provisioning\|chat-dm-safety-authority-core" docs/autopilot-backlog.md`
   — if this returns nothing, **stop**. Author and land those two slices first (slice 1's exact
   executable packet is already pinned at `docs/proposals/in-app-chat-primary-player-surface-plan-
   2026-07-27.md` §9.2 — copy it, don't re-derive it).
2. `ls infra/postgres-init/` — must show a `chat_definer` bootstrap file (slice 1's deliverable), not
   just `01-job-definer.sql`.
3. `git log --all --oneline | grep -i "dm_safety_enabled\|chat_pair_blocked\|assert_dm_allowed"` on
   `origin/main` — must show a merged commit (slice 2's deliverable).

If any of these fail, this launcher is not runnable. See
`docs/autopilot-dd38-dd86-chat-schema-core.md` §9/§10 for the full readiness verdict
(`NOT_CODE_READY`) and the exact blockers.

## Read before you write

1. `docs/autopilot-dd38-dd86-chat-schema-core.md` — the task contract. Read §4 (dependency graph),
   §5 (exact DDL to copy verbatim), §6 (migration numbering — provisional, re-derive), §7 (negative
   scope), §9 (verdict — currently `NOT_CODE_READY`, your first job on resuming this slice is to
   re-run §9's gates now that the dependencies you just verified above have landed).
2. `docs/autopilot-manifests/dd38-dd86-chat-schema-core.json` — read the whole file.
   `depends_on` names the two prerequisites; `dep_checks` is **empty on purpose** — you must fill it
   with real `base_sha`/`landed_sha`/`symbol` proof for both, following the exact shape used in
   `docs/autopilot-manifests/db-tenants-authz-grant-security-definer.json`'s own `dep_checks` entry,
   before `register` will accept this manifest.
3. `docs/features/BE/feature_inapp_chat_tech.md` (v0.23) lines 127-249 and 400-603 — the Reviewed
   target DDL this slice's migration must match verbatim. Do not paraphrase or "improve" it; any
   deviation from this spec is an owner question, not an implementation choice.
4. `packages/db/migrations/0009_rls_policies_grants.sql` — the tenant-only RLS idiom this slice
   extends with a **new** person-scoped GUC (`app.person_id`) — the first one in this codebase.
5. `packages/db/migrations/0012_auth_functions.sql` — general SECURITY DEFINER idiom (REVOKE ALL FROM
   PUBLIC, then GRANT EXECUTE TO app, fixed search_path). The chat spec's own helpers additionally use
   `STABLE` and `SET search_path = pg_catalog, public` (pure predicate reads, not mutations) — follow
   the chat spec's exact form, not 0012's, where they differ.
6. `packages/db/src/tenant.ts` — `withTenant`'s `set_config('app.tenant_id', $1, true)` pattern. Your
   new test file's local `app.person_id` setter should mirror this exactly; do not add a new exported
   helper to this file (see negative scope).

## The three things that are easy to get subtly wrong

**Do not extend `rls-invariants.test.ts` or `auth.test.ts`.** Both are already 4000+ lines. Add a new
file, `packages/db/src/chat-schema-invariants.test.ts`. Its generic "CND" constraint-naming-drift
guard in `rls-invariants.test.ts` already covers new tables automatically — **provided** every
CHECK/UNIQUE/FK in your `schema.ts` mirror uses an explicit declared name via Drizzle's
`check()`/`unique()`/`foreignKey()` builders. An anonymous constraint either drifts from the
migration's real name or silently escapes that guard.

**Do not add a `withPerson` helper to `tenant.ts`.** The B3 budget exception for this slice caps it at
3 modules (migration + schema mirror + one focused test). Set `app.person_id` inline in the new test
file's own setup, the same way `withTenant` sets `app.tenant_id` — do not promote it to a shared
export as a 4th module.

**Do not grant `app` any mutation on the three tables.** The Reviewed spec's own closing lines are
`REVOKE INSERT, UPDATE, DELETE ON chat_channels, chat_members, chat_messages FROM app; GRANT SELECT
ON chat_channels, chat_members, chat_messages TO app;` — `app` is read-only via RLS. Mutation has no
owner until `chat-shared-message-command-core` (slice 7) and `chat-dm-lifecycle-command-core` (slice
8) land their SECURITY DEFINER RPCs. If you find yourself adding an `INSERT`/`UPDATE`/`DELETE` grant
here, stop — that is a different, later slice.

## Registration mechanics

- `register` requires `HEAD === base_sha` exactly. Register before your first commit, and only after
  the ⛔ section above is fully satisfied.
- The runtime manifest is hash-locked at `register`. Generate it into
  `.autopilot/state/dd38-dd86-chat-schema-core/manifest.json` from
  `docs/autopilot-manifests/_TEMPLATE.json`, copying this slice's authored contract into it —
  including the now-filled `dep_checks`.
- The migration filename `0029_chat_schema_core.sql` in `scope` is a **provisional placeholder**
  (contract §6). **Re-verify the live tail with `ls packages/db/migrations/*.sql | sort | tail -5`
  before creating anything** — by the time this slice's dependencies have landed, at least one more
  migration (slice 2's) will have consumed a number this contract could not predict exactly. Correct
  `scope` to the real number and re-register rather than picking whatever is free.
- `ap-finish.sh` runs from the repository root, not from the worktree it removes.

## Steps

1. Verify repo identity, that `main == origin/main`, and pin `base_sha` from live HEAD.
2. Re-verify both prerequisite slices are merged (see ⛔ above) and re-derive the live migration tail.
   Fill `dep_checks` in the authored manifest with real proof for both dependencies before doing
   anything else.
3. Create the worktree and branch `feat/dd38-dd86-chat-schema-core`, register the scope gate, then
   create `regions.log` and `fix-round-count.txt`.
4. Write the migration first, exactly matching contract §5.1. Apply it and confirm all three tables,
   both helper functions, all five triggers, and the closing REVOKE/GRANT lines exist before touching
   TypeScript.
5. Mirror the three tables into `packages/db/schema.ts`, every constraint explicitly named (see
   "easy to get wrong" above).
6. Add `packages/db/src/chat-schema-invariants.test.ts`: reuse `setupRlsTestContext`/`withTenant`;
   define a local `app.person_id` setter inline. Cover the full acceptance matrix in contract §8 —
   the negative-proof rows (cross-tenant, cross-channel, cross-person DM, impersonation via
   `WITH CHECK`, direct DML rejection) are the actual point of this slice; do not ship only
   happy-path coverage.
7. Fix the mechanical literal(s) in `packages/db/src/migrate.test.ts` that a new migration file
   forces (migration count / tail filename) — nothing else in that file should change.
8. Document `chat_current_is_member` and `dm_current_read_allowed` in `packages/db/README.md`,
   following the file's existing per-migration convention.
9. Run the declared verification — all `verification.focused` commands, then the full canonical list
   including the real-Postgres suite.
10. Run the full gate: `scripts/autopilot-scope-gate ready --manifest
    .autopilot/state/dd38-dd86-chat-schema-core/manifest.json`. 2 consecutive clean code-review rounds
    AND 1 clean security round (this slice opens the first RLS boundary on conversation content and
    the first person-scoped RLS GUC in this codebase — do not skip the security round, and make sure
    it specifically checks the two-policy-OR structure and the `WITH CHECK` impersonation guard).
11. Stop at `READY | AWAIT | HALT`. Do not merge. Do not implement any post-root slice (channel
    lifecycle, capability registry, send/mark-read, moderation, DM lifecycle) even if it looks like a
    small addition. Report the exact merge command inputs.

## Negative scope — do not cross these even if it looks trivial

No `create_dm`, `send_chat_message`, `mark_read`, edit/delete/search/reaction/moderation RPC. No HTTP
route or SSE topic. No `chat_message_mentions`/`chat_message_reactions`/`chat_message_revisions`/
`chat_notification_preferences`/`chat_notification_dispatches`/`chat_channel_mutes`/
`chat_moderation_audit`/`chat_command_receipts` tables. No DD-56 capability registry/grants/audit. No
media/object-storage table. No Assistant/KB table or route. No creation of the `chat_definer` role
(consume only). No `CREATE OR REPLACE` or re-ownership of `dm_safety_enabled`/`chat_pair_blocked`/
`assert_dm_allowed` (call only). No `INSERT`/`UPDATE`/`DELETE` grant to any role on any of the three
tables. No new exported helper on `tenant.ts`. No edit to `rls-invariants.test.ts` or
`docs/autopilot-backlog.md`.

If any acceptance row in contract §8 turns out to need a file outside this slice's scope, or if the
two-policy-OR structure admits a row it should not, HALT and report — either means this slice's
premise needs re-deriving, an owner question, not an implementation choice.
