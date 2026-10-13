-- ============================================================================
-- 0051_host_add_person_definer.sql
-- Web MVP lane M2c: a host adds a NEW player by display name. `persons` is a global protected
-- table with no grant to `app` (0009), so the only way the app role may mint one is a narrow
-- SECURITY DEFINER function -- the same model as auth_login_* (0012).
--
-- create_host_added_person(p_tenant_id, p_actor_person_id, p_display_name) -> uuid
--   * tenant binding: p_tenant_id must equal the caller's app.tenant_id GUC (0049/0038 shape),
--     else insufficient_privilege -- never serves a caller that has not scoped its transaction;
--   * the actor must be an ACTIVE web tenant_admins row of that tenant (the service ALSO runs
--     authorize(session.manage) first; this is the definer's own defence in depth);
--   * display name: trimmed, 1..100 characters, else invalid_parameter_value;
--   * inserts ONE persons row (status default 'active', no phone, no account) and returns its id.
-- It never reads or links an existing person: a name is not an identity (DD-85).
-- SET search_path = pg_catalog, public, pg_temp (pg_temp LAST, 0048 lesson); EXECUTE for app only.
-- ============================================================================

CREATE FUNCTION create_host_added_person(
  p_tenant_id uuid,
  p_actor_person_id uuid,
  p_display_name text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_ctx uuid;
  v_name text;
  v_id uuid;
BEGIN
  BEGIN
    v_ctx := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_ctx := NULL;
  END;
  IF p_tenant_id IS NULL OR v_ctx IS NULL OR p_tenant_id <> v_ctx THEN
    RAISE EXCEPTION 'create_host_added_person: tenant context mismatch'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_actor_person_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.tenant_admins ta
     WHERE ta.tenant_id = p_tenant_id
       AND ta.platform = 'web'
       AND ta.platform_user_lookup_hash = p_actor_person_id::text
       AND ta.active
  ) THEN
    RAISE EXCEPTION 'create_host_added_person: actor is not an active tenant admin'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_name := btrim(p_display_name);
  IF v_name IS NULL OR char_length(v_name) < 1 OR char_length(v_name) > 100 THEN
    RAISE EXCEPTION 'create_host_added_person: display name must be 1..100 characters'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  INSERT INTO public.persons (display_name) VALUES (v_name) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION create_host_added_person(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_host_added_person(uuid, uuid, text) TO app;
