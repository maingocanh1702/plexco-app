# Feature: In-App Chat — FE Design Spec

> **Route(s):** `/chat` · `/chat/:threadId` (accessed via 💬 header icon)
> **Source authority:** `../../../features/FE/feature_inapp_chat.md` v0.15 · baseline `0c5808fc7cf50d139bdd9c4ee79917bf4059c4f4`
> **Source contract status:** Reviewed
> **Projection/API contract:** Product/BE Chat §3; exact HTTP handoff still requires slice-local pin before implementation
> **Capability/availability:** Live channel/DM authz + exact `chat.channel.post_restricted` · `chat.message.moderate` · `chat.member.mute` · `chat.channel.manage`
> **Priority:** 11 — designer-kickoff.md §3B
> **FE design status:** Draft
> **Runtime status:** Not started — không có Chat migration/API/UI
> **Negative scope:** Không bridge ra bot; không mở DM trước safety gate; không có personal archive state

> 📍 **Đọc nhanh (cập nhật 2026-09-15 — chỉ mục, không phải authority):** feature nguồn `../../../features/FE/feature_inapp_chat.md`; scope/phase đọc ở `BRD.md` v3.10 §📍 · hành vi `PRD.md` v2.9 §📍 · contract `TDD.md` v3.2 §📍 · **tiến độ thật `ROADMAP.md` v3.17 §📍** (mốc `main@e235ea4`, 15/09).
>
> **Phase-1 (DD-114):** ⬜ ngoài phase-1 (D7) · **Launch (DD-113):** ⬜ negative scope
>
> **Surface:** Web app **PWA** (Next.js App Router, installable/offline — DD-113 launch = PWA + Zalo bot song song) — ngoài 5 khối launch; **app native iOS (App Store) + Android (CH Play) là phase-2** (DD-69): tái dùng API/contract, màn native thiết kế lại theo platform sau gate, **không phải bản sao màn này**.
>
> **Trạng thái:** FE design Draft · 🔴 **FE PENDING (DD-116)** — không mở page/component, không track `.pen` tới khi đủ cả ba vế (chọn đúng một `.pen` canonical · tracked trên `main` · owner ký gate DD-81) · as-built @ `main@e235ea4`: **0 màn FE nối API** (đúng 1 `apps/web/app/page.tsx`); BE: chat DB root `0030`–`0032` code dark, 0 API.

---

## 1. Mô tả

Chat trong app giữa thành viên CLB và host — group chat theo CLB + DM giữa 2 người. Truy cập qua icon 💬 trên header (mọi màn). Hỗ trợ text + media (image/file), closed-set reactions, reply, own edit/delete, structured mentions và slash-command requester overlays. Chat KHÔNG chiếm tab trên bottom nav — luôn truy cập từ header.

> ⚠️ **Privacy boundary (DD-91):** Slash command `/pay` là requester-only overlay. Peer trong DM **KHÔNG thấy gì**: không command, không result, không event, không unread, không ref. Kết quả là card cục bộ tạm thời, không ghi vào lịch sử.
> ⚠️ **Safety gate (DD-55):** DM chỉ mở sau khi block + report + rate-limit + abuse audit đều hoạt động fail-closed.

> 🚧 **Current implementation boundary — toàn bộ §6 của file này là `UNPINNED`.** Wireframe, state,
> component và animation dưới đây là **visual fixture**: chúng kiểm tra hierarchy/spacing, KHÔNG
> authorize fetch, render hay implement. Chat hiện có **0 migration · 0 API · 0 UI**; exact HTTP
> handoff còn phải pin ở slice. Không dùng fixture làm seed/default/fallback, không suy response path
> từ wireframe. Riêng DM: entry point phải **omit** cho tới khi safety gate chứng minh live
> (`feature_inapp_chat.md:95` — "gate/config chưa sẵn sàng → fail-closed, không tạo DM"), không render
> thread rỗng.

---

## 2. User Flows

### Flow 1: Mở chat

1. User tap 💬 trên header → mở chat list
2. Thấy: CLB group chats + DMs sorted by recent
3. Tap thread → xem messages + nhập tin nhắn

### Flow 2: Chat CLB (group)

1. Mở CLB thread → thấy messages từ thành viên
2. Nhập tin → send → message hiện realtime. Channel `admins_only` yêu cầu exact `chat.channel.post_restricted`; thiếu/wrong/expired/revoked → composer read-only và server deny nếu state drift
3. Swipe/long-press message → reply, react (👍|❤️|😂|😮|😢|🙏), edit (<15m), delete
4. Hide/restore message chỉ với exact `chat.message.moderate`; timed member mute (1h/24h/7d) + reason chỉ với exact `chat.member.mute`. Không suy từ role hoặc `chat.channel.manage`

### Flow 3: Slash command /pay

1. Gõ `/pay` trong CLB chat → hiện payment status card (requester-only)
2. Trong DM → nếu 1 CLB → thẳng card. Nhiều CLB → picker

### Flow 4: Mentions, search và channel management

1. Gõ `@` → chọn member từ server-authorized picker; submit structured mention IDs, không parse display name thành identity
2. Search gọi server PostgreSQL `simple` FTS trên message hiện còn được live-authorize; server loại tombstone, revision cũ và private-bot content trước khi trả
3. Personal DM không có archive state
4. Club channel archive chỉ hiện với exact `chat.channel.manage`; missing/wrong/expired/revoked capability thì action absent
5. Nếu channel đang là default, archive action chỉ hiện sau khi HTTP owner pin picker replacement + một atomic swap-and-archive command; tới lúc đó action absent trên default channel

> **Slash catalog:** `/help | /pay | /me | /myclubs | /discover | /name` dùng trong club, bot và human-DM requester overlay. `/sessions | /waitlist` chỉ dùng trong club/private-bot contexts. Unknown command hoặc unsupported args trong private context bị reject **trước insert**, nên peer không thấy command/event/unread/ref.

---

## 3. Screens & States

### Chat List

#### Layout (Mobile 375px)

```
┌──────────────────────┐
│ [← Back] 💬 Tin nhắn │
├──────────────────────┤
│ [🔍 Tìm kiếm...]    │
├──────────────────────┤
│ ┌──────────────────┐ │
│ │ 🏸 CLB Rồng Xanh │ │
│ │ Nguyễn A: BM T5.. │ │
│ │ 5 phút trước · 🔴2│ │
│ └──────────────────┘ │
│ ┌──────────────────┐ │
│ │ 👤 Trần Thị B    │ │  ← DM: omit tới khi safety gate live
│ │ Cho hỏi kèo CN.. │ │
│ │ 1 giờ trước       │ │
│ └──────────────────┘ │
│ ┌──────────────────┐ │
│ │ ⚽ FC Phượng Hoàng│ │
│ │ Host: Kèo CN đã..│ │
│ │ Hôm qua           │ │
│ └──────────────────┘ │
├──────────────────────┤
│ Bottom Nav            │
└──────────────────────┘
```

#### Layout (Desktop ≥1024px)

```
┌──────────────────────────────────────────────────────────────┐
│  Header: 💬 Tin nhắn                                        │
├─────────────────┬────────────────────────────────────────────┤
│                 │                                            │
│  Thread List    │  Message View                              │
│  (300px)        │                                            │
│                 │  🏸 CLB Rồng Xanh (12 thành viên)          │
│  [🔍 Search]   │  ──────────────────────────────────         │
│                 │  Nguyễn A: BM T5 ai join? · 5m             │
│  🏸 CLB RX ●   │  Trần B: Tui đi!           · 4m            │
│  👤 Trần B     │  Lê C: Join luôn            · 3m            │
│  ⚽ FC PH      │  (không có system message — xem ghi chú)    │
│                 │                                            │
│                 │  ┌────────────────────────────────┐        │
│                 │  │ [______________________] [Send]│        │
│                 │  └────────────────────────────────┘        │
│                 │                                            │
└─────────────────┴────────────────────────────────────────────┘
```

> ⚠️ **Vòng trước ô này vẽ `[System] 3/8 slot filled` — đã gỡ, và gỡ vì hai lý do độc lập:**
> (1) **không producer nào được authorize** ghi system message (`BE/feature_inapp_chat_tech.md:1213`
> chỉ cho P7 bot SECURITY DEFINER; `feature_inapp_chat.md:55` cấm moderation tạo), và session
> join/slot activity còn deferred bởi `NTF-OQ-18`;
> (2) `3/8` là **denominator đẩy tới mọi member** — đúng lớp mà marketplace cấm
> (`feature_marketplace_fe.md`: chỉ `slots_open`, KHÔNG denominator). Không vẽ lại dưới dạng khác.

#### States

- **Loading:** Skeleton thread rows
- **Ready:** Thread list sorted by recent. Unread badge (🔴 count). Last message preview
- **Empty:** "Chưa có tin nhắn nào" + "Tin nhắn từ CLB sẽ hiện ở đây"
- **Error:** Retry

#### Error mapping

| Status | Error code | Visible state | i18n `t(vi, en)` |
|---|---|---|---|
| 403 | `CHAT_FORBIDDEN` | Thread biến mất khỏi list + đóng SSE; không giữ preview mờ, không render row no-access | `t("Không có quyền trong kênh này", "You don't have access to this channel")` |
| 403 | `CHAT_SAFETY_BLOCKED` | **DM entry point (nút nhắn tin / tạo DM) omitted** — không mở thread rỗng, không tạo thread lạc quan. Áp cả khi safety gate/config chưa sẵn sàng: fail-closed, không tạo DM. Group threads vẫn render | `t("Không thể thực hiện thao tác", "This action isn't available")` |
| 429 | `CHAT_RATE_LIMITED` | Tạo DM bị chặn tạm; entry point về trạng thái chờ + retry, không tạo thread lạc quan | `t("Gửi quá nhanh — thử lại", "Too fast — try again")` |
| — | *(unknown / missing / timeout)* | **Fail closed** — unavailable placeholder + retry; giữ stale threads nếu có, không render Empty và không mở DM entry point | `t("Không tải được tin nhắn. Thử lại.", "Couldn't load messages. Try again.")` |

> **Error mapping:** Pin server error/status → exact visible state. Unknown/missing response fail closed;
> không invent success, zero, empty hoặc disabled control. Nếu BE chưa pin catalog cho một endpoint,
> ghi `UNPINNED error catalog — omit active UI` thay vì bịa mã.

#### Responsive

| Breakpoint | Chat List |
|---|---|
| 1440px | Trên ngưỡng `≥1024px` của wireframe desktop: split — thread list cột trái 300px (§7) + message view bên phải; header "💬 Tin nhắn" chạy ngang trên cả hai cột; ô [🔍 Search] nằm trong cột thread list; không có bottom nav |
| 768px | Dưới ngưỡng `≥1024px` nên không dùng split layout. File chỉ pin hai hình thức — mobile 375px và desktop `≥1024px` — và **không pin** form riêng cho dải 768–1024px; không tự đặt số, không tự dựng biến thể trung gian |
| 375px | Full-screen thread list: header [← Back] 💬 Tin nhắn · ô tìm kiếm dưới header · thread row xếp dọc (avatar + tên + preview + time + unread badge) · bottom nav dưới cùng. Chat **không** chiếm tab trên bottom nav — luôn vào từ icon 💬 trên header (§1). Baseline omit không đổi theo breakpoint — chat hiện **0 migration · 0 API · 0 UI** (fence §1) nên toàn bộ wireframe là visual fixture, không fetch/không render ở mọi kích thước; riêng DM entry point vẫn **omit** tới khi safety gate chứng minh live, không render thread rỗng |

### Message View

#### States

- **Loading:** Skeleton message bubbles
- **Ready:** Messages chronological. Input bar bottom. **Không render system message** — chưa producer nào được authorize ghi (`BE/feature_inapp_chat_tech.md:1213`, `feature_inapp_chat.md:55`)
- **Empty (new thread):** "Bắt đầu cuộc trò chuyện"
- **Error:** "Không tải được tin nhắn" + retry
- **Slash command result:** Inline card **chỉ hiện cho requester**. Peer thấy **tuyệt đối zero** — không command/result/event/unread/ref

#### Error mapping

| Status | Error code | Visible state | i18n `t(vi, en)` |
|---|---|---|---|
| 403 | `CHAT_FORBIDDEN` | Đóng thread + remove messages; generic no-access, không giữ preview mờ | `t("Không có quyền trong kênh này", "You don't have access to this channel")` |
| 403 | `CHAT_SAFETY_BLOCKED` | DM composer + thread absent (block pair hoặc safety gate chưa sẵn sàng); không render thread rỗng, không tiết lộ phía nào block | `t("Không thể thực hiện thao tác", "This action isn't available")` |
| 403 | `CHAT_MUTED` | Composer read-only + inline banner; read access không đổi, không ẩn message đã có | `t("Bạn đang tạm bị giới hạn gửi trong kênh này", "You're temporarily restricted from posting in this channel")` |
| 403 | `CHAT_CAPABILITY_REQUIRED` | Action absent (không disabled) + refetch state; không suy quyền từ role ở client | `t("Không có quyền thực hiện thao tác", "You don't have permission for this action")` |
| 403 | `CHAT_MODERATION_FORBIDDEN` | Hide/restore absent; generic no-disclosure, không hiện target tồn tại hay không | `t("Không thể kiểm duyệt nội dung này", "You can't moderate this content")` |
| 409 | `CHAT_DUP_MESSAGE` *(200-safe)* | Retry trả message cũ — render đúng 1 bubble, không double-insert, không báo lỗi | `N/A — no error surface` |
| 413 | `CHAT_MESSAGE_TOO_LARGE` | Inline error dưới composer; giữ nguyên draft, không tự cắt bớt nội dung | `t("Tin nhắn quá dài", "Message is too long")` |
| 429 | `CHAT_RATE_LIMITED` | Send bị chặn tạm + retry; message giữ trạng thái chưa gửi, không render đã gửi | `t("Gửi quá nhanh — thử lại", "Too fast — try again")` |
| 409 | `CHAT_EDIT_WINDOW_CLOSED` | Edit action absent + đóng edit box; body giữ revision server, không apply optimistic | `t("Không thể sửa tin nhắn này nữa", "This message can no longer be edited")` |
| 409 | `CHAT_EDIT_CONFLICT` | Dialog "tin nhắn đã thay đổi" + refetch; không retry ngầm, không ghi đè revision | `t("Tin nhắn đã thay đổi", "This message changed")` |
| 409 | `CHAT_MEDIA_NOT_READY` | Media giữ trạng thái chờ cho requester; người khác không thấy raw pending/rejected media | `t("Tệp chưa sẵn sàng", "This file isn't ready yet")` |
| 415 | `CHAT_MEDIA_TYPE_REJECTED` | Inline error ở attachment; không upload lại tự động, không đổi type hộ user | `t("Loại tệp không được hỗ trợ", "This file type isn't supported")` |
| 422 | `CHAT_MEDIA_REJECTED` | Safe tombstone + remove action theo contract; không cấp signed access | `t("Tệp không thể sử dụng", "This file can't be used")` |
| 409 | `CHAT_REPLY_INVALID` | Reply preview bị gỡ + composer giữ draft; không partial insert | `t("Tin nhắn trả lời không còn hợp lệ", "The message you're replying to is no longer valid")` |
| 422 | `CHAT_MENTION_INVALID` | Refresh mention picker; không fallback fuzzy/display-name lookup | `t("Mention không hợp lệ", "That mention isn't valid")` |
| 422 | `CHAT_REACTION_INVALID` | Reaction không apply; giữ closed set 👍❤️😂😮😢🙏, không render emoji ngoài set | `t("Cảm xúc không hợp lệ", "That reaction isn't allowed")` |
| 409 | `CHAT_MESSAGE_TOMBSTONED` | Reply/reaction bị chặn; message hiện tombstone "đã ẩn", không còn body/media | `t("Tin nhắn đã được ẩn", "This message has been hidden")` |
| 400 | `CHAT_COMMAND_UNKNOWN` | Local error cho requester **trước insert**; peer zero event/unread/ref | `t("Lệnh chưa hỗ trợ — xem /help", "Unknown command — see /help")` |
| 400 | `CHAT_COMMAND_ARGUMENTS_NOT_ALLOWED` | Local error trước insert; không tự bỏ tham số rồi gửi hộ | `t("Lệnh này không nhận tham số", "This command doesn't take arguments")` |
| 400 | `CHAT_COMMAND_UNSUPPORTED_SURFACE` | `/sessions`·`/waitlist` trong human DM: local error trước insert, command ẩn khỏi autocomplete | `t("Lệnh chưa dùng được tại đây", "This command isn't available here")` |
| 400 | `CHAT_COMMAND_SELECTOR_INVALID` | CLB picker đóng + yêu cầu chọn lại (requester-only); generic, không lộ tenant nào còn eligible | `t("Lựa chọn không còn hợp lệ", "That selection is no longer valid")` |
| 409 | `CHAT_COMMAND_ROUTE_REQUIRED` | Zero mutation; requester-only hint, không chèn message vào thread | `t("Hãy dùng thao tác riêng tư này trong ứng dụng", "Use this private action inside the app")` |
| 409 | `CHAT_DEFAULT_REQUIRED` | Archive action bị chặn; không archive trước rồi sửa default sau | `t("CLB phải có một kênh mặc định", "A club must keep one default channel")` |
| 409 | `CHAT_IDEMPOTENCY_MISMATCH` | Command dừng + refetch receipt; không retry ngầm với payload khác | `t("Yêu cầu không khớp lần gửi trước", "This request doesn't match the previous one")` |
| 422 | `CHAT_REASON_INVALID` | Inline error trong ReportModal ở field lý do/note; không submit | `t("Lý do không hợp lệ", "That reason isn't valid")` |
| 422 | `CHAT_MUTE_DURATION_INVALID` | Inline error ở picker thời hạn; chỉ 1h·24h·7d, không tự chọn hộ | `t("Thời hạn tạm ẩn không hợp lệ", "That mute duration isn't valid")` |
| — | *(unknown / missing / timeout)* | **Fail closed** — unavailable placeholder + retry; composer read-only, message giữ trạng thái chưa gửi, không render slash result | `t("Không tải được tin nhắn. Thử lại.", "Couldn't load messages. Try again.")` |

> **Error mapping:** Pin server error/status → exact visible state. Unknown/missing response fail closed;
> không invent success, zero, empty hoặc disabled control. Nếu BE chưa pin catalog cho một endpoint,
> ghi `UNPINNED error catalog — omit active UI` thay vì bịa mã.

#### Responsive

| Breakpoint | Message View |
|---|---|
| 1440px | Pane phải của split desktop (thread list 300px bên trái, §7): chat header (avatar + tên + member count) trên cùng, message bubble chronological ở giữa, composer + [Send] sticky đáy pane; gửi bằng Enter (§7); chưa chọn thread → pane phải hiện placeholder "Chọn cuộc trò chuyện" (§5 case 9); slash autocomplete là dropdown ngay trên composer |
| 768px | Dưới ngưỡng `≥1024px` nên không dùng split layout. File chỉ pin hai hình thức — mobile 375px và desktop `≥1024px` — và **không pin** form riêng cho dải 768–1024px; không tự đặt số, không tự dựng biến thể trung gian |
| 375px | Full-screen message view sau khi tap thread, có nút back về thread list (§7); composer sticky đáy, auto-resize khi multiline, gửi bằng nút thay vì Enter (§7); long-press bubble → context menu copy/reply (§7); scroll lên → lazy load history, có tin mới khi đang scroll lên → badge "↓ Tin mới" (§7). Baseline omit không đổi theo breakpoint — chat hiện **0 migration · 0 API · 0 UI** (fence §1), không fetch/không render ở mọi kích thước; DM composer/thread vẫn absent tới khi safety gate live, và slash-command result vẫn là overlay requester-only (peer thấy zero) ở mọi kích thước |

---

## 4. Components Used

| Component | States | Mô tả |
|---|---|---|
| `ThreadRow` | default, unread (bold + badge), selected | Row thread: avatar + name + preview + time |
| `UnreadBadge` | count (1-99), 99+ | Badge đỏ số tin chưa đọc |
| `MessageBubble` | sent (right, brand color), received (left, gray), system (center, muted), edited (label), tombstone | Bubble tin nhắn |
| `SystemMessage` | — | **Không implement ở phase này.** Không producer nào được phép ghi system message: `BE/feature_inapp_chat_tech.md:1213` chốt "chỉ bot SECURITY DEFINER riêng ở P7 mới ghi assistant/system", và `feature_inapp_chat.md:55` cấm moderation tạo system message. Session join/slot activity còn deferred bởi `NTF-OQ-18` |
| `SlashCommandCard` | closed catalog theo context | Requester-only overlay; `/sessions` và `/waitlist` chỉ club/private-bot, private rejects xảy ra trước insert |
| `ClubPicker` | single select, multi CLB | Picker CLB khi /pay trong DM nhiều CLB |
| `MessageInput` | default, focus, sending, slash hint, read-only, denied | `admins_only` cần exact `chat.channel.post_restricted`; thiếu grant → read-only, drift → deny + refetch |
| `MentionPicker` | loading, ready, empty, denied | Structured member picker; submit opaque person/member ref, không dùng display-name lookup |
| `AuthorizedMessageSearch` | idle, loading, results, no-match, denied, error | Server `simple` FTS + live authz; loại tombstone/revision/private-bot, không client-only scan |
| `ChatHeader` | group (avatar + name + member count), DM (avatar + name) | Header chat thread |
| `ReactionBar` | 👍 ❤️ 😂 😮 😢 🙏, with count per emoji | Reaction picker + display |
| `ReplyPreview` | attached to message (truncated original) | Reply context preview |
| `MediaMessage` | image (loading/ready/error), file (download link) | Image inline + file attachment |
| `BlockButton` | default, blocked | Block/unblock user |
| `ReportModal` | form: reason select + optional note | Report abuse modal |
| `MessageModerationBar` | hidden, hide, restore, processing, denied | Exact `chat.message.moderate`; không suy từ channel-management/role |
| `MemberMuteAction` | hidden, 1h, 24h, 7d, processing, denied | Exact `chat.member.mute` + reason; là write restriction, không phải notification preference |
| `ChannelArchiveAction` | hidden, ready, replacement-required, processing | Exact `chat.channel.manage`; default channel chỉ cho action khi có replacement picker + atomic swap/archive contract, nếu chưa pin thì hidden |

---

## 5. Edge Cases (UX)

| # | Case | Hiển thị |
|---|---|---|
| 1 | Unread count > 99 | Badge "99+" |
| 2 | /pay trong DM nhiều CLB | CLB picker inline (requester-only) |
| 3 | /pay result — peer trong DM | Peer **KHÔNG thấy** command/result/event/unread/ref. Tuyệt đối zero |
| 4 | Message gửi khi offline | Composer giữ draft **in-memory** + trạng thái "⏳ Chưa gửi" (`t("Chưa gửi", "Not sent")`) + retry khi có lại mạng. Retry dùng đúng `client_msg_id` cũ — `UNIQUE(channel_id, client_msg_id)` trả message cũ, không double-insert (`BE/feature_inapp_chat_tech.md:867`). **Không persist nội dung message ra client storage**: offline outbox/queue chưa có authority nào pin, không auto-send ngầm |
| 5 | Club notification preference = `off` | Thread vẫn readable và unread badge vẫn phản ánh read state; chỉ tắt notification delivery. DM không có preference control mới |
| 6 | Long message | Word wrap. Không truncate trong view |
| 7 | User bị kick khỏi CLB | Mất read/send authority, đóng SSE stream và remove thread/messages; race đang mở → generic no-access, không giữ preview mờ |
| 8 | /sessions beta OFF | Command không hiện trong autocomplete. Gõ → "Tính năng chưa khả dụng" |
| 9 | Desktop: no thread selected | Right pane: "Chọn cuộc trò chuyện" placeholder |
| 10 | Scroll lên xem history | Lazy load older messages (infinite scroll up) |
| 11 | Block user | Chặn DM send/receive/create. Hiện "Bạn đã chặn người này" |
| 12 | Report user | Modal: chọn lý do (spam/harassment/unsafe/off_topic/other) + note |
| 13 | Edit message > 15 phút | Nút edit ẩn. Hiện "Chỉ sửa được trong 15 phút" |
| 14 | Edit message 5 lần rồi | Nút edit disabled. "Đã sửa tối đa" |
| 15 | Host đọc DM của người khác | **KHÔNG BAO GIỎ** — host/admin không có quyền đọc DM |
| 16 | Media pending/rejected/quarantined/deleted | Requester thấy scan progress; terminal unsafe/deleted state thành safe tombstone + retry/remove action theo contract. Người khác không thấy raw pending/rejected media |
| 17 | Unknown slash command / unsupported args trong private context | Reject trước insert; requester thấy local error, peer zero event/unread/ref |
| 18 | Mention target không còn authorized/visible | Server reject; refresh picker, không fallback fuzzy/display-name lookup |
| 19 | Archive personal DM | Không có action và không có personal archive state |
| 20 | Archive default club channel | Action absent tới khi exact replacement picker + atomic swap-and-archive command được pin; không archive trước rồi sửa default sau |
| 21 | `admins_only` thiếu `chat.channel.post_restricted` | Composer read-only; send bị server deny nếu grant drift, rồi refetch. Không suy quyền từ role |
| 22 | Thiếu moderation capability | Hide/restore absent nếu thiếu `chat.message.moderate`; timed mute absent nếu thiếu `chat.member.mute`; hai grant độc lập với `chat.channel.manage` |

---

## 6. Data hiển thị

| Field | Exact response path | Format | i18n `t(vi, en)` | Ghi chú |
|---|---|---|---|---|
| Thread name | `UNPINNED Chat HTTP DTO — omit active UI` | CLB name hoặc person name | `data — no copy` | Display name, không dịch |
| Last message preview | `UNPINNED Chat HTTP DTO — omit active UI` | Truncate 1 line | `data — no copy` | "{sender}: {message}", không dịch |
| Time | `UNPINNED Chat HTTP DTO — omit active UI` | Relative | `t("Hôm qua", "Yesterday")`; "5m"·"1h": N/A — locale formatter | "5m", "1h", "Hôm qua" |
| Unread count | `UNPINNED Chat HTTP DTO — omit active UI` | Number badge | Accessible label `t("Tin nhắn chưa đọc", "Unread messages")`; value: `data — no copy` | Red circle + accessible label |
| Message text | `UNPINNED Chat HTTP DTO — omit active UI` | Full text | `data — no copy` | Word wrap, không dịch |
| Reaction | `UNPINNED Chat HTTP DTO — omit active UI` | Emoji + count | Accessible label `t("Cảm xúc", "Reactions")`; emoji + count: `data — no copy` | 👍3 ❤️1 + accessible label |
| Edited label | Static target copy; Chat DTO unpinned | "(đã sửa)" | `t("(đã sửa)", "(edited)")` | Nhỏ, muted, bên dưới message |
| Media | `UNPINNED Chat HTTP DTO — omit active UI` | Image inline / file link | Label `t("Tệp đính kèm", "Attachment")`; nội dung tệp: `data — no copy` | Signed URL, re-authorize on read |

> **i18n:** Mọi chuỗi user-facing ở file này đi qua `t(vi, en)` (`packages/core/src/i18n.ts`). Repo không có key-based i18n; cặp vi/en ở cột trên là chuỗi thật, không phải key.

---

## 7. Responsive & Interaction Notes

- **Desktop:** Split layout (thread list 300px left + messages right). Click thread → load messages
- **Mobile:** Thread list → click → full-screen messages → back button
- **Input bar:** Sticky bottom. Auto-resize height for multiline. Send: Enter (desktop), button (mobile)
- **Slash autocomplete:** Typing "/" shows command list dropdown. Tab/click to select
- **Realtime:** SSE/LISTEN-NOTIFY only. New message → scroll to bottom (nếu ở bottom). Nếu scrolled up → "↓ Tin mới" badge
- **Unread header badge:** 💬 icon trên header hiện badge tổng unread across threads
- **Dark mode:** Sent bubble `var(--primary)`, received `var(--bg-card)`. System muted text
- **Touch:** Long-press message → context menu (copy, reply). Club thread có thể mở preference `all | mentions | off`; DM không có preference control. Moderation timed mute là write restriction riêng, không đổi unread/read state. Archive nằm trong authorized management menu

---

## Analytics Events (Draft — đề xuất, chưa phải contract)

> Skeleton — chưa điền. Quy tắc khi điền: params cấm amount/tiền/PII; chỉ opaque id, enum, count, boolean. Nguồn template: Sporta FE porting analysis 2026-08-07.

| Event | Trigger | Params | Ghi chú |
|---|---|---|---|
| TBD (UNPINNED) | | | |

## State Machine (Draft)

> Skeleton — node lấy từ §States hiện có của file này: Chat List (§3): Loading · Ready · Empty · Error; Message View (§3): Loading · Ready · Empty (new thread) · Error · Slash command result. Transition: TBD (UNPINNED) — chỉ được điền từ flow/edge case đã pin, không suy diễn.

## Acceptance Criteria (Draft)

> Skeleton — mỗi AC khi điền phải trace về một § có sẵn trong file. TBD.

## Testing Notes (Draft)

> Skeleton — unit/component/e2e hooks map theo AC. TBD.

---

_FE Design Spec v0.5 · 2026-08-07 · Source: feature_inapp_chat.md v0.15_
_Changelog v0.5: Thêm skeleton 4 section Draft (Analytics/State Machine/AC/Testing) — nguồn: Sporta FE porting analysis 2026-08-07_
_FE Design Spec — 2026-09-08 (cấu trúc, không bump version): thêm khối 📍 Đọc nhanh dưới header — feature nguồn · phase-1 (DD-114) · launch (DD-113) · surface PWA trước, native iOS/Android phase-2 (DD-69) · FE PENDING (DD-116) · as-built @ `e235ea4`. Pointer core docs BRD v3.10 · PRD v2.9 · TDD v3.2 · ROADMAP v3.17. Nội dung thiết kế không đổi._

_Re-pin 2026-09-15 (cấu trúc, không bump version): as-built @ `e235ea4` theo `ROADMAP.md` v3.17 §📍 — 8 command session · 7 route nghiệp vụ · **0 màn FE**; FE PENDING (DD-116) không đổi, DD-119 vẫn 🟡 chưa ratify. Nội dung thiết kế không đổi._
