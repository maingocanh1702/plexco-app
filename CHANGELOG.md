# Changelog — Plexco

Mọi thay đổi đáng chú ý được ghi nhận ở đây.
Format theo [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
versioning theo [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

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
