# Feature: Notifications & Reminders — Backend Tech Spec

> **Canonical phase:** P3 / P4.5–P4.7  
> **Version:** 2.2 · 2026-07-15
> **Status:** Reviewed  
> **Product spec:** `../feature_notifications_reminders.md`  
> **References:** `../../standards/business-rules.md` BL-SEC-5 · `../../standards/decisions.md` DD-37/DD-40/DD-45 · `../../dd-45-waitlist-analysis.md`

> **Cập nhật v2.1 (DD-40 ✅ + DD-37 ✅, 2026-07-10):** kênh nhắc chính = **web push + Zalo DM**; **Messenger best-effort trong cửa sổ standard 24h**, ngoài cửa sổ chỉ khi có cơ chế Meta đủ điều kiện/được phê duyệt; **bỏ group-mention Telegram**. Ngưỡng nhắc mặc định **2h → 24h → …** (DD-40). Sau **mọi** điểm markPaid (thủ công tiền mặt/CK **và** auto CK) → **xác nhận tự động tới player** (FR-6.2). Nhắc thủ công (`reminders_manual`) = mọi tier; **nhắc tự động (`reminders_auto`) = `host_pro`**.

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
| 7 | Security | PII/amount in reminder template | Nhắc là **DM-only** (Zalo/Messenger web push) — không broadcast group; group-mention Telegram đã bỏ (DD-37). Template escaping + privacy policy check |
| 8 | Security | Manual override bypass cooldown | Owner role + reason + audit required |
| 9 | Resilience | Provider rate-limit (429) | Honor `retry-after`, update next_attempt_at |
| 10 | Resilience | Provider permanent failure | Mark unreachable — fallback to owner digest |
| 11 | Security | Cross-tenant reachability | ❌ NEVER — reachability scoped (person, tenant, platform) |
| 12 | Data Integrity | Left membership still eligible | Policy check: allow final notice or skip |
| 13 | Financial/Resilience | Duplicate waitlist derivation-failure event | `intent_key=waitlist-charge-derivation:{session}:{player}:{trigger}:{reason}`; at most one owner alert (unresolved recipient→skipped/DLQ); no player promotion/venue notification |

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
4. **Dispatcher** selects channel (DD-37): **web push + Zalo DM (primary)** → **Messenger DM best-effort trong cửa sổ 24h** → owner digest. *(Không còn group-mention Telegram; Messenger không gửi ngoài 24h.)* Chọn theo `channel_reachability` đúng (person, tenant, platform).
5. **Channel Adapter** sends outside TX, records delivery result
6. Retry: transient → backoff/jitter; rate-limit → honor retry-after; permanent → unreachable; Messenger ngoài 24h → skip (dồn web + Zalo)

### Waitlist derivation failure alert (DD-45)

1. Consume tenant-scoped outbox event `waitlist.charge_derivation_failed` emitted by the session transaction with opaque `session_id`, `player_id`, `trigger_command_id`, `reason_code`.
2. Load active owner/admin key from tenant-scoped `tenant_admins`, then resolve its exact `(platform,platform_user_lookup_hash)` → `person_id` through the identity service / narrow `SECURITY DEFINER` lookup (global-protected `channel_identities`, never a direct app-table join). Create `owner_alert` intent with deterministic key `waitlist-charge-derivation:{session}:{player}:{trigger}:{reason}`; duplicate event = no-op. Nếu không resolve được recipient, mark projector delivery skipped/DLQ reason `OWNER_RECIPIENT_UNRESOLVED`; outbox/audit vẫn durable và không ảnh hưởng domain retry.
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
| 20 | Tenant isolation | Tenant A notification | Not visible to tenant B |
| 21 | Waitlist derivation owner alert dedupe | Resolvable owner + same failure event twice | Exactly one `owner_alert` intent; no candidate delivery |
| 22 | Failure alert privacy | Event includes opaque ids + reason | No amount/gender/venue/PII in intent/template/log |
| 23 | Owner recipient unresolved | Admin key has no identity-service match | No intent; projector skipped/DLQ `OWNER_RECIPIENT_UNRESOLVED`; domain retry unaffected |

### Integration Tests

| # | Test | Setup | Expected |
|---|------|-------|----------|
| 1 | Scheduler → send → delivery | Create charges → run scheduler | Intents created, delivery attempted |
| 2 | Settled event → confirmation | Payment matched → outbox | Confirmation sent once |
| 3 | Reversal → correction | Reversal after settled | Correction sent |
| 4 | 1k tenant burst | 1000 tenants with due charges | Jitter prevents burst, all processed |
| 5 | Waitlist failure outbox → owner digest | Resolvable owner + duplicate derivation-failure event | One owner alert/digest; session retry handled separately from same event; candidate receives nothing |

---

## 6. Rollout Plan + Changelog

### Rollout

1. Shadow eligibility (log only, no sends)
2. Owner preview only
3. Manual send — web push + Zalo DM (`reminders_manual`, mọi tier)
4. Automatic scheduled send — 2h→24h thresholds (`reminders_auto`, `host_pro`)
5. Messenger DM best-effort trong cửa sổ 24h (P2.5)
6. Enable waitlist failure owner-alert projector after DD-45 session retry worker is wired

### Metrics

- Eligible/sent/skipped/failed counts
- Reminder-to-settlement conversion rate
- Queue lag / retry age
- Provider rate-limit frequency
- Opt-out/complaint count
- Waitlist derivation-failure alerts / dedupe conflicts / alert age

### Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-07-15 | v2.2 | **DD-39×DD-45 owner-alert projection:** consume `waitlist.charge_derivation_failed` into at most one tenant owner alert/digest with deterministic key; unresolved recipient→skipped/DLQ; no candidate/venue/PII delivery; promotion retry remains session-service owned. |
| 2026-06-18 | v1.0 | Initial BE tech spec (English format) |
| 2026-06-19 | v2.0 | Chuẩn hoá Vietnamese numbered (6 sections), full DDL, 12 BE edge cases, 20 tests |
| 2026-07-10 | v2.1 | **DD-40 ✅ + DD-37 ✅:** kênh nhắc = web push + Zalo DM chính, Messenger best-effort 24h; bỏ group-mention Telegram; ngưỡng mặc định 2h→24h; markPaid (thủ công tiền mặt/CK + auto) → xác nhận tự động (FR-6.2); `reminders_manual` mọi tier, `reminders_auto` = host_pro. Cập nhật dispatcher, edge #7, rollout. |
