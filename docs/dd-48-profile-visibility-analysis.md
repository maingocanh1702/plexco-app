# 🔒 DD-48 Analysis — Profile visibility (public/private) + cross-user gating

> **Mục đích:** chốt framework visibility + **whitelist approved fields + migration + ranh giới HR1/HR2**. Build P4+.
> **Ngày:** 2026-07-13 · **Canonical:** `schema.ts` (persons) · `feature_marketplace_discovery` (public whitelist) · `feature_user_settings` §7 · `feature_player_view` · DD-47 (follow) · DD-39 (gender PII) · DD-42 (reliability per-tenant) · `0009` RLS. Ghi → `decisions.md` DD-48.

---

## 0. TL;DR — ✅ framework (owner), build P4+
- `persons.profile_visibility text NOT NULL DEFAULT 'public' CHECK (public|private)` cho **user mới** (owner-chốt default public, hợp DD-29). **Migration fail-closed:** add nullable/no-default → backfill **user hiện có=`private`** → set default `public` → set NOT NULL/CHECK. Không public hoá ngầm profile trước đây chưa có cross-user surface.
- Cross-user social profile (`GET /api/persons/:id/profile`) = **APPROVED PUBLIC-PROFILE FIELDS có source tường minh**; không derive từ memberships/sessions để tránh lộ cross-tenant. Initial safe set: `display_name`, `username` khi migration DD-39 tồn tại, `plexco_since` coarse từ `persons.created_at`; avatar/sports chưa có canonical source nên chưa trả.
- **Gating fail-closed:** public→approved fields; private→approved fields chỉ khi `person_follows(V→T)=accepted` (DD-47); còn lại → **card tối thiểu**. Self dùng `/api/me`; host operational view dùng tenant membership/roster path riêng — không mở rộng social-profile DTO.
- **Private ẩn social profile với cả đồng đội và host non-follower.** Host chỉ giữ operational access qua tenant membership/roster route riêng; đây không phải ngoại lệ trên social DTO. **KHÔNG nới RLS/membership authz, KHÔNG đụng tiền.**
- **5 open item chốt lúc build** (§5).

---

## 0.1 Correction log
| Rev trước (mâu thuẫn) | Sự thật |
|---|---|
| whitelist gồm "aggregate số buổi" | **aggregate = OPEN ITEM (§5.1), CHƯA vào whitelist.** |
| "field-whitelist non-PII" (khẳng định chung) | Gọi **"approved public-profile fields"** — không khẳng định blanket non-PII (username/avatar có thể nhạy). |
| default public không nói migration | **User cũ backfill `private`; user mới mới nhận default `public`.** |
| host exception nằm ngay social profile path | Tách route: social profile không trả PII/operational data; host dùng tenant-scoped membership/roster path hiện hữu. |
| whitelist nêu avatar/sports/member-since nhưng không có source | Chỉ ship field có canonical source; `plexco_since` từ `persons.created_at`, avatar/sports deferred tới khi có model riêng. |

---

## 1. Canonical hiện trạng
| Sự thật | Nguồn |
|---|---|
| `persons` chưa có `profile_visibility`; `feature_player_view` = person-self only (chưa cross-user) | `schema.ts:39` · `feature_player_view` |
| Public whitelist (marketplace) = session-level (host/club_display_name moderated), không profile cross-user | `feature_marketplace_discovery.md:82` |
| gender/dob = PII enc, không public (DD-39/user_settings); reliability per-tenant không cross (DD-42) | DD-39/42 |
| `persons` live chỉ có `display_name` + identity fields; chưa có `username`/avatar/person-sports | `schema.ts:39-52` |
| §7 user_settings: private ẩn social profile với non-follower; private cần approve; public auto-follow | `feature_user_settings` §7 |

---

## 2. Contract
- **Migration `profile_visibility`:** (1) add nullable không default; (2) `UPDATE persons SET profile_visibility='private'` cho row hiện có; (3) set default `public`; (4) set NOT NULL + CHECK. New person sau migration = public; existing person giữ fail-closed private tới khi tự đổi.
- **Social profile path cross-user** (`GET /api/persons/:id/profile`) có DTO allowlist theo source:
  | Field public | Canonical source | Trạng thái |
  |---|---|---|
  | `display_name` | `persons.display_name` (sanitize + user-controlled) | ✅ initial |
  | `username` | `persons.username` từ migration DD-39 | ✅ khi column đã migrate |
  | `plexco_since` | tháng/năm coarse từ `persons.created_at` | ✅ initial; không derive membership |
  | avatar | chưa có canonical field/asset policy | ⬜ exclude tới khi có source |
  | `sports[]` | chưa có person↔sport preference model | ⬜ exclude; **không suy từ session/club history** |
- **CẤM trong social path:** SĐT/email/`dob`/`gender`, `charges`/nợ/`pay_code`, reliability per-tenant (DD-42), memberships/roster, venue, tenant ids. Aggregate buổi vẫn open item và default exclude.
- **Gating social (fail-closed, default-deny):**
  | Viewer V xem target T | Kết quả |
  |---|---|
  | V == T | route `/api/me` self-view; không dùng cross-user DTO |
  | T public | approved fields hiện có source |
  | T private + `person_follows(V→T)=accepted` (DD-47) | approved fields hiện có source |
  | còn lại (kể cả đồng đội/host không follow) | **fixed minimal card**: không trả profile field; chỉ placeholder avatar + "Hồ sơ riêng tư" + follow/request CTA |
- **Operational host path tách riêng:** host của tenant mà T là member tiếp tục đọc mức cần cho roster/suy giá/đối soát qua tenant-scoped membership/roster APIs dưới RLS. Host role **không** widen `/api/persons/:id/profile` và không đưa gender/charge vào social DTO.
- **Private ẩn CẢ đồng đội cùng CLB** ở social profile. Host vẫn có operational access ở path riêng, không phải ngoại lệ follow trên social path.

## 3. Ranh giới BẮT BUỘC (HR1/HR2)
- Visibility gating = **lớp gate xã hội BỔ SUNG** trên đường đọc profile — **KHÔNG thay/không nới** RLS/membership authz, **KHÔNG** đụng đường tiền:
  - Private **KHÔNG** gỡ T khỏi roster/session đã join (capacity/vận hành giữ nguyên).
  - Private **KHÔNG** giấu `charges`/pay-status của T với **host** (HR2 không đổi).
  - Private **KHÔNG** ẩn `host_display_name` của T trên `public_sessions` do T host (marketplace vận hành — §P7/DD-06).
  - Money/PII **không bao giờ** vào social profile path bất kể public/private; host operational access không render qua profile serializer.

## 4. Dependencies
- **DD-47** follow graph (gating private).
- **DD-39** gender (không lộ profile), **DD-42** reliability (không cross-tenant), **DD-06** venue.
- **DD-38** DM in-app (open item #3).
- Migration: DD-39 profile fields trước/đồng slice; `profile_visibility` staged backfill existing=`private`; profile read service. Avatar/sports cần decision/model riêng trước khi thêm whitelist. Build **P4+**.

## 5. 5 Open item (chốt lúc build)
1. Tập "stats" chính xác + có **aggregate cross-tenant** không (rủi ro lộ hoạt động xuyên CLB) — hiện **CHƯA** vào whitelist.
2. follower-count / following-list của user private có ẩn với non-follower không.
3. private có ảnh hưởng quyền **DM in-app (DD-38)** không.
4. có cần cơ chế **block** không.
5. trong session **chung**, đồng đội thấy tên T tới mức nào (roster-presence vận hành khác profile xã hội).

## 6. Propagation (khi build P4+)
`feature_user_settings(.md/_tech)` §7 (field-source matrix + staged backfill + route split), `feature_player_view` (pointer: `/me` self-only, không reuse cho social/host ops), `feature_marketplace_discovery` (không đổi — host_display_name giữ), `schema.ts`+migration, profile serializer tests. **Đã cập nhật:** user-settings product/BE + player-view boundary → ✅ framework.

## 7. Test fixtures
existing user→private, new user→public · migration interruption ở mỗi stage fail-closed · `/api/me` self đầy đủ · public→only sourced approved fields · private+follower accepted→approved · private+non-follower/host-nonfollower→fixed minimal card không profile fields · host operational route vẫn thấy đúng tenant-scoped data nhưng social DTO không đổi · avatar/sports absent khi chưa có source · profile path KHÔNG lộ PII/tiền/reliability/membership cross-tenant · đổi visibility áp DD-47 · host_display_name vẫn trên public_sessions.

## 8. Quyết định (đã chốt framework, build P4+)
profile_visibility default public cho user mới, existing backfill private; approved fields chỉ khi có canonical source; gating social fail-closed theo follower; self và host operational data đi route riêng; private ẩn social profile với đồng đội/host non-follower nhưng không giảm operational authz; không nới RLS/tiền; 5 open item lúc build. Ghi `decisions.md` DD-48 ✅ framework.

**Nguồn:** `schema.ts:39` · `feature_marketplace_discovery.md:82` · `feature_user_settings` §7 · `feature_player_view` · DD-47/39/42/06/38 · `0009`.
