# 🌐 Web App — Surface Docs

> **Surface:** plexco.app (web dashboard + marketplace + player view + chat in-app)
> **Deployable unit:** `apps/web`
> **Tech stack:** Next.js App Router baseline · Route Handlers/API · SSE · vanilla CSS · Google Fonts
> **Version:** v0.3 · 2026-07-10
> **Refs:** `../../product/TDD.md` §3.9 · `../../features/feature_web_auth_onboarding.md` · `../../features/feature_sync_engine.md` · `../../features/feature_marketplace_discovery.md` · `../../features/feature_player_view.md`

> **Cập nhật v3.4 (DD-37 ✅):** Auth phase-1 = **Google OAuth + email/password** (DD-13 ✅, thay TG Login) + link **Facebook** (DD-33 🟡) / **Zalo** (DD-14 ⬜). Kênh phase-1 = **web + Zalo + Facebook Messenger** (Telegram loại). Web nay còn là surface của **chat in-app** (DD-38 ✅) + **cài đặt hồ sơ/giá theo giới tính** (DD-39 ✅) + **mark-paid thủ công** (DD-40 ✅).

---

## 1. Vai trò trong hệ thống

Web app là **1 trong 3 surfaces phase-1** của Plexco (cùng Zalo bot, Facebook Messenger — Telegram đã loại, DD-37). Tất cả surfaces ghi vào **cùng PostgreSQL canonical store** qua `packages/core` domain services.

```
plexco.app
├── /             → Landing + auth
├── /dashboard    → Host dashboard (tenant-scoped)
├── /discover     → Marketplace (public, cross-tenant)
├── /me           → Player view (person-scoped)
├── /onboarding   → Wizard tạo tenant
└── /api          → REST API cho web + native app (tương lai)
```

### 1.1 Stack Decision (OD-10)

Baseline để implement P4: **Next.js App Router**.

| Layer | Decision | Lý do |
|-------|----------|-------|
| UI routes | Next.js App Router | Dashboard + marketplace + player view cần routing/layout tốt |
| API | Next Route Handlers hoặc shared Express adapter nếu bot cùng process | Giữ contract HTTP rõ, dễ tách sau |
| Realtime | SSE trước, WebSocket sau nếu cần | Đủ cho dashboard/player updates, đơn giản hơn |
| Styling | CSS variables + vanilla CSS | Bám design tokens, không lock vào UI kit sớm |
| Domain writes | Không viết trực tiếp từ component | Gọi command/API → domain service → outbox |

Nếu sau P0 chọn Express SSR vì deploy đơn giản hơn, API/DTO contract bên dưới vẫn giữ nguyên.

---

## 2. Screen Map

| Route | Screen | Auth | Data scope | Phase |
|-------|--------|------|-----------|-------|
| `/` | Landing + login (Google OAuth + email/password) | Public | — | P1 |
| `/onboarding` | Wizard (SePay, Zalo, Facebook Messenger, môn) | Authenticated | — | P4 |
| `/dashboard` | Host overview (sessions, payments, members) | TenantAdmin | Tenant RLS | P4 |
| `/dashboard/sessions` | Session list + CRUD | TenantAdmin | Tenant RLS | P4 |
| `/dashboard/sessions/:id` | Session detail (roster, payments, QR) | TenantAdmin | Tenant RLS | P4 |
| `/dashboard/payments` | Ledger, /unmatched, manual allocation | TenantAdmin | Tenant RLS | P4 |
| `/dashboard/members` | Membership list, merge tool, nghi trùng | TenantAdmin | Tenant RLS | P4 |
| `/dashboard/settings` | Tenant config, bank accounts, bot links | TenantOwner | Tenant RLS | P4 |
| `/discover` | Marketplace tìm kèo | Public | public_sessions | P4.3 |
| `/discover/:id` | Session preview + join CTA | Public | public_sessions | P4.3 |
| `/me` | Player clubs + nợ tổng | Authenticated | Person-scoped | P4.5 |
| `/me/clubs/:id` | Club detail (sessions, nợ, lịch sử) | Authenticated | Membership-scoped | P4.5 |

Chi tiết states (Loading/Ready/Error/Empty) → xem từng feature spec + `screens/` handoff.

### 2.1 Permission Matrix

| Area | Role required | Notes |
|------|---------------|-------|
| `/dashboard/**` | `TenantAdmin` | Tenant-scoped RLS + app-level authz |
| `/dashboard/settings` | `TenantOwner` | Secrets, billing, bot/channel config |
| `/dashboard/payments` | `TenantAdmin` with payment permission | Manual allocation/reversal audited |
| `/discover/**` | Public | Reads public DTO only, no tenant-private tables |
| `/discover/:id/join` | Authenticated person or magic-link session | Join rechecks canonical session transactionally |
| `/me/**` | Authenticated person | Person-scoped, not tenant-admin scoped |
| `/api/reproject` | PlatformAdmin | Audited, rate-limited |

---

## 3. Auth Flow (DD-13 ✅ — phase-1)

```
Landing → chọn provider:
  ├── Google OAuth  → /auth/google/callback   → verify id_token (google.sub)
  └── Email/password → POST /auth/email        → verify credential (bảng riêng)
  → account_identities lookup/create (platform ∈ {google, email}) → Person resolve
  → Set httpOnly session cookie (access 15m + refresh 30d)
  → Redirect: có tenant? → /dashboard : /onboarding hoặc /discover
```

- **Bỏ TG Login adapter** (DD-37). `account_identities.platform ∈ { google, email, facebook(DD-33), zalo(DD-14) }`; SI-2 keyed-hash cho `google.sub`/email (DD-31).
- **Link tài khoản:** person có thể link **Facebook** (DD-33 🟡) + **Zalo** (DD-14 ⬜) vào cùng Person qua verified account identity hoặc transactional one-time `/link` code, không auto-link bằng tên/owner/CK. DD-50: phase-1 không thu SĐT; phone dormant.

---

## 4. Realtime (SSE)

```
GET /api/sse?token=xxx
  → Server-Sent Events stream
  → Events: session.updated, player.joined, payment.settled, ...
  → Client reconnect tự động (EventSource built-in)
  → Fallback: polling 10s nếu SSE fail
```

Web projector nhận outbox events → push qua SSE → dashboard cập nhật realtime.

### 4.1 SSE Topic Contract

| Topic | AuthZ | Events |
|-------|-------|--------|
| `tenant:<tenantId>` | TenantAdmin | `session.updated`, `player.joined`, `payment.settled`, `sync.warning` |
| `person:<personId>` | Same authenticated person | `my.session.updated`, `my.payment.settled`, `my.join_request.updated` |
| `public:discover` | Public disabled by default | Prefer refetch/cache invalidation, not open broadcast |

SSE payload chỉ chứa invalidation/minimal DTO. Client refetch canonical API để tránh stale sensitive data.

Example:

```json
{
  "event": "session.updated",
  "topic": "tenant:...",
  "aggregateId": "session_opaque_id",
  "version": 12,
  "occurredAt": "2026-06-20T08:00:00.000Z"
}
```

---

## 5. Design System

→ **Bắt đầu design FE:** [`./designer-kickoff.md`](./designer-kickoff.md) (🟡 — entry point: gói tài liệu + thứ tự system→screens + checklist nghiệm thu).
→ Tokens (SoT): [`../../standards/design-tokens.md`](../../standards/design-tokens.md). Bản `./design-tokens.md` là surface note — 🟡 DD-59 đề xuất trỏ hẳn về SoT để tránh drift.
→ Kiến trúc FE: [`../../standards/frontend-architecture.md`](../../standards/frontend-architecture.md) (🟡 DD-57).
→ Pipeline visual-source→code: [`./frontend-pipeline.md`](./frontend-pipeline.md) (🟡 DD-58; visual SoT mới chưa chốt).
→ Benchmark method: [`../../standards/design-tokens-benchmark.md`](../../standards/design-tokens-benchmark.md) (🟡 DD-59).
→ API convention: [`../../standards/api-reference-convention.md`](../../standards/api-reference-convention.md) (🟡 DD-60).

Quy tắc:
- **Mọi color/spacing/typography = CSS variable** — không hardcode hex/rgba
- **Google Fonts:** Inter (body), Outfit (headings)
- **Dark mode:** support via `prefers-color-scheme` + manual toggle
- **Responsive:** 375px / 768px / 1440px breakpoints
- **Touch targets:** min 44x44px
- **Animations:** micro-interactions cho state changes, hover effects

---

## 6. Folder Structure (code)

```
apps/web/
├── api/
│   ├── auth/          ← Google OAuth + email/password, session, refresh, link Facebook/Zalo
│   ├── sessions/      ← CRUD, join
│   ├── payments/      ← ledger, allocate, reverse, cash
│   ├── members/       ← membership, merge
│   ├── tenants/       ← config, bank accounts
│   ├── discover/      ← marketplace (public, no RLS)
│   └── sse/           ← Server-Sent Events
│
├── dashboard/         ← host UI pages
├── discover/          ← marketplace UI pages
├── player/            ← player view pages
├── shared/            ← shared components, layouts
│
├── styles/
│   ├── index.css      ← design tokens + reset
│   └── components/    ← component-specific CSS
│
└── public/            ← static assets
```

## 7. API DTO Baseline

All APIs return JSON envelope:

```json
{
  "data": {},
  "error": null,
  "meta": { "requestId": "req_..." }
}
```

Errors:

```json
{
  "data": null,
  "error": {
    "code": "CSRF_INVALID",
    "message": "Yêu cầu không hợp lệ",
    "statusCode": 403
  },
  "meta": { "requestId": "req_..." }
}
```

### 7.1 Public Discovery DTO

```json
{
  "id": "pubsess_opaque",
  "sportKey": "badminton",
  "startsAt": "2026-06-20T12:00:00.000Z",
  "endsAt": "2026-06-20T14:00:00.000Z",
  "area": "Quận 7",
  "skillLevel": "intermediate",
  "priceAmount": 90000,
  "slotsOpen": 3,
  "clubDisplayName": "Bestminton",
  "hostDisplayName": "Ngoc-Anh",
  "joinPolicy": "open"
}
```

Excluded from public DTO: `tenant_id`, exact venue, roster, bank info, phone/email, charge/payment status.

### 7.2 Command Write Contract

Every mutation includes `commandId`:

```json
{
  "commandId": "cmd_client_uuid",
  "payload": {}
}
```

Duplicate `commandId` returns previous semantic result. UI must not retry with a new command id unless the user intentionally performs a new action.

---

## 8. Implementation Readiness

| Hạng mục | Status | Ghi chú |
|----------|--------|---------|
| Surface map | ✅ Good | Routes/auth/data scopes rõ |
| Product specs | ✅ Reviewed | Auth/onboarding, sync, marketplace, player view |
| BE specs | ✅ Reviewed | DDL/API/test plans cho core flows |
| Missing before UI build | 🟡 Medium | Screen handoffs, component inventory, exact copy, empty/error illustrations |
| Missing before API build | 🟡 Medium | Final table names after P0, DTO schemas in code, auth middleware |
| Delivery readiness | 🟡 Low/Medium | Scaffold được sớm, full feature phụ thuộc P0–P4 backend |

**Go/no-go:** Có thể scaffold `apps/web` sớm với auth/discover/dashboard shells. Không build payment/manual allocation UI sâu trước khi ledger + domain services ổn.

---

## 9. Cross-references

| Topic | Doc |
|-------|-----|
| Auth + onboarding | [feature_web_auth_onboarding.md](../../features/feature_web_auth_onboarding.md) |
| Sync engine (command/outbox/SSE) | [feature_sync_engine.md](../../features/feature_sync_engine.md) |
| Marketplace discovery | [feature_marketplace_discovery.md](../../features/feature_marketplace_discovery.md) |
| Player view | [feature_player_view.md](../../features/feature_player_view.md) |
| Cross-club join | [feature_cross_club_join.md](../../features/feature_cross_club_join.md) |
| Session management | [feature_session_management.md](../../features/feature_session_management.md) |
| Payment reconcile | [feature_payment_reconcile.md](../../features/feature_payment_reconcile.md) |
| Design tokens | [design-tokens.md](./design-tokens.md) |
| Native app strategy | [native-app-strategy.md](../../strategy/native-app-strategy.md) |

---

## 10. Changelog

| Date | Version | Thay đổi |
|------|---------|----------|
| 2026-07-10 | v0.3 | **v3.4 pivot (DD-37 ✅):** auth = Google + email (DD-13 ✅, bỏ TG Login) + link Facebook (DD-33 🟡)/Zalo (DD-14 ⬜); surfaces phase-1 = web + Zalo + Messenger (Telegram loại); web thêm surface chat in-app (DD-38 🟡), settings/giá theo giới tính (DD-39 🟡), mark-paid thủ công (DD-40 ✅). Cập nhật §1/§2/§3/§6. |
| 2026-06-20 | v0.2 | Chốt Next.js App Router baseline, thêm permission matrix, SSE topics, DTO/API contract, readiness |
| 2026-06-19 | v0.1 | Initial surface docs |

*Web app surface docs v0.3. Screen handoffs sẽ được tạo per-screen trong `screens/` trước P4.*
