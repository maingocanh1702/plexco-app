# Feature: Host Dashboard — FE Design Spec

> **Route(s):** `/dashboard`
> **Source authority:** `../../../features/feature_session_management.md` v2.17 + `../../../features/feature_payment_reconcile.md` v1.10 + `../../../features/feature_notifications_reminders.md` v3.11 · baseline `0c5808fc7cf50d139bdd9c4ee79917bf4059c4f4`
> **Source contract status:** Reviewed source contracts; dashboard aggregate DTO chưa có authority
> **Projection/API contract:** `UNPINNED` — aggregate/projection zones omitted
> **Capability/availability:** Server-authorized tenant shell/navigation only
> **Priority:** 3 — designer-kickoff.md §3B
> **FE design status:** Draft shell
> **Runtime status:** Not started — không có dashboard route/API/UI
> **Negative scope:** Không render revenue/trend/member/debt/activity aggregate tới khi có Reviewed DTO owner

---

## 1. Mô tả

Trang tổng quan cho host sau đăng nhập. Baseline hiện chỉ authorizes page shell, navigation và CTA "Tạo buổi mới". Các aggregate của 4-zone concept — revenue/trend/member/session/debt/activity — chưa có Reviewed owner DTO, nên wireframe bên dưới là visual fixture cho composition, không phải data hoặc interaction contract.

---

## 2. User Flows

### Flow 1: Xem tổng quan

1. Host đăng nhập → server-authorized redirect `/dashboard`
2. FE render dashboard shell, sidebar và CTA "Tạo buổi mới"
3. Zone 1–4 bị omit hoặc dùng neutral unavailable placeholder tới khi exact DTO/owner contract được Reviewed

### Flow 2: Quick actions từ dashboard

1. Click "Tạo buổi mới" → redirect `/dashboard/sessions/new`
2. Session/debt/activity rows chưa có interaction contract nên không clickable
3. Notification chỉ được navigate khi future contract trả opaque authorized target; FE không suy route từ aggregate payload

---

## 3. Screens & States

### `/dashboard` — Host Dashboard (4-Zone Layout)

> **Visual fixture only:** Các số, tên, tỷ lệ, debt rows và activity copy trong wireframe chỉ kiểm tra hierarchy/spacing. Implementation hiện tại phải omit Zone 1/3/4 và Zone 2 data, hoặc render một neutral unavailable placeholder. Không dùng fixture làm seed/default/fallback. Session/activity notification projection còn deferred bởi `NTF-OQ-18`.

#### Layout (Desktop 1440px)

```
┌──────────┬──────────────────────────────────────────────────┐
│          │  Header: "Dashboard" · Notifications 🔔(3)       │
│          │                        · [+ Tạo buổi mới]       │
│ Sidebar  ├──────────────────────────────────────────────────┤
│          │                                                  │
│ 📊 Tổng  │  Zone 1: Stat Cards (4 cards, 1 row)            │
│    quan  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────┐│
│          │  │ 💰 DT    │ │ 🏸 Kèo  │ │ 👥 TV   │ │ 📋 Nợ││
│ 📅 Buổi  │  │ tháng    │ │ tháng    │ │ active   │ │ chưa ││
│    chơi  │  │ 12.5tr ↑ │ │ 24   ↑  │ │ 48       │ │ thu  ││
│          │  │ +22%     │ │ +12%    │ │          │ │ 3.2tr││
│ 💰 Thanh │  └──────────┘ └──────────┘ └──────────┘ └──────┘│
│    toán  │                                                  │
│          │  ⚠️ OWNER CONTRACT PENDING:                      │
│          │  Stat card values hiện là placeholder.            │
│          │  Product/BE cần define:                           │
│          │  - DTO fields (exact response shape)              │
│          │  - Calculation formula (gross vs net, reversal)   │
│          │  - Timezone (UTC vs local, period boundaries)     │
│          │  - Reversal semantics (DT tháng trừ reversal?)   │
│          │  Designer dùng layout này, giá trị thay đổi.     │
│          │  ┌────────────────────────┬──────────────────────┤
│ 👥 Thành │  │                        │                      │
│    viên  │  │  Zone 2: Kèo sắp tới  │  Zone 3: Tiền chưa  │
│          │  │  (session cards list)   │  thu (debt summary)  │
│ ⚙️ Cài   │  │                        │                      │
│    đặt   │  │  ┌──────────────────┐  │  ┌──────────────────┐│
│          │  │  │ 🏸 BM Thứ 5     │  │  │ Nguyễn A  150k   ││
│          │  │  │ 19:00 · 6/8 slot│  │  │ Trần B    200k   ││
│          │  │  │ Sân ABC · ✅ open│  │  │ Lê C       50k   ││
│          │  │  └──────────────────┘  │  │ ─────────────────││
│          │  │  ┌──────────────────┐  │  │ Tổng: 3.2tr      ││
│          │  │  │ ⚽ Bóng đá CN    │  │  │                  ││
│          │  │  │ 08:00 · 12/20   │  │  │ [Xem tất cả →]   ││
│          │  │  │ Sân XYZ · draft │  │  └──────────────────┘│
│          │  │  └──────────────────┘  │                      │
│          │  │                        │  Zone 4: Hoạt động   │
│          │  │  [Xem tất cả →]       │  gần đây             │
│          │  │                        │  ┌──────────────────┐│
│          │  │                        │  │ 🔔 3 thông báo   ││
│          │  │                        │  │ • A đã trả 150k  ││
│          │  │                        │  │ • B join kèo T5  ││
│          │  │                        │  │ • Kèo CN sắp bắt ││
│          │  │                        │  │   đầu (2h nữa)   ││
│          │  │                        │  └──────────────────┘│
│          │  └────────────────────────┴──────────────────────┤
└──────────┴──────────────────────────────────────────────────┘
```

#### Layout (Mobile 375px)

```
┌──────────────────────┐
│ ☰  Dashboard  🔔(3)  │
├──────────────────────┤
│ Stat Cards (2×2)     │
│ ┌────────┐ ┌────────┐│
│ │💰 12.5tr│ │🏸 24   ││
│ └────────┘ └────────┘│
│ ┌────────┐ ┌────────┐│
│ │👥 48   │ │📋 3.2tr││
│ └────────┘ └────────┘│
├──────────────────────┤
│ [+ Tạo buổi mới]    │
├──────────────────────┤
│ Kèo sắp tới         │
│ ┌──────────────────┐ │
│ │ 🏸 BM Thứ 5     │ │
│ │ 19:00 · 6/8 slot │ │
│ └──────────────────┘ │
│ ┌──────────────────┐ │
│ │ ⚽ Bóng đá CN    │ │
│ │ 08:00 · 12/20    │ │
│ └──────────────────┘ │
│ [Xem tất cả →]      │
├──────────────────────┤
│ Tiền chưa thu        │
│ Nguyễn A    150k     │
│ Trần B      200k     │
│ [Xem tất cả →]      │
├──────────────────────┤
│ 🔔 Hoạt động gần đây │
│ • A đã trả 150k      │
│ • B join kèo T5      │
├──────────────────────┤
│ 🏠  📅  💰  👥  ⚙️  │
│ (Bottom Nav)          │
└──────────────────────┘
```

#### States

- **Loading:** Shell/navigation loading only; không dựng skeleton aggregate chưa có contract
- **Ready:** Shell + authorized navigation + CTA "Tạo buổi mới"
- **Unavailable:** Omit Zone 1–4 hoặc hiện neutral "Tổng quan chi tiết chưa khả dụng"; không render 0 vì 0 là một business assertion
- **Error:** Shell-level error + retry; future per-zone behavior phải theo DTO contract tương ứng

#### Error mapping

| Status | Error code | Visible state | i18n `t(vi, en)` |
|---|---|---|---|
| 403 | `TENANT_CONTEXT_REQUIRED` | Shell không render tenant data; chuyển sang server-authorized club selection/recovery flow, FE không đoán club | `t("Cần chọn club để tiếp tục", "Choose a club to continue")` |
| 403 | `NOT_TENANT_ADMIN` | Dashboard không render; redirect theo server-authorized flow, không hiện shell rỗng kèm zone placeholder | `t("Bạn không có quyền admin của club này", "You don't have admin access to this club")` |
| 403 | `TENANT_SUSPENDED` | Banner shell-level; navigation read-only và CTA "Tạo buổi mới" absent, không render disabled control | `t("Club đang tạm ngưng", "This club is suspended")` |
| 403 | `CAPABILITY_DENIED` | Omit đúng navigation item/CTA bị từ chối; không suy quyền ở client, không render control disabled | `t("Bạn không có quyền thực hiện thao tác này", "You don't have permission for this action")` |
| — | `UNPINNED error catalog — omit active UI` | Zone 1–4 aggregate (revenue/session/member/debt/activity): không fetch, không render error surface — zone absent hoặc neutral unavailable placeholder | `N/A — surface omitted` |
| — | *(unknown / missing / timeout)* | **Fail closed** — unavailable placeholder + retry; shell giữ navigation, không render aggregate, không render 0 và không giữ stale snapshot | `t("Không tải được trang tổng quan. Thử lại.", "Couldn't load the dashboard. Try again.")` |

> **Error mapping:** Pin server error/status → exact visible state. Unknown/missing response fail closed;
> không invent success, zero, empty hoặc disabled control. Nếu BE chưa pin catalog cho một endpoint,
> ghi `UNPINNED error catalog — omit active UI` thay vì bịa mã.

#### Responsive

| Breakpoint | Host Dashboard |
|---|---|
| 1440px | Sidebar fixed 240px full label (§3 *Sidebar*: >1024px); header "Dashboard" + 🔔 + [+ Tạo buổi mới] trên cùng; Zone 1 = 4 stat card một hàng (§7); Zone 2 và Zone 3/4 chia 2 cột 60/40 (§7) |
| 768px | Sidebar ẩn + hamburger ☰ overlay (§3 *Sidebar*: ≤768px hidden); Zone 1 vẫn 4 card một hàng nhưng thu nhỏ, Zone 2+3 vẫn 2 cột (§7 "Tablet"). Bottom nav chỉ được pin cho mobile (§4 `BottomNav`, §7) và file **không pin** ngưỡng bật nó — không tự đặt số |
| 375px | Sidebar ẩn + hamburger; header ☰ · Dashboard · 🔔; Zone 1 = grid 2×2 (§7); CTA [+ Tạo buổi mới] full width ngay dưới stat cards; Zone 2 → 3 → 4 xếp dọc một cột (§7); bottom nav 5 tab (Dashboard · Buổi chơi · Thanh toán · Thành viên · Cài đặt). Baseline omit không đổi theo breakpoint — Zone 1–4 aggregate chưa có Reviewed DTO owner nên omit hoặc hiện neutral "Tổng quan chi tiết chưa khả dụng" ở mọi kích thước; không render 0 vì 0 là một business assertion, và badge count trên 🔔 / sidebar item vẫn omit |

---

### Sidebar — Host Navigation

> **Visual fixture only:** `{CLB name}`, `Host Name` và `(badge: 2 mới)` trong wireframe chỉ kiểm tra hierarchy/spacing. Baseline chỉ render nav item và tenant shell data mà server đã authorize; **badge count phải omit** — count aggregate chưa có DTO owner (xem §6), không render 0, không suy từ cache/route. Không dùng fixture làm seed/default/fallback.

#### Layout

```
┌──────────────────┐
│  🟠 plexco       │
│  {CLB name}      │
├──────────────────┤
│  Tổng quan       │
│                  │
│  📊 Dashboard    │  ← active: brand bg
│                  │
│  Quản lý         │
│                  │
│  📅 Buổi chơi   │  (badge: 2 mới)
│  💰 Thanh toán   │
│  👥 Thành viên   │
│                  │
│  Hệ thống       │
│                  │
│  ⚙️ Cài đặt      │
├──────────────────┤
│  👤 Host Name    │
│  [Đăng xuất]     │
└──────────────────┘
```

#### Error mapping

| Status | Error code | Visible state | i18n `t(vi, en)` |
|---|---|---|---|
| 403 | `TENANT_CONTEXT_REQUIRED` | Sidebar không render CLB name/nav item của tenant; chuyển sang server-authorized club selection flow | `t("Cần chọn club để tiếp tục", "Choose a club to continue")` |
| 403 | `CAPABILITY_DENIED` | Omit đúng item bị từ chối khỏi nav; không render item disabled và không suy quyền từ route | `t("Bạn không có quyền thực hiện thao tác này", "You don't have permission for this action")` |
| 403 | `TENANT_SUSPENDED` | Nav còn read-only item; CTA/mutation entry point absent | `t("Club đang tạm ngưng", "This club is suspended")` |
| — | *(unknown / missing / timeout)* | **Fail closed** — nav rút về item server đã authorize + retry; không render badge count, không suy nav từ cache | `t("Không tải được điều hướng. Thử lại.", "Couldn't load navigation. Try again.")` |

> **Error mapping:** Pin server error/status → exact visible state. Unknown/missing response fail closed;
> không invent success, zero, empty hoặc disabled control. Nếu BE chưa pin catalog cho một endpoint,
> ghi `UNPINNED error catalog — omit active UI` thay vì bịa mã.

#### Responsive

| Breakpoint | Sidebar |
|---|---|
| >1024px | Fixed 240px, full labels |
| ≤1024px, >768px | Collapsed 64px, icon-only, hover tooltip |
| ≤768px | Hidden + hamburger ☰ top-left, overlay khi mở |

---

## 4. Components Used

| Component | States | Mô tả |
|---|---|---|
| `StatCard` | design-only pending owner contract | Không implement cho tới khi exact aggregate DTO/formula/timezone/reversal semantics được Reviewed |
| `SparklineMini` | design-only pending owner contract | Không derive trend client-side |
| `SessionCard` | design-only pending owner contract | Dashboard projection riêng chưa được pin; session detail/list contract không tự authorize projection này |
| `StatusBadge` | draft (gray), open (green), closed (blue), cancelled (red) | Badge trạng thái kèo |
| `DebtItem` | design-only pending owner contract | Không clickable; aggregate không đủ chứng minh một session target |
| `NotificationItem` | design-only pending owner contract | Navigate chỉ bằng opaque authorized target; session/activity projection deferred `NTF-OQ-18` |
| `Sidebar` | expanded, collapsed, overlay (mobile) | Navigation sidebar — groups + items + badges |
| `SidebarItem` | default, hover, active (brand bg); badge: design-only pending owner contract | Menu item — icon + label. Nav item được authorize; **badge count thì không** — chưa có DTO owner nên baseline omit badge, không render 0 |
| `QuickActionButton` | default, hover | "Tạo buổi mới" — primary CTA |
| `SectionHeader` | default | Zone title + "Xem tất cả →" link |
| `BottomNav` | mobile only, 5 tabs | Mobile bottom navigation bar |

---

## 5. Edge Cases (UX)

| # | Case | Hiển thị |
|---|---|---|
| 1 | CLB mới hoặc aggregate DTO chưa available | Shell + CTA "Tạo buổi đầu tiên"; không suy mọi aggregate = 0 |
| 2 | Bất kỳ aggregate/projection owner nào chưa pin DTO | Omit zone tương ứng hoặc neutral unavailable; không derive, sort, paginate, format hay navigate từ fixture |
| 3 | Shell/navigation request lỗi hoặc offline | Generic error/banner + retry; không giữ stale aggregate snapshot |
| 4 | Capability/tenant context không chứng minh được | Fail closed: không render action/tenant data, chuyển sang server-authorized recovery/login flow |

---

## 6. Data hiển thị

| Field | Exact response path | Format | i18n `t(vi, en)` | Ghi chú |
|---|---|---|---|---|
| Revenue/session/member/debt/trend | `UNPINNED — omit active UI` | N/A | N/A — no authorized copy | Unowned aggregate; wait for exact DTO + formula + timezone + reversal semantics |
| Upcoming session projection | `UNPINNED — omit active UI` | N/A | N/A — no authorized copy | Wait for exact DTO and route target |
| Notification/activity projection | `UNPINNED — omit active UI` | N/A | N/A — no authorized copy | Deferred `NTF-OQ-18`; future opaque source ref/target only |

#### Shell copy (i18n)

Chuỗi static do file này authorize (shell + navigation + CTA). Không có response path — đây là copy, không phải DTO field.

| Chuỗi (vị trí) | i18n `t(vi, en)` |
|---|---|
| Header title "Dashboard" (§3 desktop layout) | `t("Tổng quan", "Dashboard")` |
| CTA "Tạo buổi mới" (§2 Flow 2, §3 desktop + mobile layout, §3 Ready state) | `t("Tạo buổi mới", "New session")` |
| Unavailable placeholder "Tổng quan chi tiết chưa khả dụng" (§3 Unavailable state) | `t("Tổng quan chi tiết chưa khả dụng", "Detailed overview isn't available yet")` |
| Empty-state CTA "Tạo buổi đầu tiên" (§5 edge case 1) | `t("Tạo buổi đầu tiên", "Create your first session")` |
| Sidebar group "Tổng quan" | `t("Tổng quan", "Overview")` |
| Sidebar item "Dashboard" | `t("Tổng quan", "Dashboard")` |
| Sidebar group "Quản lý" | `t("Quản lý", "Manage")` |
| Sidebar item "Buổi chơi" (cũng là Bottom Nav item) | `t("Buổi chơi", "Sessions")` |
| Sidebar item "Thanh toán" (cũng là Bottom Nav item) | `t("Thanh toán", "Payments")` |
| Sidebar item "Thành viên" (cũng là Bottom Nav item) | `t("Thành viên", "Members")` |
| Sidebar group "Hệ thống" | `t("Hệ thống", "System")` |
| Sidebar item "Cài đặt" (cũng là Bottom Nav item) | `t("Cài đặt", "Settings")` |
| Sidebar footer "Đăng xuất" | `t("Đăng xuất", "Log out")` |
| Sidebar `{CLB name}` · footer `Host Name` | `data — no copy` |
| Sidebar badge "2 mới" · header "Notifications 🔔(3)" | `N/A — surface omitted`; count chưa có DTO owner |

> **i18n:** Mọi chuỗi user-facing ở file này đi qua `t(vi, en)` (`packages/core/src/i18n.ts`). Repo không có key-based i18n; cặp vi/en ở cột trên là chuỗi thật, không phải key.

---

## 7. Responsive & Interaction Notes

- **Stat cards:** Desktop = 4 cards 1 row. Tablet = 4 cards 1 row (smaller). Mobile = 2×2 grid
- **Zones 2+3:** Desktop = 2 columns (60/40). Tablet = 2 columns. Mobile = stacked single column
- **Aggregate motion:** Count-up, sparkline, hover navigation và notification pulse chưa được implement/author tới khi owner contract tồn tại
- **Refresh:** Shell không tự poll aggregate chưa có contract
- **Dark mode:** Stat card bg `var(--bg-card)`, text `var(--text-primary)`, trend colors: green `var(--success)`, red `var(--error)`
- **Sidebar IDs:** `#sidebar`, `#sidebar-backdrop`, `#menu-toggle` (bắt buộc theo user rules)
- **Bottom Nav (mobile):** 5 items: Dashboard, Buổi chơi, Thanh toán, Thành viên, Cài đặt. Active item: brand color fill

---

_FE Design Spec v0.2 · 2026-07-31 · Source: session v2.17 + payment v1.10 + notifications v3.11_
