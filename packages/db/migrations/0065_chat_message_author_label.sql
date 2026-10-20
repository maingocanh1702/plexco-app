-- ============================================================================
-- 0065_chat_message_author_label.sql
-- Phase 3 lane L15a (M10). Authority: the owner's answer "Labels ok" (2026-10-20) and the contract in
-- docs/sessions/web-mvp-phase3-readiness-p3-m10-chat-author-labels.md (section 4.3; pinned defaults L-1..L-4
-- in section 6, each "default applied, pending owner sign-off"). Replaces ONE function and adds ONE column
-- grant: chat_list_messages (0063 SECTION 4) gains exactly one trailing result column, author_label text,
-- and chat_definer gains SELECT (display_name) ON memberships. No table, column, index, trigger, policy or
-- role, so schema.ts and db.dbml are unchanged (functions are not mirrored; 0055, 0058, 0059).
-- chat_get_message and every other function are untouched.
--
-- author_label is the message author's CURRENT club display name: memberships.display_name of the author's
-- active membership in the channel's tenant, computed inside this SECURITY DEFINER function. The argument
-- list is unchanged, so the caller still passes no person id, and the result carries no new id: a label
-- exists only for the authors of the rows that the unchanged 0063 authorization already lets the caller
-- read (a non-member still gets CHAT_FORBIDDEN). persons is never read (its display_name is global PII).
--
-- THREAT MODEL. Defends against: (1) a member of club A learning a name from club B, or the name of a
-- person who is not a current member of the channel's club (the join is pinned to the channel's tenant and
-- to status = 'active'); (2) an enumeration or oracle (no person-id argument; labels exist only for the
-- authors of messages in the caller's already-authorized channel); (3) a former member's name continuing
-- to be disclosed (left and merged memberships never match the join); (4) a label carrying more PII than
-- the club display name (it is that one column, trimmed and bounded); (5) a name leaking through a
-- tombstoned (deleted or hidden) message (the label uses the body's predicate). It does NOT defend against
-- a compromised app tier, which already reads the message bodies, and it does not make a club display name
-- less PII than it is (members of the same club already see each other's club names in the roster).
--
-- DECISION TABLE (label cell; a deny is NULL, never an error; the function's authorization is unchanged):
--   author_type = 'person', ACTIVE membership in the channel's tenant, non-blank display_name, row not
--     tombstoned                                        -> left(nullif(btrim(display_name), ''), 120)
--   the same but display_name NULL or blank             -> NULL
--   membership in that tenant left, merged or guest, or none -> NULL
--   author_type <> 'person'                             -> NULL
--   tombstoned (author_deleted_at set, or moderation_state <> 'visible') -> NULL
--   one person in two clubs                             -> only the channel's club's name can appear
--   signature                                           -> unchanged; result = the 0063 ten columns + author_label
-- Pinned defaults: L-1 the CURRENT club name, not a send-time snapshot; L-2 left, merged, guest or no active
-- membership -> NULL, author_type <> 'person' -> NULL; L-3 NULL or blank -> NULL, btrim's default set
-- (control characters are not stripped; the roster shows the same value), at most 120 characters (the 0053
-- expression); L-4 tombstoned -> NULL.
--
-- JOIN KEY. (channel tenant, author_person_id, status = 'active'), not chat_messages.membership_id: a
-- re-join creates a new membership row, so a message's own membership_id can point at a left row, and the
-- label must show the current name. The partial unique index memberships_active_person_unique
-- (tenant_id, person_id) WHERE status IN ('active', 'guest') allows at most one matching row, so the LEFT
-- JOIN never duplicates a message.
--
-- WHY DROP + CREATE. CREATE OR REPLACE FUNCTION cannot change a function's result type, and the RETURNS
-- TABLE gains a column. The DROP has no CASCADE, so it fails if any object depends on the function (step 0
-- found none; its callers are SQL calls, which record no dependency). A DROP discards the old ACL, so the
-- REVOKE and GRANT below re-assert it as 0063 had it: EXECUTE for app only.
--
-- WHY THE SET ROLE BRACKET (precedent 0032; the same transient step 0063 SECTION 4 runs). The function must
-- be owned by chat_definer, the narrow role whose grants it runs with. Creating it under SET ROLE
-- chat_definer makes chat_definer the owner directly; chat_definer holds CREATE on schema public for the
-- bracket only and loses it again at the end. The column grant is issued by the migration role, outside
-- the bracket.
-- ============================================================================

-- 1. The one column grant (migration role). The label reads memberships.display_name; chat_definer already
--    holds SELECT on the columns the join uses (tenant_id, person_id, status).
GRANT SELECT (display_name) ON public.memberships TO chat_definer;

-- 2. The SET ROLE bracket: transient CREATE on schema public, then DROP + CREATE as chat_definer.
GRANT USAGE, CREATE ON SCHEMA public TO chat_definer;
SET ROLE chat_definer;

DROP FUNCTION public.chat_list_messages(uuid, timestamptz, uuid, text, integer);

CREATE FUNCTION public.chat_list_messages(p_channel uuid, p_cursor_created_at timestamptz DEFAULT NULL,
  p_cursor_id uuid DEFAULT NULL, p_direction text DEFAULT 'before', p_limit integer DEFAULT 50)
RETURNS TABLE (id uuid, channel_id uuid, author_type text, author_person_id uuid, body text,
  reply_to_message_id uuid, edited_at timestamptz, edit_count smallint, tombstone text, created_at timestamptz,
  author_label text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_ch record;
  v_tenant uuid;
  v_person uuid;
  v_dir text := coalesce(p_direction, 'before');
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
BEGIN
  SELECT ch.kind, ch.tenant_id INTO v_ch FROM public.chat_channels ch WHERE ch.id = p_channel;
  IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE = 'CHAT_FORBIDDEN'; END IF;
  IF v_ch.kind <> 'club' THEN RAISE EXCEPTION USING MESSAGE = 'CHAT_SAFETY_BLOCKED'; END IF;
  IF current_setting('app.tenant_id', true) ~* '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$' THEN
    v_tenant := current_setting('app.tenant_id', true)::uuid;
  END IF;
  IF current_setting('app.person_id', true) ~* '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$' THEN
    v_person := current_setting('app.person_id', true)::uuid;
  END IF;
  PERFORM 1 FROM public.chat_members cm
    JOIN public.memberships m ON (m.id, m.person_id, m.tenant_id) = (cm.membership_id, cm.person_id, cm.tenant_id)
   WHERE cm.channel_id = p_channel AND cm.person_id = v_person AND m.status = 'active' AND v_ch.tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE = 'CHAT_FORBIDDEN'; END IF;
  IF v_dir NOT IN ('before', 'after') OR (p_cursor_created_at IS NULL) <> (p_cursor_id IS NULL) THEN
    RAISE EXCEPTION USING MESSAGE = 'INVALID_BODY';
  END IF;
  -- two queries, not a CASE-ordered one, so each page stays an index range scan of LIMIT rows
  IF v_dir = 'before' THEN
    RETURN QUERY SELECT msg.id, msg.channel_id, msg.author_type, msg.author_person_id,
        CASE WHEN msg.author_deleted_at IS NULL AND msg.moderation_state = 'visible' THEN msg.body END,
        msg.reply_to_message_id, msg.edited_at, msg.edit_count,
        CASE WHEN msg.author_deleted_at IS NOT NULL THEN 'author_deleted'
             WHEN msg.moderation_state <> 'visible' THEN 'moderation_hidden' END,
        msg.created_at,
        CASE WHEN msg.author_deleted_at IS NULL AND msg.moderation_state = 'visible' AND msg.author_type = 'person'
             THEN left(nullif(btrim(am.display_name), ''), 120) END AS author_label
      FROM public.chat_messages msg
      LEFT JOIN public.memberships am
        ON am.tenant_id = v_ch.tenant_id AND am.person_id = msg.author_person_id AND am.status = 'active'
     WHERE msg.channel_id = p_channel
       AND (p_cursor_id IS NULL OR (msg.created_at, msg.id) < (p_cursor_created_at, p_cursor_id))
     ORDER BY msg.created_at DESC, msg.id DESC LIMIT v_limit;
  ELSE
    RETURN QUERY SELECT msg.id, msg.channel_id, msg.author_type, msg.author_person_id,
        CASE WHEN msg.author_deleted_at IS NULL AND msg.moderation_state = 'visible' THEN msg.body END,
        msg.reply_to_message_id, msg.edited_at, msg.edit_count,
        CASE WHEN msg.author_deleted_at IS NOT NULL THEN 'author_deleted'
             WHEN msg.moderation_state <> 'visible' THEN 'moderation_hidden' END,
        msg.created_at,
        CASE WHEN msg.author_deleted_at IS NULL AND msg.moderation_state = 'visible' AND msg.author_type = 'person'
             THEN left(nullif(btrim(am.display_name), ''), 120) END AS author_label
      FROM public.chat_messages msg
      LEFT JOIN public.memberships am
        ON am.tenant_id = v_ch.tenant_id AND am.person_id = msg.author_person_id AND am.status = 'active'
     WHERE msg.channel_id = p_channel
       AND (p_cursor_id IS NULL OR (msg.created_at, msg.id) > (p_cursor_created_at, p_cursor_id))
     ORDER BY msg.created_at, msg.id LIMIT v_limit;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.chat_list_messages(uuid, timestamptz, uuid, text, integer) FROM PUBLIC, app_worker, readonly;
GRANT EXECUTE ON FUNCTION public.chat_list_messages(uuid, timestamptz, uuid, text, integer) TO app;

RESET ROLE;
REVOKE CREATE ON SCHEMA public FROM chat_definer;
