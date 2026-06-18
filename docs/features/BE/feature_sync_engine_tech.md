# Feature: Sync Engine & Re-projection — Backend Tech Spec

> **Canonical phase:** P4  
> **Version:** 2.0 · 2026-06-19  
> **Status:** Reviewed  
> **Product spec:** `../feature_sync_engine.md`  
> **References:** `../../core/TDD.md` §3.8

---

## 1. Tổng quan triển khai

```text
Surface → Command(id, tenant, actor, version)
  → Validate → Insert/check processed_commands → Lock aggregate
    → Domain mutation → Append monotonic event → Store result → COMMIT

Worker (FOR UPDATE SKIP LOCKED) → Claim events by aggregate order
  → Create projector_deliveries → Projector lease → Reload canonical
    → External call → Mark delivered | Retry | DLQ
```

**Design decisions:**
- Duplicate command → return stored result without re-running mutation.
- Event schemas versioned — avoid secrets/PII in payload.
- Crash after provider success handled via provider idempotency or convergent edit/upsert.
- Worker partitions by aggregate ordering key (not tenant-wide).

---

## 2. Database Schema + Edge Cases (BE)

### Schema

```sql
CREATE TABLE processed_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  command_id text NOT NULL,
  command_type text NOT NULL,
  result_hash text,
  result_ref jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, command_id)
);

CREATE TABLE outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  sequence integer NOT NULL,
  type text NOT NULL,
  schema_version integer NOT NULL DEFAULT 1,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz
);

CREATE TABLE projector_deliveries (
  event_id uuid NOT NULL REFERENCES outbox_events(id),
  projector text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed', 'dlq')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  delivered_at timestamptz,
  provider_ref text,
  error_code text,
  PRIMARY KEY (event_id, projector)
);

CREATE TABLE surface_refs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_id uuid NOT NULL,
  platform text NOT NULL,
  target text NOT NULL,
  external_ref text,
  UNIQUE (aggregate_id, platform, target)
);
```

Business tables: `ENABLE + FORCE ROW LEVEL SECURITY`. Worker claims through narrow function.

### Indexes

```sql
CREATE INDEX idx_outbox_unclaimed ON outbox_events(aggregate_id, sequence) WHERE claimed_at IS NULL;
CREATE INDEX idx_projector_pending ON projector_deliveries(next_attempt_at) WHERE status = 'pending';
CREATE INDEX idx_surface_refs_aggregate ON surface_refs(aggregate_id);
```

### Edge Cases (Backend)

| # | Category | Case | Xử lý |
|---|----------|------|-------|
| 1 | Concurrency | Duplicate command (same command_id) | UNIQUE constraint → return stored result |
| 2 | Data Integrity | Mutation rollback | No outbox event — atomic commit ensures consistency |
| 3 | Concurrency | Parallel workers claim same event | `FOR UPDATE SKIP LOCKED` partitioning |
| 4 | Concurrency | Aggregate ordering regression | Monotonic sequence enforced per aggregate |
| 5 | Resilience | Crash before provider call | Retry claims event — delivery pending |
| 6 | Resilience | Crash after provider success | Provider idempotency or convergent upsert |
| 7 | Resilience | Projector A fails, B succeeds | Independent tracking — B delivered, A retries |
| 8 | Data Integrity | TG message missing/deleted | Surface ref lookup fails → replacement + ref update |
| 9 | Security | Public projector emits private data | Strict whitelist — delete private/closed/expired |
| 10 | Security | Reproject replays notifications | ❌ BLOCK — no re-send unless projector supports correction mode |
| 11 | Security | Realtime topic guessing | AuthZ per subscription — reject unauthorized |
| 12 | Resilience | DLQ overflow | Alert threshold → operator review — bounded retry |

---

## 3. API Contract

### Endpoints

| Method | Path | Auth | Mô tả |
|--------|------|------|-------|
| POST | /api/reproject | PlatformAdmin | Trigger reproject |
| GET | /api/sync/status | TenantAdmin | Sync lag/health |
| GET | /api/realtime/subscribe | Authenticated | SSE/WS subscription |

### Realtime Authorization

```text
Topic: tenant:<id> → requires TenantAdmin role
Topic: person:<id> → requires authenticated person match
```

Short session-bound connection, heartbeat, reconnect cursor, per-account connection limits, fallback refetch.

### Error Codes

| Code | Error Code | Message | Trigger |
|------|-----------|---------|---------|
| 409 | `STALE_COMMAND` | Command đã xử lý | Duplicate command_id |
| 403 | `REPROJECT_UNAUTHORIZED` | Không có quyền reproject | Non-operator |
| 429 | `REPROJECT_THROTTLED` | Đang xử lý reproject khác | Rate-limited |

---

## 4. Chi tiết triển khai

### Projector Registry

| Projector | Surface | Behavior |
|-----------|---------|----------|
| `tg_announcement` | Telegram group | Edit/send message, update surface_ref |
| `tg_roster` | Telegram group | Edit inline roster display |
| `zalo_dm` | Zalo DM | Send/update DM |
| `web_realtime` | Web SSE/WS | Push invalidation event |
| `public_sessions` | Public search | Upsert/delete projection |
| `messenger` | Messenger (P4.8) | Registered, not active |

### SLO Targets

| Metric | Target |
|--------|--------|
| Sync lag p95 | ≤ 3s |
| Sync lag p99 | ≤ 10s |
| Payment reconcile p99 | ≤ 5s |
| DLQ size | Alert at > 100 |

---

## 5. Testing Plan

### Unit Tests

| # | Test | Input | Expected |
|---|------|-------|----------|
| 1 | Command dedup | Duplicate command_id | Return stored result |
| 2 | Command concurrent | Same command_id parallel | One wins, one dedup |
| 3 | Atomic commit | Mutation + event | Both committed or neither |
| 4 | Rollback no event | Mutation fails | No outbox event |
| 5 | Aggregate ordering | Events out of order | Monotonic sequence enforced |
| 6 | Worker claim skip locked | Parallel workers | No duplicate claims |
| 7 | Projector A fail B success | Mixed results | Independent tracking |
| 8 | TG missing message | Deleted message ref | Replacement created |
| 9 | Public whitelist | Private session event | Not projected |
| 10 | Public deletion | Session closed event | Projection deleted |
| 11 | Reproject no notifications | Reproject command | No notification re-send |
| 12 | Realtime auth valid | Correct topic/person | Subscribed |
| 13 | Realtime auth invalid | Wrong topic | Rejected |
| 14 | Realtime disconnect | Connection drop | Reconnect + refetch |
| 15 | Crash recovery before send | Worker crash pre-send | Event reclaimed |
| 16 | Crash recovery after send | Worker crash post-send | Convergent (no duplicate) |
| 17 | DLQ threshold | Max retries exhausted | Moved to DLQ + alert |
| 18 | Event schema version | V1 vs V2 payload | Correct deserialization |
| 19 | Reproject audit | Reproject triggered | Audit entry created |
| 20 | Tenant isolation | Events from tenant A | Not visible to tenant B |

### Integration Tests

| # | Test | Setup | Expected |
|---|------|-------|----------|
| 1 | Command → outbox → projector | Create session | All projectors receive event |
| 2 | Reproject repair | Delete TG message → reproject | Message recreated |
| 3 | Realtime end-to-end | Subscribe → trigger event | Client receives update |
| 4 | Load test 1k tenants | Parallel commands | SLO met, no data corruption |

---

## 6. Rollout Plan + Changelog

### Rollout

1. Deploy command/outbox schema
2. Shadow dispatcher (log events, no delivery)
3. Enable TG projector
4. Enable web realtime
5. Enable public projector
6. Monitor SLO targets

### Metrics

- Outbox age / delivery lag per projector
- DLQ size / aggregate ordering stalls
- Realtime connections / disconnects
- Reproject count / audit trail
- SLO breach alerts (p95/p99)

### Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-06-18 | v1.0 | Initial BE tech spec (English format) |
| 2026-06-19 | v2.0 | Chuẩn hoá Vietnamese numbered (6 sections), full DDL, 12 BE edge cases, projector registry, SLO targets, 20 tests |
