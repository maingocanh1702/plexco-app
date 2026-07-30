# AP-40 — authorizeTenantAction: the choke-point every suspension check will go through

Implement `authorizeTenantAction(tenantId, actionClass)` — the single resolver that decides whether a
tenant may perform an action class, reading both status axes itself so no caller ever has to. This is
a root dependency: nothing waits on anything, and nothing wires to it in this slice.

## Read before you write

1. `docs/autopilot-authorize-tenant-action-core.md` — the task contract. Its first line must be
   `<!-- review-readiness: code-ready -->` and its verdict block must read `REVIEW_VERDICT: CODE_READY`
   with `CLOSURE_MATRIX: PASS (12/12)`. If either is missing, HALT — you have the wrong file or an
   unauthorized plan.
2. `docs/features/BE/feature_billing_lifecycle_tech.md` §3 Status Authority — **the authority**. The
   6-case decision table (`1`, `1b`, `2`, `2b`, `3`, `4`) is founder-ratified 2026-07-24. Read it in
   place. Do not copy it into code comments or docs; cite case numbers in test names instead. Copies
   are how it goes stale — this repo has paid for that lesson three registrations in a row.
3. `docs/features/BE/feature_session_management_tech.md` §4 step 6 and edge #24 — the consumer
   contract. It pins the locking discipline you must satisfy even though no consumer exists yet.
4. `packages/db/migrations/0002_tenants_core.sql:15-16`, `0007_billing.sql:34`, `0012_auth_functions.sql`
   — the live columns. Already verified 2026-07-30; re-verify rather than trust this sentence.

## The two things that are easy to get subtly wrong

**The signature must accept a tenant identifier, never a pre-resolved status.** The function owns
reading both `tenants.status` and `subscriptions.status` and resolving the union itself. A caller that
pre-resolves one column silently misses the other axis — the billing spec §1 names this as exactly why
the "adapters cannot implement inconsistent suspension rules" guarantee stays real. Do not export any
path that takes a status scalar, not even as a "testing convenience".

**The mutating branch must use a locking read.** `SELECT ... FOR SHARE` on `tenants`, then
`subscriptions`, in that order — the same order as the resolver's own step 1 → step 2. A plain
re-SELECT inside the same transaction is NOT enough under READ COMMITTED: holding a lock on one table
does not serialize against a concurrent writer on a different one. This was codex round-01 [P1] on
`docs-session-publish-concurrency-recheck`, not optional hardening.

**Acceptance row E3 is the one that decides whether this slice was worth doing.** Your concurrency test
must FAIL when `FOR SHARE` is removed. If it passes against both a locking and a non-locking
implementation, it proves nothing and you have re-created the exact defect codex round-02 [P1] caught in
billing test #36's first draft. The harness must hold the competing transaction OPEN while your function
reads; if you let it commit first, a plain re-SELECT sees the new value and passes too.

## Registration mechanics — each of these cost a real slice to learn

- `register` requires `HEAD === base_sha` exactly. Register before your first commit.
- The runtime manifest is hash-locked at register. `docs/autopilot-manifests/authorize-tenant-action-core.json`
  is the tracked authored contract and carries **no** `manifest_schema_version`; adding it there makes
  register HALT `CONTRACT_INVALID`. Generate the runtime manifest into
  `.autopilot/state/<feature>/manifest.json` from `docs/autopilot-manifests/_TEMPLATE.json`.
- Write `verification` as PROPERTIES, never literals. Do not pin a test count, a migration tail, or a
  version number anywhere. Any literal that goes stale forces a full close-and-re-register cycle.
- Both the slice doc and the authored manifest are IN scope on purpose, so contract amendments can land
  with the change they describe. Use that — do not write an explanation of a gap you could just close.
- `ap-finish.sh` runs from the repository root, not from the worktree it removes.

## Steps

1. Verify repo identity, that `main == origin/main`, and pin `base_sha` from live HEAD. Do not use any
   SHA written in a document as your base.
2. Check the installed kit version (`# KIT_VERSION:` in `scripts/autopilot-scope-gate`). If it is below
   17, stop and tell the owner: v17 changes the reviewer contract so that findings outside your change
   set become ADVISORY instead of blocking. Running below 17 means out-of-scope repo staleness can
   deadlock your verdict, and you will not be able to fix it from inside the slice.
3. Create the worktree and branch `feat/authorize-tenant-action-core`, register the scope gate, then
   create `regions.log` and `fix-round-count.txt`.
4. Implement the resolver, then the tests. Write the allow path (case 3) first to pin the shape, then
   each deny case citing its number, then the three concurrency rows.
5. Run the declared verification. Tests need a live Postgres and `DATABASE_URL_TEST`; the concurrency
   rows need two connections — `packages/db/src/test-harness.ts` already exists, extend it rather than
   inventing a second harness.
6. Run the full gate: `scripts/autopilot-scope-gate ready --manifest .autopilot/state/<feature>/manifest.json`.
   Code review plus one mandatory security round — this slice is an authorization boundary.
7. Stop at `READY | AWAIT | HALT`. Do not merge. Report the exact merge command inputs.

## Negative scope — do not cross these even if it looks trivial

No `hasCapability` (blocked on DD-29 — the live `plans` seed has no `capabilities` wrapper, so every
lookup returns undefined). No changes to `plans`. No migration; assert your diff contains no new file
under `packages/db/migrations/`. No wiring into any route. No new error code — `TENANT_SUSPENDED` (403)
exists and is deliberately cause-agnostic, so a denial must not reveal which axis blocked. No write path
for `tenants.status`; the trust-safety mechanism that must own set AND clear together does not exist yet.

If you find that the resolver needs a third column beyond the two pinned, HALT and report — that would
mean the ratified decision table is incomplete, which is an owner question, not an implementation choice.
