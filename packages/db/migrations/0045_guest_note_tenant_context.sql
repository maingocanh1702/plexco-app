-- Guest-note routing association only: commands still own mutation permissions
-- and actor-bound replay. The caller supplies an authenticated person, never a
-- request-body identity. Preserve tenant_ids_for_person's admin-only contract.
CREATE FUNCTION public.guest_note_tenant_for_person(
  p_person_id uuid, p_tenant_id uuid, p_session_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_previous_tenant text := current_setting('app.tenant_id', true);
  v_matches boolean;
BEGIN
  IF p_person_id IS NULL OR p_tenant_id IS NULL OR p_session_id IS NULL THEN
    RETURN NULL;
  END IF;
  PERFORM set_config('app.tenant_id', p_tenant_id::text, true);
  SELECT
    EXISTS (
      SELECT 1 FROM public.players p
      JOIN public.memberships m
        ON m.id = p.membership_id AND m.tenant_id = p.tenant_id
      WHERE p.tenant_id = p_tenant_id AND p.session_id = p_session_id
        AND m.person_id = p_person_id
    ) OR EXISTS (
      SELECT 1 FROM public.session_guest_notes n
      WHERE n.tenant_id = p_tenant_id AND n.session_id = p_session_id
        AND n.created_by_person_id = p_person_id
    ) OR EXISTS (
      -- ponytail: existing tenant-key lookup leaves O(commands in candidate tenant) fallback work.
      -- Add a separately reviewed online expression index if measured lookup latency is too high.
      SELECT 1 FROM public.processed_commands c
      WHERE c.tenant_id = p_tenant_id
        AND c.command_type IN ('CreateGuestNote', 'DeleteGuestNote')
        AND c.result_ref->>'actorPersonId' = p_person_id::text
        AND c.result_ref->>'sessionId' = p_session_id::text
    ) INTO v_matches;
  PERFORM set_config('app.tenant_id', coalesce(v_previous_tenant, ''), true);
  RETURN CASE WHEN v_matches THEN p_tenant_id ELSE NULL END;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.tenant_id', coalesce(v_previous_tenant, ''), true);
  RAISE;
END;
$$;
REVOKE ALL ON FUNCTION public.guest_note_tenant_for_person(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guest_note_tenant_for_person(uuid,uuid,uuid) TO app;
