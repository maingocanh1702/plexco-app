# HANDOFF — Plexco

> **Đọc file này ĐẦU TIÊN khi tiếp quản project.** Self-contained: không cần context phiên trước.
> Cập nhật: 2026-06-18. Khi thay đổi convention/kiến trúc lớn → cập nhật file này.

---

## 0. TL;DR cho dev/AI mới (làm theo thứ tự)
1. Đọc hết file này.
2. `git log --oneline -15` + `git status` để biết hiện trạng.
3. Đọc `README.md` (tính năng + setup + doc map).
4. **TRƯỚC mọi việc đụng code/git: nắm 5 HARD RULES ở §3 — vi phạm = rò rỉ tiền/PII thật.**
5. Việc mới: theo workflow ở §5 (không tự ý sửa thẳng main).
6. **Autopilot song song:** luật chung tự nạp qua `~/.claude/CLAUDE.md` (autopilot-invariants). Chạy nhiều session/feature song song qua **git worktree riêng + `scripts/autopilot-scope-gate register --manifest docs/autopilot-manifests/<slug>.json`** (HALT nếu đụng `scope`/`invariants`/dep). Token domain chuẩn ở `docs/autopilot-invariant-catalog.md`; backlog + cặp-song-song ở `docs/autopilot-backlog.md`; cơ chế ở `docs/autopilot-parallel-scope-gate.md`. Song song khi scope+invariant rời nhau, tuần tự khi đụng (vd cùng `schema`/`identity`/`money-model`).

---

## 1. Project là gì

**Plexco** là platform **2 phía, đa môn** cho thể thao phong trào:
- **Host**: tạo & quản kèo, thu & **đối soát CK tự động** (SePay/ApiPay) — ngay trong nhóm chat (TG/Zalo/Messenger) **và** web.
- **Player**: khám phá kèo cross-CLB/môn (**marketplace**), join, theo dõi nợ — xuyên CLB.
- **Web app = canonical store** — mọi kênh chat là surface, sync 2 chiều.

**Stack:** TypeScript, grammY (TG), Express + SSE (web), Drizzle ORM, PostgreSQL (RLS). Chạy modular monolith.
**Monorepo:** pnpm workspaces — `packages/core` + `apps/bot` + `apps/web`.
**Bối cảnh:** lift logic thuần từ bot single-club (Bestminton) đã chạy production sang `packages/core`; viết lại data layer trên Postgres + RLS.
**Song ngữ vi/en:** mọi chuỗi user-facing qua `t(vi, en)`; user đổi bằng cấu hình ngôn ngữ.

## 2. Kiến trúc & repo map

**3 vùng dữ liệu (= 3 tầng hiển thị):**
1. **GLOBAL identity** (ngoài RLS, không chứa tiền): `persons`, `channel_identities`, `channel_reachability`, `sports`.
2. **TENANT-scoped** (RLS fail-closed): `sessions`, `players`, `memberships`, `payments`, `webhook_transactions`, billing… — tiền/roster/nội bộ.
3. **PUBLIC read model** (cross-tenant, KHÔNG RLS, field whitelist): `public_sessions` — marketplace. **Không** chứa tiền/PII.

**Packages:**
- `packages/core` — logic thuần (matching, payments-logic, dates, format, i18n, sports). Test trong isolation.
- `apps/bot` — Telegram (grammY: InlineKeyboard + callback), Zalo (HTTP DM), Messenger (post-MVP). Tenant middleware.
- `apps/web` — Express API + SSE realtime + web UI (dashboard host, player view, discovery).

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
  → Projectors fan-out: edit msg TG · DM Zalo · SSE web · upsert public_sessions
```

## 3. ⛔ 5 HARD RULES (vi phạm = rò rỉ thật)

1. **RLS FAIL-CLOSED.** Mọi query đi qua `tenantRepo(tenantId)` — choke-point bắt buộc. `SET LOCAL app.tenant_id`. Role `app` = `NOBYPASSRLS`. **Không** query trực tiếp bảng tenant-scoped từ controller.

2. **TIỀN/PII KHÔNG RA PUBLIC.** `public_sessions` chỉ chứa field-whitelist (môn, giờ, khu vực, giá, slot, host_display_name, club_display_name). **Tuyệt đối không** lưu roster, nợ, SĐT, email vào bảng public. Test bất biến CI bắt buộc.

3. **KHÔNG multi-master.** Web app = canonical store. Surfaces (TG/Zalo/Messenger) chỉ gửi command, **không** ghi trực tiếp vào DB. Đồng bộ qua outbox → projectors.

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
- `DB_PATH=/tmp/test.db pnpm test`
- Test bất biến: cô lập tenant A/B + public chỉ field whitelist
- Seed data: tiếng Việt, mọi trạng thái, idempotent, 8-10 records/entity

### CSS & Design
- Mọi color/spacing/typography khai báo CSS variables trong `:root`
- KHÔNG hardcode hex/rgba — luôn dùng `var(--token)`
- Xem `docs/standards/design-tokens.md`

## 5. Workflow

1. **Branch:** feature branch từ `main`, KHÔNG sửa thẳng main
2. **Scope nhỏ:** ~300 LOC / ≤3 module per branch
3. **PR:** theo `PR_TEMPLATE.md`, checklist pass
4. **Review:** code review trước merge
5. **Merge:** squash 1 commit/feature vào `main`

## 6. Trạng thái hiện tại (2026-06-18)

**Planning & Docs DONE** (reposition v2.0). **Code chưa bắt đầu.**

Tài liệu hoàn tất:
- ✅ BRD v3.1 (platform đa môn 2 phía)
- ✅ PRD v2.1 (14 user flows)
- ✅ TDD v2.1 (25 tables, RLS, sync engine, ledger)
- ✅ Roadmap v2.1 (7 phases, canonical P-numbers)
- ✅ 4 phụ lục (saas-plan, reconciliation, AUDIT, messenger)
- ✅ Feature docs 15/15 all phases (3 reviewed, 12 drafted) — FE + BE pairs
- ✅ Business rules, design tokens, dependency graph
- ✅ README, CHANGELOG, PR_TEMPLATE, HANDOFF, templates

**Việc tiếp theo:** Phase 0 — Foundation (monorepo + lift `core` + Postgres/RLS + test bất biến). Xem `docs/core/ROADMAP.md` → Next Actions.

**Reference:** Bot single-club (Bestminton) đang chạy production — logic tiền đã kiểm chứng, sẽ lift sang `packages/core` và migrate thành tenant #1.

## 7. Doc map & nơi tra cứu

| Folder | Nội dung |
|---|---|
| `docs/core/` | BRD, PRD, TDD, ROADMAP — 4 tài liệu cốt lõi |
| `docs/standards/` | HANDOFF, business-rules, design-tokens, dependency-graph |
| `docs/appendices/` | saas-plan, reconciliation, AUDIT, messenger-channel, PnL model |
| `docs/features/` | Feature specs FE (Product) |
| `docs/features/BE/` | Feature specs BE (Tech) |
| `templates/` | Templates tái sử dụng (design-tokens, checklist, dependency-graph) |

**Source of truth khi conflict:** `AUDIT → reconciliation → saas-implementation-plan → BRD → PRD → TDD`

## 8. Bẫy cần tránh (từ kinh nghiệm bot cũ)

- **Đi fuzzy multi-name cho combo payment → sai tiền.** Dùng pay_code cho deterministic matching.
- **Query không qua `tenantRepo` → data rò rỉ cross-tenant.** Luôn dùng choke-point.
- **Copy logic qua 2 transport → DRIFT.** Rút logic ra core chung, transport = adapter mỏng.
- **Public projection không filter → lộ tiền/PII.** Field whitelist là bắt buộc.
- **Quên test bất biến → regression.** Test cô lập + public PHẢI xanh trong CI.
- **Merge identity thiếu verify → chiếm nợ người khác.** Claim-có-tiền cần OTP.

---

## Changelog

| Ngày | Version | Thay đổi |
|------|---------|----------|
| 19/06/2026 | — | Thêm Changelog table |
| 18/06/2026 | v1.0 | Handoff checklist per feature |
