# Feature: Multi-tenant Foundation — Backend Tech Spec

> **Canonical phase:** P0–P1
> **Version:** 1.5a · 2026-07-19
> **Status:** Implementation contract reconciled to TDD v3.1 / decisions v1.45; P0–P1 live schema/migrations/tests remain the reality baseline, DD-15/DD-65..68 migration pending
> **Implementation:** Implemented (foundation) — RLS + tenantRepo + migrations 0000–0013 trên `main` · authority: `../../standards/BUILD-STATUS.md` (Doc status ≠ Implementation status)  
> **Product spec:** `../feature_multi_tenant.md`
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

---

## 9. Definition of Done

- [ ] Roles and grants verified by automated test.
- [ ] `app.tenant_id` is the only tenant context setting.
- [ ] Every tenant table passes policy audit.
- [ ] `tenantRepo`/`withTenant` tests cover commit, rollback and pool reuse.
- [ ] Worker narrow-function threat tests pass.
- [ ] Public and person-self invariant tests pass.
- [ ] Fresh and upgrade migrations pass on PostgreSQL.
- [ ] Product acceptance criteria in `../feature_multi_tenant.md` pass.

---

## Changelog

| Date | Version | Change |
|---|---|---|
| 2026-07-19 | v1.5a | Metadata sweep (index v2.35): thêm trường **Implementation** đồng bộ BUILD-STATUS (Implemented (foundation)). Không đổi contract. |
| 2026-07-17 | v1.5 | **Live-schema closure:** replace the abridged `sessions` block with the exact `0002`/Drizzle contract, including nullable `area`, venue address, defaults, optimistic version and audit timestamps. |
| 2026-07-17 | v1.4 | **DD-67 v1.45 generalization:** endpoint-scope identity/reachability for Messenger + Zalo, three-part uniqueness and `channel_identity_id` reachability; target tenant remains separately authorized. Live baseline unchanged; migration pending. |
| 2026-07-17 | v1.3 | **DD-65..68 boundary propagation:** split Zalo tenant reachability from global-protected Messenger Page registry/identity/endpoint reachability; endpoint/default context no longer equals target tenant. Live P0–P1 baseline unchanged; migration pending. |
| 2026-07-10 | v1.2 | **DD-37 ✅:** channel adapters = Zalo (P2) + Facebook Messenger (P2.5); bỏ Telegram. Cập nhật architecture note (`apps/bot`). |
| 2026-06-18 | v1.1 | Replaced legacy payments schema; standardized RLS setting; added worker/protected/public contracts |
| 2026-06-18 | v1.0 | Initial backend spec |
