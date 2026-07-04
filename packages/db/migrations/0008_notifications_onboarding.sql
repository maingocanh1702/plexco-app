-- ============================================================================
-- 0008_notifications_onboarding.sql
-- Reminder/confirmation pipeline + tenant onboarding runs.
-- Source: feature_notifications_reminders_tech §2, feature_web_auth_onboarding_tech §2.
-- Invariants: BL-NTF-1..3 (anti-spam, settled-only confirm, MSG 24h window),
--             INV-6 (idempotent via intent_key/delivery_key).
-- ============================================================================

-- Per-tenant reminder policy (TENANT-private).
CREATE TABLE notification_policies (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) UNIQUE,
  thresholds        jsonb NOT NULL DEFAULT '{}',
  quiet_hours_start time,
  quiet_hours_end   time,
  max_count         integer NOT NULL DEFAULT 3,
  cooldown_minutes  integer NOT NULL DEFAULT 1440,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Notification intents (TENANT-private), deduped by intent_key.
CREATE TABLE notification_intents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  type          text NOT NULL,                       -- 'reminder' | 'settled' | 'correction'
  aggregate_id  uuid NOT NULL,
  state_version integer NOT NULL,
  person_id     uuid NOT NULL REFERENCES persons(id),
  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','dispatched','skipped','expired')),
  intent_key    text NOT NULL UNIQUE,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_notif_intents_tenant ON notification_intents(tenant_id, status);

-- Per-platform delivery attempts (TENANT-private), deduped by delivery_key.
CREATE TABLE notification_deliveries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  intent_id       uuid NOT NULL REFERENCES notification_intents(id),
  platform        text NOT NULL,
  target_ref      text,                               -- encrypted provider target
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','sent','failed','skipped')),
  attempts        integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  provider_code   text,
  delivery_key    text NOT NULL UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_notif_deliveries_pending
  ON notification_deliveries(next_attempt_at) WHERE status = 'pending';

-- ---- Onboarding runs/steps (TENANT-private) -------------------------------
CREATE TABLE onboarding_runs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id),
  status     text NOT NULL DEFAULT 'in_progress'
             CHECK (status IN ('in_progress','completed','abandoned')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE onboarding_steps (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          uuid NOT NULL REFERENCES onboarding_runs(id),
  step            text NOT NULL,
  status          text NOT NULL DEFAULT 'not_configured'
                  CHECK (status IN ('not_configured','pending','verified','error','skipped')),
  idempotency_key text,
  error_code      text,
  completed_at    timestamptz,
  UNIQUE (run_id, step, idempotency_key)
);
