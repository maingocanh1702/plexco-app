# 📋 BACKLOG — P0 → P3 (issue-ready checklist)

> Mỗi `##` = 1 module (epic). Mỗi `- [ ]` = 1 issue/checkbox copy thẳng sang GitHub Issues.
> Mỗi issue đóng được khi: code đúng AC + test xanh (gồm gate liên quan) + không phá gate phase trước.
> Ký hiệu gate: **[ISO]** isolation · **[PUB]** public · **[LED]** ledger · **[SYNC]** sync · **[WRK]** worker/RLS.
> **[PUB] có 2 mức:** *whitelist skeleton gate* (từ P0 — mọi cột `public_sessions` ∈ whitelist) và *full discovery-leak gate* (từ P4.3 — discovery/join không lộ tiền/PII/roster; chống scrape). Backlog P0–P3 chỉ bật **mức skeleton**.
>
> **Cập nhật 10/07/2026 (DD-37 / BRD v3.4):** **Telegram bỏ khỏi phạm vi.** Kênh chat phase-1 = **Zalo (P2)** + **Facebook Messenger (P2.5)**; nhắc chính = **web push + Zalo DM**, Messenger best-effort trong 24h. Auth phase-1 = **Google OAuth + email/password** (DD-13). EPIC M4 dưới đây đã reframe Telegram→Zalo/Messenger (giữ nguyên cơ chế routing/authz).

---

## EPIC M1 — Monorepo + lift `core` (+ sports)  · P0 · 🏢

- [ ] Khởi tạo monorepo pnpm: `packages/core`, `apps/bot`, `apps/web`; tsconfig + lint + CI skeleton (GitHub Actions chạy `pnpm test`).
- [ ] Dựng Postgres qua docker-compose cho dev; script `db:up` / `db:reset`.
- [ ] Lift logic thuần sang `packages/core`: `matching`, `payments-logic`, `dates`, `format`, `i18n`, **`sports`** — **không** phụ thuộc DB.
- [ ] Port test cũ của bot single-club vào `core`; **toàn bộ xanh lại** làm reference (matching name/amount/ngày, FIFO 2-buổi-đồng-giá).
- [ ] CI: job `core` chạy unit test, fail PR nếu đỏ.

**DoD:** `pnpm -F core test` xanh; monorepo build sạch; CI bật.

---

## EPIC M2 — Postgres + Drizzle + RLS + public skeleton · P0 · 🏢

- [ ] Drizzle schema + migration `01_tenants_rls`: bảng `tenants`, role SQL `app LOGIN NOSUPERUSER NOBYPASSRLS`.
- [ ] Mỗi bảng tenant-scoped: `ENABLE` + `FORCE ROW LEVEL SECURITY` + policy `USING (tenant_id = current_setting('app.tenant_id', true)::uuid)` (missing → NULL → 0 dòng, fail-closed).
- [ ] `withTenant(tenantId, fn)`: mở transaction, `SET LOCAL app.tenant_id`, hết tx tự xoá context.
- [ ] **[ISO]** Test bất biến cô lập (CI bắt buộc): tenant A/B — repo B không thấy session/charge của A; query quên `SET LOCAL` → 0 dòng.
- [ ] Bảng `public_sessions` skeleton (cross-tenant, **không RLS**) với đúng field whitelist: `session_id, tenant_id(join-routing), sport_key, starts_at, ends_at, area, skill_level, price, slots_open, host_display_name, club_display_name, join_policy`.
- [ ] **[PUB]** Test bất biến public (CI bắt buộc): mọi cột `public_sessions` ∈ whitelist; không có cột tiền/PII/roster.

**DoD:** `drizzle push` sạch; RLS bật; **[ISO]** + **[PUB]** xanh trong CI. → góp vào **Milestone MS1**.

---

## EPIC M3 — Tenant schema đa môn + repo choke-point · P0–P1 · 🏢

- [ ] Migration `02_sessions_players_charges`: mọi bảng có `tenant_id`; `sports` (key/name/active); `sessions.{sport_id, starts_at, ends_at, timezone, price, slots_max, area, venue, skill_level, visibility(private|public), join_policy(open|approval), status}`.
- [ ] UNIQUE quan trọng: `players(tenant_id,session_id,membership_id)`, `charges(tenant_id,session_id,player_id)`, `(tenant_id,pay_code)`.
- [ ] `tenantRepo(tenantId)` choke-point: **nơi DUY NHẤT** chèn `tenant_id`; port toàn bộ API `db.ts` cũ vào, mỗi hàm khép kín tenantId; handler **không** tự viết `WHERE tenant_id`.
- [ ] Edge #30: chỉ chọn môn từ `sports` active; không tự do nhập.
- [ ] Migration `03_settings`: `settings(tenant_id,key)` + RLS.
- [ ] **[ISO]** mở rộng test cô lập cho mọi bảng mới.

**DoD:** schema đa môn đủ; repo choke-point thay mọi truy cập trực tiếp; **[ISO]** xanh. → đóng **Milestone MS1**, bật `P0-P1 = done`.

---

## EPIC M4 — Chat-channel tenant middleware (Zalo · P2 → Messenger P2.5) · P2 · 🏢

> **DD-37:** Telegram bỏ. Kênh phase-1 = Zalo (P2, chính) + Facebook Messenger (P2.5). Cơ chế "route tenant suy từ kênh + authz theo person" giữ nguyên; chỉ đổi khoá định tuyến.

- [ ] Zalo bot webhook `/webhook/zalo/:token` (bot-token per-club); Messenger webhook `/webhook/messenger` (1 App Plexco, Page per-club) — P2.5. *(Telegram bỏ — DD-37.)*
- [ ] Middleware resolve tenant **từ kênh** (NFR-S3 — không suy từ nội dung): Zalo `webhookToken → zalo_bot → tenant`; Messenger `page_id → tenant`; gắn `ctx.tenant` + `ctx.repo = tenantRepo(tenant.id)`.
- [ ] Join/link theo kênh: Zalo **DM number-reply** (`/join` + số; GROUP còn Beta, không inline button); Messenger quick-reply/persistent menu + deep-link `ref=club_<slug>`; bind `TenantAdmin` + channel-link; player context KHÔNG auto-join.
- [ ] Authz 2 lớp: `ADMIN_CMD` → `isTenantAdmin(tenant.id, <định danh người của kênh>)` theo người, **không** theo chat/PSID (Edge #16).
- [ ] Lệnh host đa-tenant: `/newsession` (đa môn), `/announce`, `/config`, **mark-paid thủ công (tiền mặt/CK)**; cron đa-tenant + throttler per-channel (jitter); nhắc chính **web push + Zalo DM**, Messenger best-effort trong 24h.
- [ ] Fail-closed: kênh chưa nối tenant → `TENANT_NOT_LINKED` (404), không lộ.
- [ ] Test routing: 2 token/Page khác nhau → 2 club; lệnh admin từ non-admin → `NOT_TENANT_ADMIN`.

**DoD:** kênh phase-1 (Zalo per-club + Messenger Page-per-club) phục vụ ≥2 club khác tenant, lệnh không lẫn; authz theo định danh người xanh. *(Telegram bỏ — DD-37.)*

---

## EPIC M5 — Durable webhook + ledger/allocation + /unmatched · P3 · 💰 (killer flow)

- [ ] Migration `06_bank_accounts_transactions_allocations`: `bank_accounts`, `bank_transactions`, `charges`, `payment_allocations` + RLS.
- [ ] Endpoint `/webhook/sepay/:token`: `findBankAccountByToken` + `timingSafe(secret)` + verify `account_number` (Edge #14 → 401/409, vẫn lưu raw, không log secret).
- [ ] **Durable ingest:** trong 1 DB transaction — INSERT `bank_transactions` idempotent `UNIQUE(tenant,provider,external_id)` `ON CONFLICT DO NOTHING` + enqueue reconcile job (pg-boss) → **commit rồi mới ACK** provider (Edge #5; thiếu id → synthetic `sha256(provider|acct|amount|date|content)` Edge #6).
- [ ] Matching engine tenant-scoped: ưu tiên `pay_code` (nullable, **chưa phụ thuộc** — TDD §10.5) → fallback tên + số tiền + ngày.
- [ ] `payment_allocations`: hỗ trợ partial / multi-person / overpay / reversal; FIFO khi 2 buổi đồng giá cùng ngày (Edge #1); tổng allocation ∈ `[0, bank_tx.amount]` và ∈ `[0, charge.amount_due]`; charge chỉ `paid` khi phủ đủ.
- [ ] Ledger invariants ở DB/transaction: bank allocation dương + bắt buộc `bank_transaction_id`; cash/waiver bắt buộc actor; reversal âm + ref allocation gốc; không sửa/xoá allocation đã audit.
- [ ] `/unmatched`: CK không khớp/còn dư → danh sách; owner gán tay → `markPaid`; retry cron `EVERY_HOUR`.
- [ ] **[LED]** Test bất biến ledger (CI): 1 CK chia nhiều charge/người; partial không paid; over-allocation chặn (`ALLOCATION_EXCEEDS_FUNDS` 409); duplicate/retry/reversal giữ đúng tổng.
- [ ] **[WRK]** Test worker/RLS: job nhận `tenant_id` → `SET LOCAL` → gọi cùng service; claim `FOR UPDATE SKIP LOCKED`; privileged call có audit.

**DoD:** webhook → markPaid ≤ 5s P99; **[LED]** + **[WRK]** xanh; webhook trùng → idempotent 1 lần. KPI phase: % auto-match name-based ≥ 70%.

---

## EPIC M6 — Migrate bot cũ → tenant #1 (dogfood) · P3 · 🏢

- [ ] Script đọc `data/bot.db` (SQLite) → tạo tenant **"Bestminton"** + Account owner + `BankAccount`, gắn **sport = cầu lông**. *(DD-37: kênh Plexco phase-1 = Zalo/Messenger; player re-link qua Zalo/Messenger + Person link — KHÔNG tạo TelegramLink. Bot Telegram cũ đóng băng làm reference.)*
- [ ] Copy `sessions/players/members/aliases` gắn `tenant_id`; mỗi player-session → 1 `charge`.
- [ ] Payment lịch sử: có giao dịch gốc → import real `bank_transaction` + allocation; thiếu bằng chứng → chỉ import sau B1 dedicated legacy/attested source (`bank_transaction_id=NULL`, migration actor + opaque evidence), chưa có contract thì halt/manual review. Cấm synthetic bank transaction.
- [ ] **Đối chiếu trước cutover:** tổng charge / allocated / unallocated + số roster khớp giữa SQLite và Postgres.
- [ ] Cutover: đổi webhook SePay sang Plexco → tắt bot cũ (bot cũ **đóng băng** làm reference).
- [ ] Founder bắt đầu dogfood thật: 1 buổi/tuần chạy trên Plexco.

**DoD:** đóng **Milestone MS2** — ≥2 CLB trên 1 bot, đối soát/nhắc không lẫn; tenant #1 vận hành thật; số đối chiếu khớp 100%.

---

## Gate matrix (cái gì phải xanh ở mỗi mốc)

| Mốc | [ISO] | [PUB] | [LED] | [WRK] | [SYNC] |
|---|:--:|:--:|:--:|:--:|:--:|
| MS1 (P0–P1) | ✅ | ✅ skeleton | — | — | — |
| MS2 (P2–P3) | ✅ | ✅ skeleton | ✅ | ✅ | — |

> **[PUB] full leak gate** và **[SYNC] gate** bật ở **P4 / P4.3** (cùng Web+Sync+Marketplace), không thuộc backlog này.
> Sau M6, đi tiếp **P3.5 Identity (M7)** rồi **P4 Web+Sync (M8/M9)**. Backlog P3.5+ tách file riêng khi tới gần (giữ WIP thấp, không decompose quá xa).
