# Bestminton → Plexco: Feature Audit & Reusability Analysis

> **Mục tiêu:** Kiểm kê toàn bộ tính năng/code đã ship của Bestminton bot, đánh giá khả năng tận dụng cho Plexco.

---

## 1. Bestminton Bot — Feature Inventory (19 Features, All Shipped ✅)

| # | Feature | Code Files | LOC (approx) | Test Coverage |
|---|---------|-----------|:---:|:---:|
| F01 | Session Management | `bot.ts`, `sessions.ts`, `db.ts` | ~4k + 6.8k | ✅ `db.test.ts` |
| F02 | Photo Import (LLM) | `llm.ts`, `bot.ts` | ~16k + ??? | ✅ partial |
| F03 | Voice Control (STT) | `voice.ts`, `stt.ts` | ~20k + 10k | ✅ `stt.test.ts` |
| F04 | Auto Payment Match | `matching.ts`, `payments.ts` | ~24k + 37k | ✅ `matching.test.ts`, `payments.test.ts` |
| F05 | Amount Classification | `payments-logic.ts` | ~6.4k | ✅ `payments-logic.test.ts` |
| F06 | Cross-session Settlement | `payments.ts` | (included in F04) | ✅ |
| F07 | Pay Code (BMTxxxx) | `matching.ts`, `db.ts` | ~2k | ✅ `player-p4.test.ts` |
| F08 | Members & Aliases | `db.ts`, `matching.ts`, `merge-members.ts` | ~3.7k | ✅ |
| F09 | Capacity & Waitlist | `db.ts`, `bot.ts` | ~??? | ✅ `waitlist.test.ts` |
| F10 | Notifications (Owner) | `notify.ts`, `reminder.ts` | ~6k + 12k | ✅ `post-session-remind.test.ts`, `presession-remind.test.ts` |
| F11 | Notifications (Player) | `tg/notify-players-tg.ts`, `zalo/notify-players.ts` | ~2.5k + 15.7k | ✅ `notify-players-*.test.ts` |
| F12 | Multi-bank & VietQR | `banks.ts`, `vietqr.ts` | ~7k + 0.9k | ✅ `banks.test.ts`, `vietqr.test.ts` |
| F13 | Telegram Transport | `bot.ts`, `tg/player-tg.ts` | ~131k + 53k | ✅ `player-tg.test.ts` |
| F14 | Zalo Transport | `zalo/zbot.ts`, `zalo/player.ts` | ~122k + 37k | ✅ `zalo/player.test.ts` |
| F15 | Weekly Template | `reminder.ts` | (included in F10) | ✅ |
| F16 | i18n (vi/en) | `i18n.ts` | ~1k | — (trivial) |
| F17 | Auto-announce | `announce.ts` | ~3k | — |
| F18 | Fan-out + Guard | `payments.ts`, `notify.ts` | (cross-cutting) | ✅ |
| F19 | Club Identity & Contact | `club.ts` | ~6.9k | ✅ `club.test.ts` |

### KPI đã đạt (production, ~30-50 CK/tuần)
- Auto-match rate: **~85%** (fuzzy + rules + pay code)
- CK → notify latency: **<2s**
- False positive (đánh sai tiền): **0**
- Test pass rate: **100%** (27+ test files)

---

## 2. Plexco App — Current Progress

| Hạng mục | Trạng thái |
|----------|-----------|
| Core docs (BRD/PRD/TDD/ROADMAP) | ✅ v2.1 reviewed |
| Feature specs | ✅ 15/15 written (3 reviewed, 12 drafted) |
| Templates & standards | ✅ Created |
| **Monorepo scaffold** | ⬜ Not started |
| **Any code** | ⬜ Not started |

> **Plexco đang ở giai đoạn docs-only, chưa có 1 dòng code.**

---

## 3. Architecture Comparison

| Dimension | Bestminton (Single-club) | Plexco (Multi-tenant SaaS) |
|-----------|------------------------|-----------------------------|
| **Database** | SQLite (`node:sqlite`) | PostgreSQL + Drizzle ORM + RLS |
| **Tenant model** | Single instance, 1 owner | Multi-tenant, `tenant_id` RLS, fail-closed |
| **Bot framework** | grammY (direct) | grammY (qua middleware tenant) |
| **Zalo** | Custom HTTP + polling/webhook | Custom HTTP, per-club BYO token |
| **Web** | ❌ None | Next.js/Express SSR + SSE |
| **Payment** | SePay/ApiPay webhook → SQLite | SePay/ApiPay webhook → PostgreSQL ledger |
| **Matching** | Fuzzy name + pay code | **Same** (lift from core) |
| **i18n** | `t(vi, en)` inline | **Same** (lift from core) |
| **Sync** | N/A | Command bus + Outbox + Projectors |
| **Identity** | SQLite `members` table | Person/ChannelIdentity/Membership + merge |
| **Queue/Cron** | node-cron in-process | pg-boss on PostgreSQL |

---

## 4. Reusability Matrix — Bestminton → Plexco `packages/core`

### 🟢 Direct Lift (Copy → minor refactor → tests xanh)

Các module này **pure logic, không phụ thuộc DB hay transport** — lift nguyên vẹn sang `packages/core`:

| Module | File | Size | Lift Effort | Notes |
|--------|------|:----:|:-----------:|-------|
| **Name matching** | [matching.ts](file:///Users/maingocanh/Projects/Bestminton%20Club%20Payment%20check%20bot/src/matching.ts) | 552 lines | ⚡ Trivial | Core fuzzy match + normalize VN names + alias learning + confidence scoring. **Thay `badminton` stopwords bằng configurable sport keywords** |
| **Date parsing** | [dates.ts](file:///Users/maingocanh/Projects/Bestminton%20Club%20Payment%20check%20bot/src/dates.ts) | 151 lines | ⚡ Trivial | `parseFlexibleDate`, `parseMoney`, `parseTimeAtStart`, `fmtDate` — 100% pure |
| **VietQR** | [vietqr.ts](file:///Users/maingocanh/Projects/Bestminton%20Club%20Payment%20check%20bot/src/vietqr.ts) | 24 lines | ⚡ Trivial | `buildVietQrUrl` — no deps, pure URL builder |
| **i18n** | [i18n.ts](file:///Users/maingocanh/Projects/Bestminton%20Club%20Payment%20check%20bot/src/i18n.ts) | 33 lines | ⚡ Trivial | `t(vi, en)`, `setLang`, `parseLang`. Plexco cần per-tenant lang → nâng thành context-based |
| **Format/display** | [format.ts](file:///Users/maingocanh/Projects/Bestminton%20Club%20Payment%20check%20bot/src/format.ts) | 223 lines | 🔧 Minor | `fmtMoney`, `esc`, `progressView`, `sessionStatusText`. **Tách display logic khỏi `db` import** |
| **Pay core** | [pay-core.ts](file:///Users/maingocanh/Projects/Bestminton%20Club%20Payment%20check%20bot/src/pay-core.ts) | 231 lines | 🔧 Minor | Self-pay / combo-pay compute. **Tách khỏi `db` import → inject repo** |

**Total liftable pure logic: ~1,200 lines** — đây là phần giá trị nhất, đã battle-tested với ~85% auto-match rate.

### 🟡 Adaptable (Cần refactor đáng kể)

| Module | File | Size | Adapt Effort | Notes |
|--------|------|:----:|:------------:|-------|
| **Payment processing** | [payments.ts](file:///Users/maingocanh/Projects/Bestminton%20Club%20Payment%20check%20bot/src/payments.ts) | 37k | 🔨 Medium | Core flow: dedupe → session select → match → allocate → notify. **Cần thay SQLite calls bằng Drizzle + tenant-scoped queries + ledger model** |
| **Payment logic** | [payments-logic.ts](file:///Users/maingocanh/Projects/Bestminton%20Club%20Payment%20check%20bot/src/payments-logic.ts) | 6.4k | 🔧 Minor | Amount classification (mark-all/need-more/too-few). **Mostly pure, minor db deps** |
| **SePay provider** | [sepay.ts](file:///Users/maingocanh/Projects/Bestminton%20Club%20Payment%20check%20bot/src/providers/sepay.ts) | 53 lines | 🔧 Minor | Webhook handler: auth + parse → `recordIncomingTransaction`. **Cần thêm tenant routing (`/webhook/sepay/:token`)** |
| **ApiPay provider** | [apipay.ts](file:///Users/maingocanh/Projects/Bestminton%20Club%20Payment%20check%20bot/src/providers/apipay.ts) | ~80 lines | 🔧 Minor | HMAC-SHA256 verify + parse. **Same: thêm tenant routing** |
| **Notifications** | [notify.ts](file:///Users/maingocanh/Projects/Bestminton%20Club%20Payment%20check%20bot/src/notify.ts) | ~6k | 🔨 Medium | Fan-out TG+Zalo. **Cần outbox pattern thay direct send** |
| **Reminder** | [reminder.ts](file:///Users/maingocanh/Projects/Bestminton%20Club%20Payment%20check%20bot/src/reminder.ts) | ~12k | 🔨 Medium | Cron jobs: nhắc nợ, weekly, backup. **Cần pg-boss thay node-cron, loop qua tenants** |
| **LLM (photo import)** | [llm.ts](file:///Users/maingocanh/Projects/Bestminton%20Club%20Payment%20check%20bot/src/llm.ts) | ~16k | 🔧 Minor | Multi-provider vision API. **Đã transport-agnostic, lift dễ** |
| **Banks** | [banks.ts](file:///Users/maingocanh/Projects/Bestminton%20Club%20Payment%20check%20bot/src/banks.ts) | ~7k | 🔨 Medium | Multi-bank management. **Cần tenant-scope** |
| **Members/Merge** | [merge-members.ts](file:///Users/maingocanh/Projects/Bestminton%20Club%20Payment%20check%20bot/src/merge-members.ts) | ~3.7k | 🔨 Medium | Merge logic. **Plexco cần Person/ChannelIdentity model phức tạp hơn** |

### 🔴 Cannot Lift — Plexco-only (New build)

| Feature | Why New |
|---------|---------|
| **Multi-tenant Foundation** | PostgreSQL + RLS + `tenantRepo` choke-point — không tồn tại trong Bestminton |
| **Tenant Routing & Authz** | Middleware `chat_id → tenant_id` + authz 2 lớp — mới hoàn toàn |
| **Web App + Dashboard** | Bestminton không có web — entire new surface |
| **Sync Engine** | Command bus + outbox + projectors — core architecture mới |
| **Marketplace Discovery** | Public read model + cross-tenant search — không có tiền lệ |
| **Cross-club Join** | Join request + approval flow — mới |
| **Billing & Lifecycle** | Subscription/trial/suspended — mới |
| **Security & Operations** | KMS, audit, pen-test, token-drift — production hardening mới |

---

## 5. Test Assets Transferable

Bestminton có **27 test files** — dưới đây là những test CÓ THỂ lift:

| Test | Lines | Reusable? |
|------|:-----:|:---------:|
| `matching.test.ts` | 19k | ✅ **Rất giá trị** — 100+ test cases cho VN name matching |
| `payments-logic.test.ts` | 2.5k | ✅ Amount classification tests |
| `vietqr.test.ts` | 2.3k | ✅ VietQR URL generation |
| `banks.test.ts` | 3.4k | 🟡 Cần adapt cho Drizzle |
| `stt.test.ts` | 2.7k | 🟡 STT parsing tests |
| `player-p4.test.ts` | 21.7k | 🟡 Pay code tests — lift pay code logic |
| `player-pay.test.ts` | 37.9k | 🟡 Payment flow tests — cần adapt cho ledger |

---

## 6. Key Patterns Worth Preserving

### A. BL-2 Invariant: "Không bao giờ đánh sai tiền"
```
Persist RAW transaction BEFORE acking webhook 200.
Only THEN attempt matching.
False positive = 0 in production.
```
→ **Plexco TDD đã document pattern này** (durable webhook, lưu raw trước ACK).

### B. Fan-out + Double-commit Guard
```
Payment notification fans out to TG + Zalo.
If handled on one platform, the other is blocked by double-commit guard.
```
→ **Plexco cần mở rộng** thành outbox + projector fan-out (TG + Zalo + Web SSE).

### C. Confidence-based Auto-match
```
Similarity score (88-100%) + 3 deterministic rules:
- Rule 1: template match (sport + date + name) → 100%
- Rule 2: same-day tx → 100%, ±1 day → 99%
- Rule 3: buddy (2 unique names) → 99%
```
→ **Lift sang core** — generalize `badminton` → `ctx.sport` keyword.

### D. VN Name Normalization Pipeline
```
NFD decompose → strip diacritics → đ→d → lowercase → alphanum only
+ alias learning from bank transfer descriptions
+ pay_code (BMTxxxx) deterministic matching
```
→ **Trực tiếp lift** — đây là IP quan trọng nhất.

### E. Multi-provider Payment Architecture
```
providers/ directory: mỗi provider = 1 file
- Parse webhook → IncomingTransaction
- Register Express route
- PROVIDERS env toggle
```
→ **Giữ pattern**, thêm tenant routing (`/webhook/:provider/:token`).

---

## 7. Recommended Lift Strategy (Theo Plexco Roadmap)

### P0: Foundation — Lift `packages/core`

```
packages/core/
  ├── matching.ts       ← lift from Bestminton (generalize sport keywords)
  ├── matching.test.ts  ← lift test suite
  ├── dates.ts          ← lift as-is
  ├── dates.test.ts     ← lift
  ├── format.ts         ← lift (remove db import → inject data)
  ├── vietqr.ts         ← lift as-is
  ├── vietqr.test.ts    ← lift
  ├── i18n.ts           ← lift (enhance to per-tenant context)
  ├── money.ts          ← parseMoney from dates.ts
  └── sports.ts         ← NEW: sport taxonomy (cầu lông, pickleball, tennis...)
```

> **Ước tính: ~1,200 lines code + ~20,000 lines test** có thể lift trong P0.

### P3: Payment Reconciliation — Adapt payment flow

```
packages/core/
  ├── payments-logic.ts  ← lift (amount classification)
  ├── pay-core.ts        ← lift (self-pay/combo compute, inject repo)
  └── providers/
      ├── types.ts        ← IncomingTransaction interface
      ├── sepay.ts        ← adapt (add tenant routing)
      └── apipay.ts       ← adapt (add tenant routing)

apps/bot/
  └── payments.ts        ← adapt (SQLite → Drizzle + tenant-scoped + ledger)
```

### P4.5-P4.7: Player Channels — Adapt transport

```
apps/bot/
  ├── tg/               ← adapt from Bestminton tg/ (tenant middleware)
  └── zalo/             ← adapt from Bestminton zalo/ (per-club token)
```

---

## 8. Tổng kết

| Metric | Giá trị |
|--------|---------|
| **Bestminton features shipped** | 19/19 (100% production) |
| **Plexco code progress** | 0% (docs only) |
| **Lines directly liftable** | ~1,200 (pure logic) |
| **Test lines liftable** | ~20,000+ |
| **Lines needing adaptation** | ~80,000+ (transport, db, notifications) |
| **Lines completely new** | Multi-tenant, RLS, Web, Sync, Marketplace, Billing |

### Kết luận

1. **Bestminton là prototype đã validate xong** — 19 features chạy production, ~85% auto-match, 0 false positive. Plexco roadmap đã explicitly gọi nó là "tenant #1 khi cutover".

2. **`packages/core` nên lift trước** (P0): `matching.ts`, `dates.ts`, `vietqr.ts`, `i18n.ts`, `format.ts` — đây là IP lõi, battle-tested, và **không phụ thuộc storage**.

3. **Payment flow adapt ở P3**: giữ BL-2 invariant + confidence model + multi-provider pattern, nhưng backend chuyển từ SQLite → PostgreSQL ledger + tenant-scoped.

4. **Transport adapt ở P4.5+**: `bot.ts`/`zbot.ts` là ~250k lines nhưng tightly coupled với SQLite — cần viết lại tầng data, giữ UX flow.

5. **Phần lớn giá trị nằm ở matching + tests** — 19k lines matching tests là asset quý nhất, cover hàng trăm edge cases tên VN.

> [!IMPORTANT]
> **Bestminton roadmap v2.0 đã ghi rõ:** "SaaS = project riêng, ngoài scope repo Bestminton." Plexco chính là project riêng đó. Chiến lược đúng: **lift pure logic → `packages/core`**, không sửa Bestminton repo.
