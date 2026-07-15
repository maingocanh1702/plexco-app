# Phân tích — Thêm Native App (iOS / Android) sau Web MVP

**Phiên bản:** 1.0
**Ngày tạo:** 18/06/2026
**Tài liệu tham chiếu:** `BRD.md` v3.1 · `PRD.md` v2.1 · `TDD.md` v2.1 · `ROADMAP.md` v2.1 · `feature_sync_engine.md` · `feature_marketplace_discovery.md` · `feature_identity.md`

> ⚠️ **Version note (15/07/2026):** companion doc ở baseline **v3.1/v2.1**. Nguồn hiện hành: **BRD v3.5 · PRD v2.4 · TDD v2.4 · ROADMAP v2.7 · `decisions.md` v1.31**; chưa reflect pivot kênh (DD-37) + cụm session-model/social (DD-41–48). Khi conflict, ưu tiên TDD → BRD hiện hành.

> **TL;DR:** Kiến trúc canonical-store + surface-projection của Plexco **đã future-proof cho native app**. Native iOS/Android chỉ là thêm 1 surface — backend API, sync engine, marketplace discovery, identity pipeline **không cần đổi**. Effort chính nằm ở: (1) Native UI, (2) Push Notification projector, (3) Auth providers mở rộng (Apple/Google Sign-In), (4) Offline cache strategy. Không có breaking change.

---

## 1. Context & Timeline

### Lộ trình hiện tại (P0–P6)

```
P0–P1: Foundation + Multi-tenant
P2:    Bot biết tenant + Session
P3:    Payment reconcile
P3.5:  Identity directory
P4:    Web app canonical + Sync engine + Onboarding
P4.3:  Marketplace discovery
P2.5:  Messenger (join+confirm, App Review) · P4.x: Player channels (Zalo/Messenger) — Telegram bỏ (DD-37)
P5:    Billing
P6:    Hardening
```

### Native app = Phase tiếp theo (P7+)

```
P7.0:  Spike — chọn tech (Swift/Kotlin native vs React Native/Flutter)
P7.1:  Core UI (auth, home, discovery, session detail)
P7.2:  Push notification projector + device token management
P7.3:  Host dashboard native
P7.4:  Player flow (join, view, pay)
P7.5:  Offline mode + cache
P7.6:  App Store / Play Store submission
```

> **Vì sao web trước, native sau?**
> - Web = **0 cài đặt** cho player (khám phá + join ngay) — phù hợp marketplace discovery
> - Web = nhanh hơn iterate (deploy instant, không qua App Store review)
> - Native = **trải nghiệm premium** cho host quản lý hằng ngày + push notification cho player
> - Build native khi đã có **API ổn định** + user base validate product

---

## 2. Phân tích ảnh hưởng lên kiến trúc hiện tại

### 2.1 Canonical Store + Outbox — KHÔNG đổi

```
┌─── Surfaces hiện tại ──┐     ┌─── Surfaces thêm sau ──┐
│  Zalo bot               │     │  iOS App               │
│  Messenger (phase-1)    │     │  Android App           │
│  Web app (Next.js)      │     │                        │
│  (Telegram bỏ — DD-37)  │     │                        │
└──────────┬──────────────┘     └──────────┬─────────────┘
           │                               │
           │  command (commandId)          │  command (cùng API)
           │                               │
           ▼                               ▼
┌──────────────────────────────────────────────────────────┐
│              PostgreSQL — CANONICAL STORE                 │
│   sessions · members · charges · bank_transactions       │
│   (tenant-scoped, RLS)                                   │
│                                                          │
│   outbox_events (ghi cùng transaction với mutation)       │
│   public_sessions (marketplace read model)               │
└────────────────────────┬─────────────────────────────────┘
                         │
              dispatcher (pg-boss poll)
                         │
         ┌───────────────┼───────────────────────────┐
         ▼               ▼               ▼           ▼
    Zalo Projector  Msgr Projector  Web Projector  🆕 Push
    (reply)         (24h window)    (SSE)          Projector
                                                   (FCM/APNs)
                         │
                         ▼
                  Public Projector
                  (upsert public_sessions)
```

**Kết luận:** Canonical store, outbox, dispatcher, projector pattern — **không thay đổi**. Native app gửi command qua **cùng REST API** như web app. Thêm 1 Push Projector cho native notifications.

### 2.2 Component-by-component impact analysis

| Component | Hiện tại | Native app thêm gì? | Breaking change? |
|-----------|---------|---------------------|-----------------|
| **REST API** (`apps/web` hoặc `apps/api`) | JSON endpoints cho web | Native gọi **cùng endpoints** | ❌ Không |
| **Sync Engine** (outbox + projector) | Zalo/Messenger/Web projectors | Thêm **Push Projector** (FCM/APNs) | ❌ Không — thêm projector, không sửa cũ |
| **Marketplace Discovery** | `GET /discover` → JSON | Native gọi **cùng API** → render native UI | ❌ Không |
| **Identity pipeline** | Person → ChannelIdentity → Membership | Thêm **ChannelIdentity `platform='ios'/'android'`** hoặc dùng Account auth trực tiếp | ❌ Không — extend, không sửa |
| **Auth** | Telegram Login Widget → Account | Thêm **Apple Sign-In + Google Sign-In** auth providers | 🟡 Extend — thêm fields vào `accounts`, thêm auth strategy |
| **RLS / tenantRepo** | `SET LOCAL app.tenant_id` | Native dùng **cùng API** → cùng RLS path | ❌ Không |
| **public_sessions** (read model) | Field-whitelist, cross-tenant | Native đọc **cùng data** | ❌ Không |
| **Realtime updates** | SSE (Server-Sent Events) | Đổi sang **Push notification** cho native; giữ SSE cho web | 🟡 Thêm channel, không bỏ SSE |
| **Billing** | Web dashboard payment | Có thể thêm In-App Purchase (Apple/Google) | 🟡 Mở rộng nếu cần |

### 2.3 Kết luận impact

```
❌ KHÔNG đổi (90% hệ thống):
   - PostgreSQL schema (trừ thêm device_tokens)
   - tenantRepo / RLS
   - Outbox / dispatcher
   - Existing projectors (Zalo/Messenger/Web)
   - Marketplace Discovery API
   - Identity pipeline (Person/ChannelIdentity/Membership)
   - Payment reconcile logic
   - Business rules

🟡 MỞ RỘNG (10%):
   - Thêm Push Projector
   - Thêm device_tokens table
   - Thêm auth providers (Apple/Google)
   - Thêm ChannelReachability platform values
```

---

## 3. Components mới cần build

### 3.1 Push Notification Projector

**Tại sao không dùng SSE cho native?**
- SSE yêu cầu connection mở liên tục → tốn pin, bị OS kill background
- Push notification (FCM/APNs) = OS-level delivery, hoạt động khi app đóng
- Web giữ SSE (browser support tốt, không cần push permission)

**Schema:**

```sql
-- Device tokens cho push notification
CREATE TABLE device_tokens (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    platform    text NOT NULL CHECK (platform IN ('ios', 'android')),
    token       text NOT NULL,        -- FCM token hoặc APNs device token
    app_version text,                 -- track version để gửi compatible payload
    active      boolean DEFAULT true,
    created_at  timestamptz DEFAULT now(),
    updated_at  timestamptz DEFAULT now(),

    UNIQUE(token)                     -- 1 token = 1 device, không trùng
);
CREATE INDEX idx_device_tokens_account ON device_tokens(account_id, active);
```

> **Lưu ý:** KHÔNG cần `tenant_id` trên `device_tokens` — device thuộc về **Account** (global), không phải tenant. Khi gửi push, projector tra `Account → Person → Membership(tenant) → device_tokens` để chọn đúng devices.

**Projector logic:**

```
outbox_event: { type: "session.created", tenantId, payload }
  │
  Push Projector:
  1. Lấy membership[] của tenant đó có liên quan đến event
  2. membership.personId → account → device_tokens (active=true)
  3. Group by platform (ios/android)
  4. FCM batch send (Android + iOS qua FCM, hoặc APNs trực tiếp cho iOS)
  5. Handle token invalid → set active=false (cleanup)
```

**Event → Push mapping:**

| Event type | Push title (vi) | Push body | Deep link |
|-----------|----------------|-----------|-----------|
| `session.created` | "Kèo mới 🏸" | "{host} tạo kèo {sport} lúc {time}" | `plexco://session/{id}` |
| `session.updated` | "Kèo cập nhật" | "{field} đã đổi" | `plexco://session/{id}` |
| `player.joined` | "Có người join" | "{name} đã tham gia kèo {date}" | `plexco://session/{id}` |
| `player.left` | "Có người rời" | "{name} đã rời kèo" | `plexco://session/{id}` |
| `payment.matched` | "CK đã khớp ✅" | "{name} đã thanh toán {amount}" | `plexco://session/{id}/payments` |
| `join_request.pending` | "Yêu cầu join" | "{name} muốn tham gia kèo {date}" | `plexco://session/{id}/requests` |
| `reminder.debt` | "Nhắc thanh toán" | "Bạn còn nợ {amount} cho kèo {date}" | `plexco://session/{id}/pay` |

### 3.2 Auth mở rộng

**Hiện tại (phase-1, DD-13):** Google OAuth + email/password → `account_identities(platform ∈ google/email)` → Account → Person (Telegram Login bỏ — DD-37; link Facebook/Zalo vào cùng Person)

**Thêm cho native:**

```sql
-- Mở rộng accounts table
ALTER TABLE accounts ADD COLUMN apple_id    text UNIQUE;
ALTER TABLE accounts ADD COLUMN google_id   text UNIQUE;
ALTER TABLE accounts ADD COLUMN auth_method text DEFAULT 'google'
    CHECK (auth_method IN ('google', 'email', 'apple', 'facebook', 'zalo', 'phone'));
-- DD-37: Telegram bỏ; canonical = account_identities.platform ∈ {google,email,facebook,zalo}
```

**Auth flow native:**

```
iOS App:
  Apple Sign-In → Apple ID token
    → POST /auth/apple { identityToken }
    → Verify với Apple servers
    → Tìm Account(apple_id) hoặc tạo mới
    → JWT access + refresh token
    → Account → Person (reuse identity pipeline)

Android App:
  Google Sign-In → Google ID token
    → POST /auth/google { idToken }
    → Verify với Google servers
    → Tìm Account(google_id) hoặc tạo mới
    → JWT access + refresh token
    → Account → Person (reuse identity pipeline)
```

**Link Account cross-auth:**
User đăng nhập web bằng Google, native bằng Apple → 2 Account khác nhau? Giải pháp:

| Trường hợp | Giải pháp |
|------------|-----------|
| Cùng email (Google email = Apple email) | Auto-link Account nếu **email verified** cả hai phía |
| Khác email | Manual link: đăng nhập 1 → Settings → "Liên kết tài khoản" → đăng nhập cái kia |
| Cùng SĐT verified | Auto-link qua Person.phone |

> **Nguyên tắc:** Account là **authentication record** (cách đăng nhập). Person là **identity** (con người). Nhiều Account có thể trỏ về 1 Person — reuse đúng cơ chế identity merge (AUDIT C3).

### 3.3 ChannelReachability mở rộng

```sql
-- Thêm platform values
ALTER TABLE channel_reachability
    ALTER COLUMN platform TYPE text;
-- platform IN ('zalo', 'messenger', 'google', 'ios', 'android', 'web')  -- DD-37: Telegram bỏ
```

Projector chọn kênh thông báo theo `ChannelReachability`:

```
notifyPlayer(person, tenant, event):
  reachability = SELECT * FROM channel_reachability
                 WHERE person_id = person AND tenant_id = tenant AND can_dm = true
                 ORDER BY priority -- ưu tiên native push > web push + Zalo DM > Messenger (24h)

  for each channel in reachability:
    if channel.platform == 'ios' || 'android':
      → Push Projector (FCM/APNs)
    elif channel.platform == 'zalo':
      → Zalo Projector (sendMessage)
    elif channel.platform == 'messenger':
      → Messenger Projector (best-effort trong cửa sổ 24h)
```

---

## 4. API — Native gọi cùng Web API

### 4.1 Endpoints không đổi

Native app gọi **chính xác** cùng endpoints mà web app đang dùng:

| Category | Endpoint | Web dùng | Native dùng |
|----------|---------|----------|-------------|
| **Discovery** | `GET /discover` | ✅ | ✅ Cùng |
| **Session CRUD** | `POST/GET/PATCH /sessions` | ✅ | ✅ Cùng |
| **Join** | `POST /sessions/:id/join` | ✅ | ✅ Cùng |
| **Player view** | `GET /me/clubs` | ✅ | ✅ Cùng |
| **Payment** | `GET /sessions/:id/payments` | ✅ | ✅ Cùng |
| **Roster** | `GET /sessions/:id/members` | ✅ | ✅ Cùng |
| **Onboarding** | `POST /tenants` | ✅ | ✅ Cùng |

### 4.2 Endpoints mới cho native

| Endpoint | Mô tả |
|----------|-------|
| `POST /auth/apple` | Apple Sign-In verify + login/register |
| `POST /auth/google` | Google Sign-In verify + login/register |
| `POST /auth/refresh` | Refresh JWT token (mobile cần rotate thường xuyên hơn) |
| `PUT /devices/token` | Register/update FCM/APNs device token |
| `DELETE /devices/token` | Unregister device token (logout) |
| `GET /notifications/settings` | Notification preferences per user |
| `PUT /notifications/settings` | Update preferences (mute club, quiet hours) |

### 4.3 Response format — đã compatible

API hiện tại trả **JSON** (không HTML) → native parse nguyên.

```json
// GET /discover?sport=badminton&area=quan_7
{
  "sessions": [
    {
      "id": "sess-abc",
      "sportKey": "badminton",
      "startsAt": "2026-06-20T19:00:00+07:00",
      "area": "Quận 7",
      "price": 80000,
      "slotsOpen": 3,
      "hostDisplayName": "Minh",
      "clubDisplayName": "Bestminton Club",
      "joinPolicy": "open"
    }
  ],
  "nextCursor": "xxx",
  "total": 42
}
```

Web render → HTML; Native render → SwiftUI/Compose. **Cùng data, khác presentation.**

---

## 5. Offline & Caching (mobile-specific)

### 5.1 Strategy

| Data | Cache policy | Lý do |
|------|-------------|-------|
| **Discovery results** | Cache 5 phút + pull-to-refresh | Dữ liệu thay đổi thường xuyên (slot fill) |
| **Session detail** | Cache + invalidate on push notification | Push event `session.updated` → refetch |
| **Player's clubs** | Cache dài (1h) + pull-to-refresh | Ít thay đổi |
| **Payment status** | **KHÔNG cache** — luôn fetch fresh | Tiền phải chính xác, không stale |
| **User profile** | Cache dài | Hiếm thay đổi |

### 5.2 Offline mode (limited)

```
Online:  Full functionality — mọi command gửi được
Offline: Read-only từ cache
         - Xem session đã cache
         - Xem club list đã cache
         - KHÔNG join/leave/pay (cần server)
         - Queue action? ❌ KHÔNG — tiền/roster cần real-time consistency
```

> **Quyết định:** Plexco **KHÔNG** queue offline mutations. Lý do: session slot có thể full, payment cần real-time match, roster cần consistency. Cho user thấy "Không có kết nối" thay vì gửi command stale.

### 5.3 Deep linking

```
URL scheme: plexco://
Universal links: https://plexco.app/...

plexco://session/{id}           → Session detail
plexco://session/{id}/join      → Join flow
plexco://session/{id}/pay       → Payment screen
plexco://discover               → Marketplace
plexco://clubs                  → My clubs
plexco://link/{code}            → Identity merge link
```

Web URL (plexco.app/session/xxx) mở **native app nếu cài**, fallback web nếu chưa cài → **App Links (Android) / Universal Links (iOS)**.

---

## 6. Tech stack — Quyết định mở

### 6.1 Options

| Option | Pro | Con |
|--------|-----|-----|
| **Swift (iOS) + Kotlin (Android)** | Performance tốt nhất, native UX, App Store ưu tiên | 2 codebase, 2x effort UI |
| **React Native** | 1 codebase JS/TS, share types với `packages/core` | Performance kém hơn native, dependency nặng |
| **Flutter** | 1 codebase Dart, UI đẹp, performance tốt | Khác ngôn ngữ (Dart ≠ TypeScript), không share types |
| **Expo (React Native)** | Dễ nhất: 1 codebase, OTA update, EAS build | Giới hạn native modules, performance |

### 6.2 Khuyến nghị sơ bộ

**React Native / Expo** — lý do:
- **Share TypeScript types** với `packages/core` (enums, DTOs, error codes, validation)
- 1 codebase cho iOS + Android
- Team đã quen TypeScript
- OTA update (không qua App Store cho minor fixes)
- Có thể dùng `packages/shared` constants trực tiếp

> ⬜ **Chốt ở P7.0 Spike** — test performance với Plexco use cases thực tế trước khi commit.

---

## 7. Billing — In-App Purchase consideration

### Vấn đề Apple/Google 30% cut

Nếu host trả paid tier **host_pro 250k/tháng** qua App Store → Apple/Google lấy khoảng 30% → margin bị ăn mạnh.

### Giải pháp

| Approach | Khả thi? |
|----------|----------|
| **Thu phí qua web** (hiện tại) — app chỉ redirect tới plexco.app/billing | ✅ Hợp lệ — "reader app" rule |
| **Thu phí qua bank transfer** (hiện tại) — app hiện QR code | ✅ Hợp lệ — không qua IAP |
| ❌ Thu qua IAP | Mất 30%, margin âm |

> **Quyết định đề xuất:** Giữ billing qua bank transfer / web — **không dùng In-App Purchase**. Native app là tool quản lý, không phải marketplace bán digital goods. Phù hợp Apple "reader app" guidelines.

---

## 8. Rủi ro & Quyết định mở

| # | Rủi ro / Câu hỏi | Mitigation / Trạng thái |
|---|---|---|
| R1 | App Store review reject (đặc biệt Apple — strict về "login with Apple" requirement) | Phải có Apple Sign-In nếu có Google Sign-In; compliance check trước submit |
| R2 | Push notification opt-in rate thấp (iOS ~50%) | Fallback: web push + Zalo DM vẫn hoạt động; push là bonus |
| R3 | FCM/APNs token invalid (user uninstall/reinstall) | Token cleanup trong Push Projector — invalid → `active=false` |
| R4 | 2 codebase maintenance nếu chọn native | Spike P7.0 test React Native/Expo trước |
| OD-N1 | Tech stack native: Swift+Kotlin vs React Native vs Flutter? | ⬜ Chốt ở P7.0 Spike |
| OD-N2 | Offline mode: read-only hay queue mutations? | ✅ Đề xuất: read-only (tiền cần consistency) |
| OD-N3 | Billing qua IAP hay giữ bank transfer? | ✅ Đề xuất: giữ bank transfer (tránh 30% cut) |

---

## 9. Checklist "sẵn sàng cho native" khi build web

Những điều cần **lưu ý ngay từ P4** (build web) để native không phải refactor sau:

- [x] API trả **JSON** thuần, không mix HTML response
- [x] Auth endpoint tách riêng (không cookie-only, hỗ trợ Bearer token)
- [x] Outbox/projector pattern — extensible (thêm projector không sửa cũ)
- [x] Discovery API stateless (cursor-based pagination, không session-dependent)
- [x] `public_sessions` là read model riêng — native đọc cùng query
- [x] Deep link URLs deterministic (`/session/:id`, `/discover`)
- [ ] *(P7)* Device token management
- [ ] *(P7)* Push notification projector
- [ ] *(P7)* Apple/Google Sign-In auth providers

> ✅ **6/9 đã được design sẵn** trong TDD v2.1 + feature specs. 3 còn lại là P7 work.

---

## 10. Tổng kết

```
┌──────────────────────────────────────────────────────────────────┐
│                    Native App Impact Summary                     │
│                                                                  │
│  ❌ KHÔNG ĐỔI:                                                  │
│     PostgreSQL + RLS + tenantRepo                                │
│     Outbox + dispatcher + existing projectors                    │
│     Marketplace Discovery API (GET /discover)                    │
│     Identity pipeline (Person / ChannelIdentity / Membership)    │
│     Payment reconcile logic                                      │
│     Business rules (37 rules, 9 domains)                         │
│     Session management                                           │
│                                                                  │
│  🟡 MỞ RỘNG:                                                    │
│     + Push Projector (FCM/APNs)                    ~ 1–2 tuần    │
│     + device_tokens table                          ~ 1 ngày      │
│     + Apple/Google Sign-In auth providers          ~ 1 tuần      │
│     + ChannelReachability thêm ios/android         ~ 1 ngày      │
│     + Notification preferences API                 ~ 3 ngày      │
│                                                                  │
│  🆕 BUILD MỚI:                                                   │
│     Native UI (SwiftUI/Compose hoặc React Native)  ~ 6–10 tuần  │
│     Offline cache layer                            ~ 1–2 tuần    │
│     Deep linking + Universal Links                 ~ 3 ngày      │
│     App Store / Play Store submission              ~ 1 tuần      │
│                                                                  │
│  TỔNG ESTIMATE (1 dev): ~ 12–16 tuần cho P7                     │
└──────────────────────────────────────────────────────────────────┘
```

**Kiến trúc canonical-store + surface-projection đã tính trước native app. Khi đến P7, effort chính là UI — backend/API/sync/marketplace không đổi.**

---

*Tài liệu này là companion cho `TDD.md` v2.1 §3.8 (sync engine) và `ROADMAP.md` v2.1. Khi conflict, giữ thứ tự ưu tiên TDD → BRD → doc này.*

---

## Changelog

| Ngày | Version | Thay đổi |
|------|---------|----------|
| 19/06/2026 | — | Thêm Changelog table |
| 18/06/2026 | v1.0 | Phân tích thêm native app post-MVP |
| 10/07/2026 | 1.1 | DD-37 channel pivot (BRD v3.4): surfaces hiện tại = Zalo/Messenger/Web (bỏ Telegram); projector/ChannelReachability refs đổi TG→Zalo/Messenger; auth "hiện tại" = Google/email (DD-13). Kiến trúc canonical-store + surface-projection **không đổi**. |
