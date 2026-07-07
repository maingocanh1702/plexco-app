# Feature: Multi-tenant Foundation — Backend Tech Spec

> **Canonical phase:** P0–P1  
> **Version:** 1.1 · 2026-06-18  
> **Status:** Implementation contract aligned with TDD v2.1  
> **Product spec:** `../feature_multi_tenant.md`  
> **References:** `../../product/TDD.md` §3.1–3.4 · `../../research/player-side-saas-AUDIT.md`

---

## 1. Architecture

```text
packages/core       pure domain logic, no DB/bot dependency
apps/bot            Telegram/Zalo adapters (P2+)
apps/web            web/API surface (P4+)
packages/db         Drizzle schema, migrations, tenantRepo, privileged DB functions
packages/jobs       pg-boss producers/handlers, tenant-scoped execution wrapper
```

PostgreSQL/domain services are canonical. Runtime requests never set tenant from untrusted body/content. Tenant comes from channel routing or authenticated web context, followed by role authorization.

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
- Tenant-private: `sessions`, `players`; later migrations add memberships/reachability/ledger but inherit the same RLS template.
- Public: `public_sessions` skeleton.
- Worker metadata/functions: queue schema + audit entries; no public HTTP access.

### Required session fields

```sql
CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  sport_id uuid NOT NULL REFERENCES sports(id),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  timezone text NOT NULL,
  price integer NOT NULL CHECK (price >= 0),
  slots_max integer CHECK (slots_max IS NULL OR slots_max > 0),
  area text NOT NULL,
  venue text,
  skill_level text,
  visibility text NOT NULL CHECK (visibility IN ('private','public')),
  join_policy text NOT NULL CHECK (join_policy IN ('open','approval')),
  status text NOT NULL CHECK (status IN ('open','closed','cancelled')),
  CHECK (ends_at > starts_at)
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

When P3.5 adds `persons/channel_identities`, runtime API role receives no direct SELECT. Identity service uses narrow functions/queries authorized by authenticated person. `channel_reachability` remains tenant-scoped + RLS.

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
| 2026-06-18 | v1.1 | Replaced legacy payments schema; standardized RLS setting; added worker/protected/public contracts |
| 2026-06-18 | v1.0 | Initial backend spec |
