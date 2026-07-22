# HANDOFF — Plexco

> **Đọc file này ĐẦU TIÊN khi tiếp quản project.** Self-contained: không cần context phiên trước.
> Cập nhật: 2026-07-20 (BRD v3.9e · PRD v2.8d · TDD v3.1 · ROADMAP v3.3d · **decisions v1.88**; HEAD `main@172dfff`). **DD-80 ✅ auth G3 revoke-all + D0a/D0b decomposition**; slice code auth đầu tiên (D0a) đang in-flight — xem `../auth-s4-session-handoff.md`. DD-70..72 🟡; DD-73/74/75/78 dependency/consumer-sequenced, DD-76/77 evidence-gated.
>
> **⚡ v3.4 Phase-1 pivot (DD-37 ✅, thay DD-09):** Kênh phase-1 = **web + Zalo + Facebook Messenger**;
> **Telegram đã bị loại khỏi phạm vi** (không còn adapter/bot Telegram trong MVP). Auth phase-1 =
> **Google OAuth + email/password** (DD-13 ✅, thay TG Login) + link **Facebook** (DD-33 ✅; external approval evidence là enablement gate, capability OFF + one-time `link_code` fallback tới khi pass)
> + **Zalo** (DD-14 ⬜). Feature phase-1 mới: **Google login**, **chat cơ bản trong app** (DD-38 ✅, scope-committed phase-1),
> **cài đặt hồ sơ + giá theo giới tính** (DD-39 ✅, scope-committed phase-1), **mark-paid thủ công tiền mặt/CK, tap/multi-select** (DD-40 ✅).
> *(DD-38/39 committed — schema `chat_*`/`person.gender` chưa vào canonical `schema.ts`, migration còn chờ.)*
>
> **⚡ Channel endpoint DD-15/DD-65..68:** một Meta App; central Plexco Page luôn có + optional Page per-club. Identity uniqueness = `(platform, provider_scope_lookup_hash, platform_user_lookup_hash)`; Messenger scope Page, Zalo scope bot/OA tới khi DD-15 chứng minh rộng hơn; reachability gắn `channel_identity_id`. Endpoint/default context không tự cấp target tenant; one-route delivery. Live schema/runtime chưa đáp ứng contract.
>
> **📱 DD-69 app-native (✅ direction accepted, owner 18/07):** phase-1 target = PWA qua S9/S20 nhưng live `apps/web` chưa có manifest/service worker; phase-2 native build **chưa schedule** (technical gates mở). RN+Expo là recommendation sau spike. Native push dùng protected device subscription riêng, không phải ChannelIdentity; offline v1 read-only. Xem `../dd-69-app-native-analysis.md`.

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

**Stack:** TypeScript, Next.js App Router + SSE (web), HTTP adapter kênh (Zalo/Messenger), Drizzle ORM, PostgreSQL (RLS). Chạy modular monolith trong container, không Vercel (DD-10). *(Telegram/grammY đã loại khỏi target — DD-37; auth route Telegram-era vẫn còn trong code baseline tới khi provider swap land.)*
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
- `apps/bot` target — Zalo DM + Messenger hybrid central/tenant Page, role-aware host/player, 24h/App Review. **Reality hiện tại:** chỉ queue/provision shell, chưa Messenger adapter/handler/projector.
- `apps/web` — Next.js App Router/API routes + SSE realtime + web UI (dashboard host, player view, discovery).

**Flow đối soát CK (đường tiền — hiểu kỹ trước khi sửa):**
```
SePay webhook → /webhook/sepay/:token → verify timestamp/raw-body HMAC (timing-safe, ±300s) → lưu raw trước ack
  → matching: pay_code tier → name matcher → classifyAmount
  → FIFO settle → notifyPlayersPaid (fan-out mọi kênh + sync web)
```

**Canonical store pattern:**
```
Mọi surface (chat/web/webhook) → Command → Services → tenantRepo (choke-point, RLS)
  → ghi + Outbox event (cùng tx)
  → Projectors: Zalo · Messenger one-route (tenant Page→central) · SSE web · public_sessions
```

## 3. ⛔ 5 HARD RULES (vi phạm = rò rỉ thật)

1. **RLS FAIL-CLOSED.** Mọi query đi qua `tenantRepo(tenantId)` — choke-point bắt buộc. `SET LOCAL app.tenant_id`. Role `app` = `NOBYPASSRLS`. **Không** query trực tiếp bảng tenant-scoped từ controller.

2. **TIỀN/PII KHÔNG RA PUBLIC.** `public_sessions` chỉ chứa field-whitelist (môn, giờ, khu vực, giá, slot, host_display_name, club_display_name). **Tuyệt đối không** lưu roster, nợ, SĐT, email vào bảng public. Test bất biến CI bắt buộc.

3. **KHÔNG multi-master.** PostgreSQL + domain model = canonical store. Surfaces (Zalo/Messenger/web) chỉ gửi command, **không** tự sở hữu bản ghi song song. Mutation đi qua service/tenantRepo; đồng bộ qua outbox → projectors.

4. **CLAIM-CÓ-TIỀN CẦN KHOÁ MẠNH.** Merge/claim identity phải qua **verified factor: email đã verify (web) hoặc `link_code` deterministic dùng-một-lần (bot)** — DD-50, phase-1 không thu SĐT (phone fields dormant). Không cho người lạ claim membership đang có nợ bằng tên/alias. (AUDIT C2/C5)

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
- `DATABASE_URL_TEST=postgres://plexco:plexco_dev@localhost:5432/plexco_test pnpm test` (harness **bắt buộc `DATABASE_URL_TEST`**, `packages/db/src/test-harness.ts`; local chạy `docker compose -f infra/docker-compose.yml up -d postgres` trước. KHÔNG dùng `DB_PATH`/SQLite.)
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

## 6. Trạng thái hiện tại (2026-07-20)

**Planning & Docs — decision coverage cao** (current **decisions v1.88** — DD-80 G3 revoke-all concurrency contract + D0a/D0b decomposition; DD-70..72 🟡; DD-73/74/75/78 dependency/consumer-sequenced, DD-76/77 evidence-gated). **B0 auth đã owner-duyệt → ghi thành DD-80**; auth provider swap đã bước vào code. Implementation phần còn lại vẫn cần migrations/services/adapters/E2E; code-readiness vẫn bị B1/B2/B3 và external/legal gates.

> **⚙️ Đang nóng — Auth S4 (D0→D1):** **D0a (`8f493f7`, migration `0015` epoch revoke-all — owner override) và D0b (`93c5404`, issuance fence + `/api/auth/logout-all` — gate ĐẠT, không override) đều đã MERGE.** Nửa đầu chuỗi provider swap xong. Hot area giờ là **D1 `auth-s4-d1-email-token-core`** (code dark) → `auth-s4-d1-google-adapter`. Chi tiết: **`../auth-s4-session-handoff.md`**.

- ✅ **Foundation merged:** monorepo (`packages/core` + `packages/db` + `apps/bot` + `apps/web`) + core logic thuần (test xanh) + Postgres/RLS choke-point (`tenantRepo`/`withTenant`) + **migrations `0000–0013`** committed (roles/RLS/grants/functions/seeds/auth_functions/onboarding_steps) + bộ RLS invariant test chạy trên role runtime thật.
- 🟡 **Auth Onboarding v3 (Telegram-era) merged** (`5b1193b`) + web tests. **DD-37 supersede provider** → Google/email; **B0 đã owner-duyệt → DD-80 v1.88** (G3 epoch revoke-all). Provider swap re-slice thành D0a/D0b/D1: **D0a in-flight (chưa merge)**, D0b/D1 HOLD theo dependency. Telegram-era routes vẫn còn tới khi provider swap land.
- ⬜ **Feature layer chưa build:** session/reconcile/sync/marketplace/billing/bot handlers/UI (bảng DB đã dựng sẵn; tầng command/service/projector/UI còn trắng).

Tài liệu hoàn tất (bản mới nhất):
- ✅ BRD v3.9e · PRD v2.8d · TDD v3.1 · ROADMAP v3.3d (current authority v1.67; runtime pending)
- ✅ 4 phụ lục (saas-plan, reconciliation, AUDIT, messenger)
- Feature docs: **23 Product/System / 22 BE = 22 cặp + 1 product-only Draft** (`channel_booking_funnel`). Cặp mới nhất: **Home hub (DD-79 ✅ 19/07, S9, composition-only)** + nav shell 5 slot config-driven; design tool chốt **Pencil** (DD-81, `plexco-app-design.pen`). Cặp thứ 21 là Session Organize v0.5 (DD-61..64 ✅ accept-in-principle, build post-P4); coverage không có nghĩa runtime/build-ready — xem `features/README.md`.
- ✅ Business rules, design tokens, dependency graph
- ✅ README, CHANGELOG, PULL_REQUEST_TEMPLATE, HANDOFF, templates

**Việc tiếp theo:** (1) đóng vòng review **D0a** rồi manual merge (P0 không auto-merge; đang có nguy cơ MAX_ROUNDS — xem `../auth-s4-session-handoff.md §4`); (2) **D0b** web boundary → **D1** email-token → **D1** google-adapter (dependency-gated); (3) song song chạy được autoprompt docs-only P2 (AP-23/AP-24). Sau chuỗi auth mới vào feature layer (session → reconcile → sync). Xem `../auth-s4-session-handoff.md`, `docs/standards/BUILD-STATUS.md`, `docs/slice-readiness-verdicts.md`, `docs/product/ROADMAP.md` → Next Actions.

**Reference:** Bot single-club (Bestminton) đang chạy production — logic tiền đã kiểm chứng, đã lift sang `packages/core`, migrate thành tenant #1.

## 7. Doc map & nơi tra cứu

| Folder | Nội dung |
|---|---|
| `docs/00-start-here/` | HANDOFF (file này), identity-model — đọc trước tiên |
| `docs/auth-s4-session-handoff.md` | **Handoff chi tiết mảng Auth S4 (D0→D1)** — bản đang nóng, resume độc lập slice auth |
| `docs/product/` | BRD, PRD, TDD, ROADMAP, CRM_DASHBOARD_BRD — tài liệu cốt lõi |
| `docs/standards/` | decisions, business-rules, design-tokens, feature-dependency-graph, deployment-infra · **DD-57..59 deferred reference** · **DD-60 accepted** · **DD-61..64 accepted-in-principle/no-runtime** |
| `docs/features/` · `docs/features/BE/` | Feature specs FE (Product) · BE (Tech) |
| `docs/channels/` | telegram **(archived — DD-37)**, zalo, messenger (phase-1), web (+ messenger-channel-design; designer-kickoff/pipeline are DD-57..59 deferred references; API convention DD-60 accepted) |
| `docs/dd-73-78-share-activity-analysis.md` + `docs/founder-decision-brief-2026-07-19-share-activity.md` | Cụm **Share & Activity** (DD-73..78 ✅ 19/07): phân tích đầy đủ + bản ghi 6 quyết định |
| `docs/research/` | bestminton analysis/scan, player-side-saas AUDIT & reconciliation |
| `docs/strategy/` | gtm-strategy, gtm-doi-soat-decision, saas-implementation-plan, PnL model |
| `docs/automation/` | onboarding, playbook, automation-overview, product-backlog (autopilot-kit vẫn ở `docs/autopilot-*`) |
| `docs/templates/` | Templates tái sử dụng; FE handoff/token-mapping templates là **DD-58 deferred/optional reference**, không active gate |
| `docs/archive/` | **KHÔNG phải authority** — nội dung cứu khỏi `.autopilot/worktrees/` (không còn là git worktree + bị gitignore ⇒ chưa commit = chưa được bảo vệ). Gồm patch slice P0 identity/link/secret chưa từng commit, và ledger autopilot phase-1 (`DECISIONS.md`/`PROGRESS.md` — không có bản nào khác trong repo). Đọc `docs/archive/README.md` trước khi revive bất cứ thứ gì trong đó |

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
- **Merge identity thiếu strong proof → chiếm nợ người khác.** Claim-có-tiền cần verified account email hoặc transactional one-time `link_code`; tên/alias/owner assertion không thay proof DD-50.
- **Thiết kế schema/model từ nguyên tắc chung mà chưa đọc canonical → đề xuất sai + tạo bảng song song.** TRƯỚC khi đụng schema/data model/kiến trúc: đọc `packages/db/schema.ts` + `migrations/*.sql` (AUTHORITATIVE) → feature spec → `standards/decisions.md`. KHÔNG chế tên/bảng trùng khái niệm đã có (`persons`/`accounts`/`channel_identities`/`memberships`). Quyết định chưa chốt → proposal ở `decisions.md`, không viết vào spec đã Reviewed. (bài học session identity 2026-07-02)

---

## Identity — nơi tra cứu (tránh chế lại model)

- **Source of truth:** `packages/db/schema.ts` + `packages/db/migrations/0001_global_directory.sql`;
  contract ở `docs/features/feature_identity.md` + `BE/feature_identity_tech.md`; nguyên tắc §P6
  ở `docs/standards/core-db-architecture-principles.md`.
- **Model:** `Person` (người thật global, anchor) · `Account`/`account_identities`/`web_sessions`
  (web-auth) · `channel_identities`/`channel_reachability` (bot) · `memberships` (person↔tenant).
  `link_codes` (hash-only) nối bot↔person, KHÔNG cần SĐT. **Phase-1 không thu SĐT (DD-50)** — khoá mạnh = verified email + link_code; phone = merge signal tương lai (DD-01, dormant).
- **Orientation (KHÔNG phải chân lý):** `docs/00-start-here/identity-model.md`. Auth/link phase-1:
  `decisions.md` DD-13 (Google/email ✅), DD-33 (Facebook Login/Messenger link ✅; external enablement gate pending), DD-14/DD-15
  (Zalo Login/OA ⬜ & bot `from.id` cross-bot). Person link **Google + Facebook + Zalo** (không còn Telegram).

---

## Changelog

| Ngày | Version | Thay đổi |
|------|---------|----------|
| 20/07/2026 | v1.20 | **Auth swap bước vào code + current refresh.** Authority → decisions v1.88 (DD-80 G3 revoke-all epoch contract + D0a/D0b decomposition); HEAD `main@172dfff`. B0 owner-duyệt→DD-80; provider swap re-slice D0a/D0b/D1, **D0a `auth-s4-d0-revoke-core` in-flight** (migration `0015`, code feature-layer đầu tiên, chưa merge). Thêm pointer `docs/auth-s4-session-handoff.md`. Runtime baseline (migrations `0000–0013`) không đổi. |
| 19/07/2026 | v1.19 | **DD-79 ✅ Home hub (S9) + DD-81 ✅ Pencil:** cặp spec thứ 22 (Reviewed contract, composition-only trên player_view/marketplace/§A — không bảng mới); nav PWA 5 slot registry (Feed gated DD-76, 💬 chat header); design file mới `plexco-app-design.pen`. Mirror đã propagate BRD v3.9g/PRD v2.8f/TDD v3.1a/ROADMAP v3.3f/design-brief v1.9/BUILD-STATUS. Runtime không đổi. |
| 19/07/2026 | v1.19 | Current authority → decisions v1.65 / BRD v3.9e / PRD v2.8d / ROADMAP v3.3d; DD-73..78 sequencing correction ở v1.64. DD-74/75 tạo baseline; chỉ DD-76/77 evidence-gated; DD-78 đi cùng consumer. Không đổi runtime baseline. |
| 19/07/2026 | v1.18 | Authority → decisions **v1.60**. **DD-73..78 ✅ chốt (owner 19/07)**: 6 câu đều phương án (a); Q5 kèm re-scope đưa fence/guarded-view/grant migration về **DD-12**; **DD-64 amended** (self-aggregate). Sequencing wording của entry này được corrected ở v1.19; runtime baseline không đổi. |
| 19/07/2026 | v1.17 | Current authority → decisions v1.59/PRD v2.8c. DD-05/06/45/49 integrity closure pins approval re-derive, venue active-only, activation-time refunded lifecycle và bounded waitlist retry. Không migration/runtime mới. |
| 19/07/2026 | v1.16 | Authority → decisions v1.52. Consistency pass cụm DD-73..78: điều kiện render `/s/<id>` là **sự tồn tại row `public_sessions`** (không phải predicate `visibility`/`status` — check hai cột đó là buộc đọc `sessions`); tách `gender` người chơi khỏi `gender_restriction`; DD-73 phase **P4.3** theo DD-12; card ≠ profile field (không mở DD-48 item 1); revoke chốt 404. Founder-batch recheck còn surface DD-72 `trusted_at/trust_source` + reset-on-rebind, DD-71 component-wise vector rule và auth collision/rate-limit/KMS precision. Vẫn 🟡/design-gated ⇒ runtime baseline không đổi. |
| 18/07/2026 | v1.15 | Authority → decisions v1.51. Thêm pointer cụm **DD-73..78 🟡 đề xuất** + DD-78 default share image. Review correction cùng snapshot: Auth v2.10/v2.7 tách OAuth cross-site transaction/Lax binding khỏi Strict session/email flow; Notification v3.3 pin exact trusted route, dispatch-time roster và app-level vendor boundary. Chưa chốt/build ⇒ runtime baseline không đổi. |
| 18/07/2026 | v1.14 | Founder batch v1.47 propagation: DD-33 external gate/link-code fallback; DD-57..59 deferred references; DD-60 accepted; Session Organize v0.5 accepted-in-principle/no-runtime; DD-69 accepted direction. |
| 18/07/2026 | v1.13 | Authority → BRD v3.9c/PRD v2.8a/TDD v3.1/ROADMAP v3.3a/decisions v1.46; mirror DD-69 proposal boundaries: PWA planned-not-live, native phase-2 TBD, RN+Expo after spike, device push separate, offline read-only. Runtime baseline không đổi. |
| 17/07/2026 | v1.12 | Feature-doc closure → BRD v3.9b/PRD v2.8/TDD v3.1/ROADMAP v3.3; exact endpoint identity, SePay HMAC, DM safety/block source, Assistant DLP và Session Organize v0.4 được mirror; không claim code/migration. |
| 17/07/2026 | v1.11 | Authority → TDD v3.0/decisions v1.45. Generalize endpoint-scoped identity/reachability cho Messenger + Zalo; live schema/runtime gap và tenant-eligibility boundary được ghi rõ. |
| 17/07/2026 | v1.10 | Review-fix closure: authority → BRD v3.9a; DD-67 Page-scoped identity/reachability + one-route delivery đã propagate vào multi-tenant/identity/notification Product+BE contracts; runtime/migration vẫn pending. |
| 17/07/2026 | v1.9 | ROADMAP v3.2 propagation: hybrid Messenger milestone + delivery order; authority vẫn decisions v1.44. |
| 17/07/2026 | v1.8 | Authority → BRD 3.9/PRD 2.7/TDD 2.9/ROADMAP 3.2/decisions 1.44. Session Organize pair → v0.3 nhưng DD-61..64 vẫn proposal, phase TBD và chưa migration/service. |
| 17/07/2026 | v1.7 | Authority → BRD 3.8/PRD 2.6/TDD 2.8/ROADMAP 3.1/decisions 1.43. DD-65..68 Messenger hybrid contract + explicit live runtime/schema gap; host/player shared surface and one-route delivery. |
| 17/07/2026 | v1.6 | Authority → TDD v2.7 / ROADMAP v3.0 / decisions v1.42. Coverage → 22 Product/System + 21 BE; Session Organize v0.2 là cặp proposal, phase TBD/earliest after P4, chưa migration/service và không thay code readiness. |
| 16/07/2026 | v1.5 | Reconcile current authority decisions v1.39; DD-49..56 full contract propagation; DD-40 synthetic-transaction conflict removed; HR4/auth/chat/authz wording fail-closed; canonical local test DB = `plexco_test`; readiness names B0/B1/B2/B3 + correction/external/legal gates. |
| 13/07/2026 | v1.4 | Chốt source-of-truth theo topic; canonical store = PostgreSQL/domain model; web stack = Next.js App Router (DD-10); decisions v1.19; next auth step chưa launcher-ready. |
| 10/07/2026 | v1.3 | **Review fixes → build-status reality + canonical vocab.** §6 trạng thái: foundation + Auth v3 (Telegram-era) đã land trên `main@1eb6f60`, migrations `0000–0013` committed, web tests có; DD-37 supersede provider → Google/email spec'd nhưng chưa implement (bỏ "code chưa bắt đầu"). §2 vùng TENANT: `payments`/`webhook_transactions` → `charges`/`bank_transactions`/`payment_allocations` (canonical ledger). **DD-38/39 ✅ scope-committed phase-1** (top callout — schema chờ migration). decisions v1.16. |
| 10/07/2026 | v1.2 | **v3.4 Phase-1 pivot (DD-37 ✅):** bỏ Telegram; kênh phase-1 = web + Zalo + Facebook Messenger. Cập nhật §1/§2 (stack, apps/bot, projector fan-out), §3 HR3 (surface list), §7 doc map. Auth phase-1 = Google + email (DD-13 ✅) + link Facebook (DD-33 🟡) + Zalo (DD-14 ⬜). Thêm 4 feature phase-1: Google login · chat in-app (DD-38 🟡) · settings/giá theo giới tính (DD-39 🟡) · mark-paid thủ công (DD-40 ✅). |
| 02/07/2026 | v1.1 | Thêm bẫy "đọc canonical trước khi thiết kế schema" + mục Identity tra cứu (Person/Account/link_codes, DD-13/14/15); CLAUDE.md nay trỏ HANDOFF làm first-read |
| 19/06/2026 | — | Thêm Changelog table |
| 18/06/2026 | v1.0 | Handoff checklist per feature |
