# Expert Prompt Library — Plexco

> **Nguồn gốc:** Ported từ Sporta Expert folder, adapted cho Plexco context.
> **Mục đích:** Mỗi phase phát triển sản phẩm có 1 expert prompt tương ứng. Dùng khi cần agent đóng vai chuyên gia cụ thể.

## Product Development Pipeline

| # | Prompt | Vai trò | Phase | Sử dụng khi |
|---|--------|---------|-------|-------------|
| r00 | [competitive-research](r00-competitive-research.md) | Senior Product Analyst | Research | Phân tích đối thủ, table-stake vs differentiator |
| r01 | [brd-generation](r01-brd-generation.md) | Product Manager | Research | Tạo BRD từ research |
| r02 | [tdd-generation](r02-tdd-generation.md) | Tech Lead | Design | Technical Design Document |
| r03 | [UIUX-design](r03-UIUX-design-generation.md) | Senior UX Designer | Design | Mobile-first UX document |
| r04 | [plan-generation](r04-plan-generation.md) | Project Manager | Planning | Sprint/implementation plan |
| r05 | [implement-generation](r05-implement-generation.md) | Senior Developer | Build | Code implementation |
| r06 | [QA-generation](r06-QA-generation.md) | QA Engineer | Test | Test plan generation |

## Review & Audit Pipeline

| # | Prompt | Vai trò | Sử dụng khi |
|---|--------|---------|-------------|
| r07.1 | [uxui-expert-review](r07.1-uxui-expert-review.md) | UX Consultant (20yr) | UX audit, heuristic evaluation |
| r07.2 | [mobile-ux-audit](r07.2-mobile-ux-audit.md) | Mobile UX Specialist | Thumb-zone, gesture, performance |
| r08 | [saas-dashboard-audit](r08-saas-dashboard-ux-audit.md) | Dashboard UX Expert | Admin portal UX review |
| r09 | [engineering-code-review](r09-engineering-code-review.md) | EM/CTO (20yr) | Architecture, tech debt, security |
| r09.1 | [security-review-v2](r09.1-engineering-code-review-add-more-security-v2.md) | Security Engineer | Extended security audit |
| r10 | [product-strategy](r10-product-strategy-roadmap.md) | Growth PM | KPI-driven roadmap |
| r11 | [qa-full-coverage](r11-qa-tester-full-coverage.md) | Senior QA (15yr) | E2E business-flow test coverage |
| r12 | [uxui-comparative](r12-uxui-comparative-evaluation.md) | UX Evaluator | A/B UX comparison |

## Plexco Context Notes

Khi sử dụng Expert prompts cho Plexco, lưu ý context:

| Sporta | Plexco |
|--------|--------|
| Prisma ORM | **Drizzle ORM** |
| Flutter (mobile) | **NestJS + Web (multi-channel)** |
| Single-tenant | **Multi-tenant (RLS)** |
| Tailwind CSS | **Vanilla CSS + design tokens** |
| SQLite/PostgreSQL (single) | **PostgreSQL + RLS + tenantRepo** |
| Direct DB access | **Shared service contracts** |

## Cách dùng

1. Chọn prompt phù hợp với phase hiện tại
2. Copy nội dung prompt vào system message hoặc conversation
3. Cung cấp context Plexco (docs, code, BRD)
4. Agent sẽ output theo format trong prompt

---

> **Version:** 1.0 · Ported 2026-08-09
> **Source:** `/Users/maingocanh/Projects/Sporta/Expert/`
