# Plexco Feature Specs — Coverage Index

> **Version:** 2.0 · 2026-06-19  
> **Scope source:** `../core/BRD.md` v3.1 · `../core/PRD.md` v2.1 · `../core/TDD.md` v2.1 · `../core/ROADMAP.md` v2.1

Core docs remain authoritative by topic. Feature specs add build/test detail but cannot silently change scope, security invariants or canonical phase. All MVP feature areas now have a Product/System spec and a Backend/Engineering companion.

## Document Convention

- **Product/UX spec** (`feature_{name}.md`) — 7 sections: Mô tả, Use Cases + Edge Cases, Screens & States, Domain Model, Analytics Events, Acceptance Criteria, Open Questions / Changelog.
- **Backend Tech spec** (`BE/feature_{name}_tech.md`) — 6 sections: Tổng quan triển khai, Database Schema + Edge Cases (BE), API Contract, Chi tiết triển khai, Testing Plan, Rollout Plan + Changelog.
- Template files: `../../templates/feature-spec-template.md` and `../../templates/be-tech-spec-template.md`.
- Language: Vietnamese numbered headers (`## 1. Mô tả`, `## 2. Use Cases + Edge Cases`, ...).

## MVP coverage — 15/15

| Phase | Feature | Product/System spec | Backend/Engineering spec | Status |
|---|---|---|---|---|
| P0–P1 | Multi-tenant Foundation | `feature_multi_tenant.md` v1.1 | `BE/feature_multi_tenant_tech.md` v1.1 | ✅ Reviewed |
| P2 | Tenant Routing & Authz | `feature_tenant_routing_authz.md` v2.0 | `BE/feature_tenant_routing_authz_tech.md` v2.0 | ✅ Standardized |
| P2/P4 | Session Management | `feature_session_management.md` v2.0 | `BE/feature_session_management_tech.md` v2.0 | ✅ Standardized |
| P3 | Payment Reconciliation | `feature_payment_reconcile.md` v1.1 | `BE/feature_payment_reconcile_tech.md` v1.2 | ✅ Reviewed |
| P3.5 | Identity Directory & Merge | `feature_identity.md` v1.1 | `BE/feature_identity_tech.md` v1.1 | ✅ Reviewed |
| P3/P4.5–P4.7 | Notifications & Reminders | `feature_notifications_reminders.md` v2.0 | `BE/feature_notifications_reminders_tech.md` v2.0 | ✅ Standardized |
| P4 | Web Auth & Onboarding | `feature_web_auth_onboarding.md` v2.0 | `BE/feature_web_auth_onboarding_tech.md` v2.0 | ✅ Standardized |
| P4 | Sync Engine | `feature_sync_engine.md` v2.0 | `BE/feature_sync_engine_tech.md` v2.0 | ✅ Standardized |
| P4.3 | Marketplace Discovery | `feature_marketplace_discovery.md` v2.0 | `BE/feature_marketplace_discovery_tech.md` v2.0 | ✅ Standardized |
| P4.3 | Cross-club Join | `feature_cross_club_join.md` v2.0 | `BE/feature_cross_club_join_tech.md` v2.0 | ✅ Standardized |
| P4.5 | Player Telegram | `feature_player_telegram.md` v2.0 | `BE/feature_player_telegram_tech.md` v2.0 | ✅ Standardized |
| P4.6 | Player View | `feature_player_view.md` v2.0 | `BE/feature_player_view_tech.md` v2.0 | ✅ Standardized |
| P4.7 | Zalo Channel | `feature_zalo_channel.md` v2.0 | `BE/feature_zalo_channel_tech.md` v2.0 | ✅ Standardized |
| P5 | Billing Lifecycle | `feature_billing_lifecycle.md` v2.0 | `BE/feature_billing_lifecycle_tech.md` v2.0 | ✅ Standardized |
| P6 | Security & Operations | `feature_security_operations.md` v2.0 | `BE/feature_security_operations_tech.md` v2.0 | ✅ Standardized |

## Post-MVP

| Phase | Feature | Current source | Required before implementation |
|---|---|---|---|
| P4.8 | Messenger channel | `../appendices/messenger-channel-design.md` | Convert to Product + BE feature specs and refresh against Meta policy/App Review |

## Review gates

"Standardized" means format-verified, Vietnamese-numbered, with ≥10 use cases, ≥12 edge cases (FE) or ≥12 edge cases + ≥20 tests (BE). Before starting each phase:

1. Resolve or explicitly defer open decisions affecting that feature.
2. Review Product and Backend specs together.
3. Verify cross-references against current BRD/PRD/TDD/business rules.

## Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-06-18 | v1.1 | Initial coverage index with 15/15 features |
| 2026-06-19 | v2.0 | Standardized all specs to Vietnamese numbered format, updated versions and status |
