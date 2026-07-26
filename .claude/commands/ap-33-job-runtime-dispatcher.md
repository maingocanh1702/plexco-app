# AP-33 — Job-infra slice 2/4: worker preflight + first outbox consumer

Read canonical `/Users/maingocanh/Projects/Claude template/autopilot/autopilot-prompt-GENERIC.md` and confirm
v0.6.1 or newer. Execute manifest `docs/autopilot-manifests/job-runtime-dispatcher.json` — that manifest is the
whole execution contract. There is deliberately no separate task-contract doc: the DB side is already pinned in
merged code (`packages/db/migrations/0022_job_claim_lease_core.sql`) and in
`docs/autopilot-db-job-claim-lease-core.md` §4.2/§4.3, which own the lease, audit and delivery state machine.
Re-authoring them here would create a second authority that can drift.

P1 · `manual_only` · auto-merge `false` · `2x_clean` — two consecutive FULL-base Codex-clean rounds on the
same HEAD. Must run in its own worktree at `.autopilot/worktrees/job-runtime-dispatcher` on branch
`feat/job-runtime-dispatcher`. Never run from the repository root.

## Hard authorization gate

Do not register or edit until all are true:

1. This launcher, the manifest and a strict `CODE_READY` verdict for `job-runtime-dispatcher` are committed and
   pushed on `main`, and the verdict's `AUTHORITY_SHA` is an ancestor of `origin/main`.
2. `db-job-claim-lease-core` is merged — verify by probe, not by reading the backlog:
   `packages/db/migrations/0022_job_claim_lease_core.sql` contains `job_audit_events` on `origin/main`.
3. `git diff --stat main...HEAD` is empty before branch creation and the scope gate has no active
   `retry-liveness` or `core-api` collision.

## Preflight

1. Create the worktree from the current `origin/main` tip at the path above and verify both SHAs match.
2. Register before any edit:
   `scripts/autopilot-scope-gate register --manifest docs/autopilot-manifests/job-runtime-dispatcher.json`
3. Create `.autopilot/state/job-runtime-dispatcher/codex/`, `regions.log`, `fix-round-count.txt`.
4. Resolve `CODEX="${AUTOPILOT_CODEX_BIN:?HALT CODEX_UNAVAILABLE}"` and require it executable. Never a PATH
   `codex`, a manual reviewer or another model.
5. Baseline must be green before edits — `pnpm install --frozen-lockfile`, Postgres up, then
   `DATABASE_URL_TEST=... pnpm -w test` plus `pnpm -w typecheck && pnpm -w format:check && pnpm -w review:check
   && pnpm -w lint && pnpm -w build`. Run the CI list in full, not a subset: `format:check` is
   `prettier --check .` over the whole repo and has caught drift that per-file runs miss. Any baseline failure
   is `PREFLIGHT_REGRESSION` — stop before editing.

## Mandatory design probe (breaker 26 / v0.6.1 §0.1)

`design_probe_required: true`. Before ANY production edit, read DD-89, DD-90 Q6, TDD §3.4,
`0022_job_claim_lease_core.sql`, `apps/bot/src/{worker,queue,queues,provision-queue}.ts` and
`docs/autopilot-db-job-claim-lease-core.md` §4.3, then write
`.autopilot/state/job-runtime-dispatcher/design-probe.md` pinning the four items in the manifest `_design_probe`
— the exact preflight assertion list and how each is queried from the `app_worker` seat, the queue name and
projector identifier, the retry/DLQ policy and where its bound lives, and the injected delivery interface with
how tests drive delivered/retry/dlq — then **STOP for founder confirmation**. Do not proceed on your own
judgement: items (c) and (d) are exactly what a mechanical mirror of slice 1 gets wrong, and 0022 stores
`attempts` while deliberately leaving policy to the consumer.

Also record the measured current state: `claim_outbox_batch` returns
`(event_id, tenant_id, aggregate_id, sequence, type)`; `claim_projector_delivery_batch` returns
`(event_id, tenant_id, projector, claim_token, attempts)`; all four functions are `GRANT EXECUTE` to
`app_worker` at `0022:527-530`; `QUEUES` is `[]`; `worker.ts` has no `boss.work()`. If any of these differs on
synced main, write `HALT-DESIGN_UNFIT.txt` and stop.

## Two boundaries that fail the slice if crossed

**No producer.** Owner-decided 2026-07-26 as `DEFERRED_OUT_OF_SCOPE`. Shipped code must contain zero `INSERT`
into `outbox_events`; only test fixtures may seed. And do not report "the loop runs" as evidence it runs on
real business data — it runs on a manual enqueue, which is a different claim. JRD-12 tests this.

**No direct DML.** `app_worker` keeps zero direct DML on `outbox_events`, `projector_deliveries` and
`job_audit_events` (DD-89 Q1). Every transition goes through the four granted functions. And per TDD §3.4, the
handler claims cross-tenant rows privileged, so it must re-enter tenant context via the `withTenant`
`SET LOCAL app.tenant_id` choke-point before touching any tenant-scoped data — never a raw query. JRD-5 and
JRD-11 test these.

Run acceptance JRD-1..JRD-14 against real PostgreSQL with a real `app_worker` seat; a mocked pool does not
satisfy JRD-3, JRD-5 or JRD-11. Then two consecutive FULL-base clean Codex rounds on the same HEAD, persisted
to `codex/round-NN.txt`; apply the five-round and region-thrash breakers. Emit `READY_FOR_MANUAL_MERGE` and
stop — do not merge, do not tear down the worktree, do not start slice 3.

Begin with Pre-flight, then the design probe.
