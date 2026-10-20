<!-- review-readiness: code-ready -->

# Step-0 readiness: L16 p3-m10-chat-web (session P3-S13)

> Agent-facing contract for the L16 writers and their code reviewer. Readiness reviewer: opus/high, the same model and effort as the
> lane's code reviewer. Writers: sonnet/high, one unit or one file each (section 13). Code reviewer: opus/high, at most 3 rounds,
> area-split; no security round (lane MODELS: security none; void condition in section 0). DD-122 D4: Codex waived by owner 2026-10-12;
> review by an independent Claude subagent. Every `path:line` is measured at the base `a23fe96d3b9045a5f143b19bac9b31be97a2daff`
> (W = the lane worktree `.autopilot/worktrees/p3-m10-chat-web`, branch `feat/p3-m10-chat-web`; at step 0 HEAD = base,
> `git status --porcelain` empty, no index.lock). TARGET_FILES (section 17) are read-only context that exists at the base; the edit
> set is section 12.
>
> Provenance: part A (R0-A) measured the merged contract (sections 3-5); part B (R0-B) measured the UI infrastructure, the test
> precedents and the B3 estimate (sections 6.1, 8, 11, 12); the conductor ruling RO-L16-1..4 (N/conductor-ruling-l16-step0.md) is
> BINDING and amends the lane block (section 14); part C (R0-C, this file) closed the three remaining items (section 2), pinned the
> defaults and wrote the verdict. N = `Claude outputs/plexco-phase3/status/P3-S13-notes`. Abbreviations: C =
> `packages/core/src/api-contract.ts`, CR = `apps/web/lib/chat-route.ts`, R = `apps/web/app/api/chat`, M = `R/channels/[id]/messages`.

## 0. Threat model and security judgement

- Assets: message bodies, author labels (a person's club display name: PII inside the club), client message ids, channel titles,
  the viewer's session cookie and CSRF token.
- Adversaries: (1) another member of the same club: sees only what the merged routes return; the UI never widens it; (2) anyone who
  later reads the device or browser profile: nothing about chat persists client-side (section 10); (3) a hostile display name, title
  or body (HTML, bidi or control characters): rendered as React text nodes only, isolated with `<bdi>` or `dir="auto"`, clipped by CSS.
- Out of the model: server-side authorization. L14 and L15 re-check every request (cookie actor, CSRF, live membership, capability,
  rate buckets); the UI only decides what to show and never decides an authorization outcome.
- Security judgement: no security round (lane MODELS). The judgement is void, and an opus/max security round is added with the
  reason stated, if the diff writes chat content, an author label, a channel title or a client message id to any console call, log,
  analytics event, error report, URL, storage or cache; edits `apps/web/sw/*`, any `app/api` route, any auth or session helper or
  `packages/*`; or derives a capability or role decision on the client. Step 0 found no such surface in this plan.

## 1. Base, dependencies, authority

- BASE `a23fe96d3b9045a5f143b19bac9b31be97a2daff` = origin/main = the PR #87 (L15a) merge commit (part A). Part C measured W:
  `git status --porcelain --branch` prints only `## feat/p3-m10-chat-web`; `git rev-parse HEAD` = BASE; no index.lock in the git dir.
- Hard dependencies merged at BASE: L14 #83 (chat core, `packages/db/migrations/0063_chat_message_commands.sql`), L15 #86 (chat
  routes and stream: exactly six route files, `R/channels/route.ts`, `M/route.ts`, `M/[messageId]/route.ts`,
  `M/[messageId]/moderation/route.ts`, `R/channels/[id]/read/route.ts`, `R/subscribe/route.ts`), L15a #87 (author labels,
  `authorLabel` at C:232-234), L13 #85. Probes: those six files, C:214-260, the 0063 functions `send_chat_message` (:177),
  `edit_chat_message` (:267), `delete_chat_message` (:346), `mark_read` (:397), `moderate_chat_message` (:437), `chat_list_messages` (:530).
- Owner decisions: D4 = DD-136 signed (`docs/standards/decisions.md:121`, body `:1769`, owner decision 2026-10-16): club channels
  only; no DM, media, reactions, search, mentions, group, pin, poll, slash commands, digest or push UI. "Labels ok" 2026-10-20 (L15a).
  DD-122 (`:135`) lifts the FE PENDING banner for the MVP; its D4 sets this review regime.
- Authority order for this lane, earlier wins:
  1. The merged code at BASE: the six route files, CR, C, 0063, `packages/db/src/chat-service.ts`.
  2. The PR #86 body (Routes, Contract L16 consumes, Error map, Live path) and the PR #87 body.
  3. Product spec `docs/features/FE/feature_inapp_chat.md` v0.21 (:7), "Reviewed - final Product contract, pending migration"
     (:3, :8); DD-136 narrows the build to club channels (:13). The BE tech doc `docs/features/BE/feature_inapp_chat_tech.md`
     exists; where it and the merged code differ, the merged code wins.
  4. `docs/channels/web/FE/feature_chat_fe.md`: Draft (:9), STALE PIN v0.15 against source v0.21 (:4), every section 6 field
     UNPINNED (:272-288), error tables older than the merged routes (409 CHAT_DUP_MESSAGE :181 against the merged 200
     `duplicate: true`). Layout and UX input only, never implementation authority. L16 does not edit it (section 15).
- Conductor note 5 is a summary to read against the merged text. Where it differs, section 4 wins.

## 2. Items closed by part C

### 2.1 Design tokens (part B, B5)

Token source: `apps/web/app/globals.css`, the only token-defining CSS under apps/web (part B). The writer of WU-5 reads the headings
of `docs/standards/design-tokens.md` (367 lines, a READ FIRST of the session block) before the first `.module.css`.

| Use | Tokens (globals.css line) |
|---|---|
| Page, card and row surfaces | `--bg-page` (:50), `--bg-card` (:51), `--bg-elevated` (:52), `--border` (:60), `--border-strong` (:61), `--border-hairline` (:62), `--border-width` (used by `request-inbox.module.css:24`), `--radius-md` (:101), `--radius-lg` (:102), `--shadow-card` (:107) |
| Text | `--text-primary` (:55), `--text-secondary` (:56), `--text-muted` (:57), `--text-link` (:59); `--text-xs` (:70), `--text-sm` (:71), `--text-base` (:72); `--font-medium` (:79), `--font-semibold` (:80); `--font-sans` inherited (:69) |
| Spacing | `--space-1` to `--space-6` (:88-93), `--space-8` (:94) |
| Composer | `--bg-input` (:53), `--border`, `--focus-ring`; character counter `--text-muted` + `--text-sm` |
| Pending, failed, error notice | pending `--text-muted`; failed and error notices `--error-text` (:29) on `--error-subtle` (:30) |
| admins_only hint | `--text-secondary` on `--info-subtle` (:32) |
| Unread badge | `--accent` (:18) / `--on-accent` (:19), `--radius-full` (:104), `--text-xs` |
| Focus ring | the global `:focus-visible` rule (:289) with `--focus-ring` (light :63; dark :195 and :223): chat modules add no focus rule and never remove the outline |
| Dark mode | role tokens are redefined under `@media (prefers-color-scheme: dark)` `:root:not([data-theme="light"])` (:173-174), `:root[data-theme="dark"]` (:201) and `:root[data-theme="light"]` (:228): a chat module adds no per-scheme rule and no literal colour |

Module to copy: `apps/web/components/sessions/request-inbox.module.css` (":1 Tokens only." header; list :8-14; row :16-26 with
`--space-3`/`--space-4`, `--bg-card`, `var(--border-width) solid var(--border)`, `--radius-md`). The badge pair is proven in both
schemes by the axe matrix (section 11.4); if axe flags it in dark, switch to a pair the dark block redefines (no new token).

### 2.2 Empty or whitespace-only body (part A, NOT REACHED 1)

- Send: the route rejects a non-string body (`M/route.ts:61`, 400 INVALID_BODY). An empty or whitespace-only string passes the route,
  and `send_chat_message` raises INVALID_BODY at 0063:234 (`p_body IS NULL OR p_body !~ '[^[:space:]]'`), before the 4000-character
  check (:235). INVALID_BODY maps to 400 (`packages/db/src/chat-service.ts:27`; mapped pair CR:123).
- Edit: the same non-string check at `M/[messageId]/route.ts:20`; a blank body raises INVALID_BODY in `edit_chat_message` at 0063:319,
  immediately before its 4000-character check (:320), which PR #86 Contract 11 places after the window and conflict checks: a blank
  edit of a closed-window message answers 409 first.
- The other INVALID_BODY raisers in 0063 (client message id length 1..64 :211-212, moderation :478, listing :560) are unreachable from
  a well-formed UI (lowercase uuid ids, no `limit` sent, the cursor passed back verbatim).
- UI pin: Send and Save stay disabled while `body.trim() === ""`. A body the UI passes but the server rejects (a JavaScript whitespace
  versus POSIX `[:space:]` edge) gets the 400 INVALID_BODY row of section 5, with the draft kept.

### 2.3 Seed title of the default channel (part A, NOT REACHED 2)

0063:124, in `chat_provision_member` (0063:115): `VALUES (p_tenant, 'club', 'Kênh chung', true, 0, 'system_bootstrap', 'all_members', false)`:
the default channel is seeded with that title, `is_default` true, sort order 0, post policy `all_members`. Display rule: DF-8.

### 2.4 Impact on the live hook (RO-L16-2 condition 2)

Recorded in section 6.4 (GitNexus could not resolve the symbols; the git grep fallback is recorded there; risk LOW).

## 3. The contract L16 consumes (note 5 a-j, confirmed against the merged code)

Every REST route takes `?tenant=<uuid>` (chatGate, CR:186) and answers the `{data, error, meta}` envelope (D2).

| Route | Body | `data` | Notes |
|---|---|---|---|
| GET `/api/chat/channels` | - | `{channels}`, ordered (sortOrder, id) (`R/channels/route.ts:8-15`) | D-5 read bucket |
| GET `/api/chat/channels/:id/messages` (`&limit=&cursor=`) | - | `{messages, nextCursor}`, newest first per page (`M/route.ts:41-52`) | D-5; `limit` matches `/^[1-9]\d{0,2}$/` and <= 100, absent = 50, else 400 (CR:77-80, :197-200); cursor opaque `"v1."` + base64url, re-encoded on decode (CR:87-99) |
| POST `/api/chat/channels/:id/messages` | `{clientMsgId, body, replyToMessageId?}` | `{id, createdAt, duplicate}` (`M/route.ts:55-69`) | chat-actor and L14 send buckets |
| PATCH `/api/chat/channels/:id/messages/:messageId` | `{body, expectedEditCount}` | `{id, editCount, editedAt, changed}` (`M/[messageId]/route.ts:14-27`) | chat_edit_1m |
| DELETE `/api/chat/channels/:id/messages/:messageId` | - | `{id, authorDeletedAt, changed}` (`M/[messageId]/route.ts:28-38`), idempotent | chat_edit_1m |
| POST `/api/chat/channels/:id/read` | `{throughMessageId}` | `{}` (`R/channels/[id]/read/route.ts:9-18`) | D-5; forward-only (D3) |
| POST `.../messages/:messageId/moderation` | `{action, reasonCode, reasonNote?, commandId}` | `{messageId, moderationState, changed}` | NOT called by L16 (section 7) |
| GET `/api/chat/subscribe` | - | SSE: bare `data: <json>` lines, no `event:` field (`apps/web/lib/realtime-auth.ts:111-114`); `": hb"` comments | one stream per `?tenant=` (`R/subscribe/route.ts:26-63`); the 6th stream of an account is 429 (:53) |

- (a) Live message DTO keys are exactly `{id, channelId, authorType, mine, authorLabel, body, replyToMessageId, editedAt, editCount,
  tombstone: null, createdAt}` (C:227-241); `authorLabel` is `string | null` (C:234); a tombstone is exactly `{id, channelId,
  createdAt, tombstone: "author_deleted" | "moderation_hidden"}` (C:245-250); no person identifier on any row (C:223-226).
- (b) `ChatChannelDto` = `{id, title, sortOrder, isDefault, postPolicy, unreadCount}` (C:214-221), no capability flag; `unreadCount`
  is 0..100 where 100 means 100 or more (render "100+"); the read cursor is not exposed, so after a successful POST read the
  channel list is refetched; zero readable channels is the one CHAT_FORBIDDEN body (D-23).
- (c) Keep the server's page order (never re-sort on `createdAt`); pass `nextCursor` back verbatim, never build or parse it.
- (d) `clientMsgId` = `crypto.randomUUID()`, one per message; a retry of a failed send reuses the SAME id and the identical body
  (D7); POST and PATCH return ids and metadata, never the body, so the optimistic copy is kept; a leading "/" is plain text.
- (g) A frame is exactly `{type: "chat.message", channelId, messageId}` (C:256-260) and only a refetch HINT.
- (h) chat-actor 120 per 60 s per account (CR:34); D-5 60 per 60 s per person (CR:24) on GET channels, GET history and POST read only;
  subscribe admission 30 per minute per account (CR:26-28, `R/subscribe/route.ts:36-39`).
- (i) Every non-GET runs csrfOk before any parse: 403 CSRF_INVALID (CR:181-182); every response is no-store; the stream is
  "no-store, no-transform" (`R/subscribe/route.ts:56-60`).
- (j) mapChatError (CR:151-156) maps the known codes; anything else is rethrown as a 500.
- Client helper (part A, A4): `apiFetch<T>(path, init)` (`apps/web/lib/api-client.ts:55`) sets `x-csrf-token` on every non-GET when
  `init.csrfToken` is truthy (:60), uses `cache: "no-store"` (:70), unwraps the envelope (:82-95), throws `ApiClientError(code,
  message, statusCode)` (:82-92), `CLIENT_NETWORK_ERROR` with status 0 (:38, :73), `CLIENT_BAD_RESPONSE` for a non-envelope body
  (:39, :95). Token: `useTenantContext(tenantId).csrfToken` (`apps/web/lib/use-tenant-context.ts:16-25`; "" without a session, so
  the header is omitted and the server answers 403 CSRF_INVALID). Caller to copy: `apps/web/lib/roster-payments-api.ts:10-14`.
- Time (part A, A5): `apps/web/lib/session-time.ts` formatters (`formatSessionDate` :109-117, `formatSessionTime` :119-126,
  `formatTimestamp` :139-141) with `Intl.DateTimeFormat(locale(lang), {timeZone: resolveTimeZone(tz)})`; locale vi-VN or en-GB (:106);
  `useLang()`/`useT()` from `apps/web/lib/i18n-client` (:30, :34), precedent `apps/web/components/sessions/details-tab.tsx:3`, :35.
  The formatters call `format(new Date(iso))` (:116, :125) and throw RangeError on an invalid string: chat guards first (DF-3).

## 4. Deviations from note 5 (17; the merged text wins and the writers take these)

- D1 (a) `authorType` is `"person" | "assistant" | "system"` (C:230); `authorLabel` is null for every non-person author (PR #87
  default 2; C:232-234). Note 5a's null -> "Member" would mislabel a system row: DF-1.
- D2 (all) every response is the `{data, error, meta}` envelope (PR #86 Routes); use apiFetch, branch on `error.code` only.
- D3 (b) the read route note 5 never names: POST `/api/chat/channels/:id/read?tenant=` with `{throughMessageId}` (uuid) -> `{}`;
  404 NOT_FOUND if unknown or off-channel; forward-only, an older id is not an error (T24); it reads a JSON body (read/route.ts:10),
  so a body above 64 KiB is 413 too.
- D4 (c) `nextCursor` is set on every FULL page (`M/route.ts:48-50`): a full last page yields one extra empty page; an empty older
  page means the end of history, not an error.
- D5 (d, e, read) every id must be a LOWERCASE uuid (uuidOrNull, CR:71-75) else 400; `crypto.randomUUID()` complies.
- D6 (d) send also answers 403 CHAT_CAPABILITY_REQUIRED (admins_only), 409 CHAT_REPLY_INVALID and 409 CHAT_IDEMPOTENCY_MISMATCH
  (another author's clientMsgId) (PR #86 Error map; chat-service.ts:20-22).
- D7 (d) `duplicate: true` returns the ORIGINAL row even when the retried body differs (PR #86 Contract 10): the retry resends the
  identical body; the optimistic copy is immutable until confirmed; a changed draft is a new message with a new clientMsgId.
- D8 (e) PATCH `editedAt` is nullable: null for an identical-body no-op on a never-edited message (`M/[messageId]/route.ts:23-25`).
- D9 (e) a non-author PATCH is 409 CHAT_EDIT_WINDOW_CLOSED (L14 V-9); `expectedEditCount` must be an integer 0..2^31-1 else 400
  (`M/[messageId]/route.ts:19`); 413 comes only after the window and conflict checks (PR #86 Contract 11).
- D10 (e) there is NO single-message GET: "refetch the message" on CHAT_EDIT_CONFLICT means refetch the loaded history range.
- D11 (e) no DTO field says a message is editable (no canEdit, no deadline; C:227-241): DF-2.
- D12 (e) DELETE by anyone but the author, moderators included, is the one CHAT_FORBIDDEN (`M/[messageId]/route.ts:29-30`).
- D13 (f) moderation answers `{messageId, moderationState, changed}`; a non-string reasonCode or reasonNote is 400, an unknown
  reasonCode string 422 (moderation/route.ts:15-26). Informational: L16 does not call it.
- D14 (g) heartbeats are SSE comments `": hb"` every 25 s plus one on open (PR #86 Live path D-3), invisible to EventSource; a
  listener overflow (1000 queued events) closes EVERY chat stream of the process: reconnect jitter is required, not optional.
- D15 (h) note 5h omits L14's DB buckets: send 20 per 10 s and 300 per minute per (person, channel); edit and delete chat_edit_1m
  30 per minute per (person, channel); moderation 30 per minute per (actor, tenant) (PR #86 Routes table, Contract 14).
- D16 (h) D-5 arithmetic: one hint cycle as notes 5b and 5g describe it (history GET + read POST + channels GET) is 3 of 60 tokens;
  at the 2 s coalesce ceiling that is 90 per minute > 60: DF-4.
- D17 (i, j) Next's default 500 is empty and has no no-store; route-level 400 and CHAT_FORBIDDEN text is in the default language,
  mapped codes in the tenant language (CR:49-56, :65-69, :209): the UI renders its own t(vi, en) per code, never the server text.

## 5. Error mapping per screen

Conventions: every call goes through `apps/web/lib/chat-api.ts` -> apiFetch; the UI branches on `ApiClientError.code` only (D17);
codes are verbatim from the merged routes (part A, A2; common rows: 401 AUTH_REQUIRED, 400 INVALID_BODY, 429 CHAT_RATE_LIMITED,
403 CHAT_FORBIDDEN, 403 TENANT_SUSPENDED, mutations 403 CSRF_INVALID, JSON-body routes 413 above 64 KiB). "No retry" means no Retry
control and no automatic retry. Every table ends with the unknown, missing or timeout row, which fails closed. The t(vi, en) pairs
are DF-9.

### 5.1 Channel list screen (`/c/<tenantId>/chat`: GET channels on mount and in live rounds)

| Code (HTTP) | When | UI (`data-state`) | Copy |
|---|---|---|---|
| 200 | channels returned | ready: rows in server order, badge per row ("100+" at 100) | - |
| 403 CHAT_FORBIDDEN | zero readable channels (D-23) or no live membership | empty; live off | t("Chưa có kênh trò chuyện nào bạn được xem.", "There are no chat channels you can read.") |
| 401 AUTH_REQUIRED | the session is gone | error; live off; sign-in link | t("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.", "Your session has expired. Please sign in again.") |
| 403 TENANT_SUSPENDED | the club is suspended | error; live off; no retry | t("CLB đang bị tạm ngưng.", "This club is suspended.") |
| 429 CHAT_RATE_LIMITED | initial load | error, Retry | t("Bạn thao tác quá nhanh. Vui lòng thử lại sau giây lát.", "You are going too fast. Please try again in a moment.") |
| 429 CHAT_RATE_LIMITED | live round | silent: the last list stays, the round pauses (DF-4) | - |
| CLIENT_NETWORK_ERROR (status 0) | offline or network down | offline, Retry; the last list stays when one exists; nothing inferred | t("Bạn đang ngoại tuyến.", "You are offline.") |
| 400 INVALID_BODY, any other code, 500, CLIENT_BAD_RESPONSE, a missing code or a timeout | unknown, missing or timeout | error, Retry; no state inferred | t("Đã có lỗi. Vui lòng thử lại.", "Something went wrong. Please try again.") |

### 5.2 Channel view screen (`/c/<tenantId>/chat/<channelId>`)

#### 5.2.1 History: initial load, older page, live refetch

| Code (HTTP) | When | UI (`data-state`) | Copy |
|---|---|---|---|
| 200 | messages returned | ready in server order; empty when the first page has no messages; an empty OLDER page ends the older-page control (D4) | empty: t("Chưa có tin nhắn nào.", "No messages yet.") |
| 403 CHAT_FORBIDDEN | unknown or non-club channel, or no access | error; live off; link back to the channel list; no retry | t("Bạn không có quyền xem kênh này.", "You do not have access to this channel.") |
| 401 AUTH_REQUIRED / 403 TENANT_SUSPENDED | as 5.1 | as 5.1 | as 5.1 |
| 429 CHAT_RATE_LIMITED | initial load / older page / live refetch | error with Retry / inline at the older-page control, manual retry / silent pause (DF-4) | the 5.1 rate pair, except the silent case |
| CLIENT_NETWORK_ERROR (status 0) | offline | offline, Retry; loaded messages stay; nothing inferred | t("Bạn đang ngoại tuyến.", "You are offline.") |
| 400 INVALID_BODY, any other code, 500, CLIENT_BAD_RESPONSE, a missing code or a timeout | unknown, missing or timeout | error, Retry; no state inferred | t("Đã có lỗi. Vui lòng thử lại.", "Something went wrong. Please try again.") |

#### 5.2.2 Send (composer, optimistic; the pending copy lives in component state only)

| Code (HTTP) | Optimistic message becomes | Copy |
|---|---|---|
| 200, `duplicate` false or true | confirmed: pending mark removed; id and createdAt from the response; body = the optimistic copy (D7) | - |
| CLIENT_NETWORK_ERROR (status 0) | failed + Retry (the SAME clientMsgId and the identical body) + Discard | t("Chưa gửi được.", "Not sent.") |
| 429 CHAT_RATE_LIMITED (chat-actor or the L14 send buckets) | failed + Retry (same clientMsgId) + Discard | the 5.1 rate pair |
| 400 INVALID_BODY | failed, no retry, Discard | t("Tin nhắn không hợp lệ.", "This message is not valid.") |
| 413 CHAT_MESSAGE_TOO_LARGE | failed, no retry, Discard (the composer counter prevents it) | t("Tin nhắn quá dài (tối đa 4.000 ký tự).", "This message is too long (4,000 characters at most).") |
| 403 CHAT_CAPABILITY_REQUIRED | failed, no retry, Discard (RO-L16-1) | t("Bạn không có quyền đăng tin trong kênh này.", "You cannot post in this channel.") |
| 409 CHAT_REPLY_INVALID | failed, no retry, Discard | t("Tin nhắn bạn trả lời không còn khả dụng.", "The message you replied to is no longer available.") |
| 403 CSRF_INVALID | failed, no retry, Discard | t("Trang đã cũ. Vui lòng tải lại trang.", "This page is out of date. Please reload it.") |
| 401 AUTH_REQUIRED / 403 CHAT_FORBIDDEN / 403 TENANT_SUSPENDED | failed, no retry, Discard; live off | the 5.1 or 5.2.1 pair of the code |
| 409 CHAT_IDEMPOTENCY_MISMATCH, any other code, 500, CLIENT_BAD_RESPONSE, a missing code or a timeout | failed + Retry (same clientMsgId; a send that did land resolves as `duplicate: true`) + Discard; no state inferred (CHAT_IDEMPOTENCY_MISMATCH: no retry) | t("Đã có lỗi. Vui lòng thử lại.", "Something went wrong. Please try again.") |

#### 5.2.3 Edit own (PATCH; control per DF-2)

| Code (HTTP) | UI | Copy |
|---|---|---|
| 200 `changed: true` | editor closes; the row shows the new body and the edited label until the next refetch (`editedAt` from the response) | - |
| 200 `changed: false` | editor closes; nothing changes | - |
| 409 CHAT_EDIT_WINDOW_CLOSED | editor closes, original body kept, Edit hidden for that message in this view | t("Tin nhắn này không thể sửa nữa.", "This message can no longer be edited.") |
| 409 CHAT_EDIT_CONFLICT | editor closes; the loaded history range is refetched (D10); no blind retry | t("Tin nhắn đã thay đổi; đã hiện bản mới nhất.", "This message changed; the latest version is shown.") |
| 403 CHAT_CAPABILITY_REQUIRED | editor closes; no retry | the 5.2.2 capability pair |
| 400 INVALID_BODY / 413 CHAT_MESSAGE_TOO_LARGE | editor stays open with the draft | the 5.2.2 pair of the code |
| 429 CHAT_RATE_LIMITED | editor stays open; manual retry | the 5.1 rate pair |
| 403 CSRF_INVALID / 401 AUTH_REQUIRED / 403 CHAT_FORBIDDEN / 403 TENANT_SUSPENDED | editor closes; no retry | the pair of the code |
| any other code, 500, CLIENT_NETWORK_ERROR, CLIENT_BAD_RESPONSE, a missing code or a timeout | editor stays open with the draft; nothing inferred (the next refetch shows the truth) | t("Đã có lỗi. Vui lòng thử lại.", "Something went wrong. Please try again.") |

#### 5.2.4 Delete own (DELETE; control per DF-2)

| Code (HTTP) | UI | Copy |
|---|---|---|
| 200 `changed` true or false | the row becomes a tombstone after the refetch (idempotent) | DF-12 tombstone text |
| 403 CHAT_FORBIDDEN | no retry (Delete renders only on own rows; this is the fallback) | t("Bạn chỉ có thể xoá tin nhắn của mình.", "You can only delete your own messages.") |
| 429 CHAT_RATE_LIMITED | manual retry | the 5.1 rate pair |
| 403 CSRF_INVALID / 401 AUTH_REQUIRED / 403 TENANT_SUSPENDED | no retry | the pair of the code |
| any other code, 500, CLIENT_NETWORK_ERROR, CLIENT_BAD_RESPONSE, a missing code or a timeout | the row stays as it is until the next refetch; nothing inferred | t("Đã có lỗi. Vui lòng thử lại.", "Something went wrong. Please try again.") |

#### 5.2.5 Read cursor (POST read; silent)

| Code (HTTP) | UI | Copy |
|---|---|---|
| 200 | the channel list is refetched (debounced, DF-4); the badge follows the refetched `unreadCount` | - |
| 429, 404 NOT_FOUND, 400, any other code, 500, a network error, a missing code or a timeout | silent: the badge never advances without a 200; the next eligible round sends the newest id again | - |

### 5.3 Live stream (both screens; EventSource exposes no status)

| Event | UI | Copy |
|---|---|---|
| open | resync: one round refetches through the authorized GETs | - |
| frame that parses | hint only: its channelId joins the round's set; nothing is rendered from the frame | - |
| frame that does not parse | dropped | - |
| onerror (401, 403, 429 admission, the 6th stream, a listener overflow, the 15-minute lifetime, the network) | the hub closes the source and reconnects with full-jitter backoff (cap 30 s), then resyncs | - |
| a round answers AUTH_REQUIRED, CHAT_FORBIDDEN or TENANT_SUSPENDED | live off for that view; the screen shows that code's row | as 5.1 / 5.2.1 |
| a round answers CHAT_RATE_LIMITED | the round returns true: a 30 s silent pause | - |
| a round answers anything else, or times out | the round ends; nothing inferred; the next hint or resync retries | - |

## 6. Live path (RO-L16-2)

### 6.1 The gap at BASE

`apps/web/lib/use-realtime.ts` (the L5 client hook) serves only the sessions stream: the hub opens `/api/realtime/subscribe?tenant=`
(:85), `parseRealtimeMessage` accepts exactly the keys `sessionId`, `type`, `version` (:60-64), and the hub drops a null parse (:96)
and dedupes by `sessionId` + `version` (:97-99). A chat frame `{type: "chat.message", channelId, messageId}` parses to null today
(the conductor measured the same in the ruling).

### 6.2 Design: one hook, one set of reconnect rules

- `useRealtime` gains one optional last parameter, a stream descriptor `{path, parse, dedupe?}`. Its default is today's sessions
  stream: path `/api/realtime/subscribe`, parse `parseRealtimeMessage`, dedupe by `sessionId` + `version`. The two callers
  (`use-sessions-data.ts:105`, `:274`) pass nothing and compile unchanged.
- Hub channels are keyed by `path|tenant`: the sessions stream and the chat stream of one tenant are two channels of one hub, each
  with its own source, backoff and resync. Note 5g (one chat stream per tenant per tab, closed on unmount) gets a WU-1 test: two
  subscribers of one `path|tenant` share one source, and the last unsubscribe closes it.
- The message type is generic, with the sessions message type as the default, so existing callers keep their types.
- `CHAT_STREAM` (exported from `lib/use-chat.ts`): path `/api/chat/subscribe`; parse accepts exactly the keys `channelId`,
  `messageId`, `type`, with `type === "chat.message"` and both ids lowercase uuids, else null; no `dedupe` (no version on chat frames).
- `use-chat.ts` calls `useRealtime(tenantId, live, round, accept, CHAT_STREAM)`. `accept` adds the frame's `channelId` to a Set (a
  resync adds every loaded channel) and returns true. `round` refetches only what changed, through the authorized GETs: the channel
  list (badges), and the newest history page of the open channel when its id is in the Set. It returns `code === "CHAT_RATE_LIMITED"`
  (true = the hub's 30 s silent pause). A round answering AUTH_REQUIRED, CHAT_FORBIDDEN or TENANT_SUSPENDED turns live off for that
  view (5.3). Nothing is rendered from a frame.

### 6.3 RO-L16-2 conditions (ruling lines 16-20, verbatim)

> 1. The new stream descriptor {path, parse, dedupe?} defaults to today's sessions stream: the two existing callers are untouched and every existing use-realtime test case passes UNCHANGED (additions only; if an existing case must change, stop and ask).
> 2. Run gitnexus impact on every symbol you edit in the hook BEFORE the edit and record the blast radius in the readiness file (LOW expected; HIGH or CRITICAL goes to the conductor first). Add a regression test that the sessions stream still parses and dedupes as before.
> 3. Do not claim "byte-identical" anywhere: state exactly what changed (added lines, changed lines), as the L5 listener claim of L15 had to be corrected.
> 4. Chat frames carry no version: no dedupe by version; hints coalesce per channel at most once per 2 seconds (the existing round rule). A 429 on stream admission (the 6th stream, or the 30 per minute admission bucket) is a backoff, never a tight reconnect loop.
> 5. Reviewers get one named question: any regression of the sessions live sync.

### 6.4 Blast radius (RO-L16-2 condition 2)

- `mcp__gitnexus__impact` (repo plexco-app, direction upstream) answered "Target not found" for `useRealtime`, `createRealtimeHub` and
  `parseRealtimeMessage`: the index does not hold the L5 file's symbols (stale index, O-3). The impact record is therefore this git grep
  at BASE: `git -C W grep -n -E 'useRealtime|createRealtimeHub|parseRealtimeMessage|createLiveRounds|backoffDelayMs|RealtimeSignal|use-realtime' a23fe96d3b9045a5f143b19bac9b31be97a2daff -- apps packages`.
- Production callers: only `apps/web/lib/use-sessions-data.ts` :21 (import), :105 and :274 (`useRealtime`). No production caller of
  the other symbols outside `use-realtime.ts`. Tests: `use-realtime.test.ts` :3-11 (imports), :46, :58, :61, :73, :142, :158, :182,
  :186, :191; `tenant-lang.test.ts:272` (the inventory entry). `realtime-listener.ts:30` declares its own server-side
  `backoffDelayMs`, a separate symbol, unaffected.
- Affected process: the sessions live sync of the two `use-sessions-data.ts` call sites. Risk LOW (not HIGH or CRITICAL).
- Declarations in `use-realtime.ts` at BASE: RealtimeMessage :13, RealtimeSignal :19, EventSourceLike :21, RealtimeHubDeps :28,
  BACKOFF :37, STABLE_OPEN_MS :39, LIVE_ROUND_GAP_MS :41, LIVE_PAUSE_MS :43, backoffDelayMs :46, parseRealtimeMessage :51, Channel :67,
  createRealtimeHub :77, createLiveRounds :155, browserDeps :200, browserHub :207, hub() :209, useRealtime :235.
- WU-1 re-runs `impact` on each symbol it edits, before the edit. If it still answers "Target not found", WU-1 re-runs this grep at
  its own base and the PR body carries the result (the S1 IMPACT fallback). The PR body states the exact added and changed lines of
  `use-realtime.ts` (condition 3).

### 6.5 Reconnect and budget rules at BASE (part B B2; L16 changes none of them)

| Rule | Where |
|---|---|
| full-jitter backoff, cap 30 s, on every source error | `BACKOFF` :37, `backoffDelayMs` :46-48, applied :102-115 |
| backoff reset after a 30 s stable open | `STABLE_OPEN_MS` :39, :107 |
| resync on open and reopen | :87-92, :111-114 |
| rounds single-flight, at least 2 s apart | `LIVE_ROUND_GAP_MS` :41, `createLiveRounds` :155 |
| a round returning true pauses 30 s | `LIVE_PAUSE_MS` :43 |
| server: at most 5 streams per account, heartbeat 25 s, lifetime 15 minutes | `realtime-listener.ts` :20 and :181, :23, :24 |

A 429 on stream admission reaches the hub as a plain source error (EventSource exposes no status, 5.3) and takes the same backoff:
never a tight reconnect loop (condition 4).

## 7. Viewer capability (RO-L16-1)

Facts at BASE (part A A3 and the ruling's measured facts):

- The club shell `apps/web/app/c/[tenantId]/layout.tsx` checks only `currentSession() !== null` (:24) and passes only `tenantId` to
  `AppShell` (:30): no role or capability prop reaches a screen.
- No chat GET exposes either capability (the six route files; C:214-221). The only client-visible role data, `SessionDto.tenants`
  (`apps/web/app/api/auth/session/route.ts:22-29`), may not be decided on: DD-56, and `apps/web/lib/role-read-guard.test.ts` :9, :18,
  :37 fails any non-test source that reads `.role`. Role is not the capability anyway (both resolve server-side, PR #86 Contract 11-12).
- The server-side read exists but no page may reach it: `tenant_capability_authorize` (0049, EXECUTE for app at 0049:134) and its typed
  wrapper `authorize()` in `packages/db/src/tenant-capability-authority.ts`; `chat.message.moderate` and `chat.channel.post_restricted`
  are preset actions (0047:85-86, admin and co_admin). `apps/web/app/c/server-boundary.test.ts` forbids pages and layouts under
  `/c/**` from reaching the database. The only pinned way to a viewer-capability signal is an API field: out of scope (O-1).

Decision (binding):

- No moderation control renders for anyone: no hide or restore control and no moderation sheet. A unit test and an e2e case assert
  that none renders, for a host-shaped and for a member-shaped session.
- The composer always shows, admins_only channels included. In an admins_only channel (C:219, `postPolicy: "all_members" |
  "admins_only"`) the DF-5 hint shows. A 403 CHAT_CAPABILITY_REQUIRED renders its fail-closed t(vi, en) row of section 5, no retry.
- No scaffolding: no unused prop, no hidden component, no moderation call in `chat-api.ts`, no guess from `postPolicy`, role or any
  other field. The server always enforces; moderation stays reachable through the merged API only (L15's route tests).
- The OPEN proposal, verbatim (ruling line 11; carried into the report and the PR body as O-1):

> "viewer capability: GET /api/chat/channels returns canModerate and canPostRestricted booleans per tenant, computed by the existing authorize() primitive for chat.message.moderate and chat.channel.post_restricted (no migration; P1 because it exposes an authorization result; a security round); then a small UI lane renders the moderation sheet for canModerate and uses canPostRestricted for the admins_only composer"

## 8. UNPINNED (each one: omit active UI)

Authority: the Product spec `feature_inapp_chat.md` v0.21 and the merged DTOs (section 1); the FE design spec is layout input only
(Draft, stale pin; O-2). Elements the specs describe for the D4 cut that the merged DTOs do not return:

| Pin | Element | Source | UI in L16 |
|---|---|---|---|
| U1 | channel-row icon (club sport icon) | Product :214 | omitted |
| U2 | channel-row last-message preview with sender prefix | Product :216 (FE :86-87, :137) | omitted |
| U3 | channel-row relative timestamp | Product :218 | omitted; rows keep the server order (sortOrder, id), not the FE "sorted by recent" (:137) |
| U4 | unread divider, jump to first unread, re-sync from the last-seen cursor (CHT-UC-9) | Product :99 | omitted: the read cursor is not exposed; a reconnect refetches the newest page |
| U5 | reply quote text | the DTO carries `replyToMessageId` only | the quote shows only when its target is in a loaded page; otherwise the DF-7 marker |
| U6 | viewer capability flags (`canModerate`, `canPostRestricted`) | ChatChannelDto has no such field (section 7) | no moderation UI; the composer always shows; O-1 |
| U7 | mute banner CHAT_MUTED | FE :178; no mute code in any merged route row (part A A2) | omitted |
| U8 | system messages and tombstone detail | FE :167; only the tombstone kind is returned | a system row renders its body with the DF-1 System label and no actions; a tombstone renders only the DF-12 text, for both kinds (FE :167 is layout input, superseded by the accepted DF-1) |
| U9 | author avatar | Product :280, the DM header only, outside D4 | omitted |

Pinned and rendered: the edited label from `editedAt` (DF-12), the older-page control from `nextCursor` (Product wireframe :232-258),
left or right alignment from `mine`. A grep of the Product spec for typing|presence|online|seen finds no club-cut UI (part B B1).

## 9. Defaults (each "default applied, pending owner sign-off"; the PR body repeats each one with its reason)

| Pin | Default applied, pending owner sign-off | Reason |
|---|---|---|
| DF-1 | sender label: `mine` -> t("Bạn", "You"); a person row with `authorLabel` -> the label as a React text node in its own `<bdi>`, clipped by CSS ellipsis; a person row with a null label -> t("Thành viên", "Member"); a system row -> t("Hệ thống", "System"); an assistant row -> t("Trợ lý", "Assistant") | D1: note 5a's null -> Member would mislabel a system row; accepted in the ruling |
| DF-2 | Edit and Delete only on rows with `mine` and `tombstone === null`; the server decides (the 403 and 409 rows of 5.2.3 and 5.2.4); no client clock and no client edit counter | D11: no DTO field says a message is editable; accepted in the ruling |
| DF-3 | times in the club time zone: `useTenantContext(tenantId).timezone` with the `session-time.ts` formatters and `useLang`; `Number.isNaN(Date.parse(iso))` hides the time (never 1970), with a test | A5: the formatters throw RangeError on an invalid string; accepted in the ruling |
| DF-4 | one live round per view per >= 2 s; POST read only when the newest loaded id changed and the tab is visible, debounced apart from the channel-list refetch; a 429 is a silent pause, never a toast and never "no new messages" | D16: the 60 per minute read bucket is shared; accepted in the ruling |
| DF-5 | hint t("Kênh này chỉ quản trị viên được đăng tin", "Only admins can post in this channel") above the composer when `postPolicy === "admins_only"` (C:219) | RO-L16-1 |
| DF-6 | nav item t("Trò chuyện", "Chat") with a `ChatIcon` in `nav-icons.tsx`, linking `/c/<tenantId>/chat` | part B B3; no spec copy pins it |
| DF-7 | reply marker t("Trả lời một tin nhắn", "Reply to a message") when the reply target is not loaded | U5 |
| DF-8 | t("Kênh chung", "General") only when `isDefault` and `title` equals the 0063:124 seed text; any other title is shown as the user-authored text it is | note 5b; section 2.3 |
| DF-9 | the section 5 copy deck; where `session-error-ui.ts` already exports a pair for the same generic code, reuse it | note 5j; one copy per code |
| DF-10 | document title generic t("Trò chuyện", "Chat"), never the channel title | note 8: the title is club content, and a document title reaches the history and the tab strip |
| DF-11 | history requests send no `limit` (the server default 50) | note 5c: a value outside 1..100 is a 400; no client constant needed |
| DF-12 | row copy: tombstone t("Tin nhắn đã bị gỡ.", "Message removed."); edited t("(đã sửa)", "(edited)"); pending t("Đang gửi...", "Sending..."); failed t("Chưa gửi được.", "Not sent."); Retry t("Thử lại", "Retry"); Discard t("Bỏ", "Discard"); older t("Xem tin cũ hơn", "Show older messages") | lane TESTS; no spec copy pins them |

## 10. Privacy (conductor note 8; a violation is a HALT)

- No message body, author label, `clientMsgId` or channel title in any console call, log line, analytics event, error report, URL,
  service-worker cache, localStorage, sessionStorage, IndexedDB or thrown Error message. The `clientMsgId` travels only in the POST body.
- The optimistic copy lives in component state only.
- Text nodes only (React escaping), never `dangerouslySetInnerHTML`. The author label sits in its own `<bdi>` (or a `dir="auto"`
  element) with CSS ellipsis; a test feeds a label carrying bidi and control characters (for example U+202E) and asserts that the
  text around it keeps its order and the label stays inside its own element.
- The service worker `apps/web/sw/sw.template.js` is NOT edited: at BASE it never intercepts `/api/*` or a non-GET request and never
  caches a navigation response (:7, :59, :62, :64-65). L16 asserts that rule with an e2e test (11.3).
- Semgrep CE blocks a template literal as the first argument of `console.error`, `console.warn` or `console.log`: the chat files log
  nothing about chat at all (no console call).

## 11. Test plan

### 11.1 Lane TESTS as amended

The lane TESTS apply, as amended by RO-L16-1 ("no moderation control renders (unit and e2e)") and RO-L16-4 (CI proves the live path
with a simulated SSE frame; the golden path runs two real contexts). Every new non-trivial file gets a unit test.

### 11.2 Unit tests (`NODE_ENV=test pnpm --filter @plexco/web test`)

- `use-realtime.test.ts`, additions only, the sessions regression case first: the default descriptor parses and dedupes sessions frames
  as before; a descriptor routes `path`, `parse` and an absent `dedupe`; channels keyed by `path|tenant`; two subscribers share one
  source and the last unsubscribe closes it. Every existing case stays unchanged.
- `chat-api.test.ts`: paths and methods with `tenant`; the cursor passed back verbatim; no `limit`; `x-csrf-token` on every mutation;
  error codes parsed; a missing code, a non-JSON body or a timeout gives the fail-closed result. No moderation call exists.
- `chat-error-ui.test.ts`: every row of the section 5 tables; unknown, 500, missing and timeout give the fail-closed row.
- `use-chat.test.ts`: the `CHAT_STREAM` parse (another type, extra keys or uppercase ids give null); optimistic pending, then confirmed
  or failed; a retry reuses the same `clientMsgId` and a `duplicate: true` answer confirms one row; 409 CHAT_EDIT_WINDOW_CLOSED shows
  its message; 409 CHAT_EDIT_CONFLICT refetches, no blind retry; the channel list refetches only after a 200 read; hints coalesce to one
  refetch per channel per 2 s; a 429 pauses silently; AUTH_REQUIRED, CHAT_FORBIDDEN and TENANT_SUSPENDED turn live off.
- `channel-list.test.tsx`: the server order kept; the badge hidden at 0, the number for 1..99, "100+" at 100; DF-8.
- `message-list.test.tsx` (the actions included): no re-sort; both tombstone kinds show only the DF-12 text; the edited label; DF-1
  labels with the `<bdi>` bidi case (section 10); Edit and Delete only per DF-2; no moderation control on any row; DF-3.
- `composer.test.tsx`: Send disabled while `body.trim() === ""` (2.2); the DF-5 hint; the pending, failed, Retry and Discard copy;
  403 CHAT_CAPABILITY_REQUIRED shows its message with no retry; 413 CHAT_MESSAGE_TOO_LARGE shows its row and keeps the draft.

### 11.3 Mocked e2e (`apps/web/e2e/chat.spec.ts`, mock `apps/web/e2e/support/chat-api-mock.ts`)

Optimistic pending, then confirmed; failed and Retry reuse the same `clientMsgId` (the mock records both POST bodies); the edit-window
409 message; the tombstone text; the badge changes only after a 200 POST read; no moderation control for a host-shaped and a
member-shaped session; the admins_only hint; the nav link href `/c/<tenantId>/chat`; live (RO-L16-4): the mocked stream emits exactly
`{type: "chat.message", channelId, messageId}`, the open channel refetches its newest page and then shows the message, and nothing is
rendered from the frame; the service-worker caches and the storages hold no `/api/chat` URL, message text or author label.

### 11.4 States-and-viewport matrix (`apps/web/e2e/chat-a11y.spec.ts`)

{channel list, channel view} x {loading, ready, empty, error, offline} x {375x812, 1280x800} x {light, dark} = 40 cells. Each asserts
its `data-state`, no horizontal overflow at 375, and axe (wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa) serious + critical = [].
Pattern: `player-a11y.spec.ts` :10-49; helpers `putScreenInState` (`player-api-mock.ts:433`), `holdNext` (:161-166), `setOffline`
(:242), `abort` (:184), the 500 E2E_NOT_STUBBED fallback (:137).

### 11.5 Golden path (local only, never CI)

A third test in `apps/web/e2e/golden-path.spec.ts` (host test :44, player test :270, `signInAsPersona` :296 and :327-328, the file ends
at :376 at BASE): two real browser contexts, two members of one club; a message sent in one appears in the other without a reload; the
other context's channel-list badge advances, then clears after the read call. Command (`golden-path.config.ts:16`):
`pnpm --filter @plexco/web exec playwright test --config e2e/golden-path.config.ts`, once at the final head under the lock wrapper
when Docker and the port are available; otherwise NOT RUN with the reason, never a pass.

### 11.6 Commands

The S1 VERIFY set: `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm review:check:changed`, `pnpm build`,
`NODE_ENV=test pnpm --filter @plexco/web test`, `NODE_ENV=test DATABASE_URL_TEST=... pnpm -w test`,
`pnpm --filter @plexco/web exec playwright test`; 11.5 locally.

### 11.7 Acceptance matrix

| AC | Behaviour | Proof | Expected result |
|---|---|---|---|
| AC-1 | channel list | channel-list test, chat.spec | order (sortOrder, id); badge hidden at 0, 1..99 shown, "100+" at 100 |
| AC-2 | default channel title | channel-list test | DF-8: the bilingual pair only for the seeded default; any other title verbatim |
| AC-3 | history order and paging | chat-api test, message-list test, chat.spec | server page order kept; `nextCursor` passed back verbatim; no `limit` sent |
| AC-4 | optimistic send | use-chat test, chat.spec | pending, then confirmed |
| AC-5 | retry after a failed send | use-chat test, chat.spec | the same `clientMsgId`; `duplicate: true` confirms one row; never a second row |
| AC-6 | edit and delete own | message-list test, use-chat test, chat.spec | controls only per DF-2; the window 409 shows its message; the conflict 409 refetches |
| AC-7 | tombstones | message-list test, chat.spec | both kinds show only the DF-12 text, no detail, no actions |
| AC-8 | unread badge | use-chat test, chat.spec, golden path | moves only after a 200 POST read |
| AC-9 | no moderation control | message-list test, chat.spec | none renders for a host-shaped or a member-shaped session |
| AC-10 | admins_only channel | composer test, chat.spec | the DF-5 hint; 403 CHAT_CAPABILITY_REQUIRED shows its message, no retry |
| AC-11 | live path | use-chat test, chat.spec | a frame triggers a refetch, then the message shows; nothing from the frame; at most one refetch per channel per 2 s; a 429 pauses silently |
| AC-12 | sessions live sync | use-realtime test | every existing case unchanged and green; the sessions regression case green |
| AC-13 | error mapping | chat-error-ui test | every section 5 row; unknown, 500, missing and timeout give the fail-closed row |
| AC-14 | privacy | chat.spec, message-list test, a grep of the chat files | no `/api/chat` URL, text or label in a service-worker cache or a storage; no console call; the bidi label stays isolated |
| AC-15 | states and viewports | chat-a11y.spec | 40 cells: `data-state`, no overflow at 375, axe serious + critical = [] |
| AC-16 | nav entry and times | chat.spec, message-list test | the nav link to `/c/<tenantId>/chat` (DF-6); an unparseable time hidden (DF-3) |
| AC-17 | two members live | golden-path.spec, local | the message appears in the other context without a reload; the badge advances and clears; or NOT RUN with the reason |
| AC-18 | build and suites | 11.6 | every command green, the TS-1 inventory test included |

## 12. B3 budget (RO-L16-3)

### 12.1 Caps (ruling line 23, first two sentences, verbatim)

> Caps: non-test 2,000, test 1,500, total 3,500, files 30, modules 5 (app/c/[tenantId]/chat, components/chat, lib, components/shell, e2e), 0 migrations, counted as b3-measure.sh counts (gross added lines, comments included; .module.css and e2e/support/*.ts are non-test; the readiness .md excluded). Report at 90% (1,800 / 1,350 / 3,150); at a cap STOP and ask (a ruling request file).

Estimate: part B option A minus the moderation sheet: non-test about 1,615, test about 1,180 (TS-1 included), total about 2,795,
plus or minus 25%. The upper band (about 2,020 non-test) touches the non-test cap, so the 90% report point is the early warning.
Precondition before any count: `grep -n -E 'BASE|base_sha|a23fe96' N/scripts/b3-measure.sh` shows the full BASE.

### 12.2 File plan: 29 files against the cap of 30 (paths under apps/web; N new, M modified; the readiness .md excluded)

- Non-test (18): N `app/c/[tenantId]/chat/page.tsx`; N `app/c/[tenantId]/chat/[channelId]/page.tsx`; N `components/chat/channel-list.tsx`
  (rows and the unread badge: no separate badge file); N `components/chat/channel-list.module.css`; N `components/chat/channel-view.tsx`
  (the screen container); N `components/chat/channel-view.module.css`; N `components/chat/message-list.tsx`;
  N `components/chat/message-list.module.css` (also styles the message actions: no separate module); N `components/chat/message-actions.tsx`;
  N `components/chat/composer.tsx`; N `components/chat/composer.module.css`; N `lib/chat-api.ts`; N `lib/use-chat.ts`;
  N `lib/chat-error-ui.ts`; M `lib/use-realtime.ts`; M `components/shell/shell-nav.tsx`; M `components/shell/nav-icons.tsx`;
  N `e2e/support/chat-api-mock.ts`.
- Test (11): M `lib/use-realtime.test.ts` (additions only); M `lib/tenant-lang.test.ts` (TS-1); N `lib/chat-api.test.ts`;
  N `lib/use-chat.test.ts`; N `lib/chat-error-ui.test.ts`; N `components/chat/channel-list.test.tsx`;
  N `components/chat/message-list.test.tsx` (the actions included); N `components/chat/composer.test.tsx`; N `e2e/chat.spec.ts`;
  N `e2e/chat-a11y.spec.ts`; M `e2e/golden-path.spec.ts`.

### 12.3 TS-1: test-only scope addition (approved by the conductor; relayed 2026-10-20 14:17)

`apps/web/lib/tenant-lang.test.ts` (the DD-118 inventory) walks every non-test `.ts` in `apps/web/lib` (`discoverLibFiles` :311-315)
and every `app/**/route.ts` (:299-305), and fails on an unclassified file (:330-332). It gets exactly three test-only entries, bucket
"c" (not a user-facing response, legend :105-108): `"lib/chat-api.ts": "c"`, `"lib/chat-error-ui.ts": "c"`, `"lib/use-chat.ts": "c"`,
each added by the unit that creates the file. Precedents, all "c": api-client :229, use-tenant-context :234, session-error-ui :239,
session-time :243, discover-api :246, me-player-api :247, roster-payments-api :259, use-realtime :272. Pages and components (`.tsx`)
are not walked. Listed in scope and counted in the test cap; reported to the conductor 2026-10-20 14:13 with a veto window.

### 12.4 Coherence and compatibility

Coherence (accepted in RO-L16-3): the pages need the components, the components need `use-chat.ts` and `chat-api.ts`, the nav item
needs the page, and the matrix and the golden path need the screens; a split doubles review cycles and CI pushes without reducing the
work. Compatibility: no API, DB, migration, worker, service-worker, workflow or env change; the one shared-file change is an additive,
default-preserving parameter of `useRealtime` (section 6), proven by the unchanged existing tests and the sessions regression case.

## 13. Writer units (in this order; one file or one section per worker)

| Unit | Files (under apps/web) | First red test |
|---|---|---|
| WU-1 | `lib/use-realtime.ts`, `lib/use-realtime.test.ts` | the sessions regression case, then the descriptor cases (6.2, 6.3) |
| WU-2 | `lib/chat-api.ts` and its test; its TS-1 entry | paths, CSRF header, cursor verbatim, no `limit` |
| WU-3 | `lib/chat-error-ui.ts` and its test; its TS-1 entry | the section 5 rows and the fail-closed row |
| WU-4 | `lib/use-chat.ts` and its test; its TS-1 entry | the `CHAT_STREAM` parse, optimistic send, the same-`clientMsgId` retry |
| WU-5 | `components/chat/channel-list.tsx`, its module and test; `app/c/[tenantId]/chat/page.tsx`; `components/shell/shell-nav.tsx`, `components/shell/nav-icons.tsx` | the badge at 0, 1..99 and 100; DF-8 |
| WU-6 | `components/chat/message-list.tsx`, its module and test; `components/chat/channel-view.tsx` and its module; `app/c/[tenantId]/chat/[channelId]/page.tsx` | server order, tombstones, DF-1, DF-3 |
| WU-7 | `components/chat/composer.tsx`, its module and test; `components/chat/message-actions.tsx` and its cases in the message-list test | blank body, DF-5, DF-2, the window 409 |
| WU-8 | `e2e/support/chat-api-mock.ts`, `e2e/chat.spec.ts` | 11.3 |
| WU-9 | `e2e/chat-a11y.spec.ts` | 11.4 |
| WU-10 | `e2e/golden-path.spec.ts` | 11.5 |

Every unit: GitNexus impact before editing an existing symbol (fallback: the 6.4 grep), detect_changes (or the grep) before its commit,
its TS-1 entry together with the file that needs it, and the b3-measure.sh count reported at 90%.

## 14. Amended lane lines (verbatim)

RO-L16-1, ruling line 9:

> Amended lines (this ruling wins over the lane block and over notes 5f, 9 and 18 of the brief): TESTS "host sees moderation actions, members do not" becomes "no moderation control renders (unit and e2e)"; DONE WHEN "moderation works for a host" is dropped from this PR; REVIEW PLAN question 2 "moderation controls visible to members" becomes "no moderation control renders"; the S4 line "moderation controls are host-only (a test)" becomes "no moderation control renders (a test)". The moderation sheet (about 150 non-test, 90 test lines in your estimate) is out of the L16 caps.

RO-L16-2, ruling line 15, first sentence:

> apps/web/lib/use-realtime.ts is added to the lane's files.

RO-L16-3, ruling line 23: the caps are quoted in 12.1; the rest of the line:

> Fix allowance for NAMED review findings: +30 non-test and +60 test (the RO-L13-1 pattern), each fix group listed in the PR body with its finding. No API, DB, migration, worker, service-worker, workflow or env change.

RO-L16-4, ruling lines 26-28:

> - CI e2e proves the live path with a simulated SSE frame: the mocked stream emits exactly {type: "chat.message", channelId, messageId}; the test asserts that the open channel REFETCHES its newest page and then shows the message, and that nothing is rendered from the frame itself (a frame is a hint, never content).
> - The golden-path chat step (local only, apps/web/e2e/golden-path.spec.ts) runs two real browser contexts (two members of one club) and asserts that a message sent in one appears in the other without a reload, and that the other channel list's unread badge advances and clears after the read call. Run it once at the final head under the lock wrapper when Docker and the port are available (the result and the not-proven reporter output go into the report and the PR body); otherwise write NOT RUN with the reason, never a pass. The conductor re-runs the M10 golden path after the merge round with a separate verifier.
> - This satisfies TESTS "two-browser e2e where a message appears live" and DONE WHEN "two members chat live locally" through the golden path; say in the PR body which half runs where.

## 15. OPEN (out of scope; none blocks this slice)

- O-1 viewer capability: the section 7 proposal. The owner approved lanes L15b (API) and L16b (UI) on 2026-10-20 (conductor news,
  relayed 14:17); this PR ships without the moderation UI.
- O-2 `docs/channels/web/FE/feature_chat_fe.md`: Draft, stale pin (v0.15 against v0.21), error tables older than the merged routes
  (409 CHAT_DUP_MESSAGE :181 against the merged 200 `duplicate: true`). A docs lane re-pins it; L16 does not edit it.
- O-3 the GitNexus index lacks the L5 symbols ("Target not found"): re-index (`node .gitnexus/run.cjs analyze`); the PR body carries
  the 6.4 grep.
- O-4 PR #86 lists 413 for send, PATCH and moderation only, though the read route also parses a JSON body (D3). L16 treats every
  read answer other than 200 as the silent row of 5.2.5; the L15 contract owner confirms the read 413.
- O-5 TS-1 was disclosed to the conductor for a veto (2026-10-20 14:13) and approved (relayed 14:17, section 12.3); the PR body
  repeats the disclosure.

## 16. Closure matrix (12 of 12)

| # | Gate | Evidence | Result |
|---|---|---|---|
| 1 | Authority snapshot pinned by SHA | `AUTHORITY_SHA` = W HEAD = BASE; `check-target-files-exist-at-sha.sh` reports missing=0 for every TARGET_FILES path | PASS |
| 2 | Decisions in scope final | D4 = DD-136 signed (`docs/standards/decisions.md:121`, body `:1769`); conductor ruling RO-L16-1 to RO-L16-4; DF-1 to DF-12 pinned as defaults pending owner sign-off | PASS |
| 3 | Scope IN/OUT and owner clear | sections 12-14; the lane NEGATIVE SCOPE; the RO-L16-2 scope addition; TS-1 (approved) | PASS |
| 4 | Dependencies classified | L14 #83, L15 #86, L15a #87 and L13 #85 merged at BASE (section 1) | PASS |
| 5 | Live schema and code match | sections 2-6, measured at BASE; no schema change | PASS |
| 6 | Data, API, state, auth contract | sections 3-7 | PASS |
| 7 | Fail-closed, idempotency, order | every section 5 table ends fail-closed; the same-`clientMsgId` retry (D7); server order kept; the badge only after a 200 read; DF-3 | PASS |
| 8 | Open questions in scope = 0 | DF-1 to DF-12 pinned; U1 to U9 omitted; O-1 to O-5 out of scope (section 15) | PASS |
| 9 | Acceptance matrix with expected results | 11.7, AC-1 to AC-18 | PASS |
| 10 | Migration, security, rollback | no migration and no API, DB, grant or service-worker change; server authorization stays authoritative; rollback = revert; section 0 | PASS |
| 11 | First slice hard dependencies merged | WU-1 needs only BASE | PASS |
| 12 | Implementation handoff ready | sections 11-13; W at BASE, clean apart from this file | PASS |

## 17. Verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-10-20
AUTHORITY_SHA: a23fe96d3b9045a5f143b19bac9b31be97a2daff
BASE_BRANCH: main
TARGET_FILES:
  - docs/standards/decisions.md
  - docs/standards/review-code-readiness-gate.md
  - docs/standards/design-tokens.md
  - docs/features/FE/feature_inapp_chat.md
  - docs/features/BE/feature_inapp_chat_tech.md
  - docs/channels/web/FE/feature_chat_fe.md
  - docs/sessions/web-mvp-phase3-readiness-p3-m9-player-web.md
  - packages/core/src/api-contract.ts
  - packages/db/migrations/0063_chat_message_commands.sql
  - packages/db/src/chat-service.ts
  - apps/web/lib/chat-route.ts
  - apps/web/lib/realtime-auth.ts
  - apps/web/lib/realtime-listener.ts
  - apps/web/lib/use-realtime.ts
  - apps/web/lib/use-realtime.test.ts
  - apps/web/lib/use-sessions-data.ts
  - apps/web/lib/tenant-lang.test.ts
  - apps/web/lib/api-client.ts
  - apps/web/lib/use-tenant-context.ts
  - apps/web/lib/session-time.ts
  - apps/web/lib/roster-payments-api.ts
  - apps/web/components/shell/shell-nav.tsx
  - apps/web/components/shell/nav-icons.tsx
  - apps/web/components/sessions/request-inbox.module.css
  - apps/web/app/globals.css
  - apps/web/app/c/server-boundary.test.ts
  - apps/web/sw/sw.template.js
  - apps/web/e2e/player-a11y.spec.ts
  - apps/web/e2e/support/player-api-mock.ts
  - apps/web/e2e/support/session-api-mock.ts
  - apps/web/e2e/support/golden-path-helpers.ts
  - apps/web/e2e/golden-path.spec.ts
  - apps/web/e2e/golden-path.config.ts
SLICE: p3-m10-chat-web
IN_SCOPE: the chat web UI for the D4 club-channel cut over the merged L15 routes only: the /c/<tenantId>/chat channel list with unread badges and the /c/<tenantId>/chat/<channelId> view with keyset history, an optimistic composer with a same-clientMsgId retry, reply, edit and delete own (the server decides), tombstones and in-app unread state; the additive stream descriptor in use-realtime.ts (RO-L16-2); chat-api.ts, use-chat.ts and chat-error-ui.ts; the Chat nav item; unit tests, the mocked chat e2e, the 40-cell a11y matrix, the local golden-path chat step and the three TS-1 inventory entries
OUT_OF_SCOPE: any API, DB, migration, packages, worker, service-worker, workflow or env change; every moderation control and the moderation sheet (RO-L16-1, O-1); DM, media, reactions, search, mentions, group, pin, poll, slash commands, digest and push UI; fields the merged DTOs do not return (U1 to U9); the runbook (L17); decisions.md and the FE design spec; enabling dispatch or any projector row
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: L14 #83, L15 #86, L15a #87 and L13 #85 merged at a23fe96d3b9045a5f143b19bac9b31be97a2daff (probes: section 1); DD-136 (D4) signed
PRIOR_SLICES: L14 p3-m10-chat-core (#83), L15 p3-m10-chat-api-live (#86), L15a p3-m10-chat-author-labels (#87), L13 p3-m9-zalo-player-commands (#85)
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS # no migration and no API, DB, grant, service-worker or auth change; the merged routes' server-side authorization stays authoritative; the UI makes no client capability decision (RO-L16-1); section 0 voids the no-security-round judgement if a trust-boundary surface appears
IMPLEMENTATION_ARTIFACTS: PASS
FIRST_IMPLEMENTATION_STEP: WU-1 - GitNexus impact on each use-realtime.ts symbol it edits (or the section 6.4 grep fallback), then the additions-only use-realtime.test.ts cases red (the sessions regression case first) before editing apps/web/lib/use-realtime.ts
REMAINING_BLOCKERS: none
```
