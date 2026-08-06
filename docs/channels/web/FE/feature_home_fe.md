# Feature: Home (PWA) — FE Design Spec

> **Route(s):** `/` (authenticated) — PWA landing
> **Source authority:** `../../../features/feature_home.md` v0.10 · baseline `0c5808fc7cf50d139bdd9c4ee79917bf4059c4f4`
> **Source contract status:** Reviewed composition contract
> **Projection/API contract:** `GET /api/me/home` target in BE Home v0.4; no runtime
> **Capability/availability:** Person-self session authz + public Marketplace availability; section failure is fail-closed
> **Priority:** 13 — designer-kickoff.md §3B
> **FE design status:** Draft
> **Runtime status:** Not started — authenticated Home composition/UI chưa build
> **Negative scope:** Không tự tính money/capacity; chỉ compose person-self + public whitelist

---

## 1. Mô tả

Màn hình đầu tiên sau đăng nhập trên PWA — personal dashboard tổng hợp: tiền còn nợ xuyên CLB, kèo sắp tới (mọi CLB), và gợi ý kèo từ marketplace. Mobile-first 375px, glanceable, ưu tiên 1 màn không scroll cho nội dung chính. "Có taste" — áp hero recipe (gradient + glow) từ theme-direction.

> 🚧 **Current implementation boundary — toàn bộ §6 của file này là `UNPINNED`.** `GET /api/me/home`
> là **target** trong BE Home v0.4, chưa có runtime; BE §3 hiện là DTO minh hoạ, field name chốt ở
> build slice. Wireframe, state, component và animation (count-up chips, hero gradient) là **visual
> fixture** kiểm tra hierarchy/spacing — KHÔNG authorize fetch/implement, không dùng làm
> seed/default/fallback. Mọi số tiền và capacity đến từ server: `feature_home.md:26` chốt "Home KHÔNG
> tự tính tiền phía client/server"; chỉ `known_zero` mới hiện 0, `unknown` phải hiện unavailable/retry
> chứ không fail-open thành 0.

---

## 2. User Flows

### Flow 1: Xem Home sau login

1. User login → thấy Home: chips tài chính + hero kèo kế tiếp + list kèo sắp tới
2. Tap chip "Còn nợ" → person-self debt detail
3. Tap hero card → session detail (đúng tenant context)
4. Tap "Tất cả →" → full list sessions

### Flow 2: User mới (chưa thuộc CLB)

1. Login → Home hiện onboarding checklist thay chips
2. + Suggested sessions từ marketplace
3. Tap "Khám phá kèo" → marketplace

---

## 3. Screens & States

### Home — PWA Main Screen

#### Layout (Mobile 375px)

```
┌──────────────────────────────────────┐
│ [Avatar] Xin chào 👋 {tên}   💬 🔔● │
├──────────────────────────────────────┤
│ ┌──────────────┐  ┌───────────────┐ │
│ │ 💸 Còn nợ    │  │ 📅 Kèo tuần   │ │
│ │ 85.000₫ ·2CLB│  │ này: 3        │ │
│ └──────────────┘  └───────────────┘ │
├──────────────────────────────────────┤
│ ┌──────────────────────────────────┐ │
│ │ ⭐ HERO — kèo kế tiếp            │ │
│ │ gradient bg + sport glow         │ │
│ │                                  │ │
│ │ 🏸 Cầu lông T3 · CLB Rồng Xanh  │ │
│ │ T3 22/07 · 19:30                │ │
│ │ Role: Player                     │ │
│ │                                  │ │
│ │ Tap card → session detail         │ │
│ └──────────────────────────────────┘ │
├──────────────────────────────────────┤
│ KÈO SẮP TỚI                Tất cả →│
│ ┌──────────────────────────────────┐ │
│ │ 🏸 Đánh cầu CN · Player · 🔴    │ │
│ │ ⚽ FC Phượng Hoàng · Host · —   │ │
│ │ 🏸 BM T2 · Player · ⚠️          │ │
│ └──────────────────────────────────┘ │
├──────────────────────────────────────┤
│ KÈO GỢI Ý                          │
│ ┌──────────────────────────────────┐ │
│ │ 🏸 Q.7 · T5 · 120k · 5 chỗ trống│ │
│ │ 🎾 Q.2 · CN · 200k · 2 chỗ trống│ │
│ └──────────────────────────────────┘ │
├──────────────────────────────────────┤
│  🏠   [🔍 FAB]   🏸   ⚙️           │
│  Home  Khám phá   Club  Setting     │
└──────────────────────────────────────┘
```

#### Layout (Desktop ≥1024px)

```
┌──────────────────────────────────────────────────────────────┐
│  Header: [Avatar] Xin chào {tên}         💬 🔔●              │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  Chips: [💸 Còn nợ: 85.000₫ · 2CLB] [📅 Kèo tuần này: 3]   │
│                                                              │
│  ┌────────────────────────────┬──────────────────────────────┤
│  │                            │                              │
│  │  HERO Card (gradient)      │  KÈO GỢI Ý (marketplace)    │
│  │  🏸 Cầu lông T3            │  🏸 Q.7 · T5 · 120k · 5 trống│
│  │  CLB Rồng Xanh             │  🎾 Q.2 · CN · 200k · 2 trống│
│  │  T3 22/07 · 19:30          │  ⚽ Q.TB · CN · 80k · 12 trống│
│  │  Tap card → session detail │  [Xem tất cả →]             │
│  │                            │                              │
│  ├────────────────────────────┤                              │
│  │  KÈO SẮP TỚI              │                              │
│  │  • 🏸 Đánh cầu CN · 🔴    │                              │
│  │  • ⚽ Phượng Hoàng · —    │                              │
│  │  • 🏸 BM T2 · ⚠️          │                              │
│  │  [Tất cả →]               │                              │
│  └────────────────────────────┴──────────────────────────────┤
└──────────────────────────────────────────────────────────────┘
```

#### States

- **Loading:** Skeleton: 2 chips + hero card + 3 compact rows — maintain layout
- **Ready:** Chips + hero gradient card + upcoming list + suggested. Count-up animation chưa được implement/author tới khi owner contract tồn tại (xem §7)
- **Error:** Toast "Không tải được trang chủ" + retry. Không giữ/render person-self snapshot cũ
- **Empty (proven no debt, no sessions):** Chips: 💸 Còn nợ 0đ (chỉ proven `known_zero`) + 📅 0 kèo. CTA "Khám phá kèo" → marketplace; không render deferred streak
- **Onboarding (user mới):** Thay chips bằng checklist progress + suggested sessions
- **Offline:** Banner "Không có kết nối"; ẩn person-self chips/hero/upcoming. Chỉ public suggested cache có thể còn theo Marketplace policy

#### Error mapping

| Status | Error code | Visible state | i18n `t(vi, en)` |
|---|---|---|---|
| 200 | `debt: null` + `debtReason: "UNAVAILABLE"` | **Per-section** — chỉ chip "Còn nợ" thành unavailable placeholder "—" + retry tại chính chip; hero/upcoming/suggested vẫn render. KHÔNG coerce 0đ, KHÔNG toast toàn trang | `t("Chưa xem được số tiền còn nợ. Thử lại.", "Can't show your outstanding amount. Try again.")` |
| 200 | section `null` + `reason='UNAVAILABLE'` (upcoming · suggested · unread — tên field reason ngoài `debtReason` chưa được BE pin) | **Per-section** — chỉ section đó thành unavailable placeholder + retry; các section khác giữ nguyên. Không render Empty, không suy 0 | `t("Chưa xem được mục này. Thử lại.", "Can't show this section. Try again.")` |
| 401 | `AUTH_REQUIRED` | Về login + clear person-self data khỏi view; không giữ chips/hero/upcoming snapshot cũ | `t("Cần đăng nhập", "Please sign in")` |
| 429 | `RATE_LIMITED` | Chặn refetch/pull-to-refresh tạm + retry sau; unavailable placeholder, không render person-self snapshot cũ | `t("Quá nhiều yêu cầu — thử lại sau", "Too many requests — try again shortly")` |
| — | *(unknown / missing / timeout)* | **Fail closed** — toàn aggregate fail: toast "Không tải được trang chủ" + retry; không render person-self snapshot cũ, không coerce chip nợ về 0 | `t("Không tải được trang chủ. Thử lại.", "Couldn't load Home. Try again.")` |

> **Error mapping:** Pin server error/status → exact visible state. Unknown/missing response fail closed;
> không invent success, zero, empty hoặc disabled control. Nếu BE chưa pin catalog cho một endpoint,
> ghi `UNPINNED error catalog — omit active UI` thay vì bịa mã.

#### Responsive

| Breakpoint | Home |
|---|---|
| 1440px | Trên ngưỡng `≥1024px` của wireframe desktop: header [Avatar] + lời chào + 💬 🔔 một hàng; hai chip nằm ngang dưới header; thân chia 2 cột — cột trái xếp dọc HERO card rồi "KÈO SẮP TỚI" + [Tất cả →], cột phải là "KÈO GỢI Ý" + [Xem tất cả →]; không có bottom nav |
| 768px | Dưới ngưỡng `≥1024px` nên không dùng bố cục 2 cột. File chỉ pin hai hình thức — mobile-first 375px và desktop `≥1024px` — và **không pin** form riêng cho dải 768–1024px; không tự đặt số, không tự dựng biến thể trung gian |
| 375px | Composition chính (mobile-first, §7): một cột — header · 2 chip cạnh nhau · HERO card gradient + sport glow · "KÈO SẮP TỚI" (tối đa 4 row compact 44px) · "KÈO GỢI Ý" · bottom nav; hero + chips + upcoming vừa 1 màn, không scroll cho nội dung chính (§7); suggested lazy-load dưới fold (§7). Baseline omit không đổi theo breakpoint — toàn bộ §6 là `UNPINNED` (fence §1) nên chips, hero, upcoming và suggested đều omit hoặc render unavailable placeholder ở mọi kích thước; `unknown` hiện "—" + retry tại chính chip/section, không coerce về 0 và không fail-open |

---

### Bottom Nav

| Slot | Tab | Icon | Route |
|---|---|---|---|
| 1 | Home | 🏠 | `/` |
| 2 | Khám phá | 🔍 (FAB, raised) | `/discover` |
| 3 | Club | 🏸 | `/me/clubs` |
| 4 | Setting | ⚙️ | `/me/settings` |

> Feed tab (📰) = config OFF phase-1. Slot reserved, không render tab chết.

#### Responsive

| Breakpoint | Bottom Nav |
|---|---|
| 1440px | Wireframe desktop `≥1024px` **không vẽ** bottom nav — surface này absent ở breakpoint đó; điều hướng còn lại nằm ở header (avatar · 💬 · 🔔). File không pin bất kỳ thay thế nào khác cho desktop, không tự dựng |
| 768px | Không pin. File chỉ vẽ bottom nav trong layout mobile 375px và bỏ hẳn nó ở desktop `≥1024px`, không pin ngưỡng chuyển giữa hai hình thức — không tự đặt số |
| 375px | 4 tab cố định đáy màn theo đúng thứ tự slot: 🏠 Home · 🔍 Khám phá (FAB center, raised 8px + ripple, §7) · 🏸 Club · ⚙️ Setting; active tab highlighted. Slot Feed (📰) reserved vì config OFF phase-1 — **không render tab chết** ở mọi breakpoint |

---

## 4. Components Used

| Component | States | Mô tả |
|---|---|---|
| `HeroCard` | loading (skeleton), ready (gradient + glow), empty, countdown | Kèo kế tiếp — gradient bg, sport glow effect, role badge; tap card tới session detail |
| `FinanceChips` | loading, ready (value), error (dash), zero (proven green) | 2 chips: nợ + kèo tuần. Tap navigable |
| `UpcomingList` | loading, ready, empty | Max 4 rows compact. "Tất cả →" link |
| `UpcomingRow` | default, payment dot (🔴 `open`, ⚠️ `partial`), unavailable (— khi `unknown`) | Row: sport icon + name + role badge + canonical payment status. **Union chỉ hai giá trị** — `"open" \| "partial"` (`BE/feature_player_view_tech.md:184`); **không có state `paid`**, player_view v2.7 cố ý để paid/void/left-club ledger history ngoài `SelfPaymentStatus`. `unknown` phải hiện unavailable/retry, không fail-open thành 0 |
| `SuggestedSection` | loading, ready, empty | Kèo gợi ý từ marketplace (public whitelist) |
| `BottomNav` | 4 tabs, active highlighted, FAB center | Config-driven tab bar |
| `OnboardingChecklist` | progress bar + items | Replace chips khi user mới |
| `OfflineBanner` | visible, hidden | "Không có kết nối" banner |

---

## 5. Edge Cases (UX)

| # | Case | Hiển thị |
|---|---|---|
| 1 | User vừa host vừa player cùng session | 1 entry, role badge "Host" ưu tiên |
| 2 | Nhiều kèo cùng giờ | Sort: host trước → time ASC. Max 4 + "Tất cả →" |
| 3 | Payment truth unknown | Chip nợ: "—" (dash) + retry. KHÔNG hiện 0 |
| 4 | Session bị hủy khi đang xem | SSE update + toast. Card biến mất, sau đó **refetch aggregate từ server**. FE **không** recalc chips — `feature_home.md:26` chốt "Home KHÔNG tự tính tiền phía client/server"; trong lúc chờ response, chip giữ trạng thái unavailable chứ không tự trừ |
| 5 | Charge settled realtime | SSE → **refetch aggregate**; chip nợ và payment dot render lại theo giá trị server trả. Dot **không** chuyển sang 🟢: union canonical chỉ `open \| partial`, không có `paid` (`BE/feature_player_view_tech.md:184`). Khoản đã tất toán rời khỏi `SelfPaymentStatus`, dot hiện `—` |
| 6 | Hero card kèo expired | Next hero auto-select. Nếu không có → empty hero |
| 7 | Nhiều CLB (>5) | Chips aggregate tổng. List vẫn hiện per-session (không chọn CLB trước) |
| 8 | Feed tab DD-76 chưa clear | Slot reserved, tab KHÔNG render. 4 tabs hiện |
| 9 | Token expired khi đang xem | Auto-refresh. Fail → về login (clear personal data from view) |
| 10 | Pull-to-refresh | Refresh aggregate + SSE reconnect |

---

## 6. Data hiển thị

| Field | Exact response path | Format | i18n `t(vi, en)` | Ghi chú |
|---|---|---|---|---|
| Greeting | `UNPINNED person display-name projection — omit` | "Xin chào 👋 {tên}" | `t("Xin chào 👋", "Hi 👋")`; {tên}: `data — no copy` | Không lấy tên từ fixture hoặc auth token tùy ý |
| Debt total | `UNPINNED Home DTO — omit active UI` | "85.000₫" | Label `t("Còn nợ", "Outstanding")`; số tiền: `data — no copy` | Candidate fields ở BE §3 là minh hoạ; chỉ render sau build-slice pin và khi kind `known_amount` |
| Sessions week | `UNPINNED Home DTO — omit active UI` | "3" | Label `t("Kèo tuần này", "Sessions this week")`; value: `data — no copy` | BE §3 hiện là DTO minh hoạ, chưa phải implementation pin |
| Hero session | `UNPINNED Home DTO — omit active UI` | Sport + CLB + date/time | Label `t("Kèo kế tiếp", "Next session")`; sport·CLB·thời gian: `data — no copy` | Không có capacity; không tự join với public projection |
| Hero action | No response field — card navigation only | Tap whole card | Accessible label `t("Mở buổi chơi", "Open session")` | Không render payment/management CTA |
| Upcoming time | `UNPINNED Home DTO — omit active UI` | "CN 08:00" | N/A — locale formatter | Day-of-week short + time |
| Role badge (hero + upcoming row) | `UNPINNED Home DTO — omit active UI` | Badge | `t("Player", "Player")` · `t("Host", "Host")` | Candidate field `upcoming[].role` ở BE §3 là DTO minh hoạ, chưa phải implementation pin. Không suy role từ route/token/tenant context; dedupe host-ưu-tiên do server làm (§5 case 1) |
| Payment dot (upcoming row) | `UNPINNED Home DTO — omit active UI` | Dot: 🔴 `open` · ⚠️ `partial` · "—" khi `unknown` | Accessible label `t("Còn nợ", "Outstanding")` · `t("Trả một phần", "Partially paid")` · `t("Chưa xem được", "Can't show this")` | Candidate field `upcoming[].paymentStatus` ở BE §3 là DTO minh hoạ. **Union chỉ hai giá trị** — `"open" \| "partial"` (`BE/feature_player_view_tech.md:184`), **không có state `paid`**; `unknown` phải hiện unavailable/retry, không fail-open thành 0 |
| Unread indicator (🔔 header) | `UNPINNED Home DTO — omit active UI` | Dot ● hoặc badge count | Accessible label `t("Thông báo chưa đọc", "Unread notifications")`; số: `data — no copy` | Candidate field `unreadNotifications` ở BE §3 là DTO minh hoạ. Baseline omit indicator — không render ● khi chưa chứng minh được có unread, không render 0 |
| Suggested | `UNPINNED Home composition DTO — omit active UI` | Sport + area + scalar price + `slotsOpen` | Label `t("Kèo gợi ý", "Suggested sessions")`; sport·khu vực·giá·`slotsOpen`: `data — no copy` | Public source whitelist only; composition response path vẫn cần build-slice pin |

> **i18n:** Mọi chuỗi user-facing ở file này đi qua `t(vi, en)` (`packages/core/src/i18n.ts`). Repo không có key-based i18n; cặp vi/en ở cột trên là chuỗi thật, không phải key.

---

## 7. Responsive & Interaction Notes

- **Mobile-first:** Hero + chips + upcoming fit 1 screen (no scroll for main content)
- **Hero card:** Gradient bg using sport-themed colors (badminton=green, football=blue). Glow effect CSS `box-shadow` + `backdrop-filter`. Animated entrance (scale up from 0.95)
- **Chips:** Tap → navigate. Count-up animation chưa được implement/author tới khi owner contract tồn tại (§6 chips là `UNPINNED`). Red/green semantic colors for debt
- **Upcoming rows:** Compact (44px height). Payment dot pulsing animation khi có nợ mới
- **Bottom Nav FAB:** Center tab raised 8px. Ripple effect on tap. Badge count trên 🔔 (header)
- **SSE:** Subscribe khi mount. Auto-reconnect. Update chips + rows realtime
- **Pull-to-refresh:** Native PWA gesture. Refresh indicator
- **Dark mode:** Hero gradient dark variant. Chips `var(--bg-card)`. Text `var(--text-primary)`
- **Performance:** Above-fold content renders first. Suggested section lazy loaded

---

_FE Design Spec v0.4 · 2026-07-31 · Source: feature_home.md v0.10 + DD-79_
