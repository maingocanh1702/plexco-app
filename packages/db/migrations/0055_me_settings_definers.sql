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
--                                        ci missing / owned by another Person    invalid  (one outcome: no oracle.
--                                                                                A repeat or concurrent detach of
--                                                                                the same ci lands HERE: the first
--                                                                                call moved it to a new Person)
--                                        ci inactive                             invalid  (listed but not
--                                                                                detachable: see INACTIVE below)
--                                        otherwise                               detached: a FRESH empty Person
--                                        (display_name NULL, status active) is minted, the identity is moved onto it
--                                        (status unchanged), the identity's live link codes are revoked, one
--                                        routing_audit row `identity.channel_detached` (tenant NULL, ids only).
--
-- WHY A NEW EMPTY PERSON AND NOT A DELETE / TOMBSTONE / MERGE. The Zalo user becomes a stranger to
-- the bot again, and a later re-link goes through 0054's empty-person rule. It is NOT exactly the
-- state before linking: the name that user had then lived on the Person 0054 tombstoned, and no name
-- is stored for the identity itself (channel_identities holds no plaintext name), so the fresh Person
-- starts with display_name NULL. Copying the account Person's name would hand one Person's PII to
-- another, so nothing is copied. zalo_identity_resolve (0053) names a Person only when it mints one,
-- so the bot shows this user without a name until a later flow sets one. The Person that owns
-- memberships / charges is NEVER touched, merged, tombstoned or deleted (DD-14/15/50/67): unlinking
-- must not merge or claim anything.
--
-- INACTIVE IDENTITIES are listed (the account sees every identity still tied to its Person) but not
-- detachable: the signed unlink rule (OD-6, owner 2026-10-14) moves ACTIVE identities only. No
-- current flow sets an identity inactive, and zalo_identity_resolve (0053) reactivates one on its
-- next event, after which it can be unlinked; the web list shows such a row with no unlink action.
--
-- Hardening: SET search_path = pg_catalog, public, pg_temp, every relation public.-qualified (0048
-- lesson); EXECUTE for app only. LOCK ORDER matches 0043/0054: accounts -> persons ->
-- channel_identities. Display-name rule = TypeScript validateDisplayName (me-settings.ts): trimmed of
-- exactly what JavaScript's String.prototype.trim removes, then 1..120 CODE POINTS and no control (Cc)
-- or format (Cf) character. PostgreSQL regexes have no Unicode property classes, and their whitespace
-- class shorthand follows the database locale (NBSP is not a space under C), so both sets are
-- enumerated by hand, in E'' strings so the escapes never depend on the caller's
-- standard_conforming_strings. Cf = the 170 code points Node 20.20 and 25.6 (Unicode 17.0) report.
-- me-settings.test.ts walks every code point Node classifies Cc/Cf and every one trim() removes, so a
-- Node whose Unicode adds one fails the suite until these lists grow. The TS validator runs first in
-- the web route; this is the backstop for every other app caller.
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
  -- ECMAScript WhiteSpace + LineTerminator: exactly the set String.prototype.trim removes.
  c_space  CONSTANT text := E'[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]';
  -- Cc (U+0000 never reaches a text parameter) and Cf; see the header for where the list comes from.
  c_reject CONSTANT text := '['
    || E'\u0001-\u001f\u007f-\u009f'
    || E'\u00ad\u0600-\u0605\u061c\u06dd\u070f\u0890\u0891\u08e2\u180e'
    || E'\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb'
    || E'\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3'
    || E'\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f'
    || ']';
BEGIN
  IF p_account_id IS NULL OR p_display_name IS NULL THEN
    RAISE EXCEPTION 'person_profile_update: account id and display name are required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  v_name := regexp_replace(p_display_name, '^' || c_space || '+|' || c_space || '+$', '', 'g');
  IF char_length(v_name) < 1 OR char_length(v_name) > 120 OR v_name ~ c_reject THEN
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
  -- One outcome for: missing; owned by another Person (a repeat or concurrent detach lands here, the
  -- first call moved it); inactive (OD-6 detaches active identities only; see the header).
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
