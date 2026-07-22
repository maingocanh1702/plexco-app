-- ============================================================================
-- 0018_oauth_completion_handoff.sql
-- auth-s4-d1b — OAuth session-rotation completion hop (M3). DB layer only.
-- The tail before this migration is 0017, so 0018 is monotonic. EXPAND-ONLY:
-- it adds four columns + two SECURITY DEFINER functions to the EXISTING
-- auth_oauth_transactions row (0017); it creates no table and drops nothing.
--
-- WHY THIS EXISTS (docs/slice-readiness-verdicts.md Verdict 12 · docs/
--   probe-strict-cookie-completion-hop.md · feature_web_auth_onboarding_tech.md
--   §4 acceptance D1B-1..D1B-11): a SameSite=Strict session cookie is NOT sent
--   on the cross-site OAuth callback, so the callback cannot read/rotate a
--   pre-existing session. The pinned fix (M3) is a same-site completion hop: the
--   callback returns a first-party landing that auto-submits a same-origin POST
--   to /api/auth/google/complete, where the Strict cookie IS present, so the
--   EXISTING issueSession() runs its EXISTING rotate branch (auth_rotate_web_session,
--   0015 — reused UNCHANGED, no new primitive). Because the callback can no longer
--   call issueSession(), the account it resolved must reach the completion endpoint.
--
-- HANDOFF PERSISTENCE — option (a), the manifest's chosen shape: carry the
--   resolved account on the SAME oauth transaction row, gated by a single-use,
--   short-TTL, server-side DURABLE fence. The raw handoff token travels only in
--   the M3 landing's POST body (hidden field); ONLY its sha256 is stored here.
--   D1B-5 (replay) and D1B-6 (expiry) are enforced by the atomic
--   `UPDATE ... WHERE handoff_consumed_at IS NULL AND handoff_expires_at > clock_timestamp()`
--   in auth_oauth_handoff_consume — never by a cookie signature (a valid
--   signature stays valid on replay). This reuses the row's existing
--   sweep/retention/grant machinery (_auth_oauth_transaction_sweep terminalizes
--   + retention-deletes; the handoff row is already terminal after the claim,
--   so the 30-day retention delete cleans it — no new sweep needed).
--
-- NEGATIVE SCOPE (binding — manifest): NO new rotate primitive (0015's
--   auth_rotate_web_session is reused as-is); NO change to the Strict session
--   cookie attribute; NO re-litigating the D1 mint-fresh contract; NO Facebook /
--   email-bundle / Telegram work. auth_oauth_transactions stays FUNCTION-ONLY:
--   the new columns get ZERO direct grant; arm/consume run only inside the
--   SECURITY DEFINER functions below (mirrors 0017's issue/claim/login grants).
--
-- Rollback (pre-production, additive-only): in a NEW revert migration DROP
--   FUNCTION auth_oauth_handoff_consume / auth_oauth_handoff_arm, DROP INDEX
--   auth_oauth_transactions_handoff_idx, then ALTER TABLE ... DROP COLUMN the
--   four columns. Nothing owned by 0015/0016/0017 is dropped here.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Expand auth_oauth_transactions (0017) with the completion-handoff columns.
--    `resolved_account_id` = the account the callback resolved via the full
--    OIDC proof + §4 collision finalizer (the completion endpoint CANNOT re-run
--    that — it has no code/proof — so the resolution must be persisted here).
--    `handoff_hash` = sha256 of the one-time handoff token that rides the M3
--    landing's POST body; `handoff_expires_at` = its short TTL; and
--    `handoff_consumed_at` = the DURABLE single-use fence (a set value can never
--    be re-consumed). All NULL until the callback arms the handoff, so every
--    pre-existing row trivially satisfies the two CHECKs below.
-- ---------------------------------------------------------------------------
ALTER TABLE auth_oauth_transactions
  ADD COLUMN resolved_account_id uuid REFERENCES accounts(id),
  ADD COLUMN handoff_hash        text,
  ADD COLUMN handoff_expires_at  timestamptz,
  ADD COLUMN handoff_consumed_at timestamptz;

-- Arming sets account + hash + expiry together; a consumed handoff must have
-- been armed first. Each branch resolves definitely TRUE/FALSE (no UNKNOWN gap).
ALTER TABLE auth_oauth_transactions
  ADD CONSTRAINT auth_oauth_transactions_handoff_armed_chk
    CHECK (handoff_hash IS NULL
           OR (resolved_account_id IS NOT NULL AND handoff_expires_at IS NOT NULL)),
  ADD CONSTRAINT auth_oauth_transactions_handoff_consumed_chk
    CHECK (handoff_consumed_at IS NULL OR handoff_hash IS NOT NULL);

-- The consume lookup is by handoff_hash; UNIQUE (partial, only armed rows) both
-- serves that lookup and forbids two rows ever sharing a handoff hash. A
-- consumed row KEEPS its handoff_hash (only handoff_consumed_at is stamped), so
-- it stays in this index and the hash can never be reused post-consume.
CREATE UNIQUE INDEX auth_oauth_transactions_handoff_idx
  ON auth_oauth_transactions(handoff_hash) WHERE handoff_hash IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. auth_oauth_handoff_arm — called by the cross-site callback AFTER the OIDC
--    proof matrix passes and auth_login_google resolves the account, to bind the
--    resolved account to a one-time handoff on THIS (already-claimed) transaction
--    row. Guarded so it only arms a row whose OAuth code was actually claimed
--    (consumed_at IS NOT NULL) and is not already armed (handoff_hash IS NULL —
--    arm is itself single-use). Returns TRUE when exactly that row was armed; the
--    caller fails closed (AUTH_INVALID, no landing) on FALSE. Uses clock_timestamp()
--    for the TTL to match the 0015/0016/0017 post-lock time discipline.
-- ---------------------------------------------------------------------------
CREATE FUNCTION auth_oauth_handoff_arm(
  p_state_hash text,
  p_handoff_hash text,
  p_resolved_account_id uuid,
  p_ttl interval
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE auth_oauth_transactions
  SET resolved_account_id = p_resolved_account_id,
      handoff_hash        = p_handoff_hash,
      handoff_expires_at  = clock_timestamp() + p_ttl
  WHERE state_hash = p_state_hash
    AND consumed_at IS NOT NULL   -- the OAuth code was single-use claimed
    AND handoff_hash IS NULL;     -- not already armed (arm is single-use)
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION auth_oauth_handoff_arm(text,text,uuid,interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_oauth_handoff_arm(text,text,uuid,interval) TO app;

-- ---------------------------------------------------------------------------
-- 3. auth_oauth_handoff_consume — called by the same-site /complete POST (where
--    the Strict cookie is present). Single-use, atomic: match the exact handoff
--    hash that is unconsumed and unexpired, stamp handoff_consumed_at, and return
--    the resolved account for issueSession(). Missing / replayed (already
--    consumed) / expired all match ZERO rows and return NULL with zero mutation
--    (D1B-5, D1B-6). Two concurrent consumes of the same hash serialize on the
--    row lock; the loser re-reads a consumed row, the `handoff_consumed_at IS NULL`
--    predicate no longer holds, and it gets NULL. clock_timestamp() (not the
--    frozen now()) so a handoff that crosses its expiry mid-request reads expired.
-- ---------------------------------------------------------------------------
CREATE FUNCTION auth_oauth_handoff_consume(p_handoff_hash text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_account uuid;
BEGIN
  UPDATE auth_oauth_transactions
  SET handoff_consumed_at = clock_timestamp()
  WHERE handoff_hash = p_handoff_hash
    AND handoff_consumed_at IS NULL
    AND handoff_expires_at > clock_timestamp()
  RETURNING resolved_account_id INTO v_account;
  RETURN v_account; -- NULL when missing / already consumed / expired
END;
$$;
REVOKE ALL ON FUNCTION auth_oauth_handoff_consume(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_oauth_handoff_consume(text) TO app;
