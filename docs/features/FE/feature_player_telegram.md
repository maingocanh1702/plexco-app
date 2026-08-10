# Feature: Player Telegram Experience — Product/UX Spec

> ⚠️ **ARCHIVED (DD-37, 2026-07-10):** Telegram loại khỏi phạm vi phase-1. Thay bằng `feature_player_messenger.md` + `feature_zalo_channel.md`. Giữ làm lịch sử. Xem `../standards/decisions.md` DD-37.

> **Canonical phase:** P4.5 *(archived)*
> **Track:** 📱 Player TG
> **Version:** 2.1 · 2026-07-13
> **Status:** Archived (DD-37)
> **Prerequisites:** P2 routing/authz · P3.5 identity · P2 session/join · P3 notifications · P4 sync
> **Tài liệu liên quan:** `../product/BRD.md` FR-3.1/BR-4 · `../product/PRD.md` FLOW 3 + §4.2/4.4 · `../product/TDD.md` §3.3/3.4 · `../BE/feature_player_telegram_tech.md`

---

## 1. Mô tả

Cung cấp **group-first join/leave** và safe DM commands qua 1 shared Telegram bot. Cover: inline callback validation, live roster projection, DM tenant context, mention/DM reachability, payment/reminder surfaces. Admin commands giữ ở routing/session specs.

### Bất biến

- Callback validate: actor, chat, message/session reference, tenant, session open state — thiếu 1 = reject.
- Duplicate taps/replayed TG update = idempotent.
- TG API/rate-limit failure KHÔNG rollback canonical join/payment.
- Bot KHÔNG DM user trước khi có valid inbound/start — maintain tenant-specific reachability.

---

## 2. Use Cases + Edge Cases

### Use Cases

| ID | Actor | Hành động | Kết quả |
|---|---|---|---|
| PTG-UC-1 | Player | Tap Join button trên group announcement | Validate → resolve/create identity + membership → atomic join |
| PTG-UC-2 | Player | Tap Leave button | Financial policy check → leave/block |
| PTG-UC-3 | System | Roster change | Sync projector edits TG roster message |
| PTG-UC-4 | Player | DM `/myclubs` | List clubs (verified deep link/sticky context/picker) |
| PTG-UC-5 | Player | DM `/pay [session]` | Show QR/payment instructions |
| PTG-UC-6 | Player | DM `/me` | Personal summary across clubs |
| PTG-UC-7 | System | Send reminder to player DM | DM if reachable; group mention fallback if allowed |
| PTG-UC-8 | System | Send paid confirmation | "✅ Đã nhận CK" to player DM |
| PTG-UC-9 | Player | Multi-club DM — ambiguous context | Club picker (localized, paginated) |
| PTG-UC-10 | System | Old/edited/deleted announcement | Safe stale response + reproject |

### Edge Cases

| # | Category | Case | Hành vi bắt buộc |
|---|----------|------|-------------------|
| 1 | Security | Callback: wrong chat ≠ session tenant | Reject — validate chat binding + session tenant riêng |
| 2 | Concurrency | Duplicate tap (replayed update_id) | Idempotent — return same result |
| 3 | Financial | Paid/partial player tap Leave | Financial policy check — may require host review |
| 4 | Security | Bot DM user chưa có inbound | ❌ KHÔNG — reachability chỉ set sau valid /start |
| 5 | Security | Group mention expose debt amount | Tuỳ privacy policy — default KHÔNG expose số tiền |
| 6 | Data Integrity | Announcement deleted/edited | Safe stale response + trigger reproject |
| 7 | Security | Multi-club DM context ambiguous | KHÔNG guess — show picker |
| 8 | Resilience | TG API rate-limit | Retry with backoff — KHÔNG rollback canonical state |
| 9 | Security | Stale callback (session đã close) | "Buổi chơi đã kết thúc" — no mutation |
| 10 | Data Integrity | Roster projector duplicate announcements | Projector deduplication — edit existing, KHÔNG send new |
| 11 | Security | Reachability cross-tenant | ❌ NEVER — tenant-specific reachability only |
| 12 | Cross-Feature | Account merge → old DM context invalid | Invalidate old context — use merged person |

---

## 3. Screens & States

| Surface | Screen | Loading | Ready | Error | Empty |
|---------|--------|---------|-------|-------|-------|
| TG Group | Join callback answer | "⏳ Đang xử lý..." | "✅ Đã tham gia!" / "❌ Hết chỗ" / "⚠️ Đã tham gia rồi" | "❌ Lỗi — thử lại" | N/A |
| TG Group | Leave callback answer | "⏳ Đang xử lý..." | "✅ Đã rời" / "⚠️ Cần host duyệt (đã CK)" | "❌ Lỗi" | N/A |
| TG Group | Roster message | — | Updated inline: names + status icons | — | "Chưa có ai tham gia" |
| TG DM | Club picker | — | Inline buttons: list clubs | "Không tìm thấy clubs" | "Bạn chưa tham gia club nào" |
| TG DM | `/me` summary | "Đang tải..." | Clubs + upcoming sessions + debt summary | "Lỗi — thử lại" | "Chưa có hoạt động" |
| TG DM | Reminder received | — | "[Club] Bạn còn nợ [amount]. [QR link]" | — | N/A |
| TG DM | Paid confirmation | — | "✅ [Club] Đã nhận CK [amount]" | — | N/A |

---

## 4. Domain Model

| Entity | Vai trò | Key constraints |
|--------|---------|-----------------|
| `telegram_links` | Group → tenant binding | Routing source |
| `channel_reachability` | DM availability per person/tenant/platform | `UNIQUE(person_id, tenant_id, platform)` |
| `surface_refs` | TG message references (roster msg, announcement) | `UNIQUE(aggregate_id, surface, ref_type)` |
| `players` | Player join state | Canonical schema name; domain service shared with web |

---

## 5. Analytics Events

| Event | Khi nào | Payload tối thiểu |
|-------|---------|-------------------|
| `player_tg_callback_result` | Join/leave tap processed | `tenant_id`, `result` (joined/left/full/blocked/stale) |
| `player_tg_dm_context_selected` | Player chọn club trong picker | `tenant_id`, `person_id` (opaque) |
| `player_tg_reachability_changed` | DM reachability set/lost | `tenant_id`, `platform=telegram`, `available` |
| `player_tg_projection_failed` | Roster edit/announcement fail | `tenant_id`, `error_class` |

> Không log message content, raw Telegram ID, chat ID trong analytics.

---

## 6. Acceptance Criteria

- [ ] Group tap joins/leaves đúng tenant/session atomically
- [ ] Callback replay/wrong chat/stale message safe
- [ ] Roster projector converges — no duplicate announcements
- [ ] Multi-club DM picker/context invalidation works
- [ ] Reachability tenant-specific — no cross-tenant
- [ ] Paid/partial leave policy enforced
- [ ] Provider failure/rate limits KHÔNG corrupt state
- [ ] Privacy-safe reminder/confirmation paths pass tests

---

## 7. Open Questions / Changelog

### Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-06-18 | v1.0 | Initial spec (English format) |
| 2026-06-19 | v2.0 | Chuẩn hoá Vietnamese numbered, thêm 10 use cases, 12 edge cases, callback screen states |
| 2026-07-13 | v2.1 | Archived behavior unchanged; align only canonical roster table name to `players` so historical docs do not invent a nonexistent schema object. |
