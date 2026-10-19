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

-- SECTION 2: functions (W2 provisioning core, W3a send/mark_read, W3b edit/delete, W3c moderate, W4 read)

-- SECTION 3: trigger on memberships (W2)

-- SECTION 4: ownership block (GRANT USAGE, CREATE ON SCHEMA public TO chat_definer; ALTER FUNCTION ... OWNER TO chat_definer; REVOKE CREATE)

-- SECTION 5: backfill (W2)
