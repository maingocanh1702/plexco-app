# Phân tích — Thêm Native App (iOS / Android) sau Web MVP

**Phiên bản:** 2.0
**Ngày tạo:** 18/06/2026 · **Cập nhật:** 28/07/2026
**Tài liệu tham chiếu:** `../product/BRD.md` v3.9n · `../product/PRD.md` v2.8m · `../product/TDD.md` v3.1h · `../product/ROADMAP.md` v3.4l · `../features/FE/feature_sync_engine.md` · `../features/FE/feature_marketplace_discovery.md` · `../features/FE/feature_identity.md` · `../standards/decisions.md` v2.11 current mirror · `../decisions/analysis/dd-69-app-native-analysis.md`

> ⚠️ **Version note (19/07/2026):** companion strategy, không phải source of truth. Authority hiện hành: **BRD v3.9f · PRD v2.8e · TDD v3.1 · ROADMAP v3.3e · decisions v1.74/DD-78**. Native direction accepted nhưng build phase-2 TBD.
>
> **Current supersession (22/08/2026):** **DD-113** đặt launch = **PWA + Zalo bot song song**, native **ngoài launch** và pin ngưỡng mở native ở cuối §1. Khối 28/07 dưới đây giữ hiệu lực ở phần Chat/plan/provider; phần "native phase-2/TBD" nay đọc là **"phase sau, gate đã có ngưỡng"** chứ không còn để mở vô hạn.
>
> **Supersession 28/07/2026:** source-of-truth pointers ở header thắng version note lịch sử trên. DD-91 đặt In-app Chat làm primary daily player surface mục tiêu; primary plan v1.8 đã `PLAN_READY` tại `90d292d`, nhưng từng slice vẫn phải strict `CODE_READY`. Native vẫn phase-2/TBD, không có runtime hay lịch build. Shared job substrate `0022`/`0023` và DB CHECK `0024` không thay đổi native gates bên dưới.

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

> ⚙️ **DD-113 (owner 22/08) — re-sequencing, KHÔNG đảo hướng của doc này.** Launch = **webapp PWA
> + Zalo bot ra mắt song song**, app native **lùi về phase sau**. Điểm đổi so với bản 28/07: web không
> còn là "fallback" của Zalo mà là surface launch độc lập; và câu *"native = phase-2, build TBD"* nay có
> **ngưỡng mở cụ thể** thay vì để mở vô hạn (xem cuối §1). Toàn bộ phân tích kiến trúc §2–§10 bên dưới
> **không đổi** — nó vẫn là điều kiện kỹ thuật phải trả trước khi native khởi động.

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
> - **DD-113 bổ sung lý do thứ năm, đo được:** khi web mang nhãn "fallback", nó không được build —
>   tại `a151b15` vẫn là **0 màn FE / 1 `page.tsx` / 0 route nghiệp vụ**, hơn một tháng sau khi DD-69
>   đặt PWA làm phase-1 target. Thứ tự web-trước không tự thực hiện nếu web không có vai chính.

### Gate mở bàn native (DD-113, 22/08) — thay cho "TBD"

Ngưỡng dưới đây là **working hypotheses** do owner chốt, không phải cam kết ngày. Chưa đủ thì native ở
lại phase sau và **không được nhắc trong sales script cho host**.

| Điều kiện | Ngưỡng |
|---|---|
| PWA v1 live, có host dùng thật | ≥ 5 host vận hành ≥ 4 tuần liên tục trên PWA |
| Bằng chứng quay lại | Host weekly return rate ≥ 60% trong 4 tuần |
| Installable thật sự được dùng | PWA install rate ≥ 30% host, **đo tách iOS/Android** |
| API/auth boundary ổn định | `/api/v1` + bearer/refresh + client-safe contracts đã land (§3–§4 dưới đây) |
| Có lý do native cụ thể | Nêu được ≥ 1 capability push/offline mà PWA **đo được là không làm nổi** |

Hàng *install rate* không phải chi tiết vụn: iOS chỉ cho web push khi PWA đã add-to-home-screen
(`../features/BE/feature_notifications_reminders_tech.md`, hàng 22 🟡 + gate #4), nên nó vừa là điều
kiện của mọi lập luận "PWA đủ rồi", vừa là bằng chứng mạnh nhất cho hướng ngược lại. Đó cũng là lý do
**web push nằm ngoài launch scope** của DD-113: reminder ở launch đi qua bot Zalo, kênh không phụ thuộc
install.

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
                                                   (provider TBD)
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
| **Sync Engine** (outbox + projector) | Command/outbox schema live; channel projectors còn feature work | Thêm privacy-safe native Push Projector qua provider port được spike chốt | 🟡 Thêm projector/policy, giữ outbox core |
| **Marketplace Discovery** | Schema/spec có; full API chưa live | Native gọi cùng future `/api/v1` DTO | 🟡 Không claim endpoint đã implement |
| **Identity pipeline** | Person + AccountIdentity + endpoint-scoped ChannelIdentity + Membership | Native auth qua AccountIdentity; push qua device subscription riêng | 🟡 Thêm provider/store, không thêm iOS/Android ChannelIdentity |
| **Auth** | Live baseline còn Telegram-era cookie; Google/email là phase-1 target | Google PKCE + Apple/equivalent iOS login + bearer/refresh family | 🟡 New auth transport/provider work; không thêm provider-id cột vào `accounts` |
| **RLS / tenantRepo** | `SET LOCAL app.tenant_id` | Native dùng **cùng API** → cùng RLS path | ❌ Không |
| **public_sessions** (read model) | Field-whitelist, cross-tenant | Native đọc **cùng data** | ❌ Không |
| **Realtime updates** | SSE contract DD-07 | SSE foreground + push background | 🟡 Thêm protected device plane, không bỏ SSE |
| **Billing** | Web dashboard payment | Có thể thêm In-App Purchase (Apple/Google) | 🟡 Mở rộng nếu cần |

### 2.3 Kết luận impact

**Giữ nguyên authority/core:** PostgreSQL canonical store, tenantRepo/RLS, outbox pattern, public/person-self/tenant-private boundary, payment/session business rules.

**Bắt buộc mở rộng trước native:** client-safe contract boundary, `/api/v1` compatibility, bearer/refresh auth, Apple/equivalent iOS login, native device-subscription store + provider port được phase-2 spike chốt, push projector/policy, privacy-safe payload, old-client/OTA/store tests. Không thêm `ios/android/push` vào `ChannelIdentity/channel_reachability` và không tái dùng Web-Push row shape trước quyết định đó.

---

## 3. Components mới cần build

### 3.1 Push Notification Projector

**Tại sao không dùng SSE cho native?**
- SSE yêu cầu connection mở liên tục → tốn pin, bị OS kill background
- Native push qua provider port được spike chọn = OS-level delivery, hoạt động khi app đóng
- Web giữ SSE (browser support tốt, không cần push permission)

**Boundary authority, không phải native schema authority:** DD-72 đã owner-final cho Web Push phase-1 với `kind='web'`; exact native row shape/provider/status key vẫn phải chờ DD-69 phase-2 spike. Điều đã pin: native device push tách ChannelIdentity, token/endpoint không plaintext, không dùng tenant id trong token làm authority, và dispatcher re-check target eligibility trước send.

**Projector logic:**

```
outbox_event: { type: "session.created", tenantId, payload }
  │
  Push Projector:
  1. Lấy membership[] của tenant đó có liên quan đến event
  2. membership.personId → accepted native device-subscription store (sendable)
  3. Group by native adapter/environment đã được spike chốt
  4. Gọi provider port đã chọn (APNs/FCM/khác vẫn TBD, không hard-code ở doc này)
  5. Reconcile provider outcome theo lifecycle schema được accept lúc build
```

**Event → Push mapping:**

| Event type | Lock-screen copy | Payload tối thiểu | Protected deep link |
|-----------|----------------|-----------|-----------|
| `session.created` | "Plexco có kèo mới" | `notification_id`, `type` | `plexco://notifications/{id}` → fetch sau auth |
| `session.updated` | "Một kèo đã được cập nhật" | `notification_id`, `type` | `plexco://notifications/{id}` |
| `player.joined|left` | "Roster có cập nhật" | `notification_id`, `type` | `plexco://notifications/{id}` |
| `payment.settled` | "Có cập nhật thanh toán" | `notification_id`, `type` | `plexco://notifications/{id}` |
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

Không có concrete native DDL authority ở phase-1. DD-72 owner-final sở hữu riêng Web Push shape; native chỉ được thêm bằng migration monotonic **sau** spike chốt provider/protocol, app/bundle identity, environment, token rotation và lifecycle. Spike được quyền chọn additive variant, protocol-specific child table hoặc adapter/store khác — doc này không được suy native columns từ `endpoint_enc/p256dh/auth` của Web Push.

Các ranh giới bắt buộc dù chọn shape nào:

- `channel_reachability` **không thêm platform `push`**; Messenger/Zalo vẫn qua endpoint-bound `channel_identity_id` theo DD-67.
- Native store là GLOBAL PROTECTED theo Person/device-install, không blanket grant cho `app`; token/endpoint lookup bằng keyed HMAC và ciphertext KMS.
- Exact app/bundle/environment binding, re-parent/trust reset và provider attempt audit phải được schema build-time enforce; token hoặc payload không cấp tenant authority.
- Registration và send resolver tách nhau; generic client không truyền Person/endpoint để worker giải mã tuỳ ý.

Notification dispatcher combines the two sources without turning them into one polymorphic table:

```
notifyPlayer(person, tenant, event):
  assert target person is eligible for tenant/event       -- separate tenant auth
  web_push = load accepted DD-72 web subscriptions(person)     # phase-1 owner-final; runtime pending
  native_push = nativeAdapter.resolve(person)                   # phase-2, shape TBD
  bot_candidates = identityDeliveryService.resolveExactReachability(person)
    # each candidate carries one channel_identity_id bound to a Page/bot/OA

  candidates = rank all eligible route families by one canonical policy:
    web push       → direct Web Push/VAPID theo DD-72 owner-final (runtime pending)
    native push    → provider port/schema accepted by phase-2 spike
    Zalo           → one exact eligible bot/OA route
    Messenger      → tenant Page else central Page within allowed mechanism
  selected = first exact route; atomically claim one logical delivery across
             web/native/Zalo/Messenger before any physical attempt
  # only the selected device-push route may fan to its active physical devices;
  # never send the same logical notification concurrently on another family
```

Device revocation invalidates only exact installation/subscription theo contract phase-2 đã accept. Bot reachability changes only exact `channel_identity_id`. Không store nào authorize store kia, và tenant id không bao giờ suy từ push token/provider payload.

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
| `PUT /api/v1/devices/push-subscription` | Register/rotate encrypted native push token/endpoint theo provider contract được spike chốt |
| `DELETE /api/v1/devices/push-subscription` | Revoke installation subscription |
| `GET /api/v1/notifications/settings` | Read only accepted preference registry; phase-1 person-owned shape = announcement opt-out per membership/tenant |
| `PUT /api/v1/notifications/settings` | Update only accepted person-owned preference. Không pre-freeze `mute club`/person quiet-hours; tenant quiet-hours remains host-owned notification policy |

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
| R3 | Native push token/endpoint mất hiệu lực (uninstall/reinstall/rotation) | Provider port phân loại proven-invalid theo lifecycle được accept; mark non-sendable rồi rotate/re-register theo app installation |
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
- [ ] Accepted native device-subscription store/provider port + privacy-safe Push Projector (không mặc định tái dùng Web-Push table)
- [ ] Google PKCE + Apple/equivalent iOS login + account-link matrix
- [ ] Offline read-only cache evidence; no mutation queue
- [ ] Store/privacy/account-deletion/demo/external billing evidence

> Checklist phân biệt **live** và **target**; spec/design không được đánh dấu như runtime evidence.

---

## 10. Tổng kết

Canonical store, RLS, outbox pattern và server-owned business rules là phần được giữ. Native vẫn cần backend-adjacent work thật: client-safe contracts, versioned API compatibility, bearer/refresh auth, Apple/equivalent iOS login, protected device push, privacy-safe delivery, deep links, old-client/OTA tests và store/legal evidence. Estimate chỉ được lập sau native spike + live API inventory; không giữ con số 12–16 tuần như một commitment chưa có evidence.

---

*Tài liệu này là companion cho `../product/TDD.md` v3.1h, `../product/ROADMAP.md` v3.4l và DD-69 analysis. Khi conflict, ưu tiên `../standards/decisions.md` current.*

---

## Changelog

| Ngày | Version | Thay đổi |
|------|---------|----------|
| 22/08/2026 | 2.1 | **Mirror DD-113 ✅ (owner 22/08) — re-sequencing, không đảo hướng doc này.** Launch = webapp PWA + Zalo bot **song song**; native lùi phase sau và **nằm ngoài launch**. Thêm: (a) khối ⚙️ đầu §1; (b) lý do thứ năm cho "web trước, native sau" — nhãn "fallback" khiến web không được build, đo tại `a151b15` vẫn 0 màn FE / 1 `page.tsx` / 0 route nghiệp vụ hơn một tháng sau DD-69; (c) mục **Gate mở bàn native** với ngưỡng đo được thay cho "TBD" (≥5 host ≥4 tuần trên PWA · weekly return ≥60% · install rate ≥30% **tách iOS/Android** · `/api/v1`+bearer/refresh+client-safe contracts đã land · nêu được capability PWA đo được là không làm nổi). Hàng install-rate gắn với ràng buộc iOS chỉ cho web push khi PWA đã cài — cũng là lý do web push nằm ngoài launch scope. **§2–§10 không đổi**; chúng vẫn là điều kiện kỹ thuật phải trả trước khi native khởi động. |
| 28/07/2026 | 2.0 | Refresh current authority refs; mirror primary plan v1.8 `PLAN_READY` at `90d292d` while retaining per-slice `CODE_READY`, native phase-2/TBD and all API/auth/push/store gates. |
| 27/07/2026 | 1.9 | Refresh current source-of-truth pointers; mirror DD-91 primary-surface target nhưng giữ execution plan `NOT_PLAN_READY`, native phase-2/TBD và toàn bộ API/auth/push/store gates. Không claim runtime hay schedule. |
| 19/07/2026 | 1.8 | Pointer refresh: BRD v3.9f · PRD v2.8e · ROADMAP v3.3e · decisions v1.74. Không đổi nội dung strategy; native vẫn direction accepted, build phase-2 TBD + gates. |
| 19/07/2026 | 1.7 | **Authority + notification mirror correction:** DD-72 remains Web Push proposal; native provider/shape defer DD-69 spike. Use canonical `payment.settled`, one logical route across device/bot families, and do not invent person mute/quiet-hours settings. Authority v1.63; no runtime. |
| 18/07/2026 | 1.6 | DD-69 direction accepted; refresh PRD/ROADMAP refs, preserve native build phase-2 TBD and RN+Expo recommendation/gates as not-yet-accepted implementation choices. |
| 18/07/2026 | 1.5 | **DD-69 review closure:** phase-2/TBD thay P7; RN+Expo recommendation sau spike; PWA/Capacitor không claim live/store-ready; tách client-safe contracts; target `/api/v1`; AccountIdentity auth + Apple/equivalent iOS gate; encrypted device push tách ChannelIdentity; privacy-safe lock-screen payload; offline read-only; checklist live-vs-target; billing chuyển thành external/legal/store gate, bỏ claim reader-app/fee chắc chắn. |
| 17/07/2026 | 1.4 | **DD-67 mirror closure:** remove proposed polymorphic `channel_reachability.platform`; separate native/web device subscriptions from exact Page/bot/OA-bound ChannelIdentity reachability and tenant authorization. |
| 17/07/2026 | 1.3 | Refresh current authority refs to BRD v3.9b/PRD v2.8/TDD v3.1/ROADMAP v3.3/decisions v1.45; native scope vẫn là định hướng P7. |
| 16/07/2026 | 1.2 | Rebase authority refs lên decisions v1.39; native account linking dùng verified account email hoặc transactional `link_code`; phone dormant theo DD-50. |
| 19/06/2026 | — | Thêm Changelog table |
| 18/06/2026 | v1.0 | Phân tích thêm native app post-MVP |
| 10/07/2026 | 1.1 | DD-37 channel pivot (BRD v3.4): surfaces hiện tại = Zalo/Messenger/Web (bỏ Telegram); projector/ChannelReachability refs đổi TG→Zalo/Messenger; auth "hiện tại" = Google/email (DD-13). Kiến trúc canonical-store + surface-projection **không đổi**. |
