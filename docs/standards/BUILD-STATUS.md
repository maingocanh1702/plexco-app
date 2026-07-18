# BUILD-STATUS — Plexco (đã build vs. đã spec)

> **Mục đích:** ảnh chụp tiến độ *thực thi* so với khối tài liệu đã spec (Reviewed và Draft/proposal được ghi riêng). Trả lời gọn:
> "code đã có tới đâu, còn cách MVP bao xa". Đây là doc **living**, cập nhật mỗi khi một slice merge.
> **Cập nhật:** 2026-07-18 (current authority **decisions v1.47**, BRD v3.9d/PRD v2.8b/TDD v3.1/ROADMAP v3.3b; **DD-57..59 defer, DD-60 ✅, DD-61..64 accept-in-principle, DD-69 direction accepted, DD-33 ✅**. Không thay functional implementation baseline: S9/S20 PWA chưa live, native + Session Organize chưa schedule/build).
> **Nguồn số liệu:** `git log`, cây `packages/`+`apps/`, `docs/features/*`, `docs/standards/decisions.md`,
> `docs/autopilot-backlog.md`. Số liệu chức năng = baseline **`main@1eb6f60`** (foundation + Auth v3 đã merge), không phải khẳng định đây là HEAD hiện tại.
>
> **Reconcile 2026-07-17:** target channel identity theo DD-15/DD-65..68 = endpoint-scoped Messenger + Zalo, reachability gắn `channel_identity_id`; Messenger = central+optional tenant Page, shared host/player. Live `messenger_pages` tenant-only, identity/reachability vẫn thiếu generalized endpoint contract và `apps/bot` queue shell **chưa đáp ứng**; chưa adapter/handler/shared Session/Join/AuthZ/projector/E2E. Google/email cũng chưa implement. Migrations vẫn `0000–0013`.

---

## 0. TL;DR

| Trục | Trạng thái | Ước lượng |
|---|---|---|
| **Tài liệu / thiết kế** | **22 Product/System + 21 BE specs**, cộng DD-69 app-native analysis; feature index v2.23 covers endpoint identity/Zalo trust boundary, exact provider auth, payment/notification tenant FKs, executable DM boundaries, ApiPay enterprise-first, Assistant DLP/retry truth + Draft/promotion gate, live schema deltas and Session Organize v0.5. DD-61..64 accept-in-principle · DD-69 direction accepted · DD-33/60 ✅. Decision log tới **DD-69 / v1.47**. | Contract coverage cao; không dùng count làm code-readiness |
| **Code — lớp nền (foundation)** | monorepo + core logic + DB/RLS + migrations `0000–0013` đã merge, có test | **✅ xong** |
| **Code — lớp auth** | **Auth Onboarding v3 (Telegram-era) đã merge** (`5b1193b`) + web tests; **DD-37 supersede provider** → Google/email replacement đã spec, **chưa implement** | 🟡 provider replacement pending |
| **Code — lớp feature nghiệp vụ** | chưa bắt đầu (session/reconcile/sync/marketplace/billing/bot…) | ⬜ chưa build |
| **Roadmap build** | **S1–S3 + S4 Auth v3 (Telegram-era)** đã land trên `main@1eb6f60`; provider replacement (DD-37) chưa code | ~20% |

**Một câu:** phần *khó và nền tảng nhất* (đường tiền thuần + DB có RLS fail-closed + migrations `0000–0013`)
đã dựng xong và được test; **Auth Onboarding v3 (Telegram-era) cũng đã merge** — nhưng **DD-37 supersede
provider** nên phải thay bằng Google/email (đã spec, chưa code). Tầng feature nghiệp vụ còn nằm trên giấy.
Project vừa qua **Phase 0→1**: foundation + auth-v3 đã land trên **`main@1eb6f60`**.

---

## 1. Bức tranh tổng: docs đi trước code rất xa

Repo docs-first: decision log tới **DD-69/v1.47**. Feature-doc/DD-69 closure giải drift contract nhưng không tăng code readiness; vẫn cần migration + services/adapters/projectors. Session Organize v0.5/DD-61..64 chưa vào canonical phase/timeline; DD-69 direction ✅ accepted nhưng native build phase-2 chưa scheduled. B0/B1/B2/B3, mutation-path, external/legal/store gates vẫn phải đóng; thực thi ~20% roadmap.

```
Contract ███████████████████░░  coverage cao (không phải readiness score; DD tới DD-69)
Nền móng  ████████████████████░  ~90%   (core + db-RLS + migrations 0000–0013, có test)
Auth      ███████████░░░░░░░░░░  ~55%   (Onboarding v3 Telegram-era merged + web tests; DD-37 provider→Google/email chưa code)
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

**~2.522 dòng, 51 bảng trong `schema.ts`, 14 migration (`0000–0013`), có bộ RLS invariant test chạy trên role runtime thật.**

- **Migrations 0000→0013:** roles/extensions → global directory → tenants → payments-ledger →
  channels/connectors → sync-engine → discovery → billing → notifications/onboarding → RLS
  policies/grants → functions/triggers → seeds → auth_functions → onboarding_steps.
- **Choke-point:** `tenant.ts` (`tenantRepo`/`withTenant`) — mọi query tenant-scoped bắt buộc qua đây,
  `SET LOCAL app.tenant_id`, client theo role. `migrate.ts` = runner transactional, immutability + RLS guard.
- **Bất biến đã test (`rls-invariants.test.ts`):** RLS fail-closed trên role thật; occurrence chứng minh
  **cả hai** parent thuộc đúng tenant; app **không** import `@plexco/db/schema` trực tiếp (HR1 lint guard).
- 51 bảng đã dựng đủ cho hầu hết feature phía sau (persons/accounts/channel_identities/memberships,
  charges/payment_allocations/bank_transactions, public_sessions, outbox_events/projector_deliveries,
  subscriptions/billing_*, link_codes/merge_audit/merge_tombstones, magic_links/web_sessions/oauth_transactions…).
  → **Schema đi trước; code feature dùng chúng thì chưa có.**

### 2.3 `apps/web` + `apps/bot` — shell + Auth Onboarding v3 (Telegram-era) 🟡

- `apps/web`: khung Next.js (`layout.tsx`, `page.tsx`, `healthz/route.ts`, `next.config.mjs`) **+ Auth Onboarding v3 (Telegram-era) đã merge** (`5b1193b`) — login/onboarding routes + hash dùng `telegram`-era, **có web tests**. **DD-37 supersede provider** → cần thay bằng Google/email (đã spec, **chưa code**).
- `apps/bot`: `queue.ts`, `queues.ts`, `worker.ts`, `provision-queue.ts` + `queue.test.ts` — khung hàng đợi.

Chưa có: command handlers, services, projectors, API nghiệp vụ đầy đủ, UI thật, tích hợp Zalo/Messenger, webhook reconcile; **provider auth Google/email (DD-37) chưa implement**.

---

## 3. Đối chiếu từng feature: **spec status** vs **code**

**15 legacy Reviewed/Archived** (14 active + Telegram archived), 2 cặp pre-existing khác (connector/assistant), 3 cặp phase-1 additions (**Messenger Reviewed contract; chat/settings Draft**), 1 cặp Session Organize (accept-in-principle, post-P4) và 1 product-only Draft (funnel). Cột "Code" cho biết thực thi tới đâu.

| Feature (Phase) | Spec | Code hiện tại |
|---|---|---|
| Multi-tenant Foundation (P0–P1) | ✅ Reviewed | **✅ Có** — RLS + tenantRepo + 51 bảng |
| Tenant Routing & Authz (P2) | ✅ Reviewed (DD-65..68 hybrid target) | ⬜ Chưa protected Messenger endpoint/action resolver |
| Session Management (P2/P4) | ✅ Reviewed | ⬜ Chưa SessionService/wizard; live players/surface refs còn thiếu hybrid prerequisite constraints |
| Session Organize (post-P4) | ✅ accept-in-principle DD-61..64 (owner 18/07) | ⬜ Chưa — không có organize tables/migration/service/assign/scoring/SSE; SessionService prerequisites cũng pending |
| Payment Reconciliation (P3) | ✅ Reviewed | 🟡 Một phần — **logic** đã có ở `core` (matching + payments-logic); **wiring** webhook→settle→notify chưa |
| Identity & Merge (P3.5) | ✅ Reviewed | ⬜ Chưa (bảng link_codes/merge_audit/tombstones có sẵn) |
| Notifications & Reminders (P3/P4.5) | ✅ Reviewed | ⬜ Chưa (bảng notification_* có sẵn) |
| Web Auth & Onboarding (P4) | ✅ Reviewed | 🟡 **Auth Onboarding v3 (Telegram-era) merged** (`5b1193b`) + web tests; DD-37 supersede provider → Google/email chưa implement |
| Sync Engine (P4) | ✅ Reviewed | ⬜ Chưa projectors; Messenger one-route delivery chưa viết |
| Marketplace Discovery (P4.3) | ✅ Reviewed | ⬜ Chưa (public_sessions có sẵn) |
| Cross-club Join (P4.3) | ✅ Reviewed | ⬜ Chưa (join_requests có sẵn) |
| Shared Host/Player Messenger (P2.5, DD-65..68) | ✅ Reviewed contract | ⬜ Chưa hybrid migration/adapter/handlers/actions/reachability/E2E; bot mới có queue shell |
| Player View (P4.6) | ✅ Reviewed | ⬜ Chưa |
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
| **S4** auth | web-auth/onboarding | 🟡 **Onboarding v3 (Telegram-era) merged** (`5b1193b`) + web tests; DD-37 provider→Google/email chưa code |
| S5 session · S6 sync-engine · S7 reconcile · S8 identity-merge | | ⬜ chưa |
| S9–S12 web PWA + marketplace · S13 cross-club · S14 billing | | ⬜ chưa |
| S15 host-pro-auto · S16 reminders-auto · S17 Zalo · S18 Messenger | | ⬜ chưa |
| S19 club-assistant (DD-gate ✅) · S20 polish | | ⬜ chưa |
| Telegram | bỏ khỏi phạm vi (DD-37 thay DD-09) | ✂️ out |
| App Native phase-2 (DD-69) | RN+Expo recommendation; client/API/auth/push/offline/store gates | ✅ direction accepted (18/07) · ⬜ build chưa schedule |

**Tiến độ: S1–S3 + S4 Auth v3 (Telegram-era) đã land trên `main@1eb6f60` ≈ 20% chặng đường code; provider replacement (DD-37 Google/email) chưa code.**

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

> **Cập nhật 2026-07-16:** Auth Onboarding v3 (Telegram-era) đã merge trong functional baseline **`main@1eb6f60`** (`5b1193b Merge feat/auth-onboarding-v3`), migrations `0000–0013` committed, có web tests. Các commit sau đó chủ yếu docs/config/tooling và chưa thêm feature layer. **DD-37 supersede provider** → thay Telegram-era bằng Google/email **đã spec nhưng chưa implement**.

---

## 6. Gap & bước tiếp theo hợp lý

**Còn thiếu để có MVP chạy được:** residual S4 provider swap + tầng feature S5→S19. Ưu tiên theo dependency:

1. **S4 — Web Auth & Onboarding**: Onboarding v3 (Telegram-era) **đã merge** (`5b1193b`) + web tests.
   Việc kế tiếp: chạy **B0 mutation-path/design-probe** cho token storage/consume + account-wide revoke, rồi **author + review bộ slice mechanism-named thay provider Telegram-era → Google/email (DD-13/DD-37/DD-50)** — Product/BE contract đã pin, **chưa implement và chưa launcher-ready**;
   + port/verify đủ 8 bất biến SI-1..SI-8. Đây là ưu tiên gần nhất nhưng **chưa runnable** cho tới khi B0 + prescan + manifest/slice/launcher hoàn tất.
2. **S5 Session** + **S7 Reconcile**: reconcile đã có sẵn `core` logic → chỉ cần wiring
   webhook → tenantRepo → outbox → notify. Đòn bẩy cao nhất (đường tiền).
3. **S6 Sync-engine**: viết projectors đọc `outbox_events` fan-out (Zalo/Messenger/SSE/public_sessions).
4. **S8 Identity-merge**: bảng đã sẵn; cần luồng claim/merge bằng verified account email hoặc transactional one-time `link_code` (HR4/DD-50).

**Quyết định/gate còn treo có thể chặn hoặc định hình build:** **DD-04** provider ✅ **chốt (c) DO co-locate** (còn build-time gate: egress-IP verify + provision + restore/failover drill + RPO/RTO + KMS), **DD-14/15**
(Zalo external spikes), **DD-33 đã chốt nhưng Meta App Review/Business Verification/permission evidence vẫn là external enablement gate**, và **DD-34/35/36**
(Club Assistant P7 detail). **DD-18 chỉ chặn GO-LIVE Club Assistant và không phải build-time provider dependency; tuy nhiên Product + BE pair vẫn phải được formally promote từ Draft sang Reviewed trước implementation.**
**Current decisions v1.47:** DD-49..56/DD-65..68 propagated; DD-33/60 ✅, DD-61..64 accept-in-principle (build post-P4), DD-69 direction accepted, DD-57..59 defer. DD-69 không đổi phase-1 readiness: PWA S9/S20 chưa live; native phase-2 chưa schedule và còn client-contract/API/auth/push/offline/store gates. Endpoint-scoped channel identity/reachability + Messenger hybrid cần build slice riêng sau prerequisite design-probe; B0/B1/B2/B3 + correction/external/legal gates vẫn áp dụng.
**DD-02/05/06/08/10/12/41–46 đã ✅ chốt; DD-47/48 đã chốt framework** nhưng schema/code vẫn pending.
DD-13 (Google/email) ✅ nhưng provider chưa implement; auth đã land vẫn là Telegram-era. DD-37/38/39 ✅;
chat/giá theo giới tính còn chờ migration.

---

## 7. Live verification (2026-07-17)

Reality-check trên local working tree hiện tại; giữ kết quả full-suite gần nhất làm historical evidence riêng:

| Gate | Kết quả |
|---|---|
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

Phạm vi xác nhận hiện tại: local working tree + remote runtime closure `299338d`; full PostgreSQL suite 17/07 là current local green cho checkout này.
Remote CI/Security đã có cho runtime closure nhưng không thay staging/restore/provider evidence và không có nghĩa feature layer đã implement.

---

## 8. Bảo trì doc này

Cập nhật khi: (a) một slice merge vào `main`, (b) một feature chuyển từ ⬜→🟡→✅, (c) một DD đổi trạng
thái ảnh hưởng build. Giữ đồng bộ với `docs/autopilot-backlog.md` và `decisions.md` (2 nguồn sự thật —
doc này chỉ *tổng hợp*, không thay thế).
