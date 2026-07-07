# Feature: Tenant Routing & Admin Authorization — Backend Tech Spec

> **Canonical phase:** P2  
> **Version:** 2.0 · 2026-06-19  
> **Status:** Reviewed  
> **Product spec:** `../feature_tenant_routing_authz.md`  
> **References:** `../../product/TDD.md` §3.3–3.5 · `../../standards/business-rules.md` BL-SEC-2/BL-SEC-5

---

## 1. Tổng quan triển khai

```text
Telegram Update → telegramResolver(chat_id/user_id/deep_link)
    → AuthZ Middleware(action, actor, tenant)
        → tenant-bound Service/Repo (RLS set)
```

**Pipeline:** `telegramResolver` maps incoming update to tenant via trusted bindings. `authzMiddleware` derives stable actor identity and calls `authorize(action, actor, tenant)`. Handler cannot override either value.

**Design decisions:**
- Routing ≠ authorization — 2 separate middleware steps.
- Store keyed hashes for TG user lookup — encrypt recoverable IDs only if needed.
- Link codes: hash-only storage (no plaintext), TTL, single-use.
- Global context/link lookup via narrow service access — not open queries.

---

## 2. Database Schema + Edge Cases (BE)

### Schema

```sql
CREATE TABLE telegram_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  chat_id bigint NOT NULL,
  kind text NOT NULL DEFAULT 'group' CHECK (kind IN ('group', 'channel')),
  active boolean NOT NULL DEFAULT true,
  linked_at timestamptz NOT NULL DEFAULT now(),
  linked_by uuid REFERENCES persons(id),
  UNIQUE (chat_id) WHERE active = true  -- only 1 active binding per chat
);

CREATE TABLE tenant_admins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  platform text NOT NULL DEFAULT 'telegram',
  platform_user_lookup_hash text NOT NULL,
  role text NOT NULL DEFAULT 'admin' CHECK (role IN ('owner', 'admin', 'co_admin')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, platform, platform_user_lookup_hash) WHERE active = true
);

CREATE TABLE tenant_link_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_lookup_hash text NOT NULL UNIQUE,
  code_hash text NOT NULL,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  intended_role text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  revoked_at timestamptz,
  attempts integer NOT NULL DEFAULT 0
);

CREATE TABLE player_chat_context (
  person_id uuid NOT NULL REFERENCES persons(id),
  platform text NOT NULL DEFAULT 'telegram',
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (person_id, platform)
);

CREATE TABLE routing_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text NOT NULL,
  actor_id uuid,
  tenant_id uuid,
  detail jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

All tenant-scoped tables: `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY`.

### Indexes

```sql
CREATE INDEX idx_telegram_links_chat ON telegram_links(chat_id) WHERE active = true;
CREATE INDEX idx_tenant_admins_lookup ON tenant_admins(platform, platform_user_lookup_hash) WHERE active = true;
CREATE INDEX idx_link_codes_hash ON tenant_link_codes(code_lookup_hash);
CREATE INDEX idx_link_codes_expiry ON tenant_link_codes(expires_at) WHERE consumed_at IS NULL AND revoked_at IS NULL;
```

### Edge Cases (Backend)

| # | Category | Case | Xử lý |
|---|----------|------|-------|
| 1 | Security | Tenant resolved from message text/body | ❌ NEVER — only trusted bindings (chat_id, link code hash) |
| 2 | Concurrency | Link consume + admin create race | Single transaction + row lock on link code |
| 3 | Concurrency | Rebind chat to new tenant | Lock chat/current/new tenant rows — write before/after audit |
| 4 | Security | Callback contains spoofed session/tenant | Canonical session lookup validates tenant — reject mismatch |
| 5 | Concurrency | Replayed Telegram update_id | Idempotency key on update_id — return previous result |
| 6 | Security | Link code brute force | Rate-limit `attempts` counter + account lockout |
| 7 | Security | Bot secret/webhook path in logs | ❌ NEVER — KMS-managed, logs redact |
| 8 | Data Integrity | Username change affects auth | No impact — use stable numeric user_id |
| 9 | Data Integrity | Stale membership/context | Fail closed — invalidate and reject |
| 10 | Security | Co-admin exceeds permitted actions | Action matrix enforcement in authz middleware |
| 11 | Cross-Feature | Suspended tenant admin mutation | Billing gating check in middleware |
| 12 | Security | Cross-platform user ID collision | Impossible — lookup hash includes platform prefix |

---

## 3. API Contract

### Resolution Precedence

```text
1. Group message → chat_id → telegram_links(active=true) → tenant_id
2. Admin DM → platform_user_lookup_hash → tenant_admins → 
     1 tenant → auto-select
     N tenants → picker
3. Player DM → sticky context → validate membership active
4. Deep link → slug → tenant_id (sticky, no admin grant)
5. Fallback → fail closed (403)
```

### Internal Error Codes

| Code | Error Code | Message | Trigger |
|------|-----------|---------|---------|
| 403 | `TENANT_NOT_LINKED` | Chat chưa liên kết club | Group chat without active binding |
| 403 | `TENANT_CONTEXT_REQUIRED` | Cần chọn club | Multi-club DM without context |
| 403 | `NOT_TENANT_ADMIN` | Bạn không có quyền admin | Non-admin actor |
| 400 | `LINK_CODE_INVALID` | Mã liên kết không hợp lệ hoặc hết hạn | Invalid/expired/consumed link |
| 409 | `CHAT_ALREADY_BOUND` | Nhóm đã liên kết club khác | Rebind without owner confirmation |
| 400 | `STALE_CALLBACK` | Yêu cầu đã hết hạn — thử lại | Old callback data |
| 403 | `TENANT_SUSPENDED` | Club đang tạm ngưng | Suspended tenant mutation |

### Rate Limits

| Endpoint/Action | Limit | Scope |
|----------------|-------|-------|
| Link code attempts | 5/10min | Per IP/actor |
| Admin commands | 30/min | Per actor/tenant |
| Callback processing | 60/min | Per chat_id |

---

## 4. Chi tiết triển khai

### AuthZ Action Matrix

| Action | Owner | Admin | Co-admin | Player |
|--------|:-----:|:-----:|:--------:|:------:|
| Bind/rebind group | ✅ | ❌ | ❌ | ❌ |
| Session CRUD | ✅ | ✅ | Configured | ❌ |
| Manage admins | ✅ | ❌ | ❌ | ❌ |
| View settings | ✅ | ✅ | ✅ | ❌ |
| Player commands | ✅ | ✅ | ✅ | ✅ (own) |

### Suspended Tenant Gating

| Action Class | Allowed? |
|-------------|----------|
| Admin mutation | ❌ |
| Integration changes | ❌ |
| Player CK ingest | ✅ |
| Read-only queries | ✅ |
| System safety paths | ✅ |

---

## 5. Testing Plan

### Unit Tests

| # | Test | Input | Expected |
|---|------|-------|----------|
| 1 | Group resolution happy path | Valid chat_id with binding | Correct tenant_id |
| 2 | Group resolution no binding | Unknown chat_id | `TENANT_NOT_LINKED` |
| 3 | Admin DM single tenant | Admin with 1 membership | Auto-select tenant |
| 4 | Admin DM multi tenant | Admin with N memberships | Return picker |
| 5 | Player DM valid context | Active sticky context | Correct tenant |
| 6 | Player DM stale context | Membership deleted | Fail closed |
| 7 | Deep link routing | Valid slug | Sticky context set, no admin |
| 8 | Spoofed tenant in body | Client-supplied tenant_id | Ignored — use trusted binding |
| 9 | Callback wrong group | chat_id ≠ session tenant | Rejected |
| 10 | Link consume happy | Valid code + first use | Admin created |
| 11 | Link consume expired | Expired code | `LINK_CODE_INVALID` |
| 12 | Link consume replay | Already consumed code | `LINK_CODE_INVALID` |
| 13 | Link brute force | >5 attempts/10min | Rate limited |
| 14 | Rebind race | Concurrent rebind attempts | One success, one fails |
| 15 | Update replay | Same update_id twice | Idempotent |
| 16 | Username change | Changed TG username | Auth unaffected |
| 17 | Non-admin admin command | Player actor | 403 |
| 18 | Co-admin exceeds scope | Unauthorized action | 403 |
| 19 | Suspended tenant mutation | Admin mutate | 403 `TENANT_SUSPENDED` |
| 20 | Tenant A/B isolation | Tenant A query | No tenant B data |

### Integration Tests

| # | Test | Setup | Expected |
|---|------|-------|----------|
| 1 | Full link → bind → command flow | Issue link → consume → group add → command | All steps succeed atomically |
| 2 | Multi-club DM → picker → select | Player in 3 clubs | Picker shown, selection routes correctly |
| 3 | Rebind group | Chat bound A → rebind B | A removed, B active, audit logged |
| 4 | Suspended flow | Suspend tenant → test mutation + CK ingest | Mutation blocked, CK ingest works |

---

## 6. Rollout Plan + Changelog

### Rollout

1. Create schema + migrate
2. Bind founder as tenant #1 owner
3. Shadow resolver on bot updates (log only)
4. Switch commands to tenant middleware
5. Migrate group webhook
6. Monitor unresolved/denied/replayed updates

### Metrics

- Resolution latency/failure by reason
- AuthZ denials (expected vs unexpected)
- Stale callback count
- Link abuse attempts
- Bot webhook health

### Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-06-18 | v1.0 | Initial BE tech spec (English format) |
| 2026-06-19 | v2.0 | Chuẩn hoá Vietnamese numbered (6 sections), thêm full DDL, 12 BE edge cases, authz matrix, rate limits, 20 unit tests, 4 integration tests |
