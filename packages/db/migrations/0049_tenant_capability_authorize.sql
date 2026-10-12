-- ============================================================================
-- 0049_tenant_capability_authorize.sql
-- tenant-capability-authority-core, Milestone 2 (lane M2a-1): the locked
-- SECURITY DEFINER authorize primitive DD-56 pins as the ONE authorization
-- source (docs/features/BE/feature_tenant_routing_authz_tech.md §4 "AuthZ
-- Action Matrix" + "Actor-recheck-under-lock").
--
-- tenant_capability_authorize(p_tenant_id, p_action, p_actor_person_id)
--   -> (allowed boolean, role text, reason text)   always exactly ONE row.
--
-- Decision table (anything not listed is DENIED):
--   condition                                                    -> allowed | reason
--   p_tenant_id NULL / app.tenant_id unset / different           -> no      | tenant_context
--   p_action NULL or not a tenant_capability_actions row         -> no      | unknown_action
--   p_actor_person_id NULL, or no ACTIVE web tenant_admins row
--     for (tenant, actor) -- cross-tenant actor, inactive admin  -> no      | not_a_member
--   role owner            x any registry action class            -> yes     | (null)
--   role admin|co_admin   x preset                               -> yes     | (null)   (admin == co_admin)
--   role admin|co_admin   x owner_grantable + current grant      -> yes     | (null)
--   role admin|co_admin   x owner_grantable, no/expired/revoked  -> no      | grant_required
--   role admin|co_admin   x owner_only | platform_admin_only     -> no      | not_permitted
--   any other role literal                                       -> no      | not_permitted
--
-- Locking (actor-recheck-under-lock): the tenant_admins row and, for a
-- delegable action, the matching grant row are read FOR SHARE, so a concurrent
-- role deactivation or revoke blocks until the CALLER's transaction ends
-- (the 0038 resolve_subscription_locked shape). Every time predicate uses
-- clock_timestamp(), never now(): now() is frozen at transaction start and
-- would not advance while this call waits on the lock (audit lesson C1).
--
-- Actor -> tenant mapping: the SAME predicate tenant_ids_for_person() (0012,
-- 0037) uses -- platform = 'web' AND platform_user_lookup_hash =
-- p_person_id::text AND active -- narrowed to one tenant. It cannot call that
-- function directly because it needs the row lock; the test file asserts the
-- two agree for owner/admin/co_admin/inactive/cross-tenant rows.
--
-- Hardening: SET search_path = pg_catalog, public, pg_temp with every relation
-- schema-qualified (0048 temp-table shadowing lesson); tenant binding mirrors
-- 0038 (a caller that has not scoped its transaction is denied, never served
-- another tenant's answer); EXECUTE for app only.
-- ============================================================================

CREATE FUNCTION tenant_capability_authorize(
  p_tenant_id uuid,
  p_action text,
  p_actor_person_id uuid
)
RETURNS TABLE (allowed boolean, role text, reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_ctx uuid;
  v_class text;
  v_role text;
  v_grant uuid;
BEGIN
  -- 1. Tenant binding. A malformed GUC is treated as unset (fail-closed).
  BEGIN
    v_ctx := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_ctx := NULL;
  END;
  IF p_tenant_id IS NULL OR v_ctx IS NULL OR p_tenant_id <> v_ctx THEN
    RETURN QUERY SELECT false, NULL::text, 'tenant_context'::text;
    RETURN;
  END IF;

  -- 2. Closed registry lookup: unknown / NULL action is a deny, never a role fallback.
  SELECT a.authority_class INTO v_class
    FROM public.tenant_capability_actions a
   WHERE a.action_key = p_action;
  IF v_class IS NULL THEN
    RETURN QUERY SELECT false, NULL::text, 'unknown_action'::text;
    RETURN;
  END IF;

  -- 3. Current actor role, locked. Same predicate as tenant_ids_for_person(), one tenant.
  IF p_actor_person_id IS NOT NULL THEN
    SELECT ta.role INTO v_role
      FROM public.tenant_admins ta
     WHERE ta.tenant_id = p_tenant_id
       AND ta.platform = 'web'
       AND ta.platform_user_lookup_hash = p_actor_person_id::text
       AND ta.active
       FOR SHARE;
  END IF;
  IF v_role IS NULL THEN
    RETURN QUERY SELECT false, NULL::text, 'not_a_member'::text;
    RETURN;
  END IF;

  -- 4. Decision table.
  IF v_role = 'owner' THEN
    RETURN QUERY SELECT true, v_role, NULL::text;
    RETURN;
  END IF;
  IF v_role NOT IN ('admin', 'co_admin') THEN
    RETURN QUERY SELECT false, NULL::text, 'not_permitted'::text;
    RETURN;
  END IF;

  IF v_class = 'preset' THEN
    RETURN QUERY SELECT true, v_role, NULL::text;
    RETURN;
  ELSIF v_class = 'owner_grantable' THEN
    SELECT g.id INTO v_grant
      FROM public.tenant_capability_grants g
     WHERE g.tenant_id = p_tenant_id
       AND g.grantee_person_id = p_actor_person_id
       AND g.action_key = p_action
       AND g.revoked_at IS NULL
       AND g.expires_at > clock_timestamp()
       FOR SHARE;
    IF v_grant IS NOT NULL THEN
      RETURN QUERY SELECT true, v_role, NULL::text;
    ELSE
      RETURN QUERY SELECT false, NULL::text, 'grant_required'::text;
    END IF;
    RETURN;
  END IF;

  -- owner_only, platform_admin_only, or any future class: deny.
  RETURN QUERY SELECT false, NULL::text, 'not_permitted'::text;
END;
$$;
REVOKE ALL ON FUNCTION tenant_capability_authorize(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenant_capability_authorize(uuid, text, uuid) TO app;
