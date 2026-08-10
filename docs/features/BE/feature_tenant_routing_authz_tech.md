# Feature: Tenant Routing & Admin Authorization — Backend Tech Spec

> **Canonical phase:** P2
> **Version:** 2.7 · 2026-07-28
> **Status:** Reviewed · reconciled to TDD v3.1 / decisions DD-56/DD-86
> **Implementation:** Not started · authority: `../../standards/BUILD-STATUS.md` (Doc status ≠ Implementation status)  
> **Product spec:** `../FE/feature_tenant_routing_authz.md`
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
- **DD-56:** one canonical action→capability registry owns authorization. Live role labels `admin` and `co_admin` resolve to the same least-privilege co-admin preset, never owner rights. Unknown action/capability, missing grant, expired grant, or registry failure all deny. Adapters/API/UI may render registry output but may not infer privileges from role labels.
- **DD-86 Chat registry:** exact keys are `chat.channel.manage`, `chat.channel.post_restricted`, `chat.message.moderate`, `chat.member.mute`. All four require `kind='club'` target derivation + current tenant/channel/membership re-check at consume; none grants host/admin/support access to human DM.

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

### Migration & Rollback

> Baseline routing **đã LIVE** trên canonical: `telegram_links`/`tenant_admins`/`tenant_link_codes`/`player_chat_context`/`routing_audit` (`0002_tenants_core.sql`), `messenger_pages` (`0004_channels_connectors.sql`), RLS/grants (`0009`) — **reuse, không recreate**; DDL trên là reference baseline, không phải target. Target delta DD-65..68 và DD-56 `tenant-capability-authority-core` đi bằng các **migration mới số monotonic kế tiếp còn trống**; không sửa historical migration. Capability semantics độc lập với Chat schema, nhưng actual DB worktree là slice 4 và execution hard-dep slice 3: worktrees 1→2→3→4 serialize vì cùng chạm migration tail, `packages/db/schema.ts`, DB catalog/schema/authz tests. Capability core phải có trước mọi Chat capability consumer.

| Bước | Hành động | An toàn? |
|------|-----------|----------|
| 1 | Rollback delta migration mới: disable resolver/middleware path mới trước, rồi revert phần additive (bảng/constraint/policy mới của DD-65..68) | ✅ Additive-only revert |
| 2 | Sửa/chạy lại `0002`/`0004`/`0009` đã apply | ❌ Không có hiệu lực trên môi trường đã migrate — luôn dùng migration mới |
| 3 | DROP bảng baseline routing ở trên | ❌ NEVER — thuộc migration đã apply, có thể mang binding/admin/audit thật |
| 4 | Rollback capability authority sau khi có grant/action consumer | Disable consumer surfaces; forward-fix schema/policy/function, không drop registry/grant/audit history | ❌ Không destructive rollback |

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

### Query Patterns

```sql
-- resolveTenantFromChannel (Zalo: trusted token context)
SELECT t.id, t.display_name, t.status
FROM tenants t
JOIN zalo_bots zb ON zb.tenant_id = t.id
WHERE zb.oa_id = $1
  AND t.status = 'active';

-- getMemberRole (authorization check)
SELECT m.role, m.person_id
FROM memberships m
WHERE m.tenant_id = current_setting('app.tenant_id', true)::uuid
  AND m.person_id = $1
  AND m.status = 'active';

-- getSessionGrants (session-scoped capabilities)
SELECT g.action, g.resource_id, g.expires_at
FROM grants g
WHERE g.grantee_person_id = $1
  AND g.resource_type = 'session'
  AND g.resource_id = $2
  AND g.expires_at > now();
```

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

### Request/Response Examples

> Minh hoạ; doc này pin middleware/resolution contract, không pin REST path/DTO — field name chốt ở build slice. Envelope chuẩn DD-60 (`../../standards/api-reference-convention.md`). Error code lấy từ bảng Internal Error Codes ở trên.

**Consume link code (tenant-admin onboarding)** — thành công:

```json
{ "data": { "tenantId": "…", "role": "admin", "linked": true }, "error": null, "meta": { "requestId": "req_…" } }
```

- Link code sai/hết hạn/đã dùng:

```json
{ "data": null, "error": { "code": "LINK_CODE_INVALID", "message": "Mã liên kết không hợp lệ hoặc hết hạn", "statusCode": 400 }, "meta": { "requestId": "req_…" } }
```

**Group chat chưa bind club** (mọi admin command trong chat chưa liên kết):

```json
{ "data": null, "error": { "code": "TENANT_NOT_LINKED", "message": "Chat chưa liên kết club", "statusCode": 403 }, "meta": { "requestId": "req_…" } }
```

### Idempotency

> Tổng hợp từ cơ chế đã pin (§2 Edge Cases #2/#5/#9, §5 tests) — không thêm cơ chế mới.

| Đường | Idempotent? | Key/Cơ chế |
|-------|-------------|------------|
| Channel event (Zalo/Messenger mid/event; legacy TG `update_id`) | ✅ | Idempotency key theo event id — replay trả previous result (edge #5, test #15) |
| Link code consume | ✅ single-use | Single transaction + row lock; đã consume → replay trả `LINK_CODE_INVALID` (edge #2, test #12) |
| Callback/action snapshot | ✅ fail-closed | Stale snapshot invalidate/re-pick; capability + target re-check tại consume (edge #9, test #9) |
| Admin command HTTP key | ⬜ chưa pin — chốt ở build slice | — |


### Endpoints

| Method | Path | Auth | Mô tả |
|--------|------|------|-------|
| POST | `/api/auth/resolve-tenant` | Authenticated session | Resolve tenant from channel/session context |
| GET | `/api/tenants/:tid/members` | TenantAdmin | List tenant members with roles |
| POST | `/api/tenants/:tid/members/invite` | TenantAdmin | Invite member to tenant |
| PUT | `/api/tenants/:tid/members/:mid/role` | TenantOwner | Change member role |
| DELETE | `/api/tenants/:tid/members/:mid` | TenantAdmin | Remove member |
| GET | `/api/tenants/:tid/grants` | TenantAdmin | List session-scoped grants |
| POST | `/api/tenants/:tid/grants` | TenantAdmin | Create session-scoped grant |
| DELETE | `/api/tenants/:tid/grants/:gid` | TenantAdmin | Revoke grant |

> Envelope DD-60.
---

## 4. Chi tiết triển khai

### AuthZ Action Matrix

Every route declares one exact action key. `authorize(action, actor, tenant, now)` resolves the key through one registry and returns a capability decision; no handler repeats formulas or role checks. `owner` gets tenant-owner actions; both legacy `admin` and `co_admin` get exactly the co-admin preset plus a current explicit delegable grant.

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
| `chat.channel.manage` | ✅ | N/A | Create/rename/default/archive club channels; exact-one-default + idempotency remain Chat-owned |
| `chat.channel.post_restricted` | ✅ | N/A | Post to `admins_only` club channel; active channel membership also required |
| `chat.message.moderate` | ✅ | N/A | Club-message soft-hide/tombstone + reason + append-only audit only; no hard delete/edit |
| `chat.member.mute` | ✅ | N/A | Timed club-channel mute with DB-owned expiry; no DM/read grant |
| `role.manage` | ❌ | ❌ | TenantOwner-only; co-admin cannot remove/demote owner/admin |
| DD-51 global billing override | ❌ | ❌ | PlatformAdmin-only dedicated service |
| DD-53 freeze/split/relink | ❌ | ❌ | PlatformAdmin + DD-53 two-approval/break-glass contract |

#### Canonical implementation split

`tenant-capability-authority-core` owns the only physical authorization source:

- migration-owned `tenant_capability_actions(action_key PK, co_admin_default, delegable, authority_class)` closed registry; runtime roles have no DML and seed includes the exact DD-56 matrix plus four Chat keys;
- tenant-private `tenant_capability_grants(tenant_id, grantee_person_id, action_key, reason, granted_by_person_id, granted_at, expires_at, revoked_at)` with exact tenant/person/action FKs, `expires_at > granted_at`, one non-revoked grant per tuple and no direct app DML;
- append-only restricted grant event/audit rows and a fail-closed `authorize` primitive that resolves current Person→tenant role, treats `admin|co_admin` identically, reads only current non-revoked/non-expired delegable grants, and denies unknown/unavailable/wrong-tenant state;
- no cache; consumer mutations re-check inside their transaction. Chat's thin adapter additionally re-checks current `kind='club'` channel/membership and never converts capability into human-DM authority.

The core lands only after the serialized DB lane `chat-definer-role-provisioning → chat-dm-safety-authority-core → dd38-dd86-chat-schema-core → tenant-capability-authority-core`, then precedes `chat-club-channel-lifecycle-core → chat-authorized-member-target-read-core → chat-club-moderation-core → chat-shared-message-command-core`. Stable catalog ID 9 runs before 6/7/8 because the explicit dependency graph, not the ID, controls execution. The execution dependency on slice 3 is collision control, not a semantic dependency on Chat schema. It does not own any feature mutation. `tenant-sensitive-capability-grant-lifecycle` later owns actor-scoped grant/revoke commands + management UI if that work exceeds the core slice; the four Chat keys are default preset actions and do not depend on that lifecycle.

Before authoring the capability migration, design-probe legacy `tenant_admins` web-person resolution and every grant/revoke path. If the target cannot fit the pinned slice ceiling without cutting RLS/grants/audit tests, halt and split; do not create a Chat-local registry. `role.manage` and PlatformAdmin-only keys are rejected before persistence.

### Suspended Tenant Gating

| Action Class | Allowed? |
|-------------|----------|
| Admin mutation | ❌ |
| Integration changes | ❌ |
| Player CK ingest | ✅ |
| Read-only queries | ✅ |
| System safety paths | ✅ |

### Caching Strategy

| Data | Cache? | TTL | Invalidation |
|------|--------|-----|-------------|
| Tenant resolution (endpoint→tenant) | ❌ | — | Live per-request qua resolver; không resolve được → fail closed/re-pick (403) |
| Capability/authz decision (DD-56 registry) | ❌ | — | Evaluate mỗi request + re-check trong mutation transaction (edge #15); expired/revoked grant deny |
| Membership/context/action snapshot | ❌ | — | Stale snapshot fail-closed — invalidate/re-pick, re-check tại consume (edge #9) |

### Security Checklist (template v2.33 — map về section đã pin)

| Mục | Trả lời trong spec |
|-----|---------------------|
| Authorization/ownership | §1 routing ≠ authorization (2 lớp middleware); §4 action matrix + one registry DD-56; tenant/resource không bao giờ từ client body (edge #1/#4) |
| Injection/validation | §1/§3: tenant không suy từ free text; opaque action/protected ref; raw/spoofed callback ID reject (edge #4, test #31) |
| Secret & log redaction | §2 edge #7: bot secret/webhook path KMS-managed, logs redact; link code hash-only storage (§1) |
| Webhook signature + replay | Channel event id idempotency (edge #5); provider webhook signature verification thuộc connector/payment specs — N/A ở doc này |
| Idempotency | Bảng Idempotency §3 |
| Data retention/xoá | `routing_audit`/link-code retention chưa pin ở doc này — theo `feature_security_operations_tech.md` |

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
| 21 | Default least-privilege preset | Iterate core `authorize` for every preset action as `admin` and `co_admin` | Identical allow set; neither inherits owner-only actions; feature consumers separately retain their own preview/confirm/audit contract |
| 22 | Sensitive deny table | Evaluate correct/refund/waive-void/bank/secret/billing without grant | Deny for every action before any feature consumer is called |
| 23 | Sensitive valid grant | Evaluate each delegable sensitive action with current audited grant | Core allows only the exact capability/tenant/grantee; feature mutation remains consumer-owned |
| 24 | Expired/revoked/wrong-tenant grant | Time or tenant mismatch | 403 fail-closed |
| 25 | Role management non-delegable | Core attempts to register/persist a `role.manage` delegation; later role-management consumer tries remove/demote as co-admin | Core rejects non-delegable registry/grant state; consumer mutation is separately 403 |
| 26 | Global action non-delegable | Core evaluates DD-51 override or DD-53 split for tenant owner/co-admin | Deny; only the separate PlatformAdmin dedicated path can proceed |
| 27 | Unknown registry action | Route declares unknown key or registry unavailable | Startup/build validation fails or runtime deny; never fallback to role |
| 28 | Mid-request expiry/revoke | Core evaluator passes, grant expires/revokes, same transaction/harness evaluates again | Second authorization denies; downstream consumer tests separately prove no partial mutation |
| 29 | Messenger central context | actor has 0/1/N eligible tenants | Discovery / auto-select / bounded picker; never guess |
| 30 | Messenger cross-club action | tenant Page A, protected session B ref | Target B resolves; source A grants no capability; B authz/join rules apply |
| 31 | Messenger raw callback ID | raw tenant/session/member id | Rejected even if ID exists |
| 32 | Exact Chat registry keys | Iterate four accepted keys plus typo/unknown aliases | Accepted keys resolve; aliases/unknown deny, never fall back to role |
| 33 | Chat target re-check | Capability passes at entry, then membership/channel/tenant changes before mutation | Consume-time decision denies; no partial channel/post/moderation/mute mutation |
| 34 | Chat moderation boundary | `chat.message.moderate` against club message, then human-DM message | Club soft-tombstone/audit allowed; DM denied with zero transcript disclosure |
| 35 | Timed mute authority | `chat.member.mute` with valid/expired/revoked actor authority and target expiry | Only valid actor writes bounded club-channel mute; DB time expiry restores post; DM unaffected |

**Test ownership / dependency fence:**

- `tenant-capability-authority-core` must pass the core portions of #21–#28 and #32 before any capability consumer: closed registry/preset, grant-read constraints/RLS/audit, non-delegable persistence rejection, exact four Chat keys, unknown/unavailable/wrong-tenant/expired/revoked deny and repeated evaluator re-check. In #25 it owns only registry/storage rejection; in #28 it owns only the second fail-closed authorization decision.
- #33 belongs to each lifecycle/moderation/shared-message consumer's mutation tests; #34–#35 belong to `chat-club-moderation-core` plus `chat-shared-message-command-core` security/E2E. These tests run **after** the core and prove target re-check/no-partial-mutation/DM denial without making the core depend on consumers.
- Integration #7 runs only after the relevant Chat consumers exist. Integration #5 belongs to DD-65–68 web/Zalo/Messenger adapter rollout and is not a precondition for the Chat capability core or the primary Chat plan.

### Integration Tests

| # | Test | Setup | Expected |
|---|------|-------|----------|
| 1 | Full link → bind → command flow | Issue link → consume → group add → command | All steps succeed atomically |
| 2 | Multi-club DM → picker → select | Player in 3 clubs | Picker shown, selection routes correctly |
| 3 | Rebind group | Chat bound A → rebind B | A removed, B active, audit logged |
| 4 | Suspended flow | Suspend tenant → test mutation + CK ingest | Mutation blocked, CK ingest works |
| 5 | Registry used by every external surface | Same action via web/Zalo/Messenger after DD-65–68 adapters land | Same allow/deny result and audit class; adapters contain no role formula |
| 6 | Hybrid endpoint matrix | central + tenant Page; host/player/dual-role in 2 tenants | Correct context, isolation and capability across all combinations |
| 7 | Chat capability parity | Same club-channel action via web/app command surfaces after consumer slices land | Same exact capability, target re-check and audit class; adapters contain no role formula |

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
| 2026-07-28 | v2.7 | Mirror DD-86 final into the canonical action registry: add four exact Chat capability keys, map `admin|co_admin` to one least-privilege preset, pin `tenant-capability-authority-core` as the shared runtime owner before Chat consumers, and retain club-only target/consume-time guards plus human-DM denial tests. Reviewed/not implemented unchanged. |
| 2026-07-19 | v2.6 | **Template v2.30/v2.33 uplift:** thêm §2 Migration & Rollback (baseline `0002`/`0004`/`0009` LIVE — reuse, không recreate; DROP baseline = ❌ NEVER; delta DD-65..68 = migration mới), §3 Request/Response Examples (DD-60 envelope) + Idempotency, §4 Caching Strategy + Security Checklist. Derivative/editorial — không đổi contract. |
| 2026-07-19 | v2.5a | Metadata sweep (index v2.35): thêm trường **Implementation** đồng bộ BUILD-STATUS (Not started). Không đổi contract. |
| 2026-07-17 | v2.5 | **decisions v1.45:** generalized provider-endpoint identity/reachability cho Messenger + Zalo; reachability keyed by `channel_identity_id`, target tenant authorize separately. |
| 2026-07-17 | v2.4 | **Legacy/target closure:** Telegram DDL labeled reference-only; target delta points to endpoint-scoped Zalo/Messenger model; `tenant_link_codes` naming/lifecycle aligned and separated from identity `link_codes`. |
| 2026-07-17 | v2.3 | **DD-65..68:** Messenger endpoint/default-context split, protected opaque target resolver, Page-scoped identity/reachability, central picker and valid cross-club action semantics; live schema flagged migration-pending. |
| 2026-06-18 | v1.0 | Initial BE tech spec (English format) |
| 2026-06-19 | v2.0 | Chuẩn hoá Vietnamese numbered (6 sections), thêm full DDL, 12 BE edge cases, authz matrix, rate limits, 20 unit tests, 4 integration tests |
| 2026-07-10 | v2.1 | **DD-37 ✅:** routing pivot — tenant suy từ **Zalo `webhook_token`** + **Messenger `page_id`** per-club; Telegram `chat_id`/`telegram_links` xuống **legacy tenant-1 only**. Cập nhật overview, channel-binding note, resolution precedence. Nguyên tắc routing-từ-kênh (NFR-S3) không đổi. |
| 2026-07-16 | v2.2 | **Full propagation DD-56 (closure v1.37; current decisions v1.39):** canonical action→capability registry, exact co-admin preset, expiring/audited sensitive grants, non-delegable `role.manage`/DD-51/DD-53 actions, transaction-time re-check, and deny tests for every sensitive class. |
