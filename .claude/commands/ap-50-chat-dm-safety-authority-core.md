# AP-50 — chat-dm-safety-authority-core: DD-55 DM safety authority slice

`chat_dm_safety_config`/`chat_blocks`/`chat_reports`/`chat_dm_safety_audit` storage +
`dm_safety_enabled()`/`chat_pair_blocked()` pure predicates + `assert_dm_allowed()` fail-closed gate.
Slice 2 of the DD-38/DD-86 chat tree — the DM-safety authority `dd38-dd86-chat-schema-core` (root,
slice 3) hard-depends on.

## Before you register — verify the one hard dependency is still true

This slice's own migration does `ALTER FUNCTION ... OWNER TO chat_definer` on all three functions it
creates — that mechanically requires the `chat_definer` role to already exist. It does, as of this
launcher's authoring (2026-08-05): `infra/postgres-init/02-chat-definer.sql` merged at
`286f48bbbd5b9f41c3e63e5f201ecfd276706bff` (chat-definer-role-provisioning). Re-verify before doing
anything else:

1. `ls infra/postgres-init/` — must show `02-chat-definer.sql`.
2. `git log --oneline --all | grep -i chat.definer` — must show `286f48b` (or later) on `origin/main`.

If either fails, STOP — do not proceed with a stubbed/mocked role.

## Read before you write

1. `docs/autopilot-chat-dm-safety-authority-core.md` — the task contract. Read §5 (design probe — 14
   Tier-1 decisions with rejected alternatives, read this before you second-guess any table/function
   shape), §6.1 (exact DDL to copy verbatim), §7 (migration numbering — provisional, re-derive), §8
   (negative scope), §9 (acceptance matrix — your test file's actual job), §11 (notes for you
   specifically).
2. `docs/autopilot-manifests/chat-dm-safety-authority-core.json` — read the whole file, especially
   `dep_checks` (already filled with real proof — this slice's one dependency is merged, unlike its
   root sibling's manifest which had to leave `dep_checks` empty).
3. `docs/features/BE/feature_inapp_chat_tech.md` (v0.23) — DD-55 policy text (line 36, "DD-55 hard
   gate"), the "DD-55 design-probe gates" section, and lines 522-609 (root's own `dm_current_read_allowed`
   / `create_dm` / `send_chat_message` / `mark_read` — the exact call sites your three functions must
   satisfy; you are not writing these functions, but every one of your signatures is dictated by how
   they call you).
4. `docs/autopilot-dd38-dd86-chat-schema-core.md` §5.1 — root's own pinned DDL, which contains the
   verbatim `dm_current_read_allowed` body calling `dm_safety_enabled()`/`chat_pair_blocked()`. Your
   function signatures must match exactly what that body calls: `dm_safety_enabled()` (no args),
   `chat_pair_blocked(uuid, uuid)`.
5. `packages/db/migrations/0012_auth_functions.sql` — `rate_limit_check(bucket, limit, window)`, the
   canonical BL-SEC-5 shared counter you reuse (do not build a new rate table), and the general
   `SECURITY DEFINER` idiom. Your three new functions use `pg_catalog, public` search_path (the chat
   family's own form, not 0012's older `public, pg_temp` — contract §6.1 already reflects this
   correctly).
6. `packages/db/migrations/0009_rls_policies_grants.sql` — the global-protected-plane model (`persons`/
   `accounts`: zero RLS, zero grant to `app`). Your four new tables follow this model exactly, not the
   tenant-RLS model — see contract §5 design-probe row 8 for why.

## The four things that are easy to get subtly wrong

**Do not check only one block direction.** `chat_pair_blocked(a,b)` must return true whether the row in
`chat_blocks` is `(blocker=a,blocked=b)` OR `(blocker=b,blocked=a)`. A one-directional check is the
single highest-consequence bug this slice can ship (manifest `stop_conditions` calls this out by name)
— it would let a blocked person's *target* still be blocked from replying while the blocker can still
reach them, or vice versa, depending on which direction got missed.

**Do not let the denial exception message vary.** Every deny path in `assert_dm_allowed` — disabled,
blocked, sender-rate, target-rate — raises the exact same string `'chat safety blocked'` (reused
verbatim from `send_chat_message`'s own existing RLS-boundary error, `feature_inapp_chat_tech.md:684`).
The real reason goes ONLY into the `chat_dm_safety_audit` row, server-side. If you find yourself adding
a reason code to the raised message "for debugging," stop — that is the exact leak DD-55 forbids.

**Do not rate-limit the `'read'` action.** `assert_dm_allowed(...,'read')` (called from `mark_read`)
enforces `dm_safety_enabled()` and `chat_pair_blocked()` like every other action, but skips both
`rate_limit_check` calls — see contract §5 design-probe row 9 for why (receiver-side bookkeeping on
ordinary UI scroll, not a spam vector; root's own `dm_current_read_allowed` RLS predicate never
rate-limits reads either).

**Do not grant `app` anything on the four new tables, and do not grant `chat_definer` mutation on
`chat_blocks`/`chat_reports`.** These are global-protected (no RLS, no `app` grant at all — contract
§5 row 8) and mutation on the block/report tables belongs to slice 8, not this slice (contract §5 row
13). If you find yourself adding `GRANT INSERT/UPDATE/DELETE ... TO chat_definer` on `chat_blocks` or
`chat_reports`, or any `GRANT ... TO app` on any of the four tables, stop — that is a different, later
slice's job.

## Registration mechanics

- `register` requires `HEAD === base_sha` exactly. Register before your first commit.
- The runtime manifest is hash-locked at `register`. Generate it into
  `.autopilot/state/chat-dm-safety-authority-core/manifest.json` from
  `docs/autopilot-manifests/_TEMPLATE.json`, copying this slice's authored contract into it (including
  the already-filled `dep_checks`).
- The migration filename `0030_chat_dm_safety_authority_core.sql` in `scope` is a **provisional
  placeholder** (contract §7). **Re-verify the live tail with
  `ls packages/db/migrations/*.sql | sort | tail -5` before creating anything** — this slice's own
  contract already documents that its sibling's identically-reasoned `0029` guess was consumed by an
  unrelated migration between authoring and now; treat your own guess with the same suspicion. Correct
  `scope` to the real number and re-register rather than picking whatever is free.
- `ap-finish.sh` runs from the repository root, not from the worktree it removes.

## Steps

1. Verify repo identity, that `main == origin/main`, and pin `base_sha` from live HEAD.
2. Re-verify `chat-definer-role-provisioning` is still merged (see above) and re-derive the live
   migration tail. Confirm the manifest's existing `dep_checks` entry still resolves (the cited
   `landed_sha` should still be an ancestor of your `base_sha`).
3. Create the worktree and branch `feat/chat-dm-safety-authority-core`, register the scope gate, then
   create `regions.log` and `fix-round-count.txt`.
4. Write the migration first, exactly matching contract §6.1 (re-numbered per step 2). Apply it and
   confirm all four tables, three functions, and the closing owner/grant block exist before touching
   TypeScript.
5. Mirror the four tables into `packages/db/schema.ts` per contract §6.2, every constraint explicitly
   named (same reason as root's own contract: `rls-invariants.test.ts`'s generic CND guard needs it,
   though these tables have no RLS themselves).
6. Add `packages/db/src/chat-dm-safety-invariants.test.ts` per contract §6.3. Cover the full acceptance
   matrix in contract §9 — the negative-proof rows (both block directions, each capability disabled
   independently, rate-limit denial, no-leak exception text, zero `app` grant) are the actual point of
   this slice; do not ship only happy-path coverage.
7. Fix the mechanical literal(s) in `packages/db/src/migrate.test.ts` that a new migration file forces
   — nothing else in that file should change.
8. Document `dm_safety_enabled`, `chat_pair_blocked`, `assert_dm_allowed` in `packages/db/README.md`
   per contract §6.5, following the file's existing per-migration convention.
9. Run the declared verification — all `verification.focused` commands, then the full canonical list
   including the real-Postgres suite.
10. Run the full gate: `scripts/autopilot-scope-gate ready --manifest
    .autopilot/state/chat-dm-safety-authority-core/manifest.json`. 2 consecutive clean code-review
    rounds AND 1 clean security round (this slice is the DM-safety authority every later DM-touching
    slice trusts by construction — do not skip the security round, and make sure it specifically
    checks the two block directions, the uniform exception text, and the exact grant set).
11. Stop at `READY | AWAIT | HALT`. Do not merge. Do not implement any post-dependency slice
    (`dd38-dd86-chat-schema-core`, or anything further down the chat tree) even if it looks like a
    small addition. Report the exact merge command inputs.

## Negative scope — do not cross these even if it looks trivial

No `chat_channels`/`chat_members`/`chat_messages` or any other `chat_*` content table (root's
deliverable). No creation of the `chat_definer` role (consume only). No `create_dm`/
`send_chat_message`/`mark_read`/block-unblock-report RPC (slices 7/8's deliverable). No
`INSERT`/`UPDATE`/`DELETE` grant to `chat_definer` on `chat_blocks` or `chat_reports`. No grant of any
kind to `app`/`app_worker`/`readonly` on any of the four new tables. No `channel_id` column on
`chat_reports` (hard forward-reference constraint — `chat_channels` does not exist yet at this
migration's position). No DD-56 capability registry. No HTTP route or SSE topic. No report-triage/
action UI. No edit to `infra/postgres-init/*.sql`, `packages/db/src/tenant.ts`,
`packages/db/src/test-harness.ts`, `packages/db/src/rls-invariants.test.ts`, or
`docs/autopilot-backlog.md` entries other than this slice's own. No rollback/reverse-migration runbook
(P17 — forward-only). No retention/deletion sweep on `chat_reports` or `chat_dm_safety_audit` (BL-SEC-6
— audit-shaped data is archived after retention, never deleted; no archival tooling exists yet). No new
rate-limit table — reuse `rate_limit_check` with two new bucket-key prefixes only.

If any acceptance row in contract §9 turns out to need a file outside this slice's scope, or the
four-capability kill-switch model proves insufficient once you're implementing against it, HALT and
report — either means this slice's premise needs re-deriving, an owner question, not an implementation
choice.
