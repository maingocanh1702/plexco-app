-- ============================================================================
-- 0062_gender_pricing.sql
-- Web MVP Phase 3 lane L11 (DD-39 gender pricing). persons gains the self-declared gender as an
-- AES-256-GCM ciphertext sealed in TS (person-bound AAD; the database never sees plaintext), its key
-- version and an explicit pricing consent; sessions gains price_male / price_female (both NULL =
-- single price; a NULL side falls back to price_amount). No grant on any new column: persons keeps
-- zero runtime-role privileges (0055) and the per-column grants of job_definer / identity_definer do
-- not extend to new columns, so no projector or public surface can read them.
--
-- DECISION TABLE (anything not listed is refused)
--   person_gender_read(account)          account's ACTIVE person      one row; otherwise zero rows
--   person_gender_update(account, expected person, enc, version, consent)
--                                        active person = expected     three columns written, one row
--                                        mismatch / inactive / none   zero rows, zero writes
--   charge_gender_for_derivation(context, session, membership, actor): authorization completes
--   BEFORE any gender column is read: app.tenant_id = the session's tenant, the membership is in
--   that tenant with status active|guest, and
--     self_join   memberships.person_id = actor
--     host_add    tenant_capability_authorize(tenant, 'session.manage', actor).allowed (approve too)
--     promotion   sessions row FOR UPDATE, then a waitlisted players row (session, membership)
--   refused / unknown context => RAISE 'GENDER_FORBIDDEN' (42501), identical for NULL and set gender;
--   authorized => (person_id, NULL, NULL) when consent is false or gender_enc is NULL, else
--   (person_id, gender_enc, gender_key_version). It never writes.
-- Hardening as 0055: SECURITY DEFINER, pinned search_path, public.-qualified relations,
-- REVOKE ALL FROM PUBLIC, EXECUTE to app only.
-- ============================================================================

ALTER TABLE persons
  ADD COLUMN gender_enc bytea,
  ADD COLUMN gender_key_version text,
  ADD COLUMN gender_pricing_consent boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT persons_gender_enc_version_chk
    CHECK ((gender_enc IS NULL) = (gender_key_version IS NULL));

ALTER TABLE sessions
  ADD COLUMN price_male integer,
  ADD COLUMN price_female integer,
  ADD CONSTRAINT sessions_price_male_chk CHECK (price_male IS NULL OR price_male >= 0),
  ADD CONSTRAINT sessions_price_female_chk CHECK (price_female IS NULL OR price_female >= 0);

CREATE FUNCTION person_gender_read(p_account_id uuid)
RETURNS TABLE (person_id uuid, gender_enc bytea, gender_key_version text, gender_pricing_consent boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT p.id, p.gender_enc, p.gender_key_version, p.gender_pricing_consent
    FROM public.accounts a
    JOIN public.persons p ON p.id = a.person_id AND p.status = 'active'
   WHERE a.id = p_account_id;
$$;
REVOKE ALL ON FUNCTION person_gender_read(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION person_gender_read(uuid) TO app;

CREATE FUNCTION person_gender_update(
  p_account_id uuid, p_expected_person_id uuid, p_gender_enc bytea, p_gender_key_version text,
  p_consent boolean
)
RETURNS TABLE (person_id uuid)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_person uuid;
BEGIN
  IF p_account_id IS NULL OR p_expected_person_id IS NULL OR p_consent IS NULL THEN
    RAISE EXCEPTION 'person_gender_update: account, expected person and consent are required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- Lock order as 0055: accounts, then persons. No argument names a target person.
  SELECT a.person_id INTO v_person FROM public.accounts a WHERE a.id = p_account_id FOR UPDATE;
  IF v_person IS NULL OR v_person <> p_expected_person_id THEN RETURN; END IF;
  -- The pair CHECK refuses a blob without a key version (and the reverse); NULL + NULL = erase.
  UPDATE public.persons p
     SET gender_enc = p_gender_enc, gender_key_version = p_gender_key_version,
         gender_pricing_consent = p_consent
   WHERE p.id = v_person AND p.status = 'active'
  RETURNING p.id INTO v_person;
  IF NOT FOUND THEN RETURN; END IF;
  RETURN QUERY SELECT v_person;
END;
$$;
REVOKE ALL ON FUNCTION person_gender_update(uuid, uuid, bytea, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION person_gender_update(uuid, uuid, bytea, text, boolean) TO app;

CREATE FUNCTION charge_gender_for_derivation(
  p_context text, p_session_id uuid, p_membership_id uuid, p_actor_person_id uuid
)
RETURNS TABLE (person_id uuid, gender_enc bytea, gender_key_version text)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_ctx uuid;
  v_tenant uuid;
  v_person uuid;
  v_ok boolean := false;
BEGIN
  -- 1. Tenant binding (0049 pattern): a malformed GUC is treated as unset.
  BEGIN
    v_ctx := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_ctx := NULL;
  END;
  SELECT s.tenant_id INTO v_tenant FROM public.sessions s WHERE s.id = p_session_id;
  IF v_ctx IS NOT NULL AND v_tenant = v_ctx THEN
    -- 2. A live membership of that tenant (a guest minted earlier in this transaction is visible).
    SELECT m.person_id INTO v_person FROM public.memberships m
     WHERE m.id = p_membership_id AND m.tenant_id = v_tenant AND m.status IN ('active', 'guest');
    -- 3. Per-context check. No session-status, FIFO-head or seat check: TS owns those.
    IF v_person IS NOT NULL THEN
      IF p_context = 'self_join' THEN
        v_ok := v_person = p_actor_person_id;
      ELSIF p_context = 'host_add' THEN
        v_ok := coalesce((SELECT t.allowed FROM public.tenant_capability_authorize(
                  v_tenant, 'session.manage', p_actor_person_id) t), false);
      ELSIF p_context = 'promotion' THEN
        PERFORM 1 FROM public.sessions s WHERE s.id = p_session_id FOR UPDATE;
        v_ok := EXISTS (SELECT 1 FROM public.players pl WHERE pl.session_id = p_session_id
                          AND pl.membership_id = p_membership_id AND pl.status = 'waitlisted');
      END IF;
    END IF;
  END IF;
  IF v_ok IS NOT TRUE THEN
    RAISE EXCEPTION 'GENDER_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  -- 4. Authorized: only now is a gender column read. Consent OFF reads as never set.
  RETURN QUERY
    SELECT p.id,
           CASE WHEN p.gender_pricing_consent THEN p.gender_enc END,
           CASE WHEN p.gender_pricing_consent THEN p.gender_key_version END
      FROM public.persons p WHERE p.id = v_person;
END;
$$;
REVOKE ALL ON FUNCTION charge_gender_for_derivation(text, uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION charge_gender_for_derivation(text, uuid, uuid, uuid) TO app;

-- R-C1-a: the definer owner calls tenant_capability_authorize (EXECUTE: plexco + app at the base).
-- Measured at the base: the owner already holds it, so this conditional GRANT is a no-op there.
DO $$
BEGIN
  IF NOT has_function_privilege(current_user,
       'public.tenant_capability_authorize(uuid, text, uuid)', 'EXECUTE') THEN
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.tenant_capability_authorize(uuid, text, uuid) TO %I',
                   current_user);
  END IF;
END
$$;
