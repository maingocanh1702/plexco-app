# Feature: Zalo Player Channel — Product/UX Spec

> **Canonical phase:** P4.7  
> **Track:** 💬 Zalo Channel  
> **Version:** 2.7 · 2026-08-10
> **Status:** Reviewed · reconciled to DD-15/DD-32/DD-45/DD-49/DD-67
> **Implementation:** Not started · authority: `../standards/BUILD-STATUS.md` (Doc status ≠ Implementation status)  
> **Prerequisites:** P4 onboarding (Zalo token connect) · P3.5 identity/account-link · P2 session/join · payment evidence/finalizer · P3 notifications · P4 sync
> **Tài liệu liên quan:** `../product/PRD.md` FLOW 4 + §4.2/4.4 · `../product/BRD.md` CO-2 · `../standards/decisions.md` DD-32 · `feature_channel_booking_funnel.md` · `../BE/feature_zalo_channel_tech.md`

---

## 1. Mô tả

Support **bot-per-club** Zalo DM cho session listing, number-reply join, `/me`, `/pay`, `/leave`, reminders và settlement confirmations. Zalo group beta và inline buttons **chưa support** — DM-only, text-reply context.

### Entry points

| Entry | Route / Surface | Actor | Mô tả |
|-------|----------------|-------|-------|
| Zalo DM → bot | Direct message window | Player | Inbound DM trigger bot response |
| `/join` command | Zalo DM | Player | List open sessions → number choice |
| Number reply | Zalo DM | Player | Session detail → final confirm gate |
| `/me` command | Zalo DM | Player | Personal club summary |
| `/pay` command | Zalo DM | Player | QR/payment instructions từ canonical debt |
| `/leave` command | Zalo DM | Player | Leave with financial policy check |
| Webhook receiver | `POST /api/webhooks/zalo/:token` | System | Zalo event ingestion → tenant resolve |
| Magic link request | Zalo DM → web | Player | Short-lived link for player view |
| Onboarding connect | `/onboarding/zalo` (web) | Host | BYO bot token + webhook setup |

### Bất biến

- Webhook token/bot binding xác định tenant — **KHÔNG BAO GIỜ** từ message content.
- Number choice bound to `person/bot/tenant/list_version/TTL` — stale number KHÔNG join item mới.
- Bot token and webhook verification secret: KMS/envelope encrypted, write-only/masked and rotatable; legacy plaintext `zalo_bots.secret` must be migrated-or-disabled and removed before runtime — webhook drift monitored.
- Identity + DM availability là **bot/OA-endpoint specific** — keyed scope hash gồm bot/OA id; club A's endpoint không reuse identity/window/token của club B. Target tenant được authorize riêng.
- Reply number chọn session chỉ mở safe detail; final confirm mới gọi shared channel-booking funnel. Zalo adapter không tự tính fee/capacity, không tự quyết linked/payment và không tạo player/charge.

---

## 2. Use Cases + Edge Cases

### Use Cases

| ID | Actor | Hành động | Kết quả |
|---|---|---|---|
| ZAL-UC-1 | Host | Connect BYO bot token + webhook during onboarding | Zalo adapter configured per tenant |
| ZAL-UC-2 | Player | DM `/join` | Bot lists current open sessions with numbered choices |
| ZAL-UC-3 | Player | Reply number chọn session | Bot hiện time/public area/fee/confirmed count/slots và menu final confirm; chưa tạo player/charge |
| ZAL-UC-4 | Player | DM `/me` | Personal summary for this club |
| ZAL-UC-5 | Player | DM `/pay [session]` cho booking/charge hiện hữu | QR/payment instructions từ canonical debt owner; không tạo pay-now booking intent mới |
| ZAL-UC-6 | Player | DM `/leave [session]` | Leave with financial policy check |
| ZAL-UC-7 | System | Inbound message | Update reachability cho exact channel identity/bot-OA endpoint |
| ZAL-UC-8 | System | Send reminder/confirmation | Outbound via Zalo DM — obey provider constraints |
| ZAL-UC-9 | Player | Request web magic link | Bot issues short-lived link for player view |
| ZAL-UC-10 | System | Unsupported/protected message | Safe fallback response + owner digest |
| ZAL-UC-11 | Player | Final confirm booking | Shared DD-32 gate: free→active; full→waitlist; approval→pending; paid+qualified Account link→active/pay-later; paid+unlinked→link hoặc verified pay-now hold 15 phút |

### Edge Cases

| # | Category | Case | Hành vi bắt buộc |
|---|----------|------|-------------------|
| 1 | Security | Tenant resolved từ message content | ❌ NEVER — webhook token/bot binding only |
| 2 | Data Integrity | Stale number reply (list expired/changed) | Reject — "Danh sách đã thay đổi, gõ /join để xem lại" |
| 3 | Data Integrity | Number out of range | "Số không hợp lệ — chọn từ 1 đến N" |
| 4 | Security | Unsupported message type | Safe fallback — KHÔNG expose error details |
| 5 | Security | Bot token invalid/revoked | Degrade gracefully — KHÔNG corrupt canonical state |
| 6 | Security | Webhook drift (URL changed) | Monitor + alert — owner notification |
| 7 | Security | DM reachability cross-club | ❌ NEVER — club A's bot ≠ club B's reachability |
| 8 | Resilience | Zalo hoặc payment-provider outage | Không corrupt canonical state; Zalo send retry. Payment capability unknown/unavailable → không tạo hold/QR, chỉ offer Account link/web |
| 9 | Security | Venue/roster/debt exposed before auth | ❌ NEVER — same person-self/privacy rules across Zalo/Messenger/web |
| 10 | Data Integrity | Player messages between list versions | Reject stale — require fresh `/join` |
| 11 | Security | Magic link issued from unverified conversation | Reject — conversation must be verified first |
| 12 | Cross-Feature | Player has Messenger + Zalo identity → merge | Common identity service handles — Zalo adapter just updates reachability |
| 13 | Concurrency | Hai final-confirm tranh final slot | Shared occupancy đếm active + live holds: đúng một giữ/chiếm slot; người sau waitlisted, không charge/venue |
| 14 | Financial | Existing player đã `left` join lại | Route shared DD-49 join/correction handler; render canonical outcome. `REJOIN_REQUIRES_REVIEW` only for unknown/unimplemented disposition; Zalo không tự mutate ledger |
| 15 | Identity | `from.id` có Person nhưng chưa có qualified Account link | Browse bình thường; paid final confirm hiện link-or-pay, không cấp pay-later |
| 16 | Payment | Screenshot/nút “Tôi đã thanh toán” | Chỉ poll; không phải proof. Verified durable bank evidence mới được finalizer dùng |
| 17 | Concurrency | Link callback và payment callback race | Một shared intent/finalizer cho một terminal booking/player/charge/allocation |
| 18 | Fairness | Promotion pay-now hold hết hạn | Release slot, audit, requeue tail đúng một lần và tiếp tục selector |
| 19 | Delivery | Hold commit nhưng Zalo send fail | Definite reject → shared cancel/release; timeout/unknown → giữ resumable hold tới TTL |

---

## 3. Screens & States

> Zalo OA bot interface. No web surface (host config in connector_onboarding).

### Zalo OA — Welcome + menu

**Layout:**

```
┌──────────────────────────────────────┐
│ 🏸 CLB Cầu lông BT (Zalo OA)       │
├──────────────────────────────────────┤
│                                      │
│  Chào bạn! 👋                        │
│  Đây là CLB Cầu lông Bình Thạnh.    │
│                                      │
│  Gõ số để chọn:                      │
│  1. 🏸 Xem kèo                      │
│  2. 💰 Thanh toán                    │
│  3. ❓ Hỏi trợ lý                   │
│  4. ⚙️ Cài đặt                      │
│                                      │
└──────────────────────────────────────┘
```

> Zalo: number-reply contract (không có persistent menu/quick reply như Messenger).

### Zalo OA — Session card

**Layout:**

```
🏸 Cầu lông tối T5
🕒 19:00–21:00, 10/08
📍 Quận 3
💰 120.000đ
👥 6/8 · 2 chỗ

Gõ 1 để đăng ký
Gõ 0 để quay lại
```

### Zalo OA — Payment notification

**Layout:**

```
💰 Xác nhận thanh toán

Kèo: Cầu lông T5 · 10/08
Số tiền: 75,000₫
Trạng thái: ⏳ Chờ xác nhận từ host

Gõ /pay để xem chi tiết
```

### Data source mapping

| Component | Data source | Ghi chú |
|-----------|-------------|---------|
| OA menu | Number-reply mapping | Stateless, per-message |
| Session cards | `public_sessions` / roster | Text format (no template) |
| Payment info | `charges` per person-self | Via canonical service |
| Webhook | Zalo Webhook API | `from.id` = OA-scoped |

### State coverage matrix

| Screen | Loading | Ready | Error | Empty |
|--------|---------|-------|-------|-------|
| Welcome | — | ✅ Menu + greeting | — | ⚪ N/A |
| Session list | ✅ "Đang tải..." | ✅ Text cards + number reply | ✅ "Lỗi — gõ lại" | ✅ "Chưa có kèo" |
| Payment | ✅ "Đang kiểm tra..." | ✅ Amount + status | ✅ "Lỗi" | ✅ "Không có khoản" |
| Search | ✅ "🔍 Đang tìm..." | ✅ Results + number reply | ✅ "Lỗi" | ✅ "Không tìm thấy" |
---

## 4. Domain Model

| Entity | Vai trò | Key constraints |
|--------|---------|-----------------|
| `zalo_bot_configs` | Bot token + webhook per tenant | `tenant_id` FK, encrypted token, `webhook_url`, `verified_at` |
| `channel_identities` | Bot/OA-scoped Zalo identity | `UNIQUE(platform, provider_scope_lookup_hash, platform_user_lookup_hash)`; raw `from.id` không là plaintext lookup |
| `channel_reachability` | DM availability | protected `UNIQUE(channel_identity_id)`; target tenant authorize riêng |
| `zalo_reply_contexts` | Numbered list state | `person_id`, `tenant_id`, `list_version`, `expires_at` |
| `channel_booking_intents` | Link resume + optional payment hold | Shared tenant-private orchestration; exact channel identity/session, quote/version, TTL, canonical terminal refs |

---

## 5. Analytics Events

| Event | Khi nào | Payload tối thiểu |
|-------|---------|-------------------|
| `zalo_command_received` | Player gửi command | `tenant_id`, `command_type` (join/me/pay/leave/unknown) |
| `zalo_list_shown` | Session list gửi cho player | `tenant_id`, `session_count` |
| `zalo_choice_result` | Number reply processed | `tenant_id`, `result` (active/waitlisted/rejoin_review/stale/invalid) |
| `zalo_booking_gate_result` | Final gate/finalizer outcome | `tenant_id`, `branch`, `result`, `reason_code`; no raw identity/payment content |
| `zalo_reachability_changed` | DM reachability set/lost | `tenant_id`, `available` |
| `zalo_provider_failure` | API/rate-limit error | `tenant_id`, `error_class` |
| `zalo_token_drift` | Webhook drift detected | `tenant_id` |

> Không log message content, raw Zalo ID, token trong analytics.

---

## 6. Acceptance Criteria

- [ ] Bot-per-club webhook always routes correct tenant
- [ ] Number reply context-bound, TTL, idempotent
- [ ] Browse/final booking, leave, pay and me use common domain services; Zalo adapter không re-derive fee/capacity/link/payment.
- [ ] Same `from.id` trên hai bot/OA tạo hai endpoint-bound identities/reachability; không cross-endpoint hoặc cross-tenant authorization
- [ ] Token KMS/rotation/drift detection tests pass
- [ ] Webhook verification secret is ciphertext-only at rest; legacy plaintext rows are KMS-backfilled or disabled, plaintext column dropped and no dual-read remains
- [ ] Signed early event with ciphertext may CAS `connecting→active`; register finalization preserves `active`; missing ciphertext/`error|revoked` fail closed and duplicate events do not re-emit analytics
- [ ] Unsupported message/provider outage safe fallback works
- [ ] Magic link secure and person-bound
- [ ] Rate-limit/privacy tests pass
- [ ] First-entry full→waitlisted/no-charge/no-venue. Existing `left` render canonical `active|waitlisted|current|rejoin_review`; DD-49 active→carry-or-append, full→carry-history-or-defer-refunded; adapter không tự quyết money/capacity.
- [ ] Paid final gate: qualified Account link→active+one charge/pay-later; unlinked→15-minute hold only when settlement capability proven; full settlement→one active+charge+allocation, under/late/wrong proof không active.
- [ ] Free/full/approval do not collect payment early; promoted hold expiry releases capacity and requeues once at tail.

---

## 7. Open Questions / Changelog

### Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-08-10 | v2.7 | **A-grade upgrade:** thêm Entry points table (9 entries); bump version. Không đổi contract/domain model. |
| 2026-07-28 | v2.6 | Mirror DD-32 Option D: number selection now opens safe detail, final confirm delegates to shared link-or-pay funnel; pin qualified Account link, verified-payment hold, provider fail-closed and waitlist fairness. No runtime claim. |
| 2026-07-19 | v2.5a | Metadata sweep (index v2.35): thêm trường **Implementation** đồng bộ BUILD-STATUS (Not started). Không đổi contract. |
| 2026-07-19 | v2.5 | **DD-49 timing mirror:** active rejoin carry/append; full rejoin carry-history/defer-refunded. Zalo remains a thin renderer; authority v1.67. |
| 2026-07-19 | v2.4 | **DD-45×DD-49 mirror consistency:** qualify no-charge final-slot outcome as first-entry; existing-left rejoin renders shared carry-over/refunded active/waitlisted outcome without creating a new charge. |
| 2026-07-17 | v2.3 | **BL-SEC-1/lifecycle closure:** make bot token + webhook secret KMS/write-only; require legacy migration-or-disable/drop/no-dual-read and CAS-safe early-event/finalization behavior before runtime. |
| 2026-07-17 | v2.2 | **DD-15/DD-49/DD-67:** Zalo identity/reachability scoped bot/OA endpoint; target-tenant auth tách riêng; rejoin render canonical carry-over/refunded outcome, review chỉ fail-closed fallback. |
| 2026-07-15 | v2.1 | **DD-45 + DD-37:** Zalo render active/waitlisted/current/rejoin-review; retire "Hết chỗ" outcome; sync events/AC; edge cases dùng identity/privacy Zalo+Messenger thay TG. |
| 2026-06-18 | v1.0 | Initial spec (English format) |
| 2026-06-19 | v2.0 | Chuẩn hoá Vietnamese numbered, thêm 10 use cases, 12 edge cases, Zalo DM screen states, reply context model |
