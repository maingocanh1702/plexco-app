# Feature: {Tên tính năng} — Backend Tech Spec

> **Canonical phase:** Px  
> **Version:** x.y · YYYY-MM-DD  
> **Status:** Draft | Reviewed | Approved  
> **Product spec:** `../feature_{name}.md`  
> **References:** `../../core/TDD.md` §x · `../../standards/business-rules.md` BL-xxx

---

## 1. Tổng quan triển khai

{Component diagram / pipeline overview. Mô tả flow dữ liệu.}

```text
{Input} → {Process} → {Output} → {Side effects}
```

{Design decisions quan trọng.}

---

## 2. Database Schema + Edge Cases (BE)

### Schema

```sql
CREATE TABLE {table_name} (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  -- ...
  UNIQUE ({unique_constraint})
);
```

> All tables tenant-scoped + ENABLE + FORCE RLS using `app.tenant_id`.

### Indexes

{Recommended indexes.}

### Edge Cases (Backend)

| # | Category | Case | Xử lý |
|---|----------|------|-------|
| 1 | Concurrency | {Case} | {Solution — transaction, locking, idempotent...} |

> Minimum 12 edge cases, 4+ categories: Concurrency, Security, Data Integrity, Cross-Feature.

---

## 3. API Contract

### Endpoints

| Method | Path | Auth | Mô tả |
|--------|------|------|-------|
| POST | /api/{resource} | TenantAdmin | {Description} |

### Rate Limits

> Xem `../../standards/business-rules.md` BL-SEC-5 Rate Limit Registry.

| Endpoint | Limit |
|----------|-------|
| {endpoint} | {limit} per {scope} |

### Error Codes

| Code | Error Code | Message | Trigger |
|------|-----------|---------|---------|
| 400 | `{ERROR_CODE}` | {Message tiếng Việt} | {When} |

### Idempotency

| Endpoint | Idempotent? | Key |
|----------|-------------|-----|
| {endpoint} | ✅/❌ | `{key}` |

---

## 4. Chi tiết triển khai

### State Machine (nếu có)

{Ref product spec §4 state machine. Implementation details.}

### Scenarios by Status (nếu có)

| # | Scenario | Actor | Trigger | Kết quả |
|---|----------|-------|---------|---------|
| {ST}-1 | {Scenario} | {Actor} | {Trigger} | {Result} |

### Timeout/Expiry Spec (nếu có)

| Variant | Giá trị | Lý do |
|---------|---------|-------|
| {variant} | {value} | {reason} |

### Caching Strategy

| Data | Cache? | TTL | Invalidation |
|------|--------|-----|-------------|
| {data} | ✅/❌ | {ttl} | {strategy} |

---

## 5. Testing Plan

### Unit Tests

| # | Test | Input | Expected |
|---|------|-------|----------|
| 1 | {Test name} | {Input} | {Expected output} |

> Minimum 20 unit tests: happy path, validation errors, edge cases, rate limits, idempotent ops.

### Integration Tests

| # | Test | Setup | Expected |
|---|------|-------|----------|
| 1 | {Test name} | {Setup} | {Expected} |

> Minimum 4 integration tests cho multi-step flows.

---

## 6. Rollout Plan + Changelog

### Rollout

1. {Step 1}
2. {Step 2}

### Metrics

{Key metrics to monitor.}

### Changelog

| Date | Version | Thay đổi |
|---|---|---|
| YYYY-MM-DD | vx.y | {What changed} |
