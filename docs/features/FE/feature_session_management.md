# Feature: Session Management — Product/UX Spec

> **Canonical phase:** P2 (chat CRUD) · P4 (web parity)  
> **Track:** 📋 Session CRUD  
> **Version:** 2.18 · 2026-08-09
> **Status:** Reviewed  
> **Implementation:** Not started — waitlist schema `0014` và validated public finite-capacity invariant `0024` đã merge; SessionService/routes/projector/auto-promote vẫn chưa build · authority: `../standards/BUILD-STATUS.md` (Doc status ≠ Implementation status)
> **Prerequisites:** P0–P1 foundation stable · P2 tenant routing/authz  
> **Tài liệu liên quan:** `../product/BRD.md` FR-2 · `../product/PRD.md` FLOW 2/13 · `../product/TDD.md` §3.2/3.8 · `../standards/decisions.md` **DD-32/DD-39/DD-45/DD-45a/DD-49** · DD-37/DD-65..68 · `../standards/business-rules.md` BL-CBF/BL-SES-9/10 · `feature_channel_booking_funnel.md` · `../BE/feature_session_management_tech.md`

> **Cập nhật v3.4 (DD-37, 2026-07-10):** kênh phase-1 = **Zalo + Messenger** + web (bỏ Telegram). **Giá theo giới tính** (giá nam/nữ) nay **✅ phase-1** — xem **DD-39 (✅ Chốt)** / `feature_user_settings.md`; schema giới tính sống ở `feature_user_settings`, KHÔNG thêm vào doc này (chỉ pointer).
>
> **Current DB boundary (2026-07-27):** migration `0024` đã làm trạng thái
> `visibility='public' AND slots_max IS NULL` không thể biểu diễn và validate dữ liệu hiện có. Đây chỉ là
> DB invariant cho E#7; không chứng minh create/publish service, route, UI hay projector đã implement.

---

## 1. Mô tả

Cho phép host (TenantAdmin) tạo, sửa, thông báo, đóng và huỷ **session thể thao đa môn** — với time, venue, price, capacity, visibility và join policy nhất quán. P2 deliver qua **Zalo + Messenger admin commands**; trên Messenger host dùng được **central Plexco Page hoặc optional Page riêng của club** với chức năng cơ bản tương đương. P4 bổ sung web parity và event projections.

**Ngoài phạm vi:** Đặt sân (court booking), chấm điểm theo môn (sport-specific scoring) — **được theo dõi riêng ở `feature_session_organize.md` + `../BE/feature_session_organize_tech.md` (DD-61..64 ✅ accept-in-principle, build post-P4)**; pointer only, không thêm scope organize vào body Reviewed này. **Dọn draft chưa publish** (draft-lifecycle gap có sẵn từ `create=draft`, v2.12c) nay đã author: host-discard (SES-UC-13) và system auto-expiry draft quá giờ (SES-UC-14) đều flip `draft`→`cancelled` qua `CancelSession` mở rộng (state machine §4, founder-ratified `docs-session-draft-lifecycle`); publish contract giữ nguyên chỉ author `draft`→`open`.

### Bất biến

- Chat và web gọi **cùng domain service** — không duplicate logic.
- Session luôn gắn `tenant_id` — RLS choke-point.
- Admission capacity không bao giờ bị vượt: một helper đếm `active players + unexpired channel payment holds`; concurrent join/hold/capacity change đều lock session. Waitlisted và account-link-only intent không chiếm chỗ.
- Giá thay đổi sau khi đã charge → bắt buộc preview + explicit policy.
- Venue chi tiết (tên, SĐT, bản đồ) chỉ hiện khi canonical player outcome là `active`; pending và approved-but-waitlisted chỉ thấy area/position.
- Messenger `/newsession` dùng một durable wizard owner ở pre-dispatch boundary; mỗi bước/final confirm re-check `session.manage`, tenant context và snapshot. Central/tenant Page chỉ là adapter/context surface, không chứa business rule riêng.

---

## 2. Use Cases + Edge Cases

### Use Cases

| ID | Actor | Hành động | Kết quả |
|---|---|---|---|
| SES-UC-1 | Host | Tạo session one-off | Session tạo ở status `draft` (private/public) với validated fields; Host publish → `open` (state machine §4) |
| SES-UC-2 | Host | Tạo recurring template | Instances tương lai generated idempotently theo tenant timezone |
| SES-UC-3 | Host | Announce lên linked group | Một canonical announcement reference lưu DB |
| SES-UC-4 | Host | Sửa time/price/capacity/visibility | Command writes canonical state + outbox event |
| SES-UC-5 | Host | Đóng session | Không nhận join mới; public projection removed |
| SES-UC-6 | Host | Huỷ session | Roster/paid impact hiện preview; refund-needed policy applied |
| SES-UC-7 | Host (Web) | Sửa session qua web P4 | Cùng service/validation như chat |
| SES-UC-8 | Player | Join session public | Request → auto-approve hoặc host-approve tuỳ policy; first-entry khi full thì cả hai path vào `waitlisted`, không tạo charge/venue |
| SES-UC-9 | Player | Leave session trước giờ chơi | Player → `left`, opener atomically xét queue. First-activation derive giá rồi tạo đúng một charge; DD-49 rejoin re-derive live disposition, carry-over hoặc append refunded lifecycle chỉ khi activation, không duplicate charge row. First derivation failure lazy-creates one root promotion-retry job + candidate event. Job CAS/lease tối đa 3 claimed attempts/backoff; mỗi completed sweep re-enter current order, thử mỗi candidate một lần và re-check DD-41/DD-42/DD-52. Expired final claim hoặc completed attempt 3→resolve-or-owner-review/DLQ. |
| SES-UC-10 | System | Auto-close session hết giờ | Status → closed, projection removed |
| SES-UC-11 | Host (Messenger central/tenant Page) | Chạy `/newsession` | Role-aware tenant picker nếu cần → wizard → preview → confirm → đúng một shared `CreateSession` command |
| SES-UC-12 | Host | Publish session `draft` → `open` | Distinct `PublishSession` command (chat+web cùng service) flip status `draft` → `open` để nhận join (state machine §4). **Status-only** — không đổi `visibility`. Idempotent: re-publish session đã `open` = no-op success. Nếu `visibility='public'`: re-validate discovery completeness (E#7) trước khi mở. Chỉ Host (`session.manage`) |
| SES-UC-13 | Host | Huỷ (discard) session `draft` chưa publish | `CancelSession` mở rộng nhận nguồn `draft` (ngoài `open` hiện có) → `cancelled` (state machine §4). Draft không thể có roster/charge theo thiết kế (join chỉ mở tại publish — SES-UC-12); hệ thống verify dưới lock — thường rỗng nên xác nhận một chạm, anomaly thì fail-closed (edge #23). Bắt buộc gửi version hiện tại (đóng race với publish concurrent — edge #21). Áp dụng bất kể `starts_at` — **chỉ cho nguồn `draft`** (draft chưa từng "diễn ra"); huỷ session `open` đã quá giờ vẫn giữ nguyên yêu cầu hiện có (edge #24, không đổi). Chỉ Host (`session.manage`) |
| SES-UC-14 | System | Auto-expiry draft quá giờ chưa publish | Job định kỳ quét `draft` có `starts_at` đã qua → `cancelled` tự động qua cùng transition (`cancel_reason=auto`); draft tương lai và session không-draft không bị đụng |

### Edge Cases

| # | Category | Case | Hành vi bắt buộc |
|---|----------|------|-------------------|
| 1 | Data Integrity | `ends_at` ≤ `starts_at` | Reject — end phải sau start. Ref: BL-DATA-1 |
| 2 | Data Integrity | Sport key không tồn tại trong taxonomy | Reject — chỉ accept từ active sport taxonomy |
| 3 | Concurrency | Giảm `slots_max` xuống dưới active roster | Reject `CAPACITY_BELOW_ROSTER`; không kick/evict hay mutation ngầm |
| 4 | Concurrency | 2 first-entry players join đồng thời, chỉ còn 1 slot | Transaction lock — first-commit-wins; second vào `waitlisted` với position dương, không tạo charge/venue |
| 5 | Financial | Price change sau khi đã có charges | Preview bắt buộc: existing charges giữ nguyên HOẶC adjustment entries — KHÔNG silent mutation |
| 6 | Security | Venue details leak trước active outcome | Chỉ hiện area/queue position. Chi tiết chỉ sau khi `players.status='active'`; approved-but-waitlisted vẫn ẩn |
| 7 | Data Integrity | Visibility public thiếu discovery fields | Reject — required fields: sport, area, starts_at, slots_max (finite — public không được unlimited/`NULL`) |
| 8 | Data Integrity | Visibility private → remove projection | Immediate remove từ public search |
| 9 | Data Integrity | Recurrence qua DST boundary | Handle deterministically — dùng IANA timezone + occurrence idempotency key |
| 10 | Resilience | Announcement gửi group fail | KHÔNG rollback canonical write — projector retries/reprojects |
| 11 | Security | Mutation on closed/cancelled/past session | Reject mọi mutation — trừ privileged correction với audit trail |
| 12 | Security | Non-admin cố sửa session | 403 — routing ≠ authz. Ref: tenant_routing_authz |
| 13 | Financial | Player đã `left` tự join lại cùng session | Re-derive DD-49 dưới lock. Active: chưa-refund carry-over, refunded append lifecycle idempotent. Full: waitlisted; chưa-refund giữ aggregate lịch sử, refunded không new lifecycle tới promotion. Unknown→`REJOIN_REQUIRES_REVIEW`, không mutation |
| 14 | Financial/Resilience | First active join hoặc first-activation promotion không suy được amount | Direct active join aborts. Promotion giữ waitlisted/no-charge/venue; first failure lazy-creates one root retry job + candidate event and commits. Retry one-owner CAS/lease, max 3 claimed attempts/backoff; completed sweep dùng current-order selector, mỗi candidate tối đa một lần; sibling events không fork budget. Closed/started/full resolves; expired final claim hoặc completed attempt 3→resolve-or-review/DLQ; không fallback |
| 15 | Security/State | Messenger wizard stale/expired/context-switch/non-admin | Clear/deny fail-closed; final confirm không tạo partial/duplicate session |
| 16 | State | Publish `draft` → `open` (idempotent) | `draft` → `open` flip status + một outbox event; re-publish session đã `open` = no-op success (dedup theo `commandId`, cùng pattern close/cancel). Status-only — `visibility` không đổi |
| 17 | Data Integrity | Publish session public thiếu discovery fields | Reject `MISSING_DISCOVERY_FIELDS` — E#7 (sport, area, starts_at, finite `slots_max`) re-validate tại publish vì đây là transition bật public projection; zero mutation |
| 18 | State | Publish session closed/cancelled/past | Reject `SESSION_NOT_OPEN` — chỉ `draft` (chưa qua giờ) → `open` hợp lệ; không mutation. Chỉ Host (`session.manage`) |
| 19 | Security/Billing | Publish khi tenant billing-`suspended` | **Fail-closed block `TENANT_SUSPENDED`** (403, canonical tenant-routing code) — publish là action "publish new sessions" trong billing Suspended Action Matrix (`suspended` ❌; `active`/`past_due` ✅), **owned bởi `feature_billing_lifecycle`** (named dependency — status-authority định nghĩa ở billing, không ở đây). Existing sessions expire naturally |
| 20 | State | Discard `draft` → `cancelled` (host thủ công, hoặc auto-expiry khi quá giờ) | `CancelSession` mở rộng nhận nguồn `draft` ngoài `open`; hệ thống verify roster/charge dưới lock (thường rỗng theo thiết kế — anomaly xem edge #23) rồi mới xác nhận một chạm. Đúng một outbox event `session_cancelled`; cancel session đã `cancelled` (dù nguồn draft hay open) vẫn no-op idempotent (cùng pattern publish/close). Không có past-guard cho nguồn `draft` — hợp lệ bất kể `starts_at`; nguồn `open` giữ nguyên yêu cầu past-session cũ (edge #24, KHÔNG exempt). Chỉ Host (`session.manage`) cho nhánh thủ công |
| 21 | Security/Concurrency | Discard draft với `expectedVersion` thiếu hoặc không khớp (session vừa publish/sửa) | Reject `STALE_VERSION` — version bắt buộc gửi trên nhánh mutate (không phải field tuỳ chọn), đóng race "click Huỷ nháp cũ cancel nhầm session vừa published" — không silent-cancel một session đã `open` ngoài ý host; zero mutation |
| 22 | Resilience/Concurrency | Auto-expiry job chạy đồng thời (nhiều lượt cron chồng), xuyên nhiều tenant | `FOR UPDATE SKIP LOCKED` (cùng discipline Daily Lifecycle Job, `feature_billing_lifecycle_tech.md` §4) nên mỗi draft quá giờ transition đúng một lần, không double-cancel/double-event; lượt chạy chồng khác skip row đã khoá. Tenant isolation giữ nguyên (RLS fail-closed); cơ chế thực thi cross-tenant chính xác là build-slice detail, không đặc tả ở đây (BE §4) |
| 23 | Financial/Data Integrity | Draft mang roster/charge bất thường (data anomaly — vi phạm bất biến ứng dụng "draft không thể có roster") | Fail-closed: KHÔNG tự động huỷ (host discard lẫn auto-expiry). Host-discard trả **cùng lỗi** "Cần xác nhận huỷ" host đã biết từ SES-UC-6 (không phải lỗi riêng cho draft) — route qua cùng cơ chế preview/review đã có cho session `open`; auto-expiry (không có ai đang chờ) chỉ skip + audit. Không giả định rỗng là tuyệt đối |
| 24 | Security | Huỷ session `open` đã quá giờ chơi (`starts_at` trong quá khứ) | Reject — no-past-guard của SES-UC-13 CHỈ áp dụng khi nguồn là `draft`; huỷ một session `open` đã quá giờ vẫn cần xác nhận/audit như trước (edge #11), KHÔNG được đi qua path discard-draft thường. Giữ đúng lời hứa "huỷ session open không đổi hành vi" |
| 25 | Concurrency/Financial | Host giảm capacity trong khi có live channel payment hold | Reject dưới session lock nếu `new_slots_max < active_count + live_hold_count`; không huỷ hold hoặc lấy chỗ user âm thầm |
| 26 | Cross-Feature | Paid+unlinked waitlisted candidate được promotion offer | Candidate vẫn waitlisted/ẩn venue; hold chiếm một slot. Settle→active; expiry→release + requeue-tail một lần rồi selector tiếp tục |

---

## 3. Screens & States

> Coverage matrix `state × surface`: Bot screens text-based (Zalo/Messenger); Web P4 visual. Mobile-first 375px; desktop ≥1024 table layout.

### Bot — `/newsession` wizard (Zalo/Messenger)

**Purpose:** Host tạo kèo nhanh qua chat commands — step-by-step input.

**Flow tree:**

```
Host gọi /newsession (central Page hoặc tenant Page)
  │
  ├→ Multi-tenant? → Tenant picker (nếu host manage >1 club)
  │     └→ Chọn club → verify session.manage + tenant context
  │
  └→ Wizard steps:
        ├→ Step 1: Chọn môn thể thao (chips/quick reply)
        │     └→ Active sport taxonomy only (E#2)
        ├→ Step 2: Ngày & giờ
        │     ├→ Ngày: date picker / quick "Hôm nay", "Ngày mai", "T7 này"
        │     ├→ Giờ bắt đầu + kết thúc
        │     └→ Validate: ends_at > starts_at (E#1)
        ├→ Step 3: Địa điểm
        │     ├→ Input: tên sân / địa chỉ
        │     └→ Area code (cho public discovery)
        ├→ Step 4: Hình thức thanh toán
        │     ├→ Miễn phí — không thu
        │     ├→ Chia đều — input tổng tiền sân → auto ÷ slots
        │     ├→ Cố định/slot — input giá/người
        │     └→ Cố định theo giới tính — input giá nam + giá nữ (DD-39)
        ├→ Step 5: Số người tham gia (slots_max)
        │     └→ Public: bắt buộc finite > 0 (E#7)
        ├→ Step 6: Hiển thị (Public / Private)
        │     └→ Private: toggle link mời, yêu cầu duyệt
        │
        ├→ Preview card (summary tất cả fields)
        │     └→ Re-check session.manage + tenant context + snapshot
        │
        └→ Confirm → CreateSession command (idempotent)
              ├→ Success → Session card + "Đăng kèo" CTA (draft) + "Chia sẻ link"
              ├→ Error → Inline error per field
              └→ Duplicate confirm → no-op (1 session only)
```

**Pricing variant UI (Bot):**

| Pricing Type | Bot hiển thị | Input yêu cầu | Summary text |
|-------------|-------------|----------------|-------------|
| Miễn phí | "Miễn phí — không thu phí" | Không cần | "X người · Miễn phí" |
| Chia đều | "Nhập tổng tiền sân (VND)" | `totalVenueCost` | "X người · {total} ÷ {slots} = {perSlot}₫/người" |
| Cố định/slot | "Nhập giá mỗi người (VND)" | `pricePerSlot` | "X người × {price}₫ = {total}₫" |
| Cố định theo giới tính | "Nhập giá nam + giá nữ (VND)" | `priceMale`, `priceFemale` | "Nam: {priceMale}₫ · Nữ: {priceFemale}₫" |

**Bot states:**

| State | Nội dung |
|-------|----------|
| Loading | Typing indicator |
| Ready | Step-by-step input (sport → time → venue → price → capacity → visibility → preview → confirm) |
| Error | Inline error per field: "Giờ kết thúc phải sau giờ bắt đầu", "Số người phải > 0" |
| Empty | N/A (wizard luôn có content) |

### Bot — Session detail (`/status`)

**Purpose:** Host xem session info, roster, payment status.

**Layout (Bot message):**

```
📋 Buổi chơi: {title}
━━━━━━━━━━━━━━━━━━━━━
🏸 {sport}
📅 {date} · {startTime}–{endTime}
📍 {venue}
👥 {filledSlots}/{totalSlots} người · {status badge}
💰 {pricePerSlot}₫/người

Đã tham gia:
  ✅ Nguyễn Văn A (đã TT)
  ⏳ Trần Thị B (chưa TT)
  ⏳ Lê Văn C (chưa TT)

Thanh toán: {paidCount}/{totalCount} · {paidAmount}/{totalAmount}₫

[Đăng kèo] [Sửa] [Huỷ] [Chia sẻ link]
```

> Nút "Đăng kèo" chỉ hiện khi `status=draft`; nút "Huỷ nháp" thay "Huỷ" khi `status=draft`.

### Bot — Publish draft / Discard draft

**Publish (lệnh/callback "Đăng kèo"):**

| State | Nội dung |
|-------|----------|
| Ready | Confirm: "Đăng kèo này?" → `draft`→`open` (single-action, KHÔNG wizard) |
| Error | `SESSION_NOT_OPEN`: "Buổi chơi không mở được" (quá giờ/không draft) · `MISSING_DISCOVERY_FIELDS`: "Thiếu thông tin công khai" · `TENANT_SUSPENDED` (403): "Gói bị tạm ngưng" |

**Discard (lệnh/callback "Huỷ nháp"):**

| State | Nội dung |
|-------|----------|
| Ready | Confirm: "Huỷ buổi nháp này?" → `draft`→`cancelled` (xác nhận một chạm khi rỗng) |
| Error | `SESSION_NOT_OPEN`: "Buổi chơi không thể huỷ" · `STALE_VERSION`: "Dữ liệu đã thay đổi" · `CANCEL_REQUIRES_REVIEW`: "Cần xác nhận huỷ" (anomaly — route sang review UI SES-UC-6) |

### Web P4 — Session list

**Purpose:** Host xem tất cả sessions của club.

**Layout (desktop ≥1024px):**

```
┌──────────────────────────────────────────────────────────┐
│ Buổi chơi                           [+ Tạo buổi mới]    │
├──────────────────────────────────────────────────────────┤
│ Tabs: [Sắp tới ✓] [Đã qua] [Nháp]                      │
│                                                          │
│ ┌─ Sort: Ngày ↓ ──────────────────────────────────────┐ │
│ │ 🏸 Cầu lông chiều T5        draft  📅 05/08  18:00 │ │
│ │    📍 Sân ABC · 👥 0/8 · 💰 75k₫/ng  [Đăng kèo]   │ │
│ ├──────────────────────────────────────────────────────┤ │
│ │ ⚽ Bóng đá T7               open   📅 07/08  16:00 │ │
│ │    📍 Sân XYZ · 👥 6/10 · 💰 50k₫/ng              │ │
│ ├──────────────────────────────────────────────────────┤ │
│ │ 🏸 Cầu lông CN              open   📅 08/08  08:00 │ │
│ │    📍 Sân DEF · 👥 8/8 · Đã đầy                    │ │
│ └──────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

**Session row component:**

| Field | Data source | Ghi chú |
|-------|-------------|---------|
| Sport icon + title | `sessions.sport_id` + `sessions.title` | Taxonomy lookup for icon |
| Status badge | `sessions.status` | `draft`(grey) / `open`(green) / `closed`(red) / `cancelled`(dim) |
| Date + time | `sessions.starts_at` | Tenant timezone format |
| Venue | `sessions.venue_name` | Truncate >30 chars |
| Capacity | `players` aggregate | `active_count / slots_max` |
| Price | `sessions.price_per_slot` | Format VND; "Miễn phí" if 0 |
| Actions | Conditional | Draft: "Đăng kèo" + "Huỷ nháp"; Open: "Sửa" + "Huỷ" |

**4 States:**

| State | Nội dung |
|-------|----------|
| Loading | Skeleton rows (3 blocks × full width, shimmer) |
| Ready | Table/card list sortable by date |
| Error | Error banner: "Không tải được danh sách" + retry button |
| Empty | Icon 📋 + "Chưa có buổi chơi nào" + CTA "Tạo buổi mới" |

**Empty state layout:**

```
┌──────────────────────────────────────────────────────────┐
│ Buổi chơi                           [+ Tạo buổi mới]    │
├──────────────────────────────────────────────────────────┤
│                                                          │
│              📋                                          │
│         Chưa có buổi chơi nào                            │
│    Tạo buổi chơi đầu tiên cho club                       │
│                                                          │
│         [═══ Tạo buổi mới ═══]                           │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### Web P4 — Session create/edit form

**Purpose:** Host tạo/sửa session qua web — cùng domain service như Bot.

**Layout (desktop):**

```
┌──────────────────────────────────────────────────────────┐
│ ← Quay lại         Tạo buổi chơi mới                    │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  Môn thể thao *     [🏸 Cầu lông ▼]                     │
│                                                          │
│  Ngày *             [📅 05/08/2026    ]                  │
│  Giờ bắt đầu *     [18:00  ]   Giờ kết thúc * [20:00]   │
│                                                          │
│  Địa điểm *         [Sân ABC, Q.Bình Thạnh    ]         │
│  Khu vực             [Quận Bình Thạnh ▼]                 │
│                                                          │
│  ─── Thanh toán ───                                      │
│  (○) Miễn phí                                            │
│  (●) Chia đều  →  Tổng tiền sân: [600,000 ₫]            │
│  (○) Cố định/slot                                        │
│  (○) Theo giới tính (DD-39)                              │
│  Summary: "8 người · 600,000₫ ÷ 8 = 75,000₫/người"     │
│                                                          │
│  Số người *         [- 8 +]                              │
│  Hiển thị           [Public ▼]                           │
│                                                          │
│  ─── Cài đặt nâng cao (collapsed) ───                   │
│                                                          │
│         [═══════ Tạo buổi chơi ═══════]                  │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

**Form field spec:**

| Field | Type | Required? | Validation |
|-------|------|-----------|------------|
| Môn thể thao | Select (taxonomy) | ✅ | Active sport taxonomy only (E#2) |
| Ngày | Date picker | ✅ | ≥ today |
| Giờ bắt đầu/kết thúc | Time picker | ✅ | ends_at > starts_at (E#1) |
| Địa điểm | Text input | ✅ | Non-empty |
| Khu vực | Select | Optional | For public discovery (E#7) |
| Hình thức thanh toán | Radio group | ✅ | Default: Chia đều |
| Tổng tiền sân / Giá/slot | Number input | Conditional | Required if paid pricing |
| Số người (slots_max) | Counter | ✅ | > 0; public bắt buộc finite (E#7) |
| Hiển thị | Select | ✅ | Public / Private |

**4 States:**

| State | Nội dung |
|-------|----------|
| Loading | Skeleton form (6 input blocks shimmer) |
| Ready | Full form with validation — CTA enabled khi tất cả required fields valid |
| Error | Inline errors per field: red border + text dưới input |
| Empty | N/A (form luôn có content) |

### Web P4 — Session detail

**Purpose:** Host xem + quản lý session — roster, payments, actions.

**Layout (desktop):**

```
┌──────────────────────────────────────────────────────────┐
│ ← Danh sách      🏸 Cầu lông chiều T5    [draft] badge  │
├────────────────────────────┬─────────────────────────────┤
│  📅 05/08/2026 18:00–20:00│  ─── Hành động ───          │
│  📍 Sân ABC, Q.Bình Thạnh │  [Đăng kèo]  (draft only)  │
│  💰 75,000₫/người          │  [Sửa]                     │
│  👥 6/8 người               │  [Chia sẻ link]            │
│                             │  [Huỷ nháp]  (draft only)  │
│                             │  [Huỷ]  (open only)        │
├────────────────────────────┴─────────────────────────────┤
│  ─── Danh sách tham gia (6/8) ───                        │
│  ┌────────────────────────────────────────────────────┐  │
│  │ [AV] Nguyễn Văn A     active    ✅ Đã thanh toán  │  │
│  │ [AV] Trần Thị B       active    ⏳ Chưa TT        │  │
│  │ [AV] Lê Văn C         active    ⏳ Chưa TT        │  │
│  │ [AV] Phạm D           waitlisted  #1              │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  ─── Thanh toán (3/6 đã TT) ───                         │
│  ▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░  50%                              │
│  Đã thu: 225,000₫ / 450,000₫                            │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

**Component: Publish/Discard controls (Web):**

| Condition | Hiển thị | Tap action |
|-----------|----------|------------|
| `status=draft` | Nút "Đăng kèo" (primary) + "Huỷ nháp" (danger) | Confirm dialog → `PublishSession` / `CancelSession` |
| `status=open` | Nút "Sửa" + "Huỷ" | Edit form / Cancel confirm (với roster preview) |
| `status=closed/cancelled` | Chỉ badge + readonly info | — |

**Component: Roster list:**

| Player status | Icon | Hiển thị | Venue visible? |
|--------------|------|----------|----------------|
| `active` | ✅/⏳ | Tên + payment status | ✅ Yes (E#6) |
| `waitlisted` | 🕐 | Tên + position (#N) | ❌ Area only (E#6) |
| `left` | ↩️ | Tên + "Đã rời" (dimmed) | ❌ |

**4 States:**

| State | Nội dung |
|-------|----------|
| Loading | Skeleton: info card + roster list (4 rows) + payment bar |
| Ready | Full session info + roster + payment + action buttons |
| Error | Error banner: "Không tải được buổi chơi" + retry |
| Empty | N/A (session always has data) |

### Data source mapping

| Component | Data source | Ghi chú |
|-----------|-------------|---------|
| Session info card | `sessions` table (direct) | Tenant-scoped via RLS |
| Roster list | `players` table + join `memberships` | Active/waitlisted/left filter |
| Payment summary | `charges` table (aggregate) | Canonical contract from `feature_payment_reconcile` |
| Status badge | `sessions.status` enum | State machine §4 |
| Sport icon | `sport_taxonomy` | Active taxonomy lookup |
| Publish/Discard controls | `sessions.status` | Conditional: draft-only actions |

### State coverage matrix

| Surface | Screen | Loading | Ready | Error | Empty |
|---------|--------|---------|-------|-------|-------|
| Bot | `/newsession` wizard | ✅ Typing indicator | ✅ Step-by-step | ✅ Inline error/field | ⚪ N/A (wizard) |
| Bot | Session detail `/status` | ✅ "Đang tải..." | ✅ Info + roster | ✅ "Không tìm thấy" | ⚪ N/A |
| Bot | Session cancel confirm | ⚪ N/A | ✅ Preview impact | ⚪ N/A | ⚪ N/A |
| Bot | Publish draft | ⚪ N/A | ✅ Confirm | ✅ 3 error codes | ⚪ N/A |
| Bot | Discard draft | ⚪ N/A | ✅ Confirm | ✅ 3 error codes | ⚪ N/A |
| Web P4 | Session list | ✅ Skeleton rows | ✅ Table/card sort | ✅ Banner + retry | ✅ CTA "Tạo buổi mới" |
| Web P4 | Session create/edit | ✅ Skeleton form | ✅ Full form | ✅ Inline errors | ⚪ N/A (form) |
| Web P4 | Session detail | ✅ Skeleton cards | ✅ Full info + roster | ✅ Banner + retry | ⚪ N/A |
| Web P4 | Publish control | ✅ Button spinner | ✅ Confirm dialog | ✅ Inline error codes | ⚪ N/A |
| Web P4 | Discard draft control | ✅ Button spinner | ✅ Confirm dialog | ✅ Inline error codes | ⚪ N/A |

---

## 4. Domain Model

| Entity | Vai trò | Key constraints |
|--------|---------|-----------------|
| `sessions` | Buổi chơi chính | `tenant_id` FK, `sport_id` FK, `starts_at/ends_at` timestamptz, `slots_max` nullable/positive (`NULL` = unlimited chỉ cho non-public; public bắt buộc finite — E#7), `visibility` enum (private/public), `status` enum |
| `players` | Player tham gia/waitlist | `UNIQUE(tenant_id, session_id, membership_id)`, `status ∈ active\|left\|waitlisted`; waitlisted có position dương |
| `session_surface_refs` | Reference message/session trên từng surface | `tenant_id`, `session_id`, `platform`, `target`, `external_ref`; unique `(session_id, platform, target)` |
| `session_recurrence_rules` + `session_occurrences` | Template lặp + occurrence idempotent | `rrule`, IANA `timezone`, `last_generated_at`; unique `(recurrence_rule_id, local_occurrence_key)` |

### State Machine

```mermaid
stateDiagram-v2
    [*] --> draft
    draft --> open: Host publish
    draft --> cancelled: Host discard / auto (quá giờ)
    open --> closed: Host close / auto (hết giờ)
    open --> cancelled: Host cancel
    closed --> [*]
    cancelled --> [*]
    note right of open: Accepts join/leave
    note right of closed: No new joins, read-only
    note right of cancelled: Read-only, refund flag (draft-origin: 0 roster/refund khi verified-empty — trường hợp thường; draft mang anomaly đi qua cùng review path với open, có thể có impact thật — edge #23)
```

---

## 5. Analytics Events

| Event | Khi nào | Payload tối thiểu |
|-------|---------|-------------------|
| `session_created` | Host tạo session thành công | `tenant_id`, `session_id`, `sport_id`, `visibility`, `source` (chat/web) |
| `session_published` | Host publish `draft` → `open` (không tính re-publish no-op) | `tenant_id`, `session_id`, `visibility`, `source` (chat/web) |
| `session_updated` | Host sửa bất kỳ field | `tenant_id`, `session_id`, `fields_changed[]`, `source` |
| `session_announced` | Announcement gửi thành công | `tenant_id`, `session_id`, `channel` |
| `session_closed` | Session đóng (manual/auto) | `tenant_id`, `session_id`, `close_reason` (manual/auto) |
| `session_cancelled` | Host huỷ (draft hoặc open), hoặc auto-expiry draft quá giờ | `tenant_id`, `session_id`, `roster_count`, `has_paid`, `cancel_reason` (manual/auto) |
| `session_projection_failed` | Projector fail | `tenant_id`, `session_id`, `error_code` |

> Không bao giờ log roster names, venue details, contact info trong analytics.

---

## 6. Acceptance Criteria

- [ ] Chat và web gọi cùng domain service — không duplicate logic
- [ ] Host tạo session cơ bản thành công trên cả central Page và tenant Page; club không Page không bị buộc sang web
- [ ] Messenger role/tenant picker + wizard cancel/expiry/context-switch/replay/non-admin tests pass; duplicate confirm chỉ tạo một session
- [ ] Timezone, sport, price, capacity, visibility và join-policy validations pass
- [ ] Concurrent capacity/join/payment-hold operations không thể over-fill; giảm capacity dưới active+live-hold occupancy bị reject
- [ ] Waitlisted không tự chiếm capacity, không lộ venue và không tạo charge/new-obligation; chỉ một live paid-unlinked promotion hold tạm chiếm slot. Settle→activation; expiry→release+requeue-tail. Promotion canonical DD-49 không duplicate charge
- [ ] Active leave/capacity increase fill toàn bộ slot available; finite→unlimited (chỉ non-public — public bắt buộc finite slots_max, E#7) fill mọi eligible; decrease dưới active roster reject
- [ ] Existing `active|waitlisted` trả current outcome; existing `left` re-derive live DD-49 disposition. Refunded+full không append lifecycle tới activation; unknown/unimplemented → fail-closed
- [ ] Derivation failure: first failure lazy-creates one root `promotion_retry_id` per failing capacity opener + exactly-one candidate event bound entry/root origin. Retry job one-owner CAS/lease with atomic max-3 claimed-attempt count; each completed current-order sweep tries each candidate at most once and re-checks DD-41/DD-42/`evaluateJoinRestriction()` DD-52. Sibling/duplicate events cannot fork job/budget. Expired `claimed` at count 3 is finalized under `session→job`: resolve if retry no longer applies, else terminal+review/DLQ; no stuck job/fourth attempt/fallback
- [ ] Price/cancel changes khi đã có charge → bắt buộc explicit impact handling
- [ ] Public/private/closed projection behavior correct (projector test)
- [ ] Recurring generation idempotent và timezone-safe (DST test)
- [ ] Announcement reproject works sau provider failure
- [ ] Chỉ TenantAdmin mutate sessions — non-admin nhận 403
- [ ] Publish `draft` → `open`: status flip, session nhận join, đúng một outbox event; `visibility` không đổi (status-only)
- [ ] Re-publish session đã `open` = idempotent no-op success (dedup `commandId`); không outbox event trùng
- [ ] Publish session public re-validate discovery completeness (E#7); thiếu → `MISSING_DISCOVERY_FIELDS`
- [ ] Publish session closed/cancelled/past → `SESSION_NOT_OPEN`; chỉ Host (`session.manage`)
- [ ] Publish khi tenant billing-`suspended` → fail-closed block `TENANT_SUSPENDED` (403, canonical tenant-routing code; billing Suspended Action Matrix, owned bởi `feature_billing_lifecycle`; status-authority là hard dependency, không resolve ở đây)
- [ ] Publish có surface rõ trên **bot** (lệnh/callback "Đăng kèo" trên draft, single-action không wizard) và **web** (nút Publish trên draft detail + confirm); cùng `PublishSession` command; error states (`SESSION_NOT_OPEN`/`MISSING_DISCOVERY_FIELDS`/`STALE_VERSION`/suspended) hiển thị đúng (map BE §3)
- [ ] Host discard `draft` chưa publish: `CancelSession` mở rộng nhận nguồn `draft`, verify roster/paid dưới lock (thường rỗng theo thiết kế — join chỉ mở tại publish), xác nhận một chạm khi rỗng, đúng một outbox event `session_cancelled` (`cancel_reason=manual`); áp dụng bất kể `starts_at` (không past-guard **cho nguồn `draft`**); chỉ Host (`session.manage`)
- [ ] Huỷ session `open` đã quá giờ chơi vẫn bị reject như trước khi có slice này (edge #24) — no-past-guard của discard-draft KHÔNG mở rộng sang nguồn `open`; "huỷ open không đổi hành vi" là provable, không chỉ là lời khẳng định
- [ ] Discard/cancel bắt buộc gửi `expectedVersion` khớp trên nhánh mutate; thiếu hoặc không khớp (session đã publish/sửa concurrent) → `STALE_VERSION`; zero mutation — không silent-cancel session đã `open`
- [ ] Cancel session đã `cancelled` (dù nguồn gốc draft hay open) vẫn idempotent no-op, không cần khớp version — không outbox event trùng
- [ ] Draft mang roster/charge bất thường (data anomaly) → fail-closed, KHÔNG tự động huỷ (host discard lẫn auto-expiry); host discard trả **cùng lỗi "Cần xác nhận huỷ"** đã có cho session `open` paid roster (không phải lỗi riêng cho draft)
- [ ] Auto-expiry job: draft **verified-empty** (không anomaly) với `starts_at <= now()` tự động → `cancelled` (`cancel_reason=auto`), một outbox event; draft mang anomaly bị SKIP (không auto-cancel, xem bullet trên) — không phải mọi draft quá giờ đều tự huỷ; draft tương lai và mọi session không-draft không bị đụng
- [ ] Auto-expiry job idempotent dưới concurrent invocation và xuyên tenant (`FOR UPDATE SKIP LOCKED`, tenant isolation qua RLS) — không double-cancel, không double event, không rò rỉ cross-tenant; cơ chế thực thi cross-tenant chính xác là build-slice detail
- [ ] Draft anomaly bị auto-expiry skip vẫn được re-claim mỗi lượt (rẻ, không phải bug) nhưng owner-facing alert dedupe theo session — không spam lặp lại mỗi lần job chạy
- [ ] Discard/auto-expiry có surface rõ trên **bot** (lệnh/callback "Huỷ nháp") và **web** (nút "Huỷ nháp" + confirm); cùng `CancelSession` command mở rộng; error states (`SESSION_NOT_OPEN`/`STALE_VERSION`/**"Cần xác nhận huỷ" khi anomaly**) hiển thị đúng (map BE §3)

---

## 7. Open Questions / Changelog

### Open Questions

| ID | Quyết định | Trạng thái |
|---|---|---|
| SES-OQ-1 | Behavior khi host change price mà đã có charges | ✅ **Chốt DD-49; timing closure ghi tại decisions v1.58** — chưa refund carry-over; refunded chỉ append lifecycle khi outcome active. Full→waitlisted defer lifecycle/nợ mới tới promotion. Không mặc định row `charges` thứ hai; storage/API chờ design-probe. |
| SES-OQ-2 | Recurrence editing: sửa 1 occurrence hay this-and-future? | ⬜ Chưa chốt |
| SES-OQ-3 | Waitlist + auto-promote | ✅ **Chốt DD-45/DD-45a/DD-49** — schema `0014` đã merge; behavior chưa build. DD-45a owner-final 2026-07-28 yêu cầu future promotion slice thêm partial `UNIQUE (session_id, waitlist_position) WHERE status='waitlisted'` bằng migration monotonic mới; duplicate preflight phải HALT/manual, không auto-renumber; gaps hợp lệ. Allocator vẫn gán tail rank dưới session lock, unique là final fence. Chờ DD-39/41/42/52, DD-49 correction core, SessionService, queue-entry-version, tenant-private root store + narrow scheduler/CAS worker + expired-final finalizer, candidate audit consumer, root-keyed owner digest và DLQ. **Không có runtime/migration mới từ quyết định này.** |
| SES-OQ-4 | Field mô tả session + gating (title/notes/`session_type`/byoe/cost_shared + gating level-rank/gender/age) | ✅ **Chốt DD-41** — enforce ở shared `evaluateSessionEligibility`←`addMemberToSession`, self-attested, 9 exact codes; body/schema propagate lúc build → `../decisions/analysis/dd-41-session-fields-gating-analysis.md` |
| SES-OQ-5 | No-show/attendance/reliability + policy deprioritize/ban | ✅ **Chốt DD-42** — per-tenant (attendance trên `players`, reliability trên `memberships`, RLS, không public); build P4+ → `../decisions/analysis/dd-42-reliability-analysis.md` |
| SES-OQ-6 | Nhãn thành viên + audience targeting khi announce | ✅ **Chốt DD-43** — `membership_tags` per-tenant chỉ cho notification audience; join eligibility vẫn DD-41; public không lộ tag; build P4+ → `../decisions/analysis/dd-43-membership-tags-analysis.md` |
| SES-OQ-7 | Invite-link token cho kèo private | ✅ **Chốt DD-44/DD-52** — `session_invite_tokens` entropy≥128-bit/hash/bound; current active/waitlisted/pending or exact replay resolves before `max_uses`/DD-41/DD-42/DD-52 and does not consume again. Only a new absent/left transition increments use; token không hạ visibility → `../decisions/analysis/dd-44-invite-token-analysis.md` |

### Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-07-28 | v2.17 | Mirror DD-32 Option D: admission occupancy = active+live payment holds; capacity reduction guard, paid-unlinked promotion hold/venue boundary and expiry requeue-tail. Contract only; SessionService/intent runtime absent. |
| 2026-07-28 | v2.16 | Mirror DD-45a owner-final: future promotion slice thêm partial unique position bằng migration monotonic mới; preflight duplicate HALT/manual, không auto-renumber; gaps hợp lệ; session-lock allocator + unique final fence. Schema `0014`/runtime hiện tại không đổi. |
| 2026-07-27 | v2.15 | Mirror migration `0024`: validated public-session finite-capacity CHECK đã merge. Giữ `Implementation: Not started` cho SessionService/routes/projector/auto-promote; DB invariant không phải product runtime. |
| 2026-07-24 | v2.14 | **Draft-lifecycle cleanup (founder-ratified, `docs-session-draft-lifecycle`):** đóng gap publish contract flagged ở v2.13 (codex round-03) — một `draft` quá `starts_at` mà chưa publish bị kẹt vĩnh viễn (không có draft-terminal transition). Author CẢ HAI cleanup path founder chốt, terminal status `cancelled` (reuse enum có sẵn): **SES-UC-13** (Host discard `draft` qua `CancelSession` mở rộng nhận nguồn `draft` ngoài `open` — draft không thể có roster/charge **theo thiết kế** vì join chỉ mở tại publish (SES-UC-12), nhưng đây là bất biến ứng dụng chứ không phải DB constraint nên hệ thống **verify dưới lock** thay vì giả định, fail-closed nếu phát hiện anomaly (edge #23); `expectedVersion` **bắt buộc** trên nhánh mutate, mọi nguồn — đóng race click-cũ-cancel-nhầm-session-vừa-published; không past-guard như publish) và **SES-UC-14** (System auto-expiry job quét draft quá giờ chưa publish, cùng transition, `cancel_reason=auto`, mirror discipline `FOR UPDATE SKIP LOCKED` của Daily Lifecycle Job — BE §4; cơ chế thực thi cross-tenant chính xác là build-slice detail, cùng mức trừu tượng Daily Lifecycle Job tự thân). Edge #20 (discard transition + idempotent cancel-already-cancelled), #21 (`expectedVersion` thiếu/không khớp trên draft vừa publish → `STALE_VERSION`, chặn silent-cancel một session đã `open` ngoài ý host), #22 (auto-expiry job concurrency xuyên tenant — không double-cancel, không rò rỉ cross-tenant), #23 (draft mang roster/charge bất thường → fail-closed, `CANCEL_REQUIRES_REVIEW` — cùng lỗi review đã có cho `open` paid roster, không phải lỗi riêng cho draft), #24 mới (huỷ session `open` đã quá giờ vẫn reject như cũ — no-past-guard CHỈ áp dụng nguồn `draft`, giữ đúng lời hứa "open không đổi hành vi", provable qua BE test #61 chứ không chỉ khẳng định). §3 Screens & States: discard draft surface trên bot (lệnh/callback "Huỷ nháp") + web (nút "Huỷ nháp"), cả hai đều thêm error state "Cần xác nhận huỷ" cho case anomaly. State machine §4: transition mới `draft --> cancelled` (note cancelled-state điều kiện theo verified-empty vs. anomaly-reviewed). `session_cancelled` analytics event thêm `cancel_reason` (manual/auto), mirror shape `close_reason` có sẵn của `session_closed`. 9 AC bullet mới. §1 Ngoài phạm vi: pointer cũ (forward-pointer tới slice này) nay resolve thành cross-ref SES-UC-13/14. Không schema change tới object hiện có; BE target contract thêm một partial index mới chưa applied (`idx_sessions_draft_starts_at`, cùng budget `≤1 monotonic migration`); không endpoint mới (reuse `POST /api/sessions/:id/cancel`); không error code mới (reuse `SESSION_NOT_OPEN`/`STALE_VERSION`/`CANCEL_REQUIRES_REVIEW`). Negative scope: không đụng publish (`draft`→`open`), billing suspend-gate hay `feature_billing_lifecycle`. **Iteration note:** contract này hội tụ qua nhiều vòng codex review (lịch sử đầy đủ ở `docs/autopilot-backlog.md` task block); các vòng đầu khám phá một cơ chế Postgres privilege/role-bootstrap đầy đủ cho auto-expiry job trước khi founder redirect toàn bộ lớp chi tiết đó theo đúng precedent Daily Lifecycle Job (chỉ business contract, infra wiring dời sang build slice); một vòng full-base confirmation sau đó phát hiện wording "không past-guard" của draft-discard đã vô tình nới rộng sang exempt cả nguồn `open` khỏi past-session restriction cũ — sửa lại đúng phạm vi (chỉ `draft`) và wire nhánh anomaly vào `CANCEL_REQUIRES_REVIEW` sẵn có thay vì để ngỏ. Bản ghi ở đây là scope cuối cùng, founder-confirmed. Dated changelog giữ verbatim; không resolve OQ nào khác. |
| 2026-07-24 | v2.13a | **De-pin migration-tail** (docs-migration-tail-0018-to-0020-sweep): header Implementation line + SES-OQ-3 row hard-pinned `migrations 0000–0018` → non-pinned "verify tail hiện hành tại `packages/db/migrations/`, không hard-pin số" (live tail nay `0020`; `0019`/`0020` tenant-integrity FKs DD-68 landed sau sweep 0018 trước). Dated provenance `origin/main`@`22c23aa` giữ nguyên verbatim. Pre-existing dated changelog giữ verbatim. Không đổi contract. |
| 2026-07-23 | v2.13 | **PUBLISH transition contract (founder-ratified, `docs-session-publish-contract`):** author draft→open publish vào use-case/AC surface. Thêm **SES-UC-12** (Host publish `draft`→`open`, distinct `PublishSession` command, chat+web cùng service), edge #16 (idempotent re-publish no-op, status-only — không đổi visibility), #17 (publish public re-validate E#7 → `MISSING_DISCOVERY_FIELDS`), #18 (publish closed/cancelled/past → `SESSION_NOT_OPEN`, Host-only), #19 (publish khi tenant billing-`suspended` → **fail-closed block 403**, billing Suspended Action Matrix — **named dependency on `feature_billing_lifecycle`**, status-authority không resolve ở đây → **HARD DEPENDENCY** `docs-billing-publish-suspension-authority`), analytics event `session_published`, **§3 Screens & States publish surface (bot lệnh/callback "Đăng kèo" + web nút Publish + confirm/error)**, và 6 AC bullets. State machine §4 `draft --> open: Host publish` giữ nguyên. **Status-only**: publish KHÔNG đổi `visibility` (visibility set ở create/edit, E#7-validated độc lập). Reuse error codes `SESSION_NOT_OPEN` + `MISSING_DISCOVERY_FIELDS` (không invent). Projection-timing = **OPEN cross-authority reconcile** (session intent project-on-publish; PRD FLOW 2 + `feature_marketplace_discovery` own it, cross-ref only) → **HARD DEPENDENCY** `docs-prd-flow2-publish-projection-reconcile`. **Publish contract AUTHORED nhưng NOT code-ready cho tới khi 2 hard deps (billing-authority + projection-reconcile) merge** (BE §4 code-readiness note). No schema change (status enum draft/open/closed/cancelled đã tồn tại). §1 Ngoài phạm vi thêm pointer: **dọn draft chưa publish** (draft-terminal cleanup) là gap có sẵn từ `create=draft`, out of scope → follow-up `docs-session-draft-lifecycle` (codex round-03). Re-sliced sau codex rounds 01–06 (founder-ratified): scope giảm về 2 session specs + README + backlog. Dated changelog giữ verbatim; không resolve OQ nào khác. |
| 2026-07-23 | v2.12c | **Reconcile 2 inconsistencies (AP-25 round-06, founder-ratified):** (1) create-status — SES-UC-1 kết quả reword: create = `draft`, Host publish → `open`, khớp state machine §4 + TDD (DDL default `draft`, POST example `draft` — vốn đã đúng, không đổi); (2) public-capacity — pin E#7 authority: public bắt buộc **finite `slots_max`** (`NULL` = unlimited chỉ hợp lệ non-public) vào E#7, domain model §4 và AC finite→unlimited qualifier. Prose only; dated changelog giữ verbatim; không resolve OQ nào khác. |
| 2026-07-23 | v2.12b | **Reconcile 0014 merge-state (TDD→PRD):** current-state claim sửa → **0014 đã merge trên `main` (`1a6ac38`, migrations 0000–0018)** ở header Implementation + row SES-OQ-3 (giữ open "behavior chưa build"; provenance `origin/main`@`22c23aa` reframed thành historical marker). Pre-existing dated changelog giữ verbatim. Không đổi contract. |
| 2026-07-19 | v2.12a | Metadata sweep (index v2.35): thêm trường **Implementation** đồng bộ BUILD-STATUS (Not started). Không đổi contract. |
| 2026-07-19 | v2.12 | **DD-44/45 restriction + claimed-attempt closure:** invite current/replay no-extra-use; waitlist root lazy on first failure, max 3 claimed attempts, expired-final resolve-or-terminal, tenant-private narrow claim and one owner digest/root. Behavior remains unbuilt. |
| 2026-07-19 | v2.11 | **DD-45 retry-owner/queue/restriction closure:** one root promotion job owns max-3 full sweeps; candidate events are sibling alert/audit refs, not budgets. Each sweep re-enters current order, tries each candidate once and re-checks DD-41/DD-42/DD-52; pin reorder/ban/N×N-budget regressions. Behavior remains unbuilt. |
| 2026-07-19 | v2.10 | **DD-45 retry closure:** bind failure event to queue-entry version + origin command; require CAS/lease max-3 claim state, consume-time revalidation, crash recovery and terminal review/DLQ. SES-OQ-3 points to `aa8afae` while preserving schema provenance `1a6ac38`; behavior remains unbuilt. |
| 2026-07-19 | v2.9c | **DD-45×DD-49 integrity:** venue active-only; refunded rejoin waitlisted không new lifecycle; promotion re-derive rồi append only at activation. Failure retry one origin event + max 3/backoff/no recursion/exhausted review-DLQ. SES-OQ-3 cites schema `1a6ac38`, current HEAD `bb47c15`, main `22c23aa`; behavior vẫn chưa build. |
| 2026-07-19 | v2.9b | **DD-45 schema landed on branch:** SES-OQ-3 tách schema vs behavior — migration `0014_players_waitlist` đã commit trên `feat/session-waitlist-expand`, chưa merge main (status domain + `waitlist_position` + state-shape/positive CHECK + `idx_players_waitlist_order`, 21 DDL invariant test gồm app-role RLS/grant). Auto-promote vẫn **chưa build**. |
| 2026-07-17 | v2.9a | §1 Ngoài phạm vi: thêm **pointer** court booking + scoring → `feature_session_organize` (DD-61..64 🟡 proposal, post-phase-1). Pointer-only, không thêm scope organize vào body Reviewed (cùng pattern one-line pointer DD-39 ở v2.1). |
| 2026-07-17 | v2.9 | **DD-65..68:** host create-session parity trên central+optional tenant Page; durable pre-dispatch wizard, protected tenant context, final AuthZ/snapshot re-check và idempotent shared command acceptance. |
| 2026-07-16 | v2.8 | **Full DD-49 propagation:** body/edge/AC thay left-rejoin reject mặc định bằng normal rejoin + carry-over/refunded disposition; giữ `REJOIN_REQUIRES_REVIEW` chỉ cho unknown/unimplemented correction state. Price change dùng signed obligation adjustment contract, không giả định delta/new `charges` row. Authority: decisions v1.37. |
| 2026-07-15 | v2.6 | **DD-39×DD-45 failure contract:** promotion derive amount trước mutation; derivation fail giữ waitlisted/no-charge/no-venue, audit+retry/owner-alert, không rollback leave/capacity opener và tiếp tục candidate kế. |
| 2026-07-15 | v2.5 | **Propagation (light):** neo DD-41 (session fields+gating), DD-42 (attendance/reliability), DD-43 (membership_tags audience), DD-44 (invite token) vào Open Questions với pointer file phân tích. Decision-level đã ✅; body/schema/migration propagate lúc build slice (không đổi Reviewed body). |
| 2026-07-15 | v2.4 | **DD-45 closure:** pin open/approval full→waitlisted và `left` self-rejoin fail-closed `REJOIN_REQUIRES_REVIEW`; không reuse/duplicate charge khi refund/void policy còn mở. |
| 2026-07-15 | v2.3 | **DD-45 ✅:** pin waitlist state-shape/positive position, total order, atomic charge-on-promote, fill-available/unlimited capacity boundaries, skip-on-ineligible và giữ `CAPACITY_BELOW_ROSTER`; code/migration vẫn pending. |
| 2026-06-18 | v1.0 | Initial spec (English format) |
| 2026-06-19 | v2.0 | Chuẩn hoá Vietnamese numbered format, thêm 10 use cases, 12 edge cases, state machine, screen states chi tiết |
| 2026-07-10 | v2.1 | **DD-37:** kênh phase-1 = Zalo + Messenger (bỏ Telegram); screens "TG Bot" → "Bot (Zalo/Messenger)". Thêm **one-line pointer giá theo giới tính → DD-39 (proposal) / feature_user_settings** (không thêm schema giới tính vào body Reviewed). |
| 2026-07-13 | v2.2 | Reconcile canonical schema vocabulary: `players`, `session_surface_refs`, `session_recurrence_rules/session_occurrences`. SES-UC-9 chỉ giải phóng slot; waitlist auto-promote deferred tới khi DD-45 được chốt + migration. |
| 2026-07-16 | v2.7 | **Propagation (light) DD-49:** SES-OQ-1 ✅ (đổi giá host-choice delta/grandfather; rejoin carry-over thay left-rejoin fail-closed DD-45). Body/schema từng defer build slice; được full-propagate ở v2.8. |
