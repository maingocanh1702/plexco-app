# Feature: Notifications & Reminders — Product/UX Spec

> **Canonical phase:** P3 (manual/auto baseline) · P4.5–P4.7 (channel delivery)  
> **Track:** 🔔 Notifications  
> **Version:** 2.0 · 2026-06-19  
> **Status:** Reviewed  
> **Prerequisites:** P3 ledger stable · P3.5 identity/reachability · P4 sync/projectors  
> **Tài liệu liên quan:** `../product/BRD.md` FR-6 · `../product/PRD.md` FLOW 7/8 · `../standards/business-rules.md` BL-SEC-5 · `BE/feature_notifications_reminders_tech.md`

---

## 1. Mô tả

Nhắc nợ players chưa trả mà **không spam**, đồng thời confirm thanh toán/sửa lỗi qua kênh reachable của tenant. Ledger events là authoritative — delivery là best-effort, **KHÔNG BAO GIỜ rollback money state**.

### Bất biến

- Reminder chỉ gửi dựa trên **effective charge state** — không cache cũ.
- `ChannelReachability` scoped `(person, tenant, platform)` — KHÔNG global.
- Provider failure KHÔNG rollback ledger — delivery retry riêng.
- Quiet hours tính theo **tenant timezone**.
- Deduplicate bằng intent key + recipient + state version.

---

## 2. Use Cases + Edge Cases

### Use Cases

| ID | Actor | Hành động | Kết quả |
|---|---|---|---|
| NTF-UC-1 | Host | Manual reminder — preview trước khi gửi | Hiện danh sách eligible, excluded (kèm lý do), channel — gửi hoặc cancel |
| NTF-UC-2 | System | Scheduler auto-remind overdue charges | Select theo tenant policy, quiet hours, cooldown — gửi batch |
| NTF-UC-3 | System | `payment.settled` event | Gửi confirmation **1 lần** per charge/settlement version |
| NTF-UC-4 | System | Reversal sau confirmation | Gửi **correction**, KHÔNG gửi lại paid confirmation |
| NTF-UC-5 | System | Channel selection | Valid DM reachability cho tenant/platform → TG group mention fallback → owner digest |
| NTF-UC-6 | Host | Manual remind override cooldown | Require reason — vẫn rate-limited |
| NTF-UC-7 | Player | Nhận reminder qua Telegram DM | Hiện số tiền còn nợ + QR link |
| NTF-UC-8 | Player | Nhận paid confirmation | "✅ Đã nhận CK [amount]. Cảm ơn!" |
| NTF-UC-9 | Host | Xem delivery report | Sent/failed/skipped — KHÔNG expose provider secrets |
| NTF-UC-10 | System | P4.5 TG player delivery, P4.7 Zalo, P4.8 Messenger | Channel-specific delivery logic |

### Edge Cases

| # | Category | Case | Hành vi bắt buộc |
|---|----------|------|-------------------|
| 1 | Data Integrity | Remind charge đã paid/void | ❌ KHÔNG gửi — check effective state trước send |
| 2 | Data Integrity | Partial charge → gửi "đã trả đủ" | ❌ KHÔNG — message states remaining amount |
| 3 | Security | Expose debt amount/name trong public group | ❌ Chỉ approved template. Không tiết lộ số tiền/tên cụ thể ngoài group policy |
| 4 | Data Integrity | Player đã leave club nhưng còn nợ | Tuỳ policy: gửi final notice hoặc skip. KHÔNG gửi reminder nếu policy không cho phép |
| 5 | Concurrency | Duplicate send (intent + recipient + version) | Deduplicate bằng UNIQUE delivery key — idempotent |
| 6 | Resilience | Provider blocked/24h-window/rate-limit error | Update reachability/delivery state, classify retry vs permanent failure |
| 7 | Data Integrity | Quiet hours overlap với scheduled send | Defer to next valid window — dùng tenant timezone |
| 8 | Concurrency | Scheduler jitter — burst gửi 1000 tenants cùng lúc | Jitter prevents provider bursts — stagger sends |
| 9 | Security | Manual reminder bypass cooldown | Cooldown/rate-limit vẫn enforce — owner override cần reason |
| 10 | Cross-Feature | Reversal xảy ra sau confirmation đã gửi | Gửi **correction** message — preserve audit trail |
| 11 | Security | Reachability cross-tenant | ❌ NEVER — `(person, tenant, platform)` scoped |
| 12 | Resilience | Delivery fail — retry exhaust | Move to owner digest fallback — KHÔNG retry vô hạn |

---

## 3. Screens & States

| Surface | Screen | Loading | Ready | Error | Empty |
|---------|--------|---------|-------|-------|-------|
| TG Bot | Manual remind preview | "Đang tính..." | List: eligible players + excluded (lý do) + channel + Send/Cancel buttons | "Không có ai cần nhắc" | N/A (empty = no eligible = hiện message) |
| TG Bot | Reminder sent confirmation | — | "✅ Đã gửi nhắc nợ cho X người" | "⚠️ Gửi thất bại Y/X — xem report" | N/A |
| TG Bot | Payment confirmation (player) | — | "✅ Đã nhận CK [amount]. Cảm ơn!" | — | N/A |
| TG Bot | Payment correction (player) | — | "⚠️ Thanh toán [ref] đã được điều chỉnh" | — | N/A |
| Web P4 | Notification settings | Skeleton | Policy form: thresholds, quiet hours, cooldown, max count | Error banner | Default policy values |
| Web P4 | Delivery report | Skeleton table | Sent/failed/skipped per notification | Error banner | "Chưa có notification nào" |

---

## 4. Domain Model

| Entity | Vai trò | Key constraints |
|--------|---------|-----------------|
| `notification_policies` | Tenant-level thresholds, quiet hours, cooldown, max count | Per tenant; RLS |
| `notification_intents` | Semantic notification record (type + aggregate + state version) | `UNIQUE` intent key prevents duplicate; RLS |
| `notification_deliveries` | Per-platform delivery attempt tracking | `UNIQUE` delivery key prevents duplicate send; RLS |
| `charges` | Source of eligible reminder recipients | Effective state drives eligibility |
| `channel_reachability` | Tenant+platform DM availability | `UNIQUE(person_id, tenant_id, platform)` scoped |

Full schema: [BE/feature_notifications_reminders_tech.md](./BE/feature_notifications_reminders_tech.md).

---

## 5. Analytics Events

| Event | Khi nào | Payload tối thiểu |
|-------|---------|-------------------|
| `reminder_previewed` | Host xem preview | `tenant_id`, `eligible_count`, `excluded_count` |
| `reminder_sent` | Batch gửi thành công | `tenant_id`, `sent_count`, `channel`, `trigger` (manual/auto) |
| `reminder_skipped` | Bị cooldown/quiet-hours skip | `tenant_id`, `reason_code` |
| `payment_confirmation_sent` | Confirm CK gửi cho player | `tenant_id`, `charge_id` (opaque) |
| `payment_correction_sent` | Correction sau reversal | `tenant_id`, `charge_id` (opaque) |
| `delivery_failed` | Provider error | `tenant_id`, `platform`, `error_class` (blocked/rate-limited/unknown) |

> Chỉ dùng opaque IDs. Không log tên, số tiền, nội dung message trong analytics.

---

## 6. Acceptance Criteria

- [ ] Reminders derive từ effective charge state — không gửi cho paid/void
- [ ] Settled confirmation emit 1 lần; partial KHÔNG emit paid copy
- [ ] Reversal emit correction, preserve audit trail
- [ ] Quiet hours/cooldown/max-N pass tests với tenant timezone
- [ ] Reachability KHÔNG cross tenant — `(person, tenant, platform)` test
- [ ] Provider failure KHÔNG rollback ledger
- [ ] Manual preview/exclusions và owner digest fallback work
- [ ] Rate-limit burst test pass cho 1k tenants concurrent

---

## 7. Open Questions / Changelog

### Open Questions

| ID | Quyết định | Trạng thái |
|---|---|---|
| NTF-OQ-1 | Default reminder thresholds/max count/copy text | ⬜ Chưa chốt |
| NTF-OQ-2 | Group mention có bao gồm remaining amount hay chỉ generic reminder? | ⬜ Chưa chốt |

### Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-06-18 | v1.0 | Initial spec (English format) |
| 2026-06-19 | v2.0 | Chuẩn hoá Vietnamese numbered, thêm 10 use cases, 12 edge cases, screen states, analytics payload |
