# Feature: Player View (Person-self) — Product/UX Spec

> **Canonical phase:** P4.6  
> **Track:** 👤 Player View  
> **Version:** 2.11 · 2026-08-12
> **Status:** Reviewed  
> **Implementation:** Not started · authority: `../standards/BUILD-STATUS.md` (Doc status ≠ Implementation status)  
> **Prerequisites:** P3.5 identity · P3 ledger · P4 web auth/magic link · P4 sync realtime  
> **Tài liệu liên quan:** `../product/BRD.md` FR-8 · `../product/PRD.md` FLOW 10 · `../product/TDD.md` §3.4/§4 (person-self contract) · `../BE/feature_player_view_tech.md` · `../standards/decisions.md` DD-91/DD-96 · `../proposals/in-app-chat-primary-player-surface-plan-2026-07-27.md`

> **DD-48 boundary:** `/me` vẫn person-self và không nhận arbitrary person id. Cross-user social profile thuộc `feature_user_settings` (`GET /api/persons/:id/profile`) với DTO riêng; host operational member/roster data đi tenant-scoped path riêng. Không tái dùng `/me` serializer cho hai path đó.

> **DD-91 primary-surface boundary:** một canonical person-self service `getSelfPaymentStatus` cấp cùng payment truth cho `/api/me/charges`, chat `/pay` và authenticated notification detail. Human DM có `tenant_id=NULL`, nên `/pay` không được đoán CLB từ peer/channel: server auto-select khi requester chỉ có một CLB đủ điều kiện, còn nhiều CLB thì trả picker opaque chỉ requester thấy. Không surface nào nhận arbitrary `person_id`; lỗi authz/integrity/dependency trả trạng thái `unknown`, không biến null/unproven thành 0.

> **Execution ownership:** mechanism slices 17 `player-self-charge-read-core`, 18 `player-self-profile-clubs-read-core` và 19 `player-self-sessions-waitlist-read-core` là ba read owner tách biệt; chat adapters 24–26 chỉ compose các owner này qua requester-only transport. Slice 19 được author read-only trực tiếp trên baseline `players JOIN memberships JOIN sessions` đã merge và **không** hard-depend full SessionService. Tuy nhiên `/sessions|/waitlist` beta giữ OFF cho tới khi strict current-authority packets `svc-session-crud`, `svc-session-join-leave`, `svc-waitlist-promotion-core` cùng production-shaped data E2E đều xanh. Primary plan v1.8 đã `PLAN_READY` tại `90d292d`; pair vẫn Not started và từng mechanism slice vẫn phải có strict `CODE_READY`.

---

## 1. Mô tả

Cho verified player xem **chỉ dữ liệu của chính mình**: clubs, upcoming sessions, charges/payment status và join requests **across tenants** trên web và bot. Đây là privileged cross-tenant read path — KHÔNG phải tenant-admin access.

### Entry points

| Entry | Route / Surface | Actor | Mô tả |
|-------|----------------|-------|-------|
| Web → `/me` dashboard | `/me` (authenticated) | Player | Tổng hợp clubs + sessions + charges |
| Home tab → "Đã tham gia" | Home → My sessions section | Player | Upcoming sessions card |
| Home tab → "Còn nợ" chip | Home → Outstanding debt summary | Player | `getSelfPaymentSummary` aggregate |
| Bot → "Kèo của tôi" / "Nợ của tôi" | Messenger/Zalo persistent menu | Player | Person-self summary trong bot |
| Bot → `/pay` command | Club chat / private DM | Player | Requester-only payment status |
| Bot → `/sessions` / `/waitlist` | Club chat / private Club Bot | Player | Beta: own sessions/waitlist status |
| Notification detail | Push/in-app noti → deep link | Player | Authenticated charge detail |
| Magic link (Zalo) | Web auth callback | Player | Zalo → web person-self view |

### Bất biến

- Person authority chỉ từ **verified session/magic link** — KHÔNG từ URL/body person ID.
- DTO allowlisted: chỉ own membership/session/charge/allocation status — KHÔNG other roster/debt/admin fields.
- Cross-tenant errors KHÔNG reveal inaccessible club existence.
- `/api/me/charges`, chat `/pay` và authenticated notification detail phải đọc cùng `getSelfPaymentStatus`; không surface nào tự tính lại số còn nợ.
- Số 0 chỉ được hiển thị khi ledger chứng minh `SelfPaymentStatus.kind="known_zero"`; dữ liệu thiếu/không xác minh được phải fail-closed thành `unknown`.
- **Cross-club aggregate (DD-96 Part A):** `getSelfPaymentSummary` là owner duy nhất của tổng nợ xuyên CLB; consumer (Home) KHÔNG được cộng per-club status. Một CLB `unknown` ⇒ cả summary `unknown` — cấm partial sum.
- **Host receivable ("Chưa thu") KHÔNG thuộc feature này** (DD-96 Part B): đó là charge của người khác, tenant-scoped, role-gated → owner riêng theo DD-48. Không mở rộng `/me*` hay serializer person-self để chứa nó.

---

## 2. Use Cases + Edge Cases

### Use Cases

| ID | Actor | Hành động | Kết quả |
|---|---|---|---|
| PVW-UC-1 | Player (web) | Authenticate + view /me dashboard | Own clubs + sessions + debts summary |
| PVW-UC-2 | Player (Zalo) | Nhận magic link → open web | Same person view as Google/email-authenticated web |
| PVW-UC-3 | Player (Messenger) | Chọn **My Clubs** trong persistent menu | Concise club/debt/session list trong cửa sổ hợp lệ |
| PVW-UC-4 | System | Join/payment/merge event | Realtime invalidate/refetch own data |
| PVW-UC-5 | Player | View active club memberships | List with role, status, debt summary |
| PVW-UC-6 | Player | View upcoming sessions across clubs | Timeline sorted by date |
| PVW-UC-7 | Player | View current outstanding payment status | Mỗi club có `known_zero` hoặc items `open|partial` + `amountDue`/`amountAllocated`/`remaining`; optional `SelfPaymentStatus.payAction` chỉ cho club đó. Paid/void history cần DTO riêng |
| PVW-UC-8 | Player | View join request status | Pending/approved/rejected/expired |
| PVW-UC-9 | System | Account merge | Immediately converge to canonical Person view |
| PVW-UC-10 | Player | View left-club history | Deferred: membership status có thể hiện khi own-club DTO trả; historical paid/void/ledger cần DTO/route riêng |
| PVW-UC-11 | Player | Gõ exact `/pay` trong club chat hoặc private bot thread | Card payment status của chính mình, chỉ requester thấy |
| PVW-UC-12 | Player | Gõ exact `/pay` trong human DM | Một CLB đủ điều kiện thì mở thẳng; nhiều CLB thì picker opaque chỉ requester thấy, peer không nhận command/result |
| PVW-UC-13 | Player | Mở authenticated payment notification detail | Cùng status/remaining amount như `/api/me/charges` và `/pay` tại thời điểm đọc |
| PVW-UC-14 | Player | Gõ exact `/sessions` hoặc `/waitlist` trong club chat/private Club Bot | Requester-only DTO của chính mình từ canonical person-self read; chỉ bật beta sau current Session packets + production-shaped data E2E |
| PVW-UC-15 | Player | Xem tổng nợ xuyên CLB (chip "Còn nợ" trên Home) | `getSelfPaymentSummary` trả `totalOutstanding` + `clubCount` (số CLB có outstanding > 0) hoặc proven `known_zero`; tap → outstanding detail liệt kê per-club `items[]` = các kèo chưa trả |
| PVW-UC-16 | Player | **Trả hộ bạn** — vào session detail, chọn player còn nợ cùng session → gửi buddy payment request | Trả full remaining charge. Hiện danh sách player cùng session có charge `open|partial` (ẩn chính mình). Tạo `buddy_payment_request` (pending). Notify recipient. Trạng thái pending hiện trên roster. Cross-ref: `feature_payment_reconcile.md` PAY-UC-19/20/21 |

### Edge Cases

| # | Category | Case | Hành vi bắt buộc |
|---|----------|------|-------------------|
| 1 | Security | URL/body chứa arbitrary person ID | Reject — chỉ accept verified session/magic link |
| 2 | Security | DTO chứa other-player roster/debt | ❌ NEVER — allowlist enforced |
| 3 | Data Integrity | Club display sau khi left | Chỉ hiện "Đã rời" khi own-membership DTO trả status; không render historical ledger từ current outstanding projection |
| 4 | Security | Magic link replay/expired | Reject — hash-only, TTL, single-use, session-rotating |
| 5 | Security | Magic link wrong channel/person | Reject — channel/person bound |
| 6 | Cross-Feature | Account merge → old magic links | Invalidate old links/topics — use merged person |
| 7 | Security | Cross-tenant error reveal club existence | ❌ NEVER — return 403/empty, KHÔNG leak club name/info |
| 8 | Data Integrity | Partial/overpay/unallocated bank tx | Display only khi safely attributable to person |
| 9 | Security | Realtime topic guessing | 403 — authz enforced per topic |
| 10 | Resilience | Realtime disconnect | Fallback refetch/polling — no data loss |
| 11 | Security | Log/analytics chứa other-player PII | ❌ NEVER — opaque IDs only |
| 12 | Data Integrity | Merge session revocation | Old sessions/links invalidated immediately |
| 13 | Security | Human DM `/pay` có `tenant_id=NULL` | Không suy tenant từ peer; resolve chỉ từ own eligible memberships, trả picker opaque actor-bound khi có nhiều CLB |
| 14 | Privacy | Peer trong human DM quan sát slash/result | ❌ NEVER — command, picker và result là requester-only; không ghi shared message/history/notification |
| 15 | Data Integrity | Ledger/authz/dependency không chứng minh được balance | Trả `unknown` + retry/fallback generic; không diễn giải null/error là không nợ |
| 16 | Security | Client gửi `person_id`/raw `tenant_id` cùng `/pay` hoặc notification detail | Reject/ignore fail-closed; person từ authenticated context, CLB từ trusted channel hoặc opaque actor-bound ref |
| 17 | Enablement | Slice 19 read tests xanh nhưng một Session packet hoặc production-shaped E2E còn thiếu | Giữ `/sessions|/waitlist` beta OFF; không suy full Session authority từ read core |
| 18 | Money/Data | Cross-club summary: 1 CLB `known_amount`, 1 CLB `unknown` | Summary = `unknown` + retry. ❌ NEVER trả tổng của riêng CLB known — con số đó thấp hơn nợ thật và trông authoritative |
| 19 | Data Integrity | Person chưa thuộc CLB nào gọi summary | `known_zero` (không phải `unknown`) — không CLB nào là bằng chứng không nợ, khác với không đọc được |
| 20 | Cross-Feature | Player trả hộ: charge thay đổi giữa request và host confirm | Roster realtime cập nhật pending buddy state; nếu charge paid do song song (mark-paid/auto-reconcile) → auto-cancel buddy request, nút "Trả hộ" biến mất. Không over-allocate |

---

## 3. Screens & States

> Coverage: Web (person-self dashboard) + Bot (Zalo/Messenger) + Chat adapters. Mobile-first 375px; desktop ≥1024.

### Web — `/me` dashboard

**Purpose:** Player xem tổng quan: clubs, upcoming sessions, debt overview.

**Layout (desktop ≥1024px):**

```
┌──────────────────────────────────────────────────────────┐
│ 👤 Xin chào, {displayName}                              │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  ─── Tổng nợ ───                                         │
│  ┌────────────────────────────────────────────────────┐  │
│  │ 💰 Còn nợ: 225,000₫ (2 CLB)       [Xem chi tiết →]│  │
│  └────────────────────────────────────────────────────┘  │
│  ↑ chỉ hiện khi getSelfPaymentSummary trả known_amount   │
│  ↑ nếu unknown → "⏳ Không xác nhận được lúc này"        │
│  ↑ nếu known_zero → ẩn section / "✅ Không còn nợ"      │
│                                                          │
│  ─── CLB của bạn (3) ───                                 │
│  ┌────────────────────────────────────────────────────┐  │
│  │ 🏸 CLB Cầu lông Bình Thạnh                        │  │
│  │    Thành viên · 2 kèo sắp tới · Còn nợ: 75,000₫  │  │
│  ├────────────────────────────────────────────────────┤  │
│  │ ⚽ FC Thủ Đức                                      │  │
│  │    Thành viên · 1 kèo sắp tới · ✅ Không nợ       │  │
│  ├────────────────────────────────────────────────────┤  │
│  │ 🏓 Pickleball Q7                                   │  │
│  │    Thành viên · Không có kèo · Còn nợ: 150,000₫   │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  ─── Kèo sắp tới (3) ───                                │
│  ┌────────────────────────────────────────────────────┐  │
│  │ 🏸 Cầu lông chiều T5    📅 10/08  18:00           │  │
│  │    CLB Cầu lông BT · 👥 6/8 · ⏳ Chưa TT 75,000₫ │  │
│  ├────────────────────────────────────────────────────┤  │
│  │ ⚽ Bóng đá T7            📅 12/08  16:00           │  │
│  │    FC Thủ Đức · 👥 8/10 · ✅ Đã TT                │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

**Component: Club card:**

| Field | Data source | Ghi chú |
|-------|-------------|---------|
| Club name + sport icon | `tenants` via `memberships` | Cross-tenant read |
| Role | `memberships.role` | "Thành viên" / "Admin" |
| Upcoming count | `players` WHERE own + future | Per-club aggregate |
| Debt chip | `getSelfPaymentStatus` per club | `known_zero` / `known_amount` / `unknown` |

**4 States:**

| State | Nội dung |
|-------|----------|
| Loading | Skeleton cards (debt chip + 3 club cards + 2 session cards) |
| Ready | Clubs + sessions + debt summary |
| Error | Error banner: "Không tải được dữ liệu" + retry |
| Empty | Icon 🏸 + "Chưa tham gia club nào" + CTA "Khám phá" |

### Web — `/me` club detail

**Layout (desktop):**

```
┌──────────────────────────────────────────────────────────┐
│ ← Dashboard      🏸 CLB Cầu lông Bình Thạnh             │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  Vai trò: Thành viên · Tham gia từ: 01/06/2026          │
│                                                          │
│  ─── Kèo sắp tới ───                                    │
│  ┌────────────────────────────────────────────────────┐  │
│  │ 🏸 Cầu lông chiều T5    📅 10/08  18:00           │  │
│  │    📍 Sân ABC · 👥 6/8 · 💰 75,000₫ · ⏳ Chưa TT  │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  ─── Thanh toán ───                                      │
│  Còn nợ: 75,000₫ (1 kèo)                                │
│  ┌────────────────────────────────────────────────────┐  │
│  │ 🏸 Cầu lông chiều T5  75,000₫  ⏳ open            │  │
│  │    Đã trả: 0₫ / 75,000₫                           │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

**4 States:**

| State | Nội dung |
|-------|----------|
| Loading | Skeleton (info + session list + charge list) |
| Ready | Club info + sessions + charges |
| Error | Error banner + retry |
| Empty | "Chưa có buổi chơi" |

### Web — Outstanding detail

**Layout:**

```
┌──────────────────────────────────────────────────────────┐
│ ← Dashboard           💰 Các khoản còn nợ               │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  Tổng nợ: 225,000₫ (2 CLB)                              │
│                                                          │
│  ─── CLB Cầu lông Bình Thạnh ───                        │
│  ┌────────────────────────────────────────────────────┐  │
│  │ 🏸 Cầu lông chiều T5     75,000₫     ⏳ open      │  │
│  │    Đã trả: 0₫ / 75,000₫                           │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  ─── Pickleball Q7 ───                                   │
│  ┌────────────────────────────────────────────────────┐  │
│  │ 🏓 Pickleball T3         100,000₫   ⚠️ partial    │  │
│  │    Đã trả: 50,000₫ / 100,000₫                     │  │
│  │ 🏓 Pickleball CN         50,000₫    ⏳ open        │  │
│  │    Đã trả: 0₫ / 50,000₫                           │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

**4 States:**

| State | Nội dung |
|-------|----------|
| Loading | Skeleton list (2 club sections × 2 items) |
| Ready | Per-club outstanding items grouped |
| Error | Error banner + retry |
| Empty | Icon 🎉 + "✅ Không còn khoản phải trả!" (proven `known_zero`) |

### Web — Join requests

**4 States:**

| State | Nội dung |
|-------|----------|
| Loading | Skeleton list |
| Ready | Pending/approved/rejected list with timestamps |
| Error | Error banner + retry |
| Empty | "Không có yêu cầu tham gia nào" |

### Web — Auth required (unauthenticated `/me`)

```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│              🔐                                          │
│        Đăng nhập để xem dữ liệu                         │
│                                                          │
│  [═══ Đăng nhập bằng Google ═══]                         │
│                                                          │
│  Hoặc mở link từ bot Zalo/Messenger                      │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### Bot — `/myclubs` (Zalo) / persistent menu (Messenger)

**Layout (Bot message):**

```
👤 CLB của bạn (3)

1️⃣ 🏸 CLB Cầu lông Bình Thạnh
   Thành viên · 2 kèo sắp tới
   💰 Còn nợ: 75,000₫

2️⃣ ⚽ FC Thủ Đức
   Thành viên · 1 kèo sắp tới
   ✅ Không nợ

3️⃣ 🏓 Pickleball Q7
   Thành viên · 0 kèo
   💰 Còn nợ: 150,000₫

Tổng nợ: 225,000₫ (2 CLB)
```

**Bot states:**

| State | Nội dung |
|-------|----------|
| Loading | "Đang tải..." |
| Ready | Club list + debt + upcoming per club |
| Error | "Lỗi, thử lại sau" |
| Empty | "Bạn chưa tham gia club nào" |

### Chat — Exact `/pay` (club chat / private bot thread)

**Layout (requester-only card):**

```
💰 Thanh toán — CLB Cầu lông Bình Thạnh

Kèo: 🏸 Cầu lông chiều T5 · 10/08
Phí:       75,000₫
Đã trả:    0₫
Còn lại:   75,000₫

📎 TK nhận: Vietcombank · 0123456789

[Đã thanh toán? Host sẽ xác nhận]
```

> Chỉ requester thấy; peer/shared history = zero artifact.

### Chat — Exact `/pay` (human DM, `tenant_id=NULL`)

**Flow:**

```
Player gõ /pay trong human DM
  │
  ├→ 1 CLB eligible → auto-select → requester-only card (như trên)
  │
  └→ Nhiều CLB eligible → opaque picker:
        "Chọn CLB để xem thanh toán:"
        [CLB Cầu lông BT]  [FC Thủ Đức]  [Pickleball Q7]
        ↑ chỉ requester thấy
```

### Data source mapping

| Component | Data source | Ghi chú |
|-----------|-------------|---------|
| Club list | `memberships` JOIN `tenants` | Cross-tenant, person-scoped |
| Upcoming sessions | `players` JOIN `sessions` | Future only, per-club |
| Per-club debt | `getSelfPaymentStatus` per club | `known_zero` / `known_amount` / `unknown` |
| Cross-club summary | `getSelfPaymentSummary` | One owner; 1 `unknown` = all `unknown` |
| Outstanding items | `charges` WHERE `status IN (open, partial)` | Per-person, per-club grouped |
| Join requests | `join_requests` WHERE own | Status + timestamps |
| Chat `/pay` | `getSelfPaymentStatus` | Same canonical service |

### State coverage matrix

| Surface | Screen | Loading | Ready | Error | Empty |
|---------|--------|---------|-------|-------|-------|
| Web | /me dashboard | ✅ Skeleton cards | ✅ Clubs+sessions+debt | ✅ Banner+retry | ✅ "Chưa tham gia" + CTA |
| Web | /me club detail | ✅ Skeleton | ✅ Info+sessions+charges | ✅ Banner+retry | ✅ "Chưa có buổi chơi" |
| Web | Outstanding detail | ✅ Skeleton list | ✅ Per-club items | ✅ Banner+retry | ✅ "✅ Không nợ" |
| Web | Join requests | ✅ Skeleton list | ✅ Status list | ✅ Banner+retry | ✅ "Không có yêu cầu" |
| Web | Auth required | — | ✅ Login CTA | — | ⚪ N/A |
| Web | Account merged | — | ✅ Banner notification | — | ⚪ N/A |
| Bot | /myclubs | ✅ "Đang tải..." | ✅ Club list+debt | ✅ "Lỗi" | ✅ "Chưa tham gia" |
| Chat | /pay (club) | ✅ "Đang kiểm tra..." | ✅ Requester-only card | ✅ Generic retry | ✅ "Không còn nợ" (proven) |
| Chat | /pay (human DM) | ✅ "Đang tải CLB..." | ✅ Card or picker | ✅ Generic retry | ✅ "Không có CLB" |
| Notification | Payment detail | ✅ "Đang cập nhật..." | ✅ Canonical status | ✅ Generic retry | ✅ Proven no-debt |
| Chat | /sessions /waitlist (beta) | ✅ "Đang tải..." | ✅ Own session/waitlist | ✅ Generic retry | ✅ "Không có" |

---

## 4. Domain Model

| Entity | Vai trò | Key constraints |
|--------|---------|-----------------|
| `persons` | Global identity | Verified/linked via web auth (Google/email target) và channel identities Zalo/Messenger; Telegram chỉ legacy |
| `memberships` | Person ↔ Tenant per club | `UNIQUE(person_id, tenant_id)`, historical kept |
| `players` | Player in sessions | `tenant_id`, `session_id`, `membership_id`, `status` |
| `charges` | Payment obligations | `player_id`, `membership_id`, `session_id`, effective status |
| `payment_allocations` | Bank tx/manual/cash → charge ledger | `charge_id`, `bank_transaction_id`, `amount`, `source` |
| `magic_links` | Short-lived web access tokens | `UNIQUE(hash)`, `person_id`, `channel`, `expires_at`, `used_at` |

---

## 5. Analytics Events

| Event | Khi nào | Payload tối thiểu |
|-------|---------|-------------------|
| `player_view_opened` | Player access /me | `person_id` (opaque), `source` (web/bot), `auth_method` |
| `magic_link_consumed` | Magic link used successfully | `person_id` (opaque), `channel` |
| `magic_link_failed` | Magic link invalid/expired | `reason` (expired/used/wrong_person) |
| `player_own_debt_viewed` | Player views charge details | `person_id` (opaque), `club_count`, `surface ∈ {web,chat,notification}` |
| `player_realtime_reconnect` | Realtime reconnect after disconnect | `person_id` (opaque) |

> Opaque person/session IDs only. No other-player PII.

---

## 6. Acceptance Criteria

- [ ] Player sees all and only their own memberships/sessions/charges
- [ ] Arbitrary person/tenant/topic guessing returns 403/empty safely
- [ ] Magic link security/replay/expiry tests pass
- [ ] Merge refresh và own membership status converge; historical ledger/paid/void behavior chờ separate Reviewed DTO/route
- [ ] Current payment projection chỉ render canonical `open|partial` items + allocation breakdown; không invent paid/cash/reversal history
- [ ] Realtime authorization/reconnect/refetch works
- [ ] DTO/log/analytics contain no other-player PII
- [ ] `/api/me/charges`, chat `/pay` và authenticated notification detail trả cùng canonical `getSelfPaymentStatus` cho cùng snapshot; không consumer nào tự tính remaining amount.
- [ ] Human-DM `/pay` không suy tenant từ peer: một own eligible club auto-select, nhiều club dùng opaque actor-bound picker; peer không thấy command/picker/result và shared history không có artifact.
- [ ] Mọi person/club authority đến từ authenticated context, trusted club channel hoặc opaque requester-bound ref; arbitrary `person_id`/raw `tenant_id` không được chấp nhận.
- [ ] Null, authz failure, integrity failure và dependency failure trả `unknown`; chỉ proven `known_zero` mới hiển thị 0.
- [ ] Cross-club `getSelfPaymentSummary` là owner duy nhất của tổng xuyên CLB; không consumer nào cộng lại per-club status. Một CLB `unknown` ⇒ summary `unknown`, không partial sum. `clubCount` chỉ đếm CLB có outstanding > 0. Summary không mang `payAction`.
- [ ] Slice 19 chỉ đọc baseline `players/memberships/sessions`, không duplicate join/leave/promotion/session business rules và không cần full SessionService để author.
- [ ] `/sessions|/waitlist` beta chỉ enable khi cả ba strict current-authority packets `svc-session-crud`, `svc-session-join-leave`, `svc-waitlist-promotion-core` và production-shaped data E2E đều pass; tên cơ chế trong analysis cũ không tự là authority.
- [ ] **Buddy payment:** CTA "Trả hộ bạn" chỉ hiện khi ≥ 1 player khác có charge `open|partial`; ẩn chính mình, ẩn `paid|void`. Pending buddy request hiện trên roster. Auto-update khi charge status thay đổi.

---

## 7. Open Questions / Changelog

### Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-08-12 | v2.11 | **Pay-for-Buddy — Player surface:** Thêm PVW-UC-16 (player chọn player cùng session còn nợ → buddy request pending). Edge case #20 (charge thay đổi giữa request và confirm). 1 AC mới (CTA "Trả hộ bạn" visibility + pending state on roster). Cross-ref: `feature_payment_reconcile.md` PAY-UC-19/20/21 + `BE/feature_payment_reconcile_tech.md` §5e. Không đổi domain model/`getSelfPaymentStatus` (buddy allocation chỉ là `source='buddy'` trong canonical ledger). |
| 2026-08-10 | v2.10 | **A-grade upgrade:** thêm Entry points table (8 entries); bump version. Không đổi contract/domain model. |
| 2026-08-07 | v2.8 | **DD-96 Part A:** thêm cross-club `getSelfPaymentSummary` làm owner duy nhất của tổng nợ xuyên CLB (đóng gap `feature_home_tech.md:166` — `SelfPaymentStatus` là per-club, Home bị cấm tự cộng). Pin unknown-dominates, `clubCount` = số CLB có outstanding > 0, không `payAction` ở tầng aggregate. Thêm PVW-UC-15, edge #18–19, 1 acceptance. Ghi rõ host receivable ("Chưa thu") **không** thuộc feature này (DD-48; xem DD-96 Part B). Không authorize runtime. |
| 2026-07-31 | v2.7 | Keep paid/void/left-club ledger history outside current `SelfPaymentStatus`; remove historical acceptance claims until a separate Reviewed DTO/route owns them. |
| 2026-07-31 | v2.6 | Reconcile Product wording with canonical per-club `SelfPaymentStatus`: current projection contains only open/partial outstanding items with allocation breakdown; optional `payAction` belongs to that club status, never a global/item action. Paid/void history requires a separate DTO. No runtime authorization. |
| 2026-07-28 | v2.5 | Reconcile immutable authority `90d292d` and primary plan v1.8 `PLAN_READY`; retain per-mechanism `CODE_READY`, beta OFF and no-runtime boundaries. |
| 2026-07-28 | v2.4 | Mirror mechanism slices 17–19 và chat adapters 24–26. Pin slice 19 là read-only trên baseline đã merge, không hard-depend full SessionService; `/sessions|/waitlist` beta vẫn OFF tới strict current packets `svc-session-crud`/`svc-session-join-leave`/`svc-waitlist-promotion-core` + production-shaped data E2E. No runtime authorization. |
| 2026-07-27 | v2.3 | Mirror DD-91: canonical `getSelfPaymentStatus` cho web `/me/charges`, chat `/pay` và authenticated notification detail; human-DM picker requester-only vì `tenant_id=NULL`; fail-closed `unknown`, không arbitrary IDs/null→zero. Giữ Reviewed/not implemented. |
| 2026-07-19 | v2.2a | Metadata sweep (index v2.35): thêm trường **Implementation** đồng bộ BUILD-STATUS (Not started). Không đổi contract. |
| 2026-07-15 | v2.2 | **DD-37 closure:** active bot use cases chỉ còn Zalo/Messenger; thay TG-authenticated `/myclubs` bằng web-auth + Messenger persistent-menu contract. Telegram chỉ legacy trong domain note. |
| 2026-06-18 | v1.0 | Initial spec (English format) |
| 2026-06-19 | v2.0 | Chuẩn hoá Vietnamese numbered, thêm 10 use cases, 12 edge cases, /me dashboard screens |
| 2026-07-13 | v2.1 | Reconcile live schema: `players`, `charges.player_id/membership_id`, `payment_allocations`; auth/channel wording separates target from Telegram legacy. |
