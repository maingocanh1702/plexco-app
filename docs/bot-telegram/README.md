# 🤖 Telegram Bot — Surface Docs

> **Surface:** Telegram group + DM
> **Deployable unit:** `apps/bot/telegram/`
> **Framework:** grammY (TypeScript)
> **Phase:** P2 (tenant middleware) → P4.5 (player join)
> **Version:** v0.2 · 2026-06-20
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

### 3.1 Delivery Mode

**MVP dùng webhook**, không long polling:

| Env | Giá trị | Ghi chú |
|-----|---------|---------|
| `TELEGRAM_WEBHOOK_SECRET` | random 32+ bytes | Dùng trong path `/webhook/telegram/:secret` |
| `TELEGRAM_BOT_TOKEN_ENC` | KMS encrypted | Không log raw token |
| `TELEGRAM_ALLOWED_UPDATES` | `message,callback_query,my_chat_member` | Giảm noise và surface attack |

Local/dev có thể bật long polling qua flag riêng, nhưng production dùng webhook để thống nhất với Zalo/Messenger/payment webhooks.

### 3.2 Callback Data Contract

Callback data phải ngắn, opaque và luôn validate lại từ DB:

```text
join:<sessionPublicRef>:<nonce>
leave:<sessionPublicRef>:<nonce>
ctx:<tenantSlugOrRef>:<nonce>
```

Rules:

- `sessionPublicRef` không được là raw sequential DB id nếu có nguy cơ enumerate.
- `nonce` map tới `surface_refs`/`callback_nonces`, TTL ngắn, single-use nếu action nhạy cảm.
- Callback chỉ là hint; xử lý bắt buộc reload canonical session + tenant + actor từ DB.
- Duplicate callback/update trả cùng semantic result, không tạo roster duplicate.

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

### 4.1 Message Templates

Các template bắt buộc tách theo privacy level:

| Template | Surface | Được hiển thị | Không được hiển thị |
|----------|---------|---------------|---------------------|
| Group roster | TG group | Tên hiển thị, slot, trạng thái tham gia, icon paid tùy club policy | Số tiền nợ từng người, STK, PII |
| Player reminder | TG DM | Club, session, số tiền của chính player, QR/memo | Người khác nợ gì |
| Paid confirmation | TG DM | Khoản của chính player đã được ghi nhận | Sao kê/raw transaction |
| Host admin | TG DM/group admin | Unmatched, payment action summary | Secret/token/raw provider payload |

Default group policy: **không show số tiền nợ cá nhân trong group**; chỉ DM player hoặc host dashboard.

---

## 5. Security

- Bot token = KMS encrypted at-rest, không log (BL-SEC-1)
- Webhook: secret path `/telegram/<secret>` (AUDIT B3)
- `from.id` verify là admin → `membership.role` check trong DB (không từ cache)
- Group commands: validate `chat_id` ∈ `tenants` trước khi xử lý
- Callback data: validate session/player belong to tenant

## 6. Implementation Readiness

| Hạng mục | Status | Ghi chú |
|----------|--------|---------|
| Product/UX spec | ✅ Reviewed | `feature_player_telegram.md` |
| BE tech spec | ✅ Reviewed | Callback validation + 20 tests |
| Existing reference | ✅ Strong | Bestminton Telegram bot có production flow |
| Missing before coding | 🟡 Minor | Final DB table names, exact callback nonce table, message copy |
| Delivery readiness | 🟡 Medium | Bắt đầu sau P0–P3: tenant/RLS/session/payment foundation |

**Go/no-go:** Telegram là surface bot đầu tiên nên làm. Không cần chờ web UI hoàn thiện, nhưng phải có tenant routing, domain services, outbox và payment ledger tối thiểu.

---

## 7. Cross-references

| Topic | Doc |
|-------|-----|
| Tenant routing + authz | [feature_tenant_routing_authz.md](../features/feature_tenant_routing_authz.md) |
| Player join TG | [feature_player_telegram.md](../features/feature_player_telegram.md) |
| Session management | [feature_session_management.md](../features/feature_session_management.md) |
| Notifications | [feature_notifications_reminders.md](../features/feature_notifications_reminders.md) |
| Identity merge (/link) | [feature_identity.md](../features/feature_identity.md) |

---

## 8. Changelog

| Date | Version | Thay đổi |
|------|---------|----------|
| 2026-06-20 | v0.2 | Chốt production webhook, thêm callback contract, privacy templates, readiness checklist |
| 2026-06-19 | v0.1 | Initial surface docs |

*Telegram bot surface docs v0.2.*
