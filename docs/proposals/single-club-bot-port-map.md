# Đối chiếu: Bot single-club hiện tại ↔ Spec Plexco (port-map)

> **Trạng thái:** Draft để review · 2026-06-24
> **Mục tiêu:** Chỉ ra phần logic bot single-club **lift nguyên** sang `packages/core`, phần **phải viết lại** trên tầng data multi-tenant, và các **gap** phát sinh do lên đa-tenant.
> **Nguồn spec:** TDD §3.2/§3.6–3.8 · `feature_payment_reconcile_tech.md` · `player-side-saas-reconciliation.md` · `business-rules.md` · AUDIT.
> **Authority note (17/07/2026):** đây là proposal/reference. Khi conflict, theo `standards/decisions.md` v1.40; đặc biệt DD-50 thay phone/OTP bằng verified account email hoặc transactional one-time `link_code`, và DD-40 cấm synthetic bank transaction cho host-attested CK chưa ingest.
>
> ⚠️ **Phạm vi & giả định:** Bot single-club là **repo riêng** (không nằm trong repo Plexco này), và repo Plexco **hiện chỉ có docs, chưa có code TS**. Bản đối chiếu dưới đây dựng từ **mô tả của spec** về bot cũ ("lift logic thuần: matching, payments-logic, dates, format, i18n, sports" — TDD §dẫn nhập). Để có **port-map cấp file/hàm chính xác**, cần trỏ tôi tới repo bot cũ; chỗ nào suy từ spec tôi đánh dấu *(giả định)*.

---

## 1. Nguyên tắc lift (theo TDD)

> "Plexco là **repo riêng**, lift **logic thuần** (matching, payments-logic, dates, format) sang `packages/core`; **viết lại tầng data** trên Postgres + RLS."

Ranh giới rõ ràng:

- **Logic thuần (pure, không I/O)** → lift được, gói vào `packages/core`.
- **Tầng data + I/O + identity + kênh** → **viết lại**, vì bot cũ giả định 1 CLB / 1 store phẳng, Plexco là multi-tenant + RLS + global Person.

---

## 2. Bảng đối chiếu theo module

| Module bot cũ *(giả định)* | Plexco | Hành động | Vì sao |
|---|---|---|---|
| **Matching** (khớp CK ↔ người: tên/amount/ngày, FIFO 2-buổi) | `matching(core)` — pure proposal | ♻️ **Lift gần nguyên** | Là hàm thuần; chỉ đổi input/output thành kiểu core, **bỏ ghi DB trực tiếp** (giờ chỉ *đề xuất*, không allocate) |
| **Payments-logic** (tính nợ, partial/overpay, FIFO) | `payments-logic(core)` + ledger service | ⚠️ **Lift phần tính + tách phần ghi** | Tính toán lift được; nhưng "ghi đã trả" giờ **chỉ** qua `applyAllocations` (writer duy nhất, có lock + invariant) |
| **Dates / format / i18n / sports** | `packages/core` cùng tên | ♻️ **Lift nguyên** | Thuần, không phụ thuộc tenant |
| **Parse callback** (`pjoin:<id>`, lệnh bot) | core parser + adapter kênh | ♻️ **Lift parser**, viết lại transport | Cú pháp lệnh tái dùng; lớp gửi/nhận đổi theo grammY + Zalo HTTP |
| **Lưu members (`tg_user_id`, `zalo_user_id`, `tg_username`, `tg_can_dm`)** phẳng theo CLB | `Person`/`ChannelIdentity` (global) + `Membership` (tenant) + `ChannelReachability` (per tenant) | 🔁 **Viết lại hoàn toàn** | Tách "ai" khỏi "club nào"; `tg_can_dm` global → `ChannelReachability` per-tenant (AUDIT C1) |
| **Ghi nhận CK / payments** | `bank_transactions` + `payment_allocations` + `charges` (RLS) | 🔁 **Viết lại** | Thêm idempotency `UNIQUE(tenant,provider,external_id)`, ledger invariant, reversal |
| **Webhook SePay** (xác thực + nhận) | durable ingest (`/webhook/sepay/:token`) | 🔁 **Viết lại** | Per-bank token, timing-safe verify, raw **trước** ack, enqueue trong cùng DB txn |
| **Gửi nhắc / confirm "đã trả"** | outbox → projector + reminder cron (pg-boss) | 🔁 **Viết lại** | Adapter không mark-paid trực tiếp; gửi đi đọc `ChannelReachability` đúng tenant |
| **QR / pay_code** *(nếu bot cũ có)* | `membership.pay_code` + VietQR | ♻️/🆕 **Lift sinh-mã & render nếu có**, ráp vào matcher P4 | Xem `qr-paycode-early-rollout.md` |
| **Lưu token bot / secret** | KMS-encrypted, per-club | 🔁 **Viết lại** | Mã hoá at-rest, getWebhookInfo drift-detect (AUDIT 10.4 / §B2) |

♻️ lift · ⚠️ lift một phần (tách writer) · 🔁 viết lại · 🆕 mới

---

## 3. Khác biệt kiến trúc lõi cần nhớ khi port

### 3.1 Adapter KHÔNG còn mark-paid trực tiếp
Bot single-club thường: webhook về → tìm người theo tên → set "đã trả". Plexco **cấm** điều này:

```
provider adapter → normalize → ingest (raw, idempotent)
  → reconcile worker → matching(core) ĐỀ XUẤT plan
  → ledger service (writer DUY NHẤT) validate+lock+apply
  → outbox payment.allocated/settled → projector thông báo
```

→ Khi port code matching cũ, **cắt mọi câu lệnh ghi DB** khỏi nó; nó chỉ trả `candidates + evidence`.

### 3.2 Mọi truy vấn tiền đi qua `tenantRepo` (choke-point + RLS)
Bot cũ query store phẳng. Plexco: hàm global "không tồn tại" → quên scope = **không compile**; RLS ENABLE+FORCE fail-closed. Port = bọc mọi đọc/ghi tiền trong `withTenant(tenantId)`.

### 3.3 Identity: phẳng → 3 tầng
`members` phẳng tách thành **directory global (Person + ChannelIdentity)** + **Membership tenant-scoped** + **ChannelReachability**. Đây là phần **đập đi xây lại nhiều nhất**, vì nó mở thêm 2 thứ bot cũ không có: player-view cross-club và join cross-club từ marketplace.

### 3.4 Concurrency & idempotency thành bắt buộc
Bot cũ 1 CLB ít đụng race. Plexco cần: lock order (bank txn → charges theo UUID → reversed allocation), at-least-once worker idempotent, sweeper cho `pending`, `ON CONFLICT DO NOTHING` cho webhook trùng.

---

## 4. Gap mới hoàn toàn (bot cũ không có)

1. **Cô lập cross-tenant** (RLS + repo choke-point + test bất biến CI) — rủi ro #1 của hệ.
2. **Merge identity cross-platform** (`/link` OTP, SĐT verified) + **reconcile membership trùng** khi merge (AUDIT C4/C5).
3. **Routing tenant theo kênh** (TG group ghim chat_id; Zalo bot-per-club tự ghim; chỉ TG-DM cần picker/deep-link).
4. **Public discovery layer** (đọc kèo cross-tenant, field-whitelist, **không** chứa tiền/PII).
5. **Billing lifecycle** (trial→past_due→suspended) — SaaS, bot cũ không có.
6. **STK change G1** (pending 24h, max 2 lần/30 ngày, notify mọi kênh).
7. **Outbox/projector sync engine** (canonical store ⇄ surfaces) — P4.

---

## 5. Thứ tự port đề xuất

1. **`packages/core` thuần trước** (dates/format/i18n/sports/matching/payments-logic) — lift + viết test thuần, chưa đụng DB. Đây là phần "lift" thật, ít rủi ro.
2. **Tầng data + RLS + tenantRepo** (schema reconcile + ledger) — viết lại, test bất biến.
3. **Webhook ingest + reconcile worker** — ráp matching(core) vào ledger qua worker.
4. **Identity (Person/Membership/Reachability) + routing kênh**.
5. **Adapter kênh (grammY/Zalo) + projector + reminder**.
6. **QR/pay_code** (theo doc rollout) + discovery + billing.

---

## 6. Việc cần để chốt port-map chính xác

- **Trỏ repo bot single-club cũ** → tôi map cấp file/hàm: cái nào vào `packages/core` y nguyên, cái nào phải gọt bỏ I/O, cái nào bỏ hẳn.
- Xác nhận bot cũ **đã có** sinh pay_code/VietQR chưa → quyết định lift hay xây mới ở `qr-paycode-early-rollout.md` Bước 0–2.
- Xác nhận bot cũ dùng **SePay** payload schema nào → tái dùng normalize hay viết adapter mới.

> Mọi dòng *(giả định)* ở trên cần đối chiếu với code thật của bot cũ trước khi đưa vào kế hoạch thực thi.
