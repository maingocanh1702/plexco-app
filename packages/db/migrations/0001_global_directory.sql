-- ============================================================================
-- 0001_global_directory.sql
-- GLOBAL protected plane (no tenant RLS; protected by GRANTs + identity service).
-- Source: TDD §3.2, feature_identity_tech §2, feature_web_auth_onboarding_tech §2,
--         feature_tenant_routing_authz_tech §2, feature_player_view_tech §2.
-- Invariants: INV-5 (identity merge needs strong proof), INV-9 (PII never leaks),
--             BL-ID-1..6, BL-SEC-4. PII is encrypted at rest (*_enc bytea) with a
--             deterministic *_lookup_hash for equality lookup only.
-- ============================================================================

-- ---- Multi-sport lookup (FR-0, BL-TEN-4) -----------------------------------
CREATE TABLE sports (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text NOT NULL UNIQUE,        -- 'badminton' | 'pickleball' | 'tennis' | ...
  name        text NOT NULL,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---- Person (global real-world identity, protected) ------------------------
CREATE TABLE persons (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name          text,
  phone_enc             bytea,                       -- AES/KMS, never plaintext
  phone_lookup_hash     text,                        -- deterministic hash for merge key (DD-01)
  phone_verified_at     timestamptz,
  status                text NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','merged','deleted')),
  merged_into_person_id uuid REFERENCES persons(id),
  created_at            timestamptz NOT NULL DEFAULT now()
);
-- One active person per verified phone (DD-01).
CREATE UNIQUE INDEX persons_verified_phone_unique
  ON persons(phone_lookup_hash)
  WHERE phone_verified_at IS NOT NULL AND status = 'active';

-- ---- Channel identity (telegram/zalo/messenger -> person) ------------------
CREATE TABLE channel_identities (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id                 uuid NOT NULL REFERENCES persons(id),
  platform                  text NOT NULL
                            CHECK (platform IN ('telegram','zalo','messenger')), -- messenger P4.8
  platform_user_id_enc      bytea NOT NULL,
  platform_user_lookup_hash text NOT NULL,
  username_enc              bytea,
  status                    text NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active','inactive')),
  created_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, platform_user_lookup_hash)         -- global uniqueness (INV per TDD)
);
CREATE INDEX idx_channel_identities_person ON channel_identities(person_id);

-- ---- Identity merge: OTP link codes, audit, tombstones --------------------
CREATE TABLE link_codes (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_person_id           uuid NOT NULL REFERENCES persons(id),
  source_channel_identity_id uuid NOT NULL REFERENCES channel_identities(id),
  code_lookup_hash           text NOT NULL UNIQUE,
  code_hash                  bytea NOT NULL,
  salt                       bytea NOT NULL,
  action                     text NOT NULL DEFAULT 'merge_identity',
  expires_at                 timestamptz NOT NULL,
  consumed_at                timestamptz,
  failed_attempts            integer NOT NULL DEFAULT 0,
  created_at                 timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE merge_audit (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_person_id    uuid NOT NULL,
  target_person_id    uuid NOT NULL,
  canonical_person_id uuid NOT NULL,
  method              text NOT NULL,         -- 'link_code' | 'phone' | 'owner' | ...
  actor_type          text NOT NULL,         -- 'system' | 'owner' | 'support'
  actor_id            uuid,
  reason_code         text,
  before_snapshot_enc bytea NOT NULL,
  after_snapshot_enc  bytea NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE merge_tombstones (
  old_person_id       uuid PRIMARY KEY,
  canonical_person_id uuid NOT NULL REFERENCES persons(id),
  merge_audit_id      uuid NOT NULL REFERENCES merge_audit(id),
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- ---- Web auth (host/admin) ------------------------------------------------
-- accounts = authenticated web principal; linked to a person.
CREATE TABLE accounts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id  uuid REFERENCES persons(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE web_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid NOT NULL REFERENCES accounts(id),
  token_hash   text NOT NULL UNIQUE,
  csrf_secret  text NOT NULL,
  expires_at   timestamptz NOT NULL,
  rotated_from uuid REFERENCES web_sessions(id),
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE account_identities (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id         uuid NOT NULL REFERENCES accounts(id),
  platform           text NOT NULL,            -- 'telegram' (TG Login), ...
  platform_user_hash text NOT NULL,
  verified_at        timestamptz NOT NULL,
  UNIQUE (platform, platform_user_hash)
);

-- Player-side passwordless web entry (person-self), FR-12.
CREATE TABLE magic_links (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hash       text NOT NULL UNIQUE,
  person_id  uuid NOT NULL REFERENCES persons(id),
  channel    text NOT NULL,                     -- 'zalo' | 'telegram'
  session_id uuid REFERENCES web_sessions(id),
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_magic_links_hash ON magic_links(hash) WHERE used_at IS NULL;
