<!-- review-readiness: code-ready -->
# Autopilot task contract — `db-job-claim-lease-core`

> **Framework:** canonical `autopilot-prompt-GENERIC` v0.6.1.
> **Risk:** P1 schema migration · `manual_only` · auto-merge `false` · two consecutive FULL-base Codex-clean rounds.
> **Authority:** DD-89/DD-90 owner-final 2026-07-25.
> **Current state:** ✅ **IMPLEMENTED & MERGED** at `origin/main@34429fceac2349d3362bdd0be4aee60d9af71c5d`
> (2026-07-26), squash-merged from `feat/db-job-claim-lease-core@19091dc` via `scripts/ap-merge.sh`. Exactly
> the 10 manifest-scope files, +1930/-33; migration tail advanced `0021` → `0022`; merged probe
> `0022_job_claim_lease_core.sql::job_audit_events` verified on `main`; db suite **201/201** on merged main.
> Authority packet remains pinned at `948636f` (`CODE_READY`, closure 12/12) — this authorization has been
> **consumed**. This document is now the implementation record, not a launch instruction: do not open a new
> worktree from it. Slice 2 `job-runtime-dispatcher` needs its own manifest and verdict.

## 1. Task

Task: make the shared outbox/projector job layer reclaimable, auditable and executable only through
`job_definer`-owned narrow functions — schema-migration.

This is root slice 1/4. It repairs the current `claim_outbox_batch` failure mode under `FORCE RLS`, but
does not run a job: no queue registration, worker handler, cron, outbox producer, projector or external
provider call lands here.

## 2. Scope and authority

Positive scope is exactly the manifest list:

- one new migration after the synchronized `main` tail (`0022` is exact at authoring baseline `0021`;
  publication preflight must re-pin it if the tail moves before register);
- `schema.ts`, `rls-invariants.test.ts`, `migrate.test.ts`, `test-harness.ts` and DB README;
- CI/local bootstrap wiring: one idempotent SQL file (`infra/postgres-init/01-job-definer.sql`), one root
  `db:bootstrap` script in `package.json` that applies it to a **running** cluster, the CI step that calls
  that script after checkout, and the compose init mount for genuinely fresh volumes.

Negative scope:

- no edit of applied migrations `0000`–`0021`, no `RUNTIME_ROLES` extension and no change to any existing
  definer except `claim_outbox_batch(integer)`;
- no direct DML grant on `outbox_events`, `projector_deliveries`, `job_audit_events` or `surface_refs` to
  `app_worker`, `app`, `readonly` or `PUBLIC`;
- no `surface_refs` function/grant, no pg-boss provisioning change, no worker preflight/`boss.start()` edit,
  no queue, handler, scheduler, producer, projector or delivery-order rewrite;
- no RLS policy change. `claim_outbox_batch` keeps `ORDER BY created_at` exactly; only its supporting index
  changes.

The scope exception is intentional: a cluster-global `BYPASSRLS` prerequisite must be proven on a fresh
CI service, fresh local compose database and a non-superuser DDL-owner test. Splitting those files from
the migration would create a green-local/red-CI and false-RLS-proof path.

## 3. Pre-code design probe

This is a schema/choke-point slice, so GENERIC v0.6.1 breaker 26 applies. Before any production edit,
the executor writes `.autopilot/state/db-job-claim-lease-core/design-probe.md` containing:

```text
FOUNDER_CONFIRMATION: DD-89/DD-90 owner-final 2026-07-25
BASE: <synced origin/main SHA>
CURRENT: claim_outbox_batch is SECURITY DEFINER, owned by migration role,
         queries FORCE-RLS outbox_events without app.tenant_id, and has one-way claimed_at.
REQUIRED: job_definer exact attributes, audit-per-event, five-minute reclaimable lease,
          token-bound projector completion and no direct app_worker DML.
```

It must run a direct non-superuser probe before editing: a migration-role-owned current claim returns zero
rows with no tenant GUC; a pre-provisioned `job_definer` owner can claim the same seeded row. If either
result differs, or the migration tail/role model differs, write `HALT-DESIGN_UNFIT.txt` and stop. Do not
substitute `NOBYPASSRLS`, generic `plexco_definer`, superuser proof or a tenant GUC for the cross-tenant
claim.

## 4. Exact database contract

### 4.1 `job_definer` bootstrap and ownership

Before migration, a privileged cluster-tier bootstrap creates or verifies exactly:

```sql
job_definer NOLOGIN NOSUPERUSER BYPASSRLS
  NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION
```

Any mismatch in any of those seven attributes is a hard failure. The bootstrap grants `job_definer` to the
actual migration role and grants it `USAGE` on `public`; it does **not** grant LOGIN, runtime credentials,
membership to `app_worker`, or blanket schema CREATE.

**One idempotent SQL file, applied to a running cluster — the init-directory is a convenience, never the
contract.** `infra/postgres-init/01-job-definer.sql` holds the attribute-checking SQL; a root
`pnpm db:bootstrap` script applies it over a live connection, and **that script is the path CI, local dev
and production all use**. Two on-disk facts make the init-directory route insufficient on its own, and an
executor that relies on it will HALT:

- **CI cannot use it at all.** `.github/workflows/ci.yml:11-23` runs Postgres as a GitHub Actions *service
  container*, which starts **before** `actions/checkout` (`:27`). The repository does not exist on the runner
  when the container initialises, so `/docker-entrypoint-initdb.d` can never see a repo file. CI must call
  `pnpm db:bootstrap` as a workflow **step** after checkout and before `pnpm -w test`.
- **Local devs are already past it.** `/docker-entrypoint-initdb.d` scripts run only when the data directory
  is empty, and `infra/docker-compose.yml:20-21` keeps a persistent `pgdata` volume. Anyone who has already
  started the stack has a populated volume, so a mount-only bootstrap silently never runs and the migration
  then fails closed on a missing role, with `docker compose down -v` (destroying local data) as the only
  obvious remedy. `pnpm db:bootstrap` works on fresh and existing clusters alike.

Production runs the same SQL from a privileged admin connection with the production migration-role
identifier. Keep the compose init mount for genuinely fresh volumes, but no path may depend on it.

Migration `<next>_job_claim_lease_core.sql`:

1. asserts the exact role attributes and migration-role membership before any table/function grant;
2. creates/replaces the functions below with fixed `search_path = public` and revokes `PUBLIC`; grants
   `EXECUTE` to `app_worker` only for the four worker-callable operations, never for the audit trigger;
3. temporarily grants `CREATE ON SCHEMA public TO job_definer`, transfers owner of each named function,
   then revokes `CREATE` in the same migration transaction;
4. explicitly transfers `claim_outbox_batch(integer)` after its `CREATE OR REPLACE` (replace preserves the
   old owner otherwise);
5. transfers `job_audit_events` ownership to `job_definer` and gives it only the table privileges required
   by the named functions.

The exact `job_definer` function-owner allowlist is:

```text
claim_outbox_batch(integer)
job_prepare_projector_delivery(uuid,text)
claim_projector_delivery_batch(text,integer)
complete_projector_delivery(uuid,text,uuid,text,timestamptz,text,text)
forbid_job_audit_mutation()
```

The catalog test fails if the owner has any additional function or any listed function has another owner.
`forbid_job_audit_mutation()` is a trigger implementation only: it remains non-callable by `app_worker`,
`app`, `readonly` and `PUBLIC`.

### 4.2 Outbox lease and audit

`outbox_events` gains nullable `lease_expires_at timestamptz` and a shape constraint: `claimed_at` and
`lease_expires_at` are both NULL (available) or both non-NULL (leased). A lease is fixed at five minutes.
The migration replaces `idx_outbox_unclaimed` with a partial `(created_at)` index over available rows and
adds an expired-lease index; it does not change ordering semantics.

`claim_outbox_batch(p_limit integer default 100)` accepts only `1..100`. In one transaction it:

1. locks and releases up to `p_limit` expired outbox leases using `FOR UPDATE SKIP LOCKED`, appending one
   `outbox_lease_reclaimed` audit row per event;
2. selects available events with the existing `ORDER BY created_at FOR UPDATE SKIP LOCKED` semantics;
3. stamps `claimed_at = transaction_timestamp()` and `lease_expires_at = transaction_timestamp() + interval
   '5 minutes'`;
4. inserts one `outbox_claimed` audit row per returned event using one operation UUID for the batch; and
5. returns only `(event_id, tenant_id, aggregate_id, sequence, type)`.

An empty batch is a valid empty result, not a false success with invented rows. The function never accepts
or sets `app.tenant_id`; its narrow, audited cross-tenant access is the reason it has the definer owner.

`job_audit_events` is a platform-plane append-only table. Every row has generated `id`, `job_id` equal to
the authoritative outbox event ID, non-null `tenant_id` derived from that event, `actor='system'`, closed
`reason` and `fn_name`, a batch/action `operation_id uuid`, and `created_at`. There is deliberately **no
UNIQUE(job_id)**: expiry/reclaim can legitimately create multiple audit rows for one event. No runtime role
gets a table grant; a trigger rejects UPDATE and DELETE. The table has no query endpoint, retention task or
application read path in this slice.

### 4.3 Projector-delivery operation state machine

`projector_deliveries` gains `claim_token uuid` and `lease_expires_at timestamptz`. Its public behaviour is
defined only through the functions below; `app_worker` receives no DML grant.

| Current state | Operation | Required input / guard | New state | Result |
|---|---|---|---|---|
| no row | `job_prepare_projector_delivery` | event exists; `projector` is a code-owned lower snake identifier (1–64 chars) | `pending`, attempts 0 | insert once; duplicate is no-op |
| `pending` or due `failed` | `claim_projector_delivery_batch` | matching projector, `1..100` limit; reclaim expired `claimed` rows first under `SKIP LOCKED` | `claimed` with fresh UUID token and five-minute lease | returns event, tenant, projector, token and current attempt count |
| `claimed` | `complete_projector_delivery(...,'delivered',NULL,provider_ref,NULL)` | exact token and unexpired lease | `delivered` | increments attempts once; clears token/lease; stamps delivered time |
| `claimed` | `complete_projector_delivery(...,'retry',future_time,NULL,error_code)` | exact token/unexpired lease; bounded code-owned error identifier | `failed` | increments attempts once; clears token/lease; stores the supplied strictly-future retry instant |
| `claimed` | `complete_projector_delivery(...,'dlq',NULL,NULL,error_code)` | exact token and unexpired lease | `dlq` | increments attempts once; clears token/lease; terminal |
| `delivered` / `dlq` / wrong token / expired token | any completion | no transition is provable | unchanged | fail closed; no stale or duplicate completion |

Every state-changing prepare/claim/complete/reclaim call appends an audit row whose `job_id` and tenant are
derived from `outbox_events`, never accepted from `app_worker`. Per-projector retry count and retry instant
are state, but provider-specific retry policy, max-attempt policy, external idempotency and external calls
belong to the first concrete projector slice; this root only provides a token-guarded durable transition.

## 5. Acceptance matrix

| ID | Layer | Fixture / action | Expected result |
|---|---|---|---|
| JCL-1 | migration | fresh DB with exact bootstrap + non-superuser DDL owner | next monotonic job-core migration is recorded and all named functions are owned by `job_definer` |
| JCL-2 | migration | same owner, role absent or one attribute wrong | the job-core migration fails before grants/function ownership; no partial migration row |
| JCL-3 | migration | correct role but missing migration-role membership or schema CREATE bracket | ownership transfer fails closed; `CREATE` is revoked on every success path |
| JCL-4 | RLS | seed two tenant outbox rows; run old-equivalent claim as non-superuser migration owner | zero rows proves the latent production defect, not a passing superuser artefact |
| JCL-5 | worker seat | connect as real `app_worker`; call claim | one row per eligible event is returned across tenants; audit rows have matching event/tenant/system/operation values |
| JCL-6 | lease | claim then advance/seed expiry and claim again | row is reclaimed and claimable; two audit rows for same `job_id` are accepted |
| JCL-7 | concurrency | two worker clients claim same seeded event concurrently | exactly one receives it before expiry; no duplicate live claim |
| JCL-8 | bounds | call either claim function with 0 or 101 | deterministic error; no row, lease or audit mutation |
| JCL-9 | grants | `app_worker` direct SELECT/INSERT/UPDATE/DELETE on outbox, projector and job audit tables | every direct DML/read is denied; only granted function EXECUTE succeeds |
| JCL-10 | delivery | prepare twice, claim once, complete delivered with exact token | one delivery row, one successful completion, duplicate/late completion rejected or no-op with no state overwrite |
| JCL-11 | delivery retry | claimed row completes retry with future instant; then is claimed when due | attempt increments once per completion, stale token cannot complete after re-claim, `dlq` is terminal |
| JCL-12 | catalog | query `pg_proc`/`pg_roles` after migration | exact owner allowlist only; `job_definer` has no LOGIN and no unexpected table/function privilege |
| JCL-13 | bootstrap | CI fresh service and fresh compose volume | bootstrap runs before migration/tests; the non-superuser proof is executed, not masked by `plexco` superuser |
| JCL-13b | bootstrap | **pre-existing cluster**: populated `pgdata` volume (or any cluster where the init directory has already been skipped), then run `pnpm db:bootstrap` twice | first run creates the role with exact attributes, second run is a clean no-op; migration then succeeds. This is the case every current developer is in — a mount-only bootstrap would silently skip and fail the migration on a missing role |
| JCL-14 | regression | re-run migration and existing 0000–0021 hash/count guards | all prior migrations byte-identical; new count advances in both DB suites; rerun is idempotent |

## 6. Implementation and verification order

1. On the default branch, sync `main` and re-verify the migration tail **before worktree creation/register**.
   If it is no longer `0021`, update the manifest scope/merged probe, backlog scope/probe and all three verdict
   mirrors; commit/push the correction and re-pin strict `CODE_READY`. Only then create/register the worktree,
   re-read every DD-89/DD-90 source and run the design probe.
2. Add the privileged bootstrap SQL, the `db:bootstrap` script, the CI step that calls it after checkout, and
   the compose init mount first; prove **both** a fresh cluster and a pre-existing populated cluster end up
   with only the exact role attributes (JCL-13 and JCL-13b) before the migration test begins.
3. Add the non-superuser DDL-owner test and `workerPool` to the harness; write JCL-2 through JCL-9 as red
   tests before migration code.
4. Add the exact authorized monotonic migration path, schema mirror, exact owner/grant catalog assertions
   and JCL-10 through JCL-14. Do not edit applied migrations or change the migration filename inside the
   feature worktree; a tail mismatch should already have halted and returned to publication preflight in step 1.
5. Run the canonical DB verification plus workspace gates:

   ```bash
   DATABASE_URL_TEST=postgres://plexco:plexco_dev@localhost:5432/plexco_test \
     pnpm --filter @plexco/db test
   pnpm -w typecheck
   pnpm -w lint
   pnpm -w build
   git diff --check
   git diff --stat main...HEAD
   ```

6. Require a non-empty, manifest-exact diff, a clean tree and two consecutive FULL-base clean Codex rounds
   on the same HEAD. Persist every review at
   `.autopilot/state/db-job-claim-lease-core/codex/round-NN.txt`; apply the five-round and region-thrash
   breakers from the canonical framework.

Rollback before any worker is enabled is a single reviewed migration reverting only the job-core migration additions after
all lease/audit rows are proven empty; otherwise disable the future worker path and preserve append-only
audit evidence. Never delete/re-parent audit or outbox rows to make rollback pass.

## 7. Current readiness verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-07-25
AUTHORITY_SHA: 948636f4bd3c1bc0feaaf8b91b3ad2730b097e72
BASE_BRANCH: main
TARGET_FILES:
  - docs/standards/decisions.md
  - docs/autopilot-manifests/db-job-claim-lease-core.json
  - docs/autopilot/contracts/autopilot-db-job-claim-lease-core.md
  - .claude/commands/ap-31-db-job-claim-lease-core.md
  - docs/autopilot-backlog.md
  - docs/slice-readiness-verdicts.md
  - docs/standards/BUILD-STATUS.md
  - docs/archive/project-progress-review-2026-07-25.md
  - docs/standards/core-db-architecture-principles.md
  - docs/standards/deployment-infra.md
  - packages/db/README.md
SLICE: db-job-claim-lease-core
IN_SCOPE: outbox/projector lease primitives, per-event job audit, job_definer bootstrap/ownership, schema mirror, real-role tests and CI/local bootstrap
OUT_OF_SCOPE: worker preflight/startup, pg-boss queues, runtime handler/cron, producers/projectors, frontend/UI/design mapping, surface_refs and tenant-RLS policy changes
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS — documented budget exception (P1 root migration spans DB code, real-role tests, CI and local bootstrap); at this SHA the live migration tail is 0021, so 0022_job_claim_lease_core.sql is the verified next monotonic path and package.json is reserved solely for db:bootstrap. A pre-register tail recheck stays mandatory; any drift requires updating manifest, backlog and all verdict mirrors, committing/pushing the correction, then re-pinning
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: none — root slice; 0000 role model, 0005 worker tables and 0010 claim function are merged and re-verified at this SHA
PRIOR_SLICES: none
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS (IMPLEMENTED — squash-merged at origin/main@34429fceac2349d3362bdd0be4aee60d9af71c5d on 2026-07-26; exactly the 10 manifest-scope files, +1930/-33; migration tail advanced 0021 -> 0022; merged probe 0022_job_claim_lease_core.sql::job_audit_events verified on main; db suite 201/201 on merged main)
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS (12/12)
ACCEPTANCE_MATRIX: PASS (JCL-1..JCL-14; real-PostgreSQL db suite 179 -> 201 on merged main)
SECURITY_AND_MIGRATION_GATE: PASS (codex round-11 closed an indirect runtime-role -> group-role -> job_definer BYPASSRLS path by rechecking the denylist AFTER the grant in the same transaction with atomic rollback)
IMPLEMENTATION_ARTIFACTS: PASS (authority packet merged at 948636f; implementation squash-merged at 34429fc)
FIRST_IMPLEMENTATION_STEP: n/a — IMPLEMENTED & MERGED at origin/main@34429fc (13 codex rounds; rounds 12 and 13 clean on the same HEAD 19091dc). The five-round fix breaker fired at round 11 and was owner-authorised to continue — that round is what surfaced the BYPASSRLS escalation path above; the override is recorded here rather than left implicit
REMAINING_BLOCKERS: none — merged
NEXT_REVIEW_TRIGGER: n/a — merged. Next event is slice 2 `job-runtime-dispatcher` (worker preflight fail-closed before `boss.start()`), which is a new slice needing its own manifest and verdict; it does not inherit this authorization
```
