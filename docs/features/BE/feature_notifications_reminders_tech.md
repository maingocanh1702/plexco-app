# Feature: Notifications & Reminders — Backend Tech Spec

> **Canonical phase:** P3 / P4.5–P4.7  
> **Version:** 2.0 · 2026-06-19  
> **Status:** Reviewed  
> **Product spec:** `../feature_notifications_reminders.md`  
> **References:** `../../standards/business-rules.md` BL-SEC-5

---

## 1. Tổng quan triển khai

```text
Scheduler (narrow-claim due tenants) → Tenant TX (select eligible charges)
    → Create Intents → Dispatcher (channel selection) → Channel Adapter → Send
                                                            ↓ fail?
                                              Retry (backoff/jitter) → DLQ

Ledger Outbox → settled/correction Intents (atomic/idempotent)
```

**Design decisions:**
- At-least-once delivery safe via intent/delivery UNIQUE keys + provider idempotency.
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
  type text NOT NULL,  -- 'reminder', 'settled', 'correction'
  aggregate_id uuid NOT NULL,
  state_version integer NOT NULL,
  person_id uuid NOT NULL REFERENCES persons(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'dispatched', 'skipped', 'expired')),
  intent_key text NOT NULL UNIQUE,  -- dedup key
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intent_id uuid NOT NULL REFERENCES notification_intents(id),
  platform text NOT NULL,
  target_ref text,  -- encrypted provider target
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  provider_code text,
  delivery_key text NOT NULL UNIQUE,  -- dedup per platform
  created_at timestamptz NOT NULL DEFAULT now()
);
```

All tables: `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY`.

### Edge Cases (Backend)

| # | Category | Case | Xử lý |
|---|----------|------|-------|
| 1 | Data Integrity | Duplicate intent (same charge + version) | UNIQUE `intent_key` — insert conflict = no-op |
| 2 | Data Integrity | Duplicate delivery (same intent + platform) | UNIQUE `delivery_key` — no double-send |
| 3 | Concurrency | Scheduler concurrent tenant claims | Narrow-claim with `FOR UPDATE SKIP LOCKED` |
| 4 | Concurrency | 1k tenant burst | Jitter + staggered scheduling |
| 5 | Data Integrity | Remind paid/void charge | Eligibility check: only open/partial status |
| 6 | Data Integrity | Reversal after settled confirmation | Create correction intent — different `intent_key` |
| 7 | Security | PII/amount in group template | Template escaping + group privacy policy check |
| 8 | Security | Manual override bypass cooldown | Owner role + reason + audit required |
| 9 | Resilience | Provider rate-limit (429) | Honor `retry-after`, update next_attempt_at |
| 10 | Resilience | Provider permanent failure | Mark unreachable — fallback to owner digest |
| 11 | Security | Cross-tenant reachability | ❌ NEVER — reachability scoped (person, tenant, platform) |
| 12 | Data Integrity | Left membership still eligible | Policy check: allow final notice or skip |

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

1. **Scheduler** narrow-claims due tenants (cron, `FOR UPDATE SKIP LOCKED`)
2. Per-tenant TX: select eligible charges (open/partial, not cooldown'd, not quiet hours)
3. Create `notification_intents` with UNIQUE key
4. **Dispatcher** selects channel: DM reachability → group mention fallback → owner digest
5. **Channel Adapter** sends outside TX, records delivery result
6. Retry: transient → backoff/jitter; rate-limit → honor retry-after; permanent → unreachable

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
| 20 | Tenant isolation | Tenant A notification | Not visible to tenant B |

### Integration Tests

| # | Test | Setup | Expected |
|---|------|-------|----------|
| 1 | Scheduler → send → delivery | Create charges → run scheduler | Intents created, delivery attempted |
| 2 | Settled event → confirmation | Payment matched → outbox | Confirmation sent once |
| 3 | Reversal → correction | Reversal after settled | Correction sent |
| 4 | 1k tenant burst | 1000 tenants with due charges | Jitter prevents burst, all processed |

---

## 6. Rollout Plan + Changelog

### Rollout

1. Shadow eligibility (log only, no sends)
2. Owner preview only
3. Manual TG send
4. Automatic TG send
5. Zalo delivery (P4.7)

### Metrics

- Eligible/sent/skipped/failed counts
- Reminder-to-settlement conversion rate
- Queue lag / retry age
- Provider rate-limit frequency
- Opt-out/complaint count

### Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-06-18 | v1.0 | Initial BE tech spec (English format) |
| 2026-06-19 | v2.0 | Chuẩn hoá Vietnamese numbered (6 sections), full DDL, 12 BE edge cases, 20 tests |
