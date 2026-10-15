# Feature: Session CRUD — FE Design Spec

> **Route(s):** `/dashboard/sessions` · `/dashboard/sessions/new` · `/dashboard/sessions/:id`
> **Source authority:** `../../../features/FE/feature_session_management.md` v2.17 + `../../../features/FE/feature_payment_reconcile.md` v1.10 · baseline `0c5808fc7cf50d139bdd9c4ee79917bf4059c4f4`
> **Source authority (BE error/policy tokens):** `../../../features/BE/feature_session_management_tech.md` v2.33 · baseline `bc34a5686ece7cab82c2655abc39bbf5897d4bb4` — `CANCEL_REQUIRES_REVIEW` (cancel-only) và `CLOSE_BLOCKED_OPEN_DEBT` (§3 *Error Codes*; payload `error.details.openBalancePlayers`, §3 close example; chính sách §4 "Close / Cancel money policy", DD-131 OD-1) và `impact_policy` (§2 *Edge Cases* #4, price/capacity change có charges). Các token này **không** nằm trong feature doc v2.17 ở trên; FE lấy nguyên văn từ BE tech doc, không tự đặt mã hay enum.
> **Source authority (roster disambiguator):** `../../../standards/decisions.md` DD-85 (owner-chốt 2026-07-21) — `pay_code` là disambiguator mặc định khi ≥2 active/guest membership trong cùng tenant trùng `display_name` sau chuẩn-hoá `NFKC → trim → collapse whitespace → locale-safe casefold` (giữ dấu, không fuzzy/token-subset). Chỉ surface host/authenticated; không dùng phone (DD-50); avatar/gender ngoài phase-1.
> **Source contract status:** Reviewed; payment renderer DTO và price-adjustment API chưa author
> **Projection/API contract:** Session contract from Product/BE pair; payment widget + price adjustment `UNPINNED — omit/block`
> **Capability/availability:** Exact session action grants/availability must come from server response; no client role inference
> **Priority:** 4 — designer-kickoff.md §3B
> **FE design status:** Draft
> **Runtime status:** SessionService và các command routes đã có (BE Implementation header); route đọc `GET /api/sessions` + `GET /api/sessions/[id]` (`apps/web/app/api/sessions/route.ts`, `[id]/route.ts`) và host workspace web (`apps/web/app/c/[tenantId]/sessions/` — danh sách · tạo · chi tiết · sửa; `apps/web/components/sessions/`) đã có trên `main` (đo 2026-10-15 tại `d962b0c`); `GET /api/sessions/:id/guest-notes` và projector thật chưa build. Occupancy helper hiện tại đếm active + guest notes; pending/payment holds chưa build. FE design vẫn Draft/PENDING, không authorize render.
> **Negative scope:** Không tự build payment widget; không rewrite charge history; tuân theo guard capacity của `UpdateSession` hiện tại, không tự tính capacity ở client

> 📍 **Đọc nhanh (cập nhật 2026-09-15 — chỉ mục, không phải authority):** feature nguồn `../../../features/FE/feature_session_management.md`; scope/phase đọc ở `BRD.md` v3.10 §📍 · hành vi `PRD.md` v2.9 §📍 · contract `TDD.md` v3.2 §📍 · **tiến độ thật `ROADMAP.md` v3.17 §📍** (mốc `main@e235ea4`, 15/09).
>
> **Phase-1 (DD-114):** ✅ nhóm 6 · **Launch (DD-113):** ✅ **khối 3/5 session management + 4/5 session detail**
>
> **Surface:** Web app **PWA** (Next.js App Router, installable/offline — DD-113 launch = PWA + Zalo bot song song) — `/dashboard/sessions*` là màn lõi launch; **app native iOS (App Store) + Android (CH Play) là phase-2** (DD-69): tái dùng API/contract, màn native thiết kế lại theo platform sau gate, **không phải bản sao màn này**.
>
> **Trạng thái:** FE design Draft · 🔴 **FE PENDING (DD-116)** — không mở page/component, không track `.pen` tới khi đủ cả ba vế (chọn đúng một `.pen` canonical · tracked trên `main` · owner ký gate DD-81) · as-built @ `main@e235ea4`: **0 màn FE nối API** (đúng 1 `apps/web/app/page.tsx`); BE: 🟢 **8 command + 7 route** đã có (thêm `createGuestNote`/`deleteGuestNote` + 2 route guest-note, `0044`) — FE chỉ còn chờ gỡ PENDING.

---

## 1. Mô tả

Quản lý buổi chơi thể thao của CLB: tạo mới, xem danh sách, xem chi tiết (roster, payments, detail), publish/đóng/huỷ. Host tạo kèo ở trạng thái draft → publish để nhận join → tự động close khi hết giờ. Hỗ trợ đa môn (badminton, football, tennis, volleyball...), giá theo giới tính (optional), capacity/visibility/join policy. Payment widget chưa có owner contract nên không thuộc implementation surface hiện tại.

---

## 2. User Flows

### Flow 1: Tạo buổi chơi mới

1. Host click "Tạo buổi mới" (từ dashboard hoặc session list)
2. Redirect `/dashboard/sessions/new` → form tạo kèo
3. Điền: môn, thời gian, sân, giá, số slot, hiển thị (public/private)
4. Submit → session tạo ở status `draft`
5. Click "Đăng kèo" → confirm → status `open` → nhận join

### Flow 2: Xem danh sách kèo

1. Host vào `/dashboard/sessions`
2. Thấy table/card list sortable theo ngày
3. Filter tabs: Tất cả | Sắp tới | Draft | Đã đóng
4. Click 1 kèo → `/dashboard/sessions/:id`

### Flow 3: Quản lý kèo chi tiết

1. Host mở `/dashboard/sessions/:id`
2. Baseline chỉ hiện 2 tabs: Roster | Chi tiết
3. **Roster tab:** danh sách player (active/waitlisted/left), không có payment column/action
4. **Thanh toán tab:** action/tab bị omit hoàn toàn tới khi có Reviewed host projection/aggregate/formula/renderer DTO
5. **Chi tiết tab:** session info + nút Sửa/Đăng kèo/Đóng/Huỷ

### Flow 4: Huỷ nháp (draft chưa publish)

1. Trên session detail (status=draft) → nút "Huỷ nháp"
2. Confirm dialog → session cancelled
3. Nếu server trả `CANCEL_REQUIRES_REVIEW` (draft mang `players`/`charges` bất thường — tech doc §4 D2, edge #28) → dừng tại chỗ, **chỉ** hiện message của server: KHÔNG gợi ý gỡ người/hoàn tác thanh toán và KHÔNG có nút Roster, vì roster chỉ thêm/gỡ được khi session `open` (draft là ngõ cụt); không invent review route/workflow. (Gợi ý + nút Roster chỉ dành cho session `open` — §3 Error mapping.)

---

## 3. Screens & States

### `/dashboard/sessions` — Session List

> **Visual fixture only:** Mọi giá trị trong các wireframe §3 — tiêu đề kèo, ngày/giờ, tên sân, giá,
> số chỗ, badge trạng thái và tên trong roster — chỉ kiểm tra hierarchy/spacing, không phải data hay
> interaction contract. §6 hiện đánh **toàn bộ** session/capacity/roster DTO là
> `UNPINNED … — omit active UI` (payment renderer DTO là `UNPINNED … — omit`), nên baseline phải omit
> hoặc render neutral unavailable placeholder cho các field đó; không dùng fixture làm
> seed/default/fallback và không suy response path từ wireframe.
>
> ⚠️ **Header và §6 đang mâu thuẫn — chưa owner nào gỡ.** Header file chỉ đánh `UNPINNED — omit/block`
> cho **payment widget + price adjustment**, trong khi §6 đánh `UNPINNED … — omit active UI` cho **mọi**
> field session/capacity/roster (title, date, time, venue, price, slots, player name, pay code). Hai câu
> này không khớp nhau. Tới khi owner chốt lại, **§6 là dòng chặt hơn và là dòng có hiệu lực**: không
> field nào của session DTO được fetch/render active chỉ vì header im lặng về nó.

#### Layout (Desktop 1440px)

```
┌──────────┬──────────────────────────────────────────────────┐
│          │  Header: "Buổi chơi" · [+ Tạo buổi mới]        │
│ Sidebar  ├──────────────────────────────────────────────────┤
│          │                                                  │
│          │  Filter Tabs:                                    │
│          │  [Tất cả] [Sắp tới] [Draft] [Đã đóng]          │
│          │                                                  │
│          │  Search: [🔍 Tìm theo tên, sân...]              │
│          │                                                  │
│          │  ┌────────────────────────────────────────────┐  │
│          │  │ 🏸  BM Thứ 5              19:00 - 21:00   │  │
│          │  │     Sân ABC · 6/8 slot    [● open]        │  │
│          │  │     Payment projection: omitted             │  │
│          │  ├────────────────────────────────────────────┤  │
│          │  │ ⚽  Bóng đá CN             08:00 - 10:00   │  │
│          │  │     Sân XYZ · 12/20 slot  [○ draft]       │  │
│          │  │     📝 Chưa đăng kèo                       │  │
│          │  ├────────────────────────────────────────────┤  │
│          │  │ 🎾  Tennis T3             17:00 - 19:00    │  │
│          │  │     Court D · 4/4 slot    [■ closed]       │  │
│          │  │     Payment projection: omitted             │  │
│          │  └────────────────────────────────────────────┘  │
│          │                                                  │
│          │  Pagination: [← 1 2 3 →]                        │
│          │                                                  │
└──────────┴──────────────────────────────────────────────────┘
```

#### States

- **Loading:** 5 skeleton session rows (pulsing)
- **Ready:** Session list cards with sport icon, time, venue, server-owned capacity and status badge; không có payment progress
- **Empty:** Icon 📅 + "Chưa có buổi chơi nào" + "Tạo buổi đầu tiên để bắt đầu nhận đặt!" + CTA [🏸 Tạo buổi mới]
- **Empty Search:** "Không tìm thấy buổi chơi phù hợp" + CTA "Xoá bộ lọc"
- **Error:** Error banner + "Thử lại" — session list giữ stale data nếu có

#### Error mapping

| Status | Error code | Visible state | i18n `t(vi, en)` |
|---|---|---|---|
| 403 | `NOT_TENANT_ADMIN` | Route không render list; redirect về dashboard, không hiện row rỗng | `t("Bạn không có quyền admin của club này", "You don't have admin access to this club")` |
| 403 | `CAPABILITY_DENIED` | Omit list + mọi action; không render control disabled, không suy quyền ở client | `t("Bạn không có quyền thực hiện thao tác này", "You don't have permission for this action")` |
| — | *(unknown / missing / timeout)* | **Fail closed** — unavailable placeholder + retry; giữ stale rows nếu có, không render Empty | `t("Không tải được danh sách buổi chơi. Thử lại.", "Couldn't load sessions. Try again.")` |

> **Error mapping:** Pin server error/status → exact visible state. Unknown/missing response fail closed;
> không invent success, zero, empty hoặc disabled control. Nếu BE chưa pin catalog cho một endpoint,
> ghi `UNPINNED error catalog — omit active UI` thay vì bịa mã.

#### Responsive

| Breakpoint | Session List |
|---|---|
| 1440px | Sidebar fixed 240px full label (`feature_dashboard_fe.md` §3); header "Buổi chơi" + [+ Tạo buổi mới] cùng hàng; filter tabs và ô tìm kiếm trên cùng một hàng; list dạng table row |
| 768px | Sidebar ẩn + hamburger ☰ (`feature_dashboard_fe.md` §3: ≤768px hidden); row thu nhỏ; filter tabs giữ nguyên, ô tìm kiếm xuống dòng riêng |
| 375px | Sidebar ẩn + hamburger; list thành card stack (icon môn + info + status badge); filter tabs scroll ngang; CTA [+ Tạo buổi mới] và pagination full-width. "Payment projection: omitted" giữ nguyên ở mọi breakpoint |

---

### `/dashboard/sessions/new` — Tạo buổi chơi

#### Layout

```
┌──────────┬──────────────────────────────────────────────────┐
│          │  Header: "Tạo buổi chơi mới" · [← Quay lại]    │
│ Sidebar  ├──────────────────────────────────────────────────┤
│          │                                                  │
│          │  Form (max-width: 720px, centered)               │
│          │                                                  │
│          │  ┌──────────────────────────────────────────┐    │
│          │  │  Môn thể thao *    [🏸 Cầu lông       ▾]│    │
│          │  │  Tiêu đề (opt)     [__________________ ]│    │
│          │  │                                        │    │
│          │  │  ── Thời gian ──                        │    │
│          │  │  Ngày *            [📅 06/08/2026     ] │    │
│          │  │  Giờ bắt đầu *    [⏰ 19:00          ] │    │
│          │  │  Giờ kết thúc *   [⏰ 21:00          ] │    │
│          │  │                                        │    │
│          │  │  ── Địa điểm ──                         │    │
│          │  │  Tên sân *         [Sân ABC           ] │    │
│          │  │  Khu vực           [Q. Bình Thạnh     ] │    │
│          │  │  (không có field SĐT — DD-50 phase-1)  │    │
│          │  │                                        │    │
│          │  │  ── Giá & Chỗ ──                        │    │
│          │  │  Giá *             [_________] VNĐ     │    │
│          │  │  Giá nữ (opt)      [_________] VNĐ     │    │
│          │  │  Số chỗ            [___ ] [Không giới hạn]│ │
│          │  │  (public: bắt buộc số nguyên dương hữu hạn)│ │
│          │  │                                        │    │
│          │  │  ── Cài đặt ──                          │    │
│          │  │  Hiển thị:  [● Riêng tư] [○ Công khai]│    │
│          │  │  Join:      [● Tự động]  [○ Duyệt]   │    │
│          │  │  Ghi chú (opt)     [__________________ ]│    │
│          │  │                                        │    │
│          │  │  [        Tạo buổi chơi (Draft)       ]│    │
│          │  └──────────────────────────────────────────┘    │
│          │                                                  │
└──────────┴──────────────────────────────────────────────────┘
```

> ⚠️ **Không có field SĐT sân.** Vòng trước wireframe vẽ "SĐT sân (opt)" — field đó **không tồn tại**:
> `packages/db/schema.ts` chỉ có `venue_name`/`venue_address`, không doc nào trong `docs/features/`
> nhắc tới nó, và DD-50 chốt phase-1 **không thu số điện thoại** (phone fields dormant). Không vẽ lại.

#### States

- **Loading:** Skeleton form
- **Ready:** Form pre-filled defaults (môn từ CLB config, giá từ CLB default, timezone auto)
- **Error:** Inline errors per field
  - "Chọn môn thể thao"
  - "Giờ kết thúc phải sau giờ bắt đầu"
  - Public: "Kèo công khai cần số chỗ là số nguyên dương hữu hạn"
  - Private: cho phép "Không giới hạn" (`NULL`); không invent trần 50
  - "Giá phải ≥ 0"
  - Visibility public + chưa đủ fields → "Kèo công khai cần: môn, khu vực, thời gian, số chỗ"
- **Empty:** N/A (form)

#### Trạng thái Submitting (Draft — client-local, không phải BE token)

> **Draft addition 2026-08-07 — design spec — không authorize render (theo §6 omit-active-UI).**
> Trạng thái này thuần client (client-local, không phải BE token) — không map từ error catalog và
> không thêm mã mới vào catalog.

- Khi user bấm CTA "Tạo buổi chơi (Draft)" và request đang in-flight: spinner hiện **trong** CTA,
  CTA chuyển `disabled`, copy đổi thành `t("Đang tạo…", "Creating…")`.
- **Chặn double-submit:** CTA disabled trong suốt thời gian in-flight; bấm thêm không tạo request
  thứ hai. Form fields giữ nguyên data (khớp hàng *(unknown / missing / timeout)* ở Error mapping
  dưới — fail closed, không báo tạo thành công khi chưa có response).
- Kết thúc: response thành công → Success surface (subsection dưới); server error đã pin → CTA trở
  lại enabled + đúng visible state trong Error mapping hiện có; unknown/timeout → fail closed theo
  bảng dưới, không retry ngầm.

#### Success surface sau khi tạo kèo thành công (Draft)

> **Draft addition 2026-08-07 — design spec — không authorize render (theo §6 omit-active-UI).**
> Summary card đọc tên/giờ/slots từ **response**, nhưng §6 hiện đánh toàn bộ session/capacity DTO là
> `UNPINNED — omit active UI`, nên phần này chỉ là design target: không fetch/render active tới khi
> owner pin exact DTO; không dùng form input hay fixture làm nguồn thay response.

- Sau khi server xác nhận tạo thành công (session ở status `draft`): hiện summary card gồm tên kèo,
  thời gian, số slot — giá trị lấy từ response server trả, không echo lại form input làm nguồn.
- 2 CTA: `t("Xem chi tiết", "View detail")` → `/dashboard/sessions/:id`; `t("Chia sẻ", "Share")` —
  hành vi share (target/deep-link/copy-link) chưa có căn cứ trong file: TBD (UNPINNED), không invent.
- Không auto-publish: card ghi rõ kèo đang ở `draft` — "Đăng kèo" vẫn là bước riêng có confirm
  (khớp Flow 1 §2).

#### Error mapping

| Status | Error code | Visible state | i18n `t(vi, en)` |
|---|---|---|---|
| 400 | `INVALID_TIME_RANGE` | Inline error dưới "Giờ kết thúc"; form giữ nguyên data | `t("Giờ kết thúc phải sau giờ bắt đầu", "End time must be after start time")` |
| 400 | `SPORT_INACTIVE` | Inline error dưới "Môn thể thao"; không tự chọn môn khác thay user | `t("Môn thể thao không còn hoạt động", "This sport is no longer active")` |
| 400 | `MISSING_DISCOVERY_FIELDS` | Inline error trên nhóm field còn thiếu; không tự hạ visibility về private | `t("Kèo công khai cần: môn, khu vực, thời gian, số chỗ", "Public sessions need sport, area, time and a slot count")` |
| 403 | `NOT_TENANT_ADMIN` | Form không render; redirect về session list | `t("Bạn không có quyền tạo buổi chơi", "You don't have permission to create sessions")` |
| 403 | `TENANT_SUSPENDED` | Banner đầu form + chặn submit; không lưu draft ngầm ở client | `t("Club đang tạm ngưng — không tạo được buổi chơi", "This club is suspended — you can't create sessions")` |
| — | *(unknown / missing / timeout)* | **Fail closed** — unavailable placeholder + retry; form giữ data, không báo tạo thành công | `t("Không gửi được yêu cầu. Thử lại.", "Couldn't submit. Try again.")` |

> **Error mapping:** Pin server error/status → exact visible state. Unknown/missing response fail closed;
> không invent success, zero, empty hoặc disabled control. Nếu BE chưa pin catalog cho một endpoint,
> ghi `UNPINNED error catalog — omit active UI` thay vì bịa mã.

#### Responsive

| Breakpoint | Tạo buổi chơi |
|---|---|
| 1440px | Sidebar fixed 240px; form centered `max-width: 720px`; bốn nhóm (Thời gian · Địa điểm · Giá & Chỗ · Cài đặt) mở sẵn, label trái + ô nhập phải |
| 768px | Sidebar ẩn + hamburger; form full width trong padding; các nhóm vẫn mở sẵn |
| 375px | Form full width; các nhóm collapsible (§7); label lên trên, ô nhập full-width; date/time dùng native mobile picker (§7); CTA "Tạo buổi chơi (Draft)" full-width ≥ 44px. Không có field SĐT sân ở bất kỳ breakpoint nào |

---

### `/dashboard/sessions/:id` — Session Detail

#### Layout (Desktop 1440px)

```
┌──────────┬──────────────────────────────────────────────────┐
│          │  Header: "🏸 BM Thứ 5" · [● open]               │
│ Sidebar  │  19:00 - 21:00 · Sân ABC · 6/8 slot             │
│          ├──────────────────────────────────────────────────┤
│          │                                                  │
│          │  Tab Bar: [Roster] [Chi tiết]                    │
│          │                                                  │
│          │  ═══════════════════════════════════════════════  │
│          │                                                  │
│          │  TAB: Roster                                     │
│          │  ┌────────────────────────────────────────────┐  │
│          │  │ 👤 Nguyễn A · PC-A7B2   active             │  │
│          │  │ 👤 Nguyễn A · PC-C3D4   active             │  │
│          │  │ 👤 Trần B               active             │  │
│          │  │ 👤 Phạm D               waitlisted (pos #1)│  │
│          │  │ 👤 Hoàng E              left — (grayed)    │  │
│          │  └────────────────────────────────────────────┘  │
│          │                                                  │
└──────────┴──────────────────────────────────────────────────┘
```

> **Roster disambiguator (DD-85) — khi nào `pay_code` xuất hiện:** `pay_code` **chỉ** hiện kèm tên khi ≥2 active/guest
> membership trong cùng tenant có `display_name` trùng nhau sau chuẩn-hoá (`NFKC → trim → collapse whitespace →
> locale-safe casefold`, giữ dấu tiếng Việt; không fuzzy, không token-subset — "Minh" **không** collision với "Minh Trần").
> Tên không trùng → **không** hiện `pay_code`. Fixture trên minh hoạ đúng rule đó: hai "Nguyễn A" trùng tên nên mang
> `pay_code`, ba dòng còn lại thì không. Disambiguator này chỉ dành cho surface host/authenticated; không phone (DD-50),
> avatar/gender ngoài phase-1. Exact response path chưa pin — xem §6, baseline omit.

#### Tab: Thanh toán

```
┌──────────────────────────────────────────────────┐
│  PAYMENT SURFACE OMITTED                         │
│                                                  │
│  Exact host payment projection/aggregate DTO,    │
│  formula and renderer authority are UNPINNED.    │
│  Baseline renders no totals, progress, statuses, │
│  QR, STK or per-player payment list here.         │
└────────────────────────────────────────────────┘
```

> ⚠️ **Contract gap:** `payAction` hiện tại chỉ là protected link cho player self; không cung cấp host aggregate/QR/bank renderer DTO và không được overload. FE phải omit toàn bộ Thanh toán tab active tới khi một Reviewed owner contract pin exact fields, formula, payer/charge binding, authorization và expiry.

#### Tab: Chi tiết

```
┌──────────────────────────────────────────────────┐
│  Thông tin buổi chơi                             │
│                                                  │
│  Môn:        🏸 Cầu lông                         │
│  Ngày:       Thứ 5, 06/08/2026                   │
│  Thời gian:  19:00 - 21:00                       │
│  Sân:        Sân ABC, Q. Bình Thạnh              │
│  (không có SĐT sân — xem ghi chú DD-50 dưới)     │
│  Giá:        150,000đ (nam) / 120,000đ (nữ)     │
│  Chỗ:        6/8 (còn 2)                         │
│  Hiển thị:   Công khai                           │
│  Join:       Tự động                              │
│  Trạng thái: ● open                              │
│                                                  │
│  Actions:                                        │
│  [✏️ Sửa]  [📢 Đăng kèo]  [🔒 Đóng]  [❌ Huỷ]   │
│                                                  │
│  (Actions hiện/ẩn theo status:                    │
│   draft → Sửa + Đăng kèo + Huỷ nháp             │
│   open → Sửa + Đóng + Huỷ                        │
│   closed/cancelled → chỉ xem)                    │
└──────────────────────────────────────────────────┘
```

#### States per tab

**Roster tab:**
- **Loading:** Skeleton table rows
- **Ready:** Player list with identity disambiguation + membership status only; payment column/action omitted tới khi host payment projection pin exact IDs, states and preview DTO
- **Empty:** "Chưa có ai tham gia" + nếu `draft`: "Đăng kèo để nhận join"
- **Error:** Retry banner

**Thanh toán tab:**
- **Current:** Tab/action omitted hoàn toàn vì projection/aggregate/formula/renderer DTO chưa pin
- **Future states:** Chỉ author sau khi owner contract Reviewed; không dùng wireframe hoặc ledger rows làm fallback

**Chi tiết tab:**
- **Loading:** Skeleton info cards
- **Ready:** Session info + action buttons (per status)
- **Error:** Retry

#### Error mapping

| Status | Error code | Visible state | i18n `t(vi, en)` |
|---|---|---|---|
| 409 | `STALE_VERSION` | Dialog "dữ liệu đã đổi" + CTA tải lại; không retry ngầm, không apply optimistic | `t("Dữ liệu đã thay đổi. Tải lại?", "This session changed. Reload?")` |
| 409 | `SESSION_NOT_OPEN` | Toast lỗi + refetch; action bar dựng lại theo status server trả, FE không tự đổi badge | `t("Buổi chơi không còn ở trạng thái mở", "This session is no longer open")` |
| 409 | `CAPACITY_BELOW_ROSTER` | Inline error ở field số chỗ trong form Sửa; không lưu | `t("Sức chứa nhỏ hơn số người đã tham gia.", "Capacity is below the current roster.")` |
| 409 | `CAPACITY_BELOW_OCCUPANCY` | Inline error ở field số chỗ trong form Sửa; không lưu hoặc tự giải phóng chỗ để lách giới hạn | `t("Sức chứa nhỏ hơn số chỗ đang được sử dụng.", "Capacity is below the occupied slots.")` |
| 400 | `MISSING_DISCOVERY_FIELDS` | Đăng kèo bị chặn; inline error liệt kê field thiếu, status giữ `draft` | `t("Kèo công khai cần: môn, khu vực, thời gian, số chỗ", "Public sessions need sport, area, time and a slot count")` |
| 400 | `PRICE_CHANGE_REQUIRES_POLICY` | Save ở form Sửa bị block; chỉ trình bày hai policy target, không tự chọn hộ | `t("Cần chọn chính sách áp dụng cho các khoản đã phát sinh", "Choose how existing charges are handled")` |
| 400 | `CANCEL_REQUIRES_REVIEW` | **Cancel-only** (DD-131 OD-1; close không còn trả mã này). Dialog huỷ giữ nguyên, status giữ `open`/`draft`: **session `open`:** message của server + một gợi ý generic, không nói nhánh nào áp dụng (còn người chơi active hay còn tiền đã ghi nhận), xếp theo thứ tự host phải làm (hoàn tác thanh toán trước rồi mới gỡ người — khớp `REMOVE_REQUIRES_REVIEW`); nút "Mở danh sách người chơi" chuyển sang tab Roster (đóng dialog, không refetch, focus chuyển tới tab Roster); **session `draft` (anomaly, edge #28):** CHỈ message của server — không gợi ý, không nút (roster không sửa được ở draft); không invent review route/workflow | message server `t("Kèo này cần được xem xét trước khi huỷ.", "This session needs review before it can be cancelled.")` + (chỉ `open`) gợi ý `t("Hoàn tác các khoản thanh toán đã ghi trước, rồi gỡ từng người chơi khỏi danh sách và huỷ lại.", "Reverse any recorded payments first, then remove the players one by one and cancel again.")` |
| 409 | `CLOSE_BLOCKED_OPEN_DEBT` | Dialog đóng giữ nguyên, status giữ `open`, không refetch, không retry ngầm: message server + danh sách **tên hiển thị** các người chơi còn dư nợ (`error.details.openBalancePlayers`; `playerId` chỉ làm React key, không hiện số tiền, không tự tính ở client; danh sách giới hạn ~5 dòng và cuộn bên trong, tên dài không khoảng trắng tự xuống dòng — tiêu đề, message và nút của dialog luôn nằm trong viewport) + nút "Mở danh sách người chơi" sang tab Roster (nơi ghi thanh toán). `details` thiếu/rỗng/sai kiểu (bất kỳ phần tử sai ⇒ bỏ cả danh sách) → chỉ message generic của server (fail closed). Chỉ hiện trong workspace host đã xác thực | message server `t("Còn người chơi chưa trả đủ tiền — thu đủ trước khi đóng kèo.", "Some players have not paid in full — collect their payments before closing the session.")` + tiêu đề danh sách `t("Người chơi còn thiếu tiền:", "Players with an open balance:")` · nút `t("Mở danh sách người chơi", "Open the roster")` |
| 403 | `TENANT_SUSPENDED` | Banner đầu trang; mọi action mutation absent, detail còn read-only | `t("Club đang tạm ngưng", "This club is suspended")` |
| 403 | `NOT_TENANT_ADMIN` | Detail không render; redirect về session list | `t("Bạn không có quyền quản lý buổi chơi này", "You don't have permission to manage this session")` |
| — | `UNPINNED error catalog — omit active UI` | Tab Thanh toán: không fetch, không render error surface — tab absent hoàn toàn ở baseline | `N/A — surface omitted` |
| — | *(unknown / missing / timeout)* | **Fail closed** — unavailable placeholder + retry; roster/chi tiết giữ stale, không render action nào suy từ state đoán | `t("Không tải được buổi chơi. Thử lại.", "Couldn't load this session. Try again.")` |

> **Error mapping:** Pin server error/status → exact visible state. Unknown/missing response fail closed;
> không invent success, zero, empty hoặc disabled control. Nếu BE chưa pin catalog cho một endpoint,
> ghi `UNPINNED error catalog — omit active UI` thay vì bịa mã.

#### Responsive

| Breakpoint | Session Detail |
|---|---|
| 1440px | 2 tabs (Roster, Chi tiết) horizontal; payment tab absent; roster table full width |
| 768px | 2 tabs horizontal; payment tab absent; roster table scrollable |
| 375px | 2 tabs horizontal; payment tab absent; roster as card list |

---

## 4. Components Used

| Component | States | Mô tả |
|---|---|---|
| `SessionListCard` | default, hover (lift), status variants | Row/card buổi chơi — sport icon + time + venue + slots |
| `FilterTabs` | Tất cả, Sắp tới, Draft, Đã đóng | Tab filter trên session list |
| `SessionForm` | create mode, edit mode (pre-filled) | Form tạo/sửa session — grouped sections |
| `SportSelector` | dropdown with icons | Chọn môn: icon + tên |
| `DateTimePicker` | date picker, time picker | Chọn ngày/giờ |
| `CapacityInput` | positive finite, private-unlimited | Public bắt buộc số nguyên dương hữu hạn; private được `NULL = unlimited`; không có trần 50 |
| `VisibilityToggle` | private (lock icon), public (globe icon) | Radio group |
| `RosterTable` | loading, ready, empty, error | Bảng player — avatar + name + membership status; payment column/action omitted |
| `PaymentSurface` | omitted | Không phải runtime component; chờ exact host projection/aggregate/formula/renderer contract |
| `StatusBadge` | draft (gray), open (green), closed (blue), cancelled (red) | Badge trạng thái |
| `ActionBar` | varies by session status | Bar chứa action buttons per session status |
| `ConfirmDialog` | publish, close, cancel confirm | Dialog xác nhận hành động |

---

## 5. Edge Cases (UX)

| # | Case | Hiển thị |
|---|---|---|
| 1 | Tạo kèo public thiếu discovery fields | Inline error: "Kèo công khai cần: môn, khu vực, thời gian, số chỗ" |
| 2 | Giờ kết thúc ≤ giờ bắt đầu | Inline error dưới giờ KT: "Giờ kết thúc phải sau giờ bắt đầu" |
| 3 | `UpdateSession`: đổi số chỗ hữu hạn xuống dưới occupancy do server kiểm | Inline error theo server tại field số chỗ (§3 Error mapping); `CAPACITY_BELOW_ROSTER` giữ ưu tiên nếu dưới active roster, còn lại là `CAPACITY_BELOW_OCCUPANCY`; không lưu, FE không tự sum |
| 4 | Host publish draft quá giờ | Error: "Buổi chơi đã quá giờ bắt đầu" |
| 5 | Roster player name dài | Truncate + tooltip full name |
| 6 | Session bị concurrent sửa | Error "Dữ liệu đã thay đổi. Tải lại?" + CTA reload |
| 7 | Waitlisted player | Hiện membership status + position; không payment checkbox/action |
| 8 | Left player | Hiện grayed trong roster, không selectable |
| 9 | Price change khi đã có charges | Chỉ trình bày hai policy target: "Giữ obligation hiện tại" hoặc "Áp chênh lệch bằng append-only signed adjustment". Exact request enum/preview DTO chưa được pin, nên Save bị block; không rewrite charge/history và không tự invent `impact_policy` |
| 10 | Offline khi submit | Toast "Không có kết nối" + form giữ data |
| 11 | Guard capacity hiện tại của `UpdateSession` | Server kiểm dưới session lock bằng active + guest notes; pending/payment holds chưa build. FE chỉ dùng capacity DTO đã pin; khi còn `UNPINNED` thì omit active UI (§6), không tự sum. Private unlimited không render denominator |

---

## 6. Data hiển thị

| Field | Exact response path | Format | i18n `t(vi, en)` | Ghi chú |
|---|---|---|---|---|
| Session title | `UNPINNED session DTO — omit active UI` | Text | Label `t("Tiêu đề", "Title")`; value: `data — no copy` | Không auto-generate từ fixture trong implementation |
| Date | `UNPINNED session DTO — omit active UI` | "Thứ 5, 06/08/2026" | N/A — locale formatter | `Intl.DateTimeFormat('vi')` |
| Time range | `UNPINNED session DTO — omit active UI` | "19:00 - 21:00" | N/A — locale formatter | 24h format |
| Venue | `UNPINNED session DTO — omit active UI` | Text | Label `t("Sân", "Venue")`; value: `data — no copy` | Tên sân |
| Price | `UNPINNED session DTO — omit active UI` | "150,000đ" | N/A — currency formatter | Không derive client-side |
| Price female | `UNPINNED session DTO — omit active UI` | "120,000đ" hoặc ẩn | N/A — currency formatter | Không derive client-side |
| Slots | `UNPINNED capacity DTO — omit active UI` | "6/8 slot" | Label `t("Chỗ", "Slots")`; value: `data — no copy` | Server trả canonical capacity; FE không sum |
| Player name | `UNPINNED roster DTO — omit active UI` | Text + avatar | N/A — person content | Avatar initials chỉ là presentation fallback |
| Pay code (disambiguator) | `UNPINNED roster DTO — omit active UI` | Text `PC-XXXX` cạnh tên | `N/A — data, no copy` | DD-85: chỉ render khi `display_name` chuẩn-hoá trùng trong cùng tenant; host/authenticated only. FE không tự sinh, không suy từ tên, không dùng làm identity khi submit |
| Payment status | `UNPINNED payment renderer DTO — omit` | Badge | `N/A — surface omitted` | Không tự map ledger rows |

> **i18n:** Mọi chuỗi user-facing ở file này đi qua `t(vi, en)` (`packages/core/src/i18n.ts`). Repo không có key-based i18n; cặp vi/en ở cột trên là chuỗi thật, không phải key.

---

## 7. Responsive & Interaction Notes

- **Session list:** Desktop = table rows. Tablet = smaller rows. Mobile = card stack (sport icon + info + status badge)
- **Create form:** Desktop = centered `max-width: 720px`. Mobile = full width, sections collapsible
- **Session detail tabs:** Click tab → content transition slide. Mobile = swipeable tabs
- **Roster:** Membership rows only; payment checkbox/action omitted until the host projection/preview contract is Reviewed
- **Payment widget:** Omit hoàn toàn cho tới khi owner contract được Reviewed; không dùng `payAction` player-self để dựng QR/STK
- **Action buttons:** Desktop = horizontal bar. Mobile = stacked full-width hoặc dropdown "⋮ Actions"
- **Confirm dialogs:** Centered modal. Mobile = bottom sheet pattern
- **Date picker:** Native mobile picker. Custom dropdown desktop (calendar grid)
- **Dark mode:** Cards `var(--bg-card)`, status colors theo semantic tokens
- **Loading transitions:** Skeleton → content: fade-in 200ms

---

## Analytics Events (Draft — đề xuất, chưa phải contract)

> **Draft addition 2026-08-07 — đề xuất instrumentation, chưa phải contract; design spec — không
> authorize render (theo §6 omit-active-UI).** Event/param name chưa được owner pin. Params **CẤM**
> amount/giá/tiền, tên kèo, venue text, tên người và mọi PII — chỉ opaque id, enum, count, boolean.
> `error_code` chỉ lấy nguyên văn token đã pin trong Error mapping §3 — không thêm mã mới vào catalog.

Funnel tạo kèo (bám Flow 1 §2 + States/Submitting/Success §3):

| Event | Khi nào bắn | Params (đề xuất) |
|---|---|---|
| `session_create_form_opened` | Form `/dashboard/sessions/new` đạt Ready (§3) | `club_id` (opaque id), `entry_point` (enum: `dashboard \| session_list` — Flow 1 §2) |
| `session_create_submitted` | User bấm CTA, request bắt đầu — vào Submitting (§3, client-local) | `club_id` (opaque id), `sport` (enum), `visibility` (enum: `private \| public`), `join_policy` (enum: `auto \| approval`), `has_female_price` (boolean), `is_unlimited_slots` (boolean), `slot_count` (count — chỉ khi hữu hạn) |
| `session_create_success` | Server xác nhận draft tạo thành công — Success surface (§3) | `club_id` (opaque id), `session_id` (opaque id) |
| `session_create_failed` | Server trả error đã pin trong Error mapping §3, hoặc unknown/timeout | `club_id` (opaque id), `error_code` (enum — token có sẵn trong Error mapping §3; unknown/timeout ghi `unknown`), `is_network` (boolean) |

---

## State Machine (Draft)

> **Draft addition 2026-08-07 — design spec — không authorize render (theo §6 omit-active-UI).**
> Chỉ dùng state đã có trong file (StatusBadge §4: `draft · open · closed · cancelled`); transition
> suy từ Flow §2 + ActionBar §3; thiếu căn cứ → TBD (UNPINNED). Status là server-owned: FE không tự
> đổi state/badge — action bar dựng lại theo response server trả (`SESSION_NOT_OPEN`,
> `STALE_VERSION` §3).

### Session status (server-owned)

| Từ | Đến | Trigger (căn cứ) |
|---|---|---|
| `draft` | `open` | "Đăng kèo" + confirm (Flow 1 §2; ActionBar §3). Chặn bởi `MISSING_DISCOVERY_FIELDS` (§3) và publish quá giờ (§5 #4) — state giữ `draft` |
| `draft` | `cancelled` | "Huỷ nháp" + confirm (Flow 4 §2). `CANCEL_REQUIRES_REVIEW` → dừng tại chỗ, state giữ nguyên, chỉ message server (không gợi ý/nút Roster — Flow 4 §3) |
| `open` | `closed` | "Đóng" (ActionBar §3) hoặc tự động khi hết giờ (§1). `CLOSE_BLOCKED_OPEN_DEBT` → dừng tại chỗ, state giữ `open`, hiện danh sách người còn dư nợ (§3 Error mapping) |
| `open` | `cancelled` | "Huỷ" (ActionBar §3); `CANCEL_REQUIRES_REVIEW` → message server + gợi ý thứ tự (hoàn tác thanh toán rồi gỡ người) + nút Roster (§3) |
| `closed` / `cancelled` | — | Không có transition nào trong file — chỉ xem (§3). Reopen hoặc bất kỳ transition khác: TBD (UNPINNED) |

### Create form (client-local, không phải BE token)

`Loading → Ready → Submitting → { Success surface | Ready + inline error | Ready + fail-closed retry }`
(States + Submitting/Success §3). `Ready → Ready` khi inline validation (§3 Error). Không có đường
tắt `Ready → Success` bỏ qua Submitting.

---

## Acceptance Criteria (Draft)

> **Draft addition 2026-08-07 — design spec — không authorize render (theo §6 omit-active-UI).**
> Mỗi AC trace về § có sẵn trong file.

- **AC-1** (§3 `/dashboard/sessions/new` States): Loading hiện skeleton form; Ready pre-fill defaults từ CLB config.
- **AC-2** (§3 Submitting — Draft, client-local): trong khi request in-flight, CTA disabled + spinner + `t("Đang tạo…", "Creating…")`; bấm CTA lần 2 không tạo request thứ hai.
- **AC-3** (§3 Success surface — Draft): sau response thành công, summary card đọc giá trị từ response + đúng 2 CTA `t("Xem chi tiết", "View detail")` / `t("Chia sẻ", "Share")`; không auto-publish.
- **AC-4** (§3 Error mapping form tạo): mỗi error code đã pin hiện đúng visible state; unknown/timeout fail closed — form giữ data, không báo tạo thành công.
- **AC-5** (§2 Flow 1/4 + §3 tab Chi tiết): `draft` chỉ hiện Sửa + Đăng kèo + Huỷ nháp; `open` chỉ hiện Sửa + Đóng + Huỷ; `closed`/`cancelled` chỉ xem.
- **AC-6** (§3 Tab Thanh toán): payment surface absent hoàn toàn ở baseline — không fetch, không render error surface.
- **AC-7** (§6): không field session/capacity/roster DTO nào được fetch/render active khi còn `UNPINNED — omit active UI`; fixture §3 không làm seed/default/fallback.
- **AC-8** (§5 #10): offline khi submit → toast "Không có kết nối" + form giữ data.
- **AC-9** (Analytics Events — Draft): không event nào mang amount/tiền/PII; params chỉ opaque id, enum, count, boolean.

---

## Testing Notes (Draft)

> **Draft addition 2026-08-07 — design spec — không authorize render (theo §6 omit-active-UI).**
> Test cho surface còn `UNPINNED` chỉ được viết khi owner pin DTO — tới lúc đó là spec-only.

- **Double-submit** (§3 Submitting — Draft): mock latency, click CTA 2 lần nhanh → assert đúng 1 request; assert CTA disabled + copy `t("Đang tạo…", "Creating…")` trong lúc in-flight.
- **Submit outcomes** (§3 Error mapping): với mỗi error code đã pin → assert đúng visible state + form data giữ nguyên; unknown/timeout → fail-closed placeholder, không success toast.
- **Success surface** (§3 Success — Draft): assert giá trị card lấy từ mocked response chứ không từ form input; assert CTA điều hướng `/dashboard/sessions/:id`.
- **Status/ActionBar** (State Machine — Draft + §3): với mỗi status server trả, assert đúng tập action; assert FE không tự đổi badge trước refetch sau `SESSION_NOT_OPEN`/`STALE_VERSION`.
- **Omission** (§3 Tab Thanh toán + §6): assert payment tab không mount và không có network call payment; assert field `UNPINNED` không render active.
- **Analytics** (Analytics Events — Draft): snapshot allowlist param; assert payload không chứa key amount/tiền/PII nào.
- **i18n** (§6 i18n note): mọi chuỗi mới đi qua `t(vi, en)`.

---

_FE Design Spec v0.2 · 2026-07-31 · Source: feature_session_management.md v2.17 + feature_payment_reconcile.md v1.10_
_FE Design Spec v0.3 · 2026-08-07 · Δ v0.2→v0.3 (chỉ thêm, không sửa nội dung cũ): Draft Submitting + Success surface (§3 form tạo) và 4 section Draft cuối file (Analytics · State Machine · AC · Testing) · Source: Sporta FE porting analysis 2026-08-07_
_FE Design Spec — 2026-09-08 (cấu trúc, không bump version): thêm khối 📍 Đọc nhanh dưới header — feature nguồn · phase-1 (DD-114) · launch (DD-113) · surface PWA trước, native iOS/Android phase-2 (DD-69) · FE PENDING (DD-116) · as-built @ `0aff7ad`. Pointer core docs BRD v3.10 · PRD v2.9 · TDD v3.2 · ROADMAP v3.17. Nội dung thiết kế không đổi._

_Re-pin 2026-09-15 (cấu trúc, không bump version): as-built @ `e235ea4` theo `ROADMAP.md` v3.17 §📍 — 8 command session · 7 route nghiệp vụ · **0 màn FE**; FE PENDING (DD-116) không đổi, DD-119 vẫn 🟡 chưa ratify. Nội dung thiết kế không đổi._

_FE Design Spec — 2026-09-16: mirror the landed `UpdateSession` capacity guard and exact route error pairs; correct the current runtime header and preserve Draft/PENDING plus UNPINNED omission. No future occupancy policy or runtime change._

_FE Design Spec v0.7 · 2026-10-15 · Δ v0.6→v0.7 (PR #55 vòng review cuối, chỉ sửa chú thích — không đổi hành vi): dòng changelog v0.5 bên dưới gắn nhầm "(khớp `REMOVE_REQUIRES_REVIEW`)" vào mục giới hạn chiều cao danh sách `CLOSE_BLOCKED_OPEN_DEBT`. Đúng ra chú thích đó thuộc mục thứ tự gợi ý của session `open` (hoàn tác thanh toán trước, rồi mới gỡ người — vì `REMOVE_REQUIRES_REVIEW` từ chối gỡ người chơi đã có thanh toán; xem hàng `CANCEL_REQUIRES_REVIEW` trong bảng Error mapping). Danh sách nợ giới hạn chiều cao + cuộn nội bộ + `overflow-wrap` là quy tắc hiển thị riêng của danh sách đó, không phải một điểm "khớp" với `REMOVE_REQUIRES_REVIEW`. Dòng v0.5 giữ nguyên làm lịch sử. Draft/PENDING, UNPINNED omission và dòng fail-closed không đổi · Source: `feature_session_management_tech.md` v2.33_

_FE Design Spec v0.6 · 2026-10-15 · Δ v0.5→v0.6 (PR #55 F3): cập nhật dòng *Runtime status* đã lỗi thời — route đọc `GET /api/sessions` + `GET /api/sessions/[id]` và host workspace web (`apps/web/app/c/[tenantId]/sessions/`) đã có trên `main` (đo tại `d962b0c`); chỉ `GET /:id/guest-notes` và projector thật còn chưa build. Source-authority pin BE tech doc sửa từ v2.33 @ `93ba1d019e9c7a9f67c3180c168393192a4bbf30` (commit đó vẫn là v2.32) thành v2.33 @ `bc34a5686ece7cab82c2655abc39bbf5897d4bb4`, commit cuối cùng có v2.33; v2.34 chỉ thu hẹp câu claim của test ở §4, không đổi token lỗi/chính sách spec này lấy. Draft/PENDING, UNPINNED omission và dòng fail-closed không đổi · Source: `feature_session_management_tech.md` v2.33_

_FE Design Spec v0.5 · 2026-10-15 · Δ v0.4→v0.5 (PR #55 round-2 frontend review): `CANCEL_REQUIRES_REVIEW` trên session `draft` (anomaly) chỉ hiện message server — bỏ gợi ý + nút Roster vì roster không sửa được ở draft (Flow 4, §3, bảng Session status); gợi ý của session `open` đổi thứ tự thành hoàn tác thanh toán → gỡ người; danh sách `CLOSE_BLOCKED_OPEN_DEBT` giới hạn chiều cao + cuộn nội bộ + overflow-wrap (khớp `REMOVE_REQUIRES_REVIEW`); focus sau "Mở danh sách người chơi" chuyển tới tab Roster; source-authority pin BE tech doc → v2.33 @ `93ba1d019e9c7a9f67c3180c168393192a4bbf30`. Draft/PENDING, UNPINNED omission và dòng fail-closed không đổi · Source: `feature_session_management_tech.md` v2.33_

_FE Design Spec v0.4 · 2026-10-15 · Δ v0.3→v0.4: Error mapping thêm `CLOSE_BLOCKED_OPEN_DEBT` (409, danh sách người còn dư nợ) và `CANCEL_REQUIRES_REVIEW` thành cancel-only (DD-131 OD-1); Flow 4 và bảng Session status khớp; source-authority pin BE tech doc → v2.31 @ `ba8693e`. Draft/PENDING, UNPINNED omission và dòng fail-closed unknown/missing/timeout không đổi · Source: `feature_session_management_tech.md` v2.31_
