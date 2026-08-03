# Feature: Session Management — Backend Tech Spec

> **Canonical phase:** P2/P4  
> **Version:** 2.18b · 2026-08-03
> **Status:** Reviewed  
> **Implementation:** Partial DB substrate only — `0014` waitlist, `0019` same-tenant integrity và `0024` public-capacity CHECK đã merge; SessionService/routes/projectors/auto-promote/auto-expiry vẫn chưa build · authority: `../../standards/BUILD-STATUS.md` (Doc status ≠ Implementation status)
> **Product spec:** `../feature_session_management.md`  
> **References:** `../../product/TDD.md` §3.2/3.8 · `../../standards/business-rules.md` · `../../standards/decisions.md` DD-32/DD-39/DD-45/**DD-45a**/DD-49/**DD-52**/**DD-65..68** · `../../dd-45-waitlist-analysis.md` · `feature_channel_booking_funnel_tech.md` · `feature_user_settings_tech.md` (`deriveChargeAmount`)

> **DD-32/DD-45/DD-49 contract:** waitlisted tự thân không chiếm capacity, không tạo charge/new-obligation/venue; live paid-unlinked booking intent có thể giữ đúng một slot trong 15 phút. Admission occupancy dùng một helper `active + unexpired holds`. Promotion free/linked giữ DD-45/DD-49 timing; paid+unlinked candidate vẫn waitlisted/ẩn venue tới verified settlement, expiry release + audited requeue-tail. Runtime/intent schema chưa tồn tại.
>
> **DD-45a owner-final (2026-07-28):** future promotion slice adds partial `UNIQUE (session_id, waitlist_position) WHERE status='waitlisted'` in a new monotonic migration. Duplicate preflight HALTs for manual repair; no auto-renumber. Gaps remain valid; the session-lock allocator plus the database unique constraint form the allocation/final-fence pair. No migration or runtime change has landed from this decision.

---

## 1. Tổng quan triển khai

```text
Surface (Zalo/Messenger/Web) → Command (CreateSession/Update/Publish/Close/Cancel)
    → SessionService → [State + Deduped Command + Outbox] COMMIT
                            ↓
                Projectors: Zalo/Messenger message, Web SSE, Public search
```

Commands: `CreateSession`, `UpdateSession`, `PublishSession`, `AnnounceSession`, `CloseSession`, `CancelSession`, `GenerateOccurrences`. Mỗi command mang `commandId`, tenant/actor từ trusted context, `expected_version` cho conflicting edits. `PublishSession` là transition status-only `draft` → `open` (algorithm §4) — không đổi `visibility`. `CancelSession` nhận nguồn `draft` hoặc `open`, transition sang `cancelled` (algorithm §4, subsection "Draft discard + auto-expiry"); một scheduled job invoke cùng mutation cho draft quá giờ bị bỏ quên, không qua client `commandId`.

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
  slots_max integer,  -- NULL = unlimited (chỉ non-public — xem note Capacity × visibility dưới DDL)
  visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'public')),
  join_policy text NOT NULL DEFAULT 'open' CHECK (join_policy IN ('open', 'approval')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'closed', 'cancelled')),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CHECK (slots_max IS NULL OR slots_max > 0),
  CONSTRAINT sessions_public_capacity_chk
    CHECK (NOT (visibility = 'public' AND slots_max IS NULL))  -- 0024, landed + validated
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
  waitlist_position integer,            -- 0014 ALTER TABLE, merged on main (1a6ac38)
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
-- 0019_tenant_integrity_fks đã thêm same-tenant composite candidate keys/FKs cho:
-- (tenant_id, session_id) → sessions và (tenant_id, membership_id) → memberships,
-- đồng thời buộc session_surface_refs(tenant_id, session_id) cùng tenant.
-- Reuse các constraint đã land; không recreate hoặc liệt kê DD-68 như migration pending.
```

> **Capacity × visibility (PRD E#7 authority):** `visibility='public'` bắt buộc `slots_max IS NOT NULL` — public session không được unlimited; `NULL` = unlimited vẫn hợp lệ cho non-public. Validated DB constraint `sessions_public_capacity_chk` đã land trong `0024_public_visibility_capacity_check.sql`, nên direct INSERT/UPDATE vi phạm bị reject. SessionService validation trên create **và mọi update dẫn tới public** vẫn bắt buộc để trả domain error `MISSING_DISCOVERY_FIELDS` trước DB exception. Guard consume-time/projector vẫn giữ defense-in-depth cho pre-`0024` data, fixture hoặc constraint-bypass; không được dùng chúng để hạ claim DB invariant hoặc claim service/projector đã build.

### Indexes

```sql
CREATE INDEX idx_sessions_tenant_status ON sessions(tenant_id, status);
CREATE INDEX idx_sessions_starts_at ON sessions(starts_at) WHERE status = 'open';
CREATE INDEX idx_sessions_draft_starts_at ON sessions(starts_at) WHERE status = 'draft';  -- auto-expiry claim query, §4 Draft discard + auto-expiry — mirrors idx_sessions_starts_at pattern, not yet applied (Migration & Rollback)
CREATE INDEX idx_session_surface_refs_session ON session_surface_refs(session_id);
CREATE INDEX idx_players_waitlist_order
  ON players(session_id, status, waitlist_position, joined_at, id);
```

### Migration & Rollback

> Grep live `packages/db/migrations/` ngày 2026-07-27: `0000`–`0024` đã merge (25 migrations; tail `0024_public_visibility_capacity_check.sql`). Baseline `sessions` · recurrence · surface refs · `players` từ `0002`; waitlist objects từ `0014`; same-tenant candidate keys/FKs DD-68 từ `0019`; public-capacity CHECK từ `0024`. Tất cả **reuse, không recreate**.

- **Migration (genuinely new → migration mới monotonic sau tail hiện hành):** DD-45a hardening `UNIQUE (session_id, waitlist_position) WHERE status='waitlisted'`; retry objects (`waitlist_entry_version`, root `promotion_retry_jobs` + candidate events — §4, rollout §6 bước 4); `idx_sessions_draft_starts_at` partial index cho auto-expiry claim query (§4 Draft discard + auto-expiry, `docs-session-draft-lifecycle`) — chưa applied, cùng budget `≤1 monotonic migration`. DD-45a migration phải preflight duplicate trước DDL: có bất kỳ duplicate nào thì **HALT/manual**, không auto-renumber; gaps hợp lệ. **Không** đưa DD-68 hoặc public-capacity CHECK vào danh sách pending: chúng đã land ở `0019`/`0024`. Auto-expiry job cũng cần privileged cross-tenant execution (role, grants, migration wiring) + queue/cron registration — **build-slice detail, mirror `feature_billing_lifecycle_tech.md` §4 Daily Lifecycle Job**.
- **Rollback:**

| Bước | Hành động | An toàn? |
|------|-----------|----------|
| 1 | Disable session routes/commands + waitlist entry/promotion + retry worker + recurrence generation job | ✅ |
| 2 | Rollback = **forward migration mới** (KHÔNG rewrite/un-merge lịch sử). Chỉ revert objects genuinely-new của future slice. `0014`/`0019`/`0024` đã land: mọi thay đổi các waitlist/integrity/capacity constraints cần dependency/data proof riêng; không drop như rollback của service slice | ✅ Có điều kiện |
| 3 | Drop baseline `sessions`/`players`/recurrence/surface refs của `0002` | ❌ NEVER — migration đã apply trên main, có thể chứa session/roster thật |

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
| 12 | Data Integrity | Visibility=public without required fields | SessionService target rejects `MISSING_DISCOVERY_FIELDS`; `0024` DB CHECK independently rejects public + `slots_max=NULL`. Required (PRD E#7): sport, area, starts_at, finite `slots_max`; private unlimited remains valid |
| 13 | Data Integrity | `waitlisted` thiếu/position ≤0 hoặc active/left còn position | DB state-shape/positive CHECK reject |
| 14 | Concurrency | Leave/capacity+/hold chạy đồng thời join | Lock session trước; shared occupancy re-count active+live holds; không over-fill/double-charge/double-hold |
| 15 | Boundary | Capacity tăng hoặc finite→unlimited (finite→`NULL` chỉ cho non-public; public → edge #12 reject) | Re-count active+live holds; fill available admission slots hoặc mọi candidate eligible trong cùng locked transition |
| 16 | Boundary | Capacity giảm dưới active roster hoặc active+live-hold occupancy | Active-only breach retains `CAPACITY_BELOW_ROSTER`; live-hold breach returns `CAPACITY_BELOW_OCCUPANCY`; không evict/cancel hold/ngầm mutation |
| 17 | Financial | Existing player `status='left'` join lại | Re-derive under lock. Active: carry-over hoặc append refunded lifecycle; full: waitlisted, refunded không new lifecycle tới activation. Không duplicate charge row; unknown→review/zero mutation |
| 18 | Financial | Waitlisted candidate có existing charge | Re-derive DD-49 live disposition; missing/malformed → không promote/mutate, audit `WAITLIST_CHARGE_CONFLICT`, owner-review, continue next |
| 19 | Financial/Resilience | `deriveChargeAmount` failure lúc first-activation promote | Candidate unchanged; opener audit + candidate event referencing lazy root and commits. Root worker runs max 3 claimed attempts; completed sweeps use current order, siblings share budget/root digest; expired final claim resolves-or-terminalizes without attempt 4; no fallback |
| 20 | Security/State | Messenger wizard wrong Page/actor/tenant, stale, expired or replayed | Single interceptor denies/clears; final command re-checks capability/snapshot; no partial/double create |
| 21 | State | Publish `draft` → `open` | Lock session row; `draft` → set `status='open'` + bump `version` + `session.published` outbox trong một tx. Status-only — `visibility` unchanged. Re-publish session đã `open` = no-op success (`commandId` dedup + state no-op như close/cancel) |
| 22 | Data Integrity | Publish session `visibility='public'` thiếu discovery fields | Re-validate E#7 (sport, area, starts_at, `slots_max IS NOT NULL`) tại publish — transition bật public projection → `MISSING_DISCOVERY_FIELDS`; zero mutation |
| 23 | State | Publish session non-draft closed/cancelled/past | Reject `SESSION_NOT_OPEN` — chỉ `draft` với `starts_at > now()` mới publish được; zero mutation. `session.manage` (Host) only, AuthZ trước service (edge #10) |
| 24 | Security/Billing | Publish khi tenant billing-`suspended` | **Fail-closed block `TENANT_SUSPENDED`** (403, canonical tenant-routing code) per billing Suspended Action Matrix (owned bởi `feature_billing_lifecycle`); zero mutation, không emit event. Status-authority **resolved** — `feature_billing_lifecycle_tech.md` §3 (fail-closed 2-step, `authorizeTenantAction`). **Concurrency:** check phải re-evaluate qua locking read (`FOR SHARE` trên `tenants`/`subscriptions`) trong cùng transaction với session lock, ngay trước mutation (§4 step 6) — upfront step 1 KHÔNG đủ, và plain re-select cũng KHÔNG đủ |
| 25 | State | Discard `draft` → `cancelled` (host) | `CancelSession` guard mở rộng: source status `IN ('draft','open')` (trước đây chỉ `open`). Lock session row `FOR UPDATE`; nguồn `draft` **verify** (không giả định) `players`/`charges` rỗng dưới lock — rỗng thì bỏ qua nhánh roster/root của edge #5, anomaly thì fail-closed vào đúng edge #5/#28. Rỗng: set `status='cancelled'` + bump `version` + `session.cancelled` outbox (`cancel_reason='manual'`) trong một tx. Không past-guard cho nguồn `draft` — hợp lệ bất kể `starts_at`; nguồn `open` giữ nguyên past-guard cũ (edge #11/#31, KHÔNG exempt) |
| 26 | Concurrency | Discard/cancel với `expectedVersion` thiếu hoặc mismatch (nguồn `draft` hoặc `open`) | `expectedVersion` **bắt buộc** trên nhánh mutate — cho MỌI nguồn, không riêng draft (không optional) — thiếu HOẶC mismatch đều → `STALE_VERSION` (409); zero mutation. Đóng race "click Huỷ nháp bỏ version → cancel nhầm session vừa published"; đồng thời pin lần đầu optimistic-concurrency behavior cho toàn bộ `CancelSession` (§1 nguyên tắc chung, chưa từng detail trước slice này) |
| 27 | State | Discard session `closed`, hoặc discard session đã `cancelled` | `closed` → reject `SESSION_NOT_OPEN` (edge #11, không đổi); đã `cancelled` (dù nguồn draft hay open) → no-op idempotent (`commandId` dedup + state no-op, cùng pattern close/publish edge #21) — nhánh no-op này KHÔNG cần `expectedVersion` khớp (mirror publish idempotent-thắng-version) |
| 28 | Financial/Data Integrity | Draft mang `players`/`charges` bất thường (data anomaly — vi phạm bất biến ứng dụng "draft không roster") | Fail-closed: KHÔNG tự động huỷ (host discard lẫn auto-expiry). Host-discard (request/response, có caller đang chờ): trả `CANCEL_REQUIRES_REVIEW` (§3 Error Codes — cùng code `review_policy` của edge #5 dùng cho nguồn `open` paid roster, không invent code riêng). Auto-expiry (background, không có caller): không có response để trả — chỉ skip + audit. Cả hai nhánh đều ghi `session.expiry_anomaly_detected` mỗi lần phát hiện (§4 Events table — cùng canonical outbox mechanism `session.cancelled` dùng, append-only, mirror `waitlist.charge_derivation_failed`'s per-occurrence shape). Owner-facing alert dedupe theo `session_id` là việc của consumer, storage chính xác là build-slice detail (cùng gap pre-existing với `review_policy` chính nó, edge #5). Row giữ `draft`, re-claim lượt job sau là công việc thừa rẻ, không phải bug, tới khi host tự resolve qua review UI |
| 29 | Concurrency | Auto-expiry job race với `PublishSession` concurrent trên cùng draft | Cả hai lock session row `FOR UPDATE` trước khi mutate (session-lock-ordering, cùng discipline Publish step 2/Waitlist promotion step 1). Job lock trước → publish concurrent chờ, thấy `status` đã `cancelled` → reject `SESSION_NOT_OPEN` (edge #23, không đổi). Publish lock trước → job's `FOR UPDATE SKIP LOCKED` skip row lượt chạy này, row giờ `open` → không mutate, không còn khớp filter lượt sau. Không thứ tự nào double-transition |
| 30 | Resilience/Concurrency | Hai lượt chạy auto-expiry job chồng lấn (scheduler tick trùng, hoặc nhiều instance) | Claim filter (`status='draft' AND starts_at<=now()`) tự nhiên idempotent — row `cancelled` không còn khớp, không re-select. `FOR UPDATE SKIP LOCKED` — lượt chạy thứ hai skip row lượt đầu đang giữ lock. Không double-transition/double-event |
| 31 | State/Security | Cancel session `open` với `starts_at<=now()` (past) | Reject `SESSION_NOT_OPEN` — no-past-guard (edge #25) CHỈ áp dụng cho nguồn `draft`; `open`→`cancelled` giữ NGUYÊN yêu cầu past-session-mutation hiện có (edge #11: privileged correction + audit trail, KHÔNG qua path cancel thường) — discard KHÔNG exempt open khỏi past-guard. Paid roster trên session `open` (past hoặc không) vẫn đi qua `CANCEL_REQUIRES_REVIEW` (edge #5) như cũ, không phải path fail-closed mới của draft |

---

## 3. API Contract

### Endpoints

| Method | Path | Auth | Mô tả |
|--------|------|------|-------|
| POST | /api/sessions | TenantAdmin | Tạo session |
| PUT | /api/sessions/:id | TenantAdmin | Sửa session |
| POST | /api/sessions/:id/publish | TenantAdmin | Publish `draft` → `open` (status-only; `commandId` + `expectedVersion`) |
| POST | /api/sessions/:id/announce | TenantAdmin | Announce lên group |
| POST | /api/sessions/:id/close | TenantAdmin | Đóng session |
| POST | /api/sessions/:id/cancel | TenantAdmin | Huỷ session (`open` hoặc `draft`; nguồn `draft` = discard, zero roster/charge impact) |
| GET | /api/sessions | TenantAdmin | List sessions (tenant-scoped) |
| GET | /api/sessions/:id | TenantAdmin/Player | Detail (scoped by role) |

### Error Codes

| Code | Error Code | Message | Trigger |
|------|-----------|---------|---------|
| 400 | `INVALID_TIME_RANGE` | Giờ kết thúc phải sau giờ bắt đầu | `ends_at <= starts_at` |
| 400 | `SPORT_INACTIVE` | Môn thể thao không hoạt động | Sport not in active taxonomy |
| 409 | `CAPACITY_BELOW_ROSTER` | Số chỗ không thể thấp hơn active roster | Reduce `slots_max` below `active_count` |
| 409 | `CAPACITY_BELOW_OCCUPANCY` | Số chỗ không thể thấp hơn active roster + chỗ đang giữ thanh toán | Reduce `slots_max` below shared live occupancy |
| 409 | `SESSION_NOT_OPEN` | Buổi chơi không ở trạng thái mở | Mutation on closed/cancelled; publish của session non-draft (closed/cancelled) hoặc draft đã past `starts_at <= now()` (§4 publish) |
| 403 | `TENANT_SUSPENDED` | Club đang tạm ngưng | Publish (hoặc mutation) khi tenant billing-suspended — **canonical code owned by tenant-routing** (`feature_tenant_routing_authz_tech.md` / TDD); referenced, không định nghĩa lại ở đây |
| 409 | `STALE_VERSION` | Dữ liệu đã thay đổi — tải lại | Optimistic lock conflict |
| 400 | `PRICE_CHANGE_REQUIRES_POLICY` | Cần chọn chính sách cho charges hiện tại | Price change with existing charges |
| 400 | `CANCEL_REQUIRES_REVIEW` | Cần xác nhận huỷ — có người đã thanh toán | Cancel with paid roster (`open`); hoặc discard `draft` mang `players`/`charges` bất thường (data anomaly, edge #28/#30) — cùng error code, cùng review surface, KHÔNG invent code riêng cho draft |
| 400 | `MISSING_DISCOVERY_FIELDS` | Thiếu thông tin bắt buộc cho buổi chơi public | Public visibility without required fields (incl. finite `slots_max` — E#7, note §2); re-validated at create/update **and publish** (§4 publish) |
| 409 | `REJOIN_REQUIRES_REVIEW` | Cần host kiểm tra trạng thái tiền trước | `left` nhưng correction core chưa có hoặc không chứng minh được carry-over/refunded disposition |

### Request/Response Examples

> DTO minh hoạ theo contract đã pin; field name cụ thể chốt ở build slice; envelope DD-60 (`../../standards/api-reference-convention.md`).

**POST `/api/sessions`** — command mang `commandId` (§1); field derive từ DDL §2 (status default `draft`, version 1):

- Request:

```json
{ "commandId": "cmd_…", "startsAt": "…", "endsAt": "…", "timezone": "Asia/Ho_Chi_Minh", "visibility": "private" }
```

- Success (HTTP mapping minh hoạ):

```json
{ "data": { "session": { "id": "…", "status": "draft", "version": 1 } }, "error": null, "meta": { "requestId": "req_…" } }
```

**PUT `/api/sessions/:id`** — `409` optimistic lock conflict (Error Codes trên):

```json
{ "data": null, "error": { "code": "STALE_VERSION", "message": "Dữ liệu đã thay đổi — tải lại", "statusCode": 409 }, "meta": { "requestId": "req_…" } }
```

**PUT `/api/sessions/:id`** — `409` giảm capacity dưới active roster:

```json
{ "data": null, "error": { "code": "CAPACITY_BELOW_ROSTER", "message": "Số chỗ không thể thấp hơn active roster", "statusCode": 409 }, "meta": { "requestId": "req_…" } }
```

**POST `/api/sessions/:id/publish`** — command mang `commandId` + `expected_version` (§1); status-only `draft` → `open`:

- Request:

```json
{ "commandId": "cmd_…", "expectedVersion": 1 }
```

- Success — mutation `draft` → `open` (`version` bump, `visibility` unchanged):

```json
{ "data": { "session": { "id": "…", "status": "open", "version": 2 } }, "error": null, "meta": { "requestId": "req_…" } }
```

- Success — idempotent no-op khi session đã `open` (hoặc `commandId` replay): cùng envelope, `status: "open"`, `version` **không** đổi, không emit `session.published` trùng.
- Error — stale `expectedVersion` (`409`, optimistic lock):

```json
{ "data": null, "error": { "code": "STALE_VERSION", "message": "Dữ liệu đã thay đổi — tải lại", "statusCode": 409 }, "meta": { "requestId": "req_…" } }
```

- Error khác: non-draft/past → `SESSION_NOT_OPEN` (`409`); public thiếu discovery → `MISSING_DISCOVERY_FIELDS` (`400`); tenant billing-`suspended` → **`TENANT_SUSPENDED`** (`403`, canonical tenant-routing code; fail-closed per billing matrix — §4 publish billing note). `commandId` dedup theo canonical `processed_commands` (edge #3).

**POST `/api/sessions/:id/cancel`** — command mang `commandId` + `expectedVersion` (§1; **bắt buộc** trên nhánh mutate, mọi nguồn — edge #26, không phải field tuỳ chọn như DTO minh hoạ chung ở đầu section); nhận nguồn `draft` (discard) hoặc `open` (cancel thường):

- Request:

```json
{ "commandId": "cmd_…", "expectedVersion": 1 }
```

- Success — mutation `draft`/`open` → `cancelled` (`version` bump, `cancel_reason` nội bộ `manual` — không phải field response, chỉ trong outbox payload):

```json
{ "data": { "session": { "id": "…", "status": "cancelled", "version": 2 } }, "error": null, "meta": { "requestId": "req_…" } }
```

- Success — idempotent no-op khi session đã `cancelled` (hoặc `commandId` replay): cùng envelope, `status: "cancelled"`, `version` **không** đổi, không emit `session.cancelled` trùng; nhánh no-op này **không** cần `expectedVersion` khớp (edge #27, mirror publish idempotent-thắng-version).
- Error — `expectedVersion` thiếu hoặc mismatch (`409`, optimistic lock — bắt buộc mọi nguồn, edge #26; đóng race "click Huỷ nháp cũ cancel nhầm session vừa published"):

```json
{ "data": null, "error": { "code": "STALE_VERSION", "message": "Dữ liệu đã thay đổi — tải lại", "statusCode": 409 }, "meta": { "requestId": "req_…" } }
```

- Error khác: session `closed` → `SESSION_NOT_OPEN` (`409`, edge #11/#27). Session `open` với `starts_at<=now()` (past) → **CŨNG** `SESSION_NOT_OPEN` (`409`, edge #31 — no-past-guard KHÔNG áp dụng cho `open`, giữ nguyên hành vi cũ). Nguồn `open` với paid roster (`starts_at` bất kỳ) → `CANCEL_REQUIRES_REVIEW` (`400`, edge #5; mechanism review chưa detail schema trong doc này, chốt ở build slice — cùng gap pre-existing trước slice này). Nguồn `draft` với anomaly (`players`/`charges` bất thường) → **cùng** `CANCEL_REQUIRES_REVIEW` (`400`) + audit (edge #28) — không invent code riêng cho draft. `commandId` dedup theo canonical `processed_commands` (edge #3), cùng cơ chế mọi session command — không đổi cho nguồn `draft`.

### Idempotency

| Endpoint | Idempotent? | Key |
|----------|-------------|-----|
| POST /sessions | ✅ | `commandId` |
| PUT /sessions/:id | ✅ | `commandId` |
| POST /sessions/:id/announce | ✅ | `commandId` |
| POST /sessions/:id/publish | ✅ | canonical `processed_commands` command-dedup (edge #3, inherit — same as all session commands); publish already-open = no-op |
| POST /sessions/:id/close | ✅ | Close already-closed = no-op |
| POST /sessions/:id/cancel | ✅ | Cancel already-cancelled = no-op (áp dụng cả khi nguồn là `draft`); source `draft` hoặc `open` cùng dedup key |

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
| `session.published` | Publish command (`draft` → `open`) | `session_id`, `tenant_id`, `visibility` |
| `session.updated` | Update command | `session_id`, `changed_fields[]` |
| `session.visibility_changed` | Public ↔ private | `session_id`, `new_visibility` |
| `session.closed` | Close command / auto | `session_id`, `close_reason` |
| `session.cancelled` | Cancel command (draft discard hoặc open cancel), hoặc auto-expiry job | `session_id`, `roster_count`, `has_paid`, `cancel_reason` (manual/auto) |
| `session.expiry_anomaly_detected` | Draft discard (host hoặc auto-expiry) phát hiện `players`/`charges` bất thường trên một session `draft` (edge #28) | `session_id`, `tenant_id`, `source` (manual/auto), `anomaly_fields[]` (tên field vi phạm — vd. `['players']`, `['charges']` — KHÔNG log roster/số tiền thật). Cùng canonical outbox mechanism `session.cancelled` dùng — append-only, KHÔNG unique constraint ở layer này (mirror `waitlist.charge_derivation_failed`); owner-facing alert consumer dedup theo `session_id` là việc của consumer đó, không phải của việc ghi event |
| `session.announcement_requested` | Announce command | `session_id`, `channel` |
| `player.waitlisted` | Join khi full | `session_id`, `player_id`, `waitlist_position` |
| `player.promoted` | Leave/capacity+ mở slot | `session_id`, `player_id`, `charge_id` |
| `waitlist.charge_derivation_failed` | First-activation derivation fail trong capacity opener/retry sweep | `failure_event_id`, `promotion_retry_id`, `session_id`, `player_id`, `waitlist_entry_version`, root `origin_command_id`, `reason_code`; unique candidate key `(session_id,player_id,waitlist_entry_version,origin_command_id,reason_code)`. Sibling events reference one root job; retry command ID không thay origin |

### Publish transition (`draft` → `open`)

`PublishSession` (distinct command, `commandId`) là transition **status-only** `draft` → `open` để session bắt đầu nhận join. Cùng `SessionService` shared bởi chat + web — không duplicate logic. Publish **không** đổi `visibility` (visibility set ở create/edit, E#7-validated độc lập); nó chỉ mở trạng thái.

> **⛔ CODE-READINESS — publish contract AUTHORED, 3 gate đã đóng ở spec level (không còn spec gap known-open):** contract này được author ahead of ba gate. **(1)** `docs-billing-publish-suspension-authority` — **RESOLVED/merged**: billing status-authority (cột/giá trị nào block) pin tại `feature_billing_lifecycle_tech.md` §3 Status Authority (fail-closed 2-step, `authorizeTenantAction`, founder-ratified 2026-07-24). **(2)** `docs-prd-flow2-publish-projection-reconcile` — **RESOLVED/merged**: `PRD.md` v2.8g FLOW 2 (+FLOW 12/14, `business-rules.md` BL-DSC-2) nay khớp project-on-publish (step 7 dưới), hết conflict với project-on-create. **(3)** `docs-session-publish-concurrency-recheck` — **RESOLVED AT SPEC LEVEL bởi chính slice này**: billing status-authority check phải re-evaluate TRONG CÙNG transaction/row-lock với mutation `draft`→`open`, qua **locking read** (`SELECT ... FOR SHARE` trên `tenants` rồi `subscriptions`) — KHÔNG chỉ upfront step 1, và KHÔNG chỉ plain re-select cùng transaction (round-01 [P1]: không lock thì không serialize với writer trên bảng khác) — xem step 6 + blockquote "Billing suspension — concurrency" dưới; đóng đúng race mà `feature_billing_lifecycle_tech.md` §3 Concurrency clause + test #36 pin làm acceptance criterion. Đây **KHÔNG** phải certification `CODE_READY` đầy đủ theo `../../standards/review-code-readiness-gate.md` (chưa chạy closure matrix/acceptance-matrix/implementation-artifact pass) — build slice kế tiếp vẫn phải tự chứng minh implementation thoả cả 3 gate trên (đặc biệt billing test #36) trước khi enable. (Draft-cleanup `docs-session-draft-lifecycle` vẫn là follow-up mềm hơn, ngoài 3 gate trên.) Slice `docs-session-publish-contract` gốc chỉ AUTHOR docs contract; slice này đóng gate (3) — **không authorize code**.

1. Resolve trusted actor/tenant từ context (không từ payload). **AuthZ re-checked trên MỌI publish call (kể cả replay/no-op — authz đứng TRƯỚC dedup + state lookup):** (a) `session.manage` (Host) — actor thiếu quyền → 403 kể cả khi retry một session đã `open` (**authz thắng no-op**); non-admin 403 (edge #10). (b) **Billing suspension (fail-closed, dependency on `feature_billing_lifecycle`):** publish là action "publish new sessions" → block **`TENANT_SUSPENDED`** (403, canonical tenant-routing code) khi tenant billing-suspended per billing **Suspended Action Matrix** (`suspended` ❌; `active`/`past_due` ✅). Status-authority **resolved** — `feature_billing_lifecycle_tech.md` §3 (fail-closed 2-step, `authorizeTenantAction`). **Đây là upfront/fail-fast check (cũng gate no-op/replay — authz thắng no-op, step 3) — KHÔNG phải gate authoritative cho mutation thật**, vì nó chạy TRƯỚC session lock; gate authoritative cho mutation nằm ở step 6 (re-check bắt buộc trong cùng transaction/lock). Sau khi authz+billing pass → command dedup theo **canonical `processed_commands` command-dedup** (edge #3) — publish dùng chung cơ chế dedup như MỌI session command, KHÔNG special-case. Collision-safety (cùng `commandId`, khác resource/payload) là property của canonical dedup contract đó (nó mạnh lên thành `IDEMPOTENCY_CONFLICT` khi `processed_commands.request_hash` additive migration land — owned by Session Organize plan); publish **inherit** whatever canonical dedup cung cấp, KHÔNG re-specify hay tự gate trên `request_hash`.
2. Lock session row `FOR UPDATE` trong tenant context (RLS choke-point). Đọc `status`, `visibility`, `starts_at`, `version` under lock — không quyết định từ cache.
3. **Idempotent no-op (thắng `expectedVersion`):** đã pass authz+billing (step 1); nếu `status='open'` sẵn → return success no-op, zero mutation, **không** emit `session.published` trùng (mirror close-already-closed / cancel-already-cancelled). `expectedVersion` **KHÔNG** kiểm ở nhánh này: publish không mutation ở đây nên không có lost-update để guard — một `commandId` mới với `expectedVersion` stale trên session đã `open` vẫn trả **no-op success** (idempotency thắng `STALE_VERSION`; goal state `open` đã đạt). *Ordering:* nếu actor đã mất `session.manage` hoặc tenant billing-suspended, **step 1 trả 403 TRƯỚC** khi tới no-op (authz/billing thắng no-op) — no-op chỉ dành cho actor còn quyền.
4. **Transition guard:** `status ∈ {closed, cancelled}`, hoặc `status='draft'` nhưng `starts_at <= now()` (past) → `SESSION_NOT_OPEN` (409), zero mutation. Chỉ `draft` với `starts_at > now()` mới publish được (past-guard cùng ngưỡng `starts_at <= now()` như promotion §4 và auto-close).
5. **Public precondition:** nếu `visibility='public'` → re-validate E#7 discovery completeness (sport, area, starts_at, `slots_max IS NOT NULL`) — đây là transition **bật public projection** nên discovery phải đủ. Thiếu → `MISSING_DISCOVERY_FIELDS` (400), zero mutation. Private → bỏ qua (visibility không đổi ở publish).
6. **Commit — CHỈ cho mutation `draft`→`open` (một transaction):** **Billing re-check bắt buộc — LOCKING read, KHÔNG phải plain re-select (concurrency — build-time correctness requirement, KHÔNG phải optional hardening):** ngay TRƯỚC khi mutate, re-evaluate `authorizeTenantAction(tx, tenantId, 'publish_new_sessions')` TRONG CÙNG transaction đang giữ session lock từ step 2, và ở nhánh mutating này `authorizeTenantAction` PHẢI đọc qua `SELECT ... FOR SHARE` trên đúng row `tenants` rồi `subscriptions` (thứ tự khoá = thứ tự step 1→step 2 của chính status-authority, `feature_billing_lifecycle_tech.md` §3 — tenant-root axis trước, billing axis sau) — **một plain re-SELECT trong cùng transaction KHÔNG đủ**: dưới READ COMMITTED, một read thường không tự serialize với writer concurrent trên bảng KHÁC (`subscriptions`/`tenants` ≠ `sessions` — giữ session lock không khoá được row billing); chỉ lock thật trên đúng row đó mới ép ordering với Daily Lifecycle Job's `FOR UPDATE SKIP LOCKED`. Với `FOR SHARE`: nếu job đã giữ lock trước → re-check BLOCK tới khi job's transaction resolve rồi đọc giá trị mới nhất (thấy `suspended` nếu job vừa commit); nếu re-check giữ `FOR SHARE` trước → job's `SKIP LOCKED` tự bỏ qua row lượt cron này (suspend dời sang lượt sau), publish tiếp tục an toàn vì trạng thái đã quan sát tại một điểm serialize hợp lệ. step 1's check chỉ fail-fast/gate no-op, KHÔNG authoritative cho mutation vì nó chạy TRƯỚC lock. **Failure mode:** nếu re-check (dưới lock) resolve tenant `suspended` (fail-closed union, billing §3) → `TENANT_SUSPENDED` phải THẮNG, abort mutation, zero mutation, không emit event — kể cả khi step 1 đã pass và suspend chỉ vừa land giữa chừng publish. Chỉ khi re-check vẫn pass mới tiếp tục mutation: `expectedVersion` (nếu client gửi) chỉ được kiểm ở nhánh này (status vẫn `draft`) — mismatch → `STALE_VERSION` (§1); rồi set `status='open'`, bump `version`, ghi đúng một `session.published` outbox event. `FOR UPDATE` (session) + draft-guard + billing re-check (`FOR SHARE`, locking) là an toàn concurrency chính; `expectedVersion` là guard phụ cho stale draft edit. Status-only — `visibility` giữ nguyên.
7. **Public marketplace projection (timing = project-on-publish, reconciled):** publish emit canonical outbox event + status change; **owner projector là `feature_marketplace_discovery`** — algorithm này KHÔNG author projector. Session-side intent: public projection bật TẠI publish (`draft`→`open`), khớp marketplace projector open-only. **Reconciled** — `docs-prd-flow2-publish-projection-reconcile` **RESOLVED/merged**: `PRD.md` v2.8g FLOW 2 (+FLOW 12/14, `business-rules.md` BL-DSC-2) nay khớp project-on-publish, hết conflict với project-on-create trước đây. (Announce lên group là command riêng `AnnounceSession`/SES-UC-3, **KHÔNG** coupled với publish.)

> Idempotency là hai lớp: (a) `commandId` dedup theo **canonical `processed_commands` command-dedup** (edge #3) — publish inherit như mọi command, không re-specify; collision-safety per canonical contract (mạnh lên khi `request_hash` migration land) và (b) state no-op (session đã `open`) — cả hai đều không double-emit `session.published` hay double-flip status. Cùng contract với close/cancel no-op (§3 Idempotency).

> **Billing suspension gate (fail-closed — dependency on `feature_billing_lifecycle`, RESOLVED/merged):** publish là action **"publish new sessions"** trong billing **Suspended Action Matrix** (`active`/`past_due` ✅, **`suspended` ❌**). Publish **fail-closed block `TENANT_SUSPENDED`** (403, canonical tenant-routing code) khi tenant billing-suspended, zero mutation, không emit event. **Status-authority resolved:** billing (matrix owner) định nghĩa **authoritative status source** (`suspended` sống trong `tenants.status`/`subscriptions.status`, cả hai `CHECK 'suspended'` từ 0002/0007) tại `feature_billing_lifecycle_tech.md` §3 Status Authority — fail-closed 2-step (`tenants.status` trục tenant-root xét trước, thắng vô điều kiện; `subscriptions.status` trục billing chỉ xét khi trục tenant clear), founder-ratified 2026-07-24; session publish contract chỉ **cross-ref** matrix/authority qua `authorizeTenantAction('publish_new_sessions')`, không tự đọc `tenants.status`/`subscriptions.status`. **Không** thêm session error code (denial là billing-owned 403); matrix single source of truth — adapters không tự nới.
>
> **Billing suspension — concurrency (build-time correctness requirement, tách biệt với status-authority ở trên):** status-authority resolve **status nào authoritative**; nó KHÔNG tự resolve **khi nào** và **bằng cách nào** phải đọc status đó. `authorizeTenantAction` không phải advisory check-một-lần-sớm-rồi-quên (billing §3 Concurrency clause) — implementation PHẢI re-evaluate nó **trong cùng transaction với session lock, ngay trước commit** (step 6 trên) **VÀ đọc qua locking read (`SELECT ... FOR SHARE` trên `tenants` rồi `subscriptions`, cùng thứ tự step 1→step 2 của status-authority)** — **một plain re-SELECT trong cùng transaction KHÔNG đủ** (codex round-01 [P1]: dưới READ COMMITTED, một read thường không serialize với writer concurrent trên bảng khác chỉ vì "cùng transaction"; giữ session lock không khoá được row billing — chỉ lock thật trên đúng row `tenants`/`subscriptions` mới ép ordering với Daily Lifecycle Job's `FOR UPDATE SKIP LOCKED`). **Failure mode nếu implement sai (thiếu re-check, hoặc re-check không lock):** một suspend transition (Daily Lifecycle Job `past_due→suspended`) commit **giữa** lúc step 1 check và lúc mutation commit → publish vẫn thành công cho tenant vừa suspend; `TENANT_SUSPENDED` phải luôn thắng bất kể suspend đến giữa chừng publish. `docs-session-publish-concurrency-recheck` đóng gate này **AT SPEC LEVEL** (step 6 trên); build slice phải tự chứng minh implementation thoả bằng billing test #36 (competing-writer acceptance criterion, `feature_billing_lifecycle_tech.md` §5).

> **Dọn draft chưa publish (resolved — `docs-session-draft-lifecycle`):** publish reject past draft (`starts_at <= now()`) → `SESSION_NOT_OPEN` là **founder-ratified** (step 4) và giữ nguyên — publish KHÔNG tự invent draft-terminal transition. Việc **DỌN** một draft chưa bao giờ publish và đã quá giờ (gap có sẵn từ mô hình `create=draft`, v2.12c) nay author ở subsection **Draft discard + auto-expiry** ngay dưới đây: host-discard (`CancelSession` mở rộng nhận nguồn `draft`) và system auto-expiry job đều flip `draft`→`cancelled`. (Reconcile prose PRD FLOW 2 ("public → marketplace") cho khớp project-on-publish — `docs-prd-flow2-publish-projection-reconcile` — RESOLVED/merged, xem step 7.)

### Draft discard + auto-expiry (`draft` → `cancelled`)

`CancelSession` (existing command, không command mới/endpoint mới) mở rộng chấp nhận nguồn `draft` bên cạnh `open`. Theo **thiết kế**, một session `draft` không thể có `players` hay `charges` nào — join chỉ khả thi sau khi `PublishSession` flip status sang `open` (đầu subsection Publish transition ở trên; SES-UC-12 product spec). Nhưng "draft không roster" là bất biến **ứng dụng**, KHÔNG phải constraint DB (không FK/CHECK/trigger nào ràng `sessions.status` với sự tồn tại của `players`/`charges`) — import, bug trước đây, hoặc data repair trực tiếp về lý thuyết có thể để lại một `draft` mang roster/tiền thật. Nhánh discard vì vậy KHÔNG được giả định rỗng: nó **verify dưới lock rồi mới quyết định** fast-path hay fail-closed (chi tiết step 6 dưới; cùng nguyên tắc fail-closed edge #5 áp dụng cho nguồn `open`).

**Host-initiated discard:**

1. Resolve trusted actor/tenant từ context. AuthZ re-check mọi call: `session.manage` (Host) — thiếu quyền → 403 (edge #10). Past-guard áp dụng **có điều kiện theo nguồn** — chi tiết step 4 (KHÔNG mở rộng no-past-guard sang `open`, xem edge #31).
2. Lock session row `FOR UPDATE` (cùng choke-point discipline mọi session command khác, §1).
3. **Idempotent no-op:** nếu `status='cancelled'` sẵn → return success no-op, zero mutation, không duplicate `session.cancelled` (mirror publish/close no-op, edge #21/#27).
4. **Transition guard:** `status='closed'` → reject `SESSION_NOT_OPEN` (edge #11/#27, không đổi). `status='open'` VÀ `starts_at<=now()` (past) → **CŨNG** reject `SESSION_NOT_OPEN` (edge #11 hiện có, không đổi: mutation trên past session cần privileged correction + audit trail, KHÔNG qua path cancel thường; giữ ĐÚNG lời hứa "open→cancelled không đổi hành vi" ở step 6 — discard KHÔNG được mở rộng no-past-guard sang `open`, edge #31). `status='draft'` → không past-guard (draft chưa từng `open`, không có roster/refund/"buổi chơi đã diễn ra" để edge #11 bảo vệ) — hợp lệ bất kể `starts_at`. Chỉ hai nhánh còn lại (`draft` bất kỳ lúc nào, hoặc `open` với `starts_at>now()`) mới tiếp tục.
5. **`expectedVersion` là bắt buộc trên nhánh mutate này cho MỌI nguồn** (`draft` lẫn `open` — không riêng draft; khác nhánh no-op idempotent ở step 3, vốn thắng version — mirror publish) — kiểm với `version` live dưới lock trước khi mutate: **mismatch HOẶC thiếu** đều là `STALE_VERSION` (409, edge #26). Đây là lần đầu algorithm cancel được pin chi tiết (trước slice này chưa có subsection riêng) — chọn bắt buộc thống nhất, đúng nguyên tắc optimistic concurrency đã khai báo chung cho mọi command (§1 Design decisions "stale edits rejected"), thay vì để tuỳ chọn rồi phải phân biệt theo nguồn (không có tín hiệu server-side nào phân biệt được "click Huỷ nháp bỏ version" khỏi "Huỷ session bỏ version" một khi cả hai đều thấy `status='open'` dưới lock — chỉ version mới đóng được race category-jump `draft`→`open`). Không có code/behavior cũ nào bị phá vỡ (`Implementation: Not started`).
6. Nguồn `open`: cơ chế preview roster/paid-impact + `review_policy` hiện có (edge #5) áp dụng không đổi — không thay đổi hành vi open→cancelled cũ (ngoài `expectedVersion` bắt buộc ở step 5, áp dụng thống nhất mọi nguồn).
   Nguồn `draft`: dưới cùng lock, kiểm `players`/`charges` của session. Rỗng (kỳ vọng theo thiết kế) → fast-path, đi thẳng tới commit, không cần gate `review_policy`. Phát hiện bất kỳ row nào (anomaly — vi phạm bất biến ứng dụng) → **fail-closed**: KHÔNG tự động huỷ; trả `CANCEL_REQUIRES_REVIEW` (§3 Error Codes — cùng code, cùng review surface `review_policy` của edge #5 dùng cho nguồn `open` paid roster, KHÔNG invent code riêng) + audit (edge #28) — coi đây là dữ liệu cần host xem xét, không phải draft rỗng thật.
7. Commit: set `status='cancelled'`, bump `version`, ghi đúng một `session.cancelled` outbox event (`cancel_reason='manual'`) trong cùng transaction.

**System auto-expiry job (mirror discipline của `feature_billing_lifecycle_tech.md` §4 Daily Lifecycle Job — file đó KHÔNG bị sửa, chỉ tham chiếu pattern; CÙNG mức trừu tượng: role thực thi/grants/migration wiring và queue/cron registration là **build-slice detail**, KHÔNG đặc tả ở đây — giống hệt Daily Lifecycle Job không tự đặc tả wiring của chính nó trong doc đó):**

```text
Scheduled run → Claim sessions WHERE status='draft' AND starts_at<=now() FOR UPDATE SKIP LOCKED (batched)
    → mỗi row đã claim: verify players/charges rỗng (cùng fail-closed check host-discard step 6)
        → rỗng: set status='cancelled', bump version, ghi session.cancelled (cancel_reason='auto')
        → anomaly: KHÔNG mutate, ghi session.expiry_anomaly_detected (§4 Events table), route qua
          review_policy (edge #5) như nguồn open — không tự động huỷ dữ liệu chưa chứng minh an toàn
    → COMMIT
```

- **Idempotent/no-double-cancel:** filter claim (`status='draft' AND starts_at<=now()`) tự nhiên idempotent — row đã `cancelled` không còn khớp filter, không bị re-select lượt sau. `FOR UPDATE SKIP LOCKED` chống hai lượt chạy chồng lấn (scheduler tick trùng, nhiều instance) cùng claim một row — lượt sau skip row lượt đầu đang giữ lock.
- **Race vs. `PublishSession` (edge #29):** cả hai path lock session row `FOR UPDATE` trước khi mutate (session-lock-ordering, cùng discipline Publish step 2 và Waitlist promotion step 1). Job lock trước → publish concurrent chờ, thấy `status='cancelled'` → reject `SESSION_NOT_OPEN` (edge #23, không đổi). Publish lock trước → job's `FOR UPDATE SKIP LOCKED` skip row lượt chạy này; row giờ `open`, không còn khớp filter lượt sau. Không thứ tự nào double-transition — mirror, ở mức row-lock `sessions`, cùng kiểu competing-writer resolution mà `feature_billing_lifecycle_tech.md` test #36/#36a chứng minh ở mức row-lock `subscriptions`.
- **Anomaly fail-closed (edge #28):** một draft anomaly bị skip vẫn còn `status='draft'`, vẫn khớp filter claim — job SẼ re-claim + re-check nó mỗi lượt chạy (rẻ, read-mostly, không mutation — KHÔNG phải bug). `session.expiry_anomaly_detected` ghi mỗi lần phát hiện — cùng canonical outbox mechanism `session.cancelled` dùng (`feature_sync_engine_tech.md` §2, không invent scheme mới, không sửa file đó), không phải cơ chế riêng. Owner-facing alert dedupe theo `session_id` là việc của consumer đọc event đó — mirror "Owner alert/digest dedupes per root" của Waitlist promotion §4 — nhưng consumer/storage chính xác, cùng với execution role/grants/batching/queue registration, là **build-slice detail** (cùng gap pre-existing với `review_policy` chính nó, edge #5, chưa từng detail trước slice này).
- **Tần suất/batch size** là operational config, không phải spec-level contract (cùng cách xử lý "bounded horizon (configurable)" của Recurrence Implementation, §4).
- Không cần `commandId`/`processed_commands` dedup cho job path — idempotency đến từ filter claim, cùng lý luận Daily Lifecycle Job tự thân dựa vào (job đó cũng không đi qua client-facing command envelope).

### Waitlist entry + rejoin disposition (DD-45/DD-49)

1. Lock session row `FOR UPDATE`; resolve trusted identity, then lookup existing membership/player read-only theo UNIQUE `(tenant_id,session_id,membership_id)` mà chưa create/lock player/finance.
2. Existing `active` hoặc `waitlisted`: return current outcome idempotently; không đổi position/charge và ban áp về sau không biến replay này thành join error.
3. Không có player hoặc existing `left`: re-check session joinability — gồm defense-in-depth §2 Capacity × visibility. Current DB `0024` đã reject `visibility='public'` + `slots_max IS NULL`; nếu pre-`0024`/fixture/constraint-bypass row vẫn tới service thì fail-closed reject, zero mutation, audit + owner-review. Đây là **một choke-point cho MỌI branch phía dưới** (first-entry step 5, left-rejoin step 6, approval path) — không branch nào treat NULL as unlimited khi state invalid — cùng DD-41, DD-42 và shared `evaluateJoinRestriction()` DD-52.
4. Lock every nonterminal DD-45 root immediately after session/current-state resolution and **before** membership/player/financial locks. Sau đó mới create/reuse membership. Existing `left` lock aggregate và re-derive DD-49 disposition; partial/ambiguous/core-missing → `REJOIN_REQUIRES_REVIEW`, zero mutation.
5. Không có player row: còn slot/unlimited (unlimited chỉ non-public — public+NULL đã fail-closed tại choke-point step 3) → derive amount trước mutation; success thì insert `active` + đúng một charge atomically; DD-39 derivation failure aborts join fail-closed (không membership/player/charge/venue, không fallback). Full → insert `waitlisted` + tail position + `waitlist_entry_version=1`, không charge/venue.
6. Existing `left`: còn slot → chưa-refund carry-over; refunded append lifecycle idempotent, atomic với `active`. Full → set `waitlisted`, increment durable `waitlist_entry_version`; chưa-refund giữ aggregate lịch sử, refunded **không append lifecycle/nợ mới**. Promotion re-derives later. Không INSERT duplicate `charges` row.
7. Nếu outcome observes/causes full capacity, resolve every nonterminal root in the same transaction; active outcome writes player/finance/outbox only after root lock.

### Waitlist promotion (DD-45)

1. Lock session row `FOR UPDATE`. If session is closed/cancelled/not joinable or `starts_at <= now()`, lock nonterminal roots next, resolve them as no longer applicable, and return without candidate/finance mutation. Capacity decrease below shared occupancy (`active + unexpired payment holds`) rejects with zero mutation or implicit hold cancellation; retain `CAPACITY_BELOW_ROSTER` for an active-only breach and use `CAPACITY_BELOW_OCCUPANCY` when a live hold is the extra blocker.
2. Establish root epoch **before any candidate/player/finance lock**. A synchronous new capacity opener locks and resolves/supersedes older nonterminal roots (increment generation, clear token), but creates no new row yet. A retry worker instead locks the exact claimed root after session and validates state/token/generation/live lease. Both paths now hold the required root order.
3. Compute free slots through the shared occupancy helper: `active players + unexpired channel booking intents in awaiting_payment`. Waitlisted rows and account-link-only intents do not occupy. Exclude a candidate with a live promotion hold from the selector so one sweep cannot offer twice. `slots_max IS NULL` means unbounded fill for **non-public** sessions only. Current DB `0024` makes public+NULL unrepresentable; invalid compatibility rows fail closed with zero candidate/finance mutation.
4. Only now select candidates `status='waitlisted' ORDER BY waitlist_position, joined_at, id FOR UPDATE`.
5. Re-check `evaluateSessionEligibility()` DD-41, DD-42 reliability restriction và shared `evaluateJoinRestriction()` DD-52 rồi resolve financial disposition. First-activation phải không có charge và gọi `deriveChargeAmount`; DD-49 rejoin phải re-derive live aggregate. Missing/malformed disposition → stay waitlisted, audit+owner-review, continue next.
6. Retry-job history is UNIQUE `(tenant_id,session_id,origin_command_id)` and a partial UNIQUE `(tenant_id,session_id) WHERE state IN ('due','claimed')` permits one nonterminal root/session. The synchronous opener lazy-creates its stable root only on first DD-39 failure while session remains locked. Each failure writes one candidate event keyed `(session_id,player_id,waitlist_entry_version,origin_command_id,reason_code)` referencing that root; siblings/duplicates never create another job. At opener end, capacity full/no retryable failure→`resolved`; only open capacity+remaining failure→`due`. Any join/approve/promotion/capacity path filling capacity, plus close/start/cancel, resolves all nonterminal roots. Owner alerts remain durable.
7. Root job has `state=due|claimed|resolved|terminal`, `sweep_attempt_count`, monotonic `claim_generation`, opaque `claim_token`, `next_attempt_at`, `lease_owner`, `lease_expires_at`, `last_reason_code`. Worker CAS-claim is a **separate short job-only transaction** that atomically increments claimed-attempt count/generation (max 3), mints token, commits and releases the job lock before domain work. This counter bounds claims, not guaranteed completed sweeps.
8. Worker domain transaction follows universal lock order **session→root job→candidate/finance**. After locking session then job, require `state='claimed'`, exact token/generation and `lease_expires_at > now()` before selector/every domain mutation. Re-enter current queue head; one completed sweep visits each candidate at most once and re-checks session open/joinable, `starts_at > now()`, capacity, current entry version, DD-41, DD-42, shared DD-52 and live financial state. Deprioritize/manual ban cannot be bypassed. A different candidate failure only ensures sibling event on the same job. Closed/started/full/no-candidate resolves; remaining DD-39 failure after completed attempt 1–2→`due(backoff)`, completed attempt 3→`terminal`/DLQ.
9. Before any final root-job transition, re-check exact token/generation + live lease while job remains locked; stale claimant aborts zero domain/job mutation. Every promotion + job transition commits in one transaction. Crash before commit rolls back and lease expiry permits fenced reclaim while count `<3`; crash after commit observes `resolved|due|terminal`. For expired `claimed` with count `>=3`, maintenance finalizer locks `session→job`, rechecks exact expired claim + live applicability, clears token/lease, then resolves if retry no longer applies or marks terminal+owner-review/DLQ otherwise. It performs no candidate derivation/domain mutation and never opens attempt 4. First-activation success creates exactly one charge; DD-49 rejoin carries or appends refunded lifecycle, then activates; no duplicate charge row. Clear position + notify/outbox atomically.
10. For a paid+unlinked candidate, do not activate/create charge: create one 15-minute intent/hold under the same session lock, leave player waitlisted and venue hidden, then continue only if more admission slots remain. Verified settlement re-enters the funnel finalizer; expiry releases the hold, assigns a new tail position once and opens/continues canonical promotion. Free or qualified Account-linked candidates follow the existing activation path.
11. Stop when full/no candidate. Retry is a bounded continuation, not a new capacity trigger; one root budget + current-order selection + stable entry/origin/event keys prevent N×N attempt multiplication, reorder bypass, stale-rejoin promotion, double-promote, double-hold and double-charge.

`promotion_retry_jobs` + candidate events are tenant-private with same-tenant refs, `ENABLE+FORCE RLS`, and no broad `app`/`readonly` scan. Cross-tenant scheduling uses only a narrow audited worker claim function/role, then re-enters exact tenant context before the `session→job→candidate/finance` domain transaction. Candidate audit events may be per entry/reason; user-facing owner alert/digest is unique per `promotion_retry_id` and aggregates server-side counts/reason classes without PII/amount/venue. Terminal review is a separate root-state alert.

Queue entry assigns `max(waitlist_position)+1` under the same session lock. DD-42 deprioritize moves a candidate to the tail with the same rule; positions need not be contiguous. The selector remains `ORDER BY waitlist_position, joined_at, id` as compatibility/defense for legacy/bypass data and stable ordering; it is not a promise that equal waitlisted positions remain representable after DD-45a. Because deprioritize does not change `waitlist_entry_version`, retry safety comes from re-entering this current-order selector, never from trusting event-bound rank.

> **DD-45a final (owner 2026-07-28; current runtime unchanged):** live `0014` still has no uniqueness constraint and the current permissive duplicate fixture remains until a future promotion slice lands. That slice must add partial `UNIQUE (session_id, waitlist_position) WHERE status='waitlisted'` in a new monotonic migration only after a duplicate preflight passes. Any duplicate means **HALT/manual remediation**; migration code must not auto-renumber. Gaps stay valid. Replace the permissive duplicate-position fixture with a duplicate-rejection test when the constraint lands; retain three-key selector coverage only as compatibility/defense, not as an equal-position tie test.

### Recurrence Implementation

- Store local wall-clock rule + IANA timezone.
- Calculate UTC occurrences with tested timezone library.
- DST ambiguity policy documented (prefer earlier).
- Generate within bounded horizon (configurable).
- Edit rule → create new version; past/generated occurrences NOT silently rewritten.

### Caching Strategy

| Data | Cache? | TTL | Invalidation |
|------|--------|-----|-------------|
| Capacity/roster/charge disposition trong join/promotion | ❌ | — | Đọc under session lock (edge #1/#14, §4) — fail-closed, không quyết định từ cache |
| Session detail/list (tenant-scoped) | ❌ | — | Optimistic `version` + projectors re-render theo outbox; mutation luôn đọc canonical |
| Public discovery projection | Thuộc `feature_marketplace_discovery_tech.md` | — | — |

### Security Checklist (template v2.33 — map về section đã pin)

| Mục | Trả lời trong spec |
|-----|---------------------|
| Authorization/ownership | §3: TenantAdmin per endpoint; AuthZ middleware reject trước service (edge #10); Messenger wizard final consume re-authorize `session.manage` + target tenant (§1, §3 create path, edge #20); RLS ENABLE+FORCE trên `sessions` (§2) + tenant isolation test #18 |
| Injection/validation | §2: CHECK constraints (time range, slots, status/visibility/join_policy enums); §3 validation errors (`INVALID_TIME_RANGE`, `MISSING_DISCOVERY_FIELDS`); tenant/actor từ trusted context, không từ payload (§1) |
| Secret & log redaction | N/A — feature không chạm secret; outbox chỉ mang identifiers + safe changed fields, projectors reload canonical cho sensitive rendering (§1) |
| Webhook signature + replay | N/A — không có webhook ingest trong doc này; Messenger wizard anti-replay/stale/expired denied ở interceptor + final re-check (§3 create path, edge #20, test #36/#37) |
| Idempotency | §3 bảng Idempotency (`commandId`, close/cancel no-op) + command dedup table (edge #3) |
| Data retention/xoá | Chưa pin trong doc này — theo `feature_security_operations_tech.md` |

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
| 10 | Public → private removes projection | Visibility change | Event emitted correctly |
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
| 23 | Capacity tăng lên 12, active=7, live holds=1 | Sáu eligible candidates | Fill exactly 4 admission slots in total order (`12-7-1`) |
| 24 | Capacity finite→NULL (non-public session) | Eligible + banned candidates | Promote all eligible; banned stay waitlisted |
| 24a | Public + unlimited rejected at both layers | API create, private-unlimited→public hoặc public finite→NULL; direct SQL control | SessionService returns `MISSING_DISCOVERY_FIELDS` with zero domain mutation; direct DB INSERT/UPDATE is rejected by `sessions_public_capacity_chk`. Private+NULL control succeeds |
| 24b | Public+NULL compatibility row (consume-time) | Pre-`0024`/fixture/constraint-bypass row enters every branch (first-entry, left-rejoin, approval, capacity opener/promotion sweep) | Không treat as unbounded: entry reject fail-closed; promotion resolves roots with zero candidate/finance mutation; audit + owner-review; test fixture must state CHECK bypass explicitly |
| 25 | Capacity below active/occupancy | Below active, then between active and active+live-holds | `CAPACITY_BELOW_ROSTER` or `CAPACITY_BELOW_OCCUPANCY`; no mutation/hold cancellation |
| 25a | Paid-unlinked promotion hold | Candidate reaches head with one available slot | One 15-minute hold, candidate remains waitlisted/no venue/no charge; selector excludes live hold |
| 25b | Promotion hold expires | No verified payment/link before TTL | Release slot + requeue-tail exactly once + continue selector; duplicate expiry no-op |
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
| 33r | DD-45a migration duplicate fence | Future migration preflight sees duplicate `(session_id, waitlist_position)` among `status='waitlisted'`; clean dataset then attempts duplicate insert | Dirty preflight HALTs for manual repair with zero auto-renumber; clean migration adds the partial unique constraint and duplicate insert rejects. Gaps remain valid; selector still uses `position,joined_at,id` only as compatibility/defense |
| 34 | Direct active join amount derivation fails | Capacity available; KMS/decrypt throws | Join aborts; no player/charge/venue; no fallback; retry safe |
| 35 | Messenger host create parity | Same validated input via central, tenant Page and web | Same command/service result and canonical session shape |
| 36 | Messenger wizard lifecycle | cancel/expire/context-switch/wrong actor/Page/stale snapshot | Deny/clear; zero sessions created |
| 37 | Messenger duplicate confirm | Same opaque action/webhook/commandId replay | Exactly one session/outbox sequence; previous result returned |
| 38 | Negative base price | Create/update `price_amount < 0` through API or direct migration fixture | DB CHECK rejects; no session/outbox mutation |
| 39 | Live skill-level upgrade | Upgrade fixture with non-null `sessions.skill_level` | Value preserved and public projection/filter remains valid until DD-41 ranked-field contract completes |
| 40 | Publish draft→open | `draft` session, `starts_at > now()`, Host | `status='open'`, `version` bumped, exactly one `session.published` outbox event; `visibility` unchanged (status-only) |
| 41 | Re-publish already-open (idempotent) | Session đã `open`; `commandId` replay hoặc new `commandId` | No-op success; no duplicate `session.published`; `status`/`version`/`visibility` unchanged |
| 42 | Publish public without discovery fields | `visibility='public'` `draft` thiếu area / `slots_max` NULL / sport / starts_at | `MISSING_DISCOVERY_FIELDS`; zero mutation; no event |
| 43 | Publish closed/cancelled/past | Session `closed`/`cancelled`, hoặc `draft` với `starts_at <= now()` | `SESSION_NOT_OPEN`; zero mutation; no event |
| 44 | Non-admin publish | Player actor calls publish | 403 — AuthZ rejects before service; zero mutation |
| 45 | Publish `draft` with stale expectedVersion | `draft` session; `expectedVersion` != live `version` (concurrent edit bumped it) | `STALE_VERSION` (409) on the mutation path; zero mutation; no event |
| 46 | Publish while tenant billing-suspended | Host publish; billing resolves tenant `suspended` (per billing matrix) | Fail-closed `TENANT_SUSPENDED` (403); `status` stays `draft`; zero mutation; no `session.published`. Status-authority per `feature_billing_lifecycle_tech.md` §3 (resolved). Static case only — competing-writer race is billing test #36, the acceptance criterion for step 6's re-check-under-lock |
| 47 | Re-publish already-open with stale expectedVersion | Session `open`; new `commandId` + `expectedVersion` < live `version` | No-op success (idempotency precedence over `STALE_VERSION`); zero mutation; no event |
| 48 | Publish `commandId` collision | Same `commandId` reused for a different resource/payload | Handled by the canonical `processed_commands` command-dedup (edge #3) — publish inherits it, does not special-case; collision-safety strengthens to `IDEMPOTENCY_CONFLICT` when the canonical `request_hash` migration lands (Session Organize plan) |
| 49 | Discard draft happy path | Host cancels a `draft` session | `status='cancelled'`, `version` bumped, exactly one `session.cancelled` event (`cancel_reason='manual'`); roster/paid preview empty |
| 50 | Discard draft non-admin | Player actor calls cancel on a `draft` session | 403 — AuthZ rejects before service; zero mutation |
| 51 | Discard with mismatched expectedVersion after concurrent publish | Draft published concurrently (`status` now `open`, `version` bumped); discard client still holds the old `expectedVersion` | `STALE_VERSION` (409); zero mutation — session not silently cancelled |
| 52 | Discard closed session | Host attempts cancel on `status='closed'` | `SESSION_NOT_OPEN`; zero mutation |
| 53 | Discard already-cancelled (idempotent) | Session already `cancelled` (from either a `draft` or `open` origin) | No-op success; no duplicate `session.cancelled`; not required to match `expectedVersion` |
| 54 | Auto-expiry cancels past draft | `draft` session, `starts_at <= now()`, job runs | `status='cancelled'`, `cancel_reason='auto'`, exactly one outbox event |
| 55 | Auto-expiry leaves open/future-draft untouched | Mix: `open` session past `starts_at`, `draft` session with future `starts_at` | Neither transitions; only the past, unpublished draft is claimed |
| 56 | Auto-expiry concurrent runs | Two overlapping scheduled runs target the same due draft simultaneously | Exactly one run's `FOR UPDATE SKIP LOCKED` claims it; the other skips it (no wait, no error); exactly one `session.cancelled` event |
| 57 | Auto-expiry vs concurrent publish race | Job and `PublishSession` race the same draft under a deterministic lock-order harness (mirrors billing test #36/#36a's job-first / publish-first split) | Whichever acquires the row lock first wins deterministically: job-first → publish observes `cancelled` and rejects `SESSION_NOT_OPEN`; publish-first → job's `FOR UPDATE SKIP LOCKED` claim skips the already-locked row this run, no re-match next run (status is now `open`). Neither ordering double-transitions |
| 58 | Discard with omitted expectedVersion after concurrent publish | Draft published concurrently; discard request sends no `expectedVersion` at all | `STALE_VERSION` (409) — missing is treated the same as mismatched on the mutate branch; zero mutation, not a silent cancel of the now-open session |
| 59 | Discard draft with anomalous roster/charge (data anomaly) | `draft` session with a `players` or `charges` row present (fixture bypassing the normal join-requires-open path) | Fail-closed: `CANCEL_REQUIRES_REVIEW` (`400`) — same code and review surface edge #5 uses for `open` with a paid roster, not a bespoke draft code; does not silently cancel; `session.expiry_anomaly_detected` outbox event written (edge #28) |
| 60 | Auto-expiry skips anomalous draft, writes `session.expiry_anomaly_detected` every detection | Past `draft` session with a `players` or `charges` row present (fixture bypass); job runs twice across two scheduled ticks | Both runs leave the row `draft` (zero mutation, zero `session.cancelled` event) and re-claim it (cheap, expected — not a bug); each run writes its own `session.expiry_anomaly_detected` outbox event through the same canonical outbox mechanism `session.cancelled` uses (append-only, no dedupe at this layer, mirrors `waitlist.charge_derivation_failed`'s per-occurrence shape). No HTTP response to return here (background job, no caller) — the host-facing `CANCEL_REQUIRES_REVIEW` code only applies to the discard request path (test #59). Owner-facing alert de-duplication (at-most-one notification across the two runs) is a separate consumer whose storage is a build-slice detail — not asserted by this test, which only covers what this slice actually specifies |
| 61 | Cancel `open` session past `starts_at` still rejected | `open` session, `starts_at<=now()`, host calls cancel (no anomaly, no paid roster — simplest case) | `SESSION_NOT_OPEN` (`409`); zero mutation. Confirms discard's no-past-guard did NOT leak into the pre-existing `open`-source past-session-mutation restriction (edge #11/#31) — `open`→`cancelled` behavior is provably unchanged, not just claimed |

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
| 8 | Auto-expiry job + host discard both present | Multiple past unpublished drafts across tenants; one also manually discarded by host just before the job runs | Job claim filter (`status='draft'`) no longer matches the manually-discarded one — no double event; remaining past drafts cancel with `cancel_reason='auto'`; tenant isolation holds (RLS) |

---

## 6. Rollout Plan + Changelog

### Rollout

1. Migrate session fields/backfill timezone
2. ✅ **Done 2026-07-19 trên nhánh `feat/session-waitlist-expand` (tính đến `origin/main`@`22c23aa` ngày đó, main còn dừng ở `0013`); đã merge vào `main` (`1a6ac38`; xem tail hiện hành tại `packages/db/migrations/`, không hard-pin số)** — `0014_players_waitlist`: status domain opened to `waitlisted`, `waitlist_position`, state-shape + positive CHECKs, `idx_players_waitlist_order`. Code stays dark. Covered by 21 DDL invariant tests in `packages/db/src/waitlist-invariants.test.ts`, including app-role grant/RLS on the new column. **Not** online-safe (validated CHECKs + non-concurrent index in one runner transaction) — fine on today's empty `players`, must be split per file if ever re-run against a populated table.
3. ✅ **Done in DB:** `0019_tenant_integrity_fks` lands DD-68 same-tenant composite keys/FKs; `0024_public_visibility_capacity_check` lands + validates `sessions_public_capacity_chk`. Schema/invariant tests only — service/routes/projectors remain dark.
4. Enable atomic waitlist entry/promotion + charge/notify path — **blocked**: first-activation promotion needs `deriveChargeAmount` (DD-39), `evaluateSessionEligibility` (DD-41), DD-42 restriction source and shared `evaluateJoinRestriction()` (DD-52); rejoin promotion needs DD-49 correction. DD-32 additionally requires `channel_booking_intents`, shared occupancy helper, account predicate, verified-payment finalizer and expiry/requeue integration. Retry needs entry-version/root/CAS worker/DLQ. None exist in code yet, nên không wire một nhánh partial.
5. Enable chat CRUD
6. Recurrence shadow generation
7. Web API parity
8. Projector parity (Zalo/Messenger/public/web): public `confirmed_count` counts active players only, while `slots_open` subtracts both active players and unexpired payment holds through the shared occupancy helper; no public hold count/identity

### Metrics

- Command latency/conflict rate
- Occurrence generation lag
- Projection lag/failure rate
- Capacity conflicts per session; active/hold occupancy and hold expiry/requeue
- Waitlist depth / promotion latency / promotion skip reason
- Cancel-with-payment count

### Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-08-03 | v2.18b | **Reconcile `authorizeTenantAction` call in §4 step 6 (`docs-billing-authz-signature-reconcile`):** step 6's mandatory billing re-check documented `authorizeTenantAction(tenantId, 'publish_new_sessions')` — merged code (`ddb69a9`, `packages/db/src/authorization.ts:91-95`) requires the caller's already-open transaction as its first parameter. This was a genuine contradiction, not a stylistic gap: the same sentence requires the call to run inside the transaction holding the session lock while printing a signature that structurally cannot receive that transaction — the same defect `feature_billing_lifecycle_tech.md`'s own reconcile (v2.10) exists to close (codex round-08 [P2] on that slice, verified against this file directly). Updated to `authorizeTenantAction(tx, tenantId, 'publish_new_sessions')`. Every other mention in this file (edge #24, step 1, the "Billing suspension gate" and "Billing suspension — concurrency" blockquotes) is bare-name prose or single-argument action-class shorthand naming which action is being cross-referenced, not a signature assertion, and stays unchanged. Docs-only; code/schema/tests already merged and unaffected by this reconcile. Pre-existing dated changelog giữ verbatim. |
| 2026-07-28 | v2.18a | Reconcile two DD-32 residual drifts found by acceptance retrace: capacity-decrease step now guards active+live-hold occupancy with exact error split; projector parity keeps `confirmed_count=active` while `slots_open` subtracts active+holds and exposes no hold count. No runtime/schema. |
| 2026-07-28 | v2.18 | Mirror DD-32 Option D: shared active+hold occupancy, capacity-reduction error, selector exclusion, paid-unlinked promotion hold and expiry requeue-tail; add tests/rollout blockers. No runtime/schema. |
| 2026-07-28 | v2.17 | Mirror DD-45a owner-final without claiming implementation: future promotion slice adds partial unique waitlist position via new monotonic migration; duplicate preflight HALT/manual, no auto-renumber, gaps allowed; session-lock allocator + DB final fence. Replace permissive fixture with duplicate rejection only when migration lands; keep three-key selector as compatibility/defense. Add test #33r. |
| 2026-07-27 | v2.16 | Reconcile live DB substrate through tail `0024` (25 migrations): DD-68 same-tenant composite integrity landed in `0019`; validated `sessions_public_capacity_chk` landed in `0024`. Promote public-capacity rule from migration candidate to implemented DB invariant while retaining SessionService/projector consume guards as defense-in-depth for pre-`0024`/fixture/bypass data. Service/routes/projectors/auto-promote remain unbuilt. |
| 2026-07-24 | v2.15 | **Draft-lifecycle cleanup (founder-ratified, `docs-session-draft-lifecycle`):** closes the gap the publish contract flagged (v2.14, codex round-03) — a `draft` past its `starts_at` with no host action was permanently stuck (no draft-terminal transition existed). Authors BOTH founder-decided cleanup paths, terminal status `cancelled` (reuses the existing enum, no schema change to existing objects): `CancelSession`'s command-list line (§1) and endpoint description (§3) now note it accepts source status `draft` in addition to `open` — no new command, no new endpoint, no new error codes. New §4 algorithm subsection **"Draft discard + auto-expiry (`draft` → `cancelled`)"**, inserted directly after Publish transition. **Host-initiated discard:** a 7-step algorithm (mirrors Publish's own step numbering/rigor) — `session.manage` authz, lock `FOR UPDATE`, idempotent no-op if already `cancelled`, reject `SESSION_NOT_OPEN` if `closed`, **mandatory `expectedVersion`** on the mutate branch for every source (not draft-only — the first time `CancelSession` has had a detailed algorithm at all, so nothing pre-existing regresses; closes the race where an omitted/stale version on a "discard draft" click could otherwise fall through and silently cancel a session concurrently published to `open`), then **verify** (never assume) `players`/`charges` are empty under lock before the fast-path commit — a data anomaly routes fail-closed into the same `review_policy` gate edge #5 already uses for `open`-source cancels with paid rosters, rather than silently discarding unproven-safe data. **System auto-expiry job:** described at the same level of abstraction as `feature_billing_lifecycle_tech.md` §4's Daily Lifecycle Job (file not modified, pattern reference only) — claims `sessions WHERE status='draft' AND starts_at<=now()` via `FOR UPDATE SKIP LOCKED`, applies the identical fail-closed verify, and transitions or routes to review exactly like the host path; the job's privileged execution identity, grants, migration wiring, and queue/cron registration are explicitly a **build-slice detail** (this repo's own precedent for privileged-execution wiring, the `chat_definer` protocol in `feature_inapp_chat_tech.md` §2, is noted as a reference for that slice — not reproduced here). New event `session.expiry_anomaly_detected` (§4 Events table) rides the same canonical outbox mechanism `session.cancelled` uses when an anomaly is found on either path; `session.cancelled` itself gains a `cancel_reason` (`manual`/`auto`) field, mirroring `session_closed`'s existing `close_reason` shape. **Critical correctness point:** the no-past-guard exception is scoped **strictly to source `draft`** — `open`→`cancelled` retains the pre-existing past-session-mutation restriction (edge #11: requires privileged correction + audit trail, not the ordinary cancel path) completely unchanged; a `draft` was never `open`, so past-ness carries no roster/refund weight for it, but an `open` session past its `starts_at` may have a real, possibly-settled game behind it. The anomaly path (either source) surfaces via the **existing** `CANCEL_REQUIRES_REVIEW` error code — the same one `open`-source paid-roster cancels already return — not a bespoke draft-specific code; the auto-expiry job (no HTTP caller) has no response to give here and simply skips + audits. New §2 BE edges #25–31 (discard transition, mandatory-version race closure, closed/already-cancelled handling, anomaly fail-closed via `CANCEL_REQUIRES_REVIEW`, auto-expiry vs. concurrent-publish race, concurrent-run idempotency, and `open`-past-guard preservation) and a full `POST /api/sessions/:id/cancel` Request/Response Examples block in §3 (request DTO, success, idempotent no-op, `STALE_VERSION`, `CANCEL_REQUIRES_REVIEW`, and the other error paths — mirroring publish's existing style; the endpoint existed before this slice but its contract was never illustrated). New partial index `idx_sessions_draft_starts_at` (§2 Indexes + Migration & Rollback — mirrors the existing `idx_sessions_starts_at` pattern, not yet applied, same `≤1 monotonic migration` budget as the other pending items already listed there) for the auto-expiry claim predicate. 13 new unit tests (#49–61) plus 1 new integration test (#8) covering the happy path, authz, the version race (mismatched and omitted), closed/already-cancelled rejection, the anomalous-draft fail-closed path via `CANCEL_REQUIRES_REVIEW` (both host and job), auto-expiry itself, auto-expiry leaving other sessions untouched, concurrent-run idempotency, the auto-expiry-vs-publish race, and — critically — that cancelling a past `open` session is still rejected exactly as before this slice (test #61, proving the "open unchanged" claim rather than just asserting it). Negative scope respected throughout: does not touch the publish (`draft`→`open`) path, the billing suspend-gate, or `feature_billing_lifecycle` — this is purely a new terminal transition INTO `cancelled` FROM `draft`. **Iteration note:** this contract converged across multiple codex review rounds (full history in `docs/autopilot-backlog.md`'s task block and the session's codex round artifacts) — early rounds explored a fully-specified Postgres privilege/role-bootstrap mechanism for the auto-expiry job before the founder redirected that whole class of detail to match the Daily Lifecycle Job precedent (business contract only, infra wiring deferred to the build slice); a later full-base confirmation round then caught that the "no past-guard" wording for draft-discard had accidentally widened to also exempt `open`-source cancel from its pre-existing past-session restriction — fixed as described above, along with wiring the anomaly path to the existing `CANCEL_REQUIRES_REVIEW` surface instead of leaving it unspecified. The version reflected here is the final, founder-confirmed scope. Dated changelog giữ verbatim; không resolve OQ nào khác ngoài draft-lifecycle. |
| 2026-07-24 | v2.14c | **Round-01 fix (`docs-session-publish-concurrency-recheck`, codex [P1]):** v2.14b's step-6 re-check held only the session row lock (from step 2) and re-evaluated `authorizeTenantAction` as a plain re-SELECT — codex correctly flagged that this does NOT serialize against the Daily Lifecycle Job, which locks `subscriptions`, not `sessions`: under READ COMMITTED, being "in the same transaction" does not force ordering against a concurrent writer on a *different* row; only an actual lock on the contended row does. Fixed step 6 + the "Billing suspension — concurrency" blockquote + edge #24 + the CODE-READINESS note to require the re-check to be a **locking read** — `SELECT ... FOR SHARE` on `tenants` then `subscriptions` (lock order matches status-authority's own step 1→step 2 evaluation order) — so the re-check either blocks until a concurrent lifecycle-job suspend transaction resolves (then observes the fresh `suspended` value) or the lifecycle job's `FOR UPDATE SKIP LOCKED` skips the row this cron run (suspend deferred to the next run, publish proceeds correctly on the state it validly observed). This is what actually closes billing test #36's competing-writer race; a bare same-transaction re-read did not. |
| 2026-07-24 | v2.14b | **Publish concurrency recheck-under-lock (`docs-session-publish-concurrency-recheck`):** round-07 review of the ratified billing status-authority contract surfaced a TOCTOU race — §4 publish algorithm checked billing authorization at step 1, BEFORE acquiring the session row lock (step 2), so a tenant suspended between check and mutation could still publish. **Step 6 (commit) now requires a mandatory billing re-check** (`authorizeTenantAction('publish_new_sessions')`) INSIDE the same transaction/row-lock, immediately before the `draft`→`open` mutation — step 1's check is fail-fast/no-op-gating only, not authoritative for the mutation; `TENANT_SUSPENDED` must win even if suspension lands mid-publish (failure mode pinned as a build-time correctness requirement, not optional hardening). New blockquote "Billing suspension — concurrency" elaborates the requirement + cites billing test #36 (competing-writer acceptance criterion) as the build-time proof obligation. **⛔ CODE-READINESS note rewritten:** both original hard dependencies — `docs-billing-publish-suspension-authority` (billing status-authority, `feature_billing_lifecycle_tech.md` §3) and `docs-prd-flow2-publish-projection-reconcile` (`PRD.md` v2.8g FLOW 2) — are now RESOLVED/merged; this slice closes the third and last known gate (concurrency) AT SPEC LEVEL, explicitly short of a full `CODE_READY` certification (no closure-matrix/acceptance-matrix/implementation-artifact pass run). Synced every mirror mention of the two now-merged dependencies within this file (edge #24, step 1, step 7, "Billing suspension gate" blockquote, "Ngoài scope" draft-lifecycle blockquote, test #46) so none contradict the rewritten note; dated `v2.14` changelog row preserved verbatim (accurate as of 2026-07-23 authoring). Docs-only — no schema/code change; `Implementation: Not started` unchanged. |
| 2026-07-24 | v2.14a | **De-pin migration-tail** (docs-migration-tail-0018-to-0020-sweep): header Implementation line + §Migration&Rollback grep-note + rollout step-2 hard-pinned `migrations 0000–0018` → non-pinned "verify tail hiện hành tại `packages/db/migrations/`, không hard-pin số" (live tail nay `0020`; `0019`/`0020` tenant-integrity FKs DD-68). Dated provenance giữ nguyên verbatim. Pre-existing dated changelog giữ verbatim. Không đổi contract. |
| 2026-07-23 | v2.14 | **PUBLISH transition contract (founder-ratified, `docs-session-publish-contract`; re-sliced after codex rounds 01–05):** distinct command `PublishSession` (§1 command list + flow), endpoint `POST /api/sessions/:id/publish` (§3, `commandId` + `expectedVersion`) → Endpoints + Idempotency (`publish already-open = no-op`) + Request/Response Examples (DTO/envelope DD-60, incl. stale-`expectedVersion` → `STALE_VERSION`), §4 algorithm **Publish transition (`draft`→`open`)** (AuthZ `session.manage` re-checked mọi call incl. replay — **authz thắng no-op**; lock row; **idempotent no-op thắng `expectedVersion`** trên session đã open; guard non-draft/past → `SESSION_NOT_OPEN`; public → E#7 → `MISSING_DISCOVERY_FIELDS`; mutation `draft`→`open` mới kiểm `expectedVersion` → `STALE_VERSION`, set `status='open'` + bump `version` + đúng một `session.published` outbox), event `session.published`, BE edge #21–#24, tests #40–#47. **Status-only** — publish KHÔNG đổi `visibility`. Reuse error codes `SESSION_NOT_OPEN` + `MISSING_DISCOVERY_FIELDS` (không invent code mới). **Billing suspension = fail-closed block 403** per billing Suspended Action Matrix — **named dependency on `feature_billing_lifecycle`** (matrix owner định nghĩa authoritative status source/mismatch/missing/other-status; session slice cross-ref only, KHÔNG resolve status-authority) → **HARD DEPENDENCY** `docs-billing-publish-suspension-authority`. **Projection-timing = OPEN cross-authority reconcile** (§4 step 7): session-side intent project-on-publish, nhưng PRD FLOW 2 + marketplace integration contract mô tả project-on-create — cross-ref only, KHÔNG claim PRD/marketplace resolved → **HARD DEPENDENCY** `docs-prd-flow2-publish-projection-reconcile`. **Publish contract AUTHORED nhưng NOT code-ready cho tới khi 2 hard deps merge** (§4 code-readiness note; codex round-06). Idempotency **inherit canonical `processed_commands` dedup** (Session Organize contract: `request_hash` JCS; collision → `IDEMPOTENCY_CONFLICT`; `request_hash` = pending additive migration — cross-ref, không re-specify; codex round-06/07). Reference canonical **`TENANT_SUSPENDED`** (403, tenant-routing) cho suspended-publish (§3 error codes; codex round-07). Checklist re-trace → follow-up `docs-session-acceptance-checklist-publish-retrace` (codex round-07). Negative-scope: dọn **draft chưa publish** (draft-terminal cleanup) là pre-existing gap từ `create=draft` → backlog `docs-session-draft-lifecycle`. No schema change (status enum `draft/open/closed/cancelled` đã tồn tại `0002`). Re-slice giảm scope về 2 session specs + README + backlog (billing/projection/draft-lifecycle deferred to owning specs; acceptance-checklist tách khỏi scope). Dated changelog giữ verbatim. |
| 2026-07-23 | v2.13b | **Reconcile 2 inconsistencies (AP-25 round-06, founder-ratified):** (1) public-capacity — pin PRD E#7 authority: `visibility='public'` requires `slots_max IS NOT NULL` (public không unlimited; `NULL` = unlimited chỉ non-public) — note Capacity × visibility §2 (validation choke-point; row public+NULL ngoài choke-point = invalid fail-closed, không được project — mechanism/test thuộc `feature_marketplace_discovery_tech.md`, follow-up ngoài scope), DDL comment, edge #12/#15 qualifier, `MISSING_DISCOVERY_FIELDS` trigger, §4 consume-time re-check tại MỘT choke-point entry step-3 (mọi branch first-entry/left-rejoin/approval) + promotion step-3 (KHÔNG treat public+NULL as unbounded — fail-closed theo not-joinable path), test #24 pin non-public + #24a public+unlimited reject + #24b bypass-row consume-time fail-closed mọi branch. Cột DB giữ nullable như live `0002`; DB CHECK = hardening candidate migration mới (chưa scope). (2) create-status — TDD vốn đã đúng (DDL default `draft`, POST example `draft`), không đổi; reword nằm ở PRD SES-UC-1. Prose only; dated changelog giữ verbatim; publish-transition mechanics là pre-existing gap, không resolve ở đây. |
| 2026-07-23 | v2.13a | **Reconcile 0014 merge-state + projection direction (TDD→PRD):** current-state 0014 mirrors → **merged on `main` (`1a6ac38`, migrations 0000–0018)** (header, §2 migration note + range 0000→0018, DDL `waitlist_position` comment, rollback row = forward-migration mới, §6 rollout step-2; provenance `origin/main`@`22c23aa` reframed thành historical marker). Edge test #10 → "Public → private removes projection" khớp feature spec edge 8 + SES-UC-5/SES-UC-10 (PRD FLOW 2/13). Pre-existing dated changelog giữ verbatim. Không đổi contract. |
| 2026-07-19 | v2.13 | **Template v2.30/v2.33 uplift:** thêm §2 Migration & Rollback (reuse baseline `0002`; `0014` branch-only; DD-68/DD-45a/retry objects = migration mới monotonic), §3 Request/Response Examples (DD-60 envelope), §4 Caching Strategy + Security Checklist. Idempotency đã có sẵn (§3) — giữ nguyên. Derivative/editorial — không đổi contract. |
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
