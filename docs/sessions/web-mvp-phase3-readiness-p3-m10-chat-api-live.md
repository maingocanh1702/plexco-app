<!-- review-readiness: code-ready -->

# Step-0 readiness: L15 p3-m10-chat-api-live (session P3-S12)

> Agent-facing. Readiness reviewer, writer, code reviewer and security reviewer: opus/max; at most 3 rounds, area-split from round 1 (RO-L15-1: A routes
> and gate, B subscribe, listener and auth, C reader, DTO types and policy tests, D tests); DD-122 D4: Codex waived, independent Claude reviewers.
> Every `path:line` is MEASURED at base `819de9cc982bac48c84196612bae2f961f2bbade`; use THIS file's numbers, not the lane block's (conductor note 3).
> Authority: owner decision D4 and conductor ruling RO-L15-1..3, pinned in sections 1 and 5 (source, untracked: status/P3-S12-notes/conductor-ruling-l15.md).
> Review questions (lane REVIEW PLAN) -> where closed: **authorization on every route** 4.1, 4.4; **on every pushed event** 4.6; **tombstone leakage** 4.3;
> **enumeration** 4.1, 4.4 (one CHAT_FORBIDDEN body); **CSRF** 4.1; **resource exhaustion on the stream** 4.5, 4.6. Written in two parts: 4a (1-6), 4b (7-12).

## 1. Base, dependencies, authority
- Worktree HEAD = origin/main = `819de9cc982bac48c84196612bae2f961f2bbade`, branch `feat/p3-m10-chat-api-live`, porcelain empty, no index.lock.
- L14 merged: PR #83 is the base commit (conductor note 35); migration tail `0063_chat_message_commands.sql`. L15 adds no migration, grant or schema change.
- L5 merged: `apps/web/lib/realtime-listener.ts` (292 lines), `realtime-auth.ts` (96), `apps/web/app/api/realtime/subscribe/route.ts` (44).
- Owner D4 signed: club channels only; no DM, media, reactions, search, group, pin, poll, slash commands or digests. No other owner decision is needed.
- RO-L15-1 B3 exception GRANTED: one lane, 4 modules, non-test <= 700 LOC, REST checkpoint <= 540, no migration or grant, chat-service.ts unchanged.
  Reason: DONE WHEN needs POST, subscribe and the authorized GET in one proof behind one shared gate; a split would duplicate the gate.
- RO-L15-2 channel reader APPROVED (b) plus unreadCount: new `packages/db/src/chat-channel-reads.ts`, one index.ts export line, one DB test (4.3).
  Reason: L14 exports no channel list (db index.ts:129-143), raw tables stay in packages/db (HARD RULE 1, index.ts:4-8), L16's badge must survive reload.
- RO-L15-3 pins a-f APPROVED (D-12..D-16, D-20), g REPLACED (D-17): no person identifier on any wire DTO; live rows carry `mine` and `authorType`.
  Reason: a person id is global across clubs (persons has no tenant column), tech :1195-1205 forbids author authority fields, and L9's A-9 posture.

## 2. Measured facts (the four ruling conditions: all MET)
- (1) RO-L15-1, a second listener channel through optional deps: MET. `REALTIME_CHANNEL = "web_realtime"` (realtime-listener.ts:17) is used only at :119
  and :152; the frame is fixed at send :33-36, plan :48-51, encodeFrame :261. Per instance already: perAccount :68, :172-178; byTenant :67, :176-177;
  heartbeat 25 s :21; recheck :234, :275-286; EVENT_ID_RE :24 takes the id text. Additive: generic `F = RealtimeFrame`, `channel?`, `encode?`, defaults
  = L5's (REALTIME_CHANNEL, encodeFrame). L5 call sites stay byte-identical: subscribe route.ts:27-28, singleton :202-222, realtime-listener.test.ts:61,
  :236, :260, :284-285, realtime-listener-db.test.ts:118-119, :144.
- (2) RO-L15-2, unreadCount without a schema change or grant: MET. Cursor = chat_members.last_read_created_at + last_read_message_id (schema.ts:1073-1074;
  both-or-neither CHECK :1098-1099), written only by mark_read, forward-only (0063:425-428). app has table-level SELECT on chat_members and chat_channels
  (0031:353-354; the only chat REVOKE SELECT is 0063:93, on chat_messages, whose allowlist keeps id, channel_id, author_person_id, created_at, 0063:93-96).
  chat_messages RLS (0031:341-343): no moderation filter. ADDITION 3: no non-test chat_channels reader in packages/db/src or apps/web/lib (git grep: 0 hits).
- (3) createdAt text: `f.created_at::text AS "createdAt"` (chat-service.ts:176-178), a string (:173), cast back with `::timestamptz` (:191-192); no
  TimeZone or DateStyle pin in the repo => Postgres ISO text, e.g. `2026-10-19 11:53:07.12345+00` (derived from code and output rules, no DB query).
  Cursor regex (D-2): `^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:\d{2}){0,2}$` plus UUID_RE (session-command-route.ts:82).
- (4) PROCESS_ROLE=worker never serves Next: infra/entrypoint.sh:64-66 starts the bot worker (apps/bot/src/worker.ts:20); Next runs only as web :55-57
  and discovery :59-62 (infra/docker-compose.yml:38, :144), so /api/chat/* is web-served and discovery-404: request-policy.ts needs no edit (D-20).

## 3. Answers Q1-Q8 (step-0 reviewers 1 and 2; detail in section 4)
- Q1 L14 contract: codes chat-service.ts:14-30, ChatCommandError :34-43, sanitize :50-64, withChatActor :75-91, commands :100-161, reads :181-209.
- Q2 Routes: tech section 3 :1136-1165 (the lane cites section 4, D-7); the D4 rows :1140-1164 become 8 handlers in 6 route files; other rows are outside D4.
- Q3 Live: pg_notify('chat_realtime', id::text) inside the definers 0063:257, :337, :388, :518 (no trigger); L5 listener and auth reuse per 2 (1) and 4.6.
- Q4 Gate and envelope: ok/err api-envelope.ts:20, :36 (NO_STORE :11); CHAT codes api-contract.ts:114-125; gate parts session-command-route.ts:82-329.
- Q5 Rate limits: DB send 0063:244, :248, edit and delete :327, :382, moderation :500 (= tech:1327-1342); route buckets D-4, D-5, D-6 (4.5).
- Q6 Tests: harness session-guest-note-route-db.test.ts:9-40, :116; SSE realtime-listener-db.test.ts:114, realtime-listener.test.ts:107-264.
- Q7 Chat-core pins (docs/sessions/web-mvp-phase3-readiness-p3-m10-chat-core.md): V-22 :197 keyset 1..100, default 50; V-5 :180 NOTIFY in the definers.
- Q8 Budget: ~607 non-test LOC in 4 modules, 0 migrations (estimate at step 0) -> RO-L15-1 caps <= 700 and REST <= 540, measured at the checkpoint (6).

## 4. Contract, route by route
### 4.1 Gate: apps/web/lib/chat-route.ts, every REST handler, in this order (bare :N = session-command-route.ts)
1. `currentSession` (session-cookies.ts:179) -> AUTH_REQUIRED 401; there is no public or anonymous chat route.
2. Mutations (POST message, PATCH, DELETE, POST read, POST moderation): `csrfOk`, x-csrf-token (session-cookies.ts:328) -> CSRF_INVALID 403 (D-18).
3. `?tenant=` (readTenantParam, session-command-route.ts:105-108), path ids (UUID_RE :82), limit (D-1), cursor (D-2) -> INVALID_BODY 400 (note 30).
4. `actorThrottled(accountId)` (:111-113, rationale :251-262) -> CHAT_RATE_LIMITED 429.
5. withTenant + hasLiveMembership (db index.ts:15, :92; pattern :173-189) -> else the one CHAT_FORBIDDEN body, BEFORE withChatActor (D-19).
6. Per-person bucket on GET channels, GET history and POST read (D-5) -> CHAT_RATE_LIMITED 429.
7. Mutations: readBoundedBody (pattern :316-329), byte cap at or above L14's body cap; oversize -> 413 CHAT_MESSAGE_TOO_LARGE, bad JSON -> INVALID_BODY 400
   (the JSON.parse error is never rethrown or logged: V8 quotes the input); only listed fields are read; every body id is uuid-checked -> INVALID_BODY 400.
8. `withChatActor(db, {tenantId, personId}, fn)` (chat-service.ts:75-91) + one L14 call (4.2) -> the 4.4 map; resolveTenantLang (tenant-lang.ts:74) after 5.
9. Respond through ok/err (api-envelope.ts:20, :36): `cache-control: no-store` (NO_STORE :11, withNoStore :13-17) is on every JSON response.
### 4.2 Routes (tech section 3; `?tenant=<uuid>` on every call; files under apps/web/app/api/chat/; L14 calls in chat-service.ts)
| Method, path after /api/chat (tech) | Route file | Calls | 200 `data` |
|---|---|---|---|
| GET /channels (:1140) | channels/route.ts | listChatChannels (RO-L15-2) | `{channels}`; zero rows -> the one CHAT_FORBIDDEN body (D-23) |
| GET /channels/:id/messages (:1142) | channels/[id]/messages/route.ts | listChatMessages :181-199, before | `{messages, nextCursor}` (D-1, D-2, D-21, D-22) |
| POST /channels/:id/messages (:1144) | channels/[id]/messages/route.ts | send :100-110 | `{id, createdAt, duplicate}` (D-8, D-10) |
| PATCH /channels/:id/messages/:messageId (:1145) | channels/[id]/messages/[messageId]/route.ts | edit :112-122 | `{id, editCount, editedAt, changed}` |
| DELETE, same path (:1146) | same file | delete :124-133 | `{id, authorDeletedAt, changed}`; idempotent; non-author -> CHAT_FORBIDDEN (0063:375-376) |
| POST /channels/:id/read (:1149) | channels/[id]/read/route.ts | markChatRead :154-161 | `{}`; forward-only |
| POST .../:messageId/moderation (:1164) | .../[messageId]/moderation/route.ts | moderate :135-152 | `{messageId, moderationState, changed}` |
| GET /subscribe (:1158, D-13) | subscribe/route.ts | admission + chatRealtimeListener (4.6) | SSE frames `{type, channelId, messageId}` (D-12) |

Bodies (only these fields are read; never an author field, tech:1144): send `{clientMsgId, body, replyToMessageId?}` (:1175-1181); edit
`{body, expectedEditCount}` (:1264); read `{throughMessageId}` -> `{}` (default applied, pending owner sign-off); moderation
`{action: hide|restore, reasonCode, reasonNote?, commandId}` (:1274-1283): reasons spam, harassment, unsafe, off_topic, other (other needs a note).
### 4.3 DTOs (packages/core/src/api-contract.ts, additive types only, pattern :188-214; no new error code: all 12 CHAT_* exist at :114-125)
- No wire DTO carries `authorPersonId` or any person identifier (RO-L15-3 g); `mine` = (row.authorPersonId === the actor's person id), set in the route.
- ChatChannelDto = {id, title, sortOrder, isDefault, postPolicy, unreadCount}; never createdBy*, assistantEnabled or a read-cursor column (RO-L15-2).
- unreadCount: messages after the caller's own cursor (NULL = from the start) whose author IS DISTINCT FROM the caller (system rows count), tombstones
  included, capped at 100 (100 = 100 or more); the reader joins only `cm.person_id = actor` (members see each other's cursor rows: 0031:334-336).
- ChatMessageDto, live (ChatMessage :163-174 minus authorPersonId, plus mine): {id, channelId, authorType, mine, body, replyToMessageId, editedAt, editCount,
  tombstone: null, createdAt}. Amended 2026-10-19 (conductor answer 3): every timestamp a chat route returns (createdAt, editedAt in
  history, POST, PATCH) is ISO-8601 UTC from one chat-route.ts mapper (Date.toISOString(); unparseable -> fail closed); the D-2 cursor
  keeps L14's RAW text (chat-service.ts:176-178, microseconds), never the ISO value; L16 never parses Postgres text.
- ChatMessageDto, tombstone: exactly {id, channelId, createdAt, tombstone: 'author_deleted' | 'moderation_hidden'}; no body, authorType, author, mine,
  replyToMessageId, editedAt or editCount (RO-L15-3 f; chat_list_messages returns edit columns on tombstones, 0063:566, :577, so the route drops them).
- ChatStreamFrame: exactly {type: "chat.message", channelId, messageId}, one constant type (RO-L15-3 e); the client refetches through the authorized GET.
### 4.4 Error map (mirror mapSessionCommandError, session-command-route.ts:746-790: ChatCommandError -> isApiErrorCode -> err with its status)
- AUTH_REQUIRED 401: no session. CSRF_INVALID 403: missing or wrong x-csrf-token on a mutation, zero mutation (D-18).
- INVALID_BODY 400: a non-uuid tenant, channel, message, reply, through-message or command id (note 30); a bad limit (D-1) or cursor (D-2); bad JSON.
- The one CHAT_FORBIDDEN 403 body (byte-equal except meta.requestId; constant t(vi, en) text, never the tenant's language) for every reason: no tenant
  membership, wrong tenant, not a chat member, unknown channel or message, DM or non-club id (CHAT_SAFETY_BLOCKED, D-15), non-author DELETE, D-23.
- TENANT_SUSPENDED 403 reaches members only (D-19). 200 with duplicate: true for CHAT_DUP_MESSAGE (D-8); a moderation replay returns the stored result.
- 409: CHAT_IDEMPOTENCY_MISMATCH (cross-author clientMsgId; a commandId with a new fingerprint; generic, no data), CHAT_REPLY_INVALID, CHAT_EDIT_WINDOW_CLOSED,
  CHAT_EDIT_CONFLICT. 403 CHAT_CAPABILITY_REQUIRED on POST and PATCH in an admins_only channel (note 32 order: kind, member, post_policy, window).
- 403 CHAT_MODERATION_FORBIDDEN; 413 CHAT_MESSAGE_TOO_LARGE; 422 CHAT_REASON_INVALID; 404 NOT_FOUND (POST read, through-message not in the channel).
- Anything else (`CHAT_DB_ERROR:<SQLSTATE>`, incl. 23505 from one moderation commandId reused on two channels at once; any plain Error) -> rethrow ->
  fail-closed 500 with no text logged; the retry returns the stored result or the mismatch (note 32). L15 never widens chat-service.ts's sanitize (:50-64).
### 4.5 Rate limits (every chat 429 is CHAT_RATE_LIMITED)
- L14 enforces (0063): send 20/10 s + 300/min per (person, channel) :244, :248; edit and delete share chat_edit_1m, 30/min per (person, channel) :327,
  :382; moderation 30/min per (actor, tenant) :500; no per-target bucket (D-6). L5's realtime-subscribe bucket and cap are untouched.
- The route adds (rateLimited, session-cookies.ts:420): actorThrottled on every handler; the D-5 buckets; the chat stream cap 5 per account (D-4).
### 4.6 Live path: subscribe, listener, per-event re-authorization
- Emission is L14's (pinned): pg_notify('chat_realtime', id::text) inside the definers after the write, same tx (send 0063:257, edit :337, delete :388,
  moderation if changed :518); never mark_read or a no-op replay; one payload per id per committed tx (PR #83 body). L15 only LISTENs.
- Listener: 2 (1)'s optional deps + a `chatRealtimeListener()` singleton on "chat_realtime" (own per-account map, connect helper shared with L5's :204-215).
- Per event (realtime-auth.ts chat plan; ponytail ceiling: one read per subscriber): per tenant group, per distinct person, withChatActor + getChatMessage
  (chat-service.ts:201-209); a row -> {type, channelId: row.channelId, messageId: row.id}; null or error -> dropped, nothing sent; no polling fallback.
- Admission (GET, no CSRF): session, `?tenant=`, actorThrottled + the 30/min bucket, hasLiveMembership, at least one readable club channel, the cap;
  SSE headers exactly as L5's route (no-store included). Every 25 s the recheck re-runs admission minus buckets and cap; false or error -> close (D-3).
- Costs for the PR body: one read-back per distinct (tenant, person) with an open chat stream per NOTIFY (the payload carries no tenant), and one more
  app-pool LISTEN connection per web process while a chat stream is open (stop() :187 releases it).

## 5. Pinned defaults (each: default applied, pending owner sign-off)
- D-1 limit: integer 1..100, absent 50, anything else INVALID_BODY 400; the route rejects, never clamps (default applied, pending owner sign-off).
- D-2 cursor: unsigned `v1.<b64url(createdAt|id)>`, max 256, 2 (3) regex, else INVALID_BODY 400; definer re-gates (default applied, pending owner sign-off).
- D-3 heartbeat 25 s (<= 30 s); the recheck re-runs admission (4.6), false or error -> close (default applied, pending owner sign-off).
- D-4 5 chat streams per account, separate from L5's 5; the 6th -> 429 CHAT_RATE_LIMITED (default applied, pending owner sign-off).
- D-5 subscribe admission 30/min per account; GET channels, GET history, POST read 60/min per person (default applied, pending owner sign-off).
- D-6 no per-target moderation bucket (tech:1338); L14's 30/min per (actor, tenant) applies (default applied, pending owner sign-off).
- D-7 route contract = tech section 3 :1136-1165; the lane block and conductor note 8 cite section 4 (default applied, pending owner sign-off).
- D-8 CHAT_DUP_MESSAGE -> 200 with the original, duplicate: true; the lane block wins over tech:1301's 409 (default applied, pending owner sign-off).
- D-9 chat_realtime NOTIFY, id-only, from L14's definers, no trigger (V-5, RO-L14-5); L15 only LISTENs (default applied, pending owner sign-off).
- D-10 POST and PATCH return ids and metadata, never a body (lane test: no body text outside the authorized GET) (default applied, pending owner sign-off).
- D-11 no slash classifier: a leading "/" is plain text (D4 has no slash commands; tech:1144) (default applied, pending owner sign-off).
- D-12 frame exactly {type: "chat.message", channelId, messageId}, one constant type, a refetch hint (default applied, pending owner sign-off).
- D-13 (amended) one tenant-wide GET /api/chat/subscribe?tenant=, recorded divergence from tech:1158, costs in 4.6 (default applied, pending owner sign-off).
- D-14 (amended) GET channels per ?tenant=, club, non-archived, allowlisted columns + unreadCount 0..100 (4.3) (default applied, pending owner sign-off).
- D-15 CHAT_SAFETY_BLOCKED -> the one CHAT_FORBIDDEN body on every route, no DM-id oracle (default applied, pending owner sign-off).
- D-16 tombstones drop editedAt and editCount; the tombstone DTO is exactly 4.3's four fields (default applied, pending owner sign-off).
- D-17 (replaced by RO-L15-3 g) no person identifier on the wire; `mine` + `authorType` only; ships nameless (default applied, pending owner sign-off).
- D-18 CSRF failure -> the existing CSRF_INVALID 403, zero mutation (default applied, pending owner sign-off).
- D-19 hasLiveMembership pre-gate before withChatActor, so TENANT_SUSPENDED reaches members only (default applied, pending owner sign-off).
- D-20 request-policy.ts unchanged; discovery-denied assertions per chat path and method (default applied, pending owner sign-off).
- D-21 the history GET reads only limit and cursor and always pages "before" (default applied, pending owner sign-off).
- D-22 data:{channels} and data:{messages, nextCursor}; nextCursor = oldest row's cursor on a full page, else null (default applied, pending owner sign-off).
- D-23 zero readable club channels on GET channels or subscribe admission -> the one CHAT_FORBIDDEN body (test (i)) (default applied, pending owner sign-off).

OPEN_QUESTIONS_IN_SCOPE = 0: every unpinned item above carries a default.

## 6. Implementation order
1. Re-check HEAD = this commit, clean tree; GitNexus impact before each symbol edit; the DB/e2e lock per run; no extra definer lock (test-harness.ts:701-703).
2. REST first: packages/core DTO types (4.3) + api-contract.test.ts; apps/web/lib/chat-route.ts (4.1, 4.4, 4.5, the D-2 cursor codec).
3. packages/db/src/chat-channel-reads.ts + index.ts export + DB test: ADDITION 2 (i)-(iv), and B's cursor never changes A's count (RO-L15-2).
4. Routes + route DB tests (real DB, app role, one case per row): channels GET; messages GET, POST; message PATCH, DELETE; read POST; moderation POST.
5. REST checkpoint: commit, then `b3-measure.sh p3-m10-chat-api-live`; non-test <= 540 LOC, else STOP and report to the conductor (RO-L15-1 fallback split).
6. Live: listener deps + chatRealtimeListener(), realtime-auth.ts chat plan + recheck, subscribe/route.ts, stream DB tests; L5 test cases untouched.
7. Sweep: grep tests (message text only in the authorized GET: never in a log line, error body, frame or other response; no person uuid or `authorPersonId`
   in any response), CSRF on all 5 mutations, no-store on every chat response, D-20 assertions, no template-literal console call (note 21).
8. S1 VERIFY set and the lane's ACCEPTANCE COMMANDS; PR body: RO-L15-1..3, every section 5 default, the 4.6 costs, "contract L16 consumes" (no names, no ids).

## 7. Acceptance matrix (real DB, app role unless stated; one test per lane decision-table row, per conductor-note row and per ruling test)

Files in section 9. "The one body" = 4.4's CHAT_FORBIDDEN 403 body, byte-equal except meta.requestId.

| Lane row | Test | Expected |
|---|---|---|
| no session | T1 every handler (7 REST + subscribe), no session | 401 AUTH_REQUIRED; nothing read or written |
| wrong tenant or not a member | T2 foreign `?tenant=`, tenant non-member, chat non-member, unknown channel or message, DM-kind id | the one body (D-15) |
| POST message; PATCH ok | T3 member POST (incl. a leading "/", D-11); author PATCH | 200 `{id, createdAt, duplicate: false}`; 200 `{id, editCount, editedAt, changed}`; no body |
| duplicate client_msg_id | T4 same author, same clientMsgId twice | 200 the original id, `duplicate: true`; one row (D-8) |
| cross-author client_msg_id | T5 member B reuses member A's clientMsgId | 409 CHAT_IDEMPOTENCY_MISMATCH, generic, no data; no row |
| too large | T6 body over L14's cap; request over the route byte cap | 413 CHAT_MESSAGE_TOO_LARGE; no row |
| admins_only POST | T7 member without chat.channel.post_restricted | 403 CHAT_CAPABILITY_REQUIRED |
| rate limit | T8 21st send in 10 s; a D-5 bucket; actorThrottled | 429 CHAT_RATE_LIMITED |
| bad reply target | T9 replyToMessageId unknown or in another channel | 409 CHAT_REPLY_INVALID |
| PATCH window, conflict | T10 edit past the window (15 min or 5 edits); stale expectedEditCount | 409 CHAT_EDIT_WINDOW_CLOSED; 409 CHAT_EDIT_CONFLICT, no change |
| PATCH order (note 32) | T11 admins_only, no capability, window closed; then a non-member | 403 CHAT_CAPABILITY_REQUIRED (not WINDOW_CLOSED); non-member: the one body |
| DELETE by the author | T12 author deletes twice | 200 `changed: true`, then `false`; history shows an `author_deleted` tombstone |
| DELETE by anyone else | T13 another member, moderators included | 403, the one body; no change |
| moderation forbidden | T14 caller without chat.message.moderate | 403 CHAT_MODERATION_FORBIDDEN; no change |
| bad reason | T15 unknown reasonCode; `other` without reasonNote | 422 CHAT_REASON_INVALID |
| moderation response | T16 hide, then restore | exactly `{messageId, moderationState, changed}`; no previous body, no other actor |
| moderation replay (note 5) | T17 same commandId: same fingerprint, then a new one | 200 stored result, one audit row; 409 CHAT_IDEMPOTENCY_MISMATCH, zero mutation |
| moderation race (note 32) | T18 one commandId on two channels at once | loser 500 fail-closed (CHAT_DB_ERROR 23505), no text logged; retry: stored or 409 |
| history tombstones | T19 history over hidden and author-deleted rows | exactly `{id, channelId, createdAt, tombstone}`; no body, revision, author, mine, moderation |
| page size (D-1) | T20 limit absent, 1, 100; then 0, 101, "abc", "1.5" | 50, 1, <= 100 rows; the rest 400 INVALID_BODY |
| malformed cursor (D-2) | T21 bad prefix, bad base64url, over 256 chars, regex miss, non-uuid id | 400 INVALID_BODY; no DB call |
| ids at the boundary (note 30) | T22 non-uuid tenant, channel, message, reply, through-message or command id; bad JSON | 400 INVALID_BODY, never 500; input never echoed or logged |
| suspended tenant (D-19) | T23 member, then non-member, of a suspended tenant | 403 TENANT_SUSPENDED; the one body |
| read cursor | T24 POST read forward, then backward; a through-message of another channel | 200 `{}`, the cursor never moves back; 404 NOT_FOUND |
| channel list (D-14) | T25 GET channels as a member | 200 `{channels}`, key-set exactly ChatChannelDto (4.3); only that tenant's club channels |
| DONE WHEN | S1 A posts; B (chat member) and C (not a member of that channel) stream | B: one frame `{type, channelId, messageId}`, B's GET returns the body; C: nothing |
| cross-tenant leak | S2 tenant A message; a tenant B member streams B, then asks `?tenant=A` | nothing reaches B; admission returns the one body |
| revoke mid-stream | S3 chat membership ended while streaming | no further frame; closed at the next recheck |
| per-event drop | S4 forged or unknown id; message no longer readable; read error | nothing sent, the stream stays; no fallback read or poll |
| heartbeat (D-3) | S5 fake timers; session revoked between beats | heartbeat every 25 s (<= 30 s); closed at the next check |
| stream cap (D-4) | S6 6th chat stream of one account while L5 streams are open | 429 CHAT_RATE_LIMITED; L5's cap and streams unaffected |
| keyset (lane) | K1 page through history while another member inserts | no duplicate, no gap; order (created_at, id) descending |
| microsecond cursor | K2 rows 1 microsecond apart and rows with equal created_at (seeded as owner) | cursor carries L14's createdAt text verbatim; none skipped or repeated |
| no message text | G1 sentinel body; capture responses, error bodies, frames, NOTIFY payloads (LISTEN), spied log lines | sentinel only in the authorized GET's 200 body |
| no person identifier | G2 grep every chat route response body | no seeded person uuid, no string `authorPersonId` (RO-L15-3 g) |
| CSRF | C1 each of the 5 mutations, missing and wrong x-csrf-token | 403 CSRF_INVALID; zero rows changed (D-18) |
| no-store | N1 every chat JSON response (2xx, 4xx) and the SSE response | `cache-control: no-store` |
| reader (i), (ii) | R1 tenant non-member; guest; cross-tenant `?tenant=` (GET channels and subscribe) | the one body (at the pre-gate, or via D-23's zero rows) |
| reader (iii) | R2 archived channel; DM-kind channel in the tenant | never listed |
| reader (iv) | R3 own, others', system and tombstoned rows; NULL cursor; 101 unread | own excluded; system and tombstones counted; NULL counts all; capped at 100 |
| unread isolation | R4 member B marks read; A lists channels | A's unreadCount unchanged; only A's own mark_read lowers it |
| policy, contract | P1 request-policy.test.ts per chat path and method; P2 api-contract.test.ts DTO types | discovery denied, web allowed (D-20); additive types, 12 CHAT_* codes unchanged |
| L5 unchanged | L1 L5's realtime-listener, realtime-listener-db and realtime-auth tests | existing cases byte-identical and green |

## 8. Test and harness rules

- Route tests: real DB as the app role; handlers imported directly, next/headers mocked, setupRlsTestContext per pid, DATABASE_URL stubbed to the app
  URL, createWebSession/revokeWebSession, x-csrf-token (session-guest-note-route-db.test.ts:9-40, :116). Stream tests follow realtime-listener-db.test.ts:114.
- L15 adds describe blocks only to realtime-listener.test.ts and realtime-auth.test.ts (fake timers as :255-264); L5's cases stay byte-identical and green.
- Definer locks (note 34): setupRlsTestContext holds withDefinerReadLock around bootstrap and migrate (test-harness.ts:701-703); a test naming job_definer,
  chat_definer or identity_definer holds the matching reader lock, never withChatDefinerLock (:454, breaker side); the plan names none; no privilege
  assertion relies on role inheritance (note 33).
- Every DB suite and Playwright run goes through the one DB/e2e lock wrapper (note 12), `uptime` first; a listed flake (clerk-flake-list.txt) gets one
  recorded rerun, a second red is real; NODE_ENV=test; container psql only; G1 spies console.* and log sinks; no template-literal console call (note 21).

## 9. Scope

- IN, NEW under apps/web/app/api/chat/: channels/route.ts (GET); channels/[id]/messages/route.ts (GET, POST); subscribe/route.ts (SSE);
  channels/[id]/messages/[messageId]/route.ts (PATCH, DELETE) and its moderation/route.ts (POST); channels/[id]/read/route.ts (POST).
- IN, code: NEW apps/web/lib/chat-route.ts; apps/web/lib/realtime-listener.ts + realtime-auth.ts (additive, 4.6); packages/core/src/api-contract.ts (types);
  NEW packages/db/src/chat-channel-reads.ts + one packages/db/src/index.ts export line. Call only: chat-service.ts. request-policy.ts unchanged (D-20).
- IN, tests: NEW apps/web/lib/chat-routes-db.test.ts, apps/web/lib/chat-stream-db.test.ts, packages/db/src/chat-channel-reads.test.ts; new blocks in
  api-contract.test.ts, request-policy.test.ts, realtime-listener.test.ts and realtime-auth.test.ts; this file.
- OUT (lane, verbatim): no new migration (a needed schema change => HALT and report); no DM, search, reactions, media, mutes, slash commands or digest
  routes; no chat body in logs or in a NOTIFY payload; no public or anonymous route; no polling fallback that skips authorization.
- OUT (RO-L15-1, notes 7, 9): 0 migrations, 0 grants, 0 changed lines in chat-service.ts, migrations and existing L5 test cases; no NOTIFY change (D-9);
  no UI (L16); the Assistant stays off; no outbox use (flags stay false); no secret or HMAC key; no decisions.md edit.

## 10. B3 budget and review plan

- B3 (RO-L15-1, GRANTED): non-test <= 700 LOC incl. the reader and unreadCount; REST checkpoint (section 6 step 5) non-test <= 540, else STOP and report
  to the conductor (fallback L15a REST, then L15b live <= 220); 4 modules (apps/web/app/api/chat, apps/web/lib, packages/core, packages/db); 0 migrations;
  0 grants; test-class and total LOC are reported, not stops; step-0 estimate ~607 non-test (Q8).
- Review: opus/max, area-split from round 1, a fresh reviewer per area: A routes and the gate (REST route files, chat-route.ts); B subscribe, listener and
  auth; C reader, DTO types and policy tests (chat-channel-reads.ts, index.ts, api-contract.ts, request-policy.test.ts); D tests. Findings BLOCKING /
  SHOULD_FIX / NIT with file:line and a one-line failure scenario. Security: an opus/max round on the same areas and the header's questions. Cap 3 rounds;
  a fix after the final round is labelled "fix applied after the final round, not re-reviewed (3-round cap)". PR body carries:
  "Codex waived by owner 2026-10-12; reviewed by independent Claude subagent".

## 11. OPEN (non-blocking; owner named per item)

- O-1 Owner, pending sign-off (L17 consolidates): D-1..D-23 and 4a's further pins, each default applied (4.2 read body, 200 shapes; 4.3 system rows; 4.4 404).
- O-2 Resolved 2026-10-19 (conductor answer 3, amendment in 4.3): wire createdAt and editedAt are ISO-8601 UTC; the cursor keeps L14's raw text.
- O-3 PR body, "contract L16 consumes": one read-back per distinct (tenant, person) subscriber of the web process per NOTIFY (it carries no tenant), 4.6.
  Conductor answer 1 (2026-10-19): this measured wording replaces RO-L15-3 d's and goes in the PR body as a documented ceiling.
- O-4 Owner, via the conductor: no author label on the wire (RO-L15-3 g); L16 shows "You" or "Member"; labels need a migration lane (expected 0065).
- O-5 Docs-only commit: no code symbol changes, so GitNexus detect_changes is not applicable (fallback: `git show --stat HEAD` = this file only).

## 12. Closure matrix (12 of 12) and verdict

| # | Gate | Evidence | Result |
|---|---|---|---|
| 1 | Authority snapshot pinned by SHA | `AUTHORITY_SHA` = worktree HEAD = session base; every TARGET_FILES path exists at the base | PASS |
| 2 | Decisions in scope final | D4 signed; RO-L15-1..3 ruled; D-1..D-23 and 4a's further pins applied as defaults pending owner sign-off | PASS |
| 3 | Scope IN/OUT and owner clear | section 9; lane NEGATIVE SCOPE + RO-L15-1; L16 owns the UI | PASS |
| 4 | Dependencies classified | L14 (#83) and L5 merged at the base; migration tail 0063; no migration needed | PASS |
| 5 | Live schema and code match | sections 1-3, measured at the base; the four ruling conditions MET (2) | PASS |
| 6 | Data, API, state, auth contract | sections 4.1-4.6 | PASS |
| 7 | Fail-closed, idempotency, order | gate order 4.1; one CHAT_FORBIDDEN body; L14 receipts replay; unknown error -> 500, no text; per-event drop | PASS |
| 8 | Open questions in scope = 0 | section 5 pins; section 11 is non-blocking | PASS |
| 9 | Acceptance matrix with expected results | section 7 | PASS |
| 10 | Migration, security, rollback | 0 migrations, 0 grants, chat-service.ts unchanged; security round on areas A-D; rollback = revert | PASS |
| 11 | First slice hard dependencies merged | L14 and L5 on the base; D4 signed | PASS |
| 12 | Implementation handoff ready | sections 4-10; worktree at the base with only this file added | PASS |

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-10-19
AUTHORITY_SHA: 819de9cc982bac48c84196612bae2f961f2bbade
BASE_BRANCH: main
TARGET_FILES:
  - docs/standards/review-code-readiness-gate.md
  - docs/sessions/web-mvp-phase3-readiness-p3-m10-chat-core.md
  - docs/features/BE/feature_inapp_chat_tech.md
  - packages/db/migrations/0031_chat_schema_core.sql
  - packages/db/migrations/0063_chat_message_commands.sql
  - packages/db/src/chat-service.ts
  - packages/core/src/api-contract.ts
  - apps/web/lib/session-command-route.ts
  - apps/web/lib/realtime-listener.ts
  - apps/web/lib/realtime-auth.ts
SLICE: p3-m10-chat-api-live
IN_SCOPE: section 9 IN - 8 chat handlers in 6 route files behind chat-route.ts, the chat topic on L5's listener and auth, channel reader, DTO types, tests
OUT_OF_SCOPE: section 9 OUT - any migration, grant or schema change; chat-service.ts edits; DM, search, reactions, media, mutes, slash, digest; UI; Assistant
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: L14 merged at 819de9cc982bac48c84196612bae2f961f2bbade (#83, tail 0063); L5 realtime-listener, realtime-auth, subscribe present; D4 signed
PRIOR_SLICES: L5 (realtime SSE), L14 (P3-S11, #83)
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS # 0 migrations, 0 grants, chat-service.ts unchanged; per-event re-authorization; opus/max reviewer + opus/max security round
IMPLEMENTATION_ARTIFACTS: PASS
FIRST_IMPLEMENTATION_STEP: section 6 steps 1-2 - re-check HEAD, then packages/core DTO types + api-contract.test.ts and apps/web/lib/chat-route.ts
REMAINING_BLOCKERS: none
```
