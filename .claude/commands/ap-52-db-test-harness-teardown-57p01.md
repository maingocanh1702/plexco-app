# AP-52 — db-test-harness-teardown-57p01: the db suite fails with every test passing

CI `verify` has been red at the **Test** step since 2026-08-04. The shape, measured at runs #223 and #224:

```
Test Files  5 passed (5)
Tests       346 passed (346)
Errors      2 errors
Failed
```

No test fails. The suite fails on two unhandled Postgres `57P01` (`admin_shutdown`) errors on a
connection as `<dbName>_owner` to `<dbName>` — measured instance `plexco_migrate_dd29_upgrade`,
originating in `packages/db/src/migrate.test.ts` during the `DD29-3 A1/A3` test.

## The mechanism, so you do not chase the wrong thing

`teardown()` in `packages/db/src/test-harness.ts` runs
`DROP DATABASE IF EXISTS <db> WITH (FORCE)`. Since PostgreSQL 13, `FORCE` **terminates every remaining
connection** to that database, and a terminated backend reports `57P01` to its client. A `pg.Pool` with
no `'error'` listener turns that into an unhandled error.

**The teardown order is already correct** — `ownerPool.end()` and every `workerPool.end()` run BEFORE the
DROP. That ordering is itself a prior fix (`codex round-07 [P1]`, see the comment in the function). Any
patch premised on "they forgot to close the pool" is wrong before it is written.

## Two hypotheses — report which one the evidence supports

- **H1:** `grep -c "\.on(['\"]error" packages/db/src/test-harness.ts` returns **0** across 8 pool/client
  construction sites. node-postgres surfaces idle-client errors as unhandled without a listener. This
  alone explains the symptom and is the cheap fix.
- **H2:** the error's user is `<dbName>_owner`, i.e. a pool that was already ended. `pg.Pool.end()`
  resolves once *idle* clients close; a client still checked out at that moment is not waited on — so
  there may be a real straggler.

Fixing H1 and declaring the matter closed converts a visible race into a silent one. Instrument first:
log which pool and which checked-out client is alive at the instant the DROP runs.

## Three things that must come out unchanged

1. **`WITH (FORCE)` stays.** Terminating stragglers is the point — its comment explains that closing
   connections alone leaves behind the database, the cluster-global `ownerRole` and its `job_definer`
   membership: a LOGIN role with a fixed password and BYPASSRLS-via-membership on a shared cluster.
2. **`fileParallelism: true` stays.** Serialising to hide the symptom trades a 90s suite for a slower one
   and leaves the leak alive. `packages/db/vitest.config.*` documents why parallel is safe.
3. **No test assertion or count changes.** 346 pass at base and must still pass at 346.

And the hard line on the fix itself: suppression must be **scoped to teardown and to
connection-termination codes only**. An always-on swallow makes the harness structurally unable to
report a dead connection — the same defect `scope-gate`'s v14 header named when
`autopilot-backlog-reconcile` returned "No stale entries" with exit 0 while checking nothing:
*"A gate that cannot fail is not a gate."*

## Read before you write

1. `docs/autopilot/contracts/autopilot-db-test-harness-teardown-57p01.md` — the task contract. §2
   (mechanism), §3 (the two hypotheses), §4 (the line the fix must not cross), §5 (what stays unchanged),
   §7 (execution order).
2. `docs/autopilot-manifests/db-test-harness-teardown-57p01.json` — read `negative_scope` in full and
   `_leak_hypotheses`.
3. `packages/db/src/test-harness.ts` — `setupNonSuperuserOwnerContext` and its `teardown()`.
4. `packages/db/vitest.config.*` — the `fileParallelism` rationale.

## Register and run

```
scripts/autopilot-scope-gate register \
  --manifest .autopilot/state/db-test-harness-teardown-57p01/manifest.json
```

Hand-write that runtime manifest from the authored contract first; it carries
`manifest_schema_version: level3-operational-v2`, which the authored contract must NEVER carry
(`scope-gate:548` HALTs `CONTRACT_INVALID`). After registering, confirm
`.autopilot/state/db-test-harness-teardown-57p01/registered-manifest.sha256` EXISTS before doing
anything else.

## Verification is repetition, not a single green run

This is a timing race. Run the `packages/db` suite **5 consecutive times** and require `346 passed` and
`Errors 0` on every one. One green run proves nothing.

Terminate at READY | AWAIT | HALT. Do not merge.
