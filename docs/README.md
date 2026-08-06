# 📚 Plexco — Documentation Index

Bản đồ điều hướng cho toàn bộ docs. Bắt đầu từ đây.

> **Plexco** — platform thể thao đa môn (host + player), multi-tenant, marketplace discovery, sync đa surface: **Web/PWA · In-app Chat · Zalo · Facebook Messenger** *(Telegram đã bỏ khỏi phạm vi — DD-37; Messenger nay là phase-1, P2.5)*.
>
> **Ranh giới cập nhật 28/07/2026 (`main@784bc8d`):** current decision mirror v2.11 phản ánh owner-final authority pack đã chốt DD-32 Option D và DD-86/DD-91–95; DD-88 chỉ còn broader `DEFERRED_PROPOSAL`. Channel Booking Funnel, In-app Chat Product/BE v0.15/v0.23, Notifications Product/BE v3.11 và Club Assistant Product/BE v0.18 có **Reviewed target contract**; chưa có runtime. DD-32 cho browse session tự do; final paid booking mới chọn qualified Account link để pay later hoặc verified pay-now trong hold 15 phút. Chat primary plan **v1.8** đã đạt `PLAN_READY` tại authority `90d292d` (closure 12/12), với bounded mechanisms `1–47`, thin API `A1–A21` và tracked-design FE `F0–F15`; trạng thái này chỉ cho phép tách/author từng slice, **không** authorize code hay worktree. Mỗi slice vẫn phải đạt strict `CODE_READY`. `/api/chat/*`, `/api/me/charges`, `remainingAmount`, `getSelfPaymentStatus`, booking intent/hold/finalizer và Assistant service đều chưa tồn tại. Owner-final Chat target có DD-92 own edit/soft-delete/pre-beta search, DD-93 full command registry, DD-94 generic opaque offline signal/digest và DD-95 exact moderation; không có durable Chat-content notification item. Research auto-reconcile theo vùng chỉ là decision input: authority/provider hiện tại mới có `sepay|apipay` cho rail Việt Nam, runtime webhook→settle→notify chưa build; mark-paid thủ công vẫn là đường global an toàn.

## 🚀 Đọc theo vai trò

| Vai trò | Đọc theo thứ tự |
|---|---|
| **Mới vào / tổng quan** | `product/BRD.md` → `product/ROADMAP.md` → `product/TDD.md` |
| **Product / PM** | `product/BRD.md` → `product/PRD.md` → `features/<feature>.md` |
| **Founder / Ops / CRM** | `product/CRM_DASHBOARD_BRD.md` → `strategy/gtm-strategy.md` → `standards/business-rules.md` |
| **Backend** | `product/TDD.md` → `standards/business-rules.md` → `features/BE/<feature>_tech.md` |
| **Frontend / Web** | `channels/web/README.md` → `channels/web/design-brief.md` → `standards/design-tokens.md` (token SoT — v1.57: `channels/web/design-tokens.md` chỉ còn là pointer) |
| **Bot / Channel** | `channels/zalo/` · `channels/messenger/` + feature kênh tương ứng (`channels/telegram/` **archived — DD-37**) |
| **Bất kỳ quyết định nào** | `standards/decisions.md` ⭐ |
| **Dev chạy autopilot** | `autopilot-ONBOARDING.md` ⭐ → `autopilot-backlog.md` → `autopilot-templates/` |

## 🗂️ Cấu trúc thư mục

### `00-start-here/` — đọc trước tiên

| File | Vai trò |
|---|---|
| `HANDOFF.md` ⭐ | Bàn giao / onboarding dev — project là gì, kiến trúc, 5 HARD RULES, workflow |
| `identity-model.md` | Orientation mô hình định danh (Person/Account/ChannelIdentity/Membership) |

### `product/` — tài liệu nền (1 nguồn cho mỗi mối quan tâm)

| File | Vai trò |
|---|---|
| `BRD.md` | Yêu cầu **nghiệp vụ** — vấn đề, personas, scope, monetization, glossary |
| `PRD.md` | **User flows** chi tiết (15 flows) + edge cases, surface & command map |
| `TDD.md` | **Thiết kế kỹ thuật** — kiến trúc, data model, RLS, sync engine, security, testing |
| `ROADMAP.md` | **Lộ trình** P0–P6, dependency map, critical path, North Star |
| `CRM_DASHBOARD_BRD.md` | BRD cho **dashboard nội bộ** quản lý growth, CRM, marketplace liquidity, payment/billing, trust và ops |

### `features/` — spec theo từng feature

- `features/<feature>.md` — Product/UX spec (dùng `templates/feature-spec-template.md`)
- `features/BE/<feature>_tech.md` — Backend tech spec (dùng `templates/be-tech-spec-template.md`)
- `features/README.md` — **danh mục feature** (working tree: **24 Product/System specs + 24 BE tech specs = 24 cặp**; committed `main@784bc8d` vẫn 24/23; coverage không chứng minh runtime)

### `standards/` — quy chuẩn dùng chung xuyên feature

| File | Nội dung |
|---|---|
| `decisions.md` ⭐ | **Decision log (ADR-lite)** — mọi quyết định thiết kế/kỹ thuật |
| `business-rules.md` | Quy tắc nghiệp vụ chuẩn hoá (tiền, identity, tenant) |
| `feature-dependency-graph.md` | Đồ thị phụ thuộc giữa các feature (nguồn duy nhất) |
| `deployment-infra.md` · `environments-setup.md` | Hạ tầng, deploy, env |
| `core-db-architecture-principles.md` | Nguyên tắc DB/RLS |
| `design-tokens.md` | Token thiết kế dùng chung (canonical) |
| `BUILD-STATUS.md` | Trạng thái build |

### `decisions/` — phân tích & brief dẫn tới quyết định

Đây là **input** của quyết định; bản thân quyết định (authority) luôn nằm ở `standards/decisions.md`.

| Thư mục | Nội dung |
|---|---|
| `decisions/analysis/` | 26 phân tích `dd-*` — mỗi file mổ một DD (waitlist, join policy, hosting, tournament…), ground vào `schema.ts` + migration + feature spec, kết luận ghi ngược về `standards/decisions.md` |
| `decisions/briefs/` | 8 `founder-decision-brief-*` theo ngày — gom item cần founder duyệt một lượt. **Toàn bộ là historical input**; mỗi brief tự khai đã CLOSED/superseded, current `decisions.md` thắng khi lệch |

### `probes/` — design probe & open-items còn sống

Probe là **khảo sát kỹ thuật**, không phải Reviewed contract — trích được nhưng không cấp phép build.

| File | Vai trò |
|---|---|
| `b0-auth-credential-lifecycle-design-probe.md` | Nền của DD-80: token lifecycle, password floor 15–128 + Argon2id, blocklist, slice order D0/D1 |
| `g3-revoke-all-concurrency-probe-seed.md` | Seed đo concurrency cho revoke-all (`session_epoch`/`minted_epoch`) |
| `probe-strict-cookie-completion-hop.md` | Hành vi Safari/iOS với strict cookie ở completion hop |
| `pre-code-open-items-2026-07-16.md` | Open items phải đóng trước khi code |

### `auth/` — packet & ledger của lane auth

`auth-d0-implementation-packet.md` (**tự khai SUPERSEDED**) · `auth-d1-implementation-packet.md` ·
`auth-s4-session-handoff.md` · `auth-s4-d0a-review-ledger/` (HALT log + regions).

### `archive/` — đã đóng, giữ làm lịch sử

Doc không còn doc live nào trỏ tới như authority: `review-fix-closure-2026-07-16.md` ·
`project-progress-review-2026-07-25.md` · `session-docs-feature-updates-2026-07-17.md` ·
`session-service-reslice-analysis.md` · `runbook-unblock-2026-07-29.md` ·
`email-hoi-provider-2026-07-23.md` · `ap22-egress-run/` · `phase1-autopilot-run/`.

> Transcript trong `archive/*/`.txt cố ý **giữ nguyên path cũ** — đó là bản ghi verbatim của phiên
> agent trước; rewrite vào đó là làm sai bản ghi lịch sử.

### `autopilot/` — task contract theo slice

`autopilot/contracts/` giữ 23 task contract Level 3 (`autopilot-<slug>.md`). Chúng **không cấp phép** gì —
authority thi hành là `autopilot-manifests/<slug>.json`, và không file nào ở đây mang `REVIEW_VERDICT:`.

### `channels/` — docs theo surface

`channels/zalo/` · `channels/messenger/` · `channels/web/` (`channels/telegram/` **archived — DD-37, giữ làm lịch sử**). Mỗi surface có `README.md`; `channels/web/` thêm `design-brief.md`, `design-tokens.md`, `screens/`; `channels/messenger/` có `messenger-channel-design.md` (kênh **phase-1 P2.5**). Booking dùng một shared DD-32 decision core; Messenger/Zalo chỉ là thin adapters. Product + BE player/funnel specs đều đã có, nhưng adapter/App Review/account-link/hold/finalizer/product-channel E2E vẫn pending.

### `research/` — phân tích & audit

`bestminton-to-plexco-analysis.md` · `bestminton-latest-scan-2026-06-21.md` · `player-side-saas-AUDIT.md` (threat model) · `player-side-saas-reconciliation.md` (identity/matching) · `auto-debt-reconciliation-regional-availability-2026-07-27.md` (**research/decision input**, không phải provider/runtime authorization).

### `strategy/` — GTM & business

`gtm-strategy.md` · `gtm-doi-soat-decision.md` · `base-chat-package-feasibility.md` · `saas-implementation-plan.md` (kiến trúc multi-tenant) · `saas-pnl-model.xlsx`.

### `proposals/` — đề xuất chờ chốt

Proposal 🟡 trước khi promote vào spec/decision (vd `plexco-global-kb-and-kb-autosync.md`, `repo-structure-reorg-*.md`). `in-app-chat-primary-player-surface-plan-2026-07-27.md` v1.7 là source duy nhất cho current Chat readiness/verdict tại §13; DD-86/DD-91–95 đã owner-final, các companion đã Reviewed và DD-88 chỉ là broader `DEFERRED_PROPOSAL`. Index này không đánh giá hoặc cấp quyền cho runtime slice.

### `automation/` — docs hệ tracking/automation

`onboarding.md` (điểm vào) · `playbook.md` (phương pháp thi công) · `automation-overview.md` (3 chế độ) · `product-backlog.md` (checklist DoD M1–M6).

### `autopilot-*` ở root — autopilot-kit (path ổn định, scripts phụ thuộc)

**Người mới chạy autopilot: bắt đầu ở `autopilot-ONBOARDING.md`.** Kèm theo: `autopilot-backlog.md`
(slice registry) · `autopilot-invariant-catalog.md` · `autopilot-parallel-scope-gate.md` ·
`autopilot-manifests/` · `autopilot-templates/` · `../.autopilot/maturity-ledger.md` (sổ tín nhiệm auto-merge).

> ⚠️ **Năm file này cố ý nằm ở root `docs/`, không gom vào `autopilot/`** — `scripts/autopilot-*`
> trỏ thẳng vào path đó, mà `scripts/` được sync từ canonical kit (KIT_VERSION 31). Sửa path trong
> script để chiều thư mục sẽ tạo drift với canonical, nên path của chúng là **ràng buộc**, không phải
> lựa chọn thẩm mỹ. Task contract theo slice thì đã chuyển sang `autopilot/contracts/`.

### `templates/` — doc/spec templates

`feature-spec-template.md` · `be-tech-spec-template.md` · `design-tokens-template.md` · `feature-dev/` (`feature-checklist.md`, `feature-dependency-graph-TEMPLATE.md`).

## 🔒 4 bất biến (không vi phạm ở mọi feature)

1. Cô lập cross-tenant — RLS trên bảng canonical; đường public/`discovery` dùng **least-privilege grant** chỉ trên projection (`public_sessions`), không chạm bảng canonical (xem `standards/decisions.md` DD-12)
2. Không lộ tiền/PII ra public
3. Ledger không mất / không đếm quá tiền
4. PostgreSQL + domain model là **nguồn sự thật duy nhất**

> **Live DB marker (đo lại 06/08/2026 tại `main@2cd52ce`):** migration tail là **`0029`** — 30 file, không phải `0024`. Sau `0024_public_visibility_capacity_check.sql` còn: `0025`/`0026` rename CHECK (RENAME-only, zero predicate change), `0027` `resolve_tenant_status_locked` (SECURITY DEFINER read-only), `0028`/`0029` DD-29 capability registry (expand→contract). CHECK `sessions_public_capacity_chk` vẫn cấm `visibility='public' AND slots_max IS NULL` và vẫn cho private session capacity unlimited. Mốc migration là runtime/schema evidence riêng, **không** chứng minh Session/Marketplace UI/service đã build — FE vẫn 0 màn.

## ✍️ Quy ước khi sửa docs

- Quyết định mới → ghi vào `standards/decisions.md`, **không** để rải ở BRD/TDD.
- Feature mới → copy từ `templates/`, đặt vào `features/` + `features/BE/`.
- Mỗi doc giữ bảng **Changelog** ở cuối.

---

*Index v2.0 — 06/08/2026 (**docs reorg**: 70 file rời `docs/` root vào `decisions/analysis/` (26) · `decisions/briefs/` (8) · `autopilot/contracts/` (23) · `probes/` (4) · `auth/` (3+ledger) · `archive/` (6). Root từ **76 → 6 file**, đúng 6 file `scripts/` phụ thuộc nên path là ràng buộc. 350 reference + 22 manifest JSON rewrite; 0 broken link, tổng 233 `.md` không đổi. Đo lại migration tail `0024`→`0029` tại `2cd52ce`). · v1.9 — 28/07/2026 (sync immutable plan authority, current decision mirror and companion versions: Assistant v0.18/v0.18, Chat v0.15/v0.23, Notifications v3.11/v3.11; per-slice `CODE_READY`, runtime 0). · v1.8 — 28/07/2026 (historical companion snapshot Assistant v0.17/v0.17, Chat v0.14/v0.22, Notifications v3.10/v3.10). · v1.7 — 28/07/2026 (owner-final Chat DD-86/DD-91–95, DD-88 broader deferred). · v1.6 — 28/07/2026 (sync DD-32 Option D + Funnel BE companion; working-tree inventory 24/24, Funnel `NOT_CODE_READY`, no runtime). · v1.5 — **SUPERSEDED by v1.7 for Chat authority**. · v1.4 — 27/07/2026 (sync DD-91 status boundary, regional auto-reconcile research boundary, inventory 24/23 và live migration tail `0024`; không claim runtime). · v1.3 — 16/07/2026 (DD-04: production target = DO App Platform + Managed PG HA/VPC; canonical runbook = `standards/environments-setup.md` v2.0; cost model = `dd-04-hosting-final-decision.md` Rev 2). · v1.2 — 10/07/2026.*
