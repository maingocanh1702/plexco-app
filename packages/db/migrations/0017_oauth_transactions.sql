-- ============================================================================
-- 0017_oauth_transactions.sql
-- D1 (order-3) — Google OIDC adapter: the cross-site OAuth transaction store,
-- its narrow issue/claim functions, and the per-lane Google login finalizer
-- (§4 collision table). DB layer only. The tail before this migration is 0016,
-- so 0017 is monotonic.
-- Source: docs/standards/decisions.md DD-80 v1.88 (§10 order-3) · DD-13/DD-33/
--   DD-50/DD-53 · docs/b0-auth-credential-lifecycle-design-probe.md §4 (Google
--   OIDC collision table, 8 cells) · §4.1 (auth_oauth_transactions + browser
--   binding + PKCE ciphertext lifecycle CHECK) · §5.2 (THE canonical parent-first
--   lock hierarchy, WITHOUT the DD-70 fence — order-3 emits no global item) ·
--   §8.2 (rate buckets) · §8.3 (per-lane audit: cells 1-6 login_success,
--   cell 7 identity_conflict, cell 8 pre-DB no row) ·
--   docs/features/BE/feature_web_auth_onboarding_tech.md v2.10 §2/§4/§5
--   acceptance matrix D1-1..D1-15.
--
-- Scope (exactly this migration): one table auth_oauth_transactions (+ its
-- expiry index); the narrow SECURITY DEFINER functions
-- auth_oauth_transaction_issue / auth_oauth_transaction_claim (state+binding
-- browser-continuity, Google PKCE/nonce, single-use consume) granted to `app`;
-- and auth_login_google, the §4 collision finalizer granted to `app`. It REUSES
-- auth_audit_events (0015) and account_emails / auth_pending_email_registrations
-- / auth_email_tokens (0016); it creates NONE of them.
--
-- NEGATIVE SCOPE (binding — DD-80 §10 order-3, manifest):
--   * NO Facebook adapter (external gate DD-33 owns its own slice). The provider
--     CHECK already ALLOWS 'facebook' so the row shape is future-proof, but no
--     Facebook route/function is authored here.
--   * NO email register/verify/login/forgot/reset functions (order-4 bundle).
--   * NO email-change / rebind from Google claims: an EXISTING Google subject is
--     the stable identity owner (cells 5/6 login by subject, never mutate/promote
--     a contact from the returned email).
--   * NO auto-merge on identity conflict: cell 7 fails closed to identity_conflict
--     (→ DD-53), never mints a session or merges Person/Account.
--   * NO Telegram route/function removal.
--   * The table is function-only: ZERO grant to `app` (mirrors the 0012
--     auth_login_state / 0016 account_emails pattern). Issue/claim/login run only
--     inside the SECURITY DEFINER functions below.
--
-- Canonical lock hierarchy (B0 §5.2 — do NOT re-derive): read-only resolve the
-- subject owner + email owner (no lock) -> serialize concurrent same-email logins
-- on a domain-separated advisory lock keyed by email_lookup_hash -> lock the
-- involved `accounts` parent row(s) UUID-order -> lock the `account_emails` row
-- -> re-resolve under the locks and apply the collision cell. Never child-first.
-- Post-lock expiry re-checks use clock_timestamp() (0015/0016 precedent: now() is
-- frozen at transaction start and does not advance across a lock wait).
--
-- Rollback (pre-production, additive-only): first turn provider flag/routes OFF
-- (feature_web_auth_onboarding_tech.md §Rollback), then in a NEW revert migration
-- DROP FUNCTION auth_login_google / auth_oauth_transaction_claim /
-- auth_oauth_transaction_issue / _auth_oauth_transaction_sweep, then DROP TABLE
-- auth_oauth_transactions. Nothing owned by 0015/0016 is dropped here.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. auth_oauth_transactions (B0 §4.1 / tech §2) — one protected row per
--    started OAuth redirect flow. `state_hash` = SHA-256 of the 32-byte state
--    that travels in the authorization URL; `browser_binding_hash` = SHA-256 of
--    a distinct 32-byte value that lives ONLY in the path-scoped Lax cookie, so
--    a stolen authorization response without the cookie cannot be replayed.
--    Google additionally carries `nonce_hash` and the S256 PKCE verifier
--    CIPHERTEXT (`pkce_verifier_enc` bytea) with its OWN `kms_key_version` — the
--    raw verifier is NEVER stored in plaintext. The two lifecycle CHECKs mirror
--    auth_email_deliveries: `consumed_at` implies `terminal_at`; a Google row
--    carries verifier+nonce+key-version while non-terminal and NULLs the
--    ciphertext/key-version once terminal (D1-3/D1-12).
-- ---------------------------------------------------------------------------
CREATE TABLE auth_oauth_transactions (
  state_hash           text PRIMARY KEY,
  provider             text NOT NULL CHECK (provider IN ('google','facebook')),
  browser_binding_hash text NOT NULL,
  nonce_hash           text,
  pkce_verifier_enc    bytea,           -- canonical *_enc bytea; Google S256 only
  kms_key_version      text,            -- opaque KMS key/version metadata (text, not an envelope)
  expires_at           timestamptz NOT NULL,
  consumed_at          timestamptz,
  terminal_at          timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  -- consume always terminalizes; a terminal row may exist without a consume
  -- (expiry-cleanup terminalize — the order-4 sweep, §4.1).
  CONSTRAINT auth_oauth_transactions_consumed_terminal_chk
    CHECK (consumed_at IS NULL OR terminal_at IS NOT NULL),
  -- Google requires nonce+verifier+key while live, and NULLs verifier+key once
  -- terminal. Facebook (future) carries neither, so the CHECK only constrains
  -- provider='google'. The three OR branches are mutually exhaustive for a
  -- Google row and each resolves definitely TRUE/FALSE (no UNKNOWN gap).
  CONSTRAINT auth_oauth_transactions_google_lifecycle_chk CHECK (
    provider <> 'google'
    OR (terminal_at IS NULL
        AND nonce_hash IS NOT NULL AND pkce_verifier_enc IS NOT NULL AND kms_key_version IS NOT NULL)
    OR (terminal_at IS NOT NULL
        AND pkce_verifier_enc IS NULL AND kms_key_version IS NULL)
  )
);
-- Sweep indexes — PARTIAL, matching the two sweep predicates exactly so neither
-- the terminalize UPDATE nor the retention DELETE full-scans as terminal rows
-- accumulate (codex round-02 [P2]):
--   * expired-but-nonterminal rows = the terminalize target,
--   * terminal rows = the 30-day retention-delete target.
CREATE INDEX auth_oauth_transactions_expiry_idx
  ON auth_oauth_transactions(expires_at) WHERE terminal_at IS NULL;
CREATE INDEX auth_oauth_transactions_terminal_idx
  ON auth_oauth_transactions(terminal_at) WHERE terminal_at IS NOT NULL;
-- No grants: reached only inside the SECURITY DEFINER functions below.

-- ---------------------------------------------------------------------------
-- 1b. _auth_oauth_transaction_sweep (B0 §4.1 "sweep-at-traffic trong chính
--     narrow issue/claim functions") — the ONE sweep owner, called from BOTH
--     issue AND claim so an expired flow is terminalized at its FIRST
--     post-expiry traffic regardless of which endpoint that is (codex round-03
--     [P2]: a flow whose only post-expiry hit is its callback was otherwise
--     never terminalized on the issue-only sweep). Terminalizes expired-but-
--     nonterminal rows (stamp terminal_at + NULL the PKCE ciphertext/key), then
--     retention-deletes terminal rows past 30 days. BOTH statements are bounded
--     (LIMIT + FOR UPDATE SKIP LOCKED) and driven by the partial indexes above,
--     so a public request never full-scans nor rewrites the global backlog in
--     one call (mirrors the 0016 _auth_email_delivery_cleanup shape). Internal,
--     NOT granted.
-- ---------------------------------------------------------------------------
CREATE FUNCTION _auth_oauth_transaction_sweep()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  WITH expired AS (
    SELECT state_hash FROM auth_oauth_transactions
    WHERE terminal_at IS NULL AND expires_at < now()
    ORDER BY expires_at
    LIMIT 1000
    FOR UPDATE SKIP LOCKED
  )
  UPDATE auth_oauth_transactions t
  SET terminal_at = now(), pkce_verifier_enc = NULL, kms_key_version = NULL
  FROM expired WHERE t.state_hash = expired.state_hash;

  WITH doomed AS (
    SELECT state_hash FROM auth_oauth_transactions
    WHERE terminal_at IS NOT NULL AND terminal_at < now() - interval '30 days'
    ORDER BY terminal_at
    LIMIT 1000
    FOR UPDATE SKIP LOCKED
  )
  DELETE FROM auth_oauth_transactions t USING doomed WHERE t.state_hash = doomed.state_hash;
END;
$$;
REVOKE ALL ON FUNCTION _auth_oauth_transaction_sweep() FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 2. auth_oauth_transaction_issue (B0 §4.1 issue) — persist one started flow.
--    The trusted-IP rate bucket runs at the app boundary BEFORE this is called
--    (§8.2: "check before insert/cookie"); this function only stores the row.
--    Runs the same expiry sweep shape as auth_login_state_issue (0012) so an
--    unauthenticated redirect storm cannot grow the table unbounded. The Google
--    lifecycle CHECK rejects a Google row missing nonce/verifier/key-version.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION auth_oauth_transaction_issue(
  p_state_hash text,
  p_provider text,
  p_browser_binding_hash text,
  p_nonce_hash text,
  p_pkce_verifier_enc bytea,
  p_kms_key_version text,
  p_ttl interval
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM _auth_oauth_transaction_sweep(); -- sweep-at-traffic (§4.1)
  INSERT INTO auth_oauth_transactions(
    state_hash, provider, browser_binding_hash, nonce_hash,
    pkce_verifier_enc, kms_key_version, expires_at
  ) VALUES (
    p_state_hash, p_provider, p_browser_binding_hash, p_nonce_hash,
    p_pkce_verifier_enc, p_kms_key_version, now() + p_ttl
  );
END;
$$;
REVOKE ALL ON FUNCTION auth_oauth_transaction_issue(text,text,text,text,bytea,text,interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_oauth_transaction_issue(text,text,text,text,bytea,text,interval) TO app;

-- ---------------------------------------------------------------------------
-- 3. auth_oauth_transaction_claim (B0 §4.1 callback) — single-use consume.
--    Matches EXACT state_hash + provider + browser_binding_hash + unexpired +
--    unconsumed, then terminalizes the row and NULLs the verifier ciphertext +
--    key-version in the SAME statement. Returns the nonce hash and the OLD
--    verifier ciphertext + key-version so the app can decrypt the verifier for
--    the token exchange (RETURNING would give the post-UPDATE NULLs, so the row
--    is captured FOR UPDATE first). Missing / provider-or-binding mismatch /
--    expired / already-consumed all return ZERO rows and mutate nothing (D1-3,
--    D1-4). Two concurrent claims of the same state serialize on the row lock;
--    the loser re-reads a consumed row, the `consumed_at IS NULL` predicate no
--    longer holds, and it gets zero rows.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION auth_oauth_transaction_claim(
  p_state_hash text,
  p_provider text,
  p_browser_binding_hash text
) RETURNS TABLE (nonce_hash text, pkce_verifier_enc bytea, kms_key_version text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_nonce    text;
  v_verifier bytea;
  v_kver     text;
BEGIN
  -- Sweep-at-traffic (§4.1): the callback is post-expiry traffic too, so
  -- terminalize expired flows here as well — a flow whose ONLY hit after expiry
  -- is its callback must not keep its PKCE ciphertext until a later state
  -- request (codex round-03 [P2]). Runs BEFORE the claim: an expired target is
  -- terminalized here, then the claim SELECT (expires_at > clock_timestamp())
  -- finds nothing and returns zero rows, unchanged.
  PERFORM _auth_oauth_transaction_sweep();

  -- The bounded global sweep above may not reach THIS flow's row under a >1000
  -- backlog, so terminalize the EXACT matching expired row directly — the
  -- callback is its first post-expiry traffic and must clean its own PKCE
  -- ciphertext regardless of backlog (codex round-05 [P2]). This is a single-row
  -- targeted UPDATE (not a scan), so it stays cheap.
  UPDATE auth_oauth_transactions
  SET terminal_at = now(), pkce_verifier_enc = NULL, kms_key_version = NULL
  WHERE state_hash = p_state_hash AND provider = p_provider
    AND browser_binding_hash = p_browser_binding_hash
    AND terminal_at IS NULL AND expires_at < now();

  -- Lock + capture the LIVE row. clock_timestamp() (not the frozen now()) so a
  -- row that crossed its expiry while we queued on the lock reads as expired.
  SELECT t.nonce_hash, t.pkce_verifier_enc, t.kms_key_version
    INTO v_nonce, v_verifier, v_kver
  FROM auth_oauth_transactions t
  WHERE t.state_hash = p_state_hash
    AND t.provider = p_provider
    AND t.browser_binding_hash = p_browser_binding_hash
    AND t.consumed_at IS NULL
    AND t.expires_at > clock_timestamp()
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN; -- missing/mismatch/expired/replayed: zero rows, zero mutation
  END IF;

  UPDATE auth_oauth_transactions
  SET consumed_at = transaction_timestamp(),
      terminal_at = transaction_timestamp(),
      pkce_verifier_enc = NULL,
      kms_key_version = NULL
  WHERE state_hash = p_state_hash AND consumed_at IS NULL;
  IF NOT FOUND THEN
    RETURN; -- lost the single-use race under the lock
  END IF;

  nonce_hash := v_nonce;
  pkce_verifier_enc := v_verifier;
  kms_key_version := v_kver;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION auth_oauth_transaction_claim(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_oauth_transaction_claim(text,text,text) TO app;

-- ---------------------------------------------------------------------------
-- 4. auth_login_google (B0 §4 collision table, 8 cells) — the per-lane Google
--    login finalizer. Called ONLY after the callback's full OIDC proof matrix
--    passes (signature/iss/aud/azp/exp/nonce AND email_verified === true); cell
--    8 (any proof failure) rejects at the app boundary BEFORE this runs and
--    writes NO audit row (§8.3 — deliberate: trusted-IP bucket + generic reject
--    + HTTP log already cover it).
--
--    Inputs are ALL hashed/derived at the app boundary (this function is
--    hash-agnostic, never sees a raw sub/email — mirrors auth_login_telegram):
--      p_subject_hash      keyed HMAC of the Google `sub` (account_identities
--                          .platform_user_hash for platform='google', SI-2).
--      p_email_lookup_hash account_emails.email_lookup_hash for the returned,
--                          proven-verified email.
--      p_email_enc / p_kms_key_version / p_account_email_id
--                          cell-1 ONLY: the app PREALLOCATES account_emails.id
--                          and binds the email ciphertext's AAD to it (v1.86),
--                          then passes that exact id here so the INSERT uses it
--                          (never re-encrypted with an id chosen inside the DB).
--      p_display_name      cell-1 ONLY: seed the new person's display name
--                          (DD-26 — never overwrite an existing person's name).
--      p_request_ref       opaque audit request ref (never a raw token).
--
--    Returns (account_id, person_id, outcome) where outcome is 'login_success'
--    (cells 1-6) or 'identity_conflict' (cell 7). The audit row is written in
--    the SAME transaction as the mutation/reject.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION auth_login_google(
  p_subject_hash text,
  p_email_lookup_hash text,
  p_email_enc bytea,
  p_kms_key_version text,
  p_account_email_id uuid,
  p_display_name text,
  p_request_ref text
) RETURNS TABLE (account_id uuid, person_id uuid, outcome text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_subject_account uuid;
  v_subject_person  uuid;
  v_email_id        uuid;
  v_email_account   uuid;
  v_email_verified  boolean;
  v_new_person      uuid;
  v_new_account     uuid;
  v_result_account  uuid;
  v_result_person   uuid;
  v_outcome         text;
BEGIN
  IF p_subject_hash IS NULL OR length(p_subject_hash) < 16 THEN
    RAISE EXCEPTION 'auth_login_google: invalid subject hash'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- (1) Read-only resolve BOTH owners (no lock). now() here is a candidate
  --     filter only; the mutation runs under the locks below.
  SELECT ai.account_id, a.person_id INTO v_subject_account, v_subject_person
  FROM account_identities ai
  JOIN accounts a ON a.id = ai.account_id
  WHERE ai.platform = 'google' AND ai.platform_user_hash = p_subject_hash;

  SELECT ae.id, ae.account_id, (ae.verified_at IS NOT NULL)
    INTO v_email_id, v_email_account, v_email_verified
  FROM account_emails ae
  WHERE ae.email_lookup_hash = p_email_lookup_hash;

  -- (2) Serialize concurrent logins on TWO domain-separated advisory locks
  --     (§5.2 step 3 "absent email -> advisory lock from email_lookup_hash"),
  --     always in this fixed order (email then subject) so no lock-order
  --     inversion / deadlock is possible; the two key spaces are disjoint
  --     (distinct string prefixes). hashtextextended keeps the full 64-bit key
  --     space (hashtext is 32-bit) to minimise cross-key collisions.
  --   * EMAIL lock: a cell-1 create and a cell-2/3 promote/attach for the SAME
  --     address never race — the loser re-resolves below and sees the winner.
  --   * SUBJECT lock (codex round-01 [P1]): two concurrent logins for the SAME
  --     Google subject but DIFFERENT returned emails take different email locks,
  --     so without this both could resolve the subject as absent and each
  --     attach it to a different account (the loser's ON CONFLICT identity
  --     insert no-ops, yet the function would still return that account with
  --     login_success — authenticating the subject into the WRONG account).
  --     Serializing on the subject makes the loser block here, re-resolve with
  --     the subject now PRESENT, and take the subject branch (login the correct
  --     account, or cell-7 identity_conflict) instead of a second attach.
  PERFORM pg_advisory_xact_lock(hashtextextended('auth-oauth-email:' || p_email_lookup_hash, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('auth-oauth-subject:' || p_subject_hash, 0));

  -- (3) Parent tier, parent-first: lock the involved existing accounts in
  --     ascending UUID order (§5.2 step 3), then the account_emails row. A
  --     cell-1 create has neither yet — the advisory lock above is its
  --     serialization point. DISTINCT collapses a same-account subject+email.
  PERFORM 1 FROM accounts
  WHERE id IN (v_subject_account, v_email_account) AND id IS NOT NULL
  ORDER BY id
  FOR UPDATE;
  IF v_email_id IS NOT NULL THEN
    PERFORM 1 FROM account_emails WHERE id = v_email_id FOR UPDATE;
  END IF;

  -- (4) Re-resolve under the locks (§5.2 step 6): the advisory + row locks make
  --     a concurrent creator's commit visible now.
  SELECT ai.account_id, a.person_id INTO v_subject_account, v_subject_person
  FROM account_identities ai
  JOIN accounts a ON a.id = ai.account_id
  WHERE ai.platform = 'google' AND ai.platform_user_hash = p_subject_hash;

  SELECT ae.id, ae.account_id, (ae.verified_at IS NOT NULL)
    INTO v_email_id, v_email_account, v_email_verified
  FROM account_emails ae
  WHERE ae.email_lookup_hash = p_email_lookup_hash;

  -- (5) Apply the collision cell.
  IF v_subject_account IS NOT NULL THEN
    -- Subject already exists — the stable identity owner (cells 4/5/6/7). A
    -- Google email change never rebinds the account (email-change is a separate
    -- re-auth+verify workflow, out of D1 scope), so the returned email only
    -- MATTERS for the cell-7 conflict check.
    IF v_email_id IS NOT NULL AND v_email_verified
       AND v_email_account IS DISTINCT FROM v_subject_account THEN
      -- Cell 7: the proven-verified email belongs to a DIFFERENT account.
      -- Fail closed — no auto-merge, no session (→ DD-53).
      v_result_account := v_subject_account;
      v_result_person  := v_subject_person;
      v_outcome        := 'identity_conflict';
    ELSE
      -- Cells 4 (email @ A), 5 (email absent), 6 (email pending @ B): log in
      -- account A by its stable subject; mutate NOTHING (never create/promote a
      -- contact, never touch B's pending attempts/tokens).
      v_result_account := v_subject_account;
      v_result_person  := v_subject_person;
      v_outcome        := 'login_success';
    END IF;
  ELSE
    -- Subject absent (cells 1/2/3).
    IF v_email_id IS NULL THEN
      -- Cell 1 (new/new): create Person + Account + verified account_emails
      -- (using the app-preallocated id so the ciphertext AAD stays valid) +
      -- Google identity, atomically.
      INSERT INTO persons(display_name) VALUES (NULLIF(trim(p_display_name), ''))
        RETURNING id INTO v_new_person;
      INSERT INTO accounts(person_id) VALUES (v_new_person) RETURNING id INTO v_new_account;
      INSERT INTO account_emails(id, account_id, email_lookup_hash, email_enc, kms_key_version, verified_at)
        VALUES (p_account_email_id, v_new_account, p_email_lookup_hash, p_email_enc, p_kms_key_version, now());
      INSERT INTO account_identities(account_id, platform, platform_user_hash, verified_at)
        VALUES (v_new_account, 'google', p_subject_hash, now());
      v_result_account := v_new_account;
      v_result_person  := v_new_person;
      v_outcome        := 'login_success';
    ELSIF v_email_verified THEN
      -- Cell 2: the verified email belongs to account A — DD-50 strong proof.
      -- Attach the Google identity to A; create no second account. ON CONFLICT
      -- keeps a re-login idempotent under the advisory-lock serialization.
      INSERT INTO account_identities(account_id, platform, platform_user_hash, verified_at)
        VALUES (v_email_account, 'google', p_subject_hash, now())
        ON CONFLICT (platform, platform_user_hash) DO NOTHING;
      -- alias `accounts`: the column `person_id` would otherwise be ambiguous
      -- with this function's OUT parameter of the same name.
      SELECT a.person_id INTO v_result_person FROM accounts a WHERE a.id = v_email_account;
      v_result_account := v_email_account;
      v_outcome        := 'login_success';
    ELSE
      -- Cell 3: the email is PENDING on account A. Promote it (a verified Google
      -- email is DD-50 strong proof), supersede ALL of A's pending attempts and
      -- their verify tokens, NULL the password/registration-key candidates and
      -- COPY NONE (a pre-registration hijack must not silently install its
      -- password), then attach the Google identity.
      UPDATE account_emails
      SET verified_at = now(), pending_expires_at = NULL, updated_at = now()
      WHERE id = v_email_id;

      UPDATE auth_pending_email_registrations
      SET superseded_at = transaction_timestamp(), password_phc = NULL, registration_key_hash = NULL
      WHERE account_email_id = v_email_id
        AND consumed_at IS NULL AND superseded_at IS NULL;

      UPDATE auth_email_tokens
      SET superseded_at = transaction_timestamp()
      WHERE account_email_id = v_email_id
        AND purpose = 'verify_email'
        AND consumed_at IS NULL AND superseded_at IS NULL;

      INSERT INTO account_identities(account_id, platform, platform_user_hash, verified_at)
        VALUES (v_email_account, 'google', p_subject_hash, now())
        ON CONFLICT (platform, platform_user_hash) DO NOTHING;
      -- alias `accounts`: the column `person_id` would otherwise be ambiguous
      -- with this function's OUT parameter of the same name.
      SELECT a.person_id INTO v_result_person FROM accounts a WHERE a.id = v_email_account;
      v_result_account := v_email_account;
      v_outcome        := 'login_success';
    END IF;
  END IF;

  -- (6) Per-lane audit (§8.3 v1.85), SAME transaction as the cell above. Cells
  --     1-6 write login_success, cell 7 writes identity_conflict. session_epoch
  --     / link_codes_revoked / merge_artifacts_cancelled stay NULL (no session
  --     revoke, no link-code work on this lane).
  INSERT INTO auth_audit_events(
    event_type, account_id, outcome_class, actor_class, request_ref
  ) VALUES (
    v_outcome, v_result_account,
    CASE WHEN v_outcome = 'identity_conflict' THEN 'conflict' ELSE 'success' END,
    'google', p_request_ref
  );

  account_id := v_result_account;
  person_id  := v_result_person;
  outcome    := v_outcome;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION auth_login_google(text,text,bytea,text,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_login_google(text,text,bytea,text,uuid,text,text) TO app;
