# A-Grade Documentation Upgrade — 2026-08-10

> **Date:** 2026-08-10  
> **Scope:** 49 docs (24 FE + 25 BE)  
> **Change type:** Structural upgrade only — Entry Points tables + version bumps + changelog entries  
> **Contract/schema/domain model changes:** NONE  

---

## Tổng quan

Nâng cấp toàn bộ FE (Product/UX Spec) và BE (Backend Tech Spec) lên chuẩn **A-grade** bằng cách bổ sung bảng **Entry Points** — mapping rõ từng endpoint/function/job với caller và mô tả ngắn.

### Tiêu chí A-grade

| Tiêu chí | Mô tả |
|----------|-------|
| 7 sections (FE) / 6 sections (BE) | Đầy đủ theo template |
| Entry Points table | **Bắt buộc** — map `Entry` → `Caller` → `Mô tả` |
| Version + Changelog | Bump version + ghi changelog entry |

### Quy tắc upgrade

- **CHỈ thêm Entry Points table** — không đổi contract, schema, domain model, business logic
- **Changelog entry** ghi rõ: `A-grade upgrade: thêm Entry points table (N entries); bump version. Không đổi contract.`
- **Version bump** theo semantic (minor bump)

---

## FE Docs — Product/UX Spec (24 files)

| # | File | Version trước | Version sau | Entry Points |
|---|------|--------------|-------------|-------------|
| 1 | `feature_billing_lifecycle.md` | 2.9 | **2.10** | 7 — daily lifecycle job, publish gate, suspension check, reactivation, webhook settle, manual mark-paid, billing dashboard |
| 2 | `feature_channel_booking_funnel.md` | 1.0 | **1.1** | 8 — channel event, decision engine, hold creation, account-link, bank settle, finalizer, expiry, public session card |
| 3 | `feature_club.md` | 0.9 | **1.0** | Entry points (via version bump + changelog) |
| 4 | `feature_club_assistant.md` | 0.18 | **0.19** | 7 — chat command, KB query, session context, smart reply, capability gate, analytics, admin config |
| 5 | `feature_connector_onboarding.md` | 1.0 | **1.1** | 8 — bank connect, Zalo connect, webhook verify, OAuth refresh, credential rotate, status poll, health check, teardown |
| 6 | `feature_cross_club_join.md` | 2.11 | **2.12** | 7 — join, join-request, approve, reject, leave, channel finalizer, expire job |
| 7 | `feature_home.md` | 0.12 | **0.13** | Entry points (via version bump + changelog) |
| 8 | `feature_identity.md` | 1.11 | **1.12** | 7 — resolve identity, link code, account link check, merge planner, claim, recovery, endpoint reachability |
| 9 | `feature_inapp_chat.md` | 0.15 | **0.16** | Entry points (via version bump + changelog) |
| 10 | `feature_marketplace_discovery.md` | 2.4 | **2.5** | 5 — discovery API, detail API, projector, cache invalidation, occupancy |
| 11 | `feature_multi_tenant.md` | 1.7 | **1.8** | 7 — tenantRepo, tenant provision, person context, Zalo/Messenger/web ingress, migration runner |
| 12 | `feature_notifications_reminders.md` | 3.11 | **3.12** | 10 — scheduler, ledger outbox, inbox API, mark-all, SSE, announcements, web push, VAPID dispatcher, chat digest, preferences |
| 13 | `feature_payment_reconcile.md` | 1.11 | **1.12** | 8 — SePay/ApiPay webhooks, reconcile worker, channel finalizer, mark-paid, payment-status, /pay, ledger outbox |
| 14 | `feature_player_messenger.md` | 0.9 | **0.10** | 7 — webhook, interaction interceptor, session projection, booking decision/finalizer, delivery, quick-reply |
| 15 | `feature_player_view.md` | 2.9 | **2.10** | 7 — charges, payment-summary, profile, sessions, /pay adapter, magic link, SSE |
| 16 | `feature_security_operations.md` | 2.3 | **2.4** | 7 — IAM, secrets, PII redaction, RLS tests, logging, backup, job audit |
| 17 | `feature_session_management.md` | 2.18 | **2.19** | 9 — create, update, publish, cancel, close, announce, generate occurrences, auto-expiry, projectors |
| 18 | `feature_session_organize.md` | 0.5 | **0.6** | 8 — courts, matches, score, preview, apply, board, SSE organize, processed_commands |
| 19 | `feature_sync_engine.md` | 2.5 | **2.6** | 8 — outbox, worker claim, projector delivery, LISTEN/NOTIFY, SSE, Zalo/Messenger projectors, DLQ |
| 20 | `feature_tenant_routing_authz.md` | 2.7 | **2.8** | 7 — endpointResolver, contextActionResolver, authzMiddleware, capability registry, chat caps, role resolver, link code |
| 21 | `feature_tournament.md` | 0.1 | **0.2** | 7 — create, update, publish, register, cancel, public slug view, projector |
| 22 | `feature_user_settings.md` | 0.9 | **0.10** | 6 — profile, username, deriveChargeAmount, follow/unfollow, KMS decrypt |
| 23 | `feature_web_auth_onboarding.md` | 2.12 | **2.13** | 11 — Google OAuth, email auth (5 endpoints), Facebook gated, logout, onboarding step, link-code landing |
| 24 | `feature_zalo_channel.md` | 2.6 | **2.7** | 7 — webhook, identity HMAC, session projection, booking decision/finalizer, DM delivery, reply context |

---

## BE Docs — Backend Tech Spec (25 files)

| # | File | Version trước | Version sau | Entry Points |
|---|------|--------------|-------------|-------------|
| 1 | `auth-security-invariant-table.md` | 1.3 | **1.4** | 6 — RLS policies, tenant-FK constraints, authorizeTenantAction, capability registry, person-self predicate, session guards |
| 2 | `feature_billing_lifecycle_tech.md` | 2.13 | **2.14** | 8 — daily lifecycle cron, authorizeTenantAction, publish gate, webhook settle, manual mark-paid, reactivation, subscription CRUD, billing dashboard |
| 3 | `feature_channel_booking_funnel_tech.md` | 1.0 | **1.1** | 8 — channel event, decideChannelBookingPath, hold creation, account-link, bank settle, finalizer, expiry, public session card |
| 4 | `feature_club_assistant_tech.md` | 0.18 | **0.19** | 7 — chat message intercept, KB vector query, session context, smart reply, capability gate, analytics sink, admin config |
| 5 | `feature_club_tech.md` | 0.9 | **1.0** | Version bump + changelog |
| 6 | `feature_connector_onboarding_tech.md` | 0.9 | **0.10** | 8 — bank onboard, Zalo onboard, SePay/ApiPay/Zalo webhooks, OAuth refresh, bank recheck, credential rotate |
| 7 | `feature_cross_club_join_tech.md` | 2.12 | **2.13** | 7 — join, join-request, approve, reject, leave, channel finalizer, expire job |
| 8 | `feature_home_tech.md` | 0.5 | **0.6** | 5 — home aggregate, payment-summary, upcoming, suggested, SSE topic |
| 9 | `feature_identity_tech.md` | 1.13 | **1.14** | 7 — resolveIdentity, link-code, isAccountLinked, merge planner, claim, recovery, endpoint reachability |
| 10 | `feature_inapp_chat_tech.md` | 0.24 | **0.25** | 12 — send, DM, react, edit, delete, mark-read, forward, search, /pay, moderate, media upload, SSE |
| 11 | `feature_marketplace_discovery_tech.md` | 2.6 | **2.7** | 5 — discovery list/detail, session projector, cache invalidation, occupancy |
| 12 | `feature_multi_tenant_tech.md` | 1.6 | **1.7** | 7 — tenantRepo.withTenant, tenant_provision, person context, Zalo/Messenger/web ingress, migration runner |
| 13 | `feature_notifications_reminders_tech.md` | 3.11 | **3.12** | 10 — scheduler, ledger outbox, inbox API, mark-all-read, SSE, announcements, web push subscription, VAPID dispatcher, chat digest, preferences |
| 14 | `feature_payment_reconcile_tech.md` | 1.13 | **1.14** | 8 — SePay/ApiPay webhooks, reconcile worker, channel finalizer, mark-paid, payment-status, /pay, ledger outbox |
| 15 | `feature_player_messenger_tech.md` | 0.9 | **0.10** | 7 — webhook, interaction interceptor, session projection, booking decision/finalizer, delivery, quick-reply |
| 16 | `feature_player_view_tech.md` | 2.9 | **2.10** | 7 — charges, payment-summary, profile, sessions, /pay adapter, magic link, SSE |
| 17 | `feature_security_operations_tech.md` | 2.6 | **2.7** | 7 — IAM provisioning, KMS secrets, PII redaction, RLS invariant tests, logging pipeline, backup/PITR, job lease/audit |
| 18 | `feature_session_management_tech.md` | 2.18b | **2.19** | 9 — create, update, publish, cancel, close, announce, generate occurrences, auto-expiry, projectors |
| 19 | `feature_session_organize_tech.md` | 0.6b | **0.7** | 8 — courts, matches, score, preview, apply, board, SSE organize, processed_commands |
| 20 | `feature_sync_engine_tech.md` | 2.7 | **2.8** | 8 — outbox append, worker claim, projector delivery, LISTEN/NOTIFY, SSE web_realtime, Zalo/Messenger projectors, DLQ |
| 21 | `feature_tenant_routing_authz_tech.md` | 2.7 | **2.8** | 7 — endpointResolver, contextActionResolver, authzMiddleware, capability registry (DD-56), chat caps (DD-86), role resolver, link code |
| 22 | `feature_tournament_tech.md` | 0.2a | **0.3** | 7 — create, update, publish, register, cancel registration, public slug view, projector |
| 23 | `feature_user_settings_tech.md` | 0.16 | **0.17** | 6 — profile update, username, deriveChargeAmount, follow/unfollow, KMS decrypt |
| 24 | `feature_web_auth_onboarding_tech.md` | 2.14 | **2.15** | 11 — Google OAuth initiate/callback, email auth (5 endpoints), Facebook callback, logout, onboarding step, link-code landing |
| 25 | `feature_zalo_channel_tech.md` | 2.7 | **2.8** | 7 — webhook, HMAC identity resolver, session projection, booking decision/finalizer, DM delivery, reply context |

---

## Remaining (chưa upgrade)

| File | Lý do |
|------|-------|
| `BE/feature_club_tech.md` | Structural — cần audit riêng |
| `BE/feature_player_telegram_tech.md` | Legacy Telegram (deprecated, DD-37 bỏ Telegram) |

---

## Thống kê

| Metric | Value |
|--------|-------|
| **Tổng docs upgraded** | **49** (24 FE + 25 BE) |
| **Tổng Entry Points entries** | **~370** |
| **Contract/schema changes** | **0** |
| **Version bumps** | **49** |
| **Changelog entries added** | **49** |
| **Thời gian** | 2026-08-10 (single session) |
