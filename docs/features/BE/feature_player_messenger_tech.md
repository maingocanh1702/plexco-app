# Feature: Player Facebook Messenger Experience — Backend Tech Spec

> **Canonical phase:** P2.5
> **Version:** 0.2 · 2026-07-15
> **Status:** Draft (kênh DD-37 ✅; account-link DD-33 🟡 phase-1)
> **Product spec:** `../feature_player_messenger.md` *(Draft)*
> **References:** `../../standards/decisions.md` DD-37 (Messenger phase-1) · DD-33 (account-link) · DD-45 (waitlist/rejoin) · **PSID page-scoped = Meta platform fact** (`../../channels/messenger/messenger-channel-design.md`) · `../BE/feature_zalo_channel_tech.md` · `../BE/feature_tenant_routing_authz_tech.md`

> Kế thừa kênh player thay cho `feature_player_telegram_tech.md` (**ARCHIVED — DD-37**). Adapter dùng **domain service chung** với web/Zalo — không nhân đôi logic. Schema mới ở mức đề xuất; authoritative = `packages/db/schema.ts` (`messenger_pages`) + migrations.

---

## 1. Tổng quan triển khai

```text
Messenger webhook (page_id → tenant) → Verify X-Hub-Signature (app secret)
    → Normalize PSID (page-scoped) → Update dedup
    → Identity/Domain Service (shared) → Outbox → Delivery (24h window)
```

**Page-per-club:** 1 **FB App** cấp platform, mỗi CLB một **Page**; webhook suy tenant từ **`messenger_pages.page_id → tenant_id`** (routing từ kênh, KHÔNG từ nội dung — NFR-S3). **PSID là page-scoped** (cùng người ở 2 Page = 2 PSID khác nhau — **Meta platform fact**, xem `messenger-channel-design.md`) → identity neo theo `page_id`.

**Ràng buộc chính sách 2026 (DD-37 / CO-3):**
- **Cửa sổ 24h:** chỉ gửi message tự do trong 24h kể từ inbound cuối của user.
- **Ngoài cửa sổ:** standard send dừng sau 24h; chỉ dùng cơ chế Meta đủ điều kiện/được phê duyệt. MVP coi luồng là **"join + xác nhận"**, **nhắc best-effort trong 24h**, fallback **web + Zalo**.
- **App Review bắt buộc** trước GA (rủi ro lịch phase-1) → degrade sang web + Zalo nếu chậm.
- **Không inline button kiểu Telegram** → dùng **quick-reply / persistent menu**.

---

## 2. Database Schema + Edge Cases (BE)

### Schema

Dùng bảng canonical `messenger_pages` (schema.ts) + `channel_reachability` (24h window) + `surface_refs` + shared domain services. Không bảng mới cho player-flow.

```sql
-- Có sẵn trong schema.ts (tham chiếu, KHÔNG tạo lại):
-- messenger_pages(id, tenant_id UNIQUE, page_id UNIQUE, page_token_enc, app_secret_enc, status, verified_at, ...)
-- channel_reachability(person_id, tenant_id, platform, can_dm, last_inbound_at, window_expires_at, otn_token_enc)
--   → platform='messenger'; window_expires_at = last_inbound_at + 24h (cửa sổ 24h)
-- channel_identities(platform='messenger', platform_user_lookup_hash=keyed(page_id || ':' || PSID), ...)
--   ⚠️ PSID là PAGE-SCOPED nhưng UNIQUE của bảng là (platform, platform_user_lookup_hash) với platform='messenger'
--      (KHÔNG có cột page). Nếu hash chỉ keyed(PSID) → hai người ở hai Page khác nhau có thể trùng hash
--      (PSID không unique xuyên Page) → va chạm unique / gán nhầm identity xuyên tenant.
--   ✅ Bắt buộc đưa page_id vào hash: platform_user_lookup_hash = keyed(page_id || ':' || PSID).
--      platform_user_id_enc lưu PSID (page-scoped) đã mã hoá.
```

### Edge Cases (Backend)

| # | Category | Case | Xử lý |
|---|----------|------|-------|
| 1 | Security | Tenant từ nội dung message | ❌ NEVER — chỉ `page_id → messenger_pages → tenant` |
| 2 | Security | Webhook giả mạo | ❌ Reject — verify `X-Hub-Signature-256` (app secret, timing-safe) |
| 3 | Concurrency | Replay message (mid/event) | Update dedup — idempotent |
| 4 | Reachability | Gửi ngoài cửa sổ 24h | ❌ Không standard-send; chỉ gửi nếu eligible/approved mechanism tồn tại, nếu không fallback web + Zalo; đánh dấu unreachable-24h |
| 5 | Data Integrity | PSID cùng người khác Page | Page-scoped — 2 PSID; link về cùng Person qua DD-33/OTP, không auto-merge chéo |
| 5b | Data Integrity | Hash va chạm xuyên Page (unique `(platform,hash)`) | `platform_user_lookup_hash = keyed(page_id\|\|':'\|\|PSID)` — page_id trong hash để PSID trùng ở 2 Page không đụng unique / không gán nhầm identity xuyên tenant |
| 6 | Concurrency | Number/quick-reply reply last slot | Shared service locks session: first active, second waitlisted/no-charge/no-venue |
| 7 | Security | Page token / app secret trong log | ❌ NEVER — KMS enc, log redaction |
| 8 | Resilience | Provider rate-limit/outage | Backoff — không rollback canonical |
| 9 | Security | Cross-tenant reachability | Scoped per (person, tenant, platform='messenger') |
| 10 | Data Integrity | Stale quick-reply payload | Reject — "Danh sách đã thay đổi" |
| 11 | Cross-Feature | Account merge invalidates PSID context | Invalidate old context → merged person |
| 12 | Onboarding | Page chưa qua App Review | Degrade — kênh join hạn chế; nhắc qua web + Zalo |
| 13 | Financial | Existing player `left` join lại | Render `REJOIN_REQUIRES_REVIEW`; adapter không tự đổi player/charge/ledger |

---

## 3. API Contract

### Messenger Adapter (webhook + send)

| Interface | Auth | Mô tả |
|-----------|------|-------|
| `GET /webhook/messenger` | Public (verify_token) | Meta webhook verification handshake |
| `POST /webhook/messenger` | Signed (app secret) | Inbound events → route `page_id → tenant` |
| Quick-reply: Join | Player DM | Validate → join domain service (shared) |
| Persistent menu: `/me` `/pay` | Player DM | Personal summary / payment instructions |
| Send API (outbound) | System | Gửi trong 24h window; ngoài 24h → skip |

### Join/Error Responses (Messenger DM)

| Situation | Response |
|-----------|----------|
| Not linked | "❌ Trang chưa liên kết club" |
| Active | "✅ Đã tham gia! [venue]" |
| Waitlisted | "⏳ Bạn đang ở vị trí N" (không venue/QR) |
| Already active/waitlisted | Render current state idempotently; không đổi rank/charge |
| Rejoin after `left` | "⚠️ Cần host kiểm tra lần tham gia trước" |
| Session closed | "❌ Buổi chơi đã kết thúc" |
| Stale quick-reply | "Danh sách đã thay đổi, gõ menu để xem lại" |

### Rate Limits

| Endpoint | Limit |
|----------|-------|
| `POST /webhook/messenger` | Edge per-page/IP burst cap + body-size cap (deployment-infra §6); verify trước xử |

---

## 4. Chi tiết triển khai

### Routing + PSID

```text
1. Verify X-Hub-Signature-256 (app secret per-page)
2. page_id → messenger_pages(active) → tenant_id
3. PSID (page-scoped) → keyed lookup hash → channel_identities(platform='messenger')
   - absent → create Person + ChannelIdentity idempotently (join/approved action mới tạo membership)
4. Set/refresh channel_reachability: can_dm=true, last_inbound_at=now, window_expires_at=now+24h
5. → Domain service (same as web/Zalo)
```

### 24h Window Handling

- Mọi outbound (join xác nhận, nhắc, settled confirm) kiểm `window_expires_at > now()`.
- Trong 24h → gửi; ngoài 24h → **skip Messenger**, để notifications dispatcher dồn **web + Zalo** (`feature_notifications_reminders_tech.md`).
- **Nhắc nợ:** Messenger **best-effort trong 24h**; không phải kênh nhắc chính (web + Zalo là chính).

### Join → sync

Join qua quick-reply/persistent menu → domain join service chung → canonical `players`/roster → outbox → project lên **web + public projection**. Adapter render outcome `active|waitlisted|rejoin_review`; không tự re-derive capacity/charge. Idempotent theo command id.

### Account link (DD-33 🟡 phase-1)

FB Login (web-auth `account_identities.platform='facebook'`) và Messenger **PSID** (channel, page-scoped) là **hai subject khác nhau** → gắn về cùng `person` qua **OTP `/link`** hoặc verified signal (không auto-link chéo). Phụ thuộc **App Review / FB Business Verification**; nếu chậm → phễu Facebook tạm dùng OTP thủ công (DD-32). **KHÔNG** đụng core `Person`/`Membership`.

---

## 5. Testing Plan

### Unit Tests

| # | Test | Input | Expected |
|---|------|-------|----------|
| 1 | Webhook routes correct tenant | Valid page_id | Correct tenant |
| 2 | Forged webhook | Bad signature | Rejected |
| 3 | Join quick-reply valid | Correct page/session/actor | Joined |
| 4 | Join wrong page | Page ≠ session tenant | Rejected |
| 5 | Event replay | Same mid | Idempotent |
| 6 | Outbound in 24h | Window open | Sent |
| 7 | Outbound outside 24h | Window expired | Skip Messenger, fallback web/Zalo |
| 8 | PSID page-scoped | Same person, 2 pages | 2 PSID, link via OTP |
| 9 | Stale quick-reply | Expired payload | "Danh sách đã thay đổi" |
| 10 | Reachability isolated | Page A vs B | Independent |
| 11 | Token/secret redaction | Logs | No page token/app secret |
| 12 | Account merge | Old PSID context | Invalidated → merged person |
| 13 | Concurrent final slot | 2 quick-replies | One active+charge; one waitlisted/no-charge with positive position |
| 14 | Rejoin after left | Existing player `left` | Rejoin-review response; player/charge/allocations unchanged |

### Integration Tests

| # | Test | Setup | Expected |
|---|------|-------|----------|
| 1 | Join → web sync | Quick-reply join → check web roster | Roster updated (≤ vài giây) |
| 2 | Two pages isolated | 2 tenants, 2 Pages | Independent routing |
| 3 | 24h window fallback | Trigger reminder outside 24h | Delivered via web + Zalo |
| 4 | App Review degrade | Page pending review | Join hạn chế, nhắc web/Zalo |

---

## 6. Rollout Plan + Changelog

### Rollout

1. FB App + webhook verify handshake; sandbox Page.
2. Submit **App Review** sớm (rủi ro lịch).
3. Page-per-club onboarding (FB Login + chọn Page) — `feature_web_auth_onboarding_tech.md`.
4. Join quick-reply + persistent menu + 24h window send.
5. Settled confirm + best-effort reminder trong 24h; ngoài 24h dồn web/Zalo.
6. (DD-33) Account-link OTP/verified.

### Metrics

- Webhook validity / signature failures
- Join result distribution
- 24h-window send success vs fallback rate
- Reachability changes / App Review status

### Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-07-15 | v0.2 | **DD-45:** thin adapter renders active/waitlisted/current/rejoin-review; final-slot and ledger-unchanged tests; remove "Full" error. |
| 2026-07-10 | v0.1 | Draft khởi tạo (DD-37 ✅ kênh + DD-33 🟡 link): routing `page_id → tenant`, PSID page-scoped identity, standard window 24h (join+confirm, nhắc best-effort 24h; outside-window chỉ khi Meta eligibility/approval cho phép), quick-reply/persistent menu, join→sync web; account-link FB↔PSID qua OTP/verified. Thay `feature_player_telegram_tech.md` (archived). |
