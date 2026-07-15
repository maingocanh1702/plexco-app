# 💬 Zalo Bot — Surface Docs

> **Surface:** Zalo Official Account (OA) — DM only
> **Deployable unit:** `apps/bot/zalo/`
> **API:** Zalo OA API v3 (HTTP REST, không SDK)
> **Phase:** **P2 — Phase-1 MVP** (DD-37 ✅; player join + notifications)
> **Version:** v0.4 · 2026-07-10
> **Refs:** `../../features/feature_zalo_channel.md` · `../../features/BE/feature_zalo_channel_tech.md` · `../../research/player-side-saas-AUDIT.md` §B2

> **Cập nhật v3.4 (DD-37 ✅, thay DD-09):** Zalo là **kênh phase-1** cùng web + Facebook Messenger; **Telegram đã bị loại khỏi phạm vi**. Zalo DM là **kênh nhắc nợ chính** (cùng web push); Messenger chỉ best-effort trong cửa sổ 24h. Bảng "Khác biệt vs Telegram" bên dưới giữ làm **design rationale** — không hàm ý Telegram còn trong scope.

---

## 1. Vai trò

Zalo bot là **surface DM-only cho player** trong thị trường Việt Nam. Mỗi CLB **BYO bot-token** (tự tạo Zalo OA + dán token vào Plexco dashboard). **Không** có group chat — chỉ 1:1 DM.

```
CLB Bestminton → Zalo OA "Bestminton Club" → token_A → Plexco
CLB Pickle HCM → Zalo OA "Pickle Saigon"  → token_B → Plexco

Player Minh DM bot Bestminton → tenant route bằng bot webhook token
```

---

## 2. Khác biệt vs Telegram

| Aspect | Telegram | Zalo |
|--------|---------|------|
| Bot deployment | 1 shared bot | **BYO per-club** |
| Group support | ✅ Group + DM | ❌ **DM only** |
| Tenant routing | `chat_id` → tenant | `webhook_token` → tenant |
| Rich UI | InlineKeyboard, callback | **Text reply + number-based menu** |
| Player consent | Implicit (join group) | Player phải **nhắn trước** → consent implicit |
| canDm | Global (1 bot) | **Per-tenant** (AUDIT C1) |
| Token scope | 1 token = mọi tenant | 1 token = 1 tenant |
| Token leak impact | 🔴 All tenants messaging | 🟡 1 tenant messaging |

---

## 3. Interaction Pattern

Zalo không có InlineKeyboard → dùng **number-reply menu**:

```
Bot: Chào Minh! Chọn:
  1. Xem kèo sắp tới
  2. Xem nợ
  3. Liên kết tài khoản

Player: 1

Bot: 📋 Kèo sắp tới:
  🏸 Thứ 5, 19:00 — CLB Bestminton
  Giá: 80,000₫ · Còn 3 slot
  
  Trả lời SỐ để tham gia:
  1. Tham gia kèo này
  0. Quay lại

Player: 1

Bot: ✅ Đã tham gia! Bạn sẽ nhận nhắc thanh toán trước buổi chơi.
```

---

## 4. Reply-context

Zalo DM là stateless (không có callback data như TG). Plexco dùng **reply-context** server-side:

```
reply_contexts table:
  zalo_user_id + tenant_id → { expected_action, session_id, expires_at }

Player gửi "1" → lookup reply_context → resolve action
Context expires sau 10 phút → gửi lại sẽ bị reset menu
```

### 4.1 Number Reply Contract

Number reply chỉ hợp lệ khi có context active:

```text
context_key = person_id + tenant_id + bot_id + context_type
context_payload = {
  list_version,
  item_ids: [session_id...],
  expires_at,
  consumed_at
}
```

Rules:

- Một số tự do như `"1"` không bao giờ mutate nếu không có context active.
- Context hết hạn/đã consumed/list version lệch → yêu cầu player gõ lại `/join`.
- Join vẫn phải transactionally recheck `session.status`, `slots_open`, membership và `join_policy`.
- Reply `"0"` chỉ quay lại menu, không mutate.
- Mọi mutation dùng command id deterministic từ provider event id + context id để chống replay.

---

## 5. ChannelReachability (AUDIT C1)

```
ChannelReachability:
  personId + tenantId + platform='zalo'
  canDm: true/false
  lastInboundAt: timestamp

Zalo: canDm=true CHỈ KHI player đã DM bot CỦA CLUB ĐÓ
  → Minh DM bot CLB A: canDm(Minh, A, zalo) = true
  → Minh CHƯA DM bot CLB B: canDm(Minh, B, zalo) = false
  → Gửi DM CLB B cho Minh = FAIL (Zalo policy)
```

---

## 6. Webhook

```
POST /webhook/zalo/:token
  → token → zalo_bots.webhook_token → tenant_id
  → Verify X-Bot-Api-Secret-Token (timing-safe)
  → Route tenant
  → Handle event:
       user_send_text → parse reply-context / menu
       user_send_image → unsupported → fallback message
       follow / unfollow → update ChannelReachability
```

`zalo_bots` là source of truth duy nhất cho Zalo tenant routing. Không reuse `bank_accounts` token để tránh coupling giữa kênh chat và kênh tiền.

### 6.1 Event Contract

| Zalo event | Plexco action | Notes |
|------------|---------------|-------|
| `user_send_text` | Parse command hoặc reply-context | Unknown command → help menu |
| `user_send_image` | Safe fallback | Không xử lý ảnh trong MVP Zalo |
| `message.unsupported.received` | Owner digest + player fallback | Không expose lỗi kỹ thuật |
| `follow` / first inbound | `ChannelReachability.canDm=true` | Per `(person, tenant, zalo)` |
| `unfollow` / send failure | `canDm=false` | Không retry vô hạn |

Provider event id phải được dedupe trước khi gọi domain service.

---

## 7. Security (AUDIT §B2)

- Token **BYO per-club** → lộ = chỉ ảnh hưởng **1 CLB messaging**
- Token **không hết hạn** → rotation = owner reset trong Zalo Bot Creator + dán lại
- **Webhook drift detection**: cron gọi `getWebhookInfo` → so URL → lệch = alert + auto-reset
- **QR giả risk**: attacker có token → sendMessage giả STK → player CK nhầm
- Mitigation: STK cố định trong hệ thống; educate player "STK không đổi qua tin nhắn"
- `message.unsupported.received` → fallback owner xử tay (AUDIT B6)

### 7.1 Token Rotation Runbook

1. Owner dán token mới trong web onboarding/settings.
2. Backend encrypt token mới vào pending secret/version, set `zalo_bots.rotation_pending=true`, **giữ `zalo_bots.status='active'` và token cũ vẫn phục vụ tenant**.
3. Verify token mới bằng test API call + set webhook URL.
4. Nếu verify OK → promote pending secret thành `bot_token_enc`, set `rotation_pending=false`, status vẫn `active`; revoke/disable old token nếu provider hỗ trợ.
5. Nếu fail → discard pending secret, set `rotation_pending=false`, giữ token cũ active, lưu redacted error code, không làm gián đoạn tenant.

## 8. Implementation Readiness

| Hạng mục | Status | Ghi chú |
|----------|--------|---------|
| Product/UX spec | ✅ Reviewed | `feature_zalo_channel.md` |
| BE tech spec | ✅ Reviewed | Có DDL `zalo_bots`, `zalo_reply_contexts` |
| Existing reference | ✅ Strong | Bestminton có Zalo transport production-ish cùng TG |
| Missing before coding | 🟡 Minor/Medium | Confirm exact Zalo event names/payloads với sandbox, rate limits, token verify behavior |
| Delivery readiness | 🟡 Medium | **Kênh chat đầu tiên của phase-1 (P2)** — làm sau P0–P1 foundation + onboarding token connect (Telegram đã loại — DD-37) |

**Go/no-go:** Zalo đủ khả thi cho MVP Việt Nam và là **kênh nhắc nợ chính** (cùng web push). Bắt buộc giữ DM-only, number-reply TTL, token drift và `ChannelReachability` per tenant.

---

## 9. Cross-references

| Topic | Doc |
|-------|-----|
| Zalo channel spec | [feature_zalo_channel.md](../../features/feature_zalo_channel.md) |
| Zalo BE tech | [feature_zalo_channel_tech.md](../../features/BE/feature_zalo_channel_tech.md) |
| Token leak threat | [AUDIT.md §B2](../../research/player-side-saas-AUDIT.md) |
| ChannelReachability | [feature_identity.md](../../features/feature_identity.md) |

---

## 10. Changelog

| Date | Version | Thay đổi |
|------|---------|----------|
| 2026-07-10 | v0.4 | **Phase-1 pivot (DD-37 ✅):** Zalo nay là kênh phase-1 (P2) + **kênh nhắc nợ chính** (cùng web push); Telegram loại khỏi phạm vi. Cập nhật phase/readiness/go-no-go; bảng "vs Telegram" giữ làm design rationale. |
| 2026-06-20 | v0.3 | Sửa token rotation: dùng `rotation_pending`/pending secret thay vì một lifecycle status ngoài enum |
| 2026-06-20 | v0.2 | Chốt `zalo_bots` làm routing source, thêm number-reply/event contract, token rotation, readiness |
| 2026-06-19 | v0.1 | Initial surface docs |

*Zalo bot surface docs v0.4. Kênh phase-1 (DD-37) — nhắc nợ chính cùng web push.*
