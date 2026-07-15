# HANDOFF — Plexco

> **Đọc file này ĐẦU TIÊN khi tiếp quản project.** Self-contained: không cần context phiên trước.
> Cập nhật: 2026-07-15 (BRD v3.5 · PRD v2.4 · TDD v2.4 · ROADMAP v2.7 · decisions v1.31). Khi thay đổi convention/kiến trúc lớn → cập nhật file này.
>
> **⚡ v3.4 Phase-1 pivot (DD-37 ✅, thay DD-09):** Kênh phase-1 = **web + Zalo + Facebook Messenger**;
> **Telegram đã bị loại khỏi phạm vi** (không còn adapter/bot Telegram trong MVP). Auth phase-1 =
> **Google OAuth + email/password** (DD-13 ✅, thay TG Login) + link **Facebook** (DD-33 🟡, phase-1, phụ thuộc App Review)
> + **Zalo** (DD-14 ⬜). Feature phase-1 mới: **Google login**, **chat cơ bản trong app** (DD-38 ✅, committed phase-1),
> **cài đặt hồ sơ + giá theo giới tính** (DD-39 ✅, committed phase-1), **mark-paid thủ công tiền mặt/CK, tap/multi-select** (DD-40 ✅).
> *(DD-38/39 committed — schema `chat_*`/`person.gender` chưa vào canonical `schema.ts`, migration còn chờ.)*

---

## 0. TL;DR cho dev/AI mới (làm theo thứ tự)
1. Đọc hết file này.
2. `git log --oneline -15` + `git status` để biết hiện trạng.
3. Đọc `README.md` (tính năng + setup + doc map).
4. **TRƯỚC mọi việc đụng code/git: nắm 5 HARD RULES ở §3 — vi phạm = rò rỉ tiền/PII thật.**
5. Việc mới: theo workflow ở §5 (không tự ý sửa thẳng main).
6. **Autopilot — bắt đầu ở `docs/autopilot-ONBOARDING.md`** (entry point duy nhất, pin template v0.6.0, bản canonical repo tại `docs/autopilot-templates/`, đã sync từ `Claude template` 2026-07-15). Setup máy nhanh: chạy **`scripts/autopilot-onboard.sh --codex /abs/path/to/codex`** (idempotent: `@import` invariants vào `~/.claude/CLAUDE.md`, pin `AUTOPILOT_CODEX_BIN`, verify kit). Chạy nhiều session/feature song song qua **git worktree riêng (base `main`) + `scripts/autopilot-scope-gate register --manifest docs/autopilot-manifests/<slug>.json`** (HALT nếu đụng `scope`/`invariants`/dep). Token domain chuẩn ở `docs/autopilot-invariant-catalog.md`; backlog ở `docs/autopilot-backlog.md`; bản canonical template ở `docs/autopilot-templates/`. Song song khi scope+invariant rời nhau, tuần tự khi đụng (vd cùng `schema`/`identity`/`money-model`).

---

## 1. Project là gì

**Plexco** là platform **2 phía, đa môn** cho thể thao phong trào:
- **Host**: tạo & quản kèo, **mark-paid thủ công (tiền mặt/CK)** + **đối soát CK tự động** (SePay/ApiPay, tier `host_pro`) — ngay trong Zalo/Messenger **và** web.
- **Player**: khám phá kèo cross-CLB/môn (**marketplace**), join, theo dõi nợ — xuyên CLB.
- **PostgreSQL + domain model = canonical store** — web và các kênh chat (Zalo/Messenger) đều là surface, sync 2 chiều.

**Stack:** TypeScript, Next.js App Router + SSE (web), HTTP adapter kênh (Zalo/Messenger), Drizzle ORM, PostgreSQL (RLS). Chạy modular monolith trong container, không Vercel (DD-10). *(Telegram/grammY đã loại khỏi target — DD-37; auth route Telegram-era vẫn còn trên HEAD tới khi provider swap land.)*
**Monorepo:** pnpm workspaces — `packages/core` + `apps/bot` + `apps/web`.
**Bối cảnh:** lift logic thuần từ bot single-club (Bestminton) đã chạy production sang `packages/core`; viết lại data layer trên Postgres + RLS.
**Song ngữ vi/en:** mọi chuỗi user-facing qua `t(vi, en)`; user đổi bằng cấu hình ngôn ngữ.

## 2. Kiến trúc & repo map

**3 vùng dữ liệu (= 3 tầng hiển thị):**
1. **GLOBAL identity** (ngoài RLS, không chứa tiền): `persons`, `channel_identities`, `channel_reachability`, `sports`.
2. **TENANT-scoped** (RLS fail-closed): `sessions`, `players`, `memberships`, `charges`, `bank_transactions`, `payment_allocations`, billing… — tiền/roster/nội bộ.
3. **PUBLIC read model** (cross-tenant, KHÔNG RLS, field whitelist): `public_sessions` — marketplace. **Không** chứa tiền/PII.

**Packages:**
- `packages/core` — logic thuần (matching, payments-logic, dates, format, i18n, sports). Test trong isolation.
- `apps/bot` — Zalo (HTTP DM, bot-token per-club, number-reply), Messenger (HTTP DM, Page per-club, cửa sổ 24h — App Review). Tenant middleware. *(Telegram đã loại — DD-37.)*
- `apps/web` — Next.js App Router/API routes + SSE realtime + web UI (dashboard host, player view, discovery).

**Flow đối soát CK (đường tiền — hiểu kỹ trước khi sửa):**
```
SePay webhook → /webhook/sepay/:token → verify (timing-safe) → lưu raw trước ack
  → matching: pay_code tier → name matcher → classifyAmount
  → FIFO settle → notifyPlayersPaid (fan-out mọi kênh + sync web)
```

**Canonical store pattern:**
```
Mọi surface (chat/web/webhook) → Command → Services → tenantRepo (choke-point, RLS)
  → ghi + Outbox event (cùng tx)
  → Projectors fan-out: DM Zalo · message Messenger (trong cửa sổ 24h) · SSE web · upsert public_sessions
```

## 3. ⛔ 5 HARD RULES (vi phạm = rò rỉ thật)

1. **RLS FAIL-CLOSED.** Mọi query đi qua `tenantRepo(tenantId)` — choke-point bắt buộc. `SET LOCAL app.tenant_id`. Role `app` = `NOBYPASSRLS`. **Không** query trực tiếp bảng tenant-scoped từ controller.

2. **TIỀN/PII KHÔNG RA PUBLIC.** `public_sessions` chỉ chứa field-whitelist (môn, giờ, khu vực, giá, slot, host_display_name, club_display_name). **Tuyệt đối không** lưu roster, nợ, SĐT, email vào bảng public. Test bất biến CI bắt buộc.

3. **KHÔNG multi-master.** PostgreSQL + domain model = canonical store. Surfaces (Zalo/Messenger/web) chỉ gửi command, **không** tự sở hữu bản ghi song song. Mutation đi qua service/tenantRepo; đồng bộ qua outbox → projectors.

4. **CLAIM-CÓ-TIỀN CẦN KHOÁ MẠNH.** Merge identity phải OTP/SĐT-verified. Không cho người lạ claim membership đang có nợ bằng tên/alias. (AUDIT C2/C5)

5. **i18n BẮT BUỘC:** mọi chuỗi user-facing = `t(vi, en)`. Không hardcode 1 thứ tiếng.

## 4. Conventions

### Commit
- Format: `type(scope): mô tả ngắn gọn`
- Types: `feat` | `fix` | `docs` | `style` | `refactor` | `test` | `chore`
- Scope: module/feature (vd: `tenant`, `payment`, `identity`, `discovery`, `web`)
- Body bắt buộc cho `feat`/`fix`: what changed + why
- Tracking: `Ref: LINEAR-XXX` hoặc `Tracking: NO-LINEAR`

### Code
- TypeScript strict, `tsc --noEmit` phải sạch
- API error luôn JSON: `{ error: true, message: "...", code: "ERROR_CODE" }`
- Validate input cả FE và BE; sanitize trước DB
- CORS: KHÔNG dùng `*` ngoài development
- Mọi constructor NestJS (nếu dùng tsx): phải có `@Inject()` decorator

### Test
- `DATABASE_URL_TEST=postgres://plexco:plexco_dev@localhost:5432/plexco pnpm test` (harness **bắt buộc `DATABASE_URL_TEST`**, `packages/db/src/test-harness.ts`; local chạy `docker compose -f infra/docker-compose.yml up -d postgres` trước. KHÔNG dùng `DB_PATH`/SQLite.)
- Test bất biến: cô lập tenant A/B + public chỉ field whitelist
- Seed data: tiếng Việt, mọi trạng thái, idempotent, 8-10 records/entity

### CSS & Design
- Mọi color/spacing/typography khai báo CSS variables trong `:root`
- KHÔNG hardcode hex/rgba — luôn dùng `var(--token)`
- Xem `docs/standards/design-tokens.md`

## 5. Workflow

1. **Branch:** feature branch từ `main`, KHÔNG sửa thẳng main
2. **Scope nhỏ:** ~300 LOC / ≤3 module per branch
3. **PR:** theo `.github/PULL_REQUEST_TEMPLATE.md`, checklist pass
4. **Review:** code review trước merge
5. **Merge:** squash 1 commit/feature vào `main`

## 6. Trạng thái hiện tại (2026-07-10)

**Planning & Docs — phần lớn hoàn tất** (v3.4 pivot → decisions v1.31); **còn OQ mở + DD-04 chưa chốt** (danh sách ở `docs/founder-decision-brief-2026-07-15.md`). **Foundation + Auth Onboarding v3 (Telegram-era) đã land trên `main@1eb6f60`.**

- ✅ **Foundation merged:** monorepo (`packages/core` + `packages/db` + `apps/bot` + `apps/web`) + core logic thuần (test xanh) + Postgres/RLS choke-point (`tenantRepo`/`withTenant`) + **migrations `0000–0013`** committed (roles/RLS/grants/functions/seeds/auth_functions/onboarding_steps) + bộ RLS invariant test chạy trên role runtime thật.
- ✅ **Auth Onboarding v3 (Telegram-era) merged** (`5b1193b`) + web tests. **DD-37 supersede provider** → thay bản Telegram-era bằng **Google/email** đã **spec'd nhưng CHƯA implement**.
- ⬜ **Feature layer chưa build:** session/reconcile/sync/marketplace/billing/bot handlers/UI (bảng DB đã dựng sẵn; tầng command/service/projector/UI còn trắng).

Tài liệu hoàn tất (bản mới nhất):
- ✅ BRD v3.5 · PRD v2.4 · TDD v2.4 · ROADMAP v2.7 (canonical P-numbers)
- ✅ 4 phụ lục (saas-plan, reconciliation, AUDIT, messenger)
- Feature docs: **21 Product / 20 BE = 20 cặp hoàn chỉnh + 1 product-only Draft** (`channel_booking_funnel`); trong đó **3 cặp phase-1 mới (Messenger/chat/settings) còn untracked** — xem `features/README.md`
- ✅ Business rules, design tokens, dependency graph
- ✅ README, CHANGELOG, PULL_REQUEST_TEMPLATE, HANDOFF, templates

**Việc tiếp theo:** trước hết author/review slice thay provider auth Telegram-era → **Google/email** (DD-13/DD-37, đã spec nhưng chưa có launcher-ready slice), rồi implement; sau đó bắt đầu feature layer (session → reconcile → sync). Xem `docs/standards/BUILD-STATUS.md` + `docs/product/ROADMAP.md` → Next Actions.

**Reference:** Bot single-club (Bestminton) đang chạy production — logic tiền đã kiểm chứng, đã lift sang `packages/core`, migrate thành tenant #1.

## 7. Doc map & nơi tra cứu

| Folder | Nội dung |
|---|---|
| `docs/00-start-here/` | HANDOFF (file này), identity-model — đọc trước tiên |
| `docs/product/` | BRD, PRD, TDD, ROADMAP, CRM_DASHBOARD_BRD — tài liệu cốt lõi |
| `docs/standards/` | decisions, business-rules, design-tokens, feature-dependency-graph, deployment-infra |
| `docs/features/` · `docs/features/BE/` | Feature specs FE (Product) · BE (Tech) |
| `docs/channels/` | telegram **(archived — DD-37)**, zalo, messenger (phase-1), web (+ messenger-channel-design) |
| `docs/research/` | bestminton analysis/scan, player-side-saas AUDIT & reconciliation |
| `docs/strategy/` | gtm-strategy, gtm-doi-soat-decision, saas-implementation-plan, PnL model |
| `docs/automation/` | onboarding, playbook, automation-overview, product-backlog (autopilot-kit vẫn ở `docs/autopilot-*`) |
| `docs/templates/` | Templates tái sử dụng (feature-spec, be-tech-spec, design-tokens-template, feature-dev/) |

**Source of truth khi conflict (theo topic):**

1. **Live implementation/data model:** `packages/db/schema.ts` + migrations + code/tests trên `main`.
2. **Quyết định đã chốt:** `docs/standards/decisions.md` (proposal/open không tự thành contract).
3. **Scope/behavior/implementation target:** BRD → PRD → TDD; ROADMAP + BUILD-STATUS chỉ mô tả thứ tự/progress.
4. **Security/money:** áp dụng rule nghiêm ngặt hơn giữa AUDIT, business rules và specs; không nới fail-closed chỉ vì doc thấp hơn chưa cập nhật.

Research/reconciliation/strategy là input định hướng, không được override live schema hoặc DD đã chốt.

## 8. Bẫy cần tránh (từ kinh nghiệm bot cũ)

- **Đi fuzzy multi-name cho combo payment → sai tiền.** Dùng pay_code cho deterministic matching.
- **Query không qua `tenantRepo` → data rò rỉ cross-tenant.** Luôn dùng choke-point.
- **Copy logic qua 2 transport → DRIFT.** Rút logic ra core chung, transport = adapter mỏng.
- **Public projection không filter → lộ tiền/PII.** Field whitelist là bắt buộc.
- **Quên test bất biến → regression.** Test cô lập + public PHẢI xanh trong CI.
- **Merge identity thiếu verify → chiếm nợ người khác.** Claim-có-tiền cần OTP.
- **Thiết kế schema/model từ nguyên tắc chung mà chưa đọc canonical → đề xuất sai + tạo bảng song song.** TRƯỚC khi đụng schema/data model/kiến trúc: đọc `packages/db/schema.ts` + `migrations/*.sql` (AUTHORITATIVE) → feature spec → `standards/decisions.md`. KHÔNG chế tên/bảng trùng khái niệm đã có (`persons`/`accounts`/`channel_identities`/`memberships`). Quyết định chưa chốt → proposal ở `decisions.md`, không viết vào spec đã Reviewed. (bài học session identity 2026-07-02)

---

## Identity — nơi tra cứu (tránh chế lại model)

- **Source of truth:** `packages/db/schema.ts` + `packages/db/migrations/0001_global_directory.sql`;
  contract ở `docs/features/feature_identity.md` + `BE/feature_identity_tech.md`; nguyên tắc §P6
  ở `docs/standards/core-db-architecture-principles.md`.
- **Model:** `Person` (người thật global, anchor) · `Account`/`account_identities`/`web_sessions`
  (web-auth) · `channel_identities`/`channel_reachability` (bot) · `memberships` (person↔tenant).
  `link_codes` (hash-only) nối bot↔person, KHÔNG cần SĐT. Phone = merge signal (DD-01).
- **Orientation (KHÔNG phải chân lý):** `docs/00-start-here/identity-model.md`. Auth/link phase-1:
  `decisions.md` DD-13 (Google/email ✅), DD-33 (Facebook Login/Messenger link 🟡, phase-1), DD-14/DD-15
  (Zalo Login/OA ⬜ & bot `from.id` cross-bot). Person link **Google + Facebook + Zalo** (không còn Telegram).

---

## Changelog

| Ngày | Version | Thay đổi |
|------|---------|----------|
| 13/07/2026 | v1.4 | Chốt source-of-truth theo topic; canonical store = PostgreSQL/domain model; web stack = Next.js App Router (DD-10); decisions v1.19; next auth step chưa launcher-ready. |
| 10/07/2026 | v1.3 | **Review fixes → build-status reality + canonical vocab.** §6 trạng thái: foundation + Auth v3 (Telegram-era) đã land trên `main@1eb6f60`, migrations `0000–0013` committed, web tests có; DD-37 supersede provider → Google/email spec'd nhưng chưa implement (bỏ "code chưa bắt đầu"). §2 vùng TENANT: `payments`/`webhook_transactions` → `charges`/`bank_transactions`/`payment_allocations` (canonical ledger). **DD-38/39 ✅ committed phase-1** (top callout — schema chờ migration). decisions v1.16. |
| 10/07/2026 | v1.2 | **v3.4 Phase-1 pivot (DD-37 ✅):** bỏ Telegram; kênh phase-1 = web + Zalo + Facebook Messenger. Cập nhật §1/§2 (stack, apps/bot, projector fan-out), §3 HR3 (surface list), §7 doc map. Auth phase-1 = Google + email (DD-13 ✅) + link Facebook (DD-33 🟡) + Zalo (DD-14 ⬜). Thêm 4 feature phase-1: Google login · chat in-app (DD-38 🟡) · settings/giá theo giới tính (DD-39 🟡) · mark-paid thủ công (DD-40 ✅). |
| 02/07/2026 | v1.1 | Thêm bẫy "đọc canonical trước khi thiết kế schema" + mục Identity tra cứu (Person/Account/link_codes, DD-13/14/15); CLAUDE.md nay trỏ HANDOFF làm first-read |
| 19/06/2026 | — | Thêm Changelog table |
| 18/06/2026 | v1.0 | Handoff checklist per feature |
