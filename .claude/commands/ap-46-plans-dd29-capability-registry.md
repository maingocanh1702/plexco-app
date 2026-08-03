# AP-46 — plans-dd29-capability-registry: expand→contract plan_key + entitlements reshape

> The underlying contract (`docs/autopilot-plans-dd29-capability-registry.md`) reached
> `REVIEW_VERDICT: CODE_READY` on 2026-08-03 (v1.1, reconciliation round). Its own first line must read
> `<!-- review-readiness: code-ready -->` and its verdict block `CLOSURE_MATRIX: PASS (12/12)` — if
> either is missing or reads otherwise, HALT: you have a stale copy or an unauthorized plan. Its three
> v1.0 open questions are resolved, not deferred to you: Q1 (live-tenant pre-flight) is answered
> structurally by the expand migration's own fail-loud guards, not by anyone confirming live data state
> in advance; Q2 (deploy cadence) is decided — ship both migrations in one release; Q3 (the derived
> old→new mapping) is recorded as a derivation enforced by the same guard. None of this is yours to
> re-litigate; it is yours to implement as specified.

Moves `plans.plan_key` from the live 4-tier CHECK to DD-29's 2-tier CHECK, reshapes
`plans.entitlements` to the nested `capabilities` map, reseeds, and repoints every live
`subscriptions` row plus the `tenant_provision()` write path — as two self-guarding monotonic
migrations (expand, then contract). This is the hard prerequisite for `hasCapability`; nothing in this
slice implements `hasCapability` itself.

## Read before you write

1. `docs/autopilot-plans-dd29-capability-registry.md` — the task contract, in full. Confirm its verdict
   block actually reads `CODE_READY` with `CLOSURE_MATRIX: PASS (12/12)` (re-read it directly; do not
   trust a description of it from an earlier run or from this launcher). Read "Human decisions —
   resolved" for the reasoning behind Q1/Q2/Q3 before implementing the migrations — it explains WHY the
   guards are load-bearing and WHY both migrations ship together, which matters when you write the SQL.
2. `docs/autopilot-manifests/plans-dd29-capability-registry.json` — scope, negative scope,
   verification. Read the whole file.
3. `docs/features/BE/feature_billing_lifecycle_tech.md` §2 (Schema) and §Migration & Rollback — the
   TARGET shape is already fully specified and Reviewed (v2.10). This is a transcription job for the
   seed/capability literals (lines 68-81), not a fresh design — copy them verbatim, do not re-derive
   from memory.
4. `packages/db/migrations/0012_auth_functions.sql` lines 228-297 (`tenant_provision`) — confirm its
   hardcoded `'free_web'` literal (line 291) is still there and still the only thing that needs to
   change in that function's body before writing the `CREATE OR REPLACE FUNCTION` redefinition.
5. `packages/db/src/migrate.test.ts` — read the `BR-5`, `BR-7`, and `JCL-2` describe blocks
   (`0022`/`0023` upgrade-path and job-core fail-closed tests) before writing the new fail-closed
   proof tests for this slice's guards. Reuse that pattern; do not invent a second harness.

## The three things that are easy to get subtly wrong

**The capability key set is 11 keys, not the 6 named in earlier discussion of this task.** Use
`feature_billing_lifecycle_tech.md:70-74` (free) and `:77-81` (host_pro) verbatim:
`web_app`, `bot_zalo`, `bot_messenger`, `session_management`, `discovery_marketplace`,
`payment_mark_manual`, `payment_reconcile_auto`, `reminders_manual`, `reminders_auto`,
`assistant_ai_kb`, `crm_dashboard`. Only the last four differ between the two tiers.

**`tenant_provision()` must be redefined in the EXPAND migration, not left for later.** It lives in an
already-applied migration (`0012`) — never edit that file. Instead, `CREATE OR REPLACE FUNCTION
tenant_provision(...)` inside the new expand migration, identical body except the one literal
(`'free_web'` → `'free'`), in the SAME transaction as the new `plans` rows so there is no window where
a concurrent call could insert against a plan_key that doesn't exist yet.

**Three existing tests hardcode an old plan_key as fixture ballast and will break under CONTRACT, not
just the one test that's actually about `plan_key`.** `rls-invariants.test.ts` has three call sites
(the `plans_key_chk` case itself, plus two unrelated CHECK tests — `subscriptions_status_chk` and
`subscriptions_extra_chk` — that use `plan_key='telegram'` purely to satisfy the FK). Plus
`auth.test.ts:369` and `authorization.test.ts:49`. All five must move off the old literals. Do not stop
at the one that looks like it's "about" plan_key.

## Registration mechanics

- `register` requires `HEAD === base_sha` exactly. Re-measure `git rev-parse origin/main` yourself —
  do not use the SHA written in the slice doc, which was pinned at authoring time and other lanes have
  landed migrations since (tail was `0027` at authoring time; verify it hasn't moved before naming the
  two new migration files `0028`/`0029` — if it has, shift both numbers up together).
- The runtime manifest is hash-locked at register. `docs/autopilot-manifests/plans-dd29-capability-registry.json`
  is the tracked authored contract and carries **no** `manifest_schema_version`; adding it there makes
  register HALT `CONTRACT_INVALID`. Generate the runtime manifest into
  `.autopilot/state/plans-dd29-capability-registry/manifest.json` from `_TEMPLATE.json`.
- Write `verification` as PROPERTIES, never literals — the manifest as authored already follows this;
  do not add a pinned test count, migration filename assumption beyond the suffix match, or version
  number when you extend it.
- Both the slice doc and the authored manifest are in scope on purpose, so a contract amendment (e.g.
  recording the Q1/Q2/Q3 answers) can land with the change it describes.

## Steps

1. Confirm the slice doc's verdict reads `CODE_READY` (see "Read before you write" #1).
2. Verify repo identity, that `main == origin/main`, and pin `base_sha` from live HEAD. Verify the
   migration tail with `ls packages/db/migrations/ | sort | tail -5`; name the two new files
   accordingly (working assumption `0028`/`0029`, shift if the tail moved).
3. Create the worktree and branch `feat/plans-dd29-capability-registry`, register the scope gate, then
   create `regions.log` and `fix-round-count.txt`.
4. Author `0028_dd29_capability_registry_<expand>.sql` first: widen `plans_key_chk`, insert the two new
   `plans` rows (verbatim literals from the tech spec), redefine `tenant_provision()`, then the two
   fail-loud guards, then the `UPDATE subscriptions` remap — in that order, one transaction.
5. Prove A1-A5 (slice doc's acceptance matrix) against real Postgres before touching the contract
   migration. Extend `migrate.test.ts` with the `BR-5`/`BR-7`/`JCL-2`-shaped tests for guards 1 and 2.
6. Author `0029_dd29_capability_registry_<contract>.sql`: self-guard (assert zero remaining old-key
   rows), delete the 4 old `plans` rows, narrow `plans_key_chk`. Prove B1/B2.
7. Update `packages/db/schema.ts`'s `plans.keyChk` predicate to the contract-phase target.
8. Fix the five test call sites named in the slice doc's "Coupled blast radius" section (three in
   `rls-invariants.test.ts`, one each in `auth.test.ts` and `authorization.test.ts`) — do not stop after
   fixing only the ones that look directly related to `plan_key`.
9. Once both migrations are verified applied against the test database, update
   `feature_billing_lifecycle_tech.md`'s `⚠️ PENDING MIGRATION` banner (lines 35-36) with a dated
   landing note, and add a short DD-29 addendum to `decisions.md` noting the migration landed — factual
   closure of an already-`✅ Chốt` decision's propagation checklist item, not a new decision.
10. Run the full gate: `scripts/autopilot-scope-gate ready --manifest .autopilot/state/plans-dd29-capability-registry/manifest.json`.
    2 clean code-review rounds (P1 floor) plus one mandatory security round — this slice changes a
    SECURITY DEFINER function body and the capability defaults that gate money-adjacent automation.
11. Stop at `READY | AWAIT | HALT`. Do not merge.

## Negative scope — do not cross these even if it looks trivial

No `hasCapability` — that is `tenant-capability-authority-core`, downstream. No touching
`subscriptions.selected_extra_channel`, `period_start`/`period_end` nullability,
`subscription_invoices.paid_at`, or `billing_overrides.ticket_ref` — those are DD-51 deltas tracked
under the separate P0 `feature-billing-lifecycle` task, even though the tech spec's prose bundles them
narratively with this one. No editing `0007_billing.sql`, `0011_seeds.sql`, `0012_auth_functions.sql`,
or `0025_check_constraint_naming_drift.sql` directly — new behavior only via new monotonic migrations
and `CREATE OR REPLACE FUNCTION`. No inventing a grandfather/re-pricing policy if the live pre-flight
finds a paying tenant on an old paid tier — HALT and escalate instead. No wiring `hasCapability`
callers, routes, or UI. No editing `packages/db/src/authorization.ts` itself. No renaming
`plans_key_chk` again.

If the pre-flight query (Q1 in the slice doc) finds ANY `subscriptions` row with an old paid
`plan_key` and `status IN ('active','past_due')`, HALT and report — that is an owner
grandfather-vs-reprice decision, not an implementation choice.
