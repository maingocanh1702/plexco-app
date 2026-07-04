-- ============================================================================
-- 0003_payments_ledger.sql
-- Money ledger (TENANT-private). Append-only, fail-closed.
-- Source: feature_payment_reconcile_tech §2, TDD §3.2 ledger invariants.
-- Invariants: INV-4/7/10, BL-PAY-1..10.
--   * amount_due >= 0; amount_allocated <= amount_due
--   * effective allocation of a bank txn in [0, amount]; unallocated <= amount
--   * auto/manual allocations are positive and require a bank_transaction
--   * cash/waiver allocations have no bank txn but require an actor (created_by)
--   * reversal allocations are negative and reference the original allocation
--   * never UPDATE/DELETE audited ledger rows — correct with reversal entries
-- ============================================================================

CREATE TABLE bank_accounts (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid NOT NULL REFERENCES tenants(id),
  provider                 text NOT NULL CHECK (provider IN ('sepay','apipay')),
  account_number_enc       bytea NOT NULL,                 -- KMS
  account_fingerprint      text NOT NULL,                  -- deterministic, for routing/verify
  webhook_token            text NOT NULL UNIQUE,
  webhook_secret_enc       bytea NOT NULL,                 -- KMS
  active                   boolean NOT NULL DEFAULT true,
  -- G1 / BL-PAY-10: STK change confirmation delay
  pending_account_number_enc bytea,
  pending_account_holder   text,
  pending_change_at        timestamptz,
  pending_expires_at       timestamptz,                    -- pending_change_at + 24h
  pending_change_by        uuid,
  stk_change_count_30d     integer NOT NULL DEFAULT 0,
  -- connector onboarding (feature_connector_onboarding_tech §2)
  provider_connection_id   uuid,                           -- FK added in 0004 (after table exists)
  provider_webhook_id      text,
  provider_bank_ref        text,
  auto_registered          boolean NOT NULL DEFAULT false,
  webhook_status           text NOT NULL DEFAULT 'connecting'
                           CHECK (webhook_status IN ('connecting','registered','active','drift','error','revoked')),
  last_register_at         timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider, account_fingerprint)
);
CREATE INDEX idx_bank_accounts_tenant ON bank_accounts(tenant_id);

CREATE TABLE charges (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  session_id       uuid NOT NULL REFERENCES sessions(id),
  player_id        uuid NOT NULL REFERENCES players(id),
  membership_id    uuid REFERENCES memberships(id),
  amount_due       integer NOT NULL CHECK (amount_due >= 0),
  amount_allocated integer NOT NULL DEFAULT 0 CHECK (amount_allocated >= 0),
  status           text NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open','partial','paid','void')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, session_id, player_id),
  CHECK (amount_allocated <= amount_due)
);
CREATE INDEX idx_charges_tenant_status ON charges(tenant_id, status);
CREATE INDEX idx_charges_session ON charges(session_id);

CREATE TABLE bank_transactions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id),
  bank_account_id    uuid NOT NULL REFERENCES bank_accounts(id),
  provider           text NOT NULL,
  external_id        text NOT NULL,
  amount             integer NOT NULL CHECK (amount > 0),
  unallocated_amount integer NOT NULL CHECK (unallocated_amount >= 0),
  occurred_at        timestamptz NOT NULL,
  content_enc        bytea,
  raw_payload_enc    bytea NOT NULL,                       -- durable raw before ACK (BL-PAY-1)
  reconcile_status   text NOT NULL DEFAULT 'pending'
                     CHECK (reconcile_status IN ('pending','matched','partial','unmatched','ignored')),
  received_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider, external_id),               -- idempotency (BL-PAY-4)
  CHECK (unallocated_amount <= amount)
);
CREATE INDEX idx_bank_txn_reconcile ON bank_transactions(tenant_id, reconcile_status);

CREATE TABLE payment_allocations (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL REFERENCES tenants(id),
  bank_transaction_id    uuid REFERENCES bank_transactions(id),  -- NULL for cash/waiver
  charge_id              uuid NOT NULL REFERENCES charges(id),
  amount                 integer NOT NULL CHECK (amount <> 0),    -- signed; reversal negative
  source                 text NOT NULL CHECK (source IN ('auto','manual','cash','waiver','reversal')),
  reverses_allocation_id uuid REFERENCES payment_allocations(id),
  created_by             uuid,                               -- actor for cash/waiver/manual
  reason_code            text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (source IN ('auto','manual') AND amount > 0 AND bank_transaction_id IS NOT NULL)
    OR (source IN ('cash','waiver') AND amount > 0 AND bank_transaction_id IS NULL AND created_by IS NOT NULL)
    OR (source = 'reversal' AND amount < 0 AND reverses_allocation_id IS NOT NULL)
  )
);
CREATE INDEX idx_alloc_charge ON payment_allocations(charge_id);
CREATE INDEX idx_alloc_bank_txn ON payment_allocations(bank_transaction_id);
