-- ============================================================================
-- 0040_web_sessions_idle_ttl.sql
-- Audit 2026-09-06 W-6 (second half): the web session lived for its ABSOLUTE
-- TTL (30 days, 0015:171) whether or not it was ever used again. A cookie
-- copied off a device stayed valid for a month of silence. This adds an IDLE
-- window on top of the absolute one:
--   * web_sessions.last_seen_at — touched on resolve, throttled to once per
--     minute per session so a busy client does not turn every request into a
--     write;
--   * auth_resolve_web_session(p_token_hash, p_idle) refuses a session whose
--     last_seen_at is older than p_idle (default 14 days). The absolute
--     expires_at, revoked_at and epoch checks are unchanged, but the whole
--     decision now happens UNDER the session row's lock (see the body): adding
--     a write to a previously read-only resolve is what made lock ordering
--     matter, and deciding before the wait would let a concurrently committing
--     logout still hand back an authenticated session.
--   * auth_rotate_web_session gains the SAME window. Without it the idle TTL
--     would be a property of ONE function rather than of the session: rotate
--     (0015) only filtered revoked_at/expires_at, and apps/web's issueSession
--     (session-cookies.ts) hands it the raw request cookie WITHOUT resolving
--     first — so a cookie silent for 20 days would come back from the dead as
--     a fresh 30-day session with the idle clock reset, exactly the
--     copied-off-a-device case W-6 is about. Measured before this fix:
--     resolve('stale') -> 0 rows, rotate('stale') -> minted, resolve(new) -> 1 row.
--     auth_revoke_web_session / auth_revoke_all_web_sessions are deliberately
--     NOT windowed: they only ever revoke, and the logout-all route resolves
--     first (logout-all/route.ts:39) so an idle cookie cannot reach it anyway.
-- Signature change (both functions): the old overload is DROPPED before the new
-- one is created — keeping both would make `auth_resolve_web_session($1)` /
-- `auth_rotate_web_session($1,$2,$3,$4,$5)` ambiguous ("function is not
-- unique") for every existing caller.
-- Expand-only: existing rows get last_seen_at = now() at migration time, so
-- no live session is cut off by the migration itself; the idle clock starts
-- from the deploy.
-- ============================================================================

ALTER TABLE web_sessions
  ADD COLUMN last_seen_at timestamptz NOT NULL DEFAULT now();

-- Cleanup/observability reads ("sessions idle for > N days") without a seq scan.
CREATE INDEX idx_web_sessions_last_seen_active ON web_sessions(last_seen_at)
  WHERE revoked_at IS NULL;

DROP FUNCTION IF EXISTS auth_resolve_web_session(text);

CREATE FUNCTION auth_resolve_web_session(
  p_token_hash text,
  p_idle interval DEFAULT interval '14 days'
)
RETURNS TABLE (session_id uuid, account_id uuid, person_id uuid,
               csrf_secret text, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_idle IS NULL OR p_idle <= interval '0' THEN
    RAISE EXCEPTION 'auth_resolve_web_session: p_idle must be a positive interval'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- (1) READ-ONLY candidate resolution: which row to lock, holding no lock (0034/0043 shape).
  SELECT s.id INTO v_id
  FROM web_sessions s
  WHERE s.token_hash = p_token_hash
    AND s.revoked_at IS NULL
    AND s.expires_at > now()
    AND s.last_seen_at > now() - p_idle;
  IF v_id IS NULL THEN
    RETURN;
  END IF;

  -- (2) Lock the session row, THEN revalidate every fact under the lock.
  --
  -- The touch below is a write, so it takes this row lock either way; the only question is
  -- whether the answer is decided before or after that wait. Deciding it BEFORE — read the row,
  -- then block on the touch — is a live authentication bug the moment the toucher is the one
  -- blocking: a logout that had UPDATEd the row but not yet committed is invisible to the
  -- read (READ COMMITTED shows the old version), the touch then queues behind it, and when the
  -- logout COMMITS this function goes on to return the session it already cached. A revoke that
  -- committed strictly before we answered would still have let the caller in, which is precisely
  -- what DD-80 v1.88's "revoke-all is linearizable" forbids.
  -- Locking first and re-reading under the lock makes the revoke either entirely before us (we
  -- see it and return nothing) or entirely after (it waits for us). clock_timestamp(), not now():
  -- now() is frozen at transaction start and does not advance across the lock wait, so a session
  -- that crosses its expiry or idle threshold WHILE queued here must still read as dead — the
  -- same reason 0015 gives for rotate/logout-all (codex round-09 [P2]).
  -- Lock order is safe: this acquires web_sessions and NOTHING else (the accounts read below
  -- takes no row lock), while rotate/logout-all take accounts before web_sessions — no cycle.
  PERFORM 1 FROM web_sessions WHERE id = v_id FOR UPDATE;

  SELECT s.id, s.account_id, a.person_id, s.csrf_secret, s.expires_at
    INTO session_id, account_id, person_id, csrf_secret, expires_at
  FROM web_sessions s
  JOIN accounts a ON a.id = s.account_id
  WHERE s.id = v_id
    AND s.token_hash = p_token_hash
    AND s.revoked_at IS NULL
    AND s.expires_at > clock_timestamp()
    AND s.last_seen_at > clock_timestamp() - p_idle
    AND s.minted_epoch = a.session_epoch;
  IF NOT FOUND THEN
    RETURN; -- revoked, expired, idled out or epoch-bumped while we were resolving
  END IF;

  -- (3) Touch, throttled: a session used within the last minute is not rewritten. We already
  -- hold the row lock, so this cannot block and cannot race the check above.
  UPDATE web_sessions
     SET last_seen_at = clock_timestamp()
   WHERE id = session_id
     AND last_seen_at < clock_timestamp() - interval '1 minute';

  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION auth_resolve_web_session(text, interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_resolve_web_session(text, interval) TO app;

-- ---------------------------------------------------------------------------
-- Rotate, same window. Body is 0015's verbatim (read-only resolve -> lock the
-- unique accounts parent set in ascending id order -> re-read the candidate
-- FOR UPDATE and revalidate every fact under the lock), with the idle
-- predicate added to BOTH the candidate read and the locked revalidation, and
-- clock_timestamp() under the lock for the same reason 0015 gives for
-- expires_at: now() is frozen at transaction start and does not advance across
-- the lock wait, so a session that crosses its idle threshold WHILE queued
-- must still read as idle-dead.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS auth_rotate_web_session(text, text, text, interval, uuid);

CREATE FUNCTION auth_rotate_web_session(
  p_old_token_hash text, p_new_token_hash text, p_new_csrf text, p_ttl interval,
  p_account_id uuid, p_idle interval DEFAULT interval '14 days'
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_candidate_id uuid;
  v_old_account_id uuid;
  v_old_epoch bigint;
  v_target_epoch bigint;
  v_old web_sessions%ROWTYPE;
  v_new uuid;
BEGIN
  IF p_idle IS NULL OR p_idle <= interval '0' THEN
    RAISE EXCEPTION 'auth_rotate_web_session: p_idle must be a positive interval'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT id, account_id INTO v_candidate_id, v_old_account_id
  FROM web_sessions
  WHERE token_hash = p_old_token_hash
    AND revoked_at IS NULL
    AND expires_at > now()
    AND last_seen_at > now() - p_idle;
  IF NOT FOUND THEN
    RETURN NULL; -- nothing to rotate (caller treats as plain login)
  END IF;

  PERFORM 1 FROM accounts WHERE id IN (v_old_account_id, p_account_id) ORDER BY id FOR UPDATE;

  SELECT session_epoch INTO v_old_epoch FROM accounts WHERE id = v_old_account_id;
  SELECT session_epoch INTO v_target_epoch FROM accounts WHERE id = p_account_id;
  IF v_old_epoch IS NULL OR v_target_epoch IS NULL THEN
    RAISE EXCEPTION 'auth_rotate_web_session: unknown account in parent set' USING ERRCODE = 'foreign_key_violation';
  END IF;

  SELECT * INTO v_old FROM web_sessions
  WHERE id = v_candidate_id
    AND token_hash = p_old_token_hash
    AND account_id = v_old_account_id
    AND revoked_at IS NULL
    AND expires_at > clock_timestamp()
    AND last_seen_at > clock_timestamp() - p_idle
  FOR UPDATE;
  IF NOT FOUND OR v_old.minted_epoch <> v_old_epoch THEN
    RETURN NULL; -- drift under lock: zero insert
  END IF;

  UPDATE web_sessions SET revoked_at = now() WHERE id = v_old.id;
  INSERT INTO web_sessions(account_id, token_hash, csrf_secret, expires_at, rotated_from, minted_epoch)
  VALUES (p_account_id, p_new_token_hash, p_new_csrf, now() + p_ttl, v_old.id, v_target_epoch)
  RETURNING id INTO v_new;
  RETURN v_new;
END;
$$;
REVOKE ALL ON FUNCTION auth_rotate_web_session(text,text,text,interval,uuid,interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_rotate_web_session(text,text,text,interval,uuid,interval) TO app;
