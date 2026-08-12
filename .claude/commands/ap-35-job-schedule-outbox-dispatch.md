# AP-35 — Job-infra slice 3a: schedule the outbox dispatch cycle + close the `__pgboss__send-it` fence hole

Read canonical `/Users/maingocanh/Projects/Claude template/autopilot/autopilot-prompt-GENERIC.md` and confirm
v0.6.1 or newer. Execute manifest `docs/autopilot-manifests/job-schedule-outbox-dispatch.json` — that manifest
is the whole execution contract. The DB contract below it is merged code (`0022`, `0023`) and the runtime
contract is slice 2b (`fca314e`); do not re-author either here.

P1 · `manual-runtime-feature` · `manual_only` · auto-merge `false` · `2x_clean`. Own worktree at
`.autopilot/worktrees/job-schedule-outbox-dispatch`, branch `feat/job-schedule-outbox-dispatch`. Never run from
the repo root.

**RUNS IN PARALLEL** with `db-public-visibility-capacity-check` (AP-36). That is only safe while this slice stays
`apps/bot`-only: it holds the `retry-liveness` token, AP-36 holds `schema` + `marketplace`, and the two file
sets are disjoint. Adding a migration here pulls in `schema` and collides immediately — see the boundary below.

## Hard authorization gate

Do not register or edit until all are true:

1. This launcher, the manifest and a strict `CODE_READY` verdict for `job-schedule-outbox-dispatch` are
   committed and pushed on `main`, and the verdict's `AUTHORITY_SHA` is an ancestor of `origin/main`.
2. `job-runtime-dispatcher` is merged — verify by probe, not by reading the backlog: `apps/bot/src/worker.ts`
   contains `boss.work(` on `origin/main`.
3. `git diff --stat main...HEAD` is empty before branch creation, and the scope gate reports no active
   `retry-liveness` holder.

## Preflight

1. Worktree from the current `origin/main` tip; verify both SHAs match.
2. Register with the RUNTIME manifest, never the authored contract. Hand-write
   `.autopilot/state/job-schedule-outbox-dispatch/manifest.json` from
   `docs/autopilot-manifests/_TEMPLATE.json`, filling it from the authored contract
   `docs/autopilot-manifests/job-schedule-outbox-dispatch.json` and deriving `base_sha` from the live
   `origin/main` tip — never copying `base_sha` out of the authored file. Then:
   `scripts/autopilot-scope-gate register --manifest .autopilot/state/job-schedule-outbox-dispatch/manifest.json`
   Verify `.autopilot/state/job-schedule-outbox-dispatch/registered-manifest.sha256` EXISTS before doing
   anything else. The gate writes that file only when the manifest carries `manifest_schema_version`, which
   the authored contract is forbidden to carry — pass the authored path and it silently skips the
   hash-lock, raises no error, and still prints `registered:`. No hash-lock file means no hash-lock.
3. Create `.autopilot/state/job-schedule-outbox-dispatch/codex/`, `regions.log`, `fix-round-count.txt`.
4. `CODEX="${AUTOPILOT_CODEX_BIN:?HALT CODEX_UNAVAILABLE}"`, must be executable. No PATH `codex`, no substitute
   reviewer.
5. Green baseline before edits — `pnpm install --frozen-lockfile`, Postgres up, then
   `DATABASE_URL_TEST=... pnpm -w test` and the full CI list `typecheck`, `format:check`, `review:check`,
   `lint`, `build`. Run all of them; `format:check` is `prettier --check .` over the whole repo. Any failure is
   `PREFLIGHT_REGRESSION`.
6. Note for local dev: every DB-touching suite rewrites `app_worker`'s cluster-global password and none restores
   it (`.env.example` documents the re-`ALTER ROLE` step). Expect to re-run it between suite runs and a manual
   worker start. This is known, tracked, and not yours to fix.

## Why this slice exists — read pg-boss's source, not its README

Slice 2b left a handler that is registered and permanently idle: `boss.work(OUTBOX_DISPATCH_QUEUE)` exists,
nothing ever sends to that queue. But the interesting failure is the second one, and it is silent:

- `timekeeper.js:44-69` — `start()` calls `manager.createQueue('__pgboss__send-it')` inside an **empty
  `try {} catch {}`** at `:54-56`. `app_worker` has no `CREATE`, so that call throws and is discarded.
- `timekeeper.js:141-151` — `cron()` does **not** insert into the target queue. It inserts into
  `__pgboss__send-it`; the worker for that queue fans out to the real one.
- `apps/bot/src/queues.ts:18` does not list that name, so `apps/bot/src/preflight.ts:147-195` never asserts a
  partition for it.
- It exists today **by accident**: `provision-queue.ts:24` calls `boss.start()` under the migration role with
  pg-boss's `schedule:true` default (`attorney.js:159`).

Nothing pins that chain. If provisioning ever runs with `schedule:false`, cron dies with no error anywhere.

## Mandatory design probe — five items, and (b) is the one a mirror gets wrong

`design_probe_required: true`. Write `.autopilot/state/job-schedule-outbox-dispatch/design-probe.md` pinning the
five items in the manifest `_design_probe`, then **STOP for founder confirmation**.

Item (b): the obvious move is to append `'__pgboss__send-it'` to `QUEUES` so the existing
`assertQueuesProvisioned` covers it. **Read `provision-queue.ts` before choosing.** `QUEUES` also drives what
provisioning **creates**, and pg-boss creates that queue itself. Determine empirically whether that is
idempotent or an error. If the two roles of `QUEUES` conflict, say so and propose splitting the list rather
than overloading it — do not overload it silently because the one-line change looks tidy.

Also re-measure the current state and `HALT-DESIGN_UNFIT.txt` on any mismatch: `worker.ts` has `boss.work(...)`
and no `boss.schedule(...)`; `QUEUES` is `[OUTBOX_DISPATCH_QUEUE]`; `REQUIRED_PROJECTORS` has exactly one entry;
pg-boss resolves to **10.4.2** (if not, re-derive `timekeeper.js:54-56` and `attorney.js:159` from the actual
version before proceeding).

## Boundaries that fail the slice

**No migration.** Hard, for two reasons: everything needed already exists in `0022`/`0023`, and a migration
pulls in the `schema` token and collides with AP-36 running in parallel. `list_due_tenant_jobs` (named at
TDD:494, absent from disk) is DEFERRED to its own slice.

**No least-privilege assertion.** Verdict 22 cut role-attribute, ownership, excess-privilege and membership
checks out of `preflight.ts` after they consumed six codex rounds and a `MAX_ROUNDS` halt. DD-90 Q6 asks this
preflight to assert that required grants are **PRESENT**, never that excess ones are **ABSENT**. Re-adding any
of that class is an immediate HALT, not a judgement call. `JSO-4` greps the shipped file for it.

**No projector.** `dispatcher.ts` is out of scope entirely. `dispatcher.ts:23-30` also forbids extending
`REQUIRED_PROJECTORS` under an ordinary rolling deploy until a durable versioned registry or a
drain-before-enable discipline exists — that is slice 4's problem, not a line to touch here.

Run `JSO-1..JSO-9` against real PostgreSQL with a real `app_worker` seat. `JSO-2` is the row this slice exists
for: with the `__pgboss__send-it` partition absent, preflight must FAIL non-zero and name it. `JSO-6` requires a
scheduled send to actually drive `runDispatchCycle` end to end — a test that only proves the schedule row exists
does not satisfy it. Then two consecutive FULL-base clean Codex rounds on the same HEAD, persisted to
`codex/round-NN.txt`; apply the five-round and region-thrash breakers. **If a round-06 pattern appears — every
finding in the same region, each adding one more dimension of an open-ended property — HALT and report it as a
scope question, do not grind.** Emit `READY_FOR_MANUAL_MERGE` and stop.

Begin with Pre-flight, then the design probe.
