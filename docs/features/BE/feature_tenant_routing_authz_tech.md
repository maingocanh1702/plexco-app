# Feature: Tenant Routing & Admin Authorization — Backend Tech Spec

> **Canonical phase:** P2
> **Version:** 2.5a · 2026-07-19
> **Status:** Reviewed · reconciled to TDD v3.1 / decisions v1.45
> **Implementation:** Not started · authority: `../../standards/BUILD-STATUS.md` (Doc status ≠ Implementation status)  
> **Product spec:** `../feature_tenant_routing_authz.md`
> **References:** `../../product/TDD.md` §3.3–3.5 · `../../standards/business-rules.md` BL-SEC-2/BL-SEC-5 · `../../standards/decisions.md` DD-27 · DD-51 · DD-53 · DD-56 · **DD-65..68**

---

## 1. Tổng quan triển khai

> **Authority DD-15/DD-65..68 v1.45 (2026-07-17):** Zalo token/Messenger Page resolve provider endpoint + optional default ingress tenant; identity/reachability scoped theo bot/OA/Page. Target tenant/resource đến từ protected opaque action/public ref/server context và được authorize riêng; không từ message/client body. Telegram legacy không dùng cho tenant mới.

```text
Channel event → endpointResolver (Zalo tenant | Messenger central/tenant | web session)
    → protected context/action resolver → AuthZ Middleware(action, actor, target tenant/resource)
        → tenant-bound Service/Repo (RLS set)
```

**Pipeline:** `channelResolver` maps trusted endpoint; Messenger identity lookup includes Page ID. `contextActionResolver` resolves target from opaque actor/Page-bound action, protected public ref or eligible-role picker. `authzMiddleware` then calls `authorize(action, actor, target)`; handler cannot override endpoint, actor or target.

**Design decisions:**
- Routing ≠ authorization — 2 separate middleware steps.
- Tenant/resource **không bao giờ** suy từ free text/client body. Zalo/web may pin it; Messenger Page supplies only endpoint/default and protected resolver owns final target (NFR-S3/DD-66).
- Store keyed hashes for per-channel user lookup — encrypt recoverable IDs only if needed.
- Link codes: hash-only storage (no plaintext), TTL, single-use.
- Global context/link lookup via narrow service access — not open queries.
- **Channel identity/reachability là provider-endpoint scoped** → 3-part key `(platform, provider_scope_lookup_hash, platform_user_lookup_hash)`; Messenger scope Page, Zalo scope bot/OA; explicit endpoint binding, không reuse window/token hoặc auto-merge xuyên endpoint.
- **DD-56:** one canonical action→capability registry owns authorization. Unknown action/capability, missing grant, expired grant, or registry failure all deny. Adapters/API/UI may render registry output but may not infer privileges from role labels.

---

## 2. Database Schema + Edge Cases (BE)

### Live legacy baseline — reference only, NOT target DDL

Khối DDL dưới đây mô tả baseline Telegram-era đang tồn tại để migration có điểm xuất phát; **không được copy làm target schema** cho tenant mới. Target delta ở ngay sau block phải được thực hiện bằng migration mới: Zalo/Messenger provider bindings, endpoint-scoped identity/reachability, hybrid Page registry/context và defaults không còn Telegram.

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

> **Target delta (Reviewed):** Telegram is legacy only. Zalo uses `webhook_token → endpoint/default tenant`; Messenger requires a new DD-65 migration for global-protected central+tenant Page registry and server-side action/context storage. Both channel identities use the DD-67 3-part endpoint key and reachability by `channel_identity_id`; target tenant authorize separately. Live `messenger_pages.tenant_id NOT NULL UNIQUE` is implementation truth today but insufficient; do not edit historical migration. Defaults `'telegram'` above remain historical and are not target defaults.

`tenant_link_codes` is the canonical table for **tenant-admin onboarding** in this feature. It is not the DD-50 identity `link_codes` table; do not merge their purposes or schemas. Current lifecycle fields are `consumed_at`/`revoked_at`/`attempts`, never the Product alias `used_at`.

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
| 1 | Security | Tenant resolved from message text/body | ❌ NEVER — trusted endpoint + protected context/action resolver only |
| 2 | Concurrency | Link consume + admin create race | Single transaction + row lock on link code |
| 3 | Concurrency | Rebind chat to new tenant | Lock chat/current/new tenant rows — write before/after audit |
| 4 | Security | Callback contains raw/spoofed session/tenant | Reject. Only opaque actor+Page-bound action may resolve target; valid cross-club target need not equal source Page default |
| 5 | Concurrency | Replayed channel event id (Zalo/Messenger mid/event; legacy TG update_id) | Idempotency key on event id — return previous result |
| 6 | Security | Link code brute force | Rate-limit `attempts` counter + account lockout |
| 7 | Security | Bot secret/webhook path in logs | ❌ NEVER — KMS-managed, logs redact |
| 8 | Data Integrity | Username change affects auth | No impact — use stable numeric user_id |
| 9 | Data Integrity | Stale membership/context/action snapshot | Fail closed — invalidate/re-pick; re-check capability and target at consume |
| 10 | Security | Co-admin exceeds permitted actions | Action matrix enforcement in authz middleware |
| 11 | Cross-Feature | Suspended tenant admin mutation | Billing gating check in middleware |
| 12 | Security | Cross-platform/Page user ID collision | Lookup hash includes platform + Page + PSID; no cross-Page auto-merge |
| 13 | Security | Co-admin sensitive action without a current explicit grant | Deny before service mutation; audit denial class |
| 14 | Security | Owner tries to grant `role.manage` or a PlatformAdmin-only action | Deny; these capabilities are absent from delegable registry set |
| 15 | Security | Grant expires/revokes during request | Re-evaluate inside mutation transaction; missing/expired grant denies |

---

## 3. API Contract

### Resolution Precedence

```text
1. Zalo event → webhook_token → bot/OA endpoint + optional ingress tenant + endpoint-scoped identity
   Messenger evt → page_id → endpoint(scope, optional default tenant) + Page-scoped identity
   Web request → authenticated session → tenant context
   (legacy) TG group message → chat_id → telegram_links(active=true) → tenant_id  [tenant-1 only]
2. Messenger opaque action/protected public ref → target tenant/resource;
   otherwise actor memberships/roles →
     1 tenant → auto-select
     N tenants → bounded server-side picker
3. Revalidate action TTL/snapshot/version + membership/capability at consume
4. Source tenant Page is audit/default only; valid cross-club target resolves independently
5. Fallback → fail closed/re-pick (403)
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
| 403 | `CAPABILITY_DENIED` | Bạn không có quyền thực hiện thao tác này | Missing/default-denied/expired capability; no tenant internals exposed |

### Rate Limits

| Endpoint/Action | Limit | Scope |
|----------------|-------|-------|
| Link code attempts | 5/10min | Per IP/actor |
| Admin commands | 30/min | Per actor/tenant |
| Callback processing | 60/min | Per chat_id |

---

## 4. Chi tiết triển khai

### AuthZ Action Matrix

Every route declares one exact action key. `authorize(action, actor, tenant, now)` resolves the key through one registry and returns a capability decision; no handler repeats formulas or role checks.

| Action key / class | Co-admin preset | Delegable by owner? | Authority rule |
|---|:---:|:---:|---|
| `session.manage` | ✅ | N/A | Routine session CRUD |
| `content.manage` | ✅ | N/A | Tenant content/settings excluding secrets/billing |
| `member.manage_routine` | ✅ | N/A | Routine member actions; no role mutation |
| `member.ban` | ✅ | N/A | DD-52 actor amendment |
| `money.read` | ✅ | N/A | Read-only tenant money surface |
| `money.mark_paid` | ✅ | N/A | Must still execute DD-25 preview+confirm+audit core |
| `money.correct` | ❌ | ✅ | Explicit current grant with actor/reason/expiry/audit |
| `money.refund` | ❌ | ✅ | Same; canonical money core remains fail-closed |
| `money.waive_or_void` | ❌ | ✅ | Same |
| `bank_account.manage` | ❌ | ✅ | Same; secret handling rules still apply |
| `connector.secret_manage` | ❌ | ✅ | Same; never expose secret value |
| `billing.manage` | ❌ | ✅ | Tenant billing only; not DD-51 global override |
| `role.manage` | ❌ | ❌ | TenantOwner-only; co-admin cannot remove/demote owner/admin |
| DD-51 global billing override | ❌ | ❌ | PlatformAdmin-only dedicated service |
| DD-53 freeze/split/relink | ❌ | ❌ | PlatformAdmin + DD-53 two-approval/break-glass contract |

Logical grant record (physical DDL must be pinned by the authz build slice after mutation-path probe): `tenant_id`, `grantee_person_id`, exact `capability`, `reason`, `granted_by`, `granted_at`, `expires_at`, `revoked_at`. Unique active semantics, grant/revoke, capability re-check and target mutation share a transaction boundary where required. `role.manage` and PlatformAdmin-only keys are rejected before persistence.

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
| 8 | Spoofed tenant in body | Client-supplied tenant_id | Ignored/rejected — protected resolver only |
| 9 | Callback wrong/stale actor/Page | Token binding/snapshot mismatch | Rejected; no mutation |
| 10 | Link consume happy | Valid code + first use | Admin created |
| 11 | Link consume expired | Expired code | `LINK_CODE_INVALID` |
| 12 | Link consume replay | Already consumed code | `LINK_CODE_INVALID` |
| 13 | Link brute force | >5 attempts/10min | Rate limited |
| 14 | Rebind race | Concurrent rebind attempts | One success, one fails |
| 15 | Update replay | Same update_id twice | Idempotent |
| 16 | Username change | Changed channel username (Zalo/Messenger) | Auth unaffected — use stable numeric user id/PSID |
| 17 | Non-admin admin command | Player actor | 403 |
| 18 | Co-admin exceeds scope | Unauthorized action | 403 |
| 19 | Suspended tenant mutation | Admin mutate | 403 `TENANT_SUSPENDED` |
| 20 | Tenant A/B isolation | Tenant A query | No tenant B data |
| 21 | Default co-admin preset | Iterate six preset capabilities | Allowed; mark-paid still invokes preview+confirm+audit |
| 22 | Sensitive deny table | Iterate correct/refund/waive-void/bank/secret/billing without grant | 403 before mutation for every action |
| 23 | Sensitive valid grant | Each delegable sensitive action with current audited grant | Allowed only for exact capability/tenant/grantee |
| 24 | Expired/revoked/wrong-tenant grant | Time or tenant mismatch | 403 fail-closed |
| 25 | Role management non-delegable | Owner attempts grant; co-admin attempts remove/demote | Grant rejected; mutation 403 |
| 26 | Global action non-delegable | Co-admin/owner invokes DD-51 override or DD-53 split | 403; only PlatformAdmin dedicated path can proceed |
| 27 | Unknown registry action | Route declares unknown key or registry unavailable | Startup/build validation fails or runtime deny; never fallback to role |
| 28 | Mid-request expiry/revoke | Grant valid at request entry, invalid at mutation | Transactional re-check denies; no partial mutation |
| 29 | Messenger central context | actor has 0/1/N eligible tenants | Discovery / auto-select / bounded picker; never guess |
| 30 | Messenger cross-club action | tenant Page A, protected session B ref | Target B resolves; source A grants no capability; B authz/join rules apply |
| 31 | Messenger raw callback ID | raw tenant/session/member id | Rejected even if ID exists |

### Integration Tests

| # | Test | Setup | Expected |
|---|------|-------|----------|
| 1 | Full link → bind → command flow | Issue link → consume → group add → command | All steps succeed atomically |
| 2 | Multi-club DM → picker → select | Player in 3 clubs | Picker shown, selection routes correctly |
| 3 | Rebind group | Chat bound A → rebind B | A removed, B active, audit logged |
| 4 | Suspended flow | Suspend tenant → test mutation + CK ingest | Mutation blocked, CK ingest works |
| 5 | Registry used by every surface | Same action via web/Zalo/Messenger | Same allow/deny result and audit class; adapters contain no role formula |
| 6 | Hybrid endpoint matrix | central + tenant Page; host/player/dual-role in 2 tenants | Correct context, isolation and capability across all combinations |

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
| 2026-07-19 | v2.5a | Metadata sweep (index v2.35): thêm trường **Implementation** đồng bộ BUILD-STATUS (Not started). Không đổi contract. |
| 2026-07-17 | v2.5 | **decisions v1.45:** generalized provider-endpoint identity/reachability cho Messenger + Zalo; reachability keyed by `channel_identity_id`, target tenant authorize separately. |
| 2026-07-17 | v2.4 | **Legacy/target closure:** Telegram DDL labeled reference-only; target delta points to endpoint-scoped Zalo/Messenger model; `tenant_link_codes` naming/lifecycle aligned and separated from identity `link_codes`. |
| 2026-07-17 | v2.3 | **DD-65..68:** Messenger endpoint/default-context split, protected opaque target resolver, Page-scoped identity/reachability, central picker and valid cross-club action semantics; live schema flagged migration-pending. |
| 2026-06-18 | v1.0 | Initial BE tech spec (English format) |
| 2026-06-19 | v2.0 | Chuẩn hoá Vietnamese numbered (6 sections), thêm full DDL, 12 BE edge cases, authz matrix, rate limits, 20 unit tests, 4 integration tests |
| 2026-07-10 | v2.1 | **DD-37 ✅:** routing pivot — tenant suy từ **Zalo `webhook_token`** + **Messenger `page_id`** per-club; Telegram `chat_id`/`telegram_links` xuống **legacy tenant-1 only**. Cập nhật overview, channel-binding note, resolution precedence. Nguyên tắc routing-từ-kênh (NFR-S3) không đổi. |
| 2026-07-16 | v2.2 | **Full propagation DD-56 (closure v1.37; current decisions v1.39):** canonical action→capability registry, exact co-admin preset, expiring/audited sensitive grants, non-delegable `role.manage`/DD-51/DD-53 actions, transaction-time re-check, and deny tests for every sensitive class. |
