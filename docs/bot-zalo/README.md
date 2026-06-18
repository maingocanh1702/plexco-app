# 💬 Zalo Bot — Surface Docs

> **Surface:** Zalo Official Account (OA) — DM only
> **Deployable unit:** `apps/bot/zalo/`
> **API:** Zalo OA API v3 (HTTP REST, không SDK)
> **Phase:** P4.7 (player join + notifications)
> **Version:** v0.1 · 2026-06-19
> **Refs:** `../features/feature_zalo_channel.md` · `../features/BE/feature_zalo_channel_tech.md` · `../appendices/player-side-saas-AUDIT.md` §B2

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
  → token → bank_accounts (reuse opaque token pattern)
     hoặc dedicated zalo_bots table
  → Verify X-Bot-Api-Secret-Token (timing-safe)
  → Route tenant
  → Handle event:
       user_send_text → parse reply-context / menu
       user_send_image → unsupported → fallback message
       follow / unfollow → update ChannelReachability
```

---

## 7. Security (AUDIT §B2)

- Token **BYO per-club** → lộ = chỉ ảnh hưởng **1 CLB messaging**
- Token **không hết hạn** → rotation = owner reset trong Zalo Bot Creator + dán lại
- **Webhook drift detection**: cron gọi `getWebhookInfo` → so URL → lệch = alert + auto-reset
- **QR giả risk**: attacker có token → sendMessage giả STK → player CK nhầm
  - Mitigation: STK cố định trong hệ thống; educate player "STK không đổi qua tin nhắn"
- `message.unsupported.received` → fallback owner xử tay (AUDIT B6)

---

## 8. Cross-references

| Topic | Doc |
|-------|-----|
| Zalo channel spec | [feature_zalo_channel.md](../features/feature_zalo_channel.md) |
| Zalo BE tech | [feature_zalo_channel_tech.md](../features/BE/feature_zalo_channel_tech.md) |
| Token leak threat | [AUDIT.md §B2](../appendices/player-side-saas-AUDIT.md) |
| ChannelReachability | [feature_identity.md](../features/feature_identity.md) |

---

*Zalo bot surface docs v0.1.*
