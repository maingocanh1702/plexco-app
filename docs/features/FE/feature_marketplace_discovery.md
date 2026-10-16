# Feature: Marketplace Discovery & Global Search — Product/UX Spec

> **Canonical phase:** P4.3 (Marketplace) · P4.5 (Global Search)  
> **Track:** 🔍 Discovery, Marketplace & Search  
> **Version:** 2.8 · 2026-10-16
> **Status:** Reviewed  
> **Implementation:** Not started — `public_sessions` có sẵn và `0024` đã enforce public session phải finite-capacity; publish/projector/routes/UI vẫn chưa có · authority: `../../standards/BUILD-STATUS.md` (Doc status ≠ Implementation status). *Tail migration hiện hành là `0029` (đo 06/08 tại `2cd52ce`), nhưng `0025`–`0029` không chạm marketplace: rename CHECK, definer read-only và DD-29 billing registry.*
> **Prerequisites:** P2 session management · P4 sync/public projector  
> **Tài liệu liên quan:** `../../product/BRD.md` FR-3/NFR-S2 · `../../product/PRD.md` FLOW 12 · `../../product/TDD.md` §3.9 · `../../standards/decisions.md` DD-32 · `feature_channel_booking_funnel.md` · BRD OD-6/OD-8 · `../BE/feature_marketplace_discovery_tech.md`

---

## 1. Mô tả

**Marketplace (P4.3):** Cho bất kỳ player nào tìm **public sessions đang joinable** across clubs/sports — mà KHÔNG expose tenant-private roster, money, contact hay exact venue. Cover: publishing, filtering/ranking, detail view, privacy, expiry và abuse controls. Joining là feature riêng (cross_club_join).

**Global Search (P4.5):** Unified search bar tìm kiếm **đa entity**: Users, Sessions (public), Clubs, Tournaments (public). Kết quả grouped theo entity type, debounced 300ms, suggestions real-time. Privacy-safe: chỉ trả dữ liệu public/moderated — không lộ PII, internal IDs, tenant routing.

### Entry points

| Entry | Route / Surface | Actor | Mô tả |
|-------|----------------|-------|-------|
| Home → search icon | Header `🔍` → `/search` | Any (auth) | Global search overlay |
| Marketplace tab → search bar | `/discover` → focus search | Player | Scoped to public sessions |
| Club tab → member search | `/clubs/:id/members` → search | Host/Admin | In-club member search |
| Bot command | `/search` (Zalo/Messenger) | Player | Bot search (sessions only — P4.3) |
| Deep link | `/search?q=...&type=...` | Any (auth) | Pre-filled search |
| Keyboard shortcut | `⌘K` / `Ctrl+K` | Any (auth) | Quick search overlay |

### Bất biến

- Public serializer **chỉ** emit whitelist fields — không bao giờ expose internal routing/tenant ID.
- Private/**draft** (chưa publish)/incomplete/closed/cancelled/past sessions **KHÔNG BAO GIỜ** xuất hiện.
- Exact venue chỉ reveal khi canonical player outcome là `active`; approved-but-waitlisted vẫn ẩn.
- Public chỉ có `slots_open` (DD-133): occupied = `getSessionOccupancy()` = active players + guest notes + live holds (= 0 tới khi có bảng hold, DD-132/DD-135) (+ pending invites sau migration thêm chúng); `slots_open` = `slots_max IS NULL ? NULL : max(0, slots_max - occupied)`. `confirmed_count` = active players, tenant-private, không bao giờ public. `slots_open` là advisory projection; hold count không public và final confirm luôn recheck transactionally.
- Messenger central mặc định global discovery; tenant Page mặc định local + “Khám phá tất cả”. Mỗi trang tối đa 8 business choices; Join CTA là opaque action, không raw routing ID.

---

## 2. Use Cases + Edge Cases

### Use Cases

| ID | Actor | Hành động | Kết quả |
|---|---|---|---|
| MKT-UC-1 | Host | Set session public (chỉ tại create hoặc edit — `PublishSession` status-only, không đổi `visibility`) | Projection appears sau sync projector — chỉ khi session đồng thời `status='open'`; còn `draft` (chưa Host publish) thì chưa xuất hiện dù đã set public |
| MKT-UC-2 | Player (anon) | Browse sessions — filter sport/area/time | Results list + no-result fallback |
| MKT-UC-3 | Player (auth) | Filter thêm skill/price/available slot | Filtered results |
| MKT-UC-4 | Player | Mở public detail | Session info (whitelist) + Join CTA |
| MKT-UC-5 | Player | Proceed to join flow | Web → cross-club join; Zalo/Messenger → shared DD-32 safe detail + final link-or-pay gate |
| MKT-UC-6 | Host | Edit session (time/price/visibility) | Projection updates via projector |
| MKT-UC-7 | Host | Set session private/close/cancel | Projection removed immediately |
| MKT-UC-8 | System | Session expired | Auto-disappear — expiry guard |
| MKT-UC-9 | Player | Search với unknown filters | Empty results + filter reset CTA — KHÔNG expose taxonomy internals |
| MKT-UC-10 | System | Rate-limit exceeded | 429 — "Quá nhiều truy vấn, thử lại sau" |
| MKT-UC-11 | Player | Gõ keyword vào Global Search bar | Debounce 300ms → suggestions dropdown (grouped: Users, Clubs, Sessions, Tournaments) |
| MKT-UC-12 | Player | Chọn entity type tab (Users/Clubs/Sessions/Tournaments) | Kết quả filtered theo type + query |
| MKT-UC-13 | Player | Tap user suggestion | Navigate → User profile (public) |
| MKT-UC-14 | Player | Tap club suggestion | Navigate → Club detail (public info) |
| MKT-UC-15 | Player | Tap tournament suggestion | Navigate → Tournament detail (public) |
| MKT-UC-16 | Player | Search không có kết quả | Empty state + gợi ý categories/trending |

### Edge Cases

| # | Category | Case | Hành vi bắt buộc |
|---|----------|------|-------------------|
| 1 | Security | Private session leak vào public | ❌ NEVER — projector chỉ emit khi `visibility=public` **và** `status='open'` + required fields present; `draft` không bao giờ project dù đã set public |
| 2 | Security | Tenant routing ID serialized | ❌ NEVER — internal routing ID stripped from public response |
| 3 | Security | Exact venue/address trong browse | ❌ NEVER — chỉ area (quận/khu vực). Ref: OD-6 |
| 4 | Security | Roster/membership/bank/charge/payment/PII leak | ❌ NEVER — strict whitelist |
| 5 | Data Integrity | Aggregate counts stale khi browse | Advisory only — final join/hold rechecks shared occupancy under session lock |
| 6 | Security | Pagination enumeration attack | Stable cursors + rate-limit per IP/session/account |
| 7 | Data Integrity | Club display name inappropriate | Moderation/privacy policy gate — reject offensive names |
| 8 | Data Integrity | Projector lag > SLO | Expiry guard prevents stale past offers |
| 9 | Security | Ranking dùng financial/identity data | ❌ NEVER — ranking explainable, chỉ dùng public attributes |
| 10 | Data Integrity | Closed/cancelled session vẫn trong search index | Projector must delete — reproject verifies clean |
| 11 | Security | Unknown filter values probe taxonomy | Return empty — KHÔNG expose taxonomy internals in error |
| 12 | Security | Scraping/bot abuse | Rate-limit + CAPTCHA challenge sau threshold |
| 13 | Privacy | Personal-tenant session has no approved alias (missing, unapproved or blank) | Fail closed: do not project; never fall back to internal tenant name, person name or account identity |
| 14 | Security | Global Search query chứa SQL/XSS payload | Sanitize input — parameterized query, strip tags, max 100 chars |
| 15 | Privacy | User search lộ email/phone/private profile | ❌ NEVER — chỉ trả `display_name`, `avatar_url`, `sport_interests[]`, `public_club_count` |
| 16 | Data Integrity | Search suggest trả club/tournament đã xóa/archived | Filter `status=active` — archived/deleted KHÔNG BAO GIỜ hiện |
| 17 | Performance | Query quá rộng (1 char) trả millions kết quả | Require min 2 chars; max 50 results/type; cursor pagination |
| 18 | Security | User enumerate via search (scraping) | Rate limit 30 req/min per account; fuzziness không expose exact match count |
| 19 | Data Integrity | Stale search index (user đổi tên, club xóa) | Index refresh SLO ≤ 5s; fallback: verify on-click (404 → remove from cache) |
| 20 | Privacy | Search result lộ member count/roster danh sách thật | Chỉ trả `member_count` aggregate |

---

## 3. Screens & States

> Web = center tab "🔍 Khám phá" (bottom nav slot 3, emphasized/FAB). Bot = `/search` (Zalo) / quick-reply (Messenger). Mobile-first 375px; desktop ≥1024 (2-column grid).

### Web — Marketplace browse

**Purpose:** Player tìm + filter public sessions across clubs.

**Component: Horizontal Date Selector (thay date picker dropdown — Playo-inspired):**

```
┌──────────────────────────────────────┐
│ THÁNG 8                                     │
│ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐  │  scroll-x, snap-to-item
│ │Hôm │ │ T5 │ │ T6 │ │ T7 │ │ CN │ │ T2 │  │
│ │nay │ │ 13 │ │ 14 │ │ 15 │ │ 16 │ │ 17 │  │
│ │ ●  │ │    │ │ ●  │ │ ●  │ │    │ │    │  │  ● = has sessions
│ └────┘ └────┘ └────┘ └────┘ └────┘ └────┘  │
└──────────────────────────────────────┘
```

| Property | Giá trị |
|----------|----------|
| Range | Today → 2 tuần tới (14 ngày) |
| Default | Today selected (primary color circle) |
| Session dot | ● dưới số ngày = có ≥1 public session ngày đó |
| Interaction | Tap → filter sessions cho ngày đó; scroll ngang |
| Cross-month | Khi scroll qua ngày cuối tháng, label tháng chuyển theo |
| Data source | `public_sessions` aggregate count per date |

**Layout (mobile):**

```
┌──────────────────────────────────────┐
│ 🔍 Khám phá                    🔔   │
├──────────────────────────────────────┤
│ THÁNG 8                                     │
│ [● Hôm nay] [T5 13] [T6 14] [T7 15]...    │  date selector (scroll-x)
├──────────────────────────────────────┤
│ [🏸 Cầu lông] [⚽ Bóng đá] [Tất cả]│  sport filter chips (scroll-x)
│ [📍 Khu vực ▼] [💰 Giá] [🏅 Trình độ]  │  filter bar (date picker removed)
├──────────────────────────────────────┤
│                                      │
│ ┌──────────────────────────────────┐   │
│ │ ┌───────────────┐ ┌──────────────┐ ♡ │   │  session card
│ │ │ 19:00 – 21:00  │ │ 120.000₫/Ng │   │   │  time pill + price pill + favorite
│ │ └───────────────┘ └──────────────┘   │   │
│ │                                    │   │
│ │ 🏸 Cầu lông chiều T5              │   │  sport icon + session title
│ │ CLB Rồng Xanh                     │   │  club display name (approved alias)
│ │                                    │   │
│ │ 📍 Q.Bình Thạnh  ~2.9 km           │   │  area + distance (conditional)
│ │                                    │   │
│ │ 🏅 Trung bình                      │   │  skill level tag
│ │                                    │   │
│ │ [═══ Tham gia ═══]                │   │  CTA button
│ └──────────────────────────────────┘   │
│ ┌──────────────────────────────────┐   │
│ │ ┌───────────────┐ ┌─────────────┐  ♡ │   │
│ │ │ 16:00 – 18:00  │ │ 85.000₫/Ng │    │   │
│ │ └───────────────┘ └─────────────┘    │   │
│ │ ⚽ Bóng đá T7 · FC Weekend           │   │
│ │ 📍 Thủ Đức  ~3.8 km                │   │
│ │ 🏅 Trung bình – Khá   ┌────────┐  │   │  skill level + slots status
│ │                       │ 2 chỗ   │  │   │
│ │                       └────────┘  │   │
│ └──────────────────────────────────┘   │
│                                      │
│ ┌──────────────────────────────────┐   │
│ │        Xem thêm ↓              │   │  cursor pagination
│ └──────────────────────────────────┘   │
│                                      │
└──────────────────────────────────────┘
```

**Component: Session card (public) — Unified `SessionCard` variant `browse`:**

| Field | Data source | Ghi chú |
|-------|-------------|---------|
| Session cover | `public_sessions.cover_image_url` | Optional hero image phía trên card; fallback: sport gradient bg. Moderated public field |
| Time pill | `public_sessions.starts_at` + `ends_at` | Green pill: format `HH:mm – HH:mm` |
| Time-of-day label | Derived from `starts_at` | Thay time pill khi host chọn time category hoặc chỉ có `starts_at`: "Sáng" / "Chiều" / "Tối" / "Đêm" |
| Price pill | `public_sessions.price_amount` | White/grey pill: VND scalar + "/Ng"; "Miễn phí" if 0 |
| Favorite ♡ | Client-local only (phase-1) | Tap → toast "Tính năng sắp ra mắt" — backend `saved_sessions` defer |
| Urgency badge | `slots_open` | 🔴 "Chỉ N chỗ!" khi `slots_open ≤ 3` và `> 0`. Ẩn khi `> 3` hoặc = 0. Red bg, white text, right-aligned trên card |
| Sport icon + title | `public_sessions.sport_key` + title | Taxonomy icon + session name |
| Club name | `public_sessions.club_display_name` | Moderated; personal blank → ẩn |
| Area | `public_sessions.area` | Coarse (quận/khu vực), KHÔNG address |
| Distance | Geolocation API | Conditional: chỉ hiện khi user đã cấp quyền location; fallback ẩn |
| Skill level tag | `public_sessions.skill_level` | Hiện dạng range khi có min+max: "Người mới – Trung bình". Single value khi chỉ có 1 level. Green chip pill + sport icon bên trái |
| Booking status | Player's join state | `BOOKED` (xanh lá, right-aligned) khi authenticated player đã join. Chỉ hiện nếu đã tham gia |
| Slots status | `slots_open` | `N chỗ` badge khi `slots_open > 0` và `> 3`; `Đầy` khi = 0. Ẩn khi urgency badge hiện |
| Join CTA | Opaque action → `cross_club_join` | Không raw routing ID |

**Component: Time-of-day mapping (Playo "Night" pattern):**

| Khoảng giờ | Label | Pill color |
|-----------|-------|------------|
| 05:00 – 11:59 | Sáng | Green |
| 12:00 – 16:59 | Chiều | Green |
| 17:00 – 20:59 | Tối | Green |
| 21:00 – 04:59 | Đêm | Green |

> **Logic:** Khi session có cả `starts_at` + `ends_at` → hiện `HH:mm – HH:mm` (default). Khi chỉ có `starts_at` hoặc host chọn time-of-day category → hiện label. Playo dùng "Night" cho 21:00+.

**Component: Urgency slots badge (Playo "Only N slots" pattern):**

| Condition | Badge | Style |
|-----------|-------|-------|
| `slots_open ≤ 3` và `> 0` | "Chỉ {N} chỗ!" | Red background, white text, bold, right-aligned trên card |
| `slots_open > 3` | Ẩn urgency badge | Hiện `N chỗ` bình thường |
| `slots_open = 0` | "Đầy" | Red pill, CTA disabled / thay "Vào danh sách chờ" |

**Component: Booking status badge (Playo "BOOKED" pattern):**

| Condition | Badge | Style |
|-----------|-------|-------|
| Player đã join session (status `active`) | `ĐÃ ĐĂNG KÝ` | Green background, white text, right-aligned dưới skill tag |
| Player chưa join / not authenticated | Ẩn | — |
| Player waitlisted | `CHỜ` | Yellow background |
| Player pending approval | `CHỜ DUYỆT` | Orange background |

**Component: Filter bar (update):**

| Filter | Type | Options |
|--------|------|---------|
| Môn thể thao | Chip row (scroll-x) | From `sports` taxonomy |
| Khu vực | Dropdown | Quận/khu vực từ area taxonomy |
| Giá | Range slider | 0 → 500,000₫ |
| Trình độ | Chips (DD-41) | Ordered ranks, không lộ player level |
| Slot còn trống | Toggle: "Chỉ còn chỗ" | `slots_open > 0` filter |

> **Note:** Date filter chuyển từ dropdown lên **Horizontal Date Selector** riêng (phía trên sport chips). Không còn trong filter bar.

**4 States:**

| State | Nội dung |
|-------|---------|
| Loading | Skeleton: date selector shimmer + sport chips + filter bar + 4 card skeletons (2×2 grid desktop) |
| Ready | Session cards grid + pagination |
| Error | Error banner: "Không tải được" + retry |
| Empty | Icon 🔍 + "Không tìm thấy buổi chơi nào" + [Reset bộ lọc] CTA |ame | `public_sessions.sport_key` → `sports` taxonomy | Không expose internal ID |
| Area | `public_sessions.area` | Coarse (quận/khu vực), KHÔNG address |
| Date/time | `public_sessions.starts_at` | Format `DD/MM · HH:mm` |
| Price | `public_sessions.price_amount` | VND, scalar — không lộ gender pricing |
| Slots | `slots_open` | Advisory — final check at join |
| Club name | `public_sessions.club_display_name` | Moderated; personal blank → no project |
| Join CTA | Opaque action → `cross_club_join` | Không raw routing ID |

**Component: Filter bar:**

| Filter | Type | Options |
|--------|------|---------|
| Môn thể thao | Chip row (scroll-x) | From `sports` taxonomy |
| Khu vực | Dropdown | Quận/khu vực từ area taxonomy |
| Ngày | Date picker / range | Hôm nay → 2 tuần tới |
| Giá | Range slider | 0 → 500,000₫ |
| Trình độ | Chips (DD-41) | Ordered ranks, không lộ player level |
| Slot còn trống | Toggle: "Chỉ còn chỗ" | `slots_open > 0` filter |

**4 States:**

| State | Nội dung |
|-------|----------|
| Loading | Skeleton: sport chips + filter bar + 4 card skeletons (2×2 grid desktop) |
| Ready | Session cards grid + pagination |
| Error | Error banner: "Không tải được" + retry |
| Empty | Icon 🔍 + "Không tìm thấy buổi chơi nào" + [Reset bộ lọc] CTA |

### Web — Session public detail

**Layout:**

```
┌──────────────────────────────────────┐
│ ← Khám phá                          │
├──────────────────────────────────────┤
│                                      │
│ 🏸 Cầu lông chiều T5                │
│ CLB Rồng Xanh                       │
│                                      │
│ 📅 Thứ 5, 10/08/2026                │
│ 🕒 19:00 — 21:00                    │
│ 📍 Quận 3 (địa chỉ chính xác sau   │
│    khi xác nhận tham gia)            │
│                                      │
│ 💰 120,000₫ / người                 │
│ 👥 2 chỗ còn trống                 │
│ 🏅 Trình độ: Trung bình — Khá      │
│                                      │
│ ─── Chính sách tham gia ───         │
│ Đăng ký mở (open) / Cần duyệt      │
│                                      │
│      [═══ Tham gia buổi này ═══]    │
│                                      │
└──────────────────────────────────────┘
```

**States:**

| State | Nội dung |
|-------|----------|
| Loading | Skeleton layout |
| Ready | Full whitelist info + Join CTA |
| Error | "Buổi chơi không còn khả dụng" + back CTA |
| Empty | N/A (always has data or error) |

### Web — Global Search overlay

**Purpose:** Unified search bar — tìm Users, Sessions, Clubs, Tournaments từ một nơi.

**Layout (mobile 375px — overlay mode):**

```
┌──────────────────────────────────────┐
│ [🔍 Tìm kiếm...              ] [✕] │  auto-focus + keyboard
├──────────────────────────────────────┤
│ Tabs: [Tất cả ✓] [👤 Users] [🏸 Sessions] [🏢 CLB] [🏆 Giải đấu] │
├──────────────────────────────────────┤
│                                      │
│ 👤 Người dùng                       │  section header
│ ┌────────────────────────────────┐   │
│ │ [AV] Nguyễn Văn A             │   │
│ │      🏸 Cầu lông · 3 CLB     │   │
│ ├────────────────────────────────┤   │
│ │ [AV] Trần Thị B               │   │
│ │      ⚽ Bóng đá · 1 CLB      │   │
│ └────────────────────────────────┘   │
│ [Xem thêm →]                        │
│                                      │
│ 🏢 CLB                              │  section header
│ ┌────────────────────────────────┐   │
│ │ [AV] CLB Rồng Xanh            │   │
│ │      🏸 Cầu lông · 45 TV     │   │
│ ├────────────────────────────────┤   │
│ │ [AV] FC Weekend               │   │
│ │      ⚽ Bóng đá · 22 TV      │   │
│ └────────────────────────────────┘   │
│ [Xem thêm →]                        │
│                                      │
│ 🏆 Giải đấu                         │
│ ┌────────────────────────────────┐   │
│ │ Giải Cầu lông Mùa Hè 2026    │   │
│ │ 📅 15/08 · 👥 32 đội · open  │   │
│ └────────────────────────────────┘   │
│                                      │
│ 🏸 Buổi chơi                        │
│ ┌────────────────────────────────┐   │
│ │ 🏸 Cầu lông T5 · Q3 · 19:00  │   │
│ │ 💰 120k · 👥 6/8 · 2 chỗ     │   │
│ └────────────────────────────────┘   │
│                                      │
└──────────────────────────────────────┘
```

**Suggestion dropdown (before full search — as-you-type):**

```
┌──────────────────────────────────────┐
│ [🔍 "Cầu lông"                ] [✕] │
├──────────────────────────────────────┤
│ 🔥 Gợi ý                            │
│  🏸 "Cầu lông" trong Buổi chơi (12)│  quick filter
│  🏢 "Cầu lông" trong CLB (5)       │  quick filter
│  👤 "Cầu lông" trong Người dùng (3)│  quick filter
│                                      │
│ ⏱️ Tìm kiếm gần đây                │
│  🏸 Cầu lông Q3                     │  history item
│  👤 Nguyễn Văn A                     │  history item
│  [Xóa lịch sử]                      │  danger link
└──────────────────────────────────────┘
```

**Component: Search result row (by entity type):**

| Entity | Avatar | Primary | Secondary | Action |
|--------|--------|---------|-----------|--------|
| User | Profile avatar | `display_name` (highlighted match) | Sport interests + public club count | → User profile |
| Club | Club avatar | `display_name` (highlighted) | Primary sport + member count | → Club detail |
| Tournament | Sport icon | `name` (highlighted) | Date range + team count + status | → Tournament detail |
| Session | Sport icon | `{sport} {title}` (highlighted) | Area + date + price + slots | → Session public detail |

**4 States:**

| State | Nội dung |
|-------|----------|
| Loading | Skeleton: 3 sections × 2 rows each (shimmer) |
| Ready | Grouped results by entity type |
| Error | Error banner: "Không tìm kiếm được" + retry |
| Empty | Icon 🔍 + "Không tìm thấy kết quả cho '{query}'" + trending/categories CTA |

**Empty state layout:**

```
┌──────────────────────────────────────┐
│ [🔍 "xyz123"                  ] [✕] │
├──────────────────────────────────────┤
│                                      │
│         🔍                           │
│   Không tìm thấy kết quả            │
│   cho "xyz123"                       │
│                                      │
│   Gợi ý:                            │
│   • Kiểm tra chính tả               │
│   • Thử từ khóa khác                │
│   • Tìm theo môn thể thao           │
│                                      │
│   ─── Đang hot ───                   │
│   [🏸 Cầu lông] [⚽ Bóng đá]       │
│   [🏓 Pickleball] [🏐 Bóng chuyền] │
│                                      │
└──────────────────────────────────────┘
```

### Bot — `/search` (Zalo) / quick-reply (Messenger)

**Layout (Messenger — max 8 choices/page):**

```
🔍 Tìm buổi chơi

1️⃣ 🏸 Cầu lông T5 · Q3 · 19:00
   💰 120k · 👥 6/8 · 2 chỗ
   
2️⃣ ⚽ Bóng đá T7 · Thủ Đức · 16:00
   💰 85k · 👥 8/10 · 2 chỗ

3️⃣ 🏓 Pickleball CN · Q7 · 8:00
   💰 150k · 👥 4/6 · 2 chỗ

[Trang sau →] [Huỷ tìm]
```

> Messenger: max 8/page, Prev/Next/Cancel. Zalo: number-reply contract.

**Bot states:**

| State | Nội dung |
|-------|----------|
| Loading | "🔍 Đang tìm..." |
| Ready | Kết quả list + pagination |
| Error | "Không tìm được lúc này" |
| Empty | "Không có buổi nào phù hợp — thử đổi bộ lọc" |

### Rate-limited screen

```
┌──────────────────────────────────────┐
│                                      │
│        ⏳                             │
│  Quá nhiều truy vấn                  │
│  Thử lại sau [00:30]                 │
│                                      │
└──────────────────────────────────────┘
```

### Data source mapping

| Component | Data source | Ghi chú |
|-----------|-------------|---------|
| Session cards | `public_sessions` (materialized) | Whitelist only, no FK to tenant |
| Sport chips | `sports` taxonomy | Ordered |
| Area filter | `public_sessions.area` DISTINCT | Coarse taxonomy |
| Counts | `slots_open` | Advisory, `getSessionOccupancy()` |
| Join action | Opaque session ref → `cross_club_join` | No raw routing ID |

### State coverage matrix

| Screen | Loading | Ready | Error | Empty |
|--------|---------|-------|-------|-------|
| Browse grid (Marketplace) | ✅ Skeleton cards | ✅ Cards + pagination | ✅ Banner + retry | ✅ "Không tìm thấy" + reset |
| Filter panel | — | ✅ Sport/area/time/price pickers | — | ⚪ N/A |
| Session detail | ✅ Skeleton | ✅ Whitelist info + Join CTA | ✅ "Không còn khả dụng" | ⚪ N/A |
| Rate-limited | — | ✅ Countdown | — | ⚪ N/A |
| Bot search | ✅ "Đang tìm..." | ✅ Results + pagination | ✅ "Không tìm được" | ✅ "Không phù hợp" |
| Global Search overlay | ✅ Skeleton grouped | ✅ Results by entity | ✅ Banner + retry | ✅ Trending + suggestions |
| Suggestion dropdown | ✅ Spinner inline | ✅ Quick filters + history | — | ✅ "Nhập từ khóa" |
| User result row | ✅ Skeleton | ✅ Avatar + name + sports | — | — |
| Club result row | ✅ Skeleton | ✅ Avatar + name + members | — | — |
| Tournament result row | ✅ Skeleton | ✅ Icon + name + date | — | — |

---

## 4. Domain Model

| Entity | Vai trò | Key constraints |
|--------|---------|-----------------|
| `public_sessions` | Materialized public read/projection table | Whitelist columns only; `id=session.id` + internal `session_id` reference **without FK by design** so public plane cannot cascade/query canonical tenant tables; auto-expire |
| `sessions` | Canonical source | `visibility` enum, required discovery fields |
| `search_index` | Full-text search index (denormalized) | Covers users, clubs, tournaments, sessions; refreshed on write via event/trigger; searchable columns: `display_name`, `title`, `sport_key`, `area` |
| `persons` (search view) | User public profile projection | Only `display_name`, `avatar_url`, `sport_interests`, `public_club_count` — NO PII |
| `tenants` (search view) | Club public projection | Only `display_name`, `avatar_url`, `primary_sport`, `member_count`, `status=active` |
| `public_tournaments` | Tournament public read model | `name`, `sport`, `starts_at`, `team_count`, `status`, `registration_status` |

### Public Contract (whitelist)

| Field | Nguồn | Notes |
|-------|-------|-------|
| `session_id` (opaque) | sessions.id | Masked — không expose internal routing |
| `sport_key` | sessions.sport_id → sports | Taxonomy key |
| `starts_at` / `ends_at` | sessions | UTC timestamptz |
| `area` | sessions.area | Coarse — quận/khu vực, KHÔNG address |
| `skill_level` | sessions | **Live legacy only** during DD-41 expand/backfill; must disappear from projection at cutover |
| `level_min_rank` / `level_max_rank` / `level_strict` | sessions policy (DD-41 target) | Ordered DD-08 ranks + advisory/hard flag; replaces `skill_level`, never exposes a player's level |
| `price_amount` | sessions.price_amount | Amount in VND |
| `slots_open` | `getSessionOccupancy()` (DD-133 (a)) | `slots_max IS NULL ? NULL : max(0, slots_max - occupied)`; advisory |
| `club_display_name` | Approved public alias (L10a; DD-46 as amended by DD-133), read live | Never an internal tenant name or a person/host name; blank alias => no projection |
| `public_listing_id` | opaque listing key (DD-133 (e)) | Discovery / deep-link key; never the internal session id |
| `join_policy` | sessions | open / approval |

> **Excluded:** tenant_id, venue address, roster, phone, email, bank, charges, channel IDs.

> **DD-41 target delta (decided, migration pending):** expand projector/API to public `title`, `session_type`, `level_min_rank`, `level_max_rank`, `level_strict`, `gender_restriction`, `age_min`, `age_max`; backfill rank fields, switch readers, then stop projecting/drop legacy `skill_level`. `notes`, `instructions`, `byoe`, `cost_shared` remain private. Until this expand→contract slice lands, the live legacy field is compatibility evidence, not the final Product contract.

---

## 5. Analytics Events

| Event | Khi nào | Payload tối thiểu |
|-------|---------|-------------------|
| `marketplace_searched` | Player search/filter | `filters_used[]` (bucketed), `result_count`, `source` (web/bot) |
| `marketplace_detail_opened` | Player mở session detail | `session_id` (opaque), `source` |
| `marketplace_join_cta_clicked` | Player click Join | `session_id` (opaque), `source` |
| `marketplace_no_results` | Search trả 0 results | `filters_used[]` |
| `marketplace_projection_lag` | Projector lag > threshold | `lag_ms`, `threshold_ms` |
| `global_search_executed` | Player thực hiện global search (sau debounce) | `query_length`, `entity_types_requested[]`, `result_counts{}`, `source` |
| `global_search_result_clicked` | Player tap vào kết quả search | `entity_type`, `entity_id` (opaque), `result_position`, `query_length` |
| `global_search_no_results` | Search trả 0 kết quả toàn bộ entity types | `query` (hashed/bucketed — KHÔNG raw text), `filters_used[]` |
| `global_search_suggestion_used` | Player chọn suggestion/history item | `suggestion_type` (quick_filter/history), `entity_type` |
| `global_search_history_cleared` | Player xóa lịch sử tìm kiếm | `history_count` |

> Không retain IP, PII, raw location, raw query text ngoài security policy.

---

## 6. Acceptance Criteria

- [ ] Public serializer exactly match whitelist — penetration test pass
- [ ] Private/closed/cancelled/expired sessions absent from search
- [ ] Filters sport/area/time/skill/price/slot work correctly
- [ ] Exact venue và tenant routing ID KHÔNG BAO GIỜ leak
- [ ] Edit/close/reproject converge correctly
- [ ] Rate-limit/pagination/cache không bypass privacy
- [ ] Public invariant test pass under replay
- [ ] Browse latency target documented và met
- [ ] Messenger central/tenant Page local-vs-global context đúng; opaque action TTL/snapshot/replay tests pass
- [ ] Public DTO emits `slots_open` only (no `confirmed_count`) from one shared occupancy projection (`getSessionOccupancy()`); hold count/identities remain private, adapters never re-derive and final mutation ignores stale counts.
- [ ] Personal-tenant session uses only the approved public alias (L10a) for `club_display_name`; a missing, unapproved or blank alias means no projection and no internal tenant/person name ever leaks
- [ ] **Horizontal Date Selector:** render 14 ngày (today → 2 tuần), today highlighted, session dot indicator hiện đúng, tap filter sessions, scroll ngang snap-to-item
- [ ] **Session card (unified `browse` variant):** time pill (green) + price pill + favorite icon + sport icon + title + club name + area + distance (conditional) + skill level tag + slots status badge + CTA "Tham gia"
- [ ] **Favorite icon:** Tap → toast "Tính năng sắp ra mắt" (phase-1 placeholder); không persist
- [ ] **Distance:** Chỉ hiện khi user đã cấp quyền geolocation; fallback: ẩn distance, chỉ area text
- [ ] **Skill level tag:** Hiện legacy `skill_level` text; DD-41 ranked range là separate migration
- [ ] Global Search debounce 300ms — không fire request mỗi keystroke
- [ ] Search min 2 chars — 1 char không trigger search
- [ ] Results grouped by entity type (Users → Clubs → Tournaments → Sessions) với count indicators
- [ ] User search result chỉ trả public profile (display_name, avatar, sport_interests, public_club_count) — KHÔNG email/phone/PII
- [ ] Club search chỉ trả active clubs — archived/deleted/suspended filtered
- [ ] Tournament search chỉ trả public tournaments — draft/cancelled filtered
- [ ] Session search reuse marketplace whitelist — cùng privacy contract
- [ ] Tab filtering work correctly — switching tab giữ query, chỉ đổi entity type
- [ ] Search history lưu local (localStorage/AsyncStorage) — không gửi lên server
- [ ] Highlight matched text trong result rows (bold hoặc color)
- [ ] Rate limit 30 req/min per account — 429 state hiển thị đúng
- [ ] `⌘K` / `Ctrl+K` shortcut mở search overlay
- [ ] Suggestion dropdown (as-you-type) hiện trước full results — quick filter + history
- [ ] Click result navigate đúng entity detail page
- [ ] Search input sanitized — XSS/SQL injection prevented
- [ ] Max 50 results/entity type; cursor pagination cho "Xem thêm"

---

## 7. Open Questions / Changelog

### Open Questions

| ID | Quyết định | Trạng thái |
|---|---|---|
| MKT-OQ-1 | BRD OD-6: public location granularity | ✅ Chốt (DD-06, clarified v1.60): **`area` only public; venue active-only** (approved-waitlisted no venue). |
| MKT-OQ-2 | BRD OD-8: initial sport/skill taxonomy | ✅ Chốt (DD-08, 2026-07-13): 7 môn seed (badminton/pickleball/tennis/padel/volleyball/basketball/football, extensible qua `sports`) + level 5-bậc ordered rank. |
| MKT-OQ-3 | Initial ranking: upcoming/area vs optional distance provider | ⬜ Chưa chốt |

### Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-10-16 | v2.8 | **Sync DD-133 (D1, owner ký 2026-10-16); docs-only.** Public card/detail/DTO chỉ còn `slots_open` từ `getSessionOccupancy()`: bỏ `N/M Going`, `confirmed_count`, host avatar và host name (không có cột whitelist public); `club_display_name` = alias đã duyệt (L10a); thêm `public_listing_id`. Sửa drift: `public_sessions.price` → `price_amount` (§Card, §Detail, bảng DTO). Wireframe và AC khớp. `N/M Going` ở bề mặt tenant-private (feature_session_management) giữ nguyên. Vòng review 1: live holds ghi rõ = 0 tới khi có bảng hold. Vòng review 2: mọi câu personal-tenant (AC, edge #13) chỉ nhắc alias đã duyệt (L10a); thiếu, chưa duyệt hoặc trống = không chiếu (edge #13: câu "không có alias đã duyệt" đã gọn lại, hết tự mâu thuẫn). Các dòng lịch sử giữ nguyên. |
| 2026-08-12 | v2.7 | **SessionCard upgrade (Playo reference #2):** (1) **Urgency badge:** "Chỉ N chỗ!" (đỏ) khi `slots_open ≤ 3` — tăng conversion. (2) **Booking status badge:** `ĐÃ ĐĂNG KÝ`/`CHỜ`/`CHỜ DUYỆT` (right-aligned) khi authenticated player đã join — nhận ra kèo đã đăng ký trong marketplace. (3) **Skill level range:** hiện range "Người mới – Trung bình" với green chip pill + sport icon, thay single text. (4) **Time-of-day label:** "Sáng"/"Chiều"/"Tối"/"Đêm" thay time pill khi phù hợp. (5) **Session cover image:** optional hero image trên card, fallback sport gradient. Thêm 4 component tables mới (time-of-day mapping, urgency badge, booking status, cover image). 5 fields mới trong session card table. BL-DSC-1: `cover_image_url` là public moderated field. |
| 2026-08-12 | v2.6 | **Unified SessionCard + Horizontal Date Selector (Playo-inspired):** (1) **Date selector:** thay date picker dropdown bằng horizontal scrollable date selector (14 ngày, today highlighted, session dot indicator, snap-to-item) phía trên sport chips. (2) **Session card redesign:** unified `SessionCard` variant `browse` với: time pill (green) + price pill + favorite icon (♡ placeholder phase-1) + host avatar (32px) + `N/M Going` count + sport icon + title + club/host display name + area + conditional distance (~X km, geolocation-gated) + skill level tag (legacy text, DD-41 sau) + slots status badge (`N chỗ`/`Đầy`). (3) **Filter bar:** remove date dropdown (chuyển lên date selector); giữ khu vực/giá/trình độ/slot. (4) **Loading skeleton:** thêm date selector shimmer. (5) 5 AC bullets mới. BL-DSC-1 whitelist giữ nguyên — `host_avatar_url` là public moderated field như `host_display_name`. Không đổi privacy contract. |
| 2026-08-10 | v2.5 | **Global Search (P4.5):** Mở rộng doc từ session-only marketplace thành unified search. Thêm: Global Search scope (§1 — multi-entity: Users, Clubs, Tournaments, Sessions), entry points table (6 entries), 6 use cases mới (MKT-UC-11→16), 8 edge cases mới (#14→21 — sanitize, privacy, stale index, enumerate protection), 3 screens mới (Global Search overlay + suggestion dropdown + empty state — tất cả có ASCII layouts), search result component spec (4 entity types), 5 state coverage rows mới, 4 domain model entities (search_index, persons view, tenants view, public_tournaments), 5 analytics events (global_search_*), 17 acceptance criteria mới. Privacy-safe: chỉ public/moderated data, no PII leak. Additive-only — marketplace contract không đổi. |
| 2026-07-28 | v2.4 | Mirror DD-32 public aggregates: confirmed active count and slots-open (active + live holds) from one occupancy helper; hold count stays private. Bot Join CTA routes safe detail/final gate while web retains cross-club join. No projector/runtime claim. |
| 2026-07-27 | v2.3 | Mirror `0024`: public + unlimited capacity đã bị DB CHECK loại và dữ liệu hiện có đã validate; đây là invariant nền, không phải publish/projector/Marketplace runtime. |
| 2026-07-24 | v2.2b | **Public-projection timing, explicit (`docs-prd-flow2-publish-projection-reconcile`, hard dependency of `docs-session-publish-contract`):** MKT-UC-1 + edge #1 + Bất biến bullet reworded to require `status='open'` in addition to `visibility='public'` — a `draft` session is never projected regardless of visibility. Closes the same cross-authority conflict already fixed in `../BE/feature_marketplace_discovery_tech.md` §4 and PRD FLOW 2/12/14; this Product-spec mirror was the codex round-01 P1 gap (Reviewed spec still permitted project-on-visibility-alone). Codex round-02 [P2]: MKT-UC-1 wording corrected — `visibility` is set only at create/edit, never at publish (`PublishSession` is status-only per `feature_session_management_tech.md` §4; publish only flips `draft`→`open`, which is what actually triggers the already-public row to project). No schema/algorithm change. |
| 2026-07-19 | v2.2a | Metadata sweep (index v2.35): thêm trường **Implementation** đồng bộ BUILD-STATUS (Not started). Không đổi contract. |
| 2026-07-17 | v2.2 | **Live/DD-46 projection closure:** document intentional no-FK public session reference; personal tenants source public club alias only from owner membership and fail closed when blank; ranking remains deterministic time-order until MKT-OQ-3 is resolved. |
| 2026-07-17 | v2.1 | **DD-65/66/68:** Messenger central global vs tenant Page local-default discovery; max 8 business choices/page và opaque Join actions. |
| 2026-06-18 | v1.0 | Initial spec (English format) |
| 2026-06-19 | v2.0 | Chuẩn hoá Vietnamese numbered, thêm 10 use cases, 12 edge cases, public contract whitelist, screen states |
