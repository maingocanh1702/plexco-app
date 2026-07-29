# Plexco Web App — Design Brief cho Designer

> **Version:** 2.3 · 2026-07-28
> **Tài liệu tham chiếu:** `../../product/BRD.md` v3.9n · `../../product/PRD.md` v2.8m · `../../product/TDD.md` v3.1h · `../../product/ROADMAP.md` v3.4l · `../../features/README.md` current · `../../standards/decisions.md` v2.11 current mirror · `../../proposals/in-app-chat-primary-player-surface-plan-2026-07-27.md` v1.8
> **Target audience:** Designer (UI/UX)
>
> **Cập nhật v3.4 (DD-37 ✅):** Đăng nhập = **Google + email** (bỏ Telegram Login). Kênh phase-1 = **web + Zalo + Facebook Messenger** (Telegram loại). Onboarding link **Zalo + Facebook Messenger** (không còn bước Telegram). Thêm màn **chat in-app** (DD-38 ✅), **cài đặt hồ sơ + giá theo giới tính** (DD-39 ✅), **mark-paid thủ công tap/multi-select** (DD-40 ✅).
>
> **Cập nhật DD-79/DD-81 (19/07/2026; current mirror 28/07):** phase-1 PWA có màn **Home hub** làm landing sau đăng nhập (`../../features/feature_home.md` v0.7 — chips Còn nợ/Kèo tuần · hero kèo kế tiếp gradient+glow theo theme-direction §7 · upcoming + suggested). **Bottom nav 5 slot: Home · Feed (config-OFF tới DD-76) · [Khám phá — center/FAB] · Club (CLB sở hữu + tham gia, CTA Tạo CLB) · Setting**; **💬 chat + 🔔 trên header** mọi màn chính. Visual tool = **Pencil**, canonical root file `design.pen`; target theme = Candidate C Energetic Orange `#FF5A1F` + Sora/Inter. Current Indigo/Outfit giữ active; FE mapping chỉ bắt đầu sau tracked owner-approved `design.pen` + visual/WCAG gate.
>
> **Cập nhật DD-57/58/59 (28/07):** FE governance đã ✅ chốt: server-first/feature-first/4-state; Pencil-only `design.pen → handoff → token-mapping → code → screenshot verify`; `standards/design-tokens.md` là value SoT và benchmark chỉ tư vấn. Đây là contract, không phải runtime/FE evidence.
>
> **Cập nhật DD-65..68:** central Plexco Page luôn có; Page riêng là optional. UI onboarding phải hiển thị central readiness trước, không block completion vì thiếu club Page; host/player dùng shared surface và protected actions, runtime vẫn pending.
>
> **Cập nhật DD-91 (28/07):** target direction là In-app Chat thành primary daily player surface;
> Zalo/Messenger là acquisition/external/fallback. Designer cần dự trù club channel, private Club Bot và
> requester-only `/pay`. Primary plan v1.8 đã `PLAN_READY` tại `90d292d`, Chat/Assistant contracts đã
> Reviewed, nhưng chưa slice-local `CODE_READY` và không có runtime/connected FE. Đây là conditional
> direction, không được dùng để mở mapping hoặc tự chốt visual questions. `design.pen` vẫn
> untracked/unapproved trong working tree hiện tại.

---

## 1. Tổng quan sản phẩm

**Plexco** là platform quản lý & khám phá hoạt động thể thao đa môn (cầu lông, bóng đá, tennis, pickleball...) cho 2 nhóm user:

| Vai trò | Mô tả | Access |
|---------|-------|--------|
| **Host** (Admin) | Quản lý club, tạo buổi chơi, quản lý tài chính, kết nối bot Zalo/Facebook Messenger | Web dashboard + bot admin |
| **Player** | Khám phá buổi chơi, tham gia, xem lịch sử/nợ, thanh toán, chat in-app | Web /me + bot commands |

**Triết lý:** Bot (Zalo/Facebook Messenger) cho interactions nhanh nơi user đã ở, Web app cho **dashboard quản lý** (host) + **personal view** (player) + **marketplace khám phá** (public) + **chat in-app**. *(Telegram đã loại khỏi phạm vi — DD-37.)*

---

## 2. Personas & User Journeys

### 2.1 Host — Chủ club thể thao

**Profile:** 25-45 tuổi, quản 1-3 CLB, 10-50 thành viên/CLB, dùng smartphone chính, laptop phụ.

**Pain points:**
- Thu tiền phức tạp (chuyển khoản qua bank, phải kiểm thủ công)
- Quản lý roster/lịch chơi qua group chat lộn xộn
- Không biết ai nợ bao nhiêu

**Journey trên Web:**
1. **Onboarding** → Đăng nhập via Google/email → Tạo club → Kết nối bank (SePay) → Link Zalo bot → (tuỳ chọn) Kết nối Facebook Messenger (App Review) → Hoàn tất
2. **Hàng ngày** → Dashboard: upcoming sessions, outstanding debts, recent payments
3. **Quản lý** → Sessions: tạo/sửa/clone/recurring → Financial: xem debts, payment status → Members: roster, ban list
4. **Tài chính** → Billing: subscription, invoices

### 2.2 Player — Người chơi thể thao

**Profile:** 18-40 tuổi, chơi 1-5 CLB, mobile-first.

**Journey trên Web:**
1. **Discover** → Browse marketplace → Filter sport/area/time/price → Join buổi chơi
2. **My stuff** → /me: clubs, upcoming, debts → View payment instructions → Track payment status
3. **Quick access** → Magic link từ Zalo/Facebook Messenger → Open web → View personal data

### 2.3 Public visitor — Chưa đăng nhập

**Journey:** Landing page → Browse marketplace → See session details → Sign up to join

---

## 3. Cấu trúc Screens & Sitemap

> ⚠️ **Route/auth/phase canonical = [`./README.md §2 Screen Map`](./README.md) + §2.1 Permission Matrix.** Sitemap dưới cho *bức tranh tổng* + chi tiết sub-flow (onboarding steps, `/me/*`); khi route/tên lệch với README §2 thì **README §2 thắng** (vd `/dashboard/payments` là canonical, không phải `/dashboard/finance/debts`). Cần sửa lệch → chốt ở README §2 trước.

```
/                           → Landing page (public)
├── /discover               → Marketplace discovery (public)
│   └── /discover/:id       → Session detail (public)
├── /auth/login             → Google OAuth + email/password (DD-13)
├── /auth/onboarding        → Club onboarding wizard (4 steps)
│   ├── Step 1: Club info
│   ├── Step 2: Bank (SePay)
│   ├── Step 3: Zalo bot (dán token)
│   └── Step 4: Messenger central ready + optional FB Login/chọn Page riêng
│
├── /dashboard              → Host dashboard (auth required)
│   ├── /sessions           → Session management
│   │   ├── /sessions/new   → Create session
│   │   └── /sessions/:id   → Session detail + roster
│   ├── /finance            → Financial overview
│   │   ├── /debts          → Outstanding debts
│   │   └── /payments       → Payment history
│   ├── /members            → Member management
│   ├── /settings           → Club settings
│   │   ├── /integrations   → Bot/bank connections
│   │   └── /notifications  → Notification policies
│   └── /billing            → Subscription & invoices
│
├── /me                     → Player personal view (auth required)
│   ├── /me/clubs           → My clubs
│   ├── /me/sessions        → My upcoming sessions
│   ├── /me/charges         → My charges/payments
│   └── /me/requests        → My join requests
│
└── /magic/:hash            → Magic link consume → redirect to /me
```

---

## 4. Key Screens — Chi tiết & Wireframes

### 4.1 Landing Page (/)

**Goal:** Giới thiệu Plexco + CTA discover/signup.

```
┌─────────────────────────────────────────────────────────┐
│  [Logo: Plexco]                    [Discover] [Login]   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌───────────────────────────────────────────────────┐  │
│  │           HÃY CÙNG CHƠI THỂ THAO                 │  │
│  │    Tìm kèo cầu lông, bóng đá, tennis...          │  │
│  │    gần bạn — join ngay trong vài giây             │  │
│  │                                                   │  │
│  │  [🔍 Tìm buổi chơi]    [🏟️ Tạo club miễn phí]  │  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │ Feature 1│  │ Feature 2│  │ Feature 3│              │
│  │ Quản lý  │  │ Thu tiền │  │ Marketplace│             │
│  │ dễ dàng  │  │ tự động  │  │ khám phá │              │
│  └──────────┘  └──────────┘  └──────────┘              │
│                                                         │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Trusted by 50+ clubs                             │  │
│  │  [Club logo 1] [Club logo 2] [Club logo 3] ...   │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

**Notes:**
- Hero section: gradient background, animated sport icons
- Features: 3-column grid, icon + title + short description
- Social proof: club logos carousel (sau MVP dùng placeholder)
- Mobile: stack vertically, full-width CTA buttons

---

### 4.2 Marketplace Discovery (/discover)

**Goal:** Browse và filter buổi chơi public.

```
┌─────────────────────────────────────────────────────────┐
│  [← Back]  Khám phá buổi chơi            [Login]       │
├─────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────┐    │
│  │ 🔍 [Search / filter bar]                        │    │
│  │ [Sport ▼] [Khu vực ▼] [Thời gian ▼] [Giá ▼]   │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  Tìm thấy 24 buổi chơi                                 │
│                                                         │
│  ┌───────────────────────────────┐  ┌───────────────┐   │
│  │ 🏸 Cầu lông · Q7             │  │ ⚽ Bóng đá    │   │
│  │ T4 19:00-21:00               │  │ Q2 · CN 16h   │   │
│  │ 3/8 chỗ · 80k/người         │  │ 5/14 · 70k    │   │
│  │ CLB Badminton Pro            │  │ FC Stars      │   │
│  │                              │  │               │   │
│  │ [Tham gia]                   │  │ [Tham gia]    │   │
│  └───────────────────────────────┘  └───────────────┘   │
│                                                         │
│  ┌───────────────────────────────┐  ┌───────────────┐   │
│  │ 🎾 Tennis · Bình Thạnh       │  │ ...           │   │
│  │ ...                          │  │               │   │
│  └───────────────────────────────┘  └───────────────┘   │
│                                                         │
│  [Load more →]                                          │
└─────────────────────────────────────────────────────────┘
```

**Notes:**
- Card-based grid (auto-fit, minmax(300px, 1fr))
- Sport icon + color coding per sport type
- Slot indicator: visual bar showing remaining/total
- Filter: sticky on scroll, chips on mobile
- NO venue address shown (privacy — only area/quận)
- Empty state: "Chưa có buổi chơi nào phù hợp — thử thay đổi bộ lọc"
- Loading: skeleton cards

---

### 4.3 Host Dashboard (/dashboard)

**Goal:** Overview at a glance — upcoming sessions, debts, recent activity.

```
┌──────────┬──────────────────────────────────────────────┐
│          │  Dashboard                          [Avatar] │
│  SIDEBAR │──────────────────────────────────────────────│
│          │                                              │
│  [Logo]  │  ┌────────┐ ┌────────┐ ┌────────┐          │
│          │  │ 3      │ │ 2.4M   │ │ 12     │          │
│  📊 Dash │  │Sessions│ │ Nợ     │ │Members │          │
│  📅 Sess │  │tuần này│ │ VND    │ │ active │          │
│  💰 Fin  │  └────────┘ └────────┘ └────────┘          │
│  👥 Memb │                                              │
│  ⚙️ Sett │  Buổi chơi sắp tới                          │
│  💳 Bill │  ┌────────────────────────────────────────┐  │
│          │  │ 🏸 T4 19:00 · Q7 · 5/8 chỗ           │  │
│          │  │ 🏸 T6 20:00 · Q3 · 2/8 chỗ           │  │
│          │  │ ⚽ CN 16:00 · Q2 · 8/14 chỗ           │  │
│          │  └────────────────────────────────────────┘  │
│          │                                              │
│          │  Thanh toán gần đây                          │
│          │  ┌────────────────────────────────────────┐  │
│          │  │ ✅ Nguyễn Văn A · 80k · 2 phút trước  │  │
│          │  │ ✅ Trần Thị B · 160k · 15 phút trước  │  │
│          │  │ ⏳ Lê Văn C · 80k · chờ xác nhận      │  │
│          │  └────────────────────────────────────────┘  │
└──────────┴──────────────────────────────────────────────┘
```

**Notes:**
- Sidebar: responsive (desktop 240px → tablet 64px icon → mobile hamburger overlay)
- Stats cards: animated counters on load
- Session list: clickable → detail
- Payment feed: realtime updates (SSE)
- Loading: skeleton for each section independently

---

### 4.4 Session Management (/sessions)

```
┌──────────────────────────────────────────────────────────┐
│  Buổi chơi                    [+ Tạo buổi chơi mới]    │
├──────────────────────────────────────────────────────────┤
│  [Sắp tới ▼] [Tất cả trạng thái ▼] [Tìm kiếm...]      │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │ 🟢 OPEN   🏸 Cầu lông · T4 19:00-21:00           │  │
│  │ Q7 Sports Center · 5/8 chỗ · 80k/người            │  │
│  │ [Roster ↗] [Edit ✏️] [Announce 📢] [Close ✅]     │  │
│  ├────────────────────────────────────────────────────┤  │
│  │ 🟡 DRAFT  ⚽ Bóng đá · CN 16:00-18:00             │  │
│  │ Q2 Stadium · 0/14 chỗ · 70k/người                 │  │
│  │ [Edit ✏️] [Publish 🌐] [Delete 🗑️]               │  │
│  ├────────────────────────────────────────────────────┤  │
│  │ ⚫ CLOSED 🎾 Tennis · Hôm qua 18:00               │  │
│  │ Bình Thạnh · 4/4 · 100k                           │  │
│  │ [View details ↗]                                   │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  Empty state:                                            │
│  ┌────────────────────────────────────────────────────┐  │
│  │     📅 Chưa có buổi chơi nào                      │  │
│  │     Tạo buổi chơi đầu tiên cho club bạn           │  │
│  │     [+ Tạo buổi chơi]                             │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

**Session Detail + Roster:**
```
┌────────────────────────────────────────────────────────┐
│  ← Buổi chơi #12     🏸 Cầu lông                     │
│  T4 19:00-21:00 · Q7 Sports Center                    │
│  80k/người · 5/8 chỗ · 🟢 Open                       │
├────────────────────────────────────────────────────────┤
│                                                        │
│  Roster (5/8)                                          │
│  ┌────────────────────────────────────────┐            │
│  │ 1. Nguyễn Văn A  ✅ Đã thanh toán    │            │
│  │ 2. Trần Thị B    ✅ Đã thanh toán    │            │
│  │ 3. Lê Văn C      ⏳ Chưa thanh toán  │            │
│  │ 4. Phạm Thị D    ⏳ Chưa thanh toán  │            │
│  │ 5. Hoàng Văn E   💰 Thanh toán 1 phần│            │
│  └────────────────────────────────────────┘            │
│                                                        │
│  Actions:                                              │
│  [📢 Announce] [✏️ Edit] [✅ Close] [❌ Cancel]       │
│                                                        │
│  Financial Summary                                     │
│  Thu: 240k/400k (60%) · Nợ: 160k                     │
└────────────────────────────────────────────────────────┘
```

---

### 4.5 Financial Overview (/finance)

```
┌────────────────────────────────────────────────────────┐
│  Tài chính                                             │
├────────────────────────────────────────────────────────┤
│                                                        │
│  ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐      │
│  │ 2.4M   │  │ 1.8M   │  │ 600k   │  │ 12     │      │
│  │ Tổng nợ│  │ Đã thu │  │ Còn lại│  │ Người  │      │
│  │ VND    │  │ VND    │  │ VND    │  │ nợ     │      │
│  └────────┘  └────────┘  └────────┘  └────────┘      │
│                                                        │
│  Danh sách nợ                                          │
│  ┌────────────────────────────────────────────┐        │
│  │ [Tên ▲] [Tổng nợ ▼] [Buổi gần nhất]       │        │
│  │─────────────────────────────────────────────│        │
│  │ Lê Văn C     │ 240k │ 3 buổi │ [Nhắc nợ]  │        │
│  │ Phạm Thị D   │ 160k │ 2 buổi │ [Nhắc nợ]  │        │
│  │ Hoàng Văn E  │  80k │ 1 buổi │ [Nhắc nợ]  │        │
│  └────────────────────────────────────────────┘        │
│                                                        │
│  Thanh toán gần đây (realtime)                         │
│  ┌────────────────────────────────────────────┐        │
│  │ ✅ 12:34 · Nguyễn A · 80k · Auto-matched  │        │
│  │ ✅ 12:20 · Trần B · 160k · Auto-matched   │        │
│  │ ⚠️ 11:45 · Unknown · 50k · Chờ xử lý     │        │
│  └────────────────────────────────────────────┘        │
└────────────────────────────────────────────────────────┘
```

---

### 4.6 Onboarding Wizard (/auth/onboarding)

**4-step wizard, progress bar, each step independent, resumable.**

```
┌────────────────────────────────────────────────────────┐
│  Thiết lập club                                        │
│  ┌─●──────●──────●──────○─┐                            │
│  │ Club  Bank   Zalo   FB Msg                          │
│  └────────────────────────┘                            │
│                                                        │
│  Step 1: Thông tin club                                │
│  ┌────────────────────────────────────────────┐        │
│  │ Tên club *          [                    ] │        │
│  │ Slug (URL)          [plexco.vn/club-slug ] │        │
│  │ Môn thể thao *      [Cầu lông ▼]         │        │
│  │ Khu vực *            [Quận 7 ▼]           │        │
│  │ Mô tả ngắn          [                    ] │        │
│  │ Logo (tuỳ chọn)     [📎 Upload]           │        │
│  └────────────────────────────────────────────┘        │
│                                                        │
│  [Tiếp tục →]                                          │
└────────────────────────────────────────────────────────┘

Step 2: Kết nối bank
┌────────────────────────────────────────────────────────┐
│  Nối tài khoản ngân hàng để nhận CK tự động           │
│                                                        │
│  ┌────────────────────────────────────────────┐        │
│  │ Nhà cung cấp *      [SePay ▼]             │        │
│  │ SePay               [Kết nối bằng OAuth]   │        │
│  │ Số tài khoản *       [                    ] │        │
│  │ Ngân hàng *          [Vietcombank ▼]       │        │
│  └────────────────────────────────────────────┘        │
│                                                        │
│  [Xác minh kết nối]  (spinner while verifying)         │
│                                                        │
│  ✅ Đã kết nối thành công!                             │
│  [← Quay lại]  [Tiếp tục →]                           │
└────────────────────────────────────────────────────────┘

Step 3: Liên kết Zalo bot
┌────────────────────────────────────────────────────────┐
│  Kết nối Zalo bot của club (BYO bot-token)            │
│                                                        │
│  1. Tạo Zalo bot trong Zalo Bot Creator               │
│  2. Copy Bot Token                                     │
│  3. Dán vào ô bên dưới → Xác minh                      │
│                                                        │
│  Bot Token:                                            │
│  ┌────────────────────────────────────────┐            │
│  │  [●●●●●●●●●●●●]                 [Dán]  │            │
│  └────────────────────────────────────────┘            │
│                                                        │
│  Trạng thái: ⏳ Đang xác minh token...                 │
│  (verify API call + set webhook)                       │
│                                                        │
│  [← Quay lại]  [Tiếp tục →]                           │
└────────────────────────────────────────────────────────┘

Step 4: Facebook Messenger + Readiness
┌────────────────────────────────────────────────────────┐
│  Kết nối Facebook Messenger (tuỳ chọn)                │
│  ┌────────────────────────────────────────────┐        │
│  │ [🔵 Đăng nhập Facebook + chọn Page]        │        │
│  │ [Kết nối] hoặc [Bỏ qua →]                 │        │
│  │ ⓘ Cần App Review của platform trước GA    │        │
│  └────────────────────────────────────────────┘        │
│                                                        │
│  ── Kiểm tra sẵn sàng ──                              │
│  ✅ Thông tin club                                     │
│  ✅ Kết nối bank                                       │
│  ✅ Liên kết Zalo bot                                  │
│  ⚪ Kết nối Facebook Messenger (tuỳ chọn)             │
│                                                        │
│  🎉 Club sẵn sàng hoạt động!                          │
│  [Vào Dashboard →]                                     │
└────────────────────────────────────────────────────────┘
```

---

### 4.7 Player View (/me)

```
┌────────────────────────────────────────────────────────┐
│  [Logo]  Xin chào, Nguyễn Văn A       [⚙️] [Logout]  │
├────────────────────────────────────────────────────────┤
│                                                        │
│  ┌────────┐  ┌────────┐  ┌────────┐                   │
│  │ 3      │  │ 2      │  │ 160k   │                   │
│  │ Clubs  │  │ Buổi   │  │ Nợ     │                   │
│  │ tham   │  │ sắp    │  │ VND    │                   │
│  │ gia    │  │ tới    │  │        │                   │
│  └────────┘  └────────┘  └────────┘                   │
│                                                        │
│  Buổi chơi sắp tới                                    │
│  ┌────────────────────────────────────────────┐        │
│  │ 🏸 T4 19:00 · CLB Badminton Pro · Q7      │        │
│  │    80k · ⏳ Chưa thanh toán                │        │
│  │    [Xem QR thanh toán]                     │        │
│  ├────────────────────────────────────────────┤        │
│  │ ⚽ CN 16:00 · FC Stars · Q2               │        │
│  │    70k · ✅ Đã thanh toán                  │        │
│  └────────────────────────────────────────────┘        │
│                                                        │
│  Clubs của tôi                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐            │
│  │ 🏸 CLB   │  │ ⚽ FC    │  │ 🎾 Tennis│            │
│  │ Badminton│  │ Stars    │  │ Club     │            │
│  │ Pro      │  │          │  │          │            │
│  │ Nợ: 80k │  │ ✅ Sạch  │  │ Nợ: 80k │            │
│  └──────────┘  └──────────┘  └──────────┘            │
│                                                        │
│  [Khám phá thêm clubs →]                              │
└────────────────────────────────────────────────────────┘
```

---

### 4.8 Authentication (/auth/login)

```
┌────────────────────────────────────────────────────────┐
│                                                        │
│        ┌──────────────────────────────────┐            │
│        │                                  │            │
│        │      [Logo: Plexco]              │            │
│        │                                  │            │
│        │  Đăng nhập                       │            │
│        │                                  │            │
│        │  ┌──────────────────────────┐    │            │
│        │  │ 🔵 Đăng nhập bằng Google │    │            │
│        │  └──────────────────────────┘    │            │
│        │  ─────── hoặc ───────            │            │
│        │  Email    [                 ]    │            │
│        │  Mật khẩu [                 ]    │            │
│        │  [Đăng nhập]     [Đăng ký]      │            │
│        │                                  │            │
│        │  Bằng việc đăng nhập, bạn       │            │
│        │  đồng ý với Điều khoản và       │            │
│        │  Chính sách Bảo mật.            │            │
│        │                                  │            │
│        └──────────────────────────────────┘            │
│                                                        │
└────────────────────────────────────────────────────────┘
```

**Notes:**
- Centered card, max-width: 400px (90vw on mobile)
- Background: gradient/pattern
- Login phase-1 (DD-13): **Google OAuth + email/password**. Bỏ Telegram Login (DD-37). Link **Facebook** (DD-33)/**Zalo** (DD-14) vào Person sau khi đăng nhập.

---

## 5. Design System Requirements

### 5.1 Color Palette

> ⚠️ **Giá trị màu canonical ở [`../../standards/design-tokens.md`](../../standards/design-tokens.md)** (DD-59 ✅ `.md` value SoT). Benchmark là advisory evidence, không tự đổi value. Target C chưa active tới khi visual/WCAG gate pass.

| Token | Sử dụng | Ghi chú |
|-------|---------|---------|
| `--primary` | CTA buttons, links, active states | **Current canonical = Indigo → Deep Blue**; target DD-81 = Energetic Orange `#FF5A1F` sau gate |
| `--primary-hover` | Button hover | Slightly darker/brighter |
| `--secondary` | Secondary actions, tags | Complementary color |
| `--bg-page` | Page background | Light mode: off-white, Dark mode: deep navy |
| `--bg-card` | Card backgrounds | Slight elevation from page |
| `--bg-sidebar` | Sidebar | Dark/contrast for dashboard |
| `--text-primary` | Main text | High contrast |
| `--text-secondary` | Muted text, labels | Lower contrast |
| `--success` | Paid, verified, connected | Green family |
| `--warning` | Partial, pending, expiring | Amber family |
| `--danger` | Unpaid, error, banned | Red family |
| `--sport-badminton` | Sport type color | Per sport |
| `--sport-football` | Sport type color | Per sport |
| `--sport-tennis` | Sport type color | Per sport |

### 5.2 Typography

- **Current font family:** Inter (body), Outfit (heading), system-ui fallback
- **Target DD-81:** Sora headings + Inter body, chỉ activate sau tracked owner-approved `design.pen` + visual/WCAG gate
- **Target primary contrast:** nếu activate `#FF5A1F`, normal text dùng dark `#22100A` (5.874:1); white chỉ 3.118:1 nên không đạt AA
- **Heading:** Bold, letter-spacing tight
- **Body:** Regular, 16px base, 1.5 line-height
- **Numbers/money:** Tabular-nums, monospace for alignment

### 5.3 Spacing

- 4px base unit: `--space-1` (4px), `--space-2` (8px), `--space-3` (12px), `--space-4` (16px), `--space-6` (24px), `--space-8` (32px)

### 5.4 Components cần thiết kế

| Component | Variants | States |
|-----------|----------|--------|
| Button | Primary, Secondary, Ghost, Danger | Default, Hover, Active, Disabled, Loading |
| Card | Session card, Stat card, Member card | Default, Hover, Active |
| Badge/Tag | Sport type, Status (open/closed/draft) | - |
| Input | Text, Select, Date picker, File upload | Default, Focus, Error, Disabled |
| Table | Sortable, Paginated | Loading (skeleton rows) |
| Sidebar | Desktop (240px), Tablet (64px), Mobile (overlay) | Collapsed, Expanded |
| Modal | Confirm, Form, Bottom sheet (mobile) | - |
| Toast | Success, Warning, Error, Info | - |
| Skeleton | Card, Table row, Text line | - |
| Empty state | Icon + text + CTA | - |
| Slot indicator | Visual bar (filled/total) | Full, Available, Few left |

---

## 6. Responsive Breakpoints

| Breakpoint | Layout |
|------------|--------|
| ≤ 768px (Mobile) | No sidebar — hamburger overlay. Cards stack. Bottom sheet for modals. Full-width CTAs. |
| 769px – 1024px (Tablet) | Sidebar collapsed (64px, icon-only). Cards 2-column. |
| > 1024px (Desktop) | Sidebar expanded (240px). Cards auto-fit grid. Modals centered. |

---

## 7. Interaction & Animation Notes

| Element | Interaction |
|---------|-------------|
| Stat cards | Number count-up on first load |
| Session cards | Hover lift (translateY -2px + shadow) |
| Payment feed | Slide-in animation for new entries (realtime) |
| Roster changes | Subtle highlight flash on update |
| Navigation | Smooth page transitions |
| Loading | Skeleton shimmer effect |
| Toast | Slide-in from top-right, auto-dismiss 5s |
| Filter chips | Pill animation on select/deselect |
| Slot indicator | Animated fill bar |

---

## 8. Accessibility & Touch Targets

- Minimum touch target: 44x44px
- Keyboard navigable (tab order, focus ring)
- Color contrast: WCAG AA minimum
- Screen reader labels for icons and interactive elements
- Motion: `prefers-reduced-motion` respect

---

## 9. Deliverables mong đợi từ Designer

1. **Design token authority** — `standards/design-tokens.md` value SoT + matching variables trong tracked owner-approved `design.pen`
2. **Component Library** (Button, Card, Input, Table, Badge, Toast, Skeleton, Empty state, Slot indicator)
3. **Screen designs** theo sitemap Section 3 — cover 4 states mỗi screen:
   - Loading (skeleton)
   - Ready (dữ liệu thật — tiếng Việt)
   - Error (inline errors + toast)
   - Empty (icon + text + CTA)
4. **Responsive** variants: Mobile (375px), Tablet (768px), Desktop (1440px)
5. **Dark mode** variant (tuỳ chọn — có thể phase 2)
6. **Prototype** cho key flows: Onboarding wizard, Session CRUD, Discover → Join

---

## 10. Technical Constraints

| Constraint | Chi tiết |
|------------|---------|
| CSS | Vanilla CSS (no Tailwind) — tất cả dùng CSS variables |
| Grid | `auto-fit, minmax()` — không hardcode số cột |
| Sidebar IDs | `#sidebar`, `#sidebar-backdrop`, `#menu-toggle` |
| Login card | `max-width: 90vw` |
| Data | Tiếng Việt thực tế trong mockups |
| Privacy | Marketplace KHÔNG hiển thị venue address (chỉ area/quận); KHÔNG lộ giới tính (DD-39) |
| Auth | Google OAuth + email/password (phase-1, DD-13); link Facebook (DD-33)/Zalo (DD-14). Bỏ Telegram Login (DD-37) |

---

## Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 28/07/2026 | v2.3 | Refresh current authority refs and mirror plan v1.8 `PLAN_READY` at `90d292d`; retain slice-local `CODE_READY`, no-runtime and design-authority HOLD boundaries. |
| 28/07/2026 | v2.2 | Mirror DD-57/58/59 active governance and DD-81 target C + Sora/Inter; distinguish current Indigo/Outfit from gated target and pin dark on-primary contrast. |
| 27/07/2026 | v2.1 | Refresh authority refs and add DD-91 conditional Chat-primary/`/pay` direction while preserving `NOT_PLAN_READY`, no-runtime and design-authority HOLD boundaries. |
| 25/07/2026 | v2.0 | **DD-81 path reconcile:** canonical root file = `design.pen`; chưa mở FE gate trước persist/track + owner nghiệm thu. |
| 19/07/2026 | v1.9 | **DD-79/81 mirror:** Home hub landing + bottom nav 5 slot + chat header; tool Pencil `plexco-app-design.pen`; Home = màn theme-exploration đầu tiên. |
| 2026-07-19 | v1.8 | Ref-only sync tới BRD v3.9d · PRD v2.8c · TDD v3.1 · ROADMAP v3.3b · feature index v2.29 · decisions v1.67; no UI scope/runtime change. |
| 2026-07-18 | v1.7 | Refresh authority v1.47/feature index v2.23; DD-59 benchmark is deferred reference, not an active gate. |
| 2026-07-17 | v1.6 | Refresh feature index reference to v2.22 after final integrity/Assistant readiness closure; no UI scope change. |
| 2026-07-17 | v1.5 | Refresh feature index reference to v2.20 after deep contract closure; no UI scope change. |
| 2026-07-17 | v1.4 | Refresh current authority refs to BRD v3.9b/PRD v2.8/TDD v3.1/ROADMAP v3.3/features v2.19/decisions v1.45; no UI scope change. |
| 2026-07-17 | v1.3 | Refresh current authority refs to TDD v3.0/features v2.18/decisions v1.45; no UI scope change. |
| 2026-07-17 | v1.2 | **DD-65..68:** central Messenger readiness + optional club Page, không block onboarding; refresh current authority refs tới BRD v3.9a/PRD v2.7/TDD v2.9/ROADMAP v3.2/features v2.17/decisions v1.44. |
| 2026-07-10 | v1.1 | **v3.4 pivot (DD-37 ✅):** auth wireframe/notes → Google + email (bỏ Telegram Login, DD-13); onboarding Step 3/4 → Zalo bot + Facebook Messenger (bỏ bước Telegram group); triết lý/personas → Zalo/Messenger; constraint auth + privacy giới tính (DD-39). Sửa cross-ref path `../product` → `../../product`. |
| 2026-06-19 | v1.0 | Initial design brief with wireframes, personas, sitemap, design system requirements |
