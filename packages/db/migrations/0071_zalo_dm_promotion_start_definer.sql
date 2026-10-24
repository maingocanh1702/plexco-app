-- ============================================================================
-- 0071_zalo_dm_promotion_start_definer.sql
-- Lane L34, the DD-146 amendment (the owner's item 2 of 2026-10-24): the
-- waitlist-promotion zalo_dm (event type player.promoted) is not expired by
-- the flat 60-minute bound; it stays deliverable until its session's start
-- time on the DATABASE clock. The dispatcher reads that start only through
-- the definer below, before deliver(). Design: section 3 of
-- docs/sessions/web-mvp-phase3-readiness-p3-zalo-dm-promotion-until-session-start.md
-- (option A of RO-L34-1).
--
-- Contract (RO-L34-1): one read-only statement under outbox_claimed_event's
-- live-claim predicate (0056), projector fixed to 'zalo_dm', type fixed to
-- 'player.promoted'; the tenant comes from the event row, never from a
-- parameter. A lost claim returns zero rows; a missing or foreign-tenant
-- session returns NULL (the dispatcher expires it as "start unreadable", fail
-- closed). date_part returns float8 (a JS number), never EXTRACT (numeric).
-- An infinite starts_at returns NULL too (isfinite): PG 16 cannot subtract it.
-- No write, no routing_audit row, no ciphertext.
--
-- A new event type in untilSessionStart (apps/bot/src/zalo-dm-delivery-age-bound.json)
-- needs a new branch here, which is a migration.
--
-- Posture (0056/0057): owned by job_definer (NOLOGIN, BYPASSRLS), SECURITY
-- DEFINER, SET search_path = public, pg_temp, REVOKE ALL FROM PUBLIC, EXECUTE
-- app_worker only. No new table grant: 0022 and 0056 already let job_definer
-- read every column used here (sessions id, tenant_id, starts_at: 0056).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Created AS job_definer (the 0056 / 0057 bracket: CREATE on the schema for
-- the duration of this transaction).
-- ---------------------------------------------------------------------------
GRANT CREATE ON SCHEMA public TO job_definer;
SET ROLE job_definer;

CREATE FUNCTION zalo_dm_promotion_seconds_to_start(p_event_id uuid, p_claim_token uuid)
RETURNS TABLE (seconds_to_start double precision)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE WHEN isfinite(s.starts_at) THEN date_part('epoch', s.starts_at - clock_timestamp()) END
    FROM projector_deliveries pd
    JOIN outbox_events o ON o.id = pd.event_id
    JOIN outbox_projectors p ON p.name = pd.projector AND p.enabled
    LEFT JOIN sessions s ON s.id = o.aggregate_id AND s.tenant_id = o.tenant_id
   WHERE pd.event_id = p_event_id
     AND pd.projector = 'zalo_dm'
     AND pd.status = 'claimed'
     AND pd.claim_token = p_claim_token
     AND pd.lease_expires_at >= clock_timestamp()
     AND o.type = 'player.promoted'
     AND EXISTS (SELECT 1 FROM outbox_projector_routes r
                  WHERE r.projector = pd.projector AND r.aggregate_type = o.aggregate_type
                    AND (r.event_type IS NULL OR r.event_type = o.type));
$$;
REVOKE ALL ON FUNCTION zalo_dm_promotion_seconds_to_start(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION zalo_dm_promotion_seconds_to_start(uuid, uuid) TO app_worker;

RESET ROLE;
REVOKE CREATE ON SCHEMA public FROM job_definer;
