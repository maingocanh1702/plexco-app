-- ============================================================================
-- 0007_billing.sql
-- Host subscription billing. Separate ledger from player payment ledger.
-- Source: feature_billing_lifecycle_tech §2, DD-03, BL-BIL-1..3.
-- Planes:
--   plans, billing_transactions, billing_allocations  -> PLATFORM (no tenant RLS)
--   subscriptions, subscription_invoices, billing_overrides -> tenant_id present
--     (subscriptions/subscription_invoices RLS-scoped in 0009; overrides = platform admin)
-- ============================================================================

-- Versioned plan catalog (PLATFORM).
CREATE TABLE plans (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_key     text NOT NULL CHECK (plan_key IN ('free_web','telegram','plus_channel','all_channels')),
  version      integer NOT NULL,
  price        integer NOT NULL,                    -- minor units (VND)
  currency     text NOT NULL DEFAULT 'VND',
  interval     text NOT NULL DEFAULT 'monthly',
  limits       jsonb NOT NULL DEFAULT '{}',
  entitlements jsonb NOT NULL DEFAULT '{}',
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_key, version)
);

-- One subscription per tenant (TENANT-scoped).
CREATE TABLE subscriptions (
  tenant_id             uuid PRIMARY KEY REFERENCES tenants(id),
  plan_key              text NOT NULL,
  plan_version          integer NOT NULL,
  selected_extra_channel text
                        CHECK (selected_extra_channel IN ('zalo','messenger') OR selected_extra_channel IS NULL),
  status                text NOT NULL DEFAULT 'trialing'
                        CHECK (status IN ('trialing','active','past_due','suspended','cancelled')),
  -- free_web (price=0): row created with status='active', trial_end/grace_end NULL,
  -- no invoices, lifecycle job skips it (BL-BIL-1). Free identified via plans.price=0.
  trial_end             timestamptz,
  period_start          timestamptz NOT NULL,
  period_end            timestamptz NOT NULL,
  grace_end             timestamptz,
  version               integer NOT NULL DEFAULT 1,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (plan_key, plan_version) REFERENCES plans(plan_key, version)
);

CREATE TABLE subscription_invoices (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  invoice_code text NOT NULL UNIQUE,
  amount_due  integer NOT NULL,
  amount_paid integer NOT NULL DEFAULT 0,
  status      text NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','paid','partial','overdue','cancelled')),
  due_at      timestamptz NOT NULL,
  period_key  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, period_key)
);

-- Platform-side received subscription payments (PLATFORM, no tenant RLS).
CREATE TABLE billing_transactions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider    text NOT NULL,
  external_id text NOT NULL,
  amount      integer NOT NULL,
  content_enc text,
  status      text NOT NULL DEFAULT 'received',
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, external_id)
);

CREATE TABLE billing_allocations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES billing_transactions(id),
  invoice_id     uuid NOT NULL REFERENCES subscription_invoices(id),
  amount         integer NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Manual billing overrides (platform admin only — no app grant).
CREATE TABLE billing_overrides (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id),
  actor_id   uuid NOT NULL,
  reason     text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
