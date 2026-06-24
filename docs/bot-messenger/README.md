# 📘 Messenger Bot — Surface Docs

> **Surface:** Facebook Messenger (via Page)
> **Deployable unit:** `apps/bot/messenger/`
> **API:** Messenger Platform API (Send API + Webhooks)
> **Phase:** P4.8 — **Post-MVP** (phụ thuộc Meta App Review)
> **Version:** v0.2 · 2026-06-20
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
| **Rate limits / policy limits** | Rate limit chính thức phụ thuộc loại message/Page/app tier; **không dùng giả định 200 calls/hour/page**. Rào cản thật là 24h window + App Review |

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
| 24h window | ⚠️ Bot chỉ gửi được trong 24h. Ngoài 24h cần Utility Template/OTN/Human Agent path hợp lệ |
| canDm TTL | `canDm` = true nhưng có **TTL 24h** — khác TG/Zalo (vĩnh viễn) |

---

## 4. Scope khi implement

| Feature | Support? | Ghi chú |
|---------|---------|---------|
| Player join session | ✅ | Generic Template + Postback button |
| Nhắc nợ | 🟡 Best-effort | Chỉ nếu user nhắn trong 24h gần nhất, hoặc có Utility Template/OTN hợp lệ sau policy spike |
| Xác nhận payment | ✅ | Nếu trong 24h window |
| Host commands | ❌ | Host dùng TG hoặc web — Messenger = player-only surface |
| Identity merge | ✅ | `/link` → OTP → merge ChannelIdentity(messenger) vào Person |

### 4.1 Policy-Safe Delivery Contract

Messenger adapter bắt buộc gọi `canDeliver()` trước mọi outbound:

```text
canDeliver(person, tenant, "messenger") =
  now < channel_reachability.window_expires_at
  OR has_valid_one_time_notification_token
  OR operator_initiated_human_agent_path
```

Rules:

- Không gửi scheduled reminder tự động ngoài 24h nếu chưa có approved template/token hợp lệ.
- Payment confirmation là best-effort; nếu blocked thì ghi delivery failure, không rollback payment.
- Reminder copy phải là transactional, không marketing/promo.
- Mọi delivery failure cần phân loại: `window_closed`, `permission_denied`, `rate_limited`, `token_revoked`, `unknown`.
- Messenger không là primary reminder channel trong MVP; Telegram/Zalo/web gánh primary notification.

---

## 5. Risk & Decisions

| # | Item | Status |
|---|------|--------|
| OD-9 | Có làm Messenger không? | ⬜ Chốt sau P4 — nếu có demand |
| R1 | Meta App Review reject | Prepare trước: privacy policy, demo video, use case doc |
| R2 | 24h window = nhắc nợ unreliable | Accept: Messenger là bonus channel, không primary |
| R3 | PSID mapping per-page | ChannelIdentity pipeline handle (UNIQUE platform_user_id) |

### 5.1 Required Policy Spike Before Coding

Không bắt đầu implementation Messenger trước khi có kết quả spike:

| Check | Output cần có |
|-------|---------------|
| App Review requirements | List permissions, demo script, privacy policy requirements |
| Utility Templates availability in VN | Có/không, category phù hợp reminder/payment confirmation |
| One-Time Notification availability | Có/không, opt-in UX hợp lệ |
| Human Agent path | Có/không, operator UX và audit requirement |
| Current Send API rate limit | Quote từ Meta docs theo message type/Page/app tier |
| Test Page sandbox | Webhook verify + sample postback + sample send |

Nếu spike fail cho scheduled reminders, Messenger vẫn có thể ship như **join + same-day confirmation** only.

## 6. Implementation Readiness

| Hạng mục | Status | Ghi chú |
|----------|--------|---------|
| Architecture fit | ✅ Good | DM-only adapter giống Zalo, route theo Page |
| Product reliability | 🔴 Low for reminders | 24h window làm nhắc nợ không đáng tin |
| Docs | 🟡 Medium | Appendix đủ sâu, README đã thêm policy contract |
| Missing before coding | 🔴 Required | Policy spike + App Review + Business Verification |
| Delivery readiness | 🔴 Low | Post-MVP, không chặn MVP Telegram/Zalo/web |

**Go/no-go:** Không đưa Messenger vào MVP. Chỉ build nếu sau P4 có demand rõ từ club sống trên Facebook và policy spike cho thấy delivery path hợp lệ.

---

## 7. Cross-references

| Topic | Doc |
|-------|-----|
| Messenger channel design | [messenger-channel-design.md](../appendices/messenger-channel-design.md) |
| Notifications (24h window) | [feature_notifications_reminders.md](../features/feature_notifications_reminders.md) |
| Identity | [feature_identity.md](../features/feature_identity.md) |

---

## 8. Changelog

| Date | Version | Thay đổi |
|------|---------|----------|
| 2026-06-20 | v0.2 | Sửa rate-limit assumption, thêm policy-safe delivery contract, required policy spike, readiness |
| 2026-06-19 | v0.1 | Initial surface docs |

*Messenger bot surface docs v0.2. Post-MVP — chỉ implement nếu demand validate sau P4 và policy spike pass.*
