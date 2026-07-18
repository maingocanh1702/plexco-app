# Feature: Cross-club Join & Approval — Backend Tech Spec

> **Canonical phase:** P4.3  
> **Version:** 2.5 · 2026-07-17
> **Status:** Reviewed  
> **Product spec:** `../feature_cross_club_join.md`  
> **References:** `../../standards/business-rules.md` · `../../standards/decisions.md` DD-39/DD-45/DD-49/**DD-65..68** · `../../dd-45-waitlist-analysis.md` · `feature_user_settings_tech.md` (`deriveChargeAmount`) · `feature_session_management_tech.md`
> **⚠️ Live-schema boundary:** Messenger hybrid Page registry + Page-bound opaque action (DD-65..68) và gender-aware `deriveChargeAmount` (DD-39) là **target contracts**, chưa có trong live schema (`0000–0013`); cần migration mới (**≥0014**) land trước runtime. `deriveChargeAmount` do `feature_user_settings_tech.md` sở hữu (pending build). Live `join_requests` không phụ thuộc các contract này.

---

## 1. Tổng quan triển khai

```text
Public Session ID → Protected resolver → Canonical session/tenant
    → Open Join TX: Lock session → Validate → Guest membership → Active+Charge OR Waitlisted → Outbox
    → Approval TX: Create request → Notify host → Approve(Active OR Waitlisted)/Reject/Expire
```

Commands: `JoinPublicSession`, `CancelJoinRequest`, `ApproveJoinRequest`, `RejectJoinRequest`, `ExpireJoinRequests`, `LeaveSession`. Public ID resolved via protected service to canonical session/tenant — enter tenant context → authorize.

Messenger never sends raw public/session/request IDs as authority. The Page-bound opaque action resolves target/session/request server-side with TTL+snapshot/version; source tenant Page may differ from a valid cross-club target and remains audit/default only.

---

## 2. Database Schema + Edge Cases (BE)

### Schema

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

Existing tables used: `memberships` (guest status), `players`, `charges`. DD-45 expands `players.status` with `waitlisted` + positive `waitlist_position`; waitlisted rows have no charge.

### Edge Cases (Backend)

| # | Category | Case | Xử lý |
|---|----------|------|-------|
| 1 | Concurrency | 2 players join last slot | Lock session row → first active+charge, second waitlisted without charge/venue |
| 2 | Concurrency | Approve after capacity full | Mark request approved + create waitlisted player/position under same lock; no charge/venue |
| 3 | Concurrency | Approve after request expired | Safe conflict — terminal with reason "expired" |
| 4 | Concurrency | Duplicate join command | Command dedup + UNIQUE active request index |
| 5 | Security | Body contains arbitrary person_id | ❌ Reject — use authenticated session identity |
| 6 | Security | Admin approve from wrong tenant | AuthZ check — reject |
| 7 | Data Integrity | Player already member | Use existing membership — no duplicate guest |
| 8 | Data Integrity | Player banned from club | Check ban list — reject |
| 9 | Financial | Paid player leave/cancel | Financial/refund policy — charge state drives behavior |
| 10 | Security | Public error reveals tenant state | Generic error messages — no private info |
| 11 | Data Integrity | Suspended tenant new offer | Existing sessions OK — no new extensions |
| 12 | Concurrency | Deadlock: session/request/membership | Stable lock order documented: session → request → membership |
| 13 | Financial | Existing player `left` joins/requests again | Reuse shared DD-49 rejoin disposition: carry-over if not refunded, append obligation lifecycle if refunded; unknown/unimplemented → `REJOIN_REQUIRES_REVIEW`, no mutation |
| 14 | Financial | Promotion sees waitlisted player with charge | Skip candidate, audit `WAITLIST_CHARGE_CONFLICT` + owner-review; never upsert/overwrite charge |
| 15 | Financial/Resilience | Promotion amount derivation KMS/decrypt/price failure | Candidate stays waitlisted/no-charge/no-venue; audit `WAITLIST_CHARGE_DERIVATION_FAILED` + one canonical failure outbox event for retry/alert consumers; opener commits; continue next; no fallback price |
| 16 | Financial/Resilience | Direct open/approve active path cannot derive amount | Abort that join/approve transaction fail-closed: no active player/charge/venue; newly-created guest membership rolls back; request stays pending; retry safely |
| 17 | Security | Messenger action wrong actor/Page, stale, expired or replayed | Reject before tenant repo/mutation; re-render bounded choices; raw ID never accepted |

---

## 3. API Contract

### Endpoints

| Method | Path | Auth | Mô tả |
|--------|------|------|-------|
| POST | /api/discover/sessions/:publicId/join | Authenticated Player | Open join |
| POST | /api/discover/sessions/:publicId/request | Authenticated Player | Request approval |
| DELETE | /api/join-requests/:id | Authenticated Player (own) | Cancel request |
| POST | /api/join-requests/:id/approve | TenantAdmin | Approve request |
| POST | /api/join-requests/:id/reject | TenantAdmin | Reject request |

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
2. Validate: public? open? future? DD-41 eligibility/ban?
3. Resolve/create guest membership (idempotent)
4. Lookup player by UNIQUE (tenant_id, session_id, membership_id):
   a. active/waitlisted → return current outcome idempotently
   b. left → call shared DD-49 rejoin disposition under the session/financial locks; carry-over/refunded path continues, unknown → `REJOIN_REQUIRES_REVIEW`
5. Re-count active under lock:
   a. capacity available/unlimited → derive amount first; on success insert active player + exactly one charge atomically; on DD-39 derivation failure abort this join tx (no player/charge/venue, new guest membership rollback)
   b. full → insert waitlisted player + tail position; no charge/venue
6. Store processed command + outbox event
7. COMMIT → active DTO includes venue; waitlisted DTO includes area + position only
```

### Approval Transaction

```text
1. Request create: lookup existing membership/player without creating membership:
   a. active/waitlisted → return current outcome idempotently; do not create request
   b. left → create/keep request only after the shared DD-49 disposition can be represented; unknown/unimplemented → `REJOIN_REQUIRES_REVIEW`, no request/player/financial mutation
   c. no player → create join_request (UNIQUE active per person/session); still no membership/player/charge
2. Notify host for a newly-created pending request (outbox event)
3. [Host decides]:
   a. Approve: read request keys → lock session → lock request → verify status/expiry/eligibility → resolve membership/player rejoin guard → if capacity, derive amount then active+charge atomically (derivation fail rolls back, request remains pending); otherwise approved+waitlisted/no-charge → COMMIT
   b. Reject: Lock request → mark rejected → notify player
   c. System: Expire job → mark expired → notify player
```

### Request Expiry

- Configurable TTL per tenant (default: 24h).
- System cron job: `ExpireJoinRequests` runs hourly.
- Expired requests get terminal status + player notification.

---

## 5. Testing Plan

### Unit Tests

| # | Test | Input | Expected |
|---|------|-------|----------|
| 1 | Open join happy path | Public/open/capacity | Joined + charge created |
| 2 | Open join full | No capacity | Waitlisted + positive position; no charge/venue |
| 3 | Open join closed | Status=closed | `SESSION_NOT_JOINABLE` |
| 4 | Open join private | Visibility=private | `SESSION_NOT_JOINABLE` |
| 5 | Guest membership created | Non-member join | membership role=guest |
| 6 | Existing member join | Already member | Use existing membership |
| 7 | Banned player join | Banned | `PLAYER_BANNED` |
| 8 | Approval request created | Approval policy | Request status=pending |
| 9 | Duplicate request | Same person/session | Idempotent |
| 10 | Approve happy path | Capacity available | Approved + joined |
| 11 | Approve full | No capacity at decision | Request approved + waitlisted player; no charge/venue |
| 12 | Approve expired | Past expires_at | Safe conflict "expired" |
| 13 | Reject happy path | Admin rejects | Status=rejected |
| 14 | Cancel request | Player cancels | Status=cancelled |
| 15 | Expire job | Expired requests | Batch mark expired |
| 16 | Concurrent last-slot | 2 parallel joins | One active+charge, one waitlisted without charge |
| 17 | Paid leave | Player with charge | Financial policy applied |
| 18 | Venue hidden before join | Pre-join DTO | No venue |
| 19 | Venue revealed after join | Post-join DTO | Venue present |
| 20 | Cross-tenant admin spoof | Wrong tenant admin | 403 |
| 21 | Duplicate active/waitlisted join | Existing player | Return current state idempotently; no rank/charge change |
| 22 | Rejoin after left, not refunded | Existing `left` + paid obligation without refund reversal | Active/waitlisted per capacity; carry-over same obligation/allocation; no duplicate financial row |
| 23 | Rejoin after full refund | Existing `left` + completed refund | Append one idempotent obligation-lifecycle entry through shared correction core; no duplicate `charges` row |
| 24 | Rejoin disposition unknown | Partial/ambiguous/unimplemented correction state | `REJOIN_REQUIRES_REVIEW`; player/request/charge/allocations unchanged |
| 25 | Waitlist charge conflict | Candidate already has charge | No promotion/charge mutation; audit+owner-review; continue next candidate |
| 26 | Promotion amount derivation failure | Waitlisted candidate has encrypted gender; KMS/decrypt throws | Candidate unchanged waitlisted/no-charge/no-venue; one audit + one canonical failure outbox event; opener committed; retry/alert consume event; continue next; no fallback price |
| 27 | Direct open join amount derivation failure | Capacity available; KMS/decrypt throws | Join transaction aborts; no player/charge/venue; new guest membership absent; retry safe |
| 28 | Approval amount derivation failure | Pending request + capacity; KMS/decrypt throws | Approve transaction aborts; request remains pending; no player/charge/venue; retry safe |

### Integration Tests

| # | Test | Setup | Expected |
|---|------|-------|----------|
| 1 | Open join E2E | Browse → join → verify roster | Full flow |
| 2 | Approval E2E | Request → approve → verify | Full flow |
| 3 | Expiry E2E | Request → wait → expire | Auto-expired |
| 4 | Concurrent final-slot | 10 parallel joins, 1 slot | Exactly 1 active+charge; 9 waitlisted with unique positive positions and no charge |
| 5 | Messenger cross-club action | tenant Page A + valid session B token; then wrong/stale/replay variants | Valid routes B under B rules; invalid variants make zero mutations |

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
| 2026-07-17 | v2.5 | **DD-65..68:** Page-bound opaque target resolution for Messenger, source/target tenant separation and hybrid cross-club integration test. |
| 2026-07-16 | v2.4 | **DD-49 full propagation:** all open/approval rejoin paths route to the shared locked correction disposition; carry-over/refunded/unknown tests replace blanket left rejection; no duplicate `charges` row. |
| 2026-07-15 | v2.3 | **DD-39×DD-45 fail-closed charge derivation:** direct active join/approve aborts atomically on derivation failure; waitlist promotion keeps candidate unchanged, audits/retries without rolling back opener, then continues queue; add no-fallback tests. |
| 2026-07-15 | v2.2 | **DD-45 propagation:** unify open/approval full→waitlisted, exact active-vs-waitlisted transaction outcomes, stable lock order, fail-closed `left` rejoin and existing-charge promotion guard; update tests/metrics. |
| 2026-06-18 | v1.0 | Initial BE tech spec (English format) |
| 2026-06-19 | v2.0 | Chuẩn hoá Vietnamese numbered (6 sections), DDL, 12 edge cases, transaction details, 20 tests |
| 2026-07-13 | v2.1 | Reconcile live schema: `session_roster` → `players`; join transaction inserts `players` + `charges` with canonical foreign keys. |
