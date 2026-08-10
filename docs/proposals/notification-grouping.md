# DD-88 broader proposal — Notification grouping extensions + DD-94 offline chat digest carve-out

> **Trạng thái DD-88:** 🟡 **`DEFERRED_PROPOSAL` rộng hơn** · grouping/session/activity/`message_request`/scoped-bulk extensions bên dưới vẫn là proposal và chưa có runtime; DD-88 không còn sở hữu hoặc gate exact chat digest.
> **Trạng thái DD-94:** ✅ **`DECISION_FINAL`** cho generic coalesced offline chat digest.
> **Authority repo đã đối chiếu:** `main@784bc8dd297163a5ec5415f33beabbbf34bbc8d7` (`784bc8d`) · owner-final authority pack đã land tại immutable `90d292d`; `docs/standards/decisions.md` v2.11 là current mirror.
> **Live-truth verify (2026-07-24 @ `dfabe1a`):** `notification_intents.type` = `text` **không CHECK** (chỉ status CHECK) — mọi enum type ở §1 là target, chưa live · **không** có `announcement`/session/`message_request` type, `person_notifications`, `notification_preferences` hay `membership_notification_preferences` trong `packages/db/schema.ts` · migration cao nhất trên đĩa = `0021` · DD-70/71/72 chốt hướng + DD-88 (🟡) đều có trong `decisions.md`. Mọi claim "chưa live / cần contract" trong doc khớp repo.
> **Canonical đã đọc tại snapshot 2026-07-24:** `docs/features/FE/feature_notifications_reminders.md` (v3.4h) · `docs/features/BE/feature_notifications_reminders_tech.md` (v3.4i) · `packages/db/migrations/0008_notifications_onboarding.sql` · `docs/features/FE/feature_session_management.md` §5 · `docs/features/FE/feature_inapp_chat.md` (v0.8) · `docs/standards/decisions.md` (DD-38/43/45/47/48/50/55/67/69/70/71/76/77/**88**) · `docs/standards/business-rules.md` BL-NTF-1..4.
> **Supersession 2026-07-28 @ `main@784bc8d`:** canonical Notifications v3.11/v3.11 hiện là **Reviewed contract** nhưng chưa có runtime. DD-70/71/72 và exact chat digest DD-94 đã owner-final; DD-88 chỉ còn proposal kiến trúc/grouping rộng hơn. Primary plan v1.8 đã `PLAN_READY` tại `90d292d`, nhưng exact notification slice vẫn cần strict `CODE_READY`. Live `0008` vẫn chỉ là tenant notification schema/contract baseline; chưa có producer/service/inbox/delivery/digest runtime, `person_notifications` hay preference runtime. Các version/status 24/07 trong body là snapshot lịch sử.
> **Mục tiêu:** lưu design input DD-88 cho các extension rộng hơn, đồng thời mirror ranh giới DD-94 để không vô tình defer hoặc thiết kế lại exact offline chat digest đã chốt. Tài liệu này không authorize migration, API, UI hay runtime.
> **Cập nhật 2026-07-24 (v0.2):** thêm nhóm **Tin nhắn** (chat) + phân tích **message request** (DM từ người chưa follow) — §5.
> **Cập nhật 2026-07-24 (v0.3):** taxonomy đầy đủ mọi noti hiện có + model **config nhận/không nhận theo group** (§6). Ràng buộc pin: Thanh toán + Bảo mật không opt-out được.
> **Cập nhật 2026-07-24 (v0.4 — review correction):** sửa status DD-70/71, pin security-alert no-route fail-closed, tách `message_request` global khỏi tenant enum, và đặt `notification_preferences` per-Person của DD-70 làm authority; per-membership announcement opt-out chỉ là tenant-audience exception, không phải preference model tổng quát.
> **Cập nhật 2026-07-24 (v0.5 — DD-88 mirror reconciliation):** DD-88 giờ mirror đúng packet này: chat digest là delivery-only, không tự thành durable `type`; `message_request` global opaque/read-time; preference canonical per-Person theo DD-70; tenant enum chỉ đổi cho session types, global enum chỉ đổi cho `message_request`.
> **Cập nhật 2026-07-24 (v0.7 — contract correction):** §7 tách rõ `mark all read` toàn inbox đã pin khỏi **scoped mark-all** và **bulk theo lựa chọn** là hai extension mới cần receipt/authz contract + migration riêng. `chat_members.last_read_at` chỉ là target chat contract, chưa phải runtime.
> **Cập nhật 2026-07-24 (v0.8 — review-gate pass):** live-truth verify @ `dfabe1a` (header) + §9 review-provenance theo `review-code-readiness-gate.md` §11.2 — doc là evidence inventory cho DD-88 (chưa author slice), **KHÔNG** phát canonical verdict giả.
> **Cập nhật 2026-07-24 (v0.9):** thêm §10 propagation checklist (gate trên DD-88 ratification) cho BRD/PRD/feature docs; hiện các Reviewed/product doc mới chỉ nhận pointer.
> **Cập nhật 2026-07-28 (v1.0 — historical, superseded by v1.1):** snapshot khi DD-88 còn được mô tả guardrails-only và offline digest bị defer; không dùng làm current authority.
> **Cập nhật 2026-07-28 (v1.1 — supersession):** DD-88 được giữ ở mức broader `DEFERRED_PROPOSAL`; DD-94 owner-final exact offline chat digest: source chat unread, generic opaque push, không durable item/message snapshot, coalesce cursor, preference defaults, mark-read cancellation và dispatch-time re-authorization. Không runtime; current Chat readiness chỉ lấy từ primary plan §13.

---

## 0. Kết luận ngắn

1. 🟡 **DD-88 design direction (`DEFERRED_PROPOSAL`):** "nhóm" nên là view derive từ closed-set `type`, không phải cột lưu mới. System copy đã pin derive từ fixed `type` (HR5). Chia tab = một hàm mapping `type → group` ở read-model / FE, không thêm cột `group` (denormalize thừa, rủi ro drift). Taxonomy/label cụ thể chỉ được mở cùng source type tương ứng.
2. **Notification chạy trên 2 plane tách biệt** (tenant vs global). Tab "lọc theo CLB" chỉ áp cho tenant plane; follow/security là global (không `tenant_id`, cấm tiền/PII) → phải nằm ở nhóm riêng, không lọc theo club.
3. **Nhóm "Kèo" (session lifecycle) và "Hoạt động" (player join/leave/waitlist) CHƯA tồn tại dưới dạng notification.** Hiện chúng chỉ là *analytics events* (`feature_session_management` §5), không phải `notification_intents.type`. Extension này **deferred** tới sau khi Session producers tồn tại; lúc đó cần DD/slice riêng cho type/recipient/anti-spam, không được suy từ guardrail DD-88.
4. **Payment mới có schema/contract baseline từ `0008`, chưa có producer/service/inbox/delivery runtime; follow/announcement/security là type trong target contract đã được decision chốt nhưng chưa có schema/runtime.** Nhóm hoá chỉ là read-model sau khi source type tương ứng tồn tại; không được gọi chúng là live.
5. 🟡 **DD-88 preference direction (`DEFERRED_PROPOSAL`)** (§6): một authority `notification_preferences` per-Person, per closed `type + channel`, áp cả hai plane; `membership_notification_preferences(type='announcement')` chỉ là exact tenant-audience exclusion của DD-71, không phải generic preference store thứ hai. **Thanh toán + Bảo mật không opt-out được** vẫn là hard safety requirement của core notification contract.
6. 🟡 **DD-88 read/grouping extensions (`DEFERRED_PROPOSAL`)** (§7): chat read state độc lập notification read state. Scoped/bulk chỉ được mở sau core inbox/read model và cần canonical fingerprint, server-owned boundary, re-authorize toàn bộ, all-or-nothing, hard cap **100** refs.
7. ✅ **DD-94 exact offline chat digest:** không durable item cho mỗi chat message và không snapshot body/title/amount. Digest lấy từ chat unread, coalesce theo highest unread cursor, gửi generic opaque push; preference và dispatch-time re-authorization được pin ở §5.4. Realtime unread/SSE vẫn do chat read-model sở hữu.

---

## 1. Notification type đã pin (source of truth)

### 1.1 Tenant plane — `notification_intents` (RLS, per-CLB)

Target enum trong contract Reviewed v3.7 (khởi nguồn từ proposal v3.4, migration vẫn pending sau `0008`):

| `type` | Ý nghĩa | Trạng thái |
|---|---|---|
| `reminder` | Nhắc nợ player chưa trả | ✅ Reviewed (§A) |
| `settled` | Xác nhận đã thanh toán sau markPaid | ✅ Reviewed (§A) |
| `correction` | Điều chỉnh sau reversal | ✅ Reviewed (§A) |
| `owner_alert` | Cảnh báo cho host (vd `waitlist.charge_derivation_failed` — DD-45) | ✅ Reviewed (§A) |
| `announcement` | Host broadcast tới thành viên | ✅ DD-71 direction final; target DDL/runtime chưa land |

> Live `main` (`0008`) `notification_intents.type` là `text` **không CHECK**; enum ở trên là target migration, chưa land. Bất kỳ giá trị mới nào cũng phải thêm ở migration đó, không sửa `0008`.

### 1.2 Global plane — `person_notifications` (GLOBAL PROTECTED, per-Person)

Không `tenant_id`, không RLS, **cấm tiền/PII/JSON tuỳ ý** (HR2); copy derive từ fixed `type`:

| `type` | Ý nghĩa | Trạng thái |
|---|---|---|
| `follow_request` | Yêu cầu theo dõi (DD-47) | ✅ DD-70 direction final; target DDL/runtime chưa land |
| `identity_link` | Liên kết identity (DD-50) | ✅ DD-70 direction final; target DDL/runtime chưa land |
| `identity_merged` | Gộp Person (DD-50) | ✅ DD-70 direction final; target DDL/runtime chưa land |
| `security_alert` | Đăng nhập mới / đổi email | ✅ DD-70 direction final; target DDL/runtime chưa land |

> `follow_accepted` **không** thuộc global plane (analytics-only — closure v1.70). Không nhóm nó vào inbox.

### 1.3 Session — analytics events (KHÔNG phải notification)

`feature_session_management` §5: `session_created` · `session_published` · `session_updated` · `session_announced` · `session_closed` · `session_cancelled` · `session_projection_failed`. Đây là analytics/outbox events. **Chưa có đường nào biến chúng thành notification tới host/player.**

---

## 2. Taxonomy nhóm đề xuất (UI, deferred theo source)

Với **durable inbox item**, nhóm = mapping từ fixed `type` (+ subtype đã chốt nếu cần). Chat unread/badge là read-model của chat, không được giả làm một `notification type`; UI contract của nó phải do chat slice sở hữu. Đề xuất 7 nhóm hiển thị + "Tất cả":

| Nhóm (label vi/en) | Gồm `type` | Plane | Cho tắt (opt-out)? | Trạng thái |
|---|---|---|---|---|
| **Tất cả** / All | (mọi item hợp lệ, merge 2 plane ở service layer) | cả hai | — | — |
| **Kèo** / Sessions | `session_*` (type MỚI) | tenant | 🟡 channel-only (đề xuất) | ❌ cần contract mới |
| **Hoạt động** / Activity | join/leave/waitlist-promoted (type MỚI hoặc `owner_alert` subtype) | tenant | 🟡 tùy (owner_alert host có thể bắt buộc) | ❌ cần contract mới |
| **Thanh toán** / Payments | `reminder` · `settled` · `correction` | tenant | ❌ **KHÔNG** (money integrity) | ✅ có sẵn |
| **Tin nhắn** / Messages | future durable: **`message_request`** (type MỚI, global); current non-durable: chat unread/badge + DD-94 delivery-only digest | global item; chat source theo channel plane | Generic coalesced digest; không item/message snapshot | 🟡 grouping/request proposal; digest ✅ DD-94 |
| **CLB** / Announcements | `announcement` | tenant | ✅ tenant-audience opt-out (target contract) | ✅ DD-71 direction final; DDL/runtime Draft |
| **Xã hội** / Social | `follow_request` · `identity_link` · `identity_merged` | global | 🟡 exact policy chưa pin | ✅ DD-70 direction final; DDL/runtime Draft |
| **Bảo mật** / Security | `security_alert` | global | ❌ **KHÔNG** (account safety) | ✅ DD-70 direction final; DDL/runtime Draft |

> Xem §6 cho model config chi tiết. Live schema hiện chưa có preference table nào. Trong target contract, chỉ Announcement có tenant-audience opt-out đã được model hoá; preference per-Person của DD-70 và mọi type khác vẫn cần schema contract. **Thanh toán + Bảo mật vĩnh viễn không tắt được** (enforce ở schema, không chỉ UI).

> `owner_alert` (vd waitlist derivation failed) có thể gộp vào **Hoạt động** hoặc tách nhóm **Quản trị** tuỳ vai host — cần chốt ở §4.

### 2.1 Hai trục lọc (đã có trong spec inbox)

- **Theo loại/nhóm** (tài liệu này) — áp cả 2 plane.
- **Theo CLB** (NTF-UC-16) — **chỉ tenant plane**; global item (Xã hội/Bảo mật) không thuộc CLB nào nên không xuất hiện dưới bộ lọc club, và **không được hiện tiền/tên CLB** trong các nhóm global.

Badge chưa đọc: theo spec có trần "99+"; badge theo nhóm cũng phải fail-soft (ẩn khi lỗi), không full-scan.

---

## 3. Deferred extension — Session lifecycle/activity

Để có nhóm **Kèo** + **Hoạt động**, cần một DD-proposal trả lời:

1. **Type mới hay subtype của `owner_alert`?**
   - Option A: thêm giá trị `type` mới (`session_lifecycle`, `session_activity`) vào CHECK.
   - Option B: giữ `type='owner_alert'` + cột `subtype`/`event_kind` derive copy. (Cần cân nhắc HR5: copy vẫn phải derive từ enum cố định, không free-text.)
2. **Ai nhận?** Host (kèo mình host: player join/leave) vs player (kèo mình tham gia bị cancel/đổi giờ). Recipient resolution phải qua `memberships`/roster dưới RLS, không snapshot.
3. **Tenant plane** (đúng, vì gắn CLB + session) → tái dùng `notification_intents`, **không** pipeline song song (HR3).
4. **Anti-spam / batch:** join dồn dập (10 người join trong 1 phút) → 1 digest hay N item? (Tương tự cooldown của `reminder`.)
5. **Nội dung:** cấm lộ tiền/PII ra kênh công khai; OS push generic; chi tiết chỉ sau authenticated fetch (HR2, giống NTF-UC-7/8).
6. **Effective-state render:** item "player joined" khi player đã `left` sau đó → render theo effective state (giống Edge #22 charge void).

**Reopen trigger chính xác:** Session lifecycle/activity chỉ được mở sau khi Session producers tương ứng đã land. Khi đó author DD + mechanism-named slice riêng để chốt type/subtype, recipient, anti-spam và acceptance matrix. DD-88 proposal không tự trả lời các câu này và không authorize migration/code.

---

## 4. Deferred questions cho Session extension

- **OQ-1:** `owner_alert` nằm ở nhóm "Hoạt động" hay tách "Quản trị"?
- **OQ-2:** Nhóm hiển thị theo vai (host thấy "Kèo/Hoạt động"; player thấy "Thanh toán/Xã hội") hay chung một danh sách có filter?
- **OQ-3:** Session lifecycle notify cho player (kèo bị huỷ/đổi giờ) — mức độ ưu tiên P? (khác với owner_alert cho host).
- **OQ-4:** ✅ Phần offline chat digest đã đóng riêng bằng DD-94 ở §5.4; chat unread/SSE vẫn là chat-owned read-model và digest không phải durable inbox item. `message_request` vẫn chỉ reopen sau DD-55 phase-2 request box.

---

## 5. Nhóm "Tin nhắn" (chat) + Message request

### 5.1 Bối cảnh canonical (đã pin)

Chat contract (`feature_inapp_chat`, DD-38/DD-86/DD-91/DD-92..95, Reviewed/not runtime) định nghĩa **2 durable channel kind = 2 plane**, khớp đúng kiến trúc notification:

- **`club`** — tenant-private, RLS. Tin nhắn chat toàn CLB.
- **`dm`** — **person-self / global** (`tenant_id` NULL, `dm_key` = cặp person). Chỉ 2 người đọc; host/support/admin **KHÔNG** đọc DM.

Chính sách DM (DD-55, ✅ chốt):
- **Phase-1:** open DM nhưng **hard-gated** bởi block + report + per-sender/per-target rate-limit + abuse audit (thiếu 1 gate → DM OFF).
- **Phase-2:** chỉ **follower đã accepted** (DD-47) mới DM thẳng; người còn lại vào **request box**.

CHT-UC-5 **đặc tả** unread badge qua SSE — đây là read-model của chat, không phải notification item và chưa là runtime. Vì vậy mapper inbox không nhận `club-message`/`chat DM` như một `type`; nếu UI hiển thị một Messages surface, chat slice phải cung cấp một DTO read-only, không tạo intent/item mới.

### 5.2 Nguyên tắc: tin nhắn KHÔNG tạo một notification item mỗi tin

Nếu mỗi tin nhắn sinh một `notification_intents`/`person_notifications` row thì: (a) **double-store** với canonical `chat_messages` của chat contract — vi phạm HR3 (không pipeline song song); (b) spam badge/push. Vì vậy:

| Tín hiệu | Cơ chế | Có phải notification không? |
|---|---|---|
| Có tin mới khi đang online | SSE + badge chưa đọc (read-model chat) | ❌ không — thuộc chat, không phải inbox |
| Có tin mới khi offline | **DD-94:** coalesced delivery từ chat unread, generic opaque push, không lưu item/message snapshot mỗi tin | ✅ delivery-only; không phải durable Inbox item |
| **Message request** (DM từ người chưa follow — phase-2) | Durable notification item, person-global | ⏸ deferred tới sau khi DD-55 phase-2 request box land |

Nói cách khác: nhóm **Tin nhắn** trong inbox, nếu được build, chủ yếu là *view* của chat unread + SSE. DD-94 digest là delivery-only trên chính read-model đó, không thêm item bền. Đúng một loại item bền còn đang đề xuất là **message request**.

### 5.3 Message request = request box của DD-55 phase-2

Ở phase-2, DM từ người **chưa có quan hệ follow-accepted** phải không vào thẳng hộp thoại mà đi qua **message request** — tương tự Instagram. Notification đề xuất cho request này là **person-global**, giống `follow_request`:

- Type mới đề xuất: `message_request` trên **`person_notifications`** (global plane).
- **Content-opaque:** item/push/log chỉ giữ fixed type + opaque source reference; không lưu/copy nội dung tin, tiền, PII hay social fields của sender vào `person_notifications`. Bất kỳ social field được render phải resolve sau authorized read từ source hiện hành và fail-closed khi source/visibility không còn hợp lệ. OS push luôn generic (HR2).
- **Inline accept/reject:** accept chỉ có thể mở/reuse DM qua **phase-2 policy gate đặt trước mọi direct-DM entry point** (create, existing-channel reuse, send, read). Gate re-check follow/request state, block, rate-limit, abuse audit và enablement; không được tái dùng `create_dm` phase-1 như một bypass. Reject/ignore/expiry/block không tạo channel và không báo trạng thái cho sender.
- **Idempotency:** phải bind exact canonical request/source ID với event key; re-send khi request còn pending trả cùng request/item, không tạo source request hoặc inbox item thứ hai. Không dùng caller-chosen key hoặc chỉ so `(sender,target)` mơ hồ.
- Block/rate-limit/abuse audit vẫn enforce tại boundary (Edge #13/#17 chat) trước khi tạo request.

### 5.4 DD-94 exact digest + deferred request contract

- **`message_request`:** chỉ reopen sau khi **DD-55 phase-2 request box** và canonical request lifecycle/source đã land. Khi đó một DD/slice riêng mới được chốt global `person_notifications.type`, exact lifecycle, content-opaque source ref, idempotency và authorized read. Không thêm type trước dependency này.
- **Offline chat digest đã owner-final (DD-94), không còn là reopen item:** source duy nhất là chat unread; không durable item hoặc snapshot message/body/title/amount. OS push luôn generic opaque. DM/direct mention/reply default ON; club channel có preference `all\|mentions\|off`, default `mentions`. Coalesce idempotent theo `(person, channel, highest_unread_cursor)`; mark-read làm pending cursor cũ obsolete. Ngay trước provider write phải re-check current membership hoặc DM read authority, pair block+safety, preference, device active/trust epoch và cursor vẫn unread; false/unknown thì skip + audit. Retry/unknown outcome không được duplicate. Delay/coalescing timing là `ENABLEMENT_ONLY`; thiếu hoặc chưa test config thì route OFF.
- **DM unread trong Inbox:** dùng chat read-model/badge/deep-link; không đổ mỗi DM vào Inbox. Direct mention/reply là trigger DD-94 mặc định ON nhưng vẫn không trở thành durable notification type hay mở rộng DD-88.

### 5.5 Ràng buộc riêng cho nhóm Tin nhắn

- ❌ Global DM notification/message_request **không** persist hoặc gửi nội dung tin, tên thật/social field, tiền; render field (nếu được owner cho phép) luôn là authorized source lookup tại read time (HR2, Edge chat #9).
- ❌ Không cho host/support/tenant admin suy ra nội dung/đối tác DM qua notification (DD-55 acceptance).
- ❌ Không tạo item notification cho mỗi tin nhắn (HR3) — reuse `chat_*` read-model.
- ❌ DD-94 digest không được chứa body/title/amount, durable source snapshot hoặc tạo item per-message; generic push không được biến thành content preview.
- ✅ Pending digest phải bị vô hiệu khi cursor đã đọc và phải re-authorize mọi boundary ngay trước provider write.
- ✅ Accept message request phải đi qua **canonical safety decision** DD-55 (block/rate/enablement) trước khi tạo/reuse channel.

---

## 6. Config nhận/không nhận theo group

### 6.1 Ba tầng khác nhau — đừng gộp

Config của người nhận tác động **kênh gửi**, KHÔNG xoá bản ghi. DD-70 yêu cầu `notification_preferences` **per Person, per type + channel, áp cả hai plane**. `membership_notification_preferences(type='announcement')` chỉ là tenant-audience exclusion của fan-out DD-71; nó không thay preference per-Person và không được suy rộng thành một model split theo plane. Phân biệt rõ:

1. **Inbox item (bền):** với type mà producer được phép emit, delivery fail không làm mất item (BL-NTF-2). Opt-out không xoá item đã tạo; chỉ owner contract được chọn suppress audience trước khi tạo item (hiện Announcement target contract — xem dưới).
2. **Delivery/push (kênh):** có thể tắt push/DM cho một số nhóm; item vẫn đọc được trong inbox.
3. **Full opt-out khỏi tenant audience:** target contract hiện chỉ có Announcement — member opt-out không được tạo intent (dispatch anti-join `opted_out`). Full suppression cho type khác, hoặc quan hệ của nó với Person preference DD-70, phải có DD riêng; không suy ra từ bảng announcement.

### 6.2 Ma trận policy theo group

| Group | Opt-out? | Cơ chế | Scope |
|---|---|---|---|
| **Thanh toán** (`reminder`/`settled`/`correction`) | ❌ Không bao giờ | Target schema không có row opt-out hợp lệ (BE tech §768-770). Enforce ở DB, không chỉ UI | — |
| **Bảo mật** (`security_alert`) | ❌ Không bao giờ | Chỉ dispatch nếu route verified/trusted **trước** `trigger_context_started_at`; không có route ⇒ durable item + audit, **không HTTP** | — |
| **CLB / Announcement** | ✅ Full opt-out khỏi tenant audience | `membership_notification_preferences (membership_id, type='announcement')` là target contract DD-71; còn interaction với Person preference DD-70 phải được pin | Per CLB (per membership) |
| **Xã hội** — `follow_request`/`message_request` | 🟡 policy cần chốt | `notification_preferences` per-Person (target DD-70) | Per person |
| **Xã hội** — `identity_link`/`identity_merged` | 🟡 policy cần chốt | `notification_preferences` per-Person (target DD-70) | Per person |
| **Tin nhắn** (chat push, DD-94) | ✅ Channel preference | DM/direct mention/reply default ON; club channel `all\|mentions\|off`, default `mentions`; digest vẫn không tạo Inbox item | Per person + per channel |
| **Kèo / Hoạt động** | 🟡 channel-only đề xuất | `owner_alert` cho host có thể bắt buộc (điều hành CLB) | Per CLB |

### 6.3 Ràng buộc kiến trúc cho config

- **KHÔNG có một "global mute" duy nhất.** Preference phải scoped theo fixed type + channel, với mandatory type bị schema loại khỏi tập cho tắt, để không bao giờ lỡ tắt Thanh toán/Bảo mật (BE tech §1754 cảnh báo đúng điều này).
- **Preference authority là per-Person:** một canonical preference model theo `type + channel` áp cả hai plane như DD-70. Tenant `membership_notification_preferences` chỉ được giữ như exact announcement-audience exclusion; không tạo generic tenant preference table thứ hai nếu chưa có DD nêu owner, precedence và same-Person multi-membership behavior.
- **Re-check fresh tại dispatch, không cache/snapshot** (đã pin cho announcement, §1806/§1897) — áp cho mọi group cho tắt được.
- **Money/security enforce ở schema:** cách an toàn nhất là **không tồn tại** giá trị `type` hợp lệ để opt-out chúng (giống announcement-only hiện tại), chứ không phải chặn ở tầng UI/service.

### 6.4 DD-94 exact contract final; DD-88 broader preferences remain deferred proposal

DD-94 đã pin exact default cho chat digest như §5.4. DD-88 chỉ đề xuất mô hình preference rộng hơn per-Person/per-type/channel cho hai plane và không tự authorize migration. Mỗi extension khác vẫn phải pin allowed type/channel pairs, absence/default semantics và interaction hẹp với tenant-audience exclusion của Announcement. Extension đó còn phải trả lời:

1. Danh sách chính xác group nào cho **full opt-out** vs **channel-only** vs **bắt buộc**.
2. Giữ **bất biến money+security không opt-out** (schema-enforced) khi thêm type mới.
3. `notification_preferences` per-Person: schema/grants, allowed type+channel pairs, default rows/absence semantics, immutable mandatory types, and dispatch-time recheck.
4. Precedence between Person preference and DD-71 per-membership announcement exclusion, including a Person with multiple memberships; no generic per-club mute unless a DD explicitly adds one.
5. UI: nhóm "Kèo/Hoạt động/CLB" có cần setting per-CLB hay chỉ read filter? Đây là product choice riêng, không được suy ra từ tenant plane.
6. Mặc định (default on/off) từng group khác — không được mở lại default chat digest đã chốt trong DD-94; `message_request` vẫn cần DD riêng sau request-box dependency.

---

## 7. Unread + mark-read UX (highlight · chọn tất cả unread · mark all read)

### 7.1 Baseline đã pin: mark-all toàn inbox

Chỉ `mark all read` **toàn bộ item hiện visible/authorize trên tenant + global plane** là contract đã pin:
- **NTF-UC-15 / Edge #21:** mark-all = read-only discovery **ngoài** mutation TX → bounded `READ COMMITTED` lock per-Person inbox fence **trước** authoritative snapshot → capture server boundary + re-authorize → tạo explicit read row **chỉ cho item đang visible/authorize** → receipt + reads commit all-or-nothing. **Hidden/late item vẫn unread; client KHÔNG truyền mốc thời gian.**
- Bảng: `notification_reads UNIQUE(person_id, source_kind, source_id)` · `notification_read_all_commands UNIQUE(person_id, command_id)` (idempotent).
- Endpoint target hiện hành nhận **chỉ** `command_id` và tự enumerate complete tenant + global plane; nó không nhận cursor/filter/boundary từ client. Vì vậy không được gọi nó với scope group/CLB hoặc tái diễn giải "visible set" thành một filter client chọn.
- **Unread là derived** (không có read row cho source đó), không persist tombstone. `hidden` (mất quyền) cũng derived.
- Badge có trần **"99+"**, fail-soft (Edge #25), không full-scan.

### 7.2 Highlight unread

Thuần read-model: item không có read row ⇒ unread ⇒ FE highlight (dot/nền). Áp **cả 2 plane** (tenant + global) qua merge ở service layer. Badge tổng + badge per-group đều derive từ cùng unread set; badge per-group phải fail-soft như badge tổng.

### 7.3 "Chọn tất cả unread" + mark-read theo lựa chọn = extension deferred

Hai thao tác này **không** map vào endpoint/receipt mark-all hiện có và không được ship như FE-only. DD-88 chốt guardrails fail-closed dưới đây, nhưng delivery chỉ được reopen sau khi core Inbox/read model đã land:

| Thao tác | Request và receipt | Authorization + atomicity | Replay/failure |
|---|---|---|---|
| **Scoped mark-all** (group X / CLB Y) | Endpoint/command mới nhận `command_id` + closed-set filter. Server canonicalize filter rồi lưu `person_id + command_id + filter_hash + boundary_sequence + command_kind`; không nhận cursor/timestamp/tenant-count do client khai. | Sau per-Person fence, server re-authorize và enumerate **chỉ** exact visible set khớp filter tại boundary; insert tất cả read rows + receipt trong một transaction. Filter không hợp lệ, capability/authorization đổi, hoặc vượt cap ⇒ rollback toàn bộ. Hidden/late item vẫn unread. | Same command + same canonical filter trả receipt cũ; same command + filter khác = `409`, zero mutation. Cần migration receipt/constraint mới hoặc extension rõ ràng của receipt hiện có trước build. |
| **Bulk theo lựa chọn item** | Endpoint/command mới nhận `command_id` + tập opaque visible refs, canonicalize/dedupe rồi lưu canonical request fingerprint; server hard cap **100 refs**. | Server re-authorize **mọi** ref sau fence trước khi ghi. Nếu một ref missing/unauthorized/stale, trả cùng opaque `404` như single-item mark-read và rollback **cả batch**; không "bỏ qua, không lỗi" vì điều đó tạo partial state không có receipt semantics. | Exact replay chỉ khi fingerprint giống nhau; command reused với tập khác = `409`, zero mutation. Duplicate ref chỉ tạo một read row. |

- **Không client watermark:** client không gửi "đọc tới thời điểm T"; server tự chốt boundary. Chống race 2 tab (Edge #21).
- Contract mới phải có acceptance tests cho empty result, duplicate ref, unauthorized/stale ref, replay mismatch, concurrent mark-all, over-cap, hidden/late item và cross-plane filter. NTF-UC-14 chỉ chứng minh single-item idempotency, không tự chứng minh batch semantics.

### 7.4 Chat unread ≠ inbox unread (quan trọng)

**Target chat contract** định nghĩa read-model riêng (last-read theo `chat_members`/channel), KHÔNG phải `notification_reads`; chưa có `chat_*` runtime trên `main`. Khi chat slice đã land, thì:
- "Mark all read" trên **inbox notification** KHÔNG tự đánh dấu đã đọc hội thoại chat, và ngược lại — trừ khi có DD nối hai read-model.
- Nhóm **Tin nhắn** trong inbox (§5), nếu được build, chỉ đọc chat read-model/badge/deep-link; không đổ từng tin thành notification item. DD-94 digest đọc cursor unread nhưng không mutate notification read-model.

### 7.5 Ràng buộc riêng

- **Mark-read ≠ dismiss nghĩa vụ.** Đọc một `reminder` không xoá nợ; render vẫn theo **effective state** (Edge #22 — charge void thì không hiện nợ cũ). Đọc `security_alert` không vô hiệu hoá cảnh báo.
- **Mark-read không phải opt-out.** Nó chỉ đổi trạng thái đọc, không tắt nhận (opt-out là §6). Money/security vẫn không opt-out được.
- **Merge Person:** read state re-parent + dedupe trong cùng transaction merge; badge không cộng trùng (NTF-UC-22, Edge #23).
- **Item trỏ tới nguồn đã xoá:** hiện "Không còn khả dụng" (`t(vi,en)`), không 500, không lộ id nội bộ (Edge #26).

### 7.6 Owner decisions / delivery prerequisites

1. **Scoped/bulk DD-88 proposal:** canonical request/filter fingerprint, server-owned boundary, re-authorize toàn bộ, all-or-nothing, cap 100, replay mismatch fail-closed. Exact command/receipt schema vẫn thuộc future decision/slice.
2. **Chat ↔ inbox read-model boundary:** độc lập; mark-read bên này không mutate bên kia. DD-94 chỉ làm pending digest cursor obsolete khi chat được mark-read, không ghi notification read state.
3. **Ordering:** core DD-70 notification read model phải merge trước; scoped/bulk là migration + API + invariant-test slice riêng. Không gộp nó vào migration type enum của session/message request.

---

## 8. Điều KHÔNG được làm (hard rules)

- ❌ Không thêm cột `group` denormalize; nhóm là derive từ `type`.
- ❌ Không cho global plane chứa tiền/PII/tên CLB để "render tab nhanh" (Edge #16, HR2).
- ❌ Không `UNION` SQL cross-plane; merge ở service layer (BE §3.0).
- ❌ Không dựng store/pipeline notification thứ hai cho session/activity (HR3) — tái dùng `notification_intents`.
- ❌ Không viết type mới vào spec `feature_notifications_reminders.md` đã Reviewed trước khi có DD chốt.
- ❌ Không route scoped mark-all vào `/inbox/read-all` hiện có, không silent-skip ref mất quyền trong bulk, và không dùng client timestamp/cursor làm read authority.
- ❌ Không tạo durable notification item cho từng chat message; DD-94 digest không được snapshot message/body/title/amount hoặc phát non-generic push.
- ❌ **Không cho opt-out Thanh toán (`reminder`/`settled`/`correction`) và Bảo mật (`security_alert`)** — enforce ở schema (không có `type` hợp lệ để tắt), không chỉ UI (money integrity + account safety).
- ❌ Không có "global mute" một nút tắt hết — preference scoped theo fixed type + channel và mandatory type bị schema loại khỏi tập cho tắt; nếu không sẽ lỡ tắt nhắc tiền (BE tech §1754).
- ❌ Opt-out không xoá inbox item đã tạo. Audience suppression phải do type owner contract cho phép (hiện chỉ Announcement target contract = không tạo intent); không được suy ra cho type khác.

---

## 9. Review provenance & evidence inventory

> Doc này lưu **DD-88 `DEFERRED_PROPOSAL` inventory + DD-94 boundary mirror**, không phải implementation slice và không phát readiness verdict. DD-94 là decision authority; runtime authorization nằm ở canonical plan/slice riêng.

- **Current pin:** live base `main@784bc8dd297163a5ec5415f33beabbbf34bbc8d7`; immutable target authority = `90d292d` plus current `docs/standards/decisions.md` v2.11 mirror. Pin `dfabe1a…` ở header chỉ là snapshot 24/07.
- **Live-truth:** đã re-verify 28/07 (xem supersession ở header) — canonical Notification Product/BE pair là Reviewed contract; notification/digest runtime và mọi DD-88 extension vẫn chưa land.
- **Evidence inventory cho một extension tương lai** (không quy ra trạng thái):
  - *Authority:* exact pack `90d292d` chứa DD-94 + reconciled Chat/Assistant/Notification/Player mirrors; current Chat verdict chỉ lấy từ primary plan v1.8 §13.
  - *Decision:* DD-94 digest đã owner-final; type/subtype, recipient/anti-spam và request lifecycle của session/activity/`message_request`/scoped-bulk DD-88 extensions **cố ý deferred**, không được suy từ proposal này.
  - *Spec:* `feature_notifications_reminders(.md/_tech)` là Reviewed contract cho core + DD-94; session/activity, `message_request` và scoped-bulk chưa nằm trong implementation slice đã author.
  - *Dependency (chưa trên default branch):* schema DD-70 (`person_notifications`, `notification_preferences`), DD-71 (`announcements`/tags/quota), DD-72 (`device_push_subscriptions`), DD-55 **phase-2** request box, Session producers và delivery telemetry — tất cả chưa merge/đủ bằng chứng.
  - *Decision boundary:* exact DD-94 digest đã owner-final; các câu hỏi DD-88 còn lại chỉ reopen theo trigger §10.
- **Future review inputs:** với Chat initiative, xem primary plan §13; với một DD-88 extension, owner chỉ author mechanism-named slice sau trigger tương ứng ở §10 và pin authority/dependencies/acceptance matrix của chính slice đó.

---

## 10. Delivery gate DD-94 + exact reopen triggers DD-88

| Extension | Gate / reopen trigger | Việc phải author |
|---|---|---|
| Offline chat digest (DD-94 final) | Authority pack đã land tại `90d292d`; trước code phải có strict slice-local `CODE_READY`, Chat realtime/unread + DD-67 route integrity → protected subscription → provider attempts → PWA shell → registration → display/telemetry chain đã merge | `chat-unread-notification-core` dùng `(person,channel,highest_unread_cursor)`, generic push, preference + mark-read cancellation + send-time reauth acceptance; không item/message snapshot |
| Session lifecycle/activity | Session producers tương ứng đã land | DD/slice riêng cho closed type/subtype, recipient, anti-spam, source-event idempotency và acceptance matrix |
| `message_request` | DD-55 phase-2 canonical request box đã land | Global type + request lifecycle/source + content-opaque authorized-read contract |
| Scoped mark-all / bulk read | Core Inbox/read model đã land | Receipt/API migration với canonical fingerprint, server boundary, all-or-nothing, re-authorization và cap 100 |

**Dependency order:** immutable DD-94 authority → Chat unread/safety → DD-67 route integrity → protected subscription → provider attempts → PWA shell → registration → display/telemetry → `chat-unread-notification-core`. Payment plane tách riêng: lifecycle intent → reminder + settled/correction producers → Inbox/detail → thin payment-push adapter. Riêng DD-88 proposals: core DD-70 inbox/read + preference authority trước → từng producer/source dependency → từng extension slice. Không mega-migration, provider thứ hai hoặc tự nâng BRD/PRD/Home/Chat/Session contract từ DD-88.

## 11. Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-07-28 | v1.1 | Supersede v1.0 boundary: DD-88 trở lại broader `DEFERRED_PROPOSAL`; carve exact offline chat digest sang owner-final DD-94. Pin chat-unread source, no durable item/message/body/title/amount snapshot, generic opaque push, DM/mention/reply default ON, club `all\|mentions\|off` default `mentions`, cursor coalescing, mark-read cancellation, dispatch-time auth/safety/preference/device recheck và fail-closed timing config. Current Chat readiness chỉ lấy từ primary plan §13; no runtime/code. |
| 2026-07-28 | v1.0 | **Historical snapshot, superseded by v1.1.** Khi DD-88 còn được mô tả guardrails-only, packet đã defer offline digest; current authority chuyển exact digest sang DD-94 và giữ DD-88 ở mức broader `DEFERRED_PROPOSAL`. |
