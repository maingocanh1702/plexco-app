# Feature: Notifications & Reminders — Backend Tech Spec

> **Canonical phase:** P3 / P4.5–P4.7  
> **Version:** 2.5 · 2026-07-17
> **Status:** Reviewed · reconciled to decisions v1.45/DD-15/DD-67; runtime migration pending
> **Product spec:** `../feature_notifications_reminders.md`  
> **References:** `../../standards/business-rules.md` BL-MSG-3/5, BL-NTF-1..3, BL-SEC-5 · `../../standards/decisions.md` DD-37/DD-40/DD-45/**DD-67** · `feature_identity_tech.md` · `feature_sync_engine_tech.md` · `../../dd-45-waitlist-analysis.md`

> **Cập nhật v2.1 (DD-40 ✅ + DD-37 ✅, 2026-07-10):** kênh nhắc chính = **web push + Zalo DM**; **Messenger best-effort trong cửa sổ standard 24h**, ngoài cửa sổ chỉ khi có cơ chế Meta đủ điều kiện/được phê duyệt; **bỏ group-mention Telegram**. Ngưỡng nhắc mặc định **2h → 24h → …** (DD-40). Sau **mọi** điểm markPaid (thủ công tiền mặt/CK **và** auto CK) → **xác nhận tự động tới player** (FR-6.2). Nhắc thủ công (`reminders_manual`) = mọi tier; **nhắc tự động (`reminders_auto`) = `host_pro`**.
>
> **Cập nhật v2.4 (DD-15/DD-67):** dispatcher không đọc tenant-level reachability. Nó resolve exact `channel_identity_id` endpoint cho Zalo/Messenger, re-authorize target tenant riêng, atomically claim một logical delivery key và fail closed khi provider outcome mơ hồ để tránh double-send.
>
> **Cập nhật v2.5 (tenant/endpoint integrity):** giữ `notification_deliveries.tenant_id` như live migration `0008`, bind delivery vào intent bằng composite FK `(intent_id, tenant_id)`, và bỏ `messenger_page_id` khỏi delivery row. Với Messenger/Zalo, exact Page/bot-OA luôn được derive từ immutable endpoint binding của `channel_identity_id`; không tồn tại hai cột độc lập có thể trỏ lệch endpoint.

---

## 1. Tổng quan triển khai

```text
Scheduler (narrow-claim due tenants) → Tenant TX (select eligible charges)
    → Create Intents → Dispatcher (channel selection) → Channel Adapter → Send
                                                            ↓ fail?
                                              Retry (backoff/jitter) → DLQ

Ledger Outbox → settled/correction Intents (atomic/idempotent)
Waitlist failure Outbox → owner-alert Intent (notification only; session worker owns retry)
```

**Design decisions:**
- At-least-once delivery safe via intent/delivery UNIQUE keys + provider idempotency.
- Messenger one-route: candidate endpoint không phải một delivery mới; `delivery_key` thuộc intent+platform và chỉ một Page được claim/sent.
- Tenant boundary được giữ ở database, không chỉ RLS/service: delivery chỉ tham chiếu intent có cùng `tenant_id`.
- Endpoint là thuộc tính của `channel_identity_id`; delivery không nhận/lưu Page id hoặc bot/OA id từ caller. Endpoint binding trên identity là immutable; đổi endpoint phải tạo identity mới.
- Retry classes: transient (exponential backoff/jitter), rate-limit (honor retry-after), permanent (mark unreachable), expired (skip).
- Channel adapter sends **outside** DB transaction — record result after.

---

## 2. Database Schema + Edge Cases (BE)

### Schema

```sql
CREATE TABLE notification_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) UNIQUE,
  thresholds jsonb NOT NULL DEFAULT '{}',
  quiet_hours_start time,
  quiet_hours_end time,
  max_count integer NOT NULL DEFAULT 3,
  cooldown_minutes integer NOT NULL DEFAULT 1440,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notification_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  type text NOT NULL,  -- 'reminder', 'settled', 'correction', 'owner_alert'
  aggregate_id uuid NOT NULL,
  state_version integer NOT NULL,
  person_id uuid NOT NULL REFERENCES persons(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'dispatched', 'skipped', 'expired')),
  intent_key text NOT NULL UNIQUE,  -- dedup key
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_intents_id_tenant_uq UNIQUE (id, tenant_id)
);

-- DD-67 identity migration prerequisite. The platform participates in the FK so
-- a Messenger delivery cannot reference a Zalo (or legacy Telegram) identity.
ALTER TABLE channel_identities
  ADD CONSTRAINT channel_identities_id_platform_uq UNIQUE (id, platform);

CREATE TABLE notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  intent_id uuid NOT NULL,
  platform text NOT NULL CHECK (platform IN ('web','zalo','messenger')),
  channel_identity_id uuid,
  route_class text NOT NULL, -- web|zalo_bot|messenger_tenant_page|messenger_central_page
  target_ref text,  -- legacy/audit ciphertext only; adapter MUST NOT route from this field
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  provider_code text,
  delivery_key text NOT NULL UNIQUE,  -- logical intent+platform; MUST NOT include Page id
  CONSTRAINT notification_deliveries_intent_tenant_fk
    FOREIGN KEY (intent_id, tenant_id)
    REFERENCES notification_intents(id, tenant_id),
  CONSTRAINT notification_deliveries_identity_platform_fk
    FOREIGN KEY (channel_identity_id, platform)
    REFERENCES channel_identities(id, platform),
  CHECK ((platform IN ('zalo','messenger')) = (channel_identity_id IS NOT NULL)),
  CHECK (
    (platform = 'web' AND route_class = 'web')
    OR (platform = 'zalo' AND route_class = 'zalo_bot')
    OR (platform = 'messenger' AND route_class IN ('messenger_tenant_page','messenger_central_page'))
  ),
  created_at timestamptz NOT NULL DEFAULT now()
);
```

All notification tables: `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY`. Provider registry/identity/reachability remain global-protected and are accessed only through narrow resolver/delivery functions; notification RLS does not authorize a Page/bot/OA endpoint by itself. `channel_identity_id` is the only provider-route authority: for Messenger the narrow resolver joins its exact `messenger_page_id`; for Zalo it joins its exact `zalo_bot_id`; in both cases it also resolves the encrypted provider user id from the same identity. `target_ref` remains legacy/audit ciphertext and is never an input to credential/recipient selection. The adapter receives the resolved protected endpoint secret + recipient, never caller-supplied Page/bot-OA/user ids.

### Migration / upgrade contract from live `0008`

Do **not** edit historical migration `0008_notifications_onboarding.sql`. A new migration after the DD-65/DD-67 registry/identity migration must:

1. Preserve live `notification_deliveries.tenant_id NOT NULL`; add `notification_intents UNIQUE (id, tenant_id)`, then add the composite delivery→intent FK as `NOT VALID`. The scalar `intent_id` FK may be dropped only after the composite FK validates.
2. Audit `notification_deliveries d JOIN notification_intents i ON i.id=d.intent_id WHERE d.tenant_id<>i.tenant_id`. Any row is a fail-closed migration halt/manual-repair case; never rewrite tenant ownership from request data. The composite FK is then `VALIDATE CONSTRAINT` so owner/bypass-RLS writes are fenced too.
3. Add `channel_identity_id` and `route_class` initially nullable for legacy-row audit. Add `(channel_identity_id, platform)` FK plus the platform/identity and platform/route-class shape CHECKs as `NOT VALID`, which still constrain every new/updated row. Backfill only from durable exact-endpoint evidence; an unprovable legacy route is quarantined/non-sendable, never guessed from PSID/from.id or target tenant.
4. After all legacy rows pass, validate every `NOT VALID` FK/CHECK and set `route_class NOT NULL`. Remove any staged/experimental `messenger_page_id` delivery column only after proving it is either null or exactly equal to the Page derived from its identity; mismatch halts migration. New runtime code never accepts that field.
5. Cut over dispatcher and adapter together. The resolver re-checks active identity, exact endpoint binding, reachability and separate target-tenant authorization before claim/send; endpoint-binding updates are denied (replacement identity row required).

### Edge Cases (Backend)

| # | Category | Case | Xử lý |
|---|----------|------|-------|
| 1 | Data Integrity | Duplicate intent (same charge + version) | UNIQUE `intent_key` — insert conflict = no-op |
| 2 | Data Integrity | Duplicate delivery (same intent + platform or alternate Page candidate) | UNIQUE logical `delivery_key` without Page — no double-send |
| 3 | Concurrency | Scheduler concurrent tenant claims | Narrow-claim with `FOR UPDATE SKIP LOCKED` |
| 4 | Concurrency | 1k tenant burst | Jitter + staggered scheduling |
| 5 | Data Integrity | Remind paid/void charge | Eligibility check: only open/partial status |
| 6 | Data Integrity | Reversal after settled confirmation | Create correction intent — different `intent_key` |
| 7 | Security | PII/amount in reminder template | Nhắc là **DM-only** (Zalo/Messenger web push) — không broadcast group; group-mention Telegram đã bỏ (DD-37). Template escaping + privacy policy check |
| 8 | Security | Manual override bypass cooldown | Owner role + reason + audit required |
| 9 | Resilience | Provider rate-limit (429) | Honor `retry-after`, update next_attempt_at |
| 10 | Resilience | Provider permanent failure | Mark exact endpoint unreachable; choose policy fallback only when provider outcome proves no send; unknown outcome stays fail-closed for review/retry |
| 11 | Security | Cross-tenant/cross-endpoint reachability | ❌ NEVER — exact channel identity + Page/bot/OA binding/window; target tenant re-authorized separately |
| 12 | Data Integrity | Left membership still eligible | Policy check: allow final notice or skip |
| 13 | Financial/Resilience | Duplicate waitlist derivation-failure event | `intent_key=waitlist-charge-derivation:{session}:{player}:{trigger}:{reason}`; at most one owner alert (unresolved recipient→skipped/DLQ); no player promotion/venue notification |
| 14 | Data Integrity | Tenant and central Page both reachable | Atomic claim selects tenant Page; same logical key suppresses central Page and concurrent retry |
| 15 | Data Integrity | Tenant Page closed, central Page reachable | Select central endpoint; do not copy tenant Page window/token |
| 16 | Resilience | Provider timeout after request write | Mark outcome unknown/fail-closed; do not immediately fail over to another Page and risk duplicate delivery |
| 17 | Security | Delivery tenant differs from parent intent tenant | Composite `(intent_id, tenant_id)` FK rejects even under owner/bypass-RLS connection |
| 18 | Security | Caller pairs Messenger identity from Page A with Page B | Impossible by schema/API: delivery stores no Page id; narrow resolver derives Page A from exact identity or fails closed |

---

## 3. API Contract

### Endpoints

| Method | Path | Auth | Mô tả |
|--------|------|------|-------|
| GET | /api/notifications/preview | TenantAdmin | Preview eligible recipients |
| POST | /api/notifications/send | TenantAdmin | Manual reminder send |
| GET | /api/notifications/report | TenantAdmin | Delivery report |
| PUT | /api/notifications/policy | TenantAdmin | Update notification policy |

### Error Codes

| Code | Error Code | Message | Trigger |
|------|-----------|---------|---------|
| 400 | `NO_ELIGIBLE_RECIPIENTS` | Không có ai cần nhắc nợ | No eligible charges |
| 429 | `REMINDER_COOLDOWN` | Đã nhắc gần đây — thử lại sau | Cooldown active |
| 403 | `OVERRIDE_REQUIRES_OWNER` | Chỉ chủ club mới có thể ghi đè cooldown | Non-owner override attempt |

### Idempotency

| Endpoint | Idempotent? | Key |
|----------|-------------|-----|
| POST /notifications/send | ✅ | `intent_key` per recipient |

---

## 4. Chi tiết triển khai

### Pipeline Detail

1. **Scheduler** narrow-claims due tenants (cron, `FOR UPDATE SKIP LOCKED`). Ngưỡng mặc định **2h → 24h → …** (DD-40, cấu hình ở `notification_policies.thresholds`). Nhắc tự động theo lịch = capability `reminders_auto` (`host_pro`); free tier chỉ nhắc thủ công (`reminders_manual`).
2. Per-tenant TX: select eligible charges (open/partial, not cooldown'd, not quiet hours)
3. Create `notification_intents` with UNIQUE key
4. **Dispatcher** applies notification policy (web push + Zalo DM remain primary). For Messenger, resolve exact candidates from Page-endpoint reachability: reachable tenant Page → reachable central Page → policy fallback. Atomically insert/claim one `delivery_key=intent:{intent_id}:platform:messenger`; the delivery stores only exact `channel_identity_id` + derived `route_class`, never an independently supplied Page id.
5. **Channel Adapter** sends outside TX through the endpoint derived by the narrow resolver from the claimed identity and records provider request/result; it never accepts an alternate Page id or fans out to both Pages.
6. Retry: transient → same claimed route with backoff/jitter/provider idempotency; rate-limit → honor retry-after; proven permanent/no-send → mark endpoint unreachable and let policy choose fallback; unknown-after-write → fail closed/manual review, no immediate alternate-Page send. Outside 24h/ineligible → skip Messenger and use policy fallback.

### Waitlist derivation failure alert (DD-45)

1. Consume tenant-scoped outbox event `waitlist.charge_derivation_failed` emitted by the session transaction with opaque `session_id`, `player_id`, `trigger_command_id`, `reason_code`.
2. Load active owner/admin key from tenant-scoped `tenant_admins`, then resolve its exact `(platform,provider_scope_lookup_hash,platform_user_lookup_hash)` → `person_id` through the identity service / narrow `SECURITY DEFINER` lookup (global-protected `channel_identities`, never a direct app-table join). Create `owner_alert` intent with deterministic key `waitlist-charge-derivation:{session}:{player}:{trigger}:{reason}`; duplicate event = no-op. Nếu không resolve được recipient, mark projector delivery skipped/DLQ reason `OWNER_RECIPIENT_UNRESOLVED`; outbox/audit vẫn durable và không ảnh hưởng domain retry.
3. Alert copy contains no player PII, amount, gender, venue or decrypted error detail. Candidate receives no promotion notification because state remains waitlisted.
4. This projector **does not run promotion retry**. Session service consumes the same event/retry job, re-locks session and re-counts capacity under DD-45.

### Quiet Hours

- Use tenant timezone — not UTC.
- DST-aware: recalculate windows when timezone transitions.
- Scheduler jitter prevents provider bursts.

---

## 5. Testing Plan

### Unit Tests

| # | Test | Input | Expected |
|---|------|-------|----------|
| 1 | Eligible: open charge | Charge status=open | Eligible |
| 2 | Eligible: partial charge | Charge status=partial | Eligible (remaining amount) |
| 3 | Not eligible: paid charge | Charge status=paid | Skip |
| 4 | Not eligible: void charge | Charge status=void | Skip |
| 5 | Left membership eligible | Policy allows final notice | Eligible |
| 6 | Left membership not eligible | Policy disallows | Skip |
| 7 | Quiet hours active | Send time in quiet window | Defer |
| 8 | Quiet hours DST boundary | Timezone transition | Correct window |
| 9 | Cooldown active | Last remind < cooldown | Skip |
| 10 | Max count reached | N reminders sent | Skip |
| 11 | Manual override no reason | Owner override without reason | Reject |
| 12 | Settled confirmation once | Charge settled | 1 intent created |
| 13 | Reversal after settled | Charge reversed | Correction intent |
| 14 | Duplicate intent | Same charge + version | No-op (UNIQUE conflict) |
| 15 | Duplicate delivery | Same intent + platform | No-op |
| 16 | Transient provider error | 500 error | Retry with backoff |
| 17 | Rate-limit error | 429 + retry-after | Honor retry-after |
| 18 | Permanent error | Blocked/invalid | Mark unreachable |
| 19 | Group privacy check | Amount in group template | Blocked by policy |
| 20 | Tenant isolation | Tenant A intent + attempted Tenant B delivery, including owner/bypass-RLS fixture | Insert rejected by composite FK; not merely hidden by RLS |
| 21 | Waitlist derivation owner alert dedupe | Resolvable owner + same failure event twice | Exactly one `owner_alert` intent; no candidate delivery |
| 22 | Failure alert privacy | Event includes opaque ids + reason | No amount/gender/venue/PII in intent/template/log |
| 23 | Owner recipient unresolved | Admin key has no identity-service match | No intent; projector skipped/DLQ `OWNER_RECIPIENT_UNRESOLVED`; domain retry unaffected |
| 24 | Both Messenger endpoints reachable | tenant + central windows open | One tenant-Page delivery; central suppressed by same logical key |
| 25 | Tenant endpoint closed | tenant closed, central open | One central-Page delivery; no tenant token reuse |
| 26 | Cross-Page PSID collision | same PSID text on two Pages | Exact Page-bound identity selected; no collision/misroute |
| 27 | Unknown provider outcome | timeout after write | No alternate-Page send; outcome remains reviewable/fail-closed |
| 28 | Cross-bot Zalo id collision | same `from.id` text on two bot/OA scopes | Distinct endpoint-bound identities; no cross-bot route/token reuse |
| 29 | Cross-platform identity FK | Messenger delivery references a Zalo identity | Composite `(channel_identity_id, platform)` FK rejects |
| 30 | No independent Page authority | Identity belongs to Page A; request/body supplies Page B | Request is rejected at API boundary; resolver accepts only identity id and returns only Page A secret |
| 31 | Live-schema upgrade | Apply new migration to fixture at `0008` shape | `tenant_id` retained; new writes fenced while constraints are `NOT VALID`; clean legacy data validates without loss |
| 32 | Dirty legacy tenant link | Existing delivery tenant differs from its intent tenant | Migration audit halts before validation/cutover; no automatic tenant rewrite |
| 33 | Unprovable legacy endpoint | Historical Messenger/Zalo row lacks exact endpoint evidence | Row remains quarantined/non-sendable; migration does not guess identity or Page/bot-OA |
| 34 | Tampered legacy target snapshot | `target_ref` conflicts with exact identity recipient | Adapter ignores it for routing; resolver returns endpoint + recipient from identity or fails closed |

### Integration Tests

| # | Test | Setup | Expected |
|---|------|-------|----------|
| 1 | Scheduler → send → delivery | Create charges → run scheduler | Intents created, delivery attempted |
| 2 | Settled event → confirmation | Payment matched → outbox | Confirmation sent once |
| 3 | Reversal → correction | Reversal after settled | Correction sent |
| 4 | 1k tenant burst | 1000 tenants with due charges | Jitter prevents burst, all processed |
| 5 | Waitlist failure outbox → owner digest | Resolvable owner + duplicate derivation-failure event | One owner alert/digest; session retry handled separately from same event; candidate receives nothing |
| 6 | Messenger one-route race | tenant+central endpoints, concurrent dispatcher/retry | Exactly one logical send; one delivery row/claim |
| 7 | Messenger fallback | tenant endpoint unavailable, central endpoint open | Central selected once; outside-window falls back per policy |
| 8 | Cross-tenant parent spoof | Tenant B transaction/owner role inserts delivery for Tenant A intent | Database rejects composite FK before provider adapter runs |
| 9 | Exact Page derivation | Identity bound to Page A plus forged Page B route input | No Page B credential lookup/send; route resolves Page A only or fails closed |

---

## 6. Rollout Plan + Changelog

### Rollout

1. Shadow eligibility (log only, no sends)
2. Owner preview only
3. Manual send — web push + Zalo DM (`reminders_manual`, mọi tier)
4. Automatic scheduled send — 2h→24h thresholds (`reminders_auto`, `host_pro`)
5. Run `0008` upgrade audit and validate tenant/identity composite constraints; runtime enablement is blocked by any dirty legacy tenant link or unresolved endpoint
6. Messenger DM best-effort trong cửa sổ 24h (P2.5) only after DD-65..68 Page registry/identity/reachability migration; enable one-route shadow metrics before send
7. Enable waitlist failure owner-alert projector after DD-45 session retry worker is wired

### Metrics

- Eligible/sent/skipped/failed counts
- Reminder-to-settlement conversion rate
- Queue lag / retry age
- Provider rate-limit frequency
- Opt-out/complaint count
- Waitlist derivation-failure alerts / dedupe conflicts / alert age
- Messenger route class, both-endpoint suppression, fallback and unknown-outcome counts (opaque; no raw Page/PSID)

### Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-07-17 | v2.5 | **Tenant/endpoint integrity closure:** restore live `notification_deliveries.tenant_id`, enforce same-tenant delivery→intent and identity→platform composite FKs, derive Messenger Page/Zalo bot-OA only from exact immutable identity, and add fail-closed `0008` upgrade/cross-tenant regression gates. Runtime migration pending. |
| 2026-07-17 | v2.4 | **DD-15/DD-67 v1.45:** protected endpoint reachability by `channel_identity_id` for Zalo+Messenger, 3-part identity lookup, separate target-tenant authorization and cross-endpoint tests. Runtime migration pending. |
| 2026-07-17 | v2.3 | **DD-67 full propagation:** Page-endpoint candidate resolver, logical delivery key without Page, tenant→central priority, exact endpoint state, unknown-outcome fail-closed and no-double-send tests/rollout gates. Runtime migration pending. |
| 2026-07-15 | v2.2 | **DD-39×DD-45 owner-alert projection:** consume `waitlist.charge_derivation_failed` into at most one tenant owner alert/digest with deterministic key; unresolved recipient→skipped/DLQ; no candidate/venue/PII delivery; promotion retry remains session-service owned. |
| 2026-06-18 | v1.0 | Initial BE tech spec (English format) |
| 2026-06-19 | v2.0 | Chuẩn hoá Vietnamese numbered (6 sections), full DDL, 12 BE edge cases, 20 tests |
| 2026-07-10 | v2.1 | **DD-40 ✅ + DD-37 ✅:** kênh nhắc = web push + Zalo DM chính, Messenger best-effort 24h; bỏ group-mention Telegram; ngưỡng mặc định 2h→24h; markPaid (thủ công tiền mặt/CK + auto) → xác nhận tự động (FR-6.2); `reminders_manual` mọi tier, `reminders_auto` = host_pro. Cập nhật dispatcher, edge #7, rollout. |
