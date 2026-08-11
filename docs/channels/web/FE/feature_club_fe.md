# Feature: Club — FE Design Spec

> **Route(s):** `/me/clubs` · `/clubs/:tenantId` · `/clubs/:tenantId/settings`
> **Source authority:** `../../../features/FE/feature_club.md` v1.0 · baseline `0c5808fc7cf50d139bdd9c4ee79917bf4059c4f4`
> **Source contract status:** Draft — Club tab, News/Announcement, pin post, settings
> **Projection/API contract:** `GET /api/me/clubs` (person-self memberships); club detail, news, settings per-tenant
> **Capability/availability:** Person-self data (Club list) + tenant-scoped data (Club detail sub-features); server-authorized role context
> **Priority:** — bottom nav slot #4, sau core Session/Payment
> **FE design status:** Draft
> **Runtime status:** Not started — Club tab/routes/UI chưa build
> **Negative scope:** Members CRUD → `feature_members_fe.md`; Sessions → `feature_sessions_fe.md`; Chat → `feature_chat_fe.md`; Tạo CLB → `feature_onboarding_fe.md`

---

## 1. Mô tả

Tab CLB trong bottom navigation (slot #4) hiển thị tất cả CLB của user: CLB user tạo/sở hữu (owner/admin) và CLB user tham gia (member/guest). Mỗi CLB là một hub chứa sub-features: Tin tức (News/Announcement), Kèo (Sessions), Thành viên (Members), Chat. Host/Admin có thêm Settings và quyền pin post trong News.

---

## 2. User Flows

### Flow 1: Xem danh sách CLB

1. User tap tab "CLB" trên bottom nav
2. Load danh sách CLB từ person-self memberships
3. Phân nhóm: "CLB tôi quản lý" (owner/admin) + "CLB tôi tham gia" (member/guest)
4. Tap 1 CLB → mở Club Detail

### Flow 2: Xem chi tiết CLB

1. Tap vào 1 CLB → `/clubs/:tenantId`
2. Thấy hero banner + sub-tab bar: Tin tức | Kèo | Thành viên | Chat
3. Role context quyết định UI: owner/admin thấy icon ⚙️ Settings

### Flow 3: Đăng bài + Pin post (host/admin)

1. Trong tab Tin tức → tap "Đăng bài mới"
2. Viết nội dung → submit → post hiển thị trong feed
3. Long-press / ⋮ menu trên post → "📌 Ghim lên đầu"
4. Post mới pin → post cũ tự unpin (chỉ 1 pinned/channel)

### Flow 4: Cài đặt CLB (host/admin)

1. Tap ⚙️ → mở Settings
2. Sửa tên, avatar, sport type, notification preferences
3. Danger zone: Tạm dừng CLB / Xóa CLB (owner only)

---

## 3. Screens & States

### Club List — `/me/clubs` (Bottom Nav slot #4)

> **Visual fixture only:** Tên CLB, member count, session frequency trong wireframe chỉ kiểm tra hierarchy/spacing — không phải API contract.

#### Layout (Desktop 1440px)

```
┌──────────┬──────────────────────────────────────────────────────┐
│          │  Header: "CLB của tôi"                    🔍 [Search]│
│ Sidebar  ├──────────────────────────────────────────────────────┤
│          │                                                      │
│          │  CLB tôi quản lý (2)                    section header│
│          │  ─────────────────────────────────────────────────── │
│          │  ┌────────────────────────────────────────────────┐  │
│          │  │ [🏸] CLB Cầu lông BT         👑 Owner        │  │
│          │  │      12 thành viên · 3 kèo tuần              │  │
│          │  ├────────────────────────────────────────────────┤  │
│          │  │ [⚽] FC Thủ Đức               🛡 Admin        │  │
│          │  │      8 thành viên · 1 kèo tuần               │  │
│          │  └────────────────────────────────────────────────┘  │
│          │                                                      │
│          │  CLB tôi tham gia (3)                                │
│          │  ─────────────────────────────────────────────────── │
│          │  ┌────────────────────────────────────────────────┐  │
│          │  │ [🏸] BK Badminton             Member          │  │
│          │  │      20 thành viên                            │  │
│          │  ├────────────────────────────────────────────────┤  │
│          │  │ [🎾] Tennis Q7                 Member          │  │
│          │  │      15 thành viên                            │  │
│          │  └────────────────────────────────────────────────┘  │
│          │                                                      │
│          │            [+ Tạo CLB mới]                           │
│          │                                                      │
└──────────┴──────────────────────────────────────────────────────┘
```

#### Layout (Mobile 375px)

```
┌──────────────────────────┐
│ ← Home      🏸 CLB của tôi│
├──────────────────────────┤
│                           │
│ CLB tôi quản lý (2)      │
│ ────────────────────────  │
│ [🏸] CLB Cầu lông BT     │
│      12 TV · 3 kèo  👑   │
│ ────────────────────────  │
│ [⚽] FC Thủ Đức           │
│      8 TV · 1 kèo   🛡   │
│                           │
│ CLB tôi tham gia (3)     │
│ ────────────────────────  │
│ [🏸] BK Badminton  Member│
│      20 thành viên        │
│ ────────────────────────  │
│ [🎾] Tennis Q7    Member  │
│ ────────────────────────  │
│ [🏸] SG Shuttle   Guest  │
│                           │
│     [+ Tạo CLB mới]      │
│                           │
├──────────────────────────┤
│ 🏠  🔍  🏸  ⚙️           │
│ (Bottom Nav, slot #4 ✓)  │
└──────────────────────────┘
```

#### States

- **Loading:** Skeleton: 2 section header skeletons + 4 club row skeletons (each = icon circle 40px + 2 text lines pulsing + role badge placeholder). CTA skeleton block at bottom
- **Ready:** Clubs grouped by role: "CLB tôi quản lý" + "CLB tôi tham gia". Each row: sport icon + name + role badge + member count + session frequency
- **Empty:** Illustration 🏸 + `t("Chưa có CLB nào", "No clubs yet")` + `t("Tìm và tham gia CLB hoặc tạo CLB mới", "Find and join a club or create your own")` + CTA "Tìm CLB" (→ marketplace) + CTA "Tạo CLB mới"
- **Error:** Error banner + retry CTA: `t("Không tải được danh sách CLB. Thử lại.", "Couldn't load your clubs. Try again.")`

#### Error mapping

| Status | Error code | Visible state | i18n `t(vi, en)` |
|---|---|---|---|
| 401 | `UNAUTHENTICATED` | Redirect login | `t("Đăng nhập để xem CLB", "Log in to see your clubs")` |
| — | *(unknown / missing / timeout)* | **Fail closed** — error banner + retry; không render Empty | `t("Không tải được danh sách CLB. Thử lại.", "Couldn't load your clubs. Try again.")` |

#### Responsive

| Breakpoint | Club List |
|---|---|
| 1440px | Sidebar 240px + content area; club rows full width; CTA centered bottom |
| 768px | Sidebar hidden + hamburger; club rows full width; bottom nav hidden |
| 375px | Full mobile layout; club rows stacked; bottom nav visible (slot #4 active) |

---

### Club Detail — `/clubs/:tenantId` (Hub)

#### Layout (Desktop 1440px)

```
┌──────────┬──────────────────────────────────────────────────────┐
│          │  ← CLB của tôi        🏸 CLB Cầu lông BT    ⚙️     │
│ Sidebar  ├──────────────────────────────────────────────────────┤
│          │  ┌────────────────────────────────────────────────┐  │
│          │  │         [Club Banner / Avatar]                 │  │
│          │  │         12 thành viên · Cầu lông              │  │
│          │  └────────────────────────────────────────────────┘  │
│          ├──────────────────────────────────────────────────────┤
│          │  [📰 Tin tức] [📋 Kèo] [👥 Thành viên] [💬 Chat]  │
│          ├──────────────────────────────────────────────────────┤
│          │                                                      │
│          │     (Content area — switch by active tab)            │
│          │                                                      │
└──────────┴──────────────────────────────────────────────────────┘
```

#### Layout (Mobile 375px)

```
┌──────────────────────────┐
│ ← CLB của tôi    ⚙️      │
├──────────────────────────┤
│ ┌──────────────────────┐ │
│ │   [Club Banner]      │ │
│ │   🏸 CLB Cầu lông BT│ │
│ │   12 TV · Cầu lông  │ │
│ └──────────────────────┘ │
├──────────────────────────┤
│ [📰] [📋] [👥] [💬]    │  horizontal tab bar
├──────────────────────────┤
│                           │
│  (Content area)           │
│                           │
├──────────────────────────┤
│ 🏠  🔍  🏸  ⚙️           │
└──────────────────────────┘
```

#### States

- **Loading:** Hero banner skeleton (full-width rectangle 160px) + tab bar skeleton (4 tab placeholders) + content area skeleton
- **Ready:** Hero banner + club info + active tab content
- **Empty:** N/A — CLB luôn có ít nhất thông tin cơ bản (tên, sport)
- **Error:** Error banner dưới hero + retry: `t("Không tải được thông tin CLB. Thử lại.", "Couldn't load club info. Try again.")`

#### Error mapping

| Status | Error code | Visible state | i18n `t(vi, en)` |
|---|---|---|---|
| 403 | `NOT_A_MEMBER` | Redirect về Club list | `t("Bạn không phải thành viên CLB này", "You're not a member of this club")` |
| 404 | `CLUB_NOT_FOUND` | Redirect về Club list + toast | `t("CLB không tồn tại", "Club not found")` |
| 403 | `TENANT_SUSPENDED` | Banner suspended; read-only navigation | `t("CLB đang tạm ngưng", "This club is suspended")` |
| — | *(unknown / missing / timeout)* | **Fail closed** — error + retry | `t("Không tải được thông tin CLB. Thử lại.", "Couldn't load club info. Try again.")` |

#### Responsive

| Breakpoint | Club Detail |
|---|---|
| 1440px | Sidebar 240px + hero banner full content width + horizontal tab bar |
| 768px | Sidebar hidden; hero banner full width; tab bar scrollable |
| 375px | Mobile layout; hero compact; tab bar 4 icons + labels; bottom nav |

---

### News/Announcement Feed — tab trong Club Detail

#### Layout (Mobile 375px)

```
┌──────────────────────────────┐
│         📰 Tin tức CLB       │
├──────────────────────────────┤
│                               │
│ 📌 GHIM ────────────────────  │
│ ┌──────────────────────────┐ │
│ │ 👑 Anh T (Admin)  2 ngày │ │
│ │                          │ │
│ │ 🏸 Lịch tập tháng 8:    │ │
│ │ - T3/T5: 19h-21h sân BT │ │
│ │ - T7: 8h-10h PN         │ │
│ │                 📌 Đã ghim│ │
│ └──────────────────────────┘ │
│                               │
│ ────────────────────────────  │
│ ┌──────────────────────────┐ │
│ │ 👑 Anh T      30 phút   │ │
│ │                          │ │
│ │ Tối nay kèo bình thường │ │
│ │ nhé mọi người!          │ │
│ │                  👍 3    │ │
│ └──────────────────────────┘ │
│                               │
│ ┌──────────────────────────┐ │
│ │ 🛡 Minh (Admin) Hôm qua │ │
│ │                          │ │
│ │ Nhắc mọi người thanh    │ │
│ │ toán tháng 7 nhé!       │ │
│ └──────────────────────────┘ │
│                               │
├──────────────────────────────┤
│ (Host/Admin only)            │
│ [📝 Đăng bài mới...]       │
└──────────────────────────────┘
```

#### States

- **Loading:** Skeleton: 1 pinned card skeleton (highlighted bg) + 3 post card skeletons (each = avatar circle + 2 text lines + timestamp line)
- **Ready:** Pinned post (nếu có) section "📌 GHIM" ở top + timeline posts sorted by time DESC. Each post: author avatar + name + role badge + timestamp + body + reactions
- **Empty:** Icon 📰 + `t("Chưa có thông báo nào", "No announcements yet")` + (host/admin: CTA `t("Đăng bài đầu tiên", "Post your first announcement")`)
- **Error:** Inline error + retry: `t("Không tải được tin tức. Thử lại.", "Couldn't load announcements. Try again.")`

#### Error mapping

| Status | Error code | Visible state | i18n `t(vi, en)` |
|---|---|---|---|
| 403 | `CAPABILITY_DENIED` | Feed read-only; composer hidden | `t("Bạn không có quyền đăng bài", "You don't have posting permission")` |
| — | *(unknown / missing / timeout)* | **Fail closed** — error + retry | `t("Không tải được tin tức. Thử lại.", "Couldn't load announcements. Try again.")` |

#### Responsive

| Breakpoint | News Feed |
|---|---|
| 1440px | Post cards max-width 720px centered; composer pinned bottom |
| 768px | Post cards full width within content area |
| 375px | Post cards full width; composer slide-up (mobile keyboard) |

---

### Club Settings — `/clubs/:tenantId/settings` (Host/Admin only)

#### Layout (Mobile 375px)

```
┌──────────────────────────────┐
│ ← CLB Cầu lông BT  ⚙️ Cài đặt│
├──────────────────────────────┤
│                               │
│ Thông tin CLB                 │
│ ┌──────────────────────────┐ │
│ │ Tên CLB    CLB Cầu lông BT│ │
│ │ Môn        🏸 Cầu lông   │ │
│ │ Avatar     [Đổi ảnh]     │ │
│ │ Mô tả      ...           │ │
│ └──────────────────────────┘ │
│                               │
│ Thanh toán                    │
│ ┌──────────────────────────┐ │
│ │ Ngân hàng   Vietcombank  │ │
│ │ SePay       ✅ Kết nối   │ │
│ │ Auto-reconcile ⛔ Chưa bật│ │
│ └──────────────────────────┘ │
│                               │
│ Thông báo                     │
│ ┌──────────────────────────┐ │
│ │ Push khi có kèo mới [✅] │ │
│ │ Nhắc thanh toán    [✅] │ │
│ └──────────────────────────┘ │
│                               │
│ Danger Zone                   │
│ ┌──────────────────────────┐ │
│ │ [🔴 Tạm dừng CLB]       │ │
│ │ [🔴 Xóa CLB]  (owner)   │ │
│ └──────────────────────────┘ │
│                               │
└──────────────────────────────┘
```

#### States

- **Loading:** Skeleton form fields (4 sections: each = section title + 3 row skeletons)
- **Ready:** Form pre-filled with current tenant config
- **Empty:** N/A — settings luôn có data từ tenant config
- **Error:** Inline error per field + toast cho save failure: `t("Không lưu được cài đặt. Thử lại.", "Couldn't save settings. Try again.")`

#### Error mapping

| Status | Error code | Visible state | i18n `t(vi, en)` |
|---|---|---|---|
| 403 | `NOT_TENANT_ADMIN` | Redirect về Club detail; settings route không render | `t("Bạn không có quyền cài đặt CLB", "You don't have settings access")` |
| 400 | `VALIDATION_ERROR` | Inline error dưới field lỗi | `t("Vui lòng kiểm tra lại thông tin", "Please check the information")` |
| — | *(unknown / missing / timeout)* | **Fail closed** — toast + retry | `t("Không lưu được cài đặt. Thử lại.", "Couldn't save settings. Try again.")` |

#### Responsive

| Breakpoint | Settings |
|---|---|
| 1440px | Form max-width 640px centered; Danger Zone separated section |
| 768px | Form full content width |
| 375px | Form full mobile width; Danger Zone at bottom with extra padding |

---

## 4. Components Used

| Component | States | Mô tả |
|---|---|---|
| `ClubRow` | default, hover (lift shadow), pressed | Row CLB: sport icon + name + role badge + member count |
| `RoleBadge` | 👑 Owner, 🛡 Admin, Member, Guest | Badge role thành viên |
| `SectionHeader` | default | "CLB tôi quản lý" / "CLB tôi tham gia" + count |
| `ClubHero` | loading (skeleton), ready | Banner/avatar CLB + tên + member count |
| `ClubTabBar` | 4 tabs: 📰 📋 👥 💬; active highlight | Horizontal tab bar within Club Detail |
| `PostCard` | default, pinned (📌 badge + highlighted bg) | Bài đăng: author + timestamp + body + reactions |
| `PinnedSection` | visible (has pin), hidden (no pin) | Section "📌 GHIM" header + pinned post |
| `PostComposer` | default, focused, submitting, error | Textarea + submit button (host/admin only) |
| `ReactionBar` | emoji counts (👍❤️😂😮😢🙏) | Reaction row dưới post |
| `SettingsForm` | sections: Info, Payment, Notification, Danger | Grouped form sections |
| `DangerButton` | default (red outline), confirm (red fill), loading | "Tạm dừng" / "Xóa CLB" with confirm dialog |
| `BottomNav` | 4 tabs; slot #4 active for Club | Mobile bottom navigation |

---

## 5. Edge Cases (UX)

| # | Case | Hiển thị |
|---|---|---|
| 1 | User chưa thuộc CLB nào | Empty state: 🏸 + "Chưa có CLB" + 2 CTA (Tìm CLB + Tạo CLB) |
| 2 | CLB bị suspended (billing) | Badge 🔒 Suspended trên club row; detail: banner suspended + read-only |
| 3 | Tên CLB rất dài (>40 chars) | Truncate + ellipsis trên club row; full name trong hero banner |
| 4 | Pin post khi đã có post khác đang pin | Auto unpin cũ → pin mới; animation swap |
| 5 | Post rất dài (>5000 chars) | Truncate sau 3 dòng + "Xem thêm" expand; collapse lại được |
| 6 | Non-admin cố truy cập Settings URL | Redirect về Club detail; ⚙️ icon ẩn cho non-admin |
| 7 | Role thay đổi real-time (admin → member) | UI refresh: ⚙️ ẩn, composer ẩn, pin menu ẩn. Toast thông báo |
| 8 | CLB bị xóa/archived khi đang xem | Redirect về Club list + toast `t("CLB đã bị xóa", "Club was deleted")` |
| 9 | Pull-to-refresh Club list | Refresh animation + re-fetch memberships |
| 10 | Danh sách CLB dài (>10 items) | Infinite scroll; loading indicator dưới list; không load hết 1 lần |

---

## 6. Data hiển thị

| Field | Format | i18n `t(vi, en)` | Ghi chú |
|---|---|---|---|
| Club name | Text | `data — no copy` | Truncate >40 chars |
| Sport icon | Emoji: 🏸⚽🎾🏐 | `data — no copy` | Map từ `tenants.sport_type` |
| Role badge | Emoji + text | `t("Chủ sở hữu", "Owner")` · `t("Quản trị", "Admin")` · `t("Thành viên", "Member")` · `t("Khách", "Guest")` | |
| Member count | "N thành viên" | `t("%d thành viên", "%d members")` | Aggregate |
| Session frequency | "N kèo tuần" | `t("%d kèo tuần", "%d sessions/week")` | Aggregate |
| Post timestamp | Relative | "5 phút trước", "Hôm qua" | Locale formatter |
| Post body | Markdown-lite | `data — no copy` | Bold, italic, links |
| Pinned badge | "📌 Đã ghim" | `t("Đã ghim", "Pinned")` | |

> **i18n:** Mọi chuỗi user-facing qua `t(vi, en)` (`packages/core/src/i18n.ts`). Cặp vi/en ở cột trên là chuỗi thật.

---

## 7. Responsive & Interaction Notes

- **Club row:** Tap → navigate to Club detail. Hover (desktop): lift shadow + cursor pointer
- **Tab bar:** Horizontal scroll on mobile if labels overflow; active tab: brand underline `var(--primary)`
- **Post reactions:** Tap reaction → toggle. Long-press → emoji picker (6 emoji set)
- **Pin menu:** Long-press post → context menu: "📌 Ghim lên đầu" / "Bỏ ghim". Animation: pinned section slide-in 200ms
- **Settings form:** Auto-save on blur per field. Danger zone: confirm dialog before destructive action
- **Dark mode:** Card bg `var(--bg-card)`, text `var(--text-primary)`, section headers `var(--text-secondary)`, danger `var(--error)`
- **Touch targets:** Mọi interactive element ≥ 44×44px
- **Pull-to-refresh:** Club list supports native pull-to-refresh gesture (mobile)
- **Sidebar IDs:** `#sidebar`, `#sidebar-backdrop`, `#menu-toggle` (bắt buộc)

---

_FE Design Spec v0.1 · 2026-08-10 · Source: feature_club.md v1.0_
_Changelog v0.1: Initial — 4 screens (Club List, Club Detail, News/Announcement, Settings), 7 sections, 10 edge cases, ASCII wireframes Desktop + Mobile._
