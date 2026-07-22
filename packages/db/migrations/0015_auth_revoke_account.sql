-- ============================================================================
-- 0015_auth_revoke_account.sql
-- D0a — account-session epoch core + revoke-all (DB layer only).
-- Source: docs/standards/decisions.md DD-80 v1.88 · docs/g3-revoke-all-concurrency-probe-seed.md
--         v1.0 (FINAL CONTRACT) §3-§8 · docs/b0-auth-credential-lifecycle-design-probe.md
--         §6/§8.3/§9 · docs/features/BE/feature_web_auth_onboarding_tech.md v2.10 D0a.
--
-- Scope: one atomic migration adding the account-level `session_epoch` /
-- session-level `minted_epoch` linearizable revoke-all authority, replacing
-- create/resolve/rotate with epoch-aware, parent-first-locking versions,
-- adding the ungranted internal revoke helper + public account-self logout-all
-- wrapper, the shared append-only `auth_audit_events` table, and closing the
-- pre-existing schema.ts mirror drift for auth_login_nonces/auth_login_state/
-- rate_limit_hits (B0 §9 resolution "(a)": migrations are runtime authority,
-- schema.ts mirrors every table including function-only ones — see schema.ts).
--
-- D0b (apps/web `issueSession` reject-and-reauth fence + POST /api/auth/logout-all
-- + CSRF) is a SEPARATE slice (auth-s4-d0-session-web-boundary) that depends on
-- this migration; nothing here touches apps/web.
--
-- Concurrency contract (G3 v1.0, canonical — do not re-derive):
--   - a session resolves only when `minted_epoch = session_epoch` (exact
--     equality; `>=` is forbidden, any lower/higher/corrupt epoch fails closed);
--   - every path that inserts/rebinds a session or performs account-wide
--     revoke locks the relevant `accounts` parent row(s) BEFORE ever touching
--     `web_sessions` (closes the session-first deadlock class fixed for rotate
--     in v1.83 — now generalized to create/resolve/revoke-all too);
--   - cross-account rotate locks the unique set {old_account, target_account}
--     in ascending id order;
--   - logout-all revalidates the current token under the locked account epoch
--     BEFORE bumping, then bumps the epoch and materializes `revoked_at` on
--     EVERY unrevoked row of that account (including a corrupt/future-epoch
--     row) atomically with the audit row, in one transaction.
--
-- Rollback (pre-production, additive-only — see g3-...-probe-seed.md §6.2):
--   DROP FUNCTION auth_revoke_all_web_sessions / auth_revoke_account_sessions;
--   restore the exact 0012 create/resolve/rotate definitions; DROP INDEX
--   idx_web_sessions_account_active; DROP TABLE auth_audit_events; DROP the
--   epoch columns only after confirming no dependent object remains. After
--   production use, prefer a forward-compatible migration that restores
--   0012-equivalent behavior while KEEPING the epoch columns and audit
--   history — every session an epoch bump invalidated already has
--   `revoked_at` set, so disabling the epoch predicate cannot resurrect it.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Account-session epoch columns (G3 §1/§6.1) — existing rows backfill to
--    0 via the column DEFAULT (metadata-only in PG11+, no table rewrite).
-- ---------------------------------------------------------------------------
ALTER TABLE accounts ADD COLUMN session_epoch bigint NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD CONSTRAINT accounts_session_epoch_chk CHECK (session_epoch >= 0);

ALTER TABLE web_sessions ADD COLUMN minted_epoch bigint NOT NULL DEFAULT 0;
ALTER TABLE web_sessions ADD CONSTRAINT web_sessions_minted_epoch_chk CHECK (minted_epoch >= 0);

-- ---------------------------------------------------------------------------
-- 2. Revoke-all index (v1.86/D0-13) — account-wide revoke walks only the
--    LIVE rows of one account while holding the accounts parent lock; live
--    0001 only has UNIQUE(token_hash), which cannot serve this predicate.
-- ---------------------------------------------------------------------------
CREATE INDEX idx_web_sessions_account_active
  ON web_sessions(account_id) WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- 3. Shared append-only auth audit — column-for-column per the pinned shape
--    in B0 §3.1/§8.3, plus the v1.88 session_epoch_before/after amendment.
--    Created here (v1.83 ownership), reused/extended by later slices
--    (order-2 email/reset events reuse `link_codes_revoked` /
--    `merge_artifacts_cancelled`, both NULL for every event D0a writes). No
--    grants: written only from inside the SECURITY DEFINER functions below.
-- ---------------------------------------------------------------------------
CREATE TABLE auth_audit_events (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type                text NOT NULL,
  account_id                uuid,
  account_email_id          uuid,
  outcome_class             text NOT NULL,
  actor_class               text NOT NULL,
  request_ref               text NOT NULL,
  sessions_revoked          integer,
  session_epoch_before      bigint,
  session_epoch_after       bigint,
  link_codes_revoked        integer,
  merge_artifacts_cancelled integer,
  created_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_audit_events_sessions_revoked_chk
    CHECK (sessions_revoked IS NULL OR sessions_revoked >= 0),
  CONSTRAINT auth_audit_events_epoch_before_chk
    CHECK (session_epoch_before IS NULL OR session_epoch_before >= 0),
  CONSTRAINT auth_audit_events_epoch_after_chk
    CHECK (session_epoch_after IS NULL OR session_epoch_after >= 0),
  CONSTRAINT auth_audit_events_link_codes_revoked_chk
    CHECK (link_codes_revoked IS NULL OR link_codes_revoked >= 0),
  CONSTRAINT auth_audit_events_merge_artifacts_cancelled_chk
    CHECK (merge_artifacts_cancelled IS NULL OR merge_artifacts_cancelled >= 0),
  -- Both null (an event that never touches session_epoch) or an exact +1
  -- bump — never a gap, never a decrement (DD-80 v1.88). Both branches must
  -- resolve definitely FALSE, not UNKNOWN, for a one-sided NULL: a CHECK
  -- constraint accepts UNKNOWN, so branch 2 must assert IS NOT NULL on both
  -- sides before comparing (codex round-01).
  CONSTRAINT auth_audit_events_epoch_shape_chk
    CHECK (
      (session_epoch_before IS NULL AND session_epoch_after IS NULL)
      OR (
        session_epoch_before IS NOT NULL
        AND session_epoch_after IS NOT NULL
        AND session_epoch_after = session_epoch_before + 1
      )
    )
);

-- Retention/cleanup scan index (codex round-03) — matches the established
-- pattern for every other retention-swept table in this migration set
-- (idx_auth_login_nonces_seen_at, idx_auth_login_state_expires_at,
-- idx_rate_limit_at): without it, a future cleanup/retention sweep keyed on
-- created_at degrades to a full-table scan as this append-only audit table
-- grows without bound.
CREATE INDEX auth_audit_events_created_at_idx ON auth_audit_events(created_at);

-- ---------------------------------------------------------------------------
-- 4. create / resolve / rotate — CREATE OR REPLACE, SAME signatures and
--    response shapes (manifest negative scope); only the locking/epoch
--    behavior below is new.
-- ---------------------------------------------------------------------------

-- §4.1: lock the target account, stamp the EXACT locked epoch, then insert.
-- Missing account aborts without inserting (fails closed via the explicit
-- check below, ahead of the FK violation the old INSERT-only body relied on).
CREATE OR REPLACE FUNCTION auth_create_web_session(
  p_account_id uuid, p_token_hash text, p_csrf_secret text, p_ttl interval
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_epoch bigint;
  v_id uuid;
BEGIN
  SELECT session_epoch INTO v_epoch FROM accounts WHERE id = p_account_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'auth_create_web_session: unknown account' USING ERRCODE = 'foreign_key_violation';
  END IF;

  INSERT INTO web_sessions(account_id, token_hash, csrf_secret, expires_at, minted_epoch)
  VALUES (p_account_id, p_token_hash, p_csrf_secret, now() + p_ttl, v_epoch)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION auth_create_web_session(uuid,text,text,interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_create_web_session(uuid,text,text,interval) TO app;

-- §4.2: reuse the existing accounts JOIN, add exact epoch equality. No cache,
-- no second subquery — a future/corrupt/lower/higher epoch simply joins to a
-- row that fails the predicate, so it returns nothing (fail-closed by
-- construction, not by an extra branch).
CREATE OR REPLACE FUNCTION auth_resolve_web_session(p_token_hash text)
RETURNS TABLE (session_id uuid, account_id uuid, person_id uuid,
               csrf_secret text, expires_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT s.id, s.account_id, a.person_id, s.csrf_secret, s.expires_at
  FROM web_sessions s
  JOIN accounts a ON a.id = s.account_id
  WHERE s.token_hash = p_token_hash
    AND s.revoked_at IS NULL
    AND s.expires_at > now()
    AND s.minted_epoch = a.session_epoch;
$$;
REVOKE ALL ON FUNCTION auth_resolve_web_session(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_resolve_web_session(text) TO app;

-- §4.3: read-only resolve the candidate FIRST (no lock), THEN lock the
-- unique {old_account, target_account} parent set in ascending id order
-- (collapses to one row for a same-account rotate), THEN re-read the
-- candidate FOR UPDATE and revalidate every fact — including epoch equality
-- — that the read-only step could have raced with. This is parent-first
-- (accounts before web_sessions) everywhere, closing the deadlock class
-- v1.83 fixed for rotate-vs-revoke and generalizing it to rotate-vs-logout-all.
CREATE OR REPLACE FUNCTION auth_rotate_web_session(
  p_old_token_hash text, p_new_token_hash text, p_new_csrf text, p_ttl interval,
  p_account_id uuid
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
  -- Read-only resolve: which account currently owns the live candidate.
  SELECT id, account_id INTO v_candidate_id, v_old_account_id
  FROM web_sessions
  WHERE token_hash = p_old_token_hash AND revoked_at IS NULL AND expires_at > now();
  IF NOT FOUND THEN
    RETURN NULL; -- nothing to rotate (caller treats as plain login)
  END IF;

  -- Lock the unique parent set in ascending id order (G3-I4); a same-account
  -- rotate's IN-list collapses to the single row and locks it once (G3-I3).
  PERFORM 1 FROM accounts WHERE id IN (v_old_account_id, p_account_id) ORDER BY id FOR UPDATE;

  SELECT session_epoch INTO v_old_epoch FROM accounts WHERE id = v_old_account_id;
  SELECT session_epoch INTO v_target_epoch FROM accounts WHERE id = p_account_id;
  IF v_old_epoch IS NULL OR v_target_epoch IS NULL THEN
    RAISE EXCEPTION 'auth_rotate_web_session: unknown account in parent set' USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- Re-read the candidate FOR UPDATE under the parent lock and revalidate
  -- hash/id/old-account/unrevoked/unexpired/epoch — a concurrent logout-all
  -- or a second rotate may have already invalidated it while we were locking.
  -- clock_timestamp() (codex round-09 [P2]), not now(): now() is frozen at
  -- this transaction's/statement's start and does NOT advance across the
  -- lock wait above, so a token that genuinely crosses its expiry threshold
  -- while queued here would otherwise still read as unexpired and mint a
  -- replacement past expiry — empirically confirmed (now() stays fixed
  -- across a pg_sleep in the same transaction; clock_timestamp() advances).
  SELECT * INTO v_old FROM web_sessions
  WHERE id = v_candidate_id
    AND token_hash = p_old_token_hash
    AND account_id = v_old_account_id
    AND revoked_at IS NULL
    AND expires_at > clock_timestamp()
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
REVOKE ALL ON FUNCTION auth_rotate_web_session(text,text,text,interval,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_rotate_web_session(text,text,text,interval,uuid) TO app;

-- ---------------------------------------------------------------------------
-- 5. Internal revoke-by-account helper (G3 §4.4) — OWNER-ONLY, never granted
--    to any runtime role. Caller MUST already hold the accounts(p_account_id)
--    parent lock (auth_revoke_all_web_sessions below does, before calling).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION auth_revoke_account_sessions(p_account_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_revoked_at timestamptz := now();
  v_count integer;
BEGIN
  UPDATE accounts SET session_epoch = session_epoch + 1 WHERE id = p_account_id;

  -- Epoch is validity authority; this bulk materialization exists for
  -- single-revoke/audit/count semantics and forward-rollback safety
  -- (G3-I6/I7) and unconditionally covers a corrupt/future-epoch row too.
  UPDATE web_sessions
  SET revoked_at = v_revoked_at
  WHERE account_id = p_account_id AND revoked_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION auth_revoke_account_sessions(uuid) FROM PUBLIC;
-- Deliberately no GRANT — see 0012's header + G3-I8. Only
-- auth_revoke_all_web_sessions below may reach this (SECURITY DEFINER call
-- from another SECURITY DEFINER function owned by the same migration role).

-- ---------------------------------------------------------------------------
-- 6. Public account-self logout-all wrapper (G3 §4.5) — derives the account
--    from the CURRENT session server-side; never accepts account_id from the
--    caller/body.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION auth_revoke_all_web_sessions(p_current_token_hash text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_candidate_id uuid;
  v_account_id uuid;
  v_old_epoch bigint;
  v_new_epoch bigint;
  v_candidate_epoch bigint;
  v_count integer;
BEGIN
  -- 1) Read-only resolve: derive the account server-side. This is purely an
  --    ACCOUNT LOOKUP KEY — the candidate row's subsequent fate does not
  --    gate the account-wide intent established here.
  SELECT id, account_id INTO v_candidate_id, v_account_id
  FROM web_sessions
  WHERE token_hash = p_current_token_hash AND revoked_at IS NULL AND expires_at > now();
  IF NOT FOUND THEN
    RETURN NULL; -- invalid/replayed/expired token: zero mutation
  END IF;

  -- 2) Lock the account parent (single-account operation). Any concurrent
  --    create/rotate/logout-all targeting this SAME account now serializes
  --    behind us.
  SELECT session_epoch INTO v_old_epoch FROM accounts WHERE id = v_account_id FOR UPDATE;

  -- 3) Re-derive the candidate's epoch under the account lock. Per G3-I1,
  --    exact epoch equality is the SOLE validity authority for detecting a
  --    PRIOR logout-all — not revoked_at. A concurrent rotate or the
  --    pre-existing single-session `auth_revoke_web_session` may have
  --    already flipped this row's revoked_at WITHOUT bumping the account
  --    epoch (neither touches session_epoch): the account-wide intent from
  --    step 1 still holds and MUST proceed — this is the G3 §5 "rotate wins
  --    X lock -> replacement is minted at E, then logout bumps E+1 and
  --    revokes it" row (codex round-06 [P1]; an earlier revision wrongly
  --    aborted here). minted_epoch never changes after a row is inserted,
  --    so this plain read needs no additional lock: the account lock we
  --    already hold blocks any concurrent INSERT into this account. Only a
  --    STRICTLY earlier epoch means a DIFFERENT logout-all already fully
  --    consumed this exact generation before us — the true replay case
  --    (G3-A8/D0-19). expires_at IS re-checked here (codex round-08 [P2],
  --    G3 §4.5 step 4 "currently expired token ... performs zero mutation"):
  --    unlike revoked_at, wall-clock expiry is independent of any other
  --    writer and can genuinely cross its threshold while this call was
  --    queued on the account lock — checked against clock_timestamp(), not
  --    now() (codex round-09 [P2]): now() is frozen at this call's own
  --    transaction/statement start and does not advance across the lock
  --    wait in step 2 above, so a token that naturally expires DURING that
  --    wait would otherwise still read as unexpired here.
  SELECT minted_epoch INTO v_candidate_epoch FROM web_sessions
  WHERE id = v_candidate_id AND token_hash = p_current_token_hash
    AND account_id = v_account_id AND expires_at > clock_timestamp();
  IF NOT FOUND OR v_candidate_epoch <> v_old_epoch THEN
    RETURN NULL; -- expired, or stale relative to a prior logout-all: zero mutation
  END IF;

  v_count := auth_revoke_account_sessions(v_account_id);
  SELECT session_epoch INTO v_new_epoch FROM accounts WHERE id = v_account_id;

  -- request_ref = the current session's own id (opaque, already-internal —
  -- never the raw token/hash) per the pinned shape's intent for events with
  -- no HTTP-layer command/request context at the DB layer.
  INSERT INTO auth_audit_events(
    event_type, account_id, outcome_class, actor_class,
    request_ref, sessions_revoked, session_epoch_before, session_epoch_after
  ) VALUES (
    'logout_all', v_account_id, 'success', 'account_self',
    v_candidate_id::text, v_count, v_old_epoch, v_new_epoch
  );

  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION auth_revoke_all_web_sessions(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_revoke_all_web_sessions(text) TO app;

-- ---------------------------------------------------------------------------
-- 7. schema.ts mirror drift closure (B0 §9 resolution "(a)") — auth_login_nonces
--    / auth_login_state / rate_limit_hits already exist (0012); this migration
--    adds no DDL for them. See schema.ts for the matching Drizzle mirror.
-- ---------------------------------------------------------------------------
