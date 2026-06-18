# Feature: Cross-club Join & Approval — Backend Tech Spec

> **Canonical phase:** P4.3  
> **Version:** 2.0 · 2026-06-19  
> **Status:** Reviewed  
> **Product spec:** `../feature_cross_club_join.md`  
> **References:** `../../standards/business-rules.md`

---

## 1. Tổng quan triển khai

```text
Public Session ID → Protected resolver → Canonical session/tenant
    → Open Join TX: Lock session → Validate → Guest membership → Player + Charge → Outbox
    → Approval TX: Create request → Notify host → Approve/Reject/Expire
```

Commands: `JoinPublicSession`, `CancelJoinRequest`, `ApproveJoinRequest`, `RejectJoinRequest`, `ExpireJoinRequests`, `LeaveSession`. Public ID resolved via protected service to canonical session/tenant — enter tenant context → authorize.

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

Existing tables used: `memberships` (guest status), `session_roster`, `charges`.

### Edge Cases (Backend)

| # | Category | Case | Xử lý |
|---|----------|------|-------|
| 1 | Concurrency | 2 players join last slot | Lock session row → first-commit-wins |
| 2 | Concurrency | Approve after capacity full | Safe conflict — terminal with reason "full" |
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
| 409 | `SESSION_FULL` | Buổi chơi đã đầy | Capacity exceeded |
| 409 | `ALREADY_JOINED` | Bạn đã tham gia buổi này | Duplicate join |
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
2. Validate: public? open? future? capacity?
3. Resolve/create guest membership (idempotent)
4. Insert session_roster + charge (session price)
5. Store processed command + outbox event
6. COMMIT → Return venue in joined-person DTO
```

### Approval Transaction

```text
1. Create join_request (UNIQUE active per person/session)
2. Notify host (outbox event)
3. [Host decides]:
   a. Approve: Lock request → lock session → verify status/expiry/capacity → membership/player/charge → COMMIT
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
| 2 | Open join full | No capacity | `SESSION_FULL` |
| 3 | Open join closed | Status=closed | `SESSION_NOT_JOINABLE` |
| 4 | Open join private | Visibility=private | `SESSION_NOT_JOINABLE` |
| 5 | Guest membership created | Non-member join | membership role=guest |
| 6 | Existing member join | Already member | Use existing membership |
| 7 | Banned player join | Banned | `PLAYER_BANNED` |
| 8 | Approval request created | Approval policy | Request status=pending |
| 9 | Duplicate request | Same person/session | Idempotent |
| 10 | Approve happy path | Capacity available | Approved + joined |
| 11 | Approve full | No capacity at decision | Safe conflict "full" |
| 12 | Approve expired | Past expires_at | Safe conflict "expired" |
| 13 | Reject happy path | Admin rejects | Status=rejected |
| 14 | Cancel request | Player cancels | Status=cancelled |
| 15 | Expire job | Expired requests | Batch mark expired |
| 16 | Concurrent last-slot | 2 parallel joins | One success, one full |
| 17 | Paid leave | Player with charge | Financial policy applied |
| 18 | Venue hidden before join | Pre-join DTO | No venue |
| 19 | Venue revealed after join | Post-join DTO | Venue present |
| 20 | Cross-tenant admin spoof | Wrong tenant admin | 403 |

### Integration Tests

| # | Test | Setup | Expected |
|---|------|-------|----------|
| 1 | Open join E2E | Browse → join → verify roster | Full flow |
| 2 | Approval E2E | Request → approve → verify | Full flow |
| 3 | Expiry E2E | Request → wait → expire | Auto-expired |
| 4 | Concurrent final-slot | 10 parallel joins, 1 slot | Exactly 1 joined |

---

## 6. Rollout Plan + Changelog

### Rollout

1. Tenant #1 approval-only mode
2. Internal open-join mode
3. Rate-limit/abuse testing
4. Public beta

### Metrics

- Attempts / success / pending / full / expired
- Approval latency (request → decision)
- Duplicate/conflict rate
- Abuse blocks
- Charge creation failures

### Changelog

| Date | Version | Thay đổi |
|---|---|---|
| 2026-06-18 | v1.0 | Initial BE tech spec (English format) |
| 2026-06-19 | v2.0 | Chuẩn hoá Vietnamese numbered (6 sections), DDL, 12 edge cases, transaction details, 20 tests |
