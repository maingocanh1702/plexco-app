<!-- review-readiness: code-ready -->

# Step-0 readiness: L12 p3-m9-player-web (session P3-S10)

> Agent-facing contract for the L12 writer and its code reviewer. Readiness reviewer: opus/max, the same model and effort as the lane's
> code reviewer. Writer: sonnet/high. Code reviewer: opus/max, at most 3 rounds; no security round (lane block MODELS: security none).
> DD-122 D4: Codex waived by owner 2026-10-12; review by an independent Claude subagent. Every `path:line` is measured at the base
> `277b366af3a2b215c46aec242f6da945251fb483` (W = the lane worktree; HEAD = base, clean at step 0). TARGET_FILES in section 12 are
> read-only context that exists at the base; the edit set is sections 4 and 8, plus the RC-0b scope addition.
>
> Provenance: part A wrote sections 0-3, 4.1-4.4, P-1 to P-12 and O-1 to O-4; part B wrote 4.5-4.7, P-13 to P-24 and sections 6-10;
> part C wrote this header and its rulings, the reconciliation edits (applied as exact draft line ranges by
> `P3-S10-notes/scripts/l12-c-assemble.sh`), section 9's re-derived caps, O-5, O-6 and sections 11-12.
>
> Deviations, recorded: the lane's step-0 budget of 60 tool calls is overrun (about 54 calls before part C, plus part C's 14); part C
> applied its reconciliation edits inside the assemble script instead of separate Edit calls, to stay within its 14-call cap.
>
> Lane REVIEW PLAN questions, and where each is closed:
> - A DTO field shown that is not whitelisted: 4.2 (complete per-screen allowlists D-1 to D-3, ME-1 to ME-4, H-1; no DTO is spread or
>   dumped), P-8; tests B-12, B-14, B-17.
> - Another person's debt: 4.2 ME-3 (the charges DTO holds only the caller's own rows, F-3), P-7; tests B-13, B-14.
> - A hardcoded value: P-4 (no hardcoded time zone), P-7 and P-10 (amounts only through `formatVnd`, never a made-up 0), every string a
>   t(vi, en) pair; tests B-3, B-9 and the reviewer's grep of the new files.
> - Client-trusted ids: section 0 (d) and 4.3 Identity (the actor is always the session cookie; the only ids sent are route parameters
>   the server re-checks), P-8; tests B-6, B-17.
>
> Rulings. RC-0a to RC-0e are the orchestrator's and bind; RC-1 to RC-8 are part C's reconciliation. A ruling marked "default" is
> applied now, pending owner sign-off, and the PR body repeats it with P-1 to P-24.
> - RC-0a (O-2; default): the leave, cancel and member-join routes take the tenant only from `?tenant=<uuid>` and the /me rows carry only
>   the slug, so L12 ships no leave, cancel or member-join control. DONE WHEN is amended to: the player journey discover -> join -> see it
>   in my sessions -> see my charge passes locally end to end (mocked e2e, B-7), and the extended golden path run is recorded (4.7; a leg
>   that cannot run is marked NOT RUN with its reason). The API gap stays OPEN (O-2), never L12 scope.
> - RC-0b (P-12): `apps/web/components/sessions/session-detail-view.tsx` is a named scope addition: one import and one `items` entry, at
>   most about 10 LOC, nothing else in that file. The URL-only `requests/page.tsx` fallback is rejected: a host page with no entry link is
>   unusable.
> - RC-0c (B2 fact 1, OPEN-B4): nothing in L12 or its golden path enables dispatch or any projector row. Part C spot check: no line under
>   `apps/web/e2e` or `scripts` mentions `public_sessions`; its only test writers are raw `INSERT INTO public_sessions` statements inside
>   db unit tests (`packages/db/src/session-service.test.ts:2270`, `:3812`, `:4296`; `packages/db/src/rls-invariants.test.ts:303`), which a
>   browser run cannot reuse. No merged test-only seed path exists, so the discovery leg is covered by the mocked B-7 test only and is NOT
>   RUN in the golden path. Part B's "member session page via R4/R5" is void: no player screen lives under `/c/**` and no member detail
>   page is built (4.1, O-1).
> - RC-0d (B3): the caps are re-derived in section 9 after O-1, O-2 and P-2: non-test <= 1,700, test <= 1,900, total <= 3,600, files
>   <= 50, `session-detail-view.tsx` <= 10 lines, 0 migrations, no path under `apps/web/app/api` or `packages`; the exception is argued
>   there.
> - RC-0e: B2 fact 4 is moot (no leave control). Fact 6 is measured: `apps/web/lib/session-error-ui.test.ts` exists at the base and holds
>   B-10 and B-11.
> - RC-1 (screens): built are S-1 discovery list (D-1), S-2 listing detail (D-2), S-3 join panel on S-2 (D-3, `join-panel.tsx`), S-4 me
>   hub, S-5 to S-8 my clubs, sessions, charges and requests (ME-1 to ME-4), S-10 host requests tab (H-1). Not built: S-9 (member join /
>   leave panel) and the member session detail (O-1, O-2), the share page (P-2). Part B's S-9 and S-8-cancel tables and rows are removed;
>   E-8 and E-9 are withdrawn, because no L12 screen can receive `LEAVE_REQUIRES_HOST` or `PLAYER_NOT_FOUND`.
> - RC-2 (P-2): the share page stays omitted. DD-133 (a)-(e) scopes the slug to the host share link (`docs/standards/decisions.md:1846`)
>   and requires no L12 page; no share-link producer exists at the base (4.1). L10b's "the human page `/session/<slug>` is L12's"
>   (`docs/sessions/web-mvp-phase3-readiness-p3-m9-discovery-read.md:170`) moves to the lane that adds a producer (O-3).
> - RC-3 (me hub; default): part A's 4.2 governs. `/me` makes no read and renders no DTO key, so it has only ready and offline states;
>   part B's hub cards are removed.
> - RC-4 (golden-path seat; default; a measured correction of RC-0c's mechanism, not of its journey): the host's roster add cannot seat
>   the seeded player persona. Host-add is "by display name (DD-85: no member picker, a name is never resolved to a member)"
>   (`apps/web/components/sessions/roster-add-player-form.tsx:16`; UI copy :109), and the /me reads are account-keyed (F-3). So the owner
>   publishes an open session, and the test itself seats the signed-in player through the merged member join route (tenant and session
>   ids from the host URL; the player's own cookie, CSRF token and one commandId; a test-only call: no UI control, no API change). The
>   player then sees the session on /me/sessions and the charge on /me/charges. A binary pre-check (the player's /me/clubs lists Dev Club;
>   not measured at step 0, O-5) decides run or skip with the NOT RUN reason (4.7, P-22, P-23, B-8). The conductor may overrule.
> - RC-5 (numbering): no id collides (P-1 to P-24, E-1 to E-14, R1 to R10, B-1 to B-18, R-B1, R-B2, O-1 to O-6, OPEN-B1 to OPEN-B9).
>   P-20 is merged into P-11: one command-id rule, and the L12 commands are the public join, approve and reject only.
> - RC-6 (P-17, P-18 against 4.1): consistent with the 4.1 page pattern (thin server page, client view, `apiFetch`). /discover pages
>   never mount MeFrame's `MeGate`, which needs a session (`apps/web/components/me/me-frame.tsx:32-35`): they must render with no session
>   and on the discovery role.
> - RC-7 (error codes): each 4.5.2 table keeps only codes with a measured returning line and ends with the unknown and network
>   fail-closed rows; S-10's generic decide row now points at S-3. Part A's 4.4 also lists `TENANT_SUSPENDED` on decide: it needs no row,
>   because `describePlayerError` maps it to E-13 on every screen.
> - RC-8 (test-only scope): ratified R-B1 `apps/web/e2e/support/golden-path-helpers.ts` (an additive persona sign-in helper) and R-B2
>   `apps/web/e2e/support/player-api-mock.ts` (new), with the new specs `apps/web/e2e/player.spec.ts` and
>   `apps/web/e2e/player-a11y.spec.ts`.

## 0. Threat model

Designed against exactly these four actors, nothing wider:

- (a) **Anonymous visitor** of the `/discover` pages (web or discovery process): sees only the public whitelist keys of the L10b DTO
  (4.2 D-1..D-3). Never a session uuid, tenant id, venue, roster, any money beyond the public `priceAmount`, or any person's data.
- (b) **Signed-in player**: sees only their own clubs, seats, requests and charges through the L9 account-keyed reads (`/api/me/*`); never
  another person's debt, never a venue before their seat is active, never gender or a per-gender price; a double tap sends ONE command id.
- (c) **Host holding `session.manage`**: sees the pending requests of their own session only and decides them only through the merged L8
  routes.
- (d) **Client-supplied ids**: the client sends no trusted id beyond route parameters the server re-checks (path `publicListingId`, path
  session id, path join-request id, and the `?tenant=` query the existing host pages already send). No tenant, person or player id is read
  from client state as authority.

TRUSTED, out of scope: the merged routes' own server-side authorization (L8, L9, L10b); the platform owner.

HALT conditions this contract makes impossible (where each is closed):

1. Bank data, QR, pay-now or another player's debt in any UI -> 4.2 (allowlists are exhaustive; no rendered DTO carries such a field), P-7.
2. A venue shown to a waitlisted or pending user -> 4.2 (venue keys rendered only from the L9 seat read, which the definer nulls unless
   the seat is active; never from any other source), P-6.
3. Gender or a per-gender price anywhere -> 4.2 (no gender key rendered; `genderRestriction` omitted), P-5.
4. Any API, DB or migration change -> 4.1 (every route the UI calls is merged at the base; gaps go to OPEN), negative scope.
5. A page keyed by a session uuid -> 4.1 (public pages keyed by `publicListingId` or share slug only; the FE spec's `/discover/:sessionId`
   is forbidden), P-1.

## 1. Base, dependencies, authority (QA1)

- W HEAD = origin/main = `277b366af3a2b215c46aec242f6da945251fb483` (merge of PR #76 `feat/p3-m9-gender-pricing`); branch
  `feat/p3-m9-player-web`; `git status --porcelain` empty at step 0.
- Dependencies merged at the base (route files present, read in 4.x): L8 join core (#68): `apps/web/app/api/sessions/[id]/join/route.ts`,
  `.../leave/route.ts`, `.../join-requests/route.ts`, `apps/web/app/api/join-requests/[id]/{approve,reject}/route.ts`; L9 me reads (#70):
  `apps/web/app/api/me/{clubs,sessions,charges,requests}/route.ts`; L10b public discovery (#74): `apps/web/app/api/discover/route.ts`,
  `.../discover/[publicListingId]/route.ts`, `.../discover/share/[slug]/route.ts`, `apps/web/app/api/public-listings/[publicListingId]/join/route.ts`.
  L11 (#76) merged with `GENDER_COLLECTION_ENABLED` off unless exactly `"true"` (`apps/web/app/api/me/profile/route.ts:32`).
- **D3 = DD-135 SIGNED** (`docs/standards/decisions.md:122` row, `:1790` heading "✅ Quyết định owner 2026-10-16"). What it binds in L12:
  join by signed-in account; open + seat free => active + charge created at once (DD-39 price; free session => 0đ charge `paid`); full =>
  waitlisted, no charge until promoted (`:1797-1798`); approval sessions => `join_requests` pending, host approves or rejects (`:1798`);
  self-leave only while the session is open and before start AND net recorded money = 0, else refused with a code telling the player to ask
  the host (`:1798-1800`); FIFO auto-promotion (`:1800`); hold, QR, pay-now, provider webhooks and settlement finalizer are OUT of MVP
  (`:1801`); L12 is the money-DISPLAY lane only (`:1803`).
- **D1 = DD-133 SIGNED (a)-(e)** (`:124` row, `:1837` heading, signature `:1859` "Phase 3 plan approved. D1 signed (a)-(e)."), so the
  discovery pages stay in L12 (the declined branch `:1853` does not apply). Binding: public rows carry a random opaque 128-bit
  `public_listing_id`, rotated whenever the session leaves public; the hash-only slug (DD-83/DD-75) serves ONLY the host share link
  (`:1846`); the view exposes no `session_id` (`:1847`); the public DTO carries only `slots_open` for occupancy (`:1845`).
- **DD-118** (`:2294`): authenticated surfaces resolve language from `tenants.locale` only (`:2296`), never `Accept-Language` (`:2300`);
  unresolvable => `vi` (`:2301`). The public share surface takes its locale from the link itself (`:2300`).
- **DD-83** (`:1178`): session share URL = opaque slug `/session/<slug>` (`:1180`); the 4-type scheme `/user|/club|/session|/tournament`
  and "every public URL reads only a guarded view, never `tenant_id`/PII" (`:1185`).
- **OD-4b**: one web VND formatter `apps/web/lib/money.ts` (program fact; decisions anchor in 4.x, section 3).
- **L10b pins** (`W/docs/sessions/web-mvp-phase3-readiness-p3-m9-discovery-read.md`): routes `:169-172` ("the human page `/session/<slug>`
  is L12's and reads the same db function" `:170`; join "web process only: needs the session cookie, CSRF and `app`" `:171`; join by slug
  OUT `:172`); allowlist `:173-175`; every response `no-store`, no redirect anywhere `:176`; join response
  `{ join: { outcome, waitlistPosition }, replayed }` with no player, request, session or tenant id `:164`; DTO keys `:199-201`; detail and
  share shape checks `:222-226`; every miss = ONE identical NOT_FOUND `:227-230`.
- FE design specs `docs/channels/web/FE/feature_player_view_fe.md` (458 lines) and `feature_marketplace_fe.md` (428 lines) are REFERENCE
  INPUT ONLY: a field without an owner DTO is omitted ("UNPINNED - omit active UI"); the marketplace spec's `/discover/:sessionId`
  (`feature_marketplace_fe.md:171`) is forbidden.

## 2. Lane-block and pre-measure citations re-measured at the base (QA2)

The L12 lane block cites paths only (no `file:line`); the task-line and pre-measure citations used here are re-measured below.

| Claim (source) | Measured at the base |
|---|---|
| base = origin/main `277b366…` (task line) | `git -C W rev-parse HEAD origin/main` => both `277b366af3a2b215c46aec242f6da945251fb483`; porcelain empty |
| `apps/web/app/me/layout.tsx` exists, 16 lines, auth boundary `:13-14` (lane block, task line) | yes, 16 lines: `currentSession()` :13, `redirect("/")` :14, `<MeFrame>{children}</MeFrame>` :15; comment :6-11 ("Lane M4 owns this file", wraps /me/settings and /me/link) |
| discovery allowlist `request-policy.ts:31-36` (task line) | array :31-37: `/^\/healthz$/` :32, `/^\/discover(\/\|$)/` :33, `/^\/api\/discover$/` :34, `/^\/api\/discover\/[^/]+$/` :35, `/^\/api\/discover\/share\/[^/]+$/` :36; discovery role serves GET/HEAD only `requestAllowedForRole` :55-62 |
| `app/c/[tenantId]/layout.tsx:1-31` gating (task line) | 31 lines: the server proves only "signed in" (:11-12, :22-29; resolve error fails closed to `/` :25-28); tenant membership is decided client-side by `AppShell` from `/api/auth/session` (:12, :30) |
| decisions rows `:122` DD-135, `:124` DD-133; details `:1790`, `:1837`, `:2294`, `:1178` (task line, docs pre-measure) | all four headings at those lines; DD-133 signature :1859, section ends :1861; DD-117 starts :2307 |
| L10b pins `discovery-read.md:160-230` (task line) | as cited in section 1 |
| FILES IN SCOPE (lane block) | NEW: `apps/web/app/discover/` (dir absent), `app/me/page.tsx`, `app/me/{clubs,sessions,charges,requests}/page.tsx`, `components/discover/`, `components/player/`, `components/sessions/join-panel.tsx`, `components/sessions/request-inbox.tsx`, `lib/discover-api.ts`, `lib/me-player-api.ts`. EXISTS: `app/me/layout.tsx` 16, `lib/money.ts` 46, `lib/money-single-formatter-guard.test.ts` 360, `lib/session-error-ui.ts` 223, `e2e/a11y.spec.ts` 47, `e2e/golden-path.spec.ts` 245, `e2e/golden-path.config.ts` 42, `docs/runbooks/local-mvp-smoke.md` 198. `apps/web/app/c/[tenantId]/sessions/[id]/` holds only `edit/` and `page.tsx` (10 lines): the requests tab directory is NEW |
| `toDiscoveryListingDto` `discovery-route-support.ts:227-262` (task line) | optional-key table :227-237, mapper :240-259; `:262` is `discoveryNotFound` (:262-264), not the mapper |
| detail `{ listing }` `serveDiscoveryListing` :277-297 (task line) | doc :275-279, function :280-295 (limiter :287-288, shape check :289, `{ listing }` :291, empty 500 :292-294) |
| public join response `join/route.ts:92-95`, handler :35-100 (task line) | response :92-95; handler :35-102 (102 lines) |
| `me-player-reads.ts:22-105` types (task line) | types :22-88 (MyClub :22-26, MySession :28-43, MyJoinRequest :45-56, MyChargeItem :58-65, SelfPaymentStatus :75-76, SelfPaymentSummary :77, MyClubCharges :79-83, MyCharges :85-88); `toDto` :96-104, `capped` :106-109; functions :114, :124, :136, :207 |
| `listPendingJoinRequests` `join-request-service.ts:428` to end (task line) | :428-477, last line of the file |
| last migration (L11 "migration 0062", task line) | `0059_me_player_reads_definers.sql`, `0060_tenant_public_alias.sql`, `0061_public_sessions_projector_writer.sql`, `0062_gender_pricing.sql`; `account_my_sessions` is defined only in 0059 (no later redefinition) |

## 3. Measured facts the contract rests on (part A)

- **F-1 discovery DTO.** One mapper builds every public item key by key: `publicListingId`, `sportKey`, `startsAt`, `endsAt`, `area`,
  `priceAmount`, `slotsOpen`, `clubDisplayName`, `joinPolicy` (`apps/web/lib/discovery-route-support.ts:244-252`), plus `title`,
  `sessionType`, `levelMinRank`, `levelMaxRank`, `levelStrict`, `genderRestriction`, `ageMin`, `ageMax` only when non-NULL (:228-237,
  :254-257; all NULL today per the L10b readiness P-1). List = `{ items, nextCursor }` (`apps/web/app/api/discover/route.ts:27-30`); detail
  and share = `{ listing }` (`discovery-route-support.ts:291`; `api/discover/[publicListingId]/route.ts:11`, `api/discover/share/[slug]/route.ts:16-21`).
  Share slug shape `^[A-Za-z0-9_-]{22}$` (`share/[slug]/route.ts:5`). Every miss = `discoveryNotFound()` NOT_FOUND 404 (:262-264); any failure
  = empty 500 (:271-273, :292-294); rate limit before the shape check (:287-289).
- **F-2 public join.** `POST /api/public-listings/[publicListingId]/join`: session required (AUTH_REQUIRED 401 `:40`), CSRF (`csrfOk`,
  CSRF_INVALID 403 `:41-42`), actor + per-person throttles (RATE_LIMITED 429 `:44-49`), body = `{ commandId }` ONLY (`:68`; 1-200 chars, not
  blank, not unsafe `:69-76`, else INVALID_BODY 400/413 `:53-76`); the person is the cookie's (`:87`), the listing resolves server-side to
  (tenant, session) (`:80-81`, miss = the one NOT_FOUND); `joinSession(..., allowGuestMembership: true)` (`:85-91`); response
  `{ join: { outcome, waitlistPosition }, replayed }` (`:92-95`); domain errors through `mapSessionCommandError` (`:97-98`). Outcome union
  `"active" | "waitlisted" | "requested"` (`packages/core/src/api-contract.ts:193`).
- **F-3 me reads (account-keyed, no id from the client).** `MyClub {clubRef, clubLabel, membershipStatus}` (`packages/db/src/me-player-reads.ts:22-26`);
  `MySession {sessionId, clubRef, clubLabel, sportKey, startsAt, endsAt, timezone, area, myStatus: active|waitlisted|pending,
  waitlistPosition, venueName, venueAddress}` (:28-43); `MyJoinRequest {requestId, sessionId, clubRef, clubLabel, startsAt, area,
  status: pending|approved|rejected, createdAt, decidedAt, expiresAt}` (:45-56); `MyCharges {clubs: [{clubRef, clubLabel, status}], summary}`
  (:79-88) with `SelfPaymentStatus` = `known_zero {currency "VND", asOf}` | `known_amount {currency, totalOutstanding, asOf, chargeCount,
  items}` | `unknown {reasonCode LEDGER_INCONSISTENT|TOO_MANY_OPEN_CHARGES|READ_FAILED, retryable}` (:67-76) and `SelfPaymentSummary`
  the same with `clubCount` (:77); `MyChargeItem {sessionRef, startsAt, amountDue, amountAllocated, remaining, status: open|partial}`
  (:58-65). Rows are mapped snake->camel, adding and dropping nothing (:96-104); lists capped (`capped` :106-109; SESSIONS_CAP 50,
  REQUESTS_CAP 50, OPEN_CHARGES_CAP 200 :18-20). `clubRef` is the tenant SLUG, not the tenant id (`account_my_clubs` selects `t.slug`,
  `0059_me_player_reads_definers.sql:69`).
- **F-4 venue is DB-gated.** `account_my_sessions` (0059:81-149): own seats `pl.status IN ('active','waitlisted')` on open, not-ended sessions
  (:119-120) with `CASE WHEN pl.status = 'active' THEN s.venue_name/venue_address END` (:111-112; comment :107 "the venue never leaves the
  database for a caller who is not active"); own pending requests on open, not-ended sessions (:130-131); `REVOKE ALL ... FROM PUBLIC` :148,
  `GRANT EXECUTE ... TO app` :149. The DTO comment restates it (`me-player-reads.ts:40`).
- **F-5 the host session read is session.manage-only.** `GET /api/sessions/[id]` (`apps/web/app/api/sessions/[id]/route.ts:54-69`) runs through
  `handleSessionRead` (:58), whose authority is `authorize(session.manage)` (`apps/web/lib/session-read-route.ts:17`) with ONE indistinguishable
  FORBIDDEN 403 for non-member / foreign tenant / no capability (:44, :61). A plain member therefore gets 403 from the host detail read:
  there is NO member-facing session detail read at the base (OPEN O-1).
- **F-6 host pending list.** `GET /api/sessions/[id]/join-requests` (48 lines): read gate requires `session.manage` in `?tenant=` (`route.ts:12`),
  actor = cookie person (:27-28, :33); DTO `PendingJoinRequestDto {requestId, displayName, createdAt}` built key by key (:36-40;
  `api-contract.ts:183-187`); the service re-checks `session.manage` (`join-request-service.ts:435-436`), returns only `pending`, unexpired
  requests of that session (:463-468) ordered by `createdAt, id` (:470); `displayName` = the requester's active|guest membership display
  name, NULL when there is none (left join :451, :455-461; type :74).

## 4. Contract

### 4.1 Page and route map (QA3)

Pattern kept (measured): a page is a thin server component that passes only its route params to one client view
(`apps/web/app/c/[tenantId]/sessions/[id]/page.tsx:1-10`), and the view loads its data from `/api` with `apiFetch` (`apps/web/lib/api-client.ts:55`);
under `/c/**` only after the client-side proof (`apps/web/app/c/[tenantId]/layout.tsx:8-9`). No L12 page reads the DB or calls a domain service.
Process column: `both` = served by the web and the discovery role (allowlist `apps/web/lib/request-policy.ts:31-37`; the web role serves every
path, :45-48); `web` = refused on the discovery role (edge gate :51-60: GET or HEAD on an allowlisted path only; :15 "the join POST and every
/api/sessions path stay web-only"). Page and component paths in the table are under `apps/web/`.

| Screen | Page (NEW) | Client view | Merged route it reads / posts | Who sees it | Process |
|---|---|---|---|---|---|
| Discovery list | `app/discover/page.tsx` = `/discover` | `components/discover/*` | GET `/api/discover`, filters and cursor exactly as the route accepts them; `{ items, nextCursor }` (F-1) | anyone, no session needed | both (:33, :34) |
| Listing detail | `app/discover/[publicListingId]/page.tsx` = `/discover/<publicListingId>` (P-1) | `components/discover/*` + `components/sessions/join-panel.tsx` | GET `/api/discover/<publicListingId>` = `{ listing }` (F-1); join panel: GET `/api/auth/session`, then POST `/api/public-listings/<publicListingId>/join` (F-2, 4.3) | anyone; the POST only a signed-in account on the web role (P-3) | page both (:33, :35); session read and POST web |
| Share page | not built (P-2, O-3) | - | (GET `/api/discover/share/<slug>` is merged: F-1, :36) | - | - |
| Me hub | `app/me/page.tsx` = `/me` | links to the four lists, no read | none | a signed-in account (`app/me/layout.tsx:13-14`, else redirect to `/`) | web |
| My clubs | `app/me/clubs/page.tsx` | `components/player/*` | GET `/api/me/clubs`; service shape `{ clubs, truncated }` (`packages/db/src/me-player-reads.ts:117`, `:120`) | own account only (F-3) | web |
| My sessions | `app/me/sessions/page.tsx` | `components/player/*` | GET `/api/me/sessions`; `{ sessions, truncated }` (:127, :132): seat state, waitlist position, venue only when active (F-4); no leave control (O-2) | own account only | web |
| My charges | `app/me/charges/page.tsx` | `components/player/*` | GET `/api/me/charges` (F-3) | own account only | web |
| My requests | `app/me/requests/page.tsx` | `components/player/*` | GET `/api/me/requests`; `{ requests, truncated }` (:139); no cancel control (O-2) | own account only | web |
| Member session detail | not built (O-1) | - | - | - | - |
| Host requests tab | under `app/c/[tenantId]/sessions/[id]/` (placement: 4.4) | `components/sessions/request-inbox.tsx` | GET `/api/sessions/<id>/join-requests?tenant=` (F-6); POST `/api/join-requests/<requestId>/approve` and `/reject` with `?tenant=` (4.3) | session.manage in the route tenant (F-6; `approve/route.ts:10-11`) | web |

- **No session uuid in any L12 URL (P-1).** The detail page is keyed by `publicListingId` only; it passes the raw param and the API owns the
  shape check (a bad or unknown id is the one NOT_FOUND: F-1, F-2). The `/me/sessions` card links to no per-session page. The `/me` hub holds
  the navigation: MeFrame (`apps/web/components/me/me-frame`, imported at `apps/web/app/me/layout.tsx:3`, owned by lane M4 per :9-10) is not
  edited, and `apps/web/app/me/layout.tsx` stays unchanged.
- **Settled: AppShell gating of a plain member.** The `/c/**` layout proves only "signed in" (`apps/web/app/c/[tenantId]/layout.tsx:11-12`;
  redirect to `/` :29) and renders AppShell (:30). AppShell admits a tenant only when it is in the `tenants` of GET `/api/auth/session`
  (`apps/web/components/shell/app-shell.tsx:18-20`, `:70-71`), and that list is "my web-admin tenants" (`apps/web/app/api/auth/session/route.ts:9`,
  built by `tenantsForPersonWithProfile` :22; `packages/db/src/auth.ts:273` reads `tenant_ids_for_person`, tenant_admins only per the L9
  readiness, 0037:64). A plain or guest member therefore gets the ONE 403 state on every `/c/<tenantId>/...` page, and even past it the only
  session read there is host-only (F-5). So no L12 player screen lives under `/c/**`: the member's seat view is the `/me/sessions` card, and the
  only L12 surface under `/c/**` is the host requests tab.
- **Settled: leave and cancel from `/me`.** Leave (POST `/api/sessions/<id>/leave`) and cancel (DELETE `/api/join-requests/<id>`) take the
  tenant ONLY from `?tenant=<uuid>` (`apps/web/app/api/sessions/[id]/leave/route.ts:15-16`, `:44`; `apps/web/app/api/join-requests/[id]/route.ts:13-15`,
  `:44`; `apps/web/lib/session-command-route.ts:100`, `:106`, `:162`), and L8 forbids resolving it from a session id
  (`docs/sessions/web-mvp-phase3-readiness-p3-m9-join-core.md:12`). The L9 rows carry `clubRef` = the tenant SLUG and no tenant id
  (`me-player-reads.ts:128-130`; `0059_me_player_reads_definers.sql:124`; F-3), and `/api/auth/session` lists web-admin tenants only (above).
  So the web holds no tenant uuid for a member's seat or request: L12 renders no leave and no cancel control (UNPINNED - omit active UI; P-3),
  API gap O-2. The member join POST `/api/sessions/<id>/join` has the same `?tenant=` gate (`apps/web/app/api/sessions/[id]/join/route.ts:15-17`,
  `:52`); with O-1, L12 never calls it.
- **Settled: the join button on the discovery role (P-3).** The join panel reads the session with the existing hook
  (`apps/web/lib/use-session.tsx:20` "AUTH_REQUIRED means signed out", `:26`). Signed in => the join button, CSRF from the session's `csrfToken`
  (`apps/web/app/api/auth/session/route.ts:33`). AUTH_REQUIRED 401 (:19) => a sign-in prompt t("Đăng nhập để tham gia.", "Sign in to join.")
  linking to the landing page `/` (the target of `app/me/layout.tsx:14` and `c/[tenantId]/layout.tsx:29`; no return-to, as `app/me/layout.tsx:8`
  records), no POST. Status 404 => no button and a note t("Tham gia trên ứng dụng web Plexco.", "Join on the Plexco web app."), no link, no
  POST: that is the discovery role, where neither `/api/auth/session` nor the POST is allowlisted (`request-policy.ts:31-37`, :51-60, :15; the
  edge refusal is the 404 of the L10b readiness `docs/sessions/web-mvp-phase3-readiness-p3-m9-discovery-read.md:171`, `:175`, per part A). Any
  other failure (network, 5xx, bad envelope) => no button and the screen's retryable error state (part B); never a POST without a session.
- **Share page (P-2): omitted.** No share-link producer exists at the base: in `apps/web/components` and `apps/web/lib` a `share` + `slug` grep
  hits only comments and tests (`session-command-route.ts:134`, `request-policy.ts:15`, `session-command-route.test.ts:518`,
  `tenant-lang.test.ts:274-275`), and no non-test file under `apps/bot/src`, `packages/core/src` or `packages/db/src` contains `discover/share`
  or `/session/`. The L10b `/session/<slug>` page (DD-83) cannot be served on the discovery role (`request-policy.ts:31-37`), and
  `request-policy.ts` is outside L12. Settled (RC-2): DD-133 (a)-(e) does not require a share page in L12 (it scopes the slug to the host
  share link, `docs/standards/decisions.md:1846`), so P-2 stands; L10b's "the human page `/session/<slug>` is L12's"
  (`docs/sessions/web-mvp-phase3-readiness-p3-m9-discovery-read.md:170`) moves to the lane that adds a share-link producer (O-3).

### 4.2 DTO field allowlists per screen (QA4)

Each table is the COMPLETE set of keys its screen may show; every key not listed is never rendered (no spread or dump of a DTO). "Used, not
rendered" keys may drive a link, a request path, a cursor, a state or a React key, never visible text (P-8). Sources: section 3 and the merged
route code only; a field that only the FE reference specs show is omitted (UNPINNED - omit active UI). Every amount goes through `formatVnd`
(P-7); every time follows P-4. The four `/api/me/*` routes read the account only from the verified session (`resolveMeGate`:
`apps/web/app/api/me/clubs/route.ts:14-17`, `me/sessions/route.ts:14-17`, `me/charges/route.ts:14-17`, `me/requests/route.ts:13-16`), pass the
service result through `ok()` unchanged (:20, :20, :20, :19) and answer a fault with an empty 500 (:23, :23, :23, :22); a charges read failure
is a 200 `unknown READ_FAILED`, never 0 (`me/charges/route.ts:9-11`).

**D-1 Discovery list** (`/discover`; GET `/api/discover` = `{ items, nextCursor }`, one mapper for every item: F-1)

| Key | Rendered as | Rule |
|---|---|---|
| `title` | card heading | only when present; absent => the `sportKey` label is the heading (P-4) |
| `sportKey` | sport label, t(vi, en) | an unknown key => t("Buổi chơi", "Session") |
| `startsAt`, `endsAt` | date and time range | P-4 (the DTO has no `timezone`: O-4) |
| `area` | area line | the only place shown: the DTO has no venue key (F-1, P-6) |
| `priceAmount` | price via `formatVnd` | a number only, else no price line (P-7, P-10) |
| `slotsOpen` | open-slot count | a number only, else no count (P-10) |
| `clubDisplayName` | club name | plain text |
| `joinPolicy` | t(vi, en) hint: instant join or host approval | only for a value of its declared type, else no hint (P-10) |

Used, not rendered: `publicListingId` (the card link `/discover/<publicListingId>`, P-1), `nextCursor` (the next-page request only).
Never rendered: `sessionType`, `levelMinRank`, `levelMaxRank`, `levelStrict`, `ageMin`, `ageMax` (P-4) and `genderRestriction` (P-5).

**D-2 Listing detail** (`/discover/<publicListingId>`; GET `/api/discover/<publicListingId>` = `{ listing }`, the same mapper: F-1)

| Key | Rendered as | Rule |
|---|---|---|
| `title`, `sportKey`, `startsAt`, `endsAt`, `area`, `priceAmount`, `slotsOpen`, `clubDisplayName`, `joinPolicy` of `listing` | as in D-1 | the D-1 rules |

Used, not rendered: `publicListingId` (the join POST path, F-2). Never rendered: the D-1 never-rendered keys. The only other content is the
join panel (D-3).

**D-3 Join panel** (inside D-2, `components/sessions/join-panel.tsx`; control rule P-3, command 4.3)

| Source | Key | Rendered as | Rule |
|---|---|---|---|
| `useSession()` (`apps/web/lib/use-session.tsx:7-11`, `:21-44`) | `status` | which control shows | `ready` => join button; `signed-out` (AUTH_REQUIRED, :29-30) => sign-in prompt; `error` (:31-34) => by `error.status` (P-3); `loading` => busy |
| public join `data` (F-2) | `join.outcome` | t(vi, en) result: seat active, waitlisted or request sent | `active`, `waitlisted` or `requested` (`packages/core/src/api-contract.ts:193`); any other value => no result text, only the `/me/sessions` link |
| public join `data` | `join.waitlistPosition` | "#n" | only with `waitlisted` and a number |

Used, not rendered: `session.csrfToken` (the POST's `x-csrf-token` header only, 4.3), `error.status` (selects the P-3 branch), `replayed` (a replay
renders like the first result, 4.3). Never rendered: every other key of the session DTO (`apps/web/lib/session-dto.ts:1`), including `account` and
`tenants` (`apps/web/app/api/auth/session/route.ts:22-28`), so the panel shows no name, club or tenant; no venue and no amount (the response has neither).

**Me hub** (`/me`): renders no DTO key; links to `/me/clubs`, `/me/sessions`, `/me/charges` and `/me/requests` only (P-1).

**ME-1 My clubs** (`/me/clubs`; GET `/api/me/clubs` = `{ clubs, truncated }`, `packages/db/src/me-player-reads.ts:117`, `:120`; `MyClub`: F-3)

| Key | Rendered as | Rule |
|---|---|---|
| `clubLabel` | club name | plain text, no link (4.1: no player screen under `/c/**`) |
| `membershipStatus` | t(vi, en) membership label | one label per value of `MyClub.membershipStatus` (:22-26); any other value => no label |
| `truncated` | t(vi, en) "not all shown" note | only when `true`; no number (the cap is the service's, F-3) |

Used, not rendered: `clubRef` (React key only; it is the tenant slug: F-3, P-8).

**ME-2 My sessions** (`/me/sessions`; GET `/api/me/sessions` = `{ sessions, truncated }`, :127, :132; `MySession`: F-3, F-4)

| Key | Rendered as | Rule |
|---|---|---|
| `clubLabel` | club name | plain text |
| `sportKey` | sport label | as in D-1 |
| `startsAt`, `endsAt` | date and time range | in the row's `timezone` (P-4) |
| `area` | area line | every status (the area is not the venue) |
| `myStatus` | t(vi, en) seat label: active, waitlisted or pending | any other value => no label and no venue |
| `waitlistPosition` | "#n" | only with `waitlisted` and a number |
| `venueName`, `venueAddress` | venue lines | only with `myStatus === "active"` and a non-null value (P-6; the definer nulls them otherwise: F-4) |
| `truncated` | t(vi, en) "not all shown" note | only when `true` |

Used, not rendered: `sessionId` (React key only: no per-session link, P-1), `clubRef` (P-8), `timezone` (formats the two times, P-4). No leave
control (O-2, P-3).

**ME-3 My charges** (`/me/charges`; GET `/api/me/charges` = `MyCharges { clubs, summary }`, F-3 :79-88; status variants `known_zero`,
`known_amount` and `unknown`, :67-77)

| Key | Rendered as | Rule |
|---|---|---|
| `summary` variant | the page total state | `known_zero` => the nothing-owed state; `known_amount` => the total; `unknown` => the unavailable state (P-7) |
| `summary.totalOutstanding` | total via `formatVnd` | `known_amount` with `currency === "VND"` and a number only, else the unavailable state (P-7) |
| `chargeCount` (summary and club), `summary.clubCount` | counts | numbers only |
| `asOf` (summary and club) | "as of" time | P-4 |
| `retryable` (summary and club) | a retry button | `unknown` only, when `true` |
| `clubs[].clubLabel` | club heading | plain text |
| `clubs[].status` variant | the club state | the same three cases as `summary` |
| `clubs[].status.totalOutstanding` | club total via `formatVnd` | as `summary.totalOutstanding` |
| `items[].startsAt` (club `known_amount` only) | session date and time | P-4 (no `timezone` key: O-4) |
| `items[].amountDue`, `items[].amountAllocated`, `items[].remaining` | three amounts via `formatVnd` | numbers only, else the club's unavailable state |
| `items[].status` | t(vi, en) label: open or partial | any other value => no label |

Used, not rendered: `clubs[].clubRef` and `items[].sessionRef` (React keys, P-8), `currency` (gates `formatVnd`), `reasonCode` (selects part B's
unavailable copy, never shown raw). Items render only under their club, never from `summary`. The DTO holds only the signed-in player's own
charges (F-3), so no other person's debt can appear; no pay-now, QR, bank or pay CTA (P-7).

**ME-4 My requests** (`/me/requests`; GET `/api/me/requests` = `{ requests, truncated }`, :139; `MyJoinRequest`: F-3)

| Key | Rendered as | Rule |
|---|---|---|
| `clubLabel` | club name | plain text |
| `startsAt` | session date and time | P-4 (no `timezone` key: O-4) |
| `area` | area line | the type has no venue key (F-3) |
| `status` | t(vi, en) label: pending, approved or rejected | any other value => no label |
| `createdAt` | "requested on" | P-4 |
| `decidedAt` | "decided on" | only when non-null |
| `expiresAt` | "expires on" | only with `pending` and a non-null value |
| `truncated` | t(vi, en) "not all shown" note | only when `true` |

Used, not rendered: `requestId`, `sessionId` and `clubRef` (React keys, P-8). No cancel control (O-2, P-3).

**H-1 Host requests tab** (placement 4.4; GET `/api/sessions/<id>/join-requests?tenant=`, `PendingJoinRequestDto`: F-6; decisions 4.3)

| Key | Rendered as | Rule |
|---|---|---|
| `displayName` | requester name | null => the P-9 label; no other source |
| `createdAt` | "requested at" | P-4 |
| approve `request.outcome` | result line: seat active or waitlisted | `apps/web/app/api/join-requests/[id]/approve/route.ts:35-44` |
| approve `request.waitlistPosition` | "#n" | only with `waitlisted` and a number |
| reject `request.status` | result line: rejected | `apps/web/app/api/join-requests/[id]/reject/route.ts:34-37` |

Used, not rendered: `requestId` (the decision path and the React key), `request.id`, approve `request.status` and `request.playerId`, and
`replayed` (P-8, 4.3). No amount: neither the list nor a decision response carries one (F-6, 4.3).

### 4.3 Commands and command ids (QA5)

How the web sends a command today (measured):
- `apiFetch` (`apps/web/lib/api-client.ts:55-100`): JSON body (:59, :68); `x-csrf-token` on every non-GET when a `csrfToken` is passed
  (:44-45, :60); `credentials: "same-origin"` and `cache: "no-store"` (:69-70). A network failure throws `CLIENT_NETWORK_ERROR` with status 0
  (:38, :72-73); an error envelope throws `ApiClientError` with the envelope's code, message, status and requestId (:82-93); a non-ok response,
  no envelope or no `data` throws `CLIENT_BAD_RESPONSE` with the HTTP status (:39, :95-100).
- CSRF: the `csrfToken` of GET `/api/auth/session` (`apps/web/app/api/auth/session/route.ts:33`). The player side reads it with `use-session.tsx`
  (:20, :26); the host side has it in `SessionApiContext` ("which tenant, and the CSRF secret for writes", `apps/web/lib/sessions-api.ts:113-115`),
  which the host detail already passes to its tabs (`apps/web/components/sessions/session-detail-view.tsx:219`). The tenant query is
  `tenantQuery(tenantId)` (`sessions-api.ts:136`), appended as `?${tenantQuery(ctx.tenantId)}` (:174).
- commandId: "the CALLER generates it once per attempt and reuses it on retry" (`sessions-api.ts:184`). The existing pattern is a ref with
  `commandId.current ??= crypto.randomUUID()` when the action starts, the same id on a retry, cleared after success or when
  `isDefiniteFailure(error)` (`session-detail-view.tsx:44`, `:150`, `:155`, `:161`, `:164`; `new-session-view.tsx:17`, `:23`, `:48`, `:56`;
  `visibility-toggle.tsx:30`, `:47`, `:115`, `:124`). Shared hooks: `useCommandId()` (`apps/web/lib/use-command-id.ts:58`) and
  `useRosterCommand(onAbandon)` (`apps/web/lib/use-roster-command.ts:22`), whose `cmd.run((commandId) => ...)` and `cmd.busy` drive `disabled`
  and `aria-busy` (`roster-add-player-form.tsx:46`, `:58-59`, `:133`). `isDefiniteFailure` is `apps/web/lib/session-error-ui.ts:202` (in scope).
- No web client exists yet for the public join or the join-request routes (probe C: zero hits in `apps/web/lib` and `apps/web/components`).

| Command | Merged route | Body | Tenant | `data` on success | L12 caller |
|---|---|---|---|---|---|
| Public join | POST `/api/public-listings/<publicListingId>/join` | `{ commandId }` only (F-2) | none: the listing resolves to (tenant, session) server-side (F-2) | `{ join: { outcome, waitlistPosition }, replayed }` (F-2, :92-95) | `join-panel.tsx` |
| Approve | POST `/api/join-requests/<requestId>/approve?tenant=` | `{ commandId }` (`apps/web/app/api/join-requests/[id]/approve/route.ts:8`) | the `/c/[tenantId]` route param; session.manage re-checked (:10-12) | `{ request: { id, status, outcome, playerId, waitlistPosition }, replayed }` (:35-44) | `request-inbox.tsx` |
| Reject | POST `/api/join-requests/<requestId>/reject?tenant=` | `{ commandId }` (`apps/web/app/api/join-requests/[id]/reject/route.ts:8`) | the same (:10-11) | `{ request: { id, status }, replayed }` (:34-37) | `request-inbox.tsx` |

Not called by L12 (O-1, O-2), for reference:
- member join POST `/api/sessions/<id>/join?tenant=`: body `{ commandId }` (`join/route.ts:13`); data `{ join: { outcome, playerId, waitlistPosition, requestId }, replayed }` (:44-50);
- leave POST `/api/sessions/<id>/leave?tenant=`: body `{ commandId }` (`leave/route.ts:13`); data `{ player: { id, status }, replayed }` (:39-42); LEAVE_REQUIRES_HOST 409 (:13);
- cancel DELETE `/api/join-requests/<id>?tenant=`: body `{ commandId }` (`join-requests/[id]/route.ts:11`); data `{ request: { id, status }, replayed }` (:39-42).

- **Identity.** Every route takes the actor from the session cookie, never the body (public join F-2; approve :26, :31; reject :25, :30; member
  join :35, :40; leave :30, :35; cancel :30, :35). L12 sends no person, player or tenant id from client state. The only ids it sends are route
  parameters the server re-checks: `publicListingId` (re-resolved; a miss is the one NOT_FOUND), `requestId` (from the host list, F-6;
  re-checked under session.manage) and `tenantId` (the URL param AppShell matched, `app-shell.tsx:70-71`; re-authorized on every call).
- **One command id per intent (P-11).** Created when the action starts, reused on a retry, cleared after success or `isDefiniteFailure`;
  reuse `useCommandId()` or `useRosterCommand()`, no new id helper. The id sits in a ref, so a second tap before the first settles carries the
  SAME id, and the button is `disabled` + `aria-busy` while in flight, so the second tap sends nothing. Every response carries `replayed`; a
  replay renders exactly like the first result. Writes are disabled offline, as on the roster (`roster-tab.tsx:22-25`; `useOnlineStatus` :7).
- **Where the calls live.** `discover-api.ts`: GET `/api/discover`, GET `/api/discover/<publicListingId>`, POST public join. `me-player-api.ts`:
  GET `/api/me/clubs|sessions|charges|requests`. The three host calls (list, approve, reject) sit inside `request-inbox.tsx` with `apiFetch` +
  `tenantQuery(ctx.tenantId)`: no lib file in FILES IN SCOPE fits a host call, and `sessions-api.ts` stays unedited (P-12).
- **After success.** Public join: show the outcome (`active`, `waitlisted` + position, or `requested`; `packages/core/src/api-contract.ts:193`)
  and a link to `/me/sessions`; no venue and no amount (the response carries neither). Approve or reject: refetch the pending list and the
  roster (P-12); the seat and the charge are written server-side (`approve/route.ts:12-13`), the UI computes nothing.

### 4.4 Host requests tab (QA6)

Measured at the base:
- `apps/web/app/c/[tenantId]/sessions/[id]/page.tsx:1-10` renders only `<SessionDetailView tenantId sessionId />`; the `[id]` subtree holds two
  pages and no layout (`export default` only at `page.tsx:3` `SessionDetailPage` and `edit/page.tsx:3` `EditSessionPage`).
- The host view's tabs are client state, not routes (`apps/web/components/sessions/session-detail-view.tsx`): `useState("roster")` :38; `<Tabs>`
  :211-227 inside `<div ref={tabsRef}>` :210, with `label={t("Nội dung buổi chơi", "Session content")}` :212, `active={tab}` and `onChange={setTab}`
  :213-214, and two `items` :215-226: `roster`, t("Người chơi", "Roster"), panel `<RosterTab session={session} ctx={ctx} onChanged={refresh} />`
  :216-220, and `details`, t("Chi tiết", "Details"), panel `<DetailsTab session={session} />` :221-225. Focus hand-off to Roster :53-61, :250-255;
  the edit link `editHref` is built from the loaded `session.id` (:202), so the tabs exist only after GET `/api/sessions/[id]` passed
  `session.manage` (F-5).
- `apps/web/components/sessions/roster-tab.tsx`: "use client" :1; gates mirror the server allowlists and writes are disabled offline (:22-25,
  `useOnlineStatus` :7); props `{ session, ctx, onChanged }` :26-30.

Decision (P-12):
- **Placement: a third tab in the existing `<Tabs>`.** One more `items` entry: `id: "requests"`, label t("Yêu cầu tham gia", "Join requests"),
  panel `<RequestInbox session={session} ctx={ctx} onChanged={refresh} />`; `request-inbox.tsx` takes the RosterTab props. This needs ONE file
  outside the lane FILES IN SCOPE, `apps/web/components/sessions/session-detail-view.tsx`, edited additively (one import and one `items` entry,
  about 6 LOC; no existing tab, state, read, focus or dialog logic changes). `session-service.ts`, `roster-service.ts`, `session-form.tsx`,
  `roster-tab.tsx`, `page.tsx` and `sessions-api.ts` stay unedited. Ratified as a named scope addition (RC-0b): at most about 10 LOC, nothing else in that file.
- **Why not a NEW segment under `[id]/`.** A NEW `requests/page.tsx` would be reachable only by typing its URL: the host session's only link
  source is the view itself (`editHref` :202 lives there), so no in-scope file can link to it, and the page would rebuild `ctx` and the loading
  and 403 states the view already owns. A NEW `[id]/layout.tsx` nav would also wrap `edit/page.tsx` and stack a second tab bar over Roster and
  Details. The URL-only fallback (a NEW `requests/page.tsx`) is rejected (RC-0b): a host page with no entry link is unusable.
- **Who sees it.** Only a host whose host read succeeded (`session.manage`, F-5). The list re-checks `session.manage` in `?tenant=` (F-6:
  `route.ts:12`; `join-request-service.ts:435-436`) and so does every decision (`approve/route.ts:10-12`, `reject/route.ts:10-11`), as L8 P-12 pins
  (`docs/sessions/web-mvp-phase3-readiness-p3-m9-join-core.md:231`). A plain member never reaches `/c/**` (4.1). A 403 from the list renders the
  one forbidden state, never a partial list.
- **What it lists.** The session's pending, unexpired requests in `createdAt, id` order (F-6, :463-470), the H-1 keys per row and two buttons per
  row, t("Duyệt", "Approve") and t("Từ chối", "Reject"). No pending request => the empty state (part B).
- **Actions.** POST `/api/join-requests/<requestId>/approve` or `/reject` with `?${tenantQuery(ctx.tenantId)}`, body `{ commandId }` and the CSRF of
  `ctx` (4.3). One `useCommandId()` keeper per row with the action as its payload, `get("approve")` or `get("reject")` (a different payload mints a
  fresh key: `apps/web/lib/use-command-id.ts:9-15`, `:39-44`), then `settle(error)` (:45-50). While a row's command is in flight both its buttons
  are `disabled` and the pressed one is `aria-busy`; offline disables both (P-11).
- **After a decision.** The server writes the outcome: approve with a free seat => an active seat and one charge, approve on a full session => a
  waitlisted seat (`approve/route.ts:12-13`); reject writes no roster or money (`reject/route.ts:12-13`). The UI shows the H-1 result line,
  refetches the pending list (the decided row leaves it, F-6) and calls `onChanged` (the view's `refresh`, as for RosterTab :219), so Roster
  shows the new seat. It computes no seat, position or amount and shows no amount.
- **Decide errors** (codes only; part B owns the copy): REQUEST_DECIDED, REQUEST_EXPIRED and JOIN_REQUEST_NOT_FOUND (a stale row: refetch the
  list), TENANT_SUSPENDED (`approve/route.ts:13-14`, `reject/route.ts:11-12`), FORBIDDEN 403 (the one forbidden state).

### 4.5 Error mapping per screen (QB1)

Screens (reconciled with 4.1, RC-1): S-1 discovery list (D-1), S-2 listing detail (D-2), S-3 the join panel on S-2 (D-3), S-4 me hub
(no read, RC-3), S-5 my clubs (ME-1), S-6 my sessions (ME-2), S-7 my charges (ME-3), S-8 my requests (ME-4), S-10 host requests tab (H-1).
S-9 (the member join / leave panel) is not built (O-1, O-2, RC-0a); the R4, R5 and R6 rows below are reference facts only.

**How a screen maps an ApiClientError today (measured).**

- `apps/web/lib/api-client.ts`: `apiFetch` (:55-104) turns every outcome into one error shape. A thrown fetch becomes
  `ApiClientError(CLIENT_NETWORK_ERROR, status 0)` (:72-74); an envelope error becomes `ApiClientError(code, message, statusCode,
  requestId)` (:82-94); a non-ok reply without an envelope (an empty-body 500, a proxy page) becomes `CLIENT_BAD_RESPONSE` (:95-102).
  No timeout is set (:63-71). `ApiFetchInit` (:41-46) passes every other `RequestInit` key, `signal` included, through `...rest` (:56, :65).
- `apps/web/lib/session-error-ui.ts`: `describeSessionError` (:116-194) is the ONE mapping. `CLIENT_NETWORK_ERROR` gets the client
  `t()` "no connection" text with action `retry` (:128-136). `AUTH_REQUIRED` gets `sign-in` (:138-145), `FORBIDDEN` `none` (:146-153),
  `CSRF_INVALID` `reload` (:154-161), `RATE_LIMITED` `retry` (:162-169), `INVALID_BODY` `none` (:170-177) and `SESSION_NOT_FOUND` `none`
  (:178-179). A code in `DOMAIN_CODES` (:41-62) with a non-empty message shows the SERVER message, with action `reload` if the code
  is in `RELOAD_DOMAIN_CODES` (:30-39) and `none` otherwise (:183-185). Anything else gets the generic client text, `retry` and
  `known: false` (:186-193). Server domain messages are resolved in the tenant's language inside the request
  (`session-command-route.ts:798-799`, under `runWithLang(context.lang)` :842). Pre-tenant codes are Vietnamese server-side, so the
  client renders them from its own `t()` (`session-error-ui.ts:7-13`).
- `isDefiniteFailure` (:202-206): only an envelope 4xx lets a screen drop its commandId. Network loss, `CLIENT_BAD_RESPONSE` and 5xx
  keep the SAME commandId (DD-117 D5). Screens use `commandId.current ??= crypto.randomUUID()` and reset it after a definite
  failure (`apps/web/components/sessions/session-detail-view.tsx:150`, `:164`; `new-session-view.tsx:48`, `:56`;
  `visibility-toggle.tsx:115`, `:124`).
- Rendering: `apps/web/components/sessions/api-error-notice.tsx` takes an injectable `describe` that defaults to
  `describeSessionError` (:6, :20). `sessions-list-view.tsx:84-85` renders it with `onRetry` / `onReload`.

**Gaps at the base for L12.**

- These codes are not in the catalog, so today they would render the generic "unexpected" text with `retry`:
  `JOIN_REQUEST_NOT_FOUND`, `LEAVE_REQUIRES_HOST`, `REQUEST_DECIDED`, `REQUEST_EXPIRED` and `SESSION_NOT_JOINABLE` (mapped server-side
  at `session-command-route.ts:518-523`), plus the discovery codes `NOT_FOUND`, `INVALID_FILTER` and `DISCOVERY_RATE_LIMITED`
  (`discovery-route-support.ts:139-146`, `:262-267`).
- The server text for `ALREADY_JOINED` is written for the host: "This player is already on the roster."
  (`session-command-route.ts:589`).
- /me and /discover pages render in the DD-118 pre-tenant language (`me-frame.tsx:17-23`), but a domain message comes back in the
  club's language. The same page would then show two languages.

**Which merged route returns which code (measured).**

| Route | Codes (status) |
|---|---|
| R1 `GET /api/discover` (`app/api/discover/route.ts:19-34`), anonymous | `DISCOVERY_RATE_LIMITED` 429 + `retry-after` (:22-23 -> `discovery-route-support.ts:139-146`); `INVALID_FILTER` 400 (:24-25 -> :266-267); empty-body 500 on any throw, a missing cursor key included (:21, :31-33 -> :271-272) |
| R2 `GET /api/discover/:publicListingId` (`route.ts:6-12` -> `serveDiscoveryListing`, `discovery-route-support.ts:280-295`), anonymous | `DISCOVERY_RATE_LIMITED` 429 (:287-288); `NOT_FOUND` 404 for a malformed key or a missing row (:289, :291 -> :262-263); empty-body 500 (:292-293) |
| R3 `POST /api/public-listings/:publicListingId/join` (`route.ts:35-102`) | `AUTH_REQUIRED` 401 (:40); `CSRF_INVALID` 403 (:41-43); `RATE_LIMITED` 429 for the actor or the person (:44-49); `INVALID_BODY` 413 / 400, commandId included (:53-76); `NOT_FOUND` 404 (:79, :81); then the joinSession codes below, in the tenant's language (:83, :96-98). An unmapped throw is rethrown (:99) and becomes a framework 500, which the client sees as `CLIENT_BAD_RESPONSE`. Body = `{ join: { outcome, waitlistPosition }, replayed }` only (:92-95) |
| R4 `POST /api/sessions/:id/join?tenant=` (`route.ts:27-54`, `selfService`) | gate (`session-command-route.ts:232-343`): `AUTH_REQUIRED` 401 (:238), `CSRF_INVALID` 403 (:239-241), `INVALID_BODY` 400 for a bad tenant (:245-248), `RATE_LIMITED` 429 per actor (:260-262) and per tenant (:311), `FORBIDDEN` 403 when not associated (:264-274), `INVALID_BODY` 413 / 400 (:319-320, :326, :329, :343); then joinSession |
| joinSession (`packages/db/src/session-join-service.ts:209-283`) | `TENANT_SUSPENDED` (:111) -> 403 (`session-command-route.ts:552`); `FORBIDDEN` (:112; :228 "caller is not a member of this club"; the public route passes `allowGuestMembership: true`, R3 :90) -> 403 (:511); `SESSION_NOT_FOUND` (:212, :231) -> 404 (:548); `SESSION_NOT_JOINABLE` (:233, :238) -> 400 (:523); `REJOIN_REQUIRES_REVIEW` (:260) -> 409 (:514); `ALREADY_JOINED` (:283) -> 409 (:508); `CHARGE_DERIVATION_UNAVAILABLE` -> 503 and `GENDER_FORBIDDEN` -> 403, raised by self-join, host-add and approve (:524-528) |
| R5 `POST /api/sessions/:id/leave?tenant=` (`route.ts:22-46`) | the R4 gate; leaveSession (`session-join-service.ts:332-374`): `TENANT_SUSPENDED` / `FORBIDDEN` (:111-112), `PLAYER_NOT_FOUND` (:338, :353, :360) -> 404 (:513), `LEAVE_REQUIRES_HOST` (:363, and :374 when recorded payments are not zero) -> 409 (:520). Body `{ player: { id, status }, replayed }` (:39-42) |
| R6 `DELETE /api/join-requests/:id?tenant=` (cancel, `route.ts:22-46`, `selfService`) | the R4 gate; in `join-request-service.ts`: `TENANT_SUSPENDED` (:205) and `FORBIDDEN` (:206) from requesterScope (:203-206); `JOIN_REQUEST_NOT_FOUND` (:172, :185, :246) -> 404 (:519); `COMMAND_ID_CONFLICT` (:230) -> 409 (:544); `REQUEST_DECIDED` (:247) -> 409 (:521); `REQUEST_EXPIRED` (:248) -> 409 (:522) |
| R7 `GET /api/sessions/:id/join-requests?tenant=` (`route.ts:22-48`, host) | read gate (`session-read-route.ts`): `AUTH_REQUIRED` 401 (:52), `INVALID_BODY` 400 (:56, :84-86, :100), `RATE_LIMITED` 429 (:59, :67), `FORBIDDEN` 403 (:44); listPendingJoinRequests: `FORBIDDEN` (:434, :436), `SESSION_NOT_FOUND` (:438, :446). Body `{ requests: [{ requestId, displayName, createdAt }] }` (`route.ts:36-41`; `api-contract.ts:183-187`) |
| R8 / R9 `POST /api/join-requests/:id/approve` / `reject` `?tenant=` | the R4 gate. A non-manager passes only through the opt-in association path (`session-command-route.ts:264-266`), and these two routes request no options (`approve/route.ts:22-46`, `reject/route.ts:21-39`). Approve (`join-request-service.ts:302-350`): `JOIN_REQUEST_NOT_FOUND`, `COMMAND_ID_CONFLICT`, `REQUEST_DECIDED`, `REQUEST_EXPIRED` (:172-248, as R6), `SESSION_NOT_JOINABLE` (:316, :347), `REJOIN_REQUIRES_REVIEW` (:350), `CHARGE_DERIVATION_UNAVAILABLE` / `GENDER_FORBIDDEN` (`session-command-route.ts:524-528`). Reject (:405 -> closeRequest :383) returns the lock and replay codes. hostScope (:190) codes are not measured. Approve body `{ request: { id, status, outcome, playerId, waitlistPosition }, replayed }` (`approve/route.ts:35-44`) |
| R10 `GET /api/me/{clubs,sessions,charges,requests}` (each `route.ts:12-24`) | `resolveMeGate` (`me-route-gate.ts:13-23`): `AUTH_REQUIRED` 401 (:18), `RATE_LIMITED` 429 (:23). `CSRF_INVALID` (:20) cannot happen on requests (`csrf: false`, `me/requests/route.ts:13-16`); the other three routes' option lines (:14-17) were not printed. Any throw returns 500 with NO body (`clubs/route.ts:23`, `sessions/route.ts:23`, `charges/route.ts:23`, `requests/route.ts:22`), which the client sees as `CLIENT_BAD_RESPONSE` |

Codes that no L12 route returns, so L12 does not map them:

- `SESSION_FULL`: emitted only by `session-service.ts` and `session-guest-note-route.ts`. It has no row in `STATUS_BY_CODE` (:504-552),
  and a full session answers with outcome `waitlisted` (`api-contract.ts:189-197`).
- FE design-spec codes that are not in `API_ERROR_CODES` (`api-contract.ts:98-163`):
  - `MAGIC_LINK_INVALID` and `TOPIC_UNAUTHORIZED` (`feature_player_view_fe.md`; Error mapping tables at :131, :185, :240, :270).
  - `EXPIRED_GONE`, `JOINED_ACTIVE` and `LOADING_MORE` (`feature_marketplace_fe.md` :135, :211). These are UI state names, not wire codes.

No R3 / R4 row maps `COMMAND_ID_CONFLICT` and no R8 / R9 row maps `TENANT_SUSPENDED`, because a row needs a measured line that returns
the code (B2). `session-join-service.ts` is not among the `COMMAND_ID_CONFLICT` emitters (file grep), and its replay goes through
`replayOrNull` from `roster-money-shared.ts` (`session-join-service.ts:13`, `:16`), whose codes were not printed. `hostScope`
(`join-request-service.ts:190-200`) emits no code itself: it calls
`requireActor(tx, tenantId, params.actorPersonId, HOST_ACTIONS, "manage_roster")` (:192-198), then `scopeRequest` (:199), and
`requireActor` was not printed. If either code comes back anyway, `describePlayerError` still renders E-14 or E-13 (4.5.1).

**4.5.1 What session-error-ui.ts gains (P-13).**

- One additive export, `describePlayerError(error, t): ErrorView`, placed after `describeReverseError` and built the same way: it wraps
  `describeSessionError` and overrides only a fixed set of codes (:208-223).
- Every L12 screen passes it as `api-error-notice`'s `describe` (:20).
- It renders the codes below from the page's own `t()`, with `known: true`: one language per page, and never a server string.

| ID | Code | vi / en | Action |
|---|---|---|---|
| E-1 | `NOT_FOUND` | "Kèo này không còn hoặc không tồn tại." / "This game is no longer listed." | `none` (the screen shows a link to /discover) |
| E-2 | `INVALID_FILTER` | "Bộ lọc không hợp lệ. Hãy đặt lại bộ lọc." / "That filter is not valid. Reset the filters." | `none` (the screen shows Reset filters) |
| E-3 | `DISCOVERY_RATE_LIMITED` | "Bạn tìm quá nhanh. Đợi một lát rồi thử lại." / "Too many searches. Wait a moment and try again." | `retry` |
| E-4 | `SESSION_NOT_JOINABLE` | "Buổi này hiện không nhận người tham gia." / "This session is not taking players right now." | `reload` |
| E-5 | `ALREADY_JOINED` | "Bạn đã có tên trong buổi này." / "You are already in this session." | `reload` |
| E-6 | `REJOIN_REQUIRES_REVIEW` | "Cần xem lại các khoản thanh toán trước đó rồi mới tham gia lại được." / "Earlier payments need review before rejoining." | `none` |
| E-7 | `CHARGE_DERIVATION_UNAVAILABLE` | "Chưa thể thực hiện lúc này. Vui lòng thử lại sau ít phút." / "This can't be done right now. Please try again in a few minutes." | `retry`, same commandId (P-14) |
| E-8 | withdrawn (RC-1): `LEAVE_REQUIRES_HOST` reaches no L12 screen | - | - |
| E-9 | withdrawn (RC-1): `PLAYER_NOT_FOUND` reaches no L12 screen | - | - |
| E-10 | `REQUEST_DECIDED` | "Yêu cầu này đã được xử lý." / "This request has already been decided." | `reload` |
| E-11 | `REQUEST_EXPIRED` | "Yêu cầu này đã hết hạn." / "This request has expired." | `reload` |
| E-12 | `JOIN_REQUEST_NOT_FOUND` | "Không tìm thấy yêu cầu này." / "This request was not found." | `reload` |
| E-13 | `TENANT_SUSPENDED` | "CLB này đang tạm ngưng." / "This club is suspended." | `none` |
| E-14 | `COMMAND_ID_CONFLICT` | "Thao tác bị trùng. Tải lại trang rồi thử lại." / "Duplicate action. Reload the page and try again." | `reload` |

Every other code goes to `describeSessionError` unchanged:

- `AUTH_REQUIRED`, `FORBIDDEN`, `CSRF_INVALID`, `RATE_LIMITED`, `INVALID_BODY`, `SESSION_NOT_FOUND` and `CLIENT_NETWORK_ERROR`.
- The fail-closed generic text for `GENDER_FORBIDDEN` (generic on purpose, `session-error-ui.ts:51`), `CLIENT_BAD_RESPONSE` and any
  unknown code.

`ErrorAction` (:15), `RELOAD_DOMAIN_CODES`, `DOMAIN_CODES`, `errorField`, `describeSessionError`, `isDefiniteFailure` and
`describeReverseError` do not change, so no existing screen changes behavior.

**4.5.2 Per-screen tables.** "gen" = the generic fail-closed text of `describeSessionError`, plus the requestId when there is one. The
commandId rule is P-20.

S-1 discover list (R1)

| Code | Visible state | Action |
|---|---|---|
| `DISCOVERY_RATE_LIMITED` 429 | error block E-3; the filters stay | Retry with the same filter |
| `INVALID_FILTER` 400 | error block E-2 | Reset filters, then refetch |
| load-more failure (any row here) | inline notice under the list; loaded items stay (`sessions-list-view.tsx:125-127` pattern) | Retry load more |
| `CLIENT_NETWORK_ERROR` (incl. the P-15 timeout) | offline state (4.6) | Retry |
| `CLIENT_BAD_RESPONSE` (empty-body 500), unknown | gen | Retry |

S-2 discover detail (R2)

| Code | Visible state | Action |
|---|---|---|
| `NOT_FOUND` 404 | not-found state E-1; no listing field rendered | Link to /discover |
| `DISCOVERY_RATE_LIMITED` 429 | E-3 | Retry |
| `CLIENT_NETWORK_ERROR` / timeout | offline state | Retry |
| `CLIENT_BAD_RESPONSE`, unknown | gen | Retry |

S-3 join button on the discover detail (R3)

| Code | Visible state | Action |
|---|---|---|
| `AUTH_REQUIRED` 401 | "session expired" (describeSessionError) | Sign in; commandId dropped |
| `CSRF_INVALID` 403 | reload text | Reload; commandId dropped |
| `RATE_LIMITED` 429 | retry text | Retry; new commandId (4xx) |
| `INVALID_BODY` 400 / 413 | describeSessionError `none` (a client defect) | none |
| `NOT_FOUND` 404 | E-1 | Link to /discover |
| `TENANT_SUSPENDED` 403 | E-13 | none |
| `FORBIDDEN` 403 | describeSessionError FORBIDDEN | none |
| `SESSION_NOT_FOUND` 404 | describeSessionError | Link to /discover |
| `SESSION_NOT_JOINABLE` 400 | E-4 | Reload the detail |
| `ALREADY_JOINED` 409 | E-5 | Link to /me/sessions |
| `REJOIN_REQUIRES_REVIEW` 409 | E-6 | none |
| `CHARGE_DERIVATION_UNAVAILABLE` 503 | E-7 (no gender, price or price-mode word) | Retry with the SAME commandId |
| `GENDER_FORBIDDEN` 403 | gen (never names gender) | the Retry that gen offers; new commandId (4xx) |
| `CLIENT_NETWORK_ERROR` / timeout | "no connection" | Retry with the SAME commandId |
| `CLIENT_BAD_RESPONSE` (5xx), unknown | gen + requestId | Retry with the SAME commandId |

S-5 me clubs, S-6 me sessions, S-7 me charges, S-8 me requests list (R10; one table, applied per page). S-4 me hub makes no read and maps no code (RC-3).

| Code | Visible state | Action |
|---|---|---|
| `AUTH_REQUIRED` 401 | "session expired" | Sign in (the /me layout already redirects a missing session to "/": pre-measure t0 :246-251, not re-read) |
| `RATE_LIMITED` 429 | retry text | Retry |
| `CLIENT_NETWORK_ERROR` / timeout | offline state | Retry |
| `CLIENT_BAD_RESPONSE` (500, no body), unknown | gen (requestId null: there is no envelope) | Retry |

- The hub (S-4) is links only (4.2 Me hub, RC-3), so no hub card can fail.
- S-7 also has a 200 data state that fails closed: summary `unknown` (the L9 DTO; readiness
  `web-mvp-phase3-readiness-p3-m9-me-reads.md:318-319`, A-5 / A-6).
  - It shows no total and no partial sum, only "Chưa hiển thị được số tiền. Thử lại sau." / "The amount can't be shown right now. Try
    again later."
  - Retry appears only when `retryable` is true.

S-8 cancel and S-9 member join / leave panel: not built (RC-0a, RC-1; O-1, O-2). No L12 screen calls R4, R5 or R6, so no table maps
their codes.

S-10 host requests tab (R7 list; R8 / R9 decide)

| Code | Visible state | Action |
|---|---|---|
| list: `AUTH_REQUIRED` 401 | "session expired" | Sign in |
| list: `FORBIDDEN` 403 | describeSessionError FORBIDDEN; no list rendered | none |
| list: `SESSION_NOT_FOUND` 404 | describeSessionError | none |
| list: `RATE_LIMITED` 429 | retry text | Retry |
| list: `INVALID_BODY` 400 | describeSessionError `none` | none |
| decide: `AUTH_REQUIRED` / `CSRF_INVALID` / `RATE_LIMITED` / `INVALID_BODY` / `FORBIDDEN` | as S-3 | as S-3 |
| decide: `JOIN_REQUEST_NOT_FOUND` 404 | E-12 | Reload the list |
| decide: `REQUEST_DECIDED` 409 | E-10 | Reload the list |
| decide: `REQUEST_EXPIRED` 409 | E-11 | Reload the list |
| decide: `COMMAND_ID_CONFLICT` 409 | E-14 | Reload the list; new commandId |
| approve: `SESSION_NOT_JOINABLE` 400 | E-4 | Reload the list |
| approve: `REJOIN_REQUIRES_REVIEW` 409 | E-6 | none |
| approve: `CHARGE_DERIVATION_UNAVAILABLE` 503 | E-7 | Retry with the SAME commandId |
| approve: `GENDER_FORBIDDEN` 403 | gen | none |
| `CLIENT_NETWORK_ERROR` / timeout | "no connection" / offline state | Retry with the SAME commandId |
| `CLIENT_BAD_RESPONSE` (5xx), unknown | gen + requestId | Retry with the SAME commandId |

### 4.6 States, viewport and theme matrix (QB2)

**Measured patterns to reuse.**

- `apps/web/components/sessions/sessions-list-view.tsx`: `state.status` drives every state.
  - loading: an `aria-busy="true"` list of `Skeleton` cards (:71-78).
  - error: `ApiErrorNotice` with `onRetry` / `onReload` (:84-85).
  - offline: a `role="status"` notice with the saved-at time (:88-99).
  - ready or offline with no rows: `EmptyState` with a title and body (:107-111).
  - a load-more button with a busy label (:125-129).
- Primitives in `apps/web/components/ui/` (directory listing): `empty-state.tsx`, `error-state.tsx`, `skeleton.tsx`, `spinner.tsx`,
  `state-block.module.css`, `button.tsx`, `badge.tsx`, `card.tsx`, `tabs.tsx`, `toast.tsx`, `inline-error.tsx`, `confirm-dialog.tsx`,
  `skip-link.tsx`.
- `apps/web/components/me/me-frame.tsx` is the ONE language source for /me pages.
  - Its `LangProvider` starts at `vi` (DD-118 pre-tenant) and switches to the device's remembered club language after mount
    (:17-23, :28-30).
  - It wraps the pages in `SessionProvider` + `MeGate` (:32-35) and imports `OfflineBanner`, `ErrorState`, `Skeleton`, `Spinner` and
    `SkipLink` (:9-14).
  - `div#main-content` is not a `<main>`: each /me page owns its own `<main>` (:25-26).
- `apps/web/components/pwa/offline-view.tsx` is the service worker's /offline page for a failed NAVIGATION (:34-39).
  - An in-page offline state is separate. It uses `useOnlineStatus` from `apps/web/lib/use-online-status`, imported by
    `components/shell/offline-banner.tsx:4`, `:10`, `settings/zalo-connect-card.tsx:8`, `:58` and `sessions/visibility-toggle.tsx:10`.
- `apps/web/lib/i18n-client.tsx`: `useLang` (:30-32), `useT` (:34-37), `makeT` with two literals (:22-24); an unknown language
  becomes `vi` (:18-20). The server `t` cannot be bundled for the browser (:5-9).
- Tokens: `apps/web/app/globals.css` defines 176 custom properties (`grep -cE '^\s*--[a-z]'`).
  - Examples: `--primary` (:12); `--success`, `--warning` and `--error`, each with `-text` / `-subtle` (:22-30); `--paid`,
    `--pending` and `--unpaid` (:33-35); `--gray-50..700` (:38-45).
  - Components use `var(--space-5)` (`sessions-list-view.tsx:76`).
  - `docs/standards/design-tokens.md` headings (pre-measure t0 :362-381, not re-read): §1 Color Palette with Dark Mode and Light
    Mode (default), §3 Spacing, §4 Border & Radius, §7 Layout, §8 Breakpoints, and the usage rules.
- Dark mode follows the OS unless a page pins a theme.
  - `color-scheme: light dark` (`globals.css:9`).
  - `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) … }` (:171-174).
  - Explicit pins: `:root[data-theme="dark"]` (:201-202) and `[data-theme="light"]` (:228-229).
  - `theme-color` per media query (`app/layout.tsx:44-45`).
  - Playwright's `colorScheme` emulation drives it (`e2e/a11y.spec.ts:25-27`). CSS modules use tokens only, so dark mode needs no
    per-component code.

**Required matrix.**

- Every built screen (RC-1: S-1 to S-8 and S-10) x its applicable states in the table below x {375x812, 1280x800} x {light, dark}; an
  n/a cell is skipped, never faked, and the generated test count follows from the table (not pinned here).
- Each cell must be axe clean: serious or critical findings fail, with tags `wcag2a` to `wcag22aa` (`a11y.spec.ts:34-42`).
- There is no horizontal overflow at 375.
- Each view root renders `data-state` (P-19) next to the accessible semantics the app already uses: `aria-busy="true"` while
  loading, `ApiErrorNotice` for an error, and `role="status"` when offline.

| Screen | loading | ready | empty | error | offline |
|---|---|---|---|---|---|
| S-1 discover list | skeleton cards | listing cards (fields per part A's whitelist; amounts only via `formatVnd`; no venue) | "no game matches" + Reset filters | 4.5.2 S-1 | notice + Retry; no cached copy (P-16) |
| S-2 discover detail | skeleton | listing + S-3 (no venue) | not-found (E-1) | 4.5.2 S-2 | notice + Retry |
| S-3 join button | idle; while pending: disabled + `aria-busy` + busy label (P-20) | signed out: a "Sign in to join" link and no POST. Outcome `active`: joined + a link to /me/sessions. `waitlisted`: the position (`waitlistPosition`) and no venue. `requested`: waiting for the host | n/a (the cell is the idle state) | inline 4.5.2 S-3 | disabled + offline hint (`useOnlineStatus`) |
| S-4 me hub | n/a (no read, RC-3) | the four links: /me/clubs, /me/sessions, /me/charges, /me/requests | n/a | n/a | MeFrame's offline banner; the links stay |
| S-5 me clubs | skeleton | own clubs (part A's DTO) | none + a link to /discover | 4.5.2 | notice |
| S-6 me sessions | skeleton | own seats. Venue ONLY when the status is active; waitlisted: area + position; pending: area (L9 DT-7 / A-3, readiness `p3-m9-me-reads.md:316`, `:335-336`) | none + a link to /discover | 4.5.2 | notice |
| S-7 me charges | skeleton | own open / partial charges: amountDue / amountAllocated / remaining via `formatVnd` (L9 A-4, `:317`); never another person's | known_zero: nothing to pay | 4.5.2, plus summary `unknown` failing closed (no total) | notice |
| S-8 me requests | skeleton | own requests with the 4.2 ME-4 keys; no Cancel (O-2) | none | 4.5.2 | notice |
| S-10 host requests tab | skeleton | pending list (displayName and createdAt only, `api-contract.ts:183-187`) + Approve / Reject | "no pending requests" | 4.5.2 S-10 | notice + Retry |

Rules on every screen:

- No bank detail, QR or pay-now control.
- No gender and no per-gender price (L11 merged with `GENDER_COLLECTION_ENABLED` false).
- Every amount goes through `formatVnd`; the guard scans all of apps/web (section 8).
- Every string is a `t(vi, en)` pair from `useT` (HARD RULE 5).

### 4.7 Golden path player journey and runbook section 9 (QB4)

**Measured.**

- `apps/web/e2e/golden-path.spec.ts` has one test (:41): "host golden path: club -> session -> publish -> collect (partial,
  reversal) -> close".
  - Steps:
    - Sign in as the host persona via /dev-login (:55-56), then warm up (:83).
    - Create a club (:88). The limit is 3 per account per hour; the opt-out is `GOLDEN_PATH_ALLOW_SEEDED_CLUB=1` (:30-34, :37).
    - Draft a session with venue, address and price 100.000 (:127), then publish it (:154).
    - Add two players (:164). Close is refused (:174).
    - Collect a partial cash payment (:186). Cancel is refused (:193).
    - Collect the rest (:204), reverse (:212), pay again (:226), close (:232).
  - The spec skips unless `GOLDEN_PATH_BASE_URL` is set (:36-39).
  - Helpers: `addPlayer`, `confirmTransition`, `expectToast`, `localInput`, `paceSessionApi`, `payCash`, `rosterRow`,
    `screenshotter` (:2-11); `warmUpDevServer` (:17); `COMPILE_TIMEOUT_MS` (:16).
- `apps/web/e2e/golden-path.config.ts`: `testMatch: "golden-path.spec.ts"` (:27), long timeouts (:30-32, :38-39), the list and
  not-proven reporters (:35), no web server, chromium (:41), and the command in its header (:15-16). The not-proven reporter
  (29 lines) prints its warning last (`support/golden-path-not-proven-reporter.ts:22-23`).
- `docs/runbooks/local-mvp-smoke.md`:
  - §6 (:79-104) turns on `plexco.dev_login` for plexco_smoke (:82-84) and keeps ONE fixed key in `~/.plexco-smoke-encryption-key`
    (:92-96). `pnpm dev:seed` creates "Dev Club" and three `@dev.invalid` personas: owner ("Chủ CLB"), co_admin and player (:97, :100).
  - §7 runs the dev server on 127.0.0.1:3000 (:108-111, :114).
  - §8: /dev-login has three persona buttons (:120-121).
  - §9 is the manual host click path, rows 1-14 (:123-142).
  - §10 is the automated run (:144-169): the command (:148-153), not in CI (:167), its own config and no web server (:168).
- Signing in as a second persona in the same browser is already proven: `e2e/dev-login-browser.spec.ts:30`, "a persona button signs
  the browser in as that persona: owner, then player".
- Wrappers `P3-S3-notes/scripts/l5-golden-path.sh` and `m6-golden-path.sh` (first 40 lines, identical apart from `wt` at :9):
  - They run under the DB/e2e lock (`locked-run.sh`, header :2-3).
  - They recreate ONLY plexco_smoke, and only when the key file is missing (:20-33; header :5).
  - They migrate plexco_smoke from the worktree with the smoke superuser URL and `env -u DATABASE_URL_TEST` (:34-36).
  - They read the key into the environment without printing it (:38-39), then seed (:40).
  - The header says "never enables dispatch or web_realtime" (:6).

**Player journey to add (P-22, RC-4).** A second test in golden-path.spec.ts, `test("player golden path: published session -> my
sessions -> my charges", ...)`. The host test stays byte-identical. There is no leave step (RC-0a).

Measured limits (part C, at the base):

- The /discover leg cannot run locally (RC-0c, OPEN-B4): `public_sessions` has no app write path, its projector row stays disabled, and
  nothing in L12 or its golden path enables dispatch or a projector row. No merged test-only seed path exists: no line under
  `apps/web/e2e` or `scripts` mentions the table, and its only test writers are raw `INSERT INTO public_sessions` statements inside db
  unit tests (`packages/db/src/session-service.test.ts:2270`, `:3812`, `:4296`; `packages/db/src/rls-invariants.test.ts:303`). The mocked
  B-7 test covers discover -> join, and the run record marks the golden-path /discover leg NOT RUN with this reason.
- The host's roster add cannot seat the seeded player persona: "Host-add by display name (DD-85: no member picker, a name is never
  resolved to a member)" (`apps/web/components/sessions/roster-add-player-form.tsx:16`; UI copy :109 "It is never matched to an existing
  member."). The /me reads are account-keyed (F-3), so a host-added name never reaches the persona's /me pages. The seat comes from the
  merged member join route instead, called by the test itself (step 4).

Steps:

1. Sign in as the owner persona and stay in the seeded "Dev Club" (no club creation, so the 3-per-hour limit cannot refuse it). Draft a
   session with a per-run unique venue name and area, price 100.000 and the open join policy (the select at `session-form.tsx:314-315`),
   then publish it. Read the tenant id and the session id from the host URL `/c/<tenantId>/sessions/<id>`.
2. Sign out, then sign in as the player persona (the dev-login-browser pattern, `e2e/dev-login-browser.spec.ts:30`).
3. Pre-check (binary, O-5): open /me/clubs and wait for its ready or empty state. Dev Club listed => continue. Otherwise call
   `test.skip(true, "seeded player is not a Dev Club member: player leg NOT RUN (O-5)")`; the run record carries that reason, and the
   seed is not edited (outside FILES IN SCOPE).
4. Seat the player: `page.request.post("/api/sessions/<id>/join?tenant=<tenantId>")` with body `{ commandId }` (one
   `crypto.randomUUID()`) and the `x-csrf-token` header from the player's own GET `/api/auth/session` (`csrfToken`,
   `apps/web/app/api/auth/session/route.ts:33`), on the player's cookie; expect `join.outcome` = `active` (open session, free seat:
   DD-135). Test-only: no UI control is added and no route changes (O-1, O-2 stand).
5. Open /me/sessions: the session is listed as active, WITH the per-run venue (F-4).
6. Open /me/charges: 100.000đ open for Dev Club, exactly the `formatVnd(100000)` output, and no pay-now, QR or bank text on the page.

**Runbook §9 (P-23).**

- Append rows 15-18 to the §9 table (`local-mvp-smoke.md:127-142`), in Vietnamese like the rest of the runbook:
  1. Run the automated player journey (the §10 command plus `-g "player golden path"`): it publishes an open Dev Club session and
     seats the seeded player through the member join route.
  2. /dev-login as the player.
  3. /me/sessions shows that session with its venue; /me/charges shows 100.000đ for Dev Club and no pay-now, QR or bank detail.
  4. /discover renders with no session; locally it lists nothing, because the public projector row stays disabled (OPEN-B4).
- Add one line under the table: the automated run in §10 runs both tests; add `-g "player golden path"` to run only the player journey.
- §10 stays unchanged.

**Exact local command.** The conductor's verifier runs it after the merge round, under the DB/e2e lock:

`bash "/Users/maingocanh/Projects/Plexco app/Claude outputs/plexco-phase3/status/P3-S10-notes/scripts/l12-golden-path.sh"`

- That script is a copy of `P3-S3-notes/scripts/m6-golden-path.sh` with
  `wt="/Users/maingocanh/Projects/Plexco app/.autopilot/worktrees/p3-m9-player-web"` and the P3-S10 notes dir.
- Its spec call is the runbook's (§10, :149-150): `GOLDEN_PATH_BASE_URL=http://localhost:3000 pnpm --filter @plexco/web exec playwright test --config e2e/golden-path.config.ts`.
  The base URL is the wrapper's dev server.
- It uses plexco_smoke only, and the key is never printed. It enables neither dispatch nor any projector row and runs no backfill.

## 5. Pinned defaults

Each pin is a value the lane applies now as "default applied, pending owner sign-off": P-1 to P-12 from part A, P-13 to P-24 from part B.
The writer's PR body repeats every pin and every header ruling marked default; none edits `docs/standards/decisions.md` (L17
consolidates the applied defaults into one entry).

- **P-1 Page paths.** `/discover` (list) and `/discover/[publicListingId]` (detail); never `/discover/:sessionId` and no page anywhere keyed by a
  session uuid; the member's seat view is the `/me/sessions` card, with no per-session page; `/me` is a hub of links to the four lists; MeFrame
  and `apps/web/app/me/layout.tsx` stay unedited (4.1); default applied, pending owner sign-off.
- **P-2 Share page.** Omitted: no share-link producer exists at the base, and DD-133 (a)-(e) does not require one in L12 (4.1, RC-2,
  O-3); default applied, pending owner sign-off.
- **P-3 Join control.** Only the D-3 join panel posts, and only the public join: `useSession()` `ready` => the join button; `signed-out` => the
  sign-in prompt t("Đăng nhập để tham gia.", "Sign in to join.") linking to `/`, no POST; an error with status 404 (the discovery role) => the note
  t("Tham gia trên ứng dụng web Plexco.", "Join on the Plexco web app."), no button, no POST; any other error => the retryable error state, no
  button. No leave, cancel or member-join control on any screen until O-2 is resolved (4.1); default applied, pending owner sign-off.
- **P-4 Times and optional discovery keys.** A time renders in the row's `timezone` when its DTO has one (MySession, F-3), else in the viewer's
  time zone (no other rendered DTO carries a zone: O-4); no zone is hardcoded. `title` is the heading when present, else the `sportKey` label;
  `sessionType`, `levelMinRank`, `levelMaxRank`, `levelStrict`, `ageMin` and `ageMax` are not rendered in v1 (all NULL today, F-1); default
  applied, pending owner sign-off.
- **P-5 No gender.** `genderRestriction` is never rendered, even when non-NULL, and no screen shows a per-gender price: the only price shown is
  `priceAmount` (D-1, D-2) and the only other amounts are the player's own charges (ME-3); L11 is merged with GENDER_COLLECTION_ENABLED false;
  default applied, pending owner sign-off.
- **P-6 Venue.** `venueName` and `venueAddress` render only from a MySession row with `myStatus === "active"` and a non-null value; never from
  another DTO (the discovery, request, charge and host DTOs have no venue key: F-1, F-3, F-6) and never for a waitlisted seat or a pending request
  (the definer nulls them: F-4, `packages/db/migrations/0059_me_player_reads_definers.sql:111-112`, `:125`); default applied, pending owner sign-off.
- **P-7 Money.** Every amount goes through `formatVnd` (`apps/web/lib/money.ts:27`; OD-4b, `docs/standards/decisions.md:1941-1943` clause (b): ONE
  web VND formatter) and only with `currency === "VND"`; an `unknown` status, a non-VND currency or a non-number amount renders the fail-closed
  unavailable state (copy: part B), with a retry only when `retryable`, never 0; no pay-now, QR, bank detail or pay CTA on any screen; only the
  signed-in player's own charges are shown (ME-3), never another person's debt; default applied, pending owner sign-off.
- **P-8 Ids are never text.** `publicListingId`, `sessionId`, `requestId`, `clubRef` (the tenant slug), `sessionRef`, `playerId`, `request.id` and
  `nextCursor` serve only as a route parameter, request path, cursor or React key, and the only ids sent are route parameters the server re-checks
  (section 0 (d), 4.3); default applied, pending owner sign-off.
- **P-9 Missing requester name.** A null `displayName` (no active or guest membership: F-6, `packages/db/src/join-request-service.ts:451`,
  `:455-461`) renders the fixed label t("Người chơi chưa có tên", "Unnamed player"); no other source is consulted; default applied, pending owner
  sign-off.
- **P-10 Nullable discovery values.** `slotsOpen` and `priceAmount` render only when a number (otherwise no count and no price line, never a
  made-up 0); `joinPolicy` renders a t(vi, en) hint only for a value of its declared type, otherwise nothing (F-1,
  `apps/web/lib/discovery-route-support.ts:244-252`); default applied, pending owner sign-off.
- **P-11 One command id per intent.** `useCommandId()` (`apps/web/lib/use-command-id.ts:58-61`; keeper `get` / `settle` / `reset` :28-32) or
  `useRosterCommand()` (`apps/web/lib/use-roster-command.ts:22`): minted when the action starts, kept across an uncertain failure so an identical
  retry replays, dropped on success or a definite failure (`use-command-id.ts:45-50`; `isDefiniteFailure`, `apps/web/lib/session-error-ui.ts:202`);
  the button is `disabled` and `aria-busy` while in flight and writes are disabled offline, so a double tap sends one id (4.3); default applied,
  pending owner sign-off.
- **P-12 Host requests tab.** A third `items` entry of the host view's `<Tabs>` (`apps/web/components/sessions/session-detail-view.tsx:215-226`)
  rendering `request-inbox.tsx` with the RosterTab props, so it exists only with the loaded host session (`session.manage`); the list, approve and
  reject calls live in `request-inbox.tsx` with `apiFetch` and `tenantQuery(ctx.tenantId)`, and `sessions-api.ts` stays unedited; after a decision
  it refetches the list and calls `onChanged`; it uses the RC-0b scope addition `session-detail-view.tsx` (one import and one `items`
  entry, at most about 10 LOC, nothing else in that file; no URL-only fallback) (4.3, 4.4); default applied, pending owner sign-off.
- P-13 One error variant for every L12 screen: `describePlayerError(error, t)` in `session-error-ui.ts`, with catalog 4.5.1 (E-1 to
  E-14, client `t(vi, en)`). Everything else goes to `describeSessionError` unchanged. Screen-owned controls (Reset filters, the link
  to /discover) live in the views, and `ErrorAction` does not change; default applied, pending owner sign-off.
- P-14 The `CHARGE_DERIVATION_UNAVAILABLE` copy is E-7: no gender, price, price-mode or "pricing" word. Its action is retry with the
  SAME commandId (a 503 writes nothing, `session-command-route.ts:525`). `GENDER_FORBIDDEN` stays generic; default applied, pending
  owner sign-off.
- P-15 Request timeout 15 s: `discover-api.ts` and `me-player-api.ts` pass `signal: AbortSignal.timeout(15_000)` to `apiFetch`. An
  abort surfaces as `CLIENT_NETWORK_ERROR` (`api-client.ts:72-74`), and commands keep their commandId; default applied, pending owner
  sign-off.
- P-16 Offline means `useOnlineStatus()` is false or the error is `CLIENT_NETWORK_ERROR`; it shows a `role="status"` notice and Retry.
  No player data (sessions, charges, requests) is cached on the device; default applied, pending owner sign-off.
- P-17 /discover pages fetch client-side through `discover-api.ts` (R1, R2). The page itself reads no database, so e2e mocks it with
  `page.route` (consistent with the 4.1 page pattern, RC-6); /discover pages never mount MeFrame's `MeGate`; default applied, pending owner sign-off.
- P-18 /discover pages take their language the way /me pages do (DD-118 pre-tenant: `vi`, then the device's remembered language after
  mount, `me-frame.tsx:20-23`, `:28-30`). /c/[tenantId] pages use the tenant locale (`i18n-client.tsx:8-9`); default applied, pending
  owner sign-off.
- P-19 Each L12 view root renders `data-state="loading|ready|empty|error|offline"` next to the semantics the primitives already carry:
  `aria-busy="true"` while loading (skeletons are `aria-hidden`, `components/ui/skeleton.tsx:7`), `role="alert"` on an error
  (`components/ui/error-state.tsx:22`, `components/sessions/api-error-notice.tsx:42`) and `role="status"` when offline (P-16). The
  empty state gets no role (none printed for `components/ui/empty-state.tsx`). Tests key on `data-state`; default applied, pending
  owner sign-off.
- P-20 Merged into P-11 (RC-5): the L12 commands are the public join, approve and reject only; each takes P-11's keeper, whose ref
  behaves as `commandId.current ??= crypto.randomUUID()` (`session-detail-view.tsx:150`, `:164`), is reset only on success or
  `isDefiniteFailure`, and keeps its button disabled with `aria-busy="true"` while pending; default applied, pending owner sign-off.
- P-21 The matrix is 5 states x {375x812, 1280x800} (the `a11y.spec.ts:17-20` pair) x {light, dark} (`colorScheme`), generated in a new
  `e2e/player-a11y.spec.ts`. `a11y.spec.ts` gains only the anonymous /discover row. L12 adds no theme toggle UI; default applied,
  pending owner sign-off.
- P-22 The player golden path is a second test in `golden-path.spec.ts` (steps in 4.7, RC-4): the owner publishes an open session in
  the seeded Dev Club, the test seats the seeded player through the merged member join route (a test-only call, no UI control), and the
  player sees the session with its venue on /me/sessions and the charge through `formatVnd` on /me/charges; a player who is not a Dev
  Club member skips the test with the NOT RUN reason (O-5), and the /discover leg is NOT RUN (RC-0c). The host test does not change;
  default applied, pending owner sign-off.
- P-23 Runbook: §9 gains rows 15-18 and the `-g "player golden path"` line; §10 does not change; default applied, pending owner sign-off.
- P-24 Rate limits (`RATE_LIMITED`, `DISCOVERY_RATE_LIMITED`) show a Retry button and no countdown. `apiFetch` never reads response
  headers (`api-client.ts:55-104`), so it never sees `retry-after`; default applied, pending owner sign-off.

## 6. Implementation steps (dependency order, test-first)

1. Run GitNexus `impact` (upstream) before editing an existing symbol: `session-error-ui.ts` (additive export only), `a11y.spec.ts`
   `SCREENS`, `golden-path.spec.ts`, `golden-path-helpers.ts` if a helper is added, and `SessionDetailView` (`session-detail-view.tsx`, RC-0b). Run
   `detect_changes` before every commit. The fallback is a grep of callers stated in the PR body.
2. Red, then green, for the libs. The tests come first:
   - the `describePlayerError` table test (B-10, B-11);
   - `discover-api.test.ts` and `me-player-api.test.ts`: a timeout becomes `CLIENT_NETWORK_ERROR`; the DTO parse follows part A's
     allowlist; injected keys are dropped (B-12);
   - one view test per state, using renderToStaticMarkup (the `link-code-view.test.tsx:6-29` pattern).

   DoD: they fail because the code is missing.
3. Green: `describePlayerError`, `discover-api.ts`, `me-player-api.ts`. DoD: the step-2 lib tests are green, and the existing
   `session-error-ui` tests are unmodified and green.
4. Views, their `.module.css` (tokens only) and the pages, one screen at a time: S-1, S-2, S-3 (`join-panel.tsx`); S-4 to S-8;
   S-10 `request-inbox.tsx` + the third host tab (RC-0b). DoD: the view tests and the money guard are green.
5. Mocked e2e:
   - `e2e/support/player-api-mock.ts` (page.route per state; it reuses `signIn`, `TENANT_ID` and `installApiMock` from
     `session-api-mock.ts`);
   - `e2e/player.spec.ts` (B-4 to B-7, B-13 to B-16);
   - `e2e/player-a11y.spec.ts` (B-1);
   - the `a11y.spec.ts` row (B-2).

   DoD: `pnpm --filter @plexco/web exec playwright test` is green (under the pwa.spec.ts:39 flake rule).
6. Golden path: the second test plus the runbook §9 rows (B-8). DoD: the verifier runs it locally (4.7), or it is marked NOT RUN with
   the reason.
7. Run the S1 VERIFY set (`| tail -40`): typecheck, lint, format:check, review:check:changed, build,
   `NODE_ENV=test pnpm --filter @plexco/web test`, `NODE_ENV=test DATABASE_URL_TEST=... pnpm -w test`, Playwright. Then run the B3
   numstat check (section 9).
8. Review: an opus/max reviewer, at most 3 rounds. Its questions: any DTO field shown that is not whitelisted, another person's debt,
   hardcoded values, client-trusted ids. The PR body carries the Codex-waived line, every default P-1 to P-24 and the header rulings marked default.

## 7. Acceptance matrix (QB3)

| ID | Lane TESTS item / input | Expected | File :: test |
|---|---|---|---|
| B-1 | every screen x 5 states x {375, 1280} x {light, dark} | `data-state` matches; no horizontal overflow at 375; axe finds 0 serious or critical issues | `e2e/player-a11y.spec.ts` :: `axe <scheme> <viewport> > <screen> <state>` (200 generated) |
| B-2 | anonymous /discover in the shared a11y loop | `main` renders with no session; axe clean in all 4 scheme x viewport cells | `e2e/a11y.spec.ts` :: `discover (anonymous)` (new `SCREENS` row) |
| B-3 | amounts only through formatVnd | no number formatting outside `lib/money.ts`; the listing price and charge amounts are formatVnd output | `lib/money-single-formatter-guard.test.ts` (unchanged; scans all of apps/web) + `my-charges-view.test.tsx` :: `amounts come from formatVnd` |
| B-4 | waitlisted / pending rows carrying an injected venue string | area + position shown, venue string absent; an active row shows its venue | `my-sessions-view.test.tsx` :: `venue only for an active seat`; `join-panel.test.tsx` :: `waitlisted shows position, no venue`; `player.spec.ts` :: `waitlisted player sees area and position, no venue` |
| B-5 | no session cookie | discover list and detail render; Join shows "Sign in to join" and sends no POST | `player.spec.ts` :: `anonymous discovery works with no session` |
| B-6 | double tap on Join while the POST is held open | exactly 1 POST; the button is disabled with `aria-busy="true"` while pending; a retry after a network failure reuses the commandId, a retry after a 4xx uses a new one | `player.spec.ts` :: `join double tap sends one command id` |
| B-7 | mocked journey (RC-0a) | discover, join (active), /me/sessions lists it with its venue, /me/charges shows the charge through `formatVnd`; no leave | `player.spec.ts` :: `player journey discover -> join -> my sessions -> my charges` |
| B-8 | real local journey (RC-4) | the 4.7 steps pass on plexco_smoke, or the run record marks a leg NOT RUN with its reason (the /discover leg always: RC-0c) | `golden-path.spec.ts` :: `player golden path: published session -> my sessions -> my charges` (local only) |
| B-9 | t(vi, en) strings | each view renders distinct vi and en text in every state; no key-shaped `t("a.b")` call in new files | each `*.test.tsx` :: `renders vi and en`; plus a review grep |
| B-10 | every live 4.5.1 code (E-8 and E-9 withdrawn), plus unknown, `CLIENT_BAD_RESPONSE` and `CLIENT_NETWORK_ERROR` | exact message and action; delegated codes equal the `describeSessionError` output | `apps/web/lib/session-error-ui.test.ts` (exists at the base, RC-0e) :: `describePlayerError maps the L12 codes` |
| B-11 | `CHARGE_DERIVATION_UNAVAILABLE` in vi and en | neither text contains giới tính, gender, giá or price (case-insensitive); action retry | same file :: `charge derivation copy is neutral` |
| B-12 | DTOs carrying injected `gender`, per-gender price, bank or QR keys | none of them is rendered; the parser drops unknown keys | `me-player-api.test.ts`, `discover-api.test.ts`, view tests :: `ignores non-whitelisted keys` |
| B-13 | charges and discover screens | no pay-now button, QR image or bank-detail text | `player.spec.ts` :: `no pay-now, QR or bank detail anywhere` |
| B-14 | host inbox and charges | inbox rows show displayName and createdAt only; charges are the caller's own DTO rows | `request-inbox.test.tsx` :: `renders name and time only`; `my-charges-view.test.tsx` :: `own charges only` |
| B-15 | one representative code per screen + the fail-closed row | the 4.5.2 visible state and action | `player.spec.ts` :: `<screen> maps <code>`, `<screen> unknown and network fail closed` |
| B-16 | API aborted (`route.abort("internetdisconnected")`) and `context.setOffline(true)` | offline state with Retry; no cached player data | `player.spec.ts` :: `<screen> offline` |
| B-17 | listing card / detail link | built from the DTO's publicListingId, never from a session id | `discover-list-view.test.tsx` :: `links by publicListingId` |
| B-18 | regression | existing web tests, e2e specs, the host golden-path test and the money guard are unchanged and green | full S1 VERIFY + Playwright |

## 8. Test harness and test-only scope (QB3)

- Default Playwright (`apps/web/playwright.config.ts`):
  - It serves a production build with `next start` (:4-6, :41-50), with `testDir: ./e2e` (:20), the golden path ignored (:22),
    `fullyParallel` (:24) and chromium Desktop Chrome (:32).
  - `DATABASE_URL` points at `e2e/support/fake-postgres.mjs` (:34-40, :47). That file is a 177-line wire stub: it answers ONLY the
    session lookup for the token `e2e-session-token`, and returns an ErrorResponse for every other statement (`fake-postgres.mjs:3-10`,
    :17-18).
  - Signed-in specs mock every /api call with `page.route` (`playwright.config.ts:12`). They use `signIn`, `installApiMock`,
    `makeSession` and `TENANT_ID` from `e2e/support/session-api-mock.ts` (imported at `sessions.spec.ts:3-10`).
  - A non-envelope failure is stubbed as `route.fulfill({ status: 502, contentType: "text/html" })` (`sessions.spec.ts:149-151`).
- Correction to the pre-measure: `t0-premeasure-l12.log:301` says `ABSENT apps/web/e2e/support`. The directory exists, with
  `fake-postgres.mjs`, `golden-path-helpers.ts`, `golden-path-not-proven-reporter.ts`, `golden-path-timeouts.ts`,
  `golden-path-warmup.ts`, `realtime-live.config.ts`, `realtime-stream-mock.ts`, `roster-api-mock.ts` and `session-api-mock.ts`.
- `e2e/a11y.spec.ts` (47 lines) loops over `SCREENS` (:9-15) x `SCHEMES` (:16) x `VIEWPORTS` (:17-20).
  - It has one `describe` per scheme x viewport, which sets `colorScheme` and `viewport` (:22-28).
  - It has one test per screen, which waits for `main` (:30-33) and fails on serious or critical axe findings (:34-42).
  - A screen is added with one `SCREENS` entry. The file has no API mocks, so only signed-out paths belong there.
  - The anonymous /discover row lands in a failure state, because R1 cannot read the stub DB. That is unverified, and the test only
    needs `main`.
- Component tests: vitest, with `renderToStaticMarkup` of a pure view per state (`components/me/link-code-view.test.tsx:1-29`). L12 views
  take their state as props for the same reason.
- Money guard (`lib/money-single-formatter-guard.test.ts`):
  - It walks the whole apps/web root (:38), skipping `node_modules`, `.next`, `public`, `coverage` and `playwright-report` (:39).
  - It checks every `.ts`, `.tsx`, `.mjs` and `.js` file except tests and `lib/money.ts` (:52-57).
  - New L12 files are therefore covered with no edit to the guard.
- New test-only files:
  - `e2e/support/player-api-mock.ts`, `e2e/player.spec.ts` and `e2e/player-a11y.spec.ts`;
  - one `*.test.tsx` per new view;
  - `lib/discover-api.test.ts` and `lib/me-player-api.test.ts`;
  - the `describePlayerError` tests, in the existing `apps/web/lib/session-error-ui.test.ts` (measured at the base, RC-0e).
- Test-only scope additions for part C to ratify:
  - R-B1 `e2e/support/golden-path-helpers.ts`: an additive persona sign-in helper for the second test.
  - R-B2 `e2e/support/player-api-mock.ts`: a new support file.
- Edits to existing tests: `a11y.spec.ts` gets one `SCREENS` row; `golden-path.spec.ts` gets one new test, with the host test
  byte-identical.
- Environment:
  - The default e2e needs no database.
  - The golden path needs the S1 DB/e2e lock, plexco_smoke only, and the fixed key file, which is never printed.
  - The `pwa.spec.ts:39` offline flake gets one rerun.

## 9. B3 budget (QB5; caps re-derived by part C, RC-0d)

- Default: about 300 LOC, 3 modules, 1 migration. L12 touches 2 modules, `apps/web` and `docs/runbooks` (this readiness file in
  `docs/sessions` is excluded), and has 0 migrations. Its LOC and file count are over the default, so it needs a B3 exception.
- Re-derived after O-1, O-2 and P-2 removed the member detail page, the leave and cancel controls and the share page (RC-0d).
  Comparable files measured by part B: `sessions-list-view.tsx` + `.module.css` 135 + 88; `session-detail-view.tsx` + `.module.css`
  268 + 157; `roster-tab.tsx` + `roster.module.css` 188 + 139; `me-frame.tsx` + `.module.css` 120 + 72; `link-code-view.tsx` 158;
  `settings-channels-list.tsx` 218; `sessions-api.ts` 209; `roster-payments-api.ts` 113; `me-link-client.ts` 95; tests
  `link-code-view.test.tsx` 101 and `settings-forms.test.tsx` 206; e2e `sessions.spec.ts` 1184, `settings.spec.ts` 1037,
  `roster.spec.ts` 613.
- Estimate, non-test (CSS included):

| Part | Lines |
|---|---|
| pages, 7 x ~12 (`/discover`, the detail, `/me` and its four lists) | ~85 |
| discover views + CSS | ~250 + ~90 |
| player views (hub links only; clubs, sessions, charges, requests without Cancel) + CSS | ~380 + ~90 |
| `join-panel` (public join only) + CSS | ~110 + ~35 |
| `request-inbox` + CSS | ~130 + ~40 |
| `discover-api.ts` | ~60 |
| `me-player-api.ts` | ~100 |
| `session-error-ui.ts` additions (12 live codes) | ~80 |
| `session-detail-view.tsx` (RC-0b) | ~10 |
| runbook additions | ~10 |
| **Total** | **about 1,470** |

- Estimate, tests:

| Part | Lines |
|---|---|
| view tests, ~8 x 60 | ~480 |
| lib tests | ~220 |
| `player.spec.ts` | ~400 |
| `player-a11y.spec.ts` | ~120 |
| `player-api-mock.ts` | ~200 |
| `a11y.spec.ts` additions | ~5 |
| golden path test + helper | ~110 + ~30 |
| **Total** | **about 1,565** |

- Hard caps, measured with `git diff --numstat 277b366af3a2b215c46aec242f6da945251fb483..HEAD` and excluding the readiness file:

| Measure | Cap |
|---|---|
| non-test lines changed (CSS included) | <= 1,700 |
| test lines | <= 1,900 |
| total | <= 3,600 |
| files | <= 50 (51 with the readiness file) |
| `apps/web/components/sessions/session-detail-view.tsx` lines changed | <= 10 (RC-0b) |
| migrations | 0 (no path under `packages/db/migrations/`) |
| `git diff --name-only <base>..HEAD -- apps/web/app/api packages` | empty |

- B3 exception (conductor note 15):
  - Modules named: `apps/web` (7 pages, the discover and player components, `join-panel.tsx`, `request-inbox.tsx`, the two lib
    clients, one additive `session-error-ui.ts` export, one additive tab entry, their tests and e2e) and `docs/runbooks` (§9 rows). No
    third module and no migration.
  - Why a split breaks coherence:
    - DONE WHEN (RC-0a) is one journey, discover -> join -> see it in my sessions -> see my charge, plus the extended golden path.
    - A discover + join lane alone has no screen that shows the result; a /me lane alone has no UI path that creates its state.
    - The host requests tab closes the approval loop of the same public join: requested, approved, then listed on /me/sessions.
    - One matrix spec and one journey prove the cross-screen invariants: venue only when active, `formatVnd` only, no gender, one
      error variant.
    - Two lanes would both edit `session-error-ui.ts`, `a11y.spec.ts`, `golden-path.spec.ts` and the runbook, one after the other.
  - Compatibility proof:
    - No API, DB, migration or shared-service change: no file under `apps/web/app/api/**` or `packages/**` (the name-only check above).
    - `session-service.ts`, `roster-service.ts`, `session-form.tsx`, `roster-tab.tsx`, `sessions-api.ts`, MeFrame and
      `app/me/layout.tsx` are untouched.
    - `session-detail-view.tsx` gains one import and one `items` entry (RC-0b): no existing tab, state, read, focus or dialog logic
      changes; B-18 keeps the existing host tests green.
    - The `session-error-ui.ts` change is additive: every existing export is byte-identical, and its existing tests are unmodified.
    - `money.ts` is untouched (`formatVnd` at `money.ts:27`); the money guard scans the new files with no edit.
    - The host golden-path test is unchanged, and the new pages are new paths.
    - Rollback = revert the PR.

## 10. OPEN (out of scope for L12)

- OPEN-B1 Settled by 4.1 and RC-0a: the /me DTOs carry `clubRef` (a slug), not the tenant uuid that R4-R6 take from `?tenant=`
  (`readTenantParam`, `session-command-route.ts:105`, `:245-248`; L9 O-3, `p3-m9-me-reads.md:380-381`), so Cancel and Leave are omitted
  everywhere, and no member panel is built (O-1, O-2).
- OPEN-B2 `apiFetch` drops response headers, so there is no `retry-after` countdown (P-24). A header-aware client is a shared-lib
  change for a later lane.
- OPEN-B3 The public join answers with the outcome and waitlistPosition only (R3 :92-95, by design :26). After a public join the UI
  links to /me/sessions, not to a member panel.
- OPEN-B4 (settled by B2 and RC-0c) `public_sessions` is written only through its projector (`0061_public_sessions_projector_writer.sql:1-2`,
  :22), whose registry row stays DISABLED (`0056_outbox_projector_registry_dlq_replay.sql:106`; 0061:28); the R-2 backfill comes after
  enabling that row (0061:28-30). L12 enables neither dispatch nor any projector row, so the local golden path cannot list a session on
  /discover: its player test seats the player through the member join route (4.7, RC-4) and records the /discover leg as NOT RUN.
- OPEN-B5 The server message for `ALREADY_JOINED` is written for the host (`session-command-route.ts:589`). L12 overrides it
  client-side (E-5); changing the server copy belongs to an API lane.
- OPEN-B6 No join route returns `SESSION_FULL` (it has no row in `STATUS_BY_CODE` :504-552), so there is nothing to map.
- OPEN-B7 FE design-spec codes outside `API_ERROR_CODES` are not used: `MAGIC_LINK_INVALID`, `TOPIC_UNAUTHORIZED`, `EXPIRED_GONE`,
  `JOINED_ACTIVE`, `LOADING_MORE`.
- OPEN-B8 Pre-measure correction: `e2e/support` exists (t0 log :301).
- OPEN-B9 Settled (RC-0b): the host requests tab is a third `items` entry in `session-detail-view.tsx`, a named scope addition (one
  import and one entry, at most about 10 LOC); the URL-only page is rejected.

Follow-up facts (B2): (1) `public_sessions` has no app write path: `0061_public_sessions_projector_writer.sql:22` (no privilege granted to app); its writer is the projector's database half (:1-2), whose registry row stays DISABLED (:28; `0056_outbox_projector_registry_dlq_replay.sql:106`), and the R-2 backfill comes after enabling it (:28-30); six `packages/db/src` files that mention the table were listed, not opened (`migrate.ts`, `public-session-fence.ts`, `session-service.ts`, `client.ts`, `session-read.ts`, `session-occupancy.ts`), and the script's discovery read-source check printed nothing. (2) `session-join-service.ts` has no `COMMAND_ID_CONFLICT`; its replay is `replayOrNull` from `roster-money-shared.ts` (:13, :16), whose codes were not printed: the S-3 and S-9 join rows are removed. (3) `hostScope` (`join-request-service.ts:190-200`) calls `requireActor(..., HOST_ACTIONS, "manage_roster")` (:192-198), then `scopeRequest` (:199); `requireActor` was not printed: the S-10 `TENANT_SUSPENDED` row is removed. (4) For part C only: the `leaveSession` :363 condition and whether leaving voids the open charge were not printed (the script has no such section; measure with `sed -n '340,380p' packages/db/src/session-join-service.ts`); the web cannot call leave from /me (`P3-S10-notes/l12-readiness-handoff-a2.md` O-2). (5) `role="alert"` at `components/ui/error-state.tsx:22` and `components/sessions/api-error-notice.tsx:42`, `aria-hidden` at `components/ui/skeleton.tsx:7`, nothing for `components/ui/empty-state.tsx`: P-19. (6) The session-error-ui test file name was not printed (the script has no such section): B-10 is unchanged; measure with `ls apps/web/lib | grep -i session-error-ui`. (7) Player persona label at `apps/web/lib/dev-login/page-document.ts:48`; `dev:seed` at the root `package.json:27`, but the player's Dev Club membership printed nothing; the join-policy select at `session-form.tsx:314-315` (visibility :305-306) supersedes step 2's "not measured"; host detail tabs at `session-detail-view.tsx:15`, `:19-20`, `:26`, `:38`: OPEN-B9.

Part C on the follow-up facts: (4) is moot, because L12 has no leave control (RC-0e); (6) is measured:
`apps/web/lib/session-error-ui.test.ts` exists at the base and holds B-10 and B-11.

### OPEN from part A

- **O-1 (API gap, OUT_OF_SCOPE for L12).** There is no member-facing session detail read at the base: `GET /api/sessions/[id]` is
  `session.manage`-only (F-5: `apps/web/lib/session-read-route.ts:17`, `:44`, `:61`), so a plain member gets the one FORBIDDEN 403. L12 must
  not build the member session detail on the host read; a member's seat view comes from `/api/me/sessions` only (F-3, F-4). A members-only
  (non-public) session the member has not joined has no web read path for them. A member session read is a future API lane, not L12
  (negative scope: no API change).
- **O-2 (API gap, OUT_OF_SCOPE for L12): no self-service leave, cancel or member join the web can address.** The three routes take the tenant
  only from `?tenant=<uuid>`, L8 forbids a session-id lookup, and the web holds no tenant uuid for a member's seat or request (4.1). L12 ships
  no leave and no cancel control. The lane TESTS step "discover -> join -> see in my sessions -> leave" and DONE WHEN therefore cannot reach
  "leave" in the UI: RC-0a settles it (the journey ends at "see it in my sessions" and "see my charge"; "leave" waits on O-2). The fix is an API lane plus an owner
  decision, e.g. self-service routes keyed by the caller's own seat or request with the tenant resolved server-side (as the public join resolves
  it from `publicListingId`, F-2), or a tenant id in the L9 rows that the selfService gate re-checks (`session-command-route.ts:162`, `:169-183`).
- **O-3 (OUT_OF_SCOPE): share-link page path.** No share-link producer exists at the base (4.1, P-2). The lane that adds one pins the page
  path: `/discover/share/[slug]` fits the allowlist (`apps/web/lib/request-policy.ts:33`) and the merged GET `/api/discover/share/<slug>` (:36);
  the DD-83 `/session/<slug>` path needs a `request-policy.ts` change. L12 builds no share page.
- **O-4 (API gap, OUT_OF_SCOPE for L12): session times without a time zone.** Only `MySession` carries `timezone`
  (`packages/db/src/me-player-reads.ts:28-43`); the discovery DTO (F-1), `MyJoinRequest` (:45-56) and `MyChargeItem` (:58-65) carry `startsAt`
  (and the discovery DTO `endsAt`) with none. L12 renders those in the viewer's time zone (P-4), which differs from the session's local time for
  a viewer in another zone. Session-local rendering needs those DTOs to carry the session `timezone`: a future API lane, not L12 (negative
  scope: no API change).

### OPEN from part C

- **O-5 (measured in step 6; changing it is OUT_OF_SCOPE): the seeded player persona's Dev Club membership.** Part B's probe and part
  C's grep of the seed sources printed nothing, so it is not measured at step 0. The golden-path player test checks it first and skips
  with the NOT RUN reason when it is absent (4.7 step 3, P-22). Making the persona a member is a dev-seed change, outside FILES IN SCOPE.
- **O-6 (OUT_OF_SCOPE): a host cannot seat an account holder from the web.** Host-add is by display name and never resolves to a member
  (`apps/web/components/sessions/roster-add-player-form.tsx:16`, DD-85), so a host-added seat never reaches any player's /me pages.
  Noted for the program; not an L12 change (negative scope: no API change).

## 11. Closure matrix (12 of 12)

| # | Gate | Evidence | Result |
|---|---|---|---|
| 1 | Authority snapshot pinned by SHA | `AUTHORITY_SHA` = W HEAD = session base; every TARGET_FILES path exists at the base | PASS |
| 2 | Decisions in scope final | D3 = DD-135 signed (`docs/standards/decisions.md:1790`, signature `:1808`); D1 = DD-133 signed (a)-(e) (`:1837`, signature `:1859`); P-1 to P-24 and the header rulings marked default are pinned pending owner sign-off | PASS |
| 3 | Scope IN/OUT and owner clear | sections 4 and 8; lane NEGATIVE SCOPE; RC-0b scope addition; RC-8 test-only additions; section 10 is out of scope | PASS |
| 4 | Dependencies classified | L8 #68, L9 #70 and L10b #74 merged at the base (their route files, section 1); L11 #76 merged with gender collection off; D3 and D1 signed | PASS |
| 5 | Live schema and code match | sections 1-3 and 4.x, measured at the base; no schema, migration or API change | PASS |
| 6 | Data, API, state, auth contract | 4.1 pages and routes, 4.2 allowlists, 4.3 commands, 4.4 host tab, 4.5 error mapping, 4.6 states, 4.7 golden path | PASS |
| 7 | Fail-closed, idempotency, order | P-7 (unknown, non-VND or non-number => unavailable, never 0); P-11 one command id per intent; every 4.5.2 table ends fail-closed; venue DB-gated (F-4, P-6) | PASS |
| 8 | Open questions in scope = 0 | section 5 pins and the header rulings; O-1 to O-6 and OPEN-B1 to OPEN-B9 are out of scope (section 10) | PASS |
| 9 | Acceptance matrix with expected results | section 7, B-1 to B-18 (B-7, B-8 and B-10 as amended) | PASS |
| 10 | Migration, security, rollback | no migration and no API, DB or grant change; the merged routes' server-side authorization stays authoritative; rollback = revert | PASS |
| 11 | First slice hard dependencies merged | L8 #68, L9 #70, L10b #74 at the base | PASS |
| 12 | Implementation handoff ready | sections 4-9; W at the base, clean at step 0 | PASS |

## 12. Verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-10-19
AUTHORITY_SHA: 277b366af3a2b215c46aec242f6da945251fb483
BASE_BRANCH: main
TARGET_FILES:
  - docs/standards/decisions.md
  - docs/standards/review-code-readiness-gate.md
  - docs/sessions/web-mvp-phase3-readiness-p3-m9-join-core.md
  - docs/sessions/web-mvp-phase3-readiness-p3-m9-me-reads.md
  - docs/sessions/web-mvp-phase3-readiness-p3-m9-discovery-read.md
  - docs/channels/web/FE/feature_player_view_fe.md
  - docs/channels/web/FE/feature_marketplace_fe.md
  - package.json
  - packages/db/migrations/0056_outbox_projector_registry_dlq_replay.sql
  - packages/db/migrations/0059_me_player_reads_definers.sql
  - packages/db/migrations/0061_public_sessions_projector_writer.sql
  - packages/db/src/auth.ts
  - packages/db/src/me-player-reads.ts
  - packages/db/src/join-request-service.ts
  - packages/db/src/session-join-service.ts
  - packages/db/src/session-service.test.ts
  - packages/db/src/rls-invariants.test.ts
  - packages/core/src/api-contract.ts
  - apps/web/lib/api-client.ts
  - apps/web/lib/money.ts
  - apps/web/lib/money-single-formatter-guard.test.ts
  - apps/web/lib/request-policy.ts
  - apps/web/lib/discovery-route-support.ts
  - apps/web/lib/session-read-route.ts
  - apps/web/lib/session-command-route.ts
  - apps/web/lib/sessions-api.ts
  - apps/web/lib/session-dto.ts
  - apps/web/lib/use-command-id.ts
  - apps/web/lib/use-roster-command.ts
  - apps/web/lib/use-session.tsx
  - apps/web/lib/i18n-client.tsx
  - apps/web/lib/me-route-gate.ts
  - apps/web/app/me/layout.tsx
  - apps/web/app/api/discover/route.ts
  - apps/web/app/api/me/clubs/route.ts
  - apps/web/app/api/me/sessions/route.ts
  - apps/web/app/api/me/charges/route.ts
  - apps/web/app/api/me/requests/route.ts
  - apps/web/app/api/auth/session/route.ts
  - apps/web/components/me/me-frame.tsx
  - apps/web/components/shell/app-shell.tsx
  - apps/web/components/sessions/roster-tab.tsx
  - apps/web/components/sessions/roster-add-player-form.tsx
  - apps/web/components/sessions/api-error-notice.tsx
  - apps/web/components/sessions/sessions-list-view.tsx
  - apps/web/e2e/golden-path.config.ts
  - apps/web/e2e/dev-login-browser.spec.ts
  - apps/web/e2e/support/session-api-mock.ts
  - apps/web/playwright.config.ts
SLICE: p3-m9-player-web
IN_SCOPE: player-facing web pages over merged routes only: the /discover list and the /discover/<publicListingId> detail with the public join panel (anonymous allowed, D1 signed), the /me hub and the my clubs, sessions, charges and requests pages (own data only, venue only for an active seat, amounts only through formatVnd), the host join-requests tab as a third tab of session-detail-view.tsx with approve and reject, describePlayerError in session-error-ui.ts, discover-api.ts and me-player-api.ts, view tests, mocked e2e and the a11y matrix, the golden-path player test and the runbook section 9 rows
OUT_OF_SCOPE: any API, DB, migration or packages change; leave, cancel and member-join controls and a member session detail page (O-1, O-2); the share page (O-3); pay-now, QR and bank detail; another person's debt; a venue before the seat is active; gender display; chat UI (L16); enabling dispatch or any projector row; the dev seed; decisions.md and Reviewed specs; MeFrame, app/me/layout.tsx, request-policy.ts and sessions-api.ts
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: L8 #68, L9 #70 and L10b #74 merged at 277b366af3a2b215c46aec242f6da945251fb483 (probes: their route files, section 1); DD-135 and DD-133 signed
PRIOR_SLICES: L8 p3-m9-join-core (#68), L9 p3-m9-me-reads (#70), L10b p3-m9-discovery-read (#74), L11 p3-m9-gender-pricing (#76)
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS # no migration and no API, DB or grant change; UI over merged routes whose server-side authorization stays authoritative (cookie actor, CSRF, session.manage re-checked); only re-checked route parameters are sent; opus/max code reviewer, no security round per the lane block
IMPLEMENTATION_ARTIFACTS: PASS
FIRST_IMPLEMENTATION_STEP: section 6 steps 1-2 - GitNexus impact on the session-error-ui.ts exports and SessionDetailView, then the describePlayerError tests in apps/web/lib/session-error-ui.test.ts and the discover-api and me-player-api tests red before writing apps/web/lib/discover-api.ts
REMAINING_BLOCKERS: none
```
