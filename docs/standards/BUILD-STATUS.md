# BUILD-STATUS — Plexco (đã build vs. đã spec)

> **Mục đích:** ảnh chụp tiến độ *thực thi* so với khối tài liệu đã Reviewed. Trả lời gọn:
> "code đã có tới đâu, còn cách MVP bao xa". Đây là doc **living**, cập nhật mỗi khi một slice merge.
> **Cập nhật:** 2026-07-16 (current authority **decisions v1.39**; DD-49..56 contract closure ở v1.37; DD-57..60 là proposal, chưa gate build; functional implementation baseline không đổi).
> **Nguồn số liệu:** `git log`, cây `packages/`+`apps/`, `docs/features/*`, `docs/standards/decisions.md`,
> `docs/autopilot-backlog.md`. Số liệu chức năng = baseline **`main@1eb6f60`** (foundation + Auth v3 đã merge), không phải khẳng định đây là HEAD hiện tại.
>
> **Reconcile 2026-07-16:** channel target vẫn theo DD-37, nhưng functional implementation baseline còn Auth v3 Telegram-era và bắt buộc `TELEGRAM_BOT_TOKEN`. Google/email replacement đã spec đầy đủ nhưng **chưa implement, chưa có launcher-ready slice**; B0 mutation-path/storage/revoke-all design-probe vẫn chặn authoring. Decision authority tới **v1.39/DD-60** (DD-57..60 proposal-only). HEAD hiện tại có thêm docs/config/tooling sau `1eb6f60`, nhưng chưa thêm feature layer; migrations vẫn `0000–0013` (14 file).

---

## 0. TL;DR

| Trục | Trạng thái | Ước lượng |
|---|---|---|
| **Tài liệu / thiết kế** | **21 Product specs + 20 BE specs** = **20 cặp hiện có + 1 product-only Draft** (`channel_booking_funnel`; BE sẽ viết cùng build slice, **DD-32 đã chốt**). Decision log tới **DD-60 / v1.39**; DD-57..60 là proposal. DD-49..56 đã full-propagate, nhưng B0/B1/B2/B3 + correction mutation-path probes, external evidence và legal gate vẫn mở. | Contract coverage cao; **không dùng % này làm code-readiness** |
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

Repo được xây theo hướng **docs-first**: **20 cặp spec hiện có + 1 product-only Draft**; trong đó **15 legacy** (14 active Reviewed + Telegram Archived), connector/assistant, và 3 cặp phase-1 mới (Draft, đã tracked, còn chờ migration/build). Decision log đã ghi tới **DD-60/v1.39**; DD-57..60 là proposal. DD-41–56 có nhiều contract đã chốt, nhưng chốt policy không đồng nghĩa code-ready: B0/B1/B2/B3, DD-49 mutation-path design, external evidence và legal go-live vẫn phải đóng. Thực thi hiện mới chạy được ~20% roadmap (foundation + auth-v3 đã land).

```
Contract ███████████████████░░  coverage cao (21 Product + 20 BE; không phải readiness score; DD tới DD-60)
Nền móng  ████████████████████░  ~90%   (core + db-RLS + migrations 0000–0013, có test)
Auth      ███████████░░░░░░░░░░  ~55%   (Onboarding v3 Telegram-era merged + web tests; DD-37 provider→Google/email chưa code)
Feature   █░░░░░░░░░░░░░░░░░░░░░  ~5%    (mới có logic thuần trong core, chưa wiring)
```

---

## 2. Đã build gì — chi tiết theo package

### 2.1 `packages/core` — logic nghiệp vụ thuần ✅

Lift từ bot single-club (Bestminton) đã chạy production (~85% auto-match, 0 false-positive). Thuần
hàm, không đụng DB/transport, browser-safe. **~2.870 dòng, 9 file test.**

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
bundle client. Core **PROPOSES** — mọi quyết định tiền do lớp trên áp dụng.

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

## 3. Đối chiếu từng feature: **spec Reviewed** vs **code**

**15 legacy Reviewed/Archived** (14 active + Telegram archived), 2 cặp pre-existing khác (connector/assistant), 3 cặp Draft phase-1 đã tracked nhưng chờ migration/build và 1 product-only Draft (funnel). Cột "Code" cho biết thực thi tới đâu.

| Feature (Phase) | Spec | Code hiện tại |
|---|---|---|
| Multi-tenant Foundation (P0–P1) | ✅ Reviewed | **✅ Có** — RLS + tenantRepo + 51 bảng |
| Tenant Routing & Authz (P2) | ✅ Reviewed | ⬜ Chưa (DD-27 channel-aware authz đã chốt trên giấy) |
| Session Management (P2/P4) | ✅ Reviewed | ⬜ Chưa (bảng sessions/occurrences/recurrence có sẵn) |
| Payment Reconciliation (P3) | ✅ Reviewed | 🟡 Một phần — **logic** đã có ở `core` (matching + payments-logic); **wiring** webhook→settle→notify chưa |
| Identity & Merge (P3.5) | ✅ Reviewed | ⬜ Chưa (bảng link_codes/merge_audit/tombstones có sẵn) |
| Notifications & Reminders (P3/P4.5) | ✅ Reviewed | ⬜ Chưa (bảng notification_* có sẵn) |
| Web Auth & Onboarding (P4) | ✅ Reviewed | 🟡 **Auth Onboarding v3 (Telegram-era) merged** (`5b1193b`) + web tests; DD-37 supersede provider → Google/email chưa implement |
| Sync Engine (P4) | ✅ Reviewed | ⬜ Chưa (outbox/projector tables có sẵn, projectors chưa viết) |
| Marketplace Discovery (P4.3) | ✅ Reviewed | ⬜ Chưa (public_sessions có sẵn) |
| Cross-club Join (P4.3) | ✅ Reviewed | ⬜ Chưa (join_requests có sẵn) |
| ~~Player Telegram~~ → Player Messenger (P2.5, DD-37) | 🟡 Draft (feature_player_telegram **archived**) | ⬜ Chưa (bot mới có khung queue) |
| Player View (P4.6) | ✅ Reviewed | ⬜ Chưa |
| Zalo Channel (P4.7) | ✅ Reviewed | ⬜ Chưa (zalo_bots/reply_contexts có sẵn) |
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
(Zalo external spikes), **DD-33** (Facebook link/App Review), và **DD-34/35/36**
(Club Assistant P7 detail). **DD-18 chỉ chặn GO-LIVE Club Assistant, không chặn build interface-swappable.**
**DD-49..56 closure 2026-07-16 (v1.37; current decisions v1.39): ✅ policy/contracts propagated** — money correction, không-thu-SĐT/HR4, Host Pro lifecycle, guest→full/ban, identity recovery, PII config, DM/media, co-admin. Không còn founder choice chặn S4→S8, nhưng B0/B1/B2/B3 + DD-49 correction probes vẫn chặn các path tương ứng; legal A3 chặn go-live. Checklist: `../pre-code-open-items-2026-07-16.md`.
**DD-02/05/06/08/10/12/41–46 đã ✅ chốt; DD-47/48 đã chốt framework** nhưng schema/code vẫn pending.
DD-13 (Google/email) ✅ nhưng provider chưa implement; auth đã land vẫn là Telegram-era. DD-37/38/39 ✅;
chat/giá theo giới tính còn chờ migration.

---

## 7. Live verification (2026-07-16)

Reality-check trên local working tree hiện tại; giữ kết quả full-suite gần nhất làm historical evidence riêng:

| Gate | Kết quả |
|---|---|
| `pnpm lint` (16/07) | ✅ Pass |
| `pnpm build` (16/07) | ✅ Pass; typecheck + Next production build; live routes vẫn gồm Telegram-era auth callback/state như code snapshot đã nêu |
| `pnpm format:check` (16/07) | ✅ Pass full repo sau trusted-ingress/CI/docs/P&L closure |
| Non-DB tests (16/07) | ✅ Core **111** · web **65** · bot **3** pass; web có thêm provider-pinned client-IP regression matrix |
| Static infra/config (16/07) | ✅ Manifest JSON parse · `/bin/bash -n` · Compose config · `git diff --check` pass |
| Canonical DB/full test (16/07) | ✅ Docker PostgreSQL `/plexco_test`: **20 files / 223 tests pass** (core 111 · DB/RLS/auth 44 · web 65 · bot 3); container được stop sau verify |
| Previous full-suite baseline (13/07, historical) | ✅ **20 files / 214 tests pass** trước trusted-ingress regression expansion |
| Local Markdown link + anchor scan (16/07) | ✅ **151 Markdown files** trong current working tree, 0 broken local links/anchors · 0 unbalanced fence |

Phạm vi xác nhận hiện tại: local working tree; full PostgreSQL suite 16/07 là current green cho checkout này.
Đây không thay remote CI/Security workflow, staging/restore/provider evidence và không có nghĩa feature layer đã implement.

---

## 8. Bảo trì doc này

Cập nhật khi: (a) một slice merge vào `main`, (b) một feature chuyển từ ⬜→🟡→✅, (c) một DD đổi trạng
thái ảnh hưởng build. Giữ đồng bộ với `docs/autopilot-backlog.md` và `decisions.md` (2 nguồn sự thật —
doc này chỉ *tổng hợp*, không thay thế).
