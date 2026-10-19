-- 0063 chat_message_commands: the L14 chat command core on the 0031 chat_* tables.
-- Authority: docs/sessions/web-mvp-phase3-readiness-p3-m10-chat-core.md (CODE_READY; RO-L14-1..5, Amendment 1,
-- RO-S11-1). Rulings: club channels only (D4), every function checks the channel kind first so DM stays unreachable
-- (V-4); every write goes through a chat_definer-owned SECURITY DEFINER function; app keeps no write and no content
-- column on chat_messages (V-13); the three new tables are append-only and reachable only by chat_definer (4.3, 4.4).
-- Threat model: the caller is the trusted web process, which sets app.tenant_id and app.person_id (V-7); the attacker
-- is a member or non-member who tries to read another tenant's or channel's messages, read a hidden or deleted body,
-- post or moderate without the capability, reach a DM, or rewrite history. Defenses: RLS, column grants, kind-first
-- checks, tenant_capability_authorize, append-only tables. No message or note text in any error, log or NOTIFY.

-- SECTION 1: append-only tables and grants (4.3, 4.4)
CREATE TABLE chat_message_revisions (
  message_id uuid NOT NULL REFERENCES chat_messages(id),
  revision_no smallint NOT NULL,
  previous_body text NOT NULL,
  edited_by_person_id uuid NOT NULL REFERENCES persons(id),
  edited_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (message_id, revision_no)
); -- no CHECK: a CHECK violation DETAIL would print previous_body (K-3)

CREATE TABLE chat_moderation_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  channel_id uuid NOT NULL,
  message_id uuid NOT NULL,
  actor_person_id uuid NOT NULL REFERENCES persons(id),
  -- closed-set CHECKs narrowed to the MVP (mutes are OUT); the function validates first, so they never fire on the
  -- command path (orchestrator amendment to 4.3).
  action text NOT NULL CONSTRAINT chat_moderation_audit_action_chk CHECK (action IN ('hide','restore')),
  reason_code text NOT NULL CONSTRAINT chat_moderation_audit_reason_code_chk
    CHECK (reason_code IN ('spam','harassment','unsafe','off_topic','other')),
  reason_note text,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT chat_moderation_audit_channel_tenant_fk FOREIGN KEY (channel_id, tenant_id)
    REFERENCES chat_channels(id, tenant_id),
  CONSTRAINT chat_moderation_audit_message_fk FOREIGN KEY (channel_id, message_id)
    REFERENCES chat_messages(channel_id, id),
  CONSTRAINT chat_moderation_audit_reason_note_chk CHECK (
    (reason_code = 'other' AND reason_note IS NOT NULL AND octet_length(reason_note) BETWEEN 1 AND 500)
    OR (reason_code <> 'other' AND reason_note IS NULL))
);

CREATE TABLE chat_command_receipts (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  actor_person_id uuid NOT NULL REFERENCES persons(id),
  command_id uuid NOT NULL,
  action text NOT NULL CONSTRAINT chat_command_receipts_action_chk CHECK (action IN ('channel.create',
    'channel.rename','channel.set_default','channel.archive','message.hide','message.restore','member.mute')),
  canonical_fingerprint text NOT NULL,
  result_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, actor_person_id, command_id)
);

ALTER TABLE chat_message_revisions ENABLE ROW LEVEL SECURITY; ALTER TABLE chat_message_revisions FORCE ROW LEVEL SECURITY;
ALTER TABLE chat_moderation_audit ENABLE ROW LEVEL SECURITY;  ALTER TABLE chat_moderation_audit FORCE ROW LEVEL SECURITY;
ALTER TABLE chat_command_receipts ENABLE ROW LEVEL SECURITY;  ALTER TABLE chat_command_receipts FORCE ROW LEVEL SECURITY;
-- RO-S11-1: one tenant_isolation policy (0060 shape) on the two tenant_id tables; inert for chat_definer (BYPASSRLS)
-- while no runtime role holds a grant. chat_message_revisions has no tenant_id and no policy.
CREATE POLICY tenant_isolation ON chat_moderation_audit
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY tenant_isolation ON chat_command_receipts
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE FUNCTION forbid_chat_append_only_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (% blocked)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;
CREATE TRIGGER trg_chat_message_revisions_immutable BEFORE UPDATE OR DELETE ON chat_message_revisions
  FOR EACH ROW EXECUTE FUNCTION forbid_chat_append_only_mutation();
CREATE TRIGGER trg_chat_moderation_audit_immutable BEFORE UPDATE OR DELETE ON chat_moderation_audit
  FOR EACH ROW EXECUTE FUNCTION forbid_chat_append_only_mutation();
CREATE TRIGGER trg_chat_command_receipts_immutable BEFORE UPDATE OR DELETE ON chat_command_receipts
  FOR EACH ROW EXECUTE FUNCTION forbid_chat_append_only_mutation();

REVOKE ALL ON chat_message_revisions, chat_moderation_audit, chat_command_receipts
  FROM PUBLIC, app, app_worker, readonly;
GRANT INSERT, SELECT ON chat_message_revisions, chat_moderation_audit, chat_command_receipts TO chat_definer;
-- RO-L14-6, contract 0054:72-75: every person FK must be readable by identity_definer, else every link is requires_review.
GRANT SELECT (edited_by_person_id) ON chat_message_revisions TO identity_definer;
GRANT SELECT (actor_person_id) ON chat_moderation_audit TO identity_definer;
GRANT SELECT (actor_person_id) ON chat_command_receipts TO identity_definer;

-- V-13: column grants are additive, so the table-level read is revoked FIRST, then the 14-column allowlist.
REVOKE SELECT ON chat_messages FROM app;
GRANT SELECT (id, channel_id, tenant_id, author_type, author_person_id, membership_id, reply_to_message_id, edited_at,
  edit_count, author_deleted_at, moderation_state, moderation_updated_at, client_msg_id, created_at)
  ON chat_messages TO app;

-- chat_definer (4.4). tenant_id of chat_members / chat_messages comes from the 0031 BEFORE triggers.
GRANT INSERT (tenant_id, kind, title, is_default, sort_order, creation_origin, post_policy, assistant_enabled),
  UPDATE (archived_at) ON chat_channels TO chat_definer;
GRANT INSERT (channel_id, person_id, membership_id),
  UPDATE (last_read_created_at, last_read_message_id, membership_id) ON chat_members TO chat_definer;
GRANT SELECT ON chat_messages TO chat_definer;
GRANT INSERT (channel_id, author_type, author_person_id, membership_id, body, reply_to_message_id, client_msg_id,
  created_at),
  UPDATE (body, edited_at, edit_count, author_deleted_at, moderation_state, moderation_updated_at,
  moderation_actor_person_id, moderation_reason_code) ON chat_messages TO chat_definer;
GRANT EXECUTE ON FUNCTION tenant_capability_authorize(uuid, text, uuid) TO chat_definer;

-- SECTION 2: functions (W2 provisioning core, W3a send, W3b edit/delete/mark_read, W3c moderate, W4 read)

-- V-14/V-15 provisioning core (internal, no EXECUTE for app): ensure the tenant's default club channel, then one
-- chat_members row per non-archived club channel. A replay writes nothing; a re-join re-points membership_id only,
-- so the row's read cursor is kept. Reached only through the memberships trigger and the backfill.
CREATE FUNCTION chat_provision_member(p_tenant uuid, p_person uuid, p_membership uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  INSERT INTO public.chat_channels
    (tenant_id, kind, title, is_default, sort_order, creation_origin, post_policy, assistant_enabled)
  VALUES (p_tenant, 'club', 'Kênh chung', true, 0, 'system_bootstrap', 'all_members', false)
  ON CONFLICT (tenant_id) WHERE kind = 'club' AND is_default IS TRUE AND archived_at IS NULL DO NOTHING;
  -- a separate statement re-reads, so a default committed by a concurrent activation is visible
  INSERT INTO public.chat_members (channel_id, person_id, membership_id)
  SELECT c.id, p_person, p_membership
    FROM public.chat_channels c
   WHERE c.tenant_id = p_tenant AND c.kind = 'club' AND c.archived_at IS NULL
  ON CONFLICT (channel_id, person_id) DO UPDATE SET membership_id = EXCLUDED.membership_id
    WHERE chat_members.membership_id IS DISTINCT FROM EXCLUDED.membership_id;
END;
$$;
REVOKE ALL ON FUNCTION chat_provision_member(uuid, uuid, uuid) FROM PUBLIC, app, app_worker, readonly;

-- V-16: ids from NEW only; no advisory lock (D12's lock order untouched), no NOTIFY, no outbox; it writes only
-- chat_channels and chat_members, so the UPDATE arm cannot recurse.
CREATE FUNCTION chat_memberships_provision_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  PERFORM public.chat_provision_member(NEW.tenant_id, NEW.person_id, NEW.id);
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION chat_memberships_provision_trg() FROM PUBLIC, app, app_worker, readonly;

-- V-17 backfill: the same core over every active membership. Defined here so SECTION 4 can own it before SECTION 5
-- runs it. Returns the number of active memberships it ran the core for.
CREATE FUNCTION chat_backfill_default_channels()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  r record;
  n integer := 0;
BEGIN
  FOR r IN
    SELECT m.tenant_id, m.person_id, m.id FROM public.memberships m WHERE m.status = 'active' ORDER BY m.tenant_id, m.id
  LOOP
    PERFORM public.chat_provision_member(r.tenant_id, r.person_id, r.id);
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION chat_backfill_default_channels() FROM PUBLIC, app, app_worker, readonly;

-- 4.2 send (W3a). First failing check wins: channel lock + kind -> actor, tenant, active member -> client_msg_id
-- shape -> duplicate -> post_policy -> body -> reply target -> two rate buckets -> INSERT -> NOTIFY (new row only).
CREATE FUNCTION send_chat_message(p_channel uuid, p_client_msg_id text, p_body text,
  p_reply_to_message_id uuid DEFAULT NULL)
RETURNS TABLE (id uuid, created_at timestamptz, duplicate boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_ch record;
  v_dup record;
  v_tenant uuid;
  v_person uuid;
  v_membership uuid;
  v_id uuid;
  v_at timestamptz;
BEGIN
  -- V-6: lock and read in one statement, first; V-4: the kind before any other check, generic code
  SELECT ch.kind, ch.tenant_id, ch.post_policy INTO v_ch
    FROM public.chat_channels ch WHERE ch.id = p_channel FOR NO KEY UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE = 'CHAT_FORBIDDEN'; END IF;
  IF v_ch.kind <> 'club' THEN RAISE EXCEPTION USING MESSAGE = 'CHAT_SAFETY_BLOCKED'; END IF;
  -- V-7: actor and tenant come only from the GUCs; unset or malformed fails closed
  IF current_setting('app.tenant_id', true) ~* '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$' THEN
    v_tenant := current_setting('app.tenant_id', true)::uuid;
  END IF;
  IF current_setting('app.person_id', true) ~* '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$' THEN
    v_person := current_setting('app.person_id', true)::uuid;
  END IF;
  SELECT m.id INTO v_membership
    FROM public.chat_members cm
    JOIN public.memberships m ON (m.id, m.person_id, m.tenant_id) = (cm.membership_id, cm.person_id, cm.tenant_id)
   WHERE cm.channel_id = p_channel AND cm.person_id = v_person AND m.status = 'active' AND v_ch.tenant_id = v_tenant;
  IF v_membership IS NULL THEN RAISE EXCEPTION USING MESSAGE = 'CHAT_FORBIDDEN'; END IF;
  -- V-2
  IF p_client_msg_id IS NULL OR char_length(p_client_msg_id) NOT BETWEEN 1 AND 64 THEN
    RAISE EXCEPTION USING MESSAGE = 'INVALID_BODY';
  END IF;
  -- V-3: the same author gets the original (no row, token or NOTIFY); anyone else a generic mismatch
  SELECT msg.id, msg.created_at, msg.author_type, msg.author_person_id INTO v_dup
    FROM public.chat_messages msg WHERE msg.channel_id = p_channel AND msg.client_msg_id = p_client_msg_id;
  IF FOUND THEN
    IF v_dup.author_type = 'person' AND v_dup.author_person_id = v_person THEN
      RETURN QUERY SELECT v_dup.id, v_dup.created_at, true;
      RETURN;
    END IF;
    RAISE EXCEPTION USING MESSAGE = 'CHAT_IDEMPOTENCY_MISMATCH';
  END IF;
  -- admins_only needs the capability (anything but allowed = true denies); an unknown policy is forbidden
  IF v_ch.post_policy = 'admins_only' THEN
    IF (SELECT a.allowed FROM public.tenant_capability_authorize(v_tenant, 'chat.channel.post_restricted', v_person) a)
       IS NOT TRUE THEN
      RAISE EXCEPTION USING MESSAGE = 'CHAT_CAPABILITY_REQUIRED';
    END IF;
  ELSIF v_ch.post_policy IS DISTINCT FROM 'all_members' THEN
    RAISE EXCEPTION USING MESSAGE = 'CHAT_FORBIDDEN';
  END IF;
  -- V-1: before any INSERT
  IF p_body IS NULL OR p_body !~ '[^[:space:]]' THEN RAISE EXCEPTION USING MESSAGE = 'INVALID_BODY'; END IF;
  IF char_length(p_body) > 4000 THEN RAISE EXCEPTION USING MESSAGE = 'CHAT_MESSAGE_TOO_LARGE'; END IF;
  -- the reply target must be a visible, not author-deleted message of this channel
  IF p_reply_to_message_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.chat_messages r
        WHERE r.id = p_reply_to_message_id AND r.channel_id = p_channel
          AND r.moderation_state = 'visible' AND r.author_deleted_at IS NULL) THEN
    RAISE EXCEPTION USING MESSAGE = 'CHAT_REPLY_INVALID';
  END IF;
  -- V-8: uuid-only bucket keys, after every other check; a rejected send rolls its token back with it
  IF NOT public.rate_limit_check('chat_send_10s:' || v_person::text || ':' || p_channel::text, 20, interval '10 seconds')
  THEN
    RAISE EXCEPTION USING MESSAGE = 'CHAT_RATE_LIMITED';
  END IF;
  IF NOT public.rate_limit_check('chat_send_1m:' || v_person::text || ':' || p_channel::text, 300, interval '1 minute')
  THEN
    RAISE EXCEPTION USING MESSAGE = 'CHAT_RATE_LIMITED';
  END IF;
  INSERT INTO public.chat_messages AS msg
    (channel_id, author_type, author_person_id, membership_id, body, reply_to_message_id, client_msg_id, created_at)
  VALUES (p_channel, 'person', v_person, v_membership, p_body, p_reply_to_message_id, p_client_msg_id, clock_timestamp())
  RETURNING msg.id, msg.created_at INTO v_id, v_at;
  -- 4.5: the id only, delivered on commit
  PERFORM pg_catalog.pg_notify('chat_realtime', v_id::text);
  RETURN QUERY SELECT v_id, v_at, false;
END;
$$;
REVOKE ALL ON FUNCTION send_chat_message(uuid, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION send_chat_message(uuid, text, text, uuid) TO app;

-- 4.2 edit, delete and mark_read (W3b) open with send's prelude: channel lock + kind -> actor, tenant, active member.
-- edit: the message FOR UPDATE in this channel -> V-9 window -> expected count -> body -> identical (no-op) -> rate
-- -> revision INSERT -> UPDATE -> NOTIFY.
CREATE FUNCTION edit_chat_message(p_channel uuid, p_message uuid, p_body text, p_expected_edit_count integer)
RETURNS TABLE (id uuid, edit_count smallint, edited_at timestamptz, changed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_ch record;
  v_msg record;
  v_tenant uuid;
  v_person uuid;
  v_count smallint;
  v_at timestamptz;
BEGIN
  SELECT ch.kind, ch.tenant_id INTO v_ch FROM public.chat_channels ch WHERE ch.id = p_channel FOR NO KEY UPDATE;
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
  SELECT msg.author_type, msg.author_person_id, msg.body, msg.edit_count, msg.edited_at, msg.created_at,
         msg.author_deleted_at, msg.moderation_state INTO v_msg
    FROM public.chat_messages msg WHERE msg.id = p_message AND msg.channel_id = p_channel FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE = 'CHAT_FORBIDDEN'; END IF;
  -- V-9, V-24: IS NOT TRUE, so a NULL author (system or assistant message) closes the window as well
  IF (v_msg.author_type = 'person' AND v_msg.author_person_id = v_person AND v_msg.author_deleted_at IS NULL
      AND v_msg.moderation_state = 'visible' AND statement_timestamp() < v_msg.created_at + interval '15 minutes'
      AND v_msg.edit_count < 5) IS NOT TRUE THEN
    RAISE EXCEPTION USING MESSAGE = 'CHAT_EDIT_WINDOW_CLOSED';
  END IF;
  IF v_msg.edit_count IS DISTINCT FROM p_expected_edit_count THEN
    RAISE EXCEPTION USING MESSAGE = 'CHAT_EDIT_CONFLICT';
  END IF;
  -- V-1: before any write
  IF p_body IS NULL OR p_body !~ '[^[:space:]]' THEN RAISE EXCEPTION USING MESSAGE = 'INVALID_BODY'; END IF;
  IF char_length(p_body) > 4000 THEN RAISE EXCEPTION USING MESSAGE = 'CHAT_MESSAGE_TOO_LARGE'; END IF;
  -- an identical body is a no-op: the stored row comes back, no revision, token or NOTIFY
  IF v_msg.body = p_body THEN
    RETURN QUERY SELECT p_message, v_msg.edit_count, v_msg.edited_at, false;
    RETURN;
  END IF;
  -- V-8: one bucket shared by edit and delete, checked last
  IF NOT public.rate_limit_check('chat_edit_1m:' || v_person::text || ':' || p_channel::text, 30, interval '1 minute')
  THEN
    RAISE EXCEPTION USING MESSAGE = 'CHAT_RATE_LIMITED';
  END IF;
  INSERT INTO public.chat_message_revisions (message_id, revision_no, previous_body, edited_by_person_id)
  VALUES (p_message, v_msg.edit_count + 1, v_msg.body, v_person);
  UPDATE public.chat_messages AS msg
     SET body = p_body, edit_count = msg.edit_count + 1, edited_at = statement_timestamp()
   WHERE msg.id = p_message
  RETURNING msg.edit_count, msg.edited_at INTO v_count, v_at;
  PERFORM pg_catalog.pg_notify('chat_realtime', p_message::text);
  RETURN QUERY SELECT p_message, v_count, v_at, true;
END;
$$;
REVOKE ALL ON FUNCTION edit_chat_message(uuid, uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION edit_chat_message(uuid, uuid, text, integer) TO app;

-- delete (V-10): the message FOR UPDATE in this channel -> own person message -> already deleted (no-op) -> rate ->
-- stamp author_deleted_at -> NOTIFY. Allowed on a hidden message; no restore, no hard delete.
CREATE FUNCTION delete_chat_message(p_channel uuid, p_message uuid)
RETURNS TABLE (id uuid, author_deleted_at timestamptz, changed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_ch record;
  v_msg record;
  v_tenant uuid;
  v_person uuid;
  v_at timestamptz;
BEGIN
  SELECT ch.kind, ch.tenant_id INTO v_ch FROM public.chat_channels ch WHERE ch.id = p_channel FOR NO KEY UPDATE;
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
  SELECT msg.author_type, msg.author_person_id, msg.author_deleted_at INTO v_msg
    FROM public.chat_messages msg WHERE msg.id = p_message AND msg.channel_id = p_channel FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE = 'CHAT_FORBIDDEN'; END IF;
  IF (v_msg.author_type = 'person' AND v_msg.author_person_id = v_person) IS NOT TRUE THEN
    RAISE EXCEPTION USING MESSAGE = 'CHAT_FORBIDDEN';
  END IF;
  IF v_msg.author_deleted_at IS NOT NULL THEN
    RETURN QUERY SELECT p_message, v_msg.author_deleted_at, false;
    RETURN;
  END IF;
  IF NOT public.rate_limit_check('chat_edit_1m:' || v_person::text || ':' || p_channel::text, 30, interval '1 minute')
  THEN
    RAISE EXCEPTION USING MESSAGE = 'CHAT_RATE_LIMITED';
  END IF;
  UPDATE public.chat_messages AS msg SET author_deleted_at = statement_timestamp() WHERE msg.id = p_message
  RETURNING msg.author_deleted_at INTO v_at;
  PERFORM pg_catalog.pg_notify('chat_realtime', p_message::text);
  RETURN QUERY SELECT p_message, v_at, true;
END;
$$;
REVOKE ALL ON FUNCTION delete_chat_message(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION delete_chat_message(uuid, uuid) TO app;

-- mark_read (V-21): membership before the through-message, which must be in this channel (else NOT_FOUND; a
-- tombstoned one is allowed) -> the caller's own cursor, forward only by (created_at, id). No rate, no NOTIFY.
CREATE FUNCTION mark_read(p_channel uuid, p_through_message uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_ch record;
  v_tenant uuid;
  v_person uuid;
  v_at timestamptz;
BEGIN
  SELECT ch.kind, ch.tenant_id INTO v_ch FROM public.chat_channels ch WHERE ch.id = p_channel FOR NO KEY UPDATE;
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
  SELECT msg.created_at INTO v_at
    FROM public.chat_messages msg WHERE msg.id = p_through_message AND msg.channel_id = p_channel;
  IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE = 'NOT_FOUND'; END IF;
  UPDATE public.chat_members AS cm SET last_read_created_at = v_at, last_read_message_id = p_through_message
   WHERE cm.channel_id = p_channel AND cm.person_id = v_person
     AND (cm.last_read_created_at IS NULL
          OR (cm.last_read_created_at, cm.last_read_message_id) < (v_at, p_through_message));
END;
$$;
REVOKE ALL ON FUNCTION mark_read(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mark_read(uuid, uuid) TO app;

-- moderate (V-11, V-26; 4.2): lock + kind -> GUCs -> member + capability -> input -> fingerprint -> receipt (replay or
-- mismatch) -> person message FOR UPDATE in this channel -> same state? -> rate -> trio + audit (effective only) ->
-- receipt -> NOTIFY (effective only). The note lives only in the audit row; the receipt holds a hash, ids and state.
CREATE FUNCTION moderate_chat_message(p_channel uuid, p_message uuid, p_command_id uuid, p_action text,
  p_reason_code text, p_reason_note text DEFAULT NULL)
RETURNS TABLE (message_id uuid, moderation_state text, changed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_kind text;
  v_ch_tenant uuid;
  v_tenant uuid;
  v_person uuid;
  v_ok boolean;
  v_fp text;
  v_old_fp text;
  v_res jsonb;
  v_cur text;
  v_hide boolean := p_action = 'hide';
  v_state text := CASE WHEN p_action = 'hide' THEN 'hidden' ELSE 'visible' END;
  v_changed boolean;
BEGIN
  SELECT ch.kind, ch.tenant_id INTO v_kind, v_ch_tenant FROM public.chat_channels ch WHERE ch.id = p_channel
    FOR NO KEY UPDATE;
  -- V-4: kind first (a missing channel is generic too), before the actor context is even read
  IF v_kind IS DISTINCT FROM 'club' THEN RAISE EXCEPTION USING MESSAGE = 'CHAT_MODERATION_FORBIDDEN'; END IF;
  IF current_setting('app.tenant_id', true) ~* '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$' THEN
    v_tenant := current_setting('app.tenant_id', true)::uuid;
  END IF;
  IF current_setting('app.person_id', true) ~* '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$' THEN
    v_person := current_setting('app.person_id', true)::uuid;
  END IF;
  IF v_tenant IS NULL OR v_person IS NULL THEN RAISE EXCEPTION USING MESSAGE = 'CHAT_FORBIDDEN'; END IF; -- V-7
  -- V-11: active member of this channel's tenant AND the capability (allowed IS NOT TRUE = deny), before any input
  PERFORM 1 FROM public.chat_members cm
    JOIN public.memberships m ON (m.id, m.person_id, m.tenant_id) = (cm.membership_id, cm.person_id, cm.tenant_id)
   WHERE cm.channel_id = p_channel AND cm.person_id = v_person AND m.status = 'active' AND v_ch_tenant = v_tenant;
  IF FOUND THEN
    SELECT a.allowed INTO v_ok FROM public.tenant_capability_authorize(v_tenant, 'chat.message.moderate', v_person) a;
  END IF;
  IF v_ok IS NOT TRUE THEN RAISE EXCEPTION USING MESSAGE = 'CHAT_MODERATION_FORBIDDEN'; END IF;
  IF p_command_id IS NULL OR (p_action IN ('hide', 'restore')) IS NOT TRUE THEN
    RAISE EXCEPTION USING MESSAGE = 'INVALID_BODY';
  END IF;
  -- closed reason set and the note rule (octet_length), before any write; the 4.3 audit CHECKs are only the backstop
  IF ((p_reason_code IN ('spam', 'harassment', 'unsafe', 'off_topic') AND p_reason_note IS NULL)
      OR (p_reason_code = 'other' AND octet_length(p_reason_note) BETWEEN 1 AND 500)) IS NOT TRUE THEN
    RAISE EXCEPTION USING MESSAGE = 'CHAT_REASON_INVALID';
  END IF;
  -- V-26: the receipt answers before any target lookup, mutation or rate token
  v_fp := encode(sha256(convert_to(jsonb_build_array(p_action, p_message::text, p_reason_code, p_reason_note)::text,
    'UTF8')), 'hex');
  SELECT r.canonical_fingerprint, r.result_json INTO v_old_fp, v_res FROM public.chat_command_receipts r
   WHERE r.tenant_id = v_tenant AND r.actor_person_id = v_person AND r.command_id = p_command_id;
  IF FOUND THEN
    IF v_old_fp <> v_fp THEN RAISE EXCEPTION USING MESSAGE = 'CHAT_IDEMPOTENCY_MISMATCH'; END IF;
    RETURN QUERY SELECT (v_res ->> 'message_id')::uuid, v_res ->> 'moderation_state', (v_res ->> 'changed')::boolean;
    RETURN;
  END IF;
  SELECT msg.moderation_state INTO v_cur FROM public.chat_messages msg
   WHERE msg.id = p_message AND msg.channel_id = p_channel AND msg.author_type = 'person' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE = 'CHAT_MODERATION_FORBIDDEN'; END IF;
  v_changed := v_cur IS DISTINCT FROM v_state;
  -- V-8: one bucket per actor and tenant for hide and restore; every newly accepted command id takes a token
  IF NOT public.rate_limit_check('chat_mod_1m:' || v_person::text || ':' || v_tenant::text, 30, interval '1 minute')
  THEN
    RAISE EXCEPTION USING MESSAGE = 'CHAT_RATE_LIMITED';
  END IF;
  IF v_changed THEN -- restore NULLs the trio; author_deleted_at is never touched
    UPDATE public.chat_messages AS msg
       SET moderation_state = v_state, moderation_updated_at = CASE WHEN v_hide THEN statement_timestamp() END,
           moderation_actor_person_id = CASE WHEN v_hide THEN v_person END,
           moderation_reason_code = CASE WHEN v_hide THEN p_reason_code END
     WHERE msg.id = p_message;
    INSERT INTO public.chat_moderation_audit (tenant_id, channel_id, message_id, actor_person_id, action, reason_code,
      reason_note)
    VALUES (v_tenant, p_channel, p_message, v_person, p_action, p_reason_code, p_reason_note);
  END IF;
  INSERT INTO public.chat_command_receipts (tenant_id, actor_person_id, command_id, action, canonical_fingerprint,
    result_json)
  VALUES (v_tenant, v_person, p_command_id, 'message.' || p_action, v_fp, jsonb_build_object('message_id', p_message,
    'action', p_action, 'moderation_state', v_state, 'changed', v_changed));
  IF v_changed THEN PERFORM pg_catalog.pg_notify('chat_realtime', p_message::text); END IF;
  RETURN QUERY SELECT p_message, v_state, v_changed;
END;
$$;
REVOKE ALL ON FUNCTION moderate_chat_message(uuid, uuid, uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION moderate_chat_message(uuid, uuid, uuid, text, text, text) TO app;

-- read (V-4, V-7, V-12, V-22; 4.2): kind -> GUCs -> active member of the channel's tenant -> page or row; no lock
-- (STABLE). body is NULL and tombstone set ('author_deleted' wins over 'moderation_hidden') on a tombstoned row; no
-- actor, reason, revision, receipt or moderation column. list raises; get answers every denial with zero rows (it
-- serves the database-wide NOTIFY stream). Keyset (created_at, id), cursor row excluded: 'before' (default) pages DESC
-- from the newest, 'after' ASC from the oldest; both cursor halves or neither; limit NULL -> 50, clamped to 1..100.
CREATE FUNCTION chat_list_messages(p_channel uuid, p_cursor_created_at timestamptz DEFAULT NULL,
  p_cursor_id uuid DEFAULT NULL, p_direction text DEFAULT 'before', p_limit integer DEFAULT 50)
RETURNS TABLE (id uuid, channel_id uuid, author_type text, author_person_id uuid, body text,
  reply_to_message_id uuid, edited_at timestamptz, edit_count smallint, tombstone text, created_at timestamptz)
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
        msg.created_at
      FROM public.chat_messages msg
     WHERE msg.channel_id = p_channel
       AND (p_cursor_id IS NULL OR (msg.created_at, msg.id) < (p_cursor_created_at, p_cursor_id))
     ORDER BY msg.created_at DESC, msg.id DESC LIMIT v_limit;
  ELSE
    RETURN QUERY SELECT msg.id, msg.channel_id, msg.author_type, msg.author_person_id,
        CASE WHEN msg.author_deleted_at IS NULL AND msg.moderation_state = 'visible' THEN msg.body END,
        msg.reply_to_message_id, msg.edited_at, msg.edit_count,
        CASE WHEN msg.author_deleted_at IS NOT NULL THEN 'author_deleted'
             WHEN msg.moderation_state <> 'visible' THEN 'moderation_hidden' END,
        msg.created_at
      FROM public.chat_messages msg
     WHERE msg.channel_id = p_channel
       AND (p_cursor_id IS NULL OR (msg.created_at, msg.id) > (p_cursor_created_at, p_cursor_id))
     ORDER BY msg.created_at, msg.id LIMIT v_limit;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION chat_list_messages(uuid, timestamptz, uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION chat_list_messages(uuid, timestamptz, uuid, text, integer) TO app;

CREATE FUNCTION chat_get_message(p_message uuid)
RETURNS TABLE (id uuid, channel_id uuid, author_type text, author_person_id uuid, body text,
  reply_to_message_id uuid, edited_at timestamptz, edit_count smallint, tombstone text, created_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_tenant uuid;
  v_person uuid;
BEGIN
  IF current_setting('app.tenant_id', true) ~* '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$' THEN
    v_tenant := current_setting('app.tenant_id', true)::uuid;
  END IF;
  IF current_setting('app.person_id', true) ~* '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$' THEN
    v_person := current_setting('app.person_id', true)::uuid;
  END IF;
  RETURN QUERY SELECT msg.id, msg.channel_id, msg.author_type, msg.author_person_id,
      CASE WHEN msg.author_deleted_at IS NULL AND msg.moderation_state = 'visible' THEN msg.body END,
      msg.reply_to_message_id, msg.edited_at, msg.edit_count,
      CASE WHEN msg.author_deleted_at IS NOT NULL THEN 'author_deleted'
           WHEN msg.moderation_state <> 'visible' THEN 'moderation_hidden' END,
      msg.created_at
    FROM public.chat_messages msg
    JOIN public.chat_channels ch ON ch.id = msg.channel_id AND ch.kind = 'club' AND ch.tenant_id = v_tenant
   WHERE msg.id = p_message
     AND EXISTS (SELECT 1 FROM public.chat_members cm
                   JOIN public.memberships m
                     ON (m.id, m.person_id, m.tenant_id) = (cm.membership_id, cm.person_id, cm.tenant_id)
                  WHERE cm.channel_id = msg.channel_id AND cm.person_id = v_person AND m.status = 'active');
END;
$$;
REVOKE ALL ON FUNCTION chat_get_message(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION chat_get_message(uuid) TO app;

-- SECTION 3: trigger on memberships (W2)
-- Created while chat_memberships_provision_trg is still migration-owned (4.2 ownership order).
CREATE TRIGGER trg_memberships_chat_provision
  AFTER INSERT OR UPDATE OF status ON public.memberships
  FOR EACH ROW WHEN (NEW.status = 'active')
  EXECUTE FUNCTION public.chat_memberships_provision_trg();

-- SECTION 4: ownership block (GRANT USAGE, CREATE ON SCHEMA public TO chat_definer; ALTER FUNCTION ... OWNER TO chat_definer; REVOKE CREATE)
GRANT USAGE, CREATE ON SCHEMA public TO chat_definer;
ALTER FUNCTION chat_provision_member(uuid, uuid, uuid) OWNER TO chat_definer;
ALTER FUNCTION chat_memberships_provision_trg() OWNER TO chat_definer;
ALTER FUNCTION chat_backfill_default_channels() OWNER TO chat_definer;
ALTER FUNCTION send_chat_message(uuid, text, text, uuid) OWNER TO chat_definer;
ALTER FUNCTION edit_chat_message(uuid, uuid, text, integer) OWNER TO chat_definer;
ALTER FUNCTION delete_chat_message(uuid, uuid) OWNER TO chat_definer;
ALTER FUNCTION mark_read(uuid, uuid) OWNER TO chat_definer;
ALTER FUNCTION moderate_chat_message(uuid, uuid, uuid, text, text, text) OWNER TO chat_definer;
ALTER FUNCTION chat_list_messages(uuid, timestamptz, uuid, text, integer) OWNER TO chat_definer;
ALTER FUNCTION chat_get_message(uuid) OWNER TO chat_definer;
REVOKE CREATE ON SCHEMA public FROM chat_definer;

-- SECTION 5: backfill (W2)
-- V-17: run as chat_definer (BYPASSRLS): a NOBYPASSRLS migration role would read zero memberships rows under FORCE RLS.
SET ROLE chat_definer;
SELECT public.chat_backfill_default_channels();
RESET ROLE;
