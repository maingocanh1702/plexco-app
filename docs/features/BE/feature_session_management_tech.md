# Feature: Session Management — Backend Tech Spec

> **Canonical phase:** P2/P4  
> **Version:** 2.4 · 2026-07-15
> **Status:** Reviewed  
> **Product spec:** `../feature_session_management.md`  
> **References:** `../../product/TDD.md` §3.2/3.8 · `../../standards/business-rules.md` · `../../standards/decisions.md` DD-39/DD-45 · `../../dd-45-waitlist-analysis.md` · `feature_user_settings_tech.md` (`deriveChargeAmount`)

> **DD-45 ✅ waitlist contract:** open/approval full→`waitlisted` không chiếm capacity/charge/venue; promotion assert no existing charge + derive amount trước mutation, rồi tạo đúng một charge atomic, clear position và fill đủ slot trống theo total order. DD-39 derivation fail giữ candidate waitlisted/no-charge/no-venue, audit+retry/owner-alert, không rollback opener và tiếp tục candidate kế. Existing `left` self-rejoin fail-closed `REJOIN_REQUIRES_REVIEW`. Schema dưới đây là contract đã pin nhưng migration/code vẫn pending build.

---

## 1. Tổng quan triển khai

```text
Surface (Zalo/Messenger/Web) → Command (CreateSession/Update/Close/Cancel)
    → SessionService → [State + Deduped Command + Outbox] COMMIT
                            ↓
                Projectors: Zalo/Messenger message, Web SSE, Public search
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
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  session_id uuid NOT NULL REFERENCES sessions(id),
  platform text NOT NULL,
  target text NOT NULL,
  external_ref text,
  UNIQUE (session_id, platform, target)
);

CREATE TABLE players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  session_id uuid NOT NULL REFERENCES sessions(id),
  membership_id uuid NOT NULL REFERENCES memberships(id),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'left', 'waitlisted')),
  waitlist_position integer,
  joined_at timestamptz NOT NULL DEFAULT now(),
  last_reminded_at timestamptz,
  CHECK ((status = 'waitlisted') = (waitlist_position IS NOT NULL)),
  CHECK (waitlist_position IS NULL OR waitlist_position > 0),
  UNIQUE (tenant_id, session_id, membership_id)
);
```

### Indexes

```sql
CREATE INDEX idx_sessions_tenant_status ON sessions(tenant_id, status);
CREATE INDEX idx_sessions_starts_at ON sessions(starts_at) WHERE status = 'open';
CREATE INDEX idx_session_surface_refs_session ON session_surface_refs(session_id);
CREATE INDEX idx_players_waitlist_order
  ON players(session_id, status, waitlist_position, joined_at, id);
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
| 9 | Resilience | Projector (Zalo/Messenger/web) fails | Outbox retry — canonical state already committed |
| 10 | Security | Non-admin sends session command | AuthZ middleware rejects before service — 403 |
| 11 | Cross-Feature | Session mutation after status=closed | Service rejects — `SESSION_NOT_OPEN` |
| 12 | Data Integrity | Visibility=public without required fields | Validation rejects — `MISSING_DISCOVERY_FIELDS` |
| 13 | Data Integrity | `waitlisted` thiếu/position ≤0 hoặc active/left còn position | DB state-shape/positive CHECK reject |
| 14 | Concurrency | Leave/capacity+ chạy đồng thời join | Lock session trước; re-count active; không over-fill/double-charge |
| 15 | Boundary | Capacity tăng hoặc finite→unlimited | Re-count active; fill `new_slots_max-active_count` hoặc mọi candidate eligible trong cùng locked transition |
| 16 | Boundary | Capacity giảm dưới active roster | Reject `CAPACITY_BELOW_ROSTER`; không evict/không mutation |
| 17 | Financial | Existing player `status='left'` join lại | Reject `REJOIN_REQUIRES_REVIEW`; không đổi player/charge/allocation history |
| 18 | Financial | Waitlisted candidate có existing charge (invalid/legacy) | Không promote/không mutate charge; audit `WAITLIST_CHARGE_CONFLICT`, owner-review, tiếp tục candidate kế |
| 19 | Financial/Resilience | `deriveChargeAmount` KMS/decrypt/price failure lúc promote | Candidate giữ `waitlisted`, no charge/venue; audit `WAITLIST_CHARGE_DERIVATION_FAILED` + one canonical failure outbox event cho retry/alert consumers; leave/capacity opener commit; continue next; không fallback price |

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
| 409 | `CAPACITY_BELOW_ROSTER` | Số chỗ không thể thấp hơn active roster | Reduce `slots_max` below `active_count` |
| 409 | `SESSION_NOT_OPEN` | Buổi chơi không ở trạng thái mở | Mutation on closed/cancelled |
| 409 | `STALE_VERSION` | Dữ liệu đã thay đổi — tải lại | Optimistic lock conflict |
| 400 | `PRICE_CHANGE_REQUIRES_POLICY` | Cần chọn chính sách cho charges hiện tại | Price change with existing charges |
| 400 | `CANCEL_REQUIRES_REVIEW` | Cần xác nhận huỷ — có người đã thanh toán | Cancel with paid roster |
| 400 | `MISSING_DISCOVERY_FIELDS` | Thiếu thông tin bắt buộc cho buổi chơi public | Public visibility without required fields |
| 409 | `REJOIN_REQUIRES_REVIEW` | Cần host kiểm tra lần tham gia trước | Existing player row có `status='left'` |

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
| `player.waitlisted` | Join khi full | `session_id`, `player_id`, `waitlist_position` |
| `player.promoted` | Leave/capacity+ mở slot | `session_id`, `player_id`, `charge_id` |

### Waitlist entry + rejoin guard (DD-45)

1. Lock session row `FOR UPDATE`; resolve membership, rồi lookup player theo UNIQUE `(tenant_id,session_id,membership_id)` trước mọi player/charge write.
2. Không có player row: còn slot/unlimited → derive amount trước mutation; success thì insert `active` + đúng một charge atomically; DD-39 derivation failure aborts join fail-closed (không player/charge/venue, không fallback). Full → insert `waitlisted` + tail position, không charge/venue.
3. Existing `active` hoặc `waitlisted`: return current outcome idempotently; không đổi position và không tạo charge.
4. Existing `left`: return `REJOIN_REQUIRES_REVIEW`; không update player, không create/reopen/void charge, không ghi allocation. Host correction là flow riêng có preview+confirm+audit sau khi refund/void policy được chốt.

### Waitlist promotion (DD-45)

1. Lock session row `FOR UPDATE`; reject closed/cancelled and capacity decrease below active count.
2. Compute free slots from `status='active'` only. `slots_max IS NULL` means unbounded fill.
3. Select candidates `status='waitlisted' ORDER BY waitlist_position, joined_at, id FOR UPDATE`.
4. Re-check DD-41 eligibility + DD-42 ban, assert candidate không có charge, rồi gọi `deriveChargeAmount` **trước mọi player/charge mutation**. Ineligible/ban stays waitlisted. Existing charge → stay waitlisted, audit `WAITLIST_CHARGE_CONFLICT` + owner-review; continue to the next.
5. Nếu DD-39 derivation fail (`gender_enc != NULL` + KMS/decrypt/price error): catch fail-closed; candidate giữ nguyên `waitlisted` + position, no charge/venue; ghi audit `WAITLIST_CHARGE_DERIVATION_FAILED` + đúng một outbox event `waitlist.charge_derivation_failed` với idempotency key `(session_id,player_id,trigger_command_id,reason)`. Session retry worker và owner-alert projector consume cùng event; leave/capacity opener vẫn commit; continue next candidate. **Không fallback `price_amount`.** Retry re-lock/re-count capacity; full thì no-op, candidate giữ rank.
6. Với candidate derive thành công: create exactly one charge + set `status='active'` + clear `waitlist_position` + write notify/outbox atomically trong cùng transaction.
7. Stop when capacity is full or no eligible candidate remains. Trigger command + retry key không cho double-promote/double-charge.

Queue entry assigns `max(waitlist_position)+1` under the same session lock. DD-42 deprioritize moves a candidate to the tail with the same rule; positions need not be contiguous because `joined_at,id` complete the total order.

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
| 5 | Reduce capacity below active roster | `slots_max < active_count` | `CAPACITY_BELOW_ROSTER` error |
| 6 | Price change no policy | Price change + existing charges | `PRICE_CHANGE_REQUIRES_POLICY` |
| 7 | Cancel with paid roster no review | Paid players exist | `CANCEL_REQUIRES_REVIEW` |
| 8 | Close already-closed | Status=closed | No-op, success |
| 9 | Public without discovery fields | Missing required fields | `MISSING_DISCOVERY_FIELDS` |
| 10 | Private → public removes projection | Visibility change | Event emitted correctly |
| 11 | Concurrent join last slot | 2 concurrent transactions | One active; one `waitlisted` with positive position and no charge |
| 12 | Concurrent web/chat edit | Same session, different version | One success, one `STALE_VERSION` |
| 13 | Command dedup (same commandId) | Duplicate command | Return previous result |
| 14 | DST timezone boundary | Recurrence across DST | Correct UTC calculation |
| 15 | Recurrence idempotency | Generate twice | Same occurrences, no duplicates |
| 16 | Mutation on cancelled session | Any update | `SESSION_NOT_OPEN` |
| 17 | Non-admin create session | Player actor | 403 |
| 18 | Tenant isolation | Session from tenant A | Not visible to tenant B |
| 19 | Public serializer whitelist | Public endpoint | No venue/roster/financial data |
| 20 | Announcement retry | First attempt fails | Retry succeeds, no duplicate message |
| 21 | Join full | Session full | `waitlisted`, position dương, no charge/venue/capacity |
| 22 | Leave opens slot | One eligible candidate | Promote + clear position + one charge atomically |
| 23 | Capacity tăng lên 12, active=7 | Sáu eligible candidates | Promote exactly 5 in total order (`12-7`) |
| 24 | Capacity finite→NULL | Eligible + banned candidates | Promote all eligible; banned stay waitlisted |
| 25 | Capacity below active | `slots_max < active_count` | `CAPACITY_BELOW_ROSTER`, no mutation |
| 26 | Candidate ineligible | First in queue fails DD-41 | Skip first, promote next, first keeps position |
| 27 | Promotion retry | Same commandId twice | Same result; no double charge/promotion |
| 28 | Rejoin after left | Existing player `left` + any charge state | `REJOIN_REQUIRES_REVIEW`; player/charge/allocations byte-for-byte unchanged |
| 29 | Promotion charge conflict | Waitlisted candidate already has charge | Candidate not promoted; audit+owner-review; next eligible candidate may fill slot |
| 30 | Promotion amount derivation fails | `gender_enc != NULL`; KMS/decrypt throws | Candidate byte-for-byte waitlisted, no charge/venue; one audit + one canonical failure outbox event; opener committed; retry/alert consume event; next candidate may fill slot; no fallback price |
| 31 | Derivation retry after another candidate filled slot | Same retry key; capacity now full | No-op; no promotion/charge; failed candidate keeps queue rank |
| 32 | Direct active join amount derivation fails | Capacity available; KMS/decrypt throws | Join aborts; no player/charge/venue; no fallback; retry safe |

### Integration Tests

| # | Test | Setup | Expected |
|---|------|-------|----------|
| 1 | Full CRUD lifecycle | Create → update → close | State transitions correct |
| 2 | Chat + web same service | Zalo/Messenger create → web edit | Same session, consistent state |
| 3 | Recurrence generation | Create rule → generate | Occurrences match timezone |
| 4 | Outbox → projector delivery | Create session → check projector | Event delivered, projection updated |
| 5 | Concurrent leave + join last slot | Two transactions | Lock order preserves capacity; one canonical outcome, no double charge |
| 6 | Leave + first waitlisted candidate KMS failure | One leave, two waitlisted candidates | Leave commits; first unchanged + one retry/audit; second may promote with one charge; no venue/charge for first |

---

## 6. Rollout Plan + Changelog

### Rollout

1. Migrate session fields/backfill timezone
2. Expand `players` with waitlist status/position CHECK/index; keep code dark until backfill/verification passes
3. Enable atomic waitlist entry/promotion + charge/notify path
4. Enable chat CRUD
5. Recurrence shadow generation
6. Web API parity
7. Projector parity (Zalo/Messenger/public/web; capacity counts active only)

### Metrics

- Command latency/conflict rate
- Occurrence generation lag
- Projection lag/failure rate
- Capacity conflicts per session
- Waitlist depth / promotion latency / promotion skip reason
- Cancel-with-payment count

### Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-07-15 | v2.4 | **DD-39×DD-45 fail-closed propagation:** derive charge amount before promotion mutation; KMS/decrypt/price failure keeps candidate waitlisted/no-charge/no-venue, writes idempotent audit+retry/owner-alert, does not rollback leave/capacity opener, then continues the queue; add retry no-op tests. |
| 2026-07-15 | v2.3 | **DD-45 money closure:** add entry/rejoin decision table; full path creates waitlisted without charge; promotion assert-no-charge + exactly-one insert; `left` rejoin fails closed; conflict audit/test coverage. |
| 2026-07-15 | v2.2 | **DD-45 ✅:** pin schema state-shape/positive position + queue index; total order position/joined_at/id; locked fill-available/unlimited promotion; atomic status+charge+notify; capacity-below-active reject; add edge/test/rollout coverage. |
| 2026-06-18 | v1.0 | Initial BE tech spec (English format) |
| 2026-06-19 | v2.0 | Chuẩn hoá Vietnamese numbered (6 sections), thêm full DDL, 12 BE edge cases, error codes, idempotency table, 20 unit tests, 4 integration tests |
| 2026-07-13 | v2.1 | Reconcile với canonical schema: thêm `players`, `tenant_id` trên `session_surface_refs`; đổi TG projector/tests sang Zalo/Messenger/web. Waitlist chưa model cho tới khi DD-45 ✅. |
