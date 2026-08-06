<!-- review-readiness: enforce -->
# 💬 DD-86 Analysis — In-app **multi-channel per CLB** (kênh theo chủ đề kiểu Messenger community)

> **Mục đích:** chốt hướng data model cho việc mỗi CLB có **nhiều kênh chat theo chủ đề** (Main / Feedback / Announcements / host tự tạo thêm), thay vì đúng **1 kênh club/CLB** như mô hình DD-38 hiện tại. Mỗi kênh vẫn @mention được **Club Assistant** (bot đã feed KB) để trả lời câu hỏi.
> **Ngày:** 2026-07-28 · **Version:** 1.1 · **Trạng thái:** ✅ **DECISION_FINAL** — owner ratify **Option B** và toàn bộ DD-86-Q1..Q10. Đây là product/architecture authority để hoàn thiện spec; **không** phải `PLAN_READY`, `CODE_READY`, migration hay runtime proof. §13 ghi verdict review của execution pack, không cấp phép code.
> **Canonical đối chiếu:** `docs/features/BE/feature_inapp_chat_tech.md` (DDL đề xuất chat `chat_*`, RLS 2-policy) · `docs/features/feature_inapp_chat.md` (DD-38) · `docs/features/feature_club_assistant.md` + `docs/proposals/club-ai-bot-knowledge-base.md` (bot+KB) · `decisions.md` DD-38/DD-55/DD-16..29/DD-71/DD-79/DD-83/DD-86/DD-91..95; DD-88 chỉ là broader proposal · `packages/db/schema.ts` (**AUTHORITATIVE** khi build; `chat_*` HIỆN CHƯA có trong đây) · HANDOFF §3 (5 HARD RULES).
> **Lưu ý tên:** "channel" ở doc này = **kênh chat trong app Plexco theo chủ đề** (in-app topic channel). KHÁC hoàn toàn `docs/channels/` (= adapter nền tảng ngoài: Zalo/Messenger/web). Đừng trộn hai khái niệm.

---

## 0. TL;DR — quyết định cuối

**Bối cảnh:** hướng sản phẩm anh mô tả gần như đã có spec:
- *Bot tag được + feed KB để trả lời* = **Club Assistant + KB** (DD-16/17/19–23/28 ✅; DD-18 provider ⬜ = gate go-live). Không phải làm lại.
- *Kênh chat trong CLB* = **In-app Chat** (DD-38/DD-86 ✅, Product/BE Reviewed, pending migration).

**Điểm net-new đã chốt tại DD-86:** mô hình chat trước đó khoá **đúng 1 kênh `club`/CLB** (`chat_channels_club_uq`). "Nhiều kênh theo chủ đề" là mở rộng data model có chủ đích theo Option B.

**Đã chốt (Option B — thêm cột phân loại, giữ nguyên trục `kind`):**
- Giữ `chat_channels.kind ∈ {club, dm}` **không đổi** (không phá RLS/composite-FK/assistant projection đã thiết kế). Một kênh chủ đề của CLB **vẫn là `kind='club'`** (tenant-private).
- **Bỏ** unique index `chat_channels_club_uq` (ràng buộc 1-kênh/CLB) → cho **N kênh `club`/tenant**.
- Thêm metadata club-only: `title`, `sort_order`, `is_default` (Main pinned), `created_by_membership_id` + `created_by_person_id`, `post_policy` (`all_members` | `admins_only` cho Announcements), `assistant_enabled`; `archived_at` tiếp tục là lifecycle soft-close.
- **Membership per-channel:** giữ `chat_members` là 1 row/(channel, person) — vì `last_read_at`/badge chưa đọc vốn phải theo từng kênh. Phase-1: **auto-provision** member vào mọi kênh không hạn chế của CLB (kênh riêng/subset = phase sau).
- **Announcements** = một kênh `post_policy='admins_only'`, **KHÔNG** thay thế feature Announcement broadcast (DD-71) — hai thứ khác nhau (§6).

**Vì sao Option B, không phải "thêm `kind` mới":** thêm `kind='topic'` sẽ buộc viết lại toàn bộ CHECK XOR (`club⇔tenant NOT NULL`/`dm⇔dm_key`), RLS 2-policy, và assistant projector (`kind='club'`). Giữ `kind='club'` + thêm cột phân loại **giữ nguyên mọi bất biến bảo mật đã harden**, blast radius nhỏ nhất.

**Sequencing (quan trọng):** `chat_*` **chưa vào migration**. DD-86 và cặp Chat đã đóng nhánh decision/spec, nhưng root migration DD-38/DD-86 vẫn đợi nhánh độc lập gồm docs-only DM-safety contract, exact `chat_definer` provisioning và safety storage/primitives. Root chỉ được tạo final N-channel chat tables + pure DM read adapter/RLS sau khi **cả hai nhánh** đã đóng; không land baseline one-channel rồi fold.

---

## 1. Canonical đã cố định gì

| Sự thật | Nguồn |
|---|---|
| `chat_channels.kind` chỉ có **2 giá trị**: `CHECK (kind IN ('club','dm'))` | `feature_inapp_chat_tech.md` §2 — `chat_channels` DDL (kind CHECK) |
| **ĐÚNG 1 kênh `club`/tenant** — `CREATE UNIQUE INDEX chat_channels_club_uq ON chat_channels(tenant_id) WHERE kind='club'` | `feature_inapp_chat_tech.md` §2 — index `chat_channels_club_uq` |
| CHECK XOR: `club ⇒ tenant_id NOT NULL AND dm_key NULL`; `dm ⇒ tenant_id NULL AND dm_key NOT NULL` | `feature_inapp_chat_tech.md` §2 — `chat_channels` CHECK XOR |
| `chat_members.role ∈ {member, admin}`, có `last_read_at` per row, PK `(channel_id, person_id)` | `feature_inapp_chat_tech.md` §2 — `chat_members` DDL |
| Composite FK: child bind `(channel_id, tenant_id) → chat_channels(id, tenant_id)`; `chat_channels UNIQUE(id, tenant_id)` | `feature_inapp_chat_tech.md` §2 — composite FK + `UNIQUE(id, tenant_id)` |
| RLS = **2 permissive policy** mỗi bảng `chat_*` (club dùng `app.tenant_id` + `chat_current_is_member`; dm dùng `app.person_id` + `dm_current_read_allowed`) | `feature_inapp_chat_tech.md` §2 — RLS policies `chat_*` |
| **Assistant chỉ phát vào `kind='club'`**, `author_type='assistant'`, `client_msg_id='assistant:'||query_id` | `feature_club_assistant.md` §4 — `chat_channels` row · `club-ai-bot-knowledge-base.md §4.4` |
| Bot = **config cấp tenant** (`bot_configs`, UNIQUE tenant_id), KHÔNG phải Person/ChannelIdentity mới (DD-20) | `feature_club_assistant.md` §4 — `bot_configs` · §1 bất biến DD-20 |
| `chat_*` (channels/members/messages + safety) **CHƯA tồn tại trong `packages/db/migrations/`** — contract Reviewed, pending migration | `feature_inapp_chat_tech.md` §2 — Migration & Rollback note |
| DD-71 Announcement = host→member **broadcast/fan-out** (proof-bound preview/confirm, quota, free + host_pro), **không phải** một chat channel | `decisions.md` DD-71 |
| Nav app có header 💬 chat (DD-79 Home hub, S9) | `decisions.md` DD-79 · `feature_home.md` |
| DD-86 và DD-91..95 đã owner-ratify; DD-92 sở hữu message/search, DD-93 slash, DD-94 digest, DD-95 moderation. DD-88 chỉ là broader proposal | `decisions.md` DD-55/DD-86/DD-88/DD-91..95 |

> **Hệ quả:** (1) đúng 1 club-channel/tenant là **ràng buộc tường minh** (`chat_channels_club_uq`), không phải giả định — bỏ nó là hành động có chủ đích, cần DD; (2) vì `chat_*` chưa migrate nên đây là **thời điểm rẻ nhất** để đưa N-channel vào ngay từ migration đầu; (3) giữ `kind='club'` cho kênh chủ đề = tái dùng nguyên RLS/FK/assistant, không tạo trục phân loại thứ hai.

---

## 2. Vấn đề — mô hình hiện tại chỉ cho 1 kênh/CLB

Ảnh tham chiếu (Messenger community của Bestminton) có: **Main chat** (pinned) + **Feedback** + **Announcements** + nút **Create chat**. Đây là **N kênh theo chủ đề trong 1 CLB**, member đặt tên/tạo thêm, một số kênh chỉ host được post.

Mô hình DD-38 hiện tại:
```
chat_channels.kind ∈ {club, dm}
  club: đúng 1 kênh / tenant  ← chat_channels_club_uq CHẶN kênh chủ đề thứ 2
  dm:   1-1 person↔person
```
⇒ Không thể có Feedback + Announcements + custom cùng lúc trong 1 CLB. Cần mở rộng.

---

## 3. Options data model

| # | Hướng | Ưu | Nhược | Verdict |
|---|---|---|---|---|
| **A** | Thêm `kind='topic'` (kênh chủ đề là kind thứ 3) | "kind" mô tả đủ loại | Phải viết lại CHECK XOR (`kind` giờ 3 nhánh: club-1-shared/topic-N/dm), RLS 2-policy phải xử topic riêng, assistant projector `kind IN ('club','topic')`. Blast radius rộng trên đúng phần đã harden bảo mật. | ⚪ Không chọn |
| **B** | **Giữ `kind='club'`; kênh chủ đề = nhiều row `club`/tenant + cột phân loại** | Tái dùng nguyên RLS/FK/assistant (`kind='club'` không đổi). Chỉ **bỏ 1 unique index** + **thêm cột**. Blast radius nhỏ nhất. | "club" giờ nghĩa là "kênh trong CLB" thay vì "kênh CLB duy nhất" — cần rename khái niệm trong prose (không đụng enum) | ✅ **Chốt** |
| **C** | Bảng riêng `chat_topics` tham chiếu 1 `chat_channels` club | Tách rõ | Thừa: một `club` channel giờ 1-1 với 1 topic → chỉ là cột đội lốt bảng. Thêm join, thêm FK. | ⚪ Không chọn |

**Owner đã ratify Option B.** Kênh chủ đề vẫn là `kind='club'` (tenant-private), chỉ khác: **cho phép N row**/tenant + metadata mô tả kênh.

---

## 4. Schema contract đã chốt (DDL authority vẫn thuộc BE spec + migration)

> DDL/RLS/migration thật thuộc `feature_inapp_chat_tech.md` + `packages/db/schema.ts` + migration khi build. Dưới đây là **delta so với DDL đề xuất hiện có**, để review model — không copy chạy.

**`chat_channels` — bỏ ràng buộc 1/CLB + thêm cột:**
```sql
-- BỎ: cho phép N kênh club/tenant
-- DROP INDEX chat_channels_club_uq;         (không tạo index này nữa trong migration chat)

-- THÊM metadata CLUB-ONLY. Không dùng DEFAULT toàn bảng vì DM phải giữ NULL:
title                     text,
is_default                boolean,
sort_order                int,
created_by_membership_id  uuid,
created_by_person_id      uuid,
post_policy               text,
assistant_enabled         boolean,
-- archived_at đã có sẵn (soft-close)

-- Shape: club có đủ metadata; DM giữ NULL toàn bộ metadata club-only.
CHECK (
  (kind='club'
    AND title IS NOT NULL
    AND is_default IS NOT NULL
    AND sort_order IS NOT NULL
    AND post_policy IN ('all_members','admins_only')
    AND assistant_enabled IS NOT NULL)
  OR
  (kind='dm'
    AND title IS NULL
    AND is_default IS NULL
    AND sort_order IS NULL
    AND created_by_membership_id IS NULL
    AND created_by_person_id IS NULL
    AND post_policy IS NULL
    AND assistant_enabled IS NULL)
);

-- NULL/NULL = system bootstrap; nếu do người tạo thì bind đủ person+membership+tenant.
CHECK ((created_by_membership_id IS NULL) = (created_by_person_id IS NULL));
FOREIGN KEY (created_by_membership_id, created_by_person_id, tenant_id)
  REFERENCES memberships(id, person_id, tenant_id);

-- Chỉ enforce "AT MOST one active default"; exact-one cần lifecycle command bên dưới.
CREATE UNIQUE INDEX chat_channels_default_uq
  ON chat_channels(tenant_id)
  WHERE kind='club' AND is_default IS TRUE AND archived_at IS NULL;
```

**Exact-one active default không thể chỉ dựa partial unique index.** Mọi `create/set-default/archive` phải đi qua một lifecycle owner, khoá tenant row rồi đổi trạng thái trong một transaction:

- `create_club_channel`: RPC tự set giá trị club-only (`is_default=false`, `sort_order`, `post_policy`) và derive `assistant_enabled=true` cho `all_members`, `false` cho `admins_only`; tự promote thành default nếu đây là active club-channel đầu tiên. Sau create, chỉ actor có exact `chat.channel.manage` được đổi flag trên cả hai policy; mọi execution vẫn qua toàn bộ tenant/entitlement/provider/privacy gates.
- `set_default_club_channel`: lock tenant + old/new channel, set old `false` và new `true` atomically; retry cùng command trả cùng kết quả.
- `archive_club_channel`: nếu target là default thì caller phải truyền replacement active channel trong cùng command; không có replacement hợp lệ → fail-closed, không archive.
- Deferred invariant/commit assertion phải chứng minh mỗi tenant đã provision chat có **exactly one** `kind='club' AND archived_at IS NULL AND is_default=true`; unique index chỉ là fence chống hai default đồng thời.

**`chat_members` — không đổi cấu trúc** (PK `(channel_id, person_id)` đã hỗ trợ N kênh; `role` đã có `admin`; `last_read_at` per kênh đã sẵn). Chỉ thay đổi **hành vi provisioning** (§5).

**Adjacent floor — DD-91..95:** DD-91 sở hữu requester-only `/pay`; DD-92 sở hữu reply/immutable structured mention, exact emoji reaction set, bounded own edit, author tombstone và beta-required authorized search; DD-93 sở hữu exact zero-arg slash catalog theo surface; DD-94 sở hữu generic coalesced offline digest không durable item/body; DD-95 sở hữu club-only hide/restore + timed mute. DD-86 không sao chép hoặc thu hẹp các contract này.

---

## 5. Blast radius (đối chiếu từng phần đã harden)

| Thành phần hiện có | Ảnh hưởng khi lên N-channel | Mức |
|---|---|---|
| CHECK XOR `club/dm` (`tech §2 — CHECK XOR`) | **Không đổi** — kênh chủ đề vẫn `kind='club'` (tenant NOT NULL, dm_key NULL) | 🟢 none |
| `chat_channels_club_uq` (1/CLB) | **Bỏ** — partial unique mới chỉ chặn hai active default; lifecycle command + deferred assertion giữ **exactly one** active default/CLB | 🟡 có chủ đích |
| Composite FK `(channel_id, tenant_id)` + `UNIQUE(id, tenant_id)` (`tech §2 — composite FK`) | **Không đổi** — `id` vẫn unique, bind tenant vẫn đúng với N kênh | 🟢 none |
| `chat_bind_tenant` trigger (đóng lỗ FK MATCH SIMPLE NULL) | **Không đổi** — logic set `tenant_id=channel.tenant_id` độc lập số kênh | 🟢 none |
| RLS club policy `chat_current_is_member(id)` (`tech §2 — helper + RLS club policy`) | **Đã chốt:** giữ row `chat_members` per channel và auto-provision mọi active membership vào mọi active club channel; `last_read_at` vẫn per channel | ✅ DD-86-Q2 |
| Assistant projector `kind='club'` (`club_assistant §4`) | **Không đổi trục** — nhưng cần thêm điều kiện `assistant_enabled` để bot không trả lời ở kênh tắt bot | 🟡 thêm 1 predicate |
| DM path (dm_key, 2-member guard, safety DD-55) | **Không đổi** — multi-channel chỉ đụng nhánh `club` | 🟢 none |
| Public plane | **Không đổi** — chat không bao giờ vào `public_sessions` (NFR-S2) | 🟢 none |

### 5.1 Sub-decision đã chốt: membership per-channel

`last_read_at`/badge chưa đọc **bắt buộc** per (kênh, person). Vậy dù mô hình "ai cũng thấy mọi kênh", vẫn cần row `chat_members`/kênh để giữ read-state. Đã chốt:

- **Phase-1:** mọi membership `status='active'` của CLB được **auto-provision** `chat_members` row cho mọi active `kind='club'` channel (`archived_at IS NULL`). Không tham chiếu `private` vì enum phase-1 chưa có giá trị đó. Tạo kênh mới → channel + toàn bộ row member commit cùng transaction; một row lỗi thì rollback cả channel, không để kênh partial-visible. Membership chuyển sang `active` → canonical membership lifecycle chèn idempotent (`ON CONFLICT DO NOTHING`) vào mọi active club-channel; chuyển `left` vẫn mất quyền tức thì nhờ helper re-check `memberships.status`.
- **Phase sau:** kênh riêng/subset (chỉ một số member) — lúc đó `chat_members` đã là nguồn membership per-channel sẵn sàng, không phải đổi model.

---

## 6. Overlap với Announcements (DD-71) — phân định rõ

Ảnh có kênh **"Announcements"**. Đừng nhầm với feature **Announcement broadcast (DD-71)**:

| | Kênh "Announcements" (DD-86) | Announcement broadcast (DD-71) |
|---|---|---|
| Bản chất | Một **chat channel** `kind='club'`, `post_policy='admins_only'` | **Fan-out** host→member qua nhiều kênh (in-app + push/Zalo/Messenger) |
| Lưu ở | `chat_messages` | Canonical `announcements` + audience/preferences/quota reservation; dispatch mới materialize `notification_intents` + delivery/attempt ledger |
| Đọc | Trong tab chat của CLB | Inbox thông báo hợp nhất (DD-70) + kênh ngoài |
| Ràng buộc | Chỉ admin post; member đọc | Proof-bound preview→confirm (không undo), quota, free + host_pro |

**Đã chốt:** kênh "Announcements" = nơi **hiển thị/lưu** thông báo dạng chat trong app; nếu host muốn **fan-out ra ngoài** (push/Zalo) thì đó là DD-71. Có thể (phase sau) nối một announcement DD-71 vào kênh Announcements. **Phase-1 giữ tách** — kênh Announcements chỉ là club channel admins-only, không tự fan-out, không tạo durable notification item theo từng message.

---

## 7. Per-channel authz / post permission

- **Không dùng `chat_members.role='admin'` làm tenant-admin authority.** DD-56 bắt buộc một registry action→capability canonical; `chat_members.role` chỉ là channel-local metadata/read-state và không tự cấp quyền quản trị tenant.
- **Post permission** enforce ở `send_chat_message` RPC (choke-point proposal tại `tech §2 — send_chat_message`): `all_members` cần active channel membership; `admins_only` cần exact capability `chat.channel.post_restricted`. Resolver unavailable/unknown action/missing-or-expired grant → fail-closed. Announcements vẫn readable cho member nhưng chỉ actor có capability mới post.
- **Tạo/sửa/archive/set-default** đi qua RPC `SECURITY DEFINER` hẹp và exact action `chat.channel.manage`; actor/person lấy từ web session, tenant derive từ canonical channel, không nhận role/tenant authority từ body. Các câu `REVOKE` ở tech spec hiện là **contract proposal**, chưa phải runtime vì migration chat chưa tồn tại.
- **Tạo kênh phase-1:** chỉ actor có `chat.channel.manage`; member-create không có capability này và được defer.
- **Adjacent moderation v1 theo DD-95/CHT-OQ-2:** `chat.message.moderate` chỉ cho soft-hide/restore human-authored club message bằng tombstone, reason bắt buộc + immutable audit; `chat.member.mute` chỉ cho timed mute theo channel. Hai capability này thuộc DD-95, không thuộc lifecycle owner DD-86; chúng không bao giờ cấp quyền đọc/moderate human DM và không mở hard delete, content edit, permanent ban hay system-message moderation.

---

## 8. Bất biến phải giữ (không được regress)

1. **RLS fail-closed cô lập tenant** — kênh chủ đề CLB A không đọc được từ CLB B. Test A≠B giữ nguyên (N kênh không nới predicate tenant).
2. **DM vẫn person-self đúng 2 người** — nhánh `dm` không đổi.
3. **Chat không ra public** — không kênh nào vào `public_sessions`.
4. **Bot chỉ ground KB đã qua DLP** (DD-21) — multi-channel không nối ledger/PII vào LLM; bot vẫn config tenant, phát `author_type='assistant'`.
5. **Không multi-master** — send/tạo kênh/announcement đều qua command→RPC→(outbox/NOTIFY); không writer thứ hai.
6. **i18n** — tên kênh do host nhập (data, không cần dịch); mọi chuỗi hệ thống qua `t(vi,en)`.
7. **Idempotency** — `client_msg_id` UNIQUE per channel giữ nguyên. Mọi create/rename/archive/set-default nhận actor-scoped UUID `Idempotency-Key`; receipt bind `(tenant_id, actor_person_id, command_id, action, canonical_fingerprint)`. Same key+same fingerprint trả fixed result; mismatch reject trước mutation.

---

## 9. Bot @mention per channel — đã fit sẵn

Vì bot là **config tenant** (`bot_configs` 1/tenant) và projector authorize bằng `chat_members` rồi phát vào `kind='club'`, việc có **N kênh club** **không** đụng model bot/KB:
- @mention bot ở bất kỳ kênh `kind='club'` nào của CLB → cùng một KB tenant trả lời.
- `chat_channels.assistant_enabled` được server derive mặc định **`true` cho `post_policy='all_members'`** và **`false` cho `post_policy='admins_only'`**. Chỉ actor có `chat.channel.manage` mới được đổi flag trên cả hai policy. Dù flag là `true`, persist/project/consume chỉ được chạy khi đồng thời tenant config enabled + exact entitlement `assistant_ai_kb` + provider/privacy/cap gates đều PASS; unknown/unavailable ở bất kỳ gate nào = không gọi provider, không phát câu trả lời.
- KHÔNG cần bot/KB per-channel (một KB/CLB vẫn đúng DD-16).

⇒ Phần "mỗi channel tag được bot" trong hướng của anh **không tốn thiết kế mới** ngoài 1 cột flag.

---

## 10. Sequencing

1. Commit/re-pin authority baseline + analysis/spec mirrors để có immutable SHA.
2. DD-55 DM-safety contract trong exact Chat Product/BE authority pack đã Reviewed: finite block/report/rate/audit FSM, exact storage/idempotency/retention, pure `dm_safety_enabled`/`chat_pair_blocked` và side-effect `assert_dm_allowed`; không còn docs-only packet riêng phải author.
3. First runtime slice sau immutable re-pin: `chat-definer-role-provisioning` với exact NOLOGIN/BYPASSRLS attributes, grants/membership và production-role verification; không tạo chat tables.
4. Land `chat-dm-safety-authority-core`: một migration monotonic độc lập với `chat_*` tạo safety storage + pair/rate/audit primitives và exact grants/tests; không tạo chat tables/API/UI.
5. ✅ **Đã đóng:** owner ratify DD-86/DD-91..95; cặp In-app Chat, Club Assistant, Notifications và Tenant Routing/Authz Product/BE đã được promote sang Reviewed với contract + acceptance matrix cuối. DD-88 giữ đúng trạng thái broader `DEFERRED_PROPOSAL`.
6. **Root migration slice** `dd38-dd86-chat-schema-core` chỉ sở hữu final N-channel `chat_channels/chat_members/chat_messages` DDL/constraints/triggers → pure chat-specific membership/DM read adapters → RLS/policies → read-helper owner/grants; moderation/mute/notification/capability storage đều ngoài root. Root tiêu thụ safety primitives đã land nhưng không alter/re-own chúng; **không được tạo/grant** `create_dm`, `send_chat_message`, `mark_read`, command HTTP/RPC hay route.
7. Land `tenant-capability-authority-core`: owner cross-feature duy nhất của closed DD-56 registry, cùng least-privilege preset cho `admin|co_admin`, tenant/person resolver, tenant-private expiring/revocable grant-read storage, append-only grant audit và fail-closed `authorize`. Capability semantics độc lập với Chat schema, nhưng **actual DB worktrees 1→2→3→4 phải serialize** vì cùng chạm migration tail, `packages/db/schema.ts`, DB catalog/schema/authz tests. Bốn exact Chat keys nằm trong preset; Chat không tạo registry riêng. Sensitive grant/revoke command/UI có thể là follow-up, nhưng không được trì hoãn core read/authorize.
8. Sau serialized DB lane, actual dependency là `chat-club-channel-lifecycle-core → chat-authorized-member-target-read-core → chat-club-moderation-core → chat-shared-message-command-core → chat-dm-lifecycle-command-core`: target core sở hữu short-lived requester+channel-bound opaque DTO + consume-time resolver cho mention/mute/start-DM; moderation land dark và sở hữu duy nhất mute/moderation storage + writers/audit; shared chỉ đọc current mute state và sở hữu send/history/mark-read + atomic reply/mention; DM lifecycle sở hữu duy nhất `create_dm`/reuse/block/report. Catalog ID 9 vẫn ổn định nhưng phải chạy trước 6/7/8; root **không** đợi migration DD-38 one-channel rồi fold DD-86 và không để consumer chạy trước guard.
9. Channel management/restricted-post/moderation/mute RPC là consumer sau root+capability join; nếu canonical DD-56 core chưa live, route/RPC user-facing phải negative-scope/OFF, không fallback sang raw `role='admin'`.
10. Club Assistant pha B chỉ land sau canonical chat root migration; DD-18 vẫn là enablement-only gate cho provider/go-live. Assistant/Notification/DD-88 không chặn root migration.

DD-86 mở rộng mô hình DD-38 và tham chiếu DD-71/DD-16..28/DD-79; không đụng đường tiền.

---

## 11. Ratified answers — DD-86-Q1..Q10

| ID | Câu hỏi | Quyết định cuối | Trạng thái |
|---|---|---|---|
| DD-86-Q1 | Kênh chủ đề = `kind='club'` + cột (Option B) hay `kind='topic'` mới (A)? | **Option B** | ✅ `DECISION_FINAL` |
| DD-86-Q2 | Membership: auto-join mọi kênh (phase-1) hay per-channel join? | Auto-join mọi active member vào mọi active club channel; private/subset defer | ✅ `DECISION_FINAL` |
| DD-86-Q3 | "Announcements" là chat channel (admins_only) hay chỉ luồng DD-71? | Chat channel `admins_only`, tách DD-71; không materialize DD-71 fan-out hoặc durable item/message source. Offline digest là delivery-only theo DD-94 | ✅ `DECISION_FINAL` |
| DD-86-Q4 | Ai được tạo kênh phase-1? | Chỉ actor có `chat.channel.manage`; member-create defer | ✅ `DECISION_FINAL` |
| DD-86-Q5 | Kênh có shareable URL (vào slug registry DD-83) không? | Không phase-1; không public/shareable slug/URL | ✅ `DECISION_FINAL_NEGATIVE_SCOPE` |
| DD-86-Q6 | Bot bật/tắt per kênh (`assistant_enabled`) mặc định? | Server derive true cho `all_members`, false cho `admins_only`; exact `chat.channel.manage` được đổi trên cả hai; luôn AND tenant config/entitlement/provider/privacy/cap gates, unknown deny | ✅ `DECISION_FINAL` |
| DD-86-Q7 | Authority cho lifecycle kênh và restricted post là gì? | DD-86 sở hữu exact `chat.channel.manage` + `chat.channel.post_restricted`; unknown/unavailable/missing/expired deny. Moderation/mute thuộc duy nhất DD-95 | ✅ `DECISION_FINAL` |
| DD-86-Q8 | Exact-one default tồn tại qua create/set/archive/concurrency thế nào? | Tenant lock + atomic replacement + deferred commit assertion; archived default không được tính | ✅ `DECISION_FINAL` |
| DD-86-Q9 | Idempotency create/rename/archive/set-default? | Actor-scoped UUID command receipt + canonical fingerprint | ✅ `DECISION_FINAL` |
| DD-86-Q10 | Audit creator shape? | `(created_by_membership_id, created_by_person_id, tenant_id)` composite FK; NULL/NULL chỉ system bootstrap | ✅ `DECISION_FINAL` |

---

## 12. Decision mirror cuối cho `decisions.md`

> `decisions.md` là canonical registry; block dưới đây là mirror của quyết định đã ratify, không phải proposal mới.

```
## DD-86 — In-app multi-channel per CLB (kênh theo chủ đề) · ✅ Chốt

Bối cảnh: mô hình In-app Chat (DD-38) khoá đúng 1 kênh club/CLB (chat_channels_club_uq).
Hướng sản phẩm: mỗi CLB có N kênh theo chủ đề (Main/Feedback/Announcements/host tạo thêm),
mỗi kênh @mention được Club Assistant (DD-16..28).

Quyết định: Option B — giữ kind='club', bỏ chat_channels_club_uq, cho N kênh club/tenant;
metadata club-only/DM-NULL; exact-one active default do tenant-locked lifecycle command +
deferred assertion; creator bind composite membership+person+tenant; auto-provision active
member per channel. Post/manage dùng DD-56 capability registry (`chat.channel.manage`,
`chat.channel.post_restricted`), không dùng `chat_members.role` làm tenant authority.
Moderation/mute là adjacent contract do DD-95 sở hữu, không phải lifecycle contract của DD-86.
Unknown/unavailable/missing/expired capability luôn deny.

Bất biến giữ nguyên: RLS tenant fail-closed, DM person-self, chat không ra public,
bot chỉ ground KB đã DLP (DD-21), không multi-master, i18n.

Quan hệ: phụ thuộc DD-38; tách với DD-71 (announcement broadcast) phase-1; bot = config
tenant (DD-20), 1 KB/CLB (DD-16) — multi-channel không đụng model bot/KB. assistant_enabled
mặc định true cho all_members, false cho admins_only; exact chat.channel.manage được đổi trên
cả hai policy và consume-time luôn AND mọi gate. DD-91 sở hữu requester-only /pay; DD-92
sở hữu reply/mention/reaction/edit/delete/search; DD-93 slash catalog; DD-94 digest delivery-only;
DD-95 club-only moderation. Không durable notification item per chat message.

Open in scope: 0. Trạng thái: ✅ DECISION_FINAL · không migration · không đổi code-readiness.
```

---

## 13. Snapshot pin + readiness verdict (theo `review-code-readiness-gate` v1.3)

> Doc này là **decision-analysis tier**. DD-86 đã `DECISION_FINAL`; verdict dưới đây áp gate lên **execution pack**, không phải phủ nhận quyết định và không cấp phép code.

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: PLAN_READY
REVIEWED_AT: 2026-07-28
AUTHORITY_SHA: 90d292d85fbe92db7a5afcd118a99e28f3d3b3b7
BASE_BRANCH: main
BASE_REMOTE_RELATION: MAIN_EQUALS_ORIGIN_MAIN
PRIOR_SNAPSHOT: 2dc9b8c760c3b437af08ca1fc5fcbaea1492ad39; delta = this 27-file authority pack only
WORKTREE_STATE: AUTHORITY_PACK_COMMITTED_AND_PUSHED  # 90d292d contains exactly the 27 TARGET_FILES; 73 unrelated WIP files stay outside the baseline
TARGET_FILES:
  - docs/proposals/in-app-chat-primary-player-surface-plan-2026-07-27.md
  - docs/decisions/analysis/dd-86-in-app-multi-channel-analysis.md
  - docs/features/feature_inapp_chat.md
  - docs/features/BE/feature_inapp_chat_tech.md
  - docs/features/BE/feature_club_assistant_tech.md
  - docs/features/feature_club_assistant.md
  - docs/features/feature_player_view.md
  - docs/features/BE/feature_player_view_tech.md
  - docs/features/feature_notifications_reminders.md
  - docs/features/BE/feature_notifications_reminders_tech.md
  - docs/features/feature_tenant_routing_authz.md
  - docs/features/BE/feature_tenant_routing_authz_tech.md
  - docs/features/README.md
  - docs/proposals/club-ai-bot-knowledge-base.md
  - docs/proposals/plexco-global-kb-and-kb-autosync.md
  - docs/proposals/notification-grouping.md
  - docs/product/BRD.md
  - docs/product/PRD.md
  - docs/product/TDD.md
  - docs/product/ROADMAP.md
  - docs/README.md
  - docs/00-start-here/HANDOFF.md
  - docs/autopilot-backlog.md
  - docs/standards/decisions.md
  - docs/standards/feature-dependency-graph.md
  - docs/standards/business-rules.md
  - docs/standards/BUILD-STATUS.md
SLICE: inapp-chat-primary-player-surface-plan (DD-86 decision-final authority)
IN_SCOPE: DD-86 multi-channel model plus DD-91..95 player-primary Chat/Assistant/slash/notification/authz execution contract and dependency-ordered slices
OUT_OF_SCOPE: runtime implementation; external chat bridge; E2EE/voice/video; public/subset channels; LLM-selected money/session tools; unowned host-money commands
G1_DECISION: PASS            # DD-86-Q1..Q10 + DD-91..95 đã owner-ratify; không còn product choice trong scope
G2_SPEC: PASS                # In-app Chat Product/BE pair Reviewed với exact storage/authz/acceptance
G3_DEPENDENCY: PASS          # actual DB worktrees serialize 1→2→3→4; capability semantics remain independent; one-owner consumers follow
G4_TEST: PASS                # full happy/boundary/auth/failure/concurrency/migration/security/regression/observability matrix pinned
G5_SCOPE: PASS               # bounded slice catalog + explicit root/safety §B3 ceilings/compatibility proof đã pin
G6_EXTERNAL: ENABLEMENT_ONLY:DD-18-provider-privacy-ToS;DD-72-Web-Push-user-consent;DD-94-digest-timing-config;MEDIA-private-object-storage-region-credentials;MEDIA-malware-moderation-scanner;DD-55-DM-media-report-bounded-config
HARD_DEPENDENCIES: exact 27-file authority pack contains DD-86 + DD-91..95 ratification and Reviewed Chat/Assistant/Notification/Tenant-Authz contracts; memberships/persons/tenants/tenant_admins/outbox/job substrate MERGED; missing DD-56, Chat/Assistant/Player/Notification/Web-Push runtime and product delivery are fully ordered and owned by bounded mechanism slices 1-47, thin API slices A1-A21 and tracked-design FE slices F0-F15; /sessions|/waitlist beta additionally requires strict current-authority svc-session-crud, svc-session-join-leave and svc-waitlist-promotion-core packets plus production-shaped data E2E
PRIOR_SLICES: immutable authority commit/re-pin -> serialized DB lane chat-definer-role-provisioning -> chat-dm-safety-authority-core -> dd38-dd86-chat-schema-core -> tenant-capability-authority-core -> chat-club-channel-lifecycle-core -> chat-authorized-member-target-read-core -> chat-club-moderation-core -> chat-shared-message-command-core; catalog IDs remain stable but actual worktree order follows explicit dependencies; every later BE/worker/client/FE slice requires its own strict CODE_READY
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: DD-18 provider/privacy/ToS for Assistant; Web Push permission/device evidence; DD-94 measured timing/coalescing config; private object-storage region/credentials; malware/moderation scanner; bounded DM/media/report numeric config; current Session producer packets and data E2E for /sessions|/waitlist; real payment/reconciliation producer E2E for payment Inbox/push
LIVE_REPO_VERIFICATION: PASS # verified at 90d292d; chat_* and DD-56 registry/grant/authorize runtime absent
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS — 12/12; row 1 closed by immutable commit 90d292d (see plan §13.1 for per-row evidence)
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS  # full fail-closed contracts/negative scope pinned; runtime proof remains separate
IMPLEMENTATION_ARTIFACTS: NOT_REQUIRED_FOR_PLAN_READY — primary plan §9.2 pins a B1-B3-equivalent first-slice packet; gate B4 autopilot doc/manifest/launcher/worktree/scope-gate are owed by the slice-local CODE_READY verdict
FIRST_IMPLEMENTATION_STEP: author the chat-definer-role-provisioning readiness packet and take it through its own strict CODE_READY; no worktree before that verdict
REMAINING_BLOCKERS: none
```

**Diễn giải:** DD-86 và DD-91..95 đã **DECISION_FINAL**, `OPEN_QUESTIONS_IN_SCOPE=0`, Chat/Assistant/Player View/Notification/Tenant-Authz contracts đã Reviewed và execution DAG/acceptance/scope đã đóng nội dung. Exact 27-file target pack nay nằm trong immutable commit `90d292d` trên `origin/main`, đóng nốt closure row 1 → execution đạt **`PLAN_READY`**.

`PLAN_READY` **không** đồng nghĩa `CODE_READY`. `chat_*` và DD-56 capability runtime vẫn chưa có trên `main`; docs không phải runtime proof. Mỗi slice phải tự đạt strict `CODE_READY` trước khi mở worktree, bắt đầu từ `chat-definer-role-provisioning`.

---

## Changelog

| Ngày | Version | Thay đổi |
|---|---|---|
| 2026-07-28 | v1.2 | **`NOT_PLAN_READY` → `PLAN_READY`.** Blocker duy nhất còn lại — 27-file authority pack chưa nằm trong commit bất biến — đã đóng bằng `90d292d` (đúng 27 file, 0 file lạ, đã push `origin/main`). Re-pin `AUTHORITY_SHA` `2dc9b8c` → `90d292d`, thêm `PRIOR_SNAPSHOT`, `CLOSURE_MATRIX` `PARTIAL 11/12` → `PASS 12/12`, `REMAINING_BLOCKERS` → `none`, bỏ `NEXT_REVIEW_TRIGGER`. Hạ `IMPLEMENTATION_ARTIFACTS` → `NOT_REQUIRED_FOR_PLAN_READY` (§9.2 chỉ tương đương B1–B3; B4 do slice-local `CODE_READY` nợ). Không đổi decision, không runtime/migration, không authorize code. |
| 2026-07-28 | v1.1 | Reconcile DD-91..95 owner-final: Assistant defaults true `all_members`/false `admins_only`, interaction/edit/search, exact slash catalog, generic digest và club moderation. Semantic freeze orders DD-95 storage/writers before shared send and keeps reply/mention solely in shared writer; mechanism IDs match plan/graph/BE. DD-88 là broader proposal. Content gates G1–G5/acceptance/security PASS; execution còn `NOT_PLAN_READY` chỉ vì immutable-authority commit/re-pin gate. Không runtime/migration. |
| 2026-07-28 | v1.0 | Reconcile owner-final authority v2.10: Q6 Assistant storage default OFF, explicit admin opt-in/all gates và Announcements always-OFF; Q7 pin đủ bốn exact capabilities. Chat v1 giữ reply/structured mention/closed reactions, exact lowercase `/help|/sessions|/pay`, tombstone/timed mute và no edit/search/offline digest. Preserve Chat Reviewed + `OPEN_QUESTIONS_IN_SCOPE=0`; add Assistant Draft blocker; không runtime/migration. |
| 2026-07-28 | v0.9 | Owner ratify Option B và DD-86-Q1..Q10; close CHT-OQ-2, message floor, exact lowercase slash v1 và no-digest/no-per-message-notification defaults. Pin four exact Chat capabilities, Assistant default OFF/admin opt-in/Announcements OFF. Promote Chat Product/BE contract to Reviewed, set G1/G2/G4 + contract/acceptance PASS and open count 0; execution remains `NOT_PLAN_READY` for safety/provisioning artifacts, immutable SHA and measured scope. No runtime/migration. |
| 2026-07-27 | v0.8 | Resolve sequencing/ownership contradiction: standalone safety contract → definer provisioning → safety authority can proceed before/in parallel with DD-86 closure; root waits for both branches. Root owns only final N-channel tables + pure DM read adapter/RLS/read grants; create/reuse/send/mark-read remain post-root owners. Verdict remains `NOT_PLAN_READY` with 9 DD-86 questions. |
| 2026-07-27 | v0.7 | Re-pin live `main==origin/main@2dc9b8c`. Delta `81b4fe8..2dc9b8c` chỉ cập nhật readiness artifacts cho slice DB constraint-naming, không chạm Chat/Assistant/payment contracts hay runtime nên không đổi blast radius, 9 open questions hoặc verdict `NOT_PLAN_READY`. |
| 2026-07-27 | v0.6 | **Historical dependency-order draft (superseded by v0.8):** introduced the independent DM-safety contract, exact `chat_definer` provisioning and standalone safety-authority migration before the root join. v0.8 replaces its broad root/adapters wording with the current two-branch join and one-owner root/post-root split. Assistant/Notification/DD-88 do not block root; verdict remained `NOT_PLAN_READY`. |
| 2026-07-22 | v0.5 | **Ref-durability fix:** đổi mọi line-number citation (`§1`/§5/§7 trỏ `feature_inapp_chat_tech.md:NN`, `feature_club_assistant.md:NN`) sang **symbol/section anchor** vì tech spec bị chèn dòng (line-ref cũ đã drift ~+11). Claim không đổi, chỉ con trỏ; tránh drift tiếp khi spec thay đổi. Không đổi product direction/readiness state/verdict. |
| 2026-07-22 | v0.4 | Nâng persisted verdict lên machine contract v1.3: classification `enforce`, `REVIEW_POLICY_VERSION`, `CLOSURE_MATRIX`; không đổi product direction hay readiness state. |
| 2026-07-22 | v0.3 | **Review-fix closure:** sửa schema club-only vs DM-NULL; creator composite FK; exact-one active default lifecycle; auto-provision atomic; DD-56 capability authority; mutation idempotency; DD-71 storage owner; Assistant flag AND tenant gates; phân loại Q1..Q10 (Q5 deferred); sửa dependency graph thành root `dd38-dd86-chat-schema-core`; verdict pin đúng dirty-worktree boundary và giữ **NOT_PLAN_READY**. Mirror proposal-safe vào decisions/Chat/Assistant/index; không runtime/migration. |
| 2026-07-21 | v0.2 | **Áp `review-code-readiness-gate` v1.1 + template v1.0:** thêm §13 snapshot pin (`AUTHORITY_SHA ad10194`, base `main`) + canonical verdict block = **NOT_PLAN_READY** (G1 FAIL owner-decision mở, G3 FAIL `chat_*` chưa trên main). Ghi rõ analysis tier tách khỏi readiness-verdict file (precedent dd-82). Không đổi nội dung phân tích §0–§12. |
| 2026-07-21 | v0.1 | Khởi tạo analysis: đối chiếu hướng "multi-channel + club bot" với canonical (DD-38 chat / DD-16..28 assistant / DD-71 announcement); xác định net-new = bỏ 1-club-channel/tenant; đề xuất Option B (giữ `kind='club'` + cột), blast radius, overlap DD-71, per-channel authz, bất biến, sequencing, 6 open questions và block DD-86 đề xuất. **Analysis/proposal only — chưa chốt, chưa migration, chưa sửa spec Reviewed/schema.** |
