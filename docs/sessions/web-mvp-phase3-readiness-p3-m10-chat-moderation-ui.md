<!-- review-readiness: code-ready -->

# Step-0 readiness: L16b p3-m10-chat-moderation-ui (session P3-S13b)

> Agent-facing contract for the L16b writers and their code reviewer. Readiness reviewer: opus/high, the same model and effort as
> the lane's code reviewer. Writers: sonnet/high, one unit each (section 11). Code reviewer: opus/high, at most 3 rounds (pre-push
> rounds count), area-split; no security round (void condition in section 0). DD-122 D4: Codex waived by owner 2026-10-12; review
> by an independent Claude subagent. Every `path:line` is measured at BASE `9afb29356eb9a7dce2794554fdf9491b3f5d6d0b` (W = the
> lane worktree `.autopilot/worktrees/p3-m10-chat-moderation-ui`, branch `feat/p3-m10-chat-moderation-ui`). Paths are under
> `apps/web` unless they start with `packages/` or `docs/`. TARGET_FILES (section 13) are read-only context that exists at BASE;
> the edit set is section 10.
>
> Provenance: part A (R0-A, N/l16b-r0-part-a.md) measured the seams and the merged contract; part B (R0-B, N/l16b-r0-part-b.md)
> measured the e2e mock, the tests, the copy and the B3 estimate; the conductor ruling RO-L16b-1 (N/conductor-ruling-l16b-file-cap.md)
> is BINDING; part C (R0-C, this file) re-read `lib/use-chat.ts:270-410`, `lib/use-command-id.ts:1-60`, `lib/chat-error-ui.ts:50-208`
> and the history cursor (`lib/chat-api.ts:184-190`), pinned the defaults and wrote the verdict.
> N = `Claude outputs/plexco-phase3/status/P3-S13b-notes`. 0063 = `packages/db/migrations/0063_chat_message_commands.sql`.

## 0. Threat model and security judgement

- Assets: message bodies; author labels (club display names, PII inside the club); the moderation note (the moderator's free text
  about another person: sensitive); client message ids and commandIds; the session cookie and CSRF token; the two viewer booleans.
- Adversaries: (1) another club member: sees only what the merged routes return; a hidden message reaches every reader as the
  4-key tombstone, never its body or its moderator; (2) a later reader of the device or browser profile: nothing about chat or
  moderation persists client-side (section 8); (3) a viewer who forges or keeps a stale `canModerate: true` (devtools, a demotion
  mid-session): gets 403 CHAT_MODERATION_FORBIDDEN, because the definer checks the capability before the input and before the
  replay lookup (0063:469-494), so not even a stored result is replayed to a demoted moderator; (4) a hostile body or label:
  React text nodes only (L16 rules unchanged).
- Out of the model: server authorization. L14, L15 and L15b re-check every request (cookie actor, CSRF, live membership,
  capability, rate buckets). The flags authorize nothing; the UI uses them only to decide what to show.
- Security judgement: no security round (conductor note 1: a UI hint over finished routes). The judgement is VOID, and an opus/max
  security round is added with the reason stated, if the diff: sends or receives a role, a person id or a capability name beyond
  the two booleans; writes a body, note, label, client message id or commandId to a console call, log, analytics event, error
  report, URL, storage or cache; edits any `app/api` route, auth or session helper, `sw/*` or `packages/*`; or infers an
  authorization outcome from anything other than the two server flags. Step 0 found no such surface: the client needs the two
  booleans plus the existing DTO fields `mine`, `authorType` and `tombstone`.

## 1. Base, dependencies, authority

- BASE `9afb29356eb9a7dce2794554fdf9491b3f5d6d0b` = origin/main = the L16 PR #89 merge commit (`git log --oneline -1 origin/main`
  prints `9afb293 Merge pull request #89`). Part C measured W: `git status --porcelain --branch` prints only
  `## feat/p3-m10-chat-moderation-ui`; `git rev-parse HEAD` = BASE; no index.lock in `.git/worktrees/p3-m10-chat-moderation-ui`.
- Hard dependencies merged at BASE: L15b #88 (merge `2844c537f3211486d588c44cc489f629e9e34b19`; `app/api/chat/channels/route.ts:32-49`
  answers `data = {channels, viewer: {canModerate, canPostRestricted}}`) and L16 #89 (merge `9afb293`; the chat UI). Earlier: L14
  #83 (0063), L15 #86 (the moderation route `app/api/chat/channels/[id]/messages/[messageId]/moderation/route.ts`), L15a #87.
  Migration tail at BASE: 0065; this lane adds none.
- Authority: the owner's "moderation ok" (2026-10-20; status/CONDUCTOR-LOG.md and the L16b lane block header) and RO-L16b-1 (file
  cap 21, line caps unchanged, C1-C4 accepted). This lane reverses RO-L16-1 (status/P3-S13-notes/conductor-ruling-l16-step0.md:7-13)
  for the moderation controls and the composer state only. Everything else L16 pinned stays: its copy deck and DF ledger, the
  ConfirmDialog with its built-in cancel, the privacy rules, the coalesced refetch rounds.
- Authority order, earlier wins: (1) the merged code at BASE (0063, `packages/db/migrations/0047_tenant_capability_authority_core.sql`,
  the channels and moderation routes, `lib/chat-route.ts`, `packages/db/src/chat-service.ts`, `packages/core/src/api-contract.ts`);
  (2) the PR #86 body (Routes, Contract L16 consumes, Error map) and the PR #88 body; (3) the L16 readiness file
  `docs/sessions/web-mvp-phase3-readiness-p3-m10-chat-web.md`; (4) the lane block as corrected in section 2.

## 2. Measured corrections to the lane block

C1-C4 come from part A and are accepted by RO-L16b-1; C5-C7 come from part B.

- C1: `moderate_chat_message` (0063:437-521) has NO author check. The target lookup (0063:495-497) is `msg.id = p_message AND
  msg.channel_id = p_channel AND msg.author_type = 'person' FOR UPDATE`, so a moderator may hide their own message on the server.
  "Own live message: no entry" is a UI default (DM-1).
- C2: every non-person target is 403 CHAT_MODERATION_FORBIDDEN (0063:496-497). The Hide entry also requires `authorType ===
  "person"`; the MessageActions `m` Pick (`components/chat/message-actions.tsx:35`) gains `authorType`.
- C3: the note rule is `octet_length(p_reason_note) BETWEEN 1 AND 500` (0063:481-482): 500 UTF-8 BYTES, not characters. For spam,
  harassment, unsafe and off_topic the note must be absent or null; `""` is 422 (`"" IS NULL` is false).
- C4: restore has no author rule and no state precondition and takes the same reason rule (0063:480-484); a no-op restore is 200
  `changed: false` with no audit row but spends a receipt and a rate token (0063:498-517). Restore never touches
  `author_deleted_at` (0063:504-509) and author_deleted wins on read (0063:526), so Restore is offered only on a
  `moderation_hidden` tombstone. The restore response has no body: DM-4 pins the refresh.
- C5: the e2e mock ALREADY returns `viewer` per persona (`e2e/support/chat-api-mock.ts:63-75`; privileged = `persona !== "member"`
  at :172-175, matching the co-admin preset 0047:85-86). No persona that reaches the chat UI gets false: `member` sees No access
  with zero /api/chat calls (`e2e/chat.spec.ts:124-133`). A false viewer comes from the EXISTING per-test override
  (`replies.channels`, mock :163, merged at :172-175, or `chat.reply("channels", ...)` at :203), which is a real route shape
  (L16c's member entry produces it). No new persona or mock option. The mock has no moderation route (500 E2E_NOT_STUBBED, :16, :189).
- C6: `message-actions.tsx` has no `.module.css` and no test, and `channel-view.tsx` has no test (the lane block says "each with
  .module.css and tests"); their unit coverage lives in `components/chat/message-list.test.tsx`.
- C7: no "CC-1..CC-10" labels exist at BASE (`git grep -nE '\bCC-[0-9]+'` over docs and apps/web is empty). L16's pinned copy is the
  section 5 copy deck of its readiness file (:183-255) and its DF ledger (:385-395; DF-12 tombstone copy at :391).
- Re-counts by part C: part B's file total is 20, not 21 (10 non-test + 9 test + this file; section 10), and the new copy pairs are
  16, not 14 (section 7 adds the note-too-long pair part B missed).

## 3. Contract consumed (merged at BASE)

- Route: POST `/api/chat/channels/:id/messages/:messageId/moderation` (`moderation/route.ts:9-28`), `chatGate(request, {ids:
  {channelId, messageId}, json: true})`, x-csrf-token like every mutation (PR #86 item 16). Body `{action: "hide" | "restore",
  reasonCode: string, reasonNote: string | null (default null), commandId: uuid}` (:13-14). 400 INVALID_BODY when commandId is
  not a uuid, action is not hide or restore, reasonCode is not a string, or reasonNote is neither null nor a string (:15-22).
- Reasons: spam, harassment, unsafe and off_topic need `reasonNote` null; `other` needs a 1..500-byte note; anything else is 422
  CHAT_REASON_INVALID (0063:481-483). The capability check precedes the input check (0063:469-484): a non-moderator always gets 403.
- 200 `{data: {messageId, moderationState: "hidden" | "visible", changed: boolean}, error: null, meta: {requestId}}` (:26;
  0063:455, :519); never the previous body, never another moderator.
- Statuses (`packages/db/src/chat-service.ts:14-30`; gate `lib/chat-route.ts:175-239`): 200 (a replay too); 400 INVALID_BODY (also a
  bad ?tenant=, bad JSON, a non-object body, a NUL); 401 AUTH_REQUIRED; 403 CSRF_INVALID (before any parse); 403 CHAT_FORBIDDEN
  (the non-member pre-gate); 403 TENANT_SUSPENDED; 403 CHAT_MODERATION_FORBIDDEN (non-club kind, no capability or not a member, an
  unknown, non-person or other-channel target: the one in-tenant denial body); 409 CHAT_IDEMPOTENCY_MISMATCH (0063:491); 413
  CHAT_MESSAGE_TOO_LARGE (over 64 KiB); 422 CHAT_REASON_INVALID; 429 CHAT_RATE_LIMITED (120/min per account at the gate, 30/min per
  actor and tenant in the definer, spent by every NEW commandId); 500 fail closed (CHAT_DB_ERROR:*). No 404 on this route.
- Replay (0063:485-494): keyed by (tenant, actor person, command_id); fingerprint `sha256(jsonb_build_array(action, messageId,
  reasonCode, reasonNote))`. The same commandId with the same 4-tuple returns the STORED result before the target lookup and the
  rate token (it may be stale); any difference (a note edit, null vs "", hide vs restore) is 409 with zero mutation, so hide then
  restore always takes two commandIds. Replay runs after the capability check.
- Realtime: `pg_notify('chat_realtime', id)` only when changed (0063:518) becomes the frame `{type: "chat.message", channelId,
  messageId}`; `channelRound` (`lib/use-chat.ts:398-404`) then refetches the newest page only, coalesced at 2 s; the acting
  moderator gets the frame too.
- Viewer: `app/api/chat/channels/route.ts:32-49` runs `listChatChannels(tx)`, then `authorize(tx, {tenantId, action:
  "chat.message.moderate", actorPersonId}).allowed` and the same for `"chat.channel.post_restricted"`, and answers `{data:
  {channels: [...], viewer: {canModerate: boolean, canPostRestricted: boolean}}, error: null, meta: {requestId}}`. The key exists
  only on a live member's 200; no denial body carries it. Types: `api-contract.ts` ChatViewerDto :227-230, ChatChannelListDto
  :233-236, ChatLiveMessageDto :242-256, ChatTombstoneDto :260-265 (kinds :264).

## 4. Seams per file

- `lib/chat-api.ts`: `listChannels` (:178-182) keeps only `{channels: body?.channels}`; `matches(data, CHANNELS)` (:121) is exact on
  keys and rows (:82-97) and `Spec<T>` requires every key (:60). Adding `viewer` to CHANNELS would turn a missing viewer into
  CLIENT_BAD_RESPONSE for the whole list, which the lane forbids, so `viewer` is parsed SEPARATELY: an object with exactly the two
  keys, both `typeof "boolean"`, else `{canModerate: false, canPostRestricted: false}`; the channels check is unchanged; other
  `data` keys stay ignored. `ChatChannelList` (:33-35) gains `viewer`, always present after the parse. New call
  `moderateMessage(ctx, channelId, messageId, {action, reasonCode, reasonNote, commandId})` = `mutate(spec, ctx, "POST",
  messagePath(channelId, messageId) + "/moderation", json)` (:160-176) with the exact result spec `{messageId: isId,
  moderationState: oneOf("hidden", "visible"), changed: isBool}`. The stale comments :23-26 go. Tests that flip:
  `chat-api.test.ts:368-374` (viewer dropped), :377-387 (exactly six calls), :389-395 (the `\/moderation` ban; keep the console
  and storage bans).
- `lib/use-chat.ts`: `ChannelsView` (:100-104) and `channelsView()` (:108-121) gain `viewer`: the parsed viewer on an ok answer,
  both false on ANY non-ok answer (offline included: offline keeps `prev.channels` at :119, not the flags). The history hook gains
  `moderate(messageId, input)` over an exported `moderateAttempt({ctx, channelId, messageId, input, t}): Promise<Settled>` beside
  `removeAttempt` (:362-377); the commandId arrives in `input` and is never minted in the hook. Page model (re-read by part C):
  `historyView` (:270-292) merges a newest page by id and keeps older rows only on overlap; `appendOlder` (:294-300) skips loaded
  ids; `refetchNewest` (:388-396) sends no cursor; a cursor is a previous page's `nextCursor` sent as received
  (`chat-api.ts:184-190`), so the client cannot address an older page by itself.
- `components/chat/message-actions.tsx`: `RowActions {onReply, onEdit, onRemove}` (:17-21) gains OPTIONAL `onModerate(id, input):
  Promise<ChatListError | null>`; the Pick (:35) gains `authorType`. Hide renders only when `actions.onModerate` exists, `!m.mine`
  and `m.authorType === "person"`, beside Reply (:92-94); Edit and Delete are unchanged (:70-91); the sheet mounts only when its
  entry renders (the ConfirmDialog-only-when-mine precedent, :116-131); focus handling follows :45-48.
- `components/chat/message-list.tsx`: `actions` undefined = read-only rows (:22, :115); the tombstone branch (:96-101) keeps the one
  DF-12 text for every kind and adds Restore only when `actions?.onModerate` exists and `m.tombstone === "moderation_hidden"`; the
  tombstone data stays exactly `{id, channelId, createdAt, tombstone}`. Tests that flip: `message-list.test.tsx:145-158` (the
  host-shaped RO-L16-1 case and the per-case `not.toMatch(/hide|restore/i)`; fixture `gone("2", "moderation_hidden")` at :60).
- `components/chat/channel-view.tsx`: the channel comes from `useChatChannels(tenantId, {live: false})` (:21-22), which now also
  yields `viewer`; the row actions (:61) get `onModerate: chat.moderate` ONLY when `viewer.canModerate` is true (an absent
  callback is the fail-closed default by construction); Composer (:64) gets `canPostRestricted={viewer.canPostRestricted}`. The
  link line :29 is L16c's seam: untouched.
- `components/chat/composer.tsx`: `Composer({postPolicy, outbox, reply?})` (:25-33), `admins` (:43), the hint (:107-111) linked by
  aria-describedby (:130), Send disabled only by `!canSend(body)` (:136). New optional prop `canPostRestricted` (default false);
  `admins && !canPostRestricted` disables the textarea and Send and keeps the hint; while the channels load `postPolicy` is
  undefined, so nothing changes; the stale comment :24 goes.
- `lib/chat-error-ui.ts`: the `ChatErrorAction` union (:13) and `TABLES` gain `moderate` (section 6).
- Nothing else assumes `viewer` is absent: no snapshot (no toMatchSnapshot or toMatchInlineSnapshot in components/chat, the chat
  lib tests or e2e) and `use-chat.test.ts` has no viewer reference (part A Q5).
- Test environment (measured by part C): no DOM library in `apps/web/package.json` or the root `package.json` and no `environment`
  in `apps/web/vitest.config.ts`; component tests render with `renderToStaticMarkup` (`message-list.test.tsx:2`,
  `composer.test.tsx:2`). Clicks, focus and retries are proven in Playwright; unit proofs use pure exported helpers and markup.

## 5. Decision table (the server decides; the UI shows)

| # | Condition | UI | Planned test (file: case) |
|---|---|---|---|
| D1 | canModerate; another author's live `person` row | Hide entry; Hide with a reason sends; 200 hidden: tombstone (DM-5); failure: its section 6 row | message-list.test.tsx "moderator: Hide only on another person's live row"; use-chat.test.ts "moderateAttempt hide: exact 4-key moderation_hidden tombstone"; chat.spec.ts "hide then restore with a reason" |
| D2 | canModerate; `moderation_hidden` tombstone | Restore entry; Restore with a reason sends; 200 visible: DM-4 refresh | message-list.test.tsx "moderator: Restore only on moderation_hidden"; use-chat.test.ts "restore: newest-page row returns live", "restore walks to an older page with the received nextCursor"; chat.spec.ts as D1 |
| D3 | `author_deleted` tombstone (C4) | no Restore, for anyone | message-list.test.tsx (same it.each table) |
| D4 | live row with authorType assistant or system (C2) | no moderation entry | message-list.test.tsx (same table) |
| D5 | own live row (C1) | no moderation entry; Edit, Delete, Reply as L16 | message-list.test.tsx (same table) |
| D6 | canModerate false; viewer missing or malformed; any non-ok channels answer | no moderation control anywhere; no /moderation request | chat-api.test.ts "viewer: valid, missing, malformed (non-boolean, null, array, extra inner key), extra data keys"; use-chat.test.ts "a non-ok channels answer yields both flags false"; message-list.test.tsx "no onModerate: no Hide or Restore on any row" (the renamed L16 case); chat.spec.ts "canModerate false: no moderation control" |
| D7 | admins_only and canPostRestricted false / true; all_members | disabled with the hint / enabled / unchanged; 403 CHAT_CAPABILITY_REQUIRED keeps CAPABILITY, no retry | composer.test.tsx (three cases beside :49-56); chat.spec.ts "admins_only with canPostRestricted false: composer disabled"; the existing send row in chat-error-ui.test.ts stays |
| D8 | a retry of a failed moderation; a changed reason or note | the SAME commandId; a NEW commandId | moderation-sheet.test.tsx "submitModeration: a retry reuses the commandId, a reset mints a new one"; chat.spec.ts "moderation Retry reuses the commandId" |
| D9 | 429 | RATE in the sheet, manual retry with the same commandId; no toast, never success | chat-error-ui.test.ts "moderate: CHAT_RATE_LIMITED is RATE with retry"; moderation-sheet.test.tsx "an error renders one role=alert" |
| D10 | reason other / any other reason (C3) | trimmed note of 1..500 UTF-8 bytes before sending / `reasonNote: null`; a 422 still shows REASON_INVALID | moderation-sheet.test.tsx "validateModeration: blank and whitespace-only other fail; 250 x 'đ' (500 bytes) passes; 251 x 'đ' (251 chars, 502 bytes) fails; spam sends null" |
| D11 | 200 hidden with `changed: false` (already hidden, or a replay) | still the tombstone (render from moderationState, never from changed) | use-chat.test.ts "hide changed:false still renders the tombstone" |
| D12 | 403 CHAT_MODERATION_FORBIDDEN (a stale true) | FORBIDDEN, no retry, row unchanged | chat-error-ui.test.ts "moderate: CHAT_MODERATION_FORBIDDEN, no retry"; use-chat.test.ts "a failure leaves the rows unchanged" |
| D13 | network loss, 5xx, a malformed 200, an unknown code | OFFLINE or GENERIC with retry under the same commandId; never read as success | chat-error-ui.test.ts "moderate: fallback rows"; chat-api.test.ts "moderateMessage: an extra key or a bad moderationState is CLIENT_BAD_RESPONSE" |

## 6. Error mapping: action `moderate` (lib/chat-error-ui.ts)

A 5xx infers nothing whatever code it carries (`describeChatError`); every retry reuses the action's commandId (DM-6).

| Code | HTTP | Copy | Retry |
|---|---|---|---|
| CHAT_MODERATION_FORBIDDEN | 403 | NEW t("Bạn không có quyền kiểm duyệt tin nhắn này.", "You cannot moderate this message.") | no |
| CHAT_REASON_INVALID | 422 | NEW t("Lý do hoặc ghi chú không hợp lệ.", "The reason or note is not valid.") | no (a changed input is a new command) |
| CHAT_IDEMPOTENCY_MISMATCH | 409 | GENERIC t("Đã có lỗi. Vui lòng thử lại.", "Something went wrong. Please try again.") | no (as send) |
| CHAT_RATE_LIMITED | 429 | RATE t("Bạn thao tác quá nhanh. Vui lòng thử lại sau giây lát.", "You are going too fast. Please try again in a moment.") | yes |
| CSRF_INVALID | 403 | CSRF t("Trang đã cũ. Vui lòng tải lại trang.", "This page is out of date. Please reload it.") | no |
| AUTH_REQUIRED | 401 | AUTH t("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.", "Your session has expired. Please sign in again.") | no |
| CHAT_FORBIDDEN | 403 | NO_ACCESS t("Bạn không có quyền xem kênh này.", "You do not have access to this channel.") | no |
| TENANT_SUSPENDED | 403 | SUSPENDED t("CLB đang bị tạm ngưng.", "This club is suspended.") | no |
| CLIENT_NETWORK_ERROR | none | OFFLINE t("Bạn đang ngoại tuyến.", "You are offline.") | yes |
| fallback: any 5xx, CLIENT_BAD_RESPONSE, INVALID_BODY, 413, a 404, a timeout, any unknown or missing code | any | GENERIC (fail closed: the row is unchanged) | yes (an uncertain outcome replays under the same key) |

## 7. Tier-B defaults (each: default applied, pending owner sign-off)

- DM-1 (C1): an own live message gets no moderation entry; the author uses Delete. The server would allow it.
- DM-2 (C2): an assistant or system row gets no entry; the server always refuses it.
- DM-3 (C4): Restore only on a `moderation_hidden` tombstone, never on `author_deleted`; the DF-12 text stays the same for both.
- DM-4 (restore refresh; RO-L16b-1's "coalesced refetch of the affected page", specified against the real page model): on a 200
  whose `moderationState` is "visible", `moderateAttempt` refetches through the existing history call only. (1)
  `listHistory(tenantId, channelId)` with no cursor, merged by `historyView` exactly as `refetchNewest` does. (2) While the restored
  id is still a tombstone in the state, the last page did not contain it and its `nextCursor` is non-null: `listHistory(tenantId,
  channelId, nextCursor)` with the cursor exactly as received; such a page only REPLACES loaded rows by id and inserts nothing.
  (3) It stops at the page holding the id, a null `nextCursor`, a non-ok answer or 20 pages (a `ponytail:` ceiling comment: a
  deeper restore shows after a reload). Nothing renders that a server page did not return; a failed walk leaves the tombstone.
  Coalesced: the walk is the restore's only refetch (it does not also mark the channel stale); the live frame's own coalesced
  round may refetch the newest page too, and both merges are idempotent by id. No new route, no client-built cursor.
- DM-5 (hide success): on a 200 whose `moderationState` is "hidden" (changed or not, a replay included), the loaded row becomes
  `{id, channelId, createdAt, tombstone: "moderation_hidden"}` built from the loaded row (the `removeAttempt` precedent,
  `use-chat.ts:362-377`), with no refetch. Why: the 4-key tombstone carries no content, so it cannot show anything the server did
  not return; it drops the hidden body from client memory at once; one request instead of two; the live frame confirms it.
- DM-6 (commandId): the sheet owns one `useCommandId()` keeper (`lib/use-command-id.ts:29-58`; `roster-reverse-dialog.tsx` resets
  on every input change). It calls `get()` with NO payload, because the note is sensitive and must not become a fingerprint (the
  documented secret-body pattern, `use-command-id.ts:25-27`), and `reset()` on every reason or note change and after a 2xx. It
  never calls `settle()` with a chat failure (`isDefiniteFailure` reads thrown errors; chat-api resolves `{ok: false, code,
  status}`), so every failure keeps the key and every retry of the same input goes out under the same commandId: the stored result
  or a fresh first execution, never a second command. This is the safe side of the keeper's sticky-uncertainty rule (a later 4xx
  proves nothing about an earlier uncertain attempt). Closing the sheet unmounts the keeper: a reopen is a new user action.
  `submitModeration(keeper, send, input)` is the exported pure helper that applies this rule (unit-testable without a DOM).
- DM-7 (busy and focus): ConfirmDialog's `busy` (aria-busy and its built-in busy label; Escape and backdrop ignored while busy,
  `confirm-dialog.tsx:57-66, :86-88`); the radios and the note are read-only while busy; one command in flight per sheet. Focus
  returns to the opener (`confirm-dialog.tsx:44-49`); after a successful hide the opener is gone, so focus moves to that row's
  Restore button; after a successful restore it stays on Restore until the row returns live, then moves to the row's Reply.
- DM-8 (429): the sheet stays open with one `role="alert"` line (RATE), the confirm button stays enabled as the manual retry with
  the same commandId; no auto-retry, no toast, never read as success.
- DM-9 (note): rendered only for `other` (an `<input>` TextField, since the dialog's Tab-wrap selector omits `textarea`) and cleared
  on a switch; trimmed; required non-blank; at most 500 UTF-8 bytes measured with `new TextEncoder().encode(note).length`; every
  other reason sends `reasonNote: null`, never `""`.
- DM-10 (viewer fail-closed): a missing viewer, a non-object, a non-boolean flag or an extra key inside `viewer` gives both false;
  any non-ok channels answer, offline included, gives both false.
- DM-11 (entries and status): Hide is a plain button beside Reply; Restore is a plain button in the tombstone row; both labels match
  the `MODERATION` regex of `chat.spec.ts:13`. A success closes the sheet and one polite `role="status"` line announces N15 or N16.
- DM-12 (golden path, part B): the co_admin hides the owner's `textTwo` (spam) and restores it (other plus a note); the owner sees
  the tombstone and the text come back live. This flips the lane block's roles because the co_admin never sends
  (`e2e/golden-path.spec.ts:378-443`); both personas are preset-allowed (0047:86). It fits the cap (about 30 lines;
  TEST_TIMEOUT_MS 1,200,000 at `e2e/support/golden-path-timeouts.ts:16`). Local only.
- DM-13 (composer): `admins_only` with `canPostRestricted` false sets `disabled` on the textarea and Send and keeps the existing
  hint (`chatAdminsOnlyHint`) linked by aria-describedby; no new copy.

New copy pairs (all defaults pending owner sign-off; precedent in brackets):

| # | Use | t("vi", "en") |
|---|---|---|
| N1 | Hide entry and hide confirm | t("Ẩn tin", "Hide") [matches chat.spec.ts:13] |
| N2 | Restore entry and restore confirm | t("Khôi phục", "Restore") [matches chat.spec.ts:13] |
| N3 | hide title | t("Ẩn tin nhắn này?", "Hide this message?") ["Delete this message?", message-list.test.tsx:162] |
| N4 | restore title | t("Khôi phục tin nhắn này?", "Restore this message?") [as N3] |
| N5-N9 | reasons spam, harassment, unsafe, off_topic, other | t("Spam", "Spam"); t("Quấy rối", "Harassment"); t("Nội dung không an toàn", "Unsafe content"); t("Lạc đề", "Off topic"); t("Lý do khác", "Other") |
| N10 | note label | t("Ghi chú (bắt buộc)", "Note (required)") [mark-paid-method-step.tsx:41] |
| N11 | note blank | t("Nhập ghi chú cho lý do khác.", "Enter a note for Other.") [roster-reverse-dialog.tsx:86] |
| N12 | note over 500 bytes (added by part C) | t("Ghi chú quá dài.", "This note is too long.") [TOO_LARGE; no character count, the bound is bytes] |
| N13 | CHAT_MODERATION_FORBIDDEN | t("Bạn không có quyền kiểm duyệt tin nhắn này.", "You cannot moderate this message.") [CAPABILITY] |
| N14 | CHAT_REASON_INVALID | t("Lý do hoặc ghi chú không hợp lệ.", "The reason or note is not valid.") [INVALID] |
| N15 | hide success status | t("Đã ẩn tin nhắn.", "Message hidden.") [roster-remove-dialog.tsx:44] |
| N16 | restore success status | t("Đã khôi phục tin nhắn.", "Message restored.") [as N15] |

Reused verbatim: the legend t("Lý do (bắt buộc)", "Reason (required)") (`components/sessions/roster-reverse-dialog.tsx:80`); cancel
t("Quay lại", "Go back") and busy t("Đang xử lý…", "Working…") built into ConfirmDialog (`components/ui/confirm-dialog.tsx:96, :104`);
RATE, GENERIC, CSRF, AUTH, NO_ACCESS, SUSPENDED and OFFLINE (`lib/chat-error-ui.ts:58-73, :88-89`); the DF-12 tombstone text
t("Tin nhắn đã bị gỡ.", "Message removed.") (`message-list.tsx:38`); the admins_only hint (`chat-error-ui.ts:205-207`).

## 8. Privacy

- No note, body, author label, client message id or commandId in any console call, log, analytics event, error report, URL,
  localStorage, sessionStorage, IndexedDB, Cache API or service-worker cache. The request path carries only channelId and
  messageId (as L16's paths do) and no query; the service worker is untouched and never caches a mutation.
- The note lives only in the sheet's React state and the one request body; the keeper holds no payload (DM-6); closing the sheet
  unmounts it. A successful hide replaces the row object with the 4-key tombstone, so the hidden body leaves client memory.
- Source guards: keep the console and storage half of `chat-api.test.ts:389-395`; add the same guard for `moderation-sheet.tsx`.
  Fixtures use synthetic notes only.

## 9. Test plan

- Unit (vitest, node environment, markup via `renderToStaticMarkup`): the section 5 rows in `lib/chat-api.test.ts`,
  `lib/use-chat.test.ts`, `lib/chat-error-ui.test.ts`, `components/chat/moderation-sheet.test.tsx`,
  `components/chat/message-list.test.tsx` (an it.each over own, peer person, assistant, system, moderation_hidden and author_deleted
  rows, with and without `onModerate`) and `components/chat/composer.test.tsx`. The multi-byte bound case is D10.
- Seam rules (L16 lessons 7b and 7c): every fetch mock answers the real envelope `{data, error, meta}` or a real error body;
  `moderateAttempt` and `submitModeration` are fed the `ChatResult` union chat-api produces, never a thrown error or a bare object.
- e2e (`e2e/chat.spec.ts`, mocked): the :109-122 loop flips to "controls render only when the server says so" (owner and co_admin
  with the default viewer see Hide on the peer row only; the sorted names gain Hide); a viewer `{canModerate: false,
  canPostRestricted: false}` through the existing `replies.channels` override shows no button, menuitem or link matching
  MODERATION and makes no /moderation request; hide with spam (body `reasonNote: null`) then restore with other plus a note
  (two different commandIds); a first moderation POST answering 500 then Retry sends the same commandId (the :44 send precedent);
  admins_only with `{canModerate: true, canPostRestricted: false}` disables the composer with the hint.
- Mock (`e2e/support/chat-api-mock.ts`): ROUTES gains `moderate: ["POST", /^\/api\/chat\/channels\/[^/]+\/messages\/[^/]+\/moderation$/]`
  (a literal regex; edit and remove are PATCH and DELETE, so no collision) and `ready()` a default real-shape reply
  `{messageId, moderationState: "hidden", changed: true}`; specs override with `chat.reply("moderate", ...)` for restore.
- a11y matrix (`e2e/chat-a11y.spec.ts`): one "sheet open" state at 375x812 and 1280x800, light and dark (4 cases): open Hide, wait
  for the dialog, axe wcag2a/2aa/21a/21aa/22aa clean on serious and critical, no overflow at 375.
- Golden path (W8, local only): DM-12.
- After every unit: the FULL `NODE_ENV=test pnpm --filter @plexco/web test 2>&1 | tail -40`. Playwright only under the shared
  DB/e2e lock wrapper. Before the push: grep the diff for `new RegExp(` with a non-literal argument, a local Semgrep if the repo
  provides one, `pnpm build` once at the final head.

## 10. B3

RO-L16b-1, verbatim: "File cap 21 (counted as b3-measure.sh counts: every changed file including e2e specs, unit tests, the
.module.css, the new component and the readiness doc); line caps UNCHANGED: non-test 700, test 900, total 1,500; 0 migrations;
modules as named in the lane block." Its 90% report point: "630 / 810 / 1,350 lines or 19 files"; a projection above the caps
there stops the remaining units for a split request. The +30 non-test / +60 test allowance for NAMED review findings stays.

| File (size at BASE) | Est. added | File (size at BASE) | Est. added |
|---|---|---|---|
| lib/chat-api.ts (235) | +55 | lib/chat-api.test.ts (396) | +85 |
| lib/use-chat.ts (600) | +80 (part B +60, +20 for DM-4) | lib/use-chat.test.ts (358) | +75 |
| lib/chat-error-ui.ts (208) | +25 | lib/chat-error-ui.test.ts (138) | +25 |
| components/chat/moderation-sheet.tsx (NEW) | +130 | components/chat/moderation-sheet.test.tsx (NEW) | +110 |
| components/chat/moderation-sheet.module.css (NEW) | +22 | components/chat/message-list.test.tsx (179) | +40 |
| components/chat/message-actions.tsx (134) | +25 | components/chat/composer.test.tsx (94) | +15 |
| components/chat/message-list.tsx (123) | +20 | e2e/chat.spec.ts (219) | +95 |
| components/chat/channel-view.tsx (70) | +15 | e2e/chat-a11y.spec.ts (60) | +22 |
| components/chat/composer.tsx (142) | +10 | e2e/golden-path.spec.ts (443) | +30 (W8) |
| e2e/support/chat-api-mock.ts (213) | +8 | | |

Totals (band +25%): non-test 390 (488) of 700; test 497 (621) of 900; total 887 (1,109) of 1,500; files 20 of 21 (19 without W8,
this file included); migrations 0. Every cap fits.

## 11. Writer units (in order; one unit each; END the turn after the commit and the hand-off)

Every unit: GitNexus `impact` before editing a symbol (else a caller grep stated in the hand-off), `detect_changes` before the commit,
the FULL web vitest, `pnpm typecheck`, one conventional commit without AI references.

- W1 `lib/chat-api.ts` + `lib/chat-api.test.ts`: the separate viewer parse (section 4, DM-10) and `moderateMessage`; the three
  flipped tests; the D6 parse cases and the D13 response cases. Accept: green, and the channels list still validates exactly.
- W2 `lib/use-chat.ts` + `lib/use-chat.test.ts`: `viewer` in ChannelsView, `moderateAttempt` (DM-5, DM-4), `moderate` in the
  history hook. Accept: D1, D2, D6, D11, D12 cases green, including the walk to an older page with the received cursor.
- W3 `lib/chat-error-ui.ts` + `lib/chat-error-ui.test.ts`: the `moderate` table (section 6), N13 and N14. Accept: one case per row.
- W4 `components/chat/moderation-sheet.tsx` + `.module.css` + `.test.tsx`: ConfirmDialog composed unedited (the
  roster-reverse-dialog precedent), a fieldset radio group, the note TextField, `validateModeration` and `submitModeration`, N1-N12,
  tokens only (`docs/standards/design-tokens.md`), the source guard. Accept: D8, D10 and markup cases green.
- W5 `components/chat/composer.tsx` + `composer.test.tsx`: `canPostRestricted` (D7, DM-13). Placed before W6 because channel-view
  passes the new prop.
- W6 `message-actions.tsx`, `message-list.tsx`, `channel-view.tsx` + `message-list.test.tsx`: the entries, `onModerate` only on
  canModerate, focus and status (DM-7, DM-11). channel-view.tsx:29 and channel-list.tsx stay untouched. Accept: D1-D6 rows green.
- W7 `e2e/support/chat-api-mock.ts`, `e2e/chat.spec.ts`, `e2e/chat-a11y.spec.ts` (section 9), under the lock wrapper.
- W8 `e2e/golden-path.spec.ts` (DM-12), local only, if the line caps still hold at the 90% report point.

## 12. OPEN (out of scope; none blocks this lane)

- O-1: other viewers who hold a restored (or edited) row in an older loaded page see it only after a reload, because the live
  round refetches the newest page only (`use-chat.ts:388-404`); an L16 property. DM-4 covers the acting moderator only.
- O-2: the server lets a moderator hide or restore their own message (C1) and no route test covers it
  (`lib/chat-routes-db.test.ts`); whether the product wants that is an owner question for a later lane (the UI hides it, DM-1).
- O-3: a demotion mid-session leaves a stale `canModerate: true` until the next channels load; the server's 403 covers it; no
  viewer refetch on a 403 is added.
- O-4: `channel-list.tsx:29` ("no moderation control") stays true, since the list has none, and is L16c's seam file: left alone.
- O-5: the DF-12 text is the same for both tombstone kinds; a distinct "hidden by a moderator" text would be a new product copy
  decision, not requested.

## 13. Closure matrix (12 of 12) and verdict

| # | Gate | Evidence | Result |
|---|---|---|---|
| 1 | Authority snapshot pinned by SHA | `AUTHORITY_SHA` = W HEAD = BASE; `check-target-files-exist-at-sha.sh` reports missing=0 | PASS |
| 2 | Decisions in scope final | the owner's "moderation ok" 2026-10-20; RO-L16b-1; DD-122 D4; DD-136 (D4); DM-1 to DM-13 and N1 to N16 pinned as defaults pending owner sign-off | PASS |
| 3 | Scope IN/OUT and owner clear | sections 4, 10 and 11; the lane NEGATIVE SCOPE; the L16c file ownership | PASS |
| 4 | Dependencies classified | L15b #88 and L16 #89 merged at BASE; L14, L15 and L15a earlier (section 1) | PASS |
| 5 | Live schema and code match | sections 2-4 measured at BASE; no schema change | PASS |
| 6 | Data, API, state, auth contract | sections 3 and 4 | PASS |
| 7 | Fail-closed, idempotency, order | D6, D12, D13; the section 6 fallback row; DM-4, DM-5, DM-6, DM-10 | PASS |
| 8 | Open questions in scope = 0 | every choice pinned in section 7; O-1 to O-5 out of scope | PASS |
| 9 | Acceptance matrix with expected results | sections 5 and 9 | PASS |
| 10 | Migration, security, rollback | no migration and no API, DB, grant or service-worker change; rollback = revert; section 0 | PASS |
| 11 | First slice hard dependencies merged | W1 needs only BASE | PASS |
| 12 | Implementation handoff ready | sections 10 and 11; W at BASE, clean apart from this file | PASS |

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-10-20
AUTHORITY_SHA: 9afb29356eb9a7dce2794554fdf9491b3f5d6d0b
BASE_BRANCH: main
TARGET_FILES:
  - docs/standards/decisions.md
  - docs/standards/review-code-readiness-gate.md
  - docs/standards/design-tokens.md
  - docs/features/FE/feature_inapp_chat.md
  - docs/features/BE/feature_inapp_chat_tech.md
  - docs/sessions/web-mvp-phase3-readiness-p3-m10-chat-web.md
  - packages/core/src/api-contract.ts
  - packages/db/migrations/0047_tenant_capability_authority_core.sql
  - packages/db/migrations/0063_chat_message_commands.sql
  - packages/db/src/chat-service.ts
  - apps/web/app/api/chat/channels/route.ts
  - apps/web/lib/chat-route.ts
  - apps/web/lib/chat-routes-db.test.ts
  - apps/web/lib/chat-api.ts
  - apps/web/lib/chat-api.test.ts
  - apps/web/lib/use-chat.ts
  - apps/web/lib/use-chat.test.ts
  - apps/web/lib/chat-error-ui.ts
  - apps/web/lib/chat-error-ui.test.ts
  - apps/web/lib/use-command-id.ts
  - apps/web/components/chat/message-actions.tsx
  - apps/web/components/chat/message-list.tsx
  - apps/web/components/chat/message-list.test.tsx
  - apps/web/components/chat/channel-view.tsx
  - apps/web/components/chat/channel-list.tsx
  - apps/web/components/chat/composer.tsx
  - apps/web/components/chat/composer.test.tsx
  - apps/web/components/ui/confirm-dialog.tsx
  - apps/web/components/ui/text-field.tsx
  - apps/web/components/sessions/roster-reverse-dialog.tsx
  - apps/web/components/sessions/roster-remove-dialog.tsx
  - apps/web/components/sessions/mark-paid-method-step.tsx
  - apps/web/components/sessions/roster.module.css
  - apps/web/e2e/support/chat-api-mock.ts
  - apps/web/e2e/chat.spec.ts
  - apps/web/e2e/chat-a11y.spec.ts
  - apps/web/e2e/golden-path.spec.ts
  - apps/web/e2e/support/golden-path-timeouts.ts
SLICE: p3-m10-chat-moderation-ui
IN_SCOPE: the chat moderation UI over the merged L15 moderation route and the L15b viewer flags only: a separate fail-closed viewer parse in chat-api.ts and its exposure in use-chat.ts; the moderation call and command with one commandId per user action reused on retry; a lane-own moderation sheet composing ConfirmDialog unedited (reason picker, other-only byte-bounded note, busy, status); Hide on another person's live row and Restore on a moderation_hidden tombstone only when the server says canModerate; the admins_only composer state from canPostRestricted; the moderate error rows; unit tests, the mocked chat e2e, the a11y matrix sheet state and the local golden-path moment
OUT_OF_SCOPE: any API, DB, migration, packages, worker, service-worker, workflow or env change; any new route; a role, person id or capability name on the client beyond the two booleans; AppShell, the session route, the /me tree and the link-building lines of channel-list.tsx and channel-view.tsx (L16c); edits of shared UI components (ConfirmDialog, TextField); DM, media, reaction, search, mention, group, pin, poll, slash command, digest, push, mute or block UI; decisions.md and the FE design spec; enabling dispatch
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: L15b #88 (merge 2844c537f3211486d588c44cc489f629e9e34b19) and L16 #89 (merge 9afb29356eb9a7dce2794554fdf9491b3f5d6d0b) merged at BASE; L14 #83, L15 #86 and L15a #87 earlier (probes: section 1); the owner's moderation ok
PRIOR_SLICES: L14 p3-m10-chat-core (#83), L15 p3-m10-chat-api-live (#86), L15a p3-m10-chat-author-labels (#87), L15b (#88), L16 p3-m10-chat-web (#89)
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS # no migration and no API, DB, grant, service-worker or auth change; the server re-authorizes every moderation command (capability before input and replay, 0063:469-494); the two flags only decide what renders; section 0 voids the no-security-round judgement if a trust-boundary surface appears
IMPLEMENTATION_ARTIFACTS: PASS
FIRST_IMPLEMENTATION_STEP: W1 - GitNexus impact on listChannels (or the caller grep fallback), then the chat-api.test.ts viewer cases red (valid, missing, malformed, extra data keys) before editing apps/web/lib/chat-api.ts
REMAINING_BLOCKERS: none
```
