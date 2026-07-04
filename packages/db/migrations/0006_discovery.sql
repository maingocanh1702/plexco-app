-- ============================================================================
-- 0006_discovery.sql
-- PUBLIC read model (cross-tenant, NO RLS, field whitelist) + cross-club join.
-- Source: feature_marketplace_discovery_tech §2, feature_cross_club_join_tech §2,
--         TDD §3.9, DD-06/DD-12.
-- Invariants: INV-3 (public is a projection), BL-DSC-1..4.
--   public_sessions stores ONLY whitelisted fields — no roster, no money/debt,
--   no PII, no exact venue, no STK. tenant_id is internal routing only.
-- ============================================================================

CREATE TABLE public_sessions (
  id               uuid PRIMARY KEY,                -- = sessions.id
  session_id       uuid NOT NULL,
  tenant_id        uuid NOT NULL,                   -- internal join-routing only, never serialized
  sport_key        text NOT NULL,
  starts_at        timestamptz NOT NULL,
  ends_at          timestamptz NOT NULL,
  area             text NOT NULL,                   -- district/area only (DD-06)
  skill_level      text,
  price_amount     integer NOT NULL,
  slots_open       integer NOT NULL,                -- derived by projector (P4)
  club_display_name text NOT NULL,
  host_display_name text,
  join_policy      text NOT NULL,
  projected_at     timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL
);
CREATE INDEX idx_public_starts ON public_sessions(starts_at) WHERE starts_at > now();
CREATE INDEX idx_public_sport_time ON public_sessions(sport_key, starts_at);
CREATE INDEX idx_public_area_time ON public_sessions(area, starts_at);
CREATE INDEX idx_public_price ON public_sessions(price_amount);

-- Cross-club join approval queue (TENANT-private, RLS in 0009).
CREATE TABLE join_requests (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  session_id  uuid NOT NULL REFERENCES sessions(id),
  person_id   uuid NOT NULL REFERENCES persons(id),
  status      text NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','approved','rejected','expired','cancelled')),
  expires_at  timestamptz NOT NULL,
  decided_by  uuid REFERENCES persons(id),
  decided_at  timestamptz,
  command_id  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
-- At most one pending request per (session, person).
CREATE UNIQUE INDEX idx_join_requests_active
  ON join_requests(session_id, person_id) WHERE status = 'pending';
