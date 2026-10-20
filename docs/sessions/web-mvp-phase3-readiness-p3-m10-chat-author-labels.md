<!-- review-readiness: code-ready -->

# Step-0 readiness: L15a p3-m10-chat-author-labels (session P3-S12a)

> Agent-facing. Readiness reviewer, writers, code reviewer and security reviewer: opus/max; at most 3 rounds (pre-push rounds
> count), area-split from round 1 if the diff is large; DD-122 D4: Codex waived, independent Claude reviewers.
> Every `path:line` is MEASURED at base `03e17a5b7c99db9365ddc41dc213e648273bbffc` (three readiness reviewers, token-rule
> hand-offs); use THIS file's numbers, not the lane block's (conductor note 3).
> Authority: owner answer "Labels ok" (2026-10-20, status/L17-carry-forward.md:206-207), D4 signed (club channels only),
> conductor rulings RO-L14-* and RO-L15-* where they apply (section 1). Source files under status/ are untracked.

## 1. Base, dependencies, authority
- Worktree HEAD = base `03e17a5b7c99db9365ddc41dc213e648273bbffc`, branch `feat/p3-m10-chat-author-labels`; porcelain shows
  only this file; no index.lock (git dir `.git/worktrees/p3-m10-chat-author-labels`).
- On the base: L15 (PR #86: routes, DTO types, wire tests), L14 (#83, 0063), L13a (#84, 0064). Migration tail 0064 (ls and
  plexco_test schema_migrations) => this lane's migration is `0065_chat_message_author_label.sql`.
- Binding rulings (grep of status/P3-S11-notes/conductor-ruling-*.md, P3-S12-notes/conductor-ruling-l15*.md):
  RO-L14 b3:15-16 (definer read functions owned by chat_definer, pinned search_path, gate inside, EXECUTE for app only;
  tests as the real app role) => kept. RO-L15-3 f (a tombstone DTO is exactly {id, channelId, createdAt, tombstone}, no
  author field) => no label on ChatTombstoneDto. RO-L15-3 g (no authorPersonId or other person identifier on any wire DTO)
  => kept. RO-L15-3 :21 (L16 renders "You" / "Member") => "Member" stays the NULL fallback. RO-L15-1 ("0 changed lines in
  chat-service.ts") bound L15 only.
- Not re-read: the L14 readiness file and the L14/L15 PR bodies; the read-function contract they pin is measured here from
  the live catalog (3a) and 0063 itself, which outrank a readiness doc (precedence rungs 1-2).

## 2. Q1 callers (one `git grep -n -e chat_list_messages -e chat_get_message`)
- SQL: only 0063 defines or names them: list :530-589 (REVOKE :588, GRANT :589), get :591-625 (REVOKE :624, GRANT :625),
  owner :644-645. No view, no other function, no later migration names either; pg_depend: zero dependents (3a).
- TS reader: packages/db/src/chat-service.ts `listChatMessages` :181-199 (calls chat_list_messages :193) and
  `getChatMessage` :201-209 (:206); both select the shared `MESSAGE_COLUMNS` :176-178 into `ChatMessage` :163-174
  (server-side type, carries authorPersonId :167).
- Live path: apps/web/lib/realtime-auth.ts :118, :142 (per-event re-authorization through getChatMessage; id-only frame).
- Tests: chat-catalog.test.ts :333-334, :346 READ_FNS, :347-349 READ_RESULT, :397-403 per-function [args, result];
  chat-read.test.ts :17-28 COLS, :29 LIST, :33 GET, :216 and :223 (fields toEqual COLS); realtime-auth.test.ts :203-219
  (a fake chat_get_message row).
- MEASURED CORRECTION (Tier A): the lane block names packages/db/src/chat-channel-reads.ts, but that file (36 lines) holds
  only `listChatChannels` :17 and never calls chat_list_messages. The consumer edit lands in chat-service.ts (section 4.2);
  chat-channel-reads.ts is untouched.
- Only the history GET needs the label; getChatMessage feeds the frame `{type, channelId, messageId}` only => decision (c).

## 3. Q2 privileges and attributes
- chat_definer on memberships: `GRANT SELECT (id, person_id, tenant_id, status) ON memberships TO chat_definer` (0031:322);
  display_name not included; no table-level grant.
- Both functions (0063): plpgsql, STABLE, SECURITY DEFINER, `SET search_path = pg_catalog, public, pg_temp` (list :534-537,
  get :594-597); REVOKE ALL FROM PUBLIC + GRANT EXECUTE TO app (:588-589, :624-625); SECTION 4 (:634-646) = transient
  `GRANT USAGE, CREATE ON SCHEMA public TO chat_definer`, ALTER FUNCTION ... OWNER TO chat_definer, `REVOKE CREATE`.
- No ALTER DEFAULT PRIVILEGES (only a comment at 0034:370) => a re-created function starts with owner + PUBLIC EXECUTE.
- CREATE OR REPLACE cannot change RETURNS TABLE (OUT parameters) => DROP FUNCTION + CREATE.

### 3a. DB probe (plexco_test, read-only SELECTs, script status/P3-S12a-notes/scripts/l15a-q2-readonly-probe.sh)
- schema_migrations tail 0064. chat_definer: rolsuper f, rolbypassrls t, rolinherit f, rolcanlogin f; its one member is
  plexco (inherit t, set t).
- `has_column_privilege('chat_definer','public.memberships','display_name','SELECT')` = f; table SELECT = f => (d) NEEDED.
- memberships: RLS enabled + forced, one policy tenant_isolation; chat_definer is BYPASSRLS, so the function's
  channel-tenant predicate is the fence (0063:555-558). display_name: text, nullable, no constraint, no validating trigger.
- `memberships_active_person_unique` = UNIQUE (tenant_id, person_id) WHERE status IN ('active','guest').
- chat_messages: author_type IN ('person','assistant','system'); person => author_person_id NOT NULL; non-person => NULL.
- Both functions live: owner chat_definer, prosecdef t, provolatile s, proconfig `{search_path=pg_catalog, public,
  pg_temp}`, proacl `{chat_definer=X/chat_definer,app=X/chat_definer}`, the same 10-column TABLE; zero pg_depend dependents.

### 3b. MEASURED CORRECTION: migration idiom (Tier A, precedent 0032)
- DROP is ownership-checked and CREATE needs schema CREATE; under the BR-6 NOINHERIT migration posture the migration role
  cannot drop a chat_definer-owned function. 0032:42-55, :80, :83 runs the replace AS chat_definer inside the transient
  `GRANT USAGE, CREATE ON SCHEMA public TO chat_definer` ... `REVOKE CREATE ON SCHEMA public FROM chat_definer` bracket,
  the same transient pair 0063 SECTION 4 (:634-646) uses. So the lane block's "ownership steps exactly as 0063 SECTION 4"
  holds, and the lane adds NO net grant beyond the one column grant. The column grant runs as the migration role (table
  owner), outside the bracket. Result: owner chat_definer, ACL `{chat_definer=X/chat_definer,app=X/chat_definer}`.

### 3c. Q5 locks and shape pins
- Reader lock `withDefinerReadLock(base, fn)` test-harness.ts:547-550 (breaker `withChatDefinerLock` :454);
  setupRlsTestContext :679 migrates inside it (:701); never nest a reader lock in a reader's fn (:552-557).
- chat-catalog.test.ts:373-404 (owner, SECURITY DEFINER, STABLE, search_path) and :406 on (EXECUTE exactly chat_definer +
  app; PUBLIC, app_worker, readonly not; RO-L14-8 aclexplode) run on the migrated catalog => re-assert after the DROP.

### 3d. Q6 pins and migration number
- 0065. Tail pins: migrate.test.ts:53 (MIGRATION_COUNT 65 + comment), :769; rls-invariants.test.ts:70, :73, :1825, :1830,
  :2108, :4701, :4703, :4704; outbox-projector-registry.test.ts:114-120 (one site). Each 65 -> 66, 0064 -> 0065.

## 4. Q3 and Q7 answers, contract

### 4.1 Q3 display_name writers, validation, decision log
- Writers of memberships rows (`git grep` insert/update memberships, SQL + drizzle, non-test): 0012:280, 0028:263,
  0037:148 insert without display_name (NULL); 0058:78-80 inserts a 'guest' row with display_name copied from
  persons.display_name (0058:58-60); apps: packages/db/src/roster-service.ts:121 `.insert(memberships)`. No UPDATE writer.
- 0051:54-58 (btrim, 1..100) and 0053:196 (`left(nullif(btrim(p_display_name), ''), 120)`) bound persons.display_name only.
  memberships.display_name has no DB bound ("nullable and unbounded", session-service.ts:2893). The function's normalizer is
  the only DB-side bound; it reuses the 0053:196 expression. btrim strips spaces only; control characters are not stripped.
- Club scope: the label is the memberships row of the CHANNEL's tenant, the same value the club roster resolves (DD-85
  decisions.md:1219). A 0058 copy originates from the global name at join, but the function never reads persons and a
  guest row is NULL. Not a STOP condition.
- decisions.md queries: `grep -c -i display_name` 31; `grep -c -i 'sender name'` 0; `grep -c safeLabel` 0;
  `grep -c -i -w author` 27. Governing hits: DD-85 :1206-1225 (display_name is a display label, not a key, non-unique;
  shown to host/authenticated only), DD-92 :1334-1341 (author delete leaves only a tombstone on shared surfaces), DD-46 :647
  (public alias, not this surface). None forbids a same-club label; "Labels ok" authorizes it.

### 4.2 Q7 DTO path and wire
- The message DTO mapper is local: apps/web/app/api/chat/channels/[id]/messages/route.ts `toDto` :19-29 (doc :18), `mine`
  computed server-side at :28 (`row.authorPersonId === personId`); `live` copies named fields only (:20, :27).
- Only the history GET (:31-42, listChatMessages -> toDto) returns a message DTO. POST returns {id, createdAt, duplicate}
  (:45-60); PATCH [messageId]/route.ts:25 {id, editCount, editedAt, ...}; DELETE :36 {id, authorDeletedAt, ...};
  moderation/route.ts:26 {messageId, moderationState, ...}. `ChatMessageDto` is imported only by messages/route.ts:1, :19.
- Wire types: packages/core/src/api-contract.ts ChatLiveMessageDto :226-237, ChatTombstoneDto :241-246, union :248.
- Wire tests: api-contract.test.ts:342-368 (keyof live + satisfies sample; :367 authorPersonId rejected), :373-383
  (tombstone keyof); apps/web/lib/chat-routes-db.test.ts:339 (no authorPersonId), :344 (first live row);
  apps/web/lib/chat-stream-db.test.ts:440, :630-633 (G2: no person uuid or authorPersonId anywhere; unchanged).
- No person id reaches the wire: authorPersonId stays in the server row; the DTO gains one string field.

### 4.3 Contract
- 0065 shape: header (purpose, THREAT MODEL, decision table, why DROP + CREATE, precedent 0032);
  `GRANT SELECT (display_name) ON public.memberships TO chat_definer;` then `GRANT USAGE, CREATE ON SCHEMA public TO
  chat_definer; SET ROLE chat_definer; DROP FUNCTION public.chat_list_messages(uuid, timestamptz, uuid, text, integer);
  CREATE FUNCTION` with the same arguments, LANGUAGE, STABLE, SECURITY DEFINER, SET search_path, the 0063 body and the old
  10 columns plus trailing `author_label text`; `REVOKE ALL ... FROM PUBLIC, app_worker, readonly` (0064:66 form);
  `GRANT EXECUTE ... TO app; RESET ROLE; REVOKE CREATE ON SCHEMA public FROM chat_definer;`.
- Label rule, in BOTH RETURN QUERY branches (0063:564-573, :575-584): `LEFT JOIN public.memberships am ON am.tenant_id =
  v_ch.tenant_id AND am.person_id = <message>.author_person_id AND am.status = 'active'` (an alias distinct from the
  caller-gate alias) and `CASE WHEN <the body CASE's visible predicate, 0063:565, copied verbatim> AND <message>.author_type
  = 'person' THEN left(nullif(btrim(am.display_name), ''), 120) END AS author_label`. No argument added; get untouched.
- Consumers: chat-service.ts exports `ChatMessageListRow extends ChatMessage { authorLabel: string | null }`;
  listChatMessages selects `f.author_label AS "authorLabel"` on the LIST query only (MESSAGE_COLUMNS unchanged);
  packages/db/src/index.ts:156 named export list gains the type; route.ts toDto takes ChatMessageListRow and `live` gains
  `authorLabel`; api-contract.ts ChatLiveMessageDto gains `authorLabel: string | null` (doc line). ChatTombstoneDto unchanged.

## 5. Decisions (a)-(h)
- (a) Join by the channel's tenant + author_person_id, status 'active', through memberships_active_person_unique. Why: a
  re-join creates a new membership row, so chat_messages.membership_id can point at a 'left' row (against "current name");
  the partial unique index admits one active row per (tenant, person), so the LEFT JOIN cannot duplicate a message;
  v_ch.tenant_id is proven equal to the caller's tenant (0063:555-558). Plan, 100-row page: Limit -> Nested Loop Left Join
  -> the keyset index scan on chat_messages LIMIT v_limit (<= 100, 0063:544) -> <= 100 probes on the partial unique index.
- (b) 'guest' is not a current member for the label: 0063's read gates require `m.status = 'active'` (list :557, get :621).
- (c) chat_get_message untouched: its only consumer builds the id-only frame (2, 4.2).
- (d) `GRANT SELECT (display_name) ON memberships TO chat_definer`: NEEDED (has_column_privilege = f, 3a); nothing else.
- (e) Per-row test map: section 7, file packages/db/src/chat-read.test.ts (new describe, reusing its fixtures).
- (f) Not mirrored: schema.ts and db.dbml name chat_definer only in prose comments (schema.ts:868, :1104, :1117, :1148;
  db.dbml:676) and carry no GRANT (schema.ts:1994: migrations are authoritative for grants) => both untouched.
- (g) 11 tail pins (3d) plus a 12th: chat-schema-invariants.test.ts:1031-1043 pins chat_definer's memberships columns to
  [id, person_id, status, tenant_id] -> [display_name, id, person_id, status, tenant_id]. All 12 test-only mechanical.
- (h) authorLabel goes on the shared ChatLiveMessageDto, whose only producer is the list GET, so no other path fills NULL;
  never on ChatTombstoneDto (RO-L15-3 f); the person id never reaches the wire.

## 6. Pinned defaults (each: default applied, pending owner sign-off)
- L-1 The label is the author's CURRENT club display_name (not a send-time snapshot).
- L-2 Left, merged, guest or no active membership in the channel's tenant -> NULL; author_type <> 'person' -> NULL.
- L-3 NULL or blank display_name -> NULL; `left(nullif(btrim(display_name), ''), 120)` (the 0053:196 expression; btrim
  default set; control characters not stripped, the roster shows the same value).
- L-4 Tombstoned row (author_deleted or moderation_hidden) -> NULL: the label uses the body CASE's predicate.
- L-5 Wire: `authorLabel: string | null` on ChatLiveMessageDto only (decision h); the tombstone DTO keeps four keys.
- L-6 Named server type ChatMessageListRow (one definition of the list row shape) exported via index.ts:156.

## 7. Acceptance matrix (real DB, app role through asApp chat-read.test.ts:95, inside withDefinerReadLock)
New describe "0065 author_label (L15a decision table)" in packages/db/src/chat-read.test.ts, reusing beforeAll :49, the
two-club member (:235), the re-join flow (:263), the left-only person (:282) and the DT-21 tombstones (:192); display
names and non-person rows are seeded through the owner pool.
| # | Decision-table row | Case | Expected |
|---|---|---|---|
| T1 | active author, non-blank name | `'  Minh  '`; a 130-character name | `'Minh'`; 120 characters |
| T2 | name NULL or blank | NULL; `'   '` | NULL, NULL |
| T3 | left, merged, none | author left; merged; guest (b) | NULL each; list still answers |
| T4 | non-person author | a system row and an assistant row | NULL |
| T5 | tombstoned | author_deleted; moderation_hidden; readers author, member, moderator | NULL label, NULL body |
| T6 | cross-club | one person, names A and B in two clubs | club A reader sees A only; B string absent from the whole result |
| T7 | signature | fields of list = [...COLS, "author_label"] (:216); args unchanged | old 10 columns + author_label |
| T8 | re-join | leave, new active row with a new name | old message shows the new name |
| T9 | authorization unchanged | non-member list; get | CHAT_FORBIDDEN; zero rows (DT-35 :282 on the 0065 catalog) |
| T10 | ACL and attributes after DROP | chat-catalog.test.ts:373-404, :406 (no edit) | app yes; PUBLIC, app_worker, readonly no; owner chat_definer |
| T11 | column grant | chat-schema-invariants.test.ts:1031-1043 | [display_name, id, person_id, status, tenant_id] |
| T12 | wire | api-contract.test.ts:342-383; chat-routes-db.test.ts:339-344 | authorLabel on live rows; none on tombstones; no authorPersonId; no uuid outside id, channelId, reply ids |

## 8. Test and harness rules
- One DB/e2e lock (status/.db-e2e.lock via locked-run.sh, copied from status/P3-S13a-notes/scripts/); one migration at a time.
- Known flakes: status/conductor-scripts/clerk-flake-list.txt; one rerun, a second red is real.
- The label cases name chat_definer's grant and run its function: they hold withDefinerReadLock (conductor note 7b).

## 9. Scope
- IN: NEW packages/db/migrations/0065_chat_message_author_label.sql; EDIT packages/db/src/chat-service.ts,
  packages/db/src/index.ts, apps/web/app/api/chat/channels/[id]/messages/route.ts, packages/core/src/api-contract.ts;
  tests chat-read.test.ts, apps/web/lib/chat-routes-db.test.ts, packages/core/src/api-contract.test.ts; mechanical
  (apart): migrate.test.ts, rls-invariants.test.ts, outbox-projector-registry.test.ts, chat-catalog.test.ts:347-349 and
  :397-403, chat-schema-invariants.test.ts:1031-1043; this file.
- OUT: chat-channel-reads.ts, chat_get_message, every other function, schema.ts, db.dbml, any table, column, index,
  trigger, policy or role, persons, the SSE frame, realtime listener and auth, rate limits, routes, UI, workflows; no
  safeLabel, member-targets, mention, DM or search; Reviewed specs (BE DTO whitelist via L17).
- STOP check: no condition holds (no persons read, no new table or column, no person-id argument, only
  chat_list_messages replaced, the name is club-scoped).

## 10. B3 budget and review plan
- Non-test (gross added lines, comments included): 0065 ~105-115; chat-service.ts ~8; index.ts 1; route.ts ~3;
  api-contract.ts ~4 => ~121-131 of 400. Counted tests: chat-read.test.ts ~180-230, chat-routes-db.test.ts ~20-30,
  api-contract.test.ts ~4 => ~205-265 of 700. Mechanical apart: ~21 lines in 5 files. Total ~350-420 of 1100.
- Files: 9 counted (5 non-test, 3 test, this file) of 12, plus 5 mechanical files counted apart (conductor note 5).
  Modules 3 (packages/db, apps/web, packages/core); migrations 1. If docs count as non-test, this file adds ~230: still
  under 400. Within the pre-approved caps: no ruling request.
- Review: opus/max reviewer + opus/max security round, at most 3 rounds; questions per the lane block REVIEW PLAN.

## 11. OPEN (non-blocking; owner named per item)
- O-1 (conductor, L17): the BE spec DTO whitelist (docs/features/BE/feature_inapp_chat_tech.md) gains authorLabel in
  the L17 closeout; this lane edits no Reviewed spec; the PR body says so.
- O-2 (L16): render authorLabel as a text node, "You" for mine, "Member" when NULL; stored names may hold control or bidi
  characters (L-3), so isolating the label is L16's choice.
- O-3 (L17 backlog, existing): the 0063 functions do not check archived_at (L17-carry-forward.md:209); the replaced
  function keeps the 0063 body unchanged.

## 12. Closure matrix (12 of 12) and verdict

| # | Gate | Evidence | Result |
|---|---|---|---|
| 1 | Authority snapshot pinned by SHA | `AUTHORITY_SHA` = worktree HEAD = session base; every TARGET_FILES path exists at the base | PASS |
| 2 | Decisions in scope final | "Labels ok" and D4 signed; RO-L14/RO-L15 applied (1); L-1..L-6 pinned as defaults | PASS |
| 3 | Scope IN/OUT and owner clear | section 9; lane NEGATIVE SCOPE; L16 owns the UI, L17 the spec | PASS |
| 4 | Dependencies classified | L15 (#86), L14 (#83), L13a (#84) on the base; tail 0064 | PASS |
| 5 | Live schema and code match | sections 2-4, measured at the base and in the catalog (3a) | PASS |
| 6 | Data, API, state, auth contract | section 4.3 and decisions (a)-(h) | PASS |
| 7 | Fail-closed, idempotency, order | every deny is NULL; authorization unchanged; read-only, no write path | PASS |
| 8 | Open questions in scope = 0 | section 6 pins; section 11 is non-blocking | PASS |
| 9 | Acceptance matrix with expected results | section 7 | PASS |
| 10 | Migration, security, rollback | one migration, one column grant, ACL re-asserted; security round; rollback = a forward migration | PASS |
| 11 | First slice hard dependencies merged | L15, L14, L13a on the base; D4 signed | PASS |
| 12 | Implementation handoff ready | sections 4-10; worktree at the base with only this file added | PASS |

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-10-20
AUTHORITY_SHA: 03e17a5b7c99db9365ddc41dc213e648273bbffc
BASE_BRANCH: main
TARGET_FILES:
  - docs/standards/review-code-readiness-gate.md
  - docs/standards/decisions.md
  - docs/sessions/web-mvp-phase3-readiness-p3-m10-chat-api-live.md
  - docs/features/BE/feature_inapp_chat_tech.md
  - docs/features/FE/feature_inapp_chat.md
  - packages/db/migrations/0031_chat_schema_core.sql
  - packages/db/migrations/0032_chat_dm_safety_config_single_read.sql
  - packages/db/migrations/0058_player_self_join.sql
  - packages/db/migrations/0063_chat_message_commands.sql
  - packages/db/migrations/0064_channel_identity_link_gate.sql
  - packages/db/src/chat-service.ts
  - packages/db/src/test-harness.ts
  - packages/core/src/api-contract.ts
SLICE: p3-m10-chat-author-labels
IN_SCOPE: section 9 IN - migration 0065 replacing chat_list_messages with a trailing author_label, one column grant, the list reader, DTO field, tests
OUT_OF_SCOPE: section 9 OUT - chat_get_message and every other function; tables, columns, policies, roles; persons; SSE frame, listener, rate limits; UI
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: L15 merged at 03e17a5b7c99db9365ddc41dc213e648273bbffc (#86); L14 (#83, 0063) and L13a (#84, 0064) on the base; D4 signed; owner "Labels ok"
PRIOR_SLICES: L14 (P3-S11, #83), L13a (#84), L15 (P3-S12, #86)
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS # one migration, one column grant, 0032 SET ROLE bracket, ACL and attributes re-asserted by tests; opus/max reviewer + security round
IMPLEMENTATION_ARTIFACTS: PASS
FIRST_IMPLEMENTATION_STEP: re-check HEAD, then 0065 with the chat-read.test.ts label block (T1-T9) and the 12 mechanical pins
REMAINING_BLOCKERS: none
```
