# Plexco Feature Specs — Coverage Index

> **Version:** 2.23 · 2026-07-18
> **Scope source:** `../product/BRD.md` v3.9d · `../product/PRD.md` v2.8b · `../product/TDD.md` v3.1 · `../product/ROADMAP.md` v3.3b · `../standards/decisions.md` **v1.47 (DD-01..69)**. DD-49..56 đã full-propagate; **DD-57..59 defer, DD-60 ✅, DD-61..64 ✅ accept-in-principle (build post-P4), DD-69 ✅ định hướng accepted**; DD-65..68 đã chốt, với DD-67 generalized endpoint scope cho Messenger + Zalo. Session Organize (DD-61..64) accept-in-principle nhưng **chưa build** — cần prerequisite implementation + canonical phase. Schema/code cùng các design-probe B0/B1/B2/B3 vẫn defer về đúng build slice.

> **Cập nhật v3.4 (DD-37, 2026-07-10):** kênh phase-1 = **Zalo + Facebook Messenger** + web (**Telegram loại khỏi phạm vi**). `feature_player_telegram` → **Archived (DD-37)**, thay bằng `feature_player_messenger`. Thêm phase-1: `feature_inapp_chat` (DD-38 ✅), `feature_user_settings` (DD-39 ✅), Google login (DD-13 ✅, trong `feature_web_auth_onboarding`), mark-paid thủ công (DD-40 ✅, trong `feature_payment_reconcile`).

Core docs remain authoritative by topic. Feature specs add build/test detail but cannot silently change scope, security invariants or canonical phase. **Ngoại lệ hiện tại:** `feature_channel_booking_funnel.md` là product-only Draft; DD-32 đã chốt A nhưng BE companion được viết cùng build slice, không phải gate quyết định còn mở.

## Document Convention

- **Product/UX spec** (`feature_{name}.md`) — 7 sections: Mô tả, Use Cases + Edge Cases, Screens & States, Domain Model, Analytics Events, Acceptance Criteria, Open Questions / Changelog.
- **Backend Tech spec** (`BE/feature_{name}_tech.md`) — 6 sections: Tổng quan triển khai, Database Schema + Edge Cases (BE), API Contract, Chi tiết triển khai, Testing Plan, Rollout Plan + Changelog.
- Template files: `../templates/feature-spec-template.md` and `../templates/be-tech-spec-template.md`.
- Language: Vietnamese numbered headers (`## 1. Mô tả`, `## 2. Use Cases + Edge Cases`, ...).

## Coverage taxonomy (inventory partition + status lens)

Bốn nhóm inventory **không overlap** — "coverage" = **có spec + BE tech**, KHÔNG có nghĩa đã implement:

- **Legacy coverage (pre-pivot)** — 15 cặp spec MVP viết trước DD-37 (bảng ngay dưới); trong đó `feature_player_telegram` nay **Archived**.
- **Pre-existing cross-cutting/post-MVP** — 2 cặp: Connector Onboarding + Club Assistant; status riêng được ghi ở các bảng dưới.
- **Phase-1 additions — DD ✅, tracked; pending migration/build** — 3 **cặp** mới (Messenger/chat/settings): Messenger đã **Reviewed contract**; chat/settings vẫn Draft. Cả 6 file đã tracked nhưng chưa có migration/runtime implementation. "DD ✅/Reviewed" không có nghĩa "đã build".
- **Post-phase-1 (accept-in-principle)** — 1 cặp Session Organize v0.5: DD-61..64 ✅ accept-in-principle (owner 18/07), build **post-P4**; file coverage không phải runtime/build-ready.

**Status lens (không cộng thêm vào inventory):** **15 Reviewed contracts** = 14 legacy active + Shared Host/Player Messenger; Telegram Archived; connector/assistant/chat/settings/session-organize giữ status riêng. Tất cả vẫn phải đọc cột code trong BUILD-STATUS.

> ⚠️ **Reconcile với `../standards/BUILD-STATUS.md`:** trên disk có **22 Product/System specs + 21 BE specs = 21 cặp + 1 product-only Draft** (`feature_channel_booking_funnel`; BE deferred tới build slice). 21 cặp gồm **15 legacy** (14 active Reviewed + 1 Telegram Archived), **2 cặp pre-existing** (connector + assistant), **3 cặp phase-1** pending migration/build và **1 cặp Session Organize (accept-in-principle, build post-P4)**. Coverage chỉ nghĩa là file tồn tại; không phải canonical phase hay implementation readiness.

### Legacy coverage — 15 cặp spec MVP (1 Archived)

| Phase | Feature | Product/System spec | Backend/Engineering spec | Status |
|---|---|---|---|---|
| P0–P1 | Multi-tenant Foundation | `feature_multi_tenant.md` v1.7 | `BE/feature_multi_tenant_tech.md` v1.5 | ✅ Reviewed |
| P2 | Tenant Routing & Authz | `feature_tenant_routing_authz.md` v2.6 | `BE/feature_tenant_routing_authz_tech.md` v2.5 | ✅ Reviewed |
| P2/P4 | Session Management | `feature_session_management.md` v2.9a | `BE/feature_session_management_tech.md` v2.7 | ✅ Reviewed |
| P3 | Payment Reconciliation | `feature_payment_reconcile.md` v1.7 | `BE/feature_payment_reconcile_tech.md` v1.8 | ✅ Reviewed |
| P3.5 | Identity Directory & Merge | `feature_identity.md` v1.7 | `BE/feature_identity_tech.md` v1.7 | ✅ Reviewed |
| P3/P4.5–P4.7 | Notifications & Reminders | `feature_notifications_reminders.md` v2.5 | `BE/feature_notifications_reminders_tech.md` v2.5 | ✅ Reviewed |
| P4 | Web Auth & Onboarding | `feature_web_auth_onboarding.md` v2.9 | `BE/feature_web_auth_onboarding_tech.md` v2.6 | ✅ Reviewed; DD-33 contract propagated, Facebook external enablement gate/runtime pending |
| P4 | Sync Engine | `feature_sync_engine.md` v2.3 | `BE/feature_sync_engine_tech.md` v2.4 | ✅ Reviewed |
| P4.3 | Marketplace Discovery | `feature_marketplace_discovery.md` v2.2 | `BE/feature_marketplace_discovery_tech.md` v2.1 | ✅ Reviewed |
| P4.3 | Cross-club Join | `feature_cross_club_join.md` v2.6 | `BE/feature_cross_club_join_tech.md` v2.5 | ✅ Reviewed |
| ~~P4.5~~ | ~~Player Telegram~~ | `feature_player_telegram.md` v2.1 | `BE/feature_player_telegram_tech.md` v2.1 | ⚠️ **Archived (DD-37)** → `feature_player_messenger.md` |
| P4.6 | Player View | `feature_player_view.md` v2.2 | `BE/feature_player_view_tech.md` v2.2 | ✅ Reviewed |
| P4.7 | Zalo Channel | `feature_zalo_channel.md` v2.3 | `BE/feature_zalo_channel_tech.md` v2.3 | ✅ Reviewed |
| P5 | Billing Lifecycle | `feature_billing_lifecycle.md` v2.7 | `BE/feature_billing_lifecycle_tech.md` v2.6 | ✅ Reviewed |
| P6 | Security & Operations | `feature_security_operations.md` v2.2 | `BE/feature_security_operations_tech.md` v2.2 | ✅ Reviewed |

### Cross-cutting tracked pair (pre-existing)

| Phase | Feature | Product/System spec | Backend/Engineering spec | Status |
|---|---|---|---|---|
| P3/P4/P4.7 | Connector Onboarding (Zalo · SePay · ApiPay) | `feature_connector_onboarding.md` v0.9 | `BE/feature_connector_onboarding_tech.md` v0.6 | 🟡 Draft — provider-contract reviewed; Zalo auto-register còn blocked bởi sandbox confirmation |

### Phase-1 additions — DD ✅, tracked; pending migration/build (DD-37/38/39/65..68)

3 feature pair mới (6 file) — **DD đã ✅**, Product spec + BE tech **đã tracked trong documentation baseline**; chờ migration/build. KHÔNG tính vào 15 legacy.

| Phase | Feature | Product/System spec | Backend/Engineering spec | Status |
|---|---|---|---|---|
| P2.5/P4.5 | Shared Host & Player Facebook Messenger (thay Telegram) | `feature_player_messenger.md` v0.5 | `BE/feature_player_messenger_tech.md` v0.4 | ✅ Reviewed contract, implementation pending (DD-37/DD-65..68 ✅ · DD-33 ✅ link, App Review pending) |
| P4 | In-app Chat (toàn CLB + 1-1) | `feature_inapp_chat.md` v0.7 | `BE/feature_inapp_chat_tech.md` v0.14 | ✅ DD chốt — Draft, pending migration (DD-38 ✅ · DD-55 safety/media contract ✅) |
| P4/P4+ | User Settings & Profile + Follow/Visibility | `feature_user_settings.md` v0.8 | `BE/feature_user_settings_tech.md` v0.7 | ✅ DD-39(+addendum)/54 + DD-47/48 framework — Draft, pending migration/build |

> Reviewed docs cập nhật theo DD ✅ (không đổi trạng thái Reviewed): `feature_web_auth_onboarding` (DD-13 Google+email), `feature_payment_reconcile` + `feature_notifications_reminders` (DD-40 mark-paid thủ công), `feature_tenant_routing_authz` + `feature_identity` + `feature_multi_tenant` + `feature_billing_lifecycle` + `feature_session_management` (DD-37 channel pivot).

## Post-MVP

| Phase | Feature | Current source | Required before implementation |
|---|---|---|---|
| ~~P4.8~~ → **phase-1 (P2.5/P4.5)** | Messenger channel | **nay là phase-1 (DD-37/DD-65..68)** → `feature_player_messenger.md` v0.5 + `BE/feature_player_messenger_tech.md` v0.4 + `../channels/messenger/messenger-channel-design.md` v2.4 | Shared host/player contract Reviewed; runtime/migration/E2E pending; App Review Meta / DD-33 trước GA |
| P7 (đề xuất) | Club AI Assistant + Knowledge Base | `feature_club_assistant.md` v0.9 + `BE/feature_club_assistant_tech.md` v0.9 (🟡 Draft) · proposal `../proposals/club-ai-bot-knowledge-base.md` | **Formally promote Product + BE pair sang Reviewed trước implementation.** DD-16/17/19–23/28 đã chốt; **DD-18 provider + privacy/ToS chặn GO-LIVE**, không tự biến Draft thành build-ready. DD-34/35/36 chưa chốt nên không tự mở rộng scope. Migration mới monotonic phải tự cài/verify `vector`, chứa ENABLE + FORCE RLS/policy/grant matrix (không sửa `0000`/`0009` đã apply); object storage cho file thô |
| P4.3/P4.7 + Messenger P2.5 | Channel-first Booking Funnel | `feature_channel_booking_funnel.md` v0.6 (DD-32 ✅ A, Draft) | Build BE companion; phụ thuộc DD-33/DD-14 cho natural social login, transactional one-time `link_code` fallback; giữ CCJ guest free/paid với active→charge, full→waitlisted/no-charge; không linked gate/đường book song song |
| Post-P4 (accept-in-principle, owner 18/07) — sau Session CRUD + Sync | Session Organize (court + match + live score) | `feature_session_organize.md` v0.5 + `BE/feature_session_organize_tech.md` v0.5 (accepted design, DD-61..64 ✅ accept-in-principle; no runtime) | Build post-P4: extend DD-56 registry/grant storage và triển khai SessionService prerequisites. V0.4 two-side; participant stint + partial assigned uniqueness; migration mới + tenant-safe FKs/RLS; point/reversal ledger idempotent; independent organize/score grants; relation-based read/SSE; balanced phụ thuộc level source. **Đã tính vào file coverage 22/21, chưa tính là runtime/build-ready.** |

## Review gates

Với spec mới hoặc spec được promote sang **Reviewed**, review gate kỳ vọng format Vietnamese-numbered và coverage tương đương: ≥10 use cases, ≥12 edge cases (Product) hoặc ≥12 edge cases + ≥20 test cases (BE). Legacy Reviewed spec được chấp nhận khi coverage tương đương đã thể hiện rõ, không cần đổi status chỉ vì cách đếm khác. Trước mỗi phase:

1. Resolve or explicitly defer open decisions affecting that feature.
2. Review Product and Backend specs together.
3. Verify cross-references against current BRD/PRD/TDD/business rules.

## Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-07-18 | v2.23 | DD-33 auth specs → v2.9/v2.6; Session Organize → v0.5 accepted-in-principle/no-runtime; preserve coverage vs implementation boundary. |
| 2026-07-17 | v2.22 | Final review-fix closure: Club Assistant formal Draft gate; Identity keeps `zalo_bots` tenant-private; Zalo/Connector KMS-migrates-or-disables legacy secrets, forbids dual-read and pins ciphertext/state + CAS-safe early-event lifecycle; Multi-tenant mirrors live `sessions`; Sync distinguishes existing `0005`. Runtime/migrations remain pending. |
| 2026-07-17 | v2.21 | Final integrity closure: payment ledger same-tenant/same-session composite FKs; notification intent/delivery tenant fence + endpoint-derived routing; executable chat membership parent key; ApiPay enterprise-first Product/BE/onboarding contract with explicit BYO fallback. Runtime/migrations remain pending. |
| 2026-07-17 | v2.20 | Deep feature-contract closure: executable chat safety/send/read/SSE; identity endpoint FK + terminal link-code lifecycle; exact provider auth/secret ownership; live Sync/Marketplace/Session DDL; Assistant generation/cache/provider-attempt truth; onboarding readiness and target/live schema boundaries. Runtime/migration status unchanged. |
| 2026-07-17 | v2.19 | Authority → BRD v3.9b/PRD v2.8/TDD v3.1/ROADMAP v3.3. Feature-doc closure đồng bộ exact endpoint identity, SePay HMAC, DM safety/block source, Assistant DLP và Session Organize v0.4; runtime/migration/readiness không đổi. |
| 2026-07-17 | v2.18 | Authority → TDD v3.0/decisions v1.45. Refresh toàn bộ current Product/BE version rows; generalized endpoint-scoped identity/reachability cho Messenger + Zalo; runtime/migration/readiness boundaries không đổi. |
| 2026-07-17 | v2.17 | Review-fix closure: taxonomy thành inventory partition + status lens không overlap; DD-67 propagate vào multi-tenant/identity/notification Product+BE pairs; scope source → BRD v3.9a. Runtime/migration vẫn pending. |
| 2026-07-17 | v2.16 | Promote Messenger index thành **Shared Host/Player Reviewed contract** v0.4/v0.3 theo DD-65..68; refresh version refs của routing/session/auth/sync/marketplace/cross-club. Implementation vẫn pending. |
| 2026-07-17 | v2.15 | Authority → BRD v3.9 / PRD v2.7 / TDD v2.9 / ROADMAP v3.2 / decisions v1.44. Session Organize pair → v0.3; giữ DD-61..64 proposal và coverage/readiness boundary. |
| 2026-07-17 | v2.14 | Thêm cặp Session Organize v0.2 vào on-disk coverage: **22 Product/System + 21 BE = 21 cặp + 1 product-only**. Neo decisions v1.42, TDD v2.7, ROADMAP v3.0; phase organize giữ TBD/earliest-after-P4 và status proposal, không biến doc coverage thành implementation readiness. |
| 2026-07-16 | v2.13 | **Code-aware contract closure (DD-49..56 v1.37; current decisions v1.39):** full Product+BE propagation cho correction/rejoin, payment, billing, identity/auth, chat safety+media và exact authz capabilities; DD-40 synthetic-transfer conflict removed; refresh toàn bộ version rows. DD-57..60 giữ proposal; schema/code/design-probes vẫn pending. |
| 2026-07-16 | v2.12 | **Founder batch propagation (decisions v1.36, DD-49..56):** light propagation vào 9 specs — session v2.7 (SES-OQ-1), payment v1.5 (PAY-OQ-3), billing v2.6 (BIL-OQ-2), CCJ v2.4 (CCJ-OQ-2), identity v1.3 (ID-OQ-1/2/3), routing v2.2 (RTE-OQ-1/2), user_settings v0.6 (USR-OQ-1/3), chat v0.4 (CHT-OQ-1/3), web_auth v2.4 (WAO-OQ-5). Schema/code vẫn defer build slice. HR4 HANDOFF đổi theo DD-50. |
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
