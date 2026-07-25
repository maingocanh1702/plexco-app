# AP-31 — `db-job-claim-lease-core`

Task: make the shared outbox/projector job layer reclaimable, auditable and executable only through
`job_definer`-owned narrow functions — schema-migration.

This is a P1 manual-only slice. It must run in its own worktree on
`feat/db-job-claim-lease-core`; never run it from the repository root and never auto-merge.

## Hard authorization gate

Do not register or edit until all of these are true:

1. `docs/autopilot-db-job-claim-lease-core.md` starts with `<!-- review-readiness: code-ready -->` and
   has a strict `CODE_READY` verdict whose SHA is an ancestor of `origin/main`.
2. The manifest, this launcher, backlog entry and verdict tracker are committed and pushed on that same
   authority lineage; the manifest status is no longer `planned` due to uncommitted authority.
3. `git diff --stat main...HEAD` is empty before branch creation, the main checkout is clean and synced, and
   the scope gate has no active `schema`/`retry-liveness` collision.

Until then, stop with `HALT-DEP_MISSING.txt`: the current packet is intentionally `enforce`/
`NOT_CODE_READY`, not authorization to create a worktree.

## Preflight after authorization

1. On the default branch, re-verify the synced migration tail before creating the worktree. If it is no longer
   `0021`, stop: update the manifest scope/merged probe, backlog scope/probe and all three verdict mirrors;
   commit/push the correction and re-pin strict `CODE_READY`. Never renumber from inside the feature worktree.
2. Create a dedicated worktree from the pinned `origin/main` SHA and verify its HEAD equals that SHA.
3. Register before any edit:

   ```bash
   scripts/autopilot-scope-gate register \
     --manifest docs/autopilot-manifests/db-job-claim-lease-core.json
   ```

4. Create worktree-local state:

   ```bash
   mkdir -p .autopilot/state/db-job-claim-lease-core/codex
   : > .autopilot/state/db-job-claim-lease-core/regions.log
   echo 0 > .autopilot/state/db-job-claim-lease-core/fix-round-count.txt
   ```

5. Resolve only `CODEX="${AUTOPILOT_CODEX_BIN:?HALT CODEX_UNAVAILABLE}"`; require that binary to be
   executable. Never use PATH `codex`, a manual reviewer or another model as a substitute.
6. Run the DB suite using the canonical environment plus typecheck/lint/build. Any baseline failure is
   `PREFLIGHT_REGRESSION` and stops before edits.

## Mandatory design probe

Before any production edit, read DD-89, DD-90, the task contract, `0005`, `0009`, `0010`, `migrate.ts`,
the real-role test harness and the pg-boss provision/worker entrypoints. Then write
`.autopilot/state/db-job-claim-lease-core/design-probe.md` with the DD-89/DD-90 founder confirmation and
these measured facts:

- migration-role ownership of the current `claim_outbox_batch` returns zero cross-tenant rows without a
  tenant GUC under `FORCE RLS`;
- a pre-provisioned exact-attribute `job_definer BYPASSRLS` owner can claim the same seeded row;
- `RUNTIME_ROLES`/`ensureRoleExists` creates `LOGIN NOBYPASSRLS` roles and is therefore unfit;
- current `app_worker` has EXECUTE-only claim access and is denied direct business-table access.

Any changed role model, migration tail, ordering requirement, new direct-DML grant, generic definer or
superuser-only proof is `DESIGN_UNFIT`/`SECURITY_FINDING` HALT. Do not choose a substitute mechanism.

## Implementation fence

Only manifest-scoped files may change. Follow the task contract's JCL-1..JCL-14 matrix exactly:

- bootstrap and prove the cluster-global role before migration;
- write the non-superuser DDL-owner and `app_worker` seat tests first;
- add one monotonic migration; never edit `0000`–`0021`;
- preserve `ORDER BY created_at`, make leases/token completion/audit append-only and fail closed;
- leave `queues.ts`, `worker.ts`, `provision-queue.ts`, all producers/projectors and `surface_refs` untouched.

After every logical change run:

```bash
DATABASE_URL_TEST=postgres://plexco:plexco_dev@localhost:5432/plexco_test \
  pnpm --filter @plexco/db test
pnpm -w typecheck
pnpm -w lint
pnpm -w build
git diff --check
git diff --stat main...HEAD
```

Stage named files only. A finding appends `file:function` to `regions.log` and increments the counter file;
counter `>5`, three consecutive findings in one region, scope drift or any missing decision-table row halts.

## Codex review and finish

Require a non-empty scoped diff before each counted review. Persist every FULL-base review directly:

```bash
"$CODEX" review --base main \
  > .autopilot/state/db-job-claim-lease-core/codex/round-NN.txt 2>&1
```

Two consecutive FULL-base rounds with zero findings on the current HEAD are required. Apply the canonical
quota/auth/transient triage; a no-verdict round never counts. After the second clean round, re-run all
verification, prove mergeability against current `origin/main`, run `scope-gate ready`, push only the feature
branch if available and emit `READY_FOR_MANUAL_MERGE`. Do not merge, tear down the worktree or start slice 2.
