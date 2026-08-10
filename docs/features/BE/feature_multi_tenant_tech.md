# Feature: Multi-tenant Foundation — Backend Tech Spec

> **Canonical phase:** P0–P1
> **Version:** 1.6 · 2026-07-19
> **Status:** Implementation contract reconciled to TDD v3.1 / decisions v1.45; P0–P1 live schema/migrations/tests remain the reality baseline, DD-15/DD-65..68 migration pending
> **Implementation:** Implemented (foundation) — RLS + tenantRepo + migrations 0000–0013 trên `main` · authority: `../../standards/BUILD-STATUS.md` (Doc status ≠ Implementation status)  
> **Product spec:** `../FE/feature_multi_tenant.md`
> **References:** `../../product/TDD.md` §3.1–3.4 · `../../research/player-side-saas-AUDIT.md` · `../../standards/decisions.md` DD-37/**DD-65..68** · `feature_identity_tech.md` · `feature_tenant_routing_authz_tech.md`

> **Cập nhật v1.2 (DD-37 ✅, 2026-07-10):** kênh phase-1 = **Zalo + Facebook Messenger + web** (bỏ Telegram). Channel adapters ở `apps/bot` nay là Zalo (P2) + Messenger (P2.5).
>
> **Cập nhật v1.3 (DD-65..68):** Zalo token/web auth có thể pin tenant. Messenger `page_id` chỉ resolve global-protected endpoint/default context; target tenant/resource phải từ opaque action/protected ref/server picker. Page-bound identity/reachability không dùng tenant RLS làm authorization.
>
> **Cập nhật v1.4 (decisions v1.45):** identity/reachability được generalized cho Messenger + Zalo: unique `(platform, provider_scope_lookup_hash, platform_user_lookup_hash)`, reachability gắn `channel_identity_id`; endpoint ingress/default và target-tenant authorization là hai lớp riêng.
>
> **Cập nhật v1.5:** `sessions` DDL dưới mirror chính xác live migration `0002`/Drizzle schema; không dùng một field subset trông như full-table authority.

---

## 1. Architecture

```text
packages/core       pure domain logic, no DB/bot dependency
apps/bot            Zalo (P2) + Facebook Messenger (P2.5) channel adapters
apps/web            web/API surface (P4+)
packages/db         Drizzle schema, migrations, tenantRepo, privileged DB functions
packages/jobs       pg-boss producers/handlers, tenant-scoped execution wrapper
```

PostgreSQL/domain services are canonical. Runtime requests never set tenant from untrusted body/content. Zalo/web can provide trusted tenant context; Messenger resolves endpoint first and target tenant separately through protected server state, followed by role/action authorization.

### Database roles

| Role | Purpose | Rules |
|---|---|---|
| `app` | HTTP/bot runtime | `NOSUPERUSER NOBYPASSRLS`; tenant tables only through RLS |
| `app_worker` | Scheduler/outbox claim | EXECUTE narrow functions + queue metadata only; no broad business-table bypass |
| `migration` | DDL | Not available to runtime; secret isolated |

---

## 2. Schema contract

Core P0–P1 tables:

- Global lookup: `sports`.
- Tenant root/config: `tenants`, `settings`.
- Tenant-private: `sessions`, `players`; later migrations add memberships, Zalo bot/tenant config and ledger under the same RLS template.
- Global-protected: Messenger Page registry plus endpoint-scoped channel identity/reachability for Messenger and Zalo; no blanket app grant, narrow resolver only.
- Public: `public_sessions` skeleton.
- Worker metadata/functions: queue schema + audit entries; no public HTTP access.

### Live `sessions` table (migration `0002`)

```sql
CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  sport_id uuid NOT NULL REFERENCES sports(id),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  timezone text NOT NULL,
  venue_name text,
  venue_address text,
  area text,
  skill_level text,
  price_amount integer NOT NULL DEFAULT 0 CHECK (price_amount >= 0),
  slots_max integer,
  visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','public')),
  join_policy text NOT NULL DEFAULT 'open' CHECK (join_policy IN ('open','approval')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','closed','cancelled')),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CHECK (slots_max IS NULL OR slots_max > 0)
);
```

### Public read model

`public_sessions` stores only: session ID, internal routing tenant ID, sport key, starts/ends, area, skill level, price, slots open, club/host display name and join policy. API serializers never expose routing `tenant_id`. No venue, roster, bank, debt, contact or raw event payload.

### Migration & Rollback

> Baseline P0–P1 (`tenants`/`memberships`/`sessions`/`players` + RLS/grants) **đã LIVE** trên canonical qua `0002_tenants_core.sql` (schema) + `0009_rls_policies_grants.sql` (RLS/grants) — doc này mô tả live baseline: **reuse, không recreate**. Delta còn pending (DD-15/DD-65..68 identity/reachability) đi bằng **migration mới số monotonic kế tiếp còn trống**, không sửa/chạy lại migration lịch sử (quy trình forward-fix ở §6).

| Bước | Hành động | An toàn? |
|------|-----------|----------|
| 1 | Rollback một delta migration mới: disable route/worker phụ thuộc trước, rồi revert phần additive (constraint/policy/function mới) | ✅ Additive-only revert; forward-fix ưu tiên (§6) |
| 2 | Sửa/chạy lại `0002`/`0009` đã apply | ❌ Không có hiệu lực trên môi trường đã migrate — luôn dùng migration mới |
| 3 | DROP bảng baseline (`tenants`/`memberships`/`sessions`/`players`/…) | ❌ NEVER — baseline đang mang dữ liệu thật; destructive rollback đòi backup/restore + PITR (§6) |

---

## 3. RLS and repository contract

The only setting name is `app.tenant_id`.

```sql
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON sessions
USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
```

Apply ENABLE + FORCE + USING/WITH CHECK to every tenant-scoped table. Missing setting yields NULL and therefore zero visible rows.

```ts
export async function withTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>) {
  assertUuid(tenantId);
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL app.tenant_id = ${tenantId}`);
    return fn(tx);
  });
}

export function tenantRepo(tenantId: string) {
  return {
    listSessions: () => withTenant(tenantId, tx => /* scoped query */),
    createSession: (input: CreateSession) => withTenant(tenantId, tx => /* insert tenantId */),
  };
}
```

Handlers receive a repo/service already bound to trusted tenant context. Direct imports of tenant tables outside db/service modules are lint/review failures.

---

## 4. Worker contract

`app_worker` does not receive general `BYPASSRLS`.

1. Claim due metadata through SECURITY DEFINER functions with fixed `search_path`, input validation and minimal returned columns.
2. Function returns `job_id`, `tenant_id`, entity ID—not arbitrary business rows.
3. Handler opens a normal tenant transaction and calls `SET LOCAL app.tenant_id`.
4. Claim uses `FOR UPDATE SKIP LOCKED`/pg-boss semantics.
5. Every privileged claim records job, tenant, reason and system actor.

Security-definer functions must be owned by a non-login role; revoke PUBLIC execute and grant only to `app_worker`.

---

## 5. Protected and public paths

### Global identity

When P3.5 adds `persons/channel_identities`, runtime API role receives no direct SELECT. Identity service uses narrow functions/queries authorized by authenticated person. Both Messenger and Zalo identities are endpoint-scoped through `provider_scope_lookup_hash`; reachability is keyed by `channel_identity_id`. These rows are global-protected and require exact endpoint relation plus separate target-tenant authorization at the consumer. Tenant-owned Zalo bot configuration remains tenant-private.

### Person-self

Person ID comes from verified session/magic-link, not request params as authority. Cross-tenant aggregation selects a field whitelist and writes audit. A player cannot subscribe/query another person.

### Public

Discovery role/API can read `public_sessions` only. It cannot join tenant tables at request time. Rate-limit, pagination and stable public error shapes are mandatory.

### Request/Response Examples

> Doc này là foundation spec (RLS/`tenantRepo`/worker) — **không pin HTTP endpoint riêng**; API surface nằm ở các feature spec tiêu thụ. Mọi endpoint đọc/ghi tenant data dùng envelope chuẩn DD-60 (`../../standards/api-reference-convention.md`): thành công `{ "data": {...}, "error": null, "meta": { "requestId": "req_…" } }`; lỗi `{ "data": null, "error": { "code": "X", "message": "…", "statusCode": N }, "meta": { "requestId": "req_…" } }`. Ví dụ cụ thể xem spec từng feature (vd `feature_payment_reconcile_tech.md` §6).
### Request/Response Examples

> Foundation envelope DD-60 — áp dụng cho MỌI endpoint dùng tenant context.

**Thành công** — tenant-scoped query:

```json
{
  "data": { "sessions": [...], "count": 5 },
  "error": null,
  "meta": { "requestId": "req_..." }
}
```

**Lỗi** — thiếu tenant context:

```json
{
  "data": null,
  "error": { "code": "TENANT_CONTEXT_MISSING", "message": "Thiếu ngữ cảnh CLB", "statusCode": 400 },
  "meta": { "requestId": "req_..." }
}
```

**Lỗi** — RLS denial (cross-tenant):

```json
{
  "data": null,
  "error": { "code": "TENANT_ACCESS_DENIED", "message": "Không có quyền truy cập CLB này", "statusCode": 403 },
  "meta": { "requestId": "req_..." }
}
```


### Idempotency

> Chỉ tổng hợp cơ chế đã pin trong doc này; key HTTP per-endpoint thuộc spec từng feature.

| Đường | Idempotent? | Cơ chế |
|-------|-------------|--------|
| Worker claim (§4) | ✅ | `FOR UPDATE SKIP LOCKED`/pg-boss semantics — mỗi job claim đúng một lần dưới concurrency (test §7) |
| Migration apply (§6) | ✅ | Versioned migrations + advisory lock — không chạy DDL đồng thời/lặp |
| HTTP mutation của feature tiêu thụ | ⬜ chưa pin ở doc này | Chốt ở spec/build slice từng feature (`processed_commands`/command id) |


### Error Codes (foundation — cascaded to all tenant endpoints)

| Code | Error Code | Message | Trigger |
|------|-----------|---------|---------|
| 400 | `TENANT_CONTEXT_MISSING` | Thiếu ngữ cảnh CLB | No tenant_id in request context |
| 400 | `TENANT_NOT_FOUND` | CLB không tồn tại | Invalid tenant_id |
| 400 | `TENANT_SUSPENDED` | CLB đã bị tạm ngưng | Tenant suspended/inactive |
| 403 | `TENANT_ACCESS_DENIED` | Không có quyền truy cập CLB này | RLS denial / wrong tenant |
| 403 | `ROLE_INSUFFICIENT` | Không đủ quyền thực hiện hành động này | Role < required |
| 403 | `PERSON_SELF_MISMATCH` | Không có quyền truy cập dữ liệu người khác | Person-self endpoint violation |
| 500 | `TENANT_RLS_LEAK` | Lỗi hệ thống — liên hệ hỗ trợ | SET LOCAL failure / pool leak (internal alert) |
| 500 | `MIGRATION_LOCK_FAILED` | Không thể áp dụng migration | Advisory lock contention |

> Đây là error codes nền tảng — áp dụng cho MỌI endpoint sử dụng tenant context. Specific feature error codes ở spec từng feature.### Internal Contract Endpoints (consumed by feature modules)

| Method | Path | Auth | Mô tả |
|--------|------|------|-------|
| — | `tenantRepo.withTenant(tid, fn)` | Internal service | Open transaction + SET LOCAL |
| — | `tenantRepo.getById(tid)` | Internal service | Tenant metadata lookup |
| POST | `/internal/worker/claim` | app_worker role | pg-boss job claim (narrow function) |
| GET | `/internal/health/rls` | Ops/CI | RLS invariant health check |
| — | `pnpm db:migrate` | CLI (migration role) | Apply migrations |
| — | `pnpm db:seed` | CLI (migration role) | Idempotent seed |

> Foundation spec — app-facing HTTP endpoints thuộc các feature spec tiêu thụ.


---

## 6. Migrations and rollout

- Versioned Drizzle migrations; do not use `db:push` in production.
- Acquire PostgreSQL advisory lock before migration.
- Additive nullable/backfill/constraint sequence for existing data.
- Migration role only in deployment job.
- Forward-fix preferred after production migration; destructive rollback requires backup/restore plan.
- PITR enabled before tenant #1 cutover.

### P0–P1 order

1. Roles/extensions/migration metadata.
2. `sports`, `tenants`, `settings`.
3. Sessions/players + constraints.
4. RLS policies + FORCE.
5. Public skeleton.
6. Worker functions/audit.
7. Seed and invariant suites.

---

## 7. Testing

### Unit Tests (tenantRepo + RLS logic)

| # | Test | Input | Expected |
|---|------|-------|----------|
| 1 | tenantRepo opens transaction with SET LOCAL | Valid tenant_id | app.tenant_id set |
| 2 | tenantRepo without tenant → 0 rows | No tenant context | Empty result, no crash |
| 3 | Query tenant A data as tenant B | tenant_id mismatch | 0 rows returned |
| 4 | INSERT without tenant_id → error | Missing FK | FK violation |
| 5 | FORCE RLS prevents owner bypass | Table owner query | Only RLS-visible rows |
| 6 | Pool reuse → no context leak | Sequential requests | Fresh SET LOCAL each time |
| 7 | Player reads own debt only | Player A, player B debt | Only own visible |
| 8 | Worker claim via narrow function | pg-boss job | Exactly one claim |
| 9 | Worker claim under concurrency | 3 workers, 1 job | Exactly one succeeds |
| 10 | Migration advisory lock prevents concurrent DDL | 2 migration runners | One waits |
| 11 | Seed idempotent | Run seed twice | Same result |
| 12 | Public projection whitelist only | Public query | Only whitelist fields |
| 13 | Private session not in public | Session with visibility=private | Not projected |
| 14 | Public serializer omits tenant_id | Serialize public_session | No tenant_id in output |
| 15 | Person-self rejects foreign person_id | Wrong authenticated person | 403 |
| 16 | CI audit: all tenant tables have RLS | Schema scan | ENABLE + FORCE on all |
| 17 | CI audit: public whitelist check | Schema scan | No new field without update |
| 18 | Runtime role is NOSUPERUSER NOBYPASSRLS | Role check | Correct attributes |
| 19 | Worker audit trail | Worker claim | Audit record created |
| 20 | Session slot transaction prevents overfill | Concurrent joins | No over-fill |

### Integration Tests

| # | Test | Setup | Expected |
|---|------|-------|----------|
| 1 | Full tenant isolation | 2 tenants, seed chéo | A không thấy B |
| 2 | Worker → tenant RLS context | Worker claim → business query | Correct tenant data |
| 3 | Migration → seed → test suite | Fresh DB | Green |
| 4 | Pool connection storm | 50 concurrent requests | No context leak |

### Required integration tests

- App role without tenant context reads/writes zero rows.
- Tenant A cannot SELECT/UPDATE/DELETE/INSERT as tenant B.
- Pool reuse does not leak previous `SET LOCAL` context.
- Table owner/runtime role cannot bypass FORCE RLS.
- Authz: player cannot read another player’s debt/roster within same tenant.
- Private session never appears in public projection.
- Public serializer exactly matches whitelist and omits routing tenant ID.
- Person-self rejects mismatched authenticated person.
- Worker claims once under concurrency, audits claim, then sees only job tenant.
- Migration advisory lock prevents concurrent DDL.
- Session slot transaction prevents over-fill.

### CI schema audit

Fail if any tenant table lacks `tenant_id`, ENABLE/FORCE RLS, policy USING/WITH CHECK, or appears in the direct-import allowlist unexpectedly. Fail if public table/serializer gains a field without explicit whitelist update.

---

## 8. Observability and security

- Structured logs may include tenant ID/job ID but no secrets, bank content or PII.
- Metrics: RLS denial, public query latency, worker claim lag/failure, migration duration.
- Alert on privileged function anomaly and runtime connection using wrong DB role.
- SQL connection startup assertion verifies current user and `rolbypassrls=false`.

### Caching Strategy

| Data | Cache? | TTL | Invalidation |
|------|--------|-----|-------------|
| Tenant context / RLS decision | ❌ | — | Fail-closed, live per-request: `SET LOCAL app.tenant_id` trong transaction (§3); không cache decision xuyên request |
| Authz/role/grant checks | ❌ | — | Live per-request tại middleware/service (xem `feature_tenant_routing_authz_tech.md`) |
| `public_sessions` read model | Projection (không phải cache authz) | — | Cập nhật qua projector; serializer whitelist §2 |

### Security Checklist (template v2.33 — map về section đã pin)

| Mục | Trả lời trong spec |
|-----|---------------------|
| Authorization/ownership | §3 RLS ENABLE+FORCE + `withTenant`; §4 worker narrow functions; §5 protected/person-self/public paths |
| Injection/validation | §3 `assertUuid(tenantId)`; §4 SECURITY DEFINER fixed `search_path` + input validation |
| Secret & log redaction | §8: logs có tenant/job ID nhưng không secrets/bank content/PII |
| Webhook signature + replay | N/A — doc này không định nghĩa webhook ingress (xem payment/connector specs) |
| Idempotency | §4 worker claim + bảng Idempotency §5 |
| Data retention/xoá | Chưa pin per-table ở doc này — theo `feature_security_operations_tech.md` |

---

## 9. Definition of Done

- [ ] Roles and grants verified by automated test.
- [ ] `app.tenant_id` is the only tenant context setting.
- [ ] Every tenant table passes policy audit.
- [ ] `tenantRepo`/`withTenant` tests cover commit, rollback and pool reuse.
- [ ] Worker narrow-function threat tests pass.
- [ ] Public and person-self invariant tests pass.
- [ ] Fresh and upgrade migrations pass on PostgreSQL.
- [ ] Product acceptance criteria in `../FE/feature_multi_tenant.md` pass.

---

## Changelog

| Date | Version | Change |
|---|---|---|
| 2026-07-19 | v1.6 | **Template v2.30/v2.33 uplift:** thêm §2 Migration & Rollback (baseline `0002`/`0009` LIVE — reuse, không recreate; DROP baseline = ❌ NEVER), §5 Request/Response Examples (DD-60 pointer — doc không pin endpoint riêng) + Idempotency, §8 Caching Strategy + Security Checklist. Derivative/editorial — không đổi contract. |
| 2026-07-19 | v1.5a | Metadata sweep (index v2.35): thêm trường **Implementation** đồng bộ BUILD-STATUS (Implemented (foundation)). Không đổi contract. |
| 2026-07-17 | v1.5 | **Live-schema closure:** replace the abridged `sessions` block with the exact `0002`/Drizzle contract, including nullable `area`, venue address, defaults, optimistic version and audit timestamps. |
| 2026-07-17 | v1.4 | **DD-67 v1.45 generalization:** endpoint-scope identity/reachability for Messenger + Zalo, three-part uniqueness and `channel_identity_id` reachability; target tenant remains separately authorized. Live baseline unchanged; migration pending. |
| 2026-07-17 | v1.3 | **DD-65..68 boundary propagation:** split Zalo tenant reachability from global-protected Messenger Page registry/identity/endpoint reachability; endpoint/default context no longer equals target tenant. Live P0–P1 baseline unchanged; migration pending. |
| 2026-07-10 | v1.2 | **DD-37 ✅:** channel adapters = Zalo (P2) + Facebook Messenger (P2.5); bỏ Telegram. Cập nhật architecture note (`apps/bot`). |
| 2026-06-18 | v1.1 | Replaced legacy payments schema; standardized RLS setting; added worker/protected/public contracts |
| 2026-06-18 | v1.0 | Initial backend spec |
