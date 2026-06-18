# Feature: Zalo Player Channel — Product/UX Spec

> **Canonical phase:** P4.7  
> **Track:** 💬 Zalo Channel  
> **Version:** 2.0 · 2026-06-19  
> **Status:** Reviewed  
> **Prerequisites:** P4 onboarding (Zalo token connect) · P3.5 identity · P2 session/join · P3 notifications · P4 sync  
> **Tài liệu liên quan:** `../core/PRD.md` FLOW 4 + §4.2/4.4 · `../core/BRD.md` CO-2 · `BE/feature_zalo_channel_tech.md`

---

## 1. Mô tả

Support **bot-per-club** Zalo DM cho session listing, number-reply join, `/me`, `/pay`, `/leave`, reminders và settlement confirmations. Zalo group beta và inline buttons **chưa support** — DM-only, text-reply context.

### Bất biến

- Webhook token/bot binding xác định tenant — **KHÔNG BAO GIỜ** từ message content.
- Number choice bound to `person/bot/tenant/list_version/TTL` — stale number KHÔNG join item mới.
- Bot token: encrypted, masked, rotatable — webhook drift monitored.
- DM availability là **tenant bot-specific** — club A's bot ≠ club B's bot reachability.

---

## 2. Use Cases + Edge Cases

### Use Cases

| ID | Actor | Hành động | Kết quả |
|---|---|---|---|
| ZAL-UC-1 | Host | Connect BYO bot token + webhook during onboarding | Zalo adapter configured per tenant |
| ZAL-UC-2 | Player | DM `/join` | Bot lists current open sessions with numbered choices |
| ZAL-UC-3 | Player | Reply number (e.g. "2") | Resolve listed session → identity + tenant → common join service |
| ZAL-UC-4 | Player | DM `/me` | Personal summary for this club |
| ZAL-UC-5 | Player | DM `/pay [session]` | QR/payment instructions |
| ZAL-UC-6 | Player | DM `/leave [session]` | Leave with financial policy check |
| ZAL-UC-7 | System | Inbound message | Update tenant-specific reachability |
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
| 9 | Security | Venue/roster/debt exposed before auth | ❌ NEVER — same privacy rules as TG |
| 10 | Data Integrity | Player messages between list versions | Reject stale — require fresh `/join` |
| 11 | Security | Magic link issued from unverified conversation | Reject — conversation must be verified first |
| 12 | Cross-Feature | Player has TG + Zalo identity → merge | Common identity service handles — Zalo adapter just updates reachability |

---

## 3. Screens & States

| Surface | Screen | Loading | Ready | Error | Empty |
|---------|--------|---------|-------|-------|-------|
| Zalo DM | `/join` session list | "Đang tải danh sách..." | Numbered list: "1. [Sport] [Time] [Area] — [Slots]" | "Lỗi — thử lại" | "Chưa có buổi chơi nào mở" |
| Zalo DM | Number reply → joined | "Đang xử lý..." | "✅ Đã tham gia [session]! Địa chỉ: [venue]" | "❌ Hết chỗ / Số không hợp lệ / Danh sách hết hạn" | N/A |
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
| `channel_reachability` | DM availability | `UNIQUE(person_id, tenant_id, platform='zalo')` |
| `zalo_reply_contexts` | Numbered list state | `person_id`, `tenant_id`, `list_version`, `expires_at` |

---

## 5. Analytics Events

| Event | Khi nào | Payload tối thiểu |
|-------|---------|-------------------|
| `zalo_command_received` | Player gửi command | `tenant_id`, `command_type` (join/me/pay/leave/unknown) |
| `zalo_list_shown` | Session list gửi cho player | `tenant_id`, `session_count` |
| `zalo_choice_result` | Number reply processed | `tenant_id`, `result` (joined/full/stale/invalid) |
| `zalo_reachability_changed` | DM reachability set/lost | `tenant_id`, `available` |
| `zalo_provider_failure` | API/rate-limit error | `tenant_id`, `error_class` |
| `zalo_token_drift` | Webhook drift detected | `tenant_id` |

> Không log message content, raw Zalo ID, token trong analytics.

---

## 6. Acceptance Criteria

- [ ] Bot-per-club webhook always routes correct tenant
- [ ] Number reply context-bound, TTL, idempotent
- [ ] Join/leave/pay/me use common domain services
- [ ] Reachability tenant+Zalo specific — no cross-club
- [ ] Token KMS/rotation/drift detection tests pass
- [ ] Unsupported message/provider outage safe fallback works
- [ ] Magic link secure and person-bound
- [ ] Rate-limit/privacy tests pass

---

## 7. Open Questions / Changelog

### Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-06-18 | v1.0 | Initial spec (English format) |
| 2026-06-19 | v2.0 | Chuẩn hoá Vietnamese numbered, thêm 10 use cases, 12 edge cases, Zalo DM screen states, reply context model |
