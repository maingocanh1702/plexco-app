# 📘 Messenger Bot — Surface Docs

> **Surface:** Facebook Messenger (via Page)
> **Deployable unit:** `apps/bot/messenger/`
> **API:** Messenger Platform API (Send API + Webhooks)
> **Phase:** **P2.5 — Phase-1 MVP** (DD-37 ✅, thay DD-09; App Review bắt buộc trước GA)
> **Version:** v0.7 · 2026-07-28
> **Refs:** `messenger-channel-design.md` · `../../features/FE/feature_player_messenger.md` · `../../features/FE/feature_channel_booking_funnel.md` · `../../features/FE/feature_notifications_reminders.md`

> **Authority hiện hành:** DD-65..68 ✅ thay topology Page-per-club/player-only cũ: **Page Plexco trung tâm luôn có + Page riêng per-club tuỳ chọn**; cả host và player dùng được trên cả hai. Auth-link Facebook = **DD-33 ✅ (phase-1; App Review pending)**; policy delivery vẫn phải fail-closed.

> **Booking DD-32:** browse session không cần Account link. Final confirm dùng một shared gate: free join; full waitlist; approval pending; paid+qualified link pay-later; paid+unlinked verified pay-now trong hold 15 phút khi capability available.

---

## 1. Vai trò

Messenger là **shared role-aware surface phase-1** cho host và player. Plexco vận hành **một Meta App + một central Page** cho mọi CLB; CLB có Facebook Page có thể nối thêm Page riêng để dùng cùng capability với branding/context của CLB. CLB không có Page dùng central Page, không bị giảm chức năng session cơ bản. **Cần Meta App Review + Business Verification trước GA**.

---

## 2. Ràng buộc phase-1 (phải quản lý, không phải lý do hoãn)

> DD-37 đưa Messenger vào phase-1. Các ràng buộc dưới đây **không còn** là lý do defer — chúng là điều kiện thiết kế phải xử đúng: standard messaging trong cửa sổ 24h, nộp App Review sớm, chỉ dùng cơ chế outside-window khi Meta xác nhận eligibility/approval; nếu không thì fallback **web + Zalo**.

| Ràng buộc | Chi tiết |
|---------|---------|
| **Meta App Review** | Cần submit app review với use case, privacy policy, demo video. Timeline không kiểm soát được; degrade sang transactional one-time `/link` code nếu chậm |
| **24h standard messaging window** | Standard send chỉ dùng trong 24h sau tin nhắn cuối của user. Nhắc nợ scheduled = **best-effort trong 24h**; ngoài đó fallback web + Zalo nếu không có cơ chế Meta đủ điều kiện/được phê duyệt |
| **Outside-window mechanisms** | Không giả định Message Tag/template/subscription nào luôn khả dụng. Adapter phải kiểm tra eligibility + approval theo use case/region và fail-closed sang web + Zalo; xem `messenger-channel-design.md` §2 |
| **PSID per-page** | Mỗi user có PSID khác nhau per Page → identity mapping page-scoped; merge xuyên Page qua verified account identity hoặc transactional `link_code` |
| **Rate limits / policy limits** | Rate limit chính thức phụ thuộc loại message/Page/app tier; **không dùng giả định 200 calls/hour/page**. Rào cản thật là 24h window + App Review |

---

## 3. Architecture (khi implement)

```
mọi CLB              → Plexco central Page ┐
CLB có Page (optional) → own Facebook Page  ├→ cùng Plexco Meta App → cùng domain core
web/Zalo                                    ┘

central Page: không pin tenant; resolve bằng opaque action/public ref/server-side picker
tenant Page: pin default tenant, nhưng target cross-club vẫn resolve từ protected action
```

### Khác biệt key vs TG/Zalo

| Aspect | Messenger |
|--------|----------|
| Identity | PSID là Page-scoped; hai HMAC domain-separated cho `page_id` và PSID, unique `(platform, provider_scope_lookup_hash, platform_user_lookup_hash)` |
| Rich UI | Generic Template, Button Template (giống InlineKeyboard) |
| Consent | User nhắn trước → consent implicit (tương tự Zalo) |
| 24h window | ⚠️ Bot chỉ gửi được trong 24h. Ngoài 24h cần Utility Template/OTN/Human Agent path hợp lệ |
| canDm TTL | `canDm` = true nhưng có **TTL 24h** — khác TG/Zalo (vĩnh viễn) |

---

## 4. Scope khi implement

| Feature | Support? | Ghi chú |
|---------|---------|---------|
| Player browse/book session | ✅ target | Generic Template + opaque postback: list → safe detail → shared final gate; postback không trực tiếp join |
| Player discover cross-club | ✅ | Central = global; tenant Page = local mặc định + “Khám phá tất cả”; target từ opaque action |
| Nhắc nợ | 🟡 Best-effort | Chỉ nếu user nhắn trong 24h gần nhất, hoặc có Utility Template/OTN hợp lệ sau policy spike |
| Xác nhận payment | ✅ | Nếu trong 24h window |
| Host create/manage session | ✅ | Role-aware menu; `/newsession` wizard cơ bản hoàn tất trên cả central/tenant Page; shared `SessionService` |
| Host approvals/status/announce/close | ✅ | Exact capability registry; advanced edit có thể deep-link web |
| Account link | ✅ target | Web-auth/transactional `/link` handoff → exact Page-scoped ChannelIdentity + current Person + verified Account; callback resumes same booking intent |

### 4.1 Policy-Safe Delivery Contract

Messenger adapter bắt buộc gọi `canDeliver()` trước mọi outbound:

```text
canDeliver(channel_identity_id, messenger_page_id) =
  now < endpoint_reachability.window_expires_at
  OR has_valid_one_time_notification_token
  OR operator_initiated_human_agent_path
```

Rules:

- Không gửi scheduled reminder tự động ngoài 24h nếu chưa có approved template/token hợp lệ.
- Payment confirmation là best-effort; nếu blocked thì ghi delivery failure, không rollback payment.
- Reminder copy phải là transactional, không marketing/promo.
- Mọi delivery failure cần phân loại: `window_closed`, `permission_denied`, `rate_limited`, `token_revoked`, `unknown`.
- Messenger **không** là primary reminder channel; **web + Zalo** gánh primary notification (Telegram đã loại — DD-37). Messenger = join + xác nhận + nhắc best-effort trong 24h.
- Một logical notification chỉ chọn **một** Messenger endpoint: tenant Page reachable → central Page reachable → web/Zalo; không gửi trùng cả hai Page.

### 4.2 Friendly booking gate

1. User chọn session và xem time, public area, fee, confirmed count, slots.
2. User bấm “Đăng ký”; bot không hỏi link trước bước này.
3. Free/full/approval đi thẳng outcome tương ứng, không thu tiền sớm.
4. Paid + linked: “Giữ chỗ, thanh toán sau”.
5. Paid + unlinked: “Liên kết Plexco” hoặc “Thanh toán & giữ chỗ 15 phút” khi verified settlement available.
6. QR/“Tôi đã thanh toán” chỉ là display/poll; canonical provider evidence mới được finalizer chấp nhận.

---

## 5. Risk & Decisions

| # | Item | Status |
|---|------|--------|
| OD-9 | Có làm Messenger không? | ✅ **Có — kênh phase-1 (DD-37, thay DD-09)** |
| R1 | Meta App Review reject/chậm | Prepare + nộp sớm; degrade → transactional one-time `/link` code (DD-33/DD-50) |
| R2 | 24h window = nhắc nợ unreliable | Accept: Messenger là kênh join + xác nhận, **web + Zalo** gánh nhắc chính |
| R3 | PSID mapping per-page | ChannelIdentity pipeline handle; merge xuyên Page qua verified identity/transactional `link_code` |
| R4 | Central Page không pin tenant | Signed/opaque action hoặc server-side role/membership picker; missing/stale/ambiguous → deny/re-pick, không đoán |

### 5.1 Required Policy Evidence Before GA Enablement

Có thể build/test sau khi code-readiness gate pass, nhưng không enable non-test/GA Messenger capability trước khi evidence dưới đây được xác minh:

| Check | Output cần có |
|-------|---------------|
| App Review requirements | List permissions, demo script, privacy policy requirements |
| Utility Templates availability in VN | Có/không, category phù hợp reminder/payment confirmation |
| One-Time Notification availability | Có/không, opt-in UX hợp lệ |
| Human Agent path | Có/không, operator UX và audit requirement |
| Current Send API rate limit | Quote từ Meta docs theo message type/Page/app tier |
| Test Page sandbox | Webhook verify + sample postback + sample send |

Nếu spike fail cho scheduled reminders, Messenger vẫn có thể ship như **join + same-day confirmation** only.

## 6. Implementation Evidence Inventory

| Hạng mục | Status | Ghi chú |
|----------|--------|---------|
| Architecture fit | ✅ Contract chốt | Hybrid registry + protected resolver + one shared adapter + DD-32 channel-booking core |
| Product reliability | 🔴 Low for reminders | 24h window làm nhắc nợ ngoài 24h không đáng tin → web + Zalo gánh nhắc chính |
| Docs | 🟢 Reviewed contracts | DD-32/DD-33/DD-65..68 Product/BE specs; không phải runtime hoặc `CODE_READY` proof |
| Missing runtime dependencies | 🔴 Required | Session/Join/Identity/Payment/funnel core, intent + hybrid registry/page-scoped reachability migrations, Messenger adapter/projector |
| External enablement | 🟡 Pending | App Review + Business Verification + policy evidence; gate non-test GA, không thay code-readiness gate |

**Go/no-go:** Messenger **trong phase-1 (DD-37 ✅)**. Bắt đầu **App Review + Business Verification ngay** (critical path duy nhất). Ship như **join + xác nhận trong 24h** trước; nhắc ngoài 24h dồn qua **web + Zalo** (Messenger best-effort trong 24h). Không hứa nhắc tự động vô hạn.

---

## 7. Cross-references

| Topic | Doc |
|-------|-----|
| Messenger channel design | [messenger-channel-design.md](messenger-channel-design.md) |
| Player join qua Messenger | [feature_player_messenger.md](../../features/FE/feature_player_messenger.md) |
| Notifications (24h window) | [feature_notifications_reminders.md](../../features/FE/feature_notifications_reminders.md) |
| Identity + Facebook link (DD-33) | [feature_identity.md](../../features/FE/feature_identity.md) |
| Link-or-pay booking funnel (DD-32) | [feature_channel_booking_funnel.md](../../features/FE/feature_channel_booking_funnel.md) |

---

## 8. Changelog

| Date | Version | Thay đổi |
|------|---------|----------|
| 2026-07-28 | v0.7 | Add DD-32 friendly list→detail→final gate and link-or-verified-pay branches; Messenger remains a thin renderer and runtime is still not started. |
| 2026-07-17 | v0.6 | Reconcile shared endpoint contract: hai HMAC domain-separated, unique ba phần; App Secret deployment-level và Page access token protected per Page. Runtime vẫn chưa implement. |
| 2026-07-17 | v0.5 | **DD-65..68:** central Plexco Page + optional Page per-club; host/player parity trên cả hai; protected tenant/action resolver, Page-scoped identity/reachability, one-route delivery và create-session wizard shared core. Runtime vẫn chưa implement. |
| 2026-07-15 | v0.4 | **Version/index reconcile:** đồng bộ header về v0.4 khớp README surface index; Messenger giữ **P2.5 phase-1** (DD-37); không đổi nội dung kỹ thuật. |
| 2026-07-10 | v0.3 | **Promote phase-1 (DD-37 ✅, thay DD-09):** P4.8/post-MVP → **P2.5 phase-1**. Reframe §2 (blockers → ràng buộc phải quản lý), OD-9 ✅, host-command bỏ TG, reminder chính = web + Zalo, readiness/go-no-go phase-1. Facebook auth-link = DD-33. Giữ nguyên ràng buộc 24h/App Review/Message Tags/Page per-club. |
| 2026-06-20 | v0.2 | Sửa rate-limit assumption, thêm policy-safe delivery contract, required policy spike, readiness |
| 2026-06-19 | v0.1 | Initial surface docs |

*Messenger bot surface docs v0.7. **Phase-1 (DD-32/DD-37/DD-65..68)** — hybrid shared surface cho host/player; nhắc chính qua web + Zalo; App Review là critical path.*
