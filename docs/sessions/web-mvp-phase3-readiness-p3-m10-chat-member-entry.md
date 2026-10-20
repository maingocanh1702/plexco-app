<!-- review-readiness: code-ready -->

# Step-0 readiness: L16c p3-m10-chat-member-entry (session P3-S13c)

> Agent-facing contract for the L16c writers, the code reviewer and the security reviewer. Readiness reviewer: opus/max, the same
> model and effort as the lane's code reviewer. Writers: opus/max for W1-W4 (migration, DB tests, wrapper, route), sonnet/high for
> W5-W8 (seams, gate and pages, entry, e2e), one unit, file or section each (section 11). Code reviewer opus/max plus a security
> round opus/max, at most 3 rounds (pre-push rounds count), area-split from round 1. DD-122 D4: Codex waived by owner 2026-10-12;
> review by an independent Claude subagent. Every `path:line` is measured at BASE `9afb29356eb9a7dce2794554fdf9491b3f5d6d0b` (the
> merge of L16 #89; W = `.autopilot/worktrees/p3-m10-chat-member-entry`, branch `feat/p3-m10-chat-member-entry`; at step 0 HEAD =
> BASE and `git status --porcelain` is empty). TARGET_FILES (section 18) are read-only context that exists at BASE; every file to be
> created is listed in sections 11-12 and on the IN_SCOPE line, never in TARGET_FILES.
>
> Provenance: part A (R0-A: DB side and chat API, N/l16c-r0-part-a.md), part B (R0-B: web side, N/l16c-r0-part-b.md), the ruling
> request N/l16c-ruling-request-step0.md and the BINDING conductor ruling RO-L16c-1..4 (N/conductor-ruling-l16c-step0.md); part C
> (R0-C, this file) measured m1-m5, pinned the defaults and wrote the verdict. N = `Claude outputs/plexco-phase3/status/P3-S13c-notes`.
> m9doc = `docs/sessions/web-mvp-phase3-readiness-p3-m9-me-reads.md`. Short paths: `web/` = `apps/web/`, `db/` = `packages/db/src/`,
> `mig/` = `packages/db/migrations/`.

## 0. Threat model and security judgement (the migration header comment and the PR body carry items 1-6 as written)

The context route and its definer defend against:

1. Enumeration of clubs or memberships: the definer answers only for the caller's own ACTIVE membership; every deny is zero rows
   and one generic route body with the same status and shape.
2. Acting as another account: the account comes only from the verified session (`web/lib/me-route-gate.ts:17`, `:29`); no person,
   tenant, membership or account id is read from the client.
3. A tenant uuid reaching a non-member, a guest or a former member: every non-active state is zero rows (guests included, although
   chatGate's pre-gate admits guests: `db/session-join-service.ts:156`).
4. The client choosing the tenant for the chat API: unchanged; chatGate's live-membership pre-gate (`web/lib/chat-route.ts:204-208`)
   stays the one authorization; the context route is a convenience, never a grant (part A: matches
   `docs/features/BE/feature_player_messenger_tech.md:276`).
5. A timing or shape oracle between "unknown slug" and "not a member": the status, body and headers of every deny are
   byte-identical; the residual (an unknown slug skips one index probe, pin 1a) is review question R-1 (section 14): slugs are
   public handles, membership is the secret.
6. Caching of the context: `private, no-store` on the 200, every deny and the 500.

It does NOT defend against a compromised app tier, which already holds the session.

Judgement: P1 (a new app-granted SECURITY DEFINER on the identity surface, one migration, a new /api/me route, a raw tenant id in a
/me DTO under pin 1b). The security round (opus/max) is required.

## 1. Base, dependencies, authority

- BASE contains L16 #89 (BASE is its merge), L15a #87, L15 #86 and L14 #83 (HARD_DEPENDENCIES of the L16 readiness file, a
  TARGET_FILE); the /me reads are present (`mig/0059_me_player_reads_definers.sql`, `web/app/api/me/clubs/route.ts`). L16b
  (P3-S13b) is not a dependency; the lane that merges second catches up with `git merge --no-ff origin/main`.
- Owner: "Member chat ok" and "yes, add L16c before the P3-S14 closeout" (conductor terminal; status/OWNER-ANSWER-L16c.md), with two
  binding constraints: the AppShell admin gate stays unchanged; authorization stays server-side on the chat API.
- Q8 (part A): the chat API ADMITS an active plain member end to end, so the lane has no AWAIT: list T25
  `web/lib/chat-routes-db.test.ts:1267`; history T20 `:393`, K1 `:455`; send T3 `:508`, T4 `:524`; edit own T3 `:722`; delete own
  T12 `:796`; read marker T24 `:1532`; subscribe `web/lib/chat-stream-db.test.ts` N1 `:239`, S1 `:244`; a guest and a non-member get
  the one 403 (T2 `:234`; stream R1 `:219`). Guests pass the pre-gate (`db/session-join-service.ts:156`) and are refused one layer
  down: a club channel is readable only for an active membership (`mig/0031_chat_schema_core.sql:286-290`); every command joins an
  active membership (`mig/0063_chat_message_commands.sql:207-208` and six more sites); chat_members are provisioned on active by
  `trg_memberships_chat_provision` (`0063:629-632`, backfill `:153-165`). The member UI inherits L16's mapping of
  CHAT_CAPABILITY_REQUIRED (an admins_only channel, T7 `:622`) and TENANT_SUSPENDED (`:268`); a plain member's viewer flags are false
  (T25), so no admin control renders.
- decisions.md queries (part A, logged; `grep -c -F`, then the governing hits read): `club_ref` 0; `clubRef` 1 (`:1389`: the slug is
  the member-facing key); `tenant id` 3 (`:495`, `:1063`, `:1122`; none governs member exposure); `DD-56` 32 (the admin capability
  registry); a targeted regex gave 16 lines, only `:541` relevant (DD-38: tenant-private club channels). No DD forbids or authorizes
  returning a member its own club's tenant uuid; the governing text is M-11 (m9doc `:287`) plus
  `docs/features/BE/feature_player_view_tech.md:278`, `:287`.

## 2. Conductor ruling RO-L16c-1..4 (binding; N/conductor-ruling-l16c-step0.md)

- RO-L16c-1: the narrow new definer (section 3), migration 0066, with pin 1a (the loop-free single-tenant form) and pin 1b (a SCOPED
  exception to M-11) approved. Rejected with measured cost (part A Q1(d)): A, extend `account_my_clubs` (a RETURNS TABLE change =
  DROP + CREATE + re-grant, 19 caller lines in 6 files, breaks the A-9 exact keys, tenant ids for GUEST memberships = lane STOP);
  B, the chat routes take a slug (6 route files through chatGate/readTenantParam `web/lib/chat-route.ts:184`, plus
  `web/lib/realtime-auth.ts:152-162` and the L16b-owned chat-api.ts = lane STOP). The one fact that would change it: an owner
  reversal of M-11 for `/api/me/clubs`.
- RO-L16c-2: `web/components/player/player-page.tsx` joins the lane's files (section 8).
- RO-L16c-3: files cap 26, counted as b3-measure.sh counts (this .md and the 3 pin files included); line caps unchanged (section 12).
- RO-L16c-4: every measured correction accepted (14 pins, not 11; 401 and 429 carry the gate's `no-store`; the zone seam through
  TenantZoneContext, not a chat-component prop; the basePath seam on two lines; the tenant-lang "b" row; the guest pre-gate note; the
  note-6 URL reading; the golden member leg as its own block; the chat.spec.ts:124 title as OPEN) and the defaults of section 13.

## 3. The definer (W1): NEW `mig/0066_account_club_chat_context.sql`

The tail at BASE is `0065_chat_message_author_label.sql` (part A Q7); 0066 is the next free number (W1 re-measures it).

- Signature: `public.account_club_chat_context(p_account_id uuid, p_club_ref text) RETURNS TABLE (tenant_id uuid, timezone text)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp`; `#variable_conflict use_column`
  (`0059:53`); every relation `public.`-qualified and every column alias-qualified (the OUT names equal real column names); no RAISE,
  no dynamic SQL (m9doc 4.1 rule 5 `:166-167`). VOLATILE because of set_config.
- Copy from `mig/0059_me_player_reads_definers.sql`: the header shape (ownership and FORCE RLS `:20-27`; the never-read list and the
  attributes `:38-43`; "functions are not mirrored" `:5-6`, so no schema.ts or db.dbml edit: part A Q1(e) grep 0 hits);
  `account_my_clubs` `:46-79`: DECLARE with `v_prev := current_setting('app.tenant_id', true)` `:54-57`; the person resolution
  `:59-64` (`public.accounts a JOIN public.persons p ON p.id = a.person_id AND p.status = 'active' WHERE a.id = p_account_id`, then
  `IF v_person IS NULL THEN RETURN`: a NULL, unknown or person-less account and a merged or deleted person give zero rows); the
  set_config `:66`; the restore `coalesce(v_prev, '')` `:75`; the ACL `:78-79` (two statements: REVOKE ALL FROM PUBLIC, GRANT
  EXECUTE TO app).
- Pin 1a (RO-L16c-1): replace the loop `:65-74` with ONE `SELECT t.id, t.timezone INTO v_tenant, v_tz FROM public.tenants t WHERE
  t.slug = p_club_ref` (slug UNIQUE `mig/0002_tenants_core.sql:14`; timezone NOT NULL with a default `:18`; tenants has no RLS);
  `IF v_tenant IS NULL THEN RETURN` before any set_config (a NULL or malformed slug matches nothing); ONE
  `set_config('app.tenant_id', v_tenant::text, true)`; `RETURN QUERY SELECT v_tenant, v_tz FROM public.memberships m WHERE
  m.tenant_id = v_tenant AND m.person_id = v_person AND m.status = 'active'` (at most one row, m5: `CREATE UNIQUE INDEX
  memberships_active_person_unique ON memberships(tenant_id, person_id) WHERE status IN ('active','guest')`,
  `0002_tenants_core.sql:35-37`); then restore the caller's previous GUC on the single exit. The migration comment states: this
  deviates from M-14's literal per-tenant loop (m9doc `:292`) only because there is exactly one tenant by construction.
- Owner: the migration role, as the 0059 definers have it (no OWNER TO in 0059: grep 0 hits; m9doc ruling D3 `:15`, `:371-372`); no
  new role, no identity_definer. The new tests name no definer role, so they need no extra lock (part A Q7).
- Header never-read list: never reads tenant_admins, a name, phone, display_name, pay_code or any `*_enc` column (m9doc 4.1 rule 7
  `:169-170`); takes no person, tenant or membership id; returns no person or membership id; then the threat model of section 0.
- No tenant-status filter (M-16, m9doc `:295`): a suspended club surfaces through the chat API's TENANT_SUSPENDED (section 1).

### 3.1 Decision table (a deny is zero rows, never an error; NEW `db/account-club-chat-context.test.ts`, setupRlsTestContext as `db/me-player-reads.test.ts:14`)

| # | Input | Expected | Test |
|---|---|---|---|
| D1 | the account's active person has an ACTIVE membership in the club whose slug is p_club_ref | exactly one row: tenants.id, tenants.timezone | CC-1 |
| D2 | a guest membership | 0 rows | CC-2 |
| D3 | a left membership | 0 rows | CC-3 |
| D4 | a merged membership | 0 rows | CC-4 |
| D5 | no membership in an existing club | 0 rows | CC-5 |
| D6 | an unknown well-formed slug; malformed slugs (`'Dev Club'`, `''`, 64 characters) | 0 rows each | CC-6 |
| D7 | NULL p_account_id; NULL p_club_ref | 0 rows each, no error | CC-7 |
| D8 | a merged person; a deleted person; an account with no person; an unknown account | 0 rows each | CC-8 |
| D9 | active in clubs X and Y, asking for X | X's row only, never Y's | CC-9 |
| D10 | the caller's `app.tenant_id` (unset, and set to another tenant) after a hit and after each deny | the previous value | CC-10 |
| D11 | catalog: prosecdef true, provolatile 'v', lanname plpgsql, args `p_account_id uuid, p_club_ref text`, owner = person_profile_read's owner, proconfig `['search_path=pg_catalog, public, pg_temp']` (A-12 analog, `db/me-player-reads.test.ts:190-215`) | asserted | CC-11 |
| D12 | ACL: has_function_privilege true for app, false for app_worker and readonly; proacl explicit; no PUBLIC grantee; the EXECUTE grantees exactly [owner, app] (A-13 analog, `:217-238`) | asserted | CC-12 |
| D13 | the result columns exactly `tenant_id uuid, timezone text` (exact keys, the A-9 pattern `:591`); prosrc names no tenant_admins, display_name, phone, pay_code or `_enc` | asserted | CC-13 |
| D14 | a NOBYPASSRLS migration owner (A-14 analog, `db/me-player-reads-nobypass.test.ts`, inside its existing withJobDefinerLock block `:30-35`): D1 still one row, D5 still none | asserted | CC-14 |

## 4. The wrapper (W3): `db/me-player-reads.ts` and the export block `packages/db/src/index.ts:280-293`

`readMyClubChatContext(pool, accountId, clubRef): Promise<{ tenantId: string; timezone: string } | null>` (a Tier-A name in the
`listMyClubs` and `readMyCharges` family): one `pool.query` of `SELECT c.tenant_id, c.timezone FROM
public.account_club_chat_context($1, $2) c` with `[accountId, clubRef]`; 0 rows -> null; 1 row -> camelCase (the toDto pattern
`:96-104`); more than 1 row -> throw (fail closed; the unique index makes it unreachable). No logging (the file has 0 log hits, part A
Q1(c)); the slug is never logged with the account. Tests in their own describe of the W2 file: CW-1 real DB, an active member ->
`{tenantId, timezone}`; CW-2 a deny -> null; CW-3 a pg-shaped stub `{ rows: [a, b] }` -> throws; CW-4 the stub receives exactly that SQL
and `[accountId, clubRef]`.

## 5. The route (W4): NEW `web/app/api/me/clubs/[clubRef]/chat-context/route.ts`

Copy `web/app/api/me/clubs/route.ts:6-23` (PRIVATE = `"private, no-store"` `:6`; resolveMeGate for a GET with `csrf: false` `:15`;
the bucket `:16`; `ok(data, { headers: PRIVATE })` `:20`; the log holds the route template and the error NAME only `:22`; the 500 is
a null body with PRIVATE `:23`). Order: `resolveMeGate` first (the account only from `currentSession()`,
`web/lib/me-route-gate.ts:17`; 401 AUTH_REQUIRED `:18`; `actorThrottled` `:24`; the bucket `${name}:${accountId}` `:25-27`, 429
RATE_LIMITED) with the bucket `me-chat-context-read`, 20 per 60 s; then the awaited `params.clubRef` tested with the existing
`SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}$/` (`web/lib/new-club-form.ts:4`; no case-folding) BEFORE any DB call; then
`readMyClubChatContext(pool, accountId, clubRef)`. No person, tenant, membership or account id is read from the query, the body or a
header.

- 200: `ok({ tenantId, timezone }, { headers: PRIVATE })`, exactly these two keys.
- Deny (m1): ONE module-level `deny()` for every deny path: `err("NOT_FOUND", t("Không tìm thấy.", "Not found."), 404)` (an
  EXISTING code, `packages/core/src/api-contract.ts:151`; the /me precedent `web/app/api/me/profile/route.ts:28` returns
  `err("NOT_FOUND", ..., 404)`), its Cache-Control set route-locally to PRIVATE (err() sets `no-store` only,
  `web/lib/api-envelope.ts:11`, `:14-16`; api-envelope.ts stays unchanged).
- 500: any throw -> `new Response(null, { status: 500, headers: { "cache-control": PRIVATE } })` as `:23`; the log line carries the
  route template and the error name only (no slug, account or tenant id).
- 401 and 429 come from the shared gate with its `no-store` (RO-L16c-4; the gate is unchanged); 403 CSRF_INVALID is unreachable on
  a GET with `csrf: false`.

### 5.1 Route table (NEW `.../chat-context/route.test.ts`: real DB with the setup of `web/lib/chat-routes-db.test.ts`, `actor()` `:123-126`; the wrapper wrapped in a pass-through `vi.fn` via `importOriginal` for the no-DB and the 500 rows)

| # | Case | Expected | Test |
|---|---|---|---|
| R1 | an active member, a valid slug | 200 with exactly `{tenantId, timezone}` = the club's id and tenants.timezone; `private, no-store` | CR-1 |
| R2 | guest; left; no membership; an unknown well-formed slug; a session account whose person is merged or absent | 404 NOT_FOUND, the one deny; `private, no-store` | CR-2 |
| R3 | malformed slugs (`Dev-Club`, `-x`, 64 characters, `a%2Fb`) | the same deny; the wrapper is never called (no DB) | CR-3 |
| R4 | every R2 and R3 response compared | status, body bytes and Cache-Control byte-identical across all deny kinds | CR-4 |
| R5 | active in clubs X and Y, asking for X | X's tenantId only | CR-5 |
| R6 | `?tenant=`, `?account=`, `?person=` and an `x-tenant-id` header added to R1 and to one R2 case | ignored: the same R1 body and the same deny | CR-6 |
| R7 | no session | 401 AUTH_REQUIRED, `no-store` (the gate) | CR-7 |
| R8 | the 21st call within 60 s for one account | 429 RATE_LIMITED, `no-store` (the gate); me-clubs-read is a separate bucket | CR-8 |
| R9 | the wrapper throws | 500, null body, `private, no-store`; the logged text holds no slug, account or tenant id | CR-9 |

Inventory (W4): add `"app/api/me/clubs/[clubRef]/chat-context/route.ts": "b"` to SURFACE_BUCKETS (`web/lib/tenant-lang.test.ts:113`,
next to the /me entries near `:174`); the walker takes every `app/**/route.ts` (`:302-317`) and fails an unclassified one
(`:333-341`). Pages and components are not walked. No rate-bucket registry exists and no request-policy edit is needed (the web role
allows every path, `web/lib/request-policy.ts:45-48`, `:55-62`).

## 6. The two seams (W5; the RO-L16c-4 scope, nothing more)

GitNexus impact answered "Target not found" for useTenantContext, ChannelList, ChannelView and ListView (the index does not hold
them, part B Q3), so the impact is the grep fallback below; W5 re-runs impact first and records the answer.

- basePath: an optional `basePath` prop with the default `` `/c/${tenantId}/chat` `` on ChannelList (props
  `web/components/chat/channel-list.tsx:30-32`) and ChannelView (props `web/components/chat/channel-view.tsx:13-21`), used ONLY at
  `channel-list.tsx:60` (`` href={`/c/${tenantId}/chat/${channel.id}`} `` -> `` href={`${basePath}/${channel.id}`} ``) and
  `channel-view.tsx:29` (`` href={`/c/${tenantId}/chat`} `` -> `href={basePath}`); +4/-4 gross; nothing else in those files (L16b
  owns the rest). No other `/c/` link exists in components/chat or the chat libs ("Sign in again" points to "/",
  `channel-list.tsx:50`, `channel-view.tsx:48`). Blast radius LOW: ChannelList `web/app/c/[tenantId]/chat/page.tsx:9` and
  `web/components/chat/channel-list.test.tsx:20`; ChannelView `web/app/c/[tenantId]/chat/[channelId]/page.tsx:13`.
- Zone: `web/lib/use-tenant-context.ts` exports `TenantZoneContext = createContext<string | undefined>(undefined)`; inside the hook
  `const zoneOverride = useContext(TenantZoneContext);` is its own unconditional statement (never `?? useContext(...)`); `:21` becomes
  `resolveTimeZone(tenant?.timezone ?? zoneOverride)`; `zoneOverride` joins the memo deps (`:22-25`). About +5 gross lines, 0
  call-site edits. Exactly what changes: one export, one statement, one expression, one dependency; without a provider (the admin
  path) the value is the old one. Blast radius LOW (signature and default unchanged): `web/components/chat/message-list.tsx:37`
  (zone; L16b-owned, not edited), `web/lib/use-chat.ts:438` (csrfToken; L16b-owned, not edited),
  `web/components/sessions/edit-session-view.tsx:23`, `new-session-view.tsx:21`, `session-detail-view.tsx:37`; the mocks
  `web/components/chat/message-list.test.tsx:11` and `web/components/sessions/request-inbox.test.tsx:40`. Measured correction: the
  three sessions views have NO unit test file at BASE (`git ls-files`); the tests that must stay green unchanged are those two mocks,
  the sessions e2e specs and the full web vitest.
- Regression tests (W5 creates NEW `web/components/player/member-chat-gate.test.tsx` with a describe "seams"): TZ-1 a session tenant
  with zone X and no provider -> X; TZ-2 an unknown tenant and no provider -> the default zone; TZ-3 no session tenant (a member
  session lists `tenants: []`) and a provider Y -> Y; TZ-4 a session tenant X and a provider Y -> X; BP-1 ChannelList without
  basePath -> `/c/<id>/chat/<channelId>`; BP-2 ChannelView without basePath -> the back link `/c/<id>/chat`; BP-3 and BP-4 the same
  two with the member basePath -> `/me/clubs/<slug>/chat/<channelId>` and `/me/clubs/<slug>/chat`. The chat hooks are mocked as
  `channel-list.test.tsx` mocks them, and every mock returns a shape the real hook returns.

## 7. The gate component and the two pages (W6)

NEW `web/components/player/member-chat-gate.tsx` ("use client"; props `{ clubRef: string; channelId?: string }`):

- Fetch: `apiFetch<{ tenantId: string; timezone: string }>` of `` `/api/me/clubs/${encodeURIComponent(clubRef)}/chat-context` `` with
  `{ signal }`. m2: ApiFetchInit accepts `signal` (`interface ApiFetchInit extends Omit<RequestInit, "body" | "credentials" |
  "cache">`, `web/lib/api-client.ts:41`; apiFetch `:55`); neither api-client.ts nor `web/lib/me-player-api.ts` holds a timeout
  helper (grep `timeout|AbortController|signal`: no other hit), so the gate owns one AbortController with a 15 s `setTimeout`, cleared
  on settle and aborted on unmount (no state update after unmount). W6 reads how apiFetch reports a non-2xx (`:55` onward) before
  mapping it.
- Ready: `<TenantZoneContext.Provider value={timezone}>` around `<ChannelList tenantId={tenantId} basePath={base} />`, or
  `<ChannelView tenantId={tenantId} channelId={channelId} basePath={base} />` when channelId is set, with base =
  `` `/me/clubs/${encodeURIComponent(clubRef)}/chat` ``. The csrfToken (`web/lib/use-tenant-context.ts:20`) and the language (`:18`,
  MeFrame's LangProvider `web/components/me/me-frame.tsx:28-37`) need no seam.
- Landmark: every state renders inside one `<main>` (MeFrame's `div#main-content` is not a main and each /me page owns its main,
  `me-frame.tsx:25-26`; ChannelList and ChannelView render a div, `channel-list.tsx:38`, `channel-view.tsx:27`).
- Privacy: the tenant id lives only in component state; no storage, URL, console or analytics write.

States (fail closed; the client renders its own pair and never the server message):

| Fetch outcome | State | Copy |
|---|---|---|
| pending | loading | t("Đang tải…", "Loading…") (existing) |
| 200 with exactly a uuid-shaped string `tenantId` and a non-empty string `timezone` | ready | the L16 components |
| 200 with any other shape | error + retry | as the error row |
| 404 | denied | t("Bạn không mở được trò chuyện của CLB này.", "You cannot open this club's chat.") (new) |
| 401, 403, 429, 5xx, a network error, the 15 s abort | error + retry | t("Không tải được trò chuyện.", "Could not load the chat.") (new) + button t("Thử lại", "Retry") (existing) |

Tests (W6, describe "MemberChatGate" in the W5 file; every mocked response is the real envelope of `web/lib/api-envelope.ts`): CG-1
loading; CG-2 a 404 -> denied, in vi and in en; CG-3 a 500 -> error, Retry refetches; CG-4 a network error -> error; CG-5 the 15 s
abort (fake timers) -> error; CG-6 a 200 with an extra key, a missing key or a non-uuid tenantId -> error; CG-7 ready renders
ChannelList with the route's tenantId and the member hrefs; CG-8 channelId set -> ChannelView with the back link to the member list;
CG-9 the provider reaches useTenantContext (the zone used is the route's); CG-10 the fetch path encodes clubRef; CG-11 an unmount
aborts with no state update; CG-12 no localStorage or sessionStorage write; CG-13 exactly one `<main>` in every state.

Pages (Server Components that take only the params; no DB, no `next/headers`, no session read; the /me layout already gates,
`web/app/me/layout.tsx:12-15`): NEW `web/app/me/clubs/[clubRef]/chat/page.tsx` -> `<MemberChatGate clubRef={clubRef} />` and NEW
`web/app/me/clubs/[clubRef]/chat/[channelId]/page.tsx` -> `<MemberChatGate clubRef={clubRef} channelId={channelId} />`, each a copy
of `web/app/c/[tenantId]/chat/[channelId]/page.tsx:7-13` (params is a Promise and is awaited; no metadata). No test forbids DB access
in app/me (`web/app/c/server-boundary.test.ts` covers app/c only, ROOT `:17`); the pages follow that rule anyway.

## 8. The Row action and the Chat entry (W7; RO-L16c-2)

- `web/components/player/player-page.tsx`: the Row type (`:118-123`) gains one optional `action?: ReactNode`; the card (`:140-154`)
  renders it only when set (about +3 lines). Exactly what changes: one optional field and one conditional render; a row without
  `action` renders the same elements as before. Callers (grep; GitNexus "Target not found"): `my-clubs-view.tsx:16`,
  `my-requests-view.tsx:19`, `my-sessions-view.tsx:26`; LOW.
- `web/components/player/my-clubs-view.tsx`: a row whose `membershipStatus === "active"` exactly gets an `action` link to
  `` `/me/clubs/${encodeURIComponent(club.clubRef)}/chat` `` labelled t("Trò chuyện", "Chat") (existing, `channel-list.tsx:39`); a
  guest or an unknown status gets none (fail closed). The row key stays clubRef and the slug is never shown (`:12`, `:23`). No nav
  change (MeFrame nav `me-frame.tsx:82-86`).
- Tests (m4: the MyClubsView tests are in `web/components/player/player-views.test.tsx`, describe "MyClubsView" `:107`, render
  `:115`; MyRequestsView `:155`; MySessionsView in `web/components/player/my-sessions-view.test.tsx`, describe `:46`): CE-1 an active
  row shows the Chat link with that href; CE-2 a guest row has none; CE-3 an unknown status has none; CE-4 the vi and en labels;
  CE-5 MyRequestsView rows render no action (`player-views.test.tsx:155`); CE-6 MySessionsView rows render no action
  (`my-sessions-view.test.tsx:46`). The existing cases of both files stay unchanged and green.

## 9. e2e (W8)

NEW `web/e2e/member-chat.spec.ts` (mocked, CI-run like chat.spec.ts; it imports the L16b-owned support and never edits it):
`installChatApi(page, replies, { persona: "member" })` (`web/e2e/support/chat-api-mock.ts:160-174`: the member session lists
`tenants: []` `:116-118`; ready(false) `:171-174`; an unstubbed /api/chat path returns 500 `:16`); the ME-1 clubs mock (an active
"club-e2e" and a guest "club-e2e-2", `web/e2e/support/player-api-mock.ts:269-274`, ready `:363`); an inline `page.route` stub for
`/api/me/clubs/*/chat-context` in the real envelope (the answer() shape, `chat-api-mock.ts:96-108`): 200 `{tenantId, timezone}` with
the tenant uuid the chat mock serves for club-e2e, the one 404 NOT_FOUND body for club-e2e-2 and for an unknown slug, both
`private, no-store`.

- ME-1 /me/clubs: the active row has the Chat entry, the guest row none.
- ME-2 the entry opens /me/clubs/club-e2e/chat: the channel list renders and its links point under /me/clubs/club-e2e/chat/.
- ME-3 open a channel and send: the message shows.
- ME-4 live: a pushed event shows without a reload (the mechanism of chat.spec.ts's live case).
- ME-5 deny: /me/clubs/club-e2e-2/chat and /me/clubs/no-such-club/chat show the denied copy and send no /api/chat request.
- ME-6 privacy as `web/e2e/chat.spec.ts:179-186`: the page URL and the history carry the slug and the channel id only; no tenant uuid
  or message text in the console, CacheStorage, localStorage or sessionStorage.
- ME-7 unchanged: `chat.spec.ts:124-134` (a plain member gets the shell's No access on /c/**) stays as it is, and green.

`web/e2e/golden-path.spec.ts` (local only, `web/e2e/golden-path.config.ts`, never CI): a NEW test block after L16's chat test
(`:378-440`, whose body stays untouched). The admin on `page`, the player persona in `browser.newContext()` through signInAsPersona
(`web/e2e/support/golden-path-helpers.ts:150-160`; the persona `web/lib/dev-login/personas.ts:34-35`, adminGrant null; its Dev Club
membership `web/lib/dev-login/seed.ts:21`, `:148`; the slug DEV_CLUB "dev-club" `personas.ts:43`). Binary pre-check: the player's
/me/clubs shows the Dev Club row with "Thành viên" (`golden-path.spec.ts:326-338`), else skip with the NOT RUN reason (the pattern
`:267`). GP-M1: the member sends in /me/clubs/dev-club/chat and the admin sees it live in the club's /c/ chat; GP-M2 the reverse.
Run once at the final head, or NOT RUN with the reason in the PR body.

## 10. The 14 migration-tail pins (W1; mechanical; listed apart in the PR body with before and after; measured at BASE)

| # | File:line | Before | After |
|---|---|---|---|
| 1 | `db/migrate.test.ts:53` | `const MIGRATION_COUNT = 66; // 0000..0065 (0065 chat message author label) (0064 ...` | `const MIGRATION_COUNT = 67; // 0000..0066 (0066 account club chat context) (0065 chat message author label) (0064 ...` (rest unchanged) |
| 2 | `db/migrate.test.ts:769` | `.toBe("0065_chat_message_author_label.sql");` | `.toBe("0066_account_club_chat_context.sql");` |
| 3 | `db/rls-invariants.test.ts:70` | `.toBe(66); // 0000..0065 (0065 chat message author label, 0064 ...` | `.toBe(67); // 0000..0066 (0066 account club chat context, 0065 chat message author label, 0064 ...` (rest unchanged) |
| 4 | `db/rls-invariants.test.ts:73` | `expect(second.skipped.length).toBe(66);` | `expect(second.skipped.length).toBe(67);` |
| 5 | `db/rls-invariants.test.ts:1825` | `expect(res.applied.length).toBe(66); // 0000..0065` | `expect(res.applied.length).toBe(67); // 0000..0066` |
| 6 | `db/rls-invariants.test.ts:1830` | `expect(rows.length).toBe(66);` | `expect(rows.length).toBe(67);` |
| 7 | `db/rls-invariants.test.ts:2108` | `.toBe("0065_chat_message_author_label.sql");` | `.toBe("0066_account_club_chat_context.sql");` |
| 8 | `db/rls-invariants.test.ts:4701` | `it("UCC-8: MIGRATION_COUNT (66) matches the actual migrations/ directory listing, and the tail is 0065", ...` | the same title with `(67)` and `the tail is 0066` |
| 9 | `db/rls-invariants.test.ts:4703` | `expect(files.length).toBe(66);` | `expect(files.length).toBe(67);` |
| 10 | `db/rls-invariants.test.ts:4704` | `expect(files[files.length - 1]).toBe("0065_chat_message_author_label.sql");` | `expect(files[files.length - 1]).toBe("0066_account_club_chat_context.sql");` |
| 11 | `db/outbox-projector-registry.test.ts:114` | `it("A1: 66 migrations apply with tail 0065 and re-run idempotently", ...` | `it("A1: 67 migrations apply with tail 0066 and re-run idempotently", ...` |
| 12 | `db/outbox-projector-registry.test.ts:115` | `expect(ctx.migrateResult.applied.length).toBe(66);` | `expect(ctx.migrateResult.applied.length).toBe(67);` |
| 13 | `db/outbox-projector-registry.test.ts:117` | `expect(ctx.migrateResult.applied.at(-1)).toBe("0065_chat_message_author_label.sql");` | `expect(ctx.migrateResult.applied.at(-1)).toBe("0066_account_club_chat_context.sql");` |
| 14 | `db/outbox-projector-registry.test.ts:120` | `expect(again.skipped.length).toBe(66);` | `expect(again.skipped.length).toBe(67);` |

Comment-only mentions of 0065 need no edit (`db/chat-read.test.ts:339`, `:346`; `db/chat-service.test.ts:278`;
`db/chat-service.ts:180`; `packages/core/src/api-contract.ts:247`). The pin edits are counted apart from the line estimate; their
three files count toward the file cap (RO-L16c-3).

## 11. Writer units (in this order; one unit, file or section per worker; each ends its turn right after its commit and hand-off)

Every unit: GitNexus impact before editing a symbol (the grep fallback of sections 6 and 8 when it answers "Target not found") and
detect_changes before every commit; the FULL web vitest after every unit that touches web code, tests or mocks; DB runs under the lock.

| Unit | Model | Files | Tests |
|---|---|---|---|
| W1 | opus/max | NEW `mig/0066_account_club_chat_context.sql`; the 14 pins in `db/migrate.test.ts`, `db/rls-invariants.test.ts`, `db/outbox-projector-registry.test.ts` (section 10) | the pin tests green; the migration applies after `pnpm db:bootstrap` |
| W2 | opus/max | NEW `db/account-club-chat-context.test.ts`; EDIT `db/me-player-reads-nobypass.test.ts` (one case in its locked block) | CC-1..CC-14 (incl. the A-12/A-13 analogs CC-11, CC-12 and the nobypass case CC-14) |
| W3 | opus/max | EDIT `db/me-player-reads.ts` (wrapper), `packages/db/src/index.ts` (export block `:280-293`); a describe in the W2 file | CW-1..CW-4 |
| W4 | opus/max | NEW `web/app/api/me/clubs/[clubRef]/chat-context/route.ts` and `route.test.ts`; EDIT `web/lib/tenant-lang.test.ts` ("b" row) | CR-1..CR-9; the tenant-lang walker |
| W5 | sonnet/high | EDIT `web/lib/use-tenant-context.ts`, `web/components/chat/channel-list.tsx` (`:60` + the prop), `web/components/chat/channel-view.tsx` (`:29` + the prop); NEW `web/components/player/member-chat-gate.test.tsx` (describe "seams") | TZ-1..TZ-4, BP-1..BP-4 |
| W6 | sonnet/high | NEW `web/components/player/member-chat-gate.tsx`, `web/app/me/clubs/[clubRef]/chat/page.tsx`, `web/app/me/clubs/[clubRef]/chat/[channelId]/page.tsx`; the describe "MemberChatGate" in the W5 file | CG-1..CG-13 |
| W7 | sonnet/high | EDIT `web/components/player/player-page.tsx`, `my-clubs-view.tsx`, `player-views.test.tsx`, `my-sessions-view.test.tsx` | CE-1..CE-6 |
| W8 | sonnet/high | NEW `web/e2e/member-chat.spec.ts`; EDIT `web/e2e/golden-path.spec.ts` (a new block) | ME-1..ME-7 (Playwright under the lock); GP-M1, GP-M2 (local, once at the final head, or NOT RUN) |

## 12. B3 budget (RO-L16c-3)

Caps: non-test 800, test 1,300, total 2,100 (gross added lines, comments included, counted as b3-measure.sh counts: `*.test.ts(x)`
and `*.spec.ts` are test; `.module.css` and `e2e/support/*.ts` are non-test); files 26, counting every changed file as b3-measure.sh
does (this .md and the 3 pin files included); 1 migration; named-finding allowance +40 non-test and +80 test (each fix group listed in
the PR body; a file added by a NAMED review fix may exceed 26 only if named with its finding). Report point (90%): 720 / 1,170 /
1,890 or 23 files; if the measured projection then exceeds a cap, there is no raise: stop the remaining units and propose a split.

| Unit | Non-test | Test |
|---|---|---|
| W1 migration (the 14 pins counted apart: +14/-14) | 70 | 0 |
| W2 DB tests (decision rows 110, catalog and ACL 55, seeds 40, GUC 15, nobypass 35) | 0 | 255 |
| W3 wrapper 25 + export 5; wrapper tests | 30 | 25 |
| W4 route; route test 140; tenant-lang row 1 | 45 | 141 |
| W5 seams (zone 5, basePath 4); seam tests | 9 | 60 |
| W6 gate 90, pages 26; gate tests | 116 | 75 |
| W7 Row action 3, entry 8; tests | 11 | 35 |
| W8 member spec 130; golden leg 50 | 0 | 180 |
| CSS allowance (only if no existing class fits) | 10 | 0 |
| **Total** | **~291 of 800** | **~771 of 1,300** |

Total ~1,062 of 2,100. Files: 25 planned (DB 8: the migration, the 3 pin files, the new DB test, the nobypass test,
me-player-reads.ts, index.ts; web 16: the route and its test, tenant-lang.test.ts, use-tenant-context.ts, channel-list.tsx,
channel-view.tsx, member-chat-gate.tsx and its test, the 2 pages, player-page.tsx, my-clubs-view.tsx, player-views.test.tsx,
my-sessions-view.test.tsx, member-chat.spec.ts, golden-path.spec.ts; and this .md) plus the CSS allowance = 26 of 26. Coherence: one
outcome (a member opens the club chat) across DB, route and UI; a split would ship a definer and a route with no consumer, or a UI
with no context source.

## 13. Defaults (Tier B; each "default applied, pending owner sign-off" in the PR body with its source)

| # | Default | Source |
|---|---|---|
| DF-1 | GET /api/me/clubs/[clubRef]/chat-context with the keys {tenantId, timezone} | lane DEFAULTS; RO-L16c-4 |
| DF-2 | the bucket me-chat-context-read, 20 per 60 s (mirrors me-clubs-read, `web/app/api/me/clubs/route.ts:16`) | RO-L16c-4 |
| DF-3 | the slug checked with the existing SLUG_RE (`web/lib/new-club-form.ts:4`) before any DB call; a malformed slug gets the same deny | RO-L16c-4 |
| DF-4 | every deny is 404 NOT_FOUND (existing, `packages/core/src/api-contract.ts:151`; precedent `web/app/api/me/profile/route.ts:28`) with the one pair t("Không tìm thấy.", "Not found.") (new; envelope only, the gate never shows it) | m1; RO-L16c-4 |
| DF-5 | the 200, every deny and the 500 carry `private, no-store`; 401 and 429 carry the shared gate's `no-store` | RO-L16c-4 |
| DF-6 | pin 1a, the loop-free single-tenant definer form | RO-L16c-1 |
| DF-7 | pin 1b, a scoped exception to M-11: a raw tenant id in a /me DTO only from this route and only for the caller's own ACTIVE membership; it grants nothing | RO-L16c-1 |
| DF-8 | guests get no chat entry and no context (chatGate admits guests at the pre-gate; they are refused one layer down) | lane DEFAULTS; RO-L16c-4 |
| DF-9 | the zone from tenants.timezone (`mig/0002_tenants_core.sql:18`) through TenantZoneContext; the language from MeFrame's LangProvider | lane DEFAULTS; RO-L16c-4 |
| DF-10 | the Chat entry on clubs rows whose status is exactly active, t("Trò chuyện", "Chat") (existing, `channel-list.tsx:39`) | RO-L16c-4 |
| DF-11 | the gate copy of section 7 (loading and Retry existing; denied and error new) | RO-L16c-4 |
| DF-12 | the member paths /me/clubs/[clubRef]/chat and /me/clubs/[clubRef]/chat/[channelId]; the basePath `/me/clubs/<encoded slug>/chat` | lane GOAL proposal |
| DF-13 | the gate's 15 s fetch timeout (no shared helper exists, m2) | part B estimate |
| DF-14 | no storage; the page URL carries the slug and the channel id only | RO-L16c-4 |

## 14. Review plan: named questions (code reviewer and security round, opus/max, area-split)

- R-1 (pin 1a, timing): can the residual difference (an unknown slug skips one index probe) become an oracle through the route? The
  status, body and headers of every deny are byte-identical (CR-4); slugs are public handles (discovery lists them), membership is
  the secret.
- R-2 (pin 1b, the M-11 exception): the tenantId leaves only from this route and only for the caller's own ACTIVE membership; never
  cached (`private, no-store`), never logged, never for a guest, never for another club (CC-2, CC-9, CR-2, CR-5).
- R-3 (the guest note): chatGate's pre-gate admits guests (`db/session-join-service.ts:156`); the context route never gives a guest
  the uuid; the PR body says so.
- R-4 (note 6, the URL reading): the PAGE URL and the history carry the slug and the channel id only; the fetches to
  `/api/chat/*?tenant=<uuid>` are the unchanged L16 contract and nothing logs or stores a request URL client-side. m3: the service
  worker never intercepts `/api/*` (`web/sw/sw.template.js:62`) and its navigation branch is network-only, `fetch(request).catch(()
  => offlineFallback(request))` (`:64-67`), with no cache write; a failed navigation gets the precached /offline page with the
  requested path injected in memory (`offlineFallback` `:77`). /me navigations are not cached.
- R-5 (seam question 1): no unit test feeds an object where the real producer passes a string: the page params are awaited strings;
  clubRef is a string; the TenantZoneContext value is the route's timezone string; the gate parses the payload exactly as the route
  returns it.
- R-6 (seam question 2, mocked shapes): every mocked session, member and response is a shape the real API returns (a member session
  lists `tenants: []`; the chat-context stub uses the route's real envelope; the clubs mock is ME-1).
- R-7 (default-preserving seams): the basePath default equals the old string; no provider on the admin path; the sessions-view
  consumers and the two mocks green unchanged; TZ-1, TZ-2, BP-1, BP-2.
- R-8 (the definer's ACL, owner and attributes): CC-11, CC-12, CC-13; exactly the two ACL statements; no table, column, index,
  trigger, policy or role change.
- R-9 (the admin gate untouched): `git diff --name-only BASE..HEAD` names no `web/components/shell/` file (AppShell and ShellGate), no
  `web/app/api/auth/session/route.ts`, no `mig/0037_tenant_provision_rls_self_scope.sql` (tenant_ids_for_person `:65`), no chat API
  route and no L14 or L15 migration; ME-7 green.
- R-10 (the claims the comments make): each claim in the migration header maps to a test id.
- R-11 (privacy): no content, label, slug-with-account or tenant uuid in a log, storage or cache: grep the diff for `console.`,
  `logger`, `localStorage`, `sessionStorage` and `caches.`.

## 15. Verification (every log through `| tail -40`; DB and Playwright runs only under the lock `status/.db-e2e.lock` via locked-run.sh)

- `pnpm typecheck`; `pnpm lint`; `pnpm format:check`; `pnpm review:check:changed`; `pnpm build` (once at the final head, sandbox off).
- `NODE_ENV=test pnpm --filter @plexco/web test` (the FULL web vitest after every web unit).
- `NODE_ENV=test DATABASE_URL_TEST=... pnpm --filter @plexco/db test` and `NODE_ENV=test DATABASE_URL_TEST=... pnpm -w test` (one
  migration at a time; `pnpm db:bootstrap` as superuser first on an older DB; the password step re-run after a full run).
- `pnpm --filter @plexco/web exec playwright test` (member-chat.spec.ts and chat.spec.ts); the golden path locally only.
- Before the push: a local Semgrep run if the repo provides one and a grep of the diff for `new RegExp(` with a non-literal argument;
  `git merge-tree --write-tree HEAD origin/main`; `git log --format=%B <base>..HEAD | grep -ci -E 'co-authored-by|generated
  with|claude-session|claude code'` prints 0; ONE push of the final head.

## 16. OPEN (none blocks this slice)

- O-1 OPEN NIT (OUT_OF_SCOPE, an L16b-owned file): the title of `web/e2e/chat.spec.ts:124` "(no member chat entry yet)" goes stale; it
  is not edited here; if L16b merged before the final push the catch-up may fix it, else the PR body lists it.
- O-2 spec follow-up for the M-11 exception: m9doc M-11 (`:287`) and `docs/features/BE/feature_player_view_tech.md:278`, `:287` do
  not mention the scoped exception; the conductor lists it in the closeout as a decision exception; no Reviewed spec and no
  decisions.md entry is edited here (L17 consolidates the defaults into one entry).

## 17. Closure matrix (12 of 12)

| # | Gate | Evidence | Result |
|---|---|---|---|
| 1 | Authority snapshot pinned by SHA | `AUTHORITY_SHA` = W HEAD = BASE; `check-target-files-exist-at-sha.sh` reports missing=0 for every TARGET_FILES path | PASS |
| 2 | Decisions in scope final | the owner answers (section 1); RO-L16c-1..4 (section 2); DF-1..DF-14 pinned as defaults pending owner sign-off | PASS |
| 3 | Scope IN/OUT and owner clear | sections 3-11; the lane NEGATIVE SCOPE; the file ownership against L16b; the RO-L16c-2 addition | PASS |
| 4 | Dependencies classified | L16 #89, L15a #87, L15 #86 and L14 #83 merged at BASE; L16b is not a dependency (section 1) | PASS |
| 5 | Live schema and code match | parts A and B and m1-m5 measured at BASE; tail 0065; no schema change beyond one function | PASS |
| 6 | Data, API, state, auth contract | sections 3-8 | PASS |
| 7 | Fail-closed, idempotency, order | every deny zero rows and one identical body; the gate's error state for any unknown outcome; more than one row throws; the GUC restored | PASS |
| 8 | Open questions in scope = 0 | DF-1..DF-14 pinned; O-1 and O-2 out of scope (section 16) | PASS |
| 9 | Acceptance matrix with expected results | 3.1 (CC), 4 (CW), 5.1 (CR), 6 (TZ, BP), 7 (CG), 8 (CE), 9 (ME, GP-M) | PASS |
| 10 | Migration, security, rollback | one additive migration 0066 (one function, two ACL statements); the security round required (section 0); rollback = revert before apply, a later migration drops the function after | PASS |
| 11 | First slice hard dependencies merged | W1 needs only BASE | PASS |
| 12 | Implementation handoff ready | sections 10-15; W at BASE, clean apart from this file | PASS |

## 18. Verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-10-20
AUTHORITY_SHA: 9afb29356eb9a7dce2794554fdf9491b3f5d6d0b
BASE_BRANCH: main
TARGET_FILES:
  - docs/standards/decisions.md
  - docs/standards/review-code-readiness-gate.md
  - docs/sessions/web-mvp-phase3-readiness-p3-m9-me-reads.md
  - docs/sessions/web-mvp-phase3-readiness-p3-m10-chat-web.md
  - docs/features/BE/feature_player_view_tech.md
  - docs/features/BE/feature_player_messenger_tech.md
  - packages/core/src/api-contract.ts
  - packages/db/migrations/0002_tenants_core.sql
  - packages/db/migrations/0031_chat_schema_core.sql
  - packages/db/migrations/0037_tenant_provision_rls_self_scope.sql
  - packages/db/migrations/0059_me_player_reads_definers.sql
  - packages/db/migrations/0063_chat_message_commands.sql
  - packages/db/migrations/0065_chat_message_author_label.sql
  - packages/db/src/me-player-reads.ts
  - packages/db/src/me-player-reads.test.ts
  - packages/db/src/me-player-reads-nobypass.test.ts
  - packages/db/src/index.ts
  - packages/db/src/test-harness.ts
  - packages/db/src/session-join-service.ts
  - packages/db/src/migrate.test.ts
  - packages/db/src/rls-invariants.test.ts
  - packages/db/src/outbox-projector-registry.test.ts
  - apps/web/lib/me-route-gate.ts
  - apps/web/lib/api-envelope.ts
  - apps/web/lib/api-client.ts
  - apps/web/lib/new-club-form.ts
  - apps/web/lib/request-policy.ts
  - apps/web/lib/chat-route.ts
  - apps/web/lib/chat-routes-db.test.ts
  - apps/web/lib/chat-stream-db.test.ts
  - apps/web/lib/use-tenant-context.ts
  - apps/web/lib/tenant-lang.test.ts
  - apps/web/lib/dev-login/personas.ts
  - apps/web/lib/dev-login/seed.ts
  - apps/web/app/api/me/clubs/route.ts
  - apps/web/app/api/me/profile/route.ts
  - apps/web/app/api/auth/session/route.ts
  - apps/web/app/me/layout.tsx
  - apps/web/app/c/server-boundary.test.ts
  - apps/web/components/me/me-frame.tsx
  - apps/web/components/player/my-clubs-view.tsx
  - apps/web/components/player/player-page.tsx
  - apps/web/components/player/player-views.test.tsx
  - apps/web/components/player/my-sessions-view.test.tsx
  - apps/web/components/chat/channel-list.tsx
  - apps/web/components/chat/channel-list.test.tsx
  - apps/web/components/chat/channel-view.tsx
  - apps/web/components/chat/message-list.test.tsx
  - apps/web/components/sessions/request-inbox.test.tsx
  - apps/web/components/shell/app-shell.tsx
  - apps/web/sw/sw.template.js
  - apps/web/e2e/chat.spec.ts
  - apps/web/e2e/golden-path.spec.ts
  - apps/web/e2e/golden-path.config.ts
  - apps/web/e2e/support/chat-api-mock.ts
  - apps/web/e2e/support/player-api-mock.ts
  - apps/web/e2e/support/golden-path-helpers.ts
SLICE: p3-m10-chat-member-entry
IN_SCOPE: the member chat entry in the player web: migration 0066 with the definer account_club_chat_context (the caller's own ACTIVE membership by club slug to tenant id and time zone), its DB tests and the 14 migration-tail pins; the readMyClubChatContext wrapper and its export; the new GET route apps/web/app/api/me/clubs/<clubRef>/chat-context/route.ts with its test and one tenant-lang row; the TenantZoneContext seam in use-tenant-context.ts and the basePath seam on two link lines of channel-list.tsx and channel-view.tsx; the new components/player/member-chat-gate.tsx with its test; the two new pages under apps/web/app/me/clubs/<clubRef>/chat; the optional Row action in player-page.tsx and the active-only Chat entry in my-clubs-view.tsx with their tests; the new e2e/member-chat.spec.ts and the golden-path member leg
OUT_OF_SCOPE: AppShell, ShellGate, GET /api/auth/session and tenant_ids_for_person; every chat API route, L14 or L15 definer and capability check; any table, column, index, trigger, policy or role change; a tenant uuid for a non-active membership or outside the context route; a person or membership id on the wire; the moderation UI and every L16b-owned file apart from the two basePath lines; DM, media, reactions, search, mentions, groups, pins, polls, slash commands, digest and push UI; money and PII; decisions.md and every Reviewed spec; enabling dispatch
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: L16 #89 (BASE is its merge), L15a #87, L15 #86 and L14 #83 merged at 9afb29356eb9a7dce2794554fdf9491b3f5d6d0b; the owner answers of 2026-10-20 (member chat approved; L16c before the P3-S14 closeout)
PRIOR_SLICES: L14 p3-m10-chat-core (#83), L15 p3-m10-chat-api-live (#86), L15a p3-m10-chat-author-labels (#87), L16 p3-m10-chat-web (#89)
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS # one additive migration 0066: one app-granted SECURITY DEFINER function and its two ACL statements, no table, column, index, trigger, policy or role change; the chat API pre-gate stays the one authorization; the security round is required (section 0)
IMPLEMENTATION_ARTIFACTS: PASS
FIRST_IMPLEMENTATION_STEP: W1 - re-measure the migration tail at the base (0065_chat_message_author_label.sql), write packages/db/migrations/0066_account_club_chat_context.sql per section 3, then the 14 pin edits of section 10, then the db suite under the lock
REMAINING_BLOCKERS: none
```
