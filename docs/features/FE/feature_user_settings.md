# Feature: User Settings & Profile (giá theo giới tính) — Product/UX Spec

> ⚙️ **Status:** ✅ **DD-39 chốt (2026-07-10)** — Draft, pending migration. Nguồn canonical: `../standards/decisions.md` **DD-39** (ràng buộc đã pin: decrypt-fail → fail-closed, chỉ fallback khi gender NULL thật).
>
> ✅ **Follow + private/public (DD-47/48 — framework CHỐT 2026-07-13, build P4+):** khung design duyệt; §7 dưới đây là contract-level. `person_follows` là **global protected**, chỉ qua narrow `SECURITY DEFINER`; `profile_visibility` default public cho user mới nhưng backfill user cũ=`private`; social profile chỉ trả field có canonical source; self/host operational data đi route riêng. DD-55 đã đóng DM + block; còn **3 open item DD-48** chốt lúc build. Chi tiết `../decisions/analysis/dd-47-follow-graph-analysis.md` + `../decisions/analysis/dd-48-profile-visibility-analysis.md`.

> **Canonical phase:** P4 (hồ sơ + nguồn `gender` cho giá kèo; follow/visibility P4+)
> **Track:** ⚙️ User Settings & Profile
> **Version:** 0.9a · 2026-07-19
> **Status:** DD-39 ✅ · DD-47/48 ✅ framework — Draft (pending migration/build)
> **Implementation:** Not started · authority: `../standards/BUILD-STATUS.md` (Doc status ≠ Implementation status)  
> **Prerequisites:** P3.5 identity (Person) · P4 web/app surface · (giá theo giới tính đọc bởi `feature_session_management` + `feature_payment_reconcile`) · (follow/visibility: `feature_identity` merge + `feature_player_view` profile path)
> **Tài liệu liên quan:** `../product/BRD.md` MODULE 11 / BR-16 / FR-11 / AC-11-12 · `../standards/decisions.md` **DD-39 · DD-47 · DD-48 · DD-70** · `feature_session_management.md` (đặt giá nam/nữ) · `feature_payment_reconcile.md` (suy charge) · `feature_identity.md` · `feature_player_view.md` · `packages/db/schema.ts` (**AUTHORITATIVE** khi triển khai)

---

## 1. Mô tả

Người dùng **cài đặt hồ sơ**: **giới tính**, **ngày sinh**, **tên hiển thị**, **username** (duy nhất), **ngôn ngữ** (vi/en). Hồ sơ gắn với **Person** toàn cục (không tạo bảng identity song song).

**Giá theo giới tính (DD-39):** host có thể đặt kèo **giá nam / giá nữ khác nhau**; khi tạo `charge`/`debt` cho member, hệ **suy giá theo `person.gender`**. Giới tính là **PII có consent**, mã hoá at-rest, **KHÔNG lộ ra public marketplace**.

**Follow + private/public (DD-47/48 — ✅ framework):** user có thể follow user khác và đặt `public`/`private`. User mới default public; user tồn tại trước migration được backfill private. Private cần approve follower và ẩn social profile với non-follower, kể cả đồng đội. Host vẫn thấy dữ liệu cần cho vận hành/suy giá qua tenant membership/roster path riêng; host role không mở rộng social-profile DTO. Đây là gate bổ sung, không thay/nới RLS và không đụng đường tiền/PII.

**DD-70(a) proposal (authority v1.70):** chỉ private follow mới tạo durable `follow_request`. `follow_accepted` trong bảng analytics dưới đây **không phải notification type**; public follow và private→public bulk auto-accept không fan-out thông báo hay lock follower fences hàng loạt.

### Bất biến

- `gender`/`dob` là **PII có consent** (NFR-P1), mã hoá at-rest; **KHÔNG** lộ ra public projection (field-whitelist không gồm gender/dob).
- Host của CLB member tham gia chỉ thấy **giới tính** ở **mức cần cho suy giá** — không thấy dob/PII khác.
- `username` **duy nhất toàn hệ**; đổi có kiểm tra trùng.
- Hồ sơ gắn **Person** (anchor); thay đổi **sync mọi surface** (web/Zalo/Messenger) qua canonical store.
- Giá theo giới tính suy từ `person.gender` đã set; **member thiếu gender** → **fallback giá mặc định** + nhắc set (không chặn tham gia).
- Public marketplace KHÔNG bao giờ chứa gender (CO-5, NFR-S2).

**Bất biến follow/visibility (DD-47/48 — framework chốt):**

- Follow là quan hệ **person↔person global** (bảng `person_follows`), **KHÔNG** tạo/đụng `memberships`; **cấm self-follow**; một cạnh duy nhất mỗi hướng (idempotent).
- Follow **KHÔNG** cấp quyền xem tiền/nợ/roster/PII của người khác — chỉ mở **approved social-profile fields có canonical source** (DD-48). Money/PII không bao giờ vào social profile path.
- `profile_visibility` là **gate bổ sung trên đường đọc hồ sơ xã hội**, **KHÔNG** thay/nới RLS-membership: private **không** gỡ user khỏi roster/session, **không** giấu `charges` với host.
- Private + non-follower → **fixed minimal card không profile fields** (fail-closed), kể cả host trên social route. Host operational access đi route membership/roster riêng dưới RLS.
- Merge person → re-parent + dedupe edge follow (accepted > pending), drop self-edge (như re-parent ledger, DD-01/§P6).

---

## 2. Use Cases + Edge Cases

### Use Cases

| ID | Actor | Hành động | Kết quả |
|---|---|---|---|
| USR-UC-1 | User | Đặt/sửa giới tính (tập giá trị **✅ chốt DD-39 addendum**: nam/nữ/khác/không tiết lộ) | Lưu vào hồ sơ Person (PII consent); dùng cho suy giá |
| USR-UC-2 | User | Đặt ngày sinh | Lưu PII mã hoá; không lộ public |
| USR-UC-3 | User | Đổi tên hiển thị | Cập nhật + sync mọi surface |
| USR-UC-4 | User | Đặt/đổi username | Kiểm tra trùng toàn hệ; reject nếu trùng |
| USR-UC-5 | User | Đổi ngôn ngữ (vi/en) | UI + thông báo theo locale người dùng |
| USR-UC-6 | User | Xem/thu hồi consent PII | Áp retention/anonymization; quyền xoá |
| USR-UC-7 | Host | Đặt kèo giá nam / giá nữ (tại `feature_session_management`) | `sessions` lưu giá theo giới tính theo contract DD-39 |
| USR-UC-8 | System | Tạo `charge` cho member trong kèo giá nam/nữ | Suy giá theo `person.gender`; ghi charge đúng |
| USR-UC-9 | System | Member thiếu gender trong kèo giá nam/nữ | Fallback giá mặc định + nhắc member set gender |
| USR-UC-10 | System | Public projection kèo có giá nam/nữ | Chỉ hiện dải giá whitelist; **không** lộ gender member |

### Edge Cases

| # | Category | Case | Hành vi bắt buộc |
|---|----------|------|-------------------|
| 1 | Privacy | Gender/dob lộ ra public marketplace | ❌ NEVER — field-whitelist không gồm gender/dob (test bất biến) |
| 2 | Privacy | Host xem PII vượt mức cần | Chỉ expose gender ở mức suy giá; không dob/PII khác |
| 3 | Data Integrity | Username trùng | Reject — unique check toàn hệ |
| 4 | Data Integrity | Member đổi gender giữa kỳ | Charge đã tạo giữ nguyên; charge mới theo gender hiện hành (không retroactive) |
| 5 | Data Integrity | Kèo giá nam/nữ, member "không tiết lộ" | Fallback giá mặc định + nhắc; không đoán giới tính |
| 6 | Security | Client tự khai gender để hạ giá | Gender lấy từ hồ sơ đã set + consent, không từ input tức thời khi charge |
| 7 | Compliance | User yêu cầu xoá PII | Anonymize; giữ nghĩa vụ financial audit (không phá ledger) |
| 8 | i18n | Locale user ≠ locale CLB | Ưu tiên locale người dùng cho UI cá nhân |
| 9 | Data Integrity | dob không hợp lệ / tuổi bất thường | Validation; không chặn tham gia trừ policy CLB |
| 10 | Sync | Đổi hồ sơ khi offline một surface | Canonical là nguồn; reproject khi online (không multi-master) |

---

## 3. Screens & States

> Web/App settings tab (bottom nav slot 5). Mobile-first 375px; desktop ≥1024.

### Hồ sơ cá nhân

**Purpose:** Xem/sửa profile: tên, username, giới tính, ngày sinh, ngôn ngữ, consent.

**Layout (mobile):**

```
┌──────────────────────────────────────┐
│ ← Cài đặt                           │
├──────────────────────────────────────┤
│                                      │
│         [Avatar placeholder]         │
│         {displayName}                │
│         @{username}                  │
│                                      │
│  ─── Thông tin cá nhân ───           │
│  Tên hiển thị    [{displayName}   ]  │
│  Username        [@{username}     ]  │
│                  ↳ kiểm tra trùng ⏳  │
│  Giới tính       [Nam ▼]             │
│                  ↳ Nam/Nữ/Khác/      │
│                    Không tiết lộ      │
│  Ngày sinh       [DD/MM/YYYY     ]   │
│  Ngôn ngữ        [Tiếng Việt ▼]     │
│                                      │
│  ─── Quyền riêng tư ───             │
│  Cho phép CLB sử dụng     [●○]  ON  │
│  giới tính để tính giá              │
│                                      │
│  [🔐 Đổi mật khẩu]                  │
│  [🗑️ Xoá tài khoản]    ← danger    │
│                                      │
│        [═══ Lưu thay đổi ═══]       │
│                                      │
└──────────────────────────────────────┘
```

**Component: Gender selector (DD-39):**

| Giá trị | Display | Impact charge |
|---------|---------|---------------|
| `male` | Nam | `sessions.price_male` (nếu có) |
| `female` | Nữ | `sessions.price_female` (nếu có) |
| `other` | Khác | Fallback `price_amount` base |
| `undisclosed` | Không tiết lộ | Fallback `price_amount` base |
| `NULL` (chưa set) | — | Fallback base + nhắc set |

**Component: PII consent toggle:**

| State | Hiển thị | Hệ quả |
|-------|----------|--------|
| ON | "Cho phép CLB sử dụng giới tính để tính giá" ✅ | Host đọc gender cho suy giá |
| OFF | "Không chia sẻ giới tính" | Gender trả NULL cho host → base price |

**4 States:**

| State | Nội dung |
|-------|----------|
| Loading | Skeleton form (avatar shimmer + 5 field skeletons + 2 toggle skeletons) |
| Ready | Form pre-filled từ `persons` |
| Error | Inline error per field (VD: "Username đã tồn tại", "Ngày sinh không hợp lệ") |
| Empty | Default values pre-filled (ngôn ngữ vi, gender/dob blank) |

### Đổi username

**Layout (inline real-time check):**

```
┌──────────────────────────────────────┐
│  Username *      [@plexco_user    ]  │
│                  ✅ "Có thể dùng"   │
│   — HOẶC —                          │
│                  ❌ "Đã có người     │
│                      dùng"           │
│   — HOẶC —                          │
│                  ⏳ "Đang kiểm       │
│                      tra..."         │
└──────────────────────────────────────┘
```

> Debounce 300ms trước khi gọi check API. Case-insensitive unique check.

### Đổi mật khẩu

**Layout:**

```
┌──────────────────────────────────────┐
│ ← Hồ sơ                             │
├──────────────────────────────────────┤
│                                      │
│  🔐 Đổi mật khẩu                    │
│                                      │
│  Mật khẩu hiện tại [             ]   │
│  Mật khẩu mới      [             ]   │
│  Xác nhận           [             ]   │
│                                      │
│       [═══ Đổi mật khẩu ═══]        │
│                                      │
└──────────────────────────────────────┘
```

### Quyền riêng tư / Consent

**Layout:**

```
┌──────────────────────────────────────┐
│ ← Cài đặt                           │
├──────────────────────────────────────┤
│                                      │
│  🔒 Quyền riêng tư                  │
│                                      │
│  ─── Hồ sơ ───                      │
│  Hiển thị hồ sơ     (●) Công khai   │
│                      (○) Riêng tư    │
│  ↳ Riêng tư: người khác chỉ thấy   │
│    placeholder, cần follow để xem   │
│                                      │
│  ─── Dữ liệu cá nhân (PII) ───     │
│  Chia sẻ giới tính   [●○]  ON       │
│  cho CLB tính giá                   │
│                                      │
│  ─── Tài khoản ───                  │
│  [📋 Yêu cầu xuất dữ liệu]         │
│  [🗑️ Xoá dữ liệu cá nhân]  danger │
│                                      │
└──────────────────────────────────────┘
```

### Host — Giá kèo nam/nữ (tại session form)

> Cross-ref: `feature_session_management` §3 "Web P4 — Session create/edit form"

**Component: Gender pricing toggle (trong session form):**

```
┌──────────────────────────────────────┐
│  ─── Giá ───                         │
│  (●) Giá đồng nhất                  │
│      Giá / người    [120,000₫    ]   │
│                                      │
│  (○) Giá theo giới tính (DD-39)     │
│      Giá nam        [150,000₫    ]   │
│      Giá nữ         [100,000₫    ]   │
│      Giá mặc định   [120,000₫    ]   │
│      ↳ Áp dụng cho Khác/Không       │
│        tiết lộ/chưa set gender      │
└──────────────────────────────────────┘
```

### Xoá tài khoản (danger flow)

**Layout:**

```
┌──────────────────────────────────────┐
│         ⚠️                            │
│  Bạn có chắc muốn xoá tài khoản?    │
│                                      │
│  Dữ liệu cá nhân sẽ bị xoá.        │
│  Lịch sử tài chính giữ cho audit.   │
│                                      │
│  Nhập "XOÁ TÀI KHOẢN" để xác nhận: │
│  [                              ]    │
│                                      │
│  [═══ Xoá vĩnh viễn ═══]  danger    │
│  [Huỷ]                              │
│                                      │
└──────────────────────────────────────┘
```

### Data source mapping

| Component | Data source | Ghi chú |
|-----------|-------------|---------|
| Profile fields | `persons` (gender/dob encrypted at-rest) | PII consent gated |
| Username check | `persons` WHERE `lower(username)` | Unique, debounce 300ms |
| PII consent | `persons.gender_consent` (or equivalent) | Controls host visibility |
| Visibility | `persons.profile_visibility` | public/private (DD-48) |
| Gender pricing | `sessions.price_male/price_female` | Cross-ref session form |

### State coverage matrix

| Screen | Loading | Ready | Error | Empty |
|--------|---------|-------|-------|-------|
| Hồ sơ cá nhân | ✅ Skeleton form | ✅ Pre-filled form | ✅ Inline per field | ✅ Default values |
| Đổi username | ⚪ N/A (inline) | ✅ Realtime check | ✅ "Đã tồn tại" | ⚪ N/A |
| Đổi mật khẩu | ⚪ N/A | ✅ Form | ✅ "Mật khẩu không đúng" | ⚪ N/A |
| Quyền riêng tư | — | ✅ Toggles + explain | ✅ "Lỗi lưu" toast | ✅ Default public |
| Giá nam/nữ (host) | — | ✅ Toggle + 3 fields | ✅ Inline validation | ⚪ N/A |
| Xoá tài khoản | — | ✅ Confirm dialog | ✅ "Có khoản chưa TT" | ⚪ N/A |

---

## 4. Domain Model

> **Schema contract DD-39 đã pin; migration chưa build.** Nguồn AUTHORITATIVE khi triển khai: `../standards/decisions.md` DD-39 + `packages/db/schema.ts` + migration. **Không** tạo root table `users` — hồ sơ gắn `persons` (anchor).

| Entity | Plane | Vai trò | Key constraints khi build |
|--------|-------|---------|-----------------|
| `persons` (mở rộng) | GLOBAL protected | Giữ `display_name`; thêm `gender`, `dob` (PII enc), `username`, `language` | `UNIQUE(lower(username))`; gender/dob mã hoá at-rest, consent |
| `sessions` (mở rộng) | Tenant-private | Giá theo giới tính | Canonical `price_amount` base + nullable `price_male`/`price_female` columns; both NULL = base-only, missing gender-specific side falls back to base |
| `charges` | Tenant-private | Suy giá theo `person.gender` khi tạo | Không retroactive khi đổi gender |

- **PII:** `gender`/`dob` mã hoá at-rest, retention + quyền xoá; **không** vào `public_sessions`.
- **Suy giá:** khi tạo charge → đọc `person.gender`; thiếu → giá mặc định + nhắc.

---

## 5. Analytics Events

| Event | Khi nào | Payload tối thiểu (no PII) |
|-------|---------|-------------------|
| `profile_updated` | User sửa hồ sơ | `person_id` (opaque), `fields_changed[]` |
| `username_changed` | Đổi username thành công | `person_id` (opaque) |
| `gender_set` | User đặt/đổi giới tính | `person_id` (opaque) — KHÔNG log giá trị PII |
| `consent_changed` | Bật/tắt consent PII | `person_id` (opaque), `consent_type` |
| `gender_price_applied` | Charge suy theo gender | `tenant_id`, `session_id`, `price_bucket` |
| `gender_price_fallback` | Thiếu gender → giá mặc định | `tenant_id`, `session_id` |

> KHÔNG log giá trị gender/dob/tên/username thô trong analytics.

---

## 6. Acceptance Criteria

- [ ] User đặt giới tính/ngày sinh/tên/username/ngôn ngữ; username trùng bị chặn.
- [ ] Thay đổi hồ sơ sync mọi surface (web/Zalo/Messenger) qua canonical store.
- [ ] Gender/dob là PII consent, mã hoá at-rest; **không** lộ ra public marketplace (test bất biến).
- [ ] Host chỉ thấy gender ở mức cần suy giá; không dob/PII khác.
- [ ] Host đặt giá nam/nữ khác nhau; hệ tạo `charge` đúng theo gender từng member.
- [ ] Member thiếu gender → fallback giá mặc định + nhắc set (không chặn tham gia).
- [ ] Đổi gender không retroactive charge đã tạo.
- [ ] Quyền xoá PII áp retention/anonymization, không phá financial audit.

---

## 7. Follow & Profile Visibility (DD-47/48 · ✅ Framework, build P4+)

> **Framework đã chốt; chưa implement.** Nguồn canonical khi build: `../standards/decisions.md` DD-47/48/55 + dedicated analyses + `packages/db/schema.ts`. Build slice phải pin 3 open item còn lại trước khi thêm field/behavior tương ứng.

### 7.1 Mô hình

- **Follow (DD-47):** cạnh **có hướng** follower→followee trên bảng **global** `person_follows`, `status ∈ {pending, accepted}`. Followee **public** → follow tạo `accepted` ngay; followee **private** → `pending` chờ approve.
- **Visibility (DD-48):** `persons.profile_visibility ∈ {public, private}`; user mới default public, existing backfill private. Điều khiển social profile cross-user, không đụng roster/tiền.
- **Phạm vi ẩn:** private ẩn social profile với mọi non-follower, kể cả đồng đội/host. Host vẫn có operational membership/roster access riêng; đó không phải social-profile exception.

### 7.2 Use Cases

| ID | Actor | Hành động | Kết quả |
|---|---|---|---|
| USR-UC-11 | User | Follow user **public** | Tạo edge `accepted` ngay; thấy được profile whitelist của họ |
| USR-UC-12 | User | Follow user **private** | Tạo edge `pending`; gửi yêu cầu; chưa thấy thống kê tới khi được duyệt |
| USR-UC-13 | Followee (private) | Approve / reject follow request | Approve → `accepted`; reject → xoá edge (không thông tin rò rỉ) |
| USR-UC-14 | User | Unfollow | Xoá edge của mình (follower-initiated) |
| USR-UC-15 | Followee | Remove follower (kick) | Xoá edge `accepted` đến (followee-initiated) |
| USR-UC-16 | User | Đổi `profile_visibility` public↔private | private→public: pending auto-accept; public→private: accepted cũ giữ, follow mới → pending |
| USR-UC-17 | Viewer | Xem profile user **public** | Chỉ approved fields có source: display name, username khi migrated, `plexco_since` coarse; avatar/sports/aggregate excluded tới khi có source/quyết định |
| USR-UC-18 | Viewer (non-follower) | Xem profile user **private** | **Fixed minimal card**: không profile fields; chỉ placeholder + "Hồ sơ riêng tư" + nút follow/request |
| USR-UC-19 | Host | Xem member private của CLB mình | Social route vẫn gated như mọi viewer; operational membership/roster route riêng trả đúng mức vận hành/suy giá dưới RLS |
| USR-UC-20 | System | Merge 2 person | Re-parent + dedupe edge follow (accepted > pending), drop self-edge |
| USR-UC-21 | User | Block/unblock user từ profile/settings | Reuse canonical `chat_blocks`/DD-55 safety service; block gỡ follow edges hai chiều và chặn follow/DM mới; unblock không tự restore |

### 7.3 Edge Cases

| # | Category | Case | Hành vi bắt buộc |
|---|----------|------|-------------------|
| F1 | Data Integrity | Self-follow | ❌ Reject (`CHECK follower <> followee`) |
| F2 | Data Integrity | Follow trùng (đã có edge) | Idempotent — trả edge hiện tại, không tạo trùng (`UNIQUE`) |
| F3 | Privacy | Non-follower xem user private | ❌ NEVER — fixed minimal card; **không** lộ display name/username/plexco-since/follower stats |
| F4 | Privacy | Follow path lộ tiền/nợ/roster/PII | ❌ NEVER — chỉ approved social fields có canonical source (test bất biến) |
| F5 | Security | Viewer đoán person ID để xem profile | Social gating fail-closed theo visibility + accepted follow; host operational authz ở route riêng |
| F6 | Cross-Feature | Private có gỡ user khỏi roster/giấu charge với host? | ❌ KHÔNG — RLS-membership + đường tiền không đổi (HR1/HR2) |
| F7 | Cross-Feature | Host mở social profile user private | Không có host exception: approved/minimal DTO theo follow như mọi viewer; tenant operational data chỉ qua route riêng |
| F8 | Data Integrity | Merge → edge trùng / self-edge sau merge | Re-parent + dedupe (accepted > pending) + drop self-edge |
| F9 | Abuse | reject rồi re-request spam | Rate-limit; user có thể block bằng canonical `chat_blocks`; blocked pair không tạo follow request/DM, lỗi generic |
| F10 | Marketplace | Private user host kèo public | `host_display_name` vẫn hiện trên `public_sessions` (vận hành, §P7) — private **không** ẩn |

### 7.4 Screens & States (bổ sung)

| Surface | Screen | Loading | Ready | Error | Empty |
|---------|--------|---------|-------|-------|-------|
| Web/App | Cài đặt quyền riêng tư | — | Toggle `public`/`private` + giải thích hệ quả | "Lỗi lưu" | Default `public` |
| Web/App | Hồ sơ user khác (public / là accepted follower) | Skeleton | Approved fields có canonical source + nút follow/unfollow | Error banner | N/A |
| Web/App | Hồ sơ user khác (private, non-follower) | — | Fixed placeholder card + nút "Yêu cầu theo dõi"; không profile fields | — | N/A |
| Web/App | Yêu cầu theo dõi (của tôi) | Skeleton list | Danh sách pending + Approve/Reject | Error banner | "Không có yêu cầu nào" |
| Web/App | Following / Followers | Skeleton | Danh sách + remove follower / unfollow | Error banner | "Chưa theo dõi ai" |

### 7.5 Domain Model (framework đã chốt)

| Entity | Plane | Vai trò | Key constraints khi build |
|--------|-------|---------|-----------------|
| `persons.profile_visibility` | GLOBAL protected | Cờ hiển thị social profile | user mới default public; existing backfill private; `CHECK public/private` |
| `person_follows` (mới) | GLOBAL protected | Cạnh follow có hướng | no table grant cho app/PUBLIC; narrow functions; `UNIQUE`, no-self, pending/accepted |
| `chat_blocks` (DD-55 canonical) | GLOBAL protected/person-self | Một block pair dùng chung social + DM | không tạo block store thứ hai trong User Settings; block/unblock qua narrow safety service |

> Schema chi tiết + gating + API ở `../BE/feature_user_settings_tech.md` §6. **KHÔNG** tạo bảng identity song song (`persons` là anchor, §P6).

### 7.6 Analytics Events (bổ sung — no PII)

| Event | Khi nào | Payload tối thiểu |
|-------|---------|-------------------|
| `follow_requested` | Follow user private | `actor` + `target` (opaque) |
| `follow_accepted` *(analytics-only)* | Auto (public) hoặc approve; **không emit notification** | `actor` + `target` (opaque) |
| `follow_rejected` / `unfollowed` / `follower_removed` | Tương ứng | opaque ids |
| `profile_visibility_changed` | Đổi public↔private | `person_id` (opaque), `to` |
| `profile_viewed` | Xem social profile cross-user | `viewer` + `target` (opaque), `visibility`, `access` (public/follower/minimal) |

### 7.7 Acceptance Criteria (bổ sung)

- [ ] Public: mọi user follow tự động (`accepted`); private: follow tạo `pending`, followee approve/reject.
- [ ] Private: social profile ẩn với non-follower kể cả đồng đội/host; host operational path riêng giữ nguyên quyền cần thiết.
- [ ] Profile path **không** lộ tiền/nợ/roster/PII/reliability cross-tenant (test bất biến).
- [ ] Private **không** gỡ user khỏi roster, **không** giấu `charges` với host (HR1/HR2 giữ nguyên).
- [ ] Self-follow bị chặn; follow trùng idempotent; unfollow/remove-follower hoạt động.
- [ ] Đổi visibility: private→public auto-accept pending; public→private grandfather accepted.
- [ ] Private→public bulk auto-accept chỉ ghi state + analytics; zero `follow_accepted` notification/fan-out và không acquire unbounded follower inbox fences.
- [ ] Merge person: re-parent + dedupe edge follow + drop self-edge.
- [ ] Block từ profile/settings dùng đúng canonical `chat_blocks`; atomically gỡ follow edges hai chiều, chặn re-request/DM; unblock không restore relationship cũ.

---

## 8. Open Questions / Changelog

### Open Questions (→ decisions.md)

| ID | Quyết định | Trạng thái |
|---|---|---|
| DD-39 | Giá theo giới tính (giá nam/nữ; gender từ hồ sơ; không lộ public) | ✅ Chốt |
| DD-47 | Social follow graph `person_follows` global protected | ✅ Chốt framework, build P4+ |
| DD-48 | `profile_visibility` + sourced social whitelist + route split | ✅ Chốt framework; DD-55 đóng item DM+block, còn 3 open item lúc build |
| USR-OQ-1 | Tập giá trị gender + xử lý "khác" cho giá kèo | ✅ **Chốt DD-39 addendum (2026-07-16)** — `male`/`female`/`other`/`undisclosed`; `other`/`undisclosed`/NULL → **giá base**; fail-closed CHỈ khi KMS/decrypt lỗi. Kèm **DD-54**: gender/DOB là PII optional — thu thập theo platform config trên CMS admin dashboard |
| USR-OQ-2 | Lưu giá theo giới tính: cột `price_male/price_female` vs bảng `session_price_by_gender` | ✅ **Chốt phase-1:** additive columns `sessions.price_male/price_female` beside canonical `price_amount`, matching BE/TDD/DD-39. A generalized table requires a future decision + migration, not an alternate current implementation. |
| USR-OQ-3 | Retention/anonymization SLA cho PII hồ sơ | 🟠 **Partial (DD-54, 2026-07-16):** collection policy ✅ (PII optional theo platform config; field vận hành không config-off); retention/erasure matrix vẫn chờ legal review VN (Luật 91/2025 + NĐ 356/2025) — founder brief Item 6 |
| USR-OQ-4 | Tập "stats" trong profile whitelist + có aggregate **cross-tenant** không (rủi ro lộ hoạt động xuyên CLB) | ⬜ Build-time — **DD-48 open item #1** (framework ✅; default exclude tới khi có model) → `../decisions/analysis/dd-48-profile-visibility-analysis.md` §5 |
| USR-OQ-5 | Follower-count / following-list của user **private** có ẩn với non-follower không | ⬜ Build-time — **DD-48 open item #2** (framework ✅) → `../decisions/analysis/dd-48-profile-visibility-analysis.md` §5 |
| USR-OQ-6 | Private có ảnh hưởng quyền **DM in-app** (DD-38) không | ✅ **Chốt DD-55:** phase-1 profile private/public không đổi quyền DM; mọi DM qua safety gate. Phase-2 accepted follow DM trực tiếp, non-follower vào request box |
| USR-OQ-7 | Có cần cơ chế **block** user không (chống re-request spam) | ✅ **Chốt DD-55/decisions v1.45:** có; reuse canonical `chat_blocks` + safety service của In-app Chat cho follow/profile/DM, không tạo bảng block thứ hai |
| USR-OQ-8 | Trong session **chung**, đồng đội thấy tên user tới mức nào (roster-presence vận hành vs profile xã hội — căng với "ẩn cả đồng đội") | ⬜ Build-time — **DD-48 open item #5** (framework ✅) → `../decisions/analysis/dd-48-profile-visibility-analysis.md` §5 |
| USR-OQ-9 | Đường **notify follow-request** (person-directed global): global notify path mới vs SSE person-self / in-app inbox (`outbox`/`notification_intents` hiện tenant-scoped) | ⬜ Build-time — **DD-47 notify impl-gap** (framework ✅) → `../decisions/analysis/dd-47-follow-graph-analysis.md` §4 |

### Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-07-19 | v0.9a | Metadata sweep (index v2.35): thêm trường **Implementation** đồng bộ BUILD-STATUS (Not started). Không đổi contract. |
| 2026-07-19 | v0.9 | **DD-70(a) v1.70 propagation:** `follow_accepted` is analytics-only; private→public bulk auto-accept creates no notification/fan-out or unbounded follower-fence work. No runtime/migration. |
| 2026-07-17 | v0.8 | **DD-39 storage closure:** close USR-OQ-2 on phase-1 `price_male/price_female` columns beside canonical `price_amount`; remove the competing current-table implementation path. |
| 2026-07-17 | v0.7 | **USR-OQ-6/7 closure:** DD-55 pin phase-1 open-DM qua safety gate, phase-2 follow/request-box; User Settings tái dùng canonical `chat_blocks`, block gỡ follow edges hai chiều và chặn re-request/DM; còn 3 DD-48 item thực sự mở. |
| 2026-07-15 | v0.5 | **Propagation (light):** neo USR-OQ-4..9 vào DD-48 (5 open item) / DD-47 (notify impl-gap) — framework đã ✅, các item này chốt lúc build P4+; trỏ file phân tích. Không đổi schema/body Reviewed. |
| 2026-07-16 | v0.6 | **Propagation (light) DD-39 addendum + DD-54:** USR-OQ-1 ✅ (value set `male/female/other/undisclosed`, fallback base, fail-closed chỉ KMS/decrypt); USR-OQ-3 🟠 partial (collection theo platform config DD-54; retention chờ legal); USR-UC-1 bỏ "đề xuất". Schema/migration defer build slice. Authority: decisions v1.36. |
| 2026-07-15 | v0.4 | **DD-47/48 framework ✅:** global-protected functions; state-idempotent follow; existing user private/new user public migration; sourced field whitelist; `/api/me`, social profile và host operational routes tách biệt. |
| 2026-07-11 | v0.3 | **Thêm §7 Follow & Profile Visibility (DD-47/48 🟡).** Follow graph `person_follows` (global, có hướng, pending/accepted, auto-accept public / approve private); `persons.profile_visibility` (default `public`); gating profile cross-user fail-closed, whitelist non-PII; private ẩn **cả đồng đội cùng CLB** trừ host (ngoại lệ vận hành); **KHÔNG** nới RLS / không đụng tiền (HR1/HR2). Use/edge cases, screens, analytics, AC, USR-OQ-4..9. Renumber Open Questions/Changelog → §8. |
| 2026-07-10 | v0.1 | Khởi tạo Draft (DD-39 + hồ sơ): gender/dob/name/username/language; giá theo giới tính (suy charge theo `person.gender`); PII consent, không lộ public. Schema proposal-level trỏ decisions.md + `packages/db/schema.ts`; hồ sơ gắn `persons` (không root table `users`). |
