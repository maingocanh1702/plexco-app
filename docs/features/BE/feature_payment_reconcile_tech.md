# Feature: Payment Reconciliation — Backend Tech Spec

> **Canonical phase:** P3  
> **Version:** 1.3 · 2026-06-20
> **Status:** Implementation contract aligned with TDD v2.1  
> **Product spec:** `../feature_payment_reconcile.md`  
> **References:** `../../product/TDD.md` §3.2/3.6–3.8 · `../../standards/business-rules.md`

---

## 1. Components

```text
webhook adapter
  → authenticate + normalize provider payload
  → durable ingest transaction
  → pg-boss/outbox reconcile job
  → tenant-scoped reconcile worker
  → matching(core) proposes allocation plan
  → ledger service validates/locks/applies
  → outbox payment.allocated/payment.settled
  → notification/projectors (P4+)
```

Provider adapters never mark a player paid directly. Matching is pure proposal logic; ledger service is the only writer of allocations/charge status.

---

## 2. Schema

```sql
CREATE TABLE bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  provider text NOT NULL,
  account_number_enc bytea NOT NULL,
  account_fingerprint text NOT NULL,
  webhook_token text NOT NULL UNIQUE,
  webhook_secret_enc bytea NOT NULL,
  active boolean NOT NULL DEFAULT true,
  -- G1: STK change confirmation delay (AUDIT G1, BL-PAY-10)
  pending_account_number_enc bytea,
  pending_account_holder text,
  pending_change_at timestamptz,
  pending_expires_at timestamptz,     -- pending_change_at + 24h
  pending_change_by uuid,
  stk_change_count_30d integer NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, provider, account_fingerprint)
);

CREATE TABLE charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  session_id uuid NOT NULL REFERENCES sessions(id),
  player_id uuid NOT NULL REFERENCES players(id),
  membership_id uuid,
  amount_due integer NOT NULL CHECK (amount_due >= 0),
  amount_allocated integer NOT NULL DEFAULT 0 CHECK (amount_allocated >= 0),
  status text NOT NULL CHECK (status IN ('open','partial','paid','void')),
  UNIQUE (tenant_id, session_id, player_id),
  CHECK (amount_allocated <= amount_due)
);

CREATE TABLE bank_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  bank_account_id uuid NOT NULL REFERENCES bank_accounts(id),
  provider text NOT NULL,
  external_id text NOT NULL,
  amount integer NOT NULL CHECK (amount > 0),
  unallocated_amount integer NOT NULL CHECK (unallocated_amount >= 0),
  occurred_at timestamptz NOT NULL,
  content_enc bytea,
  raw_payload_enc bytea NOT NULL,
  reconcile_status text NOT NULL CHECK (reconcile_status IN ('pending','matched','partial','unmatched','ignored')),
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider, external_id),
  CHECK (unallocated_amount <= amount)
);

CREATE TABLE payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  bank_transaction_id uuid REFERENCES bank_transactions(id),
  charge_id uuid NOT NULL REFERENCES charges(id),
  amount integer NOT NULL CHECK (amount <> 0),
  source text NOT NULL CHECK (source IN ('auto','manual','cash','waiver','reversal')),
  reverses_allocation_id uuid REFERENCES payment_allocations(id),
  created_by uuid,
  reason_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (source IN ('auto','manual') AND amount > 0 AND bank_transaction_id IS NOT NULL)
    OR (source IN ('cash','waiver') AND amount > 0 AND bank_transaction_id IS NULL AND created_by IS NOT NULL)
    OR (source = 'reversal' AND amount < 0 AND reverses_allocation_id IS NOT NULL)
  )
);
```

All four tables are tenant-scoped with ENABLE + FORCE RLS using `app.tenant_id`. Aggregate invariants cannot rely on CHECK constraints alone; ledger service locks rows and validates sums transactionally.

Recommended indexes: pending/unmatched transaction by tenant/received time, open charges by tenant/membership/session, allocations by transaction and charge, partial/paid status.

---

## 3. Durable webhook ingest

Endpoint examples: `POST /webhook/sepay/:token`, `POST /webhook/apipay/:token`.

1. Resolve bank account from opaque token.
2. Timing-safe verify secret/HMAC and verify account fingerprint.
3. Normalize provider payload and external ID; synthesize stable ID if absent.
4. Begin DB transaction with tenant context.
5. Insert `bank_transactions`; on duplicate return existing ID.
6. Enqueue pg-boss job using same DB transaction or insert reconcile outbox row atomically.
7. Commit, then return 200.

Never ACK a newly accepted transaction if step 5–6 has not committed. Duplicate returns 200 without a second job. Payload/secret errors use stable JSON errors and do not log sensitive fields.

---

## 4. Reconcile worker

Input: `{tenantId, bankTransactionId}`.

```text
withTenant(tenantId)
  lock bank_transaction FOR UPDATE
  if terminal and unallocated=0 → no-op
  load eligible charges in deterministic order
  core matcher returns candidates + evidence
  if exactly one safe plan → applyAllocations()
  else mark partial/unmatched with reason
```

P3 matching uses name + amount + date. Pay-code parser may exist behind a disabled feature flag but memo only-có-code is not issued until P4 rollout.

No automatic `fee × N` split without identified people/charges. Confidence threshold must come from calibration fixtures; it is configuration/versioned policy, not an unexplained hard-coded 88%.

---

## 5. Ledger service

`applyAllocations` locks the bank transaction (when present), target charges and reversed allocation in stable ID order.

Validation:

- Effective bank allocations after change remain within `[0, transaction.amount]`.
- Effective charge allocations remain within `[0, charge.amount_due]`.
- Manual/auto source requires bank transaction; cash/waiver requires authorized actor.
- Reversal points to a positive allocation and cannot exceed its remaining effective amount.
- Tenant IDs match across all rows.

After inserts, recompute/update `amount_allocated`, `unallocated_amount`, charge status and transaction reconcile status under the same transaction. Insert outbox events before commit.

Idempotency keys:

- Webhook: `(tenant, provider, external_id)`.
- Worker attempt: job unique key per transaction/version.
- Manual action: `commandId` in `processed_commands`.
- Reversal: unique command + target allocation checks.

---

## 6. API/command contract

| Interface | Auth | Result |
|---|---|---|
| `/unmatched` | TenantAdmin | Transactions with remainder + safe redacted candidates |
| `POST /transactions/:id/allocations` | TenantAdmin + CSRF/session | One or more manual allocations |
| `POST /allocations/:id/reverse` | TenantAdmin + reason | Immutable reversal |
| `/cash` / cash endpoint | TenantAdmin | Cash allocation against charge |
| Worker reconcile | System job | Auto allocations or unmatched reason |

Manual request includes command ID and allocation array `{chargeId, amount}`. Server ignores tenant/actor supplied in body and derives both from auth context.

### STK change endpoints (G1)

| Interface | Auth | Result |
|---|---|---|
| `PATCH /bank-accounts/:id/primary` | TenantOwner | Set pending change; delay 24h; notify all channels |
| `DELETE /bank-accounts/:id/pending-change` | TenantOwner | Cancel pending; keep current STK |
| `GET /bank-accounts/:id/pending-change` | TenantAdmin | View pending change status |

### Rate limits (G3 — BL-SEC-5)

| Endpoint | Limit |
|----------|-------|
| `POST /webhook/sepay/:token` | Không áp app-level user limit; edge per-token/IP burst cap + body-size cap theo deployment-infra §6 |
| `POST /webhook/apipay/:token` | Không áp app-level user limit; edge per-token/IP burst cap + body-size cap theo deployment-infra §6 |
| `POST /transactions/:id/allocations` | 60/min per account |
| `POST /allocations/:id/reverse` | 30/min per account |
| `POST /cash` | 30/min per account |
| `GET /unmatched` | 60/min per account |
| `PATCH /bank-accounts/:id/primary` | **5/min per account; max 2 changes / 30 days** |

Error codes: `INVALID_WEBHOOK_SECRET`, `ACCOUNT_MISMATCH`, `DUPLICATE_TXN` (200), `UNMATCHED`, `ALLOCATION_EXCEEDS_FUNDS`, `CHARGE_ALREADY_SETTLED`, `REVERSAL_EXCEEDS_EFFECTIVE`, `TENANT_SUSPENDED` for admin actions only, `STK_CHANGE_PENDING` (existing pending not yet applied/cancelled), `STK_CHANGE_RATE_LIMITED` (exceeded 2/30d), `RATE_LIMITED` (429).

---

## 7. Concurrency and failure handling

- Lock order: bank transaction → charges sorted by UUID → allocation being reversed.
- Use short transactions; external notification never runs inside ledger transaction.
- Worker retry is at-least-once and idempotent.
- Sweeper finds old `pending` transactions with no live job and re-enqueues.
- Suspended tenants always ingest. Reconcile pause/continue is policy-controlled; raw records remain recoverable.
- Projector failure does not roll back settlement; outbox retries notification.

---

## 8. Testing

### Unit

- Provider normalization/synthetic ID.
- Name/date/amount candidate generation including Vietnamese normalization.
- FIFO ordering and partial plans.
- Ambiguous multi-person returns manual, never auto split.
- Ledger sum/reversal/state derivation.

### Integration

- Raw + job commit before ACK; injected crash before commit yields no ACK.
- Injected crash after ACK is recovered by durable job/sweeper.
- Concurrent duplicate webhooks create one transaction.
- Concurrent auto/manual/cash cannot over-allocate.
- Partial, overpay, multi-charge and multi-person manual allocation totals.
- Reversal restores bank remainder/charge status exactly.
- Cash/waiver requires actor and no fake bank transaction.
- Tenant A cannot reference tenant B transaction/charge.
- Suspended tenant ingestion remains available.
- Outbox event emitted exactly once per command and projector can retry.

### Load

Webhook → durable ACK and reconcile → settled p99 targets from TDD; burst testing must include duplicate and same-charge contention.

---

## 9. Rollout and monitoring

1. Add ledger tables/RLS/indexes.
2. Backfill/import tenant #1 with explicit legacy provenance.
3. Shadow ingest provider payload without auto-allocation; compare matcher proposals.
4. Enable auto-match for calibrated safe cases.
5. Enable manual/cash/reversal commands.
6. Cut webhook and monitor unmatched/duplicate/error rates.

Metrics: durable ACK latency, reconcile lag, auto-match rate by policy version, unmatched age, unallocated value, reversal rate, allocation conflicts and queue retries. Logs contain IDs/reason codes, never raw bank content/account/secret.

---

## 10. Definition of Done

- [ ] Schema/RLS/ledger invariants implemented.
- [ ] Durable ingest crash tests pass.
- [ ] Partial/overpay/multi-person/cash/reversal tests pass.
- [ ] No auto split on ambiguous amount-only input.
- [ ] Tenant isolation and authorization tests pass.
- [ ] Product acceptance criteria in `../feature_payment_reconcile.md` pass.

---

## Changelog

| Date | Version | Change |
|---|---|---|
| 2026-06-20 | v1.3 | Clarify provider webhooks are exempt from app-level user mutation limits but still require edge per-token/IP burst cap and body-size cap |
| 2026-06-19 | v1.2 | Fold AUDIT G1 (STK change delay: schema + API + rate limit) and G3 (standardized rate limits) |
| 2026-06-18 | v1.0 | Initial legacy backend spec |
