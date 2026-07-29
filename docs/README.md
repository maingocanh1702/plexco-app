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

### `autopilot-*` — autopilot-kit (path ổn định, scripts phụ thuộc)

**Người mới chạy autopilot: bắt đầu ở `autopilot-ONBOARDING.md`.** Kèm theo: `autopilot-backlog.md`
(slice registry) · `autopilot-invariant-catalog.md` · `autopilot-parallel-scope-gate.md` ·
`autopilot-manifests/` · `autopilot-templates/` · `../.autopilot/maturity-ledger.md` (sổ tín nhiệm auto-merge).

### `templates/` — doc/spec templates

`feature-spec-template.md` · `be-tech-spec-template.md` · `design-tokens-template.md` · `feature-dev/` (`feature-checklist.md`, `feature-dependency-graph-TEMPLATE.md`).

## 🔒 4 bất biến (không vi phạm ở mọi feature)

1. Cô lập cross-tenant — RLS trên bảng canonical; đường public/`discovery` dùng **least-privilege grant** chỉ trên projection (`public_sessions`), không chạm bảng canonical (xem `standards/decisions.md` DD-12)
2. Không lộ tiền/PII ra public
3. Ledger không mất / không đếm quá tiền
4. PostgreSQL + domain model là **nguồn sự thật duy nhất**

> **Live DB marker:** migration tail trên `main` hiện là `0024_public_visibility_capacity_check.sql`; CHECK `sessions_public_capacity_chk` đã land, cấm `visibility='public' AND slots_max IS NULL` nhưng vẫn cho phép private session có capacity unlimited. Mốc migration là runtime/schema evidence riêng, không chứng minh Session/Marketplace UI/service đã build.

## ✍️ Quy ước khi sửa docs

- Quyết định mới → ghi vào `standards/decisions.md`, **không** để rải ở BRD/TDD.
- Feature mới → copy từ `templates/`, đặt vào `features/` + `features/BE/`.
- Mỗi doc giữ bảng **Changelog** ở cuối.

---

*Index v1.9 — 28/07/2026 (sync immutable plan authority, current decision mirror and companion versions: Assistant v0.18/v0.18, Chat v0.15/v0.23, Notifications v3.11/v3.11; per-slice `CODE_READY`, runtime 0). · v1.8 — 28/07/2026 (historical companion snapshot Assistant v0.17/v0.17, Chat v0.14/v0.22, Notifications v3.10/v3.10). · v1.7 — 28/07/2026 (owner-final Chat DD-86/DD-91–95, DD-88 broader deferred). · v1.6 — 28/07/2026 (sync DD-32 Option D + Funnel BE companion; working-tree inventory 24/24, Funnel `NOT_CODE_READY`, no runtime). · v1.5 — **SUPERSEDED by v1.7 for Chat authority**. · v1.4 — 27/07/2026 (sync DD-91 status boundary, regional auto-reconcile research boundary, inventory 24/23 và live migration tail `0024`; không claim runtime). · v1.3 — 16/07/2026 (DD-04: production target = DO App Platform + Managed PG HA/VPC; canonical runbook = `standards/environments-setup.md` v2.0; cost model = `dd-04-hosting-final-decision.md` Rev 2). · v1.2 — 10/07/2026.*
