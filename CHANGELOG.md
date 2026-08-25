# Changelog — Plexco

Mọi thay đổi đáng chú ý được ghi nhận ở đây.
Format theo [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
versioning theo [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased] — 08/08 → 25/08/2026

> Mốc thô cho giai đoạn sau v0.0.2 (tính tới `main@1215a6a`, 25/08/2026); nguồn sự thật tiến độ vẫn là
> `docs/standards/BUILD-STATUS.md` + `docs/00-start-here/HANDOFF.md`.

### Added (Code)

- Migrations `0030`–`0033` (tail `0033`, 34 file): chat DM-safety authority DD-55 `0030` · chat schema core DD-38/86 `0031` · DM-safety single-read DD-102 `0032` · **`public_projection_fences` + guarded view `public_session_share_v` + REVOKE base SELECT `public_sessions` khỏi `readonly`/`app` (DD-12 8a) `0033`**
- `session-service.ts`: 3 command đầu tiên `createSession` · `publishSession` · `announceSession` (+ cặp outbox producer có thứ tự); `authorizeTenantAction` có caller production
- **DD-29 capability resolver** `resolveCapability()` (`f2af39d`) — reader đầu tiên của capability registry (fail-closed, chưa có caller)
- Canonical runner authority: **854 workspace + 30 validator** PASS (@ `93f1e93`, 15/08); suite sau merge 25/08 đo informal 919 + 30

### Docs / Decisions

- decisions.md v2.19 → v2.42: DD-100..DD-117 (nổi bật: DD-107 autonomy protocol · DD-110/111 session command family · **DD-113 GTM re-sequencing PWA+Zalo song song** · **DD-114 phase-1 = 7 nhóm** · DD-115 Membership D1–D5 · **DD-116 FE PENDING vào decision log (Option B)** · DD-117 close/cancel fail-closed refuse) + 2 amendment DD-50
- A3 legal starter packet (`docs/legal/`, DRAFT) — PII data-class matrix + lawyer engagement brief; A3 là blocker phase-1 (DD-114 D5)

### Chưa có (đọc cho đúng)

- Vẫn 0 business API route · 0 màn FE (FE **PENDING** theo DD-116) · scheduler OFF · chưa projector nghiệp vụ · Google login chưa bật

## [v0.0.2] — 2026-08-07

> Entry gộp giai đoạn 18/06 → 07/08 (README đã tự nhận v0.0.2 từ trước; entry này đóng khoảng trống ghi nhận —
> chi tiết từng bước xem `docs/standards/BUILD-STATUS.md` + `docs/00-start-here/HANDOFF.md` changelog, đó mới là
> nguồn sự thật tiến độ; CHANGELOG này chỉ là mốc thô).

### Added (Code — foundation, chưa có product runtime)

- Monorepo pnpm: `packages/core` (logic thuần đã lift từ Bestminton + DD-87 `splitNameAmount` + `api-contract`/`app-error`) · `packages/db` (Drizzle + RLS choke-point `tenantRepo`) · `apps/web` (Next.js App Router; 8 auth route + 2 onboarding route) · `apps/bot` (pg-boss worker skeleton, scheduler OFF)
- Migrations `0000`–`0029` (30 file): foundation/RLS/grants/seeds `0000`–`0013` · waitlist `0014` · auth S4 `0015`–`0018` (Google + email lane, session rotation) · tenant-integrity FK DD-68 `0019`–`0021` · job lease/ack DD-89/90 `0022`–`0023` · public-capacity CHECK `0024` · CHECK naming `0025`–`0026` · `resolve_tenant_status_locked` `0027` · DD-29 capability registry `0028`–`0029`
- Test suite: canonical runner 683 (đo 07/08 tại `528540e`; 13 validator + 670 workspace) + 14 core tests sau đó (`5b2b8f5`); invariant tests RLS/public-whitelist/waitlist/migrate-race
- Review-readiness machine enforcement (`pnpm review:check`) + autopilot kit (scope-gate, codex review, backlog reconcile)

### Docs

- Authority stack BRD/PRD/TDD/ROADMAP + decisions.md tới v2.19 (DD-01..DD-99); 24 cặp feature spec Product/BE; 12 FE spec (Draft); Chat primary plan `PLAN_READY` tại `90d292d`

### Chưa có (đọc cho đúng)

- 0 business API route · 0 màn FE nối API · 0 Chat migration/API/UI · scheduler OFF, dispatcher placeholder · Google login chưa bật (owner go-live decision)

## [v0.0.1] — 2026-06-18

### Added (Planning & Docs)

**Core docs:**
- `docs/core/BRD.md` v3.1 — reposition thành platform đa môn 2 phía
- `docs/core/PRD.md` v2.1 — 14 user flows + edge cases
- `docs/core/TDD.md` v2.1 — schema 23 tables, RLS, 3 tầng hiển thị, sync engine
- `docs/core/ROADMAP.md` v2.1 — 7 phases + dependency map + KPIs

**Appendices:**
- `docs/appendices/saas-implementation-plan.md` v2 — kiến trúc multi-tenant chi tiết
- `docs/appendices/player-side-saas-reconciliation.md` v2 — identity/kênh/matching
- `docs/appendices/player-side-saas-AUDIT.md` v1 — threat model C1-C8, B1-B6
- `docs/appendices/messenger-channel-design.md` v1.1 — kênh Messenger post-MVP
- `docs/appendices/saas-pnl-model.xlsx` — financial model

**Standards:**
- `docs/standards/HANDOFF.md` — tài liệu tiếp quản
- `docs/standards/business-rules.md` v1.1 — business rules tổng hợp (37 rules, 9 domains)
- `docs/standards/design-tokens.md` v1.0 — CSS variables + design system
- `docs/standards/feature-dependency-graph.md` v1.1 — dependency graph 19 modules

**Feature docs (15 FE + 15 BE):**
- Multi-tenant Foundation (P0–P1)
- Tenant Routing & Authz (P2)
- Session Management (P2/P4)
- Payment Reconciliation (P3)
- Identity & Merge (P3.5)
- Notifications & Reminders (P3/P4.5–P4.7)
- Web Auth & Onboarding (P4)
- Sync Engine (P4)
- Marketplace Discovery (P4.3)
- Cross-club Join (P4.3)
- Player Telegram (P4.5)
- Player View (P4.6)
- Zalo Channel (P4.7)
- Billing Lifecycle (P5)
- Security & Operations (P6)

**Project files:**
- `README.md` — project overview + doc map
- `CHANGELOG.md` — file này
- `PR_TEMPLATE.md` — PR template
- `templates/` — design tokens + feature-dev templates
