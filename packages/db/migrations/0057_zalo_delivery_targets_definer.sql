-- ============================================================================
-- 0057_zalo_delivery_targets_definer.sql
-- Phase 3 lane L4 (M6 Zalo outbound). The worker's zalo_dm projector reads its
-- targets and records per-recipient dispositions ONLY through the two definers
-- below: app_worker holds no grant on zalo_bots, channel_identities, players,
-- memberships or persons, and cannot call routing_audit_append (EXECUTE app).
-- Authority: DD-134 (c) delivery matrix and the pinned contract Z-1..Z-23 in
-- docs/sessions/web-mvp-phase3-readiness-p3-m6-zalo-outbound.md (Z-16..Z-19).
--
-- Posture (0022/0041/0056): every object is owned by job_definer (NOLOGIN,
-- BYPASSRLS, never granted to a runtime role); definers are SECURITY DEFINER,
-- SET search_path = public, pg_temp, REVOKE ALL FROM PUBLIC, EXECUTE app_worker
-- only. No runtime role (app, app_worker, readonly) gains a base-table
-- privilege. zalo_dm stays DISABLED (the owner enables it by runbook); the
-- three routes are inert until then. 0056 is not edited.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Step 1 (migration role, the owner of these tables): column-narrow grants to
-- job_definer for exactly what the two definers read and write (Z-16).
-- ---------------------------------------------------------------------------
GRANT SELECT (id, tenant_id, status, bot_token_enc, key_version) ON zalo_bots TO job_definer;
GRANT SELECT (id, person_id, platform, platform_user_id_enc, status, zalo_bot_id, created_at)
  ON channel_identities TO job_definer;
GRANT SELECT (id, tenant_id, session_id, membership_id, status, joined_at) ON players TO job_definer;
GRANT SELECT (id, tenant_id, person_id, status) ON memberships TO job_definer;
GRANT SELECT (id, status) ON persons TO job_definer;
GRANT SELECT (ends_at, timezone) ON sessions TO job_definer;
GRANT INSERT (action, actor_id, tenant_id, detail) ON routing_audit TO job_definer;
GRANT EXECUTE ON FUNCTION tenant_locale(uuid) TO job_definer;
GRANT REFERENCES (id) ON outbox_events TO job_definer;
GRANT REFERENCES (id) ON channel_identities TO job_definer;

-- ---------------------------------------------------------------------------
-- Step 2: everything job_definer owns is created AS job_definer (the 0041 /
-- 0056 bracket: CREATE on the schema for the duration of this transaction).
-- ---------------------------------------------------------------------------
GRANT CREATE ON SCHEMA public TO job_definer;
SET ROLE job_definer;

-- 2a. One row per (event, recipient identity) once a DM was sent or failed
-- terminally for that recipient (Z-17). No tenant_id (derived through the
-- event), no RLS, zero grants: reached only through the definers below.
CREATE TABLE zalo_dm_recipient_deliveries (
  event_id            uuid NOT NULL,
  channel_identity_id uuid NOT NULL,
  outcome             text NOT NULL,
  error_code          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT zalo_dm_recipient_deliveries_pkey PRIMARY KEY (event_id, channel_identity_id),
  CONSTRAINT zalo_dm_recipient_deliveries_event_fk
    FOREIGN KEY (event_id) REFERENCES outbox_events(id) ON DELETE CASCADE,
  CONSTRAINT zalo_dm_recipient_deliveries_identity_fk
    FOREIGN KEY (channel_identity_id) REFERENCES channel_identities(id) ON DELETE CASCADE,
  CONSTRAINT zalo_dm_recipient_deliveries_outcome_chk CHECK (outcome IN ('sent', 'terminal')),
  CONSTRAINT zalo_dm_recipient_deliveries_error_code_chk
    CHECK (error_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  CONSTRAINT zalo_dm_recipient_deliveries_outcome_code_chk
    CHECK ((outcome = 'sent') = (error_code IS NULL))
);

-- 2b. Targets of one CLAIMED zalo_dm delivery (Z-18). Zero rows unless the
-- outbox_claimed_event live-claim predicate holds for 'zalo_dm' (the caller
-- retries claim_lost). Otherwise ONE status row (secret columns NULL, no audit):
-- stale | bot_unavailable | no_recipients | requester_unlinked | all_recorded;
-- or, for 'ok', the two routing_audit rows FIRST (the appendSecretDecryptAudit
-- detail shape), then one row per recipient not yet recorded. An audit failure
-- raises, so no ciphertext is returned. The tenant is outbox_events.tenant_id,
-- never a parameter. Returns no name, phone, email or display name.
CREATE FUNCTION zalo_dm_delivery_targets(p_event_id uuid, p_claim_token uuid, p_key_version text)
RETURNS TABLE (disposition text, bot_id uuid, bot_token_enc text, key_version text, locale text,
               starts_at timestamptz, timezone text, channel_identity_id uuid,
               recipient_user_id_enc bytea)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_type text;
  v_tenant uuid;
  v_session uuid;
  v_payload jsonb;
  v_created timestamptz;
  v_status text;
  v_starts timestamptz;
  v_ends timestamptz;
  v_tz text;
  v_bot uuid;
  v_bot_status text;
  v_bot_enc text;
  v_bot_kv text;
  v_person uuid;
  v_player uuid;
  v_ids uuid[];
  v_encs bytea[];
  v_open integer;
BEGIN
  SELECT o.type, o.tenant_id, o.aggregate_id, o.payload, o.created_at
    INTO v_type, v_tenant, v_session, v_payload, v_created
    FROM projector_deliveries pd
    JOIN outbox_events o ON o.id = pd.event_id
    JOIN outbox_projectors p ON p.name = pd.projector AND p.enabled
   WHERE pd.event_id = p_event_id
     AND pd.projector = 'zalo_dm'
     AND pd.status = 'claimed'
     AND pd.claim_token = p_claim_token
     AND pd.lease_expires_at >= clock_timestamp()
     AND EXISTS (SELECT 1 FROM outbox_projector_routes r
                  WHERE r.projector = pd.projector AND r.aggregate_type = o.aggregate_type
                    AND (r.event_type IS NULL OR r.event_type = o.type));
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Staleness (Z-12): the session must still exist in the event tenant, not have
  -- ended, and still be in the status the event implies.
  SELECT s.status, s.starts_at, s.ends_at, s.timezone INTO v_status, v_starts, v_ends, v_tz
    FROM sessions s WHERE s.id = v_session AND s.tenant_id = v_tenant;
  IF NOT FOUND OR v_ends <= clock_timestamp()
     OR v_status IS DISTINCT FROM (CASE WHEN v_type = 'session.cancelled' THEN 'cancelled' ELSE 'open' END) THEN
    RETURN QUERY SELECT 'stale'::text, NULL::uuid, NULL::text, NULL::text, NULL::text,
                        NULL::timestamptz, NULL::text, NULL::uuid, NULL::bytea;
    RETURN;
  END IF;

  -- The club's bot is usable iff registered/active under the caller's key label.
  SELECT b.id, b.status, b.bot_token_enc, b.key_version INTO v_bot, v_bot_status, v_bot_enc, v_bot_kv
    FROM zalo_bots b WHERE b.tenant_id = v_tenant;
  IF NOT FOUND OR v_bot_status NOT IN ('registered', 'active')
     OR v_bot_kv IS DISTINCT FROM p_key_version THEN
    RETURN QUERY SELECT 'bot_unavailable'::text, NULL::uuid, NULL::text, NULL::text, NULL::text,
                        NULL::timestamptz, NULL::text, NULL::uuid, NULL::bytea;
    RETURN;
  END IF;

  -- Recipients (Z-9, Z-10, Z-11): one active zalo identity on this bot per
  -- person (newest, then lowest id), for an active|guest membership in the
  -- event tenant and an active person.
  IF v_type = 'session.announcement_requested' THEN
    v_person := CASE WHEN v_payload->>'requested_by_person_id' ~ c_uuid
                     THEN (v_payload->>'requested_by_person_id')::uuid END;
  ELSIF v_type = 'player.promoted' THEN
    v_player := CASE WHEN v_payload->>'player_id' ~ c_uuid THEN (v_payload->>'player_id')::uuid END;
  END IF;
  SELECT coalesce(array_agg(t.ci_id ORDER BY t.ci_id), '{}'::uuid[]),
         coalesce(array_agg(t.enc ORDER BY t.ci_id), '{}'::bytea[])
    INTO v_ids, v_encs
    FROM (
      SELECT DISTINCT ON (pe.id) ci.id AS ci_id, ci.platform_user_id_enc AS enc
        FROM memberships m
        JOIN persons pe ON pe.id = m.person_id AND pe.status = 'active'
        JOIN channel_identities ci ON ci.person_id = pe.id AND ci.platform = 'zalo'
                                  AND ci.status = 'active' AND ci.zalo_bot_id = v_bot
       WHERE m.tenant_id = v_tenant
         AND m.status IN ('active', 'guest')
         AND CASE WHEN v_type = 'session.announcement_requested' THEN pe.id = v_person
                  ELSE EXISTS (SELECT 1 FROM players pl
                                WHERE pl.membership_id = m.id AND pl.tenant_id = v_tenant
                                  AND pl.session_id = v_session AND pl.status = 'active'
                                  AND pl.joined_at <= v_created
                                  AND (v_type <> 'player.promoted' OR pl.id = v_player)) END
       ORDER BY pe.id, ci.created_at DESC, ci.id
    ) t;
  IF cardinality(v_ids) = 0 THEN
    RETURN QUERY SELECT CASE WHEN v_type = 'session.announcement_requested'
                             THEN 'requester_unlinked' ELSE 'no_recipients' END::text,
                        NULL::uuid, NULL::text, NULL::text, NULL::text,
                        NULL::timestamptz, NULL::text, NULL::uuid, NULL::bytea;
    RETURN;
  END IF;
  SELECT count(*) INTO v_open FROM unnest(v_ids) AS u(id)
   WHERE NOT EXISTS (SELECT 1 FROM zalo_dm_recipient_deliveries d
                      WHERE d.event_id = p_event_id AND d.channel_identity_id = u.id);
  IF v_open = 0 THEN
    RETURN QUERY SELECT 'all_recorded'::text, NULL::uuid, NULL::text, NULL::text, NULL::text,
                        NULL::timestamptz, NULL::text, NULL::uuid, NULL::bytea;
    RETURN;
  END IF;

  -- Audit BEFORE any ciphertext leaves the database (fail closed).
  INSERT INTO routing_audit (action, actor_id, tenant_id, detail) VALUES
    ('zalo.secret_decrypt', NULL, v_tenant, jsonb_build_object('botId', v_bot, 'purpose', 'bot_token')),
    ('zalo.secret_decrypt', NULL, v_tenant, jsonb_build_object('botId', v_bot, 'purpose', 'channel_user'));
  RETURN QUERY
    SELECT 'ok'::text, v_bot, v_bot_enc, v_bot_kv, coalesce(tenant_locale(v_tenant), 'vi'),
           v_starts, v_tz, u.id, u.enc
      FROM unnest(v_ids, v_encs) AS u(id, enc)
     WHERE NOT EXISTS (SELECT 1 FROM zalo_dm_recipient_deliveries d
                        WHERE d.event_id = p_event_id AND d.channel_identity_id = u.id)
     ORDER BY u.id;
END;
$$;
REVOKE ALL ON FUNCTION zalo_dm_delivery_targets(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION zalo_dm_delivery_targets(uuid, uuid, text) TO app_worker;

-- 2c. Record one recipient's disposition (Z-19). true when the row exists after
-- the call (insert or an earlier record); false and no write unless the caller
-- holds the 'claimed' zalo_dm delivery with that token and the identity is a
-- zalo identity on the event tenant's bot. Lease expiry is deliberately not
-- checked: a late record of a real send prevents a duplicate DM.
CREATE FUNCTION zalo_dm_record_recipient(p_event_id uuid, p_claim_token uuid,
                                         p_channel_identity_id uuid, p_outcome text,
                                         p_error_code text)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid;
BEGIN
  IF p_outcome IS NULL OR p_outcome NOT IN ('sent', 'terminal')
     OR (p_outcome = 'sent') <> (p_error_code IS NULL)
     OR (p_error_code IS NOT NULL AND p_error_code !~ '^[a-z][a-z0-9_]{0,63}$') THEN
    RAISE EXCEPTION 'zalo_dm_record_recipient: bad outcome or error code'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT o.tenant_id INTO v_tenant
    FROM projector_deliveries pd
    JOIN outbox_events o ON o.id = pd.event_id
   WHERE pd.event_id = p_event_id AND pd.projector = 'zalo_dm'
     AND pd.status = 'claimed' AND pd.claim_token = p_claim_token;
  IF NOT FOUND OR NOT EXISTS (
       SELECT 1 FROM channel_identities ci JOIN zalo_bots b ON b.id = ci.zalo_bot_id
        WHERE ci.id = p_channel_identity_id AND ci.platform = 'zalo' AND b.tenant_id = v_tenant) THEN
    RETURN false;
  END IF;
  INSERT INTO zalo_dm_recipient_deliveries (event_id, channel_identity_id, outcome, error_code)
    VALUES (p_event_id, p_channel_identity_id, p_outcome, p_error_code)
    ON CONFLICT DO NOTHING;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION zalo_dm_record_recipient(uuid, uuid, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION zalo_dm_record_recipient(uuid, uuid, uuid, text, text) TO app_worker;

-- 2d. The three signed zalo_dm routes (D-17, DD-134 c). player.promoted is the
-- promotion lane's own route (L8); zalo_dm stays disabled here.
INSERT INTO outbox_projector_routes (projector, aggregate_type, event_type) VALUES
  ('zalo_dm', 'session', 'session.updated'),
  ('zalo_dm', 'session', 'session.cancelled'),
  ('zalo_dm', 'session', 'session.announcement_requested');

RESET ROLE;
REVOKE CREATE ON SCHEMA public FROM job_definer;
