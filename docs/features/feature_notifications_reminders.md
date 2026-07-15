# Feature: Notifications & Reminders — Product/UX Spec

> **Canonical phase:** P3 (manual/auto baseline) · P4.5–P4.7 (channel delivery)  
> **Track:** 🔔 Notifications  
> **Version:** 2.3 · 2026-07-15
> **Status:** Reviewed  
> **Prerequisites:** P3 ledger stable · P3.5 identity/reachability · P4 sync/projectors  
> **Tài liệu liên quan:** `../product/BRD.md` FR-6 · `../product/PRD.md` FLOW 7/8 · `../standards/decisions.md` DD-37/DD-40/DD-45 · `../standards/business-rules.md` BL-SEC-5 · `BE/feature_notifications_reminders_tech.md`

> **Cập nhật v3.4 (DD-40 + DD-37, 2026-07-10):** kênh nhắc chính = **web push + Zalo DM**; **Messenger best-effort trong cửa sổ standard 24h**, ngoài cửa sổ chỉ khi có cơ chế Meta đủ điều kiện/được phê duyệt. **Telegram loại khỏi phạm vi (DD-37).** Sau **mọi** markPaid (thủ công tiền mặt/CK & auto CK) → **xác nhận tự động tới player** (FR-6.2). **Nhắc tự động nâng cao = `host_pro`; free = nhắc thủ công** (DD-40).

---

## 1. Mô tả

Nhắc nợ players chưa trả mà **không spam**, đồng thời confirm thanh toán/sửa lỗi qua kênh reachable của tenant. Kênh chính = **web push + Zalo DM**; **Messenger chỉ best-effort trong cửa sổ 24h**. Ledger events là authoritative — delivery là best-effort, **KHÔNG BAO GIỜ rollback money state**.

> **Tier (DD-40):** **free** = nhắc **thủ công** (host bấm gửi) + xác nhận tự động sau markPaid. **`host_pro`** = **nhắc nợ tự động** nâng cao (cron theo ngưỡng, mặc định 2h → 24h → …).

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
| NTF-UC-1 | Host (mọi tier) | Manual reminder — preview trước khi gửi | Hiện danh sách eligible, excluded (kèm lý do), channel — gửi hoặc cancel |
| NTF-UC-2 | System (`host_pro`) | Scheduler auto-remind overdue charges (ngưỡng mặc định 2h → 24h → …) | Select theo tenant policy, quiet hours, cooldown — gửi batch |
| NTF-UC-3 | System | `payment.settled` event (sau markPaid thủ công tiền mặt/CK **hoặc** auto CK) | Gửi confirmation **1 lần** per charge/settlement version |
| NTF-UC-4 | System | Reversal sau confirmation | Gửi **correction**, KHÔNG gửi lại paid confirmation |
| NTF-UC-5 | System | Channel selection | **web push + Zalo DM** (chính) → **Messenger best-effort trong 24h** → owner digest fallback |
| NTF-UC-6 | Host | Manual remind override cooldown | Require reason — vẫn rate-limited |
| NTF-UC-7 | Player | Nhận reminder qua Zalo DM / web push | Hiện số tiền còn nợ + QR link |
| NTF-UC-8 | Player | Nhận paid confirmation | "✅ Đã nhận CK [amount]. Cảm ơn!" |
| NTF-UC-9 | Host | Xem delivery report | Sent/failed/skipped — KHÔNG expose provider secrets |
| NTF-UC-10 | System | P4.5 Zalo player delivery; Messenger best-effort trong 24h | Channel-specific delivery logic (Telegram đã loại — DD-37) |
| NTF-UC-11 | System | Waitlist promotion không derive được charge amount (DD-39/DD-45) | Domain retry do session service sở hữu; notification projector tạo tối đa một owner-alert/digest từ event, không gửi promotion/venue cho candidate; recipient unresolved thì durable event vào skipped/DLQ để ops thấy |

### Edge Cases

| # | Category | Case | Hành vi bắt buộc |
|---|----------|------|-------------------|
| 1 | Data Integrity | Remind charge đã paid/void | ❌ KHÔNG gửi — check effective state trước send |
| 2 | Data Integrity | Partial charge → gửi "đã trả đủ" | ❌ KHÔNG — message states remaining amount |
| 3 | Security | Expose debt amount/name ra kênh chung | ❌ Nhắc nợ đi **DM riêng** (Zalo DM / web push / Messenger 24h), không tiết lộ số tiền/tên ra kênh công khai |
| 4 | Data Integrity | Player đã leave club nhưng còn nợ | Tuỳ policy: gửi final notice hoặc skip. KHÔNG gửi reminder nếu policy không cho phép |
| 5 | Concurrency | Duplicate send (intent + recipient + version) | Deduplicate bằng UNIQUE delivery key — idempotent |
| 6 | Resilience | Provider blocked/24h-window/rate-limit error | Update reachability/delivery state, classify retry vs permanent failure |
| 7 | Data Integrity | Quiet hours overlap với scheduled send | Defer to next valid window — dùng tenant timezone |
| 8 | Concurrency | Scheduler jitter — burst gửi 1000 tenants cùng lúc | Jitter prevents provider bursts — stagger sends |
| 9 | Security | Manual reminder bypass cooldown | Cooldown/rate-limit vẫn enforce — owner override cần reason |
| 10 | Cross-Feature | Reversal xảy ra sau confirmation đã gửi | Gửi **correction** message — preserve audit trail |
| 11 | Security | Reachability cross-tenant | ❌ NEVER — `(person, tenant, platform)` scoped |
| 12 | Resilience | Delivery fail — retry exhaust | Move to owner digest fallback — KHÔNG retry vô hạn |
| 13 | Financial/Resilience | Duplicate `waitlist.charge_derivation_failed` event | Owner alert dedupe theo session+player+trigger+reason; không duplicate digest, không đổi player/charge và không gửi venue |

---

## 3. Screens & States

| Surface | Screen | Loading | Ready | Error | Empty |
|---------|--------|---------|-------|-------|-------|
| Bot (Zalo) / Web | Manual remind preview | "Đang tính..." | List: eligible players + excluded (lý do) + channel + Send/Cancel buttons | "Không có ai cần nhắc" | N/A (empty = no eligible = hiện message) |
| Bot (Zalo) / Web | Reminder sent confirmation | — | "✅ Đã gửi nhắc nợ cho X người" | "⚠️ Gửi thất bại Y/X — xem report" | N/A |
| Zalo DM / Messenger (24h) / Web push | Payment confirmation (player) | — | "✅ Đã nhận CK [amount]. Cảm ơn!" | — | N/A |
| Zalo DM / Messenger (24h) / Web push | Payment correction (player) | — | "⚠️ Thanh toán [ref] đã được điều chỉnh" | — | N/A |
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
| `waitlist_charge_derivation_alerted` | Owner alert được tạo từ failure event | `tenant_id`, `session_id`, `player_id` (opaque), `reason_code` |

> Chỉ dùng opaque IDs. Không log tên, số tiền, nội dung message trong analytics.

---

## 6. Acceptance Criteria

- [ ] Reminders derive từ effective charge state — không gửi cho paid/void
- [ ] Nhắc thủ công = free; nhắc tự động (cron ngưỡng 2h→24h) = `host_pro` (DD-40)
- [ ] Sau markPaid (thủ công tiền mặt/CK & auto CK) → xác nhận tự động tới player (FR-6.2)
- [ ] Kênh chính web push + Zalo DM; Messenger chỉ best-effort trong cửa sổ 24h (không gửi ngoài 24h)
- [ ] Settled confirmation emit 1 lần; partial KHÔNG emit paid copy
- [ ] Reversal emit correction, preserve audit trail
- [ ] Quiet hours/cooldown/max-N pass tests với tenant timezone
- [ ] Reachability KHÔNG cross tenant — `(person, tenant, platform)` test
- [ ] Provider failure KHÔNG rollback ledger
- [ ] Manual preview/exclusions và owner digest fallback work
- [ ] Rate-limit burst test pass cho 1k tenants concurrent
- [ ] `waitlist.charge_derivation_failed` tạo owner alert/digest tối đa một lần; recipient unresolved → skipped/DLQ có reason; alert không chứa PII/amount/venue và không sở hữu promotion retry

---

## 7. Open Questions / Changelog

### Open Questions

| ID | Quyết định | Trạng thái |
|---|---|---|
| NTF-OQ-1 | Default reminder thresholds/max count/copy text (mặc định 2h → 24h → …) | ⬜ Chưa chốt |
| NTF-OQ-2 | Nội dung nhắc DM có bao gồm remaining amount hay chỉ generic reminder? | ⬜ Chưa chốt |
| NTF-OQ-3 | Audience targeting khi announce theo nhãn thành viên | ✅ **Chốt DD-43** — filter theo `membership_tags` per-tenant chỉ giới hạn ai được mời/thấy announcement (không phải eligibility); build P4+ → `../dd-43-membership-tags-analysis.md` |
| NTF-OQ-4 | Notify khi promote waitlist → active / khi derivation fail | ✅ **Chốt DD-45** — promote thành công phát notify + reveal venue; derivation fail không notify candidate/reveal venue, chỉ phát idempotent owner-alert từ outbox event; session service sở hữu domain retry → `../dd-45-waitlist-analysis.md` |

### Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-07-15 | v2.3 | **DD-39×DD-45 failure alert:** consume waitlist charge-derivation failure event thành owner alert/digest idempotent; không gửi candidate promotion/venue; domain retry vẫn thuộc session service. |
| 2026-06-18 | v1.0 | Initial spec (English format) |
| 2026-06-19 | v2.0 | Chuẩn hoá Vietnamese numbered, thêm 10 use cases, 12 edge cases, screen states, analytics payload |
| 2026-07-15 | v2.2 | **Propagation (light):** neo DD-43 (announce audience theo `membership_tags`) + DD-45 (promote-waitlist notify) vào Open Questions với pointer; đường notify/schema propagate lúc build slice. |
| 2026-07-10 | v2.1 | **DD-40 + DD-37:** kênh nhắc chính = web push + Zalo DM, Messenger best-effort 24h (bỏ Telegram group-mention). Xác nhận tự động sau **mọi** markPaid (FR-6.2). Nhắc tự động = `host_pro`, thủ công = free. Cập nhật §1, UC-1/2/3/5/7/10, edge #3, screens, acceptance. |
