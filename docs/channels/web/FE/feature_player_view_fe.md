# Feature: Player View (/me) — FE Design Spec

> **Route(s):** `/me` · `/me/clubs/:clubId` · `/me/charges`
> **Source authority:** `../../../features/FE/feature_player_view.md` v2.7 · baseline `0c5808fc7cf50d139bdd9c4ee79917bf4059c4f4`
> **Source contract status:** Reviewed
> **Projection/API contract:** Canonical `SelfPaymentStatus` for `/api/me/charges`; club-detail DTO (`GET /api/me/clubs/:id`) và join-request HTTP route `UNPINNED`
> **Capability/availability:** Authenticated person-self only; no arbitrary person/tenant input
> **Priority:** 10 — designer-kickoff.md §3B
> **FE design status:** Draft
> **Runtime status:** Not started — person-self service/routes/UI chưa build
> **Negative scope:** Không cache person-self DTO; không tự render QR; không arbitrary person/tenant input

> 📍 **Đọc nhanh (cập nhật 2026-09-15 — chỉ mục, không phải authority):** feature nguồn `../../../features/FE/feature_player_view.md`; scope/phase đọc ở `BRD.md` v3.10 §📍 · hành vi `PRD.md` v2.9 §📍 · contract `TDD.md` v3.2 §📍 · **tiến độ thật `ROADMAP.md` v3.17 §📍** (mốc `main@e235ea4`, 15/09).
>
> **Phase-1 (DD-114):** 🟡 session detail (nhóm 6) · **Launch (DD-113):** ✅ **khối 4/5 session detail**
>
> **Surface:** Web app **PWA** (Next.js App Router, installable/offline — DD-113 launch = PWA + Zalo bot song song) — `/me` · `/me/clubs/:clubId` · `/me/charges`; **app native iOS (App Store) + Android (CH Play) là phase-2** (DD-69): tái dùng API/contract, màn native thiết kế lại theo platform sau gate, **không phải bản sao màn này**.
>
> **Trạng thái:** FE design Draft · 🔴 **FE PENDING (DD-116)** — không mở page/component, không track `.pen` tới khi đủ cả ba vế (chọn đúng một `.pen` canonical · tracked trên `main` · owner ký gate DD-81) · as-built @ `main@e235ea4`: **0 màn FE nối API** (đúng 1 `apps/web/app/page.tsx`); BE: person-self route ⬜.

---

## 1. Mô tả

Trang cá nhân cho player: xem CLB đang tham gia, kèo sắp tới, tình trạng nợ/thanh toán — xuyên CLB. Dữ liệu chỉ của chính mình (person-self), KHÔNG xem được của người khác. Truy cập qua đăng nhập web hoặc magic link từ bot.

---

## 2. User Flows

### Flow 1: Xem dashboard cá nhân

1. Player đăng nhập → vào `/me`
2. Thấy: danh sách CLB mình tham gia + tổng nợ + kèo sắp tới
3. Click CLB → chi tiết CLB (sessions + charges)
4. Click charge → chi tiết thanh toán

### Flow 2: Truy cập từ magic link (bot)

1. Player nhận magic link trên Zalo/Messenger
2. Click → browser mở `/me` (auto-authenticated)
3. Thấy cùng dashboard như web login

### Flow 3: Xem chi tiết nợ

1. Click "Còn nợ 85,000đ" → `/me/charges`
2. Thấy canonical outstanding items theo CLB + session
3. Mỗi item hiện `amountDue`, `amountAllocated`, `remaining` và status `open | partial`
4. Optional `payAction` nằm trong từng per-club `SelfPaymentStatus`, nên FE render tối đa một protected CTA cho đúng club status; không có global action, không gắn action per item và không render QR/STK/pay code
5. Paid/void/history cần DTO owner riêng; current outstanding projection không authorize history UI

### Flow 4: Xem join requests của chính mình

1. Từ `/me`, mở panel "Yêu cầu tham gia"
2. FE fetch person-self join-request DTO; không nhận arbitrary person/tenant input
3. Render `pending | approved | rejected | expired` đúng như server trả; không tự suy outcome từ membership/session

---

## 3. Screens & States

### `/me` — Player Dashboard

> **Visual fixture only (chips):** Hai chip `💸 85k nợ` và `📅 3 kèo tuần` trong cả hai wireframe chỉ kiểm tra hierarchy/spacing. §6 chốt cả hai là `UNPINNED — omit`: cross-club debt aggregate và person-self sessions DTO chưa có owner. Baseline phải omit chip hoặc render neutral unavailable placeholder; không render 0, không sum `data.clubs[]` ở client, không dùng fixture làm seed/default/fallback. Quy tắc màu chip nợ bên dưới là design target sau khi owner contract tồn tại, không phải authority để fetch/implement.

#### Layout (Mobile-first 375px)

```
┌──────────────────────┐
│ 👤 Xin chào, Trần B  │
├──────────────────────┤
│ Chips:                │
│ ┌────────┐ ┌────────┐│
│ │💸 85k  │ │📅 3 kèo││
│ │ nợ     │ │ tuần   ││
│ └────────┘ └────────┘│
├──────────────────────┤
│ CLB của tôi          │
│ ┌──────────────────┐ │
│ │ 🏸 CLB Rồng Xanh │ │
│ │ Player · 5 kèo    │ │
│ │ Nợ: 85,000đ 🔴    │ │
│ └──────────────────┘ │
│ ┌──────────────────┐ │
│ │ ⚽ FC Phượng Hoàng│ │
│ │ Player · 3 kèo    │ │
│ │ Nợ: 0đ ✅          │ │
│ └──────────────────┘ │
├──────────────────────┤
│ Kèo sắp tới          │
│ • 🏸 BM T5 · 19:00   │
│ • ⚽ Bóng CN · 08:00  │
│ • 🏸 BM T2 · 20:00   │
│ [Tất cả →]            │
├──────────────────────┤
│ Bottom Nav            │
└──────────────────────┘
```

#### Layout (Desktop 1440px)

```
┌──────────────────────────────────────────────────────────────┐
│  Header: "Hồ sơ cá nhân" · 👤 Trần Thị B                   │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  Chips: [💸 Còn nợ: 85,000đ] [📅 Kèo tuần này: 3]          │
│                                                              │
│  ┌────────────────────────┬──────────────────────────────────┤
│  │                        │                                  │
│  │  CLB của tôi           │  Kèo sắp tới                    │
│  │                        │                                  │
│  │  🏸 CLB Rồng Xanh     │  • 🏸 BM T5 · 19:00 · 85k ⚠️   │
│  │  Player · Nợ: 85k 🔴  │  • ⚽ Bóng CN · 08:00 · 0đ ✅    │
│  │                        │  • 🏸 BM T2 · 20:00 · 120k ⚠️  │
│  │  ⚽ FC Phượng Hoàng    │                                  │
│  │  Player · Nợ: 0đ ✅    │  [Tất cả →]                      │
│  │                        │                                  │
│  └────────────────────────┴──────────────────────────────────┤
└──────────────────────────────────────────────────────────────┘
```

#### States

- **Loading:** Skeleton chips + skeleton club cards + skeleton session rows
- **Ready:** Club list + upcoming sessions. Chips omit ở baseline (`UNPINNED` — xem fence trên); design target khi có owner contract: chip nợ đỏ nếu >0, xanh nếu proven `known_zero`
- **Empty (chưa tham gia CLB):** "Chưa tham gia CLB nào" + CTA "🔍 Khám phá kèo" → marketplace
- **Error:** Error banner + retry. Payment truth `unknown` → chip tiền hiện "—" + retry
- **Account merged:** Banner "🔄 Tài khoản đã được gộp — dữ liệu đã cập nhật"

#### Error mapping

| Status | Error code | Visible state | i18n `t(vi, en)` |
|---|---|---|---|
| 401 | `AUTH_REQUIRED` | Không render chips/club/upcoming; redirect login kèm note; không hiện 0 và không đọc cached person-self | `t("Đăng nhập để xem thông tin cá nhân", "Sign in to see your personal info")` |
| 400 | `MAGIC_LINK_INVALID` | Magic-link entry dừng tại màn lỗi generic + CTA "Yêu cầu link mới"; không mint session, không render person-self data | `t("Link đã hết hạn", "This link has expired")` |
| 403 | `TOPIC_UNAUTHORIZED` | Đóng SSE subscription, không resubscribe topic khác; quay về authenticated refetch, không đọc cached snapshot | `t("Không theo dõi được cập nhật realtime", "Can't subscribe to live updates")` |
| — | *(unknown / missing / timeout)* | **Fail closed** — unavailable placeholder + retry; chip tiền hiện "—", KHÔNG hiện 0 và không render cached person-self | `t("Không tải được thông tin cá nhân. Thử lại.", "Couldn't load your info. Try again.")` |

> **Error mapping:** Pin server error/status → exact visible state. Unknown/missing response fail closed;
> không invent success, zero, empty hoặc disabled control. Nếu BE chưa pin catalog cho một endpoint,
> ghi `UNPINNED error catalog — omit active UI` thay vì bịa mã.

#### Responsive

| Breakpoint | Player Dashboard |
|---|---|
| 1440px | Header "Hồ sơ cá nhân" + 👤 tên; hàng chips ngay dưới header; thân 2 cột — trái "CLB của tôi" (club card xếp dọc), phải "Kèo sắp tới" + [Tất cả →] (§7); club card hover lift (§7); không có bottom nav |
| 768px | File chỉ pin hai hình thức — mobile-first 375px một cột và desktop 1440px hai cột — và **không pin** ngưỡng chuyển giữa chúng; không tự đặt số |
| 375px | Composition chính (mobile-first): một cột xếp dọc — lời chào · 2 chip cạnh nhau · "CLB của tôi" · "Kèo sắp tới" + [Tất cả →] · bottom nav; chips sticky top (§7); mọi phần tử tương tác ≥ 44px (§7). Chips omit không đổi theo breakpoint — §6 chốt cross-club debt aggregate và person-self sessions DTO là `UNPINNED — omit` (fence đầu §3), nên baseline omit chip hoặc render neutral unavailable placeholder ở mọi kích thước; không render 0, không sum `data.clubs[]` ở client, và payment truth `unknown` hiện "—" + retry |

---

### `/me/clubs/:clubId` — Chi tiết một CLB

Source authorize surface này: `feature_player_view.md` §3 hàng "Web | /me — club detail" (Sessions + charges for this club) và BE §3 pin endpoint `GET /api/me/clubs/:id`. Response DTO chưa có ví dụ/pin nào, nên baseline chỉ author states + error mapping, không author field list.

#### Layout

```
┌──────────────────────┐
│ [← /me] {CLB name}   │
├──────────────────────┤
│ Buổi chơi của tôi     │
│ (list — UNPINNED)     │
├──────────────────────┤
│ Khoản phải trả        │
│ (list — UNPINNED)     │
├──────────────────────┤
│ Bottom Nav            │
└──────────────────────┘
```

> **Visual fixture only:** Không có DTO owner cho club-detail response; hai zone trên phải omit hoặc render neutral unavailable placeholder ở baseline. Không tái dùng `/me/charges` DTO để dựng zone "Khoản phải trả" của màn này — đó là owner khác.

#### States

- **Loading:** Skeleton sessions + skeleton charges (chỉ khi DTO owner tồn tại)
- **Ready:** Sessions + charges của đúng CLB đó, own-data allowlist only — không roster/debt người khác
- **Empty:** "Chưa có buổi chơi" — `t("Chưa có buổi chơi", "No sessions yet")`
- **Unavailable (baseline):** Zone omit hoặc neutral "Chi tiết CLB chưa khả dụng" — `t("Chi tiết CLB chưa khả dụng", "Club details aren't available yet")`; không render 0, không suy từ `/me`
- **Error:** Error banner + retry
- **No-disclosure boundary:** CLB không thuộc own membership → generic no-access, KHÔNG lộ club tồn tại hay không, không lộ tên/thông tin CLB

#### Error mapping

| Status | Error code | Visible state | i18n `t(vi, en)` |
|---|---|---|---|
| 401 | `AUTH_REQUIRED` | Không render club detail; redirect login; không đọc cached person-self | `t("Đăng nhập để xem thông tin cá nhân", "Sign in to see your personal info")` |
| — | `UNPINNED error catalog — omit active UI` | Club-detail response DTO chưa được owner pin: màn không fetch, không render error surface — zone absent hoàn toàn ở baseline | `N/A — surface omitted` |
| — | *(unknown / missing / timeout)* | **Fail closed** — unavailable placeholder + retry; không render Empty, không suy sessions/charges từ `/me`, không lộ club tồn tại hay không | `t("Không tải được thông tin CLB. Thử lại.", "Couldn't load this club. Try again.")` |

> **Error mapping:** Pin server error/status → exact visible state. Unknown/missing response fail closed;
> không invent success, zero, empty hoặc disabled control. Nếu BE chưa pin catalog cho một endpoint,
> ghi `UNPINNED error catalog — omit active UI` thay vì bịa mã.

#### Responsive

| Breakpoint | Chi tiết một CLB |
|---|---|
| 1440px | File chỉ vẽ **một** wireframe dọc cho màn này, và §7 chỉ pin bố cục 2 cột cho `/me` (clubs trái · upcoming phải) chứ không cho club detail — không tự dựng 2 cột, panel hay bảng cho breakpoint này |
| 768px | Không có wireframe hay ngưỡng nào được pin cho dải này — không tự đặt số |
| 375px | Một cột theo wireframe: [← /me] + {CLB name} trên cùng · zone "Buổi chơi của tôi" · zone "Khoản phải trả" · bottom nav. Baseline omit không đổi theo breakpoint — club-detail response DTO chưa có owner nên hai zone omit hoặc hiện neutral "Chi tiết CLB chưa khả dụng" ở mọi kích thước; không suy từ `/me`, không tái dùng DTO của `/me/charges` để dựng zone "Khoản phải trả", và CLB ngoài own membership vẫn là generic no-access |

---

### `/me/charges` — Chi tiết nợ

```
┌──────────────────────┐
│ [← /me] Thanh toán    │
├──────────────────────┤
│ CLB Rồng Xanh         │
│ Còn lại: 85,000đ      │
│ [Thanh toán CLB này]  │
│ (status.payAction,    │
│  nếu server trả)      │
│ ┌──────────────────┐ │
│ │ BM T5 · partial   │ │
│ │ Phải trả: 120,000│ │
│ │ Đã gán:    35,000│ │
│ │ Còn lại:   85,000│ │
│ └────────────────────┘ │
├──────────────────────┤
│ Bottom Nav            │
└──────────────────────┘
```

> ⚠️ **Contract:** FE KHÔNG tự render QR/STK/pay_code. Mỗi club wrapper có một `status: SelfPaymentStatus`; optional CTA của club đó dùng đúng `data.clubs[].status.payAction`. Không có global/top-level pay action và không gắn action per item. Toàn bộ person-self DTO không được cache offline.

#### States

- **Loading:** Skeleton charge cards
- **Ready:** Group theo CLB; mỗi club `known_amount` có outstanding items `open | partial` + allocation breakdown và tối đa một CTA từ chính `status.payAction`
- **Empty (proven 0):** "Không còn khoản phải trả 🎉" (chỉ khi `known_zero`)
- **Unknown:** "Không thể kiểm tra lúc này" + retry CTA — KHÔNG hiện 0
- **Error:** Retry
- **History boundary:** Không render paid/void/history trong surface này tới khi có separate Reviewed history DTO

#### Error mapping

| Status | Error code | Visible state | i18n `t(vi, en)` |
|---|---|---|---|
| 401 | `AUTH_REQUIRED` | Không render outstanding items/CTA; redirect login; không hiện 0 và không đọc cached charges | `t("Đăng nhập để xem thông tin cá nhân", "Sign in to see your personal info")` |
| — | `status.kind = "unknown"` (DTO state, không phải HTTP error) | Club đó hiện "Không thể kiểm tra lúc này" + retry; KHÔNG hiện 0, không render `known_zero` empty state, không render CTA thanh toán | `t("Không thể kiểm tra lúc này", "Can't check right now")` |
| — | *(unknown / missing / timeout)* | **Fail closed** — unavailable placeholder + retry; không suy remaining, không tự tính lại allocation, không render "Không còn khoản phải trả" | `t("Không tải được khoản phải trả. Thử lại.", "Couldn't load your charges. Try again.")` |

> **Error mapping:** Pin server error/status → exact visible state. Unknown/missing response fail closed;
> không invent success, zero, empty hoặc disabled control. Nếu BE chưa pin catalog cho một endpoint,
> ghi `UNPINNED error catalog — omit active UI` thay vì bịa mã.

#### Responsive

| Breakpoint | Chi tiết nợ |
|---|---|
| 1440px | File chỉ vẽ **một** wireframe dọc cho màn này và không pin composition desktop riêng (§7 chỉ pin 2 cột cho `/me`) — không tự dựng bảng, 2 cột hay modal |
| 768px | Không có wireframe hay ngưỡng nào được pin cho dải này — không tự đặt số |
| 375px | Một cột theo wireframe: [← /me] Thanh toán trên cùng · group theo CLB (tên CLB · "Còn lại" · tối đa **một** CTA "Thanh toán CLB này" khi server trả `status.payAction`) · các item card (session · Phải trả · Đã gán · Còn lại) xếp dọc · bottom nav; số tiền tabular-nums, phần tử tương tác ≥ 44px (§7). Không đổi theo breakpoint — FE không tự render QR/STK/pay code, không có global action và không gắn action per item ở mọi kích thước; `status.kind = "unknown"` hiện "Không thể kiểm tra lúc này" + retry chứ **không** hiện 0, và paid/void/history vẫn ngoài surface này |

---

### Join requests — person-self panel

- **Loading:** Skeleton request rows
- **Ready:** Danh sách request của chính requester với status `pending | approved | rejected | expired`
- **Empty:** "Không có yêu cầu nào"
- **Unknown/Error:** Generic retry; không biến unknown thành empty/rejected
- **Boundary:** Route riêng (nếu có) phải do HTTP owner pin sau; FE spec hiện chỉ author panel trong `/me`, không invent endpoint

#### Error mapping

| Status | Error code | Visible state | i18n `t(vi, en)` |
|---|---|---|---|
| — | `UNPINNED error catalog — omit active UI` | Join-request HTTP route/DTO chưa được owner pin: panel không fetch, không render error surface — absent hoàn toàn ở baseline | `N/A — surface omitted` |
| — | *(unknown / missing / timeout)* | **Fail closed** — generic retry; không biến unknown thành empty, `rejected` hay `expired`, không suy outcome từ membership/session | `t("Không tải được yêu cầu tham gia. Thử lại.", "Couldn't load your join requests. Try again.")` |

> **Error mapping:** Pin server error/status → exact visible state. Unknown/missing response fail closed;
> không invent success, zero, empty hoặc disabled control. Nếu BE chưa pin catalog cho một endpoint,
> ghi `UNPINNED error catalog — omit active UI` thay vì bịa mã.

#### Responsive

| Breakpoint | Join requests panel |
|---|---|
| 1440px | File **không vẽ wireframe** cho panel này (chỉ author states + error mapping) và cũng không pin vị trí của panel trong `/me` — không tự đặt layout, cột hay bề rộng |
| 768px | Không có wireframe hay ngưỡng nào được pin cho dải này — không tự đặt số |
| 375px | Chỉ pin được đúng một điều: panel nằm trong `/me` và mở từ đó (§2 Flow 4); vị trí, thứ tự và kích thước chưa pin nên không tự dựng. Baseline omit không đổi theo breakpoint — join-request HTTP route/DTO chưa được owner pin nên panel không fetch và absent hoàn toàn ở mọi kích thước; không biến unknown thành empty/`rejected`/`expired` |

---

## 4. Components Used

| Component | States | Mô tả |
|---|---|---|
| `PersonChips` | design-only pending owner contract | 2 chips: nợ + kèo tuần. Không implement tới khi cross-club debt aggregate và person-self sessions DTO được pin (§6 `UNPINNED`); future states: loading, ready (values), error (dash) |
| `ClubCard` | default, hover, debt (red badge) | Card CLB: icon + name + role + debt |
| `UpcomingRow` | default, payment dot (🔴 `open`, ⚠️ `partial`), unavailable (— khi `unknown`) | Row kèo sắp tới compact. **Union chỉ `open \| partial`** (`BE/feature_player_view_tech.md:184`) — không có state `paid`, không dùng 🟢. Khoản đã tất toán rời khỏi `SelfPaymentStatus` (v2.7 cố ý để paid/void/left-club ngoài union) |
| `OutstandingItemCard` | open (orange), partial (yellow) | Session + `amountDue` + `amountAllocated` + `remaining`; không có per-item action. State `partial` có thể vẽ progress bar — **presentation thuần** của tỉ lệ `amountAllocated`/`amountDue` server trả; ba con số hiển thị vẫn nguyên từ response, không hiện % như một giá trị tiền mới và không tự tính lại allocation |
| `ClubPayAction` | absent, ready, loading, error | Optional `data.clubs[].status.payAction`; một protected CTA cho đúng club status |
| `JoinRequestList` | loading, ready, empty, unknown | Person-self requests only; `pending | approved | rejected | expired` |
| `MergedBanner` | visible, dismissed | Account merged notification banner |
| `MagicLinkAuth` | validating, success, expired, error | Auth flow cho magic link |

> **Bỏ:** `QRPayment` component — FE không tự render QR/STK.

---

## 5. Edge Cases (UX)

| # | Case | Hiển thị |
|---|---|---|
| 1 | Player chưa login → /me | Redirect login + note "Đăng nhập để xem thông tin cá nhân" |
| 2 | Magic link expired | "Link đã hết hạn" + CTA "Yêu cầu link mới" |
| 3 | Payment truth unavailable | Chip nợ hiện "—" (dash) + retry. KHÔNG hiện 0 |
| 4 | Player vừa host vừa player | CLB card hiện role badge "Host" ưu tiên |
| 5 | Đã rời CLB (left) | Card hiện grayed + "Đã rời" — debt vẫn hiện nếu còn |
| 6 | Nhiều CLB (>5) | Scrollable list — không pagination |
| 7 | Outstanding item partial | Badge "🔄 Partial" + due/allocated/remaining server trả; không tự tính lại ở FE |
| 8 | Account merge xảy ra realtime | SSE cập nhật + toast "Tài khoản đã gộp" |
| 9 | Offline | Banner "Cần kết nối để xem thông tin cá nhân". Không render cached clubs/upcoming/charges/requests vì toàn bộ person-self DTO đều không được cache |
| 10 | SSE mất kết nối | Reconnect rồi authenticated refetch; có thể live-poll tạm thời theo server policy, nhưng không đọc persisted/cached person-self snapshot |
| 11 | Charge settle trong lúc đang xem `/me/charges` | Refetch (SSE/manual) → item **rời khỏi danh sách** vì paid rời union `open \| partial` (BE v2.7). Không render trạng thái "paid" tại chỗ, không toast số tiền ở surface này — settled confirmation thuộc Notification pipeline (NTF-UC-3), không phải `/me/charges`. Club chuyển `known_zero` khi server trả vậy → empty state "🎉" như §3 |

---

## 6. Data hiển thị

| Field | Exact response path | Format | i18n `t(vi, en)` | Ghi chú |
|---|---|---|---|---|
| Total debt | `UNPINNED cross-club aggregate — omit` | Currency VNĐ | Nhãn `t("Còn nợ", "Outstanding")`; giá trị: `data — no copy` | FE không sum `data.clubs[]`; owner phải trả aggregate canonical |
| Sessions this week | `UNPINNED person-self sessions DTO — omit` | Number | Nhãn `t("Kèo tuần này", "Sessions this week")`; giá trị: `data — no copy` | "3 kèo" |
| Club name | `data.clubs[].clubLabel` | Text | `data — no copy` | Display name; envelope/field name chỉ từ DTO minh hoạ — xem caveat dưới bảng |
| Role | `UNPINNED person-self clubs DTO — omit` | Badge | `t("Player", "Player")` · `t("Host", "Host")` | Không suy từ route/token |
| Debt per club | `data.clubs[].status.totalOutstanding` | Currency VNĐ | Nhãn `t("Nợ", "Owed")`; giá trị: `data — no copy` | Chỉ `known_amount`/`known_zero`; unknown → unavailable |
| Session time | `data.clubs[].status.items[].startsAt` | "T5 19:00" | N/A — locale formatter | Day-of-week + time |
| Amount due | `data.clubs[].status.items[].amountDue` | Currency VNĐ | Nhãn `t("Phải trả", "Amount due")`; giá trị: `data — no copy` | Tabular-nums |
| Amount allocated | `data.clubs[].status.items[].amountAllocated` | Currency VNĐ | Nhãn `t("Đã gán", "Allocated")`; giá trị: `data — no copy` | Tabular-nums |
| Remaining | `data.clubs[].status.items[].remaining` | Currency VNĐ | Nhãn `t("Còn lại", "Remaining")`; giá trị: `data — no copy` | Canonical server value |
| Outstanding status | `data.clubs[].status.items[].status` | Badge | `t("Open", "Open")` · `t("Partial", "Partial")` | Chỉ `open | partial` |
| Club pay action | `data.clubs[].status.payAction.href` when present | Protected link | `t("Thanh toán CLB này", "Pay this club")` | Tối đa một action cho đúng club status; không global và không per item |
| Join request status | `UNPINNED join-request HTTP DTO — omit` | Closed status | `t("Pending", "Pending")` · `t("Approved", "Approved")` · `t("Rejected", "Rejected")` · `t("Expired", "Expired")` | Pending / Approved / Rejected / Expired |
| Club detail (sessions + charges của CLB đó) | `UNPINNED person-self club-detail DTO — omit active UI` | List | Nhãn `t("Buổi chơi", "Sessions")` · `t("Khoản phải trả", "Charges")`; giá trị: `data — no copy` | Endpoint `GET /api/me/clubs/:id` có trong BE §3 nhưng response DTO chưa có ví dụ/pin; chỉ own-data allowlist, không roster/PII người khác |

> **Envelope caveat (`data.clubs[]` · `clubLabel`):** chỉ `status.*` là type-pinned —
> `kind`, `currency`, `totalOutstanding`, `chargeCount`, `items[].sessionRef|startsAt|amountDue|amountAllocated|remaining|status`,
> `payAction`, `asOf` (`../../../features/BE/feature_player_view_tech.md:171-189`). Envelope bao quanh
> (`data.clubs[]`) và `clubLabel` chỉ xuất hiện trong ví dụ §3, mà chính BE doc disclaim tại `:101`:
> "DTO minh hoạ … field name chốt ở build slice". Build slice phải pin lại envelope/field name trước khi
> implement; không dùng ví dụ §3 làm implementation authority.

> **i18n:** Mọi chuỗi user-facing ở file này đi qua `t(vi, en)` (`packages/core/src/i18n.ts`). Repo không có key-based i18n; cặp vi/en ở cột trên là chuỗi thật, không phải key.

---

## 7. Responsive & Interaction Notes

- **Layout:** Mobile = single column stacked. Desktop = 2 columns (clubs left, upcoming right)
- **Chips:** Sticky top. Chưa được implement/author tới khi owner contract tồn tại; design target sau đó: tap → navigate (nợ → `/me/charges`, kèo → full list)
- **Club cards:** Hover lift (desktop). Tap → `/me/clubs/:clubId`
- **Payment action:** Optional per-club CTA chỉ mở protected `data.clubs[].status.payAction.href`; không global/per-item CTA, không QR component
- **Partial presentation:** Progress bar (nếu dùng) trong `OutstandingItemCard` chỉ là tỉ lệ hiển thị của `amountAllocated`/`amountDue` server trả — không sinh con số tiền/percent mới ngoài ba giá trị response (§4)
- **Realtime:** SSE là primary; reconnect + authenticated refetch (hoặc bounded live polling nếu owner cho phép). Không cache person-self DTO
- **Dark mode:** Chips `var(--bg-card)`, debt red `var(--error)`, proven-zero green `var(--success)`
- **Fallback freshness:** Không background-poll mặc định; khi SSE đứt, reconnect rồi authenticated refetch. Chỉ bounded live polling nếu owner policy explicit cho phép
- **Touch:** All interactive elements ≥ 44px

---

## Analytics Events (Draft — đề xuất, chưa phải contract)

> **Draft addition 2026-08-07 — đề xuất instrumentation, chưa phải contract.** Event/param name chưa
> được owner pin. Params **CẤM** amount/tiền (kể cả `totalOutstanding`/`remaining`), tên người, tên
> CLB dạng text và mọi PII — chỉ opaque id, enum, count, boolean. Không log `payAction.href`
> (protected link). Giữ nguyên negative scope của file: không QR/STK/pay_code, không cache
> person-self DTO, payAction chỉ per-club.

| Event | Khi nào bắn | Params (đề xuất) |
|---|---|---|
| `player_view_viewed` | `/me` đạt Ready (§3) | `entry` (enum: `web_login \| magic_link` — Flow 1/2 §2), `club_count` (count), `has_merged_banner` (boolean) |
| `player_view_club_expanded` | Tap/click club card → `/me/clubs/:clubId` (§7 "Tap → `/me/clubs/:clubId`") | `club_id` (opaque id), `status_kind` (enum: `known_amount \| known_zero \| unknown` — §6) |
| `player_view_pay_cta_clicked` | Click CTA `t("Thanh toán CLB này", "Pay this club")` từ `data.clubs[].status.payAction` (§3 `/me/charges`) | `club_id` (opaque id), `outstanding_item_count` (count) — **không amount**, không href |

---

## State Machine (Draft)

> **Draft addition 2026-08-07 — Draft.** Chỉ dùng state đã có trong file; transition suy từ flow §2
> và states §3; thiếu căn cứ → TBD (UNPINNED). Mọi state dưới đây là server-owned DTO state trừ khi
> ghi rõ client-local; FE không tự chuyển state — chuyển chỉ qua response mới (SSE → authenticated
> refetch, §7; không đọc cached snapshot, §5 #9/#10).

### Per-club `SelfPaymentStatus.kind` (server-owned)

- `unknown → known_amount | known_zero`: chỉ qua retry/refetch trả response mới (§3 States/Error mapping); FE không tự suy `known_zero` từ unknown.
- `known_amount → known_zero`: khi server trả status mới sau tất toán — trigger phía server, FE chỉ render (§4: khoản đã tất toán rời khỏi `SelfPaymentStatus`).
- Mọi chuyển khác (kể cả `known_* → unknown`): theo response server trả; FE không giữ giá trị cũ làm fallback (không cache person-self DTO).

### Outstanding item `status` (server-owned, union chỉ `open | partial` — §4/§6)

- `open → partial`: khi server trả `amountAllocated` một phần (Flow 3 §2).
- `open | partial → (rời khỏi union)`: khi tất toán — item biến mất khỏi DTO, **không** có state `paid` (§4 UpcomingRow).
- `partial → open`: không có căn cứ trong file — TBD (UNPINNED).

### Join request (server-owned — §2 Flow 4)

- `pending → approved | rejected | expired`: server quyết; FE render đúng như server trả, không suy outcome từ membership/session (Flow 4 §2).
- `approved | rejected | expired → *`: không có căn cứ trong file — TBD (UNPINNED).

### `MagicLinkAuth` (§4, client-local, không phải BE token)

`validating → { success | expired | error }`; `success` → vào `/me` (Flow 2 §2); `expired` → màn lỗi
generic + CTA "Yêu cầu link mới" (`MAGIC_LINK_INVALID` §3), không mint session.

### Screen-level (client-local, không phải BE token)

`Loading → { Ready | Empty | Error }`; `Error → Loading` qua retry (§3 States các màn). Unknown
không bao giờ chuyển thành Empty/0 ở client (§3 `/me/charges`).

---

## Acceptance Criteria (Draft)

> **Draft addition 2026-08-07 — Draft.** Mỗi AC trace về § có sẵn trong file.

- **AC-1** (§3 `/me` fence + §6): chips omit ở baseline (`UNPINNED`); không render 0, không sum `data.clubs[]` ở client, fixture không làm seed/default/fallback.
- **AC-2** (§3 `/me/charges` States): `status.kind = "unknown"` → "Không thể kiểm tra lúc này" + retry, KHÔNG hiện 0; empty "Không còn khoản phải trả 🎉" chỉ khi `known_zero`.
- **AC-3** (§3 `/me/charges` contract fence + §4 `ClubPayAction`): tối đa **một** CTA per club, đúng từ `data.clubs[].status.payAction`; không global action, không per-item action, không QR/STK/pay_code.
- **AC-4** (§5 #9/#10 + §7): không cache person-self DTO; offline → banner, không render cached clubs/upcoming/charges/requests; SSE đứt → reconnect + authenticated refetch.
- **AC-5** (§3 `/me/clubs/:clubId` No-disclosure): CLB ngoài own membership → generic no-access, không lộ club tồn tại hay không, không lộ tên/thông tin CLB.
- **AC-6** (§3 Join requests): panel absent hoàn toàn ở baseline (route/DTO `UNPINNED`); unknown/error không biến thành empty/`rejected`/`expired`.
- **AC-7** (§3 Error mapping `/me`): `AUTH_REQUIRED` → redirect login, không hiện 0, không đọc cached person-self; `MAGIC_LINK_INVALID` → màn lỗi generic + CTA "Yêu cầu link mới", không mint session.
- **AC-8** (§4 `UpcomingRow` + §6): outstanding union chỉ `open | partial`; không render state `paid`/🟢.
- **AC-9** (Analytics Events — Draft): không event nào mang amount/tiền/PII/href; params chỉ opaque id, enum, count, boolean.

---

## Testing Notes (Draft)

> **Draft addition 2026-08-07 — Draft.** Test cho surface còn `UNPINNED` (chips, club-detail zones,
> join-request panel) chỉ được viết khi owner pin DTO — tới lúc đó là spec-only.

- **Unknown vs zero** (§3 `/me` + `/me/charges`): mock `status.kind = "unknown"` → assert chip "—" / "Không thể kiểm tra lúc này" + retry; assert KHÔNG render "0đ", không empty-celebration, không CTA thanh toán.
- **No-cache** (§5 #9/#10 + §7): reload khi offline → assert không đọc persisted/cached person-self snapshot; assert banner "Cần kết nối để xem thông tin cá nhân".
- **Pay CTA** (§3 `/me/charges` + §4 `ClubPayAction`): `payAction` absent → không CTA; present → đúng 1 CTA per club với href đúng từ DTO; assert không mount QR/STK/pay_code surface nào.
- **No-disclosure** (§3 `/me/clubs/:clubId`): club ngoài membership và club không tồn tại → cùng một generic no-access screen, không khác biệt quan sát được.
- **Join requests** (§3 Join requests): unknown/error → generic retry; assert không map sang empty/`rejected`/`expired`; baseline → assert panel không fetch, absent hoàn toàn.
- **Union guard** (§4 `UpcomingRow`): item tất toán rời khỏi DTO → assert row biến mất, không render badge `paid`.
- **Analytics** (Analytics Events — Draft): snapshot allowlist param; assert payload không chứa key amount/tiền/PII/`href` nào.
- **i18n** (§6 i18n note): mọi chuỗi mới đi qua `t(vi, en)`.

---

_FE Design Spec v0.4 · 2026-07-31 · Source: feature_player_view.md v2.7_
_FE Design Spec v0.5 · 2026-08-07 · Δ v0.4→v0.5 (chỉ thêm, không sửa nội dung cũ): 4 section Draft cuối file (Analytics · State Machine · AC · Testing) · Source: Sporta FE porting analysis 2026-08-07_
_FE Design Spec v0.6 · 2026-08-07 · Δ v0.5→v0.6: §4 `OutstandingItemCard` partial progress = presentation-only · §5 edge #11 settle-while-viewing (item rời union `open|partial`, confirmation thuộc NTF-UC-3) · §7 partial presentation note · Source: `../../../research/sporta-payment-fe-port-analysis-2026-08-07.md` (DD-97/DD-98 🟡 liên quan)_
_FE Design Spec — 2026-09-08 (cấu trúc, không bump version): thêm khối 📍 Đọc nhanh dưới header — feature nguồn · phase-1 (DD-114) · launch (DD-113) · surface PWA trước, native iOS/Android phase-2 (DD-69) · FE PENDING (DD-116) · as-built @ `e235ea4`. Pointer core docs BRD v3.10 · PRD v2.9 · TDD v3.2 · ROADMAP v3.17. Nội dung thiết kế không đổi._

_Re-pin 2026-09-15 (cấu trúc, không bump version): as-built @ `e235ea4` theo `ROADMAP.md` v3.17 §📍 — 8 command session · 7 route nghiệp vụ · **0 màn FE**; FE PENDING (DD-116) không đổi, DD-119 vẫn 🟡 chưa ratify. Nội dung thiết kế không đổi._
