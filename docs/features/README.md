# Plexco Feature Specs — Coverage Index

> **Version:** 2.11 · 2026-07-15
> **Scope source:** `../product/BRD.md` v3.6 · `../product/PRD.md` v2.4 · `../product/TDD.md` v2.5 · `../product/ROADMAP.md` v2.7 · `../standards/decisions.md` v1.32 (DD-01..48). DD-02/05/06/08/32/41–46 đã chốt; DD-47/48 chốt framework P4+; DD-14/15 là external spikes; DD-18/34/35/36 còn open/approve-in-principle. Schema/code của các DD mới vẫn defer về đúng build slice.

> **Cập nhật v3.4 (DD-37, 2026-07-10):** kênh phase-1 = **Zalo + Facebook Messenger** + web (**Telegram loại khỏi phạm vi**). `feature_player_telegram` → **Archived (DD-37)**, thay bằng `feature_player_messenger`. Thêm phase-1: `feature_inapp_chat` (DD-38 ✅), `feature_user_settings` (DD-39 ✅), Google login (DD-13 ✅, trong `feature_web_auth_onboarding`), mark-paid thủ công (DD-40 ✅, trong `feature_payment_reconcile`).

Core docs remain authoritative by topic. Feature specs add build/test detail but cannot silently change scope, security invariants or canonical phase. **Ngoại lệ hiện tại:** `feature_channel_booking_funnel.md` là product-only Draft; DD-32 đã chốt A nhưng BE companion được viết cùng build slice, không phải gate quyết định còn mở.

## Document Convention

- **Product/UX spec** (`feature_{name}.md`) — 7 sections: Mô tả, Use Cases + Edge Cases, Screens & States, Domain Model, Analytics Events, Acceptance Criteria, Open Questions / Changelog.
- **Backend Tech spec** (`BE/feature_{name}_tech.md`) — 6 sections: Tổng quan triển khai, Database Schema + Edge Cases (BE), API Contract, Chi tiết triển khai, Testing Plan, Rollout Plan + Changelog.
- Template files: `../templates/feature-spec-template.md` and `../templates/be-tech-spec-template.md`.
- Language: Vietnamese numbered headers (`## 1. Mô tả`, `## 2. Use Cases + Edge Cases`, ...).

## Coverage taxonomy (v3.4)

Ba nhóm — "coverage" = **có spec + BE tech**, KHÔNG có nghĩa đã implement:

- **Legacy coverage (pre-pivot)** — 15 cặp spec MVP viết trước DD-37 (bảng ngay dưới); trong đó `feature_player_telegram` nay **Archived**.
- **Active phase-1 coverage** — spec Reviewed còn trong scope + cập nhật theo pivot = **14 cặp** (15 legacy − Telegram archived).
- **Draft phase-1 — DD ✅, tracked; pending migration/build** — 3 **cặp** mới (Messenger/chat/settings): **quyết định DD ✅** (DD-37/38/39), **6 file đã tracked trong documentation baseline** nhưng chưa có migration/runtime implementation. "DD ✅" = quyết định đã chốt, KHÔNG phải "đã build".

> ⚠️ **Reconcile với `../standards/BUILD-STATUS.md`:** trên disk có **21 Product/System specs + 20 BE specs = 20 cặp hoàn chỉnh + 1 product-only Draft** (`feature_channel_booking_funnel`; BE deferred tới build slice). 20 cặp gồm **15 legacy** (14 active Reviewed + 1 Telegram Archived), **2 cặp pre-existing** (connector + assistant) và **3 cặp phase-1 mới đã tracked, pending migration/build** (messenger/chat/settings). "Reviewed" = trạng thái *tài liệu*, không phải *đã build*.

### Legacy coverage — 15 cặp spec MVP (1 Archived)

| Phase | Feature | Product/System spec | Backend/Engineering spec | Status |
|---|---|---|---|---|
| P0–P1 | Multi-tenant Foundation | `feature_multi_tenant.md` v1.3 | `BE/feature_multi_tenant_tech.md` v1.2 | ✅ Reviewed |
| P2 | Tenant Routing & Authz | `feature_tenant_routing_authz.md` v2.1 | `BE/feature_tenant_routing_authz_tech.md` v2.1 | ✅ Reviewed |
| P2/P4 | Session Management | `feature_session_management.md` v2.6 | `BE/feature_session_management_tech.md` v2.4 | ✅ Reviewed |
| P3 | Payment Reconciliation | `feature_payment_reconcile.md` v1.4 | `BE/feature_payment_reconcile_tech.md` v1.5 | ✅ Reviewed |
| P3.5 | Identity Directory & Merge | `feature_identity.md` v1.2 | `BE/feature_identity_tech.md` v1.2 | ✅ Reviewed |
| P3/P4.5–P4.7 | Notifications & Reminders | `feature_notifications_reminders.md` v2.3 | `BE/feature_notifications_reminders_tech.md` v2.2 | ✅ Reviewed |
| P4 | Web Auth & Onboarding | `feature_web_auth_onboarding.md` v2.3 | `BE/feature_web_auth_onboarding_tech.md` v2.2 | ✅ Reviewed |
| P4 | Sync Engine | `feature_sync_engine.md` v2.1 | `BE/feature_sync_engine_tech.md` v2.1 | ✅ Reviewed |
| P4.3 | Marketplace Discovery | `feature_marketplace_discovery.md` v2.0 | `BE/feature_marketplace_discovery_tech.md` v2.0 | ✅ Reviewed |
| P4.3 | Cross-club Join | `feature_cross_club_join.md` v2.3 | `BE/feature_cross_club_join_tech.md` v2.3 | ✅ Reviewed |
| ~~P4.5~~ | ~~Player Telegram~~ | `feature_player_telegram.md` v2.1 | `BE/feature_player_telegram_tech.md` v2.1 | ⚠️ **Archived (DD-37)** → `feature_player_messenger.md` |
| P4.6 | Player View | `feature_player_view.md` v2.2 | `BE/feature_player_view_tech.md` v2.2 | ✅ Reviewed |
| P4.7 | Zalo Channel | `feature_zalo_channel.md` v2.1 | `BE/feature_zalo_channel_tech.md` v2.1 | ✅ Reviewed |
| P5 | Billing Lifecycle | `feature_billing_lifecycle.md` v2.5 | `BE/feature_billing_lifecycle_tech.md` v2.5 | ✅ Reviewed |
| P6 | Security & Operations | `feature_security_operations.md` v2.1 | `BE/feature_security_operations_tech.md` v2.1 | ✅ Reviewed |

### Cross-cutting tracked pair (pre-existing)

| Phase | Feature | Product/System spec | Backend/Engineering spec | Status |
|---|---|---|---|---|
| P3/P4/P4.7 | Connector Onboarding (Zalo · SePay · ApiPay) | `feature_connector_onboarding.md` v0.5 | `BE/feature_connector_onboarding_tech.md` v0.2 | 🟡 Draft — provider-contract reviewed; Zalo auto-register còn blocked bởi sandbox confirmation |

### Draft — DD ✅, tracked; pending migration/build — Phase-1 additions (v3.4 — DD-37/38/39)

3 feature pair mới (6 file) — **DD đã ✅**, Product spec + BE tech **đã tracked trong documentation baseline**; chờ migration/build. KHÔNG tính vào 15 legacy.

| Phase | Feature | Product/System spec | Backend/Engineering spec | Status |
|---|---|---|---|---|
| P2.5/P4.5 | Player Facebook Messenger (thay Telegram) | `feature_player_messenger.md` v0.3 | `BE/feature_player_messenger_tech.md` v0.2 | ✅ DD chốt — Draft, pending migration (DD-37 ✅ kênh · DD-33 🟡 link) |
| P4 | In-app Chat (toàn CLB + 1-1) | `feature_inapp_chat.md` v0.3 | `BE/feature_inapp_chat_tech.md` v0.10 | ✅ DD chốt — Draft, pending migration (DD-38 ✅) |
| P4/P4+ | User Settings & Profile + Follow/Visibility | `feature_user_settings.md` v0.5 | `BE/feature_user_settings_tech.md` v0.5 | ✅ DD-39 + DD-47/48 framework — Draft, pending migration/build |

> Reviewed docs cập nhật theo DD ✅ (không đổi trạng thái Reviewed): `feature_web_auth_onboarding` (DD-13 Google+email), `feature_payment_reconcile` + `feature_notifications_reminders` (DD-40 mark-paid thủ công), `feature_tenant_routing_authz` + `feature_identity` + `feature_multi_tenant` + `feature_billing_lifecycle` + `feature_session_management` (DD-37 channel pivot).

## Post-MVP

| Phase | Feature | Current source | Required before implementation |
|---|---|---|---|
| ~~P4.8~~ → **phase-1 (P2.5/P4.5)** | Messenger channel | **nay là phase-1 (DD-37)** → `feature_player_messenger.md` v0.3 + `BE/feature_player_messenger_tech.md` v0.2 + `../channels/messenger/messenger-channel-design.md` | Product + BE Draft đã có; App Review Meta / DD-33 trước GA |
| P7 (đề xuất) | Club AI Assistant + Knowledge Base | `feature_club_assistant.md` v0.5 + `BE/feature_club_assistant_tech.md` v0.5 (🟡 Draft) · proposal `../proposals/club-ai-bot-knowledge-base.md` | DD-16/17/19–23/28 đã chốt nên không chặn build; **DD-18 provider + privacy/ToS chặn GO-LIVE**. DD-34/35/36 chưa chốt nên không tự mở rộng scope. Migration additive `memberships` UNIQUE(id,tenant_id); bật `vector`; object storage cho file thô |
| P4.3/P4.7 + Messenger P2.5 | Channel-first Booking Funnel | `feature_channel_booking_funnel.md` v0.4 (DD-32 ✅ A, Draft) | Build BE companion; phụ thuộc DD-33/DD-14 cho natural social login, OTP fallback; giữ CCJ guest free/paid với active→charge, full→waitlisted/no-charge; không linked gate/đường book song song |

## Review gates

Với spec mới hoặc spec được promote sang **Reviewed**, review gate kỳ vọng format Vietnamese-numbered và coverage tương đương: ≥10 use cases, ≥12 edge cases (Product) hoặc ≥12 edge cases + ≥20 test cases (BE). Legacy Reviewed spec được chấp nhận khi coverage tương đương đã thể hiện rõ, không cần đổi status chỉ vì cách đếm khác. Trước mỗi phase:

1. Resolve or explicitly defer open decisions affecting that feature.
2. Review Product and Backend specs together.
3. Verify cross-references against current BRD/PRD/TDD/business rules.

## Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-07-15 | v2.11 | **Canonical-readiness closure:** authority → decisions v1.32; bỏ branch/HEAD wording khỏi status lâu dài; 3 cặp phase-1 = tracked nhưng chưa build; reconcile Player View v2.2 và Security/Ops v2.1 sau DD-37 cleanup; bổ sung row Connector còn thiếu để index đủ 20 cặp + 1 product-only Draft. |
| 2026-07-15 | v2.10 | **Reality-check closure:** authority → decisions v1.31; sửa 12 version refs theo file trên disk, phase Messenger P2.5/P4.5 và Zalo P4.7, wording 3 feature pair/6 file, Club Assistant gate và Reviewed criteria. |
| 2026-07-15 | v2.9 | **Light propagation:** neo DD-05/06/32/41–48 vào feature Open Questions/status; schema/code vẫn defer về build slice. |
| 2026-07-15 | v2.8 | Sync decisions v1.27: DD-32/45 chốt implementation contract; DD-47/48 framework chốt; booking funnel BE deferred tới build thay vì chờ quyết định; user-settings v0.4; giữ counts 21 product/20 BE. |
| 2026-07-10 | v2.4 | Sửa version refs (PRD v2.2 · TDD v2.2 · ROADMAP v2.4 · decisions v1.16). Bỏ `(TBD)` cho 3 BE tech spec (đã tồn tại: messenger/chat/settings). **Taxonomy 3 nhóm** (Legacy 15 · Active phase-1 14 · Draft 3) — reconcile count, không mâu thuẫn BUILD-STATUS (18 Reviewed). `feature_player_telegram` = Archived, loại khỏi active phase-1. 3 doc mới → "✅ DD chốt — Draft, pending migration" (DD-38/39 ✅). |
| 2026-07-10 | v2.5 | **Review-fix reconcile count + versions.** Làm rõ: KHÔNG có "18 Reviewed" — **15 Reviewed** (14 active + Telegram archived) + 3 non-Reviewed (connector Draft · assistant ✅DD · funnel Draft) + 3 Draft mới untracked = **21 cặp**; đồng bộ BUILD-STATUS + ROADMAP. Cập nhật version thực tế trong bảng Legacy (multi_tenant v1.2, tenant_routing v2.1, session v2.1, payment v1.4/1.5, identity v1.2, notif v2.1, web_auth v2.2, sync v2.1, billing v2.5, player_view_tech v2.1, security_tech v2.1). "Standardized" → "Reviewed" nhất quán. Nhóm Draft mới: "DD ✅, **chưa commit git** (untracked)" thay "committed" mập mờ. |
| 2026-07-13 | v2.6 | Recount theo file trên disk: **21 product specs, 20 BE specs, 20 cặp hoàn chỉnh + 1 product-only Draft** (`channel_booking_funnel`, BE deferred tới khi DD-32 ✅). Scope source → ROADMAP v2.5 / decisions v1.19. |
| 2026-07-13 | v2.7 | Scope source → **decisions v1.25**. **DD-02/04/08/41/46 → ✅ Chốt** (không còn "DD-41..48 chưa active" — DD-41/46 đã chốt; còn DD-05/06/32/42/43/44/45/47/48 proposal, DD-14/15/18/34/35/36 open/post-MVP). |
| 2026-06-18 | v1.1 | Initial coverage index with 15/15 features |
| 2026-06-19 | v2.0 | Standardized all specs to Vietnamese numbered format, updated versions and status |
| 2026-07-05 | v2.1 | Thêm Post-MVP: Club AI Assistant + Knowledge Base (🟡 Draft, P7 đề xuất) — FE/BE specs + proposal, phụ thuộc DD-16..DD-23 |
| 2026-07-06 | v2.2 | Thêm Post-MVP: Channel-first Booking Funnel (🟡 Draft) — feature_channel_booking_funnel.md v0.1, phụ thuộc DD-32 + DD-33/DD-14 (FB/Zalo Login); phase P4.3/P4.7 + Messenger P4.8 |
| 2026-07-10 | v2.3 | **v3.4 pivot (DD-37/38/39/40):** kênh phase-1 = Zalo + Messenger + web (bỏ Telegram). `feature_player_telegram` → Archived (DD-37). Thêm `feature_player_messenger` (Draft), `feature_inapp_chat` (🟡 DD-38), `feature_user_settings` (🟡 DD-39). Messenger từ Post-MVP → phase-1. Reviewed docs cập nhật DD-13 (Google auth) + DD-40 (mark-paid thủ công) + DD-37 (channel refs). |
