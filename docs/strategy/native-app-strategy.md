# Phân tích — Thêm Native App (iOS / Android) sau Web MVP

**Phiên bản:** 1.6
**Ngày tạo:** 18/06/2026 · **Cập nhật:** 18/07/2026
**Tài liệu tham chiếu:** `../product/BRD.md` v3.9d · `../product/PRD.md` v2.8b · `../product/TDD.md` v3.1 · `../product/ROADMAP.md` v3.3b · `../features/feature_sync_engine.md` · `../features/feature_marketplace_discovery.md` · `../features/feature_identity.md` · `../standards/decisions.md` v1.47 · `../dd-69-app-native-analysis.md`

> ⚠️ **Version note (18/07/2026):** companion strategy, không phải source of truth. Authority hiện hành: **BRD v3.9d · PRD v2.8b · TDD v3.1 · ROADMAP v3.3b · decisions v1.47/DD-69**. Native direction đã accepted nhưng build là **phase-2 · TBD**, không tạo canonical `P7`; RN+Expo vẫn là recommendation sau spike.

> **TL;DR:** Canonical-store + server-owned rules là nền tốt cho native, nhưng native **không chỉ là thêm UI**. Trước GA phải bổ sung client-safe contracts, versioned API, bearer/refresh auth, Apple/equivalent iOS login, protected device push và old-client/store gates. Core domain/RLS/outbox được giữ; identity/channel schema không được mở rộng sai để chứa device token. Offline v1 read-only.

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

### Native app = phase-2 sau P6 (accepted direction, build chưa schedule)

Work packages đề xuất, **không phải canonical P-number**:

1. Native spike — RN+Expo recommendation, test capability/perf/store constraints.
2. Client-safe contracts + `/api/v1` compatibility boundary.
3. Bearer/refresh auth + Google PKCE + Apple/equivalent iOS login.
4. Protected device push + notification policy/privacy.
5. Core UI, host dashboard, player flows và chat/discovery.
6. Offline read-only cache + hardening + App Store/Play submission.

> **Vì sao web trước, native sau?**
> - Web = **0 cài đặt** cho player (khám phá + join ngay) — phù hợp marketplace discovery
> - Web = nhanh hơn iterate (deploy instant, không qua App Store review)
> - Native = **trải nghiệm premium** cho host quản lý hằng ngày + push notification cho player
> - Build native khi đã có **API ổn định** + user base validate product

---

## 2. Phân tích ảnh hưởng lên kiến trúc hiện tại

### 2.1 Giữ canonical-store/outbox pattern; mở auth/API/push boundaries

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
│   sessions · memberships · players · charges · bank_transactions │
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

**Kết luận:** canonical store, RLS và outbox pattern được giữ. Native gọi cùng canonical services qua target `/api/v1`, nhưng cần thêm compatibility/auth/device-push boundaries; đây là extension có migration/tests, không phải “chỉ thêm UI/projector”.

### 2.2 Component-by-component impact analysis

| Component | Hiện tại | Native app thêm gì? | Breaking change? |
|-----------|---------|---------------------|-----------------|
| **REST API** (`apps/web`) | Live envelope + một số `/api/auth/*`/onboarding routes; chưa có full `/api/v1` | Inventory/version DTO; native gọi cùng canonical handlers | 🟡 Compatibility layer + tests |
| **Sync Engine** (outbox + projector) | Command/outbox schema live; channel projectors còn feature work | Thêm privacy-safe Push Projector (FCM/APNs) | 🟡 Thêm projector/policy, giữ outbox core |
| **Marketplace Discovery** | Schema/spec có; full API chưa live | Native gọi cùng future `/api/v1` DTO | 🟡 Không claim endpoint đã implement |
| **Identity pipeline** | Person + AccountIdentity + endpoint-scoped ChannelIdentity + Membership | Native auth qua AccountIdentity; push qua device subscription riêng | 🟡 Thêm provider/store, không thêm iOS/Android ChannelIdentity |
| **Auth** | Live baseline còn Telegram-era cookie; Google/email là phase-1 target | Google PKCE + Apple/equivalent iOS login + bearer/refresh family | 🟡 New auth transport/provider work; không thêm provider-id cột vào `accounts` |
| **RLS / tenantRepo** | `SET LOCAL app.tenant_id` | Native dùng **cùng API** → cùng RLS path | ❌ Không |
| **public_sessions** (read model) | Field-whitelist, cross-tenant | Native đọc **cùng data** | ❌ Không |
| **Realtime updates** | SSE contract DD-07 | SSE foreground + push background | 🟡 Thêm protected device plane, không bỏ SSE |
| **Billing** | Web dashboard payment | Có thể thêm In-App Purchase (Apple/Google) | 🟡 Mở rộng nếu cần |

### 2.3 Kết luận impact

**Giữ nguyên authority/core:** PostgreSQL canonical store, tenantRepo/RLS, outbox pattern, public/person-self/tenant-private boundary, payment/session business rules.

**Bắt buộc mở rộng trước native:** client-safe contract boundary, `/api/v1` compatibility, bearer/refresh auth, Apple/equivalent iOS login, `device_push_subscriptions`, push projector/policy, privacy-safe payload, old-client/OTA/store tests. Không thêm `ios/android/push` vào `ChannelIdentity/channel_reachability`.

---

## 3. Components mới cần build

### 3.1 Push Notification Projector

**Tại sao không dùng SSE cho native?**
- SSE yêu cầu connection mở liên tục → tốn pin, bị OS kill background
- Push notification (FCM/APNs) = OS-level delivery, hoạt động khi app đóng
- Web giữ SSE (browser support tốt, không cần push permission)

**Schema authority:** dùng duy nhất `device_push_subscriptions` ở §3.3. Endpoint/token raw không lưu plaintext: DB giữ lookup hash + encrypted endpoint, bind `person_id + app_instance_id`, lifecycle `active|revoked|invalid`. Không có `tenant_id` authority trên subscription; dispatcher phải re-check person eligibility cho từng target tenant/event trước send.

**Projector logic:**

```
outbox_event: { type: "session.created", tenantId, payload }
  │
  Push Projector:
  1. Lấy membership[] của tenant đó có liên quan đến event
  2. membership.personId → device_push_subscriptions (active)
  3. Group by platform (ios/android)
  4. FCM batch send (Android + iOS qua FCM, hoặc APNs trực tiếp cho iOS)
  5. Handle token invalid → set active=false (cleanup)
```

**Event → Push mapping:**

| Event type | Lock-screen copy | Payload tối thiểu | Protected deep link |
|-----------|----------------|-----------|-----------|
| `session.created` | "Plexco có kèo mới" | `notification_id`, `type` | `plexco://notifications/{id}` → fetch sau auth |
| `session.updated` | "Một kèo đã được cập nhật" | `notification_id`, `type` | `plexco://notifications/{id}` |
| `player.joined|left` | "Roster có cập nhật" | `notification_id`, `type` | `plexco://notifications/{id}` |
| `payment.matched` | "Có cập nhật thanh toán" | `notification_id`, `type` | `plexco://notifications/{id}` |
| `join_request.pending` | "Có yêu cầu tham gia mới" | `notification_id`, `type` | `plexco://notifications/{id}` |
| `reminder.debt` | "Bạn có thông báo cần xem" | `notification_id`, `type` | `plexco://notifications/{id}` |

> **HR2:** lock-screen payload không chứa player/payer name, amount/debt, roster, venue riêng tư, provider token hay tenant authority. App mở deep link rồi fetch DTO whitelist sau auth + target authorization.

### 3.2 Auth mở rộng

**Phase-1 target (DD-13, chưa live):** Google OAuth + email/password → `account_identities(platform ∈ google/email)` → Account → Person. Live baseline vẫn Telegram-era cookie auth cho tới provider-swap slice; Telegram đã bị DD-37 loại khỏi target. Facebook/Zalo link vào cùng Person theo các gate tương ứng.

**Thêm cho native:**

```text
Target active providers sau native:
account_identities.platform ∈ {google, email, apple, facebook, zalo}
provider subject → keyed HMAC → canonical account_identities
```

Live `0001_global_directory.sql`/`schema.ts` đang để `platform` là `text` **không có**
`account_identities_platform_chk`, đồng thời baseline auth còn Telegram-era. Vì vậy migration phase-2 không được
`DROP` một constraint giả định. Provider-swap phải audit/backfill legacy rows trước; migration mới, self-contained
sau đó mới thêm validation/lookup cho active providers (có `apple`) hoặc giữ legacy value theo lifecycle retire rõ ràng.
Không thêm `apple_id`/`google_id` trực tiếp vào `accounts`.

**Auth flow native:**

```
iOS App:
  Sign in with Apple/equivalent privacy login → authorization code + PKCE/nonce
    → POST /api/v1/auth/native/apple { code, codeVerifier, redirectUri }
    → Verify issuer/audience/nonce/code server-side
    → Resolve/create account_identities(platform='apple', keyed subject hash)
    → Bearer access 15m + rotating refresh family 30d
    → Account → Person (reuse identity pipeline)

Android App:
  Google Authorization Code + PKCE
    → POST /api/v1/auth/native/google { code, codeVerifier, redirectUri }
    → Verify issuer/audience/nonce/code server-side
    → Resolve/create account_identities(platform='google', keyed subject hash)
    → Bearer access 15m + rotating refresh family 30d
    → Account → Person (reuse identity pipeline)
```

Nếu iOS cũng offer Google login cho primary account, phải có privacy-equivalent option theo App Review 4.8 hoặc documented exception/evidence. Token format opaque-vs-JWT được chốt ở auth design-probe; token không mang tenant authority bất biến.

**Link Account cross-auth:**
User đăng nhập web bằng Google, native bằng Apple → 2 Account khác nhau? Giải pháp:

| Trường hợp | Giải pháp |
|------------|-----------|
| Cùng email (Google email = Apple email) | Chỉ link sau exact verified-email proof matrix + conflict checks DD-50; không tin email string tự khai |
| Khác email | Manual link: đăng nhập 1 → Settings → "Liên kết tài khoản" → đăng nhập cái kia |
| Cùng verified account email | Auto-link chỉ sau proof matrix DD-50 + conflict checks |
| Transactional one-time `link_code` | Link thủ công, lock/consume once + explicit impact confirm |
| Cùng SĐT | Không dùng phase-1; phone schema dormant |

> **Nguyên tắc:** Account là **authentication record** (cách đăng nhập). Person là **identity** (con người). Nhiều Account có thể trỏ về 1 Person — reuse đúng cơ chế identity merge (AUDIT C3).

### 3.3 Native push tách khỏi ChannelIdentity reachability

```sql
-- Phase-2 proposal: native/web push endpoint is NOT a bot ChannelIdentity.
CREATE TABLE device_push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES persons(id),
  platform text NOT NULL CHECK (platform IN ('ios','android','web')),
  endpoint_lookup_hash text NOT NULL,
  endpoint_enc bytea NOT NULL,
  app_instance_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('active','revoked','invalid')),
  last_seen_at timestamptz NOT NULL,
  revoked_at timestamptz,
  UNIQUE (platform, endpoint_lookup_hash),
  UNIQUE (person_id, app_instance_id, platform)
);
```

`channel_reachability` **không thêm platform `push`**. DD-67 target sẽ key channel reachability bằng exact endpoint-bound `channel_identity_id` sau migration riêng (live schema hiện vẫn legacy `(person_id,tenant_id,platform)`). Messenger Page và Zalo bot/OA đi qua protected ChannelIdentity; target-tenant permission là check riêng. `device_push_subscriptions` là protected person/device store độc lập cho APNs/FCM/Web Push.

Notification dispatcher combines the two sources without turning them into one polymorphic table:

```
notifyPlayer(person, tenant, event):
  assert target person is eligible for tenant/event       -- separate tenant auth
  push = load active device_push_subscriptions(person)
  bot_candidates = identityDeliveryService.resolveExactReachability(person)
    # each candidate carries one channel_identity_id bound to a Page/bot/OA

  apply notification policy:
    native/web push → Push Projector (APNs/FCM/Web Push) using device subscription
    Zalo           → choose one exact eligible bot/OA route
    Messenger      → choose one exact eligible tenant Page, else central Page,
                     only inside current allowed messaging window/mechanism
  claim logical delivery key before send; never broadcast the same logical
  notification across multiple Page/bot identities by accident
```

Device revocation invalidates only that subscription. Bot reachability changes only the exact `channel_identity_id` row. Neither store can authorize the other, and a tenant id is never inferred from a push token or provider payload.

---

## 4. API — Native gọi cùng Web API

### 4.1 Target `/api/v1` dùng chung

Native và PWA phải gọi cùng canonical handlers/DTO, nhưng bảng dưới là **target contract, chưa phải live route inventory**. Live `apps/web` hiện chủ yếu có `/api/auth/*` + onboarding; discovery/session/player API còn phải land. Trước native cần compatibility layer để PWA hiện tại không đổi hành vi.

| Category | Endpoint | Web dùng | Native dùng |
|----------|---------|----------|-------------|
| **Discovery** | `GET /api/v1/discover` | Target | Cùng DTO/authz |
| **Session CRUD** | `POST/GET/PATCH /api/v1/sessions` | Target | Cùng handler/service |
| **Join** | `POST /api/v1/sessions/:id/join` | Target | Cùng join core + revalidation |
| **Player view** | `GET /api/v1/me/clubs` | Target | Cùng person-self boundary |
| **Payment** | `GET /api/v1/sessions/:id/payments` | Target | Tenant/person authz; không public |
| **Roster** | `GET /api/v1/sessions/:id/members` | Target | Tenant-private DTO whitelist |
| **Onboarding** | `POST /api/v1/tenants` | Target | Cùng onboarding service |

### 4.2 Endpoints mới cho native

| Endpoint | Mô tả |
|----------|-------|
| `POST /api/v1/auth/native/apple` | Apple authorization-code verify + login/register |
| `POST /api/v1/auth/native/google` | Google authorization-code + PKCE verify + login/register |
| `POST /api/v1/auth/refresh` | Rotate refresh family; reuse detection revokes family |
| `PUT /api/v1/devices/push-subscription` | Register/rotate encrypted APNs/FCM endpoint |
| `DELETE /api/v1/devices/push-subscription` | Revoke installation subscription |
| `GET /api/v1/notifications/settings` | Notification preferences per person |
| `PUT /api/v1/notifications/settings` | Update preferences (mute club, quiet hours) |

### 4.3 Response envelope — live helper, target DTO

`apps/web/lib/api-envelope.ts` đã có envelope canonical; resource DTO dưới đây vẫn là target cho discovery API.

```json
// GET /api/v1/discover?sport=badminton&area=quan_7
{
  "data": {
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
  },
  "error": null,
  "meta": { "requestId": "req_..." }
}
```

Web/RN render khác presentation nhưng parse cùng `{data,error,meta.requestId}` + DTO whitelist.

---

## 5. Offline & Caching (mobile-specific)

### 5.1 Strategy

| Data | Cache policy | Lý do |
|------|-------------|-------|
| **Public discovery results** | Cache tối đa 5 phút + stale label/pull-to-refresh | Chỉ public DTO whitelist; slot có thể đổi |
| **Public session summary** | Cache ngắn + stale label; push chỉ trigger refetch khi online | Không roster/venue riêng tư/tiền |
| **Player's clubs/membership** | **Không disk-cache ở v1** | Person-private relationship |
| **Payment/debt/status** | **Không cache** | Tiền phải fetch fresh sau auth |
| **User profile/identity** | **Không disk-cache** | PII/identity; secure storage chỉ giữ auth secret tối thiểu |

### 5.2 Offline mode (limited)

```
Online:  Full functionality — mọi command gửi được
Offline: Read-only từ cache
         - Xem public discovery/session summary đã cache, có stale label
         - KHÔNG hiện club membership/profile/roster/venue riêng tư/tiền từ disk
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

Deep link chỉ là locator, không phải authorization. App phải authenticate, resolve protected ref server-side và re-authorize target tenant/action. `link_code` vẫn purpose-bound/TTL/single-use theo DD-50; không log raw code.

---

## 6. Tech stack — Quyết định mở

### 6.1 Options

| Option | Pro | Con |
|--------|-----|-----|
| **Swift (iOS) + Kotlin (Android)** | Performance tốt nhất, native UX, App Store ưu tiên | 2 codebase, 2x effort UI |
| **React Native** | Một codebase JS/TS; share client-safe contracts/format sau khi tách boundary | Cần native QA/dependency/runtime discipline |
| **Flutter** | 1 codebase Dart, UI đẹp, performance tốt | Khác ngôn ngữ (Dart ≠ TypeScript), không share types |
| **Expo (React Native)** | Một codebase, EAS build/update, notification/secure-store/auth modules | OTA chỉ cho JS/assets tương thích runtime; native module đổi phải rebuild |

### 6.2 Khuyến nghị sơ bộ

**React Native / Expo** — lý do:
- Share **client-safe** TypeScript DTO/error/validator/format boundary sau khi tách khỏi server i18n/money modules
- 1 codebase cho iOS + Android
- Stack hiện tại đã dùng TypeScript
- EAS Update hỗ trợ JS/assets cùng runtime, có rollout/rollback; không thay native binary contract
- Expo modules phù hợp push/secure storage/auth baseline của Plexco

> 🟡 **Recommendation của DD-69, chốt sau native spike** — test performance, auth/push/deep-link, old-client compatibility và store constraints trước khi accept.

---

## 7. Billing — In-App Purchase consideration

### Vấn đề store billing/distribution

`host_pro` là SaaS capability cho host. Store billing, external-link và bank-transfer presentation phụ thuộc policy/region/app classification tại thời điểm submit; không được suy từ “reader app” nếu Plexco chưa chứng minh đủ điều kiện.

### Giải pháp

| Approach | Khả thi? |
|----------|----------|
| **Thu phí qua web / external link** | 🔗 External/legal/store gate theo region + entitlement/current policy; chưa claim hợp lệ |
| **Hiện QR/bank transfer trong app** | 🔗 Review current policy + Vietnamese legal/tax flow; chưa claim automatic exemption |
| **Store IAP** | 🔗 Đánh giá fee/economics/current small-business terms tại native spike |

> **Quyết định hiện tại:** chưa chốt distribution billing cho native. Phase-1 web/bank flow không tự động cấp quyền tái dùng trong app store binary. Native GA fail-closed: không hiển thị purchase/redirect/QR path cho tới khi external/legal/store evidence được lưu và owner accept.

Policy source phải refresh tại thời điểm spike/submit, tối thiểu Apple App Review Guidelines §3.1/§4.8: <https://developer.apple.com/app-store/review/guidelines/>.

---

## 8. Rủi ro & Quyết định mở

| # | Rủi ro / Câu hỏi | Mitigation / Trạng thái |
|---|---|---|
| R1 | App Store review reject (đặc biệt Apple — strict về "login with Apple" requirement) | Phải có Apple Sign-In nếu có Google Sign-In; compliance check trước submit |
| R2 | User không cấp push permission | Fallback theo notification policy; core action vẫn dùng được, không bắt bật push |
| R3 | FCM/APNs endpoint invalid (uninstall/reinstall/rotation) | Provider error → subscription `invalid`; rotate/re-register theo app installation |
| R4 | Dependency/native runtime drift | RN+Expo spike + runtime-version policy + staged OTA rollout/rollback |
| OD-N1 | Tech stack native | 🟡 RN+Expo recommendation; owner accept sau spike |
| OD-N2 | Offline mode | ✅ Proposal boundary: read-only v1; mutation queue là quyết định allowlist riêng |
| OD-N3 | Billing distribution | 🔗 Chưa chốt; external/legal/store evidence trước mọi purchase path |

---

## 9. Checklist "sẵn sàng cho native" khi build web

Những điều cần **lưu ý ngay từ P4** (build web) để native không phải refactor sau:

- [x] Live JSON envelope helper `{data,error,meta.requestId}`
- [ ] Full `/api/v1` route inventory + DTO compatibility tests
- [ ] Bearer access + rotating refresh family; cookie↔bearer parity
- [x] Outbox/`processed_commands` schema foundation; feature service/projector wiring còn pending
- [ ] Discovery/session/player APIs live + stateless pagination contract
- [x] `public_sessions` read-model schema; native read API/authz còn pending
- [ ] Client-safe contracts/i18n package + import boundary cấm money/server modules
- [ ] Universal/App Links + protected notification deep links
- [ ] `device_push_subscriptions` + privacy-safe Push Projector
- [ ] Google PKCE + Apple/equivalent iOS login + account-link matrix
- [ ] Offline read-only cache evidence; no mutation queue
- [ ] Store/privacy/account-deletion/demo/external billing evidence

> Checklist phân biệt **live** và **target**; spec/design không được đánh dấu như runtime evidence.

---

## 10. Tổng kết

Canonical store, RLS, outbox pattern và server-owned business rules là phần được giữ. Native vẫn cần backend-adjacent work thật: client-safe contracts, versioned API compatibility, bearer/refresh auth, Apple/equivalent iOS login, protected device push, privacy-safe delivery, deep links, old-client/OTA tests và store/legal evidence. Estimate chỉ được lập sau native spike + live API inventory; không giữ con số 12–16 tuần như một commitment chưa có evidence.

---

*Tài liệu này là companion cho `../product/TDD.md` v3.1, `../product/ROADMAP.md` v3.3b và DD-69 analysis. Khi conflict, giữ thứ tự ưu tiên theo authority-by-topic trong `../product/BRD.md` §0 + `../standards/decisions.md` v1.47.*

---

## Changelog

| Ngày | Version | Thay đổi |
|------|---------|----------|
| 18/07/2026 | 1.6 | DD-69 direction accepted; refresh PRD/ROADMAP refs, preserve native build phase-2 TBD and RN+Expo recommendation/gates as not-yet-accepted implementation choices. |
| 18/07/2026 | 1.5 | **DD-69 review closure:** phase-2/TBD thay P7; RN+Expo recommendation sau spike; PWA/Capacitor không claim live/store-ready; tách client-safe contracts; target `/api/v1`; AccountIdentity auth + Apple/equivalent iOS gate; encrypted device push tách ChannelIdentity; privacy-safe lock-screen payload; offline read-only; checklist live-vs-target; billing chuyển thành external/legal/store gate, bỏ claim reader-app/fee chắc chắn. |
| 17/07/2026 | 1.4 | **DD-67 mirror closure:** remove proposed polymorphic `channel_reachability.platform`; separate native/web device subscriptions from exact Page/bot/OA-bound ChannelIdentity reachability and tenant authorization. |
| 17/07/2026 | 1.3 | Refresh current authority refs to BRD v3.9b/PRD v2.8/TDD v3.1/ROADMAP v3.3/decisions v1.45; native scope vẫn là định hướng P7. |
| 16/07/2026 | 1.2 | Rebase authority refs lên decisions v1.39; native account linking dùng verified account email hoặc transactional `link_code`; phone dormant theo DD-50. |
| 19/06/2026 | — | Thêm Changelog table |
| 18/06/2026 | v1.0 | Phân tích thêm native app post-MVP |
| 10/07/2026 | 1.1 | DD-37 channel pivot (BRD v3.4): surfaces hiện tại = Zalo/Messenger/Web (bỏ Telegram); projector/ChannelReachability refs đổi TG→Zalo/Messenger; auth "hiện tại" = Google/email (DD-13). Kiến trúc canonical-store + surface-projection **không đổi**. |
