> **⚠️ ARCHIVED (DD-37, 2026-07-10):** Telegram out of phase-1 scope; kênh phase-1 = Zalo + Facebook Messenger + web. Đường player-Messenger thay thế: xem `feature_player_messenger_tech.md`. Doc này **giữ làm lịch sử** (không cập nhật theo v3.4). Ref: `../../standards/decisions.md` DD-37.

# Feature: Player Telegram Experience — Backend Tech Spec

> **Canonical phase:** P4.5 *(archived)*
> **Version:** 2.1 · 2026-07-13
> **Status:** ⚠️ ARCHIVED (DD-37, 2026-07-10) — superseded by `feature_player_messenger_tech.md`
> **Product spec:** `../feature_player_telegram.md`
> **References:** `../../product/TDD.md` §3.3/3.4 · `../../standards/decisions.md` DD-37

---

## 1. Tổng quan triển khai

```text
TG Update → Adapter (callback/command/deep_link)
    → Validate (actor, chat, message ref, tenant, session state)
    → Domain Service (shared with web) → Outbox → Projectors (roster edit, DM)
```

Adapter contract: validate all callback fields independently — actor, chat binding, message/session reference, tenant scope, session open state. Domain services shared with web — no duplicate logic.

---

## 2. Database Schema + Edge Cases (BE)

### Schema

Uses existing tables: `telegram_links`, `channel_reachability`, `surface_refs`, `players`, `memberships`. No new tables — adapter uses shared domain services. *(Archived adapter; vocabulary kept aligned to canonical schema.)*

### Edge Cases (Backend)

| # | Category | Case | Xử lý |
|---|----------|------|-------|
| 1 | Security | Callback: wrong chat ≠ session tenant | Reject — validate separately |
| 2 | Concurrency | Replayed TG update_id | Idempotency key — return previous result |
| 3 | Financial | Paid player tap Leave | Financial policy check via domain service |
| 4 | Security | Bot DM without prior /start | Cannot send — reachability not set |
| 5 | Security | Group mention leaks debt amount | Template policy check — default: no amount |
| 6 | Data Integrity | Old/deleted announcement message | Stale response + trigger reproject |
| 7 | Security | Multi-club DM ambiguous | NEVER guess — show picker |
| 8 | Resilience | TG API rate-limit | Retry backoff — no canonical rollback |
| 9 | Data Integrity | Roster projector creates duplicate | Delivery key dedup — edit existing message |
| 10 | Security | Cross-tenant reachability | Scoped per (person, tenant, platform) |
| 11 | Resilience | Provider timeout during join | Canonical state committed — projector retries |
| 12 | Cross-Feature | Account merge invalidates DM context | Invalidate old context — use merged person |

---

## 3. API Contract

### Telegram Adapter Commands

| Command/Callback | Auth | Mô tả |
|-----------------|------|-------|
| Inline button: Join | Player (group callback) | Validate → join domain service |
| Inline button: Leave | Player (group callback) | Validate → leave domain service |
| `/myclubs` | Player (DM) | List clubs from verified context |
| `/me` | Player (DM) | Personal summary |
| `/pay [session]` | Player (DM) | Payment instructions |
| Deep link: `club_<slug>` | Player | Set sticky context |

### Error Responses (Telegram)

| Situation | TG Response |
|-----------|-------------|
| Not linked | "❌ Nhóm chưa liên kết club" |
| Full | "❌ Hết chỗ" |
| Already joined | "⚠️ Bạn đã tham gia rồi" |
| Session closed | "❌ Buổi chơi đã kết thúc" |
| Not authorized | "⛔ Không có quyền" |
| Multi-club picker | Inline buttons with club names |

---

## 4. Chi tiết triển khai

### Callback Validation Chain

```text
1. Verify update not replayed (update_id dedup)
2. Verify chat_id → telegram_link → tenant_id
3. Verify callback session_id belongs to same tenant
4. Verify actor identity (TG user_id → person_id)
5. Verify session status = open
6. → Domain service (same as web)
```

### Reachability Management

- Set reachability on first valid `/start` or deep link interaction.
- Scoped: `(person_id, tenant_id, platform='telegram')`.
- Lost: if bot blocked by user or membership removed.

---

## 5. Testing Plan

### Unit Tests

| # | Test | Input | Expected |
|---|------|-------|----------|
| 1 | Join callback valid | Correct chat/session/actor | Joined |
| 2 | Join callback wrong chat | Chat ≠ session tenant | Rejected |
| 3 | Join callback replay | Same update_id | Idempotent |
| 4 | Join full session | No capacity | "Hết chỗ" |
| 5 | Join closed session | Status=closed | "Đã kết thúc" |
| 6 | Leave unpaid | No charges | Left successfully |
| 7 | Leave paid | Active charges | Policy check |
| 8 | DM /myclubs single club | 1 membership | Auto-show club |
| 9 | DM /myclubs multi club | 3 memberships | Picker shown |
| 10 | DM stale context | Deleted membership | Fail closed |
| 11 | Deep link sets context | Valid slug | Sticky context set |
| 12 | Roster projector edit | Join event | Message updated |
| 13 | Roster projector dedup | Same event twice | No duplicate message |
| 14 | Announcement deleted | Missing surface ref | Reproject triggered |
| 15 | Reachability set | First /start | Reachable |
| 16 | Reachability lost | Bot blocked | Not reachable |
| 17 | Cross-tenant reachability | Club A vs B | Independent |
| 18 | Group mention privacy | Amount in template | Blocked by policy |
| 19 | TG API rate-limit | 429 response | Retry backoff |
| 20 | Account merge | Old context | Invalidated |

### Integration Tests

| # | Test | Setup | Expected |
|---|------|-------|----------|
| 1 | Join → roster update | Tap join → check TG message | Roster message edited |
| 2 | Multi-club DM flow | Player in 3 clubs → DM | Picker → select → command works |
| 3 | Paid leave policy | Join → pay → leave | Policy enforced |
| 4 | Provider failure recovery | TG API timeout → retry | State consistent |

---

## 6. Rollout Plan + Changelog

### Rollout

1. Shadow adapter (log, no action)
2. Join/leave callbacks enabled
3. DM commands enabled
4. Roster projector enabled
5. Reminder/confirmation delivery

### Metrics

- Callback result distribution (joined/left/full/error)
- DM context selection count
- Reachability changes
- Projection failure rate
- API rate-limit hits

### Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-06-18 | v1.0 | Initial BE tech spec (English format) |
| 2026-06-19 | v2.0 | Chuẩn hoá Vietnamese numbered (6 sections), 12 edge cases, callback validation chain, 20 tests |
| 2026-07-13 | v2.1 | Archived behavior unchanged; align canonical roster table name to `players`. |
