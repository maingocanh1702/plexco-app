-- ============================================================================
-- 0058_player_self_join.sql
-- Phase 3 lane L8 (M9 player self-join). Authority: DD-135 (D3), DD-134 (c) and the contract in
-- docs/sessions/web-mvp-phase3-readiness-p3-m9-join-core.md section 4.7. Additive only: one app-only
-- function and one route row. No table, column, index, CHECK, policy or table grant (join_requests
-- already has RLS and app grants from the 0009 loop), so schema.ts and db.dbml are unchanged.
--
-- (a) create_guest_membership(p_tenant_id, p_person_id) -> uuid (membership id)
--   `persons` has no grant to `app` (0009), so the app role cannot read persons.display_name to name
--   a membership: a self-join by a person without a membership in the club (and L10b's join-by-slug)
--   gets one ONLY here. Shape of 0051:
--   * tenant binding: p_tenant_id must equal the caller's app.tenant_id GUC (a malformed GUC counts
--     as unset), else insufficient_privilege. The tenant is the caller's own ?tenant= scope
--     (withTenant), never a session-id lookup;
--   * the person must exist with status 'active', else insufficient_privilege;
--   * a live (active|guest) membership of (tenant, person) is returned as is;
--   * else ONE memberships row (status 'guest', display_name copied from persons) is inserted,
--     ON CONFLICT on memberships_active_person_unique DO NOTHING, then re-read: two concurrent first
--     calls end with ONE row and the same id;
--   * it writes only that one memberships row, never matches by name (a name is not an identity,
--     DD-85, HARD RULE 4) and never touches players, charges or join_requests.
--   SET search_path = pg_catalog, public, pg_temp (pg_temp LAST, 0048 lesson); owned by the migration
--   role like 0051; REVOKE ALL FROM PUBLIC; EXECUTE for app only.
--
-- (b) The promotion lane's zalo_dm route (DD-134 (c), Z-11): ('zalo_dm', 'session', 'player.promoted'),
--   admitted by 0056's outbox_projector_routes_zalo_dm_chk, inserted as job_definer (the table owner)
--   like 0057. No job_definer-owned object is created, so no CREATE ON SCHEMA grant. zalo_dm stays
--   DISABLED: a real DM needs the owner's P0 enablement.
-- ============================================================================

CREATE FUNCTION create_guest_membership(
  p_tenant_id uuid,
  p_person_id uuid
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
    RAISE EXCEPTION 'create_guest_membership: tenant context mismatch'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- FOR SHARE (a lock, not a write): a concurrent 0054 empty-person reparent cannot flip this person
  -- to 'merged' between this check and the insert; if it got there first, the re-checked row fails
  -- status = 'active' after it commits and this function raises.
  SELECT p.display_name INTO v_name
    FROM public.persons p
   WHERE p.id = p_person_id
     AND p.status = 'active'
     FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'create_guest_membership: person is not active'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT m.id INTO v_id
    FROM public.memberships m
   WHERE m.tenant_id = p_tenant_id
     AND m.person_id = p_person_id
     AND m.status IN ('active', 'guest')
     FOR SHARE;
  IF FOUND THEN
    RETURN v_id;
  END IF;

  INSERT INTO public.memberships (tenant_id, person_id, status, display_name)
  VALUES (p_tenant_id, p_person_id, 'guest', v_name)
  ON CONFLICT (tenant_id, person_id) WHERE status IN ('active', 'guest') DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  -- A concurrent first call inserted the row and committed while this INSERT waited on it
  -- (READ COMMITTED: this statement takes a fresh snapshot and sees it).
  SELECT m.id INTO v_id
    FROM public.memberships m
   WHERE m.tenant_id = p_tenant_id
     AND m.person_id = p_person_id
     AND m.status IN ('active', 'guest')
     FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'create_guest_membership: no live membership after insert'
      USING ERRCODE = 'serialization_failure';
  END IF;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION create_guest_membership(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_guest_membership(uuid, uuid) TO app;

SET ROLE job_definer;
INSERT INTO outbox_projector_routes (projector, aggregate_type, event_type) VALUES
  ('zalo_dm', 'session', 'player.promoted');
RESET ROLE;
