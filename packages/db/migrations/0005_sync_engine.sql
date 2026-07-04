-- ============================================================================
-- 0005_sync_engine.sql
-- Canonical-store sync: command dedupe, outbox, projector delivery ledger.
-- Source: feature_sync_engine_tech §2, TDD §3.8.
-- Invariants: INV-6 (idempotent mutations), BL-SYN-1..3, P8/P11.
-- ============================================================================

-- Command dedupe (TENANT-private). UNIQUE(tenant,command_id) — STALE_COMMAND.
CREATE TABLE processed_commands (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  command_id   text NOT NULL,
  command_type text NOT NULL,
  result_hash  text,
  result_ref   jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, command_id)
);

-- Outbox events (TENANT-private), written in same txn as the mutation.
CREATE TABLE outbox_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  aggregate_type text NOT NULL,
  aggregate_id   uuid NOT NULL,
  sequence       integer NOT NULL,                  -- per-aggregate ordering
  type           text NOT NULL,                     -- 'session.created' | 'payment.settled' | ...
  schema_version integer NOT NULL DEFAULT 1,
  payload        jsonb NOT NULL,                    -- minimal versioned contract (P11)
  created_at     timestamptz NOT NULL DEFAULT now(),
  claimed_at     timestamptz,
  UNIQUE (aggregate_id, sequence)
);
CREATE INDEX idx_outbox_unclaimed
  ON outbox_events(aggregate_id, sequence) WHERE claimed_at IS NULL;

-- Projector delivery ledger (WORKER plane). UNIQUE(event_id, projector).
CREATE TABLE projector_deliveries (
  event_id        uuid NOT NULL REFERENCES outbox_events(id),
  projector       text NOT NULL,                    -- 'telegram' | 'zalo' | 'web_sse' | 'public_sessions' | ...
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','delivered','failed','dlq')),
  attempts        integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  delivered_at    timestamptz,
  provider_ref    text,
  error_code      text,
  PRIMARY KEY (event_id, projector)
);
CREATE INDEX idx_projector_pending
  ON projector_deliveries(next_attempt_at) WHERE status = 'pending';

-- Generic surface refs keyed by aggregate (cross-feature), tenant-agnostic key.
CREATE TABLE surface_refs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_id uuid NOT NULL,
  platform     text NOT NULL,
  target       text NOT NULL,
  external_ref text,
  UNIQUE (aggregate_id, platform, target)
);
CREATE INDEX idx_surface_refs_aggregate ON surface_refs(aggregate_id);
