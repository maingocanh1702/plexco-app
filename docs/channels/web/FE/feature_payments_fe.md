# Feature: Payments & Ledger — FE Design Spec

> **Route(s):** `/dashboard/payments`
> **Source authority:** `../../../features/FE/feature_payment_reconcile.md` v1.10 · baseline `0c5808fc7cf50d139bdd9c4ee79917bf4059c4f4`
> **Source authority (BE tokens):** `../../../features/BE/feature_payment_reconcile_tech.md` — `ALLOCATION_EXCEEDS_FUNDS` · `CHARGE_ALREADY_SETTLED` · `REVERSAL_EXCEEDS_EFFECTIVE` · `ATTESTED_TRANSFER_UNSUPPORTED`; HTTP status cho phần lớn catalog **chưa pin** (`:472` — "HTTP mapping cho code chưa pin sẽ chốt ở build slice"), nên §3 để `—` ở cột Status thay vì đoán.
> **Source contract status:** Reviewed; primary plan PLAN_READY nhưng runtime slices chưa CODE_READY
> **Projection/API contract:** `UNPINNED` — unified ledger/month summaries phải omit khỏi active UI tới khi có discriminated DTO owner
> **Capability/availability:** `payment_reconcile_auto` entitlement + server availability; both required
> **Priority:** 6 — designer-kickoff.md §3B (payments = màn 5+6)
> **FE design status:** Draft
> **Runtime status:** Partial ledger schema only — reconcile service/routes/web UI chưa build
> **Negative scope:** Không suy money state client-side; auto-reconcile chỉ hiện khi entitlement và availability đều PASS
> **Liên quan (2026-08-07, decisions v2.18):** Statement/export sao kê = surface riêng thuộc **DD-97** (per-session view free · kỳ + export `host_pro`) — KHÔNG thuộc file này. Mark-paid/`cash|waiver` surface (SourceBadge §4 hiện dead enum) = **DD-99 P4**, prioritized sau P2; refund-on-cancel tách chờ refund policy. **DD-98** NP-1/NP-4 chặn custom split per player + auto-archive nợ theo tuổi.

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

> **Draft bổ sung cho #8 — happy empty state (copy-level, thêm 2026-08-07):** Ngoài trường hợp
> "mới dùng, chưa có giao dịch" giữ nguyên copy #8 ở trên, khi dữ liệu server trả cho thấy đồng thời
> (a) không còn bank transaction nào chưa khớp VÀ (b) không charge nào ở trạng thái `open | partial`,
> empty state dùng tone tích cực: `t("Tất cả đã khớp — không còn gì cần đối soát 🎉", "All reconciled — nothing left to match 🎉")`.
> Điều kiện xác định thuần từ dữ liệu server trả (danh sách/count do server cung cấp); FE không tự
> suy điều kiện từ tính toán client-side (§6 "Không tự cộng client-side"). Đây là bổ sung copy,
> không thêm fetch/surface nào ngoài những gì đã pin ở trên.

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

---

## Analytics Events (Draft — đề xuất, chưa phải contract)

> **Draft — đề xuất, chưa phải contract, KHÔNG authorize implement.** Event name/schema cuối cùng do
> analytics owner pin. **Ràng buộc params (bắt buộc, kế thừa negative scope header + hard rule
> tiền/PII):** params KHÔNG BAO GIỜ chứa amount/số tiền, tên người, nội dung/memo chuyển khoản,
> số tài khoản; chỉ được dùng opaque id, enum, count, boolean.

Reconcile funnel: `payments_txn_viewed` → `payments_allocation_started` → `payments_allocation_confirmed` / `payments_reversal_confirmed`.

| # | Event | Khi bắn (trace flow) | Params đề xuất (opaque id · enum · count · boolean) |
|---|---|---|---|
| 1 | `payments_txn_viewed` | Host xem chi tiết 1 bank transaction từ ledger (Flow 1 bước 3 · Flow 2 bước 2–3) | `bank_transaction_id` (opaque id) · `txn_status` (`matched\|unmatched\|partial`) · `entry_tab` (`all\|unmatched\|history`) |
| 2 | `payments_allocation_started` | Allocation Panel mở (Flow 2 bước 3 · Flow 3 bước 1) | `bank_transaction_id` (opaque id) · `txn_status` (enum) · `candidate_count` (count) · `from_suggestion` (boolean — mở từ candidate hệ thống gợi ý (Flow 2 bước 4) hay host tự chọn) |
| 3 | `payments_allocation_confirmed` | CHỈ sau khi server trả success cho request gán (Flow 3 bước 4); không bắn optimistic | `bank_transaction_id` (opaque id) · `charge_count` (count charge trong request) · `result_txn_status` (enum server trả: `matched\|partial\|unmatched`) |
| 4 | `payments_reversal_confirmed` | CHỈ sau khi server trả success cho reversal (Flow 4 bước 3); không bắn optimistic | `allocation_id` (opaque id) · `result_charge_status` (enum server trả: `open\|partial\|paid\|void`) · `result_txn_status` (enum server trả: `matched\|partial\|unmatched`) |

- Không có event cho failure path trong Draft này — error analytics (nếu cần) sẽ đề xuất riêng, và
  cũng chỉ được mang `error.code` enum, không mang nội dung response.
- Mọi `result_*` param lấy từ canonical state server trả (Flow 4 bước 3), không phải state FE tự suy.

---

## State Machine (Draft)

> **Draft — mô tả để đọc/QA, KHÔNG phải logic FE.** Server là nơi duy nhất thực hiện transition
> (Flow 4 bước 3: server append reversal, recompute rồi trả canonical states); FE chỉ render state
> server trả, không tự suy post-state từ action. Chỉ liệt kê state đã có trong file này; transition
> suy từ Flow 1–4 + §5; thiếu căn cứ → TBD (UNPINNED).

### Bank transaction — `matched | partial | unmatched` (Flow 4)

| Từ | Đến | Trigger (server-side) | Căn cứ trong file |
|---|---|---|---|
| `unmatched` | `partial` | Allocation confirm nhưng chưa phủ hết số tiền CK | Flow 3 · §5 #2/#3 |
| `unmatched` | `matched` | Allocation phủ đủ (host confirm hoặc auto-reconcile/webhook match) | Flow 2–3 · §5 #5 |
| `partial` | `matched` | Gán tiếp phần dư ("Gán dư") | Flow 3 · §3 layout row `partial` |
| `matched` | `partial` / `unmatched` | Reversal append → server recompute; FE không đoán nhánh nào | Flow 4 |
| `partial` | `unmatched` | Reversal append → server recompute | Flow 4 |

Không tồn tại state `reversed` cho bank transaction (§6 · §7) — reversal là allocation entry
âm/append-only, không phải bank-transaction status.

### Charge — `open | partial | paid | void` (Flow 4)

| Từ | Đến | Trigger (server-side) | Căn cứ trong file |
|---|---|---|---|
| `open` | `partial` | Allocation một phần | Flow 3 · §5 #2 |
| `open` | `paid` | Allocation đủ amount due | Flow 3 |
| `partial` | `paid` | Allocation phần còn thiếu | Flow 3 |
| `paid` | `partial` / `open` | Reversal → server recompute; FE không đoán nhánh nào | Flow 4 |
| `partial` | `open` | Reversal → server recompute | Flow 4 |
| vào/ra `void` | — | TBD (UNPINNED) — không flow nào trong file này tạo/thoát `void`; Flow 4 chỉ liệt kê `void` trong tập canonical | Flow 4 |

### UI-local states (client-local, không phải BE token)

- Allocation Panel: `Loading → Ready → (Success | Error)`; nhánh over-allocation do server phán quyết
  qua `ALLOCATION_EXCEEDS_FUNDS` (§3 Allocation Panel States) — bản thân chuỗi Loading/Ready/Success/Error
  là trạng thái UI thuần client (client-local, không phải BE token).
- Reversal Dialog: `confirm → processing → success` (§4 `ReversalDialog`) — cũng là trạng thái UI
  thuần client (client-local, không phải BE token), không map vào error catalog hay charge/txn state.

---

## Acceptance Criteria (Draft)

> **Draft — KHÔNG authorize implement.** Mỗi AC trace về section có sẵn trong file; AC không thêm
> error code/HTTP status mới (các ô "—" và surface UNPINNED giữ nguyên) và không mở surface/flow mới.
> **Nguyên tắc xuyên suốt (§6 "Không tự cộng client-side" + negative scope header): FE không tự
> cộng/tự tính bất kỳ con số nào — mọi số hiển thị đều đến từ server.**

| # | AC | Trace |
|---|---|---|
| AC-1 | `/dashboard/payments` không render cho user thiếu quyền admin; `NOT_TENANT_ADMIN` → redirect về dashboard đúng error mapping | §3 Ledger error mapping |
| AC-2 | Baseline: unified ledger + month summary không fetch, không render row/card/summary — ở cả 3 breakpoint | §3 fixture note · §3 Responsive · §6 |
| AC-3 | Thiếu entitlement `payment_reconcile_auto` HOẶC availability không PASS → toàn bộ auto-reconcile surface absent (tab "Chưa khớp", card CK chưa khớp, mọi auto action); không render control disabled | §5 #6/#6a · header Capability |
| AC-4 | Không có phép cộng/trừ/so sánh tiền nào ở client: vùng tổng Allocation Panel chỉ hiển thị giá trị server trả; chưa pin preview DTO → unavailable placeholder; toast success dùng số trong response, không dựng lại từ selection | §3 Allocation Panel note + States · §4 `AllocationTotal` · §6 |
| AC-5 | `ALLOCATION_EXCEEDS_FUNDS` → inline error, panel giữ mở; FE không tự so sánh tổng với số tiền CK trước khi submit | §3 Allocation Panel error mapping |
| AC-6 | Sau reversal confirm: FE refetch và render canonical states server trả, không hardcode post-state; không render bank-transaction status `reversed` | Flow 4 · §6 · §7 |
| AC-7 | Unknown/missing/timeout response → fail closed: unavailable placeholder + retry; không render 0đ, empty state hay success từ response thiếu | §3 các dòng *(unknown / missing / timeout)* |
| AC-8 | Happy empty state chỉ hiện khi dữ liệu server trả cho thấy đồng thời: không còn bank txn chưa khớp VÀ không charge `open\|partial`; FE không tự suy điều kiện từ tính toán; trường hợp new-user giữ copy #8 gốc | §5 #8 + Draft bổ sung #8 |
| AC-9 | Mọi chuỗi user-facing đi qua `t(vi, en)`; không hardcode một ngôn ngữ | §6 i18n note |
| AC-10 | `SourceBadge` render đủ 5 giá trị enum; không gộp `auto` + `manual` thành một badge "CK" | §4 `SourceBadge` · §6 Source type |
| AC-11 | Request gán gửi exact `bank_transaction_id` + `charge_id`; không gửi/tìm theo tên hiển thị | Flow 2 bước 3–4 · Flow 3 bước 2 · §5 #1 |
| AC-12 | Analytics params không chứa amount/số tiền, tên người, số tài khoản, memo; chỉ opaque id, enum, count, boolean | Analytics Events (Draft) · header Negative scope |
| AC-13 | Với mã lỗi chưa pin HTTP status, FE map theo `error.code`; AC này không pin thêm status nào (cột Status "—" giữ nguyên) | §3 note trên Allocation Panel error mapping · header BE tokens |

---

## Testing Notes (Draft)

> **Draft — KHÔNG authorize implement.** Runtime hiện chưa có reconcile service/routes/web UI
> (header Runtime status), nên E2E chỉ chạy được khi runtime slice tồn tại. Test chống lại surface
> UNPINNED (unified ledger, month summary, preview total) KHÔNG được viết fixture giả định DTO shape.

- **Component/unit (viết được khi component tồn tại):**
  - `SourceBadge`: đủ 5 enum, không gộp `auto`/`manual` (AC-10)
  - `AllocationTotal`: đổi selection KHÔNG làm đổi giá trị hiển thị khi chưa có response server; chưa pin preview DTO → unavailable placeholder (AC-4)
  - `BankTransactionStatusBadge`: đúng 3 status, không nhận `reversed` (AC-6)
  - Fail-closed: response thiếu field/malformed → unavailable + retry, không render 0đ/empty/success (AC-7)
- **Gating matrix (mock server):** 4 tổ hợp entitlement × availability — chỉ PASS+PASS render auto surface; 3 tổ hợp còn lại absent hoàn toàn, không có control disabled (AC-3)
- **Error mapping:** mỗi dòng đã pin trong §3 có 1 test render đúng visible state + i18n string; assert theo `error.code`, KHÔNG assert HTTP status cho dòng đang để "—" (AC-5 · AC-13)
- **State render:** FE render đúng canonical state server trả cho mọi hàng trong State Machine (Draft); KHÔNG viết test kiểu "FE tự chuyển state" vì transition là server-side (AC-6)
- **Concurrency (§5 #5):** mock conflict host-gán + webhook-match → reload latest state + toast "Đã có thay đổi"
- **Happy empty state:** chỉ hiện khi mock server trả đủ cả 2 điều kiện; từng điều kiện lẻ → không hiện (AC-8)
- **i18n:** snapshot cả vi lẫn en cho mọi chuỗi mới (AC-9)
- **Keyboard (§7):** Tab qua rows, Enter mở detail, Escape đóng panel
- **Analytics schema allowlist:** test tự động assert payload 4 event chỉ chứa key trong bảng đề xuất; fail nếu xuất hiện key dạng amount/name/account (AC-12)
- **E2E (deferred):** Flow 2→3→4 trên runtime thật khi slice tương ứng CODE_READY — TBD (UNPINNED), không viết trước theo fixture

---

_FE Design Spec v0.4 · 2026-08-07 · Source: feature_payment_reconcile.md v1.10_
_Changelog v0.3 → v0.4 (2026-08-07): Thêm happy empty state + 4 section Draft — nguồn: Sporta FE porting analysis 2026-08-07_
