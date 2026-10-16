<!-- review-readiness: code-ready -->

# Step-0 readiness: p3-m6-outbox-delivery-core (Phase 3 lane L3)

> Agent-facing (English). Session P3-S2 step 0, written by the readiness reviewer (Opus 5.5 / max), not the writer.
> Authority: lane block L3 in `docs/autopilot-templates/web-mvp-phase3-2026-10-16-RUN.md:213-255` and session block
> P3-S2 (`:1006-1022`); DD-134 (D2) signed by the owner 2026-10-16 (`docs/standards/decisions.md:123`, `:1812-1833`);
> DD-89/DD-90 job-infra; the DD-122 D4 review policy; this verdict.
> Base: `origin/main` `b0bf565ed72d8c4be3f47d3fe7a4e0e382605928` (P3-S1 merged: #59, #62, #60, #61).
> Long evidence, outside the repo: `Claude outputs/plexco-phase3/status/P3-S2-notes/p3-m6-outbox-delivery-core-readiness.md`.
> Every item D-1..D-24 in section 3 is "default applied, pending owner sign-off": the PR body repeats them and L17
> consolidates them into one decisions entry. This file does not edit `docs/standards/decisions.md`.

## 1. Verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-10-16
AUTHORITY_SHA: b0bf565ed72d8c4be3f47d3fe7a4e0e382605928
BASE_BRANCH: main
TARGET_FILES:
  - apps/bot/src/dispatcher.ts
  - apps/bot/src/worker.ts
  - apps/bot/src/queues.ts
  - apps/bot/src/heartbeat.ts
  - apps/bot/src/dispatcher.test.ts
  - apps/bot/src/dispatcher-outcome.test.ts
  - apps/bot/src/schedule.test.ts
  - packages/db/schema.ts
  - packages/db/db.dbml
  - packages/db/src/migrate.test.ts
  - packages/db/src/rls-invariants.test.ts
  - docs/standards/kit-pack-membership.json
  - docs/standards/kit-pack-membership.md
SLICE: p3-m6-outbox-delivery-core
IN_SCOPE: one migration (NEW 0056_outbox_projector_registry_dlq_replay.sql) plus the bot wiring that consumes it: durable projector registry (two job_definer-owned tables, three DISABLED projectors, one web_realtime aggregate route), registry-driven fan-out replacing the stub, the DD-134 (a) retry/backoff/DLQ policy, owner-only DLQ inspect/replay definers and NEW scripts/outbox-dlq-replay.mjs, a token-gated event envelope for projectors, a statement-level NOTIFY trigger with a debounced single-flight wake/drain loop (the 1-minute cron stays), heartbeat schedule_enabled plus projector_is_enabled and outbox_dispatch_schedule_live for L4b, the stale-draft auto-expiry definer run once per cron tick, worker enablement with a registry probe, three disabled placeholder projector modules, NEW docs/runbooks/outbox-dispatch-enable-rollback.md; files = TARGET_FILES + the NEW list in 3.9 + scope additions D-20/D-21
OUT_OF_SCOPE: any provider call or real projector (L4, L5, L10); any route row for zalo_dm or public_sessions; any new event type or DM type, incl. the waitlist promotion (L8); OUTBOX_DISPATCH_SCHEDULE_ENABLED or any projector enabled in a committed default (.env.example:95 and infra/docker-compose.yml:130 stay false); packages/db/src/session-service.ts; migrations 0022/0023 and every migration except NEW 0056; any base-table privilege for app, app_worker or readonly; any public_sessions write; preflight.ts, QUEUES, apps/bot/src/test-db.ts and both test-harness.ts files; NEW packages/db/src/draft-expiry.ts (not created, C4); reproject or backfill; any HTTP route or UI; docs other than the runbook, this file and the kit-pack-membership pair
G1_DECISION: PASS # DD-134 (a)(b)(e) signed 2026-10-16 incl. the (c) override (decisions.md:1812-1833); DD-89/DD-90; DD-122 D4
G2_SPEC: PASS # infra/core slice: Reviewed feature_sync_engine_tech.md v2.9 + feature_session_management_tech.md v2.37 section 4 and edges 28-30 + RUN doc L3 block + the section 3 contract
G3_DEPENDENCY: PASS # L1 merged as #62 (cf109e6, ancestor of b0bf565); every table, function, role and helper called exists at b0bf565 (section 2)
G4_TEST: PASS # acceptance A1-A33 pinned before code (section 5)
G5_SCOPE: PASS # exact files, 3 code modules, 1 migration, explicit B3 exception with caps (section 4), scope additions D-20/D-21
G6_EXTERNAL: ENABLEMENT_ONLY:schedule-flag-owner-P0,projector-enable-owner-P0,NFR-1c-live-sync-lag # no provider call, dark by default
HARD_DEPENDENCIES: L1 p3-ci-flake-hardening merged as #62 (merge cf109e61f7489e67dd62401e2562bd104ab4cd2d, ancestor of the base); DD-134 signed
PRIOR_SLICES: none
OPEN_QUESTIONS_IN_SCOPE: 0 # every gap pinned as D-1..D-24
ENABLEMENT_ONLY_GATES: OUTBOX_DISPATCH_SCHEDULE_ENABLED=true for real use (owner P0, runbook order D-23); enabling any projector row (owner, only after that projector's real module merges); NFR-1c p95<=3 s / p99<=10 s under real traffic (measured locally here, proven at enable time)
LIVE_REPO_VERIFICATION: PASS # section 2, corrections C1-C10
CONTRACT_MATRIX: PASS # section 3
CLOSURE_MATRIX: PASS # 12/12, section 7
ACCEPTANCE_MATRIX: PASS # section 5
SECURITY_AND_MIGRATION_GATE: PASS # one append-only migration; SET ROLE bracket; no runtime-role base grant; per-function posture tests; opus/max security round
IMPLEMENTATION_ARTIFACTS: PASS # DD-122 D4: no scope-gate lifecycle; RUN doc lane block + this file + the worktree at the exact base
FIRST_IMPLEMENTATION_STEP: in .autopilot/worktrees/p3-m6-outbox-delivery-core (base b0bf565 plus this readiness commit), write failing-first contract tests A1-A22 in NEW packages/db/src/outbox-projector-registry.test.ts, then author packages/db/migrations/0056_outbox_projector_registry_dlq_replay.sql with its schema.ts and db.dbml mirror and the D-20 count, tail and allowlist bumps, and run the db suite once under the DB/e2e lock
REMAINING_BLOCKERS: none
```

## 2. Measured at base (b0bf565)

### 2.1 Snapshot

- Worktree HEAD = `origin/main` = `b0bf565ed72d8c4be3f47d3fe7a4e0e382605928`, branch `feat/p3-m6-outbox-delivery-core`, clean,
  no `index.lock`. `git diff --stat c762c90..b0bf565` touches none of `dispatcher.ts`, `worker.ts`, `queues.ts`,
  `heartbeat.ts`, `preflight.ts` or any migration; #62 changed `dispatcher.test.ts`, `preflight.test.ts`, `schedule.test.ts`,
  `test-db.ts` and the db harness; #61 changed `session-service.ts` (read-only for L3).
- Migrations: 56 files `0000`..`0055`, no gap, no duplicate, tail `0055_me_settings_definers.sql`. **Next free: `0056`.**
- DD-134 signed values (decisions.md:1819-1825, signature :1833): (a) 8 deliveries, failure n<8 retries after 15 s x 2^(n-1), the 8th failure
  DLQs, 7 waits = 1905 s, no cap; (b) DLQ inspect + replay owner only (CLI, one audit row, counter reset), no UI;
  (e) schedule flag OFF by default, enabling for real use is the owner's P0, M6 also system-cancels stale drafts gated by
  the flag; (c) override: exactly ONE extra DM to a player promoted from the waitlist, wired by the lane that introduces
  the promotion event (L8), no other new DM type, no reminders; (f) L4b guard = fresh heartbeat with `schedule_enabled`
  AND `projector_is_enabled('zalo_dm')`. L3 does not AWAIT.
- No promotion event on main: `git grep` for `player.promoted|promoteFromWaitlist` in apps/ and packages/ returns nothing;
  `roster-service.ts:31` and `session-service.ts:2925-2927` say auto-promotion is not built.
- GitNexus index is at `dd5375f` (stale), but the five production bot files are unchanged since then: `runDispatchCycle`
  LOW (callers `worker.ts` main, `dispatcher.test.ts`, `dispatcher-outcome.test.ts`, `schedule.test.ts`),
  `resolveOutboxDispatchEnablement` LOW, `heartbeatOnce` LOW. Grep confirms: `REQUIRED_PROJECTORS` in dispatcher.ts,
  worker.ts, dispatcher.test.ts, schedule.test.ts; `QUEUES` in preflight.ts, provision-queue.ts and their tests only.

### 2.2 Re-measured cites (lane block measured at c762c90)

| Lane cite | At b0bf565 |
|---|---|
| dispatcher.ts STUB_PROJECTOR :32, REQUIRED_PROJECTORS :33, productionStubDeliver :77 | :32, :33, :77-80 (rolling-deploy warning :14-30) |
| runDispatchCycle, 2-phase ack/deliver | :172-329; phase 1 :185-214 (prepare :192-197, ack :202-205); phase 2 :216-326 (claim one row :223-226, `deliver_threw` :255, 22023 fallback :282-300, stale stop :307-324); ERROR_CODE_RE :351; completionArgs :397-471 |
| dispatcher.ts:53-55 (attempts pre-completion) | doc :48-56, DeliverFn :57 |
| worker.ts :80-96 enablement | `resolveOutboxDispatchEnablement` :81-96 (doc :73-80); flag parser :32-34; register :98-111 (C1) |
| worker.ts :138-142 | stub deliverer :138, enablement :139-142; heartbeat start :136 (before enablement); `boss.work` gate :157-167; shutdown :180-203 |
| queues.ts OUTBOX_DISPATCH_CRON :47, 1-min floor :38-46 | :47; floor doc :41-46; QUEUES :49 (C2) |
| heartbeat.ts | 3-arg definer call :79; `heartbeatOnce` :68-101; `startHeartbeat` :108-129; HEARTBEAT_STALE_MS 90 s :34 |
| preflight.ts "if it enumerates functions" | :82-96 checks identity, pgboss schema usage, queues, pgboss table and sequence grants; no function enumeration (C3) |
| 0009:17 | "app_worker: no business-table grants; EXECUTE narrow functions only" |
| 0022 ack/attempts :444-464 | `attempts + 1` at :444, :454, :464 in `complete_projector_delivery` :405-484; error_code grammar :434; dlq terminal CHECK :263-264; due-row claim :369-377; job_definer grants :538-539; app UPDATE/DELETE revoked :548 |
| 0023 ordering | claim `ORDER BY created_at` + SKIP LOCKED :156-157, :181-182 (no per-aggregate order); registry "not built here" :24-27, :221-227; `ack_outbox_event` :228-298 |
| 0033 | `raise_public_session_fence` :157-191 (EXECUTE app only :191, tenant check :173-180); token :194-204 and CAS clear :208-222 (app_worker) |
| 0041 heartbeat definer, job_worker_liveness :76 | table :25-33; `job_worker_heartbeat(text,text,integer)` :35-72 (grant :72); `job_worker_liveness` :76-90 (app_worker only) |
| .env.example:95, infra/docker-compose.yml:130 | both `false` |
| session-service.ts cancel path (read only) | `cancelSession` :2129; lock :2203-2208; probes :2318-2319 (`sessionHasCharges` :1622-1629, `sessionHasAnyPlayer` :2089-2096); anomaly event :2324-2337 (`source: "manual"` :2333); clean update :2360-2368; fence :2372; `session.cancelled` :2379-2391 (`cancel_reason: "manual"` :2389); `nextOutboxSequence` :2686-2687 |
| BE spec section 4 / edges | Events table `docs/features/BE/feature_session_management_tech.md:633-652` (`player.promoted` named there); draft discard + auto-expiry :676-707; edges #28-#30 :263-265; `idx_sessions_draft_starts_at` "not yet applied" :207 and :221 |

### 2.3 Catalog at base (read-only, `plexco_test` at 0055 with file hashes equal to b0bf565 for 0022, 0023, 0033, 0041, 0055)

- `app_worker`: zero table and zero column privileges in any schema. Non-PUBLIC EXECUTE on 9 functions: ack, claim x2,
  complete, prepare, heartbeat, liveness (job_definer-owned) and the fence token/clear pair (migration-role-owned).
- `job_definer` owns exactly the 8 functions of the JCL allowlist and the tables `job_audit_events`, `job_worker_heartbeats`;
  explicit grants: `outbox_events` SELECT/UPDATE, `projector_deliveries` SELECT/INSERT/UPDATE. No EXECUTE on
  `raise_public_session_fence` (app only). Membership: only `plexco` (inherit t, set t).
- FORCE RLS: sessions, players, charges, outbox_events. No RLS: projector_deliveries, job_audit_events,
  job_worker_heartbeats, public_projection_fences. No trigger on `outbox_events`. PostgreSQL 16.15.

### 2.4 Postgres probes (inside BEGIN ... ROLLBACK, scratch schema in the `postgres` database; nothing persisted)

- P1: with `f(text,text,int)` and `f(text,text,int,boolean DEFAULT NULL)` both present, a 3-arg call fails "function ... is
  not unique". After dropping the 3-arg overload, a 3-arg call resolves to the 4-arg one (default applied) and
  `to_regprocedure('f(text, text, integer)')` is NULL. Hence D-12 (DROP, then CREATE).
- P2: a trigger function with `REVOKE ALL ... FROM PUBLIC` still fires for an `app` INSERT (EXECUTE is not checked at fire
  time); `has_function_privilege('app', fn, 'EXECUTE')` is false.
- P3: `set_config('app.tenant_id', x, true)` inside a SECURITY DEFINER persists after the call for the rest of the caller's
  transaction; a nested definer sees it. Hence the save-and-restore pattern of 0045:12,18,39-42 in D-15.
- P4: `pg` is not resolvable from the repo root (`node_modules` has no pg); `createRequire` anchored at
  `packages/db/package.json` resolves pg 8.22.0. Hence D-10.
- P5: a NOLOGIN BYPASSRLS role holding only the D-4 column grants can run `SELECT ... ORDER BY (EXISTS ...), starts_at
  FOR UPDATE OF s SKIP LOCKED LIMIT n` (empty drafts sort first), the status/version/updated_at UPDATE with RETURNING
  id/tenant_id/version, and an outbox INSERT with the in-statement `max(sequence) + 1` and RETURNING; reading an ungranted
  column fails 42501. Hence D-4 and D-15 are implementable as pinned.

### 2.5 Tests the migration breaks unless edited (outside the lane's FILES IN SCOPE) and guards that stay unedited

- Tail/count pins: `migrate.test.ts:53` (`MIGRATION_COUNT = 56`, used at :140, :210, :218, :247, :345, :357, :427, :4318),
  `:769` (BR-6 NOINHERIT tail); `rls-invariants.test.ts:70`, `:73`, `:1753`, `:1758`, `:2036` (JCL-1 tail), `:4587-4590`
  (UCC-8 title, count, tail). Allowlists: JCL-1 `rls-invariants.test.ts:2042-2052` and JCL-12 `:2494-2504` (exact
  job_definer function owners). Precedent: lane M4 bumped the same lines with 0055 (8028da1). Hence D-20.
- `pnpm -w test` runs `kit:check` first: every file under `scripts/` needs one record in
  `docs/standards/kit-pack-membership.json` and the generated `.md` must match (`scripts/check-kit-pack-membership.mjs:149-157`,
  `:365-393`; precedent 283bc6b, 0fee66e). Hence D-21.
- Guards that must stay green unedited: UCC-5 and the secondary CHECK guard (`rls-invariants.test.ts:4063`, `:4293`: every
  live CHECK declared in schema.ts under its table-qualified name and vice versa); the tenant_id FORCE-RLS guard
  (`:4677`); the FK-less person/actor/`_by` uuid tripwire (`identity-link-web.test.ts:1120-1145`); the fence-table and
  `public_sessions` zero-grant catalog (`rls-invariants.test.ts:351-440`, `:628-656`); `apps/bot/src/test-db.test.ts`.
- New full-migration runs that exercise 0056 for free once D-20 lands: superuser (`setupRlsTestContext`), NOSUPERUSER
  NOBYPASSRLS INHERIT owner (JCL-1, `rls-invariants.test.ts:2032-2036`), NOINHERIT owner (BR-6, `migrate.test.ts:743-773`).

### 2.6 Inventory

- Collected tests (collection only, nothing run): bot 129 (dispatcher 32, dispatcher-outcome 51, schedule 18, preflight
  12), db 1225 (migrate 111, rls-invariants 128, session-service 202, test-harness 14). pg 8.22.0, PostgreSQL 16.15,
  Node 25.6.0 locally. Dev DB `plexco` is at 0031 (stale; only test and scratch DBs are used).

### 2.7 Corrections to the lane block

- C1 worker.ts enablement is :81-96 (doc :73-80). C2 queues.ts floor doc is :41-46.
- C3 preflight.ts enumerates no functions, so it is not edited; the registry probe lives in worker.ts (D-14).
- C4 NEW `packages/db/src/draft-expiry.ts` cannot serve the worker: `@plexco/db` is a devDependency of apps/bot
  (`apps/bot/package.json`), the image installs production deps only (`infra/Dockerfile:37-40`), and
  `packages/db/src/index.ts` is outside FILES IN SCOPE. The stale-draft cancel is a narrow definer in 0056 (D-15); the
  sub-item stays in L3 and needs no session-service.ts edit.
- C5 FILES IN SCOPE omit the count/tail/allowlist pins and the kit-pack record (2.5): scope additions D-20, D-21.
- C6 L5 has no migration and needs routes, and DD-134 (c) says web_realtime receives every session event: L3 seeds one
  web_realtime aggregate route (D-2). zalo_dm and public_sessions get no route here.
- C7 app_worker cannot read `outbox_events` (0009:17) and `claim_projector_delivery_batch` returns ids only (0022:323), so
  projectors get their event through a token-gated envelope read (D-6), not ad hoc per-lane reads.
- C8 a 4-arg heartbeat overload beside the 3-arg one breaks every 3-arg caller (P1): DROP then CREATE (D-12).
- C9 NFR-1c now sits at `docs/product/TDD.md:125` (worker.ts:49 still cites :82); acceptance checkbox
  `docs/features/FE/feature_sync_engine.md:147`.
- C10 Bot privilege assertions race migrate.test.ts breakers that grant a definer to app_worker cluster-wide
  (`dispatcher.test.ts:689-715`): negative-privilege assertions hold the jobd reader lock (D-22).

## 3. Pinned contract (each D-n: default applied, pending owner sign-off)

### 3.1 Migration and registry

- **D-1** One migration, `packages/db/migrations/0056_outbox_projector_registry_dlq_replay.sql`, run by `migrate()` in one
  transaction. Objects owned by job_definer are created inside the 0041 bracket (`GRANT CREATE ON SCHEMA public TO
  job_definer; SET ROLE job_definer; ... RESET ROLE; REVOKE CREATE ...`, 0041:18-23, :92-93); statements that need the
  migration role's ownership (grants on its tables and on `raise_public_session_fence`, the trigger, the index) run outside
  it. It must apply as superuser, as an INHERIT and as a NOINHERIT non-superuser owner (2.5).
- **D-2** Tables (no tenant_id, no uuid column named for a person/actor/`*_by`, no RLS, zero grants; reached only through
  definers): `outbox_projectors(name text PK, enabled boolean NOT NULL DEFAULT false, created_at, updated_at)` with
  `outbox_projectors_name_chk` `^[a-z][a-z0-9_]{0,63}$`; `outbox_projector_routes(projector text NOT NULL REFERENCES
  outbox_projectors(name), aggregate_type text NOT NULL, event_type text NULL, created_at)`, unique on
  (projector, aggregate_type, event_type) with NULL treated as a value, named CHECKs:
  `outbox_projector_routes_aggregate_type_chk` `^[a-z][a-z0-9_]{0,63}$`; `outbox_projector_routes_event_type_chk` NULL or
  `^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$` and at most 128 chars;
  `outbox_projector_routes_wildcard_chk` (event_type IS NOT NULL OR projector = 'web_realtime');
  `outbox_projector_routes_zalo_dm_chk` (projector <> 'zalo_dm' OR (aggregate_type = 'session' AND event_type IN
  ('session.updated','session.cancelled','session.announcement_requested','player.promoted'))). Seeds: web_realtime,
  zalo_dm, public_sessions, all `enabled = false`; exactly one route (web_realtime, 'session', NULL). Every CHECK is
  declared in `packages/db/schema.ts` under the same name (UCC-5); `db.dbml` updated.
- **D-3** Function catalogue (job_definer-owned unless noted; SECURITY DEFINER, `SET search_path = public, pg_temp`,
  `REVOKE ALL ... FROM PUBLIC`, then exactly these grants):

| Function | Returns / behaviour | EXECUTE |
|---|---|---|
| `outbox_required_projectors(p_event_id uuid)` | sorted text[] of ENABLED projectors routed for that event row's (aggregate_type, type), exact type or aggregate wildcard, no duplicates; `'{}'` when none, never NULL; 23503 if the event is missing | app_worker |
| `projector_is_enabled(p_name text)` | boolean; NULL or unknown name = false | app, app_worker |
| `outbox_projector_set_enabled(p_name text, p_enabled boolean)` | true iff the value changed (updated_at bumped), false on no-op; unknown name = SQLSTATE P0002 `projector_not_found`, zero writes | none (owner path) |
| `outbox_claimed_event(p_event_id uuid, p_projector text, p_claim_token uuid)` | one row (event_type, aggregate_type, aggregate_id, sequence, tenant_id, payload, created_at) only while that delivery row is `claimed` with that token and `lease_expires_at >= clock_timestamp()`; else zero rows | app_worker |
| `outbox_dlq_list(p_projector text DEFAULT NULL, p_limit integer DEFAULT 100)` | dlq rows only (event_id, projector, attempts, error_code, event_type, aggregate_type, aggregate_id, tenant_id, event_created_at), ordered by event_created_at, event_id; no payload; p_limit outside 1..500 = 22023 | none (owner path) |
| `outbox_dlq_replay(p_event_id uuid, p_projector text)` | D-9 | none (owner path) |
| `job_worker_heartbeat(p_worker_id text, p_hostname text, p_pid integer, p_schedule_enabled boolean DEFAULT NULL)` | D-12 | app_worker |
| `outbox_dispatch_schedule_live()` | D-12 | app, app_worker |
| `job_expire_stale_drafts(p_limit integer DEFAULT 25)` | TABLE (cancelled integer, anomalies integer); D-15 | app_worker |
| `outbox_events_notify_wake()` (migration-role-owned, SECURITY INVOKER, same search_path, REVOKE ALL FROM PUBLIC) | trigger `trg_outbox_events_wake` AFTER INSERT ON outbox_events FOR EACH STATEMENT: `pg_notify('outbox_wake', '')` | none |

  Plus `CREATE INDEX idx_sessions_draft_starts_at ON sessions (starts_at) WHERE status = 'draft'` (BE spec :207), mirrored
  in schema.ts. JCL-1/JCL-12 gain exactly: outbox_required_projectors, projector_is_enabled, outbox_projector_set_enabled,
  outbox_claimed_event, outbox_dlq_list, outbox_dlq_replay, outbox_dispatch_schedule_live, job_expire_stale_drafts.
- **D-4** New base privileges go to job_definer only, column-narrow, issued by the migration role: SELECT (id, tenant_id,
  status, starts_at, version) and UPDATE (status, version, updated_at) ON sessions; SELECT (session_id) ON players and ON
  charges; INSERT (tenant_id, aggregate_type, aggregate_id, sequence, type, payload) ON outbox_events; EXECUTE ON
  `raise_public_session_fence(uuid, text)`. Reading of the negative scope "no re-grant of base SELECT on any table": no
  runtime role (app, app_worker, readonly) gains any base-table privilege; job_definer is NOLOGIN, asserted non-grantable to
  runtime roles (0022:63-69) and reached only through its definers (DD-90 Q5 "exact grants"; precedent 0022:534-539).
  public_sessions gets nothing. If Postgres needs a wider grant, widen the minimum and cite the measurement in the PR.

### 3.2 Dispatch policy

- **D-5** Phase 1: per claimed event, `A := outbox_required_projectors(event_id)` (one call per event, no cache, no in-code
  constant or fallback); prepare each member of A; `ack_outbox_event(event_id, A, token)`. Empty A acks with `'{}'`, never
  DLQ. `REQUIRED_PROJECTORS` and `STUB_PROJECTOR` leave production code; `productionStubDeliver` stays exported only as the
  refusal sentinel of `resolveOutboxDispatchEnablement`.
- **D-6** Phase 2: iterate the map in `apps/bot/src/projectors/index.ts` in sorted name order; skip a projector unless
  `projector_is_enabled(name)` at cycle start; after claiming each row call `outbox_claimed_event`; zero rows = lease lost:
  no deliver(), stop that projector for this cycle (same rule as a stale completion, dispatcher.ts:307-324). deliver()
  receives {eventId, tenantId, projector, claimToken, attempts, event: envelope}. A registry-enabled name with no map entry
  is never claimed (its rows wait; one warning per cycle). The 22023 fallback, deliver_threw and stale-stop rules stay.
- **D-7** Retry policy (DD-134 a), a = `attempts` from the claim, n = a + 1:

| Outcome | Condition | Stored |
|---|---|---|
| delivered | any n | delivered (ack kept) |
| retryable failure | n <= 7 (a <= 6) | failed, next_attempt_at = now + 15 s x 2^a (15, 30, 60, 120, 240, 480, 960 s; sum 1905 s), projector's normalised error_code |
| retryable failure | n >= 8 (a >= 7) | dlq, error_code `attempts_exhausted`; the projector's own code goes to the bounded log line only |
| terminal failure (projector returns dlq) | any n | dlq, projector's normalised error_code |
| deliver() throws / malformed outcome | any n | dlq `deliver_threw` / `malformed_outcome` / `malformed_error_code` (unchanged) |

  The dispatcher is the only retry scheduler: a projector-supplied nextAttemptAt is ignored, so the `malformed_next_attempt`
  path retires and its tests are replaced by schedule tests. next_attempt_at uses the worker clock; the DB checks
  `> clock_timestamp()` (0022:430), so worker/DB skew >= 15 s turns an early retry into dlq `malformed_outcome`
  (replayable); the runbook requires NTP-synced clocks.
- **D-8** `projectors/web-realtime.ts`, `zalo-dm.ts`, `public-sessions.ts` each export a DeliverFn returning
  `{ result: "dlq", errorCode: "projector_not_implemented" }` with no I/O; `index.ts` maps exactly these three names. L4, L5
  and L10 replace only their own file and never edit index.ts.

### 3.3 DLQ owner path

- **D-9** `outbox_dlq_replay`: `UPDATE projector_deliveries SET status = 'pending', attempts = 0, next_attempt_at = NULL
  WHERE event_id = $1 AND projector = $2 AND status = 'dlq'`; on one row, exactly one job_audit_events row (job_id = event,
  tenant_id from the event, actor 'owner', reason 'projector_delivery_replayed', fn_name 'outbox_dlq_replay', fresh
  operation_id, created_at clock_timestamp()), return true. No row for the pair: RAISE SQLSTATE P0002
  `delivery_not_found`; row in another status: RAISE SQLSTATE 55000 `delivery_not_in_dlq` naming the status; a RAISE
  leaves zero writes. error_code is kept until the next completion overwrites it. Replay while the projector is disabled is
  allowed (the row waits). Owner path = the `DATABASE_URL_MIGRATION` credential, a job_definer member via `pnpm
  db:bootstrap`; the CLI issues `SET ROLE job_definer` before any call (posture-independent, like 0022:511-518) and
  `RESET ROLE` after. app, app_worker and readonly hold no EXECUTE (42501, zero writes); app_worker has no grant on
  projector_deliveries or either registry table (direct SQL = 42501).
- **D-10** `scripts/outbox-dlq-replay.mjs`: `list [--projector <name>] [--limit <n>]` and `replay --event <uuid>
  --projector <name>`; reads `DATABASE_URL_MIGRATION` from the environment only; validates arguments before connecting;
  never prints the URL or a credential; loads pg via `createRequire(new URL("../packages/db/package.json",
  import.meta.url))`; exit 0 = done, 2 = refusal (`delivery_not_found`, `delivery_not_in_dlq`, `invalid_argument`), 1 =
  other error; warns when the projector is disabled. No HTTP, no UI.

### 3.4 Wake-up and scheduler

- **D-11** NOTIFY channel `outbox_wake`, payload empty (any role may LISTEN on any channel, so no id, tenant or type).
  `outbox-wake.ts`: one dedicated `pg.Client` on `DATABASE_URL_DIRECT` (session mode), `LISTEN outbox_wake`, debounce
  100 ms; one shared single-flight runner per process used by the cron handler and the wake loop (a wake during a cycle
  queues exactly one follow-up); drain: rerun at once while the last cycle was full (claimedEvents = limit, or a projector
  processed `limit` deliveries), at most 20 consecutive cycles; reconnect backoff 1 s doubling to 30 s with one catch-up
  cycle after every (re)connect; errors are logged and contained. Started only when enabled; on shutdown the LISTEN client
  stops first and the in-flight cycle is awaited inside the existing deadline. The 1-minute cron (`queues.ts:47`) stays as
  the safety net; QUEUES gains nothing (no new pg-boss queue, so preflight and provisioning are unchanged).

### 3.5 Heartbeat and the L4b read functions

- **D-12** `ALTER TABLE job_worker_heartbeats ADD COLUMN schedule_enabled boolean` (nullable); `DROP FUNCTION
  job_worker_heartbeat(text, text, integer)` then CREATE the 4-arg form storing `schedule_enabled` on insert and update
  (re-grant app_worker). An old 3-arg caller records NULL. heartbeat.ts passes the boolean that gated `boss.work` in that
  process; worker.ts resolves enablement before `startHeartbeat`. `job_worker_liveness` is unchanged.
  `outbox_dispatch_schedule_live()` = EXISTS a row with `last_seen_at > clock_timestamp() - interval '90 seconds'` AND
  `schedule_enabled IS TRUE` (90 s = HEARTBEAT_STALE_MS); no parameter; NULL or false never counts.
- **D-13** `projector_is_enabled` and `outbox_projector_set_enabled` as in D-3; enabling is a runbook call, never a
  migration.
- **D-14** Worker enablement: ON iff the flag is exactly "true" AND the deliverer is not `productionStubDeliver` AND a
  registry probe (`SELECT projector_is_enabled('web_realtime')`, only when the flag is "true") succeeds; a probe error turns
  dispatch OFF with a logged reason. OFF = unschedule, no `boss.work`, no LISTEN, no draft expiry (today's behaviour). The
  spawned-process test at `schedule.test.ts:512-534` flips to asserting registration (its own comment names this lane).

### 3.6 Stale-draft auto-expiry (no session-service.ts edit)

- **D-15** `job_expire_stale_drafts(p_limit)`: p_limit outside 1..100 = 22023. Candidates `status = 'draft' AND
  starts_at <= clock_timestamp()`, `FOR UPDATE OF sessions SKIP LOCKED`, empty drafts ordered before anomalous ones (no
  starvation), LIMIT p_limit. Under the row lock re-check "any players row, any status" and "any charges row" (mirrors
  session-service.ts:2089-2096, :1622-1629, :2318-2319). Empty: set status 'cancelled', version + 1, updated_at
  clock_timestamp() (mirrors :2360-2368); `raise_public_session_fence(id, 'cancelled')` with `app.tenant_id` set to the
  row's tenant and restored on every exit incl. EXCEPTION (0045 pattern; mirrors :2372); one `session.cancelled` row
  {session_id, roster_count 0, has_paid false, cancel_reason "auto"} (mirrors :2379-2391; Events table cancel_reason
  manual/auto) with sequence = coalesce(max(sequence) for the aggregate, 0) + 1 (mirrors :2686-2687); one
  job_audit_events row (job_id = that event, actor 'system', reason 'session_draft_auto_cancelled', fn_name
  'job_expire_stale_drafts', one operation_id per call). Anomaly: no session mutation; one `session.expiry_anomaly_detected`
  row {session_id, tenant_id, source "auto", anomaly_fields} (mirrors :2324-2337) and one audit row reason
  'session_draft_expiry_anomaly', repeated on every run while the draft stays (BE edge #28 "every detection"). No
  processed_commands and no commandId (BE spec job path); no tenant-status gate (the spec's job has none; a draft cancel
  creates no obligation). Every session-aggregate writer locks the session row first (session-service.ts:908-915), so the
  in-statement sequence cannot race under the held lock.
- **D-16** `apps/bot/src/draft-expiry-job.ts` calls the definer once per cron-driven handler run (after the dispatch
  drain), never from a NOTIFY wake, only when enabled; it logs the two counts only.

### 3.7 Later lanes, the promotion DM and the projector contract

- **D-17** A later lane maps an event type to a projector only with an INSERT into `outbox_projector_routes` (inside `SET
  ROLE job_definer ... RESET ROLE`) in its OWN migration; nobody edits 0056. L4 inserts its three D2 (c) zalo_dm routes; L8
  (or L4 if a promotion event exists at L4's base) inserts exactly one promotion route to zalo_dm, `player.promoted` (BE
  Events table), plus non-DM routes it needs (web_realtime is already covered by the wildcard); L10 inserts its
  public_sessions routes; L5 inserts none. The zalo_dm CHECK admits only the four signed types: any other DM type needs a
  migration that changes the CHECK, i.e. a new owner decision, and no lane may do that in Phase 3. If L8 names the
  promotion type differently, its migration swaps exactly that one name in the CHECK.
- **D-18** Projector contract (documented in index.ts): idempotent per (aggregate_id, sequence); tolerates out-of-order
  and replayed events (claim order is created_at across aggregates, 0023:156/:181; sync engine section 1 D-13); reloads
  canonical state; may see stale backlog after a long disable; returns delivered | retry (retryable) | dlq (terminal) and
  an error code in the 0022:434 grammar.

### 3.8 Tests, scope additions, budget

- **D-19** Sync-lag measurement: section 6.
- **D-20** Scope addition, test-only, these lines and nothing else: `migrate.test.ts:53` (57 + comment), `:769` (tail);
  `rls-invariants.test.ts:70`, `:73`, `:1753`, `:1758` (57), `:2036` (tail), `:2042-2052`, `:2494-2504` (+ the eight
  names of D-3), `:4587-4590` (UCC-8 title, 57, tail).
- **D-21** Scope addition: one record `{"path": "scripts/outbox-dlq-replay.mjs", "overwrite_path": "none", "note": "No
  canonical copy. Repo-owned owner CLI (L3): DLQ inspect and replay through job_definer definers."}` appended to
  `docs/standards/kit-pack-membership.json`, then `pnpm kit:generate` rewrites `docs/standards/kit-pack-membership.md`
  (generated, never hand-edited). NEW test files: `packages/db/src/outbox-projector-registry.test.ts`,
  `apps/bot/src/projector-registry.test.ts`, `apps/bot/src/outbox-wake.test.ts`, `apps/bot/src/draft-expiry-job.test.ts`.
- **D-22** Harness (#62), used as is: db tests use `setupRlsTestContext(<unique name>)` (migrates under
  `withDefinerReadLock`, leases `ROLE_PW` last, drops its own DB); bot DB tests copy the `setupDispatcherContext` shape
  (`dispatcher.test.ts:43-106`: `withJobDefinerLock` from `./test-db.js` around bootstrap + migrate, lease after setup,
  release after the pools, plain DROP of its own DB). No password literal, no ALTER ROLE, no edit of either test-harness.ts
  or test-db.ts. Owner-path tests use the superuser seat plus `SET ROLE job_definer` (what the CLI does) inside
  `withJobDefinerLock`; every negative-privilege assertion holds the jobd reader lock (C10). No L3 test takes the chad slot
  (no `setupNonSuperuserOwnerContext`, no `bootstrapChatDefinerForOwner`), no breaker lock, and no reader lock inside a
  reader's fn, so D12's jobd/chad ordering cannot be rebuilt; the non-superuser application of 0056 is covered by JCL-1
  and BR-6 after D-20.
- **D-23** Runbook `docs/runbooks/outbox-dispatch-enable-rollback.md`: preconditions (migrated through 0056 with `pnpm
  db:bootstrap` before 0054, `provision:queue`, preflight passes, NTP); safe enable order: (1) with ALL projectors disabled,
  set the flag "true" for the worker only and restart; confirm `SELECT outbox_dispatch_schedule_live()`; wait until the
  unacked backlog is 0 (it acks with empty sets, so nothing old is ever sent); (2) only then enable one projector at a time
  with `outbox_projector_set_enabled`, and only after its real module merged (web_realtime after L5; zalo_dm after L4 plus a
  real bot token, owner P0; public_sessions after L10). Rollback: disable a projector (its rows wait and may be stale when
  re-enabled); flag false + restart (unschedule, no consumer, no LISTEN; heartbeat reports false within 30 s; the live check
  goes false within 90 s); DLQ replay with the CLI. Also: DLQ count check (sync spec alert threshold > 100), the sync-lag
  procedure (section 6), and "never commit the flag true".
- **D-24** B3 cap: section 4.

### 3.9 NEW files (scope prose; not TARGET_FILES)

`packages/db/migrations/0056_outbox_projector_registry_dlq_replay.sql` · `packages/db/src/outbox-projector-registry.test.ts`
· `apps/bot/src/projector-registry.ts` (+ `.test.ts`) · `apps/bot/src/projectors/index.ts`, `web-realtime.ts`, `zalo-dm.ts`,
`public-sessions.ts` · `apps/bot/src/outbox-wake.ts` (+ `.test.ts`) · `apps/bot/src/draft-expiry-job.ts` (+ `.test.ts`) ·
`scripts/outbox-dlq-replay.mjs` · `docs/runbooks/outbox-dispatch-enable-rollback.md`.

## 4. B3 exception (budget: about 300 LOC, 3 modules, 1 migration)

- Modules: `packages/db` (0056, schema.ts, db.dbml, NEW migration test, D-20 bumps), `apps/bot` (dispatcher, worker, queues,
  heartbeat, NEW registry, projectors, wake, expiry job, tests), `scripts` (NEW CLI); docs (runbook, kit-pack pair) are not
  a code module. Migrations: exactly one.
- Caps: total changed lines (insertions + deletions of `git diff --shortstat b0bf565..HEAD`, this file excluded) <= 3800,
  of which non-test code (SQL, TS, mjs, schema.ts, db.dbml) <= 1800. Above either cap the writer stops at a coherent point
  and reports partial with the rest under OPEN; the PR body cites the measured shortstat.
- Why a split breaks coherence: (1) every TS consumer calls a function only 0056 creates, so a migration-only PR ships
  definers with live EXECUTE grants and no caller, and a TS-only PR calls functions absent from main; (2) DONE WHEN is
  joint: no stub in the required set, end-to-end DLQ replay and a recorded p95 each need registry + policy + wake + CLI
  together; (3) one migration per lane and no stacked PRs: a second migration lane pushes L4, L5 and L10 (all "L3 merged")
  out by a session; (4) the draft expiry rides the same definer posture, grants, migration and flag gate.
- Compatibility proof (rolling deploy): (i) old worker + new DB: base code never runs a cycle (stub hard-wired at
  worker.ts:138, refused at :88-94, consumer only when enabled :157-167), so it never acks with a stale set; its 3-arg
  heartbeat resolves to the new function (P1) and records NULL, which the live check treats as off. (ii) new worker + old
  DB: preflight and QUEUES unchanged, so it boots; the registry probe fails, so dispatch stays OFF and nothing is claimed;
  the 4-arg heartbeat fails (42883), is logged and retried, and the health file goes stale within 90 s (loud). Migrate
  first. (iii) An acked event never gains a projector: claims skip acked rows (0023:155, :180), the required set is read
  only for events being acked, L3 ships no reproject or backfill, and A5 proves it. (iv) Two new workers: each event's set
  is computed once per claim and used for prepare and ack; claim tokens stop a double ack (0023:280-286). (v) Seeds are all
  disabled, so even with the flag on every event acks with `'{}'` (no DLQ flood). (vi) The trigger is additive and silent
  for old code. (vii) app gains two boolean functions only.

## 5. Acceptance matrix

| ID | Group | Input / precondition | Expected | Layer |
|---|---|---|---|---|
| A1 | Migration | fresh migrate; remigrate; JCL-1 and BR-6 runs | 57 applied, tail 0056, idempotent; applies under INHERIT and NOINHERIT non-superuser owners | db |
| A2 | Migration | after 0056 | exactly 3 projector rows, all disabled; exactly 1 route (web_realtime, session, NULL) | db |
| A3 | Boundary | route inserts as job_definer: wildcard for zalo_dm or public_sessions; zalo_dm type outside the 4; bad grammar; duplicate incl. NULL; unknown projector | each refused by its named CHECK / unique / FK | db |
| A4 | Happy/boundary | events with no route; web_realtime disabled; enabled; exact + wildcard; unknown id | `'{}'`; `'{}'`; `'{web_realtime}'`; sorted union; 23503; never NULL | db |
| A5 | Concurrency | event acked with set S, then enable a projector / add a route, run cycles | no delivery row is ever created for the acked event | db + bot |
| A6 | Authorization | app, app_worker, readonly call list/replay/set_enabled; app calls outbox_required_projectors, outbox_claimed_event, job_expire_stale_drafts; app_worker direct SQL on projector_deliveries, registry tables, sessions; readonly calls the two read functions | 42501 each, zero rows changed (counts before = after), under the jobd reader lock | db |
| A7 | Security | catalog for every D-3 function | owner, prosecdef, `search_path=public, pg_temp`, EXECUTE exactly per role and PUBLIC false; one heartbeat overload | db |
| A8 | Security | role_table_grants + role_column_grants for app_worker | 0 rows in every schema except pgboss (measured 0 at base) | db |
| A9 | Happy | owner path (superuser seat + SET ROLE job_definer) replays a dlq row | pending, attempts 0, next_attempt_at NULL, one audit row (owner, projector_delivery_replayed), nothing else touched; next cycle redelivers | db + bot |
| A10 | Failure | replay of a missing pair; of delivered, failed, claimed, pending rows | P0002 / 55000 naming the status; zero writes incl. no audit row | db |
| A11 | Boundary | list with filter, limit 0 and 501 | dlq rows only, filtered, no payload column; 22023 | db |
| A12 | Compatibility | 3-arg and 4-arg heartbeat; live check with no row, fresh true, fresh false/NULL, stale true | NULL recorded / value recorded; false, true, false, false | db + bot |
| A13 | Boundary | projector_is_enabled NULL/unknown/disabled/enabled; set_enabled change, no-op, unknown | false/false/false/true; true, false, P0002 | db |
| A14 | Security | outbox_claimed_event with the right token; wrong token; expired lease; unclaimed; completed | one row; zero rows otherwise | db |
| A15 | Observability | insert by app, by owner, multi-row statement, rolled back | one notification each on `outbox_wake`, empty payload; one per statement; none on rollback | db |
| A16 | Happy | empty past draft; future draft; open, closed, cancelled sessions | cancelled, version + 1, one session.cancelled (auto, 0, false), fence raised (guarded view 0 rows), one audit row; others untouched; parity with host cancelSession except cancel_reason | db |
| A17 | Concurrency | second run | 0 cancelled, no new event or audit row for that session | db |
| A18 | Data integrity | draft with a player (each status) or a charge; >= p_limit anomalies + 1 empty | no mutation, one anomaly event (auto, fields) + one audit row per run; the empty draft is still cancelled | db |
| A19 | Concurrency | (a) a concurrent transaction (publishSession) holds the draft row FOR UPDATE; (b) expiry holds it inside an open transaction | (a) expiry skips it (SKIP LOCKED); once publish commits the open row is never cancelled; (b) publishSession waits, then SESSION_NOT_OPEN (edge #29) | db |
| A20 | Concurrency | two concurrent expiry runs | each row cancelled once, one event per row (edge #30) | db |
| A21 | Security | caller transaction with a prior app.tenant_id, incl. a forced exception | GUC equals its prior value after the call | db |
| A22 | Boundary | p_limit 0 and 101 | 22023 | db |
| A23 | Failure | retryable at attempts 0..6; at 7; terminal at any; throw; malformed; projector nextAttemptAt set | waits 15..960 s (sum 1905 s); dlq attempts_exhausted; dlq projector code; deliver_threw; malformed_*; schedule ignores the projector value | bot |
| A24 | Regression | `git grep stub_projector` outside tests; disabled projector; enabled placeholder; enabled name without map entry | none; deliver spy 0, rows wait; dlq projector_not_implemented; rows untouched | bot |
| A25 | Regression | JRD-5, JRD-12 extended to the new functions and every NEW shipped bot file | dispatcher SQL = allowed function calls only, no table name; no INSERT INTO outbox_events in shipped files | bot |
| A26 | Concurrency | NOTIFY; burst of K <= 25 inside the window; wake during a cycle; two runners on one DB; full batch; killed LISTEN client | one debounced cycle; one cycle claims all K; exactly one follow-up; each (event, projector) delivered once; drains <= 20 cycles; reconnect + catch-up | bot |
| A27 | Authorization | flag unset, "false", garbage; "true" + stub; "true" + probe failure; "true" + registry | OFF (no LISTEN, consumer, expiry); OFF; OFF with reason; registered (spawned process), heartbeat reports exactly the gate | bot |
| A28 | Regression | cron-driven run vs wake vs flag OFF | expiry once per cron run, never on a wake, never when OFF; counts-only log | bot |
| A29 | Observability | gated sync-lag test (section 6) | p50/p95/p99/max recorded with the stated load; not asserted in CI | bot (local) |
| A30 | Regression | S1 VERIFY set; collection | green; db >= 1225, bot >= 129 except listed replacements (malformed_next_attempt cases, REQUIRED_PROJECTORS test); dispatcher-outcome containment intents kept; 0022/0023 untouched; both flag defaults false | all |
| A31 | Privacy | NOTIFY payload; envelope reader; CLI output; DLQ list; payloads | empty; current claimant only; no URL/credential; no payload; no new PII; no public_sessions write | db + bot + review |
| A32 | Observability | replay, auto-cancel, anomaly | each writes its audit row; cycle summaries and expiry counts logged | db + bot |
| A33 | Scope | `git diff --name-only b0bf565..HEAD` | within TARGET_FILES + 3.9 + D-21 test files + this file; one migration; section 4 caps | static |

## 6. Sync-lag measurement plan (D-19; local test process only)

- Where: a `describe.skipIf(process.env.OUTBOX_SYNC_LAG_MEASURE !== "1")` block in NEW `apps/bot/src/outbox-wake.test.ts`,
  so CI never runs it. It drives the real wake loop and runner in-process against its own test DB (S1 ENABLEMENT: a direct
  dispatch call inside a local test process; `OUTBOX_DISPATCH_SCHEDULE_ENABLED` is never set).
- Setup: one test-only projector (for example `lag_probe`, enabled) with a route for a test event type and an in-test
  deliver function returning delivered; one worker runner as app_worker, batch limit 25, debounce 100 ms; a separate client
  inserts the events.
- Load: 10 events/s for 60 s, N = 600, each insert its own committed transaction (one NOTIFY each). Optional second run:
  bursts of 50 events in one transaction every 5 s, N = 600.
- Metric: per event `projector_deliveries.delivered_at - outbox_events.created_at` (one DB clock, no skew); report N, p50,
  p95, p99, max, cycles run. Target p95 <= 3 s and p99 <= 10 s (NFR-1c, TDD.md:125); the measured value is reported as is
  (plan risk 3: report the number with the load, do not promise it). It goes in the PR body and in L3's section of the
  P3-S2 report.

```bash
# Inside the DB/e2e lock only; run with bash (the agent shell is zsh).
export NODE_ENV=test DATABASE_URL_TEST=postgres://plexco:plexco_dev@localhost:5432/plexco_test
OUTBOX_SYNC_LAG_MEASURE=1 pnpm --filter @plexco/bot exec vitest run src/outbox-wake.test.ts -t "sync lag"
```

## 7. Closure matrix (gate section 8)

| # | Gate | Evidence | Result |
|---|---|---|---|
| 1 | Authority snapshot pinned by SHA | `b0bf565ed72d8c4be3f47d3fe7a4e0e382605928`, exact TARGET_FILES, worktree HEAD equal | PASS |
| 2 | Decisions in scope closed | DD-134 (a)(b)(e) + (c) override signed; DD-89/DD-90; DD-122 D4 | PASS |
| 3 | Scope IN/OUT and owner clear | verdict IN_SCOPE / OUT_OF_SCOPE, 3.9, D-20, D-21, section 4 | PASS |
| 4 | Dependencies classified | L1 merged (#62); every object called exists at base (2.2, 2.3) | PASS |
| 5 | Live code matches the doc | every lane cite re-measured (2.2); corrections C1-C10 | PASS |
| 6 | Data/API/state/auth contract | D-2..D-18 | PASS |
| 7 | Fail-closed, idempotency, order | D-5..D-7, D-9, D-11, D-14, D-15, D-18; compatibility proof | PASS |
| 8 | Open questions in scope = 0 | D-1..D-24 pinned | PASS |
| 9 | Acceptance matrix has expected results | section 5, A1-A33 | PASS |
| 10 | Migration, security, rollback pinned | D-1..D-4, D-12, D-23; probes P1-P5; revert = forward migration after the flag is off | PASS |
| 11 | First slice hard dependencies merged | #62 cf109e6 ancestor of the base | PASS |
| 12 | Implementation handoff ready | worktree at base, FIRST_IMPLEMENTATION_STEP, section 8 | PASS |

## 8. Handoff

1. Failing-first `packages/db/src/outbox-projector-registry.test.ts` (A1-A22), then 0056 with schema.ts, db.dbml and the
   D-20 bumps; db suite once under the lock.
2. Bot: projectors/ (D-8), projector-registry.ts, dispatcher.ts (D-5..D-7), heartbeat.ts (D-12), worker.ts (D-14, D-16),
   outbox-wake.ts (D-11), draft-expiry-job.ts, queues.ts comments; tests A23-A28 and the extended JRD-5/JRD-12.
3. CLI (D-10) + the D-21 kit-pack record and `pnpm kit:generate`; runbook (D-23); local end-to-end replay with the CLI
   against a scratch DB, output in the PR body.
4. Sync-lag run (section 6) under the lock; S1 VERIFY set; opus/max review then opus/max security round, at most 3 rounds.

PR body: "Codex waived by owner 2026-10-12; reviewed by independent Claude subagent"; D-1..D-24; the sync-lag table with its
load; the shortstat; blast radius (GitNexus stale at dd5375f, production bot files unchanged since; grep counts of 2.1); the
end-to-end replay transcript. OPEN (out of scope, for L17 or later lanes): `.env.example:80-94` stale ENABLEMENT BLOCKER
comment and `feature_sync_engine_tech.md` / BUILD-STATUS as-built text; backlog rows projector-real-replace-stub,
db-projector-dlq-no-replay-path, job-outbox-dispatch-sync-lag-slo, job-scheduler-cron-registration and
audit-2026-09-06-d6-outbox-no-attempt-bound (outbox-side bound still absent); L4: insert its three routes, reload canonical
state and drop stale events (backlog and long-disable staleness); L8: the one `player.promoted` route; L10: its routes; anomaly
events repeat once per cron tick per anomalous draft (spec "every detection"; cadence is operational config); worker/DB clock
skew note of D-7; the P3-S1 D12 follow-up (reorder all three jobd-then-chad sites together) is unchanged.
