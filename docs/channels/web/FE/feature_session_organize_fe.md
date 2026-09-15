# Feature: Session Organize — FE Design Spec

> **Route(s):** `/clubs/:tenantId/sessions/:sid/organize` · live scoreboard inline
> **Source authority:** `../../../features/FE/feature_session_organize.md` v0.6 · baseline `0c5808fc7cf50d139bdd9c4ee79917bf4059c4f4`
> **Source contract status:** Draft — courts, matches, scoring, assignment
> **Projection/API contract:** OrganizeService CRUD + SSE live score events
> **Capability/availability:** `session.organize` grant (court/match management) + `session.score` grant (scoring); both session-scoped, expires ≤ session.ends_at
> **Priority:** — post-core, after session management stable
> **FE design status:** Draft
> **Runtime status:** Not started
> **Negative scope:** Session CRUD/roster → `feature_sessions_fe.md`; Payment → `feature_payments_fe.md`. Chat command adapter ngoài scope FE web design

> 📍 **Đọc nhanh (cập nhật 2026-09-15 — chỉ mục, không phải authority):** feature nguồn `../../../features/FE/feature_session_organize.md`; scope/phase đọc ở `BRD.md` v3.10 §📍 · hành vi `PRD.md` v2.9 §📍 · contract `TDD.md` v3.2 §📍 · **tiến độ thật `ROADMAP.md` v3.17 §📍** (mốc `main@e235ea4`, 15/09).
>
> **Phase-1 (DD-114):** ⬜ post-P4 · **Launch (DD-113):** ⬜
>
> **Surface:** Web app **PWA** (Next.js App Router, installable/offline — DD-113 launch = PWA + Zalo bot song song) — post-core; **app native iOS (App Store) + Android (CH Play) là phase-2** (DD-69): tái dùng API/contract, màn native thiết kế lại theo platform sau gate, **không phải bản sao màn này**.
>
> **Trạng thái:** FE design Draft · 🔴 **FE PENDING (DD-116)** — không mở page/component, không track `.pen` tới khi đủ cả ba vế (chọn đúng một `.pen` canonical · tracked trên `main` · owner ký gate DD-81) · as-built @ `main@e235ea4`: **0 màn FE nối API** (đúng 1 `apps/web/app/page.tsx`); BE: 0 schema.

---

## 1. Mô tả

Giao diện tổ chức buổi chơi real-time: Host khai báo sân, tạo trận, xếp người (random/balanced/rotation), và ghi điểm live. Score là event-sourced (append-only ledger) với materialized set scores. Player xem board read-only. Mọi mutation qua server — FE không tự tính điểm.

---

## 2. User Flows

### Flow 1: Khai báo sân + tạo trận

1. Host vào Organize board → thấy court list (trống nếu chưa tạo)
2. [+ Sân] → nhập label (vd "Sân 1") → sân xuất hiện trạng thái ⚪ Trống
3. Xếp players lên sân → tạo match (draft → ready → live)

### Flow 2: Xếp người tự động

1. Host chọn mode: Ngẫu nhiên / Cân bằng (theo rating) / Xoay tua
2. Preview modal: xem assignment + warnings (thiếu rating, etc.)
3. [Apply plan] → players assigned → match ready

### Flow 3: Ghi điểm live

1. Match live → tap side A (+1) hoặc side B (+1)
2. Score cập nhật real-time (SSE). Set/match auto-complete theo `target_points` + `win_by` + `best_of`
3. Undo: revert điểm vừa ghi (bounded — chỉ latest effective point)

### Flow 4: Player xem board (read-only)

1. Player active trong session → xem Organize board read-only
2. Thấy courts, matches, scores live (SSE)
3. Không thấy organize controls, score buttons

---

## 3. Screens & States

### Organize Board — `/clubs/:tenantId/sessions/:sid/organize`

#### Layout (Desktop 1440px)

```
┌──────────┬──────────────────────────────────────────────────────┐
│          │  ← Session          🏸 Cầu lông T5 · Organize       │
│ Sidebar  ├──────────────────────────────────────────────────────┤
│          │                                                      │
│          │  ─── Sân (3) ───                          [+ Sân]   │
│          │  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│          │  │ Sân 1    │  │ Sân 2    │  │ Sân 3    │          │
│          │  │ 🟢 LIVE  │  │ ⚪ Trống  │  │ 🟢 LIVE  │          │
│          │  │ A+B vs   │  │          │  │ E+F vs   │          │
│          │  │ C+D      │  │          │  │ G+H      │          │
│          │  │ 15-12    │  │          │  │ 8-11     │          │
│          │  └──────────┘  └──────────┘  └──────────┘          │
│          │                                                      │
│          │  ─── Chưa xếp (4 người) ───                         │
│          │  [I. Khoa] [J. Linh] [K. Phúc] [L. Trang]          │
│          │                                                      │
│          │  [Xếp ngẫu nhiên] [Xếp cân bằng] [Xoay tua]       │
│          │                                                      │
│          │  ─── Lịch sử trận ───                               │
│          │  Trận 1: A+B vs C+D  21-18 ✅                       │
│          │  Trận 2: E+F vs G+H  đang chơi...                  │
│          │                                                      │
└──────────┴──────────────────────────────────────────────────────┘
```

#### Layout (Mobile 375px)

```
┌──────────────────────────┐
│ ← Session    Organize    │
├──────────────────────────┤
│                           │
│ ─── Sân (3) ─── [+ Sân] │
│ ┌──────────────────────┐ │
│ │ Sân 1  🟢 LIVE       │ │
│ │ A+B vs C+D           │ │
│ │ Set 2: 15-12         │ │
│ │ [Ghi điểm →]         │ │
│ └──────────────────────┘ │
│ ┌──────────────────────┐ │
│ │ Sân 2  ⚪ Trống       │ │
│ └──────────────────────┘ │
│ ┌──────────────────────┐ │
│ │ Sân 3  🟢 LIVE       │ │
│ │ E+F vs G+H           │ │
│ │ Set 1: 8-11          │ │
│ │ [Ghi điểm →]         │ │
│ └──────────────────────┘ │
│                           │
│ Chưa xếp (4)            │
│ [I] [J] [K] [L]         │
│                           │
│ [Xếp ngẫu nhiên ▼]     │
│                           │
├──────────────────────────┤
│ 🏠  🔍  🏸  ⚙️           │
└──────────────────────────┘
```

#### States

- **Loading:** Skeleton: 3 court card skeletons (row layout) + player pool skeleton chips + action button skeletons
- **Ready:** Court cards with live status + player pool chips + assignment buttons + match history
- **Empty:** No courts yet — illustration 🏸 + `t("Thêm sân để bắt đầu tổ chức", "Add courts to start organizing")` + CTA [+ Thêm sân đầu tiên]
- **Error:** Error banner + retry: `t("Không tải được bảng điều phối. Thử lại.", "Couldn't load the organize board. Try again.")`

#### Error mapping

| Status | Error code | Visible state | i18n `t(vi, en)` |
|---|---|---|---|
| 403 | `CAPABILITY_DENIED` | Board read-only (player view) — no organize/score controls | `t("Bạn chỉ có quyền xem", "View-only access")` |
| 403 | `SESSION_NOT_ORGANIZABLE` | Banner: session không thể tổ chức (draft/closed/cancelled) | `t("Buổi chơi không thể tổ chức ở trạng thái hiện tại", "Session can't be organized in its current state")` |
| 409 | `SESSION_NOT_STARTED` | Banner warning: chưa đến giờ, chỉ chuẩn bị | `t("Chưa đến giờ — chỉ có thể chuẩn bị sân và trận", "Not started yet — you can only set up courts and matches")` |
| 409 | `SESSION_ENDED` | Banner: session ended, read-only | `t("Buổi chơi đã kết thúc", "Session has ended")` |
| — | *(unknown / timeout)* | **Fail closed** — error + retry | `t("Không tải được. Thử lại.", "Couldn't load. Try again.")` |

#### Responsive

| Breakpoint | Organize Board |
|---|---|
| 1440px | Sidebar 240px + courts horizontal row + player pool + match history below |
| 768px | Sidebar hidden; courts 2-column grid; player pool wraps |
| 375px | Courts stacked vertically; player pool horizontal scroll; assignment as dropdown |

---

### Live Scoreboard — inline per match

#### Layout (Mobile 375px)

```
┌──────────────────────────┐
│ ← Sân 1     Set 2/3     │
├──────────────────────────┤
│                           │
│   A. Nam + B. Đức        │
│        ┌────────┐        │
│        │   15   │ ← +1   │
│        └────────┘        │
│   ─────────────────      │
│        ┌────────┐        │
│        │   12   │ ← +1   │
│        └────────┘        │
│   C. Thảo + D. Hùng     │
│                           │
│  Set 1: 21-18 ✅         │
│  Set 2: 15-12 🔴 live   │
│                           │
│  [↩ Undo]  [⏹ Kết thúc] │
│                           │
└──────────────────────────┘
```

#### States

- **Loading (connecting SSE):** Skeleton scoreboard + "Đang kết nối..." spinner
- **Ready (live):** Score buttons active + real-time SSE updates + set history
- **Completed:** Score frozen + "Trận đã kết thúc" banner + final result
- **Error (SSE disconnected):** Banner "Mất kết nối" + auto-reconnect + manual retry. Stale score dimmed

#### Error mapping

| Status | Error code | Visible state | i18n `t(vi, en)` |
|---|---|---|---|
| 409 | `MATCH_NOT_LIVE` | Score buttons disabled + banner | `t("Trận chưa bắt đầu hoặc đã kết thúc", "Match hasn't started or has ended")` |
| 409 | `SLOT_TAKEN` | Toast: slot conflict | `t("Vị trí đã bị chiếm. Làm mới.", "Slot taken. Refresh.")` |
| 409 | `COURT_OCCUPIED` | Toast: court conflict | `t("Sân đang bận. Chọn sân khác.", "Court is busy. Pick another.")` |
| 409 | `PLAYER_ALREADY_ON_COURT` | Toast: player conflict | `t("Người chơi đang ở sân khác", "Player is on another court")` |
| — | *(unknown / timeout)* | **Fail closed** — retry | `t("Lỗi. Thử lại.", "Error. Try again.")` |

---

### Assignment Preview — modal

#### Layout (Mobile 375px)

```
┌──────────────────────────┐
│ 🎲 Preview — Cân bằng   │
├──────────────────────────┤
│                           │
│ Sân 1: [I+J] vs [K+L]   │
│ ⚠️ Thiếu rating: K. Phúc│
│                           │
│ Sân 2: [M+N] vs [O+P]   │
│                           │
│ [Apply plan] [Preview lại]│
└──────────────────────────┘
```

#### States

- **Loading:** Spinner + `t("Đang xếp...", "Assigning...")`
- **Ready:** Assignment plan + warnings (missing ratings, etc.)
- **Stale:** Banner: `t("Roster đã đổi — preview lại", "Roster changed — preview again")` + CTA re-preview
- **Error:** `t("Lỗi xếp người. Thử lại.", "Assignment error. Try again.")`

---

## 4. Components Used

| Component | States | Mô tả |
|---|---|---|
| `CourtCard` | 🟢 live (green border), ⚪ empty (gray), ✅ done (blue), hover (lift) | Court card showing match status |
| `MatchScoreDisplay` | current set score + set history | Score display per match |
| `ScoreButton` | default, pressed (scale-down), disabled (no permission), cooldown (debounce) | Tap +1 point — large touch target (≥56×56px) |
| `UndoButton` | default, disabled (nothing to undo), processing | Undo latest point |
| `PlayerChip` | unassigned (blue), on-court (green + label), resting (gray) | Player in pool |
| `AssignmentPreview` | plan rows + warning badges | Modal showing planned assignments |
| `WarningBadge` | orange chip | "Thiếu rating", "Stale plan" etc. |
| `SetRow` | ✅ completed (dim), 🔴 live (highlight), draft (muted) | Set score row in history |
| `MatchHistory` | list of completed/cancelled matches | Match history panel |
| `CourtStatusBadge` | 🟢 LIVE, ⚪ Trống, ✅ Done | Court availability indicator |

---

## 5. Edge Cases (UX)

| # | Case | Hiển thị |
|---|---|---|
| 1 | Hai host tap +1 cùng lúc trên cùng side | Server lock + sequence unique → không mất hoặc đảo thứ tự; FE refresh sau mỗi SSE event |
| 2 | Undo khi court đã reassigned | Toast: `t("Không thể undo — sân đã được gán cho trận khác", "Can't undo — court has been reassigned")` |
| 3 | Session chưa tới giờ | Banner warning; chỉ cho chuẩn bị (tạo sân/match/plan), không cho start/score |
| 4 | Session kết thúc khi đang ghi điểm | Banner "Buổi chơi đã kết thúc" → score buttons disabled → board read-only |
| 5 | Player rời giữa trận | Stint → `withdrawn`; player chip chuyển gray; slot available cho replacement |
| 6 | SSE mất kết nối | Banner "Mất kết nối" + auto-reconnect mỗi 5s (max 5 lần) → manual retry CTA |
| 7 | Balanced assignment thiếu rating | Warning badge "Thiếu rating cho X" + fallback random cho những player thiếu |
| 8 | Plan apply trên roster đã đổi | Reject `STALE_ASSIGNMENT_PLAN` → modal thông báo + CTA "Preview lại" |
| 9 | Double-tap score button | Debounce 300ms; button scale animation confirms single tap registered |
| 10 | Player xem board (read-only) | Ẩn: [+ Sân], score buttons, assignment controls, undo/end. Chỉ thấy courts + scores + history |

---

## 6. Data hiển thị

| Field | Format | i18n `t(vi, en)` | Ghi chú |
|---|---|---|---|
| Court label | "Sân N" | `t("Sân %s", "Court %s")` | Unique trong session |
| Court status | Badge: LIVE/Trống/Done | `t("Đang chơi", "Live")` · `t("Trống", "Available")` · `t("Xong", "Done")` | |
| Match teams | "A+B vs C+D" | `data — no copy` | Display names |
| Set score | "15-12" | tabular-nums | Materialized từ server |
| Set status | ✅ completed / 🔴 live / draft | `data — no copy` | |
| Unassigned count | "N người" | `t("Chưa xếp (%d người)", "Unassigned (%d)")` | |
| Player name | First name + initial | `data — no copy` | Privacy: không full name |
| Warning text | Varies | `t("Thiếu rating", "Missing rating")` · `t("Roster đã đổi", "Roster changed")` | |

> **i18n:** Mọi chuỗi user-facing qua `t(vi, en)`.

---

## 7. Responsive & Interaction Notes

- **Score buttons:** Large touch targets ≥ 56×56px. Scale-down animation on press (0.95 scale, 100ms). Debounce 300ms
- **Court cards:** Desktop = horizontal row. Tablet = 2-col grid. Mobile = vertical stack. Tap card → opens scoreboard
- **SSE reconnect:** Auto-reconnect mỗi 5s (exponential backoff cap 30s). Re-authorize per event. Hard 30s heartbeat
- **Assignment modes:** Dropdown on mobile (3 options); buttons on desktop. Preview is always modal
- **Player pool:** Horizontal scroll on mobile; wrap on desktop. Drag-drop to court on desktop (future)
- **Dark mode:** Court card bg `var(--bg-card)`, live border `var(--success)`, score text `var(--text-primary)`, player chips use semantic tokens
- **Touch targets:** All controls ≥ 44×44px; score buttons ≥ 56×56px
- **Sidebar IDs:** `#sidebar`, `#sidebar-backdrop`, `#menu-toggle`

---

_FE Design Spec v0.1 · 2026-08-10 · Source: feature_session_organize.md v0.6_
_Changelog v0.1: Initial — 3 screens (Organize Board, Live Scoreboard, Assignment Preview), 7 sections, 10 edge cases, ASCII wireframes Desktop + Mobile._
_FE Design Spec — 2026-09-08 (cấu trúc, không bump version): thêm khối 📍 Đọc nhanh dưới header — feature nguồn · phase-1 (DD-114) · launch (DD-113) · surface PWA trước, native iOS/Android phase-2 (DD-69) · FE PENDING (DD-116) · as-built @ `e235ea4`. Pointer core docs BRD v3.10 · PRD v2.9 · TDD v3.2 · ROADMAP v3.17. Nội dung thiết kế không đổi._

_Re-pin 2026-09-15 (cấu trúc, không bump version): as-built @ `e235ea4` theo `ROADMAP.md` v3.17 §📍 — 8 command session · 7 route nghiệp vụ · **0 màn FE**; FE PENDING (DD-116) không đổi, DD-119 vẫn 🟡 chưa ratify. Nội dung thiết kế không đổi._
