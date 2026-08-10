# Plexco — Tổng hợp Templates, Docs & Workflow mới

> **Tạo:** 2026-08-10
> **Nguồn gốc:** Ported từ Sporta + tạo mới cho Plexco
> **Sessions:** 2026-08-09 (batch 1) + 2026-08-10 (batch 2)
> **Tổng:** 31 files mới + 1 file modified

---

## Mục lục

1. [Expert Prompt Library (16 files)](#1-expert-prompt-library)
2. [Design Workflow & Playbooks (7 files)](#2-design-workflow--playbooks)
3. [CSS Recipes (1 file)](#3-css-recipes)
4. [Real Examples (1 file)](#4-real-examples)
5. [Templates (8 files)](#5-templates)
6. [Summary Table](#6-summary-table)

---

## 1. Expert Prompt Library

> **Folder:** [`docs/expert/`](docs/expert/)
> **Mục đích:** Mỗi phase phát triển sản phẩm có 1 expert prompt. Dùng khi cần agent đóng vai chuyên gia cụ thể.
> **Index:** [`docs/expert/README.md`](docs/expert/README.md)

### Product Development Pipeline

| # | File | Vai trò | Phase | Dùng khi |
|---|------|---------|-------|----------|
| r00 | [`r00-competitive-research.md`](docs/expert/r00-competitive-research.md) | Senior Product Analyst | Research | Phân tích đối thủ, table-stake vs differentiator |
| r01 | [`r01-brd-generation.md`](docs/expert/r01-brd-generation.md) | Product Manager | Research | Tạo BRD từ research |
| r02 | [`r02-tdd-generation.md`](docs/expert/r02-tdd-generation.md) | Tech Lead | Design | Technical Design Document |
| r03 | [`r03-UIUX-design-generation.md`](docs/expert/r03-UIUX-design-generation.md) | Senior UX Designer | Design | Mobile-first UX document |
| r04 | [`r04-plan-generation.md`](docs/expert/r04-plan-generation.md) | Project Manager | Planning | Sprint/implementation plan |
| r05 | [`r05-implement-generation.md`](docs/expert/r05-implement-generation.md) | Senior Developer | Build | Code implementation |
| r06 | [`r06-QA-generation.md`](docs/expert/r06-QA-generation.md) | QA Engineer | Test | Test plan generation |

### Review & Audit Pipeline

| # | File | Vai trò | Dùng khi |
|---|------|---------|----------|
| r07.1 | [`r07.1-uxui-expert-review.md`](docs/expert/r07.1-uxui-expert-review.md) | UX Consultant (20yr) | UX audit, heuristic evaluation |
| r07.2 | [`r07.2-mobile-ux-audit.md`](docs/expert/r07.2-mobile-ux-audit.md) | Mobile UX Specialist | Thumb-zone, gesture, performance |
| r08 | [`r08-saas-dashboard-ux-audit.md`](docs/expert/r08-saas-dashboard-ux-audit.md) | Dashboard UX Expert | Admin portal UX review |
| r09 | [`r09-engineering-code-review.md`](docs/expert/r09-engineering-code-review.md) | EM/CTO (20yr) | Architecture, tech debt, security |
| r09.1 | [`r09.1-engineering-code-review-add-more-security-v2.md`](docs/expert/r09.1-engineering-code-review-add-more-security-v2.md) | Security Engineer | Extended security audit |
| r10 | [`r10-product-strategy-roadmap.md`](docs/expert/r10-product-strategy-roadmap.md) | Growth PM | KPI-driven roadmap |
| r11 | [`r11-qa-tester-full-coverage.md`](docs/expert/r11-qa-tester-full-coverage.md) | Senior QA (15yr) | E2E business-flow test coverage |
| r12 | [`r12-uxui-comparative-evaluation.md`](docs/expert/r12-uxui-comparative-evaluation.md) | UX Evaluator | A/B UX comparison |

---

## 2. Design Workflow & Playbooks

> **Folder:** [`docs/workflow/`](docs/workflow/)
> **Mục đích:** End-to-end design pipeline từ BRD → .pen → tokens → code → verify.

| # | File | Nội dung | Lines |
|---|------|---------|-------|
| 1 | [`brd-to-pen-playbook.md`](docs/workflow/brd-to-pen-playbook.md) | **Master playbook** — 10 bước BRD → design tokens → .pen file. Bao gồm token mining (6 lăng kính), benchmark, taste pass, conflict resolution | 734 |
| 2 | [`design-system-playbook.md`](docs/workflow/design-system-playbook.md) | 9-step design system pipeline: Context Lock → Token Architecture → Taste Pass → Component Library → Handoff | 140 |
| 3 | [`design-token-playbook.md`](docs/workflow/design-token-playbook.md) | **Standalone token playbook** — 6 lăng kính BRD mining, 3-layer token architecture (primitive → semantic → component), governance, anti-patterns | 124 |
| 4 | [`design-to-code-pipeline.md`](docs/workflow/design-to-code-pipeline.md) | **5-step FE pipeline** — .pen → handoff → token-mapping → code → verify. MCP commands, 5 often-missed items, 3-source accuracy rule, golden rules, anti-patterns | 209 |
| 5 | [`design-to-code-lessons.md`](docs/workflow/design-to-code-lessons.md) | Retro/lessons learned từ 4 lần iterate Home Screen (Sporta). Accuracy data, common mistakes, fixes | 150 |
| 6 | [`feature-docs-playbook-sporta.md`](docs/workflow/feature-docs-playbook-sporta.md) | Sporta's feature documentation methodology (reference) | 125 |

### Quan hệ giữa các playbooks

```
brd-to-pen-playbook.md (master — 10 bước đầy đủ)
    ├── §Bước 6: design-token-playbook.md (standalone — chỉ tokens)
    ├── §Bước 7-8: design-system-playbook.md (component library)
    └── §Bước 9-10: design-to-code-pipeline.md (FE implementation)
                         └── design-to-code-lessons.md (retro data)
```

---

## 3. CSS Recipes

> **Folder:** [`docs/workflow/recipes/`](docs/workflow/recipes/)
> **Mục đích:** Copy-paste CSS patterns với tokens, fallback, performance limits.

| # | File | Nội dung | Lines |
|---|------|---------|-------|
| 1 | [`glassmorphism-recipe.md`](docs/workflow/recipes/glassmorphism-recipe.md) | **Glass effect recipe** — tokens (light+dark), mesh gradient background, 6 component patterns (header, card, hero, nav, input, stat), glass hierarchy (4 levels), performance (≤5 glass elements), `@supports` fallback, `prefers-reduced-motion`, `prefers-contrast: high` | 270 |

---

## 4. Real Examples

> **Folder:** [`docs/workflow/examples/`](docs/workflow/examples/)
> **Mục đích:** Completed examples (không phải template) — tham khảo khi tạo mới.

| # | File | Nội dung | Lines |
|---|------|---------|-------|
| 1 | [`handoff-example.md`](docs/workflow/examples/handoff-example.md) | **Real handoff** — Sporta Home Screen. Part A: pixel-perfect measurements (frame, tokens, typography, layout blocks). Part B: CSS variable mapping (adapted from Tailwind). Icons table (5 attributes) | 209 |

---

## 5. Templates

> **Folder:** [`docs/templates/`](docs/templates/)
> **Mục đích:** Copy → rename → điền placeholders khi bắt đầu file mới.

### Feature Development Templates

| # | File | Nội dung | Lines |
|---|------|---------|-------|
| 1 | [`feature-dev/feature-checklist.md`](docs/templates/feature-dev/feature-checklist.md) | **v1.2** — Development checklist with source tracing, .pen 4-state verification, pixel-perfect verify (3 breakpoints), cross-cutting QA (dark mode, deep links) | 151 |
| 2 | [`feature-dev/fe-handoff-template.md`](docs/templates/feature-dev/fe-handoff-template.md) | Pixel-perfect handoff template: frame, tokens, typography, layout blocks, QA checklist, DD-58 compliant | — |
| 3 | [`feature-dev/fe-token-mapping-template.md`](docs/templates/feature-dev/fe-token-mapping-template.md) | Token mapping template: .pen → CSS variable, icon 5-attribute, variant states, DD-58/DD-59 compliant | — |
| 4 | [`feature-dev/fe-spec-template.md`](docs/templates/feature-dev/fe-spec-template.md) | FE design spec template: user flows, screens & states, review-readiness gated | — |

### Project-Level Templates

| # | File | Nội dung | Lines |
|---|------|---------|-------|
| 5 | [`ref-insights-template.md`](docs/templates/ref-insights-template.md) | Cross-project reference insights — 6 sections: Context, Data Points, Interaction Patterns, Pros/Cons, Applicability, Action Items | 129 |
| 6 | [`retro-template.md`](docs/templates/retro-template.md) | Retro/lessons learned — 7 sections: Summary, Keep, Improve, Bugs, Spec vs Reality, Tech Debt, Action Items | 83 |
| 7 | [`product-workflow-template.md`](docs/templates/product-workflow-template.md) | 10-stage product development (Idea → Operate): role matrix, output per stage, stage-gate checklist | 637 |
| 8 | [`prd-template.md`](docs/templates/prd-template.md) | PRD for non-tech stakeholders: feature tracking by version, success metrics, user journey | 187 |
| 9 | [`changelog-template.md`](docs/templates/changelog-template.md) | AI-friendly CHANGELOG: .pen coverage table, API status, known issues, file structure | 76 |
| 10 | [`readme-template.md`](docs/templates/readme-template.md) | Project README: setup guide, port registry, tech stack, doc table | 76 |

### Existing Templates (không thay đổi — đã có trước)

| File | Nội dung |
|------|---------|
| [`be-tech-spec-template.md`](docs/templates/be-tech-spec-template.md) | BE tech spec (6 sections) |
| [`feature-spec-template.md`](docs/templates/feature-spec-template.md) | Product/UX spec (7 sections) |
| [`design-tokens-template.md`](docs/templates/design-tokens-template.md) | Design tokens SSOT template |
| [`design-system-playbook.md`](docs/templates/design-system-playbook.md) | Design system playbook (copy in templates/) |
| [`brd-to-pen-playbook.md`](docs/templates/brd-to-pen-playbook.md) | BRD→.pen playbook (copy in templates/) |
| [`feature-docs-playbook.md`](docs/templates/feature-docs-playbook.md) | Feature docs playbook |
| [`review-doc-plan-session-template.md`](docs/templates/review-doc-plan-session-template.md) | Review session template |
| [`feature-dev/feature-dependency-graph-TEMPLATE.md`](docs/templates/feature-dev/feature-dependency-graph-TEMPLATE.md) | Mermaid dependency graph |

---

## 6. Summary Table

| Category | Files mới | Files updated | Total lines | Nguồn |
|----------|-----------|---------------|-------------|-------|
| Expert Prompts | 16 (15 prompts + 1 README) | — | ~1,200 | Sporta `Expert/` |
| Workflow Playbooks | 6 | 1 (pipeline v1.1) | ~1,482 | Sporta `docs/design/` + `front-end/` |
| CSS Recipes | 1 | — | 270 | Sporta `docs/design/sporta-glassmorphism.md` |
| Real Examples | 1 | — | 209 | Sporta `docs/handoff/` |
| Templates | 6 | 1 (checklist v1.2) | ~1,188 | Sporta `templates/` |
| **Total** | **30** | **2** | **~4,349** | |

### Adaptations Applied (Sporta → Plexco)

| Sporta | Plexco |
|--------|--------|
| Tailwind CSS | `var(--token)` CSS variables |
| Flutter (mobile) 430px | Web: 375/768/1440px breakpoints |
| SwiftUI + Kotlin code | Removed — CSS-only |
| Prisma ORM | Drizzle ORM |
| Single-tenant | Multi-tenant (RLS + tenantRepo) |
| Hardcoded brand colors | `rgba(var(--primary-rgb), opacity)` |

### Plexco Context (khi dùng Expert prompts)

| Sporta | Plexco |
|--------|--------|
| Prisma ORM | **Drizzle ORM** |
| Flutter (mobile) | **NestJS + Web (multi-channel)** |
| Single-tenant | **Multi-tenant (RLS)** |
| Tailwind CSS | **Vanilla CSS + design tokens** |
| SQLite/PostgreSQL (single) | **PostgreSQL + RLS + tenantRepo** |
| Direct DB access | **Shared service contracts** |

---

## Cách sử dụng

### Bắt đầu project mới
1. Copy [`readme-template.md`](docs/templates/readme-template.md) → `README.md`
2. Copy [`changelog-template.md`](docs/templates/changelog-template.md) → `CHANGELOG.md`
3. Copy [`prd-template.md`](docs/templates/prd-template.md) → `docs/{project}-prd.md`
4. Copy [`product-workflow-template.md`](docs/templates/product-workflow-template.md) → `docs/product-workflow.md`

### Bắt đầu feature mới
1. Copy [`feature-spec-template.md`](docs/templates/feature-spec-template.md) → FE spec
2. Copy [`be-tech-spec-template.md`](docs/templates/be-tech-spec-template.md) → BE spec
3. Copy [`feature-dev/feature-checklist.md`](docs/templates/feature-dev/feature-checklist.md) → tracking

### Design → Code flow
1. Đọc [`brd-to-pen-playbook.md`](docs/workflow/brd-to-pen-playbook.md) (master) hoặc [`design-token-playbook.md`](docs/workflow/design-token-playbook.md) (tokens only)
2. Theo [`design-to-code-pipeline.md`](docs/workflow/design-to-code-pipeline.md) (5-step)
3. Dùng [`fe-handoff-template.md`](docs/templates/feature-dev/fe-handoff-template.md) + [`fe-token-mapping-template.md`](docs/templates/feature-dev/fe-token-mapping-template.md)
4. Tham khảo [`handoff-example.md`](docs/workflow/examples/handoff-example.md) (real example)
5. Nếu cần glass effect → [`glassmorphism-recipe.md`](docs/workflow/recipes/glassmorphism-recipe.md)

### Agent đóng vai chuyên gia
1. Xem index [`docs/expert/README.md`](docs/expert/README.md)
2. Chọn prompt phù hợp phase
3. Paste prompt + cung cấp Plexco context

---

> _Tổng hợp v1.0 · 2026-08-10_
