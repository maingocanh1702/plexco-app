# BUILD-STATUS — Plexco (đã build vs. đã spec)

> **Mục đích:** ảnh chụp tiến độ *thực thi* so với khối tài liệu đã spec (Reviewed và Draft/proposal được ghi riêng). Trả lời gọn:
> "code đã có tới đâu, còn cách MVP bao xa". Đây là doc **living**, cập nhật mỗi khi một slice merge.
> **Cập nhật:** 2026-07-22 (current authority **decisions v1.98**; BRD v3.9g/PRD v2.8f/TDD v3.1a/ROADMAP v3.4). D0a · D0b · D1 email-token · D1 Google · d1b đã merge; DD-87 là authority core-only, chưa có runtime change. Không dùng version hoặc coverage làm bằng chứng implementation.
> **Nguồn số liệu:** `git log`, cây `packages/`+`apps/`, `docs/features/*`, `docs/standards/decisions.md`,
> `docs/autopilot-backlog.md`. **HEAD `main`** = `8d8f3bc`; code baseline: migrations **`0000–0018`** đều trên `main` (gồm `0014` waitlist schema-only, `0015` D0a, `0016` D1 email-token, `0017` Google OAuth transaction, `0018` completion handoff). Slice `db-migration-0000-idempotent-role-create` **không thêm migration nào** — nó sửa migration runner.
> **✅ Parallel DB suite đã mở khoá (2026-07-22, `8d8f3bc`):** `migrate.ts` nay ensure role bằng pre-check + exception handler (nuốt `42710` **hoặc** `23505`, gated trên "0000 chưa applied"), nên `vitest.config.ts` đã bật **`fileParallelism: true`**. Migration `0000` **không bị sửa** (applied + immutable, checksum nguyên vẹn). Điểm bẫy đã ghi vào code: `pg_advisory_lock` là **database-scoped**, không bảo vệ object cluster-global như role. DB suite **159 test**. Chi tiết: Verdict 14. **Nhiều autopilot worktree giờ chạy DB suite đồng thời được.**
> ⚠️ **Đính chính:** commit `eba1c27` mang subject `fix(db): make migration-runner role creation race-safe...` nhưng **chỉ chứa hai file docs** (`auth-s4-session-handoff.md`, `ROADMAP.md`) do một merge abort giữa chừng. Nội dung của nó hợp lệ và được giữ; commit **thật** của slice này là **`8d8f3bc`**.
> **✅ D0a merged (2026-07-20, `8f493f7`):** `auth-s4-d0-revoke-core` (migration `0015_auth_revoke_account.sql` — **miếng code feature-layer đầu tiên**) squash-merge sau 12 vòng Codex (10 finding fix) + review tay + real-PG 97/97. Gate "2 clean liên tiếp" **không đạt** → **owner override có ghi chép** (commit message + `HALT-MAX_ROUNDS.txt`), không phải false CODE_READY.
> **✅ D0b merged (2026-07-22, `93c5404`):** `auth-s4-d0-session-web-boundary` — issuance fence `issueSession` (reject-and-reauth, không fallback-mint) + typed 401 `AUTH_INVALID` ở 2 caller + `POST /api/auth/logout-all` (CSRF trước mutation). **Zero DB change.** Gate P0 **ĐẠT** (2 clean round liên tiếp, 2 fix round) — **không override**. Web tests 65→78, real-PG green. Chi tiết: Verdict 6.
> **✅ D1 email-token-core merged (2026-07-22, `64fb4d3`):** `auth-s4-d1-email-token-core` — migration **`0016`** atomic: 5 bảng function-only (`account_emails`, `email_password_credentials`, `auth_pending_email_registrations`, `auth_email_tokens`, `auth_email_deliveries`) + partial unique index độc lập `now()` + `_auth_assert_password_phc` (parse full Argon2id, floor==ceiling, guard overflow) + trigger 2 write-path + `_auth_consume_email_token` parent-first + 5 hàm cleanup deadlock-free; `auth_audit_events` **reuse** từ `0015`; **zero app grant**. **CODE DARK** — không route/UI/provider send. DB tests 97→**128**. Gate đóng bằng **1 clean round + independent directed review** (Codex phi tất định sau 9 vòng), **override thứ 2/3 slice**. Chi tiết: Verdict 8.
> **✅ D1 google-adapter merged (2026-07-22, `c6edbfa`):** migration **`0017`** `auth_oauth_transactions` (PKCE ciphertext AES-256-GCM + key version riêng, single-use issue/claim) + `google-oidc` proof matrix + Lax path-scoped binding cookie (tách khỏi session Strict, **không** reuse `sameOriginRequest()`) + `/api/auth/google/{state,callback}` + `auth_login_google` per-lane finalizer với collision table §4. Suite: db **144** · web **131**. Codex hội tụ, phần rotation invented-scope đã revert. Chi tiết: Verdict 10.
> **✅ d1b session-rotation merged (2026-07-22, `ae8986e`):** migration **`0018`** expand-only (`resolved_account_id`/`handoff_hash`/`handoff_expires_at`/`handoff_consumed_at` + `auth_oauth_handoff_arm/_consume`) + **completion hop M3** — callback trả landing first-party auto-submit POST same-origin → `/complete` chạy `issueSession()` ở nơi cookie Strict CÓ mặt ⇒ đi đúng nhánh rotate. **Residual risk của D1 đã đóng trong code.** Handoff token đi trong body POST, chỉ lưu sha256, **không cookie**; single-use là fence server-side atomic. Suite db 144→**152** · web 131→**146**. **Gate ĐẠT ngay lần đầu: 2 vòng Codex sạch liên tiếp, 0 fix-round** — slice đầu tiên không thrash. Chi tiết: Verdict 13.
> **⛔ VẪN CHẶN BẬT GOOGLE LOGIN — nhưng lý do đã đổi:** code đã sửa xong; thứ còn thiếu là **bằng chứng đo trên Safari macOS + iOS** cho cơ chế M3 (Playwright chỉ có WebKit đông cứng, không phải Safari bản ship). Nếu Safari giữ lại cookie Strict ở M3 thì người dùng Safari âm thầm vẫn dính rủi ro. **Giữ `GOOGLE_OAUTH_CLIENT_ID/SECRET` rỗng cho tới khi đo xong** — các bước thủ công ở `../probe-strict-cookie-completion-hop.md` §7.
>
> **Reconcile 2026-07-22:** target channel identity theo DD-15/DD-65..68 vẫn là endpoint-scoped Messenger + Zalo; adapter/handler/shared Session/Join/AuthZ/projector/E2E vẫn chưa build. **Google lane đã merge nhưng chưa enable**: thiếu đo Safari macOS+iOS cho M3 nên `GOOGLE_OAUTH_*` giữ rỗng; email/password bundle order-4 và Telegram removal vẫn pending. Migrations là `0000–0018`.

---

## 0. TL;DR

| Trục | Trạng thái | Ước lượng |
|---|---|---|
| **Tài liệu / thiết kế** | **24 Product/System + 23 BE tech specs = 23 cặp + 1 product-only Draft**. DD-70..72 và DD-86 vẫn Draft/proposal; DD-73/74/75/78 dependency/consumer-sequenced, DD-76/77 evidence-gated; decision log **v1.98**. | Contract coverage cao; không dùng count làm code-readiness |
| **Code — lớp nền (foundation)** | monorepo + core logic + DB/RLS + migrations **`0000–0014`** đã merge trên `main`; `0014` là schema-only waitlist | **✅ xong** |
| **Code — lớp auth** | Auth v3 (Telegram-era) merged; **DD-80 D0a (`0015`) + D0b + D1 email-token (`0016`) + D1 Google (`0017`) + d1b session-rotation (`0018`) đã merged**; còn order-4 email bundle (flag OFF, gate C7) → gỡ Telegram. Bật Google chờ đo Safari/iOS | 🟢 Google lane xong phần code, ⛔ chưa enable |
| **Code — lớp feature nghiệp vụ** | chưa bắt đầu (session/reconcile/sync/marketplace/billing/bot…) | ⬜ chưa build |
| **Roadmap build** | **S1–S3 + S4 Auth v3** đã land + **toàn bộ lane Google: D0a · D0b · D1 email-token · D1 Google · d1b** (migrations `0000–0018`); kế tiếp order-4 email bundle | ~33% |

**Một câu:** foundation + Google auth lane đã merge, nhưng Google chưa được enable và email/password bundle vẫn chưa build; tầng feature nghiệp vụ (session/reconcile/sync/marketplace/billing/bot) vẫn nằm trên giấy. `IMPLEMENTED` cho các migration/auth slice không chứng minh product E2E hoặc enablement.

---

## 1. Bức tranh tổng: docs đi trước code rất xa

Repo docs-first: decision log tới **DD-87/v1.98**; DD-70..72 và DD-86 vẫn 🟡; **DD-73/74/75/78 dependency/consumer-sequenced, DD-76/77 evidence-gated**. Integrity closure giải drift contract nhưng không tăng code readiness; vẫn cần services/adapters/projectors. B1/B2/B3, mutation-path, external/legal/store gates vẫn phải đóng; thực thi roadmap khoảng ~33% theo slice đã merge, không phải product readiness.

```
Contract ███████████████████░░  coverage cao (không phải readiness score; DD-70..72 đề xuất; DD-73/74/75/78 dependency/consumer-sequenced; DD-76/77 evidence-gated)
Nền móng  ████████████████████░  ~90%   (core + db-RLS + migrations 0000–0014 trên `main`)
Auth      ████████████████░░░░  ~80%   (Google lane merged; ⛔ chờ Safari/iOS trước enable; email bundle pending)
Feature   █░░░░░░░░░░░░░░░░░░░░░  ~5%    (mới có logic thuần trong core, chưa wiring)
```

---

## 2. Đã build gì — chi tiết theo package

### 2.1 `packages/core` — logic nghiệp vụ thuần ✅

Lift từ bot single-club (Bestminton) đã chạy production (~85% auto-match, 0 false-positive). Đa số là
logic thuần, không đụng DB/transport. Root barrel hiện **browser-safe về dependency** và cố ý không export
`i18n.ts` (`node:async_hooks`), nhưng chưa phải contract boundary cho native: nó vẫn export matching/payment
decision helpers mà client không được dùng làm authority. **~2.870 dòng, 9 file test.**

| Module | Vai trò | Test |
|---|---|---|
| `matching.ts` | Dò `pay_code` (tier) + matcher theo tên | `matching.test.ts` |
| `payments-logic.ts` | `classifyAmount`, FIFO settle (đề xuất, không ghi DB) | `payments-logic.test.ts` |
| `dates.ts` / `time.ts` | `inferYear` (cutoff theo calendar-date, không lệch theo giờ đồng hồ) | `dates.test.ts`, `time.test.ts` |
| `format.ts` | Format tiền/ngày vi/en | `format.test.ts` |
| `i18n.ts` | `t(vi,en)` qua subpath server-only (`node:async_hooks`) | `i18n.test.ts` |
| `vietqr.ts` | Sinh chuỗi VietQR | `vietqr.test.ts` |
| `sports.ts` | Từ vựng môn + taxonomy trình độ | `sports.test.ts` |

Điểm quan trọng: barrel `index.ts` cố ý **không** re-export `i18n` để tránh kéo Node builtin vào
bundle client. Core **PROPOSES** — mọi quyết định tiền do lớp trên áp dụng. Native/PWA nên dùng client-safe
DTO/error/validator/format boundary riêng, không import money engine chỉ vì barrel bundle được trên browser.

### 2.2 `packages/db` — data layer Postgres + RLS ✅ (keystone)

**Baseline `main` (2026-07-22): migrations `0000–0018` (19 file) đều trên `main`, có bộ RLS invariant test chạy trên role runtime thật. DB suite = 152 test theo evidence D1b; full local rerun vẫn cần `DATABASE_URL_TEST`.**

> ✅ **Correction 2026-07-22:** các bản trước của doc này khẳng định `0014_players_waitlist` "chỉ trên nhánh `feat/session-waitlist-expand`, chưa vào `main`" ở bốn chỗ. **Sai** — verify on-disk: `git ls-tree main` có file, và `1a6ac38 feat(session): expand players for DD-45 waitlist` nằm trong lịch sử `main`; `waitlist-invariants.test.ts` (21 test) chạy trong mọi lần `pnpm test`. Claim cũ là prose stale được chép lại qua nhiều lần cập nhật mà không verify — đúng bẫy mà CLAUDE.md cảnh báo.

- **Migrations 0000→0013 (trên `main`):** roles/extensions → global directory → tenants → payments-ledger →
  channels/connectors → sync-engine → discovery → billing → notifications/onboarding → RLS
  policies/grants → functions/triggers → seeds → auth_functions → onboarding_steps recency.
- **`0014_players_waitlist` (2026-07-19, ✅ trên `main` tại `1a6ac38`)** — bảng đầu tiên được mở rộng cho feature layer:
  `players.status` thêm `waitlisted`, cột `waitlist_position`, hai CHECK state-shape/positive và
  `idx_players_waitlist_order`. **Chỉ schema** — auto-promote là money-write: first-activation chờ DD-39/41/42 + shared DD-52 restriction core; proven rejoin còn chờ DD-49 correction core. Retry còn thiếu `waitlist_entry_version`, candidate failure-event/owner-alert consumers, root promotion-retry store, CAS/lease sweep worker và domain DLQ/review sink. Không có behavior/runtime path nào được tính là đã build.
  21 DDL invariant test (`waitlist-invariants.test.ts`) gồm cả app-role grant/RLS trên cột mới.
- **Choke-point:** `tenant.ts` (`tenantRepo`/`withTenant`) — mọi query tenant-scoped bắt buộc qua đây,
  `SET LOCAL app.tenant_id`, client theo role. `migrate.ts` = runner transactional, immutability + RLS guard.
- **Bất biến đã test (`rls-invariants.test.ts`):** RLS fail-closed trên role thật; occurrence chứng minh
  **cả hai** parent thuộc đúng tenant; app **không** import `@plexco/db/schema` trực tiếp (HR1 lint guard).
- 51 bảng đã dựng đủ cho hầu hết feature phía sau (persons/accounts/channel_identities/memberships,
  charges/payment_allocations/bank_transactions, public_sessions, outbox_events/projector_deliveries,
  subscriptions/billing_*, link_codes/merge_audit/merge_tombstones, magic_links/web_sessions/oauth_transactions…).
  → **Schema đi trước; code feature dùng chúng thì chưa có.**

### 2.3 `apps/web` + `apps/bot` — shell + Auth Onboarding v3 (Telegram-era) 🟡

- `apps/web`: khung Next.js (`layout.tsx`, `page.tsx`, `healthz/route.ts`, `next.config.mjs`) + Auth Onboarding v3 (Telegram-era) **và Google lane DD-80 đã merge**: D0b logout-all, Google OAuth state/callback/complete và M3 completion handoff. **Google chưa enable** tới khi có đo Safari macOS+iOS; email/password bundle vẫn chưa code.
- `apps/bot`: `queue.ts`, `queues.ts`, `worker.ts`, `provision-queue.ts` + `queue.test.ts` — khung hàng đợi.

Chưa có: command handlers, services, projectors, API nghiệp vụ đầy đủ, UI thật, tích hợp Zalo/Messenger, webhook reconcile; **email/password bundle (DD-80 order-4) và Telegram removal** chưa implement.

---

## 3. Đối chiếu từng feature: **spec status** vs **code**

**15 legacy** (13 active Reviewed + 1 Notifications 🟡 Draft từ 18/07 do gộp cụm 🔔 + Telegram archived), 2 cặp pre-existing khác (connector/assistant), 3 cặp phase-1 additions (**Messenger Reviewed contract; chat/settings Draft**), **Home** (Reviewed), Session Organize (accept-in-principle), Tournament (Draft) và 1 product-only Draft (funnel). Cột "Code" cho biết thực thi tới đâu.

| Feature (Phase) | Spec | Code hiện tại |
|---|---|---|
| Multi-tenant Foundation (P0–P1) | ✅ Reviewed | **✅ Có** — RLS + tenantRepo + 51 bảng |
| Tenant Routing & Authz (P2) | ✅ Reviewed (DD-65..68 hybrid target) | ⬜ Chưa protected Messenger endpoint/action resolver |
| Session Management (P2/P4) | ✅ Reviewed | ⬜ Chưa SessionService/wizard; live players/surface refs còn thiếu hybrid prerequisite constraints |
| Session Organize (post-P4) | ✅ accept-in-principle DD-61..64 (owner 18/07) | ⬜ Chưa — không có organize tables/migration/service/assign/scoring/SSE; SessionService prerequisites cũng pending |
| Payment Reconciliation (P3) | ✅ Reviewed | 🟡 Một phần — **logic** đã có ở `core` (matching + payments-logic); **wiring** webhook→settle→notify chưa |
| Identity & Merge (P3.5) | ✅ Reviewed | ⬜ Chưa (bảng link_codes/merge_audit/tombstones có sẵn) |
| Notifications — Reminders · Inbox · Announcements · Web Push (P3/P4/P4.5) | 🟡 Draft — **§A nhắc/xác nhận/correction contract đã reviewed** (không đổi, không mở lại); §B/C/D inbox·announce·push chờ **DD-70/71/72**. Hạ Reviewed→Draft 18/07 do **gộp tài liệu** (cặp `feature_notification_center` nhập vào đây) | ⬜ Chưa (bảng notification_* có sẵn; `person_notifications`/`membership_tags`/`device_push_subscriptions` chưa có) |
| Web Auth & Onboarding (P4) | ✅ Reviewed | 🟢 Telegram-era + Google lane DD-80 merged; Google ⛔ chưa enable (Safari/iOS M3), email/password bundle và Telegram removal pending |
| Sync Engine (P4) | ✅ Reviewed | ⬜ Chưa projectors; Messenger one-route delivery chưa viết |
| Marketplace Discovery (P4.3) | ✅ Reviewed | ⬜ Chưa (public_sessions có sẵn) |
| Cross-club Join (P4.3) | ✅ Reviewed | ⬜ Chưa (join_requests có sẵn) |
| Shared Host/Player Messenger (P2.5, DD-65..68) | ✅ Reviewed contract | ⬜ Chưa hybrid migration/adapter/handlers/actions/reachability/E2E; bot mới có queue shell |
| Player View (P4.6) | ✅ Reviewed | ⬜ Chưa |
| Home hub (S9, DD-79 ✅ 19/07 + amendments v1.79–84) | ✅ Reviewed contract (`feature_home.md` v0.5a + BE v0.1 — composition-only, không bảng mới; nav registry 5 slot, Feed gated DD-76) | ⬜ Chưa — chờ S9 PWA shell; data từ player_view/marketplace/§A |
| Zalo Channel (P4.7) | ✅ Reviewed | ⬜ Chưa (`zalo_bots`/reply-context base tables có sẵn; endpoint identity/reachability + legacy-secret KMS migration/runtime còn pending) |
| Billing Lifecycle (P5) | ✅ Reviewed | ⬜ Chưa (subscriptions/subscription_invoices/billing_* có sẵn) |
| Security & Operations (P6) | ✅ Reviewed | 🟡 Một phần — RLS/HR1 guard đã thực thi; phần còn lại chưa |
| Club Assistant (P7 post-MVP) | ✅ DD chốt (DD-16..28) | ⬜ Chưa (player_chat_context có sẵn) |
| Connector Onboarding | 🟡 Draft (provider-contract reviewed) | ⬜ Chưa (provider_connections/onboarding_* có sẵn) |
| Marketplace/Sync… | — | — |

**Đọc bảng này thế nào:** gần như mọi feature đã có (a) spec Reviewed và (b) *bảng DB tương ứng* dựng
sẵn ở S3 — nhưng (c) tầng command/service/projector/UI thì trắng. Docs-first + schema-first đã giảm
rủi ro khám phá, **không biến phần còn lại thành việc "điền code" cơ học**: B0–B3, DD-49 correction
probes và các negative scope S5/S7 vẫn là design gate bắt buộc trước khi chốt storage/API hoặc mutation path.

---

## 4. Roadmap build (orchestrator 20 slice)

Nguồn: `docs/autopilot-backlog.md` (Phase-1 full-launch, S1→S20; **DD-37: Messenger nay là phase-1 P2.5**, Telegram bỏ khỏi phạm vi).

| Slice | Nội dung | Trạng thái |
|---|---|---|
| **S1** monorepo-scaffold | pnpm workspace, toolchain, CI, runtime shells, infra | ✅ **merged** |
| **S2** core-lift (+S2d foundations) | matching/dates/payments-logic + i18n/format/vietqr/sports | ✅ **merged** |
| **S3** db-postgres-drizzle-rls | schema + 14 migration (`0000–0013`) + RLS choke-point + invariant suite | ✅ **merged** |
| **S4** auth | web-auth/onboarding | 🟢 Telegram-era + Google lane DD-80 merged (`0015`–`0018`); Google ⛔ chưa enable, email/password bundle pending |
| S5 session · S6 sync-engine · S7 reconcile · S8 identity-merge | | ⬜ chưa |
| S9–S12 web PWA + marketplace · S13 cross-club · S14 billing | | ⬜ chưa |
| S15 host-pro-auto · S16 reminders-auto · S17 Zalo · S18 Messenger | | ⬜ chưa |
| S19 club-assistant (DD-gate ✅) · S20 polish | | ⬜ chưa |
| Telegram | bỏ khỏi phạm vi (DD-37 thay DD-09) | ✂️ out |
| App Native phase-2 (DD-69) | RN+Expo recommendation; client/API/auth/push/offline/store gates | ✅ direction accepted (18/07) · ⬜ build chưa schedule |

**Tiến độ: S1–S3 + Google lane DD-80 đã land; current committed tree `main@142e9fa` ≈ 33% chặng đường code theo roadmap. Google chưa enable; email/password bundle order-4 và Telegram removal chưa code.**

---

## 5. Session hôm nay đã đóng góp gì (2026-07-06)

6 commit ngày 06/07:
- **`d701210` merge phase-1** — gộp S1 + S2d + S3 + core-lift-v3 vào `main` (mốc kết thúc Phase 1).
- **`3717659` S2 core-lift-v3** — land matching/dates/payments-logic + i18n/format/sports lift.
- **auth-v3 design pass** (`a5ddfdb`, `6365667`) — artifacts security-design, chốt DD-31 (8 bất biến
  SI-1..SI-8 + 4 gap: login-state CSRF, tenant-filter policy, KMS/secret wiring, keyed web-auth hash);
  tách "decisions-resolved" (OQ-1/2/3 do founder chốt) vs "impl-open" (tới v3 merge).
- **`2ce2684`, `3f2172a`** — autopilot: class-aware review gate + fix portable read loop (macOS bash 3.2).

Nói cách khác: session này **khép lại Phase 1** (nền móng) và **mở màn thiết kế lớp Auth** (S4).

> **Historical update 2026-07-19:** đoạn này ghi trạng thái trước DD-80 slices; không dùng làm current baseline. Current baseline là `main@142e9fa`, migrations `0000–0018`, Google lane đã merge nhưng chưa enable; email/password bundle và Telegram removal vẫn pending.

---

## 6. Gap & bước tiếp theo hợp lý

**Còn thiếu để có MVP chạy được:** enable Google, email/password bundle + Telegram removal, rồi tầng feature S5→S19. Ưu tiên theo dependency:

1. **Enable Google (ENABLEMENT_ONLY):** đo Safari macOS+iOS cho M3; chỉ khi pass mới set `GOOGLE_OAUTH_*`. Đây không thay thế full product E2E.
2. **S4 email/password bundle:** sau Google lane, build release unit order-4 flag OFF rồi mới gỡ provider Telegram-era, theo DD-80.
3. **S5 Session** → **mark-paid thủ công** → **S7 Reconcile**: không coi core logic là wiring cơ học; mỗi mutation path cần contract/slice riêng.
4. **S6 Sync-engine** và **S8 Identity-merge:** author sau hard dependencies và gates tương ứng; Identity cần verified account email hoặc transactional one-time `link_code` (HR4/DD-50).

**Quyết định/gate còn treo có thể chặn hoặc định hình build:** **DD-04** provider ✅ **chốt (c) DO co-locate** (còn build-time gate: egress-IP verify + provision + restore/failover drill + RPO/RTO + KMS), **DD-14/15**
(Zalo external spikes), **DD-33 đã chốt nhưng Meta App Review/Business Verification/permission evidence vẫn là external enablement gate**, và **DD-34/35/36**
(Club Assistant P7 detail). **DD-18 chỉ chặn GO-LIVE Club Assistant và không phải build-time provider dependency; tuy nhiên Product + BE pair vẫn phải được formally promote từ Draft sang Reviewed trước implementation.**
**Current decisions v1.98:** DD-70..72 và DD-86 vẫn 🟡; DD-73/74/75/78 dependency/consumer-sequenced, DD-76/77 evidence-gated. Notification context, share/activity và native runtime vẫn chưa có. Google lane đã merge nhưng chưa enable; B1/B2/B3 + correction/external/legal gates vẫn áp dụng.
**DD-02/05/06/08/10/12/41–46 đã ✅ chốt; DD-47/48 đã chốt framework** nhưng schema/code vẫn pending.
DD-13 (Google/email) ✅: Google lane đã merge nhưng chưa enable; email/password bundle còn pending. DD-37/38/39 ✅; chat/giá theo giới tính còn chờ migration.

---

## 7. Historical verification (2026-07-16–19)

Các kết quả dưới đây là historical evidence của checkout/CI nêu rõ từng dòng, không phải xác nhận current `main@142e9fa`:

| Gate | Kết quả |
|---|---|
| **Current feature checkout full suite (19/07)** | ✅ working tree on `feat/session-waitlist-expand@aa8afae` (waitlist executable-schema provenance `1a6ac38`; `aa8afae` comment/test-format-only): canonical PostgreSQL command pass **21 files / 244 tests** (core 111 · DB/RLS/auth/waitlist 65 · web 65 · bot 3), gồm `0014` |
| **Current feature checkout static gates (19/07)** | ✅ `pnpm format:check` · `pnpm lint` · `pnpm typecheck` · `git diff --check` pass; đây là local working-tree evidence, không thay remote CI/merge evidence |
| `pnpm lint` (16/07) | ✅ Pass |
| `pnpm build` (16/07) | ✅ Pass; typecheck + Next production build; live routes vẫn gồm Telegram-era auth callback/state như code snapshot đã nêu |
| `pnpm format:check` (17/07) | ✅ Pass full repo sau Messenger hybrid contract propagation |
| Non-DB tests (16/07) | ✅ Core **111** · web **65** · bot **3** pass; web có thêm provider-pinned client-IP regression matrix |
| Static infra/config (16/07) | ✅ Manifest JSON parse · `/bin/bash -n` · Compose config · `git diff --check` pass |
| Canonical DB/full test (17/07) | ✅ `DATABASE_URL_TEST=postgres://plexco:…@localhost:5432/plexco_test pnpm test`: **20 files / 223 tests pass** (core 111 · DB/RLS/auth 44 · web 65 · bot 3) |
| Messenger-doc delta QA (17/07) | ✅ **44 modified Markdown files** checked: 0 broken relative links, 0 unbalanced fences; `git diff --check` pass. Đây là contract QA, không phải Messenger runtime E2E |
| Previous canonical DB/full test (16/07) | ✅ Docker PostgreSQL `/plexco_test`: **20 files / 223 tests pass**; container được stop sau verify |
| Previous full-suite baseline (13/07, historical) | ✅ **20 files / 214 tests pass** trước trusted-ingress regression expansion |
| Local Markdown link + anchor scan (16/07) | ✅ **151 Markdown files** trong current working tree, 0 broken local links/anchors · 0 unbalanced fence |
| Remote CI (`main@299338d`, 17/07) | ✅ [Run 29518494545](https://github.com/maingocanh1702/plexco-app/actions/runs/29518494545): install/typecheck/format/lint/build/full PostgreSQL suite pass |
| Remote Security (`main@299338d`, 17/07) | ✅ [Run 29518495006](https://github.com/maingocanh1702/plexco-app/actions/runs/29518495006): Semgrep CE + OSV full dependency scan pass |

Phạm vi historical: working tree tại `feat/session-waitlist-expand@aa8afae` local green **21/244** ngày 19/07; runtime closure `299338d` giữ historical remote CI/Security **20/223**. Các con số này không thay staging/restore/provider evidence và không có nghĩa feature layer đã implement. `0014` hiện đã merge trên main; baseline hiện hành xem phần mở đầu.

---

## 8. Bảo trì doc này

Cập nhật khi: (a) một slice merge vào `main`, (b) một feature chuyển từ ⬜→🟡→✅, (c) một DD đổi trạng
thái ảnh hưởng build. Giữ đồng bộ với `docs/autopilot-backlog.md` và `decisions.md` (2 nguồn sự thật —
doc này chỉ *tổng hợp*, không thay thế).
