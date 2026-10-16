<!-- review-readiness: code-ready -->

# Step-0 readiness: p3-m6-web-live-sync (Phase 3 lane L5)

> Agent-facing (English). Session P3-S3 step 0, written by the readiness reviewer (Opus 5.5 / max), not the writer.
> Authority: lane block L5 of the Phase 3 RUN doc (as carried in the P3-S3 worker brief); DD-134 (D2) signed by the owner
> 2026-10-16 (`docs/standards/decisions.md:123`, `:1812`, (c) at `:1820`, signature `:1833`); L3 readiness D-1..D-24
> (`docs/sessions/web-mvp-phase3-readiness-p3-m6-outbox-delivery-core.md`), which stand unchanged; the DD-122 D4 review
> policy; this verdict.
> Base: `origin/main` `442aa1bf61234a7b4330295dfd36211446988a8a` (L3 merged as #64, merge `98a4a6c920acbe2647f6e1ef710a21e535be6c8d`).
> Every item R-1..R-20 in section 3 is "default applied, pending owner sign-off": the PR body repeats them and L17
> consolidates them into one decisions entry. This file does not edit `docs/standards/decisions.md`.

## 1. Verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-10-16
AUTHORITY_SHA: 442aa1bf61234a7b4330295dfd36211446988a8a
BASE_BRANCH: main
TARGET_FILES:
  - apps/bot/src/projectors/web-realtime.ts
  - apps/web/lib/use-sessions-data.ts
  - apps/web/components/sessions/session-detail-view.tsx
  - apps/web/components/sessions/sessions-list-view.tsx
  - packages/db/src/index.ts
SLICE: p3-m6-web-live-sync
IN_SCOPE: real web_realtime projector (pg_notify of the event id on channel web_realtime); NEW db read function (event id to type, session id, sequence under the caller's tenant, RLS-filtered); NEW web LISTEN client with in-memory fan-out, per-event re-authorization and a heartbeat re-check; NEW GET /api/realtime/subscribe SSE route (node runtime) reusing the host read gate; NEW client hook use-realtime.ts with exponential reconnect and full jitter; opt-in live refresh for the session list and detail views; NEW unit, DB and e2e tests and a local p95 measurement
OUT_OF_SCOPE: any migration; chat events (L15); any public or anonymous stream; any client polling fallback; any pushed field beyond type, sessionId, version; edits to session-service.ts, roster-service.ts, session-form.tsx, edit-session-view.tsx, session-api-mock.ts, dispatcher.ts, projectors/index.ts, request-policy.ts, middleware.ts, next.config.mjs; enabling the schedule flag or the web_realtime row in any committed default
G1_DECISION: PASS # DD-134 (a)-(f) signed 2026-10-16, (c) web_realtime receives every session event (decisions.md:1820, :1833); DD-122 D4
G2_SPEC: PASS # feature_sync_engine_tech.md realtime rows :49, :146, :161, :163-170, :221, :277-279, :296 + lane block + section 3
G3_DEPENDENCY: PASS # L3 merged as #64 (98a4a6c, ancestor of 442aa1b); every table, grant, policy, function and helper used exists at the base (section 2)
G4_TEST: PASS # acceptance A1-A27 pinned before code (section 5), every decision-table row and lane TEST mapped
G5_SCOPE: PASS # exact files, scope additions R-1 and R-13, explicit B3 exception with hard caps (section 4), zero migrations
G6_EXTERNAL: ENABLEMENT_ONLY:schedule-flag-owner-P0,web-realtime-projector-enable-owner-P0 # no provider call, dark by default
HARD_DEPENDENCIES: L3 p3-m6-outbox-delivery-core merged as #64 (merge 98a4a6c920acbe2647f6e1ef710a21e535be6c8d, ancestor of the base); DD-134 signed
PRIOR_SLICES: none
OPEN_QUESTIONS_IN_SCOPE: 0 # every gap pinned as R-1..R-20
ENABLEMENT_ONLY_GATES: OUTBOX_DISPATCH_SCHEDULE_ENABLED=true on the worker for real use (owner P0); outbox_projector_set_enabled('web_realtime', true) by the owner only after this lane is merged and deployed on every worker (runbook section 2 step 4)
LIVE_REPO_VERIFICATION: PASS # section 2
CONTRACT_MATRIX: PASS # section 3
CLOSURE_MATRIX: PASS # 12/12, section 7
ACCEPTANCE_MATRIX: PASS # section 5
SECURITY_AND_MIGRATION_GATE: PASS # no migration; RLS-filtered read per subscriber tenant; per-event and per-heartbeat re-authorization; opus/max security round
IMPLEMENTATION_ARTIFACTS: PASS # DD-122 D4: no scope-gate lifecycle; lane block + this file + the worktree at the exact base
FIRST_IMPLEMENTATION_STEP: in .autopilot/worktrees/p3-m6-web-live-sync (base 442aa1b plus this readiness commit), write the failing DB test NEW packages/db/src/realtime-event-read.test.ts (A20, A7 core), then NEW packages/db/src/realtime-event-read.ts and its export line in packages/db/src/index.ts
REMAINING_BLOCKERS: none
```

## 2. Measured at base (442aa1b)

### 2.1 Snapshot

- Worktree HEAD = `origin/main` = `442aa1bf61234a7b4330295dfd36211446988a8a`, branch `feat/p3-m6-web-live-sync`, clean, no
  `index.lock`. L3 is in: `git merge-base --is-ancestor 4139cab HEAD` holds; `web-realtime.ts` was last touched by 4139cab.
- Migrations: 57 files `0000`..`0056`, tail `0056_outbox_projector_registry_dlq_replay.sql`. L5 adds none (next free would
  be `0057`).
- `apps/web/app/api/realtime/` does not exist at the base.

### 2.2 Q1: the L3 contract web_realtime implements

- `DeliverFn = (job: ClaimedDeliveryJob) => Promise<DeliveryOutcome>` (`apps/bot/src/dispatcher.ts:46`). The job carries
  `eventId, tenantId, projector, claimToken, attempts, event` (`:25-34`); `event` is the claim-bound envelope
  (`ProjectorEvent`: eventType, aggregateType, aggregateId, sequence, tenantId, payload, createdAt;
  `apps/bot/src/projector-registry.ts:13-21`, read by `outbox_claimed_event`, `:60-82`).
- Outcomes: `delivered {providerRef?}` | `retry {errorCode}` | `dlq {errorCode}` (`dispatcher.ts:41-44`); error code grammar
  `ERROR_CODE_RE` (`:372`); a throw becomes `dlq deliver_threw` (`:255-269`); the dispatcher is the only retry scheduler
  (`:11-14`, D-7). Contract D-18 (`apps/bot/src/projectors/index.ts:13-20`): idempotent per (aggregate_id, sequence),
  tolerate replay and reorder, reload canonical state, never act on stale facts.
- `deliver()` receives no DB handle and `PROJECTORS` is a static map (`projectors/index.ts:21-25`, not edited); the
  worker pool is built from `DATABASE_URL_DIRECT` (`apps/bot/src/worker.ts:116-127`). Placeholder to replace:
  `web-realtime.ts:9-12` (`dlq projector_not_implemented`).
- Wildcard route: `event_type IS NULL` is legal only for `web_realtime` (`0056:97-98`); seed
  `('web_realtime', 'session', NULL)` (`0056:107-108`); `outbox_required_projectors` matches exact or wildcard
  (`0056:111-141`) and the set is computed once at ack (D-5, `dispatcher.ts:186-205`). Every session-aggregate event type,
  including L8's later roster and join-request events, reaches web_realtime with no code change. L3 OPEN 10 (tenant scope
  and field whitelist) is closed by R-4, R-5 and R-8.
- Registry rows are seeded disabled (`0056:72-79` `enabled DEFAULT false`, `:106`). Enabling is
  `outbox_projector_set_enabled(text, boolean)`: SECURITY DEFINER, `REVOKE ALL FROM PUBLIC`, no grant (`0056:156-181`), so
  owner path only (`SET ROLE job_definer`). Test precedent: `packages/db/src/outbox-projector-registry.test.ts:60`, `:254`.
  Real enablement: runbook `docs/runbooks/outbox-dispatch-enable-rollback.md` section 2 (flag `:35-37`, backlog drain
  `:44-48`, enable `:50-56`), only after L5 is merged and deployed on every worker (`:14-15`).
- Wake channel `outbox_wake` carries an empty payload (`0056:39-60`, D-11) and is separate from L5's channel. No migration
  revokes `pg_notify` (grep of all migrations), so `app_worker` may call it; any role may LISTEN on any channel
  (`0056:42`), and any role may also NOTIFY on it: the web side treats every payload as untrusted (R-9).

### 2.3 Q2: event id to {type, session id, version, tenant}, re-authorized per subscriber

- `outbox_events` (`0005_sync_engine.sql:21-33`): `id`, `tenant_id`, `aggregate_type`, `aggregate_id`, `sequence`, `type`,
  `payload`; `UNIQUE (aggregate_id, sequence)`. RLS ENABLE + FORCE with `tenant_isolation` on
  `NULLIF(current_setting('app.tenant_id', true), '')::uuid` and `GRANT SELECT, INSERT, UPDATE, DELETE ... TO app`
  (`0009_rls_policies_grants.sql:38`, `:47-57`); `0022:548` revokes UPDATE and DELETE only; no later revoke.
  `withTenant` sets `app.tenant_id` transaction-local (`packages/db/src/tenant.ts:61-71`).
- Therefore a SELECT by id under `withTenant(T)` returns the row only when the event is T's: RLS itself filters, with the
  existing grant and policy. No migration is needed.
- The application layer cannot run that SELECT from apps/web: `@plexco/db/schema` is lint-restricted there
  (`eslint.config.mjs:107`, `:125-137`; `packages/db/src/index.ts:1-8`, "controllers/adapters must never query tenant
  tables directly (HR1)"); apps/web has no `drizzle-orm` dependency (`apps/web/package.json:13-21`); every apps/web
  `withTenant` call delegates to a `@plexco/db` function (`apps/web/lib/session-command-route.ts:118-120`,
  `apps/web/lib/club-config-route.ts:48`). No exported function reads `outbox_events` (only the test fixture
  `packages/db/src/roster-money-fixtures.ts:90`, `:97`). Hence scope addition R-1.
- Event payloads carry no version (`packages/db/src/session-service.ts:315`, `:697`, `:960`, `:1560`, `:1576`;
  `roster-money-shared.ts:155-162`), so the pushed `version` is `outbox_events.sequence` (R-5).
- `outboxEvents` drizzle columns: `id, tenantId, aggregateType, aggregateId, sequence, type` (`packages/db/schema.ts:1434-1441`).

### 2.4 Q3: the authorized read path realtime-auth.ts reuses

- `GET /api/sessions` (`apps/web/app/api/sessions/route.ts:54-77`) and `GET /api/sessions/:id`
  (`apps/web/app/api/sessions/[id]/route.ts:54-69`) both run `handleSessionRead` (`apps/web/lib/session-read-route.ts:77-105`)
  then `resolveSessionReadContext` (`:47-71`), in this order: session cookie (`:51-52`, 401), tenant param (`:54-57`, 400),
  actor ceiling (`:58-60`; 60 per minute per account, `session-command-route.ts:88`; 429), `mayManageSessions` (`:62`, 403;
  `withTenant` + `authorize(session.manage)`, `session-command-route.ts:117-122`), tenant language (`:64`), per-tenant
  bucket (`:65-69`, 429 in the tenant language).
- Envelope (`apps/web/lib/api-envelope.ts:36-53`): `{data: null, error: {code, message, statusCode}, meta: {requestId}}`,
  `cache-control: no-store` (`:11-18`). Exact bodies:
  - 401 `AUTH_REQUIRED` `t("Chưa đăng nhập.", "Not signed in.")` (`session-read-route.ts:52`)
  - 400 `INVALID_BODY` `t("Thiếu hoặc sai mã CLB.", "Missing or invalid club id.")` (`:56`)
  - 403 `FORBIDDEN` `t("Bạn không có quyền với CLB này.", "Not permitted for this club.")` (`:43-44`): one body for
    non-member, foreign or unknown tenant and missing capability (`:61-62`), no existence oracle
  - 429 `RATE_LIMITED` `t("Quá nhiều yêu cầu — đợi.", "Too many requests — wait.")` (`:59`, `:67`)
- Principal: `currentSession()` (`apps/web/lib/session-cookies.ts:179-183`) reads `SESSION_COOKIE` (`:31`) and calls
  `resolveWebSession(appDb().pool, hashToken(raw))` (`:144`). `resolveWebSession` enforces a 14-day idle window on top of
  the 30-day TTL and touches `last_seen_at`, throttled to once per minute (`packages/db/src/auth.ts:66-78`;
  `session-cookies.ts:32`).
- `appDb()` is one `pg.Pool` per process, `max 10` (`packages/db/src/client.ts:26-33`), app role; the `DB_EXPECTED_ROLE`
  gate wraps `pool.connect` (`session-cookies.ts:54-106`), so a client checked out for LISTEN is role-checked too.

### 2.5 Q4: routing role, CSP, stream headers, runtime

- `parseProcessRole` defaults to `web`; `pathAllowedForRole` allows everything for web and only `/healthz` and
  `/discover*` for discovery (`apps/web/lib/request-policy.ts:26-39`); middleware 404s anything else on discovery before any
  handler (`apps/web/middleware.ts:39-43`; matcher `:70-73`). `/api/realtime/subscribe` is therefore served by web and
  refused by discovery with no edit (A17 pins it).
- CSP: the static policy has no `default-src` or `connect-src` (`apps/web/next.config.mjs:60-63`); the nonce policy adds
  only `script-src` and `worker-src` (`request-policy.ts:61-70`). A same-origin EventSource is allowed in both modes, no
  edit (A18 pins it). `SECURITY_HEADERS` apply to every route (`next.config.mjs:70-72`), harmless on the stream.
- The service worker never intercepts `/api/*` (`apps/web/sw/sw.template.js:7`, `:57-62`).
- Next `^15.1.4` (`apps/web/package.json:18`). A route module may export only HTTP verbs and the fixed config fields
  (`request-policy.ts:89-92`): `runtime = "nodejs"` and `dynamic = "force-dynamic"` are config fields.

### 2.6 Q6: the data hooks today

- `apps/web/lib/use-session.tsx:20-44` is the AUTH session hook (`GET /api/auth/session`), not the session-data hook: it
  needs no change and L5 does not edit it (OPEN O2).
- `useSessionDetail` = `useLoadable(getSession)` (`apps/web/lib/use-sessions-data.ts:65-70`); `useLoadable` has `reload`
  (loading state, `:57`) and a silent `refresh` (`:58-61`). `useSessionList` (`:84-191`) has only `reload` (`:189`), which
  resets to loading and drops loaded pages (`:96-104`). Fetchers: `listSessions`, `getSession`
  (`apps/web/lib/sessions-api.ts:124-147`).
- Call sites: `apps/web/components/sessions/sessions-list-view.tsx:20`, `session-detail-view.tsx:37`,
  `edit-session-view.tsx:24`. The edit view keys `SessionForm` by `${session.id}:${session.version}` (`:76`) and sends
  `expectedVersion: session.version` (`:96`): a live refresh there would remount the form and wipe typed input. Live
  refresh is therefore opt-in and stays off in the edit view (R-13).

### 2.7 Q7: e2e harness

- Default config: wire-protocol stub `e2e/support/fake-postgres.mjs` plus `next build` and `next start`
  (`apps/web/playwright.config.ts:8`, `:33-47`), `testIgnore` golden path only (`:22`). APIs are mocked per page by
  `installApiMock` (`apps/web/e2e/support/session-api-mock.ts:187`) with per-page `state` (`:147-163`) and `signIn`
  (`:172-185`). The golden path is local only (`apps/web/e2e/golden-path.config.ts:12-27`).

### 2.8 Q10: dispatcher.ts:74

- `dispatcher.ts:74` says "Claims whose envelope read found the lease already gone", while a null read also means not
  registered, enabled or routed (`:239-243`). L5 does not edit `dispatcher.ts`, so the comment stays (L3 OPEN 13 stays open).

## 3. Contract (R-1..R-20, each "default applied, pending owner sign-off")

- **R-1** Scope addition (like L3 D-20/D-21): NEW `packages/db/src/realtime-event-read.ts` exporting
  `readSessionRealtimeEvent(tx: Tx, eventId: string): Promise<{ type: string; sessionId: string; version: number } | null>`;
  it rejects a non-UUID id (returns null, no query), selects `type, aggregate_id, sequence` from `outbox_events` where
  `id = eventId AND aggregate_type = 'session'`, and relies on the caller's `withTenant` for RLS; one export line in
  `packages/db/src/index.ts`; NEW `packages/db/src/realtime-event-read.test.ts` (DB, `setupRlsTestContext`, D-22).
- **R-2** Projector (`apps/bot/src/projectors/web-realtime.ts`): keeps `export const deliverWebRealtime: DeliverFn`.
  `aggregateType !== "session"` gives `dlq unsupported_aggregate`; otherwise one
  `SELECT pg_notify('web_realtime', $1)` with `$1 = job.eventId` (36 characters, nothing else). Success gives `delivered`;
  a query error gives `retry notify_failed` (a repeated NOTIFY only causes an idempotent refetch). No staleness cutoff: the
  projector carries no facts, the client refetches canonical state.
- **R-3** Projector DB handle: lazily created `new pg.Pool({ connectionString: process.env.DATABASE_URL_DIRECT, max: 1 })`
  inside `web-realtime.ts`, plus one exported test seam that injects a `Queryable`. `projectors/index.ts` is not edited.
- **R-4** LISTEN channel: `web_realtime`, a single channel. Per event the web reads once per distinct subscribed tenant
  (memoized per event), and stops at the first tenant whose RLS read returns the row.
- **R-5** Pushed message whitelist: exactly `{type, sessionId, version}`; `type` = `outbox_events.type`, `sessionId` =
  `aggregate_id`, `version` = `outbox_events.sequence` (per-session event sequence, not `sessions.version`). SSE frame:
  one `data: <json>` line, then a blank line; no `event:`, `id:` or `retry:` field. Heartbeat: one comment line `: hb`.
- **R-6** Route `apps/web/app/api/realtime/subscribe/route.ts`: `GET` only; `runtime = "nodejs"`,
  `dynamic = "force-dynamic"`. Gate = `resolveSessionReadContext(request, { bucket: "realtime-subscribe", limit: 30 })`
  unchanged (identical 401, 400, 403 and 429 bodies by construction), then `currentSession()` for the principal (null gives
  the same 401). Headers: `content-type: text/event-stream; charset=utf-8`, `cache-control: no-store, no-transform`,
  `x-accel-buffering: no`.
- **R-7** Per-account concurrent stream cap: 5 per web process; the 6th gets the same 429 `RATE_LIMITED` body.
- **R-8** Per-event re-authorization (`apps/web/lib/realtime-auth.ts`): before any frame, the subscriber's tenant must own
  the event (R-1 under `withTenant`) and `mayManageSessions(tenantId, personId)` must be true now (memoized per
  (tenant, person) per event). Denied gives a drop with nothing sent; the stream stays open until the heartbeat.
- **R-9** NOTIFY payload validation: lowercase canonical UUID only; anything else is dropped and logged as
  `realtime.notify.invalid_payload` without echoing the payload. An unknown id reads no row and is dropped.
- **R-10** Heartbeat every 25 s (at most 30 s): re-resolve the session by the token hash captured at subscribe time
  (`resolveWebSession`), same account, and `mayManageSessions`; any failure or error closes the stream (fail closed).
- **R-11** Stream lifetime: at most 15 min, then the server closes it (short session-bound connection, tech doc `:170`).
- **R-12** LISTEN client (`apps/web/lib/realtime-listener.ts`): one per web process, a client checked out from
  `appDb().pool` (app role, role-gated, 9 of 10 pool slots left), started at the first subscriber and released at zero.
  Fan-out `Map<tenantId, Set<Subscriber>>`. Pending-id queue bound 1,000; overflow closes every stream and clears the queue.
  Per-stream queue `highWaterMark` 16; `desiredSize <= 0` closes that stream. On connection loss: close every stream
  (missed NOTIFYs cannot be replayed; clients reconnect and refetch), then reconnect with R-14.
- **R-13** Scope addition: live refresh is opt-in, `options?: { live?: boolean }` defaulting to false on `useSessionDetail`
  and `useSessionList`. One changed line each in `session-detail-view.tsx:37` and `sessions-list-view.tsx:20`;
  `edit-session-view.tsx` is not edited and stays non-live.
- **R-14** Backoff (client and listener): base 1,000 ms, factor 2, cap 30,000 ms, full jitter (uniform 0..cap), reset on a
  successful open.
- **R-15** Client hook `apps/web/lib/use-realtime.ts`: one native EventSource per tenant per tab (module-level, reference
  counted), URL `/api/realtime/subscribe?tenant=<id>` (same origin, cookie sent). On every error it closes the EventSource
  (no browser auto-retry) and schedules R-14. It refetches once on each re-open (resync) and once at the first failure
  after an open (this surfaces AUTH_REQUIRED or FORBIDDEN through the authorized GET, which turns live off); it never
  refetches on a timer. Messages failing the R-5 shape are ignored; a (sessionId, version) at or below the last seen is
  ignored.
- **R-16** Refresh policy: detail refreshes silently (`refresh()`) when `sessionId` matches or on resync. The list gets a
  new silent refresh: no loading state, each stream refetched with `limit = min(50, max(20, loaded))`. Both are
  single-flight with at most one queued rerun, with no fixed delay.
- **R-17** Malformed or missing `?tenant` gives the existing 400 `INVALID_BODY` (syntax only, not an existence oracle).
- **R-18** Idle window: the heartbeat re-check touches `last_seen_at` (throttled to once per minute), so an open live tab
  counts as activity for the 14-day idle window. The 30-day TTL, logout and revocation still close the stream at the
  next heartbeat.
- **R-19** Enablement: tests enable `web_realtime` only inside their own DB (superuser seat plus `SET ROLE job_definer`,
  inside `withJobDefinerLock`, D-22). The local p95 enables it only on the scratch `plexco_smoke` DB with the runbook
  section 2 step 4 SQL, disables it afterwards, and sets `OUTBOX_DISPATCH_SCHEDULE_ENABLED=true` only in that worker
  process env (S1 ENABLEMENT). `.env.example` and compose stay false.
- **R-20** p95 method: NEW `apps/web/e2e/realtime-live.spec.ts` (self-skips unless `REALTIME_LIVE_BASE_URL` is set) run by
  NEW `apps/web/e2e/support/realtime-live.config.ts` (no webServer) against the real local stack (local-mvp-smoke runbook
  setup, dev-login). Two contexts on one tenant; 30 sequential host edits paced at 1 per second; latency = A's PUT
  response to B's DOM showing the new value. It prints one line
  `REALTIME_P95 {"n":30,"p50":..,"p95":..,"p99":..,"max":..,"load":"1 edit/s, 2 contexts, 1 tenant"}`, pasted into the PR
  body. Every DB or e2e run goes through `locked-run.sh`.

## 4. B3 exception

- Modules (5): (1) bot projector `web-realtime.ts`; (2) db read function R-1; (3) web realtime server
  (`realtime-listener.ts`, `realtime-auth.ts`, `route.ts`); (4) web client (`use-realtime.ts`, `use-sessions-data.ts`, the two
  view lines); (5) e2e (two specs, the stream mock, the live config).
- Why a split breaks coherence: the id-only NOTIFY contract is only provable end to end with the listener and auth that
  consume it (A7, A10); a listener without the route is dead code; a route without the hook is unobservable and its
  decision table is the hook's stop and back-off contract; a hook without the route opens a stream that 404s everywhere.
  Fallback if the orchestrator refuses the exception: L5a = modules 1-3 (dark and safe alone), L5b = modules 4-5; DONE
  WHEN needs both.
- Compatibility proof: no migration; no DTO, route or envelope change; the web_realtime row stays disabled in every
  committed state (`0056:74`, `:106`); `live` defaults to false, so the edit view and existing tests behave byte-identically;
  request-policy, middleware and next.config are untouched; the replaced placeholder is reachable only if the row is enabled.
- Hard caps: non-test production code at most 650 changed lines (estimate 560) across exactly the files of R-1, R-2, R-3,
  R-6, R-8, R-12, R-13 and R-15; total at most 2,300 changed lines including tests and e2e (estimate 1,900); zero migrations;
  any other path means stop and report.

## 5. Acceptance matrix (expected results)

- **A1** (decision row 1) No session cookie: 401, exact `AUTH_REQUIRED` body, no stream opened.
- **A2** (row 2) Non-member, foreign or unknown tenant, or no `session.manage`: 403 bodies identical apart from `requestId`.
- **A3** (row 3) Authorized subscriber, event in its tenant: exactly one frame `{type, sessionId, version}`.
- **A4** (row 4) Membership ended or role changed after subscribe: the next event sends nothing; the next heartbeat closes the stream.
- **A5** (row 5) 6th concurrent stream for one account: 429 `RATE_LIMITED`; after one closes, a new one is admitted.
- **A6** (row 6) An event whose payload carries extra fields (changed_fields, visibility, tenant_id, amounts): frame keys
  are exactly `sessionId, type, version`.
- **A7** Cross-tenant leak (DB-backed, two tenants subscribed): tenant A's real `updateSession` event reaches A only, never B.
- **A8** Revoke mid-stream: after membership removal, no further frames.
- **A9** Heartbeat: fake timers show a comment frame at 25 s and a re-check at every beat; none later than 30 s.
- **A10** NOTIFY payload: channel `web_realtime`, payload equal to `job.eventId`; a real LISTEN in a bot DB test receives
  only the id after a dispatch cycle with web_realtime enabled through `outbox_projector_set_enabled`; disabled means none.
- **A11** Reconnect: an error schedules a reconnect within [0, cap] of R-14; a re-open triggers exactly one refetch; a
  repeated or older (sessionId, version) is ignored (no duplicate apply).
- **A12** Slow consumer: `desiredSize <= 0` closes that stream and removes the subscriber.
- **A13** Client abort cleanup: abort or cancel removes the subscriber, decrements the account count, clears both timers;
  after 50 connect and abort cycles the counts are 0 and the LISTEN client is released (no listener leak).
- **A14** Two-context Playwright (default config, CI, NEW `apps/web/e2e/realtime.spec.ts` + NEW
  `apps/web/e2e/support/realtime-stream-mock.ts`, registered after `installApiMock` so it wins): A edits a session title; the
  test mirrors it into B's mock state and pushes one event on B's stream; B's list shows the new title without a reload.
- **A15** Local p95 (R-20): one `REALTIME_P95` line with method and load, pasted into the PR body.
- **A16** axe and 375 px on the list and detail views with the stream mocked: no new violation, no horizontal scroll.
- **A17** `pathAllowedForRole("/api/realtime/subscribe", "discovery")` is false and `"web"` is true.
- **A18** `SECURITY_HEADERS` CSP and `buildNonceCsp` contain no `default-src` or `connect-src` that excludes `'self'`.
- **A19** Stream headers as R-6; the response is not JSON and not cached.
- **A20** R-1: own-tenant id returns `{type, sessionId, version}`; foreign-tenant id returns null; non-session aggregate
  returns null; non-UUID returns null with no query.
- **A21** Forged NOTIFY (non-UUID, unknown UUID): nothing sent, no throw, one log line without the payload.
- **A22** Listener connection loss: every stream closes; the listener reconnects with R-14; a new subscriber then works.
- **A23** No polling: a healthy idle stream for 10 fake minutes causes zero refetches; an outage of N failed attempts
  causes exactly one refetch.
- **A24** Edit view stays non-live: `useSessionDetail` without `live` opens no EventSource.
- **A25** Projector outcomes: notify ok gives delivered; notify error gives retry `notify_failed`; non-session aggregate gives
  dlq `unsupported_aggregate`; every code matches `ERROR_CODE_RE`.
- **A26** Listener queue overflow (more than 1,000 pending): every stream closes, the queue clears, no crash.
- **A27** Negative: `git diff --name-only 442aa1b..HEAD` contains no `packages/db/migrations/` path and only scope files;
  committed `OUTBOX_DISPATCH_SCHEDULE_ENABLED` defaults stay false.

## 6. Implementation steps (dependency order, test-first)

1. A20 failing, then R-1 and its export line.
2. A10 and A25 failing (`apps/bot/src/projectors/web-realtime.test.ts`, bot DB harness as D-22), then R-2 and R-3.
3. A3, A4, A6, A8 and A21 failing (`apps/web/lib/realtime-auth.test.ts`, mocks as `read-routes.test.ts:15-68`), then
   `realtime-auth.ts`.
4. A7, A12, A13, A22 and A26 failing (`apps/web/lib/realtime-listener.test.ts`; DB-backed cases copy the harness of
   `apps/web/app/api/sessions/[id]/close/route-db.test.ts`, used as is), then `realtime-listener.ts`.
5. A1, A2, A5, A9, A17, A18 and A19 failing (`apps/web/app/api/realtime/subscribe/route.test.ts`), then `route.ts`.
6. A11, A23 and A24 failing (`apps/web/lib/use-realtime.test.ts`), then `use-realtime.ts`, R-16 in `use-sessions-data.ts`
   and the two view lines.
7. A14 and A16 (mocked e2e), then A15 locally (R-19, R-20) through `locked-run.sh`.
8. S1 VERIFY set, with output through `tail -40`; GitNexus impact before each edited symbol and detect_changes before each commit.

## 7. Closure matrix

1. Authority pinned by SHA: PASS (`442aa1b`, exact TARGET_FILES).
2. Decisions in scope signed: PASS (DD-134 (c); DD-122 D4; L3 D-1..D-24 unchanged).
3. Scope IN and OUT with owner: PASS (section 1, R-1, R-13).
4. Dependencies classified: PASS (L3 #64 merged, ancestor).
5. Live schema and code match: PASS (section 2).
6. Data, API, state and auth contract: PASS (R-1..R-18).
7. Fail-closed, idempotency and order: PASS (R-8, R-9, R-10, R-12, R-15, A11).
8. Open questions in scope: PASS (0, all pinned as R-n).
9. Acceptance with expected results: PASS (A1-A27).
10. Migration, security and rollback: PASS (no migration; rollback = disable the row or the flag, runbook section 3).
11. First slice dependencies merged: PASS (#64).
12. Handoff ready: PASS (section 6, worktree at the base).

## 8. OPEN

- O1 DECISION: scope additions R-1 (packages/db read function, test, one export line) and R-13 (two one-line view
  opt-ins) are outside the lane's listed files; this follows the L3 D-20/D-21 precedent and is pending orchestrator and
  owner sign-off. Without R-1 no HR1-compliant event read exists; without R-13 detail live refresh would also hit the edit view.
- O2 The lane block lists `use-session.tsx`; it is the auth-session hook (`:20-44`) and is not edited.
- O3 Merge order: `packages/db/src/index.ts` may also gain an export in a sibling lane this session; that conflict is mechanical (keep both lines).
- O4 L7 owns `session-api-mock.ts` this session; L5 only composes with it from new support files.
- O5 L3 OPEN 13 (`dispatcher.ts:74` wording) stays open; L5 does not edit `dispatcher.ts`.
- O6 R-7 and R-12 are per web process; a multi-process deployment multiplies them (local-only MVP).
- O7 R-4 costs one RLS read per subscribed tenant per event; a per-tenant channel is a later optimization if load needs it.
- O8 Owner P0: realtime flows only after the worker flag is true and the owner enables web_realtime (runbook section 2).
