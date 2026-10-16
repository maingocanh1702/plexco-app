# Feature: Marketplace — FE Design Spec

> **Route(s):** `/discover` · `/discover/:sessionId`
> **Source authority:** `../../../features/FE/feature_marketplace_discovery.md` v2.4 · baseline `0c5808fc7cf50d139bdd9c4ee79917bf4059c4f4` · STALE PIN: source is now v2.8, FE spec not re-reviewed
> **Source contract status:** Reviewed
> **Projection/API contract:** Public whitelist DTO from Marketplace BE §3; exact join mutation/outcome owned by cross-club join
> **Capability/availability:** Public read availability + authenticated join authority; venue only after canonical `active`
> **Priority:** 9 — designer-kickoff.md §3B
> **FE design status:** Draft
> **Runtime status:** Partial schema only — public service/projector/routes/UI chưa build hoặc enable
> **Negative scope:** Chỉ public whitelist; không exact venue/roster/PII/hold count; không tự derive price range

> 📍 **Đọc nhanh (cập nhật 2026-09-15 — chỉ mục, không phải authority):** feature nguồn `../../../features/FE/feature_marketplace_discovery.md`; scope/phase đọc ở `BRD.md` v3.10 §📍 · hành vi `PRD.md` v2.9 §📍 · contract `TDD.md` v3.2 §📍 · **tiến độ thật `ROADMAP.md` v3.17 §📍** (mốc `main@e235ea4`, 15/09).
>
> **Phase-1 (DD-114):** ⬜ ngoài phase-1 (D7) · **Launch (DD-113):** ⬜ negative scope: discovery public
>
> **Surface:** Web app **PWA** (Next.js App Router, installable/offline — DD-113 launch = PWA + Zalo bot song song) — `/discover` ngoài launch; **app native iOS (App Store) + Android (CH Play) là phase-2** (DD-69): tái dùng API/contract, màn native thiết kế lại theo platform sau gate, **không phải bản sao màn này**.
>
> **Trạng thái:** FE design Draft · 🔴 **FE PENDING (DD-116)** — không mở page/component, không track `.pen` tới khi đủ cả ba vế (chọn đúng một `.pen` canonical · tracked trên `main` · owner ký gate DD-81) · as-built @ `main@e235ea4`: **0 màn FE nối API** (đúng 1 `apps/web/app/page.tsx`); BE: fence 8a ✅ · projector = epic bốn tiền đề · API ⬜.

---

## 1. Mô tả

Trang tìm và khám phá kèo thể thao public từ mọi CLB. Player tìm kèo theo môn, khu vực, thời gian, giá, chỗ trống — rồi join. Chỉ hiện kèo `open + public`, KHÔNG lộ thông tin private (roster, tiền, địa chỉ cụ thể). Center tab trên bottom nav (FAB style).

---

## 2. User Flows

### Flow 1: Browse kèo public

1. User tap tab "Khám phá" (center FAB) hoặc vào `/discover`
2. Thấy grid/list kèo public — filter bar trên
3. Filter: môn, khu vực, ngày, giá, slot trống
4. Scroll infinite / pagination

### Flow 2: Xem chi tiết + Join

1. Click kèo card → `/discover/:sessionId`
2. Thấy: môn, khu vực (KHÔNG địa chỉ), thời gian, giá, slot, tên CLB, tên host
3. Click "Tham gia" → join flow (cross-club join)
4. Đã full → "Hết chỗ" disabled hoặc "Xếp hàng chờ"
5. Exact venue chỉ được fetch/render sau khi server trả canonical join outcome `active`; `waitlisted`, `pending`, `rejected` hoặc unknown tiếp tục chỉ thấy public area

---

## 3. Screens & States

### `/discover` — Marketplace Browse

> **Current implementation boundary:** Public HTTP response path, join mutation outcome và protected
> venue DTO đều chưa được build-slice pin. Wireframes dưới đây là target fixtures; active browse,
> JoinButton state/mutation và exact venue phải omit ở baseline.

#### Layout (Mobile-first 375px)

```
┌──────────────────────┐
│ 🔍 Tìm kèo thể thao │
├──────────────────────┤
│ Filter Chips:         │
│ [⚽ Tất cả ▾] [Q.7▾] │
│ [📅 Hôm nay▾] [Giá▾]│
├──────────────────────┤
│ Session Cards Grid    │
│ ┌──────────────────┐ │
│ │ 🏸 Cầu lông      │ │
│ │ Q. Bình Thạnh     │ │
│ │ T5 19:00 · 120k   │ │
│ │ 5 chỗ trống         │ │
│ │ CLB Rồng Xanh     │ │
│ │ [Tham gia]         │ │
│ └──────────────────┘ │
│ ┌──────────────────┐ │
│ │ ⚽ Bóng đá        │ │
│ │ Q. Tân Bình       │ │
│ │ CN 08:00 · 80k    │ │
│ │ 12 chỗ trống        │ │
│ │ FC Phượng Hoàng    │ │
│ │ [Tham gia]         │ │
│ └──────────────────┘ │
│ ...                   │
├──────────────────────┤
│ Bottom Nav (FAB 🔍)   │
└──────────────────────┘
```

#### Layout (Desktop 1440px)

```
┌──────────────────────────────────────────────────────────────┐
│  Header: "Khám phá kèo" · Search bar                        │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  Filter Bar:                                                │
│  [Môn ▾] [Khu vực ▾] [Ngày ▾] [Giá ▾] [Chỗ trống ▾]       │
│                                                              │
│  Grid (3 cột):                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                  │
│  │ 🏸 Cầu   │  │ ⚽ Bóng  │  │ 🎾 Tennis │                  │
│  │ Q.Bình T │  │ Q.Tân B  │  │ Q.2       │                  │
│  │ T5 19:00 │  │ CN 08:00 │  │ T3 17:00  │                  │
│  │ 120k     │  │ 80k      │  │ 200k      │                  │
│  │ 5 trống │  │ 12 trống│  │ 2 trống  │                  │
│  │[Tham gia]│  │[Tham gia]│  │[Tham gia] │                  │
│  └──────────┘  └──────────┘  └──────────┘                  │
│                                                              │
│  [Load more] hoặc infinite scroll                           │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

#### States

- **Loading:** 6 skeleton cards (3×2 grid desktop, 2 mobile)
- **Ready:** Session cards grid + filter chips. Each card: sport icon, area, time, price, slots, club name, join CTA
- **Empty:** Icon 🔍 + "Không tìm thấy buổi chơi nào" + "Thử đổi bộ lọc hoặc quay lại sau" + CTA "Xoá bộ lọc"
  - *(Draft — bổ sung additive)* Empty state có **2 CTA**: giữ CTA "Xoá bộ lọc" hiện có + thêm CTA thứ hai `t("Mở rộng bộ lọc", "Broaden filters")` — bỏ bớt filter áp dụng gần nhất rồi refetch; nếu không có filter nào đang áp dụng thì không render CTA này
- **Error:** Error banner + retry
- **Rate limited:** "Quá nhiều truy vấn — thử lại sau [countdown]"

#### Loading states (Draft — phân tách client-local)

Phân tách trạng thái "Loading" ở trên thành 3 trạng thái tải riêng. Cả 3 đều là trạng thái UI thuần client **(client-local, không phải BE token)** — không thêm mã vào error catalog UNPINNED:

| Trạng thái (client-local) | Khi nào | Hiển thị |
|---|---|---|
| `LOADING` | Tải lần đầu, chưa có list | Skeleton cards đúng như "Loading" ở trên (6 skeleton: 3×2 desktop, 2 mobile) |
| `LOADING_MORE` | Phân trang / infinite scroll (§7: load 12 cards/lần) | Giữ nguyên list hiện tại + spinner/skeleton ở cuối list (§7); không clear list, không skeleton toàn trang |
| `REFRESHING` | Làm mới thủ công (user chủ động refresh) | Giữ nguyên list hiện tại + indicator đang làm mới; không clear list |

Fail trong `LOADING_MORE`/`REFRESHING`: theo Error mapping §3 (fail closed) — giữ stale cards + banner/retry, không render Empty.

#### Error mapping

| Status | Error code | Visible state | i18n `t(vi, en)` |
|---|---|---|---|
| 429 | `DISCOVERY_RATE_LIMITED` | Banner rate-limit + countdown; không auto-retry trước khi hết countdown, giữ stale cards nếu có | `t("Quá nhiều truy vấn — thử lại sau", "Too many requests — try again shortly")` |
| 400 | `INVALID_FILTER` | Inline error trên filter bar + CTA "Xoá bộ lọc"; KHÔNG render Empty vì 0 kết quả là một business assertion | `t("Bộ lọc không hợp lệ", "That filter isn't valid")` |
| — | `UNPINNED error catalog — omit active UI` | Public HTTP response path chưa được build-slice pin: browse list active bị omit ở baseline, không fetch và không render error surface | `N/A — surface omitted` |
| — | *(unknown / missing / timeout)* | **Fail closed** — unavailable placeholder + retry; giữ stale cards nếu có, không render Empty | `t("Không tải được danh sách kèo. Thử lại.", "Couldn't load sessions. Try again.")` |

> **Error mapping:** Pin server error/status → exact visible state. Unknown/missing response fail closed;
> không invent success, zero, empty hoặc disabled control. Nếu BE chưa pin catalog cho một endpoint,
> ghi `UNPINNED error catalog — omit active UI` thay vì bịa mã.

#### Responsive

| Breakpoint | Marketplace Browse |
|---|---|
| 1440px | Header "Khám phá kèo" + search bar cùng hàng; filter bar 5 dropdown ([Môn] [Khu vực] [Ngày] [Giá] [Chỗ trống]) trên một hàng; grid card 3 cột theo `repeat(auto-fit, minmax(300px, 1fr))` (§7); [Load more] / infinite scroll dưới grid; không có bottom nav |
| 768px | File chỉ pin hai hình thức — mobile-first 375px (1 cột full width) và desktop 1440px (3 cột `auto-fit`) — và **không pin** ngưỡng chuyển giữa chúng; không tự đặt số cột hay breakpoint cho dải này |
| 375px | Composition chính (mobile-first): header "🔍 Tìm kèo thể thao"; filter chip cuộn ngang và sticky dưới header (§7); card 1 cột full width, mỗi card = sport icon · khu vực · thời gian · giá · `slots_open` · tên CLB · CTA; bottom nav với FAB 🔍 ở giữa. Baseline omit không đổi theo breakpoint — public HTTP response path chưa được build-slice pin (fence §3) nên browse list active, JoinButton state/mutation và exact venue **không fetch/không render** ở mọi kích thước; slot luôn chỉ là `slots_open`, không denominator |

### Search behavior (Draft)

> Behavior spec cho search bar đã vẽ ở layout §3 ("🔍 Tìm kèo thể thao" mobile · "Search bar" desktop).
> Toàn bộ mục này là client-side behavior; fetch active vẫn nằm sau fence §3 — public HTTP response
> path chưa build-slice pin thì search không fetch và không render kết quả active. Không thêm error
> code mới: lỗi của search request dùng đúng Error mapping §3 hiện có.

- **Debounce 300ms:** chỉ phát request sau 300ms kể từ keystroke cuối; keystroke mới trong cửa sổ debounce reset timer — gõ liên tục không tạo request trung gian.
- **Hủy request đang bay:** dùng `AbortController` — khi phát query mới, abort request đang bay; UI chỉ dùng response của request mới nhất, response từ request đã abort không được render (chống race ghi đè kết quả cũ lên kết quả mới).
- **Ngưỡng 2 ký tự:** chỉ gọi API khi query (sau trim) ≥ 2 ký tự. Dưới ngưỡng: không gọi API, hiện hint `t("Nhập ít nhất 2 ký tự", "Type at least 2 characters")`.
- **Whitespace:** query toàn khoảng trắng coi như rỗng — không gọi API, giữ nguyên kết quả đang hiển thị.
- **Payload:** request search chỉ gửi keyword (+ filter đang áp dụng); KHÔNG kèm bất kỳ định danh người dùng nào — surface public cross-tenant (Negative scope, header).

---

### `/discover/:sessionId` — Public Session Detail

```
┌──────────────────────┐
│ [← Quay lại] Detail  │
├──────────────────────┤
│                      │
│  🏸 Cầu lông         │
│  Khu vực: Q.Bình     │
│  Thạnh               │
│                      │
│  📅 Thứ 5, 06/08     │
│  ⏰ 19:00 - 21:00    │
│  💰 120,000đ          │
│  👥 5 chỗ trống       │
│                      │
│  CLB: Rồng Xanh      │
│  Host: Nguyễn A       │
│                      │
│  Join: Tự động        │
│                      │
│  [    Tham gia    ]   │
│                      │
│  ⚠️ "Địa chỉ cụ thể  │
│  chỉ hiện khi trạng   │
│  thái tham gia active"│
│                      │
└──────────────────────┘
```

#### States

- **Loading:** Skeleton info card
- **Ready:** Session info (whitelist fields only) + Join CTA
- **Full:** "Hết chỗ" — CTA disabled hoặc "Xếp hàng chờ"
- **Joined active:** Sau server-confirmed `active`, FE mới được fetch/render exact venue bằng protected contract
- **Waitlisted / pending / rejected / unknown:** Giữ public area only; không render exact venue
- **Expired/Gone:** "Buổi chơi không còn khả dụng" + CTA "Quay lại khám phá"
- **Error:** Retry

#### Error mapping

| Status | Error code | Visible state | i18n `t(vi, en)` |
|---|---|---|---|
| 429 | `DISCOVERY_RATE_LIMITED` | Banner rate-limit + countdown trên detail; không auto-retry trước khi hết countdown | `t("Quá nhiều truy vấn — thử lại sau", "Too many requests — try again shortly")` |
| — | `UNPINNED error catalog — omit active UI` | Join mutation outcome và protected venue DTO chưa pin: JoinButton + exact venue absent ở baseline, không fetch và không render error surface | `N/A — surface omitted` |
| — | *(unknown / missing / timeout)* | **Fail closed** — unavailable placeholder + retry; không suy ra `active`, không mở exact venue, không render Full/Joined | `t("Không tải được buổi chơi. Thử lại.", "Couldn't load this session. Try again.")` |

> **Error mapping:** Pin server error/status → exact visible state. Unknown/missing response fail closed;
> không invent success, zero, empty hoặc disabled control. Nếu BE chưa pin catalog cho một endpoint,
> ghi `UNPINNED error catalog — omit active UI` thay vì bịa mã.

#### Responsive

| Breakpoint | Public Session Detail |
|---|---|
| 1440px | §7 chỉ pin "Desktop = modal overlay **hoặc** separate page" — hai lựa chọn chưa chốt, và §3 chỉ có một wireframe dọc không ghi bề rộng. Không tự chọn một trong hai và không tự đặt kích thước modal |
| 768px | File chỉ pin hai hình thức ("Mobile = full screen" và "Desktop = modal overlay hoặc separate page") và **không pin ngưỡng chuyển giữa chúng** — không tự đặt số |
| 375px | Full-screen (§7): [← Quay lại] + tiêu đề trên cùng; khối info một cột theo đúng thứ tự wireframe (môn · khu vực · ngày · giờ · giá · chỗ trống · CLB · Host · Join policy); CTA "Tham gia" full width; VenueNote nằm ngay dưới CTA. Baseline omit không đổi theo breakpoint — JoinButton và exact venue absent ở mọi kích thước tới khi join mutation outcome + protected venue DTO được pin; chỉ hiện khu vực coarse, không địa chỉ, và slot chỉ là `slots_open` không denominator |

---

## 4. Components Used

| Component | States | Mô tả |
|---|---|---|
| `MarketplaceCard` | default, hover (lift), full (slots=0), expired | Card kèo public — sport icon + area + time + price + slots + join CTA |
| `FilterChips` | default, active (selected filter), dropdown open | Chip filter — dropdown khi tap |
| `SportFilter` | all, specific sport selected | Dropdown sport icons + names |
| `AreaFilter` | all, specific area | Dropdown quận/khu vực |
| `DateFilter` | Hôm nay, Tuần này, Tháng này, Custom | Date range presets |
| `PriceFilter` | range slider hoặc presets | <100k, 100-200k, >200k |
| `SlotsBadge` | available (green), few-left (orange), full (red) | "5 chỗ trống" (chỉ `slots_open`, KHÔNG denominator) — color by availability |
| `JoinButton` | omitted; future default/loading/active/waitlisted/pending/rejected/full | Current join response unpinned; future chỉ render exact server outcome và chỉ `active` là joined success |
| `PublicDetailCard` | loading, ready, expired | Detail kèo public — whitelist info |
| `VenueNote` | info box | "Địa chỉ chỉ hiện khi trạng thái tham gia active" |

---

## 5. Edge Cases (UX)

| # | Case | Hiển thị |
|---|---|---|
| 1 | Kèo full khi đang xem | Realtime update: badge → "Hết chỗ", CTA disabled hoặc "Xếp hàng" |
| 2 | Kèo bị close/cancel khi đang xem | Toast "Buổi chơi đã đóng" + redirect về browse |
| 3 | User chưa login click Join | Redirect login → quay lại detail → join |
| 4 | Filters trả 0 results | Empty state + "Xoá bộ lọc" CTA |
| 5 | Khu vực player chưa có kèo | "Chưa có kèo ở khu vực này" + gợi ý khu vực lân cận |
| 6 | Session nguồn có nhiều price rule | Public projection vẫn render một scalar public price do server trả; không tự derive range |
| 7 | Rate limit hit | "Quá nhiều truy vấn" + countdown + retry |
| 8 | Session detail 404 (deleted/expired) | "Buổi chơi không còn khả dụng" + back CTA |
| 9 | Scraping/bot detection | CAPTCHA challenge sau threshold |
| 10 | Cards load slow (image heavy) | Content-visibility: auto + lazy load cards below fold |
| 11 | Join outcome waitlisted/pending/rejected | Render exact outcome (`waitlisted` có thể là approved-but-waitlisted); chỉ public area, exact venue vẫn hidden |

---

## 6. Data hiển thị

| Field | Exact response path | Format | i18n `t(vi, en)` | Ghi chú |
|---|---|---|---|---|
| Sport | `UNPINNED public HTTP DTO — omit active UI` | Icon + text | `t("Cầu lông", "Badminton")` · `t("Bóng đá", "Football")` · `t("Tennis", "Tennis")` | Source whitelist field `sport_key`; response naming cần build-slice pin |
| Area | `UNPINNED public HTTP DTO — omit active UI` | Text | Nhãn `t("Khu vực", "Area")`; giá trị: `data — no copy` | Source whitelist field `area`; không address |
| Time | `UNPINNED public HTTP DTO — omit active UI` | "T5 19:00" or "CN 08:00" | N/A — locale formatter | Source whitelist field `starts_at` |
| Price | `UNPINNED public HTTP DTO — omit active UI` | "120,000đ" | N/A — currency formatter | Source whitelist field `price_amount`; FE không derive gender/range |
| Slots | `UNPINNED public HTTP DTO — omit active UI` | "{slotsOpen} chỗ trống" | `t("chỗ trống", "slots left")` | Source whitelist field `slots_open`; không hiện denominator |
| Club name | `UNPINNED public HTTP DTO — omit active UI` | Text | Nhãn `t("CLB", "Club")`; giá trị: `data — no copy` | Source whitelist field `club_display_name` |
| Host name | `UNPINNED public HTTP DTO — omit active UI` | Text | Nhãn `t("Host", "Host")`; giá trị: `data — no copy` | Source whitelist field `host_display_name`; không fallback raw identity |
| Join outcome | `UNPINNED cross-club join mutation response — omit JoinButton action/state` | Closed outcome | `t("Đã tham gia", "Joined")` · `t("Đã vào danh sách chờ", "On the waitlist")` · `t("Đang chờ duyệt", "Awaiting approval")`; `rejected`: `N/A — surface omitted` | Future owner phải pin exact `active | waitlisted | pending | rejected` response path và unknown mapping |
| Join policy | `UNPINNED public HTTP DTO — omit active UI` | Nhãn + text | Nhãn `t("Tham gia", "Join")`; giá trị `t("Tự động", "Automatic")` (`open`) · `t("Cần duyệt", "Needs approval")` (`approval`) | Source whitelist field `join_policy` (`feature_marketplace_discovery.md:98`, giá trị `open`/`approval`); response naming cần build-slice pin. Không suy join policy từ CTA state và không tự map sang outcome — outcome vẫn do join mutation trả |
| Protected venue | `UNPINNED active-only venue DTO — omit exact venue` | Text | `data — no copy` | Chỉ future authenticated fetch sau canonical `active`; public UI luôn dùng coarse area |

#### Filter copy (i18n)

Chuỗi static do file này authorize (nhãn filter bar + chip + preset). Không có response path — đây là copy, không phải DTO field. Riêng **danh sách option** (môn nào, khu vực nào) là data từ public DTO nên vẫn `UNPINNED — omit active UI`.

| Chuỗi (vị trí) | i18n `t(vi, en)` |
|---|---|
| Filter chip/bar "Môn" (§3 desktop filter bar) | `t("Môn", "Sport")` |
| Filter chip/bar "Khu vực" (§3 desktop filter bar) | `t("Khu vực", "Area")` |
| Filter chip/bar "Ngày" (§3 desktop filter bar) | `t("Ngày", "Date")` |
| Filter chip/bar "Giá" (§3 mobile + desktop filter bar) | `t("Giá", "Price")` |
| Filter chip/bar "Chỗ trống" (§3 desktop filter bar) | `t("Chỗ trống", "Slots left")` |
| Sport filter option "Tất cả" (§3 mobile chip, §4 `SportFilter`) | `t("Tất cả", "All")` |
| Date preset "Hôm nay" (§3 mobile chip, §4 `DateFilter`) | `t("Hôm nay", "Today")` |
| Date preset "Tuần này" (§4 `DateFilter`) | `t("Tuần này", "This week")` |
| Date preset "Tháng này" (§4 `DateFilter`) | `t("Tháng này", "This month")` |
| Date preset "Custom" (§4 `DateFilter`) | `t("Tuỳ chọn", "Custom")` |
| CTA "Xoá bộ lọc" (§3 Empty state, §5 edge case 4) | `t("Xoá bộ lọc", "Clear filters")` |
| CTA "Mở rộng bộ lọc" (§3 Empty state — Draft bổ sung) | `t("Mở rộng bộ lọc", "Broaden filters")` |
| Hint search "Nhập ít nhất 2 ký tự" (§3 Search behavior — Draft) | `t("Nhập ít nhất 2 ký tự", "Type at least 2 characters")` |

> **i18n:** Mọi chuỗi user-facing ở file này đi qua `t(vi, en)` (`packages/core/src/i18n.ts`). Repo không có key-based i18n; cặp vi/en ở cột trên là chuỗi thật, không phải key.

---

## 7. Responsive & Interaction Notes

- **Grid:** Desktop = 3 columns `repeat(auto-fit, minmax(300px, 1fr))`. Mobile = 1 column full width
- **Filter chips:** Horizontal scrollable on mobile. Sticky under header
- **Cards hover:** Lift shadow + scale 1.02 (desktop). Tap feedback (mobile)
- **Infinite scroll:** Load 12 cards at a time. Skeleton loading at bottom
- **Bottom Nav FAB:** Center tab "🔍 Khám phá" — slightly raised/highlighted
- **Detail page:** Mobile = full screen. Desktop = modal overlay hoặc separate page
- **Join CTA:** Omit ở baseline. Future: full width; exact response `active` → "✅ Đã tham gia" + protected venue/detail, `waitlisted` → "Đã vào danh sách chờ", `pending` → "Đang chờ duyệt", `rejected` → rejected state; không gộp thành generic success
- **Dark mode:** Card bg `var(--bg-card)`, sport icon colors consistent
- **Performance:** `content-visibility: auto` cho off-screen cards, `fetchpriority: high` cho above-fold

---

## Analytics Events (Draft — đề xuất, chưa phải contract)

> Đề xuất instrumentation, chưa phải contract — event name/param chưa pin với analytics pipeline.
> **Param policy (bắt buộc):** CẤM amount/giá, CẤM PII (tên, email, số điện thoại, query text tự do),
> CẤM toạ độ/địa chỉ. Chỉ cho phép: **opaque id, enum, count, boolean**. Surface public cross-tenant —
> xem Negative scope (header) và §6.

| Event (đề xuất) | Trigger | Params (chỉ opaque id / enum / count / boolean) | Trace |
|---|---|---|---|
| `marketplace_browse_viewed` | Vào `/discover` | `filter_count` (count), `has_query` (boolean) | §2 Flow 1, §3 |
| `marketplace_search_performed` | Request search phát đi sau debounce | `query_length` (count), `results_returned` (boolean) — KHÔNG gửi query text | §3 Search behavior (Draft) |
| `marketplace_filter_applied` | User áp 1 filter | `filter_type` (enum: `sport\|area\|date\|price\|slots`), `filter_count` (count) | §3 Filter bar, §4 FilterChips |
| `marketplace_filter_cleared` | CTA "Xoá bộ lọc" | `source` (enum: `filter_bar\|empty_state\|error_banner`) | §3 States Empty, §3 Error mapping 400, §5 case 4 |
| `marketplace_filter_broadened` | CTA "Mở rộng bộ lọc" (Draft) | `removed_filter_type` (enum), `remaining_filter_count` (count) | §3 States Empty (Draft bổ sung) |
| `marketplace_card_clicked` | Tap card → detail | `session_id` (opaque id), `card_position` (count) | §2 Flow 2, §4 MarketplaceCard |
| `marketplace_detail_viewed` | Vào `/discover/:sessionId` | `session_id` (opaque id) | §3 Public Session Detail |
| `marketplace_load_more` | Trigger `LOADING_MORE` | `page_index` (count) | §7 Infinite scroll, §3 Loading states (Draft) |
| `marketplace_rate_limited` | Banner 429 render | `surface` (enum: `browse\|detail`) | §3 Error mapping (browse + detail) |
| `marketplace_join_clicked` | *(future — JoinButton omit ở baseline)* | `session_id` (opaque id); outcome params TBD (UNPINNED) tới khi join mutation response được pin | §4 JoinButton, §6 Join outcome |

---

## State Machine (Draft)

> Chỉ dùng state đã pin ở §3 + 3 state client-local từ "Loading states (Draft)". State client-local
> đánh dấu `[CL]` — **(client-local, không phải BE token)**. Transition suy từ Flow §2, States §3,
> Edge cases §5; thiếu căn cứ trong file → ghi `TBD (UNPINNED)`, không tự đặt.

### `/discover` — Browse

States: `LOADING [CL]` · `LOADING_MORE [CL]` · `REFRESHING [CL]` · `READY` · `EMPTY` · `ERROR` · `RATE_LIMITED` (§3 States + §3 Loading states Draft)

```
entry (/discover)              → LOADING                                     (§2 Flow 1)
LOADING  —fetch ok, ≥1 kết quả→  READY                                       (§3 States)
LOADING  —fetch ok, 0 kết quả→   EMPTY                                       (§5 case 4; fail KHÔNG render EMPTY — §3 Error mapping)
LOADING  —fail closed→           ERROR                                       (§3 Error mapping)
LOADING  —429→                   RATE_LIMITED                                (§3 Error mapping)
READY    —scroll cuối list→      LOADING_MORE → READY (append 12 cards)      (§7 Infinite scroll)
READY    —manual refresh→        REFRESHING → READY                          (§3 Loading states Draft)
LOADING_MORE/REFRESHING —fail→   READY (giữ stale cards + banner/retry)      (§3 Error mapping fail closed)
READY|EMPTY —đổi filter / search query hợp lệ→ refetch                       (§2 Flow 1, §3 Search behavior Draft;
                                                                              hiển thị trong lúc refetch: TBD (UNPINNED) —
                                                                              file chưa pin giữ list cũ hay skeleton)
EMPTY    —CTA "Xoá bộ lọc" | "Mở rộng bộ lọc"→ LOADING                       (§3 States Empty + Draft bổ sung)
RATE_LIMITED —countdown hết + user retry→ LOADING                            (§3 Error mapping: không auto-retry trước khi hết countdown)
ERROR    —retry→                 LOADING                                     (§3 States Error)
```

### `/discover/:sessionId` — Detail

States: `LOADING [CL]` · `READY` · `FULL` · `JOINED_ACTIVE` · `WAITLISTED / PENDING / REJECTED / UNKNOWN` · `EXPIRED_GONE` · `ERROR` (§3 Detail States)

- `FULL` là derive client-side từ `slots_open = 0` (§4 `MarketplaceCard` full, §4 `SlotsBadge`), KHÔNG phải BE status token — canonical status không có FULL.
- 429 trên detail là banner overlay theo Error mapping §3 (detail), không phải state riêng.

```
entry (/discover/:id)   → LOADING                                            (§3 Detail States)
LOADING —ok→              READY | FULL (slots_open = 0)                      (§3 Detail States)
LOADING —404/expired→     EXPIRED_GONE                                       (§5 case 8)
LOADING —fail closed→     ERROR                                              (§3 Detail Error mapping)
READY   —realtime slots_open → 0→ FULL                                       (§5 case 1)
READY|FULL —realtime close/cancel→ EXPIRED_GONE (toast + redirect browse)    (§5 case 2)
READY   —join outcome→    JOINED_ACTIVE | WAITLISTED | PENDING | REJECTED    (FUTURE — join mutation response
                                                                              UNPINNED, JoinButton omit ở baseline §4;
                                                                              chỉ render exact server outcome; unknown
                                                                              outcome → giữ public area, fail closed —
                                                                              §2 Flow 2, §3 Detail States)
JOINED_ACTIVE (only)    → fetch/render exact venue qua protected contract    (§2 Flow 2 bước 5, §6 Protected venue)
```

---

## Acceptance Criteria (Draft)

| # | Criterion | Trace |
|---|---|---|
| AC-1 | Gõ liên tục trong ô search: không có request trung gian; đúng 1 request phát đi sau 300ms kể từ keystroke cuối | §3 Search behavior (Draft) |
| AC-2 | Phát query mới khi request cũ đang bay: request cũ bị abort qua `AbortController`; UI chỉ render response của request mới nhất | §3 Search behavior (Draft) |
| AC-3 | Query < 2 ký tự (sau trim): không gọi API + hiện hint `t("Nhập ít nhất 2 ký tự", "Type at least 2 characters")` | §3 Search behavior (Draft), §6 Filter copy |
| AC-4 | Query toàn khoảng trắng: không gọi API, giữ nguyên kết quả đang hiển thị | §3 Search behavior (Draft) |
| AC-5 | Request search không chứa bất kỳ định danh người dùng nào | §3 Search behavior (Draft), Negative scope (header) |
| AC-6 | Empty state (0 kết quả, có ≥1 filter): render đủ 2 CTA; "Mở rộng bộ lọc" gỡ đúng filter áp dụng gần nhất rồi refetch; "Xoá bộ lọc" gỡ toàn bộ filter | §3 States Empty (+ Draft bổ sung), §5 case 4 |
| AC-7 | `LOADING` lần đầu: skeleton; `LOADING_MORE`: giữ list + spinner cuối; `REFRESHING`: giữ list + indicator — list hiện tại không bị clear ở 2 trạng thái sau | §3 Loading states (Draft), §7 Infinite scroll |
| AC-8 | Fail trong `LOADING_MORE`/`REFRESHING`: giữ stale cards + banner/retry, không render Empty | §3 Error mapping, §3 Loading states (Draft) |
| AC-9 | Slots luôn chỉ render `slots_open`, không denominator | §3 Responsive, §4 SlotsBadge, §6 Slots |
| AC-10 | Không fetch/render exact venue trước canonical `active` | §2 Flow 2, §3 Detail States, §6 Protected venue |
| AC-11 | 429: countdown + không auto-retry trước khi hết countdown + giữ stale cards nếu có | §3 Error mapping |
| AC-12 | Mọi analytics event chỉ mang opaque id/enum/count/boolean — không amount, không PII, không toạ độ, không query text | Analytics Events (Draft) |

---

## Testing Notes (Draft)

- **Debounce timing (fake timers):** gõ "cau" từng ký tự cách 100ms → 0 request cho tới 300ms sau ký tự cuối → đúng 1 request; keystroke mới trong cửa sổ 300ms reset timer (assert không có request tại mốc 300ms tính từ ký tự trước đó).
- **Abort race:** mock request 1 trả chậm, phát query 2 → assert request 1 nhận abort signal; response request 2 được render; nếu mock để response 1 vẫn resolve sau đó → assert không ghi đè kết quả của request 2.
- **2-char threshold:** 1 ký tự → không có request + hint hiển thị; 2 ký tự → có request; `"  a  "` (trim còn 1 ký tự) → không có request; chuỗi toàn khoảng trắng → không có request, kết quả hiện tại giữ nguyên.
- **Empty-state CTA:** mock response 0 kết quả với ≥1 filter đang áp → render đủ 2 CTA; click `t("Mở rộng bộ lọc", "Broaden filters")` → filter gần nhất bị gỡ + refetch phát đi; click `t("Xoá bộ lọc", "Clear filters")` → toàn bộ filter bị gỡ + refetch; không có filter đang áp → CTA "Mở rộng bộ lọc" không render.
- **Client-local loading states:** `LOADING_MORE`/`REFRESHING` không unmount list hiện có (assert node card đầu tiên giữ nguyên); fail ở 2 trạng thái này không render Empty.
- **i18n:** hint + 2 CTA đi qua `t(vi, en)` đúng convention §6.

---

_FE Design Spec v0.2 · 2026-07-31 · Source: feature_marketplace_discovery.md v2.4_
_FE Design Spec v0.3 · 2026-08-07 · Thêm search behavior spec + empty-state 2 CTA + phân tách loading states + 4 section Draft — nguồn: Sporta FE porting analysis 2026-08-07_
_FE Design Spec — 2026-09-08 (cấu trúc, không bump version): thêm khối 📍 Đọc nhanh dưới header — feature nguồn · phase-1 (DD-114) · launch (DD-113) · surface PWA trước, native iOS/Android phase-2 (DD-69) · FE PENDING (DD-116) · as-built @ `e235ea4`. Pointer core docs BRD v3.10 · PRD v2.9 · TDD v3.2 · ROADMAP v3.17. Nội dung thiết kế không đổi._

_Re-pin 2026-09-15 (cấu trúc, không bump version): as-built @ `e235ea4` theo `ROADMAP.md` v3.17 §📍 — 8 command session · 7 route nghiệp vụ · **0 màn FE**; FE PENDING (DD-116) không đổi, DD-119 vẫn 🟡 chưa ratify. Nội dung thiết kế không đổi._
