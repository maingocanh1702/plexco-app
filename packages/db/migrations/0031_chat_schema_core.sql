-- ============================================================================
-- 0031_chat_schema_core.sql
-- dd38-dd86-chat-schema-core (slice 3 of the DD-38/DD-86 chat tree, root of
-- the tree's own tables). Final chat_channels / chat_members / chat_messages
-- shape, DM exactly-2-members guards, the pure DM read adapter
-- (dm_current_read_allowed), read-helper owner/grants and RLS policies.
-- Source: docs/features/BE/feature_inapp_chat_tech.md v0.23 lines 127-249,
--         400-471, 521-603 (Reviewed target contract). See
--         docs/autopilot/contracts/autopilot-dd38-dd86-chat-schema-core.md
--         SS5.1 for the pinned source and SS4 for why this migration hard-
--         depends on slice 1 (chat_definer role,
--         infra/postgres-init/02-chat-definer.sql) and slice 2
--         (dm_safety_enabled()/chat_pair_blocked(), migration 0030) already
--         being landed.
--
-- Every CHECK/UNIQUE/multi-column-FK below carries an explicit CONSTRAINT
-- name (contract SS5.1's own pinned DDL text left them unnamed; SS5.2
-- requires the schema.ts mirror to declare matching explicit names so
-- rls-invariants.test.ts's generic CND guard covers these tables -- an
-- unnamed CHECK here would make that instruction unsatisfiable, since
-- schema.ts can only truthfully declare a name Postgres actually assigned).
-- Same precedent as sibling migration 0030's own header comment. No
-- predicate/column/table semantics changed from the pinned source. Simple
-- single-column inline REFERENCES are left unnamed, matching this repo's
-- existing convention throughout schema.ts (e.g. channel_identities.person_id)
-- -- FK identity is not policed by the CND guard (contype='c' only).
--
-- Every RLS predicate below wraps current_setting('app.*', true) in
-- NULLIF(..., '') before casting to uuid, matching 0009_rls_policies_grants.sql's
-- own already-established idiom exactly -- NOT the bare current_setting(...)::uuid
-- form the source spec's DDL text shows. Proven necessary, not stylistic: a custom
-- GUC that has been set via set_config(name, value, true) at least once on a
-- connection reverts to '' (empty string), not a true NULL, once that transaction
-- ends -- current_setting(name, true) only returns NULL for a GUC that has NEVER
-- been referenced on that session at all (verified empirically against this
-- project's own Postgres). On a POOLED connection (app's runtime pool), a
-- transaction that legitimately leaves app.tenant_id/app.person_id unset can land
-- on a connection a PRIOR transaction already set it on, making ''::uuid crash
-- with "invalid input syntax for type uuid" instead of gracefully evaluating the
-- policy to no-match. NULLIF(x, '') converts that '' to a true NULL first, so the
-- cast is never attempted on an empty string -- same fail-closed result, no crash.
--
-- Does NOT create: create_dm/send_chat_message/mark_read or any other
-- mutation RPC, any HTTP route or SSE topic, the DD-92/94/95 interaction/
-- notification/moderation tables, the DD-56 capability registry, media/
-- Assistant tables, the chat_definer role itself, or dm_safety_enabled() /
-- chat_pair_blocked() / assert_dm_allowed() (slice 2's own deliverable --
-- this file only CALLS the first two). app has zero INSERT/UPDATE/DELETE
-- grant on any of the three tables below -- mutation has no owner yet.
-- ============================================================================

-- Prerequisite FK target (composite FK needs more than PK(id)):
ALTER TABLE memberships
  ADD CONSTRAINT memberships_id_person_tenant_uq UNIQUE (id, person_id, tenant_id);

CREATE TABLE chat_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id),
  kind text NOT NULL CONSTRAINT chat_channels_kind_chk CHECK (kind IN ('club','dm')),
  dm_key text,
  title text,
  is_default boolean,
  sort_order integer,
  created_by_membership_id uuid,
  created_by_person_id uuid,
  creation_origin text,
  post_policy text,
  assistant_enabled boolean,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chat_channels_shape_chk CHECK (
    (kind = 'club'
      AND tenant_id IS NOT NULL AND dm_key IS NULL
      AND title IS NOT NULL AND is_default IS NOT NULL AND sort_order IS NOT NULL
      AND creation_origin IS NOT NULL AND creation_origin IN ('actor','system_bootstrap')
      AND post_policy IS NOT NULL AND post_policy IN ('all_members','admins_only')
      AND assistant_enabled IS NOT NULL)
    OR
    (kind = 'dm'
      AND tenant_id IS NULL AND dm_key IS NOT NULL
      AND title IS NULL AND is_default IS NULL AND sort_order IS NULL
      AND created_by_membership_id IS NULL AND created_by_person_id IS NULL
      AND creation_origin IS NULL
      AND post_policy IS NULL AND assistant_enabled IS NULL)
  ),
  CONSTRAINT chat_channels_created_by_pair_chk
    CHECK ((created_by_membership_id IS NULL) = (created_by_person_id IS NULL)),
  CONSTRAINT chat_channels_creation_origin_chk CHECK (
    kind <> 'club'
    OR (creation_origin='actor' AND created_by_membership_id IS NOT NULL)
    OR (creation_origin='system_bootstrap' AND created_by_membership_id IS NULL)
  ),
  CONSTRAINT chat_channels_created_by_membership_fk FOREIGN KEY (created_by_membership_id, created_by_person_id, tenant_id)
    REFERENCES memberships(id, person_id, tenant_id),
  CONSTRAINT chat_channels_dm_key_uq UNIQUE (dm_key),
  CONSTRAINT chat_channels_id_tenant_uq UNIQUE (id, tenant_id)
);
CREATE UNIQUE INDEX chat_channels_default_uq
  ON chat_channels(tenant_id)
  WHERE kind='club' AND is_default IS TRUE AND archived_at IS NULL;

CREATE TABLE chat_members (
  channel_id uuid NOT NULL REFERENCES chat_channels(id),
  tenant_id  uuid,
  person_id  uuid NOT NULL REFERENCES persons(id),
  membership_id uuid,
  role text NOT NULL DEFAULT 'member' CONSTRAINT chat_members_role_chk CHECK (role IN ('member','admin')),
  last_read_created_at timestamptz,
  last_read_message_id uuid,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, person_id),
  CONSTRAINT chat_members_channel_tenant_fk FOREIGN KEY (channel_id, tenant_id) REFERENCES chat_channels(id, tenant_id),
  CONSTRAINT chat_members_membership_fk FOREIGN KEY (membership_id, person_id, tenant_id) REFERENCES memberships(id, person_id, tenant_id),
  CONSTRAINT chat_members_tenant_membership_pair_chk
    CHECK ((tenant_id IS NOT NULL AND membership_id IS NOT NULL)
      OR (tenant_id IS NULL     AND membership_id IS NULL)),
  CONSTRAINT chat_members_last_read_pair_chk
    CHECK ((last_read_created_at IS NULL) = (last_read_message_id IS NULL))
);

CREATE TABLE chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES chat_channels(id),
  tenant_id  uuid,
  author_type text NOT NULL DEFAULT 'person' CONSTRAINT chat_messages_author_type_chk CHECK (author_type IN ('person','assistant','system')),
  author_person_id uuid REFERENCES persons(id),
  membership_id uuid,
  body text NOT NULL,
  reply_to_message_id uuid,
  edited_at timestamptz,
  edit_count smallint NOT NULL DEFAULT 0 CONSTRAINT chat_messages_edit_count_chk CHECK (edit_count BETWEEN 0 AND 5),
  author_deleted_at timestamptz,
  moderation_state text NOT NULL DEFAULT 'visible' CONSTRAINT chat_messages_moderation_state_chk CHECK (moderation_state IN ('visible','hidden')),
  moderation_updated_at timestamptz,
  moderation_actor_person_id uuid REFERENCES persons(id),
  moderation_reason_code text
    CONSTRAINT chat_messages_moderation_reason_code_chk CHECK (moderation_reason_code IS NULL
      OR moderation_reason_code IN ('spam','harassment','unsafe','off_topic','other')),
  client_msg_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  search_document tsvector GENERATED ALWAYS AS (
    to_tsvector('simple'::regconfig, coalesce(body, ''))
  ) STORED,
  CONSTRAINT chat_messages_channel_client_msg_uq UNIQUE (channel_id, client_msg_id),
  CONSTRAINT chat_messages_channel_id_uq UNIQUE (channel_id, id),
  CONSTRAINT chat_messages_channel_created_at_id_uq UNIQUE (channel_id, created_at, id),
  CONSTRAINT chat_messages_channel_tenant_fk FOREIGN KEY (channel_id, tenant_id) REFERENCES chat_channels(id, tenant_id),
  CONSTRAINT chat_messages_membership_fk FOREIGN KEY (membership_id, author_person_id, tenant_id) REFERENCES memberships(id, person_id, tenant_id),
  CONSTRAINT chat_messages_reply_to_fk FOREIGN KEY (channel_id, reply_to_message_id) REFERENCES chat_messages(channel_id, id),
  CONSTRAINT chat_messages_reply_not_self_chk CHECK (reply_to_message_id IS NULL OR reply_to_message_id IS DISTINCT FROM id),
  CONSTRAINT chat_messages_moderation_pair_chk CHECK (
    (moderation_state='visible' AND moderation_updated_at IS NULL
      AND moderation_actor_person_id IS NULL AND moderation_reason_code IS NULL)
    OR
    (moderation_state='hidden' AND moderation_updated_at IS NOT NULL
      AND moderation_actor_person_id IS NOT NULL AND moderation_reason_code IS NOT NULL)
  ),
  CONSTRAINT chat_messages_author_person_required_chk CHECK (author_type <> 'person' OR author_person_id IS NOT NULL),
  CONSTRAINT chat_messages_author_person_null_chk CHECK (author_type =  'person' OR author_person_id IS NULL),
  CONSTRAINT chat_messages_membership_null_chk CHECK (author_type = 'person' OR membership_id IS NULL),
  CONSTRAINT chat_messages_membership_required_chk CHECK (author_type <> 'person' OR tenant_id IS NULL OR membership_id IS NOT NULL)
);
CREATE INDEX idx_chat_messages_channel_time ON chat_messages(channel_id, created_at, id);
CREATE INDEX idx_chat_messages_search_simple
  ON chat_messages USING gin(search_document)
  WHERE moderation_state='visible' AND author_deleted_at IS NULL;
ALTER TABLE chat_members
  ADD CONSTRAINT chat_members_last_read_message_fk FOREIGN KEY (channel_id, last_read_created_at, last_read_message_id)
  REFERENCES chat_messages(channel_id, created_at, id);

-- Tenant-bind trigger (closes the FK MATCH-SIMPLE-NULL loophole):
CREATE FUNCTION chat_bind_tenant() RETURNS trigger AS $$
DECLARE ct uuid; BEGIN
  SELECT tenant_id INTO ct FROM chat_channels WHERE id = NEW.channel_id;
  IF NEW.tenant_id IS NOT NULL AND NEW.tenant_id IS DISTINCT FROM ct THEN
    RAISE EXCEPTION 'child tenant_id % != channel tenant %', NEW.tenant_id, ct;
  END IF;
  NEW.tenant_id := ct;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_chat_members_bind  BEFORE INSERT OR UPDATE ON chat_members  FOR EACH ROW EXECUTE FUNCTION chat_bind_tenant();
CREATE TRIGGER trg_chat_messages_bind BEFORE INSERT OR UPDATE ON chat_messages FOR EACH ROW EXECUTE FUNCTION chat_bind_tenant();

-- DM exactly-2-members guards:
CREATE FUNCTION chat_dm_member_insert_guard() RETURNS trigger AS $$
DECLARE k text; c int; BEGIN
  SELECT dm_key INTO k FROM chat_channels WHERE id = NEW.channel_id AND kind = 'dm' FOR UPDATE;
  IF FOUND THEN
    IF NEW.person_id::text NOT IN (split_part(k,':',1), split_part(k,':',2)) THEN
      RAISE EXCEPTION 'DM member % not in dm_key %', NEW.person_id, k;
    END IF;
    SELECT count(*) INTO c FROM chat_members WHERE channel_id = NEW.channel_id;
    IF c >= 2 THEN RAISE EXCEPTION 'DM channel already has 2 members'; END IF;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_chat_dm_member_insert BEFORE INSERT ON chat_members
  FOR EACH ROW EXECUTE FUNCTION chat_dm_member_insert_guard();

-- Membership identity is immutable post-insert (codex round-01 [P1]): without this, an UPDATE
-- moving a chat_members row's channel_id away from a DM channel is validated only against the
-- NEW channel by the deferred AFTER trigger below (chat_dm_two_from_members), never against the
-- vacated DM channel -- silently leaving it with 1 member. There is no legitimate business
-- operation that reassigns an existing membership row to a different channel/person; join = new
-- row, leave = delete row.
CREATE FUNCTION chat_members_identity_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'chat_members.channel_id/person_id are immutable; delete and re-insert instead';
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_chat_members_identity_immutable
  BEFORE UPDATE OF channel_id, person_id ON chat_members
  FOR EACH ROW
  WHEN (NEW.channel_id IS DISTINCT FROM OLD.channel_id OR NEW.person_id IS DISTINCT FROM OLD.person_id)
  EXECUTE FUNCTION chat_members_identity_immutable();

-- Channel identity is immutable post-insert (codex round-02 [P1]): without this, flipping kind
-- from 'dm' to 'club' (satisfying chat_channels_shape_chk's club branch) makes BOTH
-- chat_assert_dm_two and chat_dm_no_member_delete below silently no-op -- each re-reads the
-- CURRENT (already-updated) kind via a fresh SELECT, so a channel that was 'dm' a moment ago now
-- reads as 'club' and their `IF kind = 'dm'` guards skip entirely, reopening the exactly-two-
-- members and no-delete invariants this migration exists to enforce. tenant_id/dm_key guarded too
-- (preferred, per review): both are paired with kind by the shape CHECK, so either changing
-- independently reopens the same class of shape-mismatch bypass.
CREATE FUNCTION chat_channels_identity_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'chat_channels.kind/tenant_id/dm_key are immutable; archive and create a new channel instead';
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_chat_channels_identity_immutable
  BEFORE UPDATE OF kind, tenant_id, dm_key ON chat_channels
  FOR EACH ROW
  WHEN (NEW.kind IS DISTINCT FROM OLD.kind
        OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
        OR NEW.dm_key IS DISTINCT FROM OLD.dm_key)
  EXECUTE FUNCTION chat_channels_identity_immutable();

CREATE FUNCTION chat_assert_dm_two(p_channel uuid) RETURNS void AS $$
DECLARE c int; k text; BEGIN
  IF (SELECT kind FROM chat_channels WHERE id = p_channel) = 'dm' THEN
    SELECT count(*) INTO c FROM chat_members WHERE channel_id = p_channel;
    IF c <> 2 THEN RAISE EXCEPTION 'DM channel % must have exactly 2 members (got %)', p_channel, c; END IF;
    SELECT string_agg(person_id::text, ':' ORDER BY person_id) INTO k
      FROM chat_members WHERE channel_id = p_channel;
    IF k <> (SELECT dm_key FROM chat_channels WHERE id = p_channel) THEN
      RAISE EXCEPTION 'DM member set % != dm_key', k; END IF;
  END IF;
END; $$ LANGUAGE plpgsql;
CREATE FUNCTION chat_dm_two_from_members() RETURNS trigger AS $$
BEGIN PERFORM chat_assert_dm_two(COALESCE(NEW.channel_id, OLD.channel_id)); RETURN NULL; END; $$ LANGUAGE plpgsql;
CREATE FUNCTION chat_dm_two_from_channel() RETURNS trigger AS $$
BEGIN PERFORM chat_assert_dm_two(COALESCE(NEW.id, OLD.id)); RETURN NULL; END; $$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER trg_chat_dm_two_members AFTER INSERT OR UPDATE OR DELETE ON chat_members
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION chat_dm_two_from_members();
CREATE CONSTRAINT TRIGGER trg_chat_dm_two_channel  AFTER INSERT OR UPDATE ON chat_channels
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION chat_dm_two_from_channel();

CREATE FUNCTION chat_dm_no_member_delete() RETURNS trigger AS $$
BEGIN
  IF (SELECT kind FROM chat_channels WHERE id = OLD.channel_id) = 'dm' THEN
    RAISE EXCEPTION 'DM members immutable; soft-close channel via archived_at';
  END IF;
  RETURN OLD;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_chat_dm_no_delete BEFORE DELETE ON chat_members
  FOR EACH ROW EXECUTE FUNCTION chat_dm_no_member_delete();

-- Read helpers (SECURITY DEFINER, owner = chat_definer — REQUIRES slice 1 landed):
CREATE FUNCTION chat_current_is_member(p_channel uuid) RETURNS boolean
  LANGUAGE sql SECURITY DEFINER STABLE SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM chat_members cm
    JOIN chat_channels c ON c.id = cm.channel_id
    LEFT JOIN memberships m
      ON (m.id, m.person_id, m.tenant_id) = (cm.membership_id, cm.person_id, cm.tenant_id)
    WHERE cm.channel_id = p_channel
      AND cm.person_id = NULLIF(current_setting('app.person_id', true), '')::uuid
      AND (c.kind = 'dm' OR (c.kind = 'club' AND m.status = 'active'))
  );
$$;
REVOKE ALL ON FUNCTION chat_current_is_member(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION chat_current_is_member(uuid) TO app;

-- REQUIRES slice 2 landed: calls dm_safety_enabled() owned by chat-dm-safety-authority-core.
-- Joins chat_channels and requires kind='dm' (codex round-02 [P2]): without it, this function
-- returns true for ANY two-member channel regardless of kind -- safe today only because every
-- current caller (the RLS policies below) additionally ANDs `tenant_id IS NULL`, but the function
-- is itself SECURITY DEFINER and directly EXECUTE-granted to app, so its own contract must not
-- depend on every future caller remembering that external guard.
CREATE FUNCTION dm_current_read_allowed(p_channel uuid) RETURNS boolean
  LANGUAGE sql SECURITY DEFINER STABLE SET search_path = pg_catalog, public AS $$
  SELECT dm_safety_enabled()
     AND EXISTS (
       SELECT 1
       FROM chat_members me
       JOIN chat_channels c ON c.id = me.channel_id AND c.kind = 'dm'
       JOIN chat_members peer ON peer.channel_id = me.channel_id AND peer.person_id <> me.person_id
       WHERE me.channel_id = p_channel
         AND me.person_id = NULLIF(current_setting('app.person_id', true), '')::uuid
         AND NOT chat_pair_blocked(me.person_id, peer.person_id));
$$;
REVOKE ALL ON FUNCTION dm_current_read_allowed(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dm_current_read_allowed(uuid) TO app;

-- Owner/grant block — REQUIRES chat_definer role (slice 1) to exist first:
GRANT USAGE, CREATE ON SCHEMA public TO chat_definer;
ALTER FUNCTION chat_current_is_member(uuid) OWNER TO chat_definer;
ALTER FUNCTION dm_current_read_allowed(uuid) OWNER TO chat_definer;
REVOKE CREATE ON SCHEMA public FROM chat_definer;
GRANT SELECT (id, person_id, tenant_id, status) ON memberships TO chat_definer;
GRANT SELECT ON chat_channels, chat_members TO chat_definer;

-- RLS: FORCE on all three; two permissive policies (club OR dm) per table.
ALTER TABLE chat_channels ENABLE ROW LEVEL SECURITY;  ALTER TABLE chat_channels FORCE ROW LEVEL SECURITY;
CREATE POLICY chat_channels_club ON chat_channels USING (
  tenant_id IS NOT NULL AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  AND chat_current_is_member(id));
CREATE POLICY chat_channels_dm ON chat_channels USING (
  tenant_id IS NULL AND dm_current_read_allowed(id));

ALTER TABLE chat_members ENABLE ROW LEVEL SECURITY;   ALTER TABLE chat_members FORCE ROW LEVEL SECURITY;
CREATE POLICY chat_members_club ON chat_members USING (
  tenant_id IS NOT NULL AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  AND chat_current_is_member(channel_id));
CREATE POLICY chat_members_dm ON chat_members USING (
  tenant_id IS NULL AND dm_current_read_allowed(channel_id));

ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;  ALTER TABLE chat_messages FORCE ROW LEVEL SECURITY;
CREATE POLICY chat_messages_club ON chat_messages
  USING      (tenant_id IS NOT NULL AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
              AND chat_current_is_member(channel_id))
  WITH CHECK (tenant_id IS NOT NULL AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
              AND chat_current_is_member(channel_id)
              AND author_type = 'person' AND author_person_id = NULLIF(current_setting('app.person_id', true), '')::uuid);
CREATE POLICY chat_messages_dm ON chat_messages
  USING      (tenant_id IS NULL AND dm_current_read_allowed(channel_id))
  WITH CHECK (tenant_id IS NULL AND dm_current_read_allowed(channel_id)
              AND author_type = 'person' AND author_person_id = NULLIF(current_setting('app.person_id', true), '')::uuid);

-- Runtime DML boundary — app is READ-ONLY on all three; mutation belongs to later slices' SECURITY DEFINER RPCs.
REVOKE INSERT, UPDATE, DELETE ON chat_channels, chat_members, chat_messages FROM app;
GRANT SELECT ON chat_channels, chat_members, chat_messages TO app;
