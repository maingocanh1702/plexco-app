-- ============================================================================
-- 0004_channels_connectors.sql
-- Channel credentials + provider connector onboarding.
-- Source: feature_zalo_channel_tech §2, feature_connector_onboarding_tech §2,
--         appendices/messenger-channel-design.md (P4.8).
-- Invariants: BL-SEC-1 (secrets KMS at-rest), BL-TEN-3 (BYO provider).
-- ============================================================================

-- ---- Provider connections (SePay OAuth / ApiPay API key), tenant-private ---
CREATE TABLE provider_connections (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id),
  provider           text NOT NULL CHECK (provider IN ('sepay','apipay')),
  auth_mode          text NOT NULL CHECK (auth_mode IN ('oauth2','api_key')),
  access_token_enc   bytea,
  refresh_token_enc  bytea,
  scope              text,
  token_expires_at   timestamptz,
  api_access_key_enc bytea,
  api_secret_key_enc bytea,
  status             text NOT NULL DEFAULT 'connecting'
                     CHECK (status IN ('connecting','registered','active','drift','error','revoked')),
  last_error_code    text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider)
);

-- Now that provider_connections exists, wire the FK from bank_accounts.
ALTER TABLE bank_accounts
  ADD CONSTRAINT bank_accounts_provider_connection_fk
  FOREIGN KEY (provider_connection_id) REFERENCES provider_connections(id);

-- ---- Short-lived OAuth transactions (PKCE+state) — GLOBAL bootstrap --------
-- Not tenant-RLS: callback has no cookie/tenant context. Runtime app must NOT
-- SELECT directly; access only via SECURITY DEFINER functions (see 0010).
CREATE TABLE oauth_transactions (
  state             text PRIMARY KEY,
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  provider          text NOT NULL CHECK (provider IN ('sepay')),
  code_verifier_enc bytea NOT NULL,
  redirect_uri      text NOT NULL,
  created_by        uuid NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL          -- created_at + 10m
);

-- ---- Zalo bots (per-club BYO token), tenant-private -----------------------
CREATE TABLE zalo_bots (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id) UNIQUE,
  bot_token_enc      text NOT NULL,                -- KMS
  webhook_token      text NOT NULL,
  secret             text,
  status             text NOT NULL DEFAULT 'connecting'
                     CHECK (status IN ('connecting','registered','active','drift','error','revoked')),
  auto_registered    boolean NOT NULL DEFAULT false,
  rotation_pending   boolean NOT NULL DEFAULT false,
  last_setwebhook_at timestamptz,
  verified_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_zalo_bots_webhook_token ON zalo_bots(webhook_token);

-- Zalo number-reply context (DM per club), tenant-private.
CREATE TABLE zalo_reply_contexts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id    uuid NOT NULL REFERENCES persons(id),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  bot_id       uuid NOT NULL REFERENCES zalo_bots(id),
  context_type text NOT NULL DEFAULT 'session_list',
  item_ids     jsonb NOT NULL,                     -- ordered session IDs
  version      integer NOT NULL DEFAULT 1,
  expires_at   timestamptz NOT NULL,
  consumed_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ---- Messenger pages (post-MVP P4.8), tenant-private ----------------------
CREATE TABLE messenger_pages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) UNIQUE,
  page_id       text NOT NULL UNIQUE,              -- route key (entry[].id)
  page_token_enc bytea NOT NULL,                   -- KMS
  app_secret_enc bytea,
  status        text NOT NULL DEFAULT 'connecting'
                CHECK (status IN ('connecting','registered','active','drift','error','revoked')),
  verified_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
