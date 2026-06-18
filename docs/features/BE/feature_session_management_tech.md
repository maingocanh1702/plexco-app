# Feature: Session Management — Backend Tech Spec

> **Canonical phase:** P2/P4  
> **Version:** 2.0 · 2026-06-19  
> **Status:** Reviewed  
> **Product spec:** `../feature_session_management.md`  
> **References:** `../../core/TDD.md` §3.2/3.8 · `../../standards/business-rules.md`

---

## 1. Tổng quan triển khai

```text
Surface (TG/Web) → Command (CreateSession/Update/Close/Cancel)
    → SessionService → [State + Deduped Command + Outbox] COMMIT
                            ↓
                Projectors: TG roster edit, Web SSE, Public search
```

Commands: `CreateSession`, `UpdateSession`, `AnnounceSession`, `CloseSession`, `CancelSession`, `GenerateOccurrences`. Mỗi command mang `commandId`, tenant/actor từ trusted context, `expected_version` cho conflicting edits.

**Design decisions:**
- Single domain service shared by chat + web — no duplicate logic.
- Optimistic concurrency via `version` column — stale edits rejected.
- Outbox events carry identifiers + safe changed fields — projectors reload canonical data cho sensitive rendering.

---

## 2. Database Schema + Edge Cases (BE)

### Schema

```sql
CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  sport_id uuid NOT NULL REFERENCES sports(id),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  timezone text NOT NULL,  -- IANA timezone
  venue_name text,
  venue_address text,
  area text,  -- public whitelist (quận/khu vực)
  price_amount integer NOT NULL DEFAULT 0,
  slots_max integer,  -- NULL = unlimited
  visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'public')),
  join_policy text NOT NULL DEFAULT 'open' CHECK (join_policy IN ('open', 'approval')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'closed', 'cancelled')),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CHECK (slots_max IS NULL OR slots_max > 0)
);
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;

CREATE TABLE session_recurrence_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  rrule text NOT NULL,
  timezone text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  last_generated_at timestamptz
);

CREATE TABLE session_occurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recurrence_rule_id uuid NOT NULL REFERENCES session_recurrence_rules(id),
  session_id uuid NOT NULL REFERENCES sessions(id),
  local_occurrence_key text NOT NULL,
  UNIQUE (recurrence_rule_id, local_occurrence_key)
);

CREATE TABLE session_surface_refs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES sessions(id),
  platform text NOT NULL,
  target text NOT NULL,
  external_ref text,
  UNIQUE (session_id, platform, target)
);
```

### Indexes

```sql
CREATE INDEX idx_sessions_tenant_status ON sessions(tenant_id, status);
CREATE INDEX idx_sessions_starts_at ON sessions(starts_at) WHERE status = 'open';
CREATE INDEX idx_session_surface_refs_session ON session_surface_refs(session_id);
```

### Edge Cases (Backend)

| # | Category | Case | Xử lý |
|---|----------|------|-------|
| 1 | Concurrency | Capacity check + player insert race | Single transaction + `SELECT ... FOR UPDATE` on session row |
| 2 | Concurrency | Web + chat edit same session | Optimistic locking via `version` — stale version → `STALE_VERSION` error |
| 3 | Concurrency | Duplicate command (same commandId) | Command dedup table — return previous result |
| 4 | Data Integrity | Price change with existing charges | Service loads charges, requires explicit `impact_policy` parameter |
| 5 | Data Integrity | Cancel with paid roster | Load financial state, require `review_policy` — no silent cancellation |
| 6 | Data Integrity | Occurrence duplicate generation | `UNIQUE(recurrence_rule_id, local_occurrence_key)` prevents duplicates |
| 7 | Data Integrity | DST ambiguity in recurrence | Tested timezone library + documented ambiguity policy (prefer earlier/later) |
| 8 | Security | Public endpoint exposes venue/roster | ❌ NEVER — separate public serializer with whitelist |
| 9 | Resilience | Projector (TG edit) fails | Outbox retry — canonical state already committed |
| 10 | Security | Non-admin sends session command | AuthZ middleware rejects before service — 403 |
| 11 | Cross-Feature | Session mutation after status=closed | Service rejects — `SESSION_NOT_OPEN` |
| 12 | Data Integrity | Visibility=public without required fields | Validation rejects — `MISSING_DISCOVERY_FIELDS` |

---

## 3. API Contract

### Endpoints

| Method | Path | Auth | Mô tả |
|--------|------|------|-------|
| POST | /api/sessions | TenantAdmin | Tạo session |
| PUT | /api/sessions/:id | TenantAdmin | Sửa session |
| POST | /api/sessions/:id/announce | TenantAdmin | Announce lên group |
| POST | /api/sessions/:id/close | TenantAdmin | Đóng session |
| POST | /api/sessions/:id/cancel | TenantAdmin | Huỷ session |
| GET | /api/sessions | TenantAdmin | List sessions (tenant-scoped) |
| GET | /api/sessions/:id | TenantAdmin/Player | Detail (scoped by role) |

### Error Codes

| Code | Error Code | Message | Trigger |
|------|-----------|---------|---------|
| 400 | `INVALID_TIME_RANGE` | Giờ kết thúc phải sau giờ bắt đầu | `ends_at <= starts_at` |
| 400 | `SPORT_INACTIVE` | Môn thể thao không hoạt động | Sport not in active taxonomy |
| 409 | `CAPACITY_BELOW_ROSTER` | Số chỗ không thể thấp hơn số người đã đăng ký | Reduce `slots_max` below roster count |
| 409 | `SESSION_NOT_OPEN` | Buổi chơi không ở trạng thái mở | Mutation on closed/cancelled |
| 409 | `STALE_VERSION` | Dữ liệu đã thay đổi — tải lại | Optimistic lock conflict |
| 400 | `PRICE_CHANGE_REQUIRES_POLICY` | Cần chọn chính sách cho charges hiện tại | Price change with existing charges |
| 400 | `CANCEL_REQUIRES_REVIEW` | Cần xác nhận huỷ — có người đã thanh toán | Cancel with paid roster |
| 400 | `MISSING_DISCOVERY_FIELDS` | Thiếu thông tin bắt buộc cho buổi chơi public | Public visibility without required fields |

### Idempotency

| Endpoint | Idempotent? | Key |
|----------|-------------|-----|
| POST /sessions | ✅ | `commandId` |
| PUT /sessions/:id | ✅ | `commandId` |
| POST /sessions/:id/announce | ✅ | `commandId` |
| POST /sessions/:id/close | ✅ | Close already-closed = no-op |
| POST /sessions/:id/cancel | ✅ | Cancel already-cancelled = no-op |

---

## 4. Chi tiết triển khai

### Events

| Event | Trigger | Payload |
|-------|---------|---------|
| `session.created` | Create command | `session_id`, `tenant_id`, `visibility` |
| `session.updated` | Update command | `session_id`, `changed_fields[]` |
| `session.visibility_changed` | Public ↔ private | `session_id`, `new_visibility` |
| `session.closed` | Close command / auto | `session_id`, `close_reason` |
| `session.cancelled` | Cancel command | `session_id`, `roster_count`, `has_paid` |
| `session.announcement_requested` | Announce command | `session_id`, `channel` |

### Recurrence Implementation

- Store local wall-clock rule + IANA timezone.
- Calculate UTC occurrences with tested timezone library.
- DST ambiguity policy documented (prefer earlier).
- Generate within bounded horizon (configurable).
- Edit rule → create new version; past/generated occurrences NOT silently rewritten.

---

## 5. Testing Plan

### Unit Tests

| # | Test | Input | Expected |
|---|------|-------|----------|
| 1 | Create session valid | All required fields | Session created, event emitted |
| 2 | Create session invalid time | `ends_at <= starts_at` | `INVALID_TIME_RANGE` error |
| 3 | Create session inactive sport | Non-existent sport_id | `SPORT_INACTIVE` error |
| 4 | Update with stale version | Wrong `version` | `STALE_VERSION` error |
| 5 | Reduce capacity below roster | `slots_max < roster.count` | `CAPACITY_BELOW_ROSTER` error |
| 6 | Price change no policy | Price change + existing charges | `PRICE_CHANGE_REQUIRES_POLICY` |
| 7 | Cancel with paid roster no review | Paid players exist | `CANCEL_REQUIRES_REVIEW` |
| 8 | Close already-closed | Status=closed | No-op, success |
| 9 | Public without discovery fields | Missing required fields | `MISSING_DISCOVERY_FIELDS` |
| 10 | Private → public removes projection | Visibility change | Event emitted correctly |
| 11 | Concurrent join last slot | 2 concurrent transactions | One success, one "full" |
| 12 | Concurrent web/chat edit | Same session, different version | One success, one `STALE_VERSION` |
| 13 | Command dedup (same commandId) | Duplicate command | Return previous result |
| 14 | DST timezone boundary | Recurrence across DST | Correct UTC calculation |
| 15 | Recurrence idempotency | Generate twice | Same occurrences, no duplicates |
| 16 | Mutation on cancelled session | Any update | `SESSION_NOT_OPEN` |
| 17 | Non-admin create session | Player actor | 403 |
| 18 | Tenant isolation | Session from tenant A | Not visible to tenant B |
| 19 | Public serializer whitelist | Public endpoint | No venue/roster/financial data |
| 20 | Announcement retry | First attempt fails | Retry succeeds, no duplicate message |

### Integration Tests

| # | Test | Setup | Expected |
|---|------|-------|----------|
| 1 | Full CRUD lifecycle | Create → update → close | State transitions correct |
| 2 | Chat + web same service | TG create → web edit | Same session, consistent state |
| 3 | Recurrence generation | Create rule → generate | Occurrences match timezone |
| 4 | Outbox → projector delivery | Create session → check projector | Event delivered, projection updated |

---

## 6. Rollout Plan + Changelog

### Rollout

1. Migrate session fields/backfill timezone
2. Enable chat CRUD
3. Recurrence shadow generation
4. Web API parity
5. Projector parity (TG/public/web)

### Metrics

- Command latency/conflict rate
- Occurrence generation lag
- Projection lag/failure rate
- Capacity conflicts per session
- Cancel-with-payment count

### Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-06-18 | v1.0 | Initial BE tech spec (English format) |
| 2026-06-19 | v2.0 | Chuẩn hoá Vietnamese numbered (6 sections), thêm full DDL, 12 BE edge cases, error codes, idempotency table, 20 unit tests, 4 integration tests |
