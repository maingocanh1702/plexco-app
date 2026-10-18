<!-- review-readiness: code-ready -->

# Step-0 readiness: L10b p3-m9-discovery-read (session P3-S8)

> Agent-facing. Readiness reviewer #1 opus/max measured sections 0-4.4 and stopped at the token rule; reviewer #2 (fresh,
> opus/max) re-measured the open items, confirmed or amended 4.1-4.4, wrote 4.5-4.7 and decided 5-11; reviewer #3 (fresh,
> opus/max, no re-measurement) wrote 5-11 from that decided content under the orchestrator rulings RD-1..RD-9 (section 4.0).
> Writer opus/max; code reviewer
> opus/max + opus/max security round, at most 3 rounds (DD-122 D4). Every `path:line` is MEASURED at base
> `4ece239852c2ca31513d61c81e418f4bfa556ebf` (lane block measured at `c762c90`). TARGET_FILES are read-only context that exists
> at the base; new files are scope, never TARGET_FILES.

## 0. Threat model (binding, nothing wider) - DONE

- Adversaries: (1) any anonymous internet client of the list, detail and share routes (enumerating listing ids and slugs,
  tampering with filters and cursors, exhausting or bypassing the rate limit, telling an unknown id from a hidden one by status,
  body or shape); (2) any signed-in visitor of the join route (joining a private, full, fenced, closed, cancelled or started
  session through a stale or forged id; joining as someone else; using the join to learn a session uuid or tenant id); (3) a club
  admin (alias text, publish, visibility, slug rotate / revoke); (4) any code running as `readonly` (a compromised discovery
  process).
- Trusted: the platform owner holding `DATABASE_URL_MIGRATION`.
- HALT conditions the contract makes impossible: any migration; any response field, URL or redirect beyond the whitelist (no
  tenant id, session uuid, confirmed_count, slots_max, venue, roster, host or person name, person gender, money beyond
  price_amount); a session uuid reaching the client; a join that skips joinSession's canonical revalidation; a `/s/<session id>`
  path; a cache.

## 1. Base, dependencies, authority (Q1) - DONE

- W = `.autopilot/worktrees/p3-m9-discovery-read`, branch `feat/p3-m9-discovery-read`, HEAD = base 4ece239 (merge of #72), clean,
  no index.lock. Log: #72 L10 (4ece239), #73 CI (f2c6aa8). Migrations end at `0061_public_sessions_projector_writer.sql`
  (0059, 0060, 0061 are the last three). L8 #68, L10a #71 (0060 present) and L10 #72 (0061 present) merged.
- DD-133 (D1) signed: decisions.md:1859 ("Phase 3 plan approved. D1 signed (a)-(e)", 2026-10-16). (a) :1844 one occupancy helper,
  `confirmed_count` tenant-private (=> never in a public response). (e) :1846 random opaque 128-bit `public_listing_id`, rotated
  whenever the session leaves public; the DD-83/DD-75 hash-only slug serves only host-shared links; the view exposes neither
  `session_id` nor `public_projection_version`; lookup server-side.
- DD-83 decisions.md:1178: a session uses an opaque slug `/session/<slug>`, replacing DD-73's `/s/<id>`; every public URL reads
  only the guarded view, never canonical rows, never exposes `tenant_id` or PII; rename => tombstone.
- DD-73 decisions.md:1013 parts and the split (default applied, pending owner sign-off):
  - IN: "the share link grants no join" - the CTA sends a protected join intent to the canonical join service, which resolves
    the target server-side and re-checks live visibility / status / capacity / join_policy / eligibility under the tenant
    context (the L10b join route + joinSession). The card ban list (venue, roster, debt, phone/email, PLAYER gender) = the DTO
    whitelist; `gender_restriction` is session policy and allowed (DD-73 ban list, BL-DSC-1 / DD-41).
  - OUT (L12 or a later slice): the server-rendered OG card / landing HTML (UI; lane NEGATIVE SCOPE "no UI (L12)"); the `?l=vi|en`
    landing locale (belongs to the renderer); the acquisition telemetry (`share_initiated -> share_landing_viewed -> join_started
    -> join_succeeded` with a bounded-TTL `share_ref`): it needs durable bounded-retention storage that does not exist at the base
    (a table = a migration = HALT for L10b) and its first two events are UI events. Recorded as OPEN O-1.
  - DONE by L10 (0061): guarded view, fence anti-join, hash-only slug registry.

## 2. Lane-block and pre-measure citations re-measured at the base (Q2) - DONE except where marked

- 0061: slug table :113-121; view `public_session_share_v` :128-163 (security_barrier; 17 columns :129-146; WHERE :149-160:
  expires_at > now(), alias approved, tenant not suspended / cancelled, no session_share fence with deny_scope public / all;
  club_display_name = t.public_alias live). `public_listing_id` DEFAULT `encode(gen_random_bytes(16),'hex')::uuid` :56, UNIQUE
  :58, never updated :74; a fenced eligible recompute replaces the row with a NEW id :257. `public_share_slug_resolve(text)`
  :447-461 (shape `^[A-Za-z0-9_-]{22}$`, sha256 of `plexco/session-share-slug/v1:` || slug, revoked_at IS NULL, row in view);
  `public_listing_resolve(uuid)` :463-475 (row in view); privileges :477-487 (lookups EXECUTE readonly only :486; view SELECT
  readonly only :487; rotate / revoke EXECUTE app :482-483).
- Catalog probe on plexco_test (has_*_privilege): readonly SELECT on public_sessions / sessions / tenants /
  public_session_share_slugs = f/f/f/f; readonly view = t; readonly both lookups = t/t; readonly rate_limit_check = f; app view =
  f; app both lookups = f/f; app rate_limit_check = t; app public_sessions = f; view relkind v, `security_barrier=true`.
- apps/web/lib/request-policy.ts (116 lines): ProcessRole :26; DISCOVERY_PATH_ALLOWLIST :28 = `[/^\/healthz$/, /^\/discover(\/|$)/]`
  (NOTE: `/api/discover` does NOT match it today); parseProcessRole :30; pathAllowedForRole :36 (web and worker: always true).
- apps/web/middleware.ts (73 lines): middleware :39; discovery outside allowlist => 404, null body, no-store :41-43; matcher :72.
- apps/web/lib/session-command-route.ts (832 lines): ACTOR_LIMIT 60/60 s :91; SESSION_NOT_FOUND_MESSAGE :94; readTenantParam :105;
  actorThrottled :111; mayManageSessions :120; SESSION_JOIN_PERSON_LIMIT session-join 10/3600 s :135 (comment :134 "L10b's
  join-by-slug route spends the same one"); personThrottled :154; isUnsafeCommandKey :202; MAX_BODY_BYTES 64 KiB :~222;
  resolveSessionCommandContext :232 (AUTH_REQUIRED 401 :238; CSRF_INVALID 403 :239-241; `?tenant=` mandatory else INVALID_BODY
  400 :245-248; actor ceiling :258-260; FORBIDDEN 403 :262-273; resolveTenantLang :297; person then tenant bucket :303-313;
  bounded body + JSON object :316-330; commandId string, non-blank, <= 200, not unsafe :335-343); mapSessionCommandError :727;
  handleSessionCommand :814 (calls resolveSessionCommandContext :820). STATUS_BY_CODE :499-544 (ALREADY_JOINED 409 :503,
  REJOIN_REQUIRES_REVIEW 409 :509, SESSION_NOT_JOINABLE 400 :518; NO row for AUTH_REQUIRED, CSRF_INVALID, INVALID_BODY,
  NOT_FOUND or RATE_LIMITED: those are emitted directly with err()); MESSAGE_BY_CODE :574 (ALREADY_JOINED :579 "Người chơi
  đã có trong buổi này." / "This player is already on the roster."); mapSessionCommandError: unregistered code or table miss
  => null (rethrow) :766-771. Imports: err from ./api-envelope :21, readBoundedBody from ./read-bounded-body :22;
  MAX_BODY_BYTES 64 KiB :221 is module-private. apps/web/lib/api-envelope.ts:36 `err(code: ApiErrorCode, message,
  statusCode, details?)` => `Response.json`, `meta.requestId` = random `req_<uuid>` per call.
- apps/web/app/api/sessions/[id]/join/route.ts (54 lines): handleSessionCommand :31-53, tenant bucket `session-self-service` 60
  :33, joinSession without allowGuestMembership :38-43, DTO key by key :44-49, `ok({ join, replayed })` :50, personLimit :52;
  comment :15-19.
- packages/db/src/session-join-service.ts (437 lines): JoinSessionParams :36-45 (allowGuestMembership? :42-44 "L10b's
  public_listing_id route only"); JoinSessionResult :48-54; liveMembership :143-156 (status IN active, guest; FOR SHARE);
  mintGuestMembership :191-202; joinSession :206; no live membership and allowGuestMembership !== true => FORBIDDEN :224-226;
  SESSION_NOT_FOUND :227-228; status open and not started else SESSION_NOT_JOINABLE :229-231; non-public needs an ACTIVE member
  :234-236; already seated => current outcome, zero writes :251-256; REJOIN_REQUIRES_REVIEW :257-259; join_policy != open =>
  openJoinRequest BEFORE any mint :263-279; mint :281; seatPlayer :282. join-request-service.ts:352 (approve) also mints.
- packages/core/src/api-contract.ts (210 lines): API_ERROR_CODES :92-152 (sorted, no duplicates: api-contract.test.ts:13-19);
  AUTH_REQUIRED :98, CSRF_INVALID :110, FORBIDDEN :111, INVALID_BODY :114, MISSING_DISCOVERY_FIELDS :127, NOT_FOUND :128,
  RATE_LIMITED :133, REJOIN_REQUIRES_REVIEW :134, SESSION_NOT_FOUND :142, SESSION_NOT_JOINABLE :143; INVALID_FILTER and
  DISCOVERY_RATE_LIMITED absent; JoinSessionResultDto :174-179 (no session id); ApiEnvelope :202-206 (data | error, meta.requestId).
- packages/db/src/index.ts (275 lines): session-join-service block ends :99; rateLimitCheck :195; public-alias block ends :275; no
  discovery export.
- apps/web/lib/session-cookies.ts: appDb :54-63 (DATABASE_URL; DB_EXPECTED_ROLE gate :60-61); gateHandleOnRoleAssert :70 (not
  exported); clientIp :402-413 (do-connecting-ip / fly-client-ip by TRUSTED_INGRESS_PROVIDER, else `local` outside production);
  rateLimited :420-423 -> rateLimitCheck(appDb().pool); clientIp is exported (:402); currentSession :179; csrfOk(request,
  session) :328.
- packages/db/src/test-harness.ts: withChatDefinerLock :454, acquireChatDefinerLock :472, withJobDefinerLock :537,
  withJobDefinerBreakerLock :542, withDefinerReadLock :547, withAdvisoryLocks :558, RlsTestContext :643, readonlyPool :648,
  setupRlsTestContext :679, password lease after setup :720-721, readonlyPool = pg.Pool max 2 :726, teardown :750.
- packages/db/schema.ts: publicSessions :1609; priceAmount integer NOT NULL :1617 (JSON integer); uq listing id :1641.
- infra/docker-compose.yml discovery service :135-147 (profile full, PROCESS_ROLE discovery, DATABASE_URL readonly dev DSN :146,
  DB_EXPECTED_ROLE readonly :147). .env.example :18-33 (DATABASE_URL = app dev DSN :33; discovery shares the name DATABASE_URL).
- BE tech doc: §3 :102-170 (GET /api/discover Public :108; detail UNPINNED :109; params :111-123 sport, area, start_after /
  start_before, skill (legacy), level_min_rank / level_max_rank, level_strict, max_price, available_only, cursor; errors :125-130
  429 DISCOVERY_RATE_LIMITED "Quá nhiều truy vấn", 400 INVALID_FILTER "Bộ lọc không hợp lệ"; example :140-151 items[] +
  nextCursor; idempotency :163-169). §4 Caching :202-209 says "short TTL cache": SUPERSEDED for this lane by the lane NEGATIVE
  SCOPE "no cache" (and L10 O-2: no cache key exists after DD-133 (e)). Security :211-222.
- Web route tests mock `@plexco/db` (`vi.mock`): apps/web/app/api/sessions/[id]/join/route.test.ts, lib/session-command-route.test.ts
  => web route tests need no DATABASE_URL_TEST and no DB lock; DB isolation tests live in packages/db.

## 3. Measured facts the contract rests on - DONE

- F-1 `app` can execute neither lookup nor read the view (probe) => the join route (web, app) resolves through a READONLY handle.
- F-2 `readonly` cannot execute rate_limit_check (probe) and a grant is a migration => discovery cannot use the DB limiter.
- F-3 a raw session uuid never resolves: public_listing_id is an independent random 128-bit value (0061:56, UNIQUE :58), the
  view never exposes session_id, and public_listing_resolve matches only `ps.public_listing_id` (:472).
- F-4 handleSessionCommand cannot serve the public join: `?tenant=` is mandatory (:245-248) and a non-member gets FORBIDDEN (:262-273).
- F-5 `/api/discover` is not on the discovery allowlist (:28): the allowlist MUST change.
- F-6 L8 OPEN 1 becomes reachable: L10b is the first caller with allowGuestMembership: true; a person whose membership is left /
  merged (not live, :151) but whose old players row in this session is not `left` gets a minted guest membership (:281) and a
  second seat (:282).
- F-7 GitNexus is stale at this base: impact(joinSession) => "Target 'joinSession' not found" (risk UNKNOWN);
  impact(resolveSessionCommandContext) => risk LOW, 0 direct callers, although handleSessionCommand calls it (:820). Grep
  fallback: `joinSession(` has ONE production caller, `apps/web/app/api/sessions/[id]/join/route.ts` (member path; no bot
  caller); handleSessionCommand serves 17 route modules under apps/web/app/api (sessions, join-requests) plus
  session-guest-note-route.ts and session-read-route.ts => the measured fan-in of resolveSessionCommandContext is HIGH.
- F-8 session-join-service.ts re-measured: `existing` is loaded (FOR UPDATE :249) only when a live membership exists
  (:238-249); seated :250-255; rejoinUnprovable :256-258; join_policy branch :262, openJoinRequest :263; mint :279, seatPlayer
  :280 (section 2 and F-6 cite :281 / :282: two lines late). On the guest path (membership undefined) nothing looks at the
  person's other seats before :262 => the RD-4 guard goes between :258 and :259.
- F-9 packages/core/src has no closed sport-key set (grep SPORT_KEYS / SportKey: none); the catalog is DB-only and readonly
  cannot read it (F-1) => the sport filter is validated by shape only (P-9).
- F-10 infra/docker-compose.yml re-measured: web service :33 (DATABASE_URL app :46, DB_EXPECTED_ROLE app :49); discovery :136
  (PROCESS_ROLE :142, DATABASE_URL readonly :147, DB_EXPECTED_ROLE readonly :148; section 2's :135-147 is one line early).
  .env.example: DATABASE_URL :33, DB_EXPECTED_ROLE :164.

## 4. Contract (binding: reviewer #1 proposals as confirmed or amended by reviewer #2)

### 4.0 Orchestrator rulings (P3-S8, 02:47, binding)

- RD-1 the four routes, the process split, the allowlist regexes, `cache-control: no-store` and no redirect (4.1) are
  accepted; join by slug is OUT (the share DTO carries publicListingId, already public in the list and resolvable only while
  the view row exists).
- RD-2 the readonly wiring (4.2) is accepted: `DISCOVERY_DATABASE_URL` in both processes, dev placeholders only, an always-on
  `current_user = 'readonly'` assert that fails closed. Scope addition NEW apps/web/lib/discovery-route-support.ts APPROVED (an
  App Router route module may export only route fields, request-policy.ts:89-91; the four routes share the readonly handle,
  the limiter, the whitelist mapper and the NOT_FOUND body). Compose and .env.example edits are limited to the
  DISCOVERY_DATABASE_URL lines (plus an optional commented `DISCOVERY_CURSOR_KEY` placeholder with no value).
- RD-3 the rate limits (4.3) are defaults pending owner sign-off; the in-process limiter carries a `ponytail:` comment naming
  its per-process ceiling and its upgrade path.
- RD-4 L8 OPEN 1 guard: scope addition packages/db/src/session-join-service.ts APPROVED, guest path only, before any write and
  before mintGuestMembership, an existing L8 code, zero writes, a red-first DB test; the member path keeps its behavior (its
  existing tests are the proof). Pinned in 4.6.
- RD-5 no edit to resolveSessionCommandContext or handleSessionCommand; on HIGH or CRITICAL impact the join route reuses the
  existing exports; a new helper beside them only on LOW or MEDIUM with the existing path unchanged. Pinned in 4.6.
- RD-6 B3 caps: non-test <= 600, test <= 1400, total <= 2000, files <= 22 (readiness file excluded), migrations 0; modules
  packages/db, packages/core, apps/web, infra (section 8).
- RD-7 DD-73 telemetry OUT, `level_*` filters rejected, the limiter ceiling and DISCOVERY_CURSOR_KEY required in production are
  UNPINNED defaults (section 5); no AWAIT.
- RD-8 (03:05) reviewer #2's amendments are accepted: session-command-route.ts is NOT edited; INVALID_FILTER and
  DISCOVERY_RATE_LIMITED are emitted only by discovery-route-support.ts through err() (measured precedent: AUTH_REQUIRED,
  CSRF_INVALID, INVALID_BODY, NOT_FOUND and RATE_LIMITED have no STATUS_BY_CODE row), which NARROWS the lane block's
  "session-command-route.ts (error map)" item (4.7); the join route adds no helper and reuses the existing exports (RD-5:
  fan-in measured HIGH by grep because the GitNexus index is stale, F-7); the join response is
  `{ join: { outcome, waitlistPosition }, replayed }` with no playerId, requestId, session id or tenant id (4.6 step 7).
- RD-9 (03:05) the RD-4 guard refuses with ALREADY_JOINED (409) for the reason in 4.6; the member path is unchanged.

### 4.1 Routes, processes, request policy (Q3)

- GET `/api/discover` (list), GET `/api/discover/<publicListingId>` (detail), GET `/api/discover/share/<slug>` (share JSON; the
  human page `/session/<slug>` is L12's and reads the same db function). Served by both processes through the readonly handle.
- POST `/api/public-listings/<publicListingId>/join` (web process only: needs the session cookie, CSRF and `app`). Join by slug
  OUT: the share DTO carries publicListingId, which is already public in the list (resolve requires the view row).
- Allowlist :28 becomes `[/^\/healthz$/, /^\/discover(\/|$)/, /^\/api\/discover$/, /^\/api\/discover\/[^/]+$/,
  /^\/api\/discover\/share\/[^/]+$/]`; shape checks stay IN the routes so a wrong shape gets the same JSON 404 body. The join
  prefix `/api/public-listings` and every `/api/sessions` path match none => 404 on discovery. middleware.ts: no change.
- Every response of the four routes: `cache-control: no-store`; no redirect anywhere.

### 4.2 Readonly wiring, no migration (Q4)

- New env `DISCOVERY_DATABASE_URL` (readonly DSN) in BOTH processes; .env.example and compose get dev placeholders only
  (`postgres://readonly:plexco_dev_readonly@...`, the convention compose:146 already uses).
- New apps/web/lib/discovery-route-support.ts (scope addition): `discoveryPool()` = createDb(url, { max: 5 }).pool with an ALWAYS-on
  `current_user = 'readonly'` assert awaited once before the first query (mismatch poisons the handle => 500, fail closed).
- Detail: `SELECT <17 view columns> FROM public_session_share_v WHERE public_listing_id = $1`. Share, ONE statement:
  `... FROM public_share_slug_resolve($1) r JOIN public_session_share_v v ON v.public_listing_id = r.public_listing_id` so tenant
  and session ids never leave the DB. Join: `SELECT tenant_id, session_id FROM public_listing_resolve($1)` on discoveryPool, then
  joinSession on appDb(). No route reads public_sessions, sessions or tenants as any role (proof = F-1 probe + the 42501 tests).

### 4.3 Rate limits (Q5)

- Discovery: in-process fixed window keyed `discover:<clientIp(request)>`, 60 / 60 s, Map capped at 10 000 keys (sweep expired;
  still full => 429, fail closed). Ceiling: per process and replica, reset on restart; locally one bucket `local`. `ponytail:`
  comment naming the upgrade (a readonly-executable limiter definer = owner migration, or ingress limits). Not a cache: counters only.
- Join: actorThrottled (60/60 s) then personThrottled(SESSION_JOIN_PERSON_LIMIT), both BEFORE the resolve; NO tenant bucket (a
  stranger must not spend a club's quota, rationale :250-257). Codes: DISCOVERY_RATE_LIMITED 429 (discovery), RATE_LIMITED 429 (join).

### 4.4 DTO, filters, cursor (Q6) - confirmed, amended by reviewer #2

- Keys: publicListingId, sportKey, startsAt, endsAt, area, priceAmount, slotsOpen, clubDisplayName, joinPolicy; title,
  sessionType, levelMinRank, levelMaxRank, levelStrict, genderRestriction, ageMin, ageMax only when non-NULL (all NULL today, P-1).
  List `{ items, nextCursor }`, detail / share `{ listing }`, DD-60 envelope. Built key by key from the row (one mapper).
- Accepted: sport, area, start_after, start_before, max_price, available_only (`true`|`false`), limit (1-50, default 20), cursor.
  INVALID_FILTER: skill (column dropped by 0061), `level_*` (no source, P-1), any unknown or repeated param, bad value.
- Value rules, checked before any DB call (else INVALID_FILTER 400): sport `^[a-z][a-z0-9_]{0,31}$` (shape only, F-9; a
  well-formed unknown sport yields an empty page, no oracle: the catalog is public); area trimmed, 1-64 chars, no control or
  bidi character, exact match; start_after / start_before ISO 8601 with an explicit offset, start_after <= start_before
  (`starts_at >= $a`, `starts_at < $b`); max_price integer 0-100000000 (`price_amount <= $n`); available_only `true` =>
  `slots_open > 0`; limit integer 1-50.
- ORDER BY starts_at ASC, public_listing_id ASC; keyset `(starts_at, public_listing_id) > ($1::timestamptz, $2::uuid)`, LIMIT n+1.
- Cursor `v1.<b64url(startsAt-microsecond-text|listingId)>.<b64url(HMAC-SHA256)>`, key `DISCOVERY_CURSOR_KEY`; unset outside
  production => per-process random key; unset in production => 500. Tamper / forge / wrong version / over-length => INVALID_FILTER.
  Amended: the list SQL returns the cursor text of starts_at (UTC, microseconds) so a JS Date never truncates the keyset; MAC
  compared with `timingSafeEqual`; cursor at most 256 chars; key at least 32 chars; a payload whose timestamp or uuid does
  not parse => INVALID_FILTER; the cursor carries no filter (filters are re-sent with every page).
- FE spec cross-check (docs/features/FE/feature_marketplace_discovery.md): whitelist :32 / :484-497 and `public_listing_id`
  :497 agree; `cover_image_url` :169, legacy `skill_level` :542 and host fields have no view column => not served; "30 req/min
  per account" :84 / :553 is the P4.5 global search, not this anonymous surface; edge #6 :72 (stable cursors, per-IP rate
  limit) agrees.

### 4.5 Detail and share (Q7)

- Detail GET `/api/discover/<publicListingId>`: shape `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`
  (case-insensitive) before any DB call, then `SELECT <whitelist columns> FROM public_session_share_v WHERE public_listing_id =
  $1::uuid`; a row => `{ listing }`.
- Share GET `/api/discover/share/<slug>`: shape `^[A-Za-z0-9_-]{22}$` before any DB call (the definer re-checks it,
  0061:447-461), then the one statement of 4.2, so tenant_id and session_id never leave the DB; same `{ listing }`.
- Every miss returns ONE response: `err("NOT_FOUND", t(...SESSION_NOT_FOUND_MESSAGE), 404)` (session-command-route.ts:94,
  api-envelope.ts:36) + `cache-control: no-store`; status, headers and body identical except `meta.requestId`, for: unknown id
  or slug, rotated or revoked slug (the lookup requires `revoked_at IS NULL`; rotate :383, revoke :421), fenced (view
  anti-join), expired (`expires_at > now()` fails), alias rejected or edited (live view filter), tenant suspended or
  cancelled, wrong shape, an id replaced by a fenced recompute (0061:257), and a raw session uuid (F-3).
- SQL lives only in packages/db/src/public-discovery-read.ts (its functions take the readonly pool); routes hold no SQL.
  Never: a redirect, a slug / listing id / IP in any log line, string-built SQL (parameterized only), an HTML body. alias and
  area travel as plain JSON strings (escaping on render is L12's).
- D9 N/A: no L10b route raises a fence or rotates / revokes a slug; rotate / revoke routes are OUT (their session.manage
  check belongs to the lane that adds them).

### 4.6 Join (Q8)

POST `/api/public-listings/<publicListingId>/join`, web process only (discovery 404s it, 4.1). In order, each refusal with
zero writes:

1. `currentSession()` (session-cookies.ts:179) else AUTH_REQUIRED 401; `csrfOk(request, session)` (:328) else CSRF_INVALID 403.
2. `actorThrottled(accountId)` (:111, 60 / 60 s), then `personThrottled(SESSION_JOIN_PERSON_LIMIT, personId)` (:135, :154;
   the bucket its comment :134 reserves) else RATE_LIMITED 429; no tenant bucket (4.3).
3. `readBoundedBody(request, 64 * 1024)` (imported at session-command-route.ts:22) => a JSON object whose `commandId` is a
   non-blank string of at most 200 chars and not `isUnsafeCommandKey` (:202): the rules of :316-343, else INVALID_BODY 400.
   The body names no person, tenant or session: the person is the session cookie's only (L8 3b).
4. Listing id shape (4.5), then `public_listing_resolve($1::uuid)` on the readonly handle (F-1) => (tenant_id, session_id)
   server-side only; no row => the detail route's NOT_FOUND response.
5. `joinSession(appDb().db, { tenantId, personId, sessionId, commandId, allowGuestMembership: true })` revalidates the
   canonical live state under the tenant context (found :227, open and not started :229, public unless an active member :234,
   seated :250, rejoin money :256, join_policy :262, capacity in seatPlayer :280): the resolve grants nothing (DD-73). The
   route reads no base table itself; joinSession's canonical reads run as app under withTenant (HARD RULE 1).
6. Domain errors through `mapSessionCommandError` (:727): L8's codes as mapped (SESSION_NOT_FOUND 404, SESSION_NOT_JOINABLE
   400, REJOIN_REQUIRES_REVIEW 409, ALREADY_JOINED 409, COMMAND_ID_CONFLICT 409, TENANT_SUSPENDED 403); a null mapping
   rethrows (500).
7. `ok({ join: { outcome, waitlistPosition }, replayed })`, key by key, `cache-control: no-store`. Amended from "as is": the
   visitor UI needs only these two; playerId and requestId are tenant-internal row ids with no visitor route in this lane
   (P-12). Never a session uuid, tenant id, player id or request id.

- Replay: L8's command record (tenant + commandId, actorPersonId stored) => the same visitor retrying the same commandId gets
  the stored outcome with `replayed: true`; L8 semantics unchanged.
- A full open session => `waitlisted` (L8 semantics, a success). "Fails closed" = an L8 refusal with zero writes for
  private-again (view row stale until the projector runs: SESSION_NOT_JOINABLE :234) and closed / cancelled / started
  (SESSION_NOT_JOINABLE :229); fenced, expired or alias-rejected listings are unresolvable (NOT_FOUND).
- RD-5 pin: the measured fan-in of resolveSessionCommandContext is HIGH (F-7; GitNexus' LOW is a stale undercount) => the
  route composes the existing exports above and adds NO helper; session-command-route.ts is not edited (4.7).
- RD-4 guard (L8 OPEN 1, F-6, F-8): in joinSession, only when `membership === undefined` (the guest path; the member path
  refuses at :224 first, so its behavior and its tests are unchanged), between :258 and :259, before openJoinRequest and
  mintGuestMembership: a query-builder SELECT of one non-left `players` row of this session joined to a `memberships` row with
  `person_id = personId` and `tenant_id = tenantId`, in the same tx => `fail("ALREADY_JOINED", ...)` (409, mapped :503 /
  :579), zero writes, no id in the body. ALREADY_JOINED over REJOIN_REQUIRES_REVIEW: it states a true fact about the caller's
  own seat, while REJOIN_REQUIRES_REVIEW claims prior payments that may not exist. Impact: GitNexus cannot see joinSession
  (F-7); grep: one production caller, the member route, which never reaches the guard => LOW.
- Language: no runWithLang before a tenant is known => t() default for every visitor response (P-14).

### 4.7 Error codes (Q9)

- api-contract.ts: `"DISCOVERY_RATE_LIMITED"` and `"INVALID_FILTER"` inserted into API_ERROR_CODES in sorted position. No new
  test assertion: err()'s `code: ApiErrorCode` (api-envelope.ts:37) makes a missing code a typecheck failure, and the sorted /
  unique test (api-contract.test.ts:13-19) covers the inserts.
- Emitted only by discovery-route-support.ts with err(): INVALID_FILTER 400 t("Bộ lọc không hợp lệ.", "Invalid filter.");
  DISCOVERY_RATE_LIMITED 429 t("Quá nhiều truy vấn, thử lại sau.", "Too many requests, try again later.") plus
  `retry-after: <seconds to the window reset>` (FE :55 and the :463 countdown; tech doc :125-130). NOT_FOUND, AUTH_REQUIRED,
  CSRF_INVALID, INVALID_BODY and RATE_LIMITED are reused as the existing routes emit them.
- No STATUS_BY_CODE / MESSAGE_BY_CODE rows and no session-command-route.ts edit (amends the lane's "error map" item): the two
  codes are never thrown as domain errors, the maps serve only mapSessionCommandError, and the precedent is measured
  (AUTH_REQUIRED, CSRF_INVALID, INVALID_BODY, NOT_FOUND and RATE_LIMITED are registered with no row, :499-544).

## 5. UNPINNED defaults (Q12): every value is a default applied, pending owner sign-off, repeated in the PR body

- P-1 DD-41 keys only when non-NULL (all NULL today); `level_*` => INVALID_FILTER (4.4); default applied, pending owner sign-off.
- P-2 routes (4.1): GET `/api/discover`, GET `/api/discover/<publicListingId>`, GET `/api/discover/share/<slug>`, POST
  `/api/public-listings/<publicListingId>/join`; no join by slug; default applied, pending owner sign-off.
- P-3 the three GETs on the web and discovery processes, the join on web only (4.1); default applied, pending owner sign-off.
- P-4 request-policy.ts:28 + the three regexes of 4.1; middleware.ts unchanged; default applied, pending owner sign-off.
- P-5 local wiring (4.2): `DISCOVERY_DATABASE_URL` in web and discovery (.env.example: the readonly dev DSN on localhost;
  compose: the same DSN on host postgres), createDb max 5, always-on readonly assert; default applied, pending owner sign-off.
- P-6 discovery limiter (4.3): in-process window `discover:<clientIp>` 60 / 60 s, at most 10 000 keys (full => 429), per
  process and replica (its `ponytail:` ceiling); default applied, pending owner sign-off.
- P-7 join buckets (4.3): actor 60 / 60 s, then session-join 10 / 3600 s per person, both before the resolve; no IP or
  tenant bucket; default applied, pending owner sign-off.
- P-8 page size 20 by default, `limit` 1-50; default applied, pending owner sign-off.
- P-9 the filter set and value rules of 4.4 (sport by shape only, F-9); default applied, pending owner sign-off.
- P-10 ORDER BY starts_at ASC, public_listing_id ASC (MKT-OQ-3) with the keyset of 4.4; default applied, pending owner sign-off.
- P-11 cursor v1 HMAC-SHA256 (4.4); `DISCOVERY_CURSOR_KEY` (>= 32 chars) required in production, a random per-process key
  when unset elsewhere; default applied, pending owner sign-off.
- P-12 join response `{ join: { outcome, waitlistPosition }, replayed }` (RD-8); default applied, pending owner sign-off.
- P-13 `allowGuestMembership: true` on the public join only (4.6 step 5); default applied, pending owner sign-off.
- P-14 visitor responses in t()'s default language (no tenant before the resolve, 4.6); default applied, pending owner sign-off.
- P-15 the RD-4 guard answers ALREADY_JOINED 409 (RD-9, 4.6); default applied, pending owner sign-off.
- P-16 DD-73 split of section 1 (IN: join intent + ban list; OUT: OG card, locale, telemetry); default applied, pending owner sign-off.
- P-17 the two t(vi, en) texts of 4.7 (INVALID_FILTER, DISCOVERY_RATE_LIMITED) + `retry-after`; default applied, pending owner sign-off.
- P-18 no rotate, revoke, visitor-cancel or fence-raising route in this lane (4.5, O-2); default applied, pending owner sign-off.

## 6. Tests and acceptance matrix (Q10, Q11)

- Files: DB = packages/db/src/public-discovery-read.test.ts (NEW); SJ = packages/db/src/session-join-service.test.ts; CU =
  apps/web/lib/discovery-cursor.test.ts (NEW); RP = apps/web/lib/request-policy.test.ts; LR / DR / SR / JR = a NEW
  route.test.ts beside each section 8 route (list, detail, share, join).
- Harness #62 as is (leased password, reader / breaker definer locks, lease after setup, settled teardown, own DB). Rows are
  seeded only through public_sessions_project_session as the owner, mirroring public-sessions-projector.test.ts and its lock,
  never by enabling a projector row; a site taking both definer locks keeps D12's order (jobd shared first, then chad). Web
  tests `vi.mock` @plexco/db (no DATABASE_URL_TEST, no DB lock). Hidden or bidi inputs are written as escapes, never raw.
- A-1 DB: whitelist golden JSON of a seeded row read AS readonly (ctx.readonlyPool); exact key set; DD-41 keys absent when NULL.
- A-2 DB: readonly gets 42501 on public_sessions, sessions and tenants; app gets 42501 on both lookups.
- A-3 DB: every 4.5 miss resolves nothing (unknown, rotated, revoked, fenced, expired, alias rejected, tenant suspended or
  cancelled, an id replaced by a fenced recompute, a raw session uuid).
- A-4 DB: keyset order, equal starts_at tie-break, last page `nextCursor: null`, each accepted filter.
- A-5 LR: list golden JSON `{ items, nextCursor }` in the DD-60 envelope, whitelist assertion, `cache-control: no-store`.
- A-6 LR: INVALID_FILTER 400 for skill, `level_*`, an unknown or repeated param and every bad value of 4.4; no DB call.
- A-7 LR / DR / SR: request 61 within 60 s => DISCOVERY_RATE_LIMITED 429 + `retry-after`; another IP passes; a full Map =>
  429; a readonly assert mismatch => 500.
- A-8 CU: round trip; payload or MAC tamper, forged MAC, wrong version, over 256 chars, unparseable timestamp or uuid =>
  INVALID_FILTER; production without a key of at least 32 chars => 500.
- A-9 DR / SR: a hit returns the whitelist `{ listing }`; every miss returns one 404 (status, headers and body equal after
  dropping meta.requestId); a bad shape makes no DB call.
- A-10 JR: no session 401, CSRF 403, throttled 429, bad body 400, each before the resolve (the resolve is never called).
- A-11 JR: joinSession gets the cookie's personId, the resolved tenantId / sessionId, the body commandId and
  `allowGuestMembership: true`; the body is exactly `{ join: { outcome, waitlistPosition }, replayed }`; no uuid anywhere.
- A-12 JR: an unresolvable listing id returns the same 404 bytes as A-9.
- A-13 SJ: guest path on private-again, closed, cancelled or started => SESSION_NOT_JOINABLE, zero writes; full => waitlisted.
- A-14 SJ: the RD-4 guard, red first: left or merged membership + a non-left players row => ALREADY_JOINED, zero writes;
  the member-path tests unchanged and green.
- A-15 DB: alias rejected or edited => the listing and its slug resolve nothing at once, with no re-projection.
- A-16 RP: discovery allows the three GET shapes and denies `/api/public-listings/<id>/join`, `/api/sessions*`,
  `/api/discover/x/join` and `/api/discover/share/x/y`; web and worker unchanged.
- A-17 LR / DR / SR / JR: a log spy sees no slug, listing id, IP, person id or money beyond price_amount.
- A-18 no new e2e (no UI, L12): the Playwright suite runs unchanged as the regression check.
- Decision table: DT-1 list => A-1, A-4, A-5; DT-2 filter, cursor, rate limit => A-6, A-7, A-8; DT-3 detail and share =>
  A-3, A-9, A-12; DT-4 join => A-10, A-11, A-12, A-13; DT-5 alias rejected or edited => A-3, A-15.
- Lane TESTS: golden + whitelist => A-1, A-5, A-9, A-11; readonly, no base table => A-1, A-2, A-7; uniform 404 => A-3,
  A-9, A-12; join on full / private-again / fenced => A-12, A-13; rate limit => A-7, A-10; cursor tamper => A-8; allowlist =>
  A-16; no PII or money in logs => A-17.

## 7. Implementation steps (dependency order, test-first)

1. GitNexus `impact` on joinSession and the composed exports; on the stale index (F-7) the grep fallback, stated in the PR body.
2. A-14 red, then the RD-4 guard in joinSession (guest path only, 4.6); A-13 pins the existing guest-path refusals.
3. api-contract.ts: DISCOVERY_RATE_LIMITED and INVALID_FILTER in sorted position; typecheck.
4. A-1..A-4 and A-15 red, then public-discovery-read.ts (list keyset, detail, share in one statement, listing resolve; the
   readonly pool as a parameter; parameterized SQL only) and its index.ts export.
5. A-8 red, then discovery-cursor.ts; then discovery-route-support.ts (readonly handle + assert, the limiter and its
   `ponytail:` comment, the whitelist mapper, the NOT_FOUND / INVALID_FILTER / DISCOVERY_RATE_LIMITED responses, no-store).
6. A-5..A-7, A-9 and A-17 red, then the three GET routes; A-10..A-12 red, then the join route composing the exports of 4.6
   (one not exported at the base => STOP and report: an export edit is outside RD-8).
7. A-16 red, then the allowlist (4.1); then the `DISCOVERY_DATABASE_URL` lines in compose and .env.example (4.2).
8. The S1 VERIFY set + the acceptance commands, detect_changes, numstat against section 8, and the PR body with the section 5
   pins and "Codex waived by owner 2026-10-12; reviewed by independent Claude subagent".

## 8. B3 exception (Q13)

- Modules: packages/db, packages/core, apps/web, infra (4, default 3); migrations 0. Files (21), 13 non-test: NEW
  packages/db/src/public-discovery-read.ts, packages/db/src/index.ts, packages/db/src/session-join-service.ts,
  packages/core/src/api-contract.ts, NEW apps/web/app/api/discover/route.ts, NEW
  `apps/web/app/api/discover/[publicListingId]/route.ts`, NEW `apps/web/app/api/discover/share/[slug]/route.ts`, NEW
  `apps/web/app/api/public-listings/[publicListingId]/join/route.ts`, NEW apps/web/lib/discovery-cursor.ts, NEW
  apps/web/lib/discovery-route-support.ts, apps/web/lib/request-policy.ts, infra/docker-compose.yml, .env.example; 8 tests:
  the section 6 files.
- Coherence: one anonymous surface over one view plus its join; a list without the join ships an unjoinable list, the four
  routes share one support module, and the RD-4 guard is reachable only through this join (F-6), so it lands with it.
- Compatibility: no migration, grant, writer, projector or view change; additive exports and codes; the member join path is
  unchanged (A-14); the allowlist widens only the discovery process, by three GET shapes; `DISCOVERY_DATABASE_URL` is new.
- Caps (RD-6; `git diff --numstat` against the base, readiness file excluded): non-test <= 600, test <= 1400, total <= 2000,
  files <= 22, migrations 0. Estimate: non-test ~470, test ~900, total ~1370, files 21.

## 9. OPEN (all OUT_OF_SCOPE for this lane; none blocks it)

- O-1 DD-73 acquisition telemetry, OG card and `?l=` landing locale: L12 or later (telemetry needs storage = a migration).
- O-2 the visitor cancel path (L8 OPEN 4): no cancel route in this lane (P-18).
- O-3 the approve-path duplicate seat (join-request-service.ts:352 mints on approve; L8 OPEN 1): the RD-4 guard covers the
  direct join only; backlog for the join-request lane.
- O-4 the GitNexus index is stale at the base (F-7): re-index is an orchestrator step; until then the grep fallback binds.
- O-5 stale prose: tech doc §4 cache :202-209 (this lane: no cache) and FE :477 `id=session.id` (DD-133 (e): public_listing_id).
- O-6 the limiter ceiling (P-6): upgrade to a readonly-executable limiter definer (an owner migration) or ingress limits.
- Closed: L10 s1 (no rotate / revoke route, P-18; no slug in logs, A-17 and parameterized SQL; alias and area as plain JSON
  strings, 4.5); L8 3b (the cookie's person only, 4.6 step 3, A-11); D9 N/A (no fence-raising route, 4.5).

## 10. Closure matrix (12/12)

| # | Gate | Evidence | Result |
|---|---|---|---|
| 1 | Authority snapshot pinned by SHA | `AUTHORITY_SHA` = lane worktree HEAD = session base 4ece239; every TARGET_FILES path measured to exist at the base (`git ls-files` in the lane worktree); new files are section 8 scope, never TARGET_FILES | PASS |
| 2 | Decisions in scope final | DD-133 (D1) signed (a)-(e), this lane binds (a) and (e) (section 1); DD-73 and DD-83 bound; rulings RD-1..RD-9 applied; P-1..P-18 pinned as defaults pending owner sign-off (section 5) | PASS |
| 3 | Scope IN/OUT and owner clear | lane FILES IN SCOPE plus the section 8 files; lane NEGATIVE SCOPE in OUT_OF_SCOPE; L10b is the only P3-S8 editor of packages/db/src/index.ts and packages/core/src/api-contract.ts | PASS |
| 4 | Dependencies classified | L8 #68, L10a #71 and L10 #72 merged at the base (0061 present); D1 signed; runs without L11; L12 (UI) downstream (section 1) | PASS |
| 5 | Live schema and code match | every lane-block citation re-measured at the base; read-only catalog probe (sections 2-3) | PASS |
| 6 | Data, API, state, auth contract | routes, processes and the discovery allowlist (4.1); readonly wiring (4.2); rate limits and their stated ceiling (4.3); whitelist DTO, filters, signed cursor and uniform 404 (4.4-4.5); join (4.6) | PASS |
| 7 | Fail-closed, idempotency, order | unknown filter value or tampered cursor -> INVALID_FILTER 400; every unresolvable id or slug -> one NOT_FOUND 404 body; keyset ORDER BY starts_at ASC, public_listing_id ASC; resolution server-side only; L8's joinSession revalidates canonical live state and the CTA grants nothing; RD-4 guard (4.4-4.6) | PASS |
| 8 | Open questions in scope = 0 | section 5 pins (value + "default applied, pending owner sign-off"); section 9 OPEN items are out of scope | PASS |
| 9 | Acceptance matrix with expected results | section 6: A-1..A-18 map every lane TESTS item and DT-1..DT-5; steps test-first (section 7) | PASS |
| 10 | Migration, security, rollback | zero migrations; no grant, writer, projector or view change; the view and the two lookups reached as readonly only and no route reads a base table directly (4.2); HARD RULES 1-5 held (sections 3-4); threat model stated and bounded (section 0); no cache; rollback = code revert | PASS |
| 11 | First slice hard dependencies merged | L8, L10a and L10 merged at 4ece239 (#68, #71, #72) | PASS |
| 12 | Implementation handoff ready | sections 4-9; B3 hard caps (section 8); lane worktree clean at the base with deps installed | PASS |

## 11. Verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-10-18
AUTHORITY_SHA: 4ece239852c2ca31513d61c81e418f4bfa556ebf
BASE_BRANCH: main
TARGET_FILES:
  - docs/standards/decisions.md
  - docs/standards/review-code-readiness-gate.md
  - docs/features/FE/feature_marketplace_discovery.md
  - docs/features/BE/feature_marketplace_discovery_tech.md
  - docs/sessions/web-mvp-phase3-readiness-p3-m9-public-projector.md
  - docs/sessions/web-mvp-phase3-readiness-p3-m9-join-core.md
  - packages/db/migrations/0033_public_projection_fences.sql
  - packages/db/migrations/0058_player_self_join.sql
  - packages/db/migrations/0061_public_sessions_projector_writer.sql
  - packages/db/schema.ts
  - packages/db/src/index.ts
  - packages/db/src/client.ts
  - packages/db/src/auth.ts
  - packages/db/src/session-join-service.ts
  - packages/db/src/session-join-service.test.ts
  - packages/db/src/join-request-service.ts
  - packages/db/src/test-harness.ts
  - packages/db/src/public-sessions-projector.test.ts
  - packages/core/src/api-contract.ts
  - packages/core/src/api-contract.test.ts
  - apps/web/middleware.ts
  - apps/web/lib/request-policy.ts
  - apps/web/lib/request-policy.test.ts
  - apps/web/lib/session-command-route.ts
  - apps/web/lib/session-cookies.ts
  - apps/web/lib/api-envelope.ts
  - infra/docker-compose.yml
  - .env.example
SLICE: p3-m9-discovery-read
IN_SCOPE: the anonymous public read surface over the replaced public_session_share_v keyed by public_listing_id, with no migration: NEW packages/db/src/public-discovery-read.ts (the view and the public_listing_resolve and public_share_slug_resolve lookups as the readonly role, 4.2) exported from packages/db/src/index.ts; NEW apps/web/app/api/discover/route.ts (list) and the NEW detail, join and DD-83 share-slug routes at the paths pinned in 4.1; NEW apps/web/lib/discovery-cursor.ts (signed opaque cursor, 4.4); INVALID_FILTER and DISCOVERY_RATE_LIMITED in packages/core/src/api-contract.ts (+ test) and the apps/web/lib/session-command-route.ts error map with t(vi, en) pairs; the discovery rate limit (4.3); the apps/web/lib/request-policy.ts allowlist (+ tests) and apps/web/middleware.ts per 4.1; infra/docker-compose.yml and .env.example placeholders only where the 4.2 wiring needs them; the test files named in section 8
OUT_OF_SCOPE: any migration (else HALT); any writer, projector, view or grant change; UI and render (L12) and the DD-73 parts pinned out of this lane; confirmed_count, slots_max, tenant id, session uuid, venue, roster, money beyond price_amount, gender, host or person name in any response, URL or redirect; any /s/ share path keyed by a session id; any cache; enabling a projector row or the dispatch cycle for real use (owner P0); edits to docs/standards/decisions.md or Reviewed specs; the section 9 OPEN items
G1_DECISION: PASS # DD-133 (D1) signed (a)-(e), this lane binds (a) and (e); DD-73 and DD-83 bound; RD-1..RD-9 applied; P-1..P-18 pinned as defaults pending owner sign-off
G2_SPEC: PASS # marketplace discovery FE spec and BE tech doc measured at the base (sections 2-3); route, DTO, filter, cursor and error contract pinned (section 4)
G3_DEPENDENCY: PASS # L8 #68, L10a #71 and L10 #72 merged at the base (0061 present); runs without L11; L12 downstream
G4_TEST: PASS # A-1..A-18 map every lane TESTS item and DT-1..DT-5; steps test-first (sections 6-7)
G5_SCOPE: PASS # zero migrations; lane FILES IN SCOPE plus the section 8 files under B3 hard caps; NEGATIVE SCOPE held
G6_EXTERNAL: PASS # local only: no external provider, no enablement step, no committed secret (4.2)
HARD_DEPENDENCIES: L8 #68, L10a #71 and L10 #72 merged at 4ece239852c2ca31513d61c81e418f4bfa556ebf (probe 0061_public_sessions_projector_writer.sql); DD-133 (D1) signed (a)-(e)
PRIOR_SLICES: L10 p3-m9-public-projector (#72); L10a p3-m9-public-alias-moderation (#71); L8 p3-m9-join-core (#68)
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS # zero migrations; no grant, writer, projector or view change; the view and both lookups reached as the readonly role only and no route reads public_sessions, sessions or tenants directly (4.2); whitelist DTO only; one uniform NOT_FOUND for every unresolvable id or slug; hash-only slugs resolved server-side; no session uuid or tenant id to the client; join revalidated by L8's joinSession (4.6); no cache; opus/max reviewer + opus/max security round
IMPLEMENTATION_ARTIFACTS: PASS
FIRST_IMPLEMENTATION_STEP: section 7 step 1, in .autopilot/worktrees/p3-m9-discovery-read at 4ece239852c2ca31513d61c81e418f4bfa556ebf (steps in dependency order, test-first)
REMAINING_BLOCKERS: none
```
