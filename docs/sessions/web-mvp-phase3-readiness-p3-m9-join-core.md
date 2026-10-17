<!-- review-readiness: code-ready -->

# Step-0 readiness: L8 p3-m9-join-core (session P3-S4)

> Agent-facing. Readiness reviewer: opus/max (same model and effort as the lane's code reviewer). Reviewers #1 and #2 measured; reviewer #3
> checked the draft against the lane block, conductor note 5 and addendum A1, and owns this verdict. Their handoffs are session notes outside the
> repo (`N/` below = the P3-S4 notes dir named in the worker brief); every fact here is cited by path:line at the base instead. Writer opus/max;
> code reviewer opus/max plus an opus/max security round (money, identity, concurrency, external input), at most 3 rounds (DD-122 D4: Codex
> waived, independent Claude reviewer). TARGET_FILES (section 12) holds the edit set (lane FILES IN SCOPE + section 9 additions) and read-only
> context; a listed file outside the edit set is never edited.
> Review questions (lane REVIEW PLAN) and where each is closed: **oversell** -> 4.2 (sessions FOR UPDATE before L7's one occupancy formula),
> A-1, A-4, DT-10; **tenant resolution leak** -> 4.6 (tenant only from `?tenant=`, never from a session-id lookup), P-3 (one FORBIDDEN 403),
> A-6, DT-1; **identity claim without a strong factor** (HARD RULE 4) -> person only from `currentSession()`, never from the body or a name, no
> claim of an existing membership or player, Zalo history only via the M3b link code (untouched by L8), DT-12, A-7; **charge duplication** ->
> charges UNIQUE (tenant_id, session_id, player_id) `0003_payments_ledger.sql:54` plus upsertCharge reviving that one row, A-1, A-2, DT-4, DT-5,
> DT-10, DM-4.
> Lane contract: `docs/autopilot-templates/web-mvp-phase3-2026-10-16-RUN.md:469` (L8 block) and `:1044` (P3-S4 session block); L4b waits for L8
> on `api-contract.ts` and `session-command-route.ts` (`:308`, `:1068`). L8 is the only editor of `session-service.ts` in P3-S4.
> Every `path:line` below is MEASURED at base `c5497a7914d89df433a3c043e280a0d074e8d3c5` (the lane block was measured at `c762c90`; #61, #65, #66,
> #67 shifted lines). Use THIS file's numbers.

## 1. Authority

- DD-135 (D3) signed (`docs/standards/decisions.md:1790-1808`, sign line `:1808`). Binding (`:1797-1801`): join by a signed-in account; open + seat
  => active + charge now (price per DD-39; free session => 0 VND `paid` charge); full => waitlisted, no charge until promoted; approval (DD-05) =>
  `join_requests` pending, host approves/rejects; self-leave while open and before start only when net recorded money = 0 (charge void), else refuse
  with a code telling the player to ask the host; FIFO auto-promotion on a freed seat; out: hold, QR, pay-now, provider webhook, settlement
  finalizer. The leave-refusal code is the lane's default to pin (`:1803`).
- DD-134 (D2) (c) override, owner 2026-10-16 (`decisions.md:1833`): exactly ONE Zalo DM to a player promoted from the waitlist (that player only, only
  if their Zalo is linked), saying they now hold a seat and the fee owed; the lane that introduces the promotion event wires it; no other DM type, no
  reminders. DD-05 `decisions.md:222-228`; DD-125 row `:132` (ActionClass += manage_roster, mark_paid; roster add/remove only while open); reversal
  owner-only (`money.correct`) `:1889`.
- DD-133 (a) via L7: one occupancy formula, `packages/db/src/session-occupancy.ts` (header `:5-27`). L4 pins that bind L8 (not re-decided):
  Z-11 (L8 adds the `player.promoted` route row + one template; the fee source and the worker VND formatter are L8's), Z-12 (staleness), Z-13 (copy),
  Z-20 (harness, D12 lock order): `docs/sessions/web-mvp-phase3-readiness-p3-m6-zalo-outbound.md:216-238`, `:272-282`.
- Specs: `docs/features/FE/feature_cross_club_join.md` (entry points `:17-23` are all public-id or slug routes => L10b; edge `:74` existing
  membership reused, no duplicate guest); `docs/features/BE/feature_cross_club_join_tech.md` (endpoints `:110-115`, idempotency `:175-178`, codes
  `:182-188`, rate limits `:190-195`, open-join tx `:203-217` incl. "public/open/future" `:208`, approval tx `:222-233`, expiry `:235-239`, edges
  `:259-260`, `:268`).

## 2. Measured at base (Q1, Q2)

- **Q1.** Merged ancestors of the base: #65 L7 `8c382917ff9d66bec45d26234520bb5a2c51e0cd`, #66 L4 `61221162c3f206ed02da62dfbd0086d770f75c49` (0057,
  `zalo-dm.ts`, `zalo-dm-templates.ts`, `zalo-bot-api.ts`), #67 L5 `c5497a7914d89df433a3c043e280a0d074e8d3c5` (`web-realtime.ts`,
  `realtime-event-read.ts`): M6 code-complete. Occupancy: `getSessionOccupancy` `session-occupancy.ts:65` (call only after `sessions ... FOR UPDATE`,
  `:24-26`; active players + guest notes, `:38`, `:44`), `sessionActiveRosterCount` `:59`, `slotsOpen` `:70`; not exported from `index.ts`; callers
  `roster-service.ts:181`, `session-service.ts:1474`, `:2782`, `:2984`. L8 calls `getSessionOccupancy` only; a second formula is a HALT. Price =
  `sessions.price_amount` integer >= 0 (`packages/db/schema.ts:610` block, `sessions_price_chk`); `join_policy` 'open'|'approval' default 'open'
  (`sessions_join_chk`); `visibility` 'private'|'public' default 'private' (`:623`, `:641`), public requires `slots_max` (`:645`).
- **Q2** (lane citation -> base):

| Lane block (c762c90) | At base |
|---|---|
| `roster-service.ts` addMemberToSession :121, removePlayerFromSession :300 | `:121`, `:300` (unchanged) |
| `upsertCharge` (pre-measure said absent) | private `async function upsertCharge` `:236-274`, called `:210` (`session.price`) |
| emitSessionEvent calls | `:212` (`player.waitlisted` / `player.added`, payload `:213-219`), `:366` (`player.removed`) |
| `roster-money-shared.ts` RosterMoneyErrorCode :14-32, emitSessionEvent :148 | `:14-31`; `:148-163` (payload "ids and amounts only, no PII" `:147`) |
| `session-service.ts` updateSession | `:1152`; capacity guard `:1464-1477` (`getSessionOccupancy` `:1474`); price guard from `:1479` |
| deleteGuestNote | `:2901`; "WAITLIST PROMOTION IS DELIBERATELY ABSENT ... It lands with the waitlist engine" `:2893-2899` |
| `payment-manual.ts:46-52` | `chargeStatusFor` `:47-52` (due 0 => `paid`) |
| 0006:37 join_requests | `0006_discovery.sql:37-52` |
| 0056:83-103, :107-108 | `0056_outbox_projector_registry_dlq_replay.sql:83-104` (zalo_dm CHECK admits `player.promoted` `:100-103`), `:107-108` web_realtime wildcard |
| 0057:240-247 | `0057_zalo_delivery_targets_definer.sql:240-247` (route rows `:242-245` inside `SET ROLE job_definer` `:39` .. `RESET ROLE` `:247`) |

Other anchors: `apps/web/lib/session-command-route.ts` ACTOR_LIMIT `:88`, readTenantParam `:102-105`, mayManageSessions `:117-122`,
resolveSessionCommandContext `:168` (options `{ guestNoteSessionId? }` `:171`), STATUS_BY_CODE `:435`, MESSAGE_BY_CODE `:499`, mapSessionCommandError
`:627` (RosterMoneyError mapped `:630`), handleSessionCommand `:712`; host-add route `apps/web/app/api/sessions/[id]/players/route.ts:23-25`
(`handleSessionCommand`, bucket `session-roster-add` 30); `packages/core/src/api-contract.ts` API_ERROR_CODES `:82-134` (sorted, unique:
`api-contract.test.ts:12`, `:16`), ApiErrorCode `:136`; `packages/db/src/index.ts` roster exports `:80-104`; `apps/web/lib/session-read-route.ts`
handleSessionRead `:77`.

## 3. Measured answers (Q3-Q12)

- **Q3 identity, tenant, membership.** Host-add order `roster-service.ts:126-231`: withTenant -> requireActor (session.manage FOR SHARE +
  authorizeTenantAction manage_roster) `:127` -> commandId + replayOrNull (advisory xact lock on `processed-command:<tenant>:<commandId>`, DD-117 D5
  dedup on (tenant_id, command_id); replay binds commandType + sessionId + actorPersonId, `roster-money-shared.ts:110-133`) `:132-153` -> sessions FOR
  UPDATE `:156-160` -> open else SESSION_NOT_OPEN `:165` -> memberships FOR SHARE -> players FOR UPDATE by (session, membership) `:171-175` -> full =
  slots_max != null && occupancy >= slots_max `:180-181` -> tail = max(waitlist_position)+1 `:184-188` -> insert or reuse the left row (joined_at
  clock_timestamp() `:204`) -> upsertCharge if active `:209-210` -> event `:212` -> recordCommand `:229`. Route identity is `currentSession().personId`
  (players route `:27`, `:43`); the body never names a person. Today's route gate admits session.manage holders or, only for guest notes, a definer-proved
  association (`auth.ts:335` guestNoteTenantForPerson), else one FORBIDDEN 403 (`session-command-route.ts:200-217`): a player gate is needed.
  memberships `0002_tenants_core.sql:23-38`: status active|guest|left|merged, `display_name` nullable `:27`, partial UNIQUE (tenant_id, person_id) WHERE
  status IN ('active','guest') `:35-37`; app has INSERT on memberships (0009 loop) but NO grant on persons/accounts, so it cannot read
  `persons.display_name` => the one narrow definer is justified. No writer sets memberships to left/merged/guest at the base. Definer shape to copy:
  `0051_host_add_person_definer.sql` (SECURITY DEFINER `:25`, `SET search_path = pg_catalog, public, pg_temp` `:26`, GUC binding `:34`, REVOKE PUBLIC
  `:64`, EXECUTE app `:65`; pinned by `rls-invariants.test.ts:4775`). Suspension: `authorization.ts:49-55` (roster changes are denied under suspension).
- **Q4 rejoin and charges.** charges `0003_payments_ledger.sql:43-56`, UNIQUE (tenant_id, session_id, player_id) `:54`, status open|partial|paid|void;
  players `0002:134-144` UNIQUE (tenant_id, session_id, membership_id) `:143`; `0014_players_waitlist.sql` status active|left|waitlisted `:79-81`,
  waitlisted <=> position not null `:107-108`, position > 0 `:111-112`, `idx_players_waitlist_order` (session_id, status, waitlist_position, joined_at,
  id) `:121-122` (not unique: gaps allowed). Net money = effectiveByCharge, SUM(payment_allocations.amount) with negative reversals
  (`roster-money-shared.ts:166-182`); upsertCharge refuses REJOIN_REQUIRES_REVIEW when effective != 0 (`roster-service.ts:269-270`) and revives
  amount_due = current price (`:271-272`). One charge per player row is a DB constraint.
- **Q5 leave and promotion.** removePlayerFromSession does not promote (header "NOT built: waitlist auto-promotion" `roster-service.ts:31-33`); open only
  `:340`; effective != 0 => REMOVE_REQUIRES_REVIEW `:357-359`; charge void `:360`; player left + position null `:362-365`. updateSession and
  deleteGuestNote do not promote. 0057's recipient filter needs `pl.joined_at <= outbox_events.created_at` (`0057:162`, created_at = tx start):
  promotion must never touch joined_at.
- **Q6 join requests.** `0006:37-52` / `schema.ts:1651-1675`: id, tenant_id, session_id, person_id, status pending|approved|rejected|expired|cancelled
  default pending, expires_at NOT NULL, decided_by, decided_at, command_id, created_at; UNIQUE `idx_join_requests_active` (session_id, person_id) WHERE
  pending; `join_requests_tenant_session_fk` (0019). RLS (ENABLE + FORCE, tenant_isolation) and app SELECT/INSERT/UPDATE/DELETE already exist from
  the 0009 loop (`0009_rls_policies_grants.sql:40`, `:48-57`): 0058 adds NO policy or grant. Zero non-test code reads the table today. BE: TTL per tenant
  default 24 h + hourly cron through a narrow scheduler role (`:237-238`, cron out of L8).
- **Q7 outbox.** emitSessionEvent: aggregate 'session', aggregate_id = session id, sequence nextOutboxSequence, same tx. No event-type registry table:
  the registry is outbox_projectors (`0056:72`) + outbox_projector_routes (`0056:83-104`); web_realtime has a wildcard ('session', NULL) `0056:107-108`.
  `web-realtime.ts:44-64` NOTIFYs any session event id (no type filter); `realtime-event-read.ts:19-35` returns {type, sessionId, version} only;
  `apps/web/lib/use-realtime.ts:50-64` accepts exactly those keys; no event-type allowlist in apps/web => host views refetch on every L8 event with no
  edit outside scope. public_sessions projector is a disabled placeholder with no route (`apps/bot/src/projectors/public-sessions.ts:4-5`): no payload
  ever reaches it.
- **Q8 D2 (c).** `zalo-dm-templates.ts`: header "no venue, address, price, roster or name" `:3-8`, union `:9`, map `:11-16` ("L8 adds
  player.promoted here" `:11`), ZaloDmValues `:26-32`, renderZaloDm `:54-81`. `zalo-dm.ts`: template lookup `:88` (unknown => dlq
  `unexpected_event_type` `:89`), payload `:90`, per-template checks `:92-104`, targets call `:123-127`, no_recipients => delivered
  `noop_no_recipients` (`STATUS_OUTCOMES` `:38-44`: unlinked => no DM, nothing fails), runWithLang `:155-157`. 0057 targets definer `:70-197`:
  `player.promoted` reads payload `player_id` `:144-145`; recipients `:147-165` (active person, active zalo identity on the tenant bot, membership
  active|guest, player active, joined_at <= event created_at, `pl.id = v_player` `:163`); staleness open + ends_at > now `:111-118`; returns no
  amount => the fee rides in the payload. One delivery per (event_id, channel_identity_id) PK `:50` + ON CONFLICT DO NOTHING `:231-233`. Stub
  `apps/bot/src/test-zalo-stub.ts:34`. Bot DB tests: `zalo-dm.test.ts:192` ("against the 0057 definers and the stub (as app_worker)").
- **Q9 harness.** `packages/db/src/test-harness.ts`: setupRlsTestContext `:679`, withChatDefinerLock `:454`, withJobDefinerLock `:537`,
  withDefinerReadLock about `:546`. App-role concurrency pattern: L7 CC1 `roster-service.test.ts:212-227` (Promise.all on `ctx.appDb.db`).
- **Q10 limiter.** `apps/web/lib/session-cookies.ts:420` rateLimited(key, limit, windowSeconds) -> `packages/db/src/auth.ts:366` rateLimitCheck ->
  SQL `rate_limit_check(bucket, limit, make_interval(secs => window))`: one shared sliding-window store, any window. The route gate's per-tenant bucket
  is fixed at 60 s; the BE limit is per person per hour (`:194-195`: join/request 10/h, cancel 20/h) => a person bucket is added.
- **Q11 codes.** Existing: AUTH_REQUIRED, CSRF_INVALID, FORBIDDEN, TENANT_SUSPENDED, RATE_LIMITED, INVALID_BODY, COMMAND_ID_CONFLICT,
  SESSION_NOT_FOUND, PLAYER_NOT_FOUND, REJOIN_REQUIRES_REVIEW, REMOVE_REQUIRES_REVIEW. Missing (L8 adds, sorted): JOIN_REQUEST_NOT_FOUND,
  LEAVE_REQUIRES_HOST, REQUEST_DECIDED, REQUEST_EXPIRED, SESSION_NOT_JOINABLE. PLAYER_BANNED (DD-52) stays out.
- **Q12 count pins** (L4 bumped them; re-measure each): `migrate.test.ts:53` (MIGRATION_COUNT 58 + comment), `:769` (tail);
  `rls-invariants.test.ts:70`, `:1753`, `:2036`, `:4611-4614` (UCC-8); `outbox-projector-registry.test.ts:114-117` (A1), `:123` (A2: wildcard + exactly
  three zalo_dm routes today). Last migration 0057, next 0058, no journal file in `packages/db/migrations`.

## 4. Contract

**4.1 Modules.** `roster-service.ts` exports `upsertCharge` (body unchanged) and `seatPlayer(tx, ...)`, extracted unchanged from addMemberToSession
`:180-210` (full check, tail, insert-or-reuse, upsertCharge when active; the caller emits its own event): host-add keeps its behavior, events and tests.
NEW `session-join-service.ts`: `joinSession(db, { tenantId, personId, sessionId, commandId, allowGuestMembership = false })` (L8 route passes false;
L10b's join-by-slug passes true), `leaveSession(db, { tenantId, personId, sessionId, commandId })`, `promoteFromWaitlist(tx, tenantId, sessionId)`
(precondition: caller holds the session row lock), `hasLiveMembership(tx, personId)`. NEW `join-request-service.ts`: `openJoinRequest(tx, ...)`
(called by joinSession under its locks), `cancelJoinRequest`, `approveJoinRequest`, `rejectJoinRequest`, `listPendingJoinRequests`. `index.ts`
exports the public functions and result types (not promoteFromWaitlist, seatPlayer or upsertCharge). Import cycles that result are call-time only (no
top-level use of an imported binding), the pattern the base already runs (`roster-money-shared.ts:5` <-> `session-service.ts:18`).

**4.2 Lock order (every command, = host-add):** withTenant(?tenant) -> suspension gate (players: authorizeTenantAction(tenant, 'manage_roster');
hosts: requireActor session.manage + manage_roster) -> commandId + replayOrNull (request commands first read the request's session_id unlocked) ->
sessions FOR UPDATE -> join_requests FOR UPDATE (request commands) -> memberships FOR SHARE (or the definer) -> players FOR UPDATE -> occupancy ->
writes -> upsertCharge -> one event -> promoteFromWaitlist (same tx) -> recordCommand. Every refusal throws RosterMoneyError before any write (zero
writes, no event: the tx rolls back).

**4.3 joinSession** (re-derives everything under the lock; also the confirm-time check): session missing -> SESSION_NOT_FOUND 404; status <> 'open'
or starts_at <= now() -> SESSION_NOT_JOINABLE 400; live (active|guest) membership of (tenant, person) FOR SHARE; none -> allowGuestMembership ?
(visibility must be 'public' else SESSION_NOT_JOINABLE; nothing is created yet) : FORBIDDEN 403; private and membership not 'active' ->
SESSION_NOT_JOINABLE; players row active|waitlisted -> current outcome, zero writes (no recordCommand); left row unprovable (P-8) ->
REJOIN_REQUIRES_REVIEW 409; join_policy 'approval' -> openJoinRequest (existing live pending -> same request id; expired pending -> set 'expired',
then insert pending with expires_at = now() + 24 h and command_id) + `join_request.created`, and NO membership is created for a caller without one
(BE `:151`; the definer runs at approve, 4.5); else seatPlayer, preceded by `create_guest_membership` for a caller without a membership (same tx:
a failed join rolls it back, BE edge 16 `:101`): free -> active + exactly one charge
(amount_due = price_amount; 0 => one `paid` charge, as host-add) + `player.added`; full -> waitlisted at the tail, no charge + `player.waitlisted`
(both source 'self_join'). No payments or payment_allocations row is ever written by L8.

**4.4 leaveSession / promoteFromWaitlist.** No live membership or no players row -> PLAYER_NOT_FOUND 404; left -> current outcome, zero writes;
not open, or starts_at <= now(), or (active and effective != 0) -> LEAVE_REQUIRES_HOST 409, zero writes; waitlisted -> left, position null,
`player.removed`, no promotion; active -> charge void, left, position null, `player.removed` (source 'self_leave'), then promoteFromWaitlist.
promoteFromWaitlist: only when status 'open' and starts_at > now(); while slots_max is NULL or getSessionOccupancy < slots_max, take the next
waitlisted row ORDER BY waitlist_position, joined_at, id FOR UPDATE, skipping a row whose old charge is unprovable (P-8, it stays waitlisted); set
active + position null (joined_at untouched), upsertCharge at the current price_amount, emit `player.promoted` {session_id, player_id, membership_id,
charge_id, amount_due} (amount_due read back from the charge). Triggers in the same tx as the freed seat: self-leave of an active player,
removePlayerFromSession of an active player, any slots_max change in updateSession (incl. to NULL), deleteGuestNote (replaces the comment
`session-service.ts:2893-2899`). Not: approve, close, cancel.

**4.5 Join requests.** cancel (requester only: another person's or unknown id -> JOIN_REQUEST_NOT_FOUND 404) / approve / reject (requireActor:
FORBIDDEN 403, TENANT_SUSPENDED 403): non-pending -> REQUEST_DECIDED 409 (a same-command replay returns the stored result); pending with expires_at <=
now() -> REQUEST_EXPIRED 409, zero writes. approve re-derives under the session lock: not open or started -> SESSION_NOT_JOINABLE (request stays
pending); requester left-row unprovable -> REJOIN_REQUIRES_REVIEW; requester already active|waitlisted -> approved, zero roster writes; else membership
(live, or the definer for a requester without one) -> seatPlayer: free -> approved + active + charge, full -> approved + waitlisted; decided_by /
decided_at set; ONE event `join_request.approved` {session_id, request_id, player_id, membership_id, status, waitlist_position}. reject ->
`join_request.rejected`, cancel -> `join_request.cancelled` ({session_id, request_id}). listPendingJoinRequests (session.manage): pending rows with
expires_at > now() ORDER BY created_at, id -> `{ requestId, displayName, createdAt }` only, displayName = the requester's live membership display_name
in the tenant (null if none).

**4.6 Routes** (all through `session-command-route.ts`; tenant only from `?tenant=`, person only from `currentSession()`, body keys other than
commandId never read). resolveSessionCommandContext gains additive options: `selfService: true` (when the caller lacks session.manage, association =
`hasLiveMembership` in one short withTenant read, else the same FORBIDDEN 403) and `personLimit: { bucket, limit, windowSeconds }` (checked after
association and language, key `<bucket>:<personId>`, -> RATE_LIMITED 429); exported helper so L10b shares the join bucket. NEW
`apps/web/app/api/sessions/[id]/join/route.ts` POST (selfService, tenant bucket `session-self-service` 60, person `session-join` 10/3600 s);
`.../leave/route.ts` POST (selfService, `session-self-service` 60); `apps/web/app/api/join-requests/[id]/route.ts` DELETE (selfService, person
`join-request-cancel` 20/3600 s); `.../approve/route.ts`, `.../reject/route.ts` POST (host gate, bucket `join-request-decide` 30);
`apps/web/app/api/sessions/[id]/join-requests/route.ts` GET (handleSessionRead, session.manage). STATUS_BY_CODE / MESSAGE_BY_CODE gain the five codes
(P-17). `api-contract.ts`: the five codes (sorted) + `PendingJoinRequestDto` {requestId, displayName, createdAt} + `JoinSessionResultDto` {outcome:
'active'|'waitlisted'|'requested', playerId, waitlistPosition, requestId} (no amount); test pins the DTO keys like `api-contract.test.ts:178`.

**4.7 Migration `packages/db/migrations/0058_player_self_join.sql`** (the only migration): (a) `create_guest_membership(p_tenant_id uuid,
p_person_id uuid) RETURNS uuid`, 0051 shape: SECURITY DEFINER, `SET search_path = pg_catalog, public, pg_temp`, p_tenant_id must equal
`NULLIF(current_setting('app.tenant_id', true), '')::uuid` else RAISE, person must be 'active' else RAISE, returns the existing active|guest
membership id, else INSERT status 'guest' with display_name from persons, ON CONFLICT (tenant_id, person_id) WHERE status IN ('active','guest') DO
NOTHING then re-select; touches no other row; REVOKE ALL FROM PUBLIC; GRANT EXECUTE TO app only; owner = migration role (as 0051). (b) `SET ROLE
job_definer;` one INSERT ('zalo_dm', 'session', 'player.promoted') with 0057's column list `:242-245`; `RESET ROLE;` (no job_definer-owned object, so
no CREATE ON SCHEMA grant). (c) Nothing else: no table, column, index, CHECK, policy or grant => `packages/db/schema.ts` and `packages/db/db.dbml`
unchanged. Prerequisite: job_definer exists (`pnpm db:bootstrap` as superuser on any non-test DB before migrate; the #62 harness does it in tests).

**4.8 D2 (c) DM and A1 formatter.** `zalo-dm-templates.ts`: union + 'promoted', map + ['player.promoted', 'promoted'], ZaloDmValues gains
`amountDue?: number`, the promoted text (P-16) with fee = `fmtMoney(amountDue)` imported from `@plexco/core`; the header `:3-8` names this template
as the single fee-bearing DM (Z-11 + DD-134 (c)); Z-13's other bans (venue, address, roster, name) hold for it. `zalo-dm.ts`: a promoted branch in
`:92-104` requires payload.amount_due to be a safe integer 0..2147483647 (charges.amount_due is int4) else dlq `malformed_payload`, before any DB
call. Recipient, staleness, idempotency, retry/DLQ: L4's path unchanged. **A1 choice: reuse the existing `fmtMoney`** (`packages/core/src/format.ts:12`,
`n.toLocaleString("vi-VN") + "đ"`, exported via `packages/core/src/index.ts:18`, `@plexco/core` already an `apps/bot` dependency `package.json:13`,
zero callers today) plus one parity test in `apps/web/lib/money.test.ts`: `fmtMoney(n) === formatVnd(n)` for 0, 1, 999, 1000, 150000, 2310000,
2147483647 and a seeded sweep of that range. Reason: zero new formatter code and no edit of `apps/web/lib/money.ts`; moving formatVnd would break the
guard `money-single-formatter-guard.test.ts:221` (asserts `export function formatVnd` in the owner file). The two differ only outside the DM's
domain (NaN, fractions, negatives), which zalo-dm.ts rejects first. **This resolves addendum A1:** no new formatter is added anywhere
(fmtMoney already exists in `packages/core`, a dependency of both apps, `apps/web/package.json:15`, `apps/bot/package.json:13`; `apps/web/lib/money.ts`
stays the one web owner, unedited, and its `groupDigits` doc `:10-14` already says fmtMoney groups the same way; `DONG` is U+0111 `:5`, the same
"đ" fmtMoney appends), and the DM-9 parity test is the proof that the DM's fee text equals the shared formatter's text (it also fails loudly if
the runtime lacks full ICU). The guard walks all of `apps/web` except the owner file (`money-single-formatter-guard.test.ts:38-56`), so the parity
test only calls the two functions and never writes `toLocaleString` or `Intl.NumberFormat` itself.

## 5. Pinned defaults (each "default applied, pending owner sign-off"; repeat in the PR body; L17 consolidates)

- P-1 Private session: joinable only by an ACTIVE member of the owning club; a guest member or a visitor gets SESSION_NOT_JOINABLE 400.
- P-2 "Past" = starts_at <= now() in the tx: join and approve need status 'open' and a future start (BE `:208` "public/open/future").
- P-3 L8 route audience: an active or guest member of `?tenant=`; anyone else one FORBIDDEN 403 (no oracle). Visitors join through L10b's
  public_listing_id route, which calls joinSession with allowGuestMembership true (public sessions only).
- P-4 Self-leave refusal: NEW code LEAVE_REQUIRES_HOST 409 ("ask the host") for net money != 0, after start, or session not open; zero writes. Not
  REMOVE_REQUIRES_REVIEW: MESSAGE_BY_CODE holds one t-pair per code (`session-command-route.ts:499`) and that pair is host copy.
- P-5 Waitlisted self-leave allowed in the same window (no charge, no promotion); already left -> current outcome; no row -> PLAYER_NOT_FOUND 404.
- P-6 Promotion fills ALL free seats FIFO only while open and before start, one charge each at the current price_amount, joined_at untouched,
  unprovable candidates skipped, no renumbering of waitlist_position.
- P-7 Promotion triggers: self-leave, host remove, any slots_max change, guest-note delete; never approve, close or cancel.
- P-8 Rejoin unprovable := the left row's charge exists and (status <> 'void' or effectiveByCharge <> 0) -> REJOIN_REQUIRES_REVIEW 409, checked for
  active, waitlisted and request outcomes.
- P-9 expires_at = created_at + 24 h (BE default; per-tenant TTL and the hourly cron not built); expiry checked lazily (P-10); a new request first
  marks the stale pending row 'expired'; the host read lists only unexpired pending rows.
- P-10 Request states: pending -> approved | rejected (host) | cancelled (requester); non-pending -> REQUEST_DECIDED 409; expired pending ->
  REQUEST_EXPIRED 409 with zero writes; approve of a requester already on the roster -> approved, zero roster writes.
- P-11 Unknown, foreign or not-own request id -> JOIN_REQUEST_NOT_FOUND 404 (one answer).
- P-12 Host read: session.manage (no suspension gate, like other host reads); displayName from the requester's live membership, null when none.
  Mapping: the lane's "requires manage_roster" is, in this repo, the host capability `session.manage` (`roster-service.ts:72`, `ACTIONS`), so the
  host GET needs session.manage in that tenant (FORBIDDEN 403 otherwise); 'manage_roster' itself is only the authorizeTenantAction suspension key
  passed to requireActor (`roster-service.ts:127`, `:306`), which the mutations pass and this read does not.
- P-13 Rate limits: join and request `session-join:<personId>` 10/3600 s; cancel `join-request-cancel:<personId>` 20/3600 s; leave has no person
  bucket (bounded by joins); player routes' tenant bucket `session-self-service` 60/60 s; approve/reject `join-request-decide` 30.
- P-14 Suspension: join, leave, request create/cancel/approve/reject call authorizeTenantAction(tenant, 'manage_roster') -> TENANT_SUSPENDED 403.
  Mapping: the host capability is `session.manage` (`roster-service.ts:72`, `ACTIONS`) and 'manage_roster' is the authorizeTenantAction suspension
  key passed to requireActor (`roster-service.ts:127`, `:306`): approve and reject need both (requireActor; FORBIDDEN 403 without session.manage),
  player commands pass the suspension gate only, and the host GET (P-12) needs session.manage only.
- P-15 Events (aggregate 'session', aggregate_id = session id, one per change): player.added / player.waitlisted (source 'self_join'),
  player.removed (source 'self_leave'), player.promoted, join_request.created / .approved / .rejected / .cancelled; payloads as section 4.
- P-16 Promotion DM: t("Bạn đã có chỗ trong buổi chơi lúc {start}. Phí: {fee}. Xem: {link}", "You now have a spot in the session at {start}. Fee:
  {fee}. See: {link}"); fee "0đ" for a free session; {start} and {link} as Z-13.
- P-17 Error copy: SESSION_NOT_JOINABLE 400 t("Buổi chơi không nhận đăng ký.", "This session is not open for joining."); REQUEST_DECIDED 409
  t("Yêu cầu này đã được xử lý.", "This request has already been decided."); REQUEST_EXPIRED 409 t("Yêu cầu này đã hết hạn.", "This request has
  expired."); JOIN_REQUEST_NOT_FOUND 404 t("Không tìm thấy yêu cầu tham gia.", "Join request not found."); LEAVE_REQUIRES_HOST 409 t("Bạn không thể
  tự rời buổi này, hãy nhờ chủ kèo.", "You cannot leave this session yourself; ask the host."); 429 reuses the existing RATE_LIMITED pair.
- P-18 Join response carries no amount and no venue (`JoinSessionResultDto` keys pinned in `api-contract.test.ts`): own-money display is L9/L12
  and the venue reveal for an active player is the L12 player view; waitlisted and pending outcomes never get a venue (BE `:119`, `:137`, `:151`).
- P-19 Module layout of 4.1 (export upsertCharge and the extracted seatPlayer; call-time-only cycles).

## 6. Implementation steps (dependency order, test-first)

1. GitNexus impact (upstream) on addMemberToSession, upsertCharge, removePlayerFromSession, updateSession, deleteGuestNote, emitSessionEvent,
   resolveSessionCommandContext, handleSessionCommand, mapSessionCommandError, renderZaloDm, the zalo-dm deliver factory; report blast radius,
   warn on HIGH/CRITICAL (fallback: caller grep in the PR body).
2. Migration tests red: migrate.test.ts count/tail, outbox-projector-registry.test.ts A1/A2 (four zalo_dm routes), rls-invariants.test.ts count
   pins + a `create_guest_membership` describe beside `:4775`; then write 0058 (4.7). One migration run at a time, through the lock script.
3. `api-contract.test.ts` (DTO keys) -> `api-contract.ts` (five codes, two DTOs); `RosterMoneyErrorCode` += the five codes.
4. `session-join-service.test.ts` and `join-request-service.test.ts` (NEW, red) -> extract seatPlayer / export upsertCharge (host-add tests stay
   green) -> session-join-service.ts -> join-request-service.ts -> promotion wiring with tests in roster-service.test.ts (host remove) and
   session-service.test.ts (capacity raise, guest-note delete) -> index.ts exports.
5. `session-command-route.test.ts` (selfService, personLimit, five mappings) -> session-command-route.ts; route tests -> six routes;
   `money.test.ts` parity (A1).
6. `zalo-dm.test.ts` promoted cases (before-DB and as app_worker with the stub) -> zalo-dm-templates.ts -> zalo-dm.ts.
7. VERIFY set (section 8), detect_changes, commit in W; no push.

## 7. Acceptance matrix (every row has a test; DB tests as the real app role on `ctx.appDb.db`, never superuser or BYPASSRLS)

| ID | Source | Test site | Expected |
|---|---|---|---|
| A-1 | TESTS concurrency | session-join-service.test.ts | 8 parallel joins (8 members) on slots_max=1: 1 active, 7 waitlisted (distinct positions), 1 charge, 8 events |
| A-2 | TESTS replay | session-join-service.test.ts | same commandId twice, sequential and parallel: 1 row, 1 charge, 1 event; second `replayed: true` |
| A-3 | TESTS confirm-time | session-join-service.test.ts | seat taken after a read showed slotsOpen 1 -> waitlisted; session closed after the read -> SESSION_NOT_JOINABLE |
| A-4 | TESTS approval race | join-request-service.test.ts | approve vs slots_max change in parallel: occupancy never > slots_max; outcome matches the serial order |
| A-5 | TESTS leave+promote | session-join-service.test.ts | BEFORE INSERT trigger (test DB) failing `player.promoted`: leave fails whole: still active, charge open, no event |
| A-6 | TESTS cross-tenant | session-join-service.test.ts + join route test | member of A with `?tenant=B` -> FORBIDDEN; A's GUC reads 0 rows of B's roster |
| A-7 | TESTS guest UNIQUE | session-join-service.test.ts + rls-invariants.test.ts | parallel allowGuestMembership joins in two sessions -> one guest membership; definer: GUC mismatch raises, PUBLIC revoked, app-only EXECUTE, search_path pinned |
| A-8 | TESTS public DTO | existing invariant suites (`pnpm -w test`) | public whitelist tests green, no public field added |
| A-9 | TESTS events | both service tests | one event per change (type per P-15); refused or rolled-back commands write none |
| A-10 | TESTS host read | join-requests GET route test + service test | plain member FORBIDDEN 403; keys exactly createdAt, displayName, requestId; expired rows absent |
| DT-1 | no account | join/leave/DELETE route tests | AUTH_REQUIRED 401; body personId/tenantId ignored, actor = session person |
| DT-2 | not joinable | session-join-service.test.ts | draft, closed, cancelled, started, private for a guest member -> SESSION_NOT_JOINABLE; private for an active member -> joins (P-1) |
| DT-3 | idempotent | session-join-service.test.ts | already active / waitlisted, new commandId -> current outcome; players, charges, events, processed_commands unchanged |
| DT-4 | rejoin | session-join-service.test.ts | left + effective != 0 or non-void charge -> REJOIN_REQUIRES_REVIEW, zero writes; left + 0 -> same row, one revived charge |
| DT-5 | open + seat | session-join-service.test.ts | active + 1 charge, amount_due = price_amount; free session -> 1 charge 0 `paid`; no payments rows |
| DT-6 | open + full | session-join-service.test.ts + api-contract.test.ts | waitlisted at the tail, no charge; result keys carry no venue or amount (P-18) |
| DT-7 | approval | join-request-service.test.ts | pending only: no player, charge or held seat, and no memberships row added (also for an allowGuestMembership caller without one); duplicate -> same id; expired pending -> marked expired + new pending |
| DT-8 | approve/reject | join-request-service.test.ts + route tests | free -> approved+active+charge; full -> approved+waitlisted; decided -> REQUEST_DECIDED; expired -> REQUEST_EXPIRED zero writes; non-host FORBIDDEN; suspended TENANT_SUSPENDED; reject -> rejected; foreign id -> JOIN_REQUEST_NOT_FOUND |
| DT-9 | self-leave | session-join-service.test.ts | net 0 -> left, charge void, promotion same tx; net > 0, after start, not open -> LEAVE_REQUIRES_HOST zero writes |
| DT-10 | promotion | roster-service.test.ts, session-service.test.ts, session-join-service.test.ts | host remove, capacity raise (finite and NULL), guest-note delete, self-leave each promote the lowest position; one charge each; joined_at unchanged; no money rows |
| DT-11 | rate limit | join and DELETE route tests | 11th join in an hour -> RATE_LIMITED 429; 21st cancel -> 429 |
| DT-12 | HARD RULE 4 | session-join-service.test.ts | a host-added person with the same display name is never reused; joins use the account's person only |
| DM-1 | D2 (c) | zalo-dm.test.ts (app_worker + stub) | one promotion -> exactly one sendMessage to the promoted player's chat |
| DM-2 | D2 (c) | zalo-dm.test.ts | promoted player unlinked -> delivered noop_no_recipients, no send, no failure |
| DM-3 | D2 (c) | zalo-dm.test.ts | other linked active players get nothing |
| DM-4 | D2 (c) | session-join-service.test.ts + zalo-dm.test.ts | payload amount_due == the charge's amount_due (charge_id); DM text contains fmtMoney(amount_due) |
| DM-5 | D2 (c) | zalo-dm.test.ts | redelivery of the same event -> still one delivery row, one send |
| DM-6 | D2 (c) | zalo-dm.test.ts (before DB) | amount_due missing, fractional, negative or > int4 -> dlq malformed_payload, no DB call |
| DM-7 | D2 (c) | zalo-dm.test.ts | 'en' tenant -> English pair; else Vietnamese |
| DM-8 | D2 (c) | outbox-projector-registry.test.ts | exactly four zalo_dm routes; no route for any other L8 type; committed defaults keep zalo_dm disabled and dispatch off |
| DM-9 | A1 | money.test.ts | fmtMoney(n) === formatVnd(n) over the domain |

## 8. Verification (cite measured output, `| tail -40`)

pnpm typecheck; pnpm lint; pnpm format:check; pnpm review:check:changed; pnpm build; NODE_ENV=test pnpm --filter @plexco/web test; NODE_ENV=test
DATABASE_URL_TEST=... pnpm --filter @plexco/db test; NODE_ENV=test DATABASE_URL_TEST=... pnpm -w test (DB suites and migrations one at a time
through `N/scripts/locked-run.sh`; re-run the app/app_worker/readonly password step after each full run). No e2e expected (no UI change); the zalo_dm
projector is enabled only inside test processes with `test-zalo-stub.ts`, never with a real token. D12: no L8 test takes the chat-definer slot; any
that must takes the job definer lock (shared) first.

## 9. Budget (B3 exception)

- Modules: four (packages/db, apps/web, packages/core, apps/bot); exactly ONE migration (0058).
- Authorized scope additions beyond the lane list: `apps/bot/src/projectors/zalo-dm.ts`, `zalo-dm-templates.ts`, `zalo-dm.test.ts` (D2 (c));
  `apps/web/lib/money.test.ts` (A1 parity; formatter `packages/core/src/format.ts` read only); count-pin tests `migrate.test.ts`,
  `rls-invariants.test.ts`, `outbox-projector-registry.test.ts`; promotion-trigger tests `roster-service.test.ts`, `session-service.test.ts`;
  `apps/web/lib/session-command-route.test.ts`; NEW `session-join-service.test.ts`, `join-request-service.test.ts` and one `route.test.ts` per new route.
- Why one lane: join, leave, approve and promotion share one lock order, one charge path (seatPlayer/upsertCharge) and one event contract; a leave
  without promotion breaks FIFO (D3), a promotion without its DM fails D2 (c) acceptance, routes without services are dead, and the definer plus the
  route row must ship in the single migration.
- Compatibility (rolling deploy; the program is local-only): 0058 is additive (one app-only function, one route row for the disabled zalo_dm
  projector); old binaries never call the function or emit the new types; new routes are new paths; the route-gate options default off; API codes are
  added only. Rollback = revert the code; 0058 stays inert. Seats freed by old code before cutover are promoted at the next seat-freeing command.
- Hard caps (git diff --numstat against the base): non-test lines (TS + SQL) <= 1100; test lines <= 1800; total <= 2900; files <= 38. Over a cap
  => stop and report, do not trim tests.

## 10. OPEN (out of scope: report, do not edit)

- O-1 Hourly expiry cron and per-tenant TTL (BE `:237-238`): later lane with the narrow scheduler role.
- O-2 L10b: a name read for visitor (membership-less) requests and a visitor cancel path; L8 lists them with displayName null.
- O-3 DD-41/42/52 eligibility and ban evaluators and DD-45 roots are not built; join has no ban check (negative scope).
- O-4 A person with two memberships in one tenant cannot exist at the base (partial unique, no left/merged writer); a future merge lane owns that guard.
- O-5 `apps/web/lib/realtime-auth.ts:62` re-auth not re-read at step 0; no edit expected (type-agnostic NOTIFY).

## 11. Closure matrix (12 of 12)

| # | Gate | Evidence | Result |
|---|---|---|---|
| 1 | Authority snapshot pinned by SHA | `AUTHORITY_SHA` = W HEAD = session base; every TARGET_FILES path exists at the base | PASS |
| 2 | Decisions in scope final | DD-135 signed `:1808`; DD-134 (c) signed `:1833`; P-1..P-19 pinned | PASS |
| 3 | Scope IN/OUT and owner clear | lane FILES IN SCOPE + section 9 additions; NEGATIVE SCOPE; L8 sole editor of session-service.ts in P3-S4 | PASS |
| 4 | Dependencies classified | #65, #66, #67 merged ancestors of the base; D3 signed | PASS |
| 5 | Live schema and code match | sections 2-3, measured at the base | PASS |
| 6 | Data, API, state, auth contract | section 4 | PASS |
| 7 | Fail-closed, idempotency, order | 4.2 lock order = host-add; command dedup; zero-write refusals; rollback leaves no event | PASS |
| 8 | Open questions in scope = 0 | section 5 pins; section 10 residue is out of scope | PASS |
| 9 | Acceptance matrix with expected results | section 7 | PASS |
| 10 | Migration, security, rollback | one additive migration, 0051 definer shape, app-only EXECUTE; opus/max reviewer + security round; rollback = revert | PASS |
| 11 | First slice hard dependencies merged | #65, #66, #67 | PASS |
| 12 | Implementation handoff ready | sections 4-9; W clean at the base with deps installed | PASS |

## 12. Verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-10-17
AUTHORITY_SHA: c5497a7914d89df433a3c043e280a0d074e8d3c5
BASE_BRANCH: main
TARGET_FILES:
  - docs/autopilot-templates/web-mvp-phase3-2026-10-16-RUN.md
  - docs/standards/decisions.md
  - docs/features/FE/feature_cross_club_join.md
  - docs/features/BE/feature_cross_club_join_tech.md
  - docs/sessions/web-mvp-phase3-readiness-p3-m6-zalo-outbound.md
  - packages/db/src/roster-service.ts
  - packages/db/src/roster-money-shared.ts
  - packages/db/src/session-service.ts
  - packages/db/src/index.ts
  - packages/db/src/session-occupancy.ts
  - packages/db/src/payment-manual.ts
  - packages/db/src/authorization.ts
  - packages/db/src/auth.ts
  - packages/db/src/realtime-event-read.ts
  - packages/db/src/test-harness.ts
  - packages/db/src/roster-service.test.ts
  - packages/db/src/session-service.test.ts
  - packages/db/src/rls-invariants.test.ts
  - packages/db/src/migrate.test.ts
  - packages/db/src/outbox-projector-registry.test.ts
  - packages/db/schema.ts
  - packages/db/db.dbml
  - packages/db/migrations/0002_tenants_core.sql
  - packages/db/migrations/0003_payments_ledger.sql
  - packages/db/migrations/0006_discovery.sql
  - packages/db/migrations/0009_rls_policies_grants.sql
  - packages/db/migrations/0014_players_waitlist.sql
  - packages/db/migrations/0051_host_add_person_definer.sql
  - packages/db/migrations/0056_outbox_projector_registry_dlq_replay.sql
  - packages/db/migrations/0057_zalo_delivery_targets_definer.sql
  - packages/core/src/api-contract.ts
  - packages/core/src/api-contract.test.ts
  - packages/core/src/format.ts
  - apps/web/lib/session-command-route.ts
  - apps/web/lib/session-command-route.test.ts
  - apps/web/lib/session-read-route.ts
  - apps/web/lib/session-cookies.ts
  - apps/web/lib/money.ts
  - apps/web/lib/money.test.ts
  - apps/web/lib/money-single-formatter-guard.test.ts
  - apps/web/lib/realtime-auth.ts
  - apps/web/app/api/sessions/[id]/players/route.ts
  - apps/bot/src/projectors/zalo-dm.ts
  - apps/bot/src/projectors/zalo-dm-templates.ts
  - apps/bot/src/projectors/zalo-dm.test.ts
  - apps/bot/src/projectors/web-realtime.ts
  - apps/bot/src/projectors/public-sessions.ts
  - apps/bot/src/test-zalo-stub.ts
SLICE: p3-m9-join-core
IN_SCOPE: player self-join on web (open -> active with one charge at price_amount, or waitlisted; approval -> pending join request), approve, reject, cancel, self-leave, FIFO promotion on every seat-freeing path with one charge each, guest membership through one narrow definer for L10b and approve, host read of pending requests, one outbox event per roster change, the D2 (c) promotion DM through L4's zalo_dm projector with the existing core fmtMoney and a parity test, five error codes, two DTOs, six routes, one migration 0058 (definer + one route row)
OUT_OF_SCOPE: holds, QR, pay-now, provider webhooks, settlement finalizer, any money movement by join, gender price (L11), discovery and public projection (L10, L10b), player view pages (L12), Zalo commands (L13), DD-41/42/52 evaluators, expiry cron and per-tenant TTL, reminders or any other DM type, reversal outside money.correct, edits to 0056, 0057, apps/web/lib/money.ts, test-harness files, decisions.md and Reviewed specs
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: ENABLEMENT_ONLY:zalo-dm-projector-enable-owner-P0 # the promotion DM stays dark: zalo_dm disabled, dispatch off, stub-only tests
HARD_DEPENDENCIES: L7 #65 merged 8c382917ff9d66bec45d26234520bb5a2c51e0cd (probe getSessionOccupancy); L4 #66 merged 61221162c3f206ed02da62dfbd0086d770f75c49 (probe 0057_zalo_delivery_targets_definer.sql); L5 #67 merged c5497a7914d89df433a3c043e280a0d074e8d3c5 (probe web-realtime.ts); DD-135 signed
PRIOR_SLICES: L7 p3-m9-occupancy-helper (#65), L4 p3-m6-zalo-outbound (#66), L5 p3-m6-web-live-sync (#67)
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: the promotion DM reaches a real player only after L4's owner P0 steps (real bot token, worker env, OUTBOX_DISPATCH_SCHEDULE_ENABLED=true, outbox_projector_set_enabled('zalo_dm', true)); L8 adds none
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS # one additive migration; definer 0051 shape with GUC binding and app-only EXECUTE; tenant only from ?tenant=, person only from the session; opus/max reviewer + opus/max security round
IMPLEMENTATION_ARTIFACTS: PASS
FIRST_IMPLEMENTATION_STEP: section 6 steps 1-2 - GitNexus impact on the listed symbols, then the 0058 tests in migrate.test.ts, outbox-projector-registry.test.ts and rls-invariants.test.ts red before writing packages/db/migrations/0058_player_self_join.sql
REMAINING_BLOCKERS: none
```
