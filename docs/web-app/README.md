# 🌐 Web App — Surface Docs

> **Surface:** plexco.app (web dashboard + marketplace + player view)
> **Deployable unit:** `apps/web`
> **Tech stack:** Next.js (hoặc Express + SSE — chốt tại OD-10) · vanilla CSS · Google Fonts
> **Version:** v0.1 · 2026-06-19
> **Refs:** `../core/TDD.md` §3.9 · `../features/feature_web_auth_onboarding.md` · `../features/feature_sync_engine.md` · `../features/feature_marketplace_discovery.md` · `../features/feature_player_view.md`

---

## 1. Vai trò trong hệ thống

Web app là **1 trong 4 surfaces** của Plexco (cùng TG bot, Zalo bot, Messenger). Tất cả surfaces ghi vào **cùng PostgreSQL canonical store** qua `packages/core` domain services.

```
plexco.app
├── /             → Landing + auth
├── /dashboard    → Host dashboard (tenant-scoped)
├── /discover     → Marketplace (public, cross-tenant)
├── /me           → Player view (person-scoped)
├── /onboarding   → Wizard tạo tenant
└── /api          → REST API cho web + native app (tương lai)
```

---

## 2. Screen Map

| Route | Screen | Auth | Data scope | Phase |
|-------|--------|------|-----------|-------|
| `/` | Landing + login (TG Login Widget) | Public | — | P4 |
| `/onboarding` | Wizard 4 bước (SePay, TG, Zalo, môn) | Authenticated | — | P4 |
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

---

## 3. Auth Flow

```
Landing → TG Login Widget → POST /auth/telegram { initData }
  → Verify HMAC (bot token) server-side
  → Account lookup/create → Person resolve
  → Set httpOnly session cookie (access 15m + refresh 30d)
  → Redirect: có tenant? → /dashboard : /onboarding hoặc /discover
```

Tương lai (P7 native): thêm Apple/Google Sign-In → cùng Account → Person pipeline.

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

---

## 5. Design System

→ Xem [design-tokens.md](./design-tokens.md) (CSS variables, typography, colors, spacing).

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
│   ├── auth/          ← TG Login, session, refresh
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

---

## 7. Cross-references

| Topic | Doc |
|-------|-----|
| Auth + onboarding | [feature_web_auth_onboarding.md](../features/feature_web_auth_onboarding.md) |
| Sync engine (command/outbox/SSE) | [feature_sync_engine.md](../features/feature_sync_engine.md) |
| Marketplace discovery | [feature_marketplace_discovery.md](../features/feature_marketplace_discovery.md) |
| Player view | [feature_player_view.md](../features/feature_player_view.md) |
| Cross-club join | [feature_cross_club_join.md](../features/feature_cross_club_join.md) |
| Session management | [feature_session_management.md](../features/feature_session_management.md) |
| Payment reconcile | [feature_payment_reconcile.md](../features/feature_payment_reconcile.md) |
| Design tokens | [design-tokens.md](./design-tokens.md) |
| Native app strategy | [native-app-strategy.md](../appendices/native-app-strategy.md) |

---

*Web app surface docs v0.1. Screen handoffs sẽ được tạo per-screen trong `screens/` trước P4.*
