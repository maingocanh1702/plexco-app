# Feature: Zalo Player Channel — Backend Tech Spec

> **Canonical phase:** P4.7  
> **Version:** 2.0 · 2026-06-19  
> **Status:** Reviewed  
> **Product spec:** `../feature_zalo_channel.md`

---

## 1. Tổng quan triển khai

```text
Webhook (opaque token → bot/tenant) → Verify provider secret
    → Normalize stable event/user IDs → Update dedup
    → Identity/Domain Service (shared) → Outbox → Delivery
```

Bot-per-club model: webhook path token determines tenant. Provider payload is NOT tenant authority beyond bound endpoint/bot.

---

## 2. Database Schema + Edge Cases (BE)

### Schema

```sql
CREATE TABLE zalo_bots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) UNIQUE,
  bot_token_enc text NOT NULL,
  webhook_token text NOT NULL,
  secret text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'drift')),
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE zalo_reply_contexts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES persons(id),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  bot_id uuid NOT NULL REFERENCES zalo_bots(id),
  context_type text NOT NULL DEFAULT 'session_list',
  item_ids jsonb NOT NULL,  -- ordered session IDs
  version integer NOT NULL DEFAULT 1,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE zalo_reply_contexts ENABLE ROW LEVEL SECURITY;
ALTER TABLE zalo_reply_contexts FORCE ROW LEVEL SECURITY;
```

### Edge Cases (Backend)

| # | Category | Case | Xử lý |
|---|----------|------|-------|
| 1 | Security | Tenant from message content | ❌ NEVER — webhook token/bot binding only |
| 2 | Data Integrity | Stale number (list expired/changed) | Reject — "Danh sách đã thay đổi" |
| 3 | Data Integrity | Number out of range | "Số không hợp lệ" |
| 4 | Security | Forged/unknown webhook | Reject — verify provider secret |
| 5 | Concurrency | Replayed event | Update dedup — idempotent |
| 6 | Concurrency | Concurrent number replies last slot | Lock session — first-commit-wins |
| 7 | Security | Bot token in logs | ❌ NEVER — KMS encrypted, log redaction |
| 8 | Data Integrity | Webhook drift (URL changed) | Hourly `getWebhookInfo` — alert on drift |
| 9 | Security | DM reachability cross-club | Scoped per tenant bot — independent |
| 10 | Resilience | Provider rate-limit/outage | Degrade — no canonical corruption |
| 11 | Security | Free numeric message without context | NEVER execute join — require active context |
| 12 | Data Integrity | Token rotation overlap | Support overlap period before revoke |

---

## 3. API Contract

### Zalo Adapter Commands

| Command | Auth | Mô tả |
|---------|------|-------|
| `/join` | Player DM | List open sessions |
| Number reply | Player DM | Join selected session |
| `/me` | Player DM | Personal summary |
| `/pay` | Player DM | Payment instructions |
| `/leave` | Player DM | Leave session |

### Error Responses (Zalo DM)

| Situation | Response |
|-----------|----------|
| Stale list | "Danh sách đã thay đổi, gõ /join để xem lại" |
| Invalid number | "Số không hợp lệ — chọn từ 1 đến N" |
| Full | "Hết chỗ" |
| Unsupported | "Lệnh không được hỗ trợ" |

---

## 4. Chi tiết triển khai

### Number-reply Context

```text
/join → Create ordered list (session IDs + version + TTL)
Player replies "2" → Lock context → Validate:
  - Same person? Same bot/tenant? Version match? Not expired?
  → YES: Consume context → resolve session → domain join service
  → NO: Reject with appropriate message
```

### Token Operations

- Envelope encrypt bot token (KMS).
- UI: masked display only.
- Rotation: overlap period → switch → revoke old.
- Drift monitor: hourly `getWebhookInfo` compare expected URL.
- Kill switch: privileged, owner-authenticated, audited.

---

## 5. Testing Plan

### Unit Tests

| # | Test | Input | Expected |
|---|------|-------|----------|
| 1 | Webhook routes correct tenant | Valid webhook token | Correct tenant |
| 2 | Forged webhook rejected | Unknown token | Rejected |
| 3 | /join lists sessions | Open sessions exist | Numbered list |
| 4 | Valid number reply | "2" with active context | Joined session 2 |
| 5 | Stale number reply | Expired context | "Danh sách đã thay đổi" |
| 6 | Wrong person reply | Different person | Rejected |
| 7 | Wrong bot reply | Different bot/tenant | Rejected |
| 8 | Number out of range | "99" | "Số không hợp lệ" |
| 9 | Free numeric no context | "3" without /join | No action |
| 10 | Concurrent final slot | 2 replies same slot | One success |
| 11 | Event replay | Same event ID | Idempotent |
| 12 | Reachability set | First interaction | Reachable |
| 13 | Reachability isolated | Club A vs B | Independent |
| 14 | Blocked user | Bot blocked | Not reachable |
| 15 | Token decrypt | Encrypted token | Correct decryption |
| 16 | Token rotation | New token | Old revoked after overlap |
| 17 | Drift detected | URL mismatch | Alert triggered |
| 18 | Unsupported message | Image/sticker | Safe fallback |
| 19 | Rate limit | Excessive requests | Throttled |
| 20 | Canonical independence | Provider error | State intact |

### Integration Tests

| # | Test | Setup | Expected |
|---|------|-------|----------|
| 1 | /join → reply → joined | Full flow | Joined + venue revealed |
| 2 | Two bots isolated | 2 tenants, 2 bots | Independent routing |
| 3 | Token rotation E2E | Rotate → verify | No downtime |
| 4 | Drift detection | Change URL → wait | Alert within 1h |

---

## 6. Rollout Plan + Changelog

### Rollout

1. Sandbox bot testing
2. Tenant #1 optional connection
3. Join-only commands
4. Reminders/confirmations
5. Beta clubs

### Metrics

- Webhook validity / lag
- Reply-context expiry rate
- Join result distribution
- Outbound failure / rate-limit
- Drift detections / token rotations

### Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-06-18 | v1.0 | Initial BE tech spec (English format) |
| 2026-06-19 | v2.0 | Chuẩn hoá Vietnamese numbered (6 sections), DDL, 12 edge cases, reply context detail, 20 tests |
