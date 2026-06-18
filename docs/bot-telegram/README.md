# 🤖 Telegram Bot — Surface Docs

> **Surface:** Telegram group + DM
> **Deployable unit:** `apps/bot/telegram/`
> **Framework:** grammY (TypeScript)
> **Phase:** P2 (tenant middleware) → P4.5 (player join)
> **Version:** v0.1 · 2026-06-19
> **Refs:** `../features/feature_tenant_routing_authz.md` · `../features/feature_player_telegram.md` · `../features/feature_session_management.md`

---

## 1. Vai trò

Telegram bot là **surface chính cho host** (quản lý kèo trong group) và **surface join cho player** (tap callback button). 1 shared bot chung mọi tenant — tenant route từ `chat_id`.

```
1 Bot (@PlexcoBot)
  ├── Group A (CLB Bestminton)  → tenant_id = aaa
  │     ├── /newsession         → tạo kèo trong group context
  │     ├── InlineKeyboard      → player tap "Tham gia"
  │     └── Auto-post roster    → projector cập nhật khi state đổi
  │
  ├── Group B (CLB Pickle HCM)  → tenant_id = bbb
  │     └── ... (isolated by RLS)
  │
  └── DM
        ├── Player nhận nhắc nợ
        ├── Player nhận xác nhận đã trả
        └── /link (merge identity)
```

---

## 2. Bot Commands

### Host commands (group context, TenantAdmin)

| Command | Mô tả | Phase |
|---------|-------|-------|
| `/newsession` | Tạo kèo mới (chọn môn, giờ, giá, slot) | P2 |
| `/announce` | Gửi thông báo tới group | P2 |
| `/config` | Cấu hình club (tên, giá mặc định, môn) | P2 |
| `/cash` | Ghi nhận tiền mặt cho player | P3 |
| `/unmatched` | Xem CK chưa khớp | P3 |

### Player interactions (group context)

| Action | Cách | Phase |
|--------|------|-------|
| Join session | Tap InlineKeyboard button "Tham gia" | P4.5 |
| Leave session | Tap "Rời kèo" hoặc `/leave` | P4.5 |
| View session | Xem tin nhắn bot (roster + status) | P2 |

### Player interactions (DM context)

| Action | Cách | Phase |
|--------|------|-------|
| Nhận nhắc nợ | Auto DM từ reminder cron | P4.5 |
| Nhận xác nhận | Auto DM khi payment.settled | P4.5 |
| `/link` | Sinh mã OTP để merge identity | P3.5 |
| `/me` | Xem nợ tổng các CLB | P4.5 |

---

## 3. Tenant Routing

```
Inbound update
  → is group? → chat_id → tenants.telegram_group_id → tenant_id
  → is DM?    → from.id → player_chat_context → tenant_id (sticky)
                         → nếu multi-club → picker InlineKeyboard
  → SET LOCAL app.tenant_id → RLS active
```

DM sticky context: validate `membership` trước khi dùng. Nếu không còn membership → bỏ context, hiện picker. (AUDIT B1)

---

## 4. Projector

TG Projector nhận outbox events → edit/send messages trong group:

| Event | Action |
|-------|--------|
| `session.created` | Post new message: roster + VietQR + InlineKeyboard |
| `session.updated` | Edit existing message: updated roster |
| `player.joined` | Edit message: add player to roster |
| `player.left` | Edit message: remove player |
| `payment.settled` | Edit message: ✅ mark next to player name |
| `reminder.sent` | DM player: nhắc nợ |

Message ID lưu trong `surface_projections` để edit đúng message.

---

## 5. Security

- Bot token = KMS encrypted at-rest, không log (BL-SEC-1)
- Webhook: secret path `/telegram/<secret>` (AUDIT B3)
- `from.id` verify là admin → `membership.role` check trong DB (không từ cache)
- Group commands: validate `chat_id` ∈ `tenants` trước khi xử lý
- Callback data: validate session/player belong to tenant

---

## 6. Cross-references

| Topic | Doc |
|-------|-----|
| Tenant routing + authz | [feature_tenant_routing_authz.md](../features/feature_tenant_routing_authz.md) |
| Player join TG | [feature_player_telegram.md](../features/feature_player_telegram.md) |
| Session management | [feature_session_management.md](../features/feature_session_management.md) |
| Notifications | [feature_notifications_reminders.md](../features/feature_notifications_reminders.md) |
| Identity merge (/link) | [feature_identity.md](../features/feature_identity.md) |

---

*Telegram bot surface docs v0.1.*
