# Feature: Tournament — FE Design Spec

> **Route(s):** `/clubs/:tenantId/tournaments` · `/clubs/:tenantId/tournaments/:tid` · `/tournament/:slug` (public)
> **Source authority:** `../../../features/FE/feature_tournament.md` v0.2 · baseline `0c5808fc7cf50d139bdd9c4ee79917bf4059c4f4`
> **Source contract status:** 🟡 Draft — info + registration + public share; bracket/standings/score = slice sau
> **Projection/API contract:** Tournament CRUD + registration CRUD + public tournament via `public_tournaments` view
> **Capability/availability:** Host: tournament CRUD + registration management; Member: view + register; Public: view-only (via slug)
> **Priority:** — post-MVP feature
> **FE design status:** Draft
> **Runtime status:** Not started
> **Negative scope:** Bracket/standings/live scoring = future slice; Session organizing → `feature_session_organize_fe.md`

> 📍 **Đọc nhanh (cập nhật 2026-09-15 — chỉ mục, không phải authority):** feature nguồn `../../../features/FE/feature_tournament.md`; scope/phase đọc ở `BRD.md` v3.10 §📍 · hành vi `PRD.md` v2.9 §📍 · contract `TDD.md` v3.2 §📍 · **tiến độ thật `ROADMAP.md` v3.17 §📍** (mốc `main@e235ea4`, 15/09).
>
> **Phase-1 (DD-114):** ⬜ ngoài phase-1 · **Launch (DD-113):** ⬜ negative scope
>
> **Surface:** Web app **PWA** (Next.js App Router, installable/offline — DD-113 launch = PWA + Zalo bot song song) — post-MVP; **app native iOS (App Store) + Android (CH Play) là phase-2** (DD-69): tái dùng API/contract, màn native thiết kế lại theo platform sau gate, **không phải bản sao màn này**.
>
> **Trạng thái:** FE design Draft · 🔴 **FE PENDING (DD-116)** — không mở page/component, không track `.pen` tới khi đủ cả ba vế (chọn đúng một `.pen` canonical · tracked trên `main` · owner ký gate DD-81) · as-built @ `main@e235ea4`: **0 màn FE nối API** (đúng 1 `apps/web/app/page.tsx`); BE: 0 schema.

---

## 1. Mô tả

Giải đấu CLB: Host tạo giải, set policy đăng ký (anyone/members-only/approval), quản lý registrations. Player đăng ký, rút, xem thông tin. Public page share qua slug — chỉ hiện whitelist fields (không venue cụ thể, không PII). v1 chỉ info + registration; bracket/standings = slice sau.

---

## 2. User Flows

### Flow 1: Host tạo giải đấu

1. Host vào Club → tab Giải đấu → [+ Tạo giải mới]
2. Điền form: tên, sport, dates, area, venue, slot max, policy
3. Lưu nháp hoặc Publish (→ giải chuyển `published`, registration `open`)

### Flow 2: Player đăng ký

1. Player xem Tournament Detail → thấy thông tin + CTA "Đăng ký"
2. Policy `anyone`: click → `registered` ngay
3. Policy `approval`: click → `pending` → host duyệt/từ chối
4. Policy `members_only`: check membership → registered hoặc reject

### Flow 3: Host quản lý registrations

1. Host vào Tournament Detail → thấy full list registrations
2. Approval mode: Duyệt (✅) / Từ chối (❌) từng pending registration
3. Có thể đóng đăng ký thủ công hoặc auto-close theo deadline

### Flow 4: Share public tournament page

1. Host tap 🔗 Share → copy public link `/tournament/:slug`
2. Ai cũng xem được (không cần login) → thấy info + CTA "Đăng ký ngay" (→ auth gate)

---

## 3. Screens & States

### Tournament List — `/clubs/:tenantId/tournaments`

#### Layout (Desktop 1440px)

```
┌──────────┬──────────────────────────────────────────────────────┐
│          │  ← CLB Cầu lông BT        🏆 Giải đấu   [+ Tạo]   │
│ Sidebar  ├──────────────────────────────────────────────────────┤
│          │                                                      │
│          │  ┌────────────────────────────────────────────────┐  │
│          │  │ 🏆 Giải Cầu lông Mùa hè 2026                 │  │
│          │  │ 📅 01/08 — 15/08  ·  🟢 Đang mở ĐK           │  │
│          │  │ 👥 12/16 ████████░░░ 75%                      │  │
│          │  └────────────────────────────────────────────────┘  │
│          │  ┌────────────────────────────────────────────────┐  │
│          │  │ 🏆 Giải Giao hữu Q7                           │  │
│          │  │ 📅 20/09 — 22/09  ·  📝 Nháp                  │  │
│          │  │ 👥 0/8                                         │  │
│          │  └────────────────────────────────────────────────┘  │
│          │                                                      │
└──────────┴──────────────────────────────────────────────────────┘
```

#### Layout (Mobile 375px)

```
┌──────────────────────────┐
│ ← CLB          🏆 Giải đấu│
├──────────────────────────┤
│                           │
│ ┌──────────────────────┐ │
│ │ 🏆 Giải Mùa hè 2026 │ │
│ │ 📅 01-15/08          │ │
│ │ 👥 12/16  🟢 Mở ĐK  │ │
│ │ ████████░░ 75%       │ │
│ └──────────────────────┘ │
│ ┌──────────────────────┐ │
│ │ 🏆 Giải Giao hữu Q7 │ │
│ │ 📅 20-22/09          │ │
│ │ 👥 0/8    📝 Nháp    │ │
│ └──────────────────────┘ │
│                           │
│    [+ Tạo giải mới]     │
│                           │
├──────────────────────────┤
│ 🏠  🔍  🏸  ⚙️           │
└──────────────────────────┘
```

#### States

- **Loading:** Skeleton: 3 tournament card skeletons (each = title line + date line + slot progress bar + status badge)
- **Ready:** Tournament cards sorted by `starts_at` DESC. Each card: title + date range + slot progress + status badge
- **Empty:** Illustration 🏆 + `t("Chưa có giải đấu nào", "No tournaments yet")` + (host: CTA `t("Tạo giải đấu đầu tiên", "Create your first tournament")`)
- **Error:** Error banner + retry: `t("Không tải được danh sách giải. Thử lại.", "Couldn't load tournaments. Try again.")`

#### Error mapping

| Status | Error code | Visible state | i18n `t(vi, en)` |
|---|---|---|---|
| 403 | `NOT_A_MEMBER` | Redirect Club list | `t("Cần là thành viên CLB để xem giải đấu", "You need to be a club member to view tournaments")` |
| — | *(unknown / timeout)* | **Fail closed** — error + retry | `t("Không tải được. Thử lại.", "Couldn't load. Try again.")` |

#### Responsive

| Breakpoint | Tournament List |
|---|---|
| 1440px | Sidebar 240px + tournament cards max-width 720px |
| 768px | Sidebar hidden; cards full content width |
| 375px | Cards full mobile width; bottom nav visible |

---

### Tournament Detail — `/clubs/:tenantId/tournaments/:tid`

#### Layout (Mobile 375px)

```
┌──────────────────────────────┐
│ ← Giải đấu        [🔗 Share]│
├──────────────────────────────┤
│ ┌──────────────────────────┐ │
│ │   [Banner/Hero Image]    │ │
│ │   🏸 Cầu lông            │ │
│ │   📅 01/08 — 15/08/2026  │ │
│ │   📍 Sân BT, Q.BT       │ │  ← venue chỉ registered
│ │   🟢 Đang mở ĐK          │ │
│ └──────────────────────────┘ │
│                               │
│ Thông tin                     │
│ ┌──────────────────────────┐ │
│ │ Giải cầu lông giao hữu  │ │
│ │ mùa hè cho mọi trình    │ │
│ │ độ. Đơn nam/nữ + đôi.   │ │
│ │                          │ │
│ │ Slots: 12/16             │ │
│ │ ████████████░░ 75%       │ │
│ │ Policy: 🌐 Ai cũng ĐK   │ │
│ └──────────────────────────┘ │
│                               │
│ Người đăng ký (12)  host view│
│ ┌──────────────────────────┐ │
│ │ 👤 Minh Hoàng   ✅ Đã ĐK│ │
│ │ 👤 Anh T        ✅ Đã ĐK│ │
│ │ 👤 Hùng N       ⏳ Chờ   │ │
│ │ ...                      │ │
│ └──────────────────────────┘ │
│                               │
│ (Player chưa ĐK)            │
│ [═══ Đăng ký tham gia ═══]  │
│                               │
│ (Player đã ĐK)              │
│ ✅ Đã đăng ký  [Rút ĐK]    │
│                               │
│ (Host)                        │
│ [⚙️ Sửa] [📋 Đóng ĐK] [🗑] │
│                               │
└──────────────────────────────┘
```

#### States

- **Loading:** Skeleton: hero banner skeleton + 4 info field skeletons + 3 registration row skeletons + CTA skeleton
- **Ready:** Full tournament detail + registration list (host) or count (member) + appropriate CTA per role/status
- **Empty:** N/A — luôn có tournament data nếu navigate thành công
- **Error:** Error banner + retry: `t("Không tải được chi tiết giải. Thử lại.", "Couldn't load tournament details. Try again.")`

#### Error mapping

| Status | Error code | Visible state | i18n `t(vi, en)` |
|---|---|---|---|
| 404 | `TOURNAMENT_NOT_FOUND` | Redirect tournament list + toast | `t("Giải đấu không tồn tại", "Tournament not found")` |
| 409 | `TOURNAMENT_FULL` | CTA disabled: "Hết chỗ" | `t("Đã hết chỗ đăng ký", "Registration is full")` |
| 409 | `REGISTRATION_CLOSED` | CTA hidden; badge "Đã đóng ĐK" | `t("Đăng ký đã đóng", "Registration is closed")` |
| 403 | `NOT_A_MEMBER` | CTA hidden; info: members-only | `t("Chỉ thành viên CLB mới đăng ký được", "Only club members can register")` |
| — | *(unknown / timeout)* | **Fail closed** — error + retry | `t("Lỗi. Thử lại.", "Error. Try again.")` |

#### Responsive

| Breakpoint | Tournament Detail |
|---|---|
| 1440px | Sidebar 240px + hero banner + content max-width 720px + registration sidebar panel 320px |
| 768px | Sidebar hidden; content stacked; registration list below info |
| 375px | Mobile stacked layout; all sections vertical |

---

### Public Tournament Page — `/tournament/:slug`

#### Layout (Mobile 375px)

```
┌──────────────────────────────┐
│        🏆 Plexco Tournament  │
├──────────────────────────────┤
│ ┌──────────────────────────┐ │
│ │   [Banner Image]         │ │
│ │                          │ │
│ │ Giải Cầu lông Mùa hè   │ │
│ │ 🏸 Cầu lông              │ │
│ │ 📅 01/08 — 15/08/2026   │ │
│ │ 📍 Quận Bình Thạnh      │ │  ← area only (DD-06)
│ │ 👥 12/16 chỗ            │ │
│ │ CLB Cầu lông BT          │ │
│ └──────────────────────────┘ │
│                               │
│ Giải cầu lông giao hữu mùa  │
│ hè dành cho mọi trình độ.    │
│                               │
│ [═══ Đăng ký ngay ═══]      │  → auth gate nếu chưa login
│                               │
├──────────────────────────────┤
│ Powered by plexco · Privacy  │
└──────────────────────────────┘
```

#### States

- **Loading:** Skeleton: banner skeleton + 5 info line skeletons + CTA skeleton
- **Ready:** Public tournament info (whitelist fields only) + registration CTA
- **Empty (404):** `t("Giải đấu không tồn tại hoặc đã bị gỡ", "Tournament not found or has been removed")`
- **Empty (tombstone):** Slug đã đổi → `t("Giải đấu đã chuyển sang link mới", "Tournament has moved to a new link")` + redirect hint
- **Error:** `t("Không tải được trang giải đấu. Thử lại.", "Couldn't load the tournament page. Try again.")`

#### Error mapping

| Status | Error code | Visible state | i18n `t(vi, en)` |
|---|---|---|---|
| 404 | `TOURNAMENT_NOT_FOUND` | 404 page | `t("Giải đấu không tồn tại", "Tournament not found")` |
| 301 | `SLUG_TOMBSTONE` | Redirect to new slug | `t("Link đã thay đổi", "Link has changed")` |
| — | *(unknown / timeout)* | **Fail closed** — error + retry | `t("Lỗi. Thử lại.", "Error. Try again.")` |

#### Responsive

| Breakpoint | Public Page |
|---|---|
| 1440px | Card centered max-width 560px; generous whitespace |
| 768px | Card centered max-width 520px |
| 375px | Card full width with padding 16px |

---

## 4. Components Used

| Component | States | Mô tả |
|---|---|---|
| `TournamentCard` | default, hover (lift), draft (muted) | Card trong list: title + date + slot progress + status |
| `SlotProgressBar` | normal (blue <80%), warning (orange ≥80%), full (red 100%) | Visual slot fill indicator |
| `StatusBadge` | 🟢 Đang mở, 🔴 Đã đóng, 📝 Nháp, ✅ Hoàn thành, ❌ Đã huỷ | Tournament/registration status |
| `RegistrationRow` | ✅ registered, ⏳ pending, ❌ rejected, ↩️ withdrawn | Registration entry |
| `ApprovalActionBar` | [✅ Duyệt] [❌ Từ chối] (host, pending only) | Approve/reject controls |
| `SlotCounter` | "N/M" with progress | Slot count display |
| `PolicyBadge` | 🌐 anyone, 🔒 members_only, 📋 approval | Registration policy indicator |
| `TournamentHero` | loading (skeleton), ready, public (limited fields) | Banner/hero for tournament detail |
| `ShareButton` | default, copied (toast "Đã copy link") | Share public link |
| `TournamentForm` | create mode, edit mode | CRUD form for tournament |
| `PlexcoBrandHeader` | logo + minimal nav | Branded header for public page |

---

## 5. Edge Cases (UX)

| # | Case | Hiển thị |
|---|---|---|
| 1 | Slot cuối bị 2 người đăng ký cùng lúc | Người sau: toast `t("Hết chỗ — thử lại sau hoặc vào danh sách chờ", "Full — try again later or join the waitlist")` |
| 2 | Host đóng ĐK đúng lúc player bấm đăng ký | Toast: `t("Đăng ký đã đóng", "Registration is closed")` + CTA refresh |
| 3 | Player đăng ký rồi rút rồi đăng ký lại | OK — re-activate; slot re-count; không double-count |
| 4 | Slug đổi tên sau share | Link cũ tombstone (DD-83) → redirect link mới; không vỡ URL đã share |
| 5 | Title rất dài (>60 chars) | Truncate + ellipsis trong card list; full title trong detail |
| 6 | Venue trên public page | KHÔNG hiện — chỉ area (DD-06); venue chỉ registered |
| 7 | Host approve khi slot đã full | Reject approve; toast: "Hết chỗ — không thể duyệt thêm"; pending giữ nguyên |
| 8 | Non-member cố đăng ký giải members-only | CTA hidden hoặc disabled + info: "Chỉ thành viên CLB" |
| 9 | Registration deadline auto-close | System auto-close; UI realtime update status badge 🟢→🔴; CTA disappear |
| 10 | Giải bị hủy khi có registrations | Tất cả registered → void; toast thông báo; UI shows ❌ Đã huỷ |

---

## 6. Data hiển thị

| Field | Format | i18n `t(vi, en)` | Ghi chú |
|---|---|---|---|
| Tournament title | Text | `data — no copy` | Max 60 chars truncate |
| Sport | Emoji + text | `t("Cầu lông", "Badminton")` etc. | Map từ `sport_key` |
| Date range | "DD/MM — DD/MM/YYYY" | locale formatter | |
| Area | "Quận N, TP" | `data — no copy` | Public (DD-06) |
| Venue | Full address | `data — no copy` | ❌ Not public; registered only |
| Slot progress | "N/M" + progress bar | `t("%d/%d đã đăng ký", "%d/%d registered")` | NULL max → `t("Không giới hạn", "Unlimited")` |
| Registration status | Badge | `t("Đang mở", "Open")` · `t("Đã đóng", "Closed")` · `t("Nháp", "Draft")` | |
| Player status | Badge | `t("Đã ĐK", "Registered")` · `t("Chờ duyệt", "Pending")` · `t("Bị từ chối", "Rejected")` · `t("Đã rút", "Withdrawn")` | |
| Host/CLB name | Text | `data — no copy` | Public |

> **i18n:** Mọi chuỗi user-facing qua `t(vi, en)`.

---

## 7. Responsive & Interaction Notes

- **Tournament cards:** Tap → navigate detail. Hover (desktop): lift shadow. Draft cards have muted opacity (0.7)
- **Slot progress bar:** Animated fill on mount. Color transitions: blue (<80%) → orange (80-95%) → red (100%)
- **Registration list:** Host: full list with approve/reject actions. Member: count only. Pull-to-refresh on mobile
- **Share button:** Copy to clipboard + toast "Đã copy link!" (1.5s auto-dismiss). Share URL = `/tournament/:slug`
- **Public page:** SEO-optimized: `<title>`, `og:title`, `og:description`, `og:image` for social sharing. No JS required for basic view
- **Auth gate:** "Đăng ký ngay" on public page → redirect login → return to tournament detail (internal route)
- **Dark mode:** Card bg `var(--bg-card)`, progress bar fill `var(--primary)`, status badges use semantic tokens, danger (huỷ/reject) `var(--error)`
- **Touch targets:** ≥ 44×44px. Approve/reject buttons: ≥ 48px height
- **Approve/reject:** Swipe-to-action on mobile (swipe right = approve, swipe left = reject) as future enhancement

---

_FE Design Spec v0.1 · 2026-08-10 · Source: feature_tournament.md v0.2_
_Changelog v0.1: Initial — 3+1 screens (Tournament List, Detail, Public Page, Create/Edit Form), 7 sections, 10 edge cases, ASCII wireframes Desktop + Mobile. v1 scope: info + registration only._
_FE Design Spec — 2026-09-08 (cấu trúc, không bump version): thêm khối 📍 Đọc nhanh dưới header — feature nguồn · phase-1 (DD-114) · launch (DD-113) · surface PWA trước, native iOS/Android phase-2 (DD-69) · FE PENDING (DD-116) · as-built @ `e235ea4`. Pointer core docs BRD v3.10 · PRD v2.9 · TDD v3.2 · ROADMAP v3.17. Nội dung thiết kế không đổi._

_Re-pin 2026-09-15 (cấu trúc, không bump version): as-built @ `e235ea4` theo `ROADMAP.md` v3.17 §📍 — 8 command session · 7 route nghiệp vụ · **0 màn FE**; FE PENDING (DD-116) không đổi, DD-119 vẫn 🟡 chưa ratify. Nội dung thiết kế không đổi._
