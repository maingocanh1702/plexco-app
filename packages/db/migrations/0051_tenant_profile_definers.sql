-- ============================================================================
-- 0051_tenant_profile_definers.sql
-- Closes the gap measured in 0035: role `app` holds ZERO privileges on `tenants`, so the web
-- club-configuration step (M1b) could not write name/timezone/locale and the shell could not
-- read the club name. Same remedy as 0035/0049: two narrow SECURITY DEFINER functions, NO grant
-- on the table itself.
--
-- NUMBERING: 0050 is written by the parallel lane M2c (payment allocations) on a sibling
-- branch; this branch is rebased on top of it before merge. 0051 is deliberate, not a gap bug.
--
-- DECISION TABLE
--   function              caller state                              result
--   tenant_profile_read   GUC unset/malformed or <> p_tenant_id     RAISE insufficient_privilege
--                         GUC = p_tenant_id, tenant exists          one row (id,name,slug,timezone,locale)
--                         GUC = p_tenant_id, tenant missing         zero rows
--   tenant_profile_update GUC unset/malformed or <> p_tenant_id     RAISE insufficient_privilege
--                         tenant_capability_authorize(content.manage) denies
--                                                                   RAISE insufficient_privilege
--                         name outside 1..120 after trim, locale not in (vi,en),
--                         timezone empty                            RAISE invalid_parameter_value
--                         otherwise                                 UPDATE only non-NULL args, return row
--                         tenant missing                            zero rows
-- NULL argument = leave unchanged. IANA timezone validity stays in TypeScript (Intl).
--
-- READ is not an authorization decision: like tenant_locale (0035) it exposes only what a caller
-- already holding that tenant's GUC (set by withTenant after the web gate proved membership) may
-- see. UPDATE authorizes INSIDE the definer, FIRST, so a caller that skips the web gate still
-- cannot write.
--
-- Hardening: SET search_path = pg_catalog, public, pg_temp, every relation public.-qualified
-- (0048 lesson); EXECUTE for app only. No schema.ts change (no new table/column).
-- ============================================================================

CREATE FUNCTION tenant_profile_read(p_tenant_id uuid)
RETURNS TABLE (id uuid, name text, slug text, timezone text, locale text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_ctx uuid;
BEGIN
  BEGIN
    v_ctx := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_ctx := NULL;
  END;
  IF p_tenant_id IS NULL OR v_ctx IS NULL OR p_tenant_id <> v_ctx THEN
    RAISE EXCEPTION 'tenant_profile_read: tenant context mismatch'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
    SELECT t.id, t.name, t.slug, t.timezone, t.locale
      FROM public.tenants t
     WHERE t.id = p_tenant_id;
END;
$$;
REVOKE ALL ON FUNCTION tenant_profile_read(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenant_profile_read(uuid) TO app;

CREATE FUNCTION tenant_profile_update(
  p_tenant_id uuid,
  p_actor_person_id uuid,
  p_name text,
  p_timezone text,
  p_locale text
)
RETURNS TABLE (id uuid, name text, slug text, timezone text, locale text)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_ctx uuid;
  v_allowed boolean;
  v_name text := btrim(p_name);
BEGIN
  BEGIN
    v_ctx := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_ctx := NULL;
  END;
  IF p_tenant_id IS NULL OR v_ctx IS NULL OR p_tenant_id <> v_ctx THEN
    RAISE EXCEPTION 'tenant_profile_update: tenant context mismatch'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Authorization FIRST (DD-56): owner, or admin/co_admin via the content.manage preset.
  SELECT a.allowed INTO v_allowed
    FROM public.tenant_capability_authorize(p_tenant_id, 'content.manage', p_actor_person_id) a;
  IF v_allowed IS NOT TRUE THEN
    RAISE EXCEPTION 'tenant_profile_update: not permitted'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_name IS NOT NULL AND (char_length(v_name) < 1 OR char_length(v_name) > 120) THEN
    RAISE EXCEPTION 'tenant_profile_update: name must be 1..120 chars'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_locale IS NOT NULL AND p_locale NOT IN ('vi', 'en') THEN
    RAISE EXCEPTION 'tenant_profile_update: unsupported locale'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_timezone IS NOT NULL AND btrim(p_timezone) = '' THEN
    RAISE EXCEPTION 'tenant_profile_update: timezone required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  RETURN QUERY
    WITH u AS (
      UPDATE public.tenants t
         SET name = coalesce(v_name, t.name),
             timezone = coalesce(p_timezone, t.timezone),
             locale = coalesce(p_locale, t.locale)
       WHERE t.id = p_tenant_id
      RETURNING t.id, t.name, t.slug, t.timezone, t.locale
    )
    SELECT u.id, u.name, u.slug, u.timezone, u.locale FROM u;
END;
$$;
REVOKE ALL ON FUNCTION tenant_profile_update(uuid, uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenant_profile_update(uuid, uuid, text, text, text) TO app;
