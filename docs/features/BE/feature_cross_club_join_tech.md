# Feature: Cross-club Join & Approval — Backend Tech Spec

> **Canonical phase:** P4.3  
> **Version:** 2.12 · 2026-07-28
> **Status:** Reviewed  
> **Implementation:** Not started — `join_requests` có sẵn từ `0006` · authority: `../../standards/BUILD-STATUS.md` (Doc status ≠ Implementation status)  
> **Product spec:** `../feature_cross_club_join.md`  
> **References:** `../../standards/business-rules.md` · `../../standards/decisions.md` DD-32/DD-39/DD-45/DD-49/**DD-52**/**DD-65..68** · `../../dd-45-waitlist-analysis.md` · `feature_channel_booking_funnel_tech.md` · `feature_user_settings_tech.md` (`deriveChargeAmount`) · `feature_session_management_tech.md`
> **⚠️ Live-schema boundary:** Waitlist schema `0014_players_waitlist` **đã merge trên `main`** tại `1a6ac38` (verify tail hiện hành tại `packages/db/migrations/`, không hard-pin số); tính đến `origin/main`@`22c23aa` (2026-07-19) main còn dừng ở `0000–0013`, đã merge kể từ đó. DD-39/DD-49/SessionService/queue-entry-version/retry behavior chưa có runtime. Live `join_requests` chỉ có `command_id`, **không có financial-proof/version field**.

---

## 1. Tổng quan triển khai

```text
Public Session ID → Protected resolver → Canonical session/tenant
    → Open Join TX: Lock session → Validate → Guest membership/player lookup
      → First-entry: Active+ExactlyOneCharge OR Waitlisted+NoCharge
      → Proven DD-49 rejoin: Active→CarryOver|AppendRefundedLifecycle;
                                 Full→Waitlisted+CarryHistory|DeferRefundedLifecycle → Outbox
    → Approval TX: Preflight live disposition → Create request (no proof storage) → Notify host
      → Approve(first-entry OR proven rejoin capacity outcome)/Reject/Expire
```

Commands: `JoinPublicSession`, `CancelJoinRequest`, `ApproveJoinRequest`, `RejectJoinRequest`, `ExpireJoinRequests`, `LeaveSession`. Public ID resolved via protected service to canonical session/tenant — enter tenant context → authorize.

Messenger never sends raw public/session/request IDs as authority. The Page-bound opaque action resolves target/session/request server-side with TTL+snapshot/version; source tenant Page may differ from a valid cross-club target and remains audit/default only.

DD-32 does not add a second join handler. For a channel-origin active outcome, `finalizeChannelBookingIntent()` enters this same transaction with a server-owned tagged disposition (`free`, `account_linked_pay_later`, or `verified_pay_now`). The public adapter cannot set it. Full and pre-approval outcomes require no disposition because they create no active player/new charge/payment.

---

## 2. Database Schema + Edge Cases (BE)

### Live baseline schema (reuse; do not recreate)

```sql
CREATE TABLE join_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  session_id uuid NOT NULL REFERENCES sessions(id),
  person_id uuid NOT NULL REFERENCES persons(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'cancelled')),
  expires_at timestamptz NOT NULL,
  decided_by uuid REFERENCES persons(id),
  decided_at timestamptz,
  command_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_join_requests_active ON join_requests(session_id, person_id) WHERE status = 'pending';
ALTER TABLE join_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE join_requests FORCE ROW LEVEL SECURITY;
```

Existing tables used: `memberships` (guest status), `players`, `charges`. DD-45 expands `players.status` with `waitlisted` + positive `waitlist_position`. First-entry waitlisted rows do not create a charge; DD-49 rejoin-waitlisted may retain a proven historical canonical aggregate, but never creates a second charge.

`join_requests` đã tồn tại từ `0006_discovery.sql`, sync trong `schema.ts`, và đã có ENABLE+FORCE RLS/grants từ `0009_rls_policies_grants.sql`. SQL trên là baseline để đọc, không phải DDL cần chạy lại.

### Migration & Rollback

- **Migration:** reuse live `join_requests`. Chỉ thêm migration monotonic cho constraint/field additive đã được design-probe chứng minh cần thiết (vd same-tenant composite FK hoặc idempotency metadata); không recreate table, không sửa `0006`/`0009`, không giả financial-proof field chưa có. Waitlist/retry objects land trong migration riêng theo DD-45.
- **Rollback:**

| Bước | Hành động | An toàn? |
|------|-----------|----------|
| 1 | Disable join/request/decision routes + cron `ExpireJoinRequests` | ✅ |
| 2 | Revert/drop **chỉ additive objects của slice** sau khi kiểm tra dependency/data | ✅ Có điều kiện |
| 3 | Drop baseline `join_requests` | ❌ NEVER — bảng thuộc migration `0006`, đã có RLS/grants và có thể chứa request lịch sử |

### Edge Cases (Backend)

| # | Category | Case | Xử lý |
|---|----------|------|-------|
| 1 | Concurrency | 2 first-entry players join last slot | Lock session row → first active+exactly-one-charge, second waitlisted without charge/venue |
| 2 | Concurrency | Approve first-entry after capacity full | Mark request approved + create waitlisted player/position under same lock; no charge/venue |
| 3 | Concurrency | Approve after request expired | Safe conflict — terminal with reason "expired" |
| 4 | Concurrency | Duplicate join command | Command dedup + UNIQUE active request index |
| 5 | Security | Body contains arbitrary person_id | ❌ Reject — use authenticated session identity |
| 6 | Security | Admin approve from wrong tenant | AuthZ check — reject |
| 7 | Data Integrity | Player already member | Use existing membership — no duplicate guest |
| 8 | Data Integrity | Player banned from club | Check ban list — reject |
| 9 | Financial | Paid player leave/cancel | Financial/refund policy — charge state drives behavior |
| 10 | Security | Public error reveals tenant state | Generic error messages — no private info |
| 11 | Data Integrity | Suspended tenant new offer | Existing sessions OK — no new extensions |
| 12 | Concurrency | Deadlock: session/root/request/membership/finance | Stable domain order: session → root job → request → membership/player → finance; current-state lookup before locks is read-only |
| 13 | Financial | Existing player `left` joins/requests again | Request-create preflight only. Open/approve re-derive under lock. Active: carry-over/append refunded lifecycle; full: waitlisted, refunded defer lifecycle. Unknown→review/no mutation |
| 14 | Financial | Promotion sees waitlisted player with charge | Re-derive live DD-49 disposition; missing/malformed → skip + audit/owner-review; never upsert/overwrite |
| 15 | Financial/Resilience | First-activation promotion derivation failure | Candidate unchanged; first failure lazy-creates root and candidate audit event; SessionService max 3 claimed attempts, completed sweeps use current order, sibling events share budget/root digest; expired final claim resolves-or-terminalizes; opener commits; no fallback |
| 16 | Financial/Resilience | First-entry direct open/approve active path cannot derive amount | Abort that join/approve transaction fail-closed: no active player/charge/venue; newly-created guest membership rolls back; approval request stays pending; retry safely |
| 17 | Security | Messenger action wrong actor/Page, stale, expired or replayed | Reject before tenant repo/mutation; re-render bounded choices; raw ID never accepted |

---

## 3. API Contract

### Endpoints

| Method | Path | Auth | Mô tả |
|--------|------|------|-------|
| POST | /api/sessions/:id/join | Authenticated Player | Resolve canonical `join_policy` server-side: open→join, approval→pending request. Client không chọn handler/policy |
| DELETE | /api/join-requests/:id | Authenticated Player (own) | Cancel request |
| POST | /api/join-requests/:id/approve | TenantAdmin | Approve request |
| POST | /api/join-requests/:id/reject | TenantAdmin | Reject request |

### Request/Response Examples

> DTO minh hoạ shape theo contract đã pin (venue **chỉ** khi `active`; waitlisted chỉ area + position dương). Tên field cụ thể chốt ở build slice; mọi response dùng envelope chuẩn `{data,error,meta.requestId}`.

**POST `/api/sessions/:id/join`** — body rỗng (identity từ authenticated session; server đọc `join_policy`; **không** nhận `person_id` hoặc policy từ client).

- `200` — active (còn slot, venue revealed):

```json
{
  "data": {
    "status": "active",
    "session": { "publicId": "…", "startAt": "…" },
    "venue": { "name": "…", "address": "…" }
  },
  "error": null,
  "meta": { "requestId": "req_…" }
}
```

- `200` — waitlisted (full, area + position, không venue/charge):

```json
{
  "data": {
    "status": "waitlisted",
    "waitlistPosition": 3,
    "session": { "publicId": "…", "startAt": "…", "area": "…" }
  },
  "error": null,
  "meta": { "requestId": "req_…" }
}
```

- `200` — approval policy tạo/return pending request (không membership/player/charge/venue):

```json
{
  "data": { "status": "pending" },
  "error": null,
  "meta": { "requestId": "req_…" }
}
```

- `409` — rejoin không chứng minh được disposition:

```json
{ "data": null, "error": { "code": "REJOIN_REQUIRES_REVIEW", "message": "Cần host kiểm tra trạng thái tiền trước", "statusCode": 409 }, "meta": { "requestId": "req_…" } }
```

**POST `/api/join-requests/:id/approve`** — `409` khi request hết hạn:

```json
{ "data": null, "error": { "code": "REQUEST_EXPIRED", "message": "Yêu cầu đã hết hạn", "statusCode": 409 }, "meta": { "requestId": "req_…" } }
```

### Idempotency

| Endpoint | Idempotent? | Key |
|----------|-------------|-----|
| join (server branches `join_policy`) | ✅ | Processed `command_id` + UNIQUE active request + UNIQUE `(tenant_id, session_id, membership_id)` — existing active/waitlisted/pending trả current outcome, không mutate |
| approve / reject / cancel | ✅ (safe conflict) | Terminal-status check — request đã decided trả `REQUEST_DECIDED`, không mutate lần hai |

### Error Codes

| Code | Error Code | Message | Trigger |
|------|-----------|---------|---------|
| 409 | `REJOIN_REQUIRES_REVIEW` | Cần host kiểm tra trạng thái tiền trước | `left` nhưng shared correction core không chứng minh được carry-over/refunded disposition |
| 409 | `REQUEST_EXPIRED` | Yêu cầu đã hết hạn | Expired request |
| 409 | `REQUEST_DECIDED` | Yêu cầu đã được xử lý | Already approved/rejected |
| 403 | `PLAYER_BANNED` | Bạn không thể tham gia club này | Banned player |
| 400 | `SESSION_NOT_JOINABLE` | Buổi chơi không nhận đăng ký | Closed/private/past |

### Rate Limits

| Action | Limit | Scope |
|--------|-------|-------|
| Join/request | 10/hour | Per person |
| Cancel | 20/hour | Per person |

---

## 4. Chi tiết triển khai

### Open Join Transaction

```text
1. Lock session (SELECT FOR UPDATE)
2. Resolve trusted identity, then lookup existing membership/player without creating anything:
   a. active/waitlisted → return current outcome idempotently
   b. absent/left → continue; a ban applied after active/waitlisted does not turn this replay into `PLAYER_BANNED` (DD-52 no-auto-evict)
3. For absent/left only, validate public/open/future + `evaluateSessionEligibility()` DD-41 + DD-42 restriction + shared `evaluateJoinRestriction()` DD-52. Failure → zero membership/player/charge/host-alert mutation
4. Still under session lock, lock any nonterminal DD-45 root **before** membership/player/financial locks. Then resolve/create guest membership idempotently only after guards. Existing left calls shared DD-49 disposition under later player/financial locks; unknown → `REJOIN_REQUIRES_REVIEW`
5. Re-count active under lock and resolve outcome:
   a. no existing player + capacity available/unlimited → derive amount first; on success insert active player + exactly one charge atomically; on DD-39 failure abort this join tx (no player/charge/venue, new guest membership rollback)
   b. no existing player + full → insert waitlisted player + tail position; no charge/venue
   c. valid DD-49 rejoin + capacity available/unlimited → active + carry-over or append refunded lifecycle; no duplicate charge row
   d. valid DD-49 rejoin + full → waitlisted + tail; not-refunded retains historical aggregate, refunded writes no new lifecycle; no venue
6. If the outcome observes/causes full capacity, resolve all nonterminal promotion roots in this same transaction; store processed command + outbox event
7. COMMIT → active DTO includes venue; waitlisted DTO includes area + position only
```

### Approval Transaction

```text
1. Request create: lock session, resolve trusted identity, then lookup processed command + existing membership/player + active pending request without creating anything:
   a. active/waitlisted → return current outcome idempotently; do not create request
   b. pending request/processed replay → return current pending outcome; no new request, token use, host alert or outbox
   c. absent/left → run non-authoritative preflight `evaluateSessionEligibility()` DD-41 + DD-42 restriction + shared `evaluateJoinRestriction()` DD-52. Current ban/restriction rejects with zero request/host notification/membership/player/charge
   d. left → preflight current DD-49 disposition; representable → create request **without storing financial proof/snapshot**. Unknown/unimplemented → `REJOIN_REQUIRES_REVIEW`, no request/player/financial mutation
   e. no player → create join_request (UNIQUE active per person/session); still no membership/player/charge
2. Notify host for a newly-created pending request (outbox event)
3. [Host decides]:
   a. Approve: read keys → lock session→nonterminal root job→request→membership/player→financial aggregate → verify status/expiry, `evaluateSessionEligibility()` DD-41, DD-42 restriction và shared `evaluateJoinRestriction()` DD-52 → **re-derive live DD-49 disposition**. First-entry: active+charge or approved+waitlisted/no-charge. Rejoin active: carry-over/append refunded lifecycle; full: approved+waitlisted, refunded no new lifecycle. Ban/restriction imposed after request, drift/unknown or derivation failure leaves request pending and zero player/financial mutation. If active outcome fills capacity, resolve all nonterminal roots in the same transaction. Creation-time preflight/command is never authority
   b. Reject: Lock request → mark rejected → notify player
   c. System: Expire job → mark expired → notify player
```

### Request Expiry

- Configurable TTL per tenant (default: 24h).
- System cron job: `ExpireJoinRequests` runs hourly. Because `join_requests` is tenant-private/FORCE-RLS, cross-tenant discovery/claim uses only the INV-8/TDD §3.4 narrow audited scheduler function/role; each batch then re-enters exact tenant context before locking/updating request rows. No broad `app`/BYPASSRLS table scan.
- Expired requests get terminal status + player notification.

### Caching Strategy

| Data | Cache? | TTL | Invalidation |
|------|--------|-----|-------------|
| Capacity/roster/DD-49 disposition trong join/approve | ❌ | — | Luôn đọc under lock (fail-closed) — browse slot chỉ advisory |
| Host approval queue | ❌ | — | Đọc live; SSE/bot re-render theo outbox event |
| Public session detail (browse) | Thuộc `feature_marketplace_discovery_tech.md` | — | — |

---

## 5. Testing Plan

### Unit Tests

| # | Test | Input | Expected |
|---|------|-------|----------|
| 1 | Open first-entry join happy path | Public/open/capacity | Joined + exactly one charge created |
| 2 | Open first-entry join full | No capacity | Waitlisted + positive position; no charge/venue |
| 3 | Open join closed | Status=closed | `SESSION_NOT_JOINABLE` |
| 4 | Open join private | Visibility=private | `SESSION_NOT_JOINABLE` |
| 5 | Guest membership created | Non-member join | membership role=guest |
| 6 | Existing member join | Already member | Use existing membership |
| 7 | Banned player join | Banned | `PLAYER_BANNED` |
| 8 | Approval request created | Approval policy | Request status=pending |
| 9 | Duplicate request | Same person/session | Idempotent |
| 10 | Approve first-entry happy path | Capacity available | Approved + joined + exactly one charge |
| 11 | Approve first-entry full | No capacity at decision | Request approved + waitlisted player; no charge/venue |
| 12 | Approve expired | Past expires_at | Safe conflict "expired" |
| 13 | Reject happy path | Admin rejects | Status=rejected |
| 14 | Cancel request | Player cancels | Status=cancelled |
| 15 | Expire job | Expired requests | Batch mark expired |
| 16 | Concurrent first-entry last-slot | 2 parallel joins | One active+exactly-one-charge, one waitlisted without charge |
| 17 | Paid leave | Player with charge | Financial policy applied |
| 18 | Venue hidden before active | Pending/rejected/approved-waitlisted DTO | No venue |
| 19 | Venue revealed for active | Active DTO only | Venue present |
| 20 | Cross-tenant admin spoof | Wrong tenant admin | 403 |
| 21 | Duplicate active/waitlisted join | Existing player | Return current state idempotently; no rank/charge change |
| 22 | Rejoin after left, not refunded | Existing `left` + paid obligation without refund reversal | Active/waitlisted per capacity; carry-over same obligation/allocation; waitlisted path creates no new charge/venue |
| 23 | Rejoin after full refund | Existing `left` + completed refund | Active→append one lifecycle; full→waitlisted/no new lifecycle/venue; no duplicate charge row |
| 24 | Rejoin disposition unknown | Partial/ambiguous/unimplemented correction state | `REJOIN_REQUIRES_REVIEW`; player/request/charge/allocations unchanged |
| 25 | Waitlist rejoin activation | Candidate has valid live DD-49 disposition | Re-derive then carry-over or append refunded lifecycle; activate/clear position; no duplicate charge row |
| 25a | Waitlist charge conflict | Live disposition missing/malformed | No promotion/charge mutation; audit+owner-review; continue next candidate |
| 26 | Promotion amount derivation failure | First-activation candidate; KMS/decrypt throws | Candidate unchanged; one candidate audit event references lazy root; opener committed; bounded claimed-attempt retry delegated to SessionService; no fallback |
| 27 | First-entry direct open join amount derivation failure | No existing player, capacity available; KMS/decrypt throws | Join transaction aborts; no player/charge/venue; new guest membership absent; retry safe |
| 28 | First-entry approval amount derivation failure | Pending first-entry request + capacity; KMS/decrypt throws | Approve transaction aborts; request remains pending; no player/charge/venue; retry safe |
| 29 | Channel active call without trusted funnel disposition | Messenger/Zalo adapter calls join directly or supplies client `linked/paid=true` | Reject before membership/player/charge; only in-process finalizer context is accepted |
| 30 | Channel pay-now completion | Live intent + verified bank transaction under funnel finalizer | Reuses common join, creates one player/charge/allocation; replay returns current outcome |
| 29 | Existing-left request preflight | Representable current DD-49 disposition | Pending request created; no financial proof field, player or ledger mutation |
| 30 | Existing-left request unknown | Unknown/unimplemented disposition | `REJOIN_REQUIRES_REVIEW`; no request/mutation |
| 31 | Existing-left state drift before approve | Preflight passed, aggregate changes before decision | Approve re-derive fails; request remains pending; player/ledger unchanged |

### Integration Tests

| # | Test | Setup | Expected |
|---|------|-------|----------|
| 1 | Open join E2E | Browse → join → verify roster | Full flow |
| 2 | Approval E2E | Request → approve → verify | Full flow |
| 3 | Expiry E2E | Request → wait → expire | Auto-expired |
| 4 | Concurrent final-slot | 10 parallel first-entry joins, 1 slot | Exactly 1 active+charge; 9 waitlisted with unique positive positions and no charge |
| 5 | Messenger cross-club action | tenant Page A + valid session B token; then wrong/stale/replay variants | Valid routes B under B rules; invalid variants make zero mutations |
| 6 | Ban imposed after request | Request pending, then DD-52 manual ban before host approval | Approval re-checks shared restriction core; request stays pending/blocked with zero membership/player/charge/venue mutation |
| 7 | Currently banned request-create | DD-52 manual ban exists before player requests approval | Shared restriction preflight rejects; no `join_request`, host notification, membership, player or charge. Preflight never replaces approve-time re-check |
| 8 | Ban after current outcome/request | Player is active, waitlisted or already pending; ban then repeat join/request | Return exact current state idempotently; no `PLAYER_BANNED`, duplicate request, host alert/outbox, queue/charge mutation. Later approve/promotion still re-checks restriction |
| 9 | Direct active fill closes old retry epoch | Root retry due from a failed opener; open join or approval takes final slot | Same session→root lock transaction resolves all nonterminal roots; old worker cannot sweep a later opening |
| 10 | Channel-finalizer parity | Same actor/session via Messenger then Zalo replay after identity merge | One canonical player/charge; second transport returns current state, no duplicate ledger |
| 10 | Cross-tenant expiry scheduler | Due requests across tenants + forged broad app scan | Broad SELECT/UPDATE denied; narrow claim returns bounded refs with audit, and exact tenant context expires only owned pending rows |

---

## 6. Rollout Plan + Changelog

### Rollout

1. Tenant #1 approval-only mode
2. Internal open-join mode
3. Rate-limit/abuse testing
4. Public beta

### Metrics

- Attempts / active / waitlisted / pending / expired / rejoin-carry-over / rejoin-new-obligation / rejoin-review
- Approval latency (request → decision)
- Duplicate/conflict rate
- Abuse blocks
- Charge creation failures

### Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-07-28 | v2.12 | Mirror DD-32 Option D: channel finalizer enters existing Join transaction with server-owned free/account-linked/settled disposition; direct/client proof rejected; add pay-now and cross-transport idempotency tests. No runtime. |
| 2026-07-24 | v2.11c | **De-pin migration-tail** (docs-migration-tail-0018-to-0020-sweep): Live-schema boundary note hard-pinned `migrations 0000–0018, tail = 0018` → non-pinned "verify tail hiện hành tại `packages/db/migrations/`, không hard-pin số" (live tail nay `0020`; `0019`/`0020` tenant-integrity FKs DD-68). Dated provenance `origin/main`@`22c23aa` giữ nguyên verbatim. Pre-existing dated changelog giữ verbatim. Không đổi contract. |
| 2026-07-23 | v2.11b | **Reconcile 0014 merge-state:** current-state Live-schema boundary sửa → `0014_players_waitlist` **đã merge trên `main`** (`1a6ac38`, migrations 0000–0018, tail = 0018); provenance `origin/main`@`22c23aa` reframed thành historical marker (không xoá). Behavior claims (DD-39/DD-49/SessionService/retry chưa build) giữ nguyên. Pre-existing dated changelog giữ verbatim. Không đổi contract. |
| 2026-07-19 | v2.11a | Metadata sweep (index v2.35): thêm trường **Implementation** đồng bộ BUILD-STATUS (Not started). Không đổi contract. |
| 2026-07-19 | v2.11 | **Live-schema/API correction:** reuse baseline `join_requests` from 0006/0009 and forbid rollback drop; one `/api/sessions/:id/join` server-branches canonical policy; examples use live envelope; universal session→root→request/player/finance order. Runtime remains unbuilt. |
| 2026-07-19 | v2.10 | **DD-05/DD-52 idempotency + capacity-epoch closure:** existing active/waitlisted/pending is resolved before restriction preflight; only absent/left can create membership/request and must pass DD-41/DD-42/DD-52. Direct active open/approve fill resolves all nonterminal promotion roots under session→job order. Runtime remains unbuilt. |
| 2026-07-19 | v2.9 | **DD-45/DD-52 closure:** request-create preflights and open join/approval re-check DD-41 + DD-42 + shared `evaluateJoinRestriction()` DD-52; current ban cannot spam requests/host alerts, ban-after-request cannot activate/charge/reveal venue. Mirror one root max-3 promotion-sweep job instead of per-event retry budgets. Runtime remains unbuilt. |
| 2026-07-19 | v2.8 | **Format uplift (Sporta parity, template v2.30):** thêm §2 Migration & Rollback, §3 Request/Response Examples + Idempotency, §4 Caching Strategy. Editorial/spec-detail only — không đổi contract/behavior; DTO examples minh hoạ theo invariant đã pin (venue active-only, waitlist no-charge), field name chốt ở build slice. |
| 2026-07-19 | v2.7 | **DD-45 retry/current-truth mirror:** distinguish active carry-or-append from full waitlist carry-or-defer; current feature HEAD `aa8afae`, schema provenance `1a6ac38`. Retry infrastructure remains SessionService-owned and unbuilt. |
| 2026-07-19 | v2.6 | **DD-05/06/45/49 integrity:** join request stores no financial proof; request-create preflights and approve re-derives live aggregate, including drift test. Venue active-only. Refunded full rejoin defers lifecycle to activation. Pin schema commit `1a6ac38`, current feature HEAD `bb47c15`. |
| 2026-07-17 | v2.5 | **DD-65..68:** Page-bound opaque target resolution for Messenger, source/target tenant separation and hybrid cross-club integration test. |
| 2026-07-16 | v2.4 | **DD-49 full propagation:** all open/approval rejoin paths route to the shared locked correction disposition; carry-over/refunded/unknown tests replace blanket left rejection; no duplicate `charges` row. |
| 2026-07-15 | v2.3 | **DD-39×DD-45 fail-closed charge derivation:** direct active join/approve aborts atomically on derivation failure; waitlist promotion keeps candidate unchanged, audits/retries without rolling back opener, then continues queue; add no-fallback tests. |
| 2026-07-15 | v2.2 | **DD-45 propagation:** unify open/approval full→waitlisted, exact active-vs-waitlisted transaction outcomes, stable lock order, fail-closed `left` rejoin and existing-charge promotion guard; update tests/metrics. |
| 2026-06-18 | v1.0 | Initial BE tech spec (English format) |
| 2026-06-19 | v2.0 | Chuẩn hoá Vietnamese numbered (6 sections), DDL, 12 edge cases, transaction details, 20 tests |
| 2026-07-13 | v2.1 | Reconcile live schema: `session_roster` → `players`; join transaction inserts `players` + `charges` with canonical foreign keys. |
