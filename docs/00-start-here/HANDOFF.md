# HANDOFF — Plexco

> **Đọc file này ĐẦU TIÊN khi tiếp quản project.** Self-contained: không cần context phiên trước.
> Cập nhật: 2026-07-28 (BRD v3.9n · PRD v2.8m · TDD v3.1h · **ROADMAP v3.4l** · decisions v2.11 current mirror; HEAD `main@ed38106` = `origin/main` — authority snapshot vẫn pin ở `784bc8d`, hai commit sau chỉ là autopilot docs/kit v11, không đụng authority · migration · runtime). Migrations `0000`–**`0024`** (25 file): auth `0015`–`0018`, tenant-integrity DD-68 `0019`–`0021`, job-infra `0022`–`0023`, capacity-visibility CHECK `0024`. Google auth lane đã merge; Safari macOS+iOS M3 **đã đo PASS 26/07**, nhưng Google login **chưa được chứng minh đã enable/go-live** — set credential vẫn là owner go-live decision và các gate khác (vd A3 legal/PII) đứng độc lập. DD-87 `splitNameAmount` core đã merge (`d2a27e1`) nhưng vẫn **không có production caller**. Tầng feature nghiệp vụ vẫn **0 Chat/Assistant/notification route, 0 màn FE**. **DD-32 Option D, DD-70/71/72 và DD-86/DD-91–95 đã owner-final; DD-88 chỉ là broader `DEFERRED_PROPOSAL`.** Channel Booking, In-app Chat v0.15/v0.23, Notifications v3.11/v3.11 và Club Assistant v0.18/v0.18 có Reviewed target contract. Exact 27-file Chat authority pack đã land tại `90d292d`; primary plan v1.8 đạt `PLAN_READY` closure 12/12, nhưng B4/worktree chưa author và từng slice `1–47` / `A1–A21` / `F0–F15` vẫn phải đạt strict `CODE_READY`. `PLAN_READY` không chứng minh runtime.
>
> ⚠️ **Hai điều dễ hiểu nhầm khi tiếp quản:** (1) canonical runner PASS trên current HEAD (`3d75c90`, 2026-07-29): **32 files / 561 workspace tests** (core 132 · DB 243 · web 146 · bot 40) + 13 readiness-validator = **574 tổng**; `550`, `460` và `419` chỉ là snapshot lịch sử. DB 219→243 (+24) do `0025` CND tests; số **file** giữ 32 vì test mới vào hai file đã có (`rls-invariants.test.ts`, `migrate.test.ts`) — đó là scope manifest của slice, không phải suy đoán. (2) Job-infra root/ack/dispatcher/preflight/schedule đã **IMPLEMENTED** (`0022`, `0023`, `fca314e`, `a03d2d6`) nhưng delivery vẫn code-dark: schedule mặc định **OFF**, `productionStubDeliver` chỉ DLQ, chưa có producer, real projector hoặc replay path; do đó không được gọi là `ENABLE_READY` hay product runtime.
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
> **⚡ Channel booking DD-32 Option D:** user luôn browse được time/public area/fee/confirmed count/slots trước khi link. Free còn chỗ → active không link; full → waitlist; approval → pending trước. Paid còn chỗ: qualified Plexco Account link → active + charge/pay later; unlinked → durable hold 15 phút và chỉ active sau verified full settlement. Screenshot/nút “đã trả”/host mark-paid không phải proof cho nhánh pay-now. Product + BE companion đã Reviewed, nhưng intent/hold/occupancy/finalizer/adapters chưa tồn tại; readiness nằm ở implementation plan riêng.
>
> **📱 DD-69 app-native (✅ direction accepted, owner 18/07):** phase-1 target = PWA qua S9/S20 nhưng live `apps/web` chưa có manifest/service worker; phase-2 native build **chưa schedule** (technical gates mở). RN+Expo là recommendation sau spike. Native push dùng protected device subscription riêng, không phải ChannelIdentity; offline v1 read-only. Xem `../dd-69-app-native-analysis.md`.

---

## 0. TL;DR cho dev/AI mới (làm theo thứ tự)
1. Đọc hết file này.
2. `git log --oneline -15` + `git status` để biết hiện trạng.
3. Đọc `README.md` (tính năng + setup + doc map).
4. **TRƯỚC mọi việc đụng code/git: nắm 5 HARD RULES ở §3 — vi phạm = rò rỉ tiền/PII thật.**
5. Việc mới: theo workflow ở §5 (không tự ý sửa thẳng main).
6. **Autopilot — bắt đầu ở `docs/autopilot-ONBOARDING.md`** (entry point duy nhất; workflow **Level 3 supervised autonomy**, contract canonical `docs/autopilot-templates/level3-workflow.md`, scope-gate **KIT_VERSION 11**, đã sync từ `Claude template` 2026-07-28). Setup máy nhanh: chạy **`scripts/autopilot-onboard.sh --codex /abs/path/to/codex`** (idempotent: `@import` invariants vào `~/.claude/CLAUDE.md`, pin `AUTOPILOT_CODEX_BIN`, verify kit). Chạy nhiều session/feature song song qua **git worktree riêng (base `main`) + `scripts/autopilot-scope-gate register --manifest docs/autopilot-manifests/<slug>.json`** (HALT nếu đụng `scope`/`invariants`/dep). Token domain chuẩn ở `docs/autopilot-invariant-catalog.md`; backlog ở `docs/autopilot-backlog.md`; bản canonical template ở `docs/autopilot-templates/`. Song song khi scope+invariant rời nhau, tuần tự khi đụng (vd cùng `schema`/`identity`/`money-model`).

---

## 1. Project là gì

**Plexco** là platform **2 phía, đa môn** cho thể thao phong trào:
- **Host**: tạo & quản kèo, **mark-paid thủ công (tiền mặt/CK)** + **đối soát CK tự động** (SePay/ApiPay, tier `host_pro`) — ngay trong Zalo/Messenger **và** web.
- **Player**: khám phá kèo cross-CLB/môn (**marketplace**), join, theo dõi nợ — xuyên CLB.
- **PostgreSQL + domain model = canonical store** — web và các kênh chat (Zalo/Messenger) đều là surface, sync 2 chiều.

**Stack:** TypeScript, Next.js App Router + SSE (web), HTTP adapter kênh (Zalo/Messenger), Drizzle ORM, PostgreSQL (RLS). Chạy modular monolith trong container, không Vercel (DD-10). *(Telegram/grammY đã loại khỏi target — DD-37; auth route Telegram-era vẫn còn trong code baseline tới khi email order-4 + Telegram-removal slice land.)*
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
- `apps/bot` target — Zalo DM + Messenger hybrid central/tenant Page, role-aware host/player, 24h/App Review. **Reality hiện tại:** shared queue provisioning/preflight, outbox dispatcher và recovery schedule đã merge nhưng schedule mặc định OFF, delivery là placeholder fail-closed; chưa có channel adapter/handler, business producer hay real projector.
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

4. **CLAIM-CÓ-TIỀN CẦN KHOÁ MẠNH.** Merge/claim identity phải qua **verified factor: email đã verify (web) hoặc `link_code` deterministic dùng-một-lần (bot)** — DD-50, phase-1 không thu SĐT (phone fields dormant). Không cho người lạ claim membership đang có nợ bằng tên/alias. Với DD-32 pay-later, exact endpoint-scoped ChannelIdentity và verified Plexco Account còn phải cùng resolve tới current canonical Person; PSID/`from.id`, provider name hoặc display name riêng lẻ không đủ. (AUDIT C2/C5)

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

## 5. Workflow — Level 3 supervised autonomy

> Canonical contract: **`../autopilot-templates/level3-workflow.md`**. Entry point vận hành:
> **`../autopilot-ONBOARDING.md`**. Forward-only: chỉ áp cho task mở mới; session đang chạy giữ
> contract cũ tới terminal state.

```text
WORKFLOW_LEVEL: 3   HUMAN_ROLE: manager_of_managers
DEFAULT_STOP_MODE: STOP_AT_READY   AUTO_MERGE: off
```

1. **Task contract trước khi code.** Primary agent resolve outcome · base · context sources · scope/
   negative scope · risk P0–P3 · autonomy mode · slice graph · worktree plan · verification ·
   code/security review · stop conditions (`level3-workflow.md` §3). Thiếu context material →
   `AWAIT_CONTEXT`, không tự bịa.
2. **Slice + worktree:** 1 writing slice = 1 branch + 1 worktree + tối đa 1 writer, base pin từ
   `main` đã verify. Register scope trước khi ghi:
   `scripts/autopilot-scope-gate register --manifest docs/autopilot-manifests/<slug>.json`.
   Root worktree luôn ở `main`, KHÔNG sửa thẳng main. Slice đụng cùng migration/state/generated
   artifact → tuần tự, không song song.
3. **Scope nhỏ:** ~300 LOC / ≤3 module per slice; mỗi slice nêu đúng 1 mechanism + negative scope.
4. **Self-verify:** `pnpm test` (bắt buộc `DATABASE_URL_TEST`) + build/lint/typecheck, e2e khi vượt
   boundary thật, và inspect exact diff so với base đã pin.
5. **Review độc lập bắt buộc:** `scripts/codex-review-pin.sh`; slice chạm auth/secret/permission/tiền/
   external input/deployment chạy thêm 1 security round. Reviewer không gọi được → `HALT
   TOOL_UNAVAILABLE`. PR theo `.github/PULL_REQUEST_TEMPLATE.md`, checklist pass.
6. **Terminal state `READY | AWAIT | HALT`** rồi **người merge tay**: squash 1 commit/feature vào
   `main`. Level 3 KHÔNG có auto-merge; P0 prepare-only; P1 luôn supervised.

Docs/plans/specs/readiness vẫn phải qua gate chặt hơn của repo:
`../standards/review-code-readiness-gate.md` + `pnpm review:check:changed`.

## 6. Trạng thái hiện tại (2026-07-28)

**Planning & Docs — decision coverage cao** (decisions v2.11 current mirror: DD-32 Option D; DD-80 auth; DD-87 `splitNameAmount`; DD-70/71/72/86/91–95 owner-final; DD-88 broader `DEFERRED_PROPOSAL`; DD-73/74/75/78 dependency/consumer-sequenced, DD-76/77 evidence-gated). Channel Booking, In-app Chat v0.15/v0.23, Notifications v3.11/v3.11 và Club Assistant v0.18/v0.18 có Reviewed target contract; runtime còn thiếu. Chat plan v1.8 = `PLAN_READY` tại `90d292d`; từng slice vẫn cần strict `CODE_READY`. Đây không phải coding authorization.

> **⚙️ Auth S4 — lane Google đã xong phần code:** **D0a (`0015`) · D0b · D1 email-token (`0016`) · D1 Google (`0017`) · d1b session-rotation (`0018`)** đều MERGE — tail toàn cục hiện `0024`. Safari macOS + iOS Safari 18.3 đã đo M3 **PASS** ngày 26/07 (`../probe-strict-cookie-completion-hop.md` §7–§8), nên measurement gate đã đóng. Google login vẫn **chưa được chứng minh đã enable/go-live**: credentials trong template giữ rỗng; owner chỉ set sau quyết định go-live và các gate độc lập còn lại. Kế tiếp trong auth vẫn là **order-4 email bundle** (flag OFF, gate C7, kế thừa D1E-18b) → gỡ Telegram. Chi tiết: **`../auth-s4-session-handoff.md`**.

- ✅ **Foundation merged:** monorepo (`packages/core` + `packages/db` + `apps/bot` + `apps/web`) + core logic thuần (test xanh) + Postgres/RLS choke-point (`tenantRepo`/`withTenant`) + **migrations `0000–0013`** committed (roles/RLS/grants/functions/seeds/auth_functions/onboarding_steps) + bộ RLS invariant test chạy trên role runtime thật.
- 🟡 **Auth Onboarding v3 (Telegram-era) merged** (`5b1193b`) + web tests. **DD-37 supersede provider** → Google/email; **B0 đã owner-duyệt → DD-80 v1.88** (G3 epoch revoke-all). Provider swap re-slice thành D0a/D0b/D1: **cả D0a · D0b · D1 · d1b nay ĐỀU ĐÃ MERGE** (bản trước ghi "D0a in-flight" — stale). Telegram-era routes vẫn còn tới khi order-4 email bundle land rồi mới gỡ provider.
- ⬜ **Feature layer chưa build:** session/reconcile/sync/marketplace/billing/bot handlers/UI (bảng DB đã dựng sẵn; tầng command/service/projector/UI còn trắng). Session Management có hợp đồng spec đóng và `0024` đã thêm đúng capacity-visibility CHECK, nhưng vẫn **0 SessionService, 0 route**. Job-infra chung đã land tới dispatcher/schedule, song schedule OFF và chưa có producer/real projector/replay; không được tính là Session/Sync/Notification runtime.

Tài liệu hoàn tất (bản mới nhất):
- ✅ BRD v3.9n · PRD v2.8m · TDD v3.1h · ROADMAP v3.4l · decisions v2.11 current mirror; exact authority pack đã land tại `90d292d`, primary plan `PLAN_READY`, runtime pending
- ✅ 4 phụ lục (saas-plan, reconciliation, AUDIT, messenger)
- Feature docs working tree: **24 Product/System / 24 BE = 24 cặp**; committed `main@784bc8d` vẫn 24/23 vì Funnel BE chưa commit. Channel Booking, In-app Chat v0.15/v0.23, Notifications v3.11/v3.11 và Club Assistant v0.18/v0.18 có Reviewed target contract; implementation chưa bắt đầu. Chat owner-final gồm DD-92 own edit/soft-delete + pre-beta search, DD-93 full registry, DD-94 generic opaque offline signal/digest và DD-95 exact moderation. Home hub v0.7/v0.3 (DD-79 ✅, S9) composition-only; Session Organize v0.5 (DD-61..64 ✅ accept-in-principle) build post-P4; coverage không có nghĩa runtime/build-ready — xem `features/README.md`.
- ✅ Business rules, design tokens, dependency graph
- ✅ README, CHANGELOG, PULL_REQUEST_TEMPLATE, HANDOFF, templates

**Việc tiếp theo:** (1) owner quyết định Google go-live sau các gate độc lập; (2) giữ `OUTBOX_DISPATCH_SCHEDULE_ENABLED=false` tới khi có real projector + producer + replay/recovery; (3) mở vertical Session BE theo dependency hiện hành — `0024` chỉ là DB invariant; (4) với Channel Booking, dùng canonical implementation plan và first prerequisite `identity-account-link-core`, không nhảy thẳng vào Messenger/Zalo adapter; (5) với Chat, làm theo current verdict/next trigger ở primary plan §13 rồi dùng slice-local packet cho bounded first slice. HANDOFF không tự authorize runtime worktree. **FE HOLD:** không mở page/component hay map token cho tới khi canonical `design.pen` được persist/track + owner nghiệm thu làm authority.

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
- **Qualified Account link cho DD-32:** exact endpoint-scoped ChannelIdentity + verified Account identity phải cùng resolve tới current canonical Person và không frozen/conflicted. Messenger PSID khác Facebook Login subject; Zalo OA `from.id` khác Zalo Login subject tới khi provider evidence chứng minh mapping.
- **Orientation (KHÔNG phải chân lý):** `docs/00-start-here/identity-model.md`. Auth/link phase-1:
  `decisions.md` DD-13 (Google/email ✅), DD-33 (Facebook Login/Messenger link ✅; external enablement gate pending), DD-14/DD-15
  (Zalo Login/OA ⬜ & bot `from.id` cross-bot). Person link **Google + Facebook + Zalo** (không còn Telegram).

---

## Changelog

| Ngày | Version | Thay đổi |
|------|---------|----------|
| 29/07/2026 | v1.28 | **§5 Workflow → Level 3 supervised autonomy.** Canonical contract `docs/autopilot-templates/level3-workflow.md`; task contract trước khi code, 1 writing slice = 1 branch/worktree/writer, self-verify bằng lệnh thật, review độc lập bắt buộc qua `scripts/codex-review-pin.sh` + security round cho trust boundary, kết ở `READY \| AWAIT \| HALT` rồi người merge. §Tiếp quản item 6 bỏ pin stale v0.6.0 → kit **KIT_VERSION 11** (`ed38106`, đã trên `origin/main`). Review-readiness gate của repo vẫn thắng ở chỗ nào chặt hơn. Không đổi authority · scope · DD · runtime. |
| 28/07/2026 | v1.27 | **Chat readiness re-pin + current live summary:** exact authority pack land `90d292d`, plan v1.8/analysis = `PLAN_READY` closure 12/12; HEAD `main@784bc8d`. B4/worktree và per-slice strict `CODE_READY` vẫn còn, runtime/migration/API/UI = 0. Sync BRD v3.9n/PRD v2.8m/TDD v3.1h/ROADMAP v3.4l; DD-32 contract giữ nguyên. |
| 28/07/2026 | v1.26 | **Owner-final Chat authority + DD-32:** mirror decisions v2.10 DD-86/DD-91–95, DD-88 broader `DEFERRED_PROPOSAL`, Assistant v0.17/v0.17, Chat v0.14/v0.22, Notifications v3.10/v3.10 và plan v1.7. Current readiness remains owned only by each canonical implementation plan; Chat points to primary plan §13. Keep DD-32 Option D and first prerequisite `identity-account-link-core`. No runtime/migration/API/UI. |
| 28/07/2026 | v1.25 | **SUPERSEDED by v1.26:** former Chat correction used Draft Assistant and the reduced no-edit/search/digest floor; no longer current authority. |
| 27/07/2026 | v1.24 | **Live-truth reconcile tại `main@2dc9b8c`:** tail `0024`/25 migration; canonical suite 32 file/537 workspace +13 validator; job-infra `0022`/`0023` + dispatcher/preflight/schedule implemented nhưng schedule OFF, stub DLQ, chưa producer/real projector/replay; Safari macOS+iOS M3 đã đo PASS nhưng Google chưa được chứng minh enabled/go-live; DD-87 core merged nhưng chưa production caller. Next-step bỏ chuỗi Safari→job-root→dispatcher→scheduler đã hoàn tất, giữ status boundary migration/runtime/enablement/E2E. |
| 25/07/2026 | v1.23 | **Full body reconcile sau review progress:** canonical suite hiện PASS 460 workspace + 13 validator tests; feature inventory 24/23; DD-70/71/72 owner-final và Notification pair Reviewed/no-runtime; stale D0a→D1 next-step bị thay bằng BE-only `db-job-claim-lease-core` packet → dispatcher/scheduler → Session vertical. DD-81 canonical path = root `design.pen`; FE giữ HOLD tới khi file được persist/track + owner nghiệm thu làm authority. |
| 25/07/2026 | v1.22 | **Current-state reconcile tại `main@2937ed9` (= `origin/main`).** Header refresh: authority → BRD v3.9g · PRD v2.8f · TDD v3.1a · ROADMAP **v3.4d** · decisions **v1.98** committed (DD-88 🟡 chưa commit); migrations `0000–0018`→**`0000–0021`** (22 file); ghi nhận **core đã có code DD-87** (`d2a27e1`) và bộ ba tenant-integrity FK `0019`–`0021` (expand-only, code dark). Sửa 2 claim stale: "D0a in-flight" → **cả lane D0a/D0b/D1/d1b đã merge**; decisions v1.88 → v1.98. Thêm 2 cảnh báo tiếp quản: **canonical runner chưa chạy lại từ `f93873b`** (số 419 là snapshot cũ) và **hàng đợi autopilot đang rỗng** (0 `ready`/`planned` sau khi flip 7 slice stale). Session Management: contract publish/draft-lifecycle đã đóng, code vẫn 0 — blocker kế tiếp là job-infra chung. Không đổi scope/DD/delivery order. |
| 24/07/2026 | v1.21 | **Migration-tail reconcile:** §6 auth-lane note `migrations 0000–0018` → **`0000–0020`** (`0019`/`0020` tenant-integrity composite FKs DD-68, 23/07/2026, ngoài auth lane `0015`–`0018`); Foundation `0000–0013` (§Identity/§6) giữ nguyên verbatim (anti-double-classify). Docs-only, không đổi contract. Chi tiết: `docs/autopilot-manifests/docs-migration-tail-0018-to-0020-sweep.json`. |
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
