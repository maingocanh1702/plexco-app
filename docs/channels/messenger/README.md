# 📘 Messenger Bot — Surface Docs

> **Surface:** Facebook Messenger (via Page)
> **Deployable unit:** `apps/bot/messenger/`
> **API:** Messenger Platform API (Send API + Webhooks)
> **Phase:** **P2.5 — Phase-1 MVP** (DD-37 ✅, thay DD-09; App Review bắt buộc trước GA)
> **Version:** v0.4 · 2026-07-15
> **Refs:** `messenger-channel-design.md` · `../../features/feature_player_messenger.md` · `../../features/feature_notifications_reminders.md`

> **Cập nhật v3.4 (DD-37 ✅):** Messenger nay là **kênh phase-1** (cùng web + Zalo); Telegram đã bị loại. Auth-link Facebook = **DD-33 🟡** (phase-1, phụ thuộc App Review). Ràng buộc chính sách bên dưới **giữ nguyên** — chúng là điều kiện thiết kế, không phải lý do hoãn.

---

## 1. Vai trò

Messenger là **surface phase-1** cho player — tương tự Zalo (DM-only). Mỗi CLB tạo Facebook Page → connect Plexco app (**1 FB App của platform, Page per-club**). **Cần Meta App Review + Business Verification trước GA** — nộp **sớm** vì đây là đường tới hạn (critical path) của lịch phase-1.

---

## 2. Ràng buộc phase-1 (phải quản lý, không phải lý do hoãn)

> DD-37 đưa Messenger vào phase-1. Các ràng buộc dưới đây **không còn** là lý do defer — chúng là điều kiện thiết kế phải xử đúng: standard messaging trong cửa sổ 24h, nộp App Review sớm, chỉ dùng cơ chế outside-window khi Meta xác nhận eligibility/approval; nếu không thì fallback **web + Zalo**.

| Ràng buộc | Chi tiết |
|---------|---------|
| **Meta App Review** | Cần submit app review với use case, privacy policy, demo video. Timeline không kiểm soát được → **rủi ro lịch phase-1** (§13 BRD Risks); degrade sang OTP `/link` thủ công nếu chậm |
| **24h standard messaging window** | Standard send chỉ dùng trong 24h sau tin nhắn cuối của user. Nhắc nợ scheduled = **best-effort trong 24h**; ngoài đó fallback web + Zalo nếu không có cơ chế Meta đủ điều kiện/được phê duyệt |
| **Outside-window mechanisms** | Không giả định Message Tag/template/subscription nào luôn khả dụng. Adapter phải kiểm tra eligibility + approval theo use case/region và fail-closed sang web + Zalo; xem `messenger-channel-design.md` §2 |
| **PSID per-page** | Mỗi user có PSID khác nhau per Page → identity mapping page-scoped (buộc vào tenant); merge xuyên Page qua OTP `/link` |
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
| Host commands | ❌ | Host dùng web — Messenger = player-only surface |
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
- Messenger **không** là primary reminder channel; **web + Zalo** gánh primary notification (Telegram đã loại — DD-37). Messenger = join + xác nhận + nhắc best-effort trong 24h.

---

## 5. Risk & Decisions

| # | Item | Status |
|---|------|--------|
| OD-9 | Có làm Messenger không? | ✅ **Có — kênh phase-1 (DD-37, thay DD-09)** |
| R1 | Meta App Review reject/chậm | Prepare + nộp sớm: privacy policy, demo video, use case doc; degrade → OTP `/link` thủ công (DD-33) |
| R2 | 24h window = nhắc nợ unreliable | Accept: Messenger là kênh join + xác nhận, **web + Zalo** gánh nhắc chính |
| R3 | PSID mapping per-page | ChannelIdentity pipeline handle (UNIQUE platform_user_id); merge xuyên Page qua OTP `/link` |

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
| Product reliability | 🔴 Low for reminders | 24h window làm nhắc nợ ngoài 24h không đáng tin → web + Zalo gánh nhắc chính |
| Docs | 🟡 Medium | Appendix đủ sâu, README đã thêm policy contract; player-flow ở `feature_player_messenger` (Draft) |
| Missing before coding | 🔴 Required | Policy spike + App Review + Business Verification (bắt đầu ngay) |
| Delivery readiness | 🟡 Medium | **Phase-1 (P2.5)**; đường tới hạn = App Review + Business Verification |

**Go/no-go:** Messenger **trong phase-1 (DD-37 ✅)**. Bắt đầu **App Review + Business Verification ngay** (critical path duy nhất). Ship như **join + xác nhận trong 24h** trước; nhắc ngoài 24h dồn qua **web + Zalo** (Messenger best-effort trong 24h). Không hứa nhắc tự động vô hạn.

---

## 7. Cross-references

| Topic | Doc |
|-------|-----|
| Messenger channel design | [messenger-channel-design.md](messenger-channel-design.md) |
| Player join qua Messenger | [feature_player_messenger.md](../../features/feature_player_messenger.md) |
| Notifications (24h window) | [feature_notifications_reminders.md](../../features/feature_notifications_reminders.md) |
| Identity + Facebook link (DD-33) | [feature_identity.md](../../features/feature_identity.md) |

---

## 8. Changelog

| Date | Version | Thay đổi |
|------|---------|----------|
| 2026-07-15 | v0.4 | **Version/index reconcile:** đồng bộ header về v0.4 khớp README surface index; Messenger giữ **P2.5 phase-1** (DD-37); không đổi nội dung kỹ thuật. |
| 2026-07-10 | v0.3 | **Promote phase-1 (DD-37 ✅, thay DD-09):** P4.8/post-MVP → **P2.5 phase-1**. Reframe §2 (blockers → ràng buộc phải quản lý), OD-9 ✅, host-command bỏ TG, reminder chính = web + Zalo, readiness/go-no-go phase-1. Facebook auth-link = DD-33. Giữ nguyên ràng buộc 24h/App Review/Message Tags/Page per-club. |
| 2026-06-20 | v0.2 | Sửa rate-limit assumption, thêm policy-safe delivery contract, required policy spike, readiness |
| 2026-06-19 | v0.1 | Initial surface docs |

*Messenger bot surface docs v0.4. **Phase-1 (DD-37)** — join + xác nhận trong 24h; nhắc chính qua web + Zalo; App Review là critical path.*
