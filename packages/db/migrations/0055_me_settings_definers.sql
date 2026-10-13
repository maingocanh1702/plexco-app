-- ============================================================================
-- 0055_me_settings_definers.sql
-- Web MVP lane M4 (user settings, launch minimum). `persons`, `accounts` and `channel_identities`
-- are global protected tables: role `app` holds NO table privilege (0009), so the signed-in user's
-- profile and linked-channel list must be reached through narrow SECURITY DEFINER functions, same
-- remedy as 0052/0053/0054. The acting account is the ONLY identity input: every function resolves
-- the account's own ACTIVE Person from `accounts.person_id`; no function takes a person id.
--
-- DECISION TABLE (anything not listed is refused; none of these reads a tenant GUC: tenant-less)
--   person_profile_read(account)         account/person active                   one row (person_id, display_name)
--                                        account missing / person not active /
--                                        NULL account                            zero rows
--   person_profile_update(account, name) account or name NULL                    RAISE invalid_parameter_value
--                                        name after trim not 1..120 code points,
--                                        or holds a control/format character     RAISE invalid_parameter_value
--                                        account missing / person not active     zero rows
--                                        otherwise                               ONLY persons.display_name is written
--   account_linked_channels(account)     account/person active                   every identity of that Person
--                                                                                (active AND inactive), newest first,
--                                                                                NO platform id / username / hash
--                                        otherwise                               zero rows
--   channel_identity_detach(account, ci) account or ci NULL                      RAISE invalid_parameter_value
--     (the UNLINK rule)                  account has no active Person            invalid
--                                        ci missing / owned by another Person    invalid  (one outcome: no oracle)
--                                        ci already inactive                     invalid  (a concurrent double
--                                                                                detach: the second call lands here)
--                                        otherwise                               detached: a FRESH empty Person
--                                        (display_name NULL, status active) is minted, the identity is moved onto it
--                                        (status unchanged), the identity's live link codes are revoked, one
--                                        routing_audit row `identity.channel_detached` (tenant NULL, ids only).
--
-- WHY A NEW EMPTY PERSON AND NOT A DELETE / TOMBSTONE / MERGE. The Zalo user simply becomes a
-- stranger again, exactly the state before linking (zalo_identity_resolve mints one empty Person per
-- new Zalo user); a later re-link goes through 0054's empty-person rule. The Person that owns
-- memberships / charges is NEVER touched, merged, tombstoned or deleted (DD-14/15/50/67): unlinking
-- must not merge or claim anything.
--
-- Hardening: SET search_path = pg_catalog, public, pg_temp, every relation public.-qualified (0048
-- lesson); EXECUTE for app only. LOCK ORDER matches 0043/0054: accounts -> persons ->
-- channel_identities. display-name rule = TypeScript validateDisplayName (me-settings.ts): trimmed,
-- 1..120 CODE POINTS, no control (Cc) or format (Cf) character. Cf is enumerated by hand (PostgreSQL
-- regexes have no \p{}); the TS side is authoritative, this is the backstop.
-- No schema.ts change (no new table/column).
-- ============================================================================

CREATE FUNCTION person_profile_read(p_account_id uuid)
RETURNS TABLE (person_id uuid, display_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT p.id, p.display_name
    FROM public.accounts a
    JOIN public.persons p ON p.id = a.person_id AND p.status = 'active'
   WHERE a.id = p_account_id;
$$;
REVOKE ALL ON FUNCTION person_profile_read(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION person_profile_read(uuid) TO app;

CREATE FUNCTION person_profile_update(p_account_id uuid, p_display_name text)
RETURNS TABLE (person_id uuid, display_name text)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_name   text;
  v_person uuid;
BEGIN
  IF p_account_id IS NULL OR p_display_name IS NULL THEN
    RAISE EXCEPTION 'person_profile_update: account id and display name are required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  v_name := regexp_replace(p_display_name, '^\s+|\s+$', '', 'g');
  IF char_length(v_name) < 1 OR char_length(v_name) > 120
     OR v_name ~ '[\u0001-\u001f\u007f-\u009f­؀-؅؜۝܏᠎​-‏‪-‮⁠-⁤⁦-⁯﻿￹-￻\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f]' THEN
    RAISE EXCEPTION 'person_profile_update: display name must be 1-120 printable characters'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT a.person_id INTO v_person FROM public.accounts a WHERE a.id = p_account_id FOR UPDATE;
  IF v_person IS NULL THEN RETURN; END IF;
  -- ONLY display_name is written; the status filter makes a merged/deleted Person unwritable.
  UPDATE public.persons SET display_name = v_name
   WHERE id = v_person AND status = 'active'
   RETURNING id, display_name INTO v_person, v_name;
  IF NOT FOUND THEN RETURN; END IF;
  RETURN QUERY SELECT v_person, v_name;
END;
$$;
REVOKE ALL ON FUNCTION person_profile_update(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION person_profile_update(uuid, text) TO app;

CREATE FUNCTION account_linked_channels(p_account_id uuid)
RETURNS TABLE (channel_identity_id uuid, platform text, status text, created_at timestamptz, zalo_bot_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT c.id, c.platform, c.status, c.created_at, c.zalo_bot_id
    FROM public.accounts a
    JOIN public.persons p ON p.id = a.person_id AND p.status = 'active'
    JOIN public.channel_identities c ON c.person_id = p.id
   WHERE a.id = p_account_id
   ORDER BY c.created_at DESC, c.id DESC;
$$;
REVOKE ALL ON FUNCTION account_linked_channels(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION account_linked_channels(uuid) TO app;

CREATE FUNCTION channel_identity_detach(p_account_id uuid, p_channel_identity_id uuid)
RETURNS TABLE (outcome text, new_person_id uuid)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_person uuid;
  v_owner  uuid;
  v_status text;
  v_new    uuid;
BEGIN
  IF p_account_id IS NULL OR p_channel_identity_id IS NULL THEN
    RAISE EXCEPTION 'channel_identity_detach: account id and channel identity id are required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- locks: accounts -> persons -> channel_identities (0043/0054 order); re-derive under the lock.
  SELECT a.person_id INTO v_person FROM public.accounts a WHERE a.id = p_account_id FOR UPDATE;
  IF v_person IS NULL THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::uuid; RETURN;
  END IF;
  PERFORM 1 FROM public.persons p WHERE p.id = v_person AND p.status = 'active' FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::uuid; RETURN;
  END IF;
  SELECT c.person_id, c.status INTO v_owner, v_status
    FROM public.channel_identities c WHERE c.id = p_channel_identity_id FOR UPDATE;
  IF NOT FOUND OR v_owner IS DISTINCT FROM v_person OR v_status <> 'active' THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::uuid; RETURN;
  END IF;

  INSERT INTO public.persons (display_name, status) VALUES (NULL, 'active') RETURNING id INTO v_new;
  UPDATE public.channel_identities SET person_id = v_new WHERE id = p_channel_identity_id;
  -- A code issued by this identity names the OLD Person as its source; it must not outlive the link.
  UPDATE public.link_codes SET revoked_at = clock_timestamp()
   WHERE source_channel_identity_id = p_channel_identity_id
     AND consumed_at IS NULL AND revoked_at IS NULL;
  INSERT INTO public.routing_audit (action, actor_id, tenant_id, detail)
    VALUES ('identity.channel_detached', p_account_id, NULL,
            jsonb_build_object('channel_identity_id', p_channel_identity_id,
                               'from_person_id', v_person, 'to_person_id', v_new));
  RETURN QUERY SELECT 'detached'::text, v_new;
END;
$$;
REVOKE ALL ON FUNCTION channel_identity_detach(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION channel_identity_detach(uuid, uuid) TO app;
