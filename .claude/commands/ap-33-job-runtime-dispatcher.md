# AP-33 — Job-infra slice 2b/4: worker preflight + first outbox consumer (TypeScript-only)

Read canonical `/Users/maingocanh/Projects/Claude template/autopilot/autopilot-prompt-GENERIC.md` and confirm
v0.6.1 or newer. Execute manifest `docs/autopilot-manifests/job-runtime-dispatcher.json` — that manifest is the
whole execution contract. There is deliberately no separate task-contract doc: the DB side is already pinned in
merged code (`packages/db/migrations/0022_job_claim_lease_core.sql` **plus
`packages/db/migrations/0023_outbox_ack_marker.sql`**) and in `docs/autopilot-db-job-claim-lease-core.md`
§4.2/§4.3, which own the lease, ack, audit and delivery state machine. Re-authoring them here would create a
second authority that can drift.

**This slice was split on 2026-07-26 and its schema half already shipped.** `0023` (merged `76e1f7b`) discharged
the ack requirement `0022:166-181` wrote by name against this slice, so `NO new migration` in the manifest
`_scope_out` is now a **hard boundary rather than the contradiction it was**: a migration appearing here means
scope drifted back into slice 2a's territory, and you HALT.

P1 · `manual_only` · auto-merge `false` · `2x_clean` — two consecutive FULL-base Codex-clean rounds on the
same HEAD. Must run in its own worktree at `.autopilot/worktrees/job-runtime-dispatcher` on branch
`feat/job-runtime-dispatcher`. Never run from the repository root.

## Hard authorization gate

Do not register or edit until all are true:

1. This launcher, the manifest and a strict `CODE_READY` verdict for `job-runtime-dispatcher` are committed and
   pushed on `main`, and the verdict's `AUTHORITY_SHA` is an ancestor of `origin/main`.
2. BOTH DB dependencies are merged — verify by probe, not by reading the backlog. On `origin/main`:
   `packages/db/migrations/0022_job_claim_lease_core.sql` contains `job_audit_events`, AND
   `packages/db/migrations/0023_outbox_ack_marker.sql` contains `ack_outbox_event`.
3. `git diff --stat main...HEAD` is empty before branch creation and the scope gate has no active
   `retry-liveness` or `core-api` collision.

## Preflight

1. Create the worktree from the current `origin/main` tip at the path above and verify both SHAs match.
2. Register before any edit — with the RUNTIME manifest, never the authored contract. Hand-write
   `.autopilot/state/job-runtime-dispatcher/manifest.json` from `docs/autopilot-manifests/_TEMPLATE.json`,
   filling it from the authored contract `docs/autopilot-manifests/job-runtime-dispatcher.json` and
   deriving `base_sha` from the live `origin/main` tip — never copying `base_sha` out of the authored file.
   Then:
   `scripts/autopilot-scope-gate register --manifest .autopilot/state/job-runtime-dispatcher/manifest.json`
   Verify `.autopilot/state/job-runtime-dispatcher/registered-manifest.sha256` EXISTS before doing anything
   else. The gate writes that file only when the manifest carries `manifest_schema_version`, which the
   authored contract is forbidden to carry — pass the authored path and it silently skips the hash-lock,
   raises no error, and still prints `registered:`. No hash-lock file means no hash-lock.
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
`.autopilot/state/job-runtime-dispatcher/design-probe.md` pinning the **five** items in the manifest
`_design_probe` — the exact preflight assertion list and how each is queried from the `app_worker` seat, the
queue name and projector identifier, the retry/DLQ policy and where its bound lives, the injected delivery
interface with how tests drive delivered/retry/dlq, and **(e) the required-projector list** — then **STOP for
founder confirmation**. Do not proceed on your own judgement: items (c) and (d) are what a mechanical mirror of
slice 1 gets wrong, and 0022 stores `attempts` while deliberately leaving policy to the consumer.

**Item (e) is the newest and the most deceptive.** `ack_outbox_event` takes `p_required_projectors text[]` and
raises if any named projector lacks a delivery row. Passing "the one projector this slice happens to register"
is **indistinguishable from correct today** and reintroduces, one layer up, exactly the failure that array
argument exists to prevent: a projector registered later would be silently omitted and the event would ack
before it was delivered. Pin whether the list is derived from the same constant that drives fan-out — so the two
**cannot** diverge by construction — or is a second independent constant that can, and justify the choice. Also
pin how the `false` return is distinguished from the raise in control flow: `false` means "another claimant owns
this, do nothing"; a raise means "this handler has a bug". They are opposite and must not share a branch.

Also record the measured current state, re-measured on synced main at `7ac0b20`: `claim_outbox_batch` returns
**six** columns `(event_id, tenant_id, aggregate_id, sequence, type, claim_token)` — `0023` added the last one,
so **five columns means `0023` was reverted and the premise is gone**; `ack_outbox_event(uuid, text[], uuid)`
returns boolean with `REVOKE ALL FROM PUBLIC` and `GRANT EXECUTE` to `app_worker` only at `0023:297-298`;
`claim_projector_delivery_batch` returns `(event_id, tenant_id, projector, claim_token, attempts)`; the four
`0022` functions are `GRANT EXECUTE` to `app_worker` at `0022:527-530`; `QUEUES` is `[]`; `worker.ts` has no
`boss.work()`. If any of these differs on synced main, write `HALT-DESIGN_UNFIT.txt` and stop.

## Three boundaries that fail the slice if crossed

**No producer.** Owner-decided 2026-07-26 as `DEFERRED_OUT_OF_SCOPE`. Shipped code must contain zero `INSERT`
into `outbox_events`; only test fixtures may seed. And do not report "the loop runs" as evidence it runs on
real business data — it runs on a manual enqueue, which is a different claim. JRD-12 tests this.

**No direct DML.** `app_worker` keeps zero direct DML on `outbox_events`, `projector_deliveries` and
`job_audit_events` (DD-89 Q1). Every transition goes through the **five** granted functions. On TDD §3.4: the
probe established this handler reads **no** tenant-scoped business data at all — `claim_outbox_batch` is a
privileged cross-tenant read returning `tenant_id` as data, and `job_prepare_projector_delivery` derives
`tenant_id` internally at `0022:298` rather than from the caller's session. So JRD-5 is a **negative** assertion
(zero SQL outside the granted functions), not a `withTenant` test — the original wording passed by having
nothing to exercise. TDD §3.4's choke-point becomes binding for **slice 4**, when the injected delivery
interface gains an implementation that reads tenant data; slice 4 must not inherit this negative as settled.

**Ack is an obligation, not a tidy-up.** The handler must call
`ack_outbox_event(event_id, required_projectors, claim_token)` once fan-out for an event completes, passing the
`claim_token` from that same `claim_outbox_batch` call. Skip it and this handler reproduces exactly the
starvation loop slice 2a exists to close: every event it processes successfully still expires its lease, is
reclaimed forever, and starves newer events. A `false` return is **not** success — it means the token was stale
and another claimant owns the event; it must not be swallowed or retried. JRD-15/16/17 test these.

Run acceptance JRD-1..JRD-17 against real PostgreSQL with a real `app_worker` seat; a mocked pool does not
satisfy JRD-3, JRD-5, JRD-11 or JRD-15..17. A green run with only **one** projector registered does not satisfy
JRD-17. Then two consecutive FULL-base clean Codex rounds on the same HEAD, persisted
to `codex/round-NN.txt`; apply the five-round and region-thrash breakers. Emit `READY_FOR_MANUAL_MERGE` and
stop — do not merge, do not tear down the worktree, do not start slice 3.

Begin with Pre-flight, then the design probe.
