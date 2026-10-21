# Plexco

> Platform quản lý & khám phá hoạt động thể thao đa môn (host + player), tích hợp **Zalo · Facebook Messenger** + Web app (Telegram loại khỏi phạm vi — DD-37).

| | |
|---|---|
| **Phiên bản** | v0.0.2 — Foundation + shared job mechanics merged; product runtime chưa nối |
| **Trạng thái** | 🟡 `main@1215a6a` (25/08/2026): monorepo + **migrations `0000–0033`** (34 file) đã merge; Google auth/session security, waitlist schema, tenant-integrity FK, job lease/ack, worker preflight/dispatcher/scheduler, chat DB root (`0030`–`0032`), `authorizeTenantAction` (đã có caller production), DD-29 capability registry 2-tier + resolver `resolveCapability()` (reader đầu tiên, chưa caller), **`public_projection_fences` + guarded view `public_session_share_v` (`0033` — base SELECT trên `public_sessions` đã REVOKE khỏi `readonly`/`app`)**, 3 session command (`create`/`publish`/`announce`) và FE-foundation core (`api-contract` + sealed `toAppError`) đã có. Scheduler mặc định **OFF**, delivery vẫn placeholder fail-closed; chưa có business API route, connected product FE hay projector nghiệp vụ; FE đang **PENDING** (DD-116). Chi tiết: [BUILD-STATUS.md](./docs/standards/BUILD-STATUS.md). |
| **Ngày tạo** | 18/06/2026 |
| **Stack** | TypeScript · Next.js App Router · Zalo/Messenger HTTP adapters *(target — chưa build)* · Drizzle ORM · PostgreSQL (RLS) · pg-boss · SSE/`LISTEN/NOTIFY` (DD-07/DD-10) |
| **Monorepo** | pnpm workspaces: `packages/core` · `apps/bot` · `apps/web` |

---

## Positioning

**Plexco** là platform **2 phía** cho hoạt động thể thao phong trào đa môn:

- **Host (chủ CLB):** tạo & quản kèo, roster, **thu & đối soát CK** (thủ công toàn cầu; tự động chỉ khi entitlement + market/provider/bank/currency/consent cùng hợp lệ) — qua web và các kênh được enable.
- **Player:** **khám phá kèo** đang mở (đa môn, cross-CLB), join, theo dõi kèo & nợ — xuyên CLB.

Zalo/Messenger là kênh acquisition/fallback; **In-app Chat là target primary daily player surface** sau khi DD-86/DD-91, safety, runtime và exit gates được đóng. Đây là hướng sản phẩm/decision WIP, chưa phải runtime. PostgreSQL + domain model là **canonical store**; mọi surface chỉ consume cùng command/outbox/projector contracts.

---

## Tech Stack

| Layer | Tech | Ghi chú |
|---|---|---|
| **Core** (logic thuần) | TypeScript | `packages/core` — matching, payments-logic, dates, format, i18n, sports |
| **Bot** | Zalo/Messenger adapters vẫn là target; `apps/bot` live đã có pg-boss queues, fail-closed preflight, outbox dispatcher và scheduler gated | Default commit `OUTBOX_DISPATCH_SCHEDULE_ENABLED=true` trong `.env.example` từ 21/10 (B3, DD-141); worker chỉ lên lịch khi cờ đúng chuỗi `"true"` và probe registry qua; mọi projector seed tắt (migration 0056) nên chu kỳ dispatch chạy mà không deliver gì, gửi thật cần bước P0 của owner; chưa có channel adapter, producer hay real projector |
| **Web** | Next.js App Router, standalone/container; SSE | `apps/web` — surface dashboard + discovery (DD-07/DD-10) |
| **Database** | PostgreSQL + Drizzle ORM | RLS fail-closed, `tenantRepo` choke-point |
| **Queue** | pg-boss | Cron, jobs trên Postgres |
| **Infra** | Docker (Postgres local), DigitalOcean App Platform + Managed PostgreSQL HA/VPC target (DD-04) | Còn egress-IP verification, provisioning, restore/failover drill và production enablement evidence |

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

> Baseline hiện tại là `main@1215a6a` (25/08/2026): monorepo, `.env.example`, local Postgres, `packages/db` + **migrations `0000–0033`** (34 file). Shared job mechanics đã có nhưng còn disabled/placeholder; tầng product feature vẫn chưa có business route/connected FE (xem [BUILD-STATUS.md](./docs/standards/BUILD-STATUS.md)).

### Prerequisites

- Node.js ≥ 22.x
- pnpm ≥ 9.x
- Docker (cho PostgreSQL dev)
- Google OAuth client + email/password; phép đo completion-hop trên Safari macOS/iOS đã PASS, nhưng secrets/config/staging/product E2E vẫn là enablement gates riêng
- Facebook App cho account-link/Messenger khi adapter tương ứng land
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
# Điền DATABASE_URL*, auth/provider secrets và KMS theo lane thực sự cần chạy.
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
| `DATABASE_URL_MIGRATION=... pnpm --filter @plexco/db migrate` | Apply canonical migrations bằng DDL-owner role (tail hiện tại: `0033`) |
| `DATABASE_URL_MIGRATION=... pnpm --filter @plexco/bot provision:queue` | Provision pg-boss schema/queues sau migrations |
| `pnpm --filter @plexco/db exec drizzle-kit studio` | Drizzle Studio (dev only) |
| `pnpm lint` | Lint toàn monorepo |
| `pnpm dev:seed` | Tạo CLB "Dev Club" + 3 persona dev (chỉ DB local, idempotent) — xem Dev-login |

### Dev-login (chỉ máy local, không cần Google OAuth)

Đăng nhập bằng persona giả (owner/host, co_admin, player của CLB "Dev Club", email `@dev.invalid`) qua
**đúng đường của Google sign-in** (account → Person → `issueSession()`, cùng cookie/CSRF/`authorize()`/RLS).
Chỉ mở khi đủ: `next dev` (NODE_ENV=development) · `PLEXCO_DEV_LOGIN=1` · `TRUSTED_INGRESS_PROVIDER=direct` ·
dev server chạy **đúng** `-H 127.0.0.1` (bắt buộc; `localhost`, `::`, `::1` hay không `-H` đều bị từ chối) ·
`DATABASE_URL` trỏ localhost/127.0.0.1/[::1]/`postgres` **và** database đã opt-in ở cấp database
(`plexco.dev_login = 'on'`) · kết nối bằng role `app` (không superuser/BYPASSRLS) · Host loopback, không header
forwarding. Thiếu một điều kiện ⇒ 404.

```bash
# một lần, bằng superuser hoặc role được GRANT SET ON PARAMETER plexco.dev_login (từ PG 15, owner của DB
# không có grant đó bị "permission denied to set parameter"); KHÔNG làm trên DB dùng chung/staging:
docker compose -f infra/docker-compose.yml exec -T postgres \
  psql -U plexco -d plexco -c "ALTER DATABASE plexco SET plexco.dev_login = 'on'"
export ENCRYPTION_KEY="$(openssl rand -base64 32)"   # tạo MỘT lần, dùng chung cho seed và dev server
DATABASE_URL=postgres://app:plexco_dev_app@localhost:5432/plexco pnpm dev:seed
PLEXCO_DEV_LOGIN=1 TRUSTED_INGRESS_PROVIDER=direct DB_EXPECTED_ROLE=app KMS_PROVIDER=local \
  DATABASE_URL=postgres://app:plexco_dev_app@localhost:5432/plexco \
  pnpm --filter @plexco/web exec next dev -H 127.0.0.1 -p 3000
# mở http://localhost:3000/dev-login (Next chuyển hướng về http://localhost:3000/... dù mở bằng 127.0.0.1)
```

⚠️ Chỉ truyền `PLEXCO_DEV_LOGIN` trên dòng lệnh `next dev`, đừng đặt vào `.env*`: có mặt (kể cả giá trị rỗng)
khi NODE_ENV khác `development` ⇒ `next build`/`next start` từ chối khởi động; CI (`pnpm guard:dev-login`, chạy
trong `pnpm test`) chặn biến này trong mọi file cấu hình deploy/container/CI (danh sách glob nằm ở đầu
`scripts/check-dev-login-exclusion.mjs`). Việc kiểm "DB là local" theo tên host chỉ là lọc sơ bộ: một port-forward
(`ssh -L`, `kubectl port-forward`, `fly proxy`) tới DB dùng chung cũng có host `localhost`, nên opt-in ở **cấp
database** (đọc từ catalog, không phải giá trị session) mới là điều kiện quyết định — đừng bao giờ chạy lệnh
`ALTER DATABASE … plexco.dev_login` trên DB dùng chung. `RESET` có hiệu lực ngay từ request kế tiếp.

Khi `/dev-login` trả 404 dù đã đặt `PLEXCO_DEV_LOGIN`, log của dev server (chỉ console, không bao giờ trong response)
có dòng `auth.dev_login.gate_closed` ghi lý do và cách sửa (`bind` = thiếu `-H 127.0.0.1`, `database_not_opted_in`, ...).

Giới hạn đã biết:
- **Residual owner đã chấp nhận** (owner, 2026-10-15, "S5 A2 waived"): khi dev-login đang bật, mọi lần từ chối
  trên prefix `/internal-dev-login` (khớp không phân biệt hoa/thường và percent-encoding) là 404 rỗng thay cho
  trang 404 HTML của framework: kiểm tra theo từng request thất bại, method không phải route (vd. PROPFIND), và
  các lần handler từ chối (probe lộ mạng, DB guard). Khi gate mở, `/dev-login` còn 307 sang
  `/internal-dev-login/page` trước. Những điều đó cho biết dev-login đang bật, nhưng không ai đăng nhập được qua đó.
- **Audit:** mỗi POST dev-login tới được definer ghi một dòng `auth_audit_events` của definer (thường là
  `login_success / success / google`; cell 7 ghi `identity_conflict / conflict`), kể cả khi sau đó POST kết thúc ở
  reauth do cookie cũ; chỉ `request_ref` `dev_login_<uuid>` đánh dấu là dev. Mỗi lần chạy seed thêm 3 dòng
  `dev_seed_<uuid>`. Owner đã từ chối migration `auth_audit_dev_login` (2026-10-15), nên đây là giới hạn đã biết.

---

## Port Registry

> ⚠️ **Code baseline (`main@784bc8d`):** web hiện có health/auth/onboarding routes, chưa có business route. Messenger/Zalo/SePay webhook bên dưới vẫn là **spec/target**. `apps/bot` có shared job mechanics nhưng ~~schedule OFF~~ ⛔ **HẾT HIỆU LỰC 21/10 (DD-141)** — default commit nay `OUTBOX_DISPATCH_SCHEDULE_ENABLED=true` (`.env.example`); chỉ đúng chuỗi `"true"` mới bật; registry seed 0056 tắt mọi projector nên chu kỳ dispatch chạy mà không deliver gì và chưa có producer/projector nghiệp vụ. Xem [BUILD-STATUS.md](./docs/standards/BUILD-STATUS.md).

| Service | Port | Ghi chú |
|---|---|---|
| Web app (Next.js) | 3000 | Dashboard + API routes + SSE |
| Messenger webhook *(spec)* | 3000 `/webhook/messenger` | Hybrid central/optional club Page; protected context routing; Meta App Review |
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
| [BRD.md](./docs/product/BRD.md) | Yêu cầu nghiệp vụ (cái gì & vì sao) | v3.9j |
| [PRD.md](./docs/product/PRD.md) | User flows + edge cases | v2.8i |
| [TDD.md](./docs/product/TDD.md) | Thiết kế kỹ thuật (schema, RLS, ledger, routing, sync) | v3.1d |
| [ROADMAP.md](./docs/product/ROADMAP.md) | Canonical phases + KPIs + dependency map | v3.4h |

### 📐 Standards (`docs/standards/`)

| Tài liệu | Mô tả | Phiên bản |
|---|---|---|
| [HANDOFF.md](./docs/00-start-here/HANDOFF.md) | Tài liệu tiếp quản cho dev/AI mới | v1.26 |
| [business-rules.md](./docs/standards/business-rules.md) | Business rules tổng hợp (ID'd, cross-ref) | v1.28 |
| [design-tokens.md](./docs/standards/design-tokens.md) | CSS variables, colors, typography | v1.1 |
| [feature-dependency-graph.md](./docs/standards/feature-dependency-graph.md) | Mermaid dependency graph + current delivery overlay | v1.12 |
| [BUILD-STATUS.md](./docs/standards/BUILD-STATUS.md) | Đã build vs. đã spec (living snapshot) | 2026-07-28 |
| [review-code-readiness-gate.md](./docs/standards/review-code-readiness-gate.md) | Gate chuẩn cho review/plan/code readiness | v1.3 |

### 📎 Research & Strategy (`docs/research/` · `docs/strategy/`)

| Tài liệu | Mô tả | Phiên bản |
|---|---|---|
| [saas-implementation-plan.md](./docs/strategy/saas-implementation-plan.md) | Kiến trúc multi-tenant chi tiết | v1.9 |
| [player-side-saas-reconciliation.md](./docs/research/player-side-saas-reconciliation.md) | Identity, kênh, matching | v2 |
| [player-side-saas-AUDIT.md](./docs/research/player-side-saas-AUDIT.md) | Bảo mật, threat model (C1-C8, B1-B6) | v1 |
| [messenger-channel-design.md](./docs/channels/messenger/messenger-channel-design.md) | Kênh Messenger (phase-1 P2.5, DD-32 shared booking gate, Meta App Review) | v2.5 |
| [saas-pnl-model.xlsx](./docs/strategy/saas-pnl-model.xlsx) | PnL model | — |
| [native-app-strategy.md](./docs/strategy/native-app-strategy.md) | Native iOS/Android — impact analysis, push, auth | v1.9 |

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
| Player Messenger (thay Telegram — DD-37) | [feature_player_messenger.md](./docs/features/feature_player_messenger.md) | [feature_player_messenger_tech.md](./docs/features/BE/feature_player_messenger_tech.md) | P2.5/P4.5 |
| ~~Player Telegram~~ (Archived — DD-37) | ~~[feature_player_telegram.md](./docs/features/feature_player_telegram.md)~~ | ~~[feature_player_telegram_tech.md](./docs/features/BE/feature_player_telegram_tech.md)~~ | ~~P4.5~~ |
| Player View | [feature_player_view.md](./docs/features/feature_player_view.md) | [feature_player_view_tech.md](./docs/features/BE/feature_player_view_tech.md) | P4.6 |
| Zalo Channel | [feature_zalo_channel.md](./docs/features/feature_zalo_channel.md) | [feature_zalo_channel_tech.md](./docs/features/BE/feature_zalo_channel_tech.md) | P4.7 |
| Billing Lifecycle | [feature_billing_lifecycle.md](./docs/features/feature_billing_lifecycle.md) | [feature_billing_lifecycle_tech.md](./docs/features/BE/feature_billing_lifecycle_tech.md) | P5 |
| Security & Operations | [feature_security_operations.md](./docs/features/feature_security_operations.md) | [feature_security_operations_tech.md](./docs/features/BE/feature_security_operations_tech.md) | P6 |
| Connector Onboarding | [feature_connector_onboarding.md](./docs/features/feature_connector_onboarding.md) | [feature_connector_onboarding_tech.md](./docs/features/BE/feature_connector_onboarding_tech.md) | P3/P4/P4.7 · Draft |
| In-app Chat (DD-38/DD-86/DD-91/DD-92..95) | [feature_inapp_chat.md](./docs/features/feature_inapp_chat.md) | [feature_inapp_chat_tech.md](./docs/features/BE/feature_inapp_chat_tech.md) | P4 · Reviewed contract; runtime pending |
| User Settings & Profile (DD-39/47/48) | [feature_user_settings.md](./docs/features/feature_user_settings.md) | [feature_user_settings_tech.md](./docs/features/BE/feature_user_settings_tech.md) | P4 · Draft (tracked; pending migration/build) |
| Channel Booking Funnel (DD-32 Option D) | [feature_channel_booking_funnel.md](./docs/features/feature_channel_booking_funnel.md) | [feature_channel_booking_funnel_tech.md](./docs/features/BE/feature_channel_booking_funnel_tech.md) | P2.5/P4.3/P4.7 · Reviewed contract; `NOT_CODE_READY`, runtime pending |
| Club Assistant (RAG/KB) | [feature_club_assistant.md](./docs/features/feature_club_assistant.md) | [feature_club_assistant_tech.md](./docs/features/BE/feature_club_assistant_tech.md) | P7 |

### 📝 Templates (`templates/`)

| Template | Mô tả |
|---|---|
| [design-tokens.md](./docs/templates/design-tokens-template.md) | Template design tokens |
| [feature-checklist.md](./docs/templates/feature-dev/feature-checklist.md) | Checklist dev cho mỗi feature |
| [feature-dependency-graph.md](./docs/templates/feature-dev/feature-dependency-graph-TEMPLATE.md) | Template dependency graph |

### 🖥️ Surface Docs

| Surface | Folder | Nội dung | Version |
|---------|--------|---------|---------|
| Web App | [docs/channels/web/](./docs/channels/web/) | Screen map, auth, SSE, [design-tokens](./docs/channels/web/design-tokens.md) | v0.5 |
| ~~Telegram Bot~~ | [docs/channels/telegram/](./docs/channels/telegram/) | **Archived (DD-37)** — chỉ tham chiếu lịch sử | v0.2 |
| Zalo Bot | [docs/channels/zalo/](./docs/channels/zalo/) | BYO token, DM-only, reply-context, DD-32 link-or-pay booking gate | v0.7 |
| Messenger Bot | [docs/channels/messenger/](./docs/channels/messenger/) | **Phase-1 (P2.5)**, DD-32 link-or-pay booking gate, 24h window, Meta App Review | v0.7 |

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
| **Scripts** | `sync-embedded.mjs` · `linear-contract.mjs` · `compare-linear.mjs` · `linear-sync.mjs` · `gen-linear-csv.mjs` | Đồng bộ EMBEDDED · validate contract · so drift · pull Linear→progress · seed CSV |
| **CI** | [.github/workflows/linear-sync.yml](./.github/workflows/linear-sync.yml) | Mirror Linear → progress.json (push/webhook/cron) |

**Ownership theo field:** `progress.json` giữ roadmap/gate/invariant/module + subtask title/khoá; **Linear** [Plexco MVP](https://linear.app/maingocanh1/project/plexco-mvp-5a5336c896c5) giữ status qua issue `[M#]` + sub-issue. Khoá nối = prefix `[M#]`/`linearId`; thiếu/trùng ID hoặc lệch title làm compare/sync fail-closed. Trạng thái suy từ hoạt động git, không bấm tay.

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

*Plexco v0.0.2 — `main@1215a6a` (25/08/2026), migrations `0000–0033` (34 file), canonical runner authority 854 workspace + 30 readiness-validator PASS (@ `93f1e93`, 15/08; suite sau merge 25/08 đo informal 919 workspace + 30 validator, chưa re-pin). Shared job mechanics đã merge nhưng còn disabled/placeholder; product business runtime và connected FE chưa có (FE PENDING — DD-116). Build-status: [BUILD-STATUS.md](./docs/standards/BUILD-STATUS.md).*
