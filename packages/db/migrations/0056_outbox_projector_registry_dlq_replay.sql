-- ============================================================================
-- 0056_outbox_projector_registry_dlq_replay.sql
-- Phase 3 lane L3 (M6 delivery core). Replaces the in-code stub required set
-- with a durable projector registry, adds the owner-only DLQ inspect/replay
-- path, the NOTIFY wake-up trigger, the heartbeat schedule flag with the two
-- L4b read functions, and the stale-draft auto-expiry definer.
-- Authority: DD-134 (a)(b)(e) and the (c) override, DD-89/DD-90, and the pinned
-- contract D-1..D-24 in docs/sessions/web-mvp-phase3-readiness-p3-m6-outbox-delivery-core.md.
--
-- Rules for later lanes (D-17): a projector is enabled with
-- outbox_projector_set_enabled (a runbook call), never a migration; a route is
-- added by an INSERT into outbox_projector_routes inside SET ROLE job_definer
-- in that lane's OWN migration. Nobody edits this file. The required set of an
-- event is read only when it is acked, so a later route never applies to an
-- event acked before it existed (claims skip acked rows, 0023).
--
-- Posture (0022/0023/0041): every definer below is owned by job_definer,
-- SECURITY DEFINER, SET search_path = public, pg_temp, REVOKE ALL FROM PUBLIC,
-- then exactly the listed grants. No runtime role (app, app_worker, readonly)
-- gains a base-table privilege. job_definer (NOLOGIN, BYPASSRLS, never granted
-- to a runtime role, 0022 Step 1) gains column-narrow grants for the expiry.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Step 1 (migration role, the owner of these objects): the column-narrow
-- privileges job_expire_stale_drafts needs (D-4). FOR UPDATE needs UPDATE on at
-- least one column; RETURNING and the version bump need SELECT on what they read.
-- ---------------------------------------------------------------------------
GRANT SELECT (id, tenant_id, status, starts_at, version) ON sessions TO job_definer;
GRANT UPDATE (status, version, updated_at) ON sessions TO job_definer;
GRANT SELECT (session_id) ON players TO job_definer;
GRANT SELECT (session_id) ON charges TO job_definer;
GRANT INSERT (tenant_id, aggregate_type, aggregate_id, sequence, type, payload)
  ON outbox_events TO job_definer;
GRANT EXECUTE ON FUNCTION raise_public_session_fence(uuid, text) TO job_definer;

-- The auto-expiry claim scan (BE spec section 3 Indexes: "not yet applied").
CREATE INDEX idx_sessions_draft_starts_at ON sessions (starts_at) WHERE status = 'draft';

-- ---------------------------------------------------------------------------
-- Step 2 (migration role): the wake-up signal (D-11). One notification per
-- INSERT statement, payload EMPTY: any role may LISTEN on any channel, so it
-- carries no id, tenant or type. It fires for every producer role (EXECUTE is
-- not checked at fire time) and NOTIFY is transactional: a rollback signals
-- nothing. The 1-minute cron stays the safety net.
-- ---------------------------------------------------------------------------
CREATE FUNCTION outbox_events_notify_wake()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM pg_catalog.pg_notify('outbox_wake', '');
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION outbox_events_notify_wake() FROM PUBLIC;

CREATE TRIGGER trg_outbox_events_wake
  AFTER INSERT ON outbox_events
  FOR EACH STATEMENT EXECUTE FUNCTION outbox_events_notify_wake();

-- ---------------------------------------------------------------------------
-- Step 3: everything job_definer owns is created AS job_definer (the 0041
-- bracket: CREATE on the schema for the duration of this transaction only).
-- ---------------------------------------------------------------------------
GRANT CREATE ON SCHEMA public TO job_definer;
SET ROLE job_definer;

-- 3a. Registry (D-2). No tenant_id, no RLS, zero grants: reached only through
-- the definers below.
CREATE TABLE outbox_projectors (
  name       text PRIMARY KEY,
  enabled    boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT outbox_projectors_name_chk CHECK (name ~ '^[a-z][a-z0-9_]{0,63}$')
);

-- event_type NULL = every event of the aggregate (web_realtime only). zalo_dm
-- admits exactly the four DM types the owner signed (DD-134 c); any other DM
-- type needs a migration that changes this CHECK, i.e. a new owner decision.
CREATE TABLE outbox_projector_routes (
  projector      text NOT NULL,
  aggregate_type text NOT NULL,
  event_type     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT outbox_projector_routes_projector_fkey
    FOREIGN KEY (projector) REFERENCES outbox_projectors (name),
  CONSTRAINT outbox_projector_routes_uq
    UNIQUE NULLS NOT DISTINCT (projector, aggregate_type, event_type),
  CONSTRAINT outbox_projector_routes_aggregate_type_chk
    CHECK (aggregate_type ~ '^[a-z][a-z0-9_]{0,63}$'),
  CONSTRAINT outbox_projector_routes_event_type_chk
    CHECK (event_type IS NULL OR (char_length(event_type) <= 128
           AND event_type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$')),
  CONSTRAINT outbox_projector_routes_wildcard_chk
    CHECK (event_type IS NOT NULL OR projector = 'web_realtime'),
  CONSTRAINT outbox_projector_routes_zalo_dm_chk
    CHECK (projector <> 'zalo_dm' OR (aggregate_type = 'session' AND event_type IS NOT NULL
           AND event_type IN ('session.updated', 'session.cancelled',
                              'session.announcement_requested', 'player.promoted')))
);

-- Seeds: all DISABLED, so even with the schedule on every event acks with '{}'.
INSERT INTO outbox_projectors (name) VALUES ('web_realtime'), ('zalo_dm'), ('public_sessions');
INSERT INTO outbox_projector_routes (projector, aggregate_type, event_type)
  VALUES ('web_realtime', 'session', NULL);

-- 3b. The required set of one event: enabled projectors routed for its
-- (aggregate_type, type), exact or wildcard, sorted, no duplicates, '{}' when
-- none (never NULL). Read once per event at ack time (D-5).
CREATE FUNCTION outbox_required_projectors(p_event_id uuid)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_aggregate_type text;
  v_type text;
  v_result text[];
BEGIN
  SELECT o.aggregate_type, o.type INTO v_aggregate_type, v_type
    FROM outbox_events o WHERE o.id = p_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'outbox_required_projectors: outbox event % does not exist', p_event_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  SELECT coalesce(array_agg(DISTINCT p.name ORDER BY p.name), '{}'::text[]) INTO v_result
    FROM outbox_projector_routes r
    JOIN outbox_projectors p ON p.name = r.projector
   WHERE p.enabled
     AND r.aggregate_type = v_aggregate_type
     AND (r.event_type IS NULL OR r.event_type = v_type);
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION outbox_required_projectors(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION outbox_required_projectors(uuid) TO app_worker;

-- 3c. Projector switch (D-13). The read is also the L4b DB-truth guard.
CREATE FUNCTION projector_is_enabled(p_name text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT coalesce((SELECT p.enabled FROM outbox_projectors p WHERE p.name = p_name), false);
$$;
REVOKE ALL ON FUNCTION projector_is_enabled(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION projector_is_enabled(text) TO app, app_worker;

-- Owner path only (no grant): true iff the value changed.
CREATE FUNCTION outbox_projector_set_enabled(p_name text, p_enabled boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rows integer;
BEGIN
  IF p_enabled IS NULL THEN
    RAISE EXCEPTION 'outbox_projector_set_enabled: p_enabled must not be NULL'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  PERFORM 1 FROM outbox_projectors p WHERE p.name = p_name FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'projector_not_found: % is not a registered projector', quote_nullable(p_name)
      USING ERRCODE = 'no_data_found';
  END IF;
  UPDATE outbox_projectors SET enabled = p_enabled, updated_at = clock_timestamp()
   WHERE name = p_name AND enabled IS DISTINCT FROM p_enabled;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;
REVOKE ALL ON FUNCTION outbox_projector_set_enabled(text, boolean) FROM PUBLIC;

-- 3d. The token-gated event envelope (D-6, C7): app_worker cannot read
-- outbox_events, so a projector sees its event only while it holds the claim.
CREATE FUNCTION outbox_claimed_event(p_event_id uuid, p_projector text, p_claim_token uuid)
RETURNS TABLE (event_type text, aggregate_type text, aggregate_id uuid, sequence integer,
               tenant_id uuid, payload jsonb, created_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT o.type, o.aggregate_type, o.aggregate_id, o.sequence, o.tenant_id, o.payload, o.created_at
    FROM projector_deliveries pd
    JOIN outbox_events o ON o.id = pd.event_id
   WHERE pd.event_id = p_event_id
     AND pd.projector = p_projector
     AND pd.status = 'claimed'
     AND pd.claim_token = p_claim_token
     AND pd.lease_expires_at >= clock_timestamp();
$$;
REVOKE ALL ON FUNCTION outbox_claimed_event(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION outbox_claimed_event(uuid, text, uuid) TO app_worker;

-- 3e. DLQ owner path (D-9, DD-134 b): no grant. The owner reaches it with the
-- migration credential (a job_definer member) and SET ROLE job_definer.
-- The list carries no payload.
CREATE FUNCTION outbox_dlq_list(p_projector text DEFAULT NULL, p_limit integer DEFAULT 100)
RETURNS TABLE (event_id uuid, projector text, attempts integer, error_code text,
               event_type text, aggregate_type text, aggregate_id uuid, tenant_id uuid,
               event_created_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 500 THEN
    RAISE EXCEPTION 'outbox_dlq_list: p_limit must be between 1 and 500'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  RETURN QUERY
  SELECT pd.event_id, pd.projector, pd.attempts, pd.error_code,
         o.type, o.aggregate_type, o.aggregate_id, o.tenant_id, o.created_at
    FROM projector_deliveries pd
    JOIN outbox_events o ON o.id = pd.event_id
   WHERE pd.status = 'dlq' AND (p_projector IS NULL OR pd.projector = p_projector)
   ORDER BY o.created_at, pd.event_id, pd.projector
   LIMIT p_limit;
END;
$$;
REVOKE ALL ON FUNCTION outbox_dlq_list(text, integer) FROM PUBLIC;

-- Replay one dlq row: back to pending with the attempt counter reset, one owner
-- audit row; error_code stays until the next completion overwrites it. A RAISE
-- leaves zero writes. Replaying while the projector is disabled is allowed (the
-- row waits).
CREATE FUNCTION outbox_dlq_replay(p_event_id uuid, p_projector text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status text;
  v_tenant_id uuid;
BEGIN
  SELECT pd.status INTO v_status FROM projector_deliveries pd
   WHERE pd.event_id = p_event_id AND pd.projector = p_projector
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'delivery_not_found: no delivery for event % and projector %',
      p_event_id, quote_nullable(p_projector)
      USING ERRCODE = 'no_data_found';
  END IF;
  IF v_status <> 'dlq' THEN
    RAISE EXCEPTION 'delivery_not_in_dlq: the delivery is %, not dlq', v_status
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  UPDATE projector_deliveries SET status = 'pending', attempts = 0, next_attempt_at = NULL
   WHERE event_id = p_event_id AND projector = p_projector AND status = 'dlq';
  SELECT o.tenant_id INTO v_tenant_id FROM outbox_events o WHERE o.id = p_event_id;
  INSERT INTO job_audit_events (job_id, tenant_id, actor, reason, fn_name, operation_id, created_at)
  VALUES (p_event_id, v_tenant_id, 'owner', 'projector_delivery_replayed', 'outbox_dlq_replay',
          gen_random_uuid(), clock_timestamp());
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION outbox_dlq_replay(uuid, text) FROM PUBLIC;

-- 3f. Heartbeat schedule flag (D-12). A 4-arg overload BESIDE the 3-arg one
-- would make every 3-arg call ambiguous (probe P1), so the 3-arg form is
-- dropped: an old 3-arg caller now resolves to this one and records NULL,
-- which the live check treats as off.
ALTER TABLE job_worker_heartbeats ADD COLUMN schedule_enabled boolean;

DROP FUNCTION job_worker_heartbeat(text, text, integer);
CREATE FUNCTION job_worker_heartbeat(
  p_worker_id text, p_hostname text, p_pid integer, p_schedule_enabled boolean DEFAULT NULL
) RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_seen timestamptz;
BEGIN
  IF p_worker_id IS NULL OR char_length(p_worker_id) NOT BETWEEN 1 AND 128 THEN
    RAISE EXCEPTION 'job_worker_heartbeat: p_worker_id must be 1..128 chars'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  INSERT INTO job_worker_heartbeats (worker_id, hostname, pid, started_at, last_seen_at, schedule_enabled)
  VALUES (p_worker_id, coalesce(p_hostname, ''), p_pid, clock_timestamp(), clock_timestamp(),
          p_schedule_enabled)
  ON CONFLICT (worker_id) DO UPDATE
    SET last_seen_at = clock_timestamp(),
        hostname = EXCLUDED.hostname,
        pid = EXCLUDED.pid,
        schedule_enabled = EXCLUDED.schedule_enabled,
        -- a restarted process (new pid) starts a new started_at; a ticking one keeps it
        started_at = CASE WHEN job_worker_heartbeats.pid = EXCLUDED.pid
                          THEN job_worker_heartbeats.started_at ELSE clock_timestamp() END
  RETURNING last_seen_at INTO v_seen;
  -- self-pruning at 30 days, unchanged from 0041
  DELETE FROM job_worker_heartbeats WHERE last_seen_at < clock_timestamp() - interval '30 days';
  RETURN v_seen;
END;
$$;
REVOKE ALL ON FUNCTION job_worker_heartbeat(text, text, integer, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION job_worker_heartbeat(text, text, integer, boolean) TO app_worker;

-- The L4b guard's second half (DD-134 f): a worker ticked within 90 s
-- (HEARTBEAT_STALE_MS) AND reported its schedule on. NULL or false never counts.
CREATE FUNCTION outbox_dispatch_schedule_live()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM job_worker_heartbeats h
     WHERE h.schedule_enabled IS TRUE
       AND h.last_seen_at > clock_timestamp() - interval '90 seconds');
$$;
REVOKE ALL ON FUNCTION outbox_dispatch_schedule_live() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION outbox_dispatch_schedule_live() TO app, app_worker;

-- 3g. Stale-draft auto-expiry (D-15; BE spec section 4 "Draft discard +
-- auto-expiry", edges #28-#30). Mirrors cancelSession's draft path in
-- session-service.ts, which this lane does not edit: an empty past draft is
-- cancelled with version + 1, the cancelled fence and one session.cancelled
-- event (cancel_reason 'auto'); a draft carrying any player row (any status) or
-- any charge is never mutated and gets one session.expiry_anomaly_detected
-- event on EVERY run (edge #28). Every session-aggregate writer locks the
-- session row first, so the in-statement sequence cannot race under the lock.
-- Empty drafts sort first, so anomalies cannot starve them. No processed_commands
-- and no tenant-status gate (the job path has neither in the spec).
CREATE FUNCTION job_expire_stale_drafts(p_limit integer DEFAULT 25)
RETURNS TABLE (cancelled integer, anomalies integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_operation_id uuid := gen_random_uuid();
  v_prev_tenant text := current_setting('app.tenant_id', true);
  v_row record;
  v_fields text[];
  v_event_id uuid;
  v_cancelled integer := 0;
  v_anomalies integer := 0;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'job_expire_stale_drafts: p_limit must be between 1 and 100'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  FOR v_row IN
    SELECT s.id, s.tenant_id
      FROM sessions s
     WHERE s.status = 'draft' AND s.starts_at <= clock_timestamp()
     ORDER BY (EXISTS (SELECT 1 FROM players p WHERE p.session_id = s.id)
               OR EXISTS (SELECT 1 FROM charges c WHERE c.session_id = s.id)),
              s.starts_at, s.id
       FOR UPDATE OF s SKIP LOCKED
     LIMIT p_limit
  LOOP
    -- re-checked under the row lock (the sort key above may be stale)
    v_fields := ARRAY[]::text[];
    IF EXISTS (SELECT 1 FROM players p WHERE p.session_id = v_row.id) THEN
      v_fields := v_fields || 'players'::text;
    END IF;
    IF EXISTS (SELECT 1 FROM charges c WHERE c.session_id = v_row.id) THEN
      v_fields := v_fields || 'charges'::text;
    END IF;

    IF cardinality(v_fields) > 0 THEN
      INSERT INTO outbox_events (tenant_id, aggregate_type, aggregate_id, sequence, type, payload)
      VALUES (v_row.tenant_id, 'session', v_row.id,
              coalesce((SELECT max(o.sequence) FROM outbox_events o WHERE o.aggregate_id = v_row.id), 0) + 1,
              'session.expiry_anomaly_detected',
              jsonb_build_object('session_id', v_row.id, 'tenant_id', v_row.tenant_id,
                                 'source', 'auto', 'anomaly_fields', to_jsonb(v_fields)))
      RETURNING id INTO v_event_id;
      INSERT INTO job_audit_events (job_id, tenant_id, actor, reason, fn_name, operation_id, created_at)
      VALUES (v_event_id, v_row.tenant_id, 'system', 'session_draft_expiry_anomaly',
              'job_expire_stale_drafts', v_operation_id, clock_timestamp());
      v_anomalies := v_anomalies + 1;
    ELSE
      UPDATE sessions SET status = 'cancelled', version = version + 1, updated_at = clock_timestamp()
       WHERE id = v_row.id;
      -- raise_public_session_fence verifies the session against app.tenant_id;
      -- the caller's value is restored right after (and on any exception below).
      PERFORM set_config('app.tenant_id', v_row.tenant_id::text, true);
      PERFORM raise_public_session_fence(v_row.id, 'cancelled');
      PERFORM set_config('app.tenant_id', coalesce(v_prev_tenant, ''), true);
      INSERT INTO outbox_events (tenant_id, aggregate_type, aggregate_id, sequence, type, payload)
      VALUES (v_row.tenant_id, 'session', v_row.id,
              coalesce((SELECT max(o.sequence) FROM outbox_events o WHERE o.aggregate_id = v_row.id), 0) + 1,
              'session.cancelled',
              jsonb_build_object('session_id', v_row.id, 'roster_count', 0, 'has_paid', false,
                                 'cancel_reason', 'auto'))
      RETURNING id INTO v_event_id;
      INSERT INTO job_audit_events (job_id, tenant_id, actor, reason, fn_name, operation_id, created_at)
      VALUES (v_event_id, v_row.tenant_id, 'system', 'session_draft_auto_cancelled',
              'job_expire_stale_drafts', v_operation_id, clock_timestamp());
      v_cancelled := v_cancelled + 1;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_cancelled, v_anomalies;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.tenant_id', coalesce(v_prev_tenant, ''), true);
  RAISE;
END;
$$;
REVOKE ALL ON FUNCTION job_expire_stale_drafts(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION job_expire_stale_drafts(integer) TO app_worker;

RESET ROLE;
REVOKE CREATE ON SCHEMA public FROM job_definer;
