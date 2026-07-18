# Feature: Session Management — Backend Tech Spec

> **Canonical phase:** P2/P4  
> **Version:** 2.12a · 2026-07-19
> **Status:** Reviewed  
> **Implementation:** Not started — waitlist `0014` mới ở nhánh feature, chưa merge · authority: `../../standards/BUILD-STATUS.md` (Doc status ≠ Implementation status)  
> **Product spec:** `../feature_session_management.md`  
> **References:** `../../product/TDD.md` §3.2/3.8 · `../../standards/business-rules.md` · `../../standards/decisions.md` DD-39/DD-45/DD-49/**DD-52**/**DD-65..68** · `../../dd-45-waitlist-analysis.md` · `feature_user_settings_tech.md` (`deriveChargeAmount`)

> **DD-45 + DD-49 contract:** waitlisted không chiếm capacity, không tạo charge/new-obligation/venue. Rejoin chưa-refund giữ historical aggregate; refunded full defers lifecycle mới tới activation. Promotion first-activation tạo đúng một charge; rejoin re-derive live disposition rồi carry-over hoặc append lifecycle atomic với activation, không duplicate charge row. First DD-39 failure in an opener lazy-creates one root `promotion_retry_id`; candidate failure events bind entry + root origin for audit. One CAS/lease job runs max 3 claimed attempts; each completed current-order sweep tries each candidate at most once and re-checks DD-41/DD-42/DD-52. Owner alert/digest dedupes per root; expired final claim finalizes resolved-or-terminal without derivation/fourth attempt.

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
- Messenger central/tenant adapters emit the same commands. A single pre-dispatch interaction interceptor owns create wizard state; final consume re-authorizes `session.manage` and target tenant before `SessionService`.

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
  skill_level text, -- current live field; DD-41 expand→contract retires only after ranked source/backfill lands
  price_amount integer NOT NULL DEFAULT 0 CHECK (price_amount >= 0),
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
  status text NOT NULL DEFAULT 'active'
    CONSTRAINT players_status_chk CHECK (status IN ('active', 'left', 'waitlisted')),
  waitlist_position integer,            -- feature branch only: 0014 ALTER TABLE; not on main yet
  joined_at timestamptz NOT NULL DEFAULT now(),
  last_reminded_at timestamptz,
  CONSTRAINT players_waitlist_shape_chk
    CHECK ((status = 'waitlisted') = (waitlist_position IS NOT NULL)),
  CONSTRAINT players_waitlist_position_positive_chk
    CHECK (waitlist_position IS NULL OR waitlist_position > 0),
  UNIQUE (tenant_id, session_id, membership_id)
);

-- CHECK constraints phải đặt tên TƯỜNG MINH. Bài học từ 0002: khai báo inline
-- unnamed khiến Postgres tự đặt `players_status_check`, lệch với tên
-- `players_status_chk` mà schema.ts khai báo — tên đó chưa từng được apply lên
-- database nào. 0014 drop cả hai spelling rồi add lại đúng tên; đừng lặp lại
-- kiểu inline unnamed cho bảng mới.
--
-- Migration triển khai phải thêm same-tenant composite candidate keys/FKs cho:
-- (tenant_id, session_id) → sessions và (tenant_id, membership_id) → memberships,
-- đồng thời buộc session_surface_refs(tenant_id, session_id) cùng tenant.
-- Các FK id đơn hiện tại không đủ chứng minh tenant integrity (DD-68 prerequisite).
-- CHƯA có trong 0014 — đó là DD-68 scope, không phải DD-45.
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
| 4 | Data Integrity | Price/capacity change with existing charges or retry root | Lock `session→root job→roster/finance`, then require explicit `impact_policy`; a capacity outcome that is full resolves roots in the same tx |
| 5 | Data Integrity | Cancel/close with paid roster + retry root | Lock `session→root job→roster/finance`, require `review_policy` — no silent cancellation. Failed preview leaves root unchanged; successful close/cancel resolves all nonterminal roots before commit |
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
| 17 | Financial | Existing player `status='left'` join lại | Re-derive under lock. Active: carry-over hoặc append refunded lifecycle; full: waitlisted, refunded không new lifecycle tới activation. Không duplicate charge row; unknown→review/zero mutation |
| 18 | Financial | Waitlisted candidate có existing charge | Re-derive DD-49 live disposition; missing/malformed → không promote/mutate, audit `WAITLIST_CHARGE_CONFLICT`, owner-review, continue next |
| 19 | Financial/Resilience | `deriveChargeAmount` failure lúc first-activation promote | Candidate unchanged; opener audit + candidate event referencing lazy root and commits. Root worker runs max 3 claimed attempts; completed sweeps use current order, siblings share budget/root digest; expired final claim resolves-or-terminalizes without attempt 4; no fallback |
| 20 | Security/State | Messenger wizard wrong Page/actor/tenant, stale, expired or replayed | Single interceptor denies/clears; final command re-checks capability/snapshot; no partial/double create |

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
| 409 | `REJOIN_REQUIRES_REVIEW` | Cần host kiểm tra trạng thái tiền trước | `left` nhưng correction core chưa có hoặc không chứng minh được carry-over/refunded disposition |

### Idempotency

| Endpoint | Idempotent? | Key |
|----------|-------------|-----|
| POST /sessions | ✅ | `commandId` |
| PUT /sessions/:id | ✅ | `commandId` |
| POST /sessions/:id/announce | ✅ | `commandId` |
| POST /sessions/:id/close | ✅ | Close already-closed = no-op |
| POST /sessions/:id/cancel | ✅ | Cancel already-cancelled = no-op |

### Messenger create-session command path

1. Endpoint/context layer resolves central/tenant Page, actor and eligible target tenant per DD-65/66.
2. One durable pre-dispatch interaction stores validated draft, step, expiry, version/snapshot and `commandId`; cancel/context-switch/expiry clears it.
3. Final preview does not mutate. Confirm re-checks actor+Page binding, `session.manage`, tenant status and snapshot under the command boundary.
4. Adapter emits the same `CreateSession` input as web/Zalo. `SessionService` owns validation/write/outbox; duplicate confirm returns the stored command result.

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
| `waitlist.charge_derivation_failed` | First-activation derivation fail trong capacity opener/retry sweep | `failure_event_id`, `promotion_retry_id`, `session_id`, `player_id`, `waitlist_entry_version`, root `origin_command_id`, `reason_code`; unique candidate key `(session_id,player_id,waitlist_entry_version,origin_command_id,reason_code)`. Sibling events reference one root job; retry command ID không thay origin |

### Waitlist entry + rejoin disposition (DD-45/DD-49)

1. Lock session row `FOR UPDATE`; resolve trusted identity, then lookup existing membership/player read-only theo UNIQUE `(tenant_id,session_id,membership_id)` mà chưa create/lock player/finance.
2. Existing `active` hoặc `waitlisted`: return current outcome idempotently; không đổi position/charge và ban áp về sau không biến replay này thành join error.
3. Không có player hoặc existing `left`: re-check session joinability + DD-41, DD-42 và shared `evaluateJoinRestriction()` DD-52. Failure xảy ra trước mọi membership/player/charge mutation.
4. Lock every nonterminal DD-45 root immediately after session/current-state resolution and **before** membership/player/financial locks. Sau đó mới create/reuse membership. Existing `left` lock aggregate và re-derive DD-49 disposition; partial/ambiguous/core-missing → `REJOIN_REQUIRES_REVIEW`, zero mutation.
5. Không có player row: còn slot/unlimited → derive amount trước mutation; success thì insert `active` + đúng một charge atomically; DD-39 derivation failure aborts join fail-closed (không membership/player/charge/venue, không fallback). Full → insert `waitlisted` + tail position + `waitlist_entry_version=1`, không charge/venue.
6. Existing `left`: còn slot → chưa-refund carry-over; refunded append lifecycle idempotent, atomic với `active`. Full → set `waitlisted`, increment durable `waitlist_entry_version`; chưa-refund giữ aggregate lịch sử, refunded **không append lifecycle/nợ mới**. Promotion re-derives later. Không INSERT duplicate `charges` row.
7. Nếu outcome observes/causes full capacity, resolve every nonterminal root in the same transaction; active outcome writes player/finance/outbox only after root lock.

### Waitlist promotion (DD-45)

1. Lock session row `FOR UPDATE`. If session is closed/cancelled/not joinable or `starts_at <= now()`, lock nonterminal roots next, resolve them as no longer applicable, and return without candidate/finance mutation. Capacity decrease below active count still rejects with zero mutation.
2. Establish root epoch **before any candidate/player/finance lock**. A synchronous new capacity opener locks and resolves/supersedes older nonterminal roots (increment generation, clear token), but creates no new row yet. A retry worker instead locks the exact claimed root after session and validates state/token/generation/live lease. Both paths now hold the required root order.
3. Compute free slots from `status='active'` only. `slots_max IS NULL` means unbounded fill.
4. Only now select candidates `status='waitlisted' ORDER BY waitlist_position, joined_at, id FOR UPDATE`.
5. Re-check `evaluateSessionEligibility()` DD-41, DD-42 reliability restriction và shared `evaluateJoinRestriction()` DD-52 rồi resolve financial disposition. First-activation phải không có charge và gọi `deriveChargeAmount`; DD-49 rejoin phải re-derive live aggregate. Missing/malformed disposition → stay waitlisted, audit+owner-review, continue next.
6. Retry-job history is UNIQUE `(tenant_id,session_id,origin_command_id)` and a partial UNIQUE `(tenant_id,session_id) WHERE state IN ('due','claimed')` permits one nonterminal root/session. The synchronous opener lazy-creates its stable root only on first DD-39 failure while session remains locked. Each failure writes one candidate event keyed `(session_id,player_id,waitlist_entry_version,origin_command_id,reason_code)` referencing that root; siblings/duplicates never create another job. At opener end, capacity full/no retryable failure→`resolved`; only open capacity+remaining failure→`due`. Any join/approve/promotion/capacity path filling capacity, plus close/start/cancel, resolves all nonterminal roots. Owner alerts remain durable.
7. Root job has `state=due|claimed|resolved|terminal`, `sweep_attempt_count`, monotonic `claim_generation`, opaque `claim_token`, `next_attempt_at`, `lease_owner`, `lease_expires_at`, `last_reason_code`. Worker CAS-claim is a **separate short job-only transaction** that atomically increments claimed-attempt count/generation (max 3), mints token, commits and releases the job lock before domain work. This counter bounds claims, not guaranteed completed sweeps.
8. Worker domain transaction follows universal lock order **session→root job→candidate/finance**. After locking session then job, require `state='claimed'`, exact token/generation and `lease_expires_at > now()` before selector/every domain mutation. Re-enter current queue head; one completed sweep visits each candidate at most once and re-checks session open/joinable, `starts_at > now()`, capacity, current entry version, DD-41, DD-42, shared DD-52 and live financial state. Deprioritize/manual ban cannot be bypassed. A different candidate failure only ensures sibling event on the same job. Closed/started/full/no-candidate resolves; remaining DD-39 failure after completed attempt 1–2→`due(backoff)`, completed attempt 3→`terminal`/DLQ.
9. Before any final root-job transition, re-check exact token/generation + live lease while job remains locked; stale claimant aborts zero domain/job mutation. Every promotion + job transition commits in one transaction. Crash before commit rolls back and lease expiry permits fenced reclaim while count `<3`; crash after commit observes `resolved|due|terminal`. For expired `claimed` with count `>=3`, maintenance finalizer locks `session→job`, rechecks exact expired claim + live applicability, clears token/lease, then resolves if retry no longer applies or marks terminal+owner-review/DLQ otherwise. It performs no candidate derivation/domain mutation and never opens attempt 4. First-activation success creates exactly one charge; DD-49 rejoin carries or appends refunded lifecycle, then activates; no duplicate charge row. Clear position + notify/outbox atomically.
10. Stop when full/no candidate. Retry is a bounded continuation, not a new capacity trigger; one root budget + current-order selection + stable entry/origin/event keys prevent N×N attempt multiplication, reorder bypass, stale-rejoin promotion, double-promote and double-charge.

`promotion_retry_jobs` + candidate events are tenant-private with same-tenant refs, `ENABLE+FORCE RLS`, and no broad `app`/`readonly` scan. Cross-tenant scheduling uses only a narrow audited worker claim function/role, then re-enters exact tenant context before the `session→job→candidate/finance` domain transaction. Candidate audit events may be per entry/reason; user-facing owner alert/digest is unique per `promotion_retry_id` and aggregates server-side counts/reason classes without PII/amount/venue. Terminal review is a separate root-state alert.

Queue entry assigns `max(waitlist_position)+1` under the same session lock. DD-42 deprioritize moves a candidate to the tail with the same rule; positions need not be contiguous because `joined_at,id` complete the total order. Because deprioritize does not change `waitlist_entry_version`, retry safety comes from re-entering this current-order selector, never from trusting event-bound rank.

> **Open DD-45a (live truth, 2026-07-19):** this DDL carries **no uniqueness** constraint on `waitlist_position`. Normal `max(position)+1` under the session lock does not generate duplicates, but `waitlist-invariants.test.ts` intentionally inserts equal `(position,joined_at)` rows and expects deterministic `id` tie-break, so duplicates are currently representable and test-pinned. Recommended promotion-slice hardening is `UNIQUE (session_id, waitlist_position) WHERE status='waitlisted'`; landing it requires a monotonic migration and replacing that permissive fixture/test, while preserving total-order coverage for legitimate ties on later keys.

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
| 11 | Concurrent first-entry join last slot | 2 concurrent transactions | One active+exactly-one-charge; one `waitlisted` with positive position and no charge |
| 12 | Concurrent web/chat edit | Same session, different version | One success, one `STALE_VERSION` |
| 13 | Command dedup (same commandId) | Duplicate command | Return previous result |
| 14 | DST timezone boundary | Recurrence across DST | Correct UTC calculation |
| 15 | Recurrence idempotency | Generate twice | Same occurrences, no duplicates |
| 16 | Mutation on cancelled session | Any update | `SESSION_NOT_OPEN` |
| 17 | Non-admin create session | Player actor | 403 |
| 18 | Tenant isolation | Session from tenant A | Not visible to tenant B |
| 19 | Public serializer whitelist | Public endpoint | No venue/roster/financial data |
| 20 | Announcement retry | First attempt fails | Retry succeeds, no duplicate message |
| 21 | First-entry join full | Session full | `waitlisted`, position dương, no charge/venue/capacity |
| 22 | Leave opens slot | One eligible first-activation candidate | Promote + clear position + one charge atomically |
| 23 | Capacity tăng lên 12, active=7 | Sáu eligible candidates | Promote exactly 5 in total order (`12-7`) |
| 24 | Capacity finite→NULL | Eligible + banned candidates | Promote all eligible; banned stay waitlisted |
| 25 | Capacity below active | `slots_max < active_count` | `CAPACITY_BELOW_ROSTER`, no mutation |
| 26 | Candidate ineligible | First in queue fails DD-41 | Skip first, promote next, first keeps position |
| 27 | Promotion retry | Same commandId twice | Same result; no double charge/promotion |
| 28 | Rejoin after left, paid not refunded | Existing player `left` + paid obligation, no refund reversal | Re-activate/waitlist theo capacity; carry-over same obligation/allocation; no duplicate financial row |
| 29 | Rejoin after full refund | Existing player `left` + completed refund | Capacity available→append one lifecycle + active; full→waitlisted with no new lifecycle/venue; no duplicate charge row |
| 30 | Rejoin financial disposition unknown | Partial/ambiguous/unimplemented correction state | `REJOIN_REQUIRES_REVIEW`; player/charge/allocations byte-for-byte unchanged |
| 31 | Promotion rejoin disposition | Waitlisted DD-49 rejoin candidate | Re-derive; not-refunded carry-over or refunded append lifecycle; activate + clear position; no duplicate charge row |
| 31a | Promotion charge conflict | Missing/malformed live DD-49 disposition | Candidate not promoted; audit+owner-review; next may fill slot |
| 32 | Promotion amount derivation fails | First-activation candidate; KMS/decrypt throws | Candidate unchanged; one candidate audit event on lazy root; opener committed; next candidate may fill; no fallback |
| 33 | Derivation retry after slot filled | Same `promotion_retry_id`; capacity full | Resolve root job no-op; no promotion/charge; candidates keep rank |
| 33a | Persistent derivation failure | Same root job completes claimed attempts 1..3 | Backoff + durable claimed-attempt count; sibling events do not fork jobs/root digest; completed attempt 3 terminal owner-review/DLQ |
| 33b | Retry succeeds | Sweep ≤3, capacity remains | Canonical selector promotes in order; root job resolves when no failure remains/capacity fills; event redelivery no-op |
| 33c | Stale candidate event | Player leaves then re-enters waitlist with incremented `waitlist_entry_version`; old event redelivered | Event is alert-dedupe only and cannot drive promotion or resolve the root job. Current sweep reads the new row/version through selector; no mutation derives from stale event payload |
| 33d | Candidate no longer applicable | During root sweep, one candidate is left/active, DD-41 ineligible, DD-42 restricted or DD-52 manually banned | Skip that row with exact reason and continue current selector; no charge/venue. Root job transition derives from the whole sweep, not from one candidate event |
| 33e | Concurrent retry claim | Two workers claim one due/expired `promotion_retry_id` | Exactly one CAS winner and one sweep increment; loser does no domain work |
| 33f | Worker crash before domain commit | Claimed root-job lease expires before attempt 1 or 2 domain commit | Reclaim safely while count `<3`; claimed-attempt count never exceeds 3; no promotion/charge before successful commit |
| 33g | Worker crash after success | Promotion + root-job transition committed | Redelivery/reclaim observes persisted state; no second charge/promotion |
| 33h | Reorder after failure | Candidate A event, then DD-42 deprioritize moves A behind B before retry | Root sweep re-enters current selector; A cannot bypass B; no out-of-order charge/promotion |
| 33i | Manual ban after failure | DD-52 ban imposed after event, before retry | Shared `evaluateJoinRestriction()` skips candidate; no active/charge/venue |
| 33j | Two candidates fail in one opener | A and B each have a unique failure event referencing one `promotion_retry_id`; two workers/redeliveries | One CAS sweep job, one shared counter ≤3; each candidate derived at most once per sweep; events/commands cannot multiply attempts N×N |
| 33k | Failure then final slot fills | A derivation fails, later B succeeds and fills last capacity in same opener | A alert event stays durable, but root job commits `resolved` and no worker may claim it; next genuine opener uses a new root origin/job if A fails again |
| 33l | Stale claimant resumes | Worker A lease expires; B reclaims with next generation/token; A resumes | A fails token/lease fence and makes zero selector/domain/job changes; only B may sweep/transition; total sweep count ≤3 |
| 33m | Opener/worker lock order | Worker claimed job while a new capacity opener starts | CAS claim commits job-only; both domain paths lock session→job→candidate/finance; no deadlock, and superseded token cannot mutate |
| 33n | Old root across capacity epochs | J1 due; direct active join fills slot; later leave creates opener J2 | Fill resolves J1 under session lock; J2 supersedes any older nonterminal root before own job. J1 claimant/event cannot sweep new opening; partial unique holds |
| 33o | Three pre-domain crashes exhaust claims | Attempts 1..3 claim then expire before domain commit | Finalizer locks session→job and rechecks exact expired claim; no longer applicable→resolved, otherwise terminal+owner-review/DLQ. No stuck `claimed`, derivation, mutation or attempt 4 |
| 33p | Initial opener after start | Session already started/past; leave/capacity edit would expose slot | No candidate lock/promotion/charge. Under session→job, resolve every nonterminal root as no longer applicable |
| 33q | Cancel/price-capacity update vs claimed worker | Paid roster + claimed root; concurrent cancel or update | Both use session→root→roster/finance; no deadlock. Review-required abort leaves root unchanged; successful close/cancel/full-capacity outcome resolves it |
| 34 | Direct active join amount derivation fails | Capacity available; KMS/decrypt throws | Join aborts; no player/charge/venue; no fallback; retry safe |
| 35 | Messenger host create parity | Same validated input via central, tenant Page and web | Same command/service result and canonical session shape |
| 36 | Messenger wizard lifecycle | cancel/expire/context-switch/wrong actor/Page/stale snapshot | Deny/clear; zero sessions created |
| 37 | Messenger duplicate confirm | Same opaque action/webhook/commandId replay | Exactly one session/outbox sequence; previous result returned |
| 38 | Negative base price | Create/update `price_amount < 0` through API or direct migration fixture | DB CHECK rejects; no session/outbox mutation |
| 39 | Live skill-level upgrade | Upgrade fixture with non-null `sessions.skill_level` | Value preserved and public projection/filter remains valid until DD-41 ranked-field contract completes |

### Integration Tests

| # | Test | Setup | Expected |
|---|------|-------|----------|
| 1 | Full CRUD lifecycle | Create → update → close | State transitions correct |
| 2 | Chat + web same service | Zalo/Messenger create → web edit | Same session, consistent state |
| 3 | Recurrence generation | Create rule → generate | Occurrences match timezone |
| 4 | Outbox → projector delivery | Create session → check projector | Event delivered, projection updated |
| 5 | Concurrent leave + join last slot | Two transactions | Lock order preserves capacity; one canonical outcome, no double charge |
| 6 | Leave + first-activation candidate KMS failure | One leave, two candidates | Leave commits; first unchanged + one audit/origin event; second may promote; bounded retries happen separately |
| 7 | Hybrid Page host matrix | central + tenant Page; host/player/dual-role across two tenants | Authorized host creates correct tenant session; non-admin and wrong context denied |

---

## 6. Rollout Plan + Changelog

### Rollout

1. Migrate session fields/backfill timezone
2. ✅ **Done 2026-07-19 trên nhánh `feat/session-waitlist-expand` (chưa merge vào `main` — `origin/main`@22c23aa vẫn dừng ở `0013`)** — `0014_players_waitlist`: status domain opened to `waitlisted`, `waitlist_position`, state-shape + positive CHECKs, `idx_players_waitlist_order`. Code stays dark. Covered by 21 DDL invariant tests in `packages/db/src/waitlist-invariants.test.ts`, including app-role grant/RLS on the new column. **Not** online-safe (validated CHECKs + non-concurrent index in one runner transaction) — fine on today's empty `players`, must be split per file if ever re-run against a populated table.
3. Enable atomic waitlist entry/promotion + charge/notify path — **blocked**: first-activation promotion needs `deriveChargeAmount` (DD-39), `evaluateSessionEligibility` (DD-41), DD-42 restriction source and shared `evaluateJoinRestriction()` (DD-52); rejoin promotion needs the DD-49 correction core. Retry additionally needs `waitlist_entry_version` migration, candidate failure-event consumer, root promotion-retry store, CAS/lease sweep worker and domain DLQ/owner-review sink. None exist in code yet, nên không wire một nhánh partial.
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
| 2026-07-19 | v2.12a | Metadata sweep (index v2.35): thêm trường **Implementation** đồng bộ BUILD-STATUS (Not started). Không đổi contract. |
| 2026-07-19 | v2.12 | **DD-45 lock/liveness/RLS closure:** every domain path locks session→root before candidate/player/finance; root is lazy on first failure; max 3 claimed attempts with expired-final resolve-or-terminal finalizer; initial opener also requires future/joinable session; tenant-private RLS/narrow scheduler claim; owner digest dedupes per root. Behavior remains unbuilt. |
| 2026-07-19 | v2.11 | **DD-45 retry-owner/queue/restriction closure:** one root promotion job owns max-3 CAS/lease full sweeps; candidate failure events are sibling alert/audit dedupe refs, not independent budgets. Each sweep re-enters current order, tries each candidate once and re-checks DD-41/DD-42/DD-52. Add reorder/ban/N×N-budget regressions. Behavior remains unbuilt. |
| 2026-07-19 | v2.10 | **DD-45 retry-consumer closure:** event binds `waitlist_entry_version` + `origin_command_id`; pin one-owner CAS/lease state machine, max-3 atomic claims, full consume-time revalidation, crash recovery and stale-entry/concurrent-worker tests. Add missing migration/worker/consumer/DLQ blockers. Behavior remains unbuilt. |
| 2026-07-19 | v2.9 | **DD-45×DD-49 integrity:** waitlisted means no new obligation/venue; refunded rejoin appends lifecycle only at activation. Add canonical failure event registry + durable 3-attempt/backoff non-recursive retry and terminal review/DLQ tests. Behavior remains unbuilt. |
| 2026-07-19 | v2.8 | **DD-45 schema landed on branch (rollout step 2):** migration `0014_players_waitlist` đã commit trên nhánh `feat/session-waitlist-expand` (chưa merge vào `main` — `origin/main`@22c23aa vẫn dừng ở `0013`) — status domain opened, `waitlist_position`, state-shape + positive CHECKs, queue index; 21 DDL invariant tests incl. app-role grant/RLS. Records that the previously-inline `players` status CHECK was auto-named `players_status_check` (schema.ts's `players_status_chk` had never been applied) and 0014 reconciles the two. Flags the position-uniqueness question and the DD-68 composite-FK omission as explicitly out of scope. Step 3 marked blocked on DD-39/41/42. Contract body unchanged. |
| 2026-07-17 | v2.7 | **Live DDL closure:** restore current `sessions.skill_level` and `price_amount >= 0` CHECK in the documented schema; add upgrade/negative-price regressions while DD-41 future rank migration remains expand→contract. |
| 2026-07-17 | v2.6 | **DD-65..68:** central/tenant Messenger create parity, single durable wizard interceptor, final capability/context/snapshot re-check, shared idempotent command path, same-tenant FK prerequisite and hybrid integration gate. |
| 2026-07-16 | v2.5 | **DD-49 full propagation:** replace blanket left-rejoin reject with locked disposition table (carry-over/refunded/unknown); unknown stays fail-closed. Pin append-only obligation lifecycle + canonical balance helper and explicitly forbid assuming a second `charges` row under live uniqueness. |
| 2026-07-15 | v2.4 | **DD-39×DD-45 fail-closed propagation:** derive charge amount before promotion mutation; KMS/decrypt/price failure keeps candidate waitlisted/no-charge/no-venue, writes idempotent audit+retry/owner-alert, does not rollback leave/capacity opener, then continues the queue; add retry no-op tests. |
| 2026-07-15 | v2.3 | **DD-45 money closure:** add entry/rejoin decision table; full path creates waitlisted without charge; promotion assert-no-charge + exactly-one insert; `left` rejoin fails closed; conflict audit/test coverage. |
| 2026-07-15 | v2.2 | **DD-45 ✅:** pin schema state-shape/positive position + queue index; total order position/joined_at/id; locked fill-available/unlimited promotion; atomic status+charge+notify; capacity-below-active reject; add edge/test/rollout coverage. |
| 2026-06-18 | v1.0 | Initial BE tech spec (English format) |
| 2026-06-19 | v2.0 | Chuẩn hoá Vietnamese numbered (6 sections), thêm full DDL, 12 BE edge cases, error codes, idempotency table, 20 unit tests, 4 integration tests |
| 2026-07-13 | v2.1 | Reconcile với canonical schema: thêm `players`, `tenant_id` trên `session_surface_refs`; đổi TG projector/tests sang Zalo/Messenger/web. Waitlist chưa model cho tới khi DD-45 ✅. |
