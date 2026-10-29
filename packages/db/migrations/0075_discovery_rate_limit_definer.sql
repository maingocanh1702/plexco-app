-- ============================================================================
-- 0075_discovery_rate_limit_definer.sql
-- L73 p5-discovery-isolation-controls (Phase 5). Authority: DD-154, the owner's approval of the
-- Phase 5 plan with Q10 at its default (i): the DB limiter is this lane's migration, closing O-6 of
-- the Phase 3 discovery read. Specification: sections 6 and 7 of
-- docs/sessions/web-mvp-phase5-readiness-p5-discovery-isolation-controls.md.
--
-- WHAT: one UNLOGGED counter table, discovery_rate_limit_counters, and one SECURITY DEFINER
-- function, discovery_rate_limit_hit(p_key text) RETURNS integer: 0 = allowed, else the retry-after
-- in seconds (1..60) to the end of the current clock-aligned 60 s window. One count for every
-- process: 60 hits per key per window; at most 20 000 keys per window; once a window holds 10 000
-- keys, one IPv6 /48 adds at most 256 /64 keys; each admission deletes at most 100 rows of older
-- windows. readonly, the discovery pool's role, may only EXECUTE the function.
--
-- WHY: the in-process limiter of apps/web/lib/discovery-route-support.ts counts each process apart
-- and a full map refuses every new visitor of that process, so the 65 536 /64 keys of one /48 lock
-- everyone out (the exposure precondition of that file). One global count with a hard size bound
-- and a /48 cap replaces it: fewer than 20 000 distinct sources per window cannot lock out other
-- visitors, and a fill by more refuses only NEW keys until the window ends.
--
-- THREAT MODEL: this file defends against
--   (1) an anonymous client, or many, locking visitors out: one /48 holds at most 10 000 keys of a
--       window, and the window's key count is a hard bound kept under a row lock (no COUNT);
--   (2) enumeration faster than 60 requests per key per window, summed over every process;
--   (3) readonly reaching the table or a bucket of its choice: it may only EXECUTE this function,
--       whose key must be one of the forms the web emits and whose limits are constants;
--   (4) a definer hijack: search_path pinned with pg_temp last, every built-in call qualified, no
--       dynamic SQL;
--   (5) a fail-open answer: a malformed key raises 22023 before any write without echoing the key,
--       and the function is not STRICT, so it never returns NULL.
-- Not defended: network floods (the owner's edge); a database superuser; a fill by 20 000 or more
-- distinct sources, which refuses NEW keys until the window ends.
--
-- POSTURE: created by the migration role, which owns the table and the function (no SET ROLE, as
-- 0012's rate_limit_check). RLS is enabled without FORCE and with no policy, so the owner alone
-- reaches the table and no BYPASSRLS is needed; every table privilege is revoked from PUBLIC, app,
-- app_worker and readonly and none is granted; EXECUTE goes to readonly only. No role DDL and no
-- default privileges. The runner wraps each file in one transaction, so there is no BEGIN or COMMIT.
-- ROLLBACK: a forward migration that drops the function and the table (it holds no durable data).
-- ============================================================================

CREATE UNLOGGED TABLE discovery_rate_limit_counters (
  window_id bigint  NOT NULL,  -- floor(epoch seconds / 60): one clock-aligned window
  bucket    text    NOT NULL,  -- 'k:' || key, 'p48:' || first three hextets, or '#keys'
  hits      integer NOT NULL,
  PRIMARY KEY (window_id, bucket)
);

-- RLS on without FORCE and with no policy: every role but the owner is denied, and the owner (the
-- definer below) is exempt without BYPASSRLS. FORCE would deny that owner under a NOBYPASSRLS
-- migration role while the superuser test suite still passed.
ALTER TABLE discovery_rate_limit_counters ENABLE ROW LEVEL SECURITY;

-- No grants: touched only via the function below.
REVOKE ALL ON TABLE discovery_rate_limit_counters FROM PUBLIC, app, app_worker, readonly;

CREATE FUNCTION discovery_rate_limit_hit(p_key text)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  DISCOVERY_RATE_LIMIT           CONSTANT integer := 60;
  DISCOVERY_RATE_WINDOW_SECONDS  CONSTANT integer := 60;
  DISCOVERY_RATE_MAX_KEYS        CONSTANT integer := 20000;
  DISCOVERY_RATE_PER_48_MAX_KEYS CONSTANT integer := 256;
  DISCOVERY_RATE_PER_48_GATE     CONSTANT integer := 10000;
  DISCOVERY_RATE_CLEANUP_BATCH   CONSTANT integer := 100;
  v_now    numeric := extract(epoch FROM pg_catalog.now());
  v_window bigint  := pg_catalog.floor(v_now / DISCOVERY_RATE_WINDOW_SECONDS::numeric)::bigint;
  v_retry  integer := pg_catalog.ceil(((v_window + 1) * DISCOVERY_RATE_WINDOW_SECONDS)::numeric - v_now)::integer;
  v_p48    text;
  v_keys   integer;
  v_hits   integer;
BEGIN
  -- 0. Before any write: p_key is a form emitted by discoveryRateLimitKey (discovery-route-support.ts),
  -- the one exported builder of the key the web passes: a dotted IPv4, the /64 form (four padded
  -- lowercase hextets) or a fixed fallback of session-cookies.ts (clientIp). The length check runs
  -- first; the message never echoes the key.
  IF p_key IS NULL OR pg_catalog.length(p_key) > 22
     OR p_key !~ '^([0-9]{1,3}([.][0-9]{1,3}){3}|[0-9a-f]{4}(:[0-9a-f]{4}){3}|local|fly:untrusted|digitalocean:untrusted)$'
  THEN
    RAISE EXCEPTION 'discovery_rate_limit_hit: malformed key' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_key ~ '^[0-9a-f]{4}(:[0-9a-f]{4}){3}$' THEN
    v_p48 := 'p48:' || pg_catalog.left(p_key, 14);  -- the /48: the first three hextets
  END IF;

  -- 1. A key already counted in this window: its own row, no other lock.
  UPDATE discovery_rate_limit_counters AS c SET hits = c.hits + 1
   WHERE c.window_id = v_window AND c.bucket = 'k:' || p_key
  RETURNING c.hits INTO v_hits;
  IF FOUND THEN
    RETURN CASE WHEN v_hits <= DISCOVERY_RATE_LIMIT THEN 0 ELSE v_retry END;
  END IF;

  -- 2-3. Unlocked fast paths for a NEW key: the window is full, or its /48 is at the cap while the
  -- window holds the gate.
  v_keys := COALESCE((SELECT c.hits FROM discovery_rate_limit_counters AS c
                       WHERE c.window_id = v_window AND c.bucket = '#keys'), 0);
  IF v_keys >= DISCOVERY_RATE_MAX_KEYS THEN
    RETURN v_retry;
  END IF;
  IF v_p48 IS NOT NULL AND v_keys >= DISCOVERY_RATE_PER_48_GATE
     AND (SELECT c.hits FROM discovery_rate_limit_counters AS c
           WHERE c.window_id = v_window AND c.bucket = v_p48) >= DISCOVERY_RATE_PER_48_MAX_KEYS THEN
    RETURN v_retry;
  END IF;

  -- 4. Bounded cleanup of older windows, on admissions only (the 0046 shape).
  WITH expired AS (
    SELECT o.ctid FROM discovery_rate_limit_counters AS o
     WHERE o.window_id < v_window
     LIMIT DISCOVERY_RATE_CLEANUP_BATCH
     FOR UPDATE SKIP LOCKED
  )
  DELETE FROM discovery_rate_limit_counters AS c
  USING expired
  WHERE c.ctid = expired.ctid;

  -- 5-7. Admission under row locks, always in this order (no lock cycle): the /48 row (counted at
  -- any load, enforced only at the gate), the window's key count (the hard bound, refusing a NEW key
  -- when full), then the key's own row. Both counts are exact per distinct admitted key: a call
  -- refused at step 6 takes back its /48 count, and a call whose key row already exists at step 7
  -- takes back both; each take-back updates rows this call already holds (no new lock).
  IF v_p48 IS NOT NULL THEN
    INSERT INTO discovery_rate_limit_counters AS c (window_id, bucket, hits)
    VALUES (v_window, v_p48, 1)
    ON CONFLICT (window_id, bucket) DO UPDATE SET hits = c.hits + 1
      WHERE NOT (v_keys >= DISCOVERY_RATE_PER_48_GATE AND c.hits >= DISCOVERY_RATE_PER_48_MAX_KEYS);
    IF NOT FOUND THEN
      RETURN v_retry;
    END IF;
  END IF;
  INSERT INTO discovery_rate_limit_counters AS c (window_id, bucket, hits)
  VALUES (v_window, '#keys', 1)
  ON CONFLICT (window_id, bucket) DO UPDATE SET hits = c.hits + 1
    WHERE c.hits < DISCOVERY_RATE_MAX_KEYS;
  IF NOT FOUND THEN
    IF v_p48 IS NOT NULL THEN  -- refused: take back this call's step-5 /48 count
      UPDATE discovery_rate_limit_counters AS c SET hits = c.hits - 1
       WHERE c.window_id = v_window AND c.bucket = v_p48;
    END IF;
    RETURN v_retry;
  END IF;
  INSERT INTO discovery_rate_limit_counters AS c (window_id, bucket, hits)
  VALUES (v_window, 'k:' || p_key, 1)
  ON CONFLICT (window_id, bucket) DO UPDATE SET hits = c.hits + 1
  RETURNING c.hits INTO v_hits;
  -- The key row already existed: a concurrent first call of this key committed it first, unseen by
  -- step 1 under READ COMMITTED. Take back this call's two counts (a NULL v_p48 matches nothing).
  IF v_hits > 1 THEN
    UPDATE discovery_rate_limit_counters AS c SET hits = c.hits - 1
     WHERE c.window_id = v_window AND c.bucket IN ('#keys', v_p48);
  END IF;
  RETURN CASE WHEN v_hits <= DISCOVERY_RATE_LIMIT THEN 0 ELSE v_retry END;
END;
$$;

-- readonly, the discovery pool's role, is the only caller.
REVOKE ALL ON FUNCTION discovery_rate_limit_hit(text) FROM PUBLIC, app, app_worker, readonly;
GRANT EXECUTE ON FUNCTION discovery_rate_limit_hit(text) TO readonly;
