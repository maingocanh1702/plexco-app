# AP-47 — chat-definer-role-provisioning: bootstrap the `chat_definer` cluster role

Idempotent, fail-closed bootstrap of the `chat_definer` Postgres role — the first runtime slice of the
in-app-chat serialized DB lane. Mirrors `infra/postgres-init/01-job-definer.sql` almost line-for-line.

## Read before you write

1. `docs/autopilot-chat-definer-role-provisioning.md` — the task contract, verdict `CODE_READY`
   (12/12 closure). Read §5 (exact SQL/diff/test design — do not paraphrase or "improve" it; any
   deviation is an owner question, not an implementation choice), §5.4 (why the grant-target fallback
   stays and why nothing outside the 3 scope files needs to change — this is load-bearing, read it
   fully before touching CI or docker-compose), §7 (negative scope), §8 (acceptance matrix).
2. `docs/autopilot-manifests/chat-definer-role-provisioning.json` — read the whole file. `depends_on`
   and `dep_checks` are both correctly empty — this slice has no executable dependency. `invariants:
   ["schema"]` — check the invariant catalog / INFLIGHT before registering in case another
   schema-token slice is mid-flight.
3. `infra/postgres-init/01-job-definer.sql` — the direct precedent. Your new file mirrors its
   structure (idempotent create, attribute-drift fail-closed check, transitive-runtime-membership
   guard, single `BEGIN...COMMIT`) almost exactly; the contract doc's §5.1 already gives you the exact
   text to write.
4. `packages/db/src/test-harness.ts` lines 60-115 — `bootstrapJobDefiner`/`withJobDefinerLock`. Your
   new test helpers (`bootstrapChatDefiner`/`withChatDefinerLock`/`hideRealChatDefiner`) mirror these
   in *shape* but live **locally inside `migrate.test.ts`**, not here — do not export them from this
   file (see contract §5.4 for why).
5. `packages/db/src/migrate.test.ts` — read the existing `hideRealJobDefiner` local helper (line 459)
   and the `describe("job_definer bootstrap script itself fails closed on runtime-role targets", ...)`
   block (line 1239) — your new describe block is a sibling of that one, adapted per contract §5.3.

## The two things that are easy to get wrong

**Do not require an explicit `chat_definer_bootstrap.migration_role` unconditionally.** It is tempting
to read plan §9.2's "missing/invalid migration role fails closed" as "an unset GUC must fail" — the
contract doc §5.4.1 already worked through why that reading breaks CI's existing bootstrap step (no
`MIGRATION_ROLE` set there) and has no clean fix at all for the docker-compose fresh-volume
init-mount path, and cites `01-job-definer.sql`'s own codex round-06 [P1] as the ruling this design
inherits, not re-derives. The adopted design keeps the `COALESCE(GUC, CURRENT_USER)` fallback exactly
like `job_definer`, and adds a new **explicit `pg_roles` existence check** on whatever the fallback
resolves to — that is what "invalid migration role" means in this contract. If you find yourself about
to add `MIGRATION_ROLE: <value>` to `.github/workflows/ci.yml`, stop and re-read §5.4.1 first — that is
a sign you've drifted to the rejected reading.

**Do not skip the re-pointing guard.** Contract §5.4.2/§5.1: before the `GRANT`, check whether
`chat_definer` is already granted to some role *other than* the one you're about to grant to (via
`pg_auth_members`, excluding `v_target` itself so exact replay still passes) and fail closed if so.
`01-job-definer.sql` does **not** have this check for a non-runtime re-target — it only guards a
runtime-role re-target (codex round-08 [P1]) — so do not copy that file's membership block verbatim and
assume it's equivalent; `chat_definer`'s version is deliberately stricter here.

## Steps

1. Verify repo identity, that `main == origin/main`, and pin `base_sha` from live HEAD. Re-verify
   `infra/postgres-init/` still contains only `01-job-definer.sql` and `packages/db/src/migrate.test.ts`
   still has `MIGRATION_COUNT = 28` — if either has changed, re-derive the contract's live-repo
   verification (§3) before proceeding.
2. Re-grep `packages/` for `pg_advisory_lock|_LOCK_KEY` to confirm `0x63686164` ("chad") still collides
   with nothing (it collided with neither `0x6a6f6264` "jobd" nor `0x706c7863` "plxc" at authoring
   time — re-check, don't assume).
3. Create the worktree and branch `feat/chat-definer-role-provisioning` from the verified base SHA,
   register the scope gate with the **runtime** manifest path
   (`.autopilot/state/chat-definer-role-provisioning/manifest.json`, generated from this repo's
   `docs/autopilot-manifests/_TEMPLATE.json`, copying this slice's authored contract into it — **not**
   the tracked `docs/autopilot-manifests/chat-definer-role-provisioning.json` path itself), then create
   `regions.log` and `fix-round-count.txt`.
4. Write `infra/postgres-init/02-chat-definer.sql` exactly per contract §5.1.
5. Apply the `package.json` diff exactly per contract §5.2 — confirm the existing `01-job-definer.sql`
   invocation is byte-for-byte unchanged before and after your edit.
6. Add the local helpers and new `describe` block to `packages/db/src/migrate.test.ts` per contract
   §5.3 — all 8 listed test cases, all local (no `test-harness.ts` edit).
7. Run every `verification.focused` command from the manifest, then the full canonical list including
   the real-Postgres suite (`DATABASE_URL_TEST=postgres://plexco:plexco_dev@localhost:5432/plexco_test
   pnpm test`).
8. Confirm zero diff under `packages/db/migrations/`, `.github/workflows/ci.yml`, and
   `infra/docker-compose.yml` — the two negative-diff `verification.focused` commands check this
   mechanically.
9. Run the full gate: `scripts/autopilot-scope-gate ready --manifest
   .autopilot/state/chat-definer-role-provisioning/manifest.json`. 2 consecutive clean code-review
   rounds AND 1 clean security round (this slice establishes a `BYPASSRLS`-capable privilege boundary —
   do not skip the security round; make sure it specifically checks the atomicity claim and the
   grant-target fallback reasoning in contract §5.4).
10. Stop at `READY | AWAIT | HALT`. Do not merge. Do not implement `chat-dm-safety-authority-core` or
    `dd38-dd86-chat-schema-core` even though both are immediately next in the dependency chain and
    both already have their own contracts. Report the exact merge command inputs.

## Negative scope — do not cross these even if it looks trivial

No `chat_*` table/function/RLS. No safety tables/functions (`dm_safety_enabled`, `chat_pair_blocked`,
`assert_dm_allowed`). No queue/pg-boss provisioning. No `GRANT USAGE`/`GRANT CREATE ON SCHEMA public TO
chat_definer` (that is the root migration's job). No new file under `packages/db/migrations/`. No edit
to `infra/postgres-init/01-job-definer.sql`, `packages/db/src/migrate.ts`'s `RUNTIME_ROLES`,
`packages/db/src/test-harness.ts`, `.github/workflows/ci.yml`, `infra/docker-compose.yml`, or
`docs/autopilot-backlog.md`.

If any acceptance row in contract §8 turns out to need a file outside this slice's scope, or if the
grant-target fallback design (§5.4) turns out to be wrong, HALT and report — either means this slice's
premise needs re-deriving, an owner question, not an implementation choice.
