-- ============================================================================
-- 0041_job_worker_heartbeat.sql
-- Audit 2026-09-06 X-5 (last part): the worker had no business liveness — the
-- container HEALTHCHECK (0039-era Dockerfile) can only say "process alive",
-- and a worker whose pg-boss loop silently stalled looked identical to a
-- healthy one. This gives the worker ONE narrow SECURITY DEFINER it may call
-- (the 0022/0023 shape: owned by job_definer, EXECUTE to app_worker, no table
-- grant) that upserts a heartbeat row, and a read-only view of staleness for
-- operators.
--   job_worker_heartbeats(worker_id, hostname, pid, last_seen_at, started_at) — self-pruning
--     at 30 days, since worker_id follows the container hostname and no runtime role could
--     ever clean the table (zero grants)
--   job_worker_heartbeat(p_worker_id, p_hostname, p_pid) → last_seen_at
--   job_worker_liveness(p_stale_after) → rows with alive boolean
-- Not a tenant table (no tenant_id) — global runtime plane, like pgboss.
-- ============================================================================

-- Created AS job_definer (0022/0023 bracket: CREATE on the schema granted for the duration of
-- this transaction and revoked at the end) so the table is job_definer-owned from birth; an
-- ALTER OWNER afterwards would need the same grant anyway (measured under a NOBYPASSRLS owner:
-- "permission denied for schema public"). Zero grants to app / app_worker / readonly.
GRANT CREATE ON SCHEMA public TO job_definer;
SET ROLE job_definer;

CREATE TABLE job_worker_heartbeats (
  worker_id    text PRIMARY KEY,
  hostname     text NOT NULL,
  pid          integer NOT NULL,
  started_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_worker_heartbeats_worker_id_chk CHECK (char_length(worker_id) BETWEEN 1 AND 128),
  CONSTRAINT job_worker_heartbeats_pid_chk CHECK (pid > 0)
);

CREATE FUNCTION job_worker_heartbeat(p_worker_id text, p_hostname text, p_pid integer)
RETURNS timestamptz
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
  INSERT INTO job_worker_heartbeats (worker_id, hostname, pid, started_at, last_seen_at)
  VALUES (p_worker_id, coalesce(p_hostname, ''), p_pid, clock_timestamp(), clock_timestamp())
  ON CONFLICT (worker_id) DO UPDATE
    SET last_seen_at = clock_timestamp(),
        hostname = EXCLUDED.hostname,
        pid = EXCLUDED.pid,
        -- a restarted process (new pid) starts a new started_at; a ticking one keeps it
        started_at = CASE WHEN job_worker_heartbeats.pid = EXCLUDED.pid
                          THEN job_worker_heartbeats.started_at ELSE clock_timestamp() END
  RETURNING last_seen_at INTO v_seen;

  -- Self-cleaning, so this table needs no scheduled sweep of its own (contrast 0016's
  -- explicit retention definers, which have a whole family of tables to walk). worker_id
  -- defaults to the container hostname, which changes on every RECREATE, so without this
  -- job_worker_liveness() would drift into mostly-dead output over a few months of deploys —
  -- and no runtime role can clean the table (zero grants), so it would be owner-only SQL.
  -- 30 days matches the DD-80 retention precedent.
  DELETE FROM job_worker_heartbeats
   WHERE last_seen_at < clock_timestamp() - interval '30 days';

  RETURN v_seen;
END;
$$;
REVOKE ALL ON FUNCTION job_worker_heartbeat(text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION job_worker_heartbeat(text, text, integer) TO app_worker;

-- Operator/liveness read: which workers have ticked within p_stale_after. Granted to
-- app_worker too so a worker can answer its OWN liveness probe without a table grant.
CREATE FUNCTION job_worker_liveness(p_stale_after interval DEFAULT interval '90 seconds')
RETURNS TABLE (worker_id text, hostname text, pid integer, started_at timestamptz,
               last_seen_at timestamptz, alive boolean)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT h.worker_id, h.hostname, h.pid, h.started_at, h.last_seen_at,
         (h.last_seen_at > clock_timestamp() - p_stale_after) AS alive
  FROM job_worker_heartbeats h
  ORDER BY h.last_seen_at DESC;
$$;
REVOKE ALL ON FUNCTION job_worker_liveness(interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION job_worker_liveness(interval) TO app_worker;

RESET ROLE;
REVOKE CREATE ON SCHEMA public FROM job_definer;
