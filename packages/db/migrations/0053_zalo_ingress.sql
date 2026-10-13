-- ============================================================================
-- 0053_zalo_ingress.sql
-- Web MVP lane M3a: Zalo bot ingress -- encrypted connector secrets, durable inbound event store,
-- scoped channel identity key (DD-15 / DD-67), and the definers the web process calls.
--
-- NUMBERING: this branch holds 0000..0049, 0051 and 0053. 0050 belongs to sibling lane M2c (PR #46)
-- and 0051 here (tenant profile definers, PR #45) will be renumbered to 0052 when the stack is
-- rebased; 0053 is deliberate, not a gap bug. MIGRATION_COUNT in the tests = 52 on this branch.
--
-- 1. zalo_bots: + webhook_secret_enc bytea, + key_version text, DROP legacy plaintext `secret`.
--    MEASURED: `secret` had zero production readers and zero writers (only rls-invariants.test.ts
--    named the table); dropping it cannot lose data the app ever wrote. CHECK
--    zalo_bots_secret_shape_chk: a bot may only be registered/active/drift with a ciphertext.
--    `bot_token_enc` stays text and now holds base64url(iv || tag || ciphertext) AES-256-GCM.
-- 2. channel_inbound_events: tenant-scoped store-before-process ledger (BRD NFR-S4), idempotent on
--    (tenant_id, bot_id, external_event_id). Raw payload only as AES-GCM ciphertext.
-- 3. channel_identities: + provider_scope_lookup_hash (+ partial UNIQUE on the 3-part key) and
--    + zalo_bot_id. The legacy 2-part UNIQUE (platform, platform_user_lookup_hash) is REPLACED by a
--    partial unique index over rows WITHOUT a scope (legacy/unscoped rows keep their invariant; 0042
--    already blocks new telegram rows). Why: the user hash is HMAC("channel-user:zalo:"+from.id) and
--    does not contain the bot, so the 2-part unique made one Zalo user unservable by a second club's
--    bot (DD-15 / DD-67 pin the 3-part key only). The two-HMAC shape is unchanged.
-- 4. Definers (all app-only): zalo_bot_resolve_by_webhook_token, zalo_identity_resolve,
--    zalo_bot_upsert_for_tenant, zalo_bot_set_status, routing_audit_append.
--
-- DEFINER DECISION TABLES (anything not listed is refused)
--   zalo_bot_resolve_by_webhook_token(token)   pre-tenant, no GUC needed
--     unknown / NULL / empty token                    zero rows (never raises)
--     known token                                     one row (bot_id, tenant_id, status,
--                                                     webhook_secret_enc, key_version, locale)
--   zalo_identity_resolve(tenant, bot, scope_hash, user_hash, user_id_enc, display_name)
--     GUC unset / <> tenant, bot not in tenant, NULL hash/enc  RAISE insufficient_privilege / invalid_parameter_value
--     active identity with the 3-part key exists               that row, created = false
--     none                                                     new persons + channel_identities, created = true
--     same Zalo user under a second bot (other scope hash)     DISTINCT person + identity (3-part key)
--     existing row with the 3-part key but status inactive     reactivated, created = false
--     concurrent first event (unique race)                     re-read the winner; else RAISE integrity_constraint_violation
--     NEVER merges persons, NEVER links an account (DD-14/15, HR4).
--   zalo_bot_upsert_for_tenant(...)
--     GUC unset / <> tenant                            RAISE insufficient_privilege
--     tenant_capability_authorize(connector.secret_manage) denies   RAISE insufficient_privilege
--     status <> 'connecting', NULL secret/token/id     RAISE invalid_parameter_value
--     existing row for the tenant is revoked           RAISE invalid_parameter_value (terminal, never resurrected)
--     no row for the tenant                            insert
--     row exists with the SAME id                      rotate token/secret, status connecting, verified_at NULL
--     row exists with another id                       RAISE serialization_failure (caller retries)
--   zalo_bot_set_status(tenant, bot, status, verified, touch_setwebhook, only_from)
--     GUC mismatch                                     RAISE insufficient_privilege
--     current status revoked                           RAISE invalid_parameter_value (terminal)
--     only_from given and current status not in it     zero rows, NO change (compare-and-set: a
--                                                      connect finishing late cannot demote an
--                                                      already-active bot)
--     otherwise                                        UPDATE; verified => verified_at once
--   routing_audit_append(action, actor, tenant, detail)
--     action outside the allowlist (zalo.secret_decrypt), GUC mismatch   RAISE
--     otherwise                                        one routing_audit row
--
-- connector.secret_manage is the 0047 registry key whose class (owner_grantable) covers connector
-- secrets (DD-56); an owner always passes, an admin only with a live explicit grant.
--
-- RLS for the pre-tenant token lookup: zalo_bots is FORCE RLS keyed on app.tenant_id, so the lookup
-- definer would see zero rows. Same remedy as 0037's person-scoped policy: a second permissive
-- SELECT policy keyed on a transaction-local GUC the definer sets and restores. Threat model: the
-- caller must already know the opaque token; the row it exposes holds only ciphertext.
--
-- Hardening: SET search_path = pg_catalog, public, pg_temp, relations public.-qualified (0048),
-- REVOKE ALL FROM PUBLIC, EXECUTE to app only, clock_timestamp() for time predicates.
-- ============================================================================

-- ---- 1. zalo_bots ---------------------------------------------------------
ALTER TABLE zalo_bots ADD COLUMN webhook_secret_enc bytea;
ALTER TABLE zalo_bots ADD COLUMN key_version text;
ALTER TABLE zalo_bots DROP COLUMN secret;
ALTER TABLE zalo_bots ADD CONSTRAINT zalo_bots_secret_shape_chk
  CHECK (webhook_secret_enc IS NOT NULL OR status IN ('connecting', 'error', 'revoked'));
COMMENT ON COLUMN zalo_bots.bot_token_enc IS
  'base64url(iv(12) || authTag(16) || ciphertext): AES-256-GCM, AAD plexco:connector-zalo-aad:v1:<tenant_id>|<bot_id>|bot_token, key = HKDF(connector pepper). Decrypted only in the web process that calls Zalo.';
COMMENT ON COLUMN zalo_bots.webhook_secret_enc IS
  'iv(12) || authTag(16) || ciphertext: AES-256-GCM, AAD ...|webhook_secret. Compared timing-safe with X-Bot-Api-Secret-Token.';

CREATE POLICY zalo_bots_webhook_lookup ON zalo_bots
  FOR SELECT
  USING (webhook_token = NULLIF(current_setting('app.zalo_webhook_token', true), ''));

-- ---- 2. channel_inbound_events -------------------------------------------
CREATE TABLE channel_inbound_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  platform          text NOT NULL,
  bot_id            uuid NOT NULL,
  external_event_id text NOT NULL,
  raw_payload_enc   bytea NOT NULL,
  key_version       text NOT NULL,
  received_at       timestamptz NOT NULL DEFAULT now(),
  processed_at      timestamptz,
  status            text NOT NULL DEFAULT 'received',
  error_code        text,
  CONSTRAINT channel_inbound_events_platform_chk CHECK (platform IN ('zalo', 'messenger')),
  CONSTRAINT channel_inbound_events_status_chk
    CHECK (status IN ('received', 'processed', 'failed', 'ignored')),
  CONSTRAINT channel_inbound_events_event_id_chk
    CHECK (char_length(external_event_id) BETWEEN 1 AND 200),
  CONSTRAINT channel_inbound_events_tenant_bot_fk
    FOREIGN KEY (tenant_id, bot_id) REFERENCES zalo_bots (tenant_id, id),
  CONSTRAINT channel_inbound_events_dedup_uq UNIQUE (tenant_id, bot_id, external_event_id)
);
CREATE INDEX idx_channel_inbound_events_status
  ON channel_inbound_events (tenant_id, status, received_at);
ALTER TABLE channel_inbound_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_inbound_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON channel_inbound_events
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
REVOKE ALL ON channel_inbound_events FROM PUBLIC, app_worker, readonly;
GRANT SELECT, INSERT, UPDATE ON channel_inbound_events TO app;

-- ---- 3. channel_identities ------------------------------------------------
ALTER TABLE channel_identities ADD COLUMN provider_scope_lookup_hash text;
ALTER TABLE channel_identities ADD COLUMN zalo_bot_id uuid REFERENCES zalo_bots(id);
-- Drop the legacy 2-part unique by LOOKING UP its real name (0001 created it unnamed; schema.ts's
-- channel_identities_platform_uid_uq is a drizzle-only name that does not exist in the database).
DO $$
DECLARE
  v_name text;
BEGIN
  SELECT c.conname INTO v_name
    FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.channel_identities'::regclass
     AND c.contype = 'u'
     AND (SELECT array_agg(a.attname::text ORDER BY a.attname::text)
            FROM pg_catalog.pg_attribute a
           WHERE a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey))
         = ARRAY['platform', 'platform_user_lookup_hash'];
  IF v_name IS NULL THEN
    RAISE EXCEPTION '0053: legacy channel_identities (platform, platform_user_lookup_hash) unique not found';
  END IF;
  EXECUTE format('ALTER TABLE public.channel_identities DROP CONSTRAINT %I', v_name);
END
$$;
CREATE UNIQUE INDEX channel_identities_platform_uid_uq
  ON channel_identities (platform, platform_user_lookup_hash)
  WHERE provider_scope_lookup_hash IS NULL;
CREATE UNIQUE INDEX channel_identities_scoped_uq
  ON channel_identities (platform, provider_scope_lookup_hash, platform_user_lookup_hash)
  WHERE provider_scope_lookup_hash IS NOT NULL;

-- ---- 4a. zalo_bot_resolve_by_webhook_token -------------------------------
CREATE FUNCTION zalo_bot_resolve_by_webhook_token(p_token text)
RETURNS TABLE (bot_id uuid, tenant_id uuid, status text, webhook_secret_enc bytea,
               key_version text, locale text)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_prev text := current_setting('app.zalo_webhook_token', true);
BEGIN
  IF p_token IS NULL OR p_token = '' OR char_length(p_token) > 200 THEN
    RETURN;
  END IF;
  PERFORM set_config('app.zalo_webhook_token', p_token, true);
  RETURN QUERY
    SELECT b.id, b.tenant_id, b.status, b.webhook_secret_enc, b.key_version,
           public.tenant_locale(b.tenant_id)
      FROM public.zalo_bots b
     WHERE b.webhook_token = p_token;
  PERFORM set_config('app.zalo_webhook_token', coalesce(v_prev, ''), true);
END;
$$;
REVOKE ALL ON FUNCTION zalo_bot_resolve_by_webhook_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION zalo_bot_resolve_by_webhook_token(text) TO app;

-- ---- 4b. zalo_identity_resolve -------------------------------------------
CREATE FUNCTION zalo_identity_resolve(
  p_tenant_id uuid, p_bot_id uuid, p_scope_hash text, p_user_hash text,
  p_user_id_enc bytea, p_display_name text
)
RETURNS TABLE (person_id uuid, channel_identity_id uuid, created boolean,
               display_name text, has_account boolean)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_ctx uuid;
  v_person uuid;
  v_ci uuid;
  v_created boolean := false;
  v_status text;
  v_name text := left(nullif(btrim(p_display_name), ''), 120);
BEGIN
  BEGIN
    v_ctx := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_ctx := NULL;
  END;
  IF p_tenant_id IS NULL OR v_ctx IS NULL OR p_tenant_id <> v_ctx THEN
    RAISE EXCEPTION 'zalo_identity_resolve: tenant context mismatch'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_bot_id IS NULL OR p_scope_hash IS NULL OR p_user_hash IS NULL OR p_user_id_enc IS NULL
     OR p_scope_hash = '' OR p_user_hash = '' THEN
    RAISE EXCEPTION 'zalo_identity_resolve: scope, user hash and ciphertext are required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  PERFORM 1 FROM public.zalo_bots b WHERE b.id = p_bot_id AND b.tenant_id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'zalo_identity_resolve: bot not in tenant'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT ci.id, ci.person_id, ci.status INTO v_ci, v_person, v_status
    FROM public.channel_identities ci
   WHERE ci.platform = 'zalo' AND ci.provider_scope_lookup_hash = p_scope_hash
     AND ci.platform_user_lookup_hash = p_user_hash;
  IF NOT FOUND THEN
    BEGIN
      INSERT INTO public.persons (display_name, status) VALUES (v_name, 'active')
        RETURNING id INTO v_person;
      INSERT INTO public.channel_identities
        (person_id, platform, platform_user_id_enc, platform_user_lookup_hash, status,
         provider_scope_lookup_hash, zalo_bot_id)
        VALUES (v_person, 'zalo', p_user_id_enc, p_user_hash, 'active', p_scope_hash, p_bot_id)
        RETURNING id INTO v_ci;
      v_created := true;
      v_status := 'active';
    EXCEPTION WHEN unique_violation THEN
      -- Only a concurrent first event can race here (the block rolled back our persons row):
      -- re-read the winner, else refuse.
      SELECT ci.id, ci.person_id, ci.status INTO v_ci, v_person, v_status
        FROM public.channel_identities ci
       WHERE ci.platform = 'zalo' AND ci.provider_scope_lookup_hash = p_scope_hash
         AND ci.platform_user_lookup_hash = p_user_hash;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'zalo_identity_resolve: identity scope conflict'
          USING ERRCODE = 'integrity_constraint_violation';
      END IF;
    END;
  END IF;
  -- The unique ignores status, so an inactive row would otherwise lock the user out forever.
  IF v_status <> 'active' THEN
    UPDATE public.channel_identities SET status = 'active' WHERE id = v_ci;
  END IF;

  RETURN QUERY
    SELECT v_person, v_ci, v_created,
           (SELECT p.display_name FROM public.persons p WHERE p.id = v_person),
           EXISTS (SELECT 1 FROM public.accounts a WHERE a.person_id = v_person);
END;
$$;
REVOKE ALL ON FUNCTION zalo_identity_resolve(uuid, uuid, text, text, bytea, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION zalo_identity_resolve(uuid, uuid, text, text, bytea, text) TO app;

-- ---- 4c. zalo_bot_upsert_for_tenant --------------------------------------
CREATE FUNCTION zalo_bot_upsert_for_tenant(
  p_tenant_id uuid, p_actor_person_id uuid, p_bot_id uuid, p_bot_token_enc text,
  p_webhook_token text, p_webhook_secret_enc bytea, p_key_version text, p_status text
)
RETURNS TABLE (bot_id uuid, webhook_token text, status text)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_ctx uuid;
  v_allowed boolean;
BEGIN
  BEGIN
    v_ctx := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_ctx := NULL;
  END;
  IF p_tenant_id IS NULL OR v_ctx IS NULL OR p_tenant_id <> v_ctx THEN
    RAISE EXCEPTION 'zalo_bot_upsert_for_tenant: tenant context mismatch'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Authorization FIRST, inside the definer: a caller that skipped the web gate still cannot write.
  SELECT a.allowed INTO v_allowed
    FROM public.tenant_capability_authorize(p_tenant_id, 'connector.secret_manage', p_actor_person_id) a;
  IF v_allowed IS NOT TRUE THEN
    RAISE EXCEPTION 'zalo_bot_upsert_for_tenant: not permitted'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_status IS DISTINCT FROM 'connecting' OR p_bot_id IS NULL OR p_bot_token_enc IS NULL
     OR p_webhook_token IS NULL OR p_webhook_secret_enc IS NULL OR p_key_version IS NULL
     OR char_length(p_webhook_token) NOT BETWEEN 16 AND 200 THEN
    RAISE EXCEPTION 'zalo_bot_upsert_for_tenant: invalid arguments'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  PERFORM 1 FROM public.zalo_bots b WHERE b.tenant_id = p_tenant_id AND b.status = 'revoked';
  IF FOUND THEN
    RAISE EXCEPTION 'zalo_bot_upsert_for_tenant: bot is revoked'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  RETURN QUERY
    WITH ins AS (
      INSERT INTO public.zalo_bots AS z
        (id, tenant_id, bot_token_enc, webhook_token, webhook_secret_enc, key_version, status)
        VALUES (p_bot_id, p_tenant_id, p_bot_token_enc, p_webhook_token, p_webhook_secret_enc,
                p_key_version, 'connecting')
      ON CONFLICT (tenant_id) DO UPDATE
        SET bot_token_enc = EXCLUDED.bot_token_enc,
            webhook_token = EXCLUDED.webhook_token,
            webhook_secret_enc = EXCLUDED.webhook_secret_enc,
            key_version = EXCLUDED.key_version,
            status = 'connecting',
            verified_at = NULL,
            rotation_pending = false
        WHERE z.id = EXCLUDED.id AND z.status <> 'revoked'
      RETURNING z.id AS r_id, z.webhook_token AS r_token, z.status AS r_status
    )
    SELECT ins.r_id, ins.r_token, ins.r_status FROM ins;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'zalo_bot_upsert_for_tenant: concurrent bot change'
      USING ERRCODE = 'serialization_failure';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION zalo_bot_upsert_for_tenant(uuid, uuid, uuid, text, text, bytea, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION zalo_bot_upsert_for_tenant(uuid, uuid, uuid, text, text, bytea, text, text) TO app;

-- ---- 4d. zalo_bot_set_status ---------------------------------------------
CREATE FUNCTION zalo_bot_set_status(
  p_tenant_id uuid, p_bot_id uuid, p_status text, p_verified boolean, p_touch_setwebhook boolean,
  p_only_from text[]
)
RETURNS TABLE (bot_id uuid, status text, verified_at timestamptz, last_setwebhook_at timestamptz)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_ctx uuid;
  v_cur text;
BEGIN
  BEGIN
    v_ctx := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_ctx := NULL;
  END;
  IF p_tenant_id IS NULL OR v_ctx IS NULL OR p_tenant_id <> v_ctx THEN
    RAISE EXCEPTION 'zalo_bot_set_status: tenant context mismatch'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('connecting','registered','active','drift','error','revoked') THEN
    RAISE EXCEPTION 'zalo_bot_set_status: invalid status' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT b.status INTO v_cur FROM public.zalo_bots b
   WHERE b.id = p_bot_id AND b.tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF v_cur = 'revoked' THEN
    RAISE EXCEPTION 'zalo_bot_set_status: bot is revoked' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_only_from IS NOT NULL AND NOT (v_cur = ANY (p_only_from)) THEN
    RETURN;
  END IF;
  RETURN QUERY
    WITH upd AS (
      UPDATE public.zalo_bots b
         SET status = p_status,
             verified_at = CASE WHEN p_verified IS TRUE THEN coalesce(b.verified_at, clock_timestamp())
                                ELSE b.verified_at END,
             last_setwebhook_at = CASE WHEN p_touch_setwebhook IS TRUE THEN clock_timestamp()
                                       ELSE b.last_setwebhook_at END
       WHERE b.id = p_bot_id AND b.tenant_id = p_tenant_id
      RETURNING b.id AS r_id, b.status AS r_status, b.verified_at AS r_verified,
                b.last_setwebhook_at AS r_hook
    )
    SELECT upd.r_id, upd.r_status, upd.r_verified, upd.r_hook FROM upd;
END;
$$;
REVOKE ALL ON FUNCTION zalo_bot_set_status(uuid, uuid, text, boolean, boolean, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION zalo_bot_set_status(uuid, uuid, text, boolean, boolean, text[]) TO app;

-- ---- 4e. routing_audit_append --------------------------------------------
-- routing_audit is global-protected (0009: zero app grants). One allowlisted action for now.
CREATE FUNCTION routing_audit_append(p_action text, p_actor_id uuid, p_tenant_id uuid, p_detail jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_ctx uuid;
  v_id uuid;
BEGIN
  BEGIN
    v_ctx := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_ctx := NULL;
  END;
  IF p_action IS DISTINCT FROM 'zalo.secret_decrypt' THEN
    RAISE EXCEPTION 'routing_audit_append: action not allowed' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_tenant_id IS NULL OR v_ctx IS NULL OR p_tenant_id <> v_ctx THEN
    RAISE EXCEPTION 'routing_audit_append: tenant context mismatch'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO public.routing_audit (action, actor_id, tenant_id, detail)
    VALUES (p_action, p_actor_id, p_tenant_id, p_detail)
    RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION routing_audit_append(text, uuid, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION routing_audit_append(text, uuid, uuid, jsonb) TO app;
