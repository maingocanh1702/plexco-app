<!-- review-readiness: code-ready -->

# Step-0 readiness: L4b p3-m6-announce-route (session P3-S5)

> Agent-facing. Readiness reviewer: opus/max (same model and effort as the lane's code reviewer). Reviewer #1 measured sections 1-2 and
> drafted sections 4-10 at the base, then stopped at the token rule; reviewer #2 closed the handoff items R-1..R-7 (section 3), applied
> the orchestrator rulings D1 and D2 (section 0), wrote sections 11-12 and owns this verdict. Their drafts and handoffs are session notes
> outside the repo; every fact here is cited by path:line at the base instead. Writer opus/max; code reviewer opus/max plus an opus/max
> security round (new HTTP command on a messaging path, auth, external input), at most 3 rounds (DD-122 D4: Codex waived, independent
> Claude reviewer). TARGET_FILES (section 12) holds the edit set (section 9) and read-only context; a listed file outside the edit set is
> never edited.
> Review questions (lane REVIEW PLAN) and where each is closed: **announced:true without DB-proven delivery readiness** -> 4.1 (guard in
> the command's own transaction, before dedup), DT-1, A-1..A-6, A-9, R-T1, R-T3; **requester spoofing** -> 4.3 (person only from
> `currentSession()`, never the body), R-T2; **channel enum bypass** -> 4.4 (zalo-only enforced in the command, not the route), A-10,
> A-14, R-T4; **payload PII** -> 4.3 (three keys, an id only), A-7, I-1.
> Every `path:line` below is MEASURED at base `dbdc061443ca18f9cdc1277916b720d92a1081ea` (the lane block was measured at `c762c90`;
> L2, L7 and L8 shifted lines). Use THIS file's numbers.

## 0. Orchestrator rulings (binding; recorded here)

- **D1 (shared file `apps/web/lib/tenant-lang.test.ts`)**: the file classifies every `route.ts` under `app/` and every non-test
  `lib/*.ts`. L4b adds ONLY `"app/api/sessions/[id]/announce/route.ts": "a",` directly after the line
  `"app/api/sessions/[id]/cancel/route.ts": "a",` (:132, measured), plus at most one comment line, and nothing else in that file. L9's
  entries are disjoint hunks of the same file.
- **D2 (= reviewer #1's R-9, accepted as drafted; pinned as A-D2)**: the DB-truth guard runs inside `announceSession`'s own transaction
  in `packages/db/src/session-service.ts`, once, as ONE `SELECT` of `outbox_dispatch_schedule_live()` and
  `projector_is_enabled('zalo_dm')`, directly after the suspension gate (:843-846 at the base) and before the payload validation (:851)
  and the processed_commands dedup (:878-903). A refusal therefore rolls back with zero writes, and a replay while delivery is off is
  refused, never answered `announced:true`. `apps/web/lib/announce-delivery-guard.ts` is NOT created: the lane's FILES IN SCOPE narrow by
  exactly that file. The conductor's S4 gate check "L4b's guard uses DB truth" finds the guard in `packages/db/src/session-service.ts`
  inside `announceSession`, between the suspension throw and the payload validation (the writer cites the final line numbers in the PR
  body). The D1 slot reserved for that file (after `"lib/use-realtime.ts": "c",`) stays unused.

## 1. Base and dependencies (Q1)

- W = `.autopilot/worktrees/p3-m6-announce-route`, branch `feat/p3-m6-announce-route`, HEAD = origin/main =
  `dbdc061443ca18f9cdc1277916b720d92a1081ea` (merge of #68); `git status --porcelain` empty; no `index.lock` under
  `.git/worktrees/p3-m6-announce-route`.
- Merged ancestors (`git log --merges` at the base): L3 #64 `98a4a6c920acbe2647f6e1ef710a21e535be6c8d` (feat/p3-m6-outbox-delivery-core,
  0056), L4 #66 `61221162c3f206ed02da62dfbd0086d770f75c49` (feat/p3-m6-zalo-outbound, 0057, zalo_dm projector), L5 #67
  `c5497a7914d89df433a3c043e280a0d074e8d3c5` (feat/p3-m6-web-live-sync), L8 #68 `dbdc061443ca18f9cdc1277916b720d92a1081ea`
  (feat/p3-m9-join-core, 0058, D2 (c) promotion DM). L4 and L8 merged: PASS.
- D2 (f) = DD-134 (f), `docs/standards/decisions.md:1824-1826`, signed `:1833`. DD-134 (e) `:1823`: the schedule flag stays OFF by
  default; turning on real use is the owner's P0 step; agents enable it only in a local test or scratch process.
- The deferral at the base (R-1, measured): the DD-56 amendment (owner 2026-08-26) `:755`; its clause 1 SCOPE `:756` names exactly
  three session command routes (create, update, publish). Inside it, the named deferral `announce_session_route` (owner ratify
  2026-08-26): heading `:758`; (a) `:760`, the criterion: announce's ONLY observable effect is delivery, and with the scheduler OFF the
  dispatcher dead-letters every row, so `{announced:true}` "sẽ là **một lời nói dối nói với caller**"; (b) `:762`, verbatim:
  "announce route ship **khi outbox schedule đã bật**, **không sớm hơn**. Khi đó `INVALID_CHANNEL` và `SESSION_ALREADY_ENDED` (BE spec
  §3 vẫn pin cả hai) quay lại `API_ERROR_CODES` cùng route."; (c) `:764` corrects an older owner argument (create, publish and update
  already insert outbox rows). Clause 2 PREDICATE `:765` (one choke-point helper, `resolveSessionCommandContext`) and clause 3
  FAIL-CLOSED `:766` still bind the new route. The lane block's `decisions.md:753-758` is superseded by these numbers.
- What DD-134 (f) binds here: the announce route ships in L4b for the local-only MVP; the channel must be zalo; a guard on DB truth,
  never a process env: refuse unless a fresh worker heartbeat reports schedule_enabled AND `projector_is_enabled('zalo_dm')`; the
  proposed code ANNOUNCE_DELIVERY_DISABLED (409, UNPINNED); never return `{announced:true}` when nothing can be delivered. Dispatch
  stays off in committed defaults; enabling real sending is the owner's P0 step (e). D2 (c): the announcement is NOT a new DM type
  (`session.announcement_requested` via zalo_dm is in the signed delivery matrix and already routed, 0057:245).

## 2. Measured facts (Q2), at the base

packages/db/src/session-service.ts (3024 lines):
- `AnnounceSessionErrorCode` :737-742 = SESSION_NOT_FOUND | SESSION_NOT_OPEN | SESSION_ALREADY_ENDED | INVALID_CHANNEL |
  COMMAND_ID_CONFLICT. `SessionAnnounceError` :744-751; `SessionAnnounceAuthorizationError` (code TENANT_SUSPENDED) :760-767;
  `failAnnounce` :769-771.
- `AnnounceChannel = "zalo" | "messenger"` :784; `ANNOUNCE_CHANNELS` :785; `isAnnounceChannel` :786-787.
- `AnnounceSessionInputPayload {sessionId, channel}` :790-795; `AnnounceSessionParams {tenantId, commandId, input}` :797-801 (no
  actor or person id). `StoredAnnounceResult {sessionId, channel}` :803-806; `AnnounceSessionResult` (+replayed) :809-811;
  `ANNOUNCE_COMMAND_TYPE = "AnnounceSession"` :813; `isStoredAnnounceResult` :821-827 (uses isAnnounceChannel).
- `announceSession` :829-971: DD-110 comment :835-842; `authorizeTenantAction(tx, tenantId, "announce_session")` :843, throw
  :844-846 -> payload validation :851-863 (SESSION_NOT_FOUND :853/:856; channel :861-863) -> canonicalize :867-868 -> advisory
  xact lock :870-872 -> dedup select :878-886, replay :889-899, COMMAND_ID_CONFLICT :900-903 -> FOR UPDATE :915-921 ->
  SESSION_NOT_OPEN :928-930 -> ends_at clock query :945-947, SESSION_ALREADY_ENDED :948-950 -> outbox insert :957-964 (payload
  `{session_id, channel}` :963) -> processed_commands :966-969 -> return :970. No non-test caller (orchestrator pre-measure; the
  writer's GitNexus impact re-checks it).
- Lane-block citations measured at c762c90: announceSession :817 -> now :829; event insert :945-952 -> now :957-964.
- packages/db/src/index.ts already exports `createDb, Db, DbHandle, Tx` :10, `announceSession` :133, `SessionAnnounceError`,
  `SessionAnnounceAuthorizationError` :140-141, types `AnnounceSessionErrorCode / InputPayload / Params / Result` :157-160:
  NO index.ts edit is needed (L9 owns index.ts).

apps/web/lib/session-command-route.ts (814 lines):
- Header comment :25-28 "Announce is NOT among them ... returns with the slice that provides a real projector (DD-56 amendment,
  clause 1)": stale after this lane, update it. Imports :1-18 (no announce error classes).
- `mayManageSessions` :118-122 (`authorize` session.manage :120); `SessionCommandContext {tenantId, commandId, body, lang}` :221-227
  (no personId); `resolveSessionCommandContext` :230-345; FORBIDDEN 403, one body for missing, foreign or unrelated :262-272;
  context returned :343.
- `STATUS_BY_CODE` :497-536 (FORBIDDEN 403 :504, COMMAND_ID_CONFLICT 409 :527, SESSION_NOT_FOUND 404 :531, SESSION_NOT_OPEN 409 :532,
  TENANT_SUSPENDED 403 :535). `MESSAGE_BY_CODE` :567-704 (section 3, R-6).
- `mapSessionCommandError` :711-762: isDomain :712-722 (no announce classes), `isApiErrorCode` narrowing :748, lookups :749-750,
  a table miss returns null (500) :753. `handleSessionCommand` :796-814.
- Person-in-handler pattern: `apps/web/app/api/sessions/[id]/mark-paid/route.ts:32-38` (`currentSession()`, `if (!session) throw
  new Error("session vanished between the entry gate and the command")`, `actorPersonId: session.personId`); the same in join,
  join-requests, players and reverse routes.

packages/core/src/api-contract.ts (201 lines): header :1-85; `API_ERROR_CODES` :86-143 (sorted; enforced by api-contract.test.ts
:17-19); ALREADY_JOINED :89 / AUTH_INVALID :90; INVALID_BODY :107 / INVALID_TIME_RANGE :108; REVERSAL_NOT_SUPPORTED :131 /
SESSION_FULL :132; SESSION_NOT_OPEN :135; TENANT_SUSPENDED :139. Absent: INVALID_CHANNEL, SESSION_ALREADY_ENDED,
ANNOUNCE_DELIVERY_DISABLED. api-contract.test.ts (267 lines) :27-63 "FIVE shipped session routes"; its comment :28-32 says
INVALID_CHANNEL and SESSION_ALREADY_ENDED return with their route.

apps/web: `app/api/sessions/[id]/publish/route.ts` is 43 lines (handleSessionCommand, bucket "session-publish" limit 10, `id`
passed unvalidated :15-18). `apps/web/package.json:16` declares only `@plexco/db` (no drizzle-orm, no pg); no apps/web file
imports drizzle-orm; `lib/dev-login/database-guard.ts:41` uses `pool.query`.

Migrations:
- 0056: `outbox_projectors.enabled DEFAULT false` :74; `outbox_required_projectors` :113-139 (`WHERE p.enabled` :134; EXECUTE
  app_worker :141); `projector_is_enabled(text)` :144-152 (SQL, SECURITY DEFINER, STABLE, `coalesce(enabled, false)`), EXECUTE
  app, app_worker :153-154; `outbox_projector_set_enabled(text, boolean)` :157-180, REVOKE :181, no grant (owner path);
  `job_worker_heartbeats.schedule_enabled` :280; `job_worker_heartbeat(text, text, integer, boolean)` :283-313, EXECUTE
  app_worker only :314-315; `outbox_dispatch_schedule_live()` :319-329 (`schedule_enabled IS TRUE AND last_seen_at >
  clock_timestamp() - interval '90 seconds'`, SECURITY DEFINER, volatile), EXECUTE app, app_worker :330-331.
- 0057: `c_uuid` :80 (hex, either case); announce requester `payload->>'requested_by_person_id' ~ c_uuid` :141-146; recipients
  :147-164 (active|guest membership in the event tenant, active person, active zalo identity on this bot, `pe.id = v_person`);
  none -> `requester_unlinked` :165-171; route row `('zalo_dm', 'session', 'session.announcement_requested')` :245.

Consumer (L4, read-only for L4b):
- apps/bot/src/projectors/zalo-dm.ts: announce branch :104-106 (dlq `no_requester` unless a uuid string); `payload.channel` is
  never read; UUID_RE :31; `startsAt: head.starts_at ?? new Date(Number.NaN)` :163.
- zalo-dm-templates.ts: event map :18; announce text :70-75 = `t("Tin mời để chuyển tiếp:\n{text}", "Ready to forward:\n{text}")`
  around `t("Mời tham gia buổi chơi lúc {start}: {link}", "Join the session at {start}: {link}")` (no venue, price or name).
- apps/bot/src/test-zalo-stub.ts (72 lines): `startZaloStub()` :34; `calls[{token, chatId, text}]` :21-25, :44.
- apps/bot/src/projectors/zalo-dm.test.ts (653 lines): `setupZaloDmContext` :168-219 (own DB `plexco_bot_zalo_dm`;
  withJobDefinerLock + bootstrapJobDefiner + migrate :201-204; app_worker password lease :205); describe "against the 0057
  definers and the stub (as app_worker)" :221; `setEnabled` through the migration seat `ctx.verify` :227, enabled in beforeAll
  :231-235; `club()` :239-259 (active tenant, active bot, open session starting now()+1 day, ending +1 day 2 h, venue "Private
  Hall", price 120000); `player()` :262-288; `claim()` :303-313 (hand-inserted event); A1 through `runDispatchCycle` :319-341;
  A5/A7 :363-380 (host-only DM for `{channel, requested_by_person_id}`; an unlinked requester dead-letters `requester_unlinked`);
  DM-1 with two cycles :382-400.

Tests and harness:
- packages/db/src/session-service.test.ts (5090 lines): describe announceSession :1321; `CH = "zalo"` :1323; seedTenant :1325-1340
  (subscription row :1333-1337 unless "missing"); seedSession :1342-1361; `announce` helper :1363-1364 (one of TWO announceSession
  call sites; the other :1521); outboxFor :1366-1371; cases AN1 :1389, SESSION_NOT_OPEN :1421, in-progress :1433,
  SESSION_ALREADY_ENDED :1449, TENANT_SUSPENDED :1467 and :1479, INVALID_CHANNEL :1487, SESSION_NOT_FOUND :1512, DED1 :1531,
  authz-beats-replay :1544. No "messenger" inside that describe.
- packages/db/vitest.config.ts: `fileParallelism: true` :18, `sequence: { concurrent: false }` :21; each file builds its own DB with
  `setupRlsTestContext(DB_NAME)` (zalo-dm-delivery.test.ts:21), so a ready state set in session-service.test.ts is seen only there.
- Owner-path pattern: packages/db/src/zalo-dm-delivery.test.ts:39-53 (`ownerPath` = withJobDefinerLock + BEGIN + SET LOCAL ROLE
  job_definer + call + COMMIT/ROLLBACK; `setEnabled`).
- docs/features/BE/feature_session_management_tech.md: endpoint list :44; edge #11 :246; edge #46 :277; section 3 endpoint :301;
  SESSION_ALREADY_ENDED 409 "Buổi chơi đã kết thúc · Session has already ended" :322; INVALID_CHANNEL 400 "Kênh thông báo không
  hợp lệ" (zalo/messenger) :342; COMMAND_ID_CONFLICT :343; announce request/response :407-427 (request body :412, section 3),
  success `{ "data": { "announced": true, "channel": "zalo" } }` :418; idempotency row :511; Rate Limits :613-628; section 4 event
  payload `session_id`, `channel` :644; announce transition :789-799 (steps :795-799).

## 3. Measurements closed by readiness reviewer #2 (handoff R-1..R-7; R-8 skipped under ruling D2)

- **R-1** decisions.md: DD-56 amendment `:755`, clause 1 `:756`, deferral heading `:758`, (a) `:760`, (b) `:762`, (c) `:764`,
  clause 2 `:765`, clause 3 `:766` (all measured; section 1). Fix to the draft: the amendment was cited "about :754-755".
- **R-2** BE spec: endpoint `:407` ("notification, KHÔNG mutate `sessions` row (edge #11 exempt) nhưng tự guard `ends_at` freshness
  (edge #46)"); request body `:412` `{ "commandId": "cmd_…", "channel": "zalo" }`; success heading `:415` ("announcement queued qua
  outbox; session row không đổi"). The Rate Limits table `:613-628` has no announce row, so A-D7 is a default, not a spec value.
- **R-3** `grep -rn OUTBOX_DISPATCH_SCHEDULE_ENABLED apps/web packages/db/src` (node_modules, .next and dist excluded): zero hits.
  apps/bot/src/heartbeat.ts: `HEARTBEAT_STALE_MS = 90_000` :36; `scheduleEnabled?: boolean` :68; `SELECT job_worker_heartbeat($1, $2,
  $3, $4)` :83 with `deps.scheduleEnabled ?? null` :87, so a worker that does not set the flag reports NULL, which
  `schedule_enabled IS TRUE` (0056:319-329) reads as not live. The DB rule stays the authority; the 90 s TS constant matches the SQL
  interval.
- **R-4** route-test pattern = `apps/web/app/api/sessions/[id]/publish/route.test.ts` (184 lines): `vi.mock("@plexco/db")` keeps the
  actual module and stubs `createDb` (pool `{}`, `db.execute` answering locale "vi"), the command (`publishSession`), `authorize` and
  `withTenant` :11-29; `vi.mock` of `lib/session-cookies` stubs `appDb` (same execute stub), `currentSession`, `csrfOk` and
  `rateLimited` :31-45; `req()` builds the POST with `?tenant=` and `x-csrf-token` :52-58. No `announce` directory exists under
  `apps/web/app/api/sessions/[id]/` (siblings: cancel, close, guest-notes, join, join-requests, leave, mark-paid, payments, players,
  publish).
- **R-5** `apps/web/lib/session-command-route.test.ts` enumerates mapper cases: describe "mapSessionCommandError — the five L8 codes
  carry the P-17 copy" :530 and describe "mapSessionCommandError" :1011 (code loops :1031, :1052; forged-code properties
  :1076-1112). It is the only apps/web test naming STATUS_BY_CODE, MESSAGE_BY_CODE or API_ERROR_CODES. Result: it joins the edit set
  with one new `it` (M-1, test-only addition; section 9 counts it).
- **R-6** `MESSAGE_BY_CODE` is a Map of `[code, [vi, en]]` tuples in sorted code order: COMMAND_ID_CONFLICT :666 (status :527),
  SESSION_NOT_FOUND :690 (status :531), SESSION_NOT_OPEN :691-697, TENANT_SUSPENDED :703; the Map closes at :704. The web copy calls
  a session "Kèo" (:694, :701).
- **R-7** seats: `RlsTestContext` (packages/db/src/test-harness.ts:643-660): `owner` = superuser client, setup and assertions only
  :644-645; `appDb` :646; `workerPool` = the narrow app_worker seat :649-650; `superuserDb` :651-652; `testUrl` :662; the app URL shape
  :722. One password spelling `ROLE_PW` :92, leaser `createRolePasswordLeaser` :111; apps/bot/src/test-db.ts:7 re-exports ROLE_PW and
  :40 states the bot lease covers app_worker "and app, readonly". A tenant without a subscriptions row is refused by
  authorizeTenantAction: session-service.test.ts:965 AUTHZ3 "tenant active but MISSING subscription row -> TENANT_SUSPENDED (case 4
  fail-closed)". zalo-dm.test.ts inserts no subscriptions row (grep: zero hits), so the integration `it` seeds one.
  apps/bot/package.json:14 depends on `@plexco/db`.

## 4. Design (Q3-Q6); every choice is a pinned default in section 5

### 4.1 Guard: ONE design, in the command's own transaction, once, before dedup (Q3; ruling D2)
- Ready iff `outbox_dispatch_schedule_live() IS TRUE AND projector_is_enabled('zalo_dm') IS TRUE`, read by ONE statement on the
  announce transaction: `select outbox_dispatch_schedule_live() as "scheduleLive", projector_is_enabled('zalo_dm') as
  "zaloDmEnabled"`. Anything else (false, NULL, no heartbeat row) is not ready. The app role holds EXECUTE on both (0056:153-154,
  :330-331), so the check reaches the DB through announceSession's existing `withTenant` transaction: no new @plexco/db export, no
  index.ts edit, no web DB code. A failing SELECT aborts the transaction and surfaces as a non-domain error (500), never as success.
- Position: inside `announceSession`, the first statement after the suspension gate (:843-846) and before payload validation
  (:851). Not ready -> `failAnnounce("ANNOUNCE_DELIVERY_DISABLED", ...)`; the throw rolls the whole transaction back, so a refusal
  writes no row of any kind (no outbox_events, no processed_commands; the advisory lock :870 is not yet taken).
- Not repeated before the insert, because: (1) it is bypass-proof: every caller of the domain command is guarded, not only this
  route; zalo_dm routes announcement events by TYPE (0057:245) and never reads `channel` (zalo-dm.ts:104-106), so an unguarded
  producer path would write an event nobody can deliver; (2) it shares the insert's transaction: the window is check -> commit
  (milliseconds plus a possible FOR UPDATE wait :915-921); a second check right before the insert narrows it only by that wait and
  still cannot close it: app has no lock path on job_worker_heartbeats or outbox_projectors (the definers take none; a lock needs
  a migration, which is negative scope), and a heartbeat is a 90 s lease, so readiness is a sampled liveness fact by
  construction; (3) the zero-write refusal is provable by a DB test as the app role (A-1..A-6); (4) apps/web declares only
  `@plexco/db` (package.json:16), so a web module could not run SQL inside the command's transaction without a new dependency.
- Consequence (ruling D2): `apps/web/lib/announce-delivery-guard.ts` is NOT created, and it gets no tenant-lang.test.ts entry.
- Accepted residual race (OPEN, not a blocker): an event committed within milliseconds of a worker dying stays pending and is
  delivered when a schedule-enabled worker returns (the consumer re-checks session freshness at delivery, L4 readiness :222,
  fragment measured). An owner disabling zalo_dm inside that window leaves the event without a zalo_dm delivery
  (`outbox_required_projectors` reads `enabled` at prepare time, 0056:134). Closing it needs a migration (negative scope).
- Env: neither announceSession nor the route reads `OUTBOX_DISPATCH_SCHEDULE_ENABLED` (R-3: zero hits in apps/web and
  packages/db/src); the flag belongs to the worker (runbook) and reaches the guard only through the worker's heartbeat.

### 4.2 Refusal code, retry and replay (Q3)
- ANNOUNCE_DELIVERY_DISABLED, 409, `["Chưa thể gửi thông báo: hệ thống gửi tin đang tắt.", "Announcements can't be delivered right
  now: message delivery is off."]`. It is added to AnnounceSessionErrorCode, API_ERROR_CODES (sorted: between ALREADY_JOINED :89 and
  AUTH_INVALID :90), STATUS_BY_CODE and MESSAGE_BY_CODE (sorted position, `[code, [vi, en]]` tuple, R-6).
- Retry after a refusal: nothing was stored, so the same commandId re-runs the whole command: still not ready -> the same 409;
  ready -> 200 with replayed false and one event.
- Replay of an already-committed announce while not ready -> 409 (the guard precedes dedup, so announced:true is never answered
  while nothing can deliver, a replay included); once ready again -> the stored result, still one event.

### 4.3 Payload and requester (Q4)
- `AnnounceSessionParams` gains a REQUIRED trusted `requestedByPersonId: string` (extending an exported type: no index.ts edit). The
  route takes it ONLY from `currentSession()` inside the handler (mark-paid/route.ts:32-38 pattern), never from the body.
  announceSession asserts it is a UUID at entry, before the transaction opens (reuse the module's existing UUID check if one exists,
  else a local regex; a non-UUID throws a plain Error and answers 500: a programming fault, like withTenant's tenantId assertion),
  lowercases it, and writes the payload `{ session_id, channel, requested_by_person_id }`: exactly three keys, an id only, with no
  name, phone, Zalo id, chat id or destination id.
- It is not stored in the result: StoredAnnounceResult stays `{sessionId, channel}` (:803-806), and isStoredAnnounceResult (:821-827)
  and the replay equality (:889-899) are unchanged, so rows written before this change stay compatible. Dedup stays on (tenant_id,
  command_id) only (DD-117 D5): a replay by another session.manage holder of the same tenant returns the stored result and writes
  nothing.
- Consumer acceptance: zalo-dm.ts:104-106 accepts a uuid string; 0057:141-171 resolves exactly that person (an active or guest
  member of the event tenant, an active person, an active zalo identity on the tenant's bot), else `requester_unlinked`, so a
  foreign or spoofed id can never DM a non-member.
- Nothing is delivered while dispatch is off: the guard refuses without a live schedule, so no event is written. Committed defaults
  stay off: `outbox_projectors.enabled DEFAULT false` (0056:74), zalo_dm stays disabled after 0057, and the worker flag is OFF
  (DD-134 (e)).

### 4.4 Decision table measured against announceSession, and the check order (Q5)
| Row | Today at the base | After L4b | Code / status |
|---|---|---|---|
| DT-1 no fresh schedule_enabled heartbeat, OR zalo_dm disabled | announces | refused, zero writes | ANNOUNCE_DELIVERY_DISABLED 409 |
| DT-2 ready + session.manage + open + ends_at in the future + zalo | one event `{session_id, channel}` | one event `{session_id, channel, requested_by_person_id}` | 200 `{announced:true, channel:"zalo"}` |
| DT-3 channel messenger, or anything that is not the string "zalo" | messenger accepted | INVALID_CHANNEL before the lock, zero writes | 400 |
| DT-4 open, ends_at <= clock_timestamp() | SESSION_ALREADY_ENDED :948-950 | unchanged | 409 |
| DT-5 draft, closed or cancelled | SESSION_NOT_OPEN :928-930 | unchanged | 409 |
| DT-6 caller without session.manage | route-level | FORBIDDEN, one body for every reason (:262-272); announceSession not called | 403 |
| DT-7 suspended tenant or missing/suspended subscription | TENANT_SUSPENDED :843-846 | unchanged and still first | 403 |
| DT-8 same commandId again | stored result :889-899 | unchanged when ready; 409 when not ready (4.2) | 200 / 409 |
| DT-9 commandId reused for another session or channel | COMMAND_ID_CONFLICT :900-903 | unchanged | 409 |
| DT-10 unknown or malformed sessionId | SESSION_NOT_FOUND | unchanged | 404 |
- Channel narrowing lives in the command, not the route: validation becomes `input.channel === "zalo"` (missing, null, non-string,
  "messenger" and "Zalo" all refuse). The AnnounceChannel type, ANNOUNCE_CHANNELS and isAnnounceChannel (:784-787) keep the DD-37
  enum, because isStoredAnnounceResult uses them for stored rows (unchanged). Validation runs before dedup, so a messenger replay would
  answer INVALID_CHANNEL; no stored AnnounceSession row exists outside tests (no caller ever shipped). Message `["Kênh thông báo không
  hợp lệ.", "Invalid announcement channel."]` (vi from BE :342).
- Check order. Route (the existing resolveSessionCommandContext): AUTH_REQUIRED 401, CSRF 403, `?tenant=` 400, actor throttle 429,
  session.manage -> FORBIDDEN 403, tenant language, rate limits 429, body and commandId 400. Then the command: (1) suspension,
  (2) delivery guard, (3) payload validation, (4) advisory lock + dedup, (5) FOR UPDATE + status, (6) ends_at clock, (7) outbox
  insert + processed_commands. Reasons: the actor check comes first (no tenant oracle, DD-56). Suspension comes first in the
  command (DD-110 "authz beats replay"; a tenant policy refusal beats an instance-wide infrastructure state; the comment :835-842
  stays true). The guard comes before validation and dedup (a request that cannot deliver is refused the same way whatever its
  body, replays included). Validation comes before the lock, and state is read under the lock (existing).

### 4.5 Route and contract (Q6)
- NEW `apps/web/app/api/sessions/[id]/announce/route.ts`: POST through `handleSessionCommand(request, { bucket: "session-announce",
  limit: 10 }, handler)` with no options, so only session.manage holders pass. Handler: `currentSession()` (null -> `throw new
  Error("session vanished between the entry gate and the command")`), `const { id } = await params`, `announceSession(appDb().db,
  { tenantId: context.tenantId, commandId: context.commandId, requestedByPersonId: session.personId, input: { sessionId: id, channel:
  context.body.channel as AnnounceChannel } })` (the channel is passed unvalidated; the command validates it), then `ok({ announced:
  true, channel: result.channel })`.
- Success body: exactly `{ announced: true, channel: "zalo" }` (BE section 3 :418), emitted only after announceSession returned,
  which means the guard passed in the same transaction and either the event was written or the stored result of an earlier
  guarded write was replayed. No `replayed` key.
- session-command-route.ts: import SessionAnnounceError and SessionAnnounceAuthorizationError; add both to isDomain (:712-722); add
  STATUS_BY_CODE rows ANNOUNCE_DELIVERY_DISABLED 409, INVALID_CHANNEL 400 and SESSION_ALREADY_ENDED 409; add the MESSAGE_BY_CODE
  tuples (4.2, 4.4, and SESSION_ALREADY_ENDED `["Buổi chơi đã kết thúc.", "Session has already ended."]` from BE :322), each in
  sorted position; update the header :25-28.
- session-command-route.test.ts (R-5): one new `it` in describe "mapSessionCommandError" (:1011), M-1 in section 7.
- api-contract.ts: add the three codes in sorted position (ANNOUNCE_DELIVERY_DISABLED between :89 and :90; INVALID_CHANNEL between
  INVALID_BODY :107 and INVALID_TIME_RANGE :108; SESSION_ALREADY_ENDED between REVERSAL_NOT_SUPPORTED :131 and SESSION_FULL :132) plus
  one header paragraph (deferral (b) :762, DD-134 (f)). api-contract.test.ts: one new `it` registering the three; update the
  comment :28-32.
- tenant-lang.test.ts (ruling D1): ONLY `"app/api/sessions/[id]/announce/route.ts": "a",` directly after :132, plus at most one
  comment line.

## 5. Pinned defaults (each is "default applied, pending owner sign-off"; repeat them in the PR body)
- A-D1 refusal code ANNOUNCE_DELIVERY_DISABLED, 409, copy as in 4.2. Default applied, pending owner sign-off.
- A-D2 guard inside announceSession's transaction, once, one SELECT, after suspension and before validation and dedup;
  announce-delivery-guard.ts is not created (4.1, orchestrator ruling D2). Default applied, pending owner sign-off.
- A-D3 a replay while not ready answers 409; a retry after a refusal may succeed (4.2). Default applied, pending owner sign-off.
- A-D4 INVALID_CHANNEL for every channel value except the string "zalo", messenger included (narrows the BE :342 zalo|messenger enum
  for the MVP), enforced in the command; copy as in 4.4. Default applied, pending owner sign-off.
- A-D5 the requester is a REQUIRED param taken from the verified session only, UUID-asserted at entry and lowercased; it is not part
  of the stored result or of dedup (4.3). Default applied, pending owner sign-off.
- A-D6 the success body is `{announced: true, channel}` only, with no replayed key, for a first write and a replay alike (4.5).
  Default applied, pending owner sign-off.
- A-D7 rate-limit bucket "session-announce", 10/min per tenant (publish precedent; the BE Rate Limits table :613-628 has no announce
  row, R-2). Default applied, pending owner sign-off.
- A-D8 the SESSION_ALREADY_ENDED and INVALID_CHANNEL message pairs (vi from BE :322/:342, en default; the BE wording "Buổi chơi" is
  kept although the web copy elsewhere says "Kèo", R-6). Default applied, pending owner sign-off.

## 6. Implementation steps (dependency order, test-first)
1. GitNexus impact (upstream) on announceSession, AnnounceSessionParams, AnnounceSessionErrorCode, mapSessionCommandError,
   STATUS_BY_CODE / MESSAGE_BY_CODE and API_ERROR_CODES; report the blast radius (expected: announceSession has no non-test caller).
2. packages/core: a new api-contract.test.ts `it` (red), then add the three codes to API_ERROR_CODES plus the header paragraph and the
   comment update :28-32.
3. packages/db: session-service.test.ts ready-state helpers plus A-1..A-14 (red), then in announceSession: the requester param and its
   entry assertion, the guard statement after :846, zalo-only validation, the three-key payload and the new error code. Update the
   existing announce tests (ready state per section 7; both call sites :1363-1364 and :1521 pass requestedByPersonId; AN1/DED1 payload
   expectations gain the third key).
4. apps/web: M-1 in session-command-route.test.ts and the announce route.test.ts (red), then session-command-route.ts (imports,
   isDomain, rows, header) and route.ts; the tenant-lang.test.ts entry (D1).
5. apps/bot: I-1 in zalo-dm.test.ts against the step-3 producer.
6. The S1 VERIFY set (tail -40); detect_changes before every commit. The PR body carries the pinned defaults, the guard's final
   session-service.ts lines and "Codex waived by owner 2026-10-12; reviewed by independent Claude subagent".

## 7. Acceptance matrix (mapped to the lane TESTS and every decision-table row)
DB, packages/db/src/session-service.test.ts (seats below):
- A-1 no heartbeat row, zalo_dm on -> ANNOUNCE_DELIVERY_DISABLED; zero outbox rows for the session; zero processed_commands rows for
  (tenant, commandId). (DT-1)
- A-2 a fresh heartbeat with schedule_enabled false -> the same, zero rows. (DT-1)
- A-3 a fresh heartbeat with schedule_enabled NULL -> the same. (DT-1)
- A-4 schedule_enabled true but last_seen_at 91 s old -> the same. (DT-1, stale)
- A-5 a fresh true heartbeat, zalo_dm disabled -> the same. (DT-1)
- A-6 `vi.stubEnv("OUTBOX_DISPATCH_SCHEDULE_ENABLED", "true")` with no heartbeat -> still refused (an env flag changes nothing);
  `vi.unstubAllEnvs()` in finally.
- A-7 ready -> exactly one session.announcement_requested; payload keys exactly `["channel", "requested_by_person_id",
  "session_id"]`; requested_by_person_id = the param. (DT-2, no PII, no destination id)
- A-8 refusal, then ready, same commandId -> success with replayed false and one event. (retry after a refusal)
- A-9 a committed announce, then not ready, same commandId -> 409 and still one event; ready again -> the stored result, still one
  event. (DT-8)
- A-10 channel "messenger", "Zalo", a missing channel plus the existing invalid set -> INVALID_CHANNEL, zero rows. (DT-3)
- A-11 a requestedByPersonId that is not a UUID -> throws (not a domain code), zero rows.
- A-12 a suspended tenant while not ready -> TENANT_SUSPENDED (order: suspension before the guard). (DT-7)
- A-13 the same commandId reused for another session -> COMMAND_ID_CONFLICT, still one event. (DT-9)
- A-14 channel "messenger" while not ready -> ANNOUNCE_DELIVERY_DISABLED (order: the guard before validation), zero rows.
- The existing AN1, SESSION_NOT_OPEN, in-progress, SESSION_ALREADY_ENDED, TENANT_SUSPENDED x2, INVALID_CHANNEL, SESSION_NOT_FOUND,
  DED1 and authz-beats-replay stay green under the ready state. (DT-4, DT-5, DT-7, DT-8, DT-10)
- Test seats (R-7, measured): the announce call runs as `ctx.appDb.db` (the app role, RLS on, EXECUTE on both read functions), never
  `ctx.superuserDb`. Fixtures and zero-row counts use `ctx.owner` (superuser, setup and assertions only), because a superuser count
  cannot be hidden by RLS, so a zero there is a real zero. The heartbeat goes through `ctx.workerPool` (app_worker; job_worker_heartbeat
  is EXECUTE app_worker only, 0056:314-315): `SELECT job_worker_heartbeat($1, $2, $3, $4)` with schedule_enabled true, false or NULL.
  Not-ready tests first `DELETE FROM job_worker_heartbeats` through ctx.owner (own DB per file; any fresh true row makes the live check
  true); staleness = `UPDATE job_worker_heartbeats SET last_seen_at = clock_timestamp() - interval '91 seconds'` through ctx.owner;
  zalo_dm on and off through the ownerPath pattern (zalo-dm-delivery.test.ts:39-53; outbox_projector_set_enabled has no grant,
  0056:181), which takes the job definer lock only, so the D12 order (job definer shared first, then the chat-definer slot) is
  untouched. Ready by default for the existing cases: zalo_dm on in beforeAll, a fresh true heartbeat in beforeEach; restore in
  afterAll inside finally (zalo_dm false, heartbeat rows deleted); never in committed defaults.
Route, NEW apps/web/app/api/sessions/[id]/announce/route.test.ts (the publish/route.test.ts:11-58 mock shape, R-4, with
`announceSession` in place of `publishSession`):
- R-T1 a resolved announceSession -> 200, `data` exactly `{announced: true, channel: "zalo"}`; this is the ONLY path to
  announced:true; no mock returns or asserts a delivery, and no test stubs a guard to true. (DT-2)
- R-T2 a body carrying another person's `requested_by_person_id` or `requestedByPersonId` -> announceSession is called with the
  cookie person only. (spoofing)
- R-T3 the mock rejects ANNOUNCE_DELIVERY_DISABLED -> 409, data null, no announced key, the vi or en text per tenant language. (DT-1)
- R-T4 INVALID_CHANNEL 400 (messenger included), SESSION_ALREADY_ENDED 409, SESSION_NOT_OPEN 409, SESSION_NOT_FOUND 404,
  COMMAND_ID_CONFLICT 409; SessionAnnounceAuthorizationError -> TENANT_SUSPENDED 403. (DT-3, DT-4, DT-5, DT-7, DT-9, DT-10)
- R-T5 no session.manage (the `authorize` mock denies) -> FORBIDDEN 403 with the shared body; announceSession not called. (DT-6)
- R-T6 `OUTBOX_DISPATCH_SCHEDULE_ENABLED=true` in the web env plus a refusing mock -> still 409 (the route reads no env).
Mapper, apps/web/lib/session-command-route.test.ts:
- M-1 `SessionAnnounceError` with ANNOUNCE_DELIVERY_DISABLED -> 409, INVALID_CHANNEL -> 400, SESSION_ALREADY_ENDED -> 409, each with
  its vi and en text; `SessionAnnounceAuthorizationError` -> 403 TENANT_SUSPENDED (proves isDomain includes both classes).
Contract, packages/core/src/api-contract.test.ts:
- C-1 the three codes are registered; the sorted and no-duplicate tests stay green.
Integration, apps/bot/src/projectors/zalo-dm.test.ts (one new `it` in the describe at :221, a test-only scope addition; no edit of
the projector, dispatch or registry):
- I-1 fixture: `club()` plus a subscriptions row for its tenant through the migration seat `ctx.verify` (the session-service.test.ts
  :1333-1337 insert shape, plan 'free', version 1, with the status the announce describe's happy path passes to seedTenant), because
  authorizeTenantAction refuses a tenant without one (AUTHZ3 :965); a host who is a Zalo-linked active member with no roster row (the
  requester) and one other linked roster player (`player()`); zalo_dm already on (beforeAll :231-235); a fresh heartbeat with
  schedule_enabled true through the context's app_worker seat, deleted in finally. Producer: the REAL `announceSession` (index.ts:133)
  on a `createDb` handle (index.ts:10) for the bot test DB as the app role (user app, `ROLE_PW.app`; the lease covers app,
  test-db.ts:40), its pool ended in finally before the lease is released. Then `runDispatchCycle` twice (DM-1 pattern :382-400) ->
  the zalo_dm delivery is delivered once; the stub records exactly one call and its chatId is the host's; the other player gets
  nothing; the event's payload keys are exactly the three. (DONE WHEN)
No e2e: no UI change (an announce UI is negative scope).

| Lane TESTS item or decision row | Covered by |
|---|---|
| refusal while the worker reports schedule off: route test and DB test with zero outbox rows | R-T3; A-1, A-2 (zero outbox_events and processed_commands rows) |
| payload carries the requester id only, no PII and no destination id | A-7, I-1 |
| one event per command id | A-9, A-13, DED1 :1531, I-1 |
| the route mocks never claim delivery | R-T1, R-T3 |
| stale heartbeat, schedule_enabled false and zalo_dm disabled each refuse; a web env flag changes nothing | A-4, A-2/A-3, A-5; A-6, R-T6 |
| channel messenger refused | A-10, A-14, R-T4 |
| DT-1 / DT-2 / DT-3 | A-1..A-6, R-T3 / A-7, R-T1, I-1 / A-10, R-T4 |
| DT-4 / DT-5 / DT-6 | :1449, R-T4 / :1421, R-T4 / R-T5 |
| DT-7 / DT-8 / DT-9 / DT-10 | :1467, :1479, A-12, R-T4 / A-8, A-9, DED1 / A-13, R-T4 / :1512, R-T4 |

## 8. Q8: the '-infinity' starts_at dead-letter (L4 PR #66 OPEN, s2 N-1, deliver_threw)
L4b does not touch that path: the projector, templates, 0057 and the dispatcher are negative scope; the payload only adds
requested_by_person_id; the head row's starts_at is still read by 0057 and rendered from zalo-dm.ts:163. It stays OPEN for L17.

## 9. B3 (Q10)
- Edit set (10 files, 4 of them non-test): packages/db/src/session-service.ts, packages/db/src/session-service.test.ts,
  packages/core/src/api-contract.ts, packages/core/src/api-contract.test.ts, apps/web/lib/session-command-route.ts,
  apps/web/lib/session-command-route.test.ts (R-5, test-only addition), apps/web/lib/tenant-lang.test.ts (ruling D1, one entry),
  NEW apps/web/app/api/sessions/[id]/announce/route.ts, NEW apps/web/app/api/sessions/[id]/announce/route.test.ts,
  apps/bot/src/projectors/zalo-dm.test.ts (I-1, test-only addition). Removed by ruling D2: apps/web/lib/announce-delivery-guard.ts.
- Explicit exception: modules packages/db, packages/core, apps/web, plus apps/bot (one test-only `it`) = 4 > 3, and the total of about
  510 LOC exceeds about 300 through tests only (non-test about 120 stays inside). Why a split breaks coherence: deferral (b) :762
  returns the codes WITH the route; a payload field without the route has no producer, and a route without the field dead-letters
  every announce (zalo-dm.ts:104-106); DONE WHEN requires the consumer integration test in the same change.
- Compatibility for a rolling deploy: the payload field is additive (the consumer requires it, and no old producer path exists: there
  is no non-test caller); the route is a new path; codes are only added; the channel narrowing applies to new commands (no stored
  AnnounceSession rows exist outside tests); zero migrations; no grant change.
- Estimate: non-test about 120 (session-service.ts about 40, route.ts about 45, session-command-route.ts about 25, api-contract.ts
  about 10); tests about 390 (session-service.test.ts about 175, route.test.ts about 140, session-command-route.test.ts about 25,
  api-contract.test.ts about 15, tenant-lang.test.ts about 2, zalo-dm.test.ts about 35).
- Hard caps (`git diff --numstat dbdc061443ca18f9cdc1277916b720d92a1081ea..HEAD`, excluding this readiness file): non-test <= 200,
  test <= 450, total <= 650, files <= 10 (exactly the edit set above), migrations 0.

## 10. OPEN
- The residual race in 4.1 (needs a migration to close; negative scope).
- The '-infinity' dead-letter (section 8), for L17.
- Docs sync for L17 (Reviewed specs are not edited here): the BE spec header :6 and section 3 :342 still say announce is gated and the
  channel enum is zalo|messenger; deferral (b) :762 is met for the local-only MVP through DD-134 (f) plus the guard, which L17
  consolidates with the applied defaults A-D1..A-D8.
- Tool hygiene: readiness reviewer #1 ran one inline for-loop and two inline awk programs while measuring (read-only; disclosed);
  reviewer #2 ran its logic from script files only.

## 11. Closure matrix (12 of 12)

| # | Gate | Evidence | Result |
|---|---|---|---|
| 1 | Authority snapshot pinned by SHA | `AUTHORITY_SHA` = W HEAD = session base; every TARGET_FILES path is tracked at the base (`git ls-files --error-unmatch`) | PASS |
| 2 | Decisions in scope final | DD-134 (f) signed `:1833` amends the deferral `:758-764` for the local-only MVP; D2 (c) delivery matrix (0057:245); orchestrator rulings D1, D2; A-D1..A-D8 pinned | PASS |
| 3 | Scope IN/OUT and owner clear | section 9 edit set (lane FILES IN SCOPE minus the guard file under D2, plus the R-5 and I-1 test additions); NEGATIVE SCOPE; L4b sole editor of session-service.ts in P3-S5; L9 files untouched | PASS |
| 4 | Dependencies classified | L3 #64, L4 #66, L8 #68 merged ancestors of the base; DD-134 (f) signed; no new @plexco/db export | PASS |
| 5 | Live schema and code match | sections 2-3, measured at the base | PASS |
| 6 | Data, API, state, auth contract | section 4 | PASS |
| 7 | Fail-closed, idempotency, order | guard in the command's transaction before dedup; zero-write refusal; one event per commandId; check order 4.4 | PASS |
| 8 | Open questions in scope = 0 | section 5 pins; section 10 residue is out of scope | PASS |
| 9 | Acceptance matrix with expected results | section 7 | PASS |
| 10 | Migration, security, rollback | zero migrations, no grant change (app already holds EXECUTE on both read functions); requester only from the verified session; opus/max reviewer + security round; rollback = revert | PASS |
| 11 | First slice hard dependencies merged | L3 #64, L4 #66, L8 #68 | PASS |
| 12 | Implementation handoff ready | sections 4-9; W clean at the base with deps installed | PASS |

## 12. Verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-10-17
AUTHORITY_SHA: dbdc061443ca18f9cdc1277916b720d92a1081ea
BASE_BRANCH: main
TARGET_FILES:
  - docs/standards/decisions.md
  - docs/features/BE/feature_session_management_tech.md
  - docs/sessions/web-mvp-phase3-readiness-p3-m6-zalo-outbound.md
  - packages/db/src/session-service.ts
  - packages/db/src/session-service.test.ts
  - packages/db/src/index.ts
  - packages/db/src/test-harness.ts
  - packages/db/src/zalo-dm-delivery.test.ts
  - packages/db/vitest.config.ts
  - packages/db/migrations/0056_outbox_projector_registry_dlq_replay.sql
  - packages/db/migrations/0057_zalo_delivery_targets_definer.sql
  - packages/db/migrations/0058_player_self_join.sql
  - packages/core/src/api-contract.ts
  - packages/core/src/api-contract.test.ts
  - apps/web/package.json
  - apps/web/lib/session-command-route.ts
  - apps/web/lib/session-command-route.test.ts
  - apps/web/lib/tenant-lang.test.ts
  - apps/web/lib/session-cookies.ts
  - apps/web/app/api/sessions/[id]/publish/route.ts
  - apps/web/app/api/sessions/[id]/publish/route.test.ts
  - apps/web/app/api/sessions/[id]/mark-paid/route.ts
  - apps/bot/package.json
  - apps/bot/src/projectors/zalo-dm.ts
  - apps/bot/src/projectors/zalo-dm-templates.ts
  - apps/bot/src/projectors/zalo-dm.test.ts
  - apps/bot/src/test-zalo-stub.ts
  - apps/bot/src/test-db.ts
  - apps/bot/src/heartbeat.ts
SLICE: p3-m6-announce-route
IN_SCOPE: host announce command on web (POST /api/sessions/:id/announce through handleSessionCommand with session.manage), a DB-truth delivery guard inside announceSession's own transaction (fresh schedule_enabled heartbeat AND projector_is_enabled('zalo_dm'), one SELECT, after suspension, before validation and dedup), zalo-only channel validation, the additive requested_by_person_id payload key taken from the verified session, three error codes (ANNOUNCE_DELIVERY_DISABLED, INVALID_CHANNEL, SESSION_ALREADY_ENDED) in api-contract and the web error map, tests in packages/db, packages/core and apps/web, and one consumer integration test in apps/bot
OUT_OF_SCOPE: announce UI, group send, any other DM type or reminders, edits to dispatch, the registry, the zalo_dm projector, its templates, 0056 or 0057, any migration or grant, enabling the schedule or zalo_dm in committed defaults, apps/web/lib/announce-delivery-guard.ts (ruling D2), packages/db/src/index.ts, schema.ts, me-player-reads and every other L9 file, roster-service.ts, session-form.tsx, decisions.md and Reviewed specs, the -infinity starts_at dead-letter (L17)
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: ENABLEMENT_ONLY:zalo-dm-projector-enable-owner-P0 # the announce DM stays dark: dispatch off and zalo_dm disabled by default, so the route refuses with 409; stub-only tests
HARD_DEPENDENCIES: L3 #64 merged 98a4a6c920acbe2647f6e1ef710a21e535be6c8d (probe outbox_dispatch_schedule_live); L4 #66 merged 61221162c3f206ed02da62dfbd0086d770f75c49 (probe 0057_zalo_delivery_targets_definer.sql); L8 #68 merged dbdc061443ca18f9cdc1277916b720d92a1081ea (probe 0058_player_self_join.sql); DD-134 (f) signed
PRIOR_SLICES: L3 p3-m6-outbox-delivery-core (#64), L4 p3-m6-zalo-outbound (#66), L8 p3-m9-join-core (#68)
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: the announce DM reaches a real host only after L4's owner P0 steps (real bot token, worker env OUTBOX_DISPATCH_SCHEDULE_ENABLED=true, outbox_projector_set_enabled('zalo_dm', true)); until then the route answers ANNOUNCE_DELIVERY_DISABLED 409; L4b adds none
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS # zero migrations and no grant change; tenant only from ?tenant=, requester only from the verified session; opus/max reviewer + opus/max security round
IMPLEMENTATION_ARTIFACTS: PASS
FIRST_IMPLEMENTATION_STEP: section 6 steps 1-2 - GitNexus impact on announceSession, AnnounceSessionParams, AnnounceSessionErrorCode, mapSessionCommandError and API_ERROR_CODES, then the api-contract.test.ts registration test red before adding ANNOUNCE_DELIVERY_DISABLED, INVALID_CHANNEL and SESSION_ALREADY_ENDED to API_ERROR_CODES
REMAINING_BLOCKERS: none
```
