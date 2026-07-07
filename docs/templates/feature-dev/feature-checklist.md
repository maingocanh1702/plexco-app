# Feature: {FEATURE_NAME} — Development Checklist

> Copy file này mỗi khi bắt đầu dev feature mới, điền tên feature và tick dần.
> Áp dụng cho mọi feature Plexco — điều chỉnh từng section phù hợp.

**Project:** Plexco
**Feature:** {FEATURE_NAME}
**Sprint:** {SPRINT_NUMBER}
**Start date:** {DATE}
**Owner:** {NAME}

---

## Phase 1: Spec (trước khi code)

- [ ] Product spec (`feature_{name}.md`) hoàn chỉnh — 7 sections:
  - [ ] §1 Mô tả feature + use cases (≥8, cover happy/alternative/mutation/cleanup)
  - [ ] §2 Edge Cases (≥10 FE, 4+ categories)
  - [ ] §3 Screens + states (loading / ready / empty / error)
  - [ ] §4 Domain model (entities, relationships) — shared ground truth
  - [ ] §5 Analytics events (`{feature}_{action}_{result}`)
  - [ ] §6 Acceptance criteria
  - [ ] §7 Open Questions / Changelog
- [ ] Tech spec (`feature_{name}_tech.md`) hoàn chỉnh — 6 sections:
  - [ ] §1 Implementation Overview
  - [ ] §2 Database schema (DDL, indexes, constraints, BE edge cases ≥12)
  - [ ] §3 API Contract (endpoints, idempotency, rate limit, form field specs)
  - [ ] §4 Implementation Details (state machine, scenarios by status, timeout, caching)
  - [ ] §5 Testing Plan (≥20 unit tests, ≥4 integration tests)
  - [ ] §6 Rollout Plan
- [ ] **API Contract Review** — FE + BE agree format

---

## Phase 2: Backend

### 2.1 Database
- [ ] Schema / migration viết xong (Drizzle)
- [ ] Migration chạy thành công (`pnpm db:push`)
- [ ] RLS policies cho bảng mới (tenant-scoped)
- [ ] Seed data: tiếng Việt, idempotent, 8-10 records
- [ ] Rollback strategy documented

### 2.2 Implementation
- [ ] Repository layer (qua `tenantRepo` choke-point)
- [ ] Service layer (business logic)
- [ ] Controller / route handler
- [ ] DTOs + input validation
- [ ] Auth / authz (tenant-resolve middleware)
- [ ] Outbox events (sync engine integration)

### 2.3 Quality
- [ ] Error responses luôn JSON: `{ error, message, code }`
- [ ] Idempotency cho payment / critical operations
- [ ] Rate limiting cho sensitive endpoints
- [ ] Unit tests pass (≥20 per feature)
- [ ] Integration tests pass (≥4 per feature)
- [ ] Test bất biến: cô lập tenant + public whitelist

### 2.4 Deploy
- [ ] API deploy staging
- [ ] Staging URL documented cho FE

---

## Phase 3: Frontend (Web)

### 3.1 Design → Code
- [ ] Design tokens áp dụng (từ `docs/design-tokens.md`)
- [ ] Component structure tạo xong

### 3.2 UI Quality
- [ ] 4 states trên mọi view: **loading / ready / empty / error**
- [ ] Skeleton loading (không generic spinner)
- [ ] Error state: icon + message + "Thử lại"
- [ ] Empty state: icon + message + CTA
- [ ] Touch targets ≥ 44px
- [ ] KHÔNG hardcode style — dùng CSS variables
- [ ] Responsive: 375px, 768px, 1440px

### 3.3 Integration
- [ ] API kết nối thành công
- [ ] SSE realtime hoạt động (sync engine)
- [ ] Error handling match API error codes
- [ ] i18n: mọi chuỗi có vi + en

---

## Phase 4: QA

### Functional
- [ ] Happy path flow
- [ ] Edge cases (input rỗng, text dài, Unicode, ký tự đặc biệt)
- [ ] Error/loading/empty states hiển thị đúng

### Security & Isolation
- [ ] RLS test: tenant A không thấy data tenant B
- [ ] Public test: field whitelist, không lộ tiền/PII
- [ ] CORS chỉ whitelist domain

### Regression
- [ ] Features cũ vẫn hoạt động
- [ ] Console clean

---

## Phase 5: PR & Merge

- [ ] Code review
- [ ] PR theo `PR_TEMPLATE.md`
- [ ] CI pass (lint + test + typecheck + build)
- [ ] Merge → staging test
- [ ] CHANGELOG.md cập nhật
- [ ] Done ✅

---

## Notes

> Ghi chú, blockers, decisions trong quá trình dev:

| Date | Note |
|------|------|
| | |
