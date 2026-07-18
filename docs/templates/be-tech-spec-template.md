# Feature: {Tên tính năng} — Backend Tech Spec

> **Canonical phase:** Px  
> **Version:** x.y · YYYY-MM-DD  
> **Status:** Draft | Reviewed | Approved *(Reviewed của Plexco ≡ Approved trong `feature-docs-playbook.md`)*  
> **Implementation:** Not started | In progress | Implemented | Verified — đồng bộ `../standards/BUILD-STATUS.md`; từ Implemented trở lên ghi kèm code ref + test evidence  
> **Product spec:** `../feature_{name}.md`  
> **References:** `../../product/TDD.md` §x · `../standards/business-rules.md` BL-xxx

---

## 1. Tổng quan triển khai

{Component diagram / pipeline overview. Mô tả flow dữ liệu.}

```text
{Input} → {Process} → {Output} → {Side effects}
```

{Design decisions quan trọng.}

> **Gate 3 chiều (trước khi Reviewed):** mọi claim kỹ thuật (độ dài mã, collision probability, TTL, limit…) phải khớp cả ba: (a) bảng/claim trong spec ↔ (b) code snippet trong spec ↔ (c) live code/schema trên `main`. Sửa 1 trong 3 → re-check 2 cái còn lại.

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

### Migration & Rollback

- **Migration:** `packages/db/migrations/{NNNN}_{name}.sql` — **monotonic, file mới** (không sửa migration đã apply); chứa ENABLE + FORCE RLS, policies, grants theo grant matrix. **Đối chiếu live schema/migrations trước khi viết** — bảng có thể đã tồn tại từ migration cũ (baseline = reuse/đọc, không recreate; bài học `join_requests` đã có từ `0006`).
- **Rollback:**

| Bước | Hành động | An toàn? |
|------|-----------|----------|
| 1 | {Disable routes/cron liên quan} | {✅/⚠️} |
| 2 | {DROP TABLE / revert cột trong migration revert mới} | {✅ pre-GA / ⚠️ mất dữ liệu gì} |

### Edge Cases (Backend)

| # | Category | Case | Xử lý |
|---|----------|------|-------|
| 1 | Concurrency | {Case} | {Solution — transaction, locking, idempotent...} |

> Minimum 12 edge cases, 4+ categories: Concurrency, Security, Data Integrity, Cross-Feature, Infra (provider/webhook/queue).

---

## 3. API Contract

### Endpoints

| Method | Path | Auth | Mô tả |
|--------|------|------|-------|
| POST | /api/{resource} | TenantAdmin | {Description} |

### Request/Response Examples

> Success DTO minh hoạ shape theo contract; field name cụ thể chốt ở build slice trừ khi spec/invariant đã pin. Envelope chuẩn theo **DD-60** (`../standards/api-reference-convention.md` §1.1, khớp live `apps/web/lib/api-envelope.ts`).

**POST `/api/{resource}`** — `200`:

```json
{ "data": { "status": "..." }, "error": null, "meta": { "requestId": "req_..." } }
```

— `4xx`:

```json
{ "data": null, "error": { "code": "{ERROR_CODE}", "message": "{Message tiếng Việt}", "statusCode": 400 }, "meta": { "requestId": "req_..." } }
```

### Rate Limits

> Xem `../standards/business-rules.md` BL-SEC-5 Rate Limit Registry.

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

### Security Checklist

> Đối chiếu `../features/BE/auth-security-invariant-table.md` + AUDIT. Spec phải trả lời tối thiểu:

| Mục | Trả lời trong spec |
|-----|---------------------|
| Authorization/ownership per-resource | {ai đọc/sửa được row nào — RLS + service check} |
| Injection/validation | {input validate/sanitize, param binding} |
| Secret & log redaction | {secret nào đi qua flow; log gì bị cấm} |
| Webhook signature + replay window | {HMAC raw-body, timestamp ±s} (nếu có webhook) |
| Idempotency | {ref §3 Idempotency} |
| Data retention/xoá | {row nào xoá được, giữ bao lâu, ai xoá} |

---

## 5. Testing Plan

### Unit Tests

| # | Test | Input | Expected |
|---|------|-------|----------|
| 1 | {Test name} | {Input} | {Expected output} |

> Minimum 20 unit tests: happy path, validation errors, edge cases, rate limits, idempotent ops — **floor, không phải target**. High-risk (money/auth/PII): decision-table coverage + abuse/concurrency cases bắt buộc.

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
