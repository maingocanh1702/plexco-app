# Feature: In-app Chat (toàn CLB + 1-1 + Group) — Product/UX Spec

> ⚙️ **Status:** ✅ **Reviewed contract** — DD-38/DD-55/DD-86/DD-91..95 ratified; pending migration. DD-88 là broader proposal. Nguồn canonical: `../../standards/decisions.md` + companion BE spec.

> **Canonical phase:** P4 (đề xuất — dựng sớm hạ tầng `chat_*`)
> **Track:** 💬 In-app Chat
> **Version:** 0.21 · 2026-10-16
> **Status:** ✅ Reviewed — final Product contract, pending migration
> **Implementation:** Not started — schema `chat_*` chưa vào canonical · authority: `../../standards/BUILD-STATUS.md` (Doc status ≠ Implementation status)  
> **Prerequisites:** P4 web/app surface + sync engine · **DD-07** (SSE + `LISTEN/NOTIFY`) · P3.5 identity (Person/Membership)
> **Tài liệu liên quan:** `../../product/BRD.md` MODULE 10 / BR-15 / AC-10 / FR-10 · `../../standards/decisions.md` **DD-38/DD-55/DD-56/DD-86/DD-88/DD-91..95** · DD-07 · DD-19/DD-20 (trợ lý tái dùng `chat_*` ở P7) · `feature_club_assistant.md` · `feature_notifications_reminders.md` · `feature_identity.md` · `packages/db/schema.ts` (**AUTHORITATIVE** khi triển khai)

> ⚠️ **MVP build scope narrowed by DD-136 (owner 2026-10-16): club channel only.** DM, media, reaction, search, group/pin/poll/embed, slash command và digest/push offline nằm ngoài MVP build. Schema `0031`: `chat_channels.kind` CHECK = `('club','dm')` — `group` chưa có schema. Mọi use case và wireframe `group` bên dưới giữ nguyên như product contract bị hoãn (deferred); không use case nào bị xoá.

> ✅ **DD-86 final boundary (2026-07-28):** Option B đã `DECISION_FINAL`: N `kind='club'` channel/tenant, exact-one active default, atomic auto-provision; lifecycle/restricted post dùng exact `chat.channel.manage`/`chat.channel.post_restricted`. Assistant mặc định true cho `all_members`, false cho `admins_only`; chỉ `chat.channel.manage` được đổi flag trên cả hai policy, và channel flag luôn **AND** tenant config/exact `assistant_ai_kb` entitlement/cap/provider/privacy gates. Migration vẫn **HOLD** tới strict slice readiness; Reviewed docs không phải runtime proof hay build authorization.

> ✅ **DD-91 primary-surface mirror (2026-07-27):** slash read-only riêng tư như `/pay` là **requester-only command overlay**, không phải human message hay Assistant/bot message. Trong DM người↔người, peer không thấy command, kết quả, event, unread hay result ref. Kết quả trả đồng bộ cho đúng requester qua authenticated HTTP `private, no-store` và chỉ tồn tại như card cục bộ tạm thời; không ghi `chat_messages`, SSE, outbox, push hoặc shared history.

> ✅ **DD-92..95 floor (2026-07-28):** same-channel reply, immutable structured mentions, reactions exact `👍|❤️|😂|😮|😢|🙏`, own edit `<15m`/max 5, author soft-delete và authorized PostgreSQL search; zero-alias/arg slash catalog theo ba surfaces; generic coalesced digest không durable item/body; club-only hide/restore + timed mute với receipt/audit. Không hard delete hoặc host/admin read/moderation trong human DM.

---

## 1. Mô tả

**Chat cơ bản trong app** cho tương tác không lệ thuộc nhóm chat bên ngoài (Zalo/Messenger). Ba loại kênh:

- **Chat CLB (`club`):** N kênh theo chủ đề cho **member trong 1 tenant**; scoped `tenant_id` + **RLS fail-closed** (tenant-private), đúng một active default.
- **Chat riêng 1-1 (`dm`):** person ↔ person; **chỉ 2 người** trong hội thoại đọc được (đường **person-self**).
- **Group chat (`group`):** nhóm nhiều người (3–50 members), hỗ trợ **hai scope**:
  - **Global** (`tenant_id=NULL`): bạn bè tự tạo, không thuộc CLB nào — RLS qua membership check.
  - **Tenant-scoped** (`tenant_id NOT NULL`): subset ad-hoc members trong 1 CLB — RLS tenant-private + membership.
  - **Follow-guard:** chỉ add member mới nếu target đã **follow actor** (DD-47 `person_follows.status='accepted'`). Tự mình join group bằng invite link (tương lai) không cần follow.
  - Sub-features Messenger/Telegram-style: **multi-pin** (tối đa 5 tin ghim/group), **poll/vote** nâng cao (single/multi choice, anonymous, quiz, deadline), **group admin** (đặt admin, kick, rename, đổi avatar), **group settings** (mute, leave, custom nickname).

Chat **chỉ sống trong Plexco** (web + surface app của Plexco), **KHÔNG bridge** ra group Zalo/Messenger ở phase-1 (BRD CO-7). Lưu **canonical** rồi project realtime qua **SSE (DD-07)**. Phase-1 gồm text + media hoàn chỉnh: private object storage, signed access, MIME/type/size/quota checks, malware scan, moderation và deletion lifecycle; không ship media half-built.

**Tái dùng hạ tầng:** dùng **chung bộ bảng `chat_*`** mà trợ lý AI (DD-19 pha B, DD-20) sẽ tái dùng ở **P7** (bot-participant `author_type='assistant'`). DD-38 chỉ **đảo thứ tự** — dựng hạ tầng chat người↔người sớm ở P4 thay vì P7. **Không tạo model song song.**

**Execution ownership theo primary-surface plan v1.8:** colliding DB worktrees serialize `chat-definer-role-provisioning` (1) → `chat-dm-safety-authority-core` (2) → `dd38-dd86-chat-schema-core` (3) → `tenant-capability-authority-core` (4). Sau đó explicit dependency là club lifecycle (5) → safe target core (9) → club moderation (6) → shared-message core (7) → DM lifecycle (8); stable catalog ID không phải execution order. Slice 4 sở hữu closed DD-56 registry, least-privilege preset, grant expiry/revocation và **append-only grant audit**. Slice 9 sở hữu short-lived requester+channel-bound opaque target ref + safe label và consume-time resolver cho mention/mute/start-DM; không global/fuzzy people search, raw UUID, persistent directory hoặc PII.

Mechanism slices 1–15 không ngầm sở hữu HTTP/UI. A1–A13 lần lượt sở hữu channel list/create/update, default/archive, history/send/read, DM list/create, block/report, safe current-member target, reaction, own edit/delete, authorized search, upload/status, attachment read/delete, club moderation và slash/private picker. Sau F0 tracked design authority, F1–F10 sở hữu channel shell, safe target picker, history/realtime, text composer, requester command overlay, private bot/mention, message interactions, search, media và safety/moderation. Adapter/UI chỉ gọi canonical mechanism owner, không tái dựng authz, membership, moderation, unread hay command state. Initiative `PLAN_READY` tại authority `90d292d`, nhưng runtime = 0, B4/worktree chưa author và từng slice vẫn phải strict `CODE_READY`.

### Entry points

| Entry | Route / Surface | Actor | Mô tả |
|-------|----------------|-------|-------|
| Header → 💬 | Shell header `💬` (cạnh 🔔) | User (auth) | Channel list (CLB + DM + Group) |
| Club detail → Chat | Club → Chat | Member | Channel `kind='club'` (`feature_club.md`) |
| Notification → chat | Push/Inbox → message | User | Deep link tới channel/message |
| Start DM (safe target) | Member picker → start DM | User (auth) | 1-1 DM person-self (safe target ref, DD-91) |
| Group create/invite | Channel list → new group / invite | User | Group (follow-guard DD-47) |
| Session ref in chat | Chat message → `/session/<slug>` | User | Shared session link (cross-feature) |
| Slash command | `/pay` … requester-only (DD-91) | User (auth) | Command overlay — không ghi transcript |

### Bất biến

- Chat `club` **cô lập cross-tenant** — app scoped `tenant_id` + DB **RLS fail-closed**; CLB A không đọc được chat CLB B (NFR-S1, bao gồm chat toàn CLB).
- Chat `dm` **chỉ 2 người** đọc được — đường **person-self**, không cho query person khác.
- Chat `group` **cô lập theo membership** — chỉ members trong group đọc được. Group global không lẫn dữ liệu tenant; group tenant-scoped cô lập cross-tenant.
- **Follow-guard khi add member vào group:** chỉ add nếu target đã follow actor (DD-47 `person_follows.status='accepted'`). Block boundary (DD-55) cũng chặn add.
- **Max 50 members/group.** Add khi đầy → reject `GROUP_MAX_MEMBERS`.
- **Multi-pin:** tối đa **5 pinned messages/channel** (áp dụng cho cả group, club, DM). Creator/admin pin bất kỳ tin; member thường chỉ pin tin của chính mình.
- **Poll/Vote:** poll gắn 1:1 với message; mỗi poll có 2–10 options; single hoặc multi-choice; optional anonymous, quiz mode, deadline. Đóng poll: hết deadline hoặc creator/admin đóng sớm.
- **Group admin:** creator tự động là admin đầu tiên; admin đặt/bỏ admin khác, kick member, rename, đổi avatar. Last admin không được leave — phải chuyển quyền trước.
- **Custom nickname:** viewer-local, chỉ mình thấy; không ảnh hưởng identity hay profile.
- **KHÔNG bridge** ra Zalo/Messenger/kênh ngoài ở phase-1 (CO-7); chat không xuất hiện ở group ngoài.
- Tenant + person resolve từ **phiên đăng nhập app**, **KHÔNG** từ nội dung message.
- Guarded send RPC atomically ghi canonical `chat_messages`, rồi `NOTIFY` message-id để SSE refetch dưới authz; side effect ngoài chat (nếu có) mới đi outbox. Không có message projector/writer thứ hai; idempotent theo **`client_msg_id` UNIQUE `(channel_id, client_msg_id)`**.
- **Tiền/PII không lộ** qua chat; chat KHÔNG thuộc public plane (không vào `public_sessions`).
- Rate-limit / anti-spam theo person + tenant.
- Phase-1 open DM chỉ được bật sau khi **block + report + per-sender/per-target rate-limit + abuse audit** đều hoạt động fail-closed qua **một canonical safety decision** tại request/create/bootstrap/send/read. Host/support/tenant admin không có quyền đọc DM.
- Media object mặc định private; pending/quarantined/rejected/deleted không được serve. Mọi signed access phải re-authorize channel membership tại thời điểm đọc.
- Registered requester-only slash grammar phải được nhận diện **trước** normal message insert. Normal send endpoint gặp `/pay` hợp lệ phải route-required/reject với zero message mutation; client không được biến command thành tin nhắn nếu command endpoint lỗi.
- DM có `tenant_id=NULL`, nên `/pay` trong DM người↔người không suy tenant từ peer/channel. Server resolve các CLB eligible của chính requester: đúng một CLB thì tự chọn; nhiều CLB thì trả picker riêng tư; không có thì trả trạng thái generic. Picker dùng selector opaque ngắn hạn bind actor + DM + tenant eligible + command; raw tenant ID không có authority.
- Safety authority/storage và canonical block/rate/audit primitives phải land ở **pre-root slice độc lập với `chat_*`**; root chat schema mới consume chúng cho RLS. DM create/send/read command core land sau root, không để root migration tham chiếu helper chưa tồn tại.
- **Message interactions:** reply chỉ tới current-visible message cùng channel mà requester đang được đọc; target đã tombstone tại send time thì reject, còn reply đã tồn tại chỉ render tombstone khi target bị ẩn sau đó. Mention là structured target + safe render snapshot bất biến. Mỗi person có tối đa một active reaction/message từ exact set `👍|❤️|😂|😮|😢|🙏`; replace/remove/retry idempotent.
- **Author lifecycle + search:** original human author được sửa body theo DB time `<15m`, tối đa 5 lần, với restricted prior-body revisions; author/channel/reply/attachments/mentions bất biến. Author soft-delete bất cứ lúc nào, irreversible với author và shared tombstone. Search beta-required chạy trên canonical current-visible row bằng PostgreSQL `simple` FTS, re-check current-readable channels và loại tombstone/revisions/slash/private bot data.
- Mention Club Assistant dùng exact structured target `club_assistant`, chỉ từ active member trong club channel. Mention không tự cấp quyền gọi model: projector vẫn bắt channel flag + mọi DD-20/DD-21 tenant/entitlement/provider/privacy gate và chỉ trả KB-grounded answer/citation hoặc `no_answer`; ledger status phải đi `/pay`, không qua LLM.
- **Slash v1:** ASCII case-insensitive canonicalization, zero alias/argument. `/help|/pay|/me|/myclubs|/discover|/name` chạy ở club, private Club Bot và human-DM overlay; `/sessions|/waitlist` chỉ ở club/bot. Unknown, extra argument hoặc unsupported surface trả private typed error/help **trước insert** và không bao giờ thành message.
- **Read boundary + digest:** realtime history/reconnect/unread/badge và `chat_members.last_read_created_at` + `last_read_message_id` (0031) thuộc Chat. DD-94 digest chỉ là generic coalesced delivery signal: DM/direct mention/reply default ON; club preference `all|mentions|off`, default `mentions`; zero durable item per source message/body/title/amount và live reauthorization ngay trước provider write.
- **Club moderation:** chỉ human-authored message trong club channel. `chat.message.moderate` soft-hide/restore bằng tombstone; `chat.member.mute` áp timed `1h|24h|7d` theo channel. Required reason `spam|harassment|unsafe|off_topic|other`, với bounded note cho `other`. Mỗi action cần actor-scoped receipt/fingerprint và immutable actor/reason/before-after/timestamp audit. Mute chặn write, không chặn read. Không đọc/moderate human DM, hard delete, sửa content, permanent ban, moderate assistant/system hoặc tạo system message.

---

## 2. Use Cases + Edge Cases

### Use Cases

| ID | Actor | Hành động | Kết quả |
|---|---|---|---|
| CHT-UC-1 | Member | Mở một kênh chat CLB | Load lịch sử (phân trang) trong tenant; RLS scoped |
| CHT-UC-2 | Member | Gửi tin nhắn text vào chat CLB | Ghi canonical → project realtime tới member online (SSE) |
| CHT-UC-3 | User | Mở DM 1-1 với user khác | Phase-1 open DM sau safety gate; upsert theo cặp person — chỉ 2 người |
| CHT-UC-4 | Member | Gửi DM 1-1 | Chỉ 2 người nhận realtime; không lộ ra chat CLB |
| CHT-UC-5 | Member | Nhận tin realtime khi đang online | SSE push; badge/thông báo chưa đọc |
| CHT-UC-6 | Member | Cuộn xem lịch sử cũ | Phân trang keyset theo thời gian |
| CHT-UC-7 | Member | Rời CLB (membership `left`) | Mất quyền đọc/gửi chat CLB đó; lịch sử giữ (audit) |
| CHT-UC-8 | Authorized moderator | Hide/restore club message hoặc timed-mute member | Exact capability → receipt + bounded reason + immutable audit; không hard delete/DM access |
| CHT-UC-9 | System | Reconnect sau mất mạng | Re-sync từ last-seen cursor; idempotent, không double |
| CHT-UC-10 | System | (P7) Trợ lý @mention trong chat CLB | Bot-participant trả lời (`author_type='assistant'`, DD-19/DD-20) — tái dùng cùng `chat_*` |
| CHT-UC-11 | User | Gửi ảnh/file hợp lệ | Upload private → scan/moderate → attach khi `ready`; recipient mở qua signed URL ngắn hạn sau authz |
| CHT-UC-12 | User | Block hoặc report người khác | Block chặn request/create/send/read boundary theo policy; report tạo abuse record/audit, không cấp host quyền đọc lịch sử DM |
| CHT-UC-13 | User | Gõ `/pay` trong DM người↔người | Slash bị intercept trước message insert; server resolve CLB của chính requester (1 auto · nhiều picker private · 0 generic) rồi trả card đồng bộ riêng requester. Peer nhận zero message/event/unread/result ref |
| CHT-UC-14 | Member | Reply, mention hoặc react | Reply same-channel; mention structured; reaction thuộc exact set `👍|❤️|😂|😮|😢|🙏` và replace/remove retry-safe |
| CHT-UC-15 | User | Dùng slash command | Registry zero-arg/alias theo surface; canonical command luôn requester-only, invalid/unsupported private-reject trước persist |
| CHT-UC-16 | Author | Sửa hoặc xoá tin của chính mình | Edit body `<15m`/max 5 với revision audit; soft-delete bất cứ lúc nào thành shared tombstone |
| CHT-UC-17 | User | Tìm tin nhắn | Search current-visible canonical content trong channel đang đọc; optional channel filter, không trả tombstone/private result |
| CHT-UC-18 | Offline recipient | Nhận digest generic | Coalesce tới highest unread cursor theo DD-94; không body/title/amount/durable item per message |
| CHT-UC-19 | Member | Forward tin nhắn từ club/group chat cho 1 user khác qua DM | Chọn tin → Forward → chọn người nhận (DM hiện có hoặc tạo mới). Tin forward kèm attribution gốc (sender, channel, timestamp). Không forward được tin đã xóa/ẩn (tombstone) |
| CHT-UC-20 | User | Forward tin nhắn từ DM người này sang DM người khác | Tương tự CHT-UC-19 nhưng source là DM. Chỉ forward được tin của chính mình hoặc tin nhận được (không forward tin của người thứ 3 mà mình không tham gia DM) |
| CHT-UC-21 | User | Tạo group chat mới | Chọn tên + avatar + chọn members (chỉ hiện người đã follow mình — DD-47); tạo group global hoặc tenant-scoped |
| CHT-UC-22 | Group member | Add member mới vào group | Chỉ add được nếu target đã follow actor (DD-47 `accepted`); block boundary (DD-55) cũng chặn |
| CHT-UC-23 | Group admin | Đặt member làm admin / bỏ admin | Cập nhật role; UI phản ánh ngay; system message thông báo |
| CHT-UC-24 | Group admin | Kick member khỏi group | Remove member; kicked user không gửi/nhận tin nữa; system message thông báo |
| CHT-UC-25 | Group admin/creator | Rename group / đổi avatar | Update metadata; system message thông báo thay đổi |
| CHT-UC-26 | Group member | Pin/unpin message trong group | Creator/admin pin bất kỳ tin; member chỉ pin tin của mình. Tối đa 5 pinned/channel. Unpin: creator/admin unpin bất kỳ, member unpin tin mình đã pin |
| CHT-UC-27 | Group member | Tạo poll vote | Tạo poll: câu hỏi + 2–10 options + settings (single/multi, anonymous, quiz, deadline). Poll gắn vào 1 message trong channel |
| CHT-UC-28 | Group member | Vote trong poll | Chọn option(s); thấy kết quả realtime. Anonymous: ẩn voter list truớc deadline/close. Quiz: reveal đáp án đúng sau close |
| CHT-UC-29 | Group member | Leave group | Rời khỏi group; lịch sử chat giữ (audit). Nếu là last admin → phải chuyển quyền trước |
| CHT-UC-30 | Group member | Mute group notifications | Toggle mute per channel; muted group không push/digest |
| CHT-UC-31 | Group member | Đặt custom nickname cho member khác | Nickname hiển thị cục bộ (viewer-local, chỉ mình thấy); không ảnh hưởng identity |
| CHT-UC-32 | Player/Host | Share session vào club chat / DM / group | Tap attach (+) → "Kèo" → picker hiện sessions actor có quyền xem → chọn → server snapshot BL-DSC-1 whitelist → message kèm rich session card (sport, title, time, area, price, slots). Optional text body kèm theo |
| CHT-UC-33 | Recipient | Tap session card trong chat | Public session: mở `/session/<slug>` (DD-73 landing). Same-tenant session: mở session detail trong CLB. Session không khả dụng: card hiện "Kèo không còn khả dụng" (stale snapshot) |

### Edge Cases

| # | Category | Case | Hành vi bắt buộc |
|---|----------|------|-------------------|
| 1 | Security | Member CLB A đọc chat CLB B | ❌ NEVER — RLS fail-closed; test bất biến cross-tenant |
| 2 | Security | Người thứ ba đọc DM 1-1 | ❌ NEVER — chỉ 2 person trong hội thoại (person-self) |
| 3 | Security | Resolve tenant/person từ nội dung message | ❌ NEVER — chỉ từ phiên đăng nhập + kênh |
| 4 | Security | Bridge chat ra Zalo/Messenger | ❌ NEVER phase-1 (CO-7) — chat chỉ sống trong Plexco |
| 5 | Abuse | Spam flood tin nhắn | Rate-limit per person+tenant; chặn/slow-mode |
| 6 | Concurrency | Double-send / retry (mất mạng) | Idempotent theo `client_msg_id` trong channel — 1 tin; concurrent retry không double-consume rate/audit |
| 7 | Data Integrity | Non-member cố gửi vào chat CLB | Eligibility fail — 403, không ghi |
| 8 | Abuse | DM giữa hai user không có quan hệ CLB | Phase-1 được phép **chỉ khi** safety gate DD-55 xanh; nếu gate/config chưa sẵn sàng → fail-closed, không tạo DM |
| 9 | Privacy | Tin chứa PII/số tiền người khác | Không có đường public; không đưa vào analytics/log thô |
| 10 | Resilience | SSE rớt kết nối | Reconnect + re-sync cursor; không mất/không trùng |
| 11 | Security | Tin đã bị moderator soft-hide vẫn hiển thị ở client cũ | Reproject tombstone; client hiển thị "đã ẩn" và không còn body/media |
| 12 | Data Integrity | Member `left` rồi quay lại | Re-grant quyền theo membership hiện hành; lịch sử liền mạch |
| 13 | Abuse | Sender/target đã block nhau hoặc sender vượt target-rate | Reject request/create/send/read tại boundary; không tiết lộ chi tiết block cho đối phương |
| 14 | Abuse | Report DM | Ghi reason/status/audit tối thiểu; abuse operator chỉ thấy artifact đúng policy, host/support tenant không đọc DM |
| 15 | Security | Upload giả MIME, malware, quá size/quota | Quarantine/reject; không tạo attachment `ready`, không phát signed URL |
| 16 | Data Integrity | Upload xong nhưng gửi message fail / object bị xoá | Orphan cleanup theo TTL; message chỉ tham chiếu attachment `ready`; deleted object hiển thị tombstone |
| 17 | Security | SQL/RPC `create_dm` bootstrap bỏ qua block/rate gate | ❌ NEVER — bootstrap gọi cùng canonical safety decision; safety subsystem thiếu/disabled thì fail-closed trước INSERT hoặc reuse |
| 18 | Privacy | `/pay` trong human DM bị lưu/gửi cho peer như tin nhắn | ❌ NEVER — registered requester-only slash bị reject khỏi normal send trước INSERT/NOTIFY; command và kết quả chỉ ở authenticated requester response |
| 19 | Security | Client gửi raw tenant ID khi chọn CLB cho `/pay` trong DM | Raw tenant không có authority; chỉ selector opaque ngắn hạn bind actor+DM+eligible tenant+command được consume |
| 20 | Privacy | Command result có ref để peer đoán/replay hoặc xuất hiện trong unread/history | ❌ NEVER — không result row/ref, SSE, outbox, push, shared persistence hay peer-visible unread |
| 21 | Privacy | Slash uppercase, alias, unknown hoặc có args fall through thành message | ❌ NEVER — private error/help; zero message/notify/unread mutation |
| 22 | Data Integrity | Reply cross-channel hoặc target đã tombstone | Reject trước mutation; reply cũ chỉ render target tombstone, không resurrect body/attachment |
| 23 | Security | Forged mention/reaction hoặc reaction ngoài set | Server resolve structured target; chỉ `👍|❤️|😂|😮|😢|🙏`; một active reaction/person/message |
| 24 | Privacy | Capability holder dùng moderation/mute để xem hoặc tác động human DM | ❌ NEVER — moderation capabilities là club-only; person-self DM boundary unchanged |
| 25 | Security | Moderator yêu cầu hard delete, sửa body, permanent ban hoặc target assistant/system | ❌ NEVER — generic deny, zero transcript disclosure/mutation |
| 26 | Data Integrity | Edit hết thời hạn/quá 5 lần hoặc cố đổi reply/mention/attachment | Reject trước mutation; DB time + expected revision; immutable fields không đổi |
| 27 | Privacy | Search trả tombstone/revision/slash/private bot result hoặc channel vừa mất quyền | ❌ NEVER — canonical current-row index + live authz re-check |
| 28 | Privacy | Digest gửi sau mark-read/block/leave/preference OFF/device epoch đổi | Cancel ngay trước provider write; unknown fail-closed, retry không duplicate |
| 29 | Security | Forward tin từ club A cho user không phải member club A | Tin forward chỉ chứa body/media snapshot + attribution (sender name, channel name); không grant access vào channel gốc. Recipient thấy nội dung nhưng không thể navigate về source channel nếu không có membership |
| 30 | Privacy | Forward tin DM riêng tư của người khác mà mình không tham gia | ❌ NEVER — chỉ forward được tin trong DM mà user là participant (person-self boundary). Tin đã tombstone/hidden không forward được |
| 31 | Security | Add user chưa follow actor vào group | ❌ REJECT — chỉ accepted follower (DD-47 `person_follows.status='accepted'`); UI ẩn user không follow trong picker |
| 32 | Security | Add user đã block actor (hoặc ngược lại) vào group | ❌ REJECT — block boundary (DD-55) chặn add; không tiết lộ lý do block |
| 33 | Data Integrity | Group đạt max 50 members | Reject add; hiển thị toast “Group đã đầy” (`GROUP_MAX_MEMBERS`) |
| 34 | Concurrency | 2 admin kick cùng member đồng thời | Idempotent — 1 remove event; concurrent retry không double-remove |
| 35 | Data Integrity | Pin message khi đã đủ 5 pinned | Reject; hiển thị toast “Đã đạt giới hạn tin ghim (5)” (`PIN_LIMIT_REACHED`) |
| 36 | Security | Member pin tin của người khác (không phải admin/creator) | ❌ REJECT — member chỉ pin tin của chính mình; creator/admin pin bất kỳ |
| 37 | Data Integrity | Poll expired nhưng chưa có ai vote | Hiển thị “Chưa có ai bình chọn”; poll đóng bình thường |
| 38 | Security | Vote sau deadline của poll | ❌ REJECT — poll đã đóng (`POLL_CLOSED`); UI disable nút vote |
| 39 | Data Integrity | Poll creator/admin close poll sớm | Kết quả freeze; quiz reveal đáp án đúng; không nhận vote mới |
| 40 | Concurrency | Nhiều vote đồng thời trong poll | Atomic per-voter; count consistent; single-choice enforce đúng 1 vote/person |
| 41 | Data Integrity | Last admin leave group | ❌ REJECT — phải chuyển quyền admin trước hoặc xoá group (`LAST_ADMIN_CANNOT_LEAVE`) |
| 42 | Privacy | Group global leak tenant data | ❌ NEVER — group global `tenant_id=NULL`, không truy cập dữ liệu CLB; RLS tách biệt |
| 43 | Security | Session card embed chứa exact venue / roster / PII / charge | ❌ NEVER — server snapshot chỉ BL-DSC-1 whitelist (DD-73). Client KHÔNG cung cấp snapshot; server resolve + snapshot tại send time |
| 44 | Security | User share session private/draft vào chat | Session picker chỉ hiện sessions mà actor có quyền xem. Private session chỉ hiện cho same-tenant member. Draft KHÔNG hiện |
| 45 | Data Integrity | Session bị cancel/private/closed sau khi card đã gửi | Card snapshot giữ nguyên trong history (đã gửi = đã gửi). Tap card → server re-check live: unavailable → generic "Kèo không còn khả dụng". KHÔNG tự xoá/ẩn message |
| 46 | Security | Client gửi forged embed_snapshot | ❌ REJECT — server KHÔNG nhận snapshot từ client. API nhận `embed_type` + `embed_ref_id`; server resolve + validate + snapshot tại insert time |
| 47 | Data Integrity | Embed ref trỏ tới session không tồn tại hoặc actor không có quyền xem | 422 `CHAT_EMBED_TARGET_NOT_FOUND` — generic, không tiết lộ session tồn tại hay không |
| 48 | Privacy | Session card trong DM leak tenant routing | Snapshot chỉ chứa public-safe fields (sport, title, time, area, price, host display name, club display name, slots). KHÔNG chứa `tenant_id`, internal routing, membership refs |

---

## 3. Screens & States

> Header entry 💬 (not bottom nav tab). Mobile-first 375px; desktop ≥1024 (split: channel list left + chat right).

### Channel list (CLB + DM + Group)

**Purpose:** Danh sách kênh chat: CLB channels + DM conversations, sorted by recency.

**Layout (mobile):**

```
┌──────────────────────────────────────┐
│ ← Home            💬 Hội thoại      │
├──────────────────────────────────────┤
│ [🔍 Tìm kiếm...]                    │
├──────────────────────────────────────┤
│                                      │
│ 🏸 CLB Cầu lông BT          2m ago  │
│   Anh T: Ai đi tối nay?        🔴3  │
│ ──────────────────────────────────── │
│ 👤 Minh Hoàng (DM)           5m ago  │
│   Bạn: OK, gặp lúc 7h          ✓✓  │
│ ──────────────────────────────────── │
│ ⚽ FC Thủ Đức                30m ago  │
│   System: Session T7 đã tạo         │
│ ──────────────────────────────────── │
│                                      │
└──────────────────────────────────────┘
```

**Component: Channel row:**

| Field | Data source | Ghi chú |
|-------|-------------|---------|
| Icon | Club sport icon (club) / Avatar (DM) | Kind-specific |
| Name | `chat_channels.name` (club) / person display_name (DM) | |
| Last message preview | `chat_messages` latest | Truncated, sender prefix |
| Unread badge | `chat_members.last_read_created_at` + `last_read_message_id` (0031) vs latest | 🔴 count |
| Timestamp | Relative (vừa xong / 2m / 5h / hôm qua) | |

**4 States:**

| State | Nội dung |
|-------|----------|
| Loading | Skeleton (5 channel row skeletons) |
| Ready | Channel list sorted by recency |
| Error | "Lỗi tải" toast + retry |
| Empty | Icon 💬 + "Chưa có hội thoại" + "Tham gia CLB để bắt đầu" |

### Club chat (full channel)

**Layout (mobile):**

```
┌──────────────────────────────────────┐
│ ← Hội thoại    🏸 CLB Cầu lông BT  │
├──────────────────────────────────────┤
│                                      │
│        [Tin nhắn cũ hơn ↑]          │
│                                      │
│  Anh T                     19:30    │
│  ┌──────────────────────────────┐   │
│  │ Ai đi cầu lông tối nay?    │   │  bubble left (other)
│  └──────────────────────────────┘   │
│                        👍1 ❤️2      │  reactions
│                                      │
│                            Bạn 19:32│
│  ┌──────────────────────────────┐   │
│  │ Mình đi!                    │   │  bubble right (self)
│  └──────────────────────────────┘   │
│                                      │
│  ── System ──────────────────────── │
│  📋 Session "Cầu lông T5" đã tạo   │  system message
│                                      │
├──────────────────────────────────────┤
│ [📎] [Soạn tin nhắn...        ] [→] │  composer
└──────────────────────────────────────┘
```

**Component: Message bubble:**

| Type | Hiển thị | Ghi chú |
|------|----------|---------|
| Text | Bubble + sender name + timestamp | Left (others) / Right (self) |
| System | Centered, muted style | Session events, moderation |
| Media | Thumbnail + tap to view | Upload progress, scan status |
| Edited | "(đã chỉnh sửa)" label | Bounded own edit |
| Deleted | "Tin nhắn đã bị xóa" tombstone | No hard-delete |
| Command result | Requester-only card (ephemeral) | `/pay`, `/sessions` |

**Component: Reactions:**

| Reaction | Set |
|----------|-----|
| Available | 👍 ❤️ 😂 😮 😢 🙏 |
| Rule | 1 active per person per message; tap to toggle/replace |

### DM (1-1)

**Layout:** Same as club chat nhưng:
- Header: Avatar + display_name (person)
- No system messages (session events)
- Safety: Block/report controls in ⋮ menu

**States:** Loading ("Đang tải...") | Ready (chat history + composer) | Error ("Lỗi gửi — thử lại") | Empty ("Bắt đầu trò chuyện")

### Command overlay (requester-only)

**Layout (ephemeral card — chỉ requester thấy):**

```
┌──────────────────────────────────────┐
│ 💰 /pay — Thanh toán                │
│                                      │
│ Kèo: 🏸 Cầu lông T5 · 10/08       │
│ Phí:       75,000₫                  │
│ Đã trả:    0₫                       │
│ Còn lại:   75,000₫                  │
│                                      │
│ [Đã thanh toán? Host sẽ xác nhận]   │
│                              [Đóng] │
└──────────────────────────────────────┘
```

> Nếu nhiều CLB eligible → club picker (opaque, chỉ requester thấy).

### Search trong Chat

**Layout:**

```
┌──────────────────────────────────────┐
│ 🔍 [tìm kiếm tin nhắn...       ] ✕ │
├──────────────────────────────────────┤
│ Kết quả (3)                          │
│                                      │
│ 🏸 CLB Cầu lông BT · Anh T · 19:30│
│   "Ai đi cầu lông tối nay?"        │
│                                      │
│ 👤 Minh Hoàng · 18:00              │
│   "cầu lông không?"                 │
│                                      │
└──────────────────────────────────────┘
```

**States:** Loading ("Đang tìm...") | Ready (results + channel context) | Error (generic retry) | Empty ("Không tìm thấy")

### Create Group

**Purpose:** Wizard tạo group chat mới (global hoặc tenant-scoped).

**Layout (mobile):**

```
┌──────────────────────────────────────┐
│ ← Hủy            Tạo nhóm   [Tạo] │
├──────────────────────────────────────┤
│       [📷 Avatar]                     │  tap to upload
│ [Tên nhóm...                       ] │
├──────────────────────────────────────┤
│ Scope:  ● Bạn bè (global)            │
│         ○ Trong CLB [chọn CLB ▼]     │
├──────────────────────────────────────┤
│ Thêm thành viên (chỉ follower)      │
│ [🔍 Tìm kiếm...]                    │
│                                      │
│ ☑ 👤 Minh Hoàng                      │
│ ☑ 👤 Anh T                           │
│ □ 👤 Chị Linh                        │
│                                      │
└──────────────────────────────────────┘
```

> Member picker chỉ hiện người đã follow actor (DD-47). User đã block/bị block không hiện. Tối thiểu 2 members (để có ≥3 cùng creator).

**States:** Loading (Đang tải...) | Ready (form + member picker) | Error (generic retry) | Empty ("Chưa có ai follow bạn")

### Group Chat

**Layout (mobile):**

```
┌──────────────────────────────────────┐
│ ← Hội thoại  👥 Nhóm Cầu lông  (5) ⓘ │  tap ⓘ → Group Info
├──────────────────────────────────────┤
│ 📌 2 tin được ghim          [Xem ▶] │  pinned bar → Pinned Messages
├──────────────────────────────────────┤
│                                      │
│  Anh T                     19:30    │
│  ┌──────────────────────────────┐   │
│  │ Ai đi cầu lông tối nay?    │   │
│  └──────────────────────────────┘   │
│                                      │
│  ── System ────────────────────── │
│  Minh Hoàng đã tham gia nhóm        │  system message
│                                      │
│  ┌──────── POLL ──────────────┐   │
│  │ 📊 Đi cầu lông lúc mấy?      │   │  poll card inline
│  │  ○ 17h    (2 votes)          │   │
│  │  ● 18h    (3 votes) ████    │   │
│  │  ○ 19h    (1 vote)           │   │
│  │  5/5 đã bình chọn            │   │
│  └──────────────────────────────┘   │
│                                      │
├──────────────────────────────────────┤
│ [📎] [📊] [Soạn tin nhắn...  ] [→] │  composer + poll button
└──────────────────────────────────────┘
```

**Component: Pinned bar** (chỉ hiện khi có pinned messages):
- Số tin ghim + preview tin mới nhất
- Tap “Xem” → mở Pinned Messages panel

**Component: Poll card** (inline trong chat):

| Field | Data source | Ghi chú |
|-------|-------------|---------|
| Question | `chat_polls.question` | Bold header |
| Options | `chat_poll_options` | Radio (single) hoặc checkbox (multi) |
| Vote count | `chat_poll_votes` aggregate | Realtime update |
| Progress bar | Derived từ vote counts | Highlight winner |
| Status | `deadline_at` / `closed_at` | “Đang mở” / “Đã đóng” / countdown |
| Anonymous badge | `chat_polls.is_anonymous` | 👻 “Bình chọn ẩn danh” |
| Quiz badge | `chat_polls.is_quiz` | 🎯 “Chế độ quiz” |

**States:** Loading ("Đang tải...") | Ready (history + composer + pinned bar + poll cards + realtime) | Error ("Đã mất kết nối" + retry) | Empty ("Chưa có tin nhắn")

### Group Info

**Purpose:** Xem/quản lý thông tin nhóm, thành viên, cài đặt.

**Layout (mobile):**

```
┌──────────────────────────────────────┐
│ ← Quay lại       Thông tin nhóm     │
├──────────────────────────────────────┤
│       [📷 Avatar]                     │  admin: tap to change
│     Nhóm Cầu lông [✏️]                │  admin: tap to rename
├──────────────────────────────────────┤
│ Thành viên (5/50)           [➕ Thêm] │  admin: add button
│                                      │
│ 👑 Minh Hoàng (Admin)        [⋮]     │  crown = admin
│ 👤 Anh T                    [⋮]     │  ⋮: set admin/kick
│ 👤 Chị Linh                 [⋮]     │
│ 👤 Phong                    [⋮]     │
│ 👤 Khánh (bạn)               [⋮]     │  nickname shown
├──────────────────────────────────────┤
│ 🔔 Tắt thông báo         [toggle]    │
│ 👤 Biệt danh              [▶]       │  custom nickname
│ 🛡️ Tin ghim (2)            [▶]       │  → Pinned Messages
├──────────────────────────────────────┤
│ 🚪 Rời nhóm                           │  danger zone
└──────────────────────────────────────┘
```

**States:** Loading ("Đang tải...") | Ready (group info + member list + settings) | Error (generic retry) | Empty — N/A

### Pinned Messages

**Purpose:** Panel hiển thị danh sách tin được ghim (tối đa 5).

**Layout (bottom sheet / slide-up):**

```
┌──────────────────────────────────────┐
│ 📌 Tin được ghim (2)            [✕] │
├──────────────────────────────────────┤
│ Anh T · 19:30                        │
│ “Lịch tập cầu lông: T3-T5-T7”      │  tap → jump to msg
│                        [📌 Bỏ ghim] │  admin/owner
│ ────────────────────────────────── │
│ Bạn · 18:00                          │
│ “Quy tắc nhóm: đúng giờ...”          │
│                        [📌 Bỏ ghim] │
└──────────────────────────────────────┘
```

**States:** Loading ("Đang tải...") | Ready (pinned list, tap to jump) | Error (generic retry) | Empty ("Chưa có tin ghim")

### Create Poll

**Purpose:** Form tạo poll/bình chọn mới.

**Layout (bottom sheet / full page):**

```
┌──────────────────────────────────────┐
│ ← Hủy          Tạo bình chọn  [Gửi] │
├──────────────────────────────────────┤
│ Câu hỏi:                             │
│ [Đi cầu lông lúc mấy?            ] │
├──────────────────────────────────────┤
│ Lựa chọn:                            │
│ 1. [17h                            ] │
│ 2. [18h                            ] │
│ 3. [19h                            ] │
│ [➕ Thêm lựa chọn]                    │  max 10
├──────────────────────────────────────┤
│ Cài đặt:                              │
│ Chọn nhiều đáp án     [□]           │
│ Bình chọn ẩn danh     [□]           │
│ Chế độ quiz          [□]           │
│   Đáp án đúng: [— chọn — ▼]        │  show if quiz ON
│ Cho phép thêm option  [□]           │
│ Thời hạn:  [— không — ▼]          │  1h/6h/12h/24h/3d/7d
└──────────────────────────────────────┘
```

**States:** Loading — N/A (form) | Ready (form ready) | Error (validation errors inline) | Empty — N/A

### Poll Results

**Purpose:** Chi tiết kết quả poll (tap từ poll card inline).

**Layout (bottom sheet):**

```
┌──────────────────────────────────────┐
│ 📊 Kết quả bình chọn          [✕] │
├──────────────────────────────────────┤
│ Đi cầu lông lúc mấy?                │
│ 5 người đã bình chọn                │
│                                      │
│ 17h  ████████████        40%  (2) │
│   👤 Anh T, 👤 Chị Linh               │  voter list (non-anon)
│ 18h  █████████████████  60%  (3) │  ★ winner
│   👤 Bạn, 👤 Phong, 👤 Khánh           │
│ 19h  ██████                 20%  (1) │
│   👤 Minh Hoàng                       │
│                                      │
│ 🎯 Quiz: đáp án đúng là "18h" ✅     │  quiz reveal (post-close)
└──────────────────────────────────────┘
```

> Anonymous poll: ẩn voter list, chỉ hiện count + %. Quiz mode: reveal đáp án đúng sau khi poll đóng.

**States:** Loading ("Đang tải...") | Ready (results + voter list) | Error (generic retry) | Empty ("Chưa có ai bình chọn")

### Session Card Embed (trong message bubble)

**Trigger:** Message có `embed_type='session'`

```
┌──────────────────────────────────────┐
│ 📎 Kèo badminton                     │  message body (optional)
│ ┌──────────────────────────────────┐ │
│ │ ┌──────────────┐ ┌─────────────┐ │ │
│ │ │ 17:00 – 19:00 │ │ 150.000₫/Ng│ │ │  time pill + price pill
│ │ └──────────────┘ └─────────────┘ │ │
│ │                                  │ │
│ │ [👤] · 4/6 Going                 │ │  host avatar + going count
│ │                                  │ │
│ │ 🏸 Kèo chiều thứ 5               │ │  sport icon + title
│ │ 🏢 CLB Cầu Lông Q7              │ │  club display name
│ │ 👤 Host: Minh Hoàng              │ │  host display name
│ │ 📍 Quận 7                       │ │  area (DD-06, KHÔNG exact venue)
│ │                                  │ │
│ │ [Xem kèo →]                     │ │  CTA → session detail/landing
│ └──────────────────────────────────┘ │
│                           17:30 ✓✓  │  timestamp + read receipt
└──────────────────────────────────────┘
```

**Embed snapshot fields (unified `SessionCard` variant `embed`):**

| Field | In snapshot? | Ghi chú |
|-------|:---:|---------|
| Session cover | ✅ | `cover_image_url` (optional, moderated). Fallback: sport gradient |
| Time pill | ✅ | `starts_at` + `ends_at` → `HH:mm – HH:mm` |
| Price pill | ✅ | `price_amount` → VND + "/Ng" |
| Urgency badge | ✅ | "Chỉ N chỗ!" khi `slots_open ≤ 3`. Snapshot tại send time |
| Sport icon + title | ✅ | `sport_key` + session title |
| Club display name | ✅ | Moderated |
| Area | ✅ | Coarse — DD-06 KHÔNG exact venue |
| Skill level | ✅ | Range format: "Người mới – Trung bình". Green chip |
| CTA | ✅ | "Xem kèo →" → session detail/landing |

**States:**
- **Card available:** Full card với CTA. Public session → `/session/<slug>` (DD-73 landing). Same-tenant → session detail.
- **Card unavailable (tap):** "Kèo này không còn khả dụng" toast. Card snapshot giữ nguyên (history record).
- **Card stale:** Snapshot data tại send time có thể stale (price/slots thay đổi). Tap CTA luôn fetch live.

### Session Picker (Overlay khi share session)

**Trigger:** Tap attach (+) → "Kèo" icon

```
┌──────────────────────────────────────┐
│ ← Chọn kèo để chia sẻ              │
│ ┌──────────────────────────────────┐ │
│ │ 🔍 Tìm kèo...                   │ │  search filter
│ └──────────────────────────────────┘ │
│                                      │
│ 📋 Kèo của bạn                      │  section: sessions actor là player/host
│ ┌──────────────────────────────────┐ │
│ │ 🏸 Kèo chiều thứ 5              │ │
│ │    T5, 17:00 · Q7 · 4/6         │ │
│ └──────────────────────────────────┘ │
│ ┌──────────────────────────────────┐ │
│ │ ⚽ Kèo sáng CN                   │ │
│ │    CN, 07:00 · Q2 · 8/10        │ │
│ └──────────────────────────────────┘ │
│                                      │
│ 🌐 Kèo public                       │  section: marketplace public sessions
│ ┌──────────────────────────────────┐ │
│ │ 🎾 Tennis doubles                │ │
│ │    T7, 15:00 · Thủ Đức · 2/4    │ │
│ └──────────────────────────────────┘ │
└──────────────────────────────────────┘
```

**States:** Loading ("Đang tải kèo...") | Ready (sessions list) | Error (generic retry) | Empty ("Chưa có kèo nào")

### Data source mapping

| Component | Data source | Ghi chú |
|-----------|-------------|---------|
| Channel list | `chat_channels` + `chat_members` | club/dm split (group: deferred, chưa có schema — DD-136), sorted recency |
| Messages | `chat_messages` + search vector + embed columns | Paginated, realtime SSE |
| Unread count | `chat_members.last_read_created_at` + `last_read_message_id` (0031) | Per-channel per-person |
| Reactions | `chat_message_reactions` | Closed set, 1/person/message |
| Command results | Canonical services (`getSelfPaymentStatus`) | Requester-only ephemeral |
| Safety | `chat_blocks` (DD-55) | Block/report/mute |
| Pinned messages | `chat_pinned_messages` | Max 5/channel; sorted by pinned_at |
| Polls | `chat_polls` + `chat_poll_options` + `chat_poll_votes` | 1:1 with message; realtime count |
| Member nicknames | `chat_member_nicknames` | Viewer-local; chỉ mình thấy |
| Follow status | `person_follows` (DD-47) | Guard cho add member vào group |
| Session embed | `chat_messages.embed_snapshot` (JSONB) | Server-rendered snapshot tại send; tap CTA fetch live |
| Session picker | `sessions` (actor's visible) + `public_sessions` | Filtered by actor visibility |

### State coverage matrix

| Screen | Loading | Ready | Error | Empty |
|--------|---------|-------|-------|-------|
| Channel list | ✅ Skeleton rows | ✅ Sorted + badges | ✅ Toast + retry | ✅ "Chưa có hội thoại" |
| Club chat | ✅ "Đang tải..." | ✅ History + composer + realtime | ✅ "Mất kết nối" + retry | ✅ "Chưa có tin nhắn" |
| DM 1-1 | ✅ "Đang tải..." | ✅ History + composer | ✅ "Lỗi gửi" + retry | ✅ "Bắt đầu trò chuyện" |
| Group chat | ✅ "Đang tải..." | ✅ History + composer + pinned bar + poll cards | ✅ "Đã mất kết nối" + retry | ✅ "Chưa có tin nhắn" |
| Create Group | ✅ "Đang tải..." | ✅ Form + member picker | ✅ Generic retry | ✅ "Chưa có ai follow" |
| Group Info | ✅ "Đang tải..." | ✅ Info + member list + settings | ✅ Generic retry | ⚪ N/A |
| Pinned Messages | ✅ "Đang tải..." | ✅ Pinned list (tap to jump) | ✅ Generic retry | ✅ "Chưa có tin ghim" |
| Create Poll | — | ✅ Form ready | ✅ Validation inline | ⚪ N/A |
| Poll Results | ✅ "Đang tải..." | ✅ Results + voter list | ✅ Generic retry | ✅ "Chưa có ai bình chọn" |
| Command overlay | ✅ "Đang kiểm tra..." | ✅ Requester-only card | ✅ Generic retry | ✅ "Không có CLB eligible" |
| Reactions | — | ✅ Closed set controls | ✅ Private deny | ⚪ N/A |
| Search | ✅ "Đang tìm..." | ✅ Results + context | ✅ Generic retry | ✅ "Không tìm thấy" |
| Media viewer | ✅ Upload/scan progress | ✅ Preview + download | ✅ Quarantined tombstone | ✅ "Chọn ảnh/file" |
| Safety actions | — | ✅ Block/report + confirm | ✅ Generic retry | ⚪ N/A |
| Kiểm duyệt | — | ✅ Hide/mute + reason | ✅ Private error | ⚪ N/A |
| Session card embed | — | ✅ Rich card + CTA | ✅ "Kèo không còn khả dụng" | ⚪ N/A |
| Session picker | ✅ "Đang tải kèo..." | ✅ Session list (own + public) | ✅ Generic retry | ✅ "Chưa có kèo" |

---

## 4. Domain Model

> **Target contract Reviewed; runtime chưa có.** Nguồn AUTHORITATIVE khi triển khai: `../../standards/decisions.md` DD-38/DD-86 + companion BE spec + `packages/db/schema.ts` + migration. **Dùng chung** bộ bảng `chat_*` với trợ lý (DD-19/DD-20) — KHÔNG tạo bảng song song.

| Entity (target) | Plane | Vai trò | Key constraints |
|--------|-------|---------|-----------------|
| `chat_channels` | `club`: Tenant-private · `dm`: **Person-self (global)** · `group`: **Membership-gated** (global hoặc tenant) | Kênh chat | `kind ∈ {club, dm, group}` (schema `0031` hiện chỉ CHECK `('club','dm')`; `group` chưa có schema và nằm ngoài MVP build theo DD-136 — giữ như contract bị hoãn); N active club channel/tenant với club-only metadata + creator identity và đúng một active default; **dm** → `tenant_id` và toàn bộ club-only metadata/creator fields **NULL**, `dm_key='least:greatest'` 2 person UNIQUE; **group** → `tenant_id` NULL (global) hoặc NOT NULL (tenant-scoped), `title` NOT NULL, `dm_key` NULL, `max_members` default 50, `group_avatar_url` optional, `created_by_person_id` NOT NULL |
| `chat_members` | theo channel (`club` tenant-private / `dm` person-self / `group` membership-gated) | Thành viên kênh | **club**: `tenant_id`+`membership_id` NOT NULL, `UNIQUE(tenant, channel, membership)`; **dm**: `tenant_id`/`membership_id` NULL, đúng 2 person theo `dm_key`; **group**: `role ∈ {admin, member}`, `tenant_id` match channel, 3–50 members |
| `chat_messages` | theo channel (`club` tenant-private / `dm` person-self) | Canonical current message | Author shape + `client_msg_id`; same-channel reply; bounded own edit; author/moderation tombstone; generated current-content search vector; no hard-delete. **Structured embed:** optional `embed_type ∈ {session}` + `embed_ref_id` + server-rendered `embed_snapshot` (JSONB, BL-DSC-1 whitelist). Body có thể rỗng khi có embed. Client KHÔNG cung cấp snapshot |
| `chat_message_mentions` | theo message/channel | Structured mention | Target kind/ref + safe render snapshot; target/server authorization before insert |
| `chat_message_reactions` | theo message/channel | Closed reactions | Một row tối đa per `(message,person)`, value ∈ `👍|❤️|😂|😮|😢|🙏`; atomic replace/remove/idempotent |
| `chat_message_revisions` | Restricted audit | Prior body của own-edit | Tối đa 5 revisions; không query qua normal history/search; author/channel/reply/mention/attachment bất biến |
| `chat_moderation_audit` / `chat_channel_mutes` | Tenant-private, club-only | Moderation evidence + timed posting restriction | Soft-hide/restore + timed mute; exact capabilities/receipts; reason + immutable audit; DB-owned expiry; never grants DM read |
| `chat_attachments` (proposal) | Private, channel-authorized | Metadata + storage/scan/deletion state | Owner + object key; `pending_scan → ready | rejected | quarantined | deleted`; message chỉ attach `ready`; no raw signed URL persisted |
| `chat_blocks` / `chat_reports` (DD-55 canonical contract; schema pending) | Person-self / abuse-control | Open-DM safety gate | Deterministic actor-target block; report reason/status + immutable audit; không làm DM readable cho host/support |
| `chat_pinned_messages` | theo channel (club/dm/group) | Tin được ghim | Tối đa **5 pinned/channel**; `PK(channel_id, message_id)`; `pinned_by_person_id` + `pinned_at`; creator/admin pin bất kỳ, member pin tin của mình |
| `chat_polls` | theo channel (club/dm/group) | Bình chọn/Poll | 1:1 với message; `question` max 1000 bytes; `is_multiple_choice`, `is_anonymous`, `is_quiz`, `allow_add_options`; `deadline_at` optional; `closed_at` set khi creator/admin đóng hoặc hết deadline |
| `chat_poll_options` | theo poll | Lựa chọn poll | 2–10 options; `option_text` max 500 bytes; `added_by_person_id`; `sort_order` unique per poll |
| `chat_poll_votes` | theo poll + option | Phiếu bầu | `PK(poll_id, option_id, person_id)`; single-choice: trigger enforce max 1 vote/person; multi-choice: cho nhiều options |
| `chat_member_nicknames` | theo channel (viewer-local) | Biệt danh cục bộ | `PK(channel_id, viewer_person_id, target_person_id)`; max 100 bytes; chỉ viewer thấy, không ảnh hưởng identity |

- **RLS:** `club` channel → thêm `chat_*` vào RLS list (ENABLE + FORCE theo `app.tenant_id`). `dm` (`tenant_id` NULL) **không** qua tenant-RLS mà gate **person-self** (chỉ 2 person trong `dm_key`) — khớp `../BE/feature_inapp_chat_tech.md`. Migration RLS list tương lai.
- **Realtime:** SSE + `LISTEN/NOTIFY` theo tenant/person (DD-07) — cùng cơ chế sync engine.
- **Read state:** `chat_members.last_read_created_at` + `last_read_message_id` (0031) vẫn là Chat authority cho history/reconnect/unread/badge. DD-94 Notification chỉ giữ opaque coalesced `highest_unread_cursor` signal; không durable notification item per source message hoặc content snapshot.
- **Không** entity nào thuộc public plane.

---

## 5. Analytics Events

| Event | Khi nào | Payload tối thiểu (no PII) |
|-------|---------|-------------------|
| `chat_channel_opened` | Member mở kênh | `tenant_id`, `kind` (club/dm/group) |
| `chat_message_sent` | Gửi tin thành công | `tenant_id`, `kind`, `len_bucket` |
| `chat_message_moderated` | Authorized actor hide/restore/mute | `tenant_id`, `action`, `reason_code` — never `reason_detail` |
| `chat_rate_limited` | Bị chặn spam | `tenant_id`, `person_id` (opaque) |
| `chat_realtime_reconnect` | SSE reconnect | `tenant_id` |
| `chat_media_outcome` | Scan/upload lifecycle completes | `kind`, `size_bucket`, `outcome_class` — no object key/content |
| `chat_block_or_report` | Safety action | `action`, opaque actor/target ids, `reason_code` only |
| `chat_group_created` | Tạo group chat mới | `scope` (global/tenant), `initial_member_count` |
| `chat_group_member_added` | Add member vào group | `channel_kind`, `added_via` (direct) |
| `chat_group_member_kicked` | Kick member khỏi group | `channel_kind`, `actor_role` (admin) |
| `chat_group_member_left` | Member tự leave group | `channel_kind` |
| `chat_message_pinned` | Pin tin nhắn | `channel_kind`, `pin_count_after` |
| `chat_message_unpinned` | Unpin tin nhắn | `channel_kind`, `pin_count_after` |
| `chat_poll_created` | Tạo poll mới | `option_count`, `has_deadline`, `is_anonymous`, `is_quiz` |
| `chat_poll_voted` | Vote trong poll | `poll_id_opaque`, `is_change` (true nếu đổi vote) |
| `chat_poll_closed` | Đóng poll (sớm hoặc hết hạn) | `total_votes`, `close_reason` (manual/deadline) |
| `chat_session_embed_sent` | Share session card vào chat | `channel_kind`, `embed_type`, `session_visibility` (public/same-tenant) |
| `chat_session_embed_tapped` | Tap CTA trên session card embed | `channel_kind`, `embed_type`, `outcome` (opened/unavailable) |

> KHÔNG log nội dung tin nhắn, tên, số tiền, raw platform ID trong analytics.

---

## 6. Acceptance Criteria

- [ ] Chat toàn CLB cô lập cross-tenant (RLS fail-closed) — test A≠B pass.
- [ ] DM 1-1 chỉ 2 người đọc được — person-self test pass.
- [ ] Không bridge ra Zalo/Messenger; chat không xuất hiện ở kênh ngoài (CO-7).
- [ ] Tenant/person resolve từ phiên đăng nhập, không từ nội dung.
- [ ] Gửi tin idempotent theo `client_msg_id`; runtime app không có direct INSERT, mọi user send qua guarded RPC cố định actor server-side.
- [ ] Rate-limit/anti-spam hoạt động theo person+tenant.
- [ ] Tin/PII/tiền không lộ ra public; không vào analytics thô.
- [ ] Dùng chung `chat_*` với trợ lý (DD-19/DD-20) — không model song song.
- [ ] Reconnect/re-sync không mất/không trùng tin.
- [ ] Open DM remains OFF until block/report/per-sender+per-target limits/abuse audit pass through one canonical decision; blocked pair cannot request/create/bootstrap/send/read through any HTTP/RPC/SQL path.
- [ ] `create_dm` under real `app` role calls the safety primitive before create/reuse; disabling any safety capability or blocking either direction yields generic denial and no channel/member mutation.
- [ ] Block/unblock/report nhận actor-scoped UUID command key + canonical fingerprint: exact replay trả prior result, same key/different fingerprint reject trước mutation; concurrent report tạo đúng một append-only report/audit effect.
- [ ] DM history/list/mark-read/SSE re-authorize canonical block+safety state; active stream closes by event/heartbeat ≤30s after block or authz loss.
- [ ] Host/support/tenant admin cannot read DM, including after a report.
- [ ] Media E2E passes private upload, MIME sniff, size/quota, malware scan, moderation, ready-only attach, signed read authz, delete/tombstone and orphan cleanup.
- [ ] `/pay` chạy requester-only ở **club channel**, **private Club Bot** và **human DM overlay**; mọi surface đều classifier-intercept trước normal insert và tạo zero `chat_messages`/NOTIFY/unread mutation.
- [ ] DM `tenant_id=NULL`: one eligible club auto-select; many trả picker requester-only; none trả generic empty. Raw tenant input bị reject; selector opaque hết hạn hoặc sai actor/DM/command bị reject.
- [ ] Command response là authenticated synchronous HTTP với `Cache-Control: private, no-store`; không có result ref/row, SSE, outbox, push, shared history/notification. Peer quan sát byte-for-byte không có command/result/event/unread mới.
- [ ] Text không TTL/auto-delete/hard-purge. Moderator soft-hide chỉ tạo tombstone + restricted immutable audit. Mọi destructive cleanup/hard-delete route/job giữ OFF.
- [ ] Một tenant có N active club channels nhưng **đúng một active default**; create/set-default/archive serialize dưới tenant lock.
- [ ] Không archive default nếu không có replacement trong cùng transaction; partial unique index chỉ chứng minh at-most-one, lifecycle chứng minh exactly-one.
- [ ] Tạo channel hoặc activate membership auto-provision đủ membership × active-channel atomically, retry-safe; lỗi giữa chừng rollback toàn bộ.
- [ ] DD-86 channel lifecycle chỉ dùng `chat.channel.manage`; `admins_only` post dùng `chat.channel.post_restricted` ngay tại shared-message core. `all_members` vẫn cần active channel membership; unknown/typo/registry-unavailable deny và `chat_members.role` không là tenant authority.
- [ ] DM rejects/non-persists `title`/`sort_order`/`post_policy`, creator membership/person/tenant và default/assistant flags.
- [ ] Server derive `assistant_enabled=true` cho `all_members`, `false` cho `admins_only`; chỉ exact `chat.channel.manage` được đổi flag trên cả hai policy. Ingress/projector require channel flag **AND** tenant config/exact `assistant_ai_kb` entitlement/cap/provider/privacy gates; false/unknown ở bất kỳ gate nào tạo zero query/provider/message.
- [ ] Create/rename/set-default/archive dùng actor-scoped UUID idempotency key + request fingerprint: exact replay trả receipt cũ, payload mismatch fail-closed.
- [ ] Reply send re-authorizes same-channel target and rejects an already tombstoned target. Existing reply never resurrects later-tombstoned content/media. Mention target refs + render snapshot remain immutable.
- [ ] Reaction accepts exactly `👍|❤️|😂|😮|😢|🙏`; one active value/person/message, atomic replace/remove và same-state/remove-absent retry returns current state without duplicate.
- [ ] Structured `@ClubBot` mention trong authorized club channel chỉ tạo Assistant response khi channel flag + mọi tenant/`assistant_ai_kb`/provider/privacy gate đều true; response KB-grounded/cited hoặc `no_answer`. Default false của `admins_only` không phải immutable prohibition: chỉ exact manage mutation + all-gates true mới bật được. Debt status không đi LLM.
- [ ] Original human author edit body theo DB time `<15m`, tối đa 5; expected revision chống race; prior body restricted-audit. Author/channel/reply/attachments/mentions bất biến; assistant/system edit bị deny.
- [ ] Author soft-delete bất cứ lúc nào là irreversible với author và render shared tombstone; hard delete/body resurrection không tồn tại. Moderator restore không hồi sinh author-deleted message.
- [ ] Search API/index phải land trước beta: generated PostgreSQL `simple` tsvector trên canonical current rows, current-readable channel filter + live authz; tombstone/revision/requester slash/private bot result bị loại.
- [ ] Slash registry ASCII case-insensitive, zero aliases/args: `/help|/pay|/me|/myclubs|/discover|/name` ở club/bot/human-DM overlay; `/sessions|/waitlist` chỉ club/bot. Unknown/extra-arg/unsupported surface trả private typed error/help trước insert.
- [ ] Soft-hide/restore chỉ target human-authored club message; timed mute `1h|24h|7d` dùng DB-owned expiry và chặn write không chặn read. Exact capability, actor-scoped receipt/fingerprint, required `spam|harassment|unsafe|off_topic|other` reason, bounded note cho `other` và một immutable actor/reason/before-after/timestamp audit effect là bắt buộc.
- [ ] DM, assistant/system, hard delete, content edit, permanent ban và system-message side effects đều generic deny.
- [ ] DD-94 digest giữ Chat là read-state owner; DM/direct mention/reply default ON, club `all|mentions|off` default `mentions`; coalesce `(person,channel,highest_unread_cursor)`, mark-read cancels obsolete pending và live reauth trước provider write. Zero durable item/message snapshot/body/title/amount; timing config thiếu/chưa test thì delivery OFF.
- [ ] Colliding DB lane 1→2→3→4 chạy **serialized**; sau đó actual dependency 5→9→6→7→8 theo table của primary plan. Capability semantics độc lập không cho phép chạy song song khi còn cùng migration tail, `packages/db/schema.ts`, DB catalog tests hoặc schema/authz invariants.
- [ ] DD-56 authority ở slice 4 dùng một closed registry + fail-closed authorization và append-only grant audit; không tạo Chat-local role registry, global grant hoặc nhét grant UI vào chat core.
- [ ] Safe member-target core ở slice 9 chỉ trả current-channel active human member với short-lived requester+channel-bound opaque ref + safe label; wrong actor/channel/expired ref generic-deny và mọi structured mention, mute, start-DM re-authorize khi consume. Không global/fuzzy search, raw UUID, persistent directory, contact, gender hoặc debt data.
- [ ] A1–A13 chỉ sở hữu HTTP auth/session/action authz, validation, privacy/cache headers, DTO và route tests; F1–F10 chỉ mở sau F0 và dùng API thật. Không adapter/component nào re-derive canonical mechanism state.
- [ ] Reviewed contract không là runtime proof: trước immutable authority re-pin và strict per-slice `CODE_READY`, không migration/route/worker/FE nào được coi là authorized hoặc implemented.
- [ ] **Group chat** (deferred, ngoài MVP build theo DD-136; chưa có schema `group` ở 0031) tạo được cả global (`tenant_id=NULL`) và tenant-scoped (`tenant_id NOT NULL`); kind='group' nằm trong `chat_channels` chính.
- [ ] **Follow-guard:** add member vào group chỉ thành công khi target đã follow actor (DD-47 `person_follows.status='accepted'`); user chưa follow không hiện trong picker; block boundary (DD-55) cũng chặn add.
- [ ] **Max 50 members/group** — add khi đầy reject `GROUP_MAX_MEMBERS`; concurrent add serialize dưới channel lock.
- [ ] **Group admin:** creator tự động là admin đầu; admin đặt/bỏ admin khác, kick member, rename, đổi avatar; last admin không được leave (`LAST_ADMIN_CANNOT_LEAVE`).
- [ ] **Group settings:** mute group notifications (toggle per channel); leave group (với guard last-admin); custom nickname viewer-local không ảnh hưởng identity.
- [ ] **Multi-pin:** tối đa **5 pinned messages/channel** (áp cho cả group, club, DM). Creator/admin pin bất kỳ tin; member chỉ pin tin của mình. Pin #6 reject `PIN_LIMIT_REACHED`.
- [ ] **Pin authorization:** member unpin chỉ tin mình đã pin; creator/admin unpin bất kỳ. Unpin tin người khác bởi member thường reject `PIN_NOT_AUTHORIZED`.
- [ ] **Poll/Vote tạo được:** câu hỏi + 2–10 options; settings: single/multi choice, anonymous, quiz, deadline, allow add options. Poll gắn 1:1 với message.
- [ ] **Poll vote:** single-choice enforce max 1 vote/person; multi-choice cho nhiều. Vote sau deadline/close reject `POLL_CLOSED`. Anonymous ẩn voter list trước close. Quiz reveal đáp án đúng sau close.
- [ ] **Poll close:** creator/admin đóng sớm hoặc deadline auto-close; kết quả freeze; không nhận vote mới.
- [ ] **Group global không leak tenant data** — `tenant_id=NULL`, RLS tách biệt; không truy cập dữ liệu CLB.
- [ ] **Group tenant-scoped** — member phải có active membership trong CLB tương ứng; RLS tenant-private + membership check.
- [ ] **System messages** cho group events: member join/leave/kick, admin đặt/bỏ, rename, đổi avatar, pin/unpin, poll created/closed.
- [ ] **Kick member** idempotent; kicked user không gửi/nhận tin nữa; system message thông báo.
- [ ] **Session card embed:** send message với `embed_type='session'` + `embed_ref_id` → server resolve + validate visibility + snapshot BL-DSC-1 whitelist fields → message chứa rich card.
- [ ] **Session picker:** attach (+) → "Kèo" → hiện sessions actor có quyền xem (own sessions + public marketplace). Private/draft sessions **KHÔNG** hiện.
- [ ] **Embed snapshot server-side only:** client KHÔNG cung cấp `embed_snapshot`; server resolve tại insert time. Forged snapshot bị reject.
- [ ] **Embed whitelist:** snapshot chỉ chứa `sport_key`, `title`, `starts_at`, `ends_at`, `area`, `price_amount`, `slots_open`, `club_display_name`, `join_policy`, `session_type`, `public_listing_id` (BL-DSC-1 whitelist, DD-133; không `confirmed_count`, không `host_display_name`). KHÔNG venue/roster/PII/charge/debt.
- [ ] **Tap CTA:** public session → `/session/<slug>` (DD-73 landing). Same-tenant → session detail. Session unavailable → generic "Kèo không còn khả dụng" toast.
- [ ] **Stale card:** snapshot data tại send time. Card KHÔNG tự update; tap CTA luôn fetch live status. Message/card KHÔNG bị xoá/ẩn khi session cancel.
- [ ] **Body + embed:** message có thể có body text + embed, hoặc chỉ embed (body rỗng). Cả hai idempotent theo `client_msg_id`.

---

## 7. Open Questions / Changelog

### Open Questions (→ decisions.md)

| ID | Quyết định | Trạng thái |
|---|---|---|
| DD-38 | Chat cơ bản in-app phase-1 (toàn CLB + 1-1, chỉ Plexco, không bridge) | ✅ Chốt |
| CHT-OQ-1 | Chính sách cho phép DM | ✅ **Chốt DD-55 (2026-07-16)** — **phase-1: open DM** nhưng hard-gated bởi block + report + per-sender/per-target rate-limit + abuse audit; thiếu một gate thì DM OFF. **Phase-2:** chỉ follower accepted (DD-47) DM direct, còn lại vào request box. Host/support/tenant admin KHÔNG đọc DM (person-scoped, tenant NULL) |
| CHT-OQ-2 | Club moderation | ✅ `DECISION_FINAL` trong DD-55 — human-authored club message soft-hide/restore qua `chat.message.moderate`; timed channel mute qua `chat.member.mute`; immutable actor/reason audit; mọi DM/assistant/system/hard-delete/content-edit/permanent-ban/system-message path bị cấm |
| CHT-OQ-3 | Media/emoji phase-1 | ✅ **Chốt DD-55 (2026-07-16)** — **media in-scope phase-1** (core value): build đủ object storage, signed access, malware scan, quota/type/size limits, moderation, deletion lifecycle — không ship half-built |
| DD-86 | Multi-channel per CLB | ✅ `DECISION_FINAL`, Q1–Q10 closed; Option B, auto-provision, exact lifecycle/post capabilities; Assistant defaults true `all_members`/false `admins_only`, mutable qua manage; no shareable URL v1 |
| DD-91 | `/pay` requester-only trên chat primary surface | ✅ Chốt — human DM dùng private command overlay + eligible-club picker; sync `private, no-store`, zero shared persistence/ref/event. Không biến `/pay` thành Assistant message |
| DD-92 | Interaction/edit/delete/search | ✅ Chốt — exact reply/mention/reaction, bounded own edit, author tombstone và beta-required authorized search |
| DD-93 | Slash grammar/catalog | ✅ Chốt — ASCII case-insensitive, zero alias/arg, exact catalog × surface matrix |
| DD-94 | Offline Chat digest | ✅ Chốt — generic coalesced signal, preference defaults + live reauth; zero durable item/content snapshot; timing enablement-only |
| DD-95 | Club moderation | ✅ Chốt — hide/restore + timed mute, exact capability/reason/receipt/audit; zero DM moderation/read |
| DD-88 | Broader notification grouping/message-request | 🟡 `DEFERRED_PROPOSAL`; không sở hữu/chặn DD-94 digest |

### Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-10-16 | v0.21 | **Sync DD-133/DD-136 + schema 0031; docs-only.** (1) Embed whitelist (bảng snapshot và AC) khớp BL-DSC-1 đã sửa: bỏ `confirmed_count`/`N/M Going`, host avatar và host display name; thêm `public_listing_id`. (2) `chat_members.last_read_at` (không tồn tại) → `last_read_created_at` + `last_read_message_id` (0031). (3) `kind=group` chú thích: chưa có schema (0031 CHECK `club`,`dm`) và ngoài MVP build theo DD-136; không use case/wireframe nào bị xoá. Các dòng lịch sử giữ nguyên. |
| 2026-08-12 | v0.20 | **SessionCard embed upgrade (Playo reference #2):** Embed snapshot thêm: `cover_image_url` (optional hero), urgency badge ("Chỉ N chỗ!" snapshot tại send time), skill level range ("Người mới – Trung bình" green chip). Snapshot fields từ 9 → 12. Không đổi embed security contract. |
| 2026-08-12 | v0.19 | **Unified SessionCard embed (Playo-inspired):** Session Card Embed redesign → unified `SessionCard` variant `embed` với: time pill (`HH:mm – HH:mm`), price pill (VND/Ng), host avatar (32px, moderated), `N/M Going` count. Thêm embed snapshot field table (9 fields). Giữ: sport icon, title, club/host display name, area (DD-06), CTA "Xem kèo", BL-DSC-1 whitelist. Không đổi embed security contract. |
| 2026-08-12 | v0.18 | **Share Session in Chat:** Cho phép gửi session card kèm thông tin hiển thị vào club chat / DM / group. Structured embed trên `chat_messages`: `embed_type='session'` + `embed_ref_id` + server-rendered `embed_snapshot` (BL-DSC-1 whitelist, DD-73 contract). Session picker lọc theo actor visibility (own sessions + public). Tap CTA → session detail/landing (live re-check). Snapshot tại send time, card giữ nguyên trong history khi session cancel. Thêm CHT-UC-32/33, edge case #43–48, 2 screens (Session Card Embed, Session Picker), 2 analytics events, 8 AC bullets. |
| 2026-08-11 | v0.17 | **Group Chat expansion:** Thêm `kind='group'` (global + tenant-scoped, 3–50 members) với follow-guard cho add member (DD-47), multi-pin (max 5/channel), advanced poll/vote (Telegram-style: single/multi, anonymous, quiz, deadline, allow add options), group admin management (đặt admin, kick, rename, avatar), group settings (mute, leave, custom nickname). Thêm 11 use cases (CHT-UC-21–31), 12 edge cases (#31–42), 6 screens mới (Create Group, Group Chat, Group Info, Pinned Messages, Create Poll, Poll Results), 5 domain entities mới (`chat_pinned_messages`, `chat_polls`, `chat_poll_options`, `chat_poll_votes`, `chat_member_nicknames`), 9 analytics events và 15 AC bullets mới. |
| 2026-08-10 | v0.16 | **Message Forward:** Thêm khả năng forward tin nhắn: (1) từ club/group chat → DM user khác, (2) từ DM → DM khác. Forward kèm attribution gốc (sender, channel, timestamp). Boundary: chỉ forward tin mình có quyền đọc (member club hoặc participant DM); không forward tombstone/hidden. Thêm CHT-UC-19/UC-20, edge case #29/#30. |
| 2026-07-28 | v0.15 | Re-pin primary-surface plan v1.8 `PLAN_READY` tại immutable authority `90d292d`, closure 12/12. Giữ runtime = 0, B4/worktree chưa author và strict per-slice `CODE_READY`; không đổi Product contract. |
| 2026-07-28 | v0.14 | Mirror executable ownership từ primary-surface plan v1.7: serialize actual DB lane `1→2→3→4`, rồi Chat chain `5→9→6→7→8`; pin slice 4 DD-56 closed registry + append-only grant audit, slice 9 safe current-channel member target trước các consumer, A1–A13 HTTP owners và F1–F10 FE owners sau F0. Giữ `NOT_PLAN_READY`, runtime = 0 tới immutable re-pin + strict per-slice `CODE_READY`. |
| 2026-07-28 | v0.13 | Owner-final DD-86/DD-91..95: Assistant defaults true `all_members`/false `admins_only`; exact emoji reactions, bounded own edit/soft-delete/authorized search; zero-arg slash catalog × surface; generic coalesced digest; club-only moderation. DD-88 remains broader proposal. Migration/runtime remain not started. |
| 2026-07-28 | v0.12 | Restore owner-final v1 floor after removing an unratified expansion; superseded editorially by v0.13 without semantic change. |
| 2026-07-28 | v0.11 | Promote Product contract to Reviewed after DD-86/CHT-OQ-2 closure. Pin Option B, four exact Chat capabilities, default-OFF Assistant/Announcements-OFF, reply/structured-mention/closed-reaction floor, no edit/search, exact lowercase slash v1, soft moderation/timed mute and no offline digest/per-message durable notification. Pending migration/not implemented. |
| 2026-07-27 | v0.10 | Close safety/retention implementation ambiguity without owner invention: block/unblock/report use actor-scoped command receipts + canonical fingerprints and one audit effect; phase-1 message retention has no TTL/auto-delete/hard purge/search index, cleanup OFF, moderation only soft-delete/tombstone. Draft/not implemented remains. |
| 2026-07-27 | v0.9 | Mirror DD-91: `/pay` trong human DM là requester-only command overlay; DM tenant-null dùng one/many/none eligible-club resolution + opaque bound selector; sync authenticated `no-store`, zero result ref/row/SSE/outbox/push/history/unread. Pin classifier reject trước message insert và sequencing safety pre-root → chat schema → DM command core. Giữ Draft/not implemented. |
| 2026-07-22 | v0.8 | Mirror proposal DD-86 có điều kiện: N club channel, exact-one active default, atomic auto-provision, DD-56 capability authz, DM-null shape, per-channel Assistant gate và command idempotency. Giữ DD-38 là authority; HOLD migration tới owner decision; spec vẫn Draft/not implemented. |
| 2026-07-19 | v0.7a | Metadata sweep (index v2.35): thêm trường **Implementation** đồng bộ BUILD-STATUS (Not started). Không đổi contract. |
| 2026-07-17 | v0.7 | **Canonical chat-model closure:** rename duplicate `chat_channel_members` reference to `chat_members`; message dedupe is `client_msg_id` per channel; user sends only through guarded server-authored RPC; DM read/list/mark/SSE re-authorize safety and concurrent retry consumes rate/audit once. |
| 2026-07-17 | v0.6 | **DD-55 bootstrap closure:** one canonical DM safety decision now explicitly owns request/create/bootstrap/send/read; `create_dm` cannot bypass block/rate/enablement gates. |
| 2026-07-16 | v0.4 | **Propagation (light) DD-55:** CHT-OQ-1 ✅ (phase-1 open DM / phase-2 follow-gated + request box; host không đọc DM), CHT-OQ-3 ✅ (media in-scope full stack). CHT-OQ-2 giữ mở (build-time). Media stack/schema defer build slice — BE tech cần bổ sung media requirements. Authority: decisions v1.36. |
| 2026-07-16 | v0.5 | **Full propagation DD-55 (decisions v1.37):** open-DM hard safety gate; block/report abuse contract; host/support DM denial; full private media upload/scan/signed-access/quota/moderation/deletion lifecycle; acceptance + domain proposals pinned. |
| 2026-07-15 | v0.3 | Làm rõ §4 Domain Model: `dm` là **person-self** (`tenant_id` NULL, `dm_key` cặp person) tách khỏi `club` tenant-private — khớp §1 + `../BE/feature_inapp_chat_tech.md`. RLS note tách club (tenant-RLS) vs dm (person-self gate). Đồng bộ version header ↔ changelog. |
| 2026-07-10 | v0.1 | Khởi tạo Draft (DD-38): chat toàn CLB + 1-1, chỉ Plexco (không bridge, CO-7), SSE (DD-07), RLS tenant cho club-chat + person-self cho DM, anti-spam; tái dùng `chat_*` mà trợ lý DD-19/DD-20 dùng ở P7. Schema proposal-level trỏ decisions.md + `packages/db/schema.ts`. |
