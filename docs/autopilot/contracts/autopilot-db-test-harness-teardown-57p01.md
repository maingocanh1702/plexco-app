<!-- review-readiness: enforce -->

# AP-52 — db-test-harness-teardown-57p01: the db suite fails with every test passing

> **Status:** authored 2026-08-10 · **Risk:** P2 · **preparation-only — no worktree opened, no code written.**
> **Base:** `10d223c3d8a6e6324d1172b07bb6446989aa9734` (`main` = `origin/main`, measured 2026-08-10).
> **Manifest:** `docs/autopilot-manifests/db-test-harness-teardown-57p01.json`
> This is an AUTHORING artifact. No `register` has been attempted.

---

## 1. The measurement

CI `verify` step **Test**, run #223 (`b2c3d59`) and again #224 (`9d7d6ac`):

```
packages/db test:  Test Files  5 passed (5)
packages/db test:       Tests  346 passed (346)
packages/db test:      Errors  2 errors
packages/db test: Failed
```

**Every test passes. The suite fails anyway.** The two errors are:

```
Serialized Error: { severity: 'FATAL', code: '57P01',
                    file: 'postgres.c', routine: 'ProcessInterrupts',
                    database: 'plexco_migrate_dd29_upgrade',
                    user:     'plexco_migrate_dd29_upgrade_owner' }

This error originated in "src/migrate.test.ts" test file.
The latest test that might've caused the error is
"A1/A3: old plans rows survive alongside the new ones, and a pre-existing
 free_web row remaps to free at version 1"
```

`57P01` is `admin_shutdown` — *terminating connection due to administrator command*.

---

## 2. Mechanism

`setupNonSuperuserOwnerContext(dbName)` in `packages/db/src/test-harness.ts` builds:

- `admin` — a `pg.Client` on the base database, superuser
- `ownerPool` — a `pg.Pool` on the temp database, `max: 2`, connecting as `<dbName>_owner`
- `workerPools` — additional pools created by `connectAsWorker()`

and tears down in this order:

```js
teardown: async () => {
  await ownerPool.end();
  for (const p of workerPools) await p.end();
  await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.query(`DROP ROLE IF EXISTS ${ownerRole}`);
  await admin.end();
}
```

Since PostgreSQL 13, `DROP DATABASE ... WITH (FORCE)` **terminates every remaining connection** to the
target. A terminated backend reports `57P01` to its client. A `pg.Pool` with **no `'error'` listener**
turns that into an unhandled error — which vitest counts under `Errors` and which fails the suite
independently of any assertion.

**The teardown order is already correct** — pools are ended before the DROP. That ordering is itself a
prior fix, recorded in the function's own comment as `codex round-07 [P1]`. So this is not a
"they forgot to close the pool" bug, and a patch written on that assumption will not hold.

---

## 3. Two hypotheses; do not stop at the first

**H1 — listener-less pools.**

```bash
grep -c "\.on(['\"]error" packages/db/src/test-harness.ts   # -> 0
```

Zero `'error'` listeners across 8 pool/client construction sites. node-postgres documents that a `Pool`
without an `'error'` listener surfaces idle-client errors as unhandled. This alone explains
`Errors 2` with `346 passed`, and it is the cheap fix.

**H2 — a connection `teardown()` does not know about.**

The error's user is `<dbName>_owner`, i.e. `ownerPool` or a `workerPool` — both already ended before the
DROP. `pg.Pool.end()` resolves once **idle** clients are closed; a client still checked out at that
instant is not waited on. So there may be a real straggler.

**H1 and H2 are not alternatives.** H1 stops the suite failing. H2 is whether anything is still
connected. Fixing H1 and declaring the matter closed converts a visible race into a silent one — report
which hypothesis the evidence supports.

---

## 4. The line the fix must not cross

Suppression must be **scoped to teardown and to connection-termination codes only**.

An always-on error swallow on these pools would make the harness structurally unable to report a
connection failure. This repo has already written down what that costs: `scope-gate`'s v14 header
records `autopilot-backlog-reconcile` returning *"No stale entries"* with exit 0 while checking nothing,
and names the lesson — **"A gate that cannot fail is not a gate."** A test harness that cannot report a
dead connection is the same defect one layer down.

Concretely: gate the handler on a `tearingDown` flag the teardown sets, match the specific codes, and let
everything else through.

---

## 5. Three things that must come out unchanged

**`WITH (FORCE)` stays.** Its comment explains why: closing connections alone leaves the database, the
cluster-global `ownerRole`, and its `job_definer` membership behind — a LOGIN role with a fixed password
and BYPASSRLS-via-membership on a shared local cluster. Terminating stragglers is the *point*. Delivering
FATAL to a listener-less pool is the defect. Do not confuse the two.

**`fileParallelism: true` stays.** `packages/db/vitest.config.*` documents both hazards that once forced
serial execution and the evidence they were closed (≥5 consecutive green full-suite runs). Serialising to
make this symptom disappear trades a 90s suite for a slower one and leaves the leak alive.

**No test assertion or count changes.** 346 pass at base and must still pass at 346.

---

## 6. Why this survived seven days

It reproduces on CI and not on the owner's machine — 683/732 green locally. A timing race.

And it had been seen before: `docs/autopilot-backlog.md` task `deps-security-bump` records
**"2× Postgres `57P01`"** among what that entry calls three infrastructure interruptions in the same
lineage, in late July. It was classified as infrastructure noise and no task was opened. It has since become a permanent red — and then a second
failure (a Lint error from the ESLint 9→10 migration) and a third (a `$0` Actions budget blocking every
runner) stacked on top of it, so for four days nobody could see this layer at all.

Worth stating plainly in the fix: *"infra noise" that recurs is a defect with no owner.*

There is also a live warning that points at this family. Commit `286f48b` merged under an explicit
**owner override of `HALT REGION_THRASH`**, and its own message records that the reviewer raised, three
times, that `pg_advisory_xact_lock` is DATABASE-local while `pg_auth_members` is CLUSTER-shared. That
warning was about role bootstrap rather than teardown, but it is the same axis — cluster-shared state
guarded by database-local reasoning. If H2 is confirmed, check whether the straggler crosses that line.

---

## 7. Execution order

1. Reproduce. Run the `packages/db` suite repeatedly against a CI-like Postgres until the 2-error shape
   appears. A single green run proves nothing here.
2. Instrument before patching: log which pool and which checked-out client is alive at the moment
   `DROP DATABASE ... WITH (FORCE)` runs. That measurement is what separates H1 from H2.
3. Attach scoped `'error'` handlers per §4.
4. If H2 is confirmed, close the straggler properly — do not let the handler stand in for the fix.
5. Re-run the suite **5 consecutive times**: 346 passed, Errors 0, every time.
6. Full monorepo suite, typecheck, lint, build.
7. Record the outcome in the backlog entry, including which hypothesis held.

---

## 8. Verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: NOT_CODE_READY
REVIEWED_AT: 2026-08-10
AUTHORITY_SHA: 10d223c3d8a6e6324d1172b07bb6446989aa9734
BASE_BRANCH: main
TARGET_FILES:
  - packages/db/src/test-harness.ts
  - docs/autopilot-manifests/db-test-harness-teardown-57p01.json
  - docs/autopilot/contracts/autopilot-db-test-harness-teardown-57p01.md
  - docs/autopilot-backlog.md
SLICE: db-test-harness-teardown-57p01
IN_SCOPE: scoped error handling for every pg.Pool and pg.Client constructed in packages/db/src/test-harness.ts, suppressing connection-termination errors only during teardown; and closing the straggler connection if measurement confirms one exists
OUT_OF_SCOPE: any always-on error swallow; removing or weakening WITH (FORCE); setting fileParallelism false; any test assertion or expected-count change; any product code outside test-harness.ts; any change to migrate.test.ts; new dependencies
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: FAIL
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: none
PRIOR_SLICES: none directly; deps-security-bump recorded the earlier 57P01 sightings as infra noise
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PARTIAL
ACCEPTANCE_MATRIX: FAIL
SECURITY_AND_MIGRATION_GATE: PASS
IMPLEMENTATION_ARTIFACTS: NOT_REQUIRED_FOR_PLAN_READY
FIRST_IMPLEMENTATION_STEP: reproduce the 2-error shape locally against a CI-like Postgres, then instrument teardown to identify which pool still holds a live connection when DROP DATABASE WITH (FORCE) runs
REMAINING_BLOCKERS:
  - blocker: the leak origin is unmeasured - H1 (listener-less pools) and H2 (a straggler connection) are both consistent with the evidence and only instrumentation separates them
    owner: assigned writer at implementation time
    resolution: instrumented run naming the live pool and client at DROP time
  - blocker: the failure is timing-dependent and has not been reproduced outside CI
    owner: assigned writer at implementation time
    resolution: 2-error shape reproduced locally, or an explicit record that the fix was verified on CI only and why that is sufficient
NEXT_REVIEW_TRIGGER: an instrumented run that names the live connection at DROP time
```

---

## 9. Changelog

| Date | Change |
| --- | --- |
| 2026-08-10 | Authored from CI run #223/#224. Pinned the 346-pass/2-error shape, the `WITH (FORCE)` mechanism, the two competing hypotheses, and the three things that must come out unchanged. Verdict `NOT_CODE_READY`. |
