# AP-43 — db-tenants-authz-grant-security-definer: let `app` actually call authorizeTenantAction

`authorizeTenantAction` (AP-40, merged `ddb69a9`) is correct but unreachable by the `app` role — it
has zero grants on `tenants`, and no plain `GRANT` fixes this without either failing (`SELECT` is not
enough for `FOR SHARE`) or reopening a write path AP-40 deliberately left closed (`UPDATE` would).
Close that gap with one narrow SECURITY DEFINER function, following this codebase's own established
pattern.

## Read before you write

1. `docs/autopilot-db-tenants-authz-grant-security-definer.md` — the task contract. First line must be
   `<!-- review-readiness: code-ready -->`, verdict must read `REVIEW_VERDICT: CODE_READY` with
   `CLOSURE_MATRIX: PASS (12/12)`. If either is missing, HALT.
2. `docs/autopilot-manifests/db-tenants-authz-grant-security-definer.json` — read the whole file.
   `_design_contract` pins the exact function signature and body. `verification.focused` are seven
   commands the readiness gate actually spawns; command 0 is a LIVE Postgres experiment (creates a
   scratch role, proves `FOR SHARE` still needs more than `SELECT`, rolls back unconditionally) — it
   must pass both before and after your changes. All seven were tested via the exact `spawnSync`
   mechanism the gate uses, round-tripped through JSON, on 2026-07-31.
3. `packages/db/src/authorization.ts` — read its docstring (lines 74-95) in full before touching it.
   It already names the fix this slice performs, written by the prior slice's own author.
4. `packages/db/migrations/0012_auth_functions.sql` — the SECURITY DEFINER pattern to match exactly:
   `LANGUAGE sql`, `SECURITY DEFINER`, `SET search_path = public, pg_temp`, `REVOKE ALL ... FROM
   PUBLIC` then `GRANT EXECUTE ... TO app`.

## The two things that are easy to get subtly wrong

**Do not touch `subscriptions`.** It already has full `SELECT/INSERT/UPDATE/DELETE` for `app` (the
`0009_rls_policies_grants.sql` `tenant_tables` loop covers it) — its existing raw `FOR SHARE` read in
`authorization.ts` already works. Only the `tenants` read is blocked. Wrapping `subscriptions` too
would be scope creep on a table that was never broken.

**The function is read-only, forever.** `resolve_tenant_status_locked` runs exactly one `SELECT ...
FOR SHARE`. Do not add an `UPDATE` branch, a parameter that could mutate, or a second function that
writes — `tenants.status` still has no write path anywhere in this codebase, and that stays true after
this slice. If you find yourself reaching for `UPDATE` inside this function, stop: that is a different,
much bigger slice requiring a trust-safety mechanism that does not exist yet.

## Registration mechanics

- `register` requires `HEAD === base_sha` exactly. Register before your first commit.
- The runtime manifest is hash-locked at `register`. Generate it into
  `.autopilot/state/db-tenants-authz-grant-security-definer/manifest.json` from
  `docs/autopilot-manifests/_TEMPLATE.json`, copying this slice's authored contract into it.
- `depends_on: [authorize-tenant-action-core]` with a real `dep_checks` entry (base
  `55970df7f8ede29af9d6d0caac7e0610ed2dff78`, landed `ddb69a92aa8b60afb4644acf211dffe2c0091a1b`,
  symbol `authorizeTenantAction` in `packages/db/src/authorization.ts`) — already satisfied since that
  slice is merged on main; `register` will verify this itself via `git merge-base --is-ancestor`.
- The migration filename `0027_resolve_tenant_status_locked.sql` in `scope` was the measured next tail
  on 2026-07-31. **Re-verify the live tail with `ls packages/db/migrations/*.sql | sort | tail -5`
  before creating anything.** If another slice landed a migration first, the correct number has moved
  — correct `scope` and re-register rather than picking whatever number is free.
- `ap-finish.sh` runs from the repository root, not from the worktree it removes.

## Steps

1. Verify repo identity, that `main == origin/main`, and pin `base_sha` from live HEAD.
2. Re-verify the live migration tail (see above). Create the worktree and branch
   `feat/db-tenants-authz-grant-security-definer`, register the scope gate, then create `regions.log`
   and `fix-round-count.txt`.
3. Re-run the two measurements this slice rests on, do not trust the slice doc's dated numbers:
   `grep -rniw "tenants" packages/db/migrations/*.sql | grep -i "GRANT\|REVOKE"` (must still be empty)
   and the live `FOR SHARE`-needs-`UPDATE` experiment (verification.focused command 0 IS this
   re-confirmation — run it manually first if you want to see it before wiring it into the gate).
4. Write the migration first, exactly as `_design_contract` in the manifest pins it. Apply it and
   confirm `resolve_tenant_status_locked` exists and is owned correctly before touching TypeScript.
5. Change `authorization.ts`'s first query from the raw `SELECT status FROM tenants WHERE id =
   ${tenantId} FOR SHARE` to `SELECT status FROM resolve_tenant_status_locked(${tenantId})`. Nothing
   else in that file changes — same control flow, same decision logic, same error propagation.
6. Add app-role test coverage to `authorization.test.ts`: at least one allow case and one deny case run
   through `ctx.appDb.db` instead of `ctx.superuserDb.db` (the harness already has `appDb`/`appPool` —
   no new test infrastructure needed), plus a negative test proving `app` still cannot run a raw
   `SELECT ... FROM tenants ... FOR SHARE` or `UPDATE tenants` directly.
7. Add a short section to `packages/db/README.md` naming the new function and the access pattern it
   closes, following the file's existing per-migration documentation style.
8. Run the declared verification — all seven `verification.focused` commands, then the full canonical
   list including the real-Postgres suite.
9. Run the full gate: `scripts/autopilot-scope-gate ready --manifest .autopilot/state/db-tenants-authz-grant-security-definer/manifest.json`.
   2 consecutive clean code-review rounds AND 1 clean security round (this slice is a trust-boundary
   change — do not skip the security round).
10. Stop at `READY | AWAIT | HALT`. Do not merge, and do not wire `authorizeTenantAction` into any
    route or caller — that is a separate future slice. Report the exact merge command inputs.

## Negative scope — do not cross these even if it looks trivial

No `GRANT SELECT`/`UPDATE`/`INSERT`/`DELETE` directly on `tenants` to `app` or any role. No write path
for `tenants.status`. No changes to `subscriptions` grants or RLS. No change to
`authorizeTenantAction`'s decision logic — only the `tenants`-row access mechanism changes. No wiring
into any route/caller. No `EXECUTE` grant to `app_worker` or `readonly`. No second migration. No edit
to `0012_auth_functions.sql` or any other applied migration. No broader access-control audit or sweep
beyond exactly this one read.

If `resolve_tenant_status_locked` turns out to need any column or table beyond `tenants.status`, or if
the live `FOR SHARE` experiment (verification.focused command 0) ever fails, HALT and report — either
would mean this slice's premise needs re-deriving, which is an owner question, not an implementation
choice.
