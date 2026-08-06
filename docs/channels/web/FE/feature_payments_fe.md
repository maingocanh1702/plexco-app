# Feature: Payments & Ledger — FE Design Spec

> **Route(s):** `/dashboard/payments`
> **Source authority:** `../../../features/feature_payment_reconcile.md` v1.10 · baseline `0c5808fc7cf50d139bdd9c4ee79917bf4059c4f4`
> **Source authority (BE tokens):** `../../../features/BE/feature_payment_reconcile_tech.md` — `ALLOCATION_EXCEEDS_FUNDS` · `CHARGE_ALREADY_SETTLED` · `REVERSAL_EXCEEDS_EFFECTIVE` · `ATTESTED_TRANSFER_UNSUPPORTED`; HTTP status cho phần lớn catalog **chưa pin** (`:472` — "HTTP mapping cho code chưa pin sẽ chốt ở build slice"), nên §3 để `—` ở cột Status thay vì đoán.
> **Source contract status:** Reviewed; primary plan PLAN_READY nhưng runtime slices chưa CODE_READY
> **Projection/API contract:** `UNPINNED` — unified ledger/month summaries phải omit khỏi active UI tới khi có discriminated DTO owner
> **Capability/availability:** `payment_reconcile_auto` entitlement + server availability; both required
> **Priority:** 6 — designer-kickoff.md §3B (payments = màn 5+6)
> **FE design status:** Draft
> **Runtime status:** Partial ledger schema only — reconcile service/routes/web UI chưa build
> **Negative scope:** Không suy money state client-side; auto-reconcile chỉ hiện khi entitlement và availability đều PASS

---

## 1. Mô tả

Quản lý thu tiền của CLB: xem ledger giao dịch, xử lý CK chưa khớp, gán tiền thủ công, và hoàn tác gán nhầm. `payment_reconcile_auto` chỉ là entitlement; auto-reconcile còn cần server xác nhận availability theo provider/bank/market/currency, consent và runtime. Exact availability DTO, unified ledger projection và kỳ/tháng summary formula chưa được pin, nên các bảng/cards bên dưới là visual target fixtures và phải **omit** khỏi implementation hiện tại. Mark-paid thủ công chỉ thuộc surface nào có contract riêng.

---

## 2. User Flows

### Flow 1: Xem ledger tổng quan (design-only; DTO owner pending)

1. Host vào `/dashboard/payments`
2. Thấy summary cards: tổng thu tháng, chưa thu; card CK chưa khớp chỉ hiện khi server trả auto-reconcile availability active
3. Thấy bảng giao dịch (bank transactions + allocations)
4. Filter: theo ngày, trạng thái (matched/unmatched/partial)

### Flow 2: Xử lý CK chưa khớp (target design; entitlement + availability active)

1. Host click tab "Chưa khớp" hoặc badge "3 CK chưa khớp"
2. Thấy danh sách CK: tên CK, số tiền, ngày, lý do chưa khớp
3. Click 1 CK → mở panel gán: chọn charge bằng row có `pay_code`; tên player chỉ để nhận diện
4. Hoặc hệ thống gợi ý candidate → host confirm; request gửi exact `bank_transaction_id` + `charge_id`, không gửi/tìm theo tên

### Flow 3: Manual allocation (gán CK cho nhiều người)

1. Host chọn 1 CK có dư → click "Gán"
2. Popup: chọn 1 hoặc nhiều charges bằng exact `charge_id`/`pay_code` → nhập số tiền mỗi charge
3. Tổng không vượt số tiền CK
4. Confirm → allocations created → charge status cập nhật

### Flow 4: Hoàn tác gán nhầm

1. Host tìm allocation cần hoàn → click "Hoàn tác"
2. Confirm dialog chỉ mô tả append-only reversal: không sửa/xóa allocation cũ
3. Server append reversal entry, recompute rồi trả canonical states. FE refresh và render, không hardcode post-state:
   - Charge: `open | partial | paid | void`
   - Bank transaction: `matched | partial | unmatched`

---

## 3. Screens & States

### `/dashboard/payments` — Ledger

> **Visual fixture only:** Monthly summary values and the unified row shape below are not an API contract. Do not implement/fetch/sort this surface until the projection owner contract named at the end of this spec is Reviewed.

#### Layout (Desktop 1440px)

```
┌──────────┬──────────────────────────────────────────────────┐
│          │  Header: "Thanh toán" · Filter: [Tháng này ▾]    │
│ Sidebar  ├──────────────────────────────────────────────────┤
│          │                                                  │
│          │  Summary Cards (3)                                │
│          │  ┌──────────┐ ┌──────────┐ ┌──────────┐         │
│          │  │ 💰 Đã thu│ │ 📋 Chưa  │ │ ⚠️ CK    │         │
│          │  │ tháng    │ │ thu      │ │ chưa khớp│         │
│          │  │ 4.5tr    │ │ 1.2tr    │ │ 3        │         │
│          │  └──────────┘ └──────────┘ └──────────┘         │
│          │                                                  │
│          │  Tab Bar: [Tất cả] [Chưa khớp (3)] [Lịch sử]   │
│          │                                                  │
│          │  ┌────────────────────────────────────────────┐  │
│          │  │ Table: Giao dịch                           │  │
│          │  ├────────────────────────────────────────────┤  │
│          │  │ Ngày      │ Nguồn  │ Tên       │ Số tiền  │  │
│          │  │ Trạng thái│ Player │ Session   │ Actions  │  │
│          │  ├────────────────────────────────────────────┤  │
│          │  │ 05/08 14:22│ CK    │ NGUYEN A  │ 150,000  │  │
│          │  │ ✅ matched │ Ng. A │ BM T5     │ [Chi tiết]│  │
│          │  ├────────────────────────────────────────────┤  │
│          │  │ 05/08 15:30│ CK    │ TRAN THI B│ 300,000  │  │
│          │  │ ⚠️ unmatched│ —    │ —         │ [Gán]    │  │
│          │  ├────────────────────────────────────────────┤  │
│          │  │ 04/08 20:00│ Cash  │ —         │ 150,000  │  │
│          │  │ ✅ matched │ Lê C  │ BM T4     │ [Chi tiết]│  │
│          │  ├────────────────────────────────────────────┤  │
│          │  │ 04/08 18:10│ CK    │ PHAM D    │ 200,000  │  │
│          │  │ 🔄 partial │ Phạm D│ BM T4     │ [Gán dư] │  │
│          │  └────────────────────────────────────────────┘  │
│          │                                                  │
│          │  Pagination: [← 1 2 3 →]                        │
│          │                                                  │
└──────────┴──────────────────────────────────────────────────┘
```

#### Layout (Mobile 375px)

```
┌──────────────────────┐
│ ☰  Thanh toán        │
├──────────────────────┤
│ Summary (scrollable) │
│ ┌──────┐ ┌──────┐   │
│ │💰4.5tr│ │📋1.2tr│  │
│ └──────┘ └──────┘   │
├──────────────────────┤
│ [Tất cả] [Chưa khớp]│
├──────────────────────┤
│ Transaction Cards    │
│ ┌──────────────────┐ │
│ │ CK · NGUYEN A    │ │
│ │ 150,000đ · 05/08 │ │
│ │ ✅ → Ng. A, BM T5│ │
│ └──────────────────┘ │
│ ┌──────────────────┐ │
│ │ CK · TRAN THI B  │ │
│ │ 300,000đ · 05/08 │ │
│ │ ⚠️ Chưa khớp     │ │
│ │ [Gán →]           │ │
│ └──────────────────┘ │
├──────────────────────┤
│ Bottom Nav           │
└──────────────────────┘
```

#### States

- **Current implementation:** Omit entire unified ledger/month-summary surface; projection DTO is unpinned
- **Future Loading/Ready/Empty/Error:** Author only with the Reviewed discriminated projection; wireframe copy is not fallback data

#### Error mapping

| Status | Error code | Visible state | i18n `t(vi, en)` |
|---|---|---|---|
| — | `UNPINNED error catalog — omit active UI` | Unified ledger + month summary: không fetch, không render row/card/summary nào ở baseline — không có surface thì không có error surface | `N/A — surface omitted` |
| 403 | `NOT_TENANT_ADMIN` | Route không render; redirect về dashboard | `t("Bạn không có quyền admin của club này", "You don't have admin access to this club")` |
| 403 | `CAPABILITY_DENIED` | Omit toàn bộ auto-reconcile surface (tab "Chưa khớp", card CK chưa khớp, mọi auto action); không hiện control disabled | `t("Bạn không có quyền thực hiện thao tác này", "You don't have permission for this action")` |
| 403 | `TENANT_SUSPENDED` | Banner đầu trang; mọi money action absent | `t("Club đang tạm ngưng", "This club is suspended")` |
| — | *(unknown / missing / timeout)* | **Fail closed** — unavailable placeholder + retry; không render 0đ, empty state hay "đã thu" từ response thiếu | `t("Không tải được dữ liệu thanh toán. Thử lại.", "Couldn't load payment data. Try again.")` |

> **Error mapping:** Pin server error/status → exact visible state. Unknown/missing response fail closed;
> không invent success, zero, empty hoặc disabled control. Nếu BE chưa pin catalog cho một endpoint,
> ghi `UNPINNED error catalog — omit active UI` thay vì bịa mã.

#### Responsive

| Breakpoint | Ledger |
|---|---|
| 1440px | Sidebar fixed 240px full label (`feature_dashboard_fe.md` §3); header "Thanh toán" + filter [Tháng này ▾] cùng hàng; 3 summary card trên một hàng (§7); tab bar [Tất cả] · [Chưa khớp] · [Lịch sử] sticky dưới header; giao dịch dạng table full width; pagination dưới table |
| 768px | Sidebar ẩn + hamburger ☰ (`feature_dashboard_fe.md` §3: ≤768px hidden + overlay). File này chỉ pin hai wireframe (Desktop 1440px · Mobile 375px) và **không pin bố cục tablet riêng**; giữ composition desktop thu hẹp — summary cards cùng hàng, tab bar sticky, table thu nhỏ theo viewport. Không tự đặt ngưỡng chuyển table → card ở đây |
| 375px | Theo wireframe Mobile: hàng đầu ☰ + "Thanh toán"; summary strip scroll ngang (§7: horizontal scroll hoặc 2+1 grid); tab bar rút còn các tab hiển thị được; giao dịch thành card stack, **không** cuộn ngang (§7); Bottom Nav ở đáy. Baseline omit set không đổi theo breakpoint — unified ledger + month summary vẫn không fetch/không render row/card/summary ở mọi kích thước (§3 fixture note + error mapping row 1), và auto-reconcile surface (tab "Chưa khớp", card "CK chưa khớp", mọi auto action) absent khi entitlement `payment_reconcile_auto` hoặc availability không PASS (§5 #6/#6a) — wireframe Mobile vì thế chỉ vẽ 2 summary card |

---

### Allocation Panel (slide-out / modal)

```
┌──────────────────────────────────────────┐
│  Gán giao dịch                    [✕]   │
│                                          │
│  CK: TRAN THI B · 300,000đ · 05/08      │
│  Chưa gán: 300,000đ                      │
│                                          │
│  ── Chọn player/kèo ──                   │
│  ┌──────────────────────────────────┐    │
│  │ ☐ PC-A7F2 · Trần B · BM T5 · 150k open │ │
│  │ ☐ PC-C2KD · Trần B · BM T4 · 100k open │ │
│  │ ☐ PC-E4Q2 · Lê C   · BM T5 · 150k open │ │
│  └──────────────────────────────────┘    │
│                                          │
│  Selected: 2 charges                     │
│  Tổng đã chọn / còn dư: (server trả)     │
│                                          │
│  [         Xác nhận gán         ]        │
│                                          │
│  ⚠️ Phần dư (nếu có) giữ ở "Chưa khớp"  │
│  để gán sau — số do server trả           │
└──────────────────────────────────────────┘
```

> ⚠️ **Không có running total tính ở client.** Vòng trước wireframe vẽ "Selected: 2 charges ·
> 250,000đ" + "Còn dư: 50,000đ" và §4 khai `RunningTotal` "real-time" — mâu thuẫn trực tiếp negative
> scope ở header ("Không suy money state client-side") và §6 ("Không tự cộng client-side"). FE chỉ
> gửi tập charge đã chọn; **mọi con số tiền hiển thị phải đến từ response**. Nếu chưa có preview
> endpoint được pin, ô tổng để trống/unavailable chứ không tự cộng.

#### States

- **Loading:** Skeleton charge list
- **Ready:** CK info + selectable charge list. Vùng tổng hiển thị **giá trị server trả**; chưa pin preview DTO ⇒ unavailable placeholder
- **Over-allocation guard:** **Server phán quyết**, FE không tự so sánh. Trả `ALLOCATION_EXCEEDS_FUNDS` → inline error `t("Vượt quá số tiền CK", "Exceeds the transfer amount")`
- **Success:** Toast dùng số tiền **server trả trong response**, không dựng lại từ selection + panel đóng + table refresh
- **Error:** Retry inline

#### Error mapping

> HTTP status của các mã ledger dưới đây chưa được pin ở BE (`feature_payment_reconcile_tech.md` §6: "HTTP mapping cho code chưa pin sẽ chốt ở build slice"); FE map theo `error.code`, không theo status đoán.

| Status | Error code | Visible state | i18n `t(vi, en)` |
|---|---|---|---|
| — | `ALLOCATION_EXCEEDS_FUNDS` | Inline error trong panel, panel giữ mở; server là nguồn duy nhất phán quyết, FE không tự tính lại | `t("Số tiền gán vượt quá phần còn lại của giao dịch", "Allocation exceeds the funds left on this transaction")` |
| — | `CHARGE_ALREADY_SETTLED` | Inline error + refetch danh sách charge; không giữ selection cũ, không tự trừ ở client | `t("Khoản này đã được thanh toán", "This charge is already settled")` |
| 403 | `TENANT_SUSPENDED` | Panel không mở; action "Gán" absent | `t("Club đang tạm ngưng", "This club is suspended")` |
| 429 | `RATE_LIMITED` | Chặn submit theo server; không auto-retry, không hàng đợi ngầm | `t("Quá nhiều yêu cầu — thử lại sau", "Too many requests — try again later")` |
| — | *(unknown / missing / timeout)* | **Fail closed** — unavailable placeholder + retry; không báo gán thành công và không cập nhật số liệu ở client | `t("Không gán được. Thử lại.", "Couldn't allocate. Try again.")` |

> **Error mapping:** Pin server error/status → exact visible state. Unknown/missing response fail closed;
> không invent success, zero, empty hoặc disabled control. Nếu BE chưa pin catalog cho một endpoint,
> ghi `UNPINNED error catalog — omit active UI` thay vì bịa mã.

#### Responsive

| Breakpoint | Allocation Panel |
|---|---|
| 1440px | Slide-out panel bên phải rộng 400px (§7), overlay lên ledger; header "Gán giao dịch" + [✕]; khối thông tin CK (tên · số tiền · ngày · "Chưa gán") trên đầu; danh sách charge checkbox cuộn dọc trong panel, mỗi dòng giữ `pay_code` + tên + kèo trên một hàng; vùng tổng + [Xác nhận gán] ở đáy panel |
| 768px | Giữ slide-out 400px, danh sách charge cuộn dọc; dòng charge được phép wrap khi `pay_code` + tên + kèo không đủ chỗ. **§7 chỉ pin hai dạng (desktop slide-out · mobile bottom sheet) và không pin ngưỡng chuyển** — không tự đặt số ở đây |
| 375px | Bottom sheet 70vh (§7), swipe down để đóng (§5 #10); dòng charge wrap 2 dòng; nút [Xác nhận gán] full-width dính đáy sheet. Ràng buộc tiền không đổi theo breakpoint — vùng tổng luôn hiển thị **giá trị server trả**, chưa pin preview DTO ⇒ unavailable placeholder, không cộng client-side ở bất kỳ kích thước nào; `TENANT_SUSPENDED` ⇒ panel không mở và action "Gán" absent |

---

### Reversal Confirm Dialog

```
┌──────────────────────────────────┐
│  Hoàn tác gán                   │
│                                  │
│  Bạn muốn hoàn tác:            │
│  • Trần B — BM T5 — 150,000đ   │
│                                  │
│  Hệ thống sẽ ghi một bút toán   │
│  hoàn ngược, tính lại trạng thái│
│  rồi cập nhật danh sách.        │
│                                  │
│  [Huỷ]        [Xác nhận hoàn]   │
└──────────────────────────────────┘
```

#### Error mapping

| Status | Error code | Visible state | i18n `t(vi, en)` |
|---|---|---|---|
| — | `REVERSAL_EXCEEDS_EFFECTIVE` | Dialog giữ mở + inline error; không ghi reversal, không sửa/xoá allocation cũ | `t("Số tiền hoàn vượt quá phần đã nhận còn lại", "Reversal exceeds the amount still received")` |
| — | `CHARGE_ALREADY_SETTLED` | Dialog đóng + refetch canonical state; không hardcode post-state | `t("Khoản này đã được thanh toán", "This charge is already settled")` |
| 403 | `TENANT_SUSPENDED` | Dialog không mở; action "Hoàn tác" absent | `t("Club đang tạm ngưng", "This club is suspended")` |
| 429 | `RATE_LIMITED` | Chặn submit theo server; không auto-retry | `t("Quá nhiều yêu cầu — thử lại sau", "Too many requests — try again later")` |
| — | *(unknown / missing / timeout)* | **Fail closed** — unavailable placeholder + retry; không render reversal row và không đoán canonical state sau hoàn | `t("Không hoàn tác được. Thử lại.", "Couldn't reverse. Try again.")` |

> **Error mapping:** Pin server error/status → exact visible state. Unknown/missing response fail closed;
> không invent success, zero, empty hoặc disabled control. Nếu BE chưa pin catalog cho một endpoint,
> ghi `UNPINNED error catalog — omit active UI` thay vì bịa mã.

#### Responsive

| Breakpoint | Reversal Confirm Dialog |
|---|---|
| 1440px | Dialog nhỏ centered ngang + dọc, overlay lên ledger; tiêu đề "Hoàn tác gán" → dòng allocation cần hoàn → đoạn giải thích append-only → hàng [Huỷ] · [Xác nhận hoàn] cùng dòng, canh phải |
| 768px | Không đổi cấu trúc — vẫn dialog centered, chỉ giảm padding ngoài |
| 375px | Dialog full-width trong padding an toàn; dòng allocation ("Trần B — BM T5 — 150,000đ") được phép wrap 2 dòng thay vì truncate; hai nút full-width. Wireframe dialog này chỉ có copy tĩnh + 2 nút nên **không có thành phần nào khác để mô tả degradation** — mọi thứ còn lại giữ nguyên ở cả ba breakpoint, kể cả việc `TENANT_SUSPENDED` ⇒ dialog không mở và action "Hoàn tác" absent |

---

## 4. Components Used

| Component | States | Mô tả |
|---|---|---|
| `SummaryCard` | design-only pending owner contract | Không implement tới khi formula kỳ/timezone/reversal semantics + DTO được Reviewed |
| `TransactionTable` | design-only pending owner contract | Unified bank/allocation ledger cần discriminated DTO; không trộn status enums |
| `TransactionRow` | design-only pending owner contract | Future row phải pin discriminator và exact fields cho bank transaction vs allocation entry |
| `TransactionCard` | same states as row (mobile) | Card version cho mobile |
| `BankTransactionStatusBadge` | matched ✅, unmatched ⚠️, partial 🔄 | Chỉ cho bank transaction reconcile status |
| `AllocationEntryBadge` | allocation, reversal | Reversal là signed append-only entry, không phải bank transaction status |
| `SourceBadge` | `auto` · `manual` · `cash` · `waiver` · `reversal` | Badge nguồn tiền. **Enum canonical có 5 giá trị** (`feature_payment_reconcile.md:275`); vòng trước component chỉ có 3 badge và gộp im lặng `auto`+`manual` thành một badge "CK", làm mất phân biệt khớp-tự-động với host-xác-nhận-thủ-công. Mapping hiển thị phải do owner contract pin, FE không tự gộp |
| `AllocationPanel` | slide-out (desktop), bottom sheet (mobile) | Panel gán CK → charges |
| `ChargeCheckbox` | unchecked, checked, disabled | Selectable row keyed by exact `charge_id`; luôn hiện `pay_code`, player name chỉ display |
| `AllocationTotal` | server-value, unavailable (chưa pin preview DTO), over-limit (server trả `ALLOCATION_EXCEEDS_FUNDS`) | **Hiển thị số server trả, không cộng client-side.** Đổi tên từ `RunningTotal` vì tên cũ mô tả đúng hành vi bị negative scope cấm |
| `ReversalDialog` | confirm, processing, success | Dialog xác nhận hoàn tác |
| `FilterTabs` | Tất cả, Chưa khớp (badge), Lịch sử | Tab filter ledger |
| `DateRangeFilter` | preset (Tuần/Tháng/Quý) + custom range | Filter theo khoảng thời gian |

---

## 5. Edge Cases (UX)

| # | Case | Hiển thị |
|---|---|---|
| 1 | CK trùng tên/amount/ngày (nhiều candidate) | Hiện candidates có `pay_code`; host chọn exact charge, submit `bank_transaction_id` + `charge_id` |
| 2 | CK trả thiếu (partial) | Badge "🔄 partial" + "Còn thiếu: 50,000đ" |
| 3 | CK trả dư | Gán tối đa = amount due. Phần dư: "50,000đ chưa gán" badge |
| 4 | Gán nhầm → hoàn tác | Reversal row hiện trong ledger (amount âm, icon ↩️) |
| 5 | Host gán + webhook match cùng lúc | Conflict → reload latest state. Toast "Đã có thay đổi" |
| 6 | Thiếu entitlement `payment_reconcile_auto` | Omit tab "Chưa khớp", unmatched summary và mọi auto action |
| 6a | Có entitlement nhưng availability false/unknown/expired/revoked | Cũng omit toàn bộ auto surface; không hiện control disabled và không suy availability ở client |
| 7 | Tên CK bị garbled/thiếu | Hiện raw text từ bank + "?" icon |
| 8 | Không có CK nào (mới dùng) | Empty state: "Chưa có giao dịch CK" + giải thích cách hoạt động |
| 9 | CK amount = 0 hoặc âm | Không hiện trong UI (filtered server-side) |
| 10 | Mobile: allocation panel | Bottom sheet pattern (swipe down to close) |

---

## 6. Data hiển thị

| Field | Exact response path | Format | i18n `t(vi, en)` | Ghi chú |
|---|---|---|---|---|
| Transaction amount | `UNPINNED unified-ledger DTO — omit active UI` | "150,000đ" | N/A — currency formatter | Visual target only |
| Transaction date | `UNPINNED unified-ledger DTO — omit active UI` | "05/08 14:22" | N/A — locale formatter | Visual target only |
| Transaction name | `UNPINNED unified-ledger DTO — omit active UI` | Text (from bank) | N/A — provider content | Không dùng tên làm deterministic key |
| Source type | `UNPINNED discriminated ledger DTO — omit` | Badge theo enum canonical 5 giá trị | `t("Khớp tự động", "Auto-matched")` (`auto`) · `t("Host xác nhận", "Manually confirmed")` (`manual`) · `t("Tiền mặt", "Cash")` (`cash`) · `t("Miễn", "Waived")` (`waiver`) · `t("Đảo", "Reversal")` (`reversal`) | Enum `auto/manual/cash/waiver/reversal` (`feature_payment_reconcile.md:275`). **Không gộp `auto` với `manual` thành một badge "CK"** — hai cái khác nhau về nguồn phán quyết. Mapping badge→màu chờ owner contract |
| Bank transaction status | `UNPINNED bank-transaction DTO — omit` | Badge: matched/unmatched/partial | `t("Đã khớp", "Matched")` · `t("Chưa khớp", "Unmatched")` · `t("Khớp một phần", "Partial")` | Không có `reversed` status |
| Allocation entry | `UNPINNED allocation DTO — omit` | Signed amount + kind | `t("Gán", "Allocation")` · `t("Hoàn tác", "Reversal")` | Reversal là allocation âm/append-only |
| Allocation amount | `UNPINNED allocation DTO — omit` | "150,000đ" | N/A — currency formatter | Positive = gán, negative = hoàn tác |
| Running total | `UNPINNED canonical summary formula — omit` | "250,000đ / 300,000đ" | N/A — currency formatter | Không tự cộng client-side |
| Remaining CK | `UNPINNED canonical summary formula — omit` | "Còn 50,000đ chưa gán" | Label `t("Chưa gán", "Unallocated")`; số tiền: `data — no copy` | Không tự tính client-side |

> **i18n:** Mọi chuỗi user-facing ở file này đi qua `t(vi, en)` (`packages/core/src/i18n.ts`). Repo không có key-based i18n; cặp vi/en ở cột trên là chuỗi thật, không phải key.

---

## 7. Responsive & Interaction Notes

- **Summary cards:** Desktop = 3 cards 1 row. Mobile = horizontal scroll hoặc 2+1 grid
- **Transaction table:** Desktop = full table. Mobile = card stack (no horizontal scroll)
- **Allocation panel:** Desktop = slide-out panel bên phải (400px). Mobile = bottom sheet (70vh)
- **Filter tabs:** Sticky top (dưới header). "Chưa khớp" tab: badge đỏ khi count > 0
- **Transaction rows hover:** Highlight + "Chi tiết" / "Gán" text hiện
- **Money amounts:** `tabular-nums` font-variant. Red cho UI label "chưa trả" khi canonical status là `open`; green cho `paid`
- **Status badge pulse:** Unmatched badge có subtle pulse để thu hút attention
- **Reversal animation:** Row flash red → fade to một allocation reversal row ↩️; không tạo bank-transaction status `reversed`
- **Sort:** Click column header → sort (asc/desc indicator)
- **Dark mode:** Table bg `var(--bg-card)`, status colors giữ semantic
- **Keyboard:** Tab qua rows, Enter mở detail, Escape đóng panel

---

> **Implementation boundary:** Trước khi activate Flow 1 hoặc unified table, owner contract phải pin discriminator, response fields, pagination/sort, monthly period + tenant timezone, gross/net/reversal formula và per-row navigation. Thiếu bất kỳ phần nào → omit, không dùng fixture làm DTO.

_FE Design Spec v0.3 · 2026-07-31 · Source: feature_payment_reconcile.md v1.10_
