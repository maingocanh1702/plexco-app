# Feature: Payment Reconciliation — Backend Tech Spec

> **Canonical phase:** P3 (auto-reconcile) · P2 (manual mark-paid)
> **Version:** 1.9a · 2026-07-19
> **Status:** Implementation contract reconciled to TDD v3.1 / current decisions v1.67; B1/schema/code pending design-probe/build slices
> **Implementation:** In progress — core matching/payments-logic đã có; wiring webhook→settle→notify chưa · authority: `../../standards/BUILD-STATUS.md` (Doc status ≠ Implementation status)  
> **Product spec:** `../feature_payment_reconcile.md`
> **References:** `../../product/TDD.md` §3.2/3.6–3.8 · `../../standards/business-rules.md` · `../../standards/decisions.md` DD-25/DD-40/DD-49/DD-51

> **Cập nhật v1.8:** mọi ledger edge dùng composite FK để chứng minh cùng tenant; charge còn bind đúng session/player/membership và reversal bind đúng charge gốc. Migration upgrade phải backfill có kiểm chứng rồi fail-closed trên bất kỳ row lịch sử lệch scope nào.

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

Các parent key này phải land trong cùng migration (hoặc reuse constraint tương đương đã có trên base). Scalar UUID FK không chứng minh hai row cùng tenant/session:

```sql
ALTER TABLE sessions
  ADD CONSTRAINT sessions_id_tenant_uq UNIQUE (id, tenant_id);
ALTER TABLE memberships
  ADD CONSTRAINT memberships_id_tenant_uq UNIQUE (id, tenant_id);
ALTER TABLE players
  ADD CONSTRAINT players_id_tenant_session_membership_uq
    UNIQUE (id, tenant_id, session_id, membership_id),
  ADD CONSTRAINT players_session_tenant_fk
    FOREIGN KEY (session_id, tenant_id) REFERENCES sessions(id, tenant_id),
  ADD CONSTRAINT players_membership_tenant_fk
    FOREIGN KEY (membership_id, tenant_id) REFERENCES memberships(id, tenant_id);

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
  UNIQUE (id, tenant_id),
  UNIQUE (tenant_id, provider, account_fingerprint)
);

CREATE TABLE charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  session_id uuid NOT NULL,
  player_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  amount_due integer NOT NULL CHECK (amount_due >= 0),
  amount_allocated integer NOT NULL DEFAULT 0 CHECK (amount_allocated >= 0),
  status text NOT NULL CHECK (status IN ('open','partial','paid','void')),
  UNIQUE (id, tenant_id),
  UNIQUE (tenant_id, session_id, player_id),
  FOREIGN KEY (session_id, tenant_id)
    REFERENCES sessions(id, tenant_id),
  FOREIGN KEY (membership_id, tenant_id)
    REFERENCES memberships(id, tenant_id),
  FOREIGN KEY (player_id, tenant_id, session_id, membership_id)
    REFERENCES players(id, tenant_id, session_id, membership_id),
  CHECK (amount_allocated <= amount_due)
);

CREATE TABLE bank_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  bank_account_id uuid NOT NULL,
  provider text NOT NULL,
  external_id text NOT NULL,
  amount integer NOT NULL CHECK (amount > 0),
  unallocated_amount integer NOT NULL CHECK (unallocated_amount >= 0),
  occurred_at timestamptz NOT NULL,
  content_enc bytea,
  provider_code_enc bytea,          -- (DD-02) code provider bóc sẵn, normalized (SePay optional; ApiPay không có) — EVIDENCE, không canonical
  raw_payload_enc bytea NOT NULL,
  reconcile_status text NOT NULL CHECK (reconcile_status IN ('pending','matched','partial','unmatched','ignored')),
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id),
  UNIQUE (tenant_id, provider, external_id),
  FOREIGN KEY (bank_account_id, tenant_id)
    REFERENCES bank_accounts(id, tenant_id),
  CHECK (unallocated_amount <= amount)
);

CREATE TABLE payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  bank_transaction_id uuid,
  charge_id uuid NOT NULL,
  amount integer NOT NULL CHECK (amount <> 0),
  -- Canonical enum authoritative in packages/db/schema.ts + migrations:
  --   auto/manual = có bank_transactions row (auto = webhook match; manual = host gán / đối soát CK).
  --   cash = tiền mặt host xác nhận (bank_transaction_id NULL, created_by set); waiver = miễn.
  --   DD-40 mark-paid thủ công: tiền mặt → 'cash'; CK đã ingest → 'manual' (khớp bank txn).
  --   Host-attested "đã CK" chưa có bank_transaction = dedicated source migration (B1), never synthetic bank txn
  --   HOẶC mở enum qua migration — KHÔNG dùng 'cash' cho CK, KHÔNG thêm 'bank_transfer'.
  source text NOT NULL CHECK (source IN ('auto','manual','cash','waiver','reversal')),
  reverses_allocation_id uuid,
  created_by uuid,
  reason_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id, charge_id),
  FOREIGN KEY (bank_transaction_id, tenant_id)
    REFERENCES bank_transactions(id, tenant_id),
  FOREIGN KEY (charge_id, tenant_id)
    REFERENCES charges(id, tenant_id),
  FOREIGN KEY (reverses_allocation_id, tenant_id, charge_id)
    REFERENCES payment_allocations(id, tenant_id, charge_id),
  CHECK (reverses_allocation_id IS NULL OR reverses_allocation_id <> id),
  CHECK (
    (source IN ('auto','manual') AND amount > 0 AND bank_transaction_id IS NOT NULL)
    -- cash/waiver: host-initiated, no bank_transaction row, requires actor
    OR (source IN ('cash','waiver') AND amount > 0 AND bank_transaction_id IS NULL AND created_by IS NOT NULL)
    OR (source = 'reversal' AND amount < 0 AND reverses_allocation_id IS NOT NULL)
  )
);
```

All four ledger tables are tenant-scoped with ENABLE + FORCE RLS using `app.tenant_id`. Composite FKs are the database fence; RLS remains defense-in-depth and must not be treated as referential integrity. Aggregate invariants cannot rely on CHECK constraints alone; ledger service locks rows and validates sums transactionally.

Recommended indexes: pending/unmatched transaction by tenant/received time, open charges by tenant/membership/session, allocations by transaction and charge, partial/paid status.

### 2.1 Additive migration/upgrade contract

Implement as a new migration after the current migration tail; do not rewrite already-applied `0002_tenants_core.sql`/`0003_payments_ledger.sql`. The migration runs as the schema migration owner with visibility over every tenant and is atomic:

1. Lock the seven affected tables against concurrent writes.
2. Backfill only `charges.membership_id IS NULL` from the exact `players` row. Abort if the player is absent or its tenant/session does not equal the charge.
3. Before adding constraints, abort on any historical mismatch: player↔session/membership; charge↔session/player/membership; bank transaction↔bank account; allocation↔transaction/charge; reversal↔original tenant/charge.
4. Add/reuse the candidate keys shown above, add composite FKs as `NOT VALID`, validate every FK, then set `charges.membership_id NOT NULL`. Only after successful validation may the old scalar FKs be dropped.
5. Update `packages/db/schema.ts`, DBML/ERD, RLS invariant inventory and migration tests in the same build slice. A docs-only update does not claim these runtime constraints already exist.

Executable upgrade shape (constraint names are canonical; omit an `ADD` only when the exact candidate key already exists on the implementation base):

```sql
BEGIN;
LOCK TABLE sessions, memberships, players, bank_accounts, charges,
  bank_transactions, payment_allocations IN SHARE ROW EXCLUSIVE MODE;

UPDATE charges c
SET membership_id = p.membership_id
FROM players p
WHERE c.membership_id IS NULL
  AND p.id = c.player_id
  AND p.tenant_id = c.tenant_id
  AND p.session_id = c.session_id;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM players p
    LEFT JOIN sessions s
      ON (s.id, s.tenant_id) = (p.session_id, p.tenant_id)
    LEFT JOIN memberships m
      ON (m.id, m.tenant_id) = (p.membership_id, p.tenant_id)
    WHERE s.id IS NULL OR m.id IS NULL
  ) THEN
    RAISE EXCEPTION 'payment ledger upgrade: player scope mismatch';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM charges c
    LEFT JOIN sessions s
      ON (s.id, s.tenant_id) = (c.session_id, c.tenant_id)
    LEFT JOIN memberships m
      ON (m.id, m.tenant_id) = (c.membership_id, c.tenant_id)
    LEFT JOIN players p
      ON (p.id, p.tenant_id, p.session_id, p.membership_id) =
         (c.player_id, c.tenant_id, c.session_id, c.membership_id)
    WHERE s.id IS NULL OR m.id IS NULL OR p.id IS NULL
  ) THEN
    RAISE EXCEPTION 'payment ledger upgrade: charge scope mismatch';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM bank_transactions bt
    LEFT JOIN bank_accounts ba
      ON (ba.id, ba.tenant_id) = (bt.bank_account_id, bt.tenant_id)
    WHERE ba.id IS NULL
  ) THEN
    RAISE EXCEPTION 'payment ledger upgrade: bank-account scope mismatch';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM payment_allocations pa
    LEFT JOIN bank_transactions bt
      ON (bt.id, bt.tenant_id) = (pa.bank_transaction_id, pa.tenant_id)
    LEFT JOIN charges c
      ON (c.id, c.tenant_id) = (pa.charge_id, pa.tenant_id)
    LEFT JOIN payment_allocations original
      ON (original.id, original.tenant_id, original.charge_id) =
         (pa.reverses_allocation_id, pa.tenant_id, pa.charge_id)
    WHERE c.id IS NULL
       OR (pa.bank_transaction_id IS NOT NULL AND bt.id IS NULL)
       OR (pa.reverses_allocation_id IS NOT NULL AND original.id IS NULL)
  ) THEN
    RAISE EXCEPTION 'payment ledger upgrade: allocation scope mismatch';
  END IF;
END
$$;

ALTER TABLE sessions
  ADD CONSTRAINT sessions_id_tenant_uq UNIQUE (id, tenant_id);
ALTER TABLE memberships
  ADD CONSTRAINT memberships_id_tenant_uq UNIQUE (id, tenant_id);
ALTER TABLE players
  ADD CONSTRAINT players_id_tenant_session_membership_uq
    UNIQUE (id, tenant_id, session_id, membership_id);
ALTER TABLE bank_accounts
  ADD CONSTRAINT bank_accounts_id_tenant_uq UNIQUE (id, tenant_id);
ALTER TABLE bank_transactions
  ADD CONSTRAINT bank_transactions_id_tenant_uq UNIQUE (id, tenant_id);
ALTER TABLE charges
  ADD CONSTRAINT charges_id_tenant_uq UNIQUE (id, tenant_id);
ALTER TABLE payment_allocations
  ADD CONSTRAINT payment_allocations_id_tenant_charge_uq
    UNIQUE (id, tenant_id, charge_id);

ALTER TABLE players
  ADD CONSTRAINT players_session_tenant_fk
    FOREIGN KEY (session_id, tenant_id) REFERENCES sessions(id, tenant_id) NOT VALID,
  ADD CONSTRAINT players_membership_tenant_fk
    FOREIGN KEY (membership_id, tenant_id) REFERENCES memberships(id, tenant_id) NOT VALID;
ALTER TABLE charges
  ADD CONSTRAINT charges_session_tenant_fk
    FOREIGN KEY (session_id, tenant_id) REFERENCES sessions(id, tenant_id) NOT VALID,
  ADD CONSTRAINT charges_membership_tenant_fk
    FOREIGN KEY (membership_id, tenant_id) REFERENCES memberships(id, tenant_id) NOT VALID,
  ADD CONSTRAINT charges_player_scope_fk
    FOREIGN KEY (player_id, tenant_id, session_id, membership_id)
    REFERENCES players(id, tenant_id, session_id, membership_id) NOT VALID;
ALTER TABLE bank_transactions
  ADD CONSTRAINT bank_transactions_account_tenant_fk
    FOREIGN KEY (bank_account_id, tenant_id) REFERENCES bank_accounts(id, tenant_id) NOT VALID;
ALTER TABLE payment_allocations
  ADD CONSTRAINT payment_allocations_transaction_tenant_fk
    FOREIGN KEY (bank_transaction_id, tenant_id)
    REFERENCES bank_transactions(id, tenant_id) NOT VALID,
  ADD CONSTRAINT payment_allocations_charge_tenant_fk
    FOREIGN KEY (charge_id, tenant_id) REFERENCES charges(id, tenant_id) NOT VALID,
  ADD CONSTRAINT payment_allocations_reversal_scope_fk
    FOREIGN KEY (reverses_allocation_id, tenant_id, charge_id)
    REFERENCES payment_allocations(id, tenant_id, charge_id) NOT VALID,
  ADD CONSTRAINT payment_allocations_no_self_reversal_chk
    CHECK (reverses_allocation_id IS NULL OR reverses_allocation_id <> id) NOT VALID;

ALTER TABLE players VALIDATE CONSTRAINT players_session_tenant_fk;
ALTER TABLE players VALIDATE CONSTRAINT players_membership_tenant_fk;
ALTER TABLE charges VALIDATE CONSTRAINT charges_session_tenant_fk;
ALTER TABLE charges VALIDATE CONSTRAINT charges_membership_tenant_fk;
ALTER TABLE charges VALIDATE CONSTRAINT charges_player_scope_fk;
ALTER TABLE bank_transactions VALIDATE CONSTRAINT bank_transactions_account_tenant_fk;
ALTER TABLE payment_allocations VALIDATE CONSTRAINT payment_allocations_transaction_tenant_fk;
ALTER TABLE payment_allocations VALIDATE CONSTRAINT payment_allocations_charge_tenant_fk;
ALTER TABLE payment_allocations VALIDATE CONSTRAINT payment_allocations_reversal_scope_fk;
ALTER TABLE payment_allocations VALIDATE CONSTRAINT payment_allocations_no_self_reversal_chk;
ALTER TABLE charges ALTER COLUMN membership_id SET NOT NULL;

ALTER TABLE players
  DROP CONSTRAINT IF EXISTS players_session_id_fkey,
  DROP CONSTRAINT IF EXISTS players_membership_id_fkey;
ALTER TABLE charges
  DROP CONSTRAINT IF EXISTS charges_session_id_fkey,
  DROP CONSTRAINT IF EXISTS charges_player_id_fkey,
  DROP CONSTRAINT IF EXISTS charges_membership_id_fkey;
ALTER TABLE bank_transactions
  DROP CONSTRAINT IF EXISTS bank_transactions_bank_account_id_fkey;
ALTER TABLE payment_allocations
  DROP CONSTRAINT IF EXISTS payment_allocations_bank_transaction_id_fkey,
  DROP CONSTRAINT IF EXISTS payment_allocations_charge_id_fkey,
  DROP CONSTRAINT IF EXISTS payment_allocations_reverses_allocation_id_fkey;
COMMIT;
```

---

## 3. Durable webhook ingest

Endpoint examples: `POST /webhook/sepay/:token`, `POST /webhook/apipay/:token`.

1. Resolve bank account from opaque token.
2. Call the canonical provider verifier from Connector Onboarding **before JSON parse/persist**, using the exact raw request bytes:
   - SePay `hmac_sha256`: require `X-SePay-Timestamp` within ±300s and `X-SePay-Signature: sha256=<hex>` equal (constant-time) to HMAC-SHA256(`{timestamp}.{raw_body}`); missing/malformed/stale/bad signature = 401 and **never** tries an alternate mode.
   - SePay explicit `api_key` fallback: accept only exact `Authorization: Apikey <key>` with constant-time comparison; this mode is configured on the endpoint and is never selected because HMAC failed.
   - ApiPay: independently verify `ApiPay-Signature = HMAC-SHA256(raw_body, per-webhook secret)`; never reuse SePay timestamp/header rules.
   Then verify opaque route token and provider account fingerprint agree. No local "generic HMAC" implementation is allowed.
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

  # --- Pay-code recognition pipeline (DD-02, P4) ---
  normalize(memo)                       # uppercase + bỏ dấu; giữ '-'/space
  cands = discoverPayCodeCandidates(memo)   # mọi split prefix{3,4}×'-?'×suffix{4}; KHÔNG loại skipCodes
  classes = batchResolve(cands)         # narrow SECURITY DEFINER → own|foreign|none (full-issued = registry.locked_at NOT NULL + pay_code match)
  memo-level precedence:                # hard-token THẮNG name-fallback
    any hard (foreign / own-prefix+unissued / dash-unresolved / >1 full-issued interpretation / error) → UNMATCHED
    ≥2 distinct own                                                                    → UNMATCHED
    exactly 1 own → membership := resolve(own); follow merged_into_membership_id (guards)
    only none / no candidate → fall through to name+amount+date (P3)

  # --- Provider-code evidence cross-check (invariant; reconcile is async) ---
  # bank_transactions.provider_code_enc = normalized code provider bóc sẵn (SePay optional; ApiPay không có).
  if bank_transaction.provider_code IS NOT NULL:
    if provider_code KHÔNG khớp candidate đã resolve (suffix/prefix/tenant) HOẶC không nằm trong content
        → UNMATCHED (fail-closed; không tự chọn bên nào)   # provider code chỉ là EVIDENCE, không canonical

  # --- Allocation plan (ledger canonical) ---
  plan = planIncomingAllocations(openDebts(membership), amount)   # FIFO priced debts; keep proven part
    exact/over/under(partial)/unknown-fee-trailing → applyAllocations(plan) (over → hold overpay)
    unknown-fee-first / already-paid               → mark unmatched with reason
```

P3 matching uses name + amount + date only. **DD-02 pay-code path (above) là P4** — parser/resolver/`planIncomingAllocations` sống sau feature flag tới khi P4 rollout; memo only-có-code chưa phát trước P4. **Contract này là canonical; §8 Testing chỉ tham chiếu lại.**

No automatic `fee × N` split without identified people/charges. Confidence threshold must come from calibration fixtures; it is configuration/versioned policy, not an unexplained hard-coded 88%.

---

## 5. Ledger service

`applyAllocations` locks the bank transaction (when present), target charges and reversed allocation in stable ID order.

Validation:

- Effective bank allocations after change remain within `[0, transaction.amount]`.
- Effective charge allocations remain within `[0, charge.amount_due]`.
- Manual/auto source requires bank transaction; cash/waiver requires authorized actor.
- Reversal points to a positive allocation on the **same tenant and charge** and cannot exceed its remaining effective amount.
- Tenant IDs match across every parent edge; a charge's player must also match its exact session and membership.

After inserts, recompute/update `amount_allocated`, `unallocated_amount`, charge status and transaction reconcile status under the same transaction. Insert outbox events before commit.

Idempotency keys:

- Webhook: `(tenant, provider, external_id)`.
- Worker attempt: job unique key per transaction/version.
- Manual action: `commandId` in `processed_commands`.
- Reversal: unique command + target allocation checks.

---

## 5b. Manual mark-paid (DD-40 ✅ — every tier)

Host đánh dấu player **đã trả** thủ công — có ở **mọi tier** (capability `payment_mark_manual`), độc lập với auto-reconcile (`payment_reconcile_auto`, chỉ `host_pro`).

- **Multi-select / tap:** host chọn **1 hoặc nhiều** player trong một kèo, chọn method **tiền mặt** (`cash`) hoặc **CK** — CK đã ingest thành một `bank_transactions` row (free tier không có webhook thì CK phải được ingest trước, hoặc dùng đường impl-mở bên dưới).
- **Ledger write:** với mỗi charge được chọn, `ledger.applyAllocations` INSERT một `payment_allocations` **host-initiated** + cập nhật `charges.amount_allocated`/`status`:
  - **tiền mặt →** `source='cash'`, `bank_transaction_id = NULL`, `created_by = host actor`, `amount = remaining amount_due` hoặc số nhập.
  - **CK →** `source='manual'`, `bank_transaction_id` = row `bank_transactions` khớp (không tạo bank txn giả).
  - **CK chưa có `bank_transaction`** (host tự xác nhận) = B1 dedicated allocation source migration; `bank_transaction_id=NULL`, `created_by` + opaque evidence bắt buộc. Trước migration reject `ATTESTED_TRANSFER_UNSUPPORTED`; **không synthetic bank transaction**, không dùng `cash|manual`.
  - Cùng invariants sum như §5 (không mark quá `amount_due`).
- **DD-25 preview + 2-pha confirm:** mark-paid là **human-initiated money mutation** → phải **preview** (danh sách player + method + tổng tiền) → **confirm** (single-slot fail-closed, DD-24) trước khi persist. Áp cho cả tap đơn lẫn multi-select.
- **Idempotent:** một `commandId` cho cả batch (ghi `processed_commands`); retry trả kết quả cũ, không double-allocate. Mỗi (charge, commandId) chỉ tạo một allocation.
- **Audit + confirm player:** ghi actor/method/reason; sau markPaid → outbox `payment.settled` → **xác nhận tự động tới player** (FR-6.2, `feature_notifications_reminders_tech.md`), best-effort, không chặn.
- **Không** cần bank webhook; **không** đụng auto-matcher. Auto-reconcile CK (webhook match tên+tiền+ngày) vẫn là đường riêng (§3–§5), gated `payment_reconcile_auto` = `host_pro`.

---

## 6. API/command contract

| Interface | Auth | Result |
|---|---|---|
| `/unmatched` | TenantAdmin | Transactions with remainder + safe redacted candidates |
| `POST /transactions/:id/allocations` | TenantAdmin + CSRF/session | One or more manual allocations (matched to a bank txn) |
| `POST /sessions/:id/mark-paid` | TenantAdmin + CSRF/session | Multi-select preview→confirm. `cash`→`source='cash'`; ingested bank transfer→`source='manual'` + `bankTransactionId`; attested/un-ingested→B1 dedicated source or reject `ATTESTED_TRANSFER_UNSUPPORTED` until migration |
| `POST /allocations/:id/reverse` | TenantAdmin + reason | Immutable reversal |
| `/cash` / cash endpoint | TenantAdmin | Cash allocation against charge (single) |
| Worker reconcile | System job | Auto allocations or unmatched reason (`host_pro`) |

Manual request includes command ID and allocation array `{chargeId, amount}` (hoặc `playerIds` cho mark-paid multi-select). Server ignores tenant/actor supplied in body and derives both from auth context.

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
| `POST /sessions/:id/mark-paid` | 30/min per account (multi-select batch, DD-40) |
| `POST /allocations/:id/reverse` | 30/min per account |
| `POST /cash` | 30/min per account |
| `GET /unmatched` | 60/min per account |
| `PATCH /bank-accounts/:id/primary` | **5/min per account; max 2 changes / 30 days** |

Error codes: `INVALID_WEBHOOK_SECRET`, `ACCOUNT_MISMATCH`, `DUPLICATE_TXN` (200), `UNMATCHED`, `ALLOCATION_EXCEEDS_FUNDS`, `CHARGE_ALREADY_SETTLED`, `REVERSAL_EXCEEDS_EFFECTIVE`, `TENANT_SUSPENDED` for admin actions only, `STK_CHANGE_PENDING` (existing pending not yet applied/cancelled), `STK_CHANGE_RATE_LIMITED` (exceeded 2/30d), `RATE_LIMITED` (429).

### DD-49 correction/refund core (storage design-probe required)

1. Lock player/session canonical charge aggregate and load immutable obligation + allocation entries.
2. Compute preview from one `effectiveAmountDue/effectiveBalance` helper; no call site re-derives totals.
3. Price change: append signed obligation adjustment or grandfather. Allocation reversal is only for reversing received money.
4. Refund: record requested/approved/executed state + opaque external reference; append linked allocation reversal only after the real refund disposition being represented. Never mutate/delete original entries.
5. Rejoin reuses the shared DD-49 disposition from session service: outcome active→carry-over if not refunded or append one idempotent refunded lifecycle; full→waitlisted keeps non-refunded history or defers refunded lifecycle until activation. Never duplicate the `charges` row.
6. Schema/API names, idempotency keys and participation-lifecycle shape must come from design-probe before migration; current UNIQUE `(tenant,session,player)` is an explicit gate.

---

## 7. Concurrency and failure handling

- Lock order: bank transaction → charges sorted by UUID → allocation being reversed.
- Use short transactions; external notification never runs inside ledger transaction.
- Worker retry is at-least-once and idempotent.
- Sweeper finds old `pending` transactions with no live job and re-enqueues.
- Suspended tenants always ingest; auto-settle/auto-notify are OFF fail-closed under DD-51/PAY-OQ-2. Enabling later requires a new decision + telemetry evidence.
- Projector failure does not roll back settlement; outbox retries notification.

---

## 8. Testing

### Unit

- Provider normalization/synthetic ID.
- Name/date/amount candidate generation including Vietnamese normalization.
- FIFO ordering and partial plans.
- Ambiguous multi-person returns manual, never auto split.
- Ledger sum/reversal/state derivation.
- **Pay-code resolver + allocation (DD-02 — assert the §4 worker contract; full spec `../../dd-02-paycode-analysis.md`):** `discoverPayCodeCandidates` → `batchResolve` (full-issued ⟺ `registry.locked_at NOT NULL` + `pay_code` match) → memo-level precedence → `planIncomingAllocations`. Fixtures:
  - `THANH TOAN`; `PAYMENT` (own vs non-own `PAY`); `BMT7Q2B` unissued → hard; foreign full-issued → hard; `ABC-7Q2A` foreign dash → hard; `BMTRANS` noise → `none`; `BMT-RANS` → hard; full-issued token in `skipCodes` → resolve (issued wins); `BMT7Q2A`/`BMT-7Q2A` both accepted; prefix-change-before-first-issuance (`BMT9K2P` none / `BMT-9K2P` hard); unknown-fee 100k→unknown pay 150k → allocate 100k keep 50k; unknown-fee-first → unmatched; concurrent prefix claim → 1 tx wins; lowercase/all-digit CHECK reject; `merged` → follow tombstone.

### Integration

- SePay exact-auth fixtures: valid timestamp/raw-body signature passes; reserialized body, missing/malformed `sha256=`, stale/future timestamp or bad HMAC returns 401 before durable row/job. HMAC-configured endpoint never downgrades even when a valid API key is also supplied; explicit fallback accepts only `Authorization: Apikey <key>`.
- ApiPay exact-auth fixtures use its own raw-body `ApiPay-Signature`; SePay headers do not authenticate ApiPay and vice versa.
- Raw + job commit before ACK; injected crash before commit yields no ACK.
- Injected crash after ACK is recovered by durable job/sweeper.
- Concurrent duplicate webhooks create one transaction.
- Concurrent auto/manual/cash cannot over-allocate.
- **(DD-02) SePay `provider_code` ↔ content mismatch** (provider bóc code khác với code trong `content`/prefix/tenant) → **hard-unmatched** (fail-closed, không tự chọn bên nào); ApiPay (không có provider code) → chỉ dựa content resolver.
- **Mark-paid (DD-40):** tiền mặt → allocation `source='cash'`+`created_by`, không tạo bank txn giả; CK → allocation `source='manual'` khớp một `bank_transactions` row; enum không có `bank_transfer`; multi-select batch idempotent theo `commandId` (retry không double); DD-25 preview→confirm bắt buộc; markPaid → 1 confirm intent tới player.
- **B1 attested transfer:** before migration → `ATTESTED_TRANSFER_UNSUPPORTED`; after migration → dedicated source, NULL bank txn, actor+opaque evidence; never synthetic bank transaction or `cash|manual` fallback.
- **DD-49 correction:** price up/down append obligation adjustment; refund reversal links original allocation; carry-over rejoin creates no financial row. Refunded rejoin creates one idempotent lifecycle **only with active outcome**; full→waitlisted creates none until activation. Unknown state fails closed. Every assertion reads the canonical balance helper.
- Partial, overpay, multi-charge and multi-person manual allocation totals.
- Reversal restores bank remainder/charge status exactly.
- Cash/waiver requires actor and no fake bank transaction.
- **Schema-upgrade fixture:** a clean legacy database upgrades atomically; a NULL charge membership is backfilled only from its exact player. Any legacy player/charge/bank/allocation scope mismatch aborts and leaves no partial constraint set.
- **Constraint-parity fixture:** query `pg_constraint` after migration and require every candidate key/composite FK from §2.1; Drizzle schema + DBML expose the same keys. A scalar-only FK is a failure.
- **Cross-tenant direct-DML fixtures:** tenant A cannot create a player against tenant B session/membership, a charge against tenant B parents, a bank transaction against tenant B account, or an allocation against tenant B transaction/charge — even when each scalar UUID exists.
- **Same-tenant cross-session fixture:** a charge cannot combine a player from session X with session Y or a membership other than that player's membership.
- **Reversal scope fixtures:** cross-tenant original and same-tenant/different-charge original both fail at the composite FK; self-reversal fails its CHECK. Valid same-charge reversal still passes service sum/remaining validation.
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
- [ ] Composite parent keys/FKs match §2.1; upgrade and cross-tenant/cross-session negative tests pass.
- [ ] Tenant isolation and authorization tests pass.
- [ ] Product acceptance criteria in `../feature_payment_reconcile.md` pass.

---

## Changelog

| Date | Version | Change |
|---|---|---|
| 2026-07-19 | v1.9a | Metadata sweep (index v2.35): thêm trường **Implementation** đồng bộ BUILD-STATUS (In progress). Không đổi contract. |
| 2026-07-19 | v1.9 | **DD-49 timing mirror:** refunded rejoin appends an idempotent lifecycle only when active; full→waitlisted defers until activation. No duplicate `charges` row or runtime change. |
| 2026-07-17 | v1.8 | **Ledger referential-integrity closure:** adds executable candidate keys and composite same-tenant FKs across players, charges, bank accounts/transactions and allocations; charge is bound to its exact session/player/membership and reversal to its original charge. Pins atomic legacy backfill/preflight/validation plus cross-tenant, cross-session and upgrade-parity tests. |
| 2026-07-17 | v1.7 | **Webhook-auth closure:** durable ingest delegates to exact provider verifiers; SePay timestamp/raw-body `sha256=` HMAC, ±300s and no-downgrade are mandatory, with explicit exact API-key fallback; ApiPay remains separate raw-body HMAC. |
| 2026-07-16 | v1.6 | **Full DD-49/B1 propagation:** append-only obligation correction + refund/rejoin core, canonical balance helper, live uniqueness design gate; dedicated attested-transfer source and hard ban on synthetic bank transactions; suspended ingest ON / automation OFF. |
| 2026-07-10 | v1.5 | **Review fixes → canonical ledger.** Bỏ `source='bank_transfer'` khỏi enum/CHECK — khớp `packages/db/schema.ts` `('auto','manual','cash','waiver','reversal')`. Mark-paid thủ công: tiền mặt → `source='cash'`; CK đã ingest → `source='manual'` (khớp một `bank_transactions`). CK host tự xác nhận chưa có bank txn = impl còn mở (synthetic manual bank_txn / enum migration), không dùng `cash`. Cập nhật header, §2 schema, §5b, API mapping, tests. |
| 2026-07-10 | v1.4 | **DD-40 ✅:** thêm §5b **manual mark-paid mọi tier** (multi-select, idempotent theo `commandId`, DD-25 preview+confirm); endpoint `POST /sessions/:id/mark-paid` + rate limit + tests. Auto-reconcile CK gated `payment_reconcile_auto`=`host_pro`. Pointer DD-39 gender-pricing cho charge. |
| 2026-06-20 | v1.3 | Clarify provider webhooks are exempt from app-level user mutation limits but still require edge per-token/IP burst cap and body-size cap |
| 2026-06-19 | v1.2 | Fold AUDIT G1 (STK change delay: schema + API + rate limit) and G3 (standardized rate limits) |
| 2026-06-18 | v1.0 | Initial legacy backend spec |
