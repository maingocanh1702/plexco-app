-- ============================================================================
-- 0022_job_claim_lease_core.sql
-- Job-infra root: job_definer ownership, outbox lease/reclaim, per-event job
-- audit, projector-delivery token/lease state machine.
-- Source: DD-89/DD-90, docs/autopilot-db-job-claim-lease-core.md.
--
-- job_definer is pre-provisioned OUTSIDE this migration (privileged cluster
-- bootstrap — infra/postgres-init/01-job-definer.sql, applied via `pnpm
-- db:bootstrap`). This migration only ASSERTS it; it never creates or alters
-- the role itself, and it is not added to migrate.ts's RUNTIME_ROLES.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Step 1: assert job_definer exists, has the exact attributes, and is granted
-- to the migration role — BEFORE any table/function grant below. JCL-2/JCL-3:
-- a missing role, a wrong attribute, or missing membership must abort here
-- with no partial migration row and no ownership/grant changes attempted.
-- ---------------------------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
  SELECT rolsuper, rolcanlogin, rolbypassrls, rolcreatedb, rolcreaterole, rolinherit, rolreplication
    INTO r
    FROM pg_roles WHERE rolname = 'job_definer';
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'job_claim_lease_core: job_definer role does not exist — run `pnpm db:bootstrap` first'
      USING ERRCODE = 'undefined_object';
  END IF;
  IF r.rolsuper OR r.rolcanlogin OR NOT r.rolbypassrls OR r.rolcreatedb
     OR r.rolcreaterole OR r.rolinherit OR r.rolreplication THEN
    RAISE EXCEPTION
      'job_claim_lease_core: job_definer has unexpected attributes (need exactly NOLOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT pg_has_role(current_user, 'job_definer', 'MEMBER') THEN
    RAISE EXCEPTION
      'job_claim_lease_core: migration role % is not a member of job_definer — run `pnpm db:bootstrap` first',
      current_user
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Step 2a: outbox lease shape. A five-minute fixed lease is represented by
-- claimed_at + lease_expires_at, both-null (available) or both-non-null
-- (leased) — never one without the other. Replaces idx_outbox_unclaimed with
-- a partial (created_at) index (claim ordering is unchanged: ORDER BY
-- created_at); adds an expired-lease index for the reclaim scan.
-- ---------------------------------------------------------------------------
ALTER TABLE outbox_events ADD COLUMN lease_expires_at timestamptz;
ALTER TABLE outbox_events ADD CONSTRAINT outbox_events_lease_shape_chk
  CHECK (
    (claimed_at IS NULL AND lease_expires_at IS NULL)
    OR (claimed_at IS NOT NULL AND lease_expires_at IS NOT NULL)
  );

DROP INDEX idx_outbox_unclaimed;
CREATE INDEX idx_outbox_unclaimed ON outbox_events (created_at) WHERE claimed_at IS NULL;
CREATE INDEX idx_outbox_expired_lease ON outbox_events (lease_expires_at) WHERE claimed_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Step 2b: job_audit_events — platform-plane, append-only. One row per
-- claimed/reclaimed/prepared/completed job-infra operation. job_id is always
-- the authoritative outbox event id (the canonical job identity at core), even
-- for projector-delivery rows. No UNIQUE(job_id): a reclaimed event is
-- legitimately audited more than once. No runtime role gets a table grant
-- (ownership transfers to job_definer below); UPDATE/DELETE are trigger-
-- rejected. No query endpoint, retention task or application read path here.
-- ---------------------------------------------------------------------------
CREATE TABLE job_audit_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id       uuid NOT NULL REFERENCES outbox_events(id),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  actor        text NOT NULL DEFAULT 'system',
  reason       text NOT NULL,
  fn_name      text NOT NULL,
  operation_id uuid NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_job_audit_events_job_id ON job_audit_events (job_id);
CREATE INDEX idx_job_audit_events_operation_id ON job_audit_events (operation_id);

CREATE OR REPLACE FUNCTION forbid_job_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'job_audit_events is append-only (% blocked)', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;
CREATE TRIGGER trg_job_audit_events_immutable
  BEFORE UPDATE OR DELETE ON job_audit_events
  FOR EACH ROW EXECUTE FUNCTION forbid_job_audit_mutation();

-- ---------------------------------------------------------------------------
-- Step 2c: claim_outbox_batch — reclaim expired leases first (audited), then
-- claim available rows (audited), preserving the existing ORDER BY created_at
-- semantics exactly. Never accepts or sets app.tenant_id — its narrow, audited
-- cross-tenant access is why it needs the definer owner (FORCE RLS on
-- outbox_events, no tenant GUC).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION claim_outbox_batch(p_limit integer DEFAULT 100)
RETURNS TABLE (event_id uuid, tenant_id uuid, aggregate_id uuid, sequence integer, type text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_operation_id uuid := gen_random_uuid();
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'claim_outbox_batch: p_limit must be between 1 and 100'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- 1. reclaim up to p_limit expired leases (SKIP LOCKED), one audit row each.
  WITH expired AS (
    SELECT id FROM outbox_events
    WHERE claimed_at IS NOT NULL AND lease_expires_at < now()
    ORDER BY created_at
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  ),
  reclaimed AS (
    UPDATE outbox_events o
    SET claimed_at = NULL, lease_expires_at = NULL
    FROM expired e
    WHERE o.id = e.id
    RETURNING o.id, o.tenant_id
  )
  -- reclaimed.id / reclaimed.tenant_id must stay qualified: this function's RETURNS TABLE(...)
  -- makes event_id/tenant_id/aggregate_id/sequence/type implicit PL/pgSQL variables, so an
  -- unqualified `tenant_id` here is ambiguous against both the CTE column and that variable.
  INSERT INTO job_audit_events (job_id, tenant_id, actor, reason, fn_name, operation_id)
  SELECT reclaimed.id, reclaimed.tenant_id, 'system', 'outbox_lease_reclaimed', 'claim_outbox_batch', v_operation_id
  FROM reclaimed;

  -- 2. claim up to p_limit available rows (now includes anything just reclaimed above).
  RETURN QUERY
  WITH claimable AS (
    SELECT id
    FROM outbox_events
    WHERE claimed_at IS NULL
    ORDER BY created_at
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  ),
  updated AS (
    UPDATE outbox_events o
    SET claimed_at = now(), lease_expires_at = now() + interval '5 minutes'
    FROM claimable c
    WHERE o.id = c.id
    RETURNING o.id, o.tenant_id, o.aggregate_id, o.sequence, o.type
  ),
  audited AS (
    -- same qualification requirement as the reclaim INSERT above (RETURNS TABLE pseudo-variables).
    INSERT INTO job_audit_events (job_id, tenant_id, actor, reason, fn_name, operation_id)
    SELECT updated.id, updated.tenant_id, 'system', 'outbox_claimed', 'claim_outbox_batch', v_operation_id
    FROM updated
    RETURNING job_id
  )
  SELECT u.id, u.tenant_id, u.aggregate_id, u.sequence, u.type
  FROM updated u
  JOIN audited a ON a.job_id = u.id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Step 2d: projector_deliveries gains token+lease ownership. Public behaviour
-- is defined only through the three functions below; app_worker receives no
-- direct DML grant on this table.
-- ---------------------------------------------------------------------------
ALTER TABLE projector_deliveries ADD COLUMN claim_token uuid;
ALTER TABLE projector_deliveries ADD COLUMN lease_expires_at timestamptz;

-- 'claimed' is a new state (token-and-lease held, between pending and delivered/failed/dlq) —
-- the 0005 inline CHECK (auto-named projector_deliveries_status_check) predates it.
ALTER TABLE projector_deliveries DROP CONSTRAINT projector_deliveries_status_check;
ALTER TABLE projector_deliveries ADD CONSTRAINT projector_deliveries_status_check
  CHECK (status IN ('pending','claimed','delivered','failed','dlq'));

-- job_prepare_projector_delivery: idempotent insert. duplicate is a no-op (no
-- audit row — nothing state-changed).
CREATE OR REPLACE FUNCTION job_prepare_projector_delivery(p_event_id uuid, p_projector text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_row_count integer;
BEGIN
  IF p_projector !~ '^[a-z][a-z0-9_]{0,63}$' THEN
    RAISE EXCEPTION
      'job_prepare_projector_delivery: projector must be a lower snake_case identifier, 1..64 chars'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT tenant_id INTO v_tenant_id FROM outbox_events WHERE id = p_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'job_prepare_projector_delivery: outbox event % does not exist', p_event_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  INSERT INTO projector_deliveries (event_id, projector, status, attempts)
  VALUES (p_event_id, p_projector, 'pending', 0)
  ON CONFLICT (event_id, projector) DO NOTHING;
  GET DIAGNOSTICS v_row_count = ROW_COUNT;

  IF v_row_count > 0 THEN
    INSERT INTO job_audit_events (job_id, tenant_id, actor, reason, fn_name, operation_id)
    VALUES (
      p_event_id, v_tenant_id, 'system', 'projector_delivery_prepared',
      'job_prepare_projector_delivery', gen_random_uuid()
    );
  END IF;
END;
$$;

-- claim_projector_delivery_batch: reclaim expired claimed rows for this
-- projector first (audited), then claim due pending/failed rows (audited),
-- returning a fresh token + current (pre-completion) attempt count.
CREATE OR REPLACE FUNCTION claim_projector_delivery_batch(p_projector text, p_limit integer DEFAULT 100)
RETURNS TABLE (event_id uuid, tenant_id uuid, projector text, claim_token uuid, attempts integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_operation_id uuid := gen_random_uuid();
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'claim_projector_delivery_batch: p_limit must be between 1 and 100'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_projector !~ '^[a-z][a-z0-9_]{0,63}$' THEN
    RAISE EXCEPTION
      'claim_projector_delivery_batch: projector must be a lower snake_case identifier, 1..64 chars'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- 1. reclaim expired claimed rows for this projector (SKIP LOCKED), one audit row each.
  WITH expired AS (
    SELECT pd.event_id, pd.projector
    FROM projector_deliveries pd
    WHERE pd.projector = p_projector AND pd.status = 'claimed' AND pd.lease_expires_at < now()
    ORDER BY pd.event_id
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  ),
  reclaimed AS (
    UPDATE projector_deliveries pd
    SET status = 'pending', claim_token = NULL, lease_expires_at = NULL
    FROM expired e
    WHERE pd.event_id = e.event_id AND pd.projector = e.projector
    RETURNING pd.event_id
  )
  INSERT INTO job_audit_events (job_id, tenant_id, actor, reason, fn_name, operation_id)
  SELECT r.event_id, o.tenant_id, 'system', 'projector_delivery_lease_reclaimed',
         'claim_projector_delivery_batch', v_operation_id
  FROM reclaimed r JOIN outbox_events o ON o.id = r.event_id;

  -- 2. claim up to p_limit due rows: pending, or failed with next_attempt_at due.
  RETURN QUERY
  WITH claimable AS (
    SELECT pd.event_id, pd.projector
    FROM projector_deliveries pd
    WHERE pd.projector = p_projector
      AND (pd.status = 'pending' OR (pd.status = 'failed' AND pd.next_attempt_at <= now()))
    ORDER BY pd.event_id
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  ),
  updated AS (
    UPDATE projector_deliveries pd
    SET status = 'claimed', claim_token = gen_random_uuid(), lease_expires_at = now() + interval '5 minutes'
    FROM claimable c
    WHERE pd.event_id = c.event_id AND pd.projector = c.projector
    RETURNING pd.event_id, pd.projector, pd.claim_token, pd.attempts
  ),
  audited AS (
    INSERT INTO job_audit_events (job_id, tenant_id, actor, reason, fn_name, operation_id)
    SELECT u.event_id, o.tenant_id, 'system', 'projector_delivery_claimed',
           'claim_projector_delivery_batch', v_operation_id
    FROM updated u JOIN outbox_events o ON o.id = u.event_id
    RETURNING job_id
  )
  SELECT u.event_id, o.tenant_id, u.projector, u.claim_token, u.attempts
  FROM updated u
  JOIN outbox_events o ON o.id = u.event_id
  JOIN audited a ON a.job_id = u.event_id;
END;
$$;

-- complete_projector_delivery: exact unexpired token required for any
-- transition. delivered/retry/dlq each increment attempts exactly once and
-- clear token+lease; retry requires a strictly-future next_attempt_at and a
-- bounded error_code; dlq is terminal. No transition possible (wrong/expired
-- token, or already delivered/dlq) is a silent no-op — fail closed, never a
-- stale or duplicate completion. Returns whether a transition happened.
CREATE OR REPLACE FUNCTION complete_projector_delivery(
  p_event_id uuid,
  p_projector text,
  p_claim_token uuid,
  p_result text,
  p_next_attempt_at timestamptz,
  p_provider_ref text,
  p_error_code text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_row_count integer;
BEGIN
  IF p_result NOT IN ('delivered', 'retry', 'dlq') THEN
    RAISE EXCEPTION 'complete_projector_delivery: result must be delivered, retry or dlq'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_result = 'retry' AND (p_next_attempt_at IS NULL OR p_next_attempt_at <= now()) THEN
    RAISE EXCEPTION 'complete_projector_delivery: retry requires a strictly-future next_attempt_at'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_result IN ('retry', 'dlq') AND (p_error_code IS NULL OR p_error_code !~ '^[a-z][a-z0-9_]{0,63}$') THEN
    RAISE EXCEPTION
      'complete_projector_delivery: retry/dlq requires a lower snake_case error_code, 1..64 chars'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT tenant_id INTO v_tenant_id FROM outbox_events WHERE id = p_event_id;

  IF p_result = 'delivered' THEN
    UPDATE projector_deliveries
    SET status = 'delivered', attempts = attempts + 1, claim_token = NULL, lease_expires_at = NULL,
        delivered_at = now(), provider_ref = p_provider_ref, error_code = NULL
    WHERE event_id = p_event_id AND projector = p_projector AND status = 'claimed'
      AND claim_token = p_claim_token AND lease_expires_at >= now();
  ELSIF p_result = 'retry' THEN
    UPDATE projector_deliveries
    SET status = 'failed', attempts = attempts + 1, claim_token = NULL, lease_expires_at = NULL,
        next_attempt_at = p_next_attempt_at, error_code = p_error_code
    WHERE event_id = p_event_id AND projector = p_projector AND status = 'claimed'
      AND claim_token = p_claim_token AND lease_expires_at >= now();
  ELSE -- dlq
    UPDATE projector_deliveries
    SET status = 'dlq', attempts = attempts + 1, claim_token = NULL, lease_expires_at = NULL,
        error_code = p_error_code
    WHERE event_id = p_event_id AND projector = p_projector AND status = 'claimed'
      AND claim_token = p_claim_token AND lease_expires_at >= now();
  END IF;

  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  IF v_row_count > 0 THEN
    INSERT INTO job_audit_events (job_id, tenant_id, actor, reason, fn_name, operation_id)
    VALUES (
      p_event_id, v_tenant_id, 'system', 'projector_delivery_' || p_result,
      'complete_projector_delivery', gen_random_uuid()
    );
  END IF;
  RETURN v_row_count > 0;
END;
$$;

-- ---------------------------------------------------------------------------
-- Step 3: ownership-transfer bracket. PG16 requires the NEW owner to hold
-- CREATE on the object's schema for the duration of an OWNER TO transfer —
-- temporarily granted, revoked in this same migration transaction. The 52
-- pre-existing SECURITY DEFINER functions are untouched; only the five named
-- below and the new job_audit_events table change owner. CREATE OR REPLACE
-- does not change ownership, so claim_outbox_batch needs an explicit transfer
-- even though it already existed.
-- ---------------------------------------------------------------------------
GRANT CREATE ON SCHEMA public TO job_definer;

ALTER FUNCTION claim_outbox_batch(integer) OWNER TO job_definer;
ALTER FUNCTION job_prepare_projector_delivery(uuid, text) OWNER TO job_definer;
ALTER FUNCTION claim_projector_delivery_batch(text, integer) OWNER TO job_definer;
ALTER FUNCTION complete_projector_delivery(uuid, text, uuid, text, timestamptz, text, text) OWNER TO job_definer;
ALTER FUNCTION forbid_job_audit_mutation() OWNER TO job_definer;
ALTER TABLE job_audit_events OWNER TO job_definer;

REVOKE CREATE ON SCHEMA public FROM job_definer;

-- ---------------------------------------------------------------------------
-- Step 4: exact grants. EXECUTE to app_worker on the four worker-callable
-- operations only — never the audit trigger implementation, never direct DML
-- on outbox_events/projector_deliveries/job_audit_events.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION claim_outbox_batch(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION job_prepare_projector_delivery(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION claim_projector_delivery_batch(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION complete_projector_delivery(uuid, text, uuid, text, timestamptz, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION forbid_job_audit_mutation() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION claim_outbox_batch(integer) TO app_worker;
GRANT EXECUTE ON FUNCTION job_prepare_projector_delivery(uuid, text) TO app_worker;
GRANT EXECUTE ON FUNCTION claim_projector_delivery_batch(text, integer) TO app_worker;
GRANT EXECUTE ON FUNCTION complete_projector_delivery(uuid, text, uuid, text, timestamptz, text, text) TO app_worker;
-- forbid_job_audit_mutation: no EXECUTE grant to app_worker/app/readonly/PUBLIC — trigger-only.

-- job_definer owns job_audit_events (full implicit rights) but not the
-- pre-existing outbox_events/projector_deliveries tables — BYPASSRLS bypasses
-- row-security POLICIES, not base table ACL, so it needs explicit, minimal
-- grants on those two (design-probe.md finding).
GRANT SELECT, UPDATE ON outbox_events TO job_definer;
GRANT SELECT, INSERT, UPDATE ON projector_deliveries TO job_definer;
