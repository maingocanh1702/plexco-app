-- ============================================================================
-- 0074_projector_delivery_lease_clock.sql
-- L46 p4-outbox-lease-clock (Phase 4). Authority: the owner's written approval of 2026-10-26 of the
-- Phase 4 plan, row L46; backlog row projector-delivery-batch-lease-clock-consistency.
--
-- WHAT: one function, claim_projector_delivery_batch(text, integer), is re-created from its only
-- definition, 0022:322-397, copied byte for byte with one edit on the 0022:380 line: the lease stamp
-- now() + interval '5 minutes' becomes clock_timestamp() + interval '5 minutes'. The generator of
-- this file proves the block equal to 0022:322-397 once that edit is reverted (never hand-edited).
--
-- WHY: now() is the transaction start, so a claim made inside a transaction already open for t
-- seconds stamps a lease t seconds short (one open over five minutes stamps an already-expired lease),
-- while every compare against the lease or the due time reads clock_timestamp() (0022:348, :373, :451,
-- :461, :471; 0056:202; 0057:109; 0071:51). The outbox twin, claim_outbox_batch, was fixed the same
-- way by 0023:189-194. The two audit INSERTs keep the job_audit_events created_at column default: a
-- deliberate choice, so that every other byte stays unchanged (a separate backlog row).
--
-- THREAT MODEL: this file defends against
--   (1) a re-creation that drops or changes a definer attribute (owner, search_path, volatility, ACL);
--   (2) CREATE on schema public or the role switch left in place after the migration;
--   (3) a lease stamped short (a duplicate delivery) or long (a stuck row), not five real minutes;
--   (4) body drift between this file, the byte pins and the live catalog;
--   (5) a re-run on an already-migrated database failing or changing anything;
--   (6) the migration role lacking the membership it needs: a loud failure, never a partial apply.
-- Not defended: a database superuser; clock skew between the database and the bot.
--
-- POSTURE: the re-creation keeps the owner job_definer and the ACL (replacing a function keeps both;
-- running it AS job_definer also makes a re-creation of a function owned by anyone else fail
-- loudly). The 0067:160-161 / :384-385 bracket grants CREATE on schema public to job_definer for
-- the duration of this transaction only (the runner wraps each file in one transaction, so there is
-- no BEGIN or COMMIT here). The 0022:523 / :529 ACL is restated byte for byte. No other function,
-- table, grant, role or attribute changes; the five-minute length, the reclaim and the due scan stay.
-- ROLLBACK: a forward migration that restates 0022:322-397.
-- ============================================================================
GRANT CREATE ON SCHEMA public TO job_definer;
SET ROLE job_definer;

CREATE OR REPLACE FUNCTION claim_projector_delivery_batch(p_projector text, p_limit integer DEFAULT 100)
RETURNS TABLE (event_id uuid, tenant_id uuid, projector text, claim_token uuid, attempts integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_operation_id uuid := gen_random_uuid();
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'claim_projector_delivery_batch: p_limit must be between 1 and 100'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- codex round-05 [P2]: reject NULL explicitly — `NULL !~ pattern` is NULL, not TRUE, so an
  -- unchecked NULL silently passes, then matches zero rows (indistinguishable from no pending work).
  IF p_projector IS NULL OR p_projector !~ '^[a-z][a-z0-9_]{0,63}$' THEN
    RAISE EXCEPTION
      'claim_projector_delivery_batch: projector must be a lower snake_case identifier, 1..64 chars'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- 1. reclaim expired claimed rows for this projector (SKIP LOCKED), one audit row each.
  -- codex round-07 [P2]: clock_timestamp(), not now() — see claim_outbox_batch's identical note.
  WITH expired AS (
    SELECT pd.event_id, pd.projector
    FROM projector_deliveries pd
    WHERE pd.projector = p_projector AND pd.status = 'claimed' AND pd.lease_expires_at < clock_timestamp()
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
  -- codex round-07 [P2]: clock_timestamp(), not now() — same rationale, this is a liveness/due
  -- check, not a value being stamped.
  RETURN QUERY
  WITH claimable AS (
    SELECT pd.event_id, pd.projector
    FROM projector_deliveries pd
    WHERE pd.projector = p_projector
      AND (pd.status = 'pending' OR (pd.status = 'failed' AND pd.next_attempt_at <= clock_timestamp()))
    ORDER BY pd.event_id
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  ),
  updated AS (
    UPDATE projector_deliveries pd
    SET status = 'claimed', claim_token = gen_random_uuid(), lease_expires_at = clock_timestamp() + interval '5 minutes'
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

REVOKE ALL ON FUNCTION claim_projector_delivery_batch(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_projector_delivery_batch(text, integer) TO app_worker;

RESET ROLE;
REVOKE CREATE ON SCHEMA public FROM job_definer;
