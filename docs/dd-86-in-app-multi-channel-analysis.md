<!-- review-readiness: enforce -->
# 💬 DD-86 Analysis — In-app **multi-channel per CLB** (kênh theo chủ đề kiểu Messenger community)

> **Mục đích:** chốt hướng data model cho việc mỗi CLB có **nhiều kênh chat theo chủ đề** (Main / Feedback / Announcements / host tự tạo thêm), thay vì đúng **1 kênh club/CLB** như mô hình DD-38 hiện tại. Mỗi kênh vẫn @mention được **Club Assistant** (bot đã feed KB) để trả lời câu hỏi.
> **Ngày:** 2026-07-22 · **Trạng thái:** 🟡 **Analysis / proposal** — CHƯA phải spec Reviewed hay implementation authority. DD-86 được mirror vào `decisions.md` ở trạng thái **🟡 proposal**; các spec Draft chỉ ghi **conditional delta**, KHÔNG coi là contract active trước owner ratification. §13 ghi verdict review của chính doc pack, không cấp phép code.
> **Canonical đối chiếu:** `docs/features/BE/feature_inapp_chat_tech.md` (DDL đề xuất chat `chat_*`, RLS 2-policy) · `docs/features/feature_inapp_chat.md` (DD-38) · `docs/features/feature_club_assistant.md` + `docs/proposals/club-ai-bot-knowledge-base.md` (bot+KB) · `decisions.md` DD-38/DD-55/DD-16..28/DD-71/DD-79/DD-83 · `packages/db/schema.ts` (**AUTHORITATIVE** khi build; `chat_*` HIỆN CHƯA có trong đây) · HANDOFF §3 (5 HARD RULES).
> **Lưu ý tên:** "channel" ở doc này = **kênh chat trong app Plexco theo chủ đề** (in-app topic channel). KHÁC hoàn toàn `docs/channels/` (= adapter nền tảng ngoài: Zalo/Messenger/web). Đừng trộn hai khái niệm.

---

## 0. TL;DR — đề xuất hướng (chưa chốt, chờ owner)

**Bối cảnh:** hướng sản phẩm anh mô tả gần như đã có spec:
- *Bot tag được + feed KB để trả lời* = **Club Assistant + KB** (DD-16/17/19–23/28 ✅; DD-18 provider ⬜ = gate go-live). Không phải làm lại.
- *Kênh chat trong CLB* = **In-app Chat** (DD-38 ✅, Draft, pending migration).

**Điểm net-new duy nhất cần chốt:** mô hình chat hiện tại khoá **đúng 1 kênh `club`/CLB** (unique index `chat_channels_club_uq`). "Nhiều kênh theo chủ đề" là **mở rộng data model** → cần DD mới.

**Đề xuất (Option B — thêm cột phân loại, giữ nguyên trục `kind`):**
- Giữ `chat_channels.kind ∈ {club, dm}` **không đổi** (không phá RLS/composite-FK/assistant projection đã thiết kế). Một kênh chủ đề của CLB **vẫn là `kind='club'`** (tenant-private).
- **Bỏ** unique index `chat_channels_club_uq` (ràng buộc 1-kênh/CLB) → cho **N kênh `club`/tenant**.
- Thêm metadata club-only: `title`, `sort_order`, `is_default` (Main pinned), `created_by_membership_id` + `created_by_person_id`, `post_policy` (`all_members` | `admins_only` cho Announcements), `assistant_enabled`; `archived_at` tiếp tục là lifecycle soft-close.
- **Membership per-channel:** giữ `chat_members` là 1 row/(channel, person) — vì `last_read_at`/badge chưa đọc vốn phải theo từng kênh. Phase-1: **auto-provision** member vào mọi kênh không hạn chế của CLB (kênh riêng/subset = phase sau).
- **Announcements** = một kênh `post_policy='admins_only'`, **KHÔNG** thay thế feature Announcement broadcast (DD-71) — hai thứ khác nhau (§6).

**Vì sao Option B, không phải "thêm `kind` mới":** thêm `kind='topic'` sẽ buộc viết lại toàn bộ CHECK XOR (`club⇔tenant NOT NULL`/`dm⇔dm_key`), RLS 2-policy, và assistant projector (`kind='club'`). Giữ `kind='club'` + thêm cột phân loại **giữ nguyên mọi bất biến bảo mật đã harden**, blast radius nhỏ nhất.

**Sequencing (quan trọng):** `chat_*` **chưa vào migration**. Nên **chốt DD-86 TRƯỚC khi author migration chat DD-38**, để schema ship sẵn N-channel-ready — tránh phải migration lần 2 để drop unique index + thêm cột (giống cách DD-82 phải chốt trước DD-41 migrate).

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
| `chat_*` (channels/members/messages + safety) **CHƯA tồn tại trong `packages/db/migrations/`** — DD-38 Draft, pending migration | `feature_inapp_chat_tech.md` §2 — Migration & Rollback note |
| DD-71 Announcement = host→member **broadcast/fan-out** (proof-bound preview/confirm, quota, free + host_pro), **không phải** một chat channel | `decisions.md` DD-71 |
| Nav app có header 💬 chat (DD-79 Home hub, S9) | `decisions.md` DD-79 · `feature_home.md` |
| Số DD kế tiếp còn trống = **DD-86** (83/84/85 đã dùng) | `decisions.md` grep DD-8x |

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
| **B** | **Giữ `kind='club'`; kênh chủ đề = nhiều row `club`/tenant + cột phân loại** | Tái dùng nguyên RLS/FK/assistant (`kind='club'` không đổi). Chỉ **bỏ 1 unique index** + **thêm cột**. Blast radius nhỏ nhất. | "club" giờ nghĩa là "kênh trong CLB" thay vì "kênh CLB duy nhất" — cần rename khái niệm trong prose (không đụng enum) | ✅ **Đề xuất** |
| **C** | Bảng riêng `chat_topics` tham chiếu 1 `chat_channels` club | Tách rõ | Thừa: một `club` channel giờ 1-1 với 1 topic → chỉ là cột đội lốt bảng. Thêm join, thêm FK. | ⚪ Không chọn |

**Đề xuất B; chưa phải owner decision.** Kênh chủ đề vẫn là `kind='club'` (tenant-private), chỉ khác: **cho phép N row**/tenant + metadata mô tả kênh.

---

## 4. Schema delta đề xuất (KHÔNG phải DDL authority — chỉ hướng)

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

- `create_club_channel`: RPC tự set giá trị club-only (`is_default=false`, `sort_order`, `post_policy`, `assistant_enabled`) và tự promote thành default nếu đây là active club-channel đầu tiên.
- `set_default_club_channel`: lock tenant + old/new channel, set old `false` và new `true` atomically; retry cùng command trả cùng kết quả.
- `archive_club_channel`: nếu target là default thì caller phải truyền replacement active channel trong cùng command; không có replacement hợp lệ → fail-closed, không archive.
- Deferred invariant/commit assertion phải chứng minh mỗi tenant đã provision chat có **exactly one** `kind='club' AND archived_at IS NULL AND is_default=true`; unique index chỉ là fence chống hai default đồng thời.

**`chat_members` — không đổi cấu trúc** (PK `(channel_id, person_id)` đã hỗ trợ N kênh; `role` đã có `admin`; `last_read_at` per kênh đã sẵn). Chỉ thay đổi **hành vi provisioning** (§5).

**`chat_messages` — không đổi cấu trúc.** Post permission enforce ở **send RPC** (§7), không phải cột mới trên message.

---

## 5. Blast radius (đối chiếu từng phần đã harden)

| Thành phần hiện có | Ảnh hưởng khi lên N-channel | Mức |
|---|---|---|
| CHECK XOR `club/dm` (`tech §2 — CHECK XOR`) | **Không đổi** — kênh chủ đề vẫn `kind='club'` (tenant NOT NULL, dm_key NULL) | 🟢 none |
| `chat_channels_club_uq` (1/CLB) | **Bỏ** — partial unique mới chỉ chặn hai active default; lifecycle command + deferred assertion giữ **exactly one** active default/CLB | 🟡 có chủ đích |
| Composite FK `(channel_id, tenant_id)` + `UNIQUE(id, tenant_id)` (`tech §2 — composite FK`) | **Không đổi** — `id` vẫn unique, bind tenant vẫn đúng với N kênh | 🟢 none |
| `chat_bind_tenant` trigger (đóng lỗ FK MATCH SIMPLE NULL) | **Không đổi** — logic set `tenant_id=channel.tenant_id` độc lập số kênh | 🟢 none |
| RLS club policy `chat_current_is_member(id)` (`tech §2 — helper + RLS club policy`) | **Cần quyết**: hiện yêu cầu **row `chat_members`**. Với auto-join-all, hoặc (a) auto-provision row mỗi kênh, hoặc (b) đổi helper sang "active membership của tenant". Đề xuất **(a)** — vì `last_read_at` phải per kênh dù sao | 🟡 quyết ở §5.1 |
| Assistant projector `kind='club'` (`club_assistant §4`) | **Không đổi trục** — nhưng cần thêm điều kiện `assistant_enabled` để bot không trả lời ở kênh tắt bot | 🟡 thêm 1 predicate |
| DM path (dm_key, 2-member guard, safety DD-55) | **Không đổi** — multi-channel chỉ đụng nhánh `club` | 🟢 none |
| Public plane | **Không đổi** — chat không bao giờ vào `public_sessions` (NFR-S2) | 🟢 none |

### 5.1 Sub-decision: membership per-channel

`last_read_at`/badge chưa đọc **bắt buộc** per (kênh, person). Vậy dù mô hình "ai cũng thấy mọi kênh", vẫn cần row `chat_members`/kênh để giữ read-state. Đề xuất:

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

**Đề xuất phân định:** kênh "Announcements" = nơi **hiển thị/lưu** thông báo dạng chat trong app; nếu host muốn **fan-out ra ngoài** (push/Zalo) thì đó là DD-71. Có thể (phase sau) nối: một announcement DD-71 **cũng** project một `chat_messages` vào kênh Announcements. **Phase-1 giữ tách** — kênh Announcements chỉ là club channel admins-only, không tự fan-out. → **Open question DD-86-Q3.**

---

## 7. Per-channel authz / post permission

- **Không dùng `chat_members.role='admin'` làm tenant-admin authority.** DD-56 bắt buộc một registry action→capability canonical; `chat_members.role` chỉ là channel-local metadata/read-state và không tự cấp quyền quản trị tenant.
- **Post permission** enforce ở `send_chat_message` RPC (choke-point proposal tại `tech §2 — send_chat_message`): `all_members` cần active channel membership; `admins_only` cần exact capability `chat.channel.post_restricted`. Resolver unavailable/unknown action/missing-or-expired grant → fail-closed. Announcements vẫn readable cho member nhưng chỉ actor có capability mới post.
- **Tạo/sửa/archive/set-default** đi qua RPC `SECURITY DEFINER` hẹp và exact action `chat.channel.manage`; actor/person lấy từ web session, tenant derive từ canonical channel, không nhận role/tenant authority từ body. Các câu `REVOKE` ở tech spec hiện là **contract proposal**, chưa phải runtime vì migration chat chưa tồn tại.
- **Ai được tạo kênh:** host/admin mặc định; "member tạo chat" (như nút Create chat trong ảnh) = **open question DD-86-Q4** (có thể mở cho member nhưng cần rate-limit + moderation).

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
- Thêm cột `chat_channels.assistant_enabled` để host **tắt bot ở kênh cụ thể** (vd tắt ở Announcements). Projector phải yêu cầu đồng thời `bot_configs.enabled`, entitlement/provider/privacy gates hiện hành **và** `channel.assistant_enabled=true`; flag per-channel không được bật vòng qua tenant-level OFF.
- KHÔNG cần bot/KB per-channel (một KB/CLB vẫn đúng DD-16).

⇒ Phần "mỗi channel tag được bot" trong hướng của anh **không tốn thiết kế mới** ngoài 1 cột flag.

---

## 10. Sequencing

1. Owner ratify DD-86; authority baseline + analysis/spec mirrors phải commit để có immutable SHA.
2. Promote cặp In-app Chat Product/BE sang Reviewed sau khi đóng contract + acceptance matrix của DD-86.
3. **Root slice đầu tiên** là `dd38-dd86-chat-schema-core`: migration chat đầu tiên tạo thẳng model N-channel + exact-one-default invariant. Đây là root dependency, **không** đợi một migration DD-38 one-channel merge trước rồi mới fold DD-86 vào migration đó.
4. Channel management/restricted-post RPC là consumer slice sau root schema và phụ thuộc canonical DD-56 action registry; nếu registry chưa live, route/RPC user-facing phải negative-scope/OFF, không fallback sang raw `role='admin'`.
5. Club Assistant pha B chỉ land sau canonical chat root migration; DD-18 vẫn là enablement-only gate cho provider/go-live.

DD-86 mở rộng mô hình DD-38 và tham chiếu DD-71/DD-16..28/DD-79; không đụng đường tiền.

---

## 11. Open questions → DD-86 (đưa vào `decisions.md` khi mở proposal)

| ID | Câu hỏi | Đề xuất mặc định | Phân loại readiness |
|---|---|---|---|
| DD-86-Q1 | Kênh chủ đề = `kind='club'` + cột (Option B) hay `kind='topic'` mới (A)? | **B** (blast radius nhỏ) | `IN_SCOPE_BLOCKER` — owner |
| DD-86-Q2 | Membership: auto-join mọi kênh (phase-1) hay per-channel join? | Auto-join-all phase-1; per-channel/private phase sau | `IN_SCOPE_BLOCKER` — owner |
| DD-86-Q3 | "Announcements" là chat channel (admins_only) hay chỉ luồng DD-71? | Chat channel admins_only, **tách** DD-71 phase-1; nối fan-out phase sau | `IN_SCOPE_BLOCKER` — owner |
| DD-86-Q4 | Ai được tạo kênh phase-1? | Chỉ actor có `chat.channel.manage`; member-create deferred | `IN_SCOPE_BLOCKER` — owner |
| DD-86-Q5 | Kênh có shareable URL (vào slug registry DD-83) không? | Không phase-1; không route/public slug | `DEFERRED_OUT_OF_SCOPE` — không chặn phase-1 |
| DD-86-Q6 | Bot bật/tắt per kênh (`assistant_enabled`) mặc định? | Mặc định bật, nhưng vẫn AND tenant config/entitlement/provider/privacy gates | `IN_SCOPE_BLOCKER` — owner |
| DD-86-Q7 | Authority cho create/manage/restricted-post là gì? | DD-56 registry: `chat.channel.manage` + `chat.channel.post_restricted`; không dùng `chat_members.role` | `IN_SCOPE_BLOCKER` — AuthZ/Chat spec owner |
| DD-86-Q8 | Exact-one default tồn tại qua create/set/archive/concurrency thế nào? | Tenant lock + atomic replacement + deferred commit assertion; archived default không được tính | `IN_SCOPE_BLOCKER` — Chat spec owner |
| DD-86-Q9 | Idempotency create/rename/archive/set-default? | Actor-scoped UUID command receipt + canonical fingerprint | `IN_SCOPE_BLOCKER` — Chat spec owner |
| DD-86-Q10 | Audit creator shape? | `(created_by_membership_id, created_by_person_id, tenant_id)` composite FK; NULL/NULL chỉ system bootstrap | `IN_SCOPE_BLOCKER` — Chat spec owner |

---

## 12. Đề xuất block DD-86 để dán vào `decisions.md` (🟡 proposal)

> Chỉ dán khi anh đồng ý mở proposal. Giữ 🟡 (chưa chốt) tới khi owner duyệt — theo rule dự án, không viết vào spec đã Reviewed.

```
## DD-86 — In-app multi-channel per CLB (kênh theo chủ đề) · 🟡 Đề xuất (chờ owner)

Bối cảnh: mô hình In-app Chat (DD-38) khoá đúng 1 kênh club/CLB (chat_channels_club_uq).
Hướng sản phẩm: mỗi CLB có N kênh theo chủ đề (Main/Feedback/Announcements/host tạo thêm),
mỗi kênh @mention được Club Assistant (DD-16..28).

Đề xuất: Option B — giữ kind='club', bỏ chat_channels_club_uq, cho N kênh club/tenant;
metadata club-only/DM-NULL; exact-one active default do tenant-locked lifecycle command +
deferred assertion; creator bind composite membership+person+tenant; auto-provision active
member per channel. Post/manage dùng DD-56 capability registry (`chat.channel.manage`,
`chat.channel.post_restricted`), không dùng `chat_members.role` làm tenant authority.

Bất biến giữ nguyên: RLS tenant fail-closed, DM person-self, chat không ra public,
bot chỉ ground KB đã DLP (DD-21), không multi-master, i18n.

Quan hệ: phụ thuộc DD-38; tách với DD-71 (announcement broadcast) phase-1; bot = config
tenant (DD-20), 1 KB/CLB (DD-16) — multi-channel không đụng model bot/KB, chỉ thêm cột
assistant_enabled. Sequencing: chốt TRƯỚC khi author migration chat DD-38.

Open: DD-86-Q1..Q10; Q5 là `DEFERRED_OUT_OF_SCOPE`, 9 câu còn lại chặn readiness (§11).
Trạng thái: 🟡 chưa chốt · không migration · không đổi code-readiness.
```

---

## 13. Snapshot pin + readiness verdict (theo `review-code-readiness-gate` v1.3)

> Doc này là **analysis tier** (giống `dd-82-tournament-analysis.md`); readiness verdict của slice thực thi sẽ nằm ở file riêng `dd-86-*-readiness.md` **chỉ sau khi DD-86 được owner chốt** (giống cặp `dd-82-tournament-slice1-readiness.md`). Verdict dưới đây là kết quả áp gate lên **chính artifact analysis + hướng đề xuất**, không phải cấp phép code.

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: NOT_PLAN_READY
REVIEWED_AT: 2026-07-22
AUTHORITY_SHA: 360c70c1d402437f2d3b91dd411f6d69938e9959
BASE_BRANCH: main
BASE_REMOTE_RELATION: LOCAL_MAIN_AHEAD_ORIGIN_MAIN_BY_1
WORKTREE_STATE: DIRTY_UNCOMMITTED  # verdict is not an immutable authority snapshot until commit
TARGET_FILES:
  - docs/dd-86-in-app-multi-channel-analysis.md
  - docs/standards/decisions.md
  - docs/features/BE/feature_inapp_chat_tech.md
  - docs/features/feature_inapp_chat.md
  - docs/features/feature_club_assistant.md
  - docs/features/BE/feature_club_assistant_tech.md
  - docs/proposals/club-ai-bot-knowledge-base.md
  - docs/features/README.md
SLICE: dd86-in-app-multi-channel (analysis, pre-decision)
IN_SCOPE: hướng data model cho N kênh kind='club'/tenant + metadata kênh + per-channel post policy
OUT_OF_SCOPE: author migration chat DD-38; thay đổi model bot/KB (DD-16..28); fan-out DD-71;
              kênh riêng/subset; slug/URL DD-83; native push
G1_DECISION: FAIL            # owner chưa ratify Q1-Q4/Q6; Q7-Q10 cần spec-owner closure
G2_SPEC: PARTIAL             # mirrors đã cập nhật conditional; Product/BE vẫn Draft, chưa promote Reviewed
G3_DEPENDENCY: FAIL          # executable root/consumer slices chưa author; không còn misclassify chat migration là prior dependency
G4_TEST: PARTIAL             # exact conditional invariants đã mirror vào BE; acceptance matrix chưa full 9 nhóm
G5_SCOPE: PARTIAL            # root schema candidate đã pin nhưng chưa có plan/manifest/worktree boundary
G6_EXTERNAL: ENABLEMENT_ONLY:DD-18-provider-privacy-ToS
HARD_DEPENDENCIES: memberships/persons/tenants baseline MERGED; DD-56 capability registry required only by management/post consumer
PRIOR_SLICES: none for dd38-dd86-chat-schema-core (root dependency); authz consumer follows capability-registry implementation
OPEN_QUESTIONS_IN_SCOPE: 9   # Q1-Q4,Q6-Q10; Q5 DEFERRED_OUT_OF_SCOPE
ENABLEMENT_ONLY_GATES: DD-18 provider/privacy/ToS for Assistant go-live
LIVE_REPO_VERIFICATION: PASS # working-tree verified; chat_* runtime absent; GitNexus has docs only, no execution flow
CONTRACT_MATRIX: PARTIAL     # contradictions fixed; owner/spec-owner ratification still missing
CLOSURE_MATRIX: FAIL         # G1/G2/G3/G4/G5 and immutable-authority closure remain open
ACCEPTANCE_MATRIX: FAIL      # conditional tests added, full happy/boundary/auth/failure/concurrency/migration/security/regression/observability matrix not approved
SECURITY_AND_MIGRATION_GATE: PARTIAL  # authz/default/FK/idempotency direction pinned but not approved/implemented
IMPLEMENTATION_ARTIFACTS: NOT_REQUIRED_FOR_PLAN_READY
FIRST_IMPLEMENTATION_STEP: blocked — after ratification/spec promotion, author dd38-dd86-chat-schema-core as the root migration slice
REMAINING_BLOCKERS:
  - blocker: DD-86 product direction chưa owner-duyệt (Q1-Q4,Q6)
    owner: product owner
    resolution: owner ratify exact defaults and promote DD-86 proposal → accepted authority
  - blocker: Q7-Q10 + full acceptance matrix chưa được Chat/AuthZ spec owners approve
    owner: In-app Chat + Tenant AuthZ spec owners
    resolution: Product/BE pair Reviewed with exact capability/default/idempotency/FK contracts and 9-group acceptance matrix
  - blocker: authority snapshot chưa immutable vì DD-86 + mirrors còn uncommitted
    owner: docs authority owner
    resolution: commit exact authority/spec pack and repin verdict to that full SHA
NEXT_REVIEW_TRIGGER: committed SHA containing owner-ratified DD-86 + Reviewed Chat Product/BE pair + authored dd38-dd86-chat-schema-core readiness artifact
```

**Diễn giải:** **NOT_PLAN_READY** vì G1 còn mở, spec pair chưa Reviewed và snapshot chưa commit. Việc `chat_*` chưa có trên `main` **không còn bị coi là prior-dependency blocker sai**: root slice sau ratification sẽ tự sở hữu migration schema cuối cùng; các consumer authz/assistant đi sau.

---

## Changelog

| Ngày | Version | Thay đổi |
|---|---|---|
| 2026-07-22 | v0.5 | **Ref-durability fix:** đổi mọi line-number citation (`§1`/§5/§7 trỏ `feature_inapp_chat_tech.md:NN`, `feature_club_assistant.md:NN`) sang **symbol/section anchor** vì tech spec bị chèn dòng (line-ref cũ đã drift ~+11). Claim không đổi, chỉ con trỏ; tránh drift tiếp khi spec thay đổi. Không đổi product direction/readiness state/verdict. |
| 2026-07-22 | v0.4 | Nâng persisted verdict lên machine contract v1.3: classification `enforce`, `REVIEW_POLICY_VERSION`, `CLOSURE_MATRIX`; không đổi product direction hay readiness state. |
| 2026-07-22 | v0.3 | **Review-fix closure:** sửa schema club-only vs DM-NULL; creator composite FK; exact-one active default lifecycle; auto-provision atomic; DD-56 capability authority; mutation idempotency; DD-71 storage owner; Assistant flag AND tenant gates; phân loại Q1..Q10 (Q5 deferred); sửa dependency graph thành root `dd38-dd86-chat-schema-core`; verdict pin đúng dirty-worktree boundary và giữ **NOT_PLAN_READY**. Mirror proposal-safe vào decisions/Chat/Assistant/index; không runtime/migration. |
| 2026-07-21 | v0.2 | **Áp `review-code-readiness-gate` v1.1 + template v1.0:** thêm §13 snapshot pin (`AUTHORITY_SHA ad10194`, base `main`) + canonical verdict block = **NOT_PLAN_READY** (G1 FAIL owner-decision mở, G3 FAIL `chat_*` chưa trên main). Ghi rõ analysis tier tách khỏi readiness-verdict file (precedent dd-82). Không đổi nội dung phân tích §0–§12. |
| 2026-07-21 | v0.1 | Khởi tạo analysis: đối chiếu hướng "multi-channel + club bot" với canonical (DD-38 chat / DD-16..28 assistant / DD-71 announcement); xác định net-new = bỏ 1-club-channel/tenant; đề xuất Option B (giữ `kind='club'` + cột), blast radius, overlap DD-71, per-channel authz, bất biến, sequencing, 6 open questions và block DD-86 đề xuất. **Analysis/proposal only — chưa chốt, chưa migration, chưa sửa spec Reviewed/schema.** |
