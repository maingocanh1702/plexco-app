# Plexco

> Platform quản lý & khám phá hoạt động thể thao đa môn (host + player), tích hợp **Zalo · Facebook Messenger** + Web app (Telegram loại khỏi phạm vi — DD-37).

| | |
|---|---|
| **Phiên bản** | v0.0.1 — Foundation merged, feature build in progress |
| **Trạng thái** | 🟢 Scaffold + foundation ĐÃ CÓ: monorepo (`packages/*`,`apps/*`) + **migrations 0000–0013** (RLS/auth/onboarding) đã merge trên `main@1eb6f60`; Auth v3 (Telegram-era) landed → **DD-37 provider replacement (Google/email + Zalo/Messenger) đang chờ**. Docs: 14 active Reviewed + 3 Draft phase-1 chưa commit; Telegram archived (DD-37). Chi tiết: [BUILD-STATUS.md](./docs/standards/BUILD-STATUS.md). |
| **Ngày tạo** | 18/06/2026 |
| **Stack** | TypeScript · Next.js App Router · Zalo/Messenger HTTP adapters · Drizzle ORM · PostgreSQL (RLS) · pg-boss · SSE/`LISTEN/NOTIFY` (DD-07/DD-10) |
| **Monorepo** | pnpm workspaces: `packages/core` · `apps/bot` · `apps/web` |

---

## Positioning

**Plexco** là platform **2 phía** cho hoạt động thể thao phong trào đa môn:

- **Host (chủ CLB):** tạo & quản kèo, roster, **thu & đối soát CK** (thủ công mọi tier · tự động host_pro) — ngay trong Zalo/Messenger và web (Telegram loại khỏi phạm vi — DD-37).
- **Player:** **khám phá kèo** đang mở (đa môn, cross-CLB), join, theo dõi kèo & nợ — xuyên CLB.

**Gặp người dùng ở nơi họ đã ở** (0 cài app cho player). PostgreSQL + domain model là **canonical store**; web và các kênh chat là surface được đồng bộ qua command/outbox/projector.

---

## Tech Stack

| Layer | Tech | Ghi chú |
|---|---|---|
| **Core** (logic thuần) | TypeScript | `packages/core` — matching, payments-logic, dates, format, i18n, sports |
| **Bot** | Zalo HTTP + Facebook Messenger HTTP adapters (Telegram bỏ — DD-37) | `apps/bot` |
| **Web** | Next.js App Router, standalone/container; SSE | `apps/web` — surface dashboard + discovery (DD-07/DD-10) |
| **Database** | PostgreSQL + Drizzle ORM | RLS fail-closed, `tenantRepo` choke-point |
| **Queue** | pg-boss | Cron, jobs trên Postgres |
| **Infra** | Docker (Postgres local), managed Postgres + app host | Provider chờ OD-4 |

---

## Architecture (High-level)

```
┌──────────────────────────────────────────────────────┐
│                    Surfaces                          │
│        Zalo  ·  Messenger  ·  Web  ·  SePay           │
└──────────┬──────────┬───────────┬─────────┬──────────┘
           │          │           │         │
      ┌────▼──────────▼───────────▼─────────▼────┐
      │   Tenant-resolve middleware + Authz       │
      │   Command bus → Services → tenantRepo     │
      │   Outbox → Projectors (sync fan-out)      │
      └─────────────────────┬────────────────────┘
                            │
      ┌─────────────────────▼────────────────────┐
      │   PostgreSQL (RLS)                       │
      │   ┌──────────┐ ┌──────────┐ ┌─────────┐ │
      │   │ GLOBAL   │ │ TENANT   │ │ PUBLIC  │ │
      │   │ identity │ │ $$, RLS  │ │ read    │ │
      │   │ sports   │ │ fail-    │ │ model   │ │
      │   │ persons  │ │ closed   │ │ no $$   │ │
      │   └──────────┘ └──────────┘ └─────────┘ │
      └──────────────────────────────────────────┘
```

**3 tầng hiển thị:**
1. **Public discovery** — kèo công khai (môn, giờ, khu vực, giá, slot) — ai cũng đọc, KHÔNG tiền/PII.
2. **Tenant-private** — tiền/nợ/roster/đối soát — chỉ trong tenant (RLS).
3. **Person-self** — "club & nợ của chính tôi" xuyên CLB — chỉ chủ nhân.

---

## Setup theo code hiện tại

> Scaffold ĐÃ CÓ trên `main@1eb6f60`: monorepo (`package.json`, `pnpm-workspace.yaml`), `.env.example`, `infra/docker-compose.yml`, `packages/db` + **migrations 0000–0013**. Các lệnh dưới đây là script có thật trên HEAD; phần lớn tầng feature còn ở spec/Draft (xem [BUILD-STATUS.md](./docs/standards/BUILD-STATUS.md)).

### Prerequisites

- Node.js ≥ 22.x
- pnpm ≥ 9.x
- Docker (cho PostgreSQL dev)
- **Hiện tại:** Telegram bot token cho auth-v3 legacy đang chạy trên HEAD
- **Target DD-37:** Google OAuth client + email/password; Facebook App cho account-link/Messenger khi các adapter tương ứng land
- Zalo bot token per-club (onboarding)
- SePay/ApiPay account (nhận webhook CK)

### Khởi tạo

```bash
# 1. Clone + install
git clone <repo-url> && cd plexco-app
pnpm install

# 2. Postgres local
docker compose -f infra/docker-compose.yml up -d postgres

# 3. Env
cp .env.example .env
# Điền DATABASE_URL*, TELEGRAM_BOT_TOKEN cho auth-v3 hiện tại và secrets/KMS.
# KHÔNG lưu DATABASE_URL_MIGRATION trong .env; chỉ truyền ad-hoc cho DDL tooling.

# 4. Database
DATABASE_URL_MIGRATION=postgres://plexco:plexco_dev@localhost:5432/plexco \
  pnpm --filter @plexco/db migrate
DATABASE_URL_MIGRATION=postgres://plexco:plexco_dev@localhost:5432/plexco \
  pnpm --filter @plexco/bot provision:queue

# 5. Dev
pnpm --filter @plexco/web dev
# Worker (terminal khác, sau khi đã provision queue):
pnpm --filter @plexco/bot start:worker
```

### Commands

| Command | Mô tả |
|---|---|
| `pnpm --filter @plexco/web dev` | Start Next.js web dev server |
| `pnpm --filter @plexco/bot start:worker` | Start pg-boss worker (sau khi provision queue) |
| `pnpm build` | Build tất cả packages |
| `pnpm test` | Chạy unit + integration tests trên Postgres test database |
| `pnpm typecheck` | `tsc --noEmit` toàn monorepo |
| `DATABASE_URL_MIGRATION=... pnpm --filter @plexco/db migrate` | Apply canonical migrations `0000–0013` bằng DDL-owner role |
| `DATABASE_URL_MIGRATION=... pnpm --filter @plexco/bot provision:queue` | Provision pg-boss schema/queues sau migrations |
| `pnpm --filter @plexco/db exec drizzle-kit studio` | Drizzle Studio (dev only) |
| `pnpm lint` | Lint toàn monorepo |

---

## Port Registry

| Service | Port | Ghi chú |
|---|---|---|
| Web app (Next.js) | 3000 | Dashboard + API routes + SSE |
| Messenger webhook | 3000 `/webhook/messenger` | Per-page routing (page_id → tenant); Meta App Review |
| Zalo webhook | 3000 `/webhook/zalo/:token` | Per-club token |
| SePay webhook | 3000 `/webhook/sepay/:token` | Per-bank token |
| PostgreSQL | 5432 | Docker compose |
| Drizzle Studio | 4983 | Dev only |

> Kiểm tra port trùng: `lsof -iTCP -sTCP:LISTEN -nP | grep LISTEN`

---

## Doc Map

### 📋 Core Specs (`docs/product/`)

| Tài liệu | Mô tả | Phiên bản |
|---|---|---|
| [BRD.md](./docs/product/BRD.md) | Yêu cầu nghiệp vụ (cái gì & vì sao) | v3.5 |
| [PRD.md](./docs/product/PRD.md) | User flows + edge cases | v2.4 |
| [TDD.md](./docs/product/TDD.md) | Thiết kế kỹ thuật (schema, RLS, ledger, routing, sync) | v2.4 |
| [ROADMAP.md](./docs/product/ROADMAP.md) | Canonical phases + KPIs + dependency map | v2.7 |

### 📐 Standards (`docs/standards/`)

| Tài liệu | Mô tả | Phiên bản |
|---|---|---|
| [HANDOFF.md](./docs/00-start-here/HANDOFF.md) | Tài liệu tiếp quản cho dev/AI mới | v1.0 |
| [business-rules.md](./docs/standards/business-rules.md) | Business rules tổng hợp (ID'd, cross-ref) | v1.7 |
| [design-tokens.md](./docs/standards/design-tokens.md) | CSS variables, colors, typography | v1.0 |
| [feature-dependency-graph.md](./docs/standards/feature-dependency-graph.md) | Mermaid dependency graph + matrix | v1.2 |
| [BUILD-STATUS.md](./docs/standards/BUILD-STATUS.md) | Đã build vs. đã spec (living snapshot) | 2026-07-15 |

### 📎 Research & Strategy (`docs/research/` · `docs/strategy/`)

| Tài liệu | Mô tả | Phiên bản |
|---|---|---|
| [saas-implementation-plan.md](./docs/strategy/saas-implementation-plan.md) | Kiến trúc multi-tenant chi tiết | v2 |
| [player-side-saas-reconciliation.md](./docs/research/player-side-saas-reconciliation.md) | Identity, kênh, matching | v2 |
| [player-side-saas-AUDIT.md](./docs/research/player-side-saas-AUDIT.md) | Bảo mật, threat model (C1-C8, B1-B6) | v1 |
| [messenger-channel-design.md](./docs/channels/messenger/messenger-channel-design.md) | Kênh Messenger (phase-1 P2.5, Meta App Review — DD-37) | v2.1 |
| [saas-pnl-model.xlsx](./docs/strategy/saas-pnl-model.xlsx) | PnL model | — |
| [native-app-strategy.md](./docs/strategy/native-app-strategy.md) | Native iOS/Android — impact analysis, push, auth | v1.0 |

### 🔧 Feature Docs (`docs/features/`)

Coverage and review status: [docs/features/README.md](./docs/features/README.md)

| Feature | Product (FE) | Tech (BE) | Phase |
|---|---|---|---|
| Multi-tenant Foundation | [feature_multi_tenant.md](./docs/features/feature_multi_tenant.md) | [feature_multi_tenant_tech.md](./docs/features/BE/feature_multi_tenant_tech.md) | P0–P1 |
| Tenant Routing & Authz | [feature_tenant_routing_authz.md](./docs/features/feature_tenant_routing_authz.md) | [feature_tenant_routing_authz_tech.md](./docs/features/BE/feature_tenant_routing_authz_tech.md) | P2 |
| Session Management | [feature_session_management.md](./docs/features/feature_session_management.md) | [feature_session_management_tech.md](./docs/features/BE/feature_session_management_tech.md) | P2/P4 |
| Payment Reconciliation | [feature_payment_reconcile.md](./docs/features/feature_payment_reconcile.md) | [feature_payment_reconcile_tech.md](./docs/features/BE/feature_payment_reconcile_tech.md) | P3 |
| Identity & Merge | [feature_identity.md](./docs/features/feature_identity.md) | [feature_identity_tech.md](./docs/features/BE/feature_identity_tech.md) | P3.5 |
| Notifications & Reminders | [feature_notifications_reminders.md](./docs/features/feature_notifications_reminders.md) | [feature_notifications_reminders_tech.md](./docs/features/BE/feature_notifications_reminders_tech.md) | P3/P4.5–P4.7 |
| Web Auth & Onboarding | [feature_web_auth_onboarding.md](./docs/features/feature_web_auth_onboarding.md) | [feature_web_auth_onboarding_tech.md](./docs/features/BE/feature_web_auth_onboarding_tech.md) | P4 |
| Sync Engine | [feature_sync_engine.md](./docs/features/feature_sync_engine.md) | [feature_sync_engine_tech.md](./docs/features/BE/feature_sync_engine_tech.md) | P4 |
| Marketplace Discovery | [feature_marketplace_discovery.md](./docs/features/feature_marketplace_discovery.md) | [feature_marketplace_discovery_tech.md](./docs/features/BE/feature_marketplace_discovery_tech.md) | P4.3 |
| Cross-club Join | [feature_cross_club_join.md](./docs/features/feature_cross_club_join.md) | [feature_cross_club_join_tech.md](./docs/features/BE/feature_cross_club_join_tech.md) | P4.3 |
| Player Messenger (thay Telegram — DD-37) | [feature_player_messenger.md](./docs/features/feature_player_messenger.md) | [feature_player_messenger_tech.md](./docs/features/BE/feature_player_messenger_tech.md) | P2.5 |
| ~~Player Telegram~~ (Archived — DD-37) | ~~[feature_player_telegram.md](./docs/features/feature_player_telegram.md)~~ | ~~[feature_player_telegram_tech.md](./docs/features/BE/feature_player_telegram_tech.md)~~ | ~~P4.5~~ |
| Player View | [feature_player_view.md](./docs/features/feature_player_view.md) | [feature_player_view_tech.md](./docs/features/BE/feature_player_view_tech.md) | P4.6 |
| Zalo Channel | [feature_zalo_channel.md](./docs/features/feature_zalo_channel.md) | [feature_zalo_channel_tech.md](./docs/features/BE/feature_zalo_channel_tech.md) | P4.7 |
| Billing Lifecycle | [feature_billing_lifecycle.md](./docs/features/feature_billing_lifecycle.md) | [feature_billing_lifecycle_tech.md](./docs/features/BE/feature_billing_lifecycle_tech.md) | P5 |
| Security & Operations | [feature_security_operations.md](./docs/features/feature_security_operations.md) | [feature_security_operations_tech.md](./docs/features/BE/feature_security_operations_tech.md) | P6 |

### 📝 Templates (`templates/`)

| Template | Mô tả |
|---|---|
| [design-tokens.md](./docs/templates/design-tokens-template.md) | Template design tokens |
| [feature-checklist.md](./docs/templates/feature-dev/feature-checklist.md) | Checklist dev cho mỗi feature |
| [feature-dependency-graph.md](./docs/templates/feature-dev/feature-dependency-graph-TEMPLATE.md) | Template dependency graph |

### 🖥️ Surface Docs

| Surface | Folder | Nội dung | Version |
|---------|--------|---------|---------|
| Web App | [docs/channels/web/](./docs/channels/web/) | Screen map, auth, SSE, [design-tokens](./docs/channels/web/design-tokens.md) | v0.1 |
| ~~Telegram Bot~~ | [docs/channels/telegram/](./docs/channels/telegram/) | **Archived (DD-37)** — chỉ tham chiếu lịch sử | v0.1 |
| Zalo Bot | [docs/channels/zalo/](./docs/channels/zalo/) | BYO token, DM-only, reply-context, webhook drift | v0.1 |
| Messenger Bot | [docs/channels/messenger/](./docs/channels/messenger/) | **Phase-1 (P2.5)**, 24h window, Meta App Review | v0.1 |

---

## Project Tracking & Automation

> Hệ thống theo dõi tiến độ + automation (hybrid `progress.json` ⇄ Linear). **Người mới đọc [onboarding.md](./docs/automation/onboarding.md) trước.**

**👉 Bắt đầu:** [onboarding.md](./docs/automation/onboarding.md) — toàn bộ context + cách vận hành (2 nguồn sự thật, 3 chế độ automation, cookbook).

| Nhóm | File | Vai trò |
|---|---|---|
| **Onboarding** | [onboarding.md](./docs/automation/onboarding.md) | Điểm vào của hệ tracking/automation |
| **Phương pháp** | [playbook.md](./docs/automation/playbook.md) | Cách thi công: nguyên tắc, cadence, 5 quality gate, 2 tuần đầu |
| **Backlog** | [product-backlog.md](./docs/automation/product-backlog.md) | Checklist DoD chi tiết M1–M6 |
| **Automation** | [automation-overview.md](./docs/automation/automation-overview.md) | Chi tiết 3 chế độ: on-demand · scheduled · realtime |
| **Tracker** | [progress.json](./progress.json) | Nguồn sự thật cấu trúc tiến độ; status mirror từ Linear khi realtime bật |
| **Dashboard** | [plexco-dashboard.html](./plexco-dashboard.html) | Bảng theo dõi self-contained (mở bằng browser) |
| **Scripts** | `sync-embedded.mjs` · `compare-linear.mjs` · `linear-sync.mjs` · `gen-linear-csv.mjs` | Đồng bộ EMBEDDED · so drift · pull Linear→progress · seed CSV |
| **CI** | [.github/workflows/linear-sync.yml](./.github/workflows/linear-sync.yml) | Mirror Linear → progress.json (push/webhook/cron) |

**Ownership theo field:** `progress.json` giữ roadmap/gate/invariant/subtask title/khoá; **Linear** [Plexco MVP](https://linear.app/maingocanh1/project/plexco-mvp-5a5336c896c5) giữ status qua issue `[M#]` + sub-issue. Khoá nối = prefix `[M#]`/`linearId`. Trạng thái suy từ hoạt động git, không bấm tay.

**Automation:** ① on-demand (nói Claude `break M8` / `mark M5 done`) · ② scheduled (`plexco-weekly-break`, Thứ 2) · ③ realtime (Linear×GitHub + Action `linear-sync` — kích hoạt khi repo GitHub có ở P0/M1).

---

## Contribution

1. Đọc [`docs/00-start-here/HANDOFF.md`](./docs/00-start-here/HANDOFF.md) trước khi code
2. Tạo feature branch, không sửa thẳng main
3. PR theo [`PULL_REQUEST_TEMPLATE.md`](./.github/PULL_REQUEST_TEMPLATE.md)
4. Commit format: `type(scope): mô tả` (xem HANDOFF §4)

---

## Source of Truth

```
Product scope/business rules: BRD
Behavior/user flows:        PRD
Implementation contract:    TDD
Delivery order/progress:     ROADMAP
Security:                    quy tắc nghiêm ngặt hơn giữa BRD và AUDIT
```

---

*Plexco v0.0.1 — foundation + Auth v3 (Telegram-era) + migrations 0000–0013 đã merge trên `main@1eb6f60`; DD-37 provider replacement (Google/email + Zalo/Messenger) đang chờ. Build-status thực tế: [BUILD-STATUS.md](./docs/standards/BUILD-STATUS.md).*
