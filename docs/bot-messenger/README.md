# 📘 Messenger Bot — Surface Docs

> **Surface:** Facebook Messenger (via Page)
> **Deployable unit:** `apps/bot/messenger/`
> **API:** Messenger Platform API (Send API + Webhooks)
> **Phase:** P4.8 — **Post-MVP** (phụ thuộc Meta App Review)
> **Version:** v0.1 · 2026-06-19
> **Refs:** `../appendices/messenger-channel-design.md` · `../features/feature_notifications_reminders.md`

---

## 1. Vai trò

Messenger là **surface post-MVP** cho player — tương tự Zalo (DM-only). Mỗi CLB tạo Facebook Page → connect Plexco app. **Bị chặn bởi Meta App Review** — không thể launch sớm.

---

## 2. Tại sao Post-MVP?

| Blocker | Chi tiết |
|---------|---------|
| **Meta App Review** | Cần submit app review với use case, privacy policy, demo video. Timeline không kiểm soát được |
| **24h messaging window** | Bot chỉ reply được trong 24h sau tin nhắn cuối của user. Sau 24h = BLOCKED. Nhắc nợ scheduled = **không đảm bảo** |
| **PSID per-page** | Mỗi user có PSID khác nhau per Page → identity mapping phức tạp hơn |
| **Rate limits** | Messenger API rate limit 200 calls/hour per page (thấp hơn TG/Zalo nhiều) |

---

## 3. Architecture (khi implement)

```
CLB Bestminton → Facebook Page "Bestminton Club" → Plexco App
CLB Pickle HCM → Facebook Page "Pickle Saigon"  → Plexco App

Mỗi Page = 1 tenant (BYO tương tự Zalo)
Tenant route: page_id → tenants.messenger_page_id
```

### Khác biệt key vs TG/Zalo

| Aspect | Messenger |
|--------|----------|
| Identity | PSID (Page-Scoped User ID) — khác per Page → `ChannelIdentity.platform_user_id` = PSID |
| Rich UI | Generic Template, Button Template (giống InlineKeyboard) |
| Consent | User nhắn trước → consent implicit (tương tự Zalo) |
| 24h window | ⚠️ Bot chỉ gửi được trong 24h. Cần Message Tags (approved) cho notifications |
| canDm TTL | `canDm` = true nhưng có **TTL 24h** — khác TG/Zalo (vĩnh viễn) |

---

## 4. Scope khi implement

| Feature | Support? | Ghi chú |
|---------|---------|---------|
| Player join session | ✅ | Generic Template + Postback button |
| Nhắc nợ | 🟡 Best-effort | Chỉ nếu user nhắn trong 24h gần nhất. Dùng `CONFIRMED_EVENT_UPDATE` Message Tag nếu được approve |
| Xác nhận payment | ✅ | Nếu trong 24h window |
| Host commands | ❌ | Host dùng TG hoặc web — Messenger = player-only surface |
| Identity merge | ✅ | `/link` → OTP → merge ChannelIdentity(messenger) vào Person |

---

## 5. Risk & Decisions

| # | Item | Status |
|---|------|--------|
| OD-9 | Có làm Messenger không? | ⬜ Chốt sau P4 — nếu có demand |
| R1 | Meta App Review reject | Prepare trước: privacy policy, demo video, use case doc |
| R2 | 24h window = nhắc nợ unreliable | Accept: Messenger là bonus channel, không primary |
| R3 | PSID mapping per-page | ChannelIdentity pipeline handle (UNIQUE platform_user_id) |

---

## 6. Cross-references

| Topic | Doc |
|-------|-----|
| Messenger channel design | [messenger-channel-design.md](../appendices/messenger-channel-design.md) |
| Notifications (24h window) | [feature_notifications_reminders.md](../features/feature_notifications_reminders.md) |
| Identity | [feature_identity.md](../features/feature_identity.md) |

---

*Messenger bot surface docs v0.1. Post-MVP — chỉ implement nếu demand validate sau P4.*
