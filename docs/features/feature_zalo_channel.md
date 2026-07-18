# Feature: Zalo Player Channel — Product/UX Spec

> **Canonical phase:** P4.7  
> **Track:** 💬 Zalo Channel  
> **Version:** 2.3 · 2026-07-17
> **Status:** Reviewed · reconciled to decisions v1.45/DD-15/DD-49/DD-67
> **Prerequisites:** P4 onboarding (Zalo token connect) · P3.5 identity · P2 session/join · P3 notifications · P4 sync  
> **Tài liệu liên quan:** `../product/PRD.md` FLOW 4 + §4.2/4.4 · `../product/BRD.md` CO-2 · `BE/feature_zalo_channel_tech.md`

---

## 1. Mô tả

Support **bot-per-club** Zalo DM cho session listing, number-reply join, `/me`, `/pay`, `/leave`, reminders và settlement confirmations. Zalo group beta và inline buttons **chưa support** — DM-only, text-reply context.

### Bất biến

- Webhook token/bot binding xác định tenant — **KHÔNG BAO GIỜ** từ message content.
- Number choice bound to `person/bot/tenant/list_version/TTL` — stale number KHÔNG join item mới.
- Bot token and webhook verification secret: KMS/envelope encrypted, write-only/masked and rotatable; legacy plaintext `zalo_bots.secret` must be migrated-or-disabled and removed before runtime — webhook drift monitored.
- Identity + DM availability là **bot/OA-endpoint specific** — keyed scope hash gồm bot/OA id; club A's endpoint không reuse identity/window/token của club B. Target tenant được authorize riêng.

---

## 2. Use Cases + Edge Cases

### Use Cases

| ID | Actor | Hành động | Kết quả |
|---|---|---|---|
| ZAL-UC-1 | Host | Connect BYO bot token + webhook during onboarding | Zalo adapter configured per tenant |
| ZAL-UC-2 | Player | DM `/join` | Bot lists current open sessions with numbered choices |
| ZAL-UC-3 | Player | Reply number (e.g. "2") | Common join service: còn slot→active+charge+venue; full→waitlisted/no-charge/no-venue |
| ZAL-UC-4 | Player | DM `/me` | Personal summary for this club |
| ZAL-UC-5 | Player | DM `/pay [session]` | QR/payment instructions |
| ZAL-UC-6 | Player | DM `/leave [session]` | Leave with financial policy check |
| ZAL-UC-7 | System | Inbound message | Update reachability cho exact channel identity/bot-OA endpoint |
| ZAL-UC-8 | System | Send reminder/confirmation | Outbound via Zalo DM — obey provider constraints |
| ZAL-UC-9 | Player | Request web magic link | Bot issues short-lived link for player view |
| ZAL-UC-10 | System | Unsupported/protected message | Safe fallback response + owner digest |

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
| 8 | Resilience | Rate-limit / provider outage | Degrade without corrupting state — retry with backoff |
| 9 | Security | Venue/roster/debt exposed before auth | ❌ NEVER — same person-self/privacy rules across Zalo/Messenger/web |
| 10 | Data Integrity | Player messages between list versions | Reject stale — require fresh `/join` |
| 11 | Security | Magic link issued from unverified conversation | Reject — conversation must be verified first |
| 12 | Cross-Feature | Player has Messenger + Zalo identity → merge | Common identity service handles — Zalo adapter just updates reachability |
| 13 | Concurrency | Hai number-reply tranh final slot | Session lock: một active, người sau waitlisted với position dương; không charge/venue |
| 14 | Financial | Existing player đã `left` join lại | Route shared DD-49 join/correction handler; render canonical outcome. `REJOIN_REQUIRES_REVIEW` only for unknown/unimplemented disposition; Zalo không tự mutate ledger |

---

## 3. Screens & States

| Surface | Screen | Loading | Ready | Error | Empty |
|---------|--------|---------|-------|-------|-------|
| Zalo DM | `/join` session list | "Đang tải danh sách..." | Numbered list: "1. [Sport] [Time] [Area] — [Slots]" | "Lỗi — thử lại" | "Chưa có buổi chơi nào mở" |
| Zalo DM | Number reply → join outcome | "Đang xử lý..." | Active: "✅ Đã tham gia [session]! [venue]"; waitlisted: "⏳ Vị trí N" | Số không hợp lệ / danh sách hết hạn / rejoin cần host review | N/A |
| Zalo DM | `/me` summary | "Đang tải..." | Club info + debt + upcoming | "Lỗi" | "Chưa có hoạt động" |
| Zalo DM | `/pay` | — | QR image + payment instructions | "Lỗi — thử lại" | N/A |
| Zalo DM | Reminder received | — | "[Club] Bạn còn nợ [amount]" | — | N/A |
| Zalo DM | Paid confirmation | — | "✅ Đã nhận CK [amount]" | — | N/A |
| Zalo DM | Magic link | — | "🔗 Xem chi tiết: [link] (hết hạn sau 5 phút)" | "Lỗi tạo link" | N/A |

---

## 4. Domain Model

| Entity | Vai trò | Key constraints |
|--------|---------|-----------------|
| `zalo_bot_configs` | Bot token + webhook per tenant | `tenant_id` FK, encrypted token, `webhook_url`, `verified_at` |
| `channel_identities` | Bot/OA-scoped Zalo identity | `UNIQUE(platform, provider_scope_lookup_hash, platform_user_lookup_hash)`; raw `from.id` không là plaintext lookup |
| `channel_reachability` | DM availability | protected `UNIQUE(channel_identity_id)`; target tenant authorize riêng |
| `zalo_reply_contexts` | Numbered list state | `person_id`, `tenant_id`, `list_version`, `expires_at` |

---

## 5. Analytics Events

| Event | Khi nào | Payload tối thiểu |
|-------|---------|-------------------|
| `zalo_command_received` | Player gửi command | `tenant_id`, `command_type` (join/me/pay/leave/unknown) |
| `zalo_list_shown` | Session list gửi cho player | `tenant_id`, `session_count` |
| `zalo_choice_result` | Number reply processed | `tenant_id`, `result` (active/waitlisted/rejoin_review/stale/invalid) |
| `zalo_reachability_changed` | DM reachability set/lost | `tenant_id`, `available` |
| `zalo_provider_failure` | API/rate-limit error | `tenant_id`, `error_class` |
| `zalo_token_drift` | Webhook drift detected | `tenant_id` |

> Không log message content, raw Zalo ID, token trong analytics.

---

## 6. Acceptance Criteria

- [ ] Bot-per-club webhook always routes correct tenant
- [ ] Number reply context-bound, TTL, idempotent
- [ ] Join/leave/pay/me use common domain services
- [ ] Same `from.id` trên hai bot/OA tạo hai endpoint-bound identities/reachability; không cross-endpoint hoặc cross-tenant authorization
- [ ] Token KMS/rotation/drift detection tests pass
- [ ] Webhook verification secret is ciphertext-only at rest; legacy plaintext rows are KMS-backfilled or disabled, plaintext column dropped and no dual-read remains
- [ ] Signed early event with ciphertext may CAS `connecting→active`; register finalization preserves `active`; missing ciphertext/`error|revoked` fail closed and duplicate events do not re-emit analytics
- [ ] Unsupported message/provider outage safe fallback works
- [ ] Magic link secure and person-bound
- [ ] Rate-limit/privacy tests pass
- [ ] Full→waitlisted/no-charge/no-venue; existing `left` render canonical `active|waitlisted|current|rejoin_review`; review chỉ khi core không chứng minh được disposition; adapter không tự quyết money/capacity.

---

## 7. Open Questions / Changelog

### Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-07-17 | v2.3 | **BL-SEC-1/lifecycle closure:** make bot token + webhook secret KMS/write-only; require legacy migration-or-disable/drop/no-dual-read and CAS-safe early-event/finalization behavior before runtime. |
| 2026-07-17 | v2.2 | **DD-15/DD-49/DD-67:** Zalo identity/reachability scoped bot/OA endpoint; target-tenant auth tách riêng; rejoin render canonical carry-over/refunded outcome, review chỉ fail-closed fallback. |
| 2026-07-15 | v2.1 | **DD-45 + DD-37:** Zalo render active/waitlisted/current/rejoin-review; retire "Hết chỗ" outcome; sync events/AC; edge cases dùng identity/privacy Zalo+Messenger thay TG. |
| 2026-06-18 | v1.0 | Initial spec (English format) |
| 2026-06-19 | v2.0 | Chuẩn hoá Vietnamese numbered, thêm 10 use cases, 12 edge cases, Zalo DM screen states, reply context model |
