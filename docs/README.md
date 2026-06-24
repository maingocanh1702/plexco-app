# 📚 Plexco — Documentation Index

Bản đồ điều hướng cho toàn bộ docs. Bắt đầu từ đây.

> **Plexco** — platform thể thao đa môn (host + player), multi-tenant, marketplace discovery, sync đa surface: Telegram · Zalo · Web *(Messenger post-MVP P4.8)*.

## 🚀 Đọc theo vai trò

| Vai trò | Đọc theo thứ tự |
|---|---|
| **Mới vào / tổng quan** | `core/BRD.md` → `core/ROADMAP.md` → `core/TDD.md` |
| **Product / PM** | `core/BRD.md` → `core/PRD.md` → `features/<feature>.md` |
| **Founder / Ops / CRM** | `core/CRM_DASHBOARD_BRD.md` → `../Plexco_GTM_Strategy.md` → `standards/business-rules.md` |
| **Backend** | `core/TDD.md` → `standards/business-rules.md` → `features/BE/<feature>_tech.md` |
| **Frontend / Web** | `web-app/README.md` → `web-app/design-brief.md` → `web-app/design-tokens.md` |
| **Bot / Channel** | `bot-telegram/` · `bot-zalo/` · `bot-messenger/` + feature kênh tương ứng |
| **Bất kỳ quyết định nào** | `standards/decisions.md` ⭐ |
| **Dev chạy autopilot** | `autopilot-ONBOARDING.md` ⭐ → `autopilot-backlog.md` → `autopilot-templates/` |

## 🗂️ Cấu trúc thư mục

### `core/` — tài liệu nền (1 nguồn cho mỗi mối quan tâm)

| File | Vai trò |
|---|---|
| `BRD.md` | Yêu cầu **nghiệp vụ** — vấn đề, personas, scope, monetization, glossary |
| `PRD.md` | **User flows** chi tiết (14 flows) + edge cases, surface & command map |
| `TDD.md` | **Thiết kế kỹ thuật** — kiến trúc, data model, RLS, sync engine, security, testing |
| `ROADMAP.md` | **Lộ trình** P0–P6, dependency map, critical path, North Star |
| `CRM_DASHBOARD_BRD.md` | BRD cho **dashboard nội bộ** quản lý growth, CRM, marketplace liquidity, payment/billing, trust và ops |

### `features/` — spec theo từng feature

- `features/<feature>.md` — Product/UX spec (dùng `templates/feature-spec-template.md`)
- `features/BE/<feature>_tech.md` — Backend tech spec (dùng `templates/be-tech-spec-template.md`)
- `features/README.md` — **danh mục feature** (16 feature: identity, multi-tenant, sync engine, marketplace, payment reconcile, billing, các kênh player…)

### `standards/` — quy chuẩn dùng chung xuyên feature

| File | Nội dung |
|---|---|
| `decisions.md` ⭐ | **Decision log (ADR-lite)** — mọi quyết định thiết kế/kỹ thuật |
| `business-rules.md` | Quy tắc nghiệp vụ chuẩn hoá (tiền, identity, tenant) |
| `feature-dependency-graph.md` | Đồ thị phụ thuộc giữa các feature |
| `deployment-infra.md` | Hạ tầng, deploy, env |
| `design-tokens.md` | Token thiết kế dùng chung |
| `HANDOFF.md` | Hướng dẫn bàn giao / onboarding dev |

### `web-app/` · `bot-telegram/` · `bot-zalo/` · `bot-messenger/` — docs theo surface

Mỗi surface có `README.md`; `web-app/` thêm `design-brief.md`, `design-tokens.md`, `screens/`.

### `appendices/` — phân tích & nền tảng quyết định

`saas-implementation-plan.md` (kiến trúc multi-tenant) · `player-side-saas-reconciliation.md` (identity/matching) · `player-side-saas-AUDIT.md` (threat model) · `messenger-channel-design.md` · `native-app-strategy.md` · `bestminton-to-plexco-analysis.md` · `saas-pnl-model.xlsx`.

### `autopilot-*` — governance quy trình dev

**Người mới chạy autopilot: bắt đầu ở `autopilot-ONBOARDING.md`** (setup 1 lần + vòng đời 1 task, pin
template v0.4.8). Các file kèm theo: `autopilot-backlog.md` · `autopilot-invariant-catalog.md` ·
`autopilot-parallel-scope-gate.md` · `autopilot-manifests/` · `autopilot-templates/` (bản canonical 2
template gốc) · `../.autopilot/maturity-ledger.md` (sổ tín nhiệm auto-merge).

### `templates/` (ở root repo, `../templates/`)

`feature-spec-template.md` · `be-tech-spec-template.md` · `feature-checklist.md` · `feature-dependency-graph.md` · `design-tokens.md`.

## 🔒 4 bất biến (không vi phạm ở mọi feature)

1. Cô lập cross-tenant — RLS trên bảng canonical; đường public/`discovery` dùng **least-privilege grant** chỉ trên projection (`public_sessions`), không chạm bảng canonical (xem `standards/decisions.md` DD-12)
2. Không lộ tiền/PII ra public
3. Ledger không mất / không đếm quá tiền
4. PostgreSQL + domain model là **nguồn sự thật duy nhất**

## ✍️ Quy ước khi sửa docs

- Quyết định mới → ghi vào `standards/decisions.md`, **không** để rải ở BRD/TDD.
- Feature mới → copy từ `../templates/`, đặt vào `features/` + `features/BE/`.
- Mỗi doc giữ bảng **Changelog** ở cuối.

---

*Index v1.1 — 21/06/2026.*
