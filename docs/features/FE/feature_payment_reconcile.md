# Feature: Payment Reconciliation — Product/UX Spec

> **Canonical phase:** P3
> **Track:** 💰 Payment Reconciliation
> **Version:** 1.13 · 2026-08-12
> **Status:** Reviewed; mirror DD-32/DD-91 `DECISION_FINAL` + regional research boundary. Primary plan v1.8 đã `PLAN_READY` tại `90d292d`; B1/runtime slices vẫn cần strict `CODE_READY`
> **Implementation:** In progress — core matching/payments-logic + ledger integrity migrations `0019`/`0020` đã có; wiring webhook→settle→notify, `remainingAmount`, `getSelfPaymentStatus` và chat `/pay` chưa · authority: `../../standards/BUILD-STATUS.md` (Doc status ≠ Implementation status)
> **Prerequisites:** P0–P1 foundation + P2 tenant routing
> **Tài liệu liên quan:** `../../product/BRD.md` FR-5 · `../../product/PRD.md` FLOW 6/9 + §4.1 · `../../product/TDD.md` §3.2/3.6/3.7 · `../../standards/decisions.md` DD-25/DD-32/DD-40/DD-91 · **DD-97** (statement/export — composition consumer trên ledger này, surface riêng) · **DD-98** (negative scope: NP-1 custom split · NP-4 auto-archive) · `../../standards/business-rules.md` BL-PAY/BL-CBF · `feature_channel_booking_funnel.md` · `../BE/feature_channel_booking_funnel_tech.md` · `../../research/player-side-saas-reconciliation.md` · `../../research/auto-debt-reconciliation-regional-availability-2026-07-27.md`

> **Cập nhật v3.4 (DD-40, 2026-07-10):** **Mark-paid thủ công (tiền mặt/CK, tap/multi-select) mặc định MỌI tier** (kể cả `free`) — áp DD-25 (human-initiated money mutation cần preview+confirm). **Đối soát CK tự động** (webhook match) là tính năng **`host_pro`**.

> **DD-91 + regional boundary (target, chưa runtime):** `payment_reconcile_auto` là commercial entitlement, không phải bằng chứng availability. Current provider/schema authority chỉ có `sepay|apipay` cho rail Việt Nam và webhook→settle→notify chưa build, nên auto-reconcile chưa enabled ở cả Việt Nam; ngoài Việt Nam vẫn dùng mark-paid thủ công cho tới khi provider/bank/market/currency/consent gate và decision riêng đóng. Person-self payment status có một owner `getSelfPaymentStatus`; exact chat `/pay` chỉ là requester-only adapter vào cùng truth, không phải matcher/ledger writer mới.

---

## 1. Mục tiêu và nguyên tắc

Nhận & đối soát tiền sân của từng CLB. **Mọi tier**: host **đánh dấu đã trả thủ công** (tiền mặt/CK) bằng tap/multi-select. **`host_pro`**: thêm **tự động nhận chuyển khoản** qua webhook, lưu bền vững, đối chiếu với các khoản phải thu và cho host xử lý phần chưa khớp. Platform không giữ tiền player; ledger chỉ phản ánh giao dịch và phân bổ.

### Entry points

| Entry | Route / Surface | Actor | Mô tả |
|-------|----------------|-------|-------|
| Session detail → Roster → Mark paid | `/clubs/:id/sessions/:sid/roster` | Host | Tap/multi-select mark-paid thủ công |
| Club dashboard → Payments | `/clubs/:id/payments` | Host | Tổng hợp transactions + unmatched |
| Unmatched queue | `/clubs/:id/payments/unmatched` | Host | Gán manual CK cho người/charge |
| Webhook receiver | `/api/webhooks/:token` | System | SePay/ApiPay durable-ingest |
| Player self → Charges | `/api/me/charges` • Home tab | Player | Xem trạng thái thanh toán cá nhân |
| Bot → `/pay` command | Club chat / private DM | Player | Exact requester-only payment status |
| Bank account settings | `/clubs/:id/settings/bank` | Host | Quản lý STK primary, đổi STK |
| Reversal / undo | `/clubs/:id/payments/:alloc_id/reverse` | Host | Hoàn tác allocation sai |

### Bất biến

- Không ACK provider trước khi raw transaction + durable reconcile job đã commit.
- Không mất hoặc double-count giao dịch.
- Không tự đoán người nhận khi tên/số tiền nhập nhằng.
- Tổng allocation hiệu lực không vượt tiền giao dịch hoặc số tiền charge còn thiếu.
- Giao dịch và allocation đã audit không bị sửa/xóa; điều chỉnh bằng reversal.
- Mọi dữ liệu ledger tenant-scoped + RLS.
- Mọi consumer person-self đọc cùng canonical `getSelfPaymentStatus`; chỉ proven `known_zero` mới hiển thị 0. Home, web, chat và notification không tự tính lại balance.
- Payment proof cho booking channel phải là `bank_transactions` đã durable-ingest và được exact-match theo payment reference; QR hoặc nút “Tôi đã thanh toán” không phải settlement proof.

---

## 2. Use Cases

| ID | Actor | Hành động | Kết quả |
|---|---|---|---|
| PAY-UC-1 | SePay/ApiPay | Gửi webhook hợp lệ | `bank_transaction` + reconcile job commit rồi ACK |
| PAY-UC-2 | System | Nhận webhook duplicate | Trả 200 idempotently; không tạo transaction/job thứ hai |
| PAY-UC-3 | System | Match tên + amount + ngày rõ ràng | Tạo allocation vào charge phù hợp |
| PAY-UC-4 | System | Hai charge đồng giá cùng người/ngày | FIFO oldest-first, không vượt số tiền phủ |
| PAY-UC-5 | System | Nhận pay code sau khi P4 rollout | Deterministic match; P3 không phụ thuộc memo chỉ-có-code |
| PAY-UC-6 | Host | Mở `/unmatched` | Xem transaction còn `unallocated_amount` + lý do |
| PAY-UC-7 | Host | Gán một CK cho nhiều người/charge | Tạo nhiều manual allocations; tổng không vượt CK |
| PAY-UC-8 | Host (mọi tier) | Ghi nhận tiền mặt `/cash` | Tạo settlement allocation nguồn `cash`; không giả lập bank webhook |
| PAY-UC-9 | Host | Hoàn tác gán nhầm | Tạo reversal tham chiếu allocation gốc + audit |
| PAY-UC-10 | System (`host_pro`) | Retry unmatched | Idempotent worker thử lại transaction còn dư |
| PAY-UC-11 | System | Charge được phủ đủ | Chuyển `paid`, phát `payment.settled` outbox event |
| PAY-UC-12 | System | Charge chỉ được phủ một phần | Chuyển `partial`, chưa gửi thông báo “đã trả đủ” |
| PAY-UC-13 | Host | Đổi STK primary | Tạo `pending_change` 24h; QR vẫn dùng STK cũ; notify tất cả kênh đã link |
| PAY-UC-14 | Host | Cancel pending STK change | Huỷ pending; giữ STK hiện tại |
| PAY-UC-15 | Host (mọi tier) | **Mark-paid thủ công multi-select** — chọn 1 hoặc nhiều player (tap/multi-select), đánh dấu **tiền mặt** (`cash`) hoặc **CK** (khớp một `bank_transaction` đã ingest → `manual`) | Preview danh sách + tổng tiền → **confirm** (DD-25) → **INSERT `payment_allocations`** cho từng player (tiền mặt → `source='cash'`, không bank txn; CK khớp `bank_transactions` → `source='manual'`) + cập nhật `charges.amount_allocated`/`status`; audit; idempotent |
| PAY-UC-16 | Host | Bỏ chọn / sửa trước confirm | Preview cập nhật real-time; chỉ ghi ledger sau khi confirm |
| PAY-UC-17 | Player | Gõ exact `/pay` ở club chat/private Club Bot/human DM | Target DD-91: command được intercept trước message/Assistant, resolve own authorized club one/many/none rồi trả requester-only current status từ `getSelfPaymentStatus`; không ghi chat/ledger |
| PAY-UC-18 | Player chưa link Account | Chọn “Thanh toán & giữ chỗ” ở bước xác nhận booking channel | Chỉ khi provider/market capability được chứng minh: tạo payment hold 15 phút; verified full settlement gọi shared booking finalizer để tạo player + charge + allocation atomically. Không full settlement thì không active |

---

## 3. Matching và allocation flow

```text
Webhook
  → verify token/secret/account
  → DB transaction:
       insert bank_transaction (idempotency key)
       enqueue reconcile job/outbox
    COMMIT
  → ACK 200

Worker reconcile(tenant_id, bank_transaction_id)
  → SET LOCAL app.tenant_id
  → pay_code enabled + present? deterministic candidate
  → otherwise name + amount + date candidates
  → exactly one safe allocation plan? lock transaction + charges, allocate
  → ambiguous/partial remainder? keep unallocated, expose /unmatched
  → emit payment.allocated / payment.settled
```

**Không auto-split theo `fee × N` nếu chưa xác định được danh tính.** Một CK trả nhiều người phải có pay code xác định hoặc host gán tay.

### 3.1 Mark-paid thủ công (mọi tier — DD-40)

Không phụ thuộc webhook. Áp dụng cho **cả `free`**:

```text
Host mở roster/danh sách nợ (bot Zalo / Messenger / web)
  → tap chọn 1 hoặc NHIỀU player (multi-select)
  → chọn nguồn: tiền mặt (cash) | CK (khớp một bank_transaction đã ingest → manual)
  → PREVIEW: danh sách player + charge + tổng tiền  (DD-25 — human-initiated money mutation)
  → CONFIRM
  → cho từng player: INSERT payment_allocations
       tiền mặt → source=cash, bank_transaction_id NULL, created_by=host
       CK       → source=manual, khớp một bank_transactions row
     + cập nhật charges.amount_allocated/status; actor=host, audit
     idempotent theo (charge, actor, intent); charge → paid/partial
  → phát payment.settled → xác nhận tự động tới player (feature_notifications_reminders FR-6.2)
```

- **Mark-paid CK thủ công** ≠ auto-reconcile: CK đã ingest → host gán allocation `source='manual'`. Host attest CK **chưa có** `bank_transaction` cần B1 enum migration/source riêng + actor/evidence reference; **cấm synthetic bank transaction**, cấm map sang `cash|manual`, cấm đoán số tiền. Trước khi B1 land, boundary reject fail-closed.
- **Auto-reconcile CK (webhook match tên+tiền+ngày, `/unmatched`)** cần tier **`host_pro`** (capability `payment_reconcile_auto`) **và** availability gate riêng (provider/bank/market/currency/consent). Flag entitlement không đủ để enable. Free và mọi market chưa có provider path = `payment_mark_manual`.
- Charge của mỗi lượt chơi suy theo giá kèo; nếu kèo đặt giá nam/nữ → xem **DD-39 (✅ Chốt)** / `feature_user_settings` (suy `amount_due` theo `person.gender`; decrypt lỗi → fail-closed).

---

### 3.2 Person-self payment truth (DD-91 target)

- Canonical fields đã có: `charges.amount_due` + `charges.amount_allocated`.
- Target primitive duy nhất: `remainingAmount(amountDue, amountAllocated) = max(0, amountDue - amountAllocated)`. `effectiveFee` giữ `fee=NULL→NULL`, sau đó mới delegate; không consumer tự copy formula.
- `getSelfPaymentStatus` thuộc Player View person-self service và validate authz/integrity/dependency trước khi trả `known_amount|known_zero|unknown`.
- `/api/me/charges`, Home composition, exact requester-only `/pay` và authenticated notification detail dùng cùng service/projection. `/pay` trả synchronous authenticated `private, no-store`, không result row/ref/SSE/outbox/push/history và không chạy LLM.
- Đây là contract docs theo DD-91; `remainingAmount`, service và adapters chưa tồn tại trong runtime, còn phụ thuộc plan/slice readiness riêng.

---

### 3.3 Channel booking pay-now boundary (DD-32 target)

- Booking funnel sở hữu intent/hold/finalizer; Payment Reconciliation chỉ sở hữu durable bank truth và allocation.
- Payment reference của booking intent là deterministic, exact và tenant/connector/currency scoped. Giao dịch mang reference này được dành riêng cho funnel finalizer, không đi qua generic name/date/amount matcher.
- Provider ingest phải commit `bank_transactions` + durable job trước ACK. Sau khi ingest transaction kết thúc, job riêng mới gọi funnel finalizer; không giữ bank-row lock rồi gọi ngược vào Session/Join.
- Exact hoặc overpayment đủ phủ toàn bộ quote có thể confirm; finalizer allocate đúng `amount_due`, phần dư giữ unmatched. Underpayment, late payment, wrong reference/currency/account hoặc provider evidence không chắc chắn đều không tạo active player.
- Host manual mark-paid/screenshot không được dùng làm instant proof để bypass first-time Account link. Khi pay-now capability unavailable/unknown, bot chỉ offer link Account hoặc tiếp tục trên web.

---

## 4. Edge Cases

| # | Case | Hành vi bắt buộc |
|---|---|---|
| 1 | Provider authentication sai | 401 trước parse/persist: SePay production requires `X-SePay-Signature: sha256=<hex>` over `{X-SePay-Timestamp}.{raw_body}`, timestamp ±300s, constant-time; HMAC failure never downgrades to API key. Explicit SePay fallback accepts only `Authorization: Apikey <key>`. ApiPay separately verifies `ApiPay-Signature = HMAC-SHA256(raw_body, per-webhook secret)`. Không log secret/raw body. |
| 2 | Token tenant A + account tenant B | 409/401; không route bằng nội dung CK |
| 3 | Provider thiếu external ID | Synthetic hash ổn định từ provider/account/amount/time/content |
| 4 | Duplicate đồng thời | UNIQUE `(tenant, provider, external_id)`; một durable job |
| 5 | Process chết sau ACK | Job đã durable; retry tiếp tục từ `pending/unmatched` |
| 6 | CK thiếu/rỗng nội dung | Giữ `unmatched`; không đoán theo amount đơn thuần |
| 7 | Tên fuzzy có nhiều candidate ngang nhau | Manual review; threshold không hard-code khi chưa calibration |
| 8 | Trả thiếu | Allocation phần chắc chắn; charge `partial`; không notify paid |
| 9 | Trả dư | Charge tối đa amount due; phần dư giữ ở `unallocated_amount` |
| 10 | Một CK trả nhiều người | Host tạo nhiều allocations hoặc deterministic pay-code plan |
| 11 | Webhook và `/cash` cùng lúc | Lock charge; tổng hiệu lực không vượt amount due |
| 12 | Auto-match và host gán tay cùng lúc | Lock bank transaction + charges; loser reload state/no-op |
| 13 | Gán nhầm đã notify | Reversal + audit + correction event; không sửa row cũ |
| 14 | Tenant suspended | Durable-ingest ON; auto-settle/auto-notify OFF theo DD-51/PAY-OQ-2; không mất CK |
| 15 | Session bị hủy/player paid rời | Host-cancel refund toàn bộ; player-leave theo policy CLB + refund request; refund ngoài Plexco, log opaque reference; ledger append-only |
| 16 | Amount ≤ 0 | Reject validation; log metadata tối thiểu |
| 17 | Attacker chiếm account host → đổi STK | Đổi STK primary → `pending_change` 24h. Hệ thống vẫn dùng STK cũ cho QR. Thông báo đổi gửi MỌI kênh đã link (Zalo/Messenger/email/web). Rate-limit: max 2 lần/30 ngày. Ref: AUDIT G1, BL-PAY-10 |
| 18 | Mark-paid multi-select: 1 player trong batch đã paid | Skip player đó (idempotent), preview cảnh báo; các player còn lại vẫn ghi bình thường |
| 19 | Double-tap "Confirm" mark-paid | Idempotent theo `(charge, actor, intent)` — không tạo allocation trùng, không over-pay |
| 20 | Host Pro có entitlement nhưng provider/bank/market chưa available | Auto-reconcile absent/fail-closed; không auto-match từ feed không đủ bằng chứng; mark-paid thủ công vẫn dùng được |
| 21 | Person-self ledger/authz/dependency không chứng minh được | `unknown` + generic retry; không biến null/error thành 0 hoặc “đã trả” |
| 22 | Human-DM `/pay` không có tenant context | Không suy tenant từ peer; 0 club generic, 1 auto-select, nhiều club dùng opaque requester-bound picker; peer/shared history nhận zero artifact |
| 23 | Booking pay-now trả thiếu | Không tạo player/charge/allocation; hold giữ tới TTL rồi manual review, v1 không tự cộng nhiều lần top-up |
| 24 | Booking pay-now trả dư | Tạo player + charge + allocation đúng amount due; phần dư của bank transaction vẫn unmatched |
| 25 | Payment ingest sau hold expiry/booking đã đóng | Không revive booking; giữ evidence và đưa manual review/refund-or-credit flow |
| 26 | Screenshot hoặc host manual mark-paid cho intent chưa link | Không được coi là proof để instant-confirm; yêu cầu exact provider evidence hoặc link Account |
| 27 | Buddy: Player trả hộ chính mình | ❌ Reject `BUDDY_SELF_PAY` — payer ≠ recipient; UI ẩn nút "Trả hộ" cho chính mình |
| 28 | Buddy: Player trả hộ cho người đã `paid` | ❌ Reject `BUDDY_CHARGE_ALREADY_PAID` — charge status phải `open` hoặc `partial` |
| 29 | Buddy: Duplicate pending request cùng payer→charge | ❌ Reject `BUDDY_REQUEST_DUPLICATE` — UNIQUE constraint `(charge_id, payer_person_id) WHERE status='pending'` |
| 30 | Buddy: Concurrent confirm + cancel request | Lock request row; first writer wins. Loser nhận 409 Conflict |
| 31 | Buddy: Charge status thay đổi giữa request và confirm | Host confirm re-validate charge status. Nếu charge đã `paid` (host mark-paid song song) → reject confirm, request auto-cancel |
| 32 | Buddy: Payer/recipient rời session giữa chừng | Request vẫn valid nếu charge tồn tại. Player `left` vẫn có charge (theo refund policy CLB). Không auto-cancel request |
| 33 | Buddy: Host confirm nhưng over-allocate | Lock charge; `amount` = `min(request.amount, charge.remaining)`. Nếu remaining = 0 → reject |
| 34 | Buddy: Reversal sau buddy payment | Host tạo reversal như mọi allocation. Reversal ảnh hưởng charge recipient, không ảnh hưởng payer ngoài audit trail |

---

## 5. Domain Model

| Entity | Vai trò | Key constraints |
|---|---|---|
| `charges` | Khoản phải thu của một player-session | UNIQUE `(tenant_id, session_id, player_id)`; status open/partial/paid/void |
| `bank_transactions` | Giao dịch CK gốc, immutable | UNIQUE `(tenant_id, provider, external_id)` |
| `payment_allocations` | Ledger phân bổ/reversal | Signed amount; optional bank transaction cho cash/waiver; immutable |
| `bank_accounts` | Tài khoản nhận + webhook credentials per tenant | UNIQUE webhook token; secret encrypted |
| `outbox_events` | Phát thay đổi ledger | Cùng transaction với allocation/status change |
| `buddy_payment_requests` 🟡 | Yêu cầu trả hộ player→player cùng session | UNIQUE `(charge_id, payer_person_id) WHERE status='pending'`; status pending/confirmed/rejected/cancelled |

> ⬜ **Pay-for-Buddy HOÃN, và giá trị enum `'buddy'` đã bị BÁC — `DD-106 Q1` (owner-delegated 2026-08-14).**
> **Không implement từ mục này.**
>
> Lý do bác vế enum: `payment_allocations` **đã có** `created_by uuid` (`0003_payments_ledger.sql:87` —
> *"actor for cash/waiver/manual"*) và CHECK **đã cho phép** `source IN ('cash','waiver') AND created_by
> IS NOT NULL` (`:92`). Nên *"A trả hộ charge của B"* **biểu diễn được ngay hôm nay** bằng
> `source='cash'` + `created_by = A`. Muốn mở lại phải trả lời được: `'buddy'` mang thông tin gì mà
> `('cash'|'manual', created_by)` không mang? Mỗi giá trị enum trên đường tiền là một nhánh **vĩnh viễn**
> trong mọi truy vấn đối soát, report và reversal về sau.
>
> Phần **workflow** (player request → host confirm, bảng `buddy_payment_requests`) là chuyện khác loại và
> chỉ **hoãn**, không bác — nhưng xếp sau DD-40 mark-paid thủ công, vì đó mới là thứ chặn doanh thu.
> Xem `../../standards/decisions.md` → DD-106 Q1.

### Ledger rules

- Bank allocation (auto-reconcile, `host_pro`): `bank_transaction_id` bắt buộc; source `auto|manual`.
- Mark-paid thủ công (mọi tier): tiền mặt → `cash`; CK đã ingest → `manual` + real `bank_transactions`. CK chưa ingest chỉ được ghi sau B1 dedicated source migration (`bank_transaction_id=NULL`, actor + opaque evidence bắt buộc); trước đó reject. **Không synthetic bank transaction** và không map sai `cash|manual`.
- Waiver: không có bank transaction; source `waiver`, actor admin bắt buộc.
- **Buddy:** player A trả hộ player B cùng session — `source='buddy'`, `bank_transaction_id=NULL`, `created_by=payer.person_id`. Amount = full remaining charge recipient (phase-1, không partial). Chỉ tạo khi host confirm `buddy_payment_request`.
- Reversal: amount âm, `reverses_allocation_id` bắt buộc; không reversal quá phần còn hiệu lực.
- DD-49 correction: price/obligation delta là append-only signed obligation entry trong canonical charge aggregate; allocation reversal chỉ đảo tiền đã nhận. Một helper tính effective due/balance cho mọi consumer. Tên bảng/API chờ design-probe live UNIQUE charge/player/session; không giả định row charge thứ hai.
- DD-91 read boundary: canonical helper/service nói trên là owner của person-self projection; Chat/Home/Notification không thêm snapshot/formula money riêng.
- Charge paid khi effective allocations = `amount_due`; partial khi nằm giữa 0 và amount due.
- `unallocated_amount` chỉ áp dụng bank transaction và được cập nhật dưới lock hoặc tính từ ledger.

### State machines

```mermaid
stateDiagram-v2
    [*] --> pending: durable ingest
    pending --> matched: allocated hết
    pending --> partial: allocated một phần
    pending --> unmatched: chưa có safe plan
    unmatched --> partial: host/retry allocate một phần
    unmatched --> matched: host/retry allocate hết
    partial --> matched: allocate phần còn lại
    matched --> partial: reversal
```

Charge: `open → partial → paid`; reversal có thể đưa `paid → partial/open`; cancellation có thể đưa sang `void` theo policy.

---

## 6. Screens và states

> Coverage matrix `state × surface`: Bot screens text-based (Zalo/Messenger); Web P4 visual.

### Mark-paid thủ công — Bot (Zalo/Messenger, mọi tier)

**Purpose:** Host đánh dấu player đã trả (tiền mặt/CK) — multi-select + preview + confirm.

**Flow tree:**

```
Host mở roster (session detail / danh sách nợ)
  │
  ├→ Tap chọn 1 hoặc NHIỀU player (multi-select checkbox)
  │     └→ Player đã paid → skip (dimmed, không chọn được)
  │
  ├→ Chọn nguồn thanh toán:
  │     ├→ 💵 Tiền mặt (cash) — không cần bank txn
  │     └→ 🏦 Chuyển khoản (CK) — khớp một bank_transaction đã ingest
  │           └→ Hiện dropdown: CK chưa gán (unmatched) → chọn 1
  │
  ├→ PREVIEW (DD-25 — human-initiated money mutation):
  │     ┌────────────────────────────────────────┐
  │     │ ⚡ Xác nhận đánh dấu đã trả            │
  │     │                                        │
  │     │ 2 player · Tiền mặt · 150,000₫        │
  │     │                                        │
  │     │  ✅ Nguyễn Văn A     75,000₫           │
  │     │  ✅ Trần Thị B       75,000₫           │
  │     │                                        │
  │     │ ⚠️ Lê Văn C — đã thanh toán (bỏ qua)  │
  │     │                                        │
  │     │ [Xác nhận]        [Huỷ]                │
  │     └────────────────────────────────────────┘
  │
  └→ CONFIRM → INSERT payment_allocations
        ├→ Success → "✅ Đã ghi nhận thanh toán cho 2 player"
        ├→ Conflict → Reload latest ledger + retry
        └→ Error → Toast + retry
```

**Bot states:**

| State | Nội dung |
|-------|----------|
| Loading | "Đang kiểm tra..." |
| Ready | Roster multi-select + nguồn chọn + preview |
| Error | Conflict → "Đã có thay đổi, vui lòng thử lại"; player đã paid → skip |
| Empty | "Không có khoản phải thu cho kèo này" |

### Mark-paid thủ công — Web P4

**Layout (desktop ≥1024px):**

```
┌──────────────────────────────────────────────────────────┐
│ Thanh toán — 🏸 Cầu lông chiều T5              [draft]  │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  ─── Tổng quan ───                                       │
│  ▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░  50% (3/6 đã trả)                │
│  Đã thu: 225,000₫ / 450,000₫                            │
│                                                          │
│  ─── Danh sách (☑️ chọn để đánh dấu) ───                │
│  ┌────────────────────────────────────────────────────┐  │
│  │ ☐ [AV] Nguyễn Văn A     75,000₫     ⏳ Chưa TT   │  │
│  │ ☐ [AV] Trần Thị B       75,000₫     ⏳ Chưa TT   │  │
│  │ ── [AV] Lê Văn C        75,000₫     ✅ Đã TT     │  │
│  │ ☐ [AV] Phạm D           75,000₫     ⏳ Chưa TT   │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  Đã chọn: 2 player · 150,000₫                           │
│  Nguồn: (●) Tiền mặt  (○) CK [▼ Chọn giao dịch]       │
│                                                          │
│  [═══ Xem trước & Xác nhận ═══]                         │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

**Component: Player row:**

| Player status | Icon | Selectable? | Ghi chú |
|--------------|------|-------------|---------|
| `open` (chưa trả) | ⏳ | ✅ Checkbox | Multi-select enabled |
| `partial` | ⚠️ | ✅ | Hiện remaining amount |
| `paid` | ✅ | ❌ Dimmed | Đã paid, không chọn được |
| `void` | — | ❌ | Hidden hoặc strikethrough |

### `/unmatched` — Giao dịch CK chưa khớp (Bot + Web, `host_pro`)

**Purpose:** Host xem CK đã nhận nhưng chưa gán được cho player, manual assign.

**Layout (Web):**

```
┌──────────────────────────────────────────────────────────┐
│ Giao dịch chưa khớp (3)                                 │
├──────────────────────────────────────────────────────────┤
│ ┌─ Transaction #1 ────────────────────────────────────┐ │
│ │ 🏦 VCB · 09/08 14:23 · 75,000₫                    │ │
│ │ Nội dung: "NGUYEN VAN A S2503"                      │ │
│ │ Chưa gán: 75,000₫                                  │ │
│ │ Lý do: Nhiều candidate trùng tên                    │ │
│ │ [Gán cho...▼]  [Bỏ qua]                            │ │
│ ├─────────────────────────────────────────────────────┤ │
│ │ 🏦 MB · 09/08 15:01 · 150,000₫                    │ │
│ │ Nội dung: ""  (rỗng)                               │ │
│ │ Chưa gán: 150,000₫                                 │ │
│ │ Lý do: Nội dung CK rỗng                            │ │
│ │ [Gán cho...▼]  [Bỏ qua]                            │ │
│ └─────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

**Bot layout:**

```
🏦 Giao dịch chưa khớp (3 CK)

1️⃣ VCB · 09/08 · 75,000₫
   "NGUYEN VAN A S2503"
   Lý do: Nhiều candidate trùng tên
   [Gán] [Bỏ qua]

2️⃣ MB · 09/08 · 150,000₫
   Nội dung rỗng
   [Gán] [Bỏ qua]
```

**4 States:**

| State | Nội dung |
|-------|----------|
| Loading | Skeleton list (3 transaction blocks) |
| Ready | Transaction list + candidate + assign CTA |
| Error | Retry banner; không mất selection state |
| Empty | Icon 🎉 + "Không có giao dịch CK chưa khớp" |

### Web P4 — Ledger view

**Purpose:** Host xem full ledger: transactions, allocations, charge status, audit trail.

**Layout (desktop):**

```
┌──────────────────────────────────────────────────────────┐
│ Sổ thanh toán                      [Xuất CSV] (DD-97)    │
├──────────────────────────────────────────────────────────┤
│ Tabs: [Giao dịch] [Phân bổ] [Charges] [Audit]           │
│                                                          │
│ ─── Giao dịch CK (Tab 1) ───                            │
│ ┌────────────────────────────────────────────────────┐   │
│ │ Date       │ Bank │ Amount   │ Nội dung    │ Status│   │
│ ├────────────┼──────┼──────────┼─────────────┼───────┤   │
│ │ 09/08 14:23│ VCB  │ 75,000₫  │ NVA S2503   │ ✅    │   │
│ │ 09/08 15:01│ MB   │ 150,000₫ │ (rỗng)      │ ⚠️    │   │
│ │ 09/08 16:30│ TCB  │ 80,000₫  │ TTB S2503   │ ✅    │   │
│ └────────────────────────────────────────────────────┘   │
│                                                          │
│ ─── Charges (Tab 3) ───                                  │
│ ┌────────────────────────────────────────────────────┐   │
│ │ Player        │ Due      │ Allocated│ Status      │   │
│ ├───────────────┼──────────┼──────────┼─────────────┤   │
│ │ Nguyễn Văn A  │ 75,000₫  │ 75,000₫  │ ✅ paid     │   │
│ │ Trần Thị B    │ 75,000₫  │ 0₫       │ ⏳ open     │   │
│ │ Lê Văn C      │ 75,000₫  │ 50,000₫  │ ⚠️ partial  │   │
│ └────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────┘
```

**4 States:**

| State | Nội dung |
|-------|----------|
| Loading | Skeleton table (header + 3 rows shimmer) |
| Ready | Full tabbed ledger view |
| Error | Error banner + retry |
| Empty | Icon 📊 + "Chưa có giao dịch nào" + subtitle "Giao dịch sẽ xuất hiện khi player thanh toán" |

### Buddy Payment — Player picker (Web P4 + Bot)

**Purpose:** Player chọn player cùng session còn nợ để trả hộ (toàn bộ charge).

**Flow tree:**

```
Player mở session detail → roster
  │
  ├→ Nhấn "Trả hộ bạn" (CTA chỉ hiện khi có ≥1 player khác còn nợ)
  │
  ├→ Hiện danh sách player còn nợ (open/partial):
  │     ┌────────────────────────────────────────┐
  │     │ 🤝 Trả hộ bạn — Kèo Cầu lông T5       │
  │     │                                        │
  │     │  (●) Nguyễn Văn B     75,000₫ còn nợ  │
  │     │  (○) Trần Thị C       50,000₫ còn nợ  │
  │     │                                        │
  │     │  ⚠️ Bạn sẽ thanh toán thay. Host sẽ    │
  │     │  xác nhận để hoàn tất.                  │
  │     │                                        │
  │     │  [Gửi yêu cầu trả hộ]    [Huỷ]        │
  │     └────────────────────────────────────────┘
  │
  ├→ Chọn 1 player → CONFIRM
  │     ├→ Success → "✅ Đã gửi yêu cầu. Chờ host xác nhận"
  │     ├→ BUDDY_CHARGE_ALREADY_PAID → "Player này đã thanh toán rồi"
  │     ├→ BUDDY_REQUEST_DUPLICATE → "Bạn đã gửi yêu cầu cho player này rồi"
  │     └→ Error → Toast + retry
  │
  └→ Pending state hiện trên roster:
        "[B] — Chờ xác nhận trả hộ bởi [A]"
```

**Bot layout:**

```
🤝 Trả hộ bạn — Kèo Cầu lông T5

Chọn player bạn muốn trả hộ:

1️⃣ Nguyễn Văn B · 75,000₫
2️⃣ Trần Thị C · 50,000₫

⚠️ Host sẽ xác nhận để hoàn tất.
[1] [2] [Huỷ]
```

**4 States:**

| State | Nội dung |
|-------|----------|
| Loading | "Đang kiểm tra..." |
| Ready | Player list + amount + confirm |
| Error | Toast: SELF_PAY / ALREADY_PAID / DUPLICATE / generic |
| Empty | "Không có player nào còn nợ trong kèo này" |

### Buddy Payment — Host confirm/reject (Web P4)

**Purpose:** Host xem danh sách buddy payment requests pending và confirm/reject.

**Layout (desktop):**

```
┌──────────────────────────────────────────────────────────┐
│ Yêu cầu trả hộ (2 pending)                              │
├──────────────────────────────────────────────────────────┤
│ ┌─ Request #1 ──────────────────────────────────────┐   │
│ │ 🤝 Nguyễn Văn A muốn trả hộ Trần Thị B           │   │
│ │ Kèo: 🏸 Cầu lông chiều T5 · 09/08                │   │
│ │ Số tiền: 75,000₫                                  │   │
│ │ Gửi lúc: 09/08 14:30                              │   │
│ │                                                    │   │
│ │ [✅ Xác nhận]  [❌ Từ chối]                        │   │
│ ├────────────────────────────────────────────────────┤   │
│ │ 🤝 Lê Văn D muốn trả hộ Phạm E                   │   │
│ │ Kèo: 🏸 Cầu lông chiều T5 · 09/08                │   │
│ │ Số tiền: 75,000₫                                  │   │
│ │ Gửi lúc: 09/08 15:00                              │   │
│ │                                                    │   │
│ │ [✅ Xác nhận]  [❌ Từ chối]                        │   │
│ └────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────┘
```

**Reject flow:** Host nhấn "Từ chối" → modal nhập lý do (optional) → CONFIRM → request → `rejected`.

**4 States:**

| State | Nội dung |
|-------|----------|
| Loading | Skeleton list (2 request blocks) |
| Ready | Request list + Confirm/Reject CTA |
| Error | Conflict → reload; network → retry banner |
| Empty | Icon 🎉 + "Không có yêu cầu trả hộ nào" |

### In-app Chat `/pay` — Person-self (DD-91 target)

**Purpose:** Player xem trạng thái thanh toán cá nhân từ canonical `getSelfPaymentStatus`.

**Layout (Bot message):**

```
💰 Thanh toán của bạn

Kèo: 🏸 Cầu lông chiều T5 · 09/08

Phí:       75,000₫
Đã trả:    0₫
Còn lại:   75,000₫

📎 Chuyển khoản tới:
  🏦 Vietcombank · 0123456789
  Chủ TK: NGUYEN HOST

[Đã thanh toán? Host sẽ xác nhận cho bạn]
```

**3 Outputs:**

| Result | Hiển thị |
|--------|----------|
| `known_amount` | Fee + đã trả + còn lại + bank info |
| `known_zero` | "✅ Bạn không còn khoản phải trả nào" |
| `unknown` | "⏳ Không thể kiểm tra lúc này. Vui lòng thử lại sau" |

### Data source mapping

| Component | Data source | Ghi chú |
|-----------|-------------|---------|
| Roster multi-select | `charges` table (per session) | Tenant-scoped via RLS |
| Payment summary bar | `charges` aggregate (amount_due vs amount_allocated) | Canonical helper |
| Unmatched list | `bank_transactions` WHERE `unallocated_amount > 0` | `host_pro` only |
| Ledger table | `bank_transactions` + `payment_allocations` + `charges` | Join view |
| Person-self `/pay` | `getSelfPaymentStatus` service | One canonical owner |
| Bank info for QR | `bank_accounts` table | Encrypted secret |

### State coverage matrix

| Surface | Screen | Loading | Ready | Error | Empty |
|---------|--------|---------|-------|-------|-------|
| Bot | Mark-paid multi-select | ✅ "Đang kiểm tra..." | ✅ Roster+preview+confirm | ✅ Conflict reload | ✅ "Không có khoản phải thu" |
| Bot | `/unmatched` (`host_pro`) | ✅ "Đang tải..." | ✅ CK list+assign CTA | ✅ Retry | ✅ "Không có CK chưa khớp" |
| Bot | `/pay` person-self | ✅ "Đang kiểm tra..." | ✅ known_amount/known_zero | ✅ unknown+retry | ⚪ N/A |
| Web P4 | Mark-paid (mọi tier) | ✅ Skeleton form | ✅ Multi-select+preview | ✅ Conflict reload | ✅ "Không có charge" |
| Web P4 | Unmatched view (`host_pro`) | ✅ Skeleton list | ✅ Transaction+assign | ✅ Retry banner | ✅ "Không có CK chưa khớp" |
| Web P4 | Ledger view | ✅ Skeleton table | ✅ Tabbed ledger | ✅ Retry banner | ✅ "Chưa có giao dịch" |
| Web P4 | Cash confirmation | ✅ Validating | ✅ Amount+confirm | ✅ Duplicate notice | ⚪ N/A |
| Web P4 | Buddy pay — Player picker | ✅ Loading roster | ✅ Roster + "Trả hộ" CTA | ✅ Toast: SELF_PAY / ALREADY_PAID / DUPLICATE | ✅ "Không có player còn nợ" |
| Web P4 | Buddy pay — Host confirm | ✅ Loading requests | ✅ Request list + Confirm/Reject | ✅ Conflict reload | ✅ "Không có yêu cầu trả hộ" |
| Bot | Buddy pay — Player request | ✅ "Đang kiểm tra..." | ✅ Player list + amount + confirm | ✅ SELF_PAY / ALREADY_PAID | ✅ "Không có player còn nợ" |

P2/P3 bắt buộc host flow qua **bot Zalo + web** (mark-paid thủ công mọi tier). Auto-reconcile webhook (`host_pro`) ở P3. Web ledger và realtime projection ở P4; notification đa kênh đầy đủ ở P4.5–P4.7 (Zalo/Messenger). *(Telegram đã loại — DD-37.)*

---

## 7. Analytics và audit

| Event | Khi nào | Payload tối thiểu |
|---|---|---|
| `payment_webhook_ingested` | Durable commit | tenant, provider, transaction_id, amount_bucket |
| `payment_reconcile_completed` | Worker terminal attempt | transaction_id, result, match_method, duration_ms |
| `payment_allocation_created` | Auto/manual/cash allocation | allocation_id, source, actor_type, amount |
| `payment_allocation_reversed` | Reversal | allocation_id, reversal_id, actor_id, reason_code |
| `payment_charge_settled` | Charge paid | charge_id, settlement_sources |
| `buddy_payment_requested` | Player tạo request trả hộ | request_id, session_id, payer_person_id (hashed), amount |
| `buddy_payment_confirmed` | Host confirm buddy payment | request_id, allocation_id, confirmed_by (hashed) |
| `buddy_payment_rejected` | Host reject buddy payment | request_id, reason_code |

Không log raw bank content, account number, display name, secret hoặc provider payload vào analytics.

---

## 8. Acceptance Criteria

- [ ] Mark-paid thủ công (mọi tier): multi-select player → preview + confirm (DD-25) → INSERT `payment_allocations` (tiền mặt `source='cash'`; CK khớp `bank_transactions` `source='manual'`) + cập nhật `charges` + audit; idempotent; không tạo bank transaction giả; enum `source` không có `bank_transfer`.
- [ ] Auto-reconcile CK (webhook match) gated `host_pro` (`payment_reconcile_auto`); free chỉ có `payment_mark_manual`.
- [ ] `payment_reconcile_auto` entitlement và availability được kiểm riêng; current `sepay|apipay` path chỉ phục vụ rail Việt Nam, thiếu provider/bank/market/currency/consent thì auto absent nhưng manual vẫn hoạt động.
- [ ] Verify webhook timing-safe và route bằng trusted token + account.
- [ ] Raw `bank_transaction` + durable job commit trước ACK.
- [ ] Duplicate/retry/crash không tạo giao dịch hoặc allocation trùng.
- [ ] Name/date/amount match chỉ auto khi có một safe plan.
- [ ] P3 hoạt động với memo name-based; pay code được phase-gate tới P4 rollout.
- [ ] FIFO đúng khi cùng player có nhiều charge đồng giá.
- [ ] Partial/overpay cập nhật đúng charge và unallocated remainder.
- [ ] Một CK có thể manual-allocate cho nhiều người mà không vượt funds.
- [ ] `/cash` tạo settlement source cash có actor/audit, không tạo bank transaction giả.
- [ ] Reversal immutable và khôi phục đúng effective balances.
- [ ] Concurrent webhook/cash/manual assignment không over-allocate.
- [ ] Suspended tenant vẫn durable-ingest CK.
- [ ] `/unmatched` hiển thị mọi transaction còn dư + reason.
- [ ] `payment.settled` chỉ phát khi charge được phủ đủ.
- [ ] Tenant A/B ledger isolation tests xanh.
- [ ] Đổi STK primary → pending 24h; QR vẫn dùng STK cũ; notify tất cả kênh.
- [ ] Rate-limit đổi STK: max 2 lần/30 ngày.
- [ ] `/api/me/charges`, Home, exact requester-only `/pay` và authenticated notification detail dùng cùng `getSelfPaymentStatus`; không consumer re-derive balance, không null/error→0.
- [ ] Human-DM `/pay` không suy tenant từ peer, peer/shared history nhận zero artifact; command result không tạo ledger/chat mutation.
- [ ] Booking pay-now chỉ xuất hiện khi entitlement + provider/bank/market/currency/consent availability đều proven; unknown/false offer link/web, không nhận screenshot/manual attest làm proof.
- [ ] Exact/overpayment trước expiry gọi một atomic funnel finalizer; exact tạo một booking/charge/allocation, overpay giữ remainder unmatched, underpay/late/wrong-reference không active.
- [ ] Giao dịch mang exact channel-booking reference không được generic matcher claim; duplicate/retry chỉ có một terminal booking và allocation.
- [ ] **Buddy payment:** Player chỉ trả hộ player khác **cùng session** có charge `open|partial`; không self-pay.
- [ ] Buddy request tạo `buddy_payment_requests` (status=`pending`); notify recipient.
- [ ] Host confirm → INSERT `payment_allocations` (`source='buddy'`, `created_by=payer.person_id`, amount = charge remaining) → cập nhật charge status → notify cả payer + recipient.
- [ ] Host reject → request `rejected` + notify payer; charge không thay đổi.
- [ ] Duplicate pending request cùng (charge, payer) bị reject `BUDDY_REQUEST_DUPLICATE`.
- [ ] Concurrent confirm: lock request + charge; no over-allocate.
- [ ] Charge đã paid khi host confirm → reject confirm, auto-cancel request.
- [ ] Buddy allocation reversible giống mọi allocation khác.
- [ ] Notification payer: "Thanh toán thành công session [X]"; notification recipient: "Thanh toán thành công session [X], [payer_name] đã thanh toán cho bạn".
- [ ] `getSelfPaymentStatus` phản ánh đúng buddy allocation (cùng truth, không formula riêng).

---

## 9. Open Decisions và changelog

| ID | Quyết định | Trạng thái |
|---|---|---|
| BRD OD-2 / DD-02 | Pay-code prefix/format + resolver/allocation invariant | ✅ Chốt 13/07/2026; P3 name-based vẫn không phụ thuộc rollout pay_code P4 |
| PAY-OQ-1 | Retry cadence/backoff unmatched | Chốt trong backend spec |
| PAY-OQ-2 | Suspended tenant pause reconcile hay vẫn reconcile | ✅ **Chốt DD-51/B10:** ingest ON; auto-settle/auto-notify OFF fail-closed. Enable lại cần decision + telemetry/evidence mới |
| PAY-OQ-3 | Refund/void policy khi hủy session | ✅ **Chốt DD-49/v1.37:** host cancel đã thu → hoàn toàn bộ; player leave paid → policy CLB + refund request; refund ngoài + opaque reference. Obligation adjustment và allocation reversal là hai ledger entry khác nghĩa; storage chờ design-probe, không duplicate/mutate charge |

## Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-08-12 | v1.13 | **Pay-for-Buddy:** Thêm player-to-player buddy payment (Player request → Host confirm → Allocation `source='buddy'`). 3 use cases (PAY-UC-19/20/21), 8 edge cases (#27–34), entity `buddy_payment_requests`, ledger rule `source='buddy'`, 4 screen rows (player picker, host confirm, bot request), 3 analytics events, 11 acceptance criteria. Phase-1: full charge only (không partial), cùng session only. Notification: payer + recipient + host. |
| 2026-08-10 | v1.12 | **A-grade upgrade:** thêm Entry points table (8 entries); bump version. Không đổi contract/ledger model. |
| 2026-07-28 | v1.10 | Reconcile immutable authority `90d292d` and primary plan v1.8 `PLAN_READY`; retain B1/per-slice `CODE_READY`, regional availability and no-runtime boundaries. |
| 2026-07-28 | v1.9 | Mirror DD-32 Option D: unlinked paid-session booking có 15-minute pay-now hold khi capability proven; only durable exact full settlement gọi shared finalizer. Pin exact/over/under/late behavior, reserve booking references khỏi generic matcher và cấm screenshot/manual attest bypass Account link. No runtime claim. |
| 2026-07-27 | v1.8 | Sync local DD-91 `DECISION_FINAL` nhưng primary-surface plan vẫn `NOT_PLAN_READY`: pin one-payment-truth, fail-closed `known_zero|known_amount|unknown` và exact requester-only `/pay` target/no-LLM/no-persistence. Tách commercial entitlement `payment_reconcile_auto` khỏi provider/bank/market/currency/consent availability; current authority chỉ `sepay|apipay` cho rail Việt Nam, auto runtime chưa build, manual mark-paid vẫn global. Ghi live ledger-integrity migrations `0019`/`0020`; không claim webhook/service/chat implementation. |
| 2026-07-19 | v1.7a | Metadata sweep (index v2.35): thêm trường **Implementation** đồng bộ BUILD-STATUS (In progress). Không đổi contract. |
| 2026-07-17 | v1.7 | **Durable-ingest auth closure:** pin exact SePay timestamp/raw-body HMAC format, freshness and no-downgrade plus exact API-key fallback; keep ApiPay raw-body verifier as a separate provider contract. |
| 2026-07-16 | v1.6 | **Full money propagation:** DD-49 append-only obligation-vs-allocation semantics + refund request contract; PAY-OQ-2 closed ingest-ON/automation-OFF for suspended. B1 chooses dedicated source migration and explicitly forbids synthetic bank transactions. Authority: decisions v1.37. |
| 2026-07-10 | v1.4 | **Review fixes: money vocab → canonical ledger.** Mark-paid = INSERT `payment_allocations` + cập nhật `charges` (KHÔNG có bảng `payment`): tiền mặt → `source='cash'`; CK khớp một `bank_transactions` → `source='manual'`. Bỏ `source='bank_transfer'` (không có trong enum canonical `auto/manual/cash/waiver/reversal`). Host tự xác nhận "đã CK" nhưng chưa có `bank_transaction` = impl còn mở (synthetic manual bank_txn / enum migration). Cập nhật UC-15, §3.1, ledger rules, screens, acceptance. |
| 2026-07-10 | v1.3 | **DD-40:** thêm **mark-paid thủ công mọi tier** (tap/multi-select, preview+confirm DD-25) — §1, §3.1, UC-15/16, edge #18/19, ledger rules, screens, acceptance. Auto-reconcile CK = `host_pro`. Kênh host flow: Zalo+web (bỏ Telegram, DD-37). One-line pointer giá theo giới tính → DD-39. |
| 2026-06-19 | v1.2 | Thêm Changelog heading, verified format compliance |
| 2026-06-19 | v1.2 | Fold AUDIT G1: STK change 24h confirmation delay (UC-13/14, edge case #17, acceptance criteria) |
| 2026-06-18 | v1.1 | Durable ingest; charge/transaction/allocation ledger; partial/overpay/multi-person/cash/reversal; canonical phase |
| 2026-06-18 | v1.0 | Initial legacy payment spec |
| 2026-07-16 | v1.5 | **Propagation (light) DD-49:** PAY-OQ-3 ✅; body/schema được full-propagate ở v1.6. |
