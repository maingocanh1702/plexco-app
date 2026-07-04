-- ============================================================================
-- 0002_tenants_core.sql
-- Tenant root + TENANT-private core (sessions, memberships, players, settings,
-- routing). RLS is enabled in 0009 (kept separate for reviewability).
-- Source: TDD §3.2/§3.3, feature_session_management_tech §2,
--         feature_identity_tech §2, feature_tenant_routing_authz_tech §2.
-- Invariants: INV-1/2, BL-TEN-*, BL-SES-*, BL-ID-4.
-- ============================================================================

-- ---- Tenant root (not RLS-scoped; it IS the scope) ------------------------
CREATE TABLE tenants (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  slug       text NOT NULL UNIQUE,
  status     text NOT NULL DEFAULT 'trialing'
             CHECK (status IN ('trialing','active','past_due','suspended','cancelled')),
  locale     text NOT NULL DEFAULT 'vi',
  timezone   text NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',  -- IANA
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---- Membership (person <-> tenant), tenant-private ------------------------
CREATE TABLE memberships (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid NOT NULL REFERENCES tenants(id),
  person_id                 uuid NOT NULL REFERENCES persons(id),
  display_name              text,
  pay_code                  text,                      -- bare in DB; prefix is display-only (DD-02)
  status                    text NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active','guest','left','merged')),
  merged_into_membership_id uuid REFERENCES memberships(id),
  created_at                timestamptz NOT NULL DEFAULT now()
);
-- One active/guest membership per (tenant, person) — merge-safe (BL-ID-4).
CREATE UNIQUE INDEX memberships_active_person_unique
  ON memberships(tenant_id, person_id)
  WHERE status IN ('active','guest');
-- pay_code unique within tenant when present.
CREATE UNIQUE INDEX memberships_tenant_paycode_unique
  ON memberships(tenant_id, pay_code)
  WHERE pay_code IS NOT NULL;

-- ---- Aliases (name-based matching helper), tenant-private ------------------
CREATE TABLE aliases (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  membership_id uuid NOT NULL REFERENCES memberships(id),
  alias_norm    text NOT NULL,                         -- normalized for matcher
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, alias_norm)
);

-- ---- Per-tenant channel reachability (BL-NTF-1, AUDIT C1) ------------------
CREATE TABLE channel_reachability (
  person_id      uuid NOT NULL REFERENCES persons(id),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  platform       text NOT NULL,                        -- telegram|zalo|messenger
  can_dm         boolean NOT NULL DEFAULT false,
  last_inbound_at timestamptz,
  -- messenger 24h window (post-MVP, BL-NTF-3):
  window_expires_at timestamptz,
  otn_token_enc  bytea,
  PRIMARY KEY (person_id, tenant_id, platform)
);

-- ---- Settings (free-form tenant config), tenant-private --------------------
CREATE TABLE settings (
  tenant_id  uuid NOT NULL REFERENCES tenants(id),
  key        text NOT NULL,
  value      jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, key)
);

-- ---- Sessions (the match/"kèo"), tenant-private ----------------------------
CREATE TABLE sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  sport_id      uuid NOT NULL REFERENCES sports(id),
  starts_at     timestamptz NOT NULL,
  ends_at       timestamptz NOT NULL,
  timezone      text NOT NULL,                          -- IANA (BL-SES-1)
  venue_name    text,                                   -- private until join/approve (DD-06)
  venue_address text,                                   -- private until join/approve
  area          text,                                   -- public whitelist (quận/khu vực)
  skill_level   text,
  price_amount  integer NOT NULL DEFAULT 0 CHECK (price_amount >= 0),
  slots_max     integer,                                -- NULL = unlimited
  visibility    text NOT NULL DEFAULT 'private'
                CHECK (visibility IN ('private','public')),
  join_policy   text NOT NULL DEFAULT 'open'
                CHECK (join_policy IN ('open','approval')),  -- DD-05
  status        text NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft','open','closed','cancelled')),
  version       integer NOT NULL DEFAULT 1,              -- optimistic concurrency
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CHECK (slots_max IS NULL OR slots_max > 0)
);
CREATE INDEX idx_sessions_tenant_status ON sessions(tenant_id, status);
CREATE INDEX idx_sessions_starts_at ON sessions(starts_at) WHERE status = 'open';

-- Recurring sessions (RRULE) — tenant-private.
CREATE TABLE session_recurrence_rules (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  rrule             text NOT NULL,
  timezone          text NOT NULL,
  version           integer NOT NULL DEFAULT 1,
  last_generated_at timestamptz
);
CREATE TABLE session_occurrences (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recurrence_rule_id  uuid NOT NULL REFERENCES session_recurrence_rules(id),
  session_id          uuid NOT NULL REFERENCES sessions(id),
  local_occurrence_key text NOT NULL,
  UNIQUE (recurrence_rule_id, local_occurrence_key)
);

-- Surface message refs for a session (e.g. TG announce message) — tenant-private.
CREATE TABLE session_surface_refs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  session_id  uuid NOT NULL REFERENCES sessions(id),
  platform    text NOT NULL,                            -- telegram|zalo|messenger|web
  target      text NOT NULL,                            -- chat_id / dm / topic
  external_ref text,                                    -- message_id, etc.
  UNIQUE (session_id, platform, target)
);
CREATE INDEX idx_session_surface_refs_session ON session_surface_refs(session_id);

-- ---- Players (session roster row), tenant-private -------------------------
CREATE TABLE players (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  session_id       uuid NOT NULL REFERENCES sessions(id),
  membership_id    uuid NOT NULL REFERENCES memberships(id),
  status           text NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active','left')),
  joined_at        timestamptz NOT NULL DEFAULT now(),
  last_reminded_at timestamptz,
  UNIQUE (tenant_id, session_id, membership_id)
);
CREATE INDEX idx_players_session ON players(session_id);

-- ---- Telegram / tenant routing + authz, tenant-private --------------------
CREATE TABLE telegram_links (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id),
  chat_id    bigint NOT NULL,
  kind       text NOT NULL DEFAULT 'group' CHECK (kind IN ('group','channel','admin')),
  active     boolean NOT NULL DEFAULT true,
  linked_at  timestamptz NOT NULL DEFAULT now(),
  linked_by  uuid REFERENCES persons(id)
);
-- Only one active binding per chat (route source of truth, BL-ID-6).
CREATE UNIQUE INDEX idx_telegram_links_chat ON telegram_links(chat_id) WHERE active = true;

CREATE TABLE tenant_admins (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid NOT NULL REFERENCES tenants(id),
  platform                  text NOT NULL DEFAULT 'telegram',
  platform_user_lookup_hash text NOT NULL,
  role                      text NOT NULL DEFAULT 'admin'
                            CHECK (role IN ('owner','admin','co_admin')),
  active                    boolean NOT NULL DEFAULT true,
  created_at                timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_tenant_admins_unique
  ON tenant_admins(tenant_id, platform, platform_user_lookup_hash) WHERE active = true;
CREATE INDEX idx_tenant_admins_lookup
  ON tenant_admins(platform, platform_user_lookup_hash) WHERE active = true;

CREATE TABLE tenant_link_codes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_lookup_hash text NOT NULL UNIQUE,
  code_hash        text NOT NULL,
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  intended_role    text NOT NULL,
  expires_at       timestamptz NOT NULL,
  consumed_at      timestamptz,
  revoked_at       timestamptz,
  attempts         integer NOT NULL DEFAULT 0
);
CREATE INDEX idx_link_codes_hash ON tenant_link_codes(code_lookup_hash);
CREATE INDEX idx_link_codes_expiry ON tenant_link_codes(expires_at)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;

-- Sticky player->tenant context for Telegram DMs (GLOBAL protected, no RLS).
CREATE TABLE player_chat_context (
  person_id  uuid NOT NULL REFERENCES persons(id),
  platform   text NOT NULL DEFAULT 'telegram',
  tenant_id  uuid NOT NULL REFERENCES tenants(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (person_id, platform)
);

-- Routing/authz audit (platform-level, no RLS).
CREATE TABLE routing_audit (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action     text NOT NULL,
  actor_id   uuid,
  tenant_id  uuid,
  detail     jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
