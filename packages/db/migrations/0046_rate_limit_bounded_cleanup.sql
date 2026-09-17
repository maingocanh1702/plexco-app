CREATE OR REPLACE FUNCTION rate_limit_check(
  p_bucket text, p_limit integer, p_window interval
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  -- Serialize same-bucket admission: without this, a concurrent burst all
  -- counts before any peer commits and every request passes the limit.
  PERFORM pg_advisory_xact_lock(hashtext(p_bucket));
  -- ponytail: at most 200 deletes, not bounded scans or immediate physical retention.
  -- Review maintenance separately if measured backlog warrants it; quota uses live rows.
  WITH expired AS (
    SELECT ctid FROM rate_limit_hits
    WHERE at < now() - interval '1 day'
    ORDER BY at
    LIMIT 100
    FOR UPDATE SKIP LOCKED
  )
  DELETE FROM rate_limit_hits AS hits
  USING expired
  WHERE hits.ctid = expired.ctid;
  WITH expired_bucket AS (
    SELECT ctid FROM rate_limit_hits
    WHERE bucket = p_bucket AND at < now() - p_window
    ORDER BY at
    LIMIT 100
    FOR UPDATE SKIP LOCKED
  )
  DELETE FROM rate_limit_hits AS hits
  USING expired_bucket
  WHERE hits.ctid = expired_bucket.ctid;
  SELECT count(*) INTO v_count FROM rate_limit_hits
  WHERE bucket = p_bucket
    AND at >= GREATEST(now() - p_window, now() - interval '1 day');
  IF v_count >= p_limit THEN
    RETURN false;
  END IF;
  INSERT INTO rate_limit_hits(bucket) VALUES (p_bucket);
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION rate_limit_check(text,integer,interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rate_limit_check(text,integer,interval) TO app;
