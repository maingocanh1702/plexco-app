# BUILD-STATUS — Plexco (đã build vs. đã spec)

> **Mục đích:** ảnh chụp tiến độ *thực thi* so với khối tài liệu đã Reviewed. Trả lời gọn:
> "code đã có tới đâu, còn cách MVP bao xa". Đây là doc **living**, cập nhật mỗi khi một slice merge.
> **Cập nhật:** 2026-07-06 (sau merge phase-1).
> **Nguồn số liệu:** `git log`, cây `packages/`+`apps/`, `docs/features/*`, `docs/standards/decisions.md`,
> `docs/autopilot-backlog.md`. Số liệu code = đếm tại commit `3f2172a`.

---

## 0. TL;DR

| Trục | Trạng thái | Ước lượng |
|---|---|---|
| **Tài liệu / thiết kế** | 18/18 feature-doc ở mức **Reviewed**; 31 decision (DD-01..DD-31), phần lớn ✅ Chốt | ~95% cho MVP |
| **Code — lớp nền (foundation)** | monorepo + core logic + DB/RLS đã merge, có test | **✅ xong** |
| **Code — lớp auth** | mới ở mức *security-design pass* (docs + DD-31 proposal), chưa có code | 🟡 đang thiết kế |
| **Code — lớp feature nghiệp vụ** | chưa bắt đầu (session/reconcile/sync/marketplace/billing/bot…) | ⬜ chưa build |
| **Roadmap build** | **3 / 20 slice** đã land (S1, S2, S3); S4 đang design | ~15% |

**Một câu:** phần *khó và nền tảng nhất* (đường tiền thuần + DB có RLS fail-closed) đã dựng xong và
được test; toàn bộ tầng feature còn nằm trên giấy. Project đang ở ranh giới **Phase 0→1**: hết
"planning & docs", vừa đặt xong 3 viên gạch móng đầu tiên.

---

## 1. Bức tranh tổng: docs đi trước code rất xa

Repo được xây theo hướng **docs-first**: toàn bộ 18 feature (FE + BE) và 31 quyết định thiết kế đã
được review và chốt *trước* khi viết code. Vì vậy khoảng cách hiện tại **không phải** là thiếu thiết
kế — mà là thiết kế đã sẵn sàng, thực thi mới chạy được ~15% roadmap.

```
Thiết kế  ████████████████████░  ~95%   (18 feature Reviewed, 31 DD)
Nền móng  ████████████████████░  ~90%   (core + db-RLS + scaffold, có test)
Auth      ████░░░░░░░░░░░░░░░░░░  ~20%   (design pass xong, chưa code)
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

**~2.522 dòng, 51 bảng trong `schema.ts`, 12 migration, có bộ RLS invariant test chạy trên role runtime thật.**

- **Migrations 0000→0011:** roles/extensions → global directory → tenants → payments-ledger →
  channels/connectors → sync-engine → discovery → billing → notifications/onboarding → RLS
  policies/grants → functions/triggers → seeds.
- **Choke-point:** `tenant.ts` (`tenantRepo`/`withTenant`) — mọi query tenant-scoped bắt buộc qua đây,
  `SET LOCAL app.tenant_id`, client theo role. `migrate.ts` = runner transactional, immutability + RLS guard.
- **Bất biến đã test (`rls-invariants.test.ts`):** RLS fail-closed trên role thật; occurrence chứng minh
  **cả hai** parent thuộc đúng tenant; app **không** import `@plexco/db/schema` trực tiếp (HR1 lint guard).
- 51 bảng đã dựng đủ cho hầu hết feature phía sau (persons/accounts/channel_identities/memberships,
  payments/allocations/bank_transactions, public_sessions, outbox_events/projector_deliveries,
  subscriptions/billing_*, link_codes/merge_audit/merge_tombstones, magic_links/web_sessions/oauth_transactions…).
  → **Schema đi trước; code feature dùng chúng thì chưa có.**

### 2.3 `apps/web` + `apps/bot` — mới là vỏ (shell) 🟡

Chỉ ~**181 dòng** tổng cộng:
- `apps/web`: `layout.tsx`, `page.tsx`, `healthz/route.ts`, `next.config.mjs` — khung Next.js + health check.
- `apps/bot`: `queue.ts`, `queues.ts`, `worker.ts`, `provision-queue.ts` + `queue.test.ts` — khung hàng đợi.

Chưa có: command handlers, services, projectors, API nghiệp vụ, UI thật, tích hợp grammY/Zalo, webhook reconcile.

---

## 3. Đối chiếu từng feature: **spec Reviewed** vs **code**

18 feature đều **Reviewed** (thiết kế xong). Cột "Code" cho biết thực thi tới đâu.

| Feature (Phase) | Spec | Code hiện tại |
|---|---|---|
| Multi-tenant Foundation (P0–P1) | ✅ Reviewed | **✅ Có** — RLS + tenantRepo + 51 bảng |
| Tenant Routing & Authz (P2) | ✅ Reviewed | ⬜ Chưa (DD-27 channel-aware authz đã chốt trên giấy) |
| Session Management (P2/P4) | ✅ Reviewed | ⬜ Chưa (bảng sessions/occurrences/recurrence có sẵn) |
| Payment Reconciliation (P3) | ✅ Reviewed | 🟡 Một phần — **logic** đã có ở `core` (matching + payments-logic); **wiring** webhook→settle→notify chưa |
| Identity & Merge (P3.5) | ✅ Reviewed | ⬜ Chưa (bảng link_codes/merge_audit/tombstones có sẵn) |
| Notifications & Reminders (P3/P4.5) | ✅ Reviewed | ⬜ Chưa (bảng notification_* có sẵn) |
| Web Auth & Onboarding (P4) | ✅ Reviewed | 🟡 **Design pass v3** (DD-31, 8 bất biến SI-1..SI-8), chưa code |
| Sync Engine (P4) | ✅ Reviewed | ⬜ Chưa (outbox/projector tables có sẵn, projectors chưa viết) |
| Marketplace Discovery (P4.3) | ✅ Reviewed | ⬜ Chưa (public_sessions có sẵn) |
| Cross-club Join (P4.3) | ✅ Reviewed | ⬜ Chưa (join_requests có sẵn) |
| Player Telegram (P4.5) | ✅ Reviewed | ⬜ Chưa (bot mới có khung queue) |
| Player View (P4.6) | ✅ Reviewed | ⬜ Chưa |
| Zalo Channel (P4.7) | ✅ Reviewed | ⬜ Chưa (zalo_bots/reply_contexts có sẵn) |
| Billing Lifecycle (P5) | ✅ Reviewed | ⬜ Chưa (subscriptions/invoices/charges có sẵn) |
| Security & Operations (P6) | ✅ Reviewed | 🟡 Một phần — RLS/HR1 guard đã thực thi; phần còn lại chưa |
| Club Assistant (P7 post-MVP) | ✅ DD chốt (DD-16..28) | ⬜ Chưa (player_chat_context có sẵn) |
| Connector Onboarding | 🟡 Draft (provider-contract reviewed) | ⬜ Chưa (provider_connections/onboarding_* có sẵn) |
| Marketplace/Sync… | — | — |

**Đọc bảng này thế nào:** gần như mọi feature đã có (a) spec Reviewed và (b) *bảng DB tương ứng* dựng
sẵn ở S3 — nhưng (c) tầng command/service/projector/UI thì trắng. Đây là dấu hiệu lành mạnh của
docs-first + schema-first: rủi ro thiết kế đã hạ, việc còn lại là "điền code" theo spec.

---

## 4. Roadmap build (orchestrator 20 slice)

Nguồn: `docs/autopilot-backlog.md` (Phase-1 full-launch, S1→S20, chừa Messenger vì Meta App Review).

| Slice | Nội dung | Trạng thái |
|---|---|---|
| **S1** monorepo-scaffold | pnpm workspace, toolchain, CI, runtime shells, infra | ✅ **merged** |
| **S2** core-lift (+S2d foundations) | matching/dates/payments-logic + i18n/format/vietqr/sports | ✅ **merged** |
| **S3** db-postgres-drizzle-rls | schema + 12 migration + RLS choke-point + invariant suite | ✅ **merged** |
| **S4** auth | web-auth/onboarding | 🟡 **design pass** (DD-31), code chưa bắt đầu |
| S5 session · S6 sync-engine · S7 reconcile · S8 identity-merge | | ⬜ chưa |
| S9–S12 web PWA + marketplace · S13 cross-club · S14 billing | | ⬜ chưa |
| S15 host-pro-auto · S16 reminders-auto · S17 TG · S18 Zalo | | ⬜ chưa |
| S19 club-assistant (DD-gate ✅) · S20 polish | | ⬜ chưa |
| Messenger | post-MVP, Meta App Review | ⏸ chừa |

**Tiến độ: 3/20 slice đã build + 1 đang thiết kế ≈ 15% chặng đường code.**

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

---

## 6. Gap & bước tiếp theo hợp lý

**Còn thiếu để có MVP chạy được:** toàn bộ tầng feature (S4→S19). Ưu tiên tự nhiên theo dependency:

1. **S4 — Web Auth & Onboarding**: design đã xong (DD-31), việc kế tiếp là *implement* 8 bất biến +
   đóng 4 gap. Đây là item sẵn sàng nhất để bắt tay.
2. **S5 Session** + **S7 Reconcile**: reconcile đã có sẵn `core` logic → chỉ cần wiring
   webhook → tenantRepo → outbox → notify. Đòn bẩy cao nhất (đường tiền).
3. **S6 Sync-engine**: viết projectors đọc `outbox_events` fan-out (TG/Zalo/SSE/public_sessions).
4. **S8 Identity-merge**: bảng đã sẵn; cần luồng claim/merge có OTP (HR4).

**Quyết định còn treo có thể chặn/định hình build:** DD-02 (pay_code), DD-04 (Neon vs Supabase),
DD-05/06 (join/vị trí public), DD-08 (danh sách môn — ⬜ Mở), DD-10 (Express vs Next), DD-12
(projection vs materialized view), DD-13/14/15 (auth provider mở rộng, Zalo). DD-18 chặn GO-LIVE
(không chặn build) cho Club Assistant.

---

## 7. Bảo trì doc này

Cập nhật khi: (a) một slice merge vào `main`, (b) một feature chuyển từ ⬜→🟡→✅, (c) một DD đổi trạng
thái ảnh hưởng build. Giữ đồng bộ với `docs/autopilot-backlog.md` và `decisions.md` (2 nguồn sự thật —
doc này chỉ *tổng hợp*, không thay thế).
