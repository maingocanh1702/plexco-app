# Feature: Multi-tenant Foundation — Product/System Spec

> **Canonical phase:** P0–P1  
> **Track:** 🏢 Multi-tenant Core + 3-tier  
> **Version:** 1.1 · 2026-06-18  
> **Status:** Reviewed against BRD v3.1 / PRD v2.1 / TDD v2.1  
> **Tài liệu liên quan:** `../product/BRD.md` §6–8 · `../product/TDD.md` §3.2–3.4 · `../strategy/saas-implementation-plan.md` · `../research/player-side-saas-AUDIT.md`

---

## 1. Mục tiêu và phạm vi

Xây nền bắt buộc cho mọi feature: monorepo, PostgreSQL + Drizzle, schema tenant-aware, multi-sport, RLS fail-closed, repository choke-point, protected global identity directory, public read-model skeleton và worker contract.

**Giá trị:** nhiều CLB dùng chung platform nhưng tiền/roster không rò cross-tenant; player chỉ thấy dữ liệu của chính mình; marketplace chỉ đọc projection công khai được whitelist.

### Trong phạm vi P0–P1

- Monorepo `packages/core`, `apps/bot`, `apps/web`.
- `sports`, `tenants`, `sessions`, `players`, settings và schema skeleton cho các module sau.
- `starts_at`, `ends_at`, timezone, sport, area/venue, skill level, visibility, slots và join policy.
- RLS cho mọi bảng tenant-scoped; role runtime `app` là `NOBYPASSRLS`.
- `tenantRepo(tenantId)` + `withTenant()` dùng `SET LOCAL app.tenant_id` trong transaction.
- Public projection skeleton `public_sessions` với whitelist.
- Worker role/functions hẹp cho cron/outbox; business job quay lại tenant context trước khi xử lý.
- Test bất biến tenant, public và privileged worker.

### Ngoài phạm vi

- Telegram tenant routing P2.
- Payment reconciliation/ledger hoàn chỉnh P3.
- Identity merge P3.5.
- Web/onboarding/sync engine P4; marketplace projector P4.3.
- Player channels P4.5–P4.7; Messenger P4.8; billing P5.

---

## 2. Use Cases

| ID | Actor | Hành động | Kết quả |
|---|---|---|---|
| MT-UC-1 | Developer | Scaffold monorepo | Build/typecheck/test chạy thống nhất |
| MT-UC-2 | System | Lift core logic thuần | Không còn dependency SQLite/runtime bot |
| MT-UC-3 | Migration role | Chạy migration | Schema được version hóa và khóa advisory |
| MT-UC-4 | Runtime API | Truy cập tenant data | Bắt buộc qua `tenantRepo` + RLS context |
| MT-UC-5 | Runtime API | Query thiếu tenant context | Trả 0 row/fail-closed |
| MT-UC-6 | Admin script | Tạo tenant | Tenant + default settings được tạo idempotently |
| MT-UC-7 | Public API | Tìm session công khai | Chỉ đọc `public_sessions`, không chạm bảng tiền/roster |
| MT-UC-8 | Person-self service | Đọc clubs/nợ của chính person | Authorize person session; không cho query person khác |
| MT-UC-9 | Worker | Claim job cross-tenant | Chỉ qua narrow function; từng job `SET LOCAL app.tenant_id` |
| MT-UC-10 | CI | Chạy invariant tests | Phát hiện schema/policy làm rò tenant hoặc public fields |

---

## 3. Edge Cases và hành vi

| # | Case | Hành vi bắt buộc |
|---|---|---|
| 1 | Query tenant table không qua repo | Review/lint chặn; RLS vẫn fail-closed |
| 2 | Connection pool tái sử dụng connection | `SET LOCAL` chỉ sống trong transaction, không dùng session-level `SET` |
| 3 | Tenant ID giả mạo từ request | Tenant lấy từ trusted routing/authz; parameterized UUID; không tin body/query |
| 4 | Runtime dùng superuser | Deployment fail; runtime credential phải `NOSUPERUSER NOBYPASSRLS` |
| 5 | Worker cần scan toàn hệ thống | Chỉ narrow stored function/queue grant; không cấp `BYPASSRLS` chung |
| 6 | Worker xử nhầm tenant | Job mang tenant ID; service transaction thiết lập tenant context và audit |
| 7 | Schema public thêm cột mới | CI whitelist fail cho tới khi security review chấp thuận |
| 8 | Kèo private bị project public | Invariant test fail; projector từ chối upsert |
| 9 | Person-self đoán person ID khác | 403 + audit; person ID lấy từ session/magic-link verified |
| 10 | Hai migration chạy cùng lúc | PostgreSQL advisory lock; instance thứ hai chờ/fail an toàn |
| 11 | Seed sport trùng | Upsert/`ON CONFLICT`; seed idempotent |
| 12 | Tenant bị xoá | Soft-delete/lifecycle status; không cascade dữ liệu tài chính |
| 13 | Hai request cùng sửa slot | Transaction + row lock/version check; không over-fill |
| 14 | Foreign key sport không tồn tại | FK chặn; không dùng `CHECK` thay cho FK |

---

## 4. Domain và quyền truy cập

### Data zones

| Zone | Ví dụ | Quyền |
|---|---|---|
| **GLOBAL protected** | `sports`; sau này `persons`, `channel_identities` | Lookup công khai có whitelist; identity chỉ qua protected service |
| **TENANT private** | sessions, players, memberships, reachability, ledger, settings | RLS theo `app.tenant_id` + authz theo vai trò |
| **PUBLIC** | `public_sessions` | Cross-tenant read-only, field whitelist, rate-limit |
| **WORKER** | queue/outbox claim metadata | Narrow privileged functions; không expose qua HTTP |

### Permission matrix

| Actor | Public | Tenant operational | Person-self | Cross-tenant worker |
|---|---:|---:|---:|---:|
| Anonymous | ✅ whitelist | ❌ | ❌ | ❌ |
| Player | ✅ | ❌ dữ liệu người khác | ✅ chính mình | ❌ |
| Tenant admin/co-admin | ✅ | ✅ tenant được cấp quyền | ✅ chính mình | ❌ |
| API runtime role | Theo endpoint | RLS + authz | Protected service | ❌ scan toàn hệ thống |
| Worker | Không qua public API | Một tenant/job | Chỉ khi job yêu cầu | ✅ narrow claim + audit |
| Migration role | N/A | Schema only | N/A | Không dùng runtime |

### Public whitelist P0–P1

`session_id` nội bộ · `sport_key` · `starts_at` · `ends_at` · `area` · `skill_level` · `price` · `slots_open` · `club_display_name` · `host_display_name` · `join_policy`.

`tenant_id` có thể tồn tại nội bộ để route join nhưng không được serialize ra public API. Không có venue chi tiết, roster, bank account, debt/payment hoặc contact PII.

### Core invariants

- `SET LOCAL app.tenant_id` là tên setting duy nhất.
- RLS dùng `current_setting('app.tenant_id', true)::uuid`; thiếu context → 0 row.
- `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` trên mọi tenant table.
- Tenant isolation và role authorization là hai lớp khác nhau; cùng tenant không mặc nhiên có quyền xem tiền người khác.
- Global identity tables không cấp `SELECT` trực tiếp cho API role.
- Public API không query tenant ledger/roster để dựng response.

---

## 5. Screens và observability

P0–P1 không có UI end-user. Deliverables quan sát được:

| Surface | Ready | Error |
|---|---|---|
| Migration runner | Version + duration + checksum | Migration ID + rollback guidance |
| Seed command | Counts + idempotent result | Transaction rollback + actionable error |
| CI isolation suite | Tenant/public/worker invariants xanh | Nêu policy/query vi phạm |
| Ops metrics | RLS denial, worker claim, migration duration | Alert khi privileged function bất thường |

Không gửi schema/migration telemetry chứa row data hoặc PII.

---

## 6. Acceptance Criteria

- [ ] Monorepo install/build/typecheck/test thành công.
- [ ] PostgreSQL migrations chạy từ fresh DB và upgrade DB có data.
- [ ] Schema session có sport + `starts_at/ends_at/timezone` + discovery fields.
- [ ] Runtime role là `NOSUPERUSER NOBYPASSRLS`.
- [ ] Mọi tenant table bật ENABLE + FORCE RLS.
- [ ] `tenantRepo` luôn mở transaction và `SET LOCAL app.tenant_id`.
- [ ] Query thiếu/sai tenant context trả 0 row.
- [ ] Tenant A/B không đọc hoặc sửa dữ liệu nhau.
- [ ] Player trong tenant không đọc debt/roster người khác nếu thiếu authz.
- [ ] Public projection chỉ chứa whitelist; private session không xuất hiện.
- [ ] Person-self endpoint từ chối person ID không thuộc session.
- [ ] Worker chỉ claim qua narrow function; mỗi business job quay lại tenant RLS context.
- [ ] Privileged worker/person-self access có audit.
- [ ] Migration dùng advisory lock và có rollback/forward-fix plan.
- [ ] Seed idempotent; danh sách môn không hard-code ngoài taxonomy đã chốt ở OD-8.

---

## 7. Open Decisions và changelog

| ID | Quyết định | Trạng thái |
|---|---|---|
| BRD OD-4 | Managed Postgres provider | Chờ chốt |
| BRD OD-8 | Danh sách môn + taxonomy trình độ | Chờ chốt |
| MT-OQ-1 | Narrow worker functions cụ thể | Chốt trong backend tech spec trước P0 implementation |

## Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-06-19 | v1.1 | Thêm Changelog heading, verified format compliance |
| 2026-06-18 | v1.1 | Canonical phase; chuẩn hóa RLS setting/worker contract; protected identity; permission matrix; public fields |
| 2026-06-18 | v1.0 | Initial foundation spec |
