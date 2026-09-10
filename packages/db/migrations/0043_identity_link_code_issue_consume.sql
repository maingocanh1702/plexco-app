-- ============================================================================
-- 0043_identity_link_code_issue_consume.sql
-- Identity link_code issue / consume — the DD-50 "khoá mạnh" runtime the
-- Reviewed spec pins in feature_identity_tech.md §4 ("Verified-proof +
-- link_code service", "Transactional consume algorithm"). Backlog row
-- identity-link-code-issue-consume (audit 2026-09-06 §4 gap #7); the schema
-- half (D-9) landed in 0039, this is the runtime half. Merge itself is NOT
-- here — see the scope fence at the end of this header.
--
-- WHY SECURITY DEFINER: link_codes / persons / channel_identities / accounts
-- are global-protected (0009: zero table grants to app). These three
-- functions are the only doorway (0012/0034 shape: fixed search_path,
-- REVOKE FROM PUBLIC, EXECUTE to `app` only). app_worker / readonly cannot
-- call them.
--
-- WHAT CROSSES THE BOUNDARY — hashes only, like every 0012/0016 token path:
--   code_lookup_hash  keyed (HMAC) deterministic hash of the code's LOOKUP
--                     COMPONENT (its first 8 symbols), UNIQUE, used for the
--                     indexed lookup (0001 column);
--   code_hash         salted SLOW hash (scrypt in @plexco/db identity.ts) of
--                     the WHOLE code with the row's `salt`; the verifier.
-- The plaintext code is generated app-side, returned to the issuer ONCE and
-- never sent to SQL — in either direction.
--
-- THE SPLIT IS LOAD-BEARING, not cosmetic (spec §4 step 1: "resolves the
-- OPAQUE LOOKUP COMPONENT"). Deriving both hashes from the whole code makes
-- the two indistinguishable as evidence: any input that reproduces a row's
-- lookup hash necessarily reproduces its verifier, so `wrong_code` can never
-- happen, and with it failed_attempts, locked_until and the
-- `failed_attempts >= max_attempts` terminal check are dead code — 0039's
-- three DD-50 lifecycle columns would be decoration and NOTHING would bound
-- guessing at this layer. Splitting the code (8 symbols locate the row, all
-- 18 verify it) is what makes a wrong guess against a REAL row observable and
-- therefore countable. The verifier deliberately covers the whole code, not
-- just the secret tail, so it also binds the row it was issued for. The consumer flow is therefore
-- two calls: link_code_salt() (read-only, returns the candidate's salt so the
-- app can compute the slow hash; a missing candidate returns NULL and the app
-- hashes against a dummy salt so timing is uniform) then link_code_consume()
-- which does everything else in ONE transaction. The DB, not the app, decides
-- verifier equality, attempt accounting and the single-use claim, so an app
-- bug cannot "consume" without the right hash.
--
-- ISSUER / TARGET are both the DD-50 XOR shape: exactly one of
-- (channel_identity_id, account_id). source_person_id is DERIVED server-side
-- from that parent (never accepted from the caller — spec §4 bullet 1) and
-- re-derived under lock at consume time (spec step 2/3). 'telegram' channel
-- identities are refused on both sides (DD-37; 0042 already blocks new ones).
--
-- LOCK ORDER (spec §4 step 2 · 0034 header · the D1E-18 barrier test in
-- auth.test.ts): read-only candidate resolution FIRST (no lock held while
-- discovering what to lock), then tiers in the one canonical global order
--     accounts  →  persons  →  channel_identities  →  link_codes row
-- UUID-sorted within a tier, ONE row at a time (a `WHERE id = ANY(...)`
-- FOR UPDATE does not promise fetch order). Account-issued codes therefore
-- descend accounts→persons; channel-issued persons→channel_identities; the
-- consumer's own parents join the same tiers. The email-token consumer (0016)
-- and the DD-32 resolver core (0034) take the same tiers in the same order,
-- so none of these can deadlock against each other; every re-check under lock
-- fails closed on drift.
--
-- TERMINAL CHECKS BEFORE ACCOUNTING (spec step 3): consumed / revoked /
-- expired / locked / attempts-exhausted are decided under the row lock and
-- return generic `invalid` WITHOUT touching the row. Only a live row with a
-- wrong verifier increments failed_attempts (step 4) — one conditional
-- UPDATE whose WHERE repeats every liveness predicate; only a live row with
-- the right verifier is claimed (step 5) — one conditional UPDATE, exactly
-- one row required. clock_timestamp(), not transaction_timestamp(), is the
-- clock for every expiry/lock predicate (0015/0016 precedent: a code that
-- crossed its expiry while queued on a parent lock must read as expired) —
-- strictly stronger than the spec's transaction_timestamp() wording.
--
-- DEFAULTS pinned here (parameters, so a caller can only TIGHTEN them):
--   TTL 10 minutes (spec), hard cap 1 hour; max_attempts 5 (0039 default,
--   CHECK 1..20); per-wrong-attempt cooldown 5 seconds via locked_until
--   (spec "reaching the cap applies cooldown/lock policy" — the cap itself is
--   terminal through failed_attempts < max_attempts, the cooldown throttles
--   the attempts before it). Issuing supersedes the issuer-person's earlier
--   live codes (revoked_at): one live code per person, so a leaked earlier
--   code is dead the moment a new one exists. Outbound rate limits (per
--   issuer / per target, spec §4 bullet 4) stay in the app on
--   rate_limit_check(), the same as every 0012 caller.
--
-- SCOPE FENCE — what this migration deliberately does NOT do:
--   * no merge plan table and no merge: spec step 5 "creates the merge plan
--     in the same transaction" has no live schema to write to (merge_audit /
--     merge_tombstones have no writer — 0034 header, DD-01/§P6). consume
--     RETURNS the verified, redacted merge intent
--     {link_code_id, source_person_id, target_person_id, issuer_kind} and the
--     merge lane (chat-identity-merge-reparent-enablement) is the one to add
--     plan persistence — by CREATE OR REPLACE of link_code_consume in a later
--     migration, never by giving app a table.
--   * no endpoint-scope validation (DD-65..68 columns do not exist on live
--     channel_identities — 0034's deferral); the channel adapter that resolves
--     a channel_identity_id is where that check lives when it lands.
--   * no notifications, no HTTP/bot surface: the §7 endpoints are a web/bot
--     lane. Nothing here reads env or config.
-- ============================================================================

-- Supersede-on-issue and "live codes for person" reads without a seq scan.
CREATE INDEX idx_link_codes_source_person_live ON link_codes(source_person_id)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- link_code_issue — bind ONE authenticated issuer, derive its Person, store
-- the hashes, supersede the person's earlier live codes. Returns the new
-- row's id / derived person / expiry / how many earlier codes were revoked.
-- Errors on the ISSUER are specific (the caller IS the issuer — nothing to
-- enumerate): invalid_parameter_value for malformed input,
-- insufficient_privilege for an issuer that is not an active, non-telegram
-- identity on an active Person.
-- ---------------------------------------------------------------------------
CREATE FUNCTION link_code_issue(
  p_source_channel_identity_id uuid,
  p_source_account_id          uuid,
  p_code_lookup_hash           text,
  p_code_hash                  bytea,
  p_salt                       bytea,
  p_ttl                        interval DEFAULT interval '10 minutes',
  p_max_attempts               integer  DEFAULT 5
)
RETURNS TABLE (link_code_id uuid, source_person_id uuid, expires_at timestamptz, superseded integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_person   uuid;
  v_relock   uuid;
  v_count    integer;
BEGIN
  -- ---- input contract -----------------------------------------------------
  IF num_nonnulls(p_source_channel_identity_id, p_source_account_id) <> 1 THEN
    RAISE EXCEPTION 'link_code_issue: exactly one of channel identity / account must be given'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_code_lookup_hash IS NULL OR char_length(p_code_lookup_hash) NOT BETWEEN 32 AND 128 THEN
    RAISE EXCEPTION 'link_code_issue: p_code_lookup_hash must be a 32..128 char hash'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_code_hash IS NULL OR octet_length(p_code_hash) < 16
     OR p_salt IS NULL OR octet_length(p_salt) < 16 THEN
    RAISE EXCEPTION 'link_code_issue: p_code_hash and p_salt must be at least 16 bytes'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_ttl IS NULL OR p_ttl <= interval '0' OR p_ttl > interval '1 hour' THEN
    RAISE EXCEPTION 'link_code_issue: p_ttl must be within (0, 1 hour]'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_max_attempts IS NULL OR p_max_attempts NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'link_code_issue: p_max_attempts must be 1..20'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- ---- (1) read-only: derive the issuer's current Person --------------------
  IF p_source_account_id IS NOT NULL THEN
    SELECT a.person_id INTO v_person
      FROM accounts a JOIN persons p ON p.id = a.person_id
     WHERE a.id = p_source_account_id AND p.status = 'active';
  ELSE
    SELECT ci.person_id INTO v_person
      FROM channel_identities ci JOIN persons p ON p.id = ci.person_id
     WHERE ci.id = p_source_channel_identity_id
       AND ci.status = 'active' AND ci.platform <> 'telegram'
       AND p.status = 'active';
  END IF;
  IF v_person IS NULL THEN
    RAISE EXCEPTION 'link_code_issue: issuer is not an active identity on an active person'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ---- (2) locks, canonical order: accounts → persons → channel_identities --
  IF p_source_account_id IS NOT NULL THEN
    PERFORM 1 FROM accounts WHERE id = p_source_account_id FOR UPDATE;
  END IF;
  PERFORM 1 FROM persons WHERE id = v_person FOR UPDATE;
  IF p_source_channel_identity_id IS NOT NULL THEN
    PERFORM 1 FROM channel_identities WHERE id = p_source_channel_identity_id FOR UPDATE;
  END IF;

  -- ---- (3) re-derive under lock; drift → refuse, nothing written -----------
  IF p_source_account_id IS NOT NULL THEN
    SELECT a.person_id INTO v_relock
      FROM accounts a JOIN persons p ON p.id = a.person_id
     WHERE a.id = p_source_account_id AND p.status = 'active';
  ELSE
    SELECT ci.person_id INTO v_relock
      FROM channel_identities ci JOIN persons p ON p.id = ci.person_id
     WHERE ci.id = p_source_channel_identity_id
       AND ci.status = 'active' AND ci.platform <> 'telegram'
       AND p.status = 'active';
  END IF;
  IF v_relock IS NULL OR v_relock <> v_person THEN
    RAISE EXCEPTION 'link_code_issue: issuer binding changed while locking'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ---- (4) supersede earlier live codes of this person (one live code) -----
  UPDATE link_codes lc
     SET revoked_at = clock_timestamp()
   WHERE lc.source_person_id = v_person
     AND lc.consumed_at IS NULL
     AND lc.revoked_at IS NULL
     AND lc.expires_at > clock_timestamp();
  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- ---- (5) insert -----------------------------------------------------------
  INSERT INTO link_codes AS lc_ret
         (source_person_id, source_channel_identity_id, source_account_id,
          code_lookup_hash, code_hash, salt, action, expires_at, max_attempts)
  VALUES (v_person, p_source_channel_identity_id, p_source_account_id,
          p_code_lookup_hash, p_code_hash, p_salt, 'merge_identity',
          clock_timestamp() + p_ttl, p_max_attempts)
  RETURNING lc_ret.id, lc_ret.source_person_id, lc_ret.expires_at
       INTO link_code_id, source_person_id, expires_at;
  superseded := v_count;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION link_code_issue(uuid, uuid, text, bytea, bytea, interval, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION link_code_issue(uuid, uuid, text, bytea, bytea, interval, integer) TO app;

-- ---------------------------------------------------------------------------
-- link_code_salt — read-only step 1 of consume: the candidate's salt (so the
-- app can compute the slow hash) or NULL. Confers no authority, holds no
-- lock, ignores lifecycle (a terminal row's salt is not a secret; the
-- lifecycle verdict is consume's, under lock).
-- ---------------------------------------------------------------------------
CREATE FUNCTION link_code_salt(p_code_lookup_hash text)
RETURNS bytea
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT lc.salt FROM link_codes lc
   WHERE lc.code_lookup_hash = p_code_lookup_hash AND lc.action = 'merge_identity';
$$;
REVOKE ALL ON FUNCTION link_code_salt(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION link_code_salt(text) TO app;

-- ---------------------------------------------------------------------------
-- link_code_consume — spec §4 steps 1–5 in one transaction. ALWAYS returns
-- exactly one row:
--   outcome 'consumed'    right verifier, code claimed, source ≠ target person
--                          → the merge intent for the (future) merge lane;
--   outcome 'same_person' right verifier, code claimed, but the target already
--                          IS the issuer's Person (nothing to merge);
--   outcome 'wrong_code'  live row, wrong verifier: failed_attempts+1 and a
--                          cooldown written; counters returned so the app can
--                          map the cap to LINK_CODE_RATE_LIMITED;
--   outcome 'invalid'     everything else — no candidate, terminal row, issuer
--                          drift, XOR violation — every ref NULL, zero mutation.
-- The TARGET is the authenticated caller (channel XOR account); an ineligible
-- target raises (insufficient_privilege) before the code is touched — it
-- reveals nothing about the code. The app maps outcomes to the §7 generic
-- LINK_CODE_INVALID / LINK_CODE_RATE_LIMITED; it never forwards these words.
-- ---------------------------------------------------------------------------
CREATE FUNCTION link_code_consume(
  p_code_lookup_hash           text,
  p_code_verifier              bytea,
  p_target_channel_identity_id uuid,
  p_target_account_id          uuid,
  p_cooldown                   interval DEFAULT interval '5 seconds'
)
RETURNS TABLE (outcome text, link_code_id uuid, source_person_id uuid, target_person_id uuid,
               issuer_kind text, failed_attempts integer, max_attempts integer,
               locked_until timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- candidate (step 1, read-only)
  v_id          uuid;
  v_src_person  uuid;
  v_src_ci      uuid;
  v_src_account uuid;
  v_tgt_person  uuid;
  -- lock plan
  v_accounts    uuid[];
  v_persons     uuid[];
  v_cis         uuid[];
  v_lock        uuid;
  -- under lock (step 3)
  r             link_codes%ROWTYPE;
  v_re_src      uuid;
  v_re_tgt      uuid;
  v_now         timestamptz;
  v_nonce       bytea;
BEGIN
  -- ---- input contract -----------------------------------------------------
  IF num_nonnulls(p_target_channel_identity_id, p_target_account_id) <> 1 THEN
    RAISE EXCEPTION 'link_code_consume: exactly one of target channel identity / account must be given'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_code_verifier IS NULL OR octet_length(p_code_verifier) < 16 THEN
    RAISE EXCEPTION 'link_code_consume: p_code_verifier must be at least 16 bytes'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_cooldown IS NULL OR p_cooldown < interval '0' OR p_cooldown > interval '1 hour' THEN
    RAISE EXCEPTION 'link_code_consume: p_cooldown must be within [0, 1 hour]'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- ---- target: the authenticated caller; ineligible → raise, code untouched
  IF p_target_account_id IS NOT NULL THEN
    SELECT a.person_id INTO v_tgt_person
      FROM accounts a JOIN persons p ON p.id = a.person_id
     WHERE a.id = p_target_account_id AND p.status = 'active';
  ELSE
    SELECT ci.person_id INTO v_tgt_person
      FROM channel_identities ci JOIN persons p ON p.id = ci.person_id
     WHERE ci.id = p_target_channel_identity_id
       AND ci.status = 'active' AND ci.platform <> 'telegram'
       AND p.status = 'active';
  END IF;
  IF v_tgt_person IS NULL THEN
    RAISE EXCEPTION 'link_code_consume: target is not an active identity on an active person'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ---- (1) read-only candidate: lookup → {code id, issuer kind/id, person}
  --      No lifecycle filter here on purpose: a terminal row must still be
  --      LOCKED before it is judged, or step 3 could race a concurrent claim.
  SELECT lc.id, lc.source_person_id, lc.source_channel_identity_id, lc.source_account_id
    INTO v_id, v_src_person, v_src_ci, v_src_account
    FROM link_codes lc
   WHERE lc.code_lookup_hash = p_code_lookup_hash
     AND lc.action = 'merge_identity';
  IF v_id IS NULL OR num_nonnulls(v_src_ci, v_src_account) <> 1 THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::uuid, NULL::uuid, NULL::uuid, NULL::text,
                        NULL::integer, NULL::integer, NULL::timestamptz;
    RETURN;
  END IF;

  -- ---- (2) locks: accounts → persons → channel_identities → the code row,
  --      UUID-sorted within a tier, one row per statement.
  v_accounts := ARRAY(SELECT DISTINCT x FROM unnest(ARRAY[v_src_account, p_target_account_id]) AS x
                       WHERE x IS NOT NULL ORDER BY x);
  v_persons  := ARRAY(SELECT DISTINCT x FROM unnest(ARRAY[v_src_person, v_tgt_person]) AS x
                       WHERE x IS NOT NULL ORDER BY x);
  v_cis      := ARRAY(SELECT DISTINCT x FROM unnest(ARRAY[v_src_ci, p_target_channel_identity_id]) AS x
                       WHERE x IS NOT NULL ORDER BY x);
  FOREACH v_lock IN ARRAY v_accounts LOOP
    PERFORM 1 FROM accounts WHERE id = v_lock FOR UPDATE;
  END LOOP;
  FOREACH v_lock IN ARRAY v_persons LOOP
    PERFORM 1 FROM persons WHERE id = v_lock FOR UPDATE;
  END LOOP;
  FOREACH v_lock IN ARRAY v_cis LOOP
    PERFORM 1 FROM channel_identities WHERE id = v_lock FOR UPDATE;
  END LOOP;
  SELECT * INTO r FROM link_codes lc WHERE lc.id = v_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::uuid, NULL::uuid, NULL::uuid, NULL::text,
                        NULL::integer, NULL::integer, NULL::timestamptz;
    RETURN;
  END IF;

  -- ---- (3) re-derive under lock: issuer binding, target binding, row shape,
  --      then the terminal checks. Any miss → generic invalid, zero mutation.
  IF r.source_account_id IS NOT NULL THEN
    SELECT a.person_id INTO v_re_src
      FROM accounts a JOIN persons p ON p.id = a.person_id
     WHERE a.id = r.source_account_id AND p.status = 'active';
  ELSIF r.source_channel_identity_id IS NOT NULL THEN
    SELECT ci.person_id INTO v_re_src
      FROM channel_identities ci JOIN persons p ON p.id = ci.person_id
     WHERE ci.id = r.source_channel_identity_id
       AND ci.status = 'active' AND ci.platform <> 'telegram'
       AND p.status = 'active';
  END IF;
  IF p_target_account_id IS NOT NULL THEN
    SELECT a.person_id INTO v_re_tgt
      FROM accounts a JOIN persons p ON p.id = a.person_id
     WHERE a.id = p_target_account_id AND p.status = 'active';
  ELSE
    SELECT ci.person_id INTO v_re_tgt
      FROM channel_identities ci JOIN persons p ON p.id = ci.person_id
     WHERE ci.id = p_target_channel_identity_id
       AND ci.status = 'active' AND ci.platform <> 'telegram'
       AND p.status = 'active';
  END IF;
  v_now := clock_timestamp();
  IF r.code_lookup_hash IS DISTINCT FROM p_code_lookup_hash
     OR r.action <> 'merge_identity'
     OR num_nonnulls(r.source_channel_identity_id, r.source_account_id) <> 1
     OR r.source_channel_identity_id IS DISTINCT FROM v_src_ci
     OR r.source_account_id IS DISTINCT FROM v_src_account
     OR r.source_person_id IS DISTINCT FROM v_src_person
     OR v_re_src IS NULL OR v_re_src <> r.source_person_id           -- issuer drift / merged
     OR v_re_tgt IS NULL OR v_re_tgt <> v_tgt_person                 -- target drift / merged
     OR r.consumed_at IS NOT NULL
     OR r.revoked_at IS NOT NULL
     OR r.expires_at <= v_now
     OR r.failed_attempts >= r.max_attempts
     OR (r.locked_until IS NOT NULL AND r.locked_until > v_now) THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::uuid, NULL::uuid, NULL::uuid, NULL::text,
                        NULL::integer, NULL::integer, NULL::timestamptz;
    RETURN;
  END IF;

  -- ---- (4) wrong verifier: ONE conditional accounting update ---------------
  -- Constant-time comparison (spec §4 step 4). Postgres compares bytea with a
  -- short-circuiting memcmp, so `r.code_hash <> p_code_verifier` leaks the
  -- length of the matching prefix through timing. Digesting both sides under a
  -- fresh per-call nonce first removes the signal: the attacker cannot predict
  -- either digest, so where those bytes diverge tells them nothing about the
  -- verifier. (pgcrypto lives in `public`, which is on this definer's pinned
  -- search_path.)
  v_nonce := gen_random_bytes(16);
  IF digest(v_nonce || r.code_hash, 'sha256') <> digest(v_nonce || p_code_verifier, 'sha256') THEN
    UPDATE link_codes lc
       SET failed_attempts = lc.failed_attempts + 1,
           locked_until    = clock_timestamp() + p_cooldown
     WHERE lc.id = r.id
       AND lc.consumed_at IS NULL
       AND lc.revoked_at IS NULL
       AND lc.expires_at > clock_timestamp()
       AND lc.failed_attempts < lc.max_attempts
       AND (lc.locked_until IS NULL OR lc.locked_until <= clock_timestamp())
    RETURNING lc.failed_attempts, lc.max_attempts, lc.locked_until
         INTO failed_attempts, max_attempts, locked_until;
    IF NOT FOUND THEN
      RETURN QUERY SELECT 'invalid'::text, NULL::uuid, NULL::uuid, NULL::uuid, NULL::text,
                          NULL::integer, NULL::integer, NULL::timestamptz;
      RETURN;
    END IF;
    outcome := 'wrong_code';
    link_code_id := NULL; source_person_id := NULL; target_person_id := NULL; issuer_kind := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  -- ---- (5) right verifier: ONE conditional claim, exactly one row ---------
  UPDATE link_codes lc
     SET consumed_at = clock_timestamp()
   WHERE lc.id = r.id
     AND lc.consumed_at IS NULL
     AND lc.revoked_at IS NULL
     AND lc.expires_at > clock_timestamp()
     AND lc.failed_attempts < lc.max_attempts
     AND (lc.locked_until IS NULL OR lc.locked_until <= clock_timestamp())
  RETURNING lc.id, lc.source_person_id, lc.failed_attempts, lc.max_attempts, lc.locked_until
       INTO link_code_id, source_person_id, failed_attempts, max_attempts, locked_until;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::uuid, NULL::uuid, NULL::uuid, NULL::text,
                        NULL::integer, NULL::integer, NULL::timestamptz;
    RETURN;
  END IF;
  target_person_id := v_tgt_person;
  issuer_kind := CASE WHEN r.source_account_id IS NOT NULL THEN 'account' ELSE 'channel' END;
  outcome := CASE WHEN source_person_id = v_tgt_person THEN 'same_person' ELSE 'consumed' END;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION link_code_consume(text, bytea, uuid, uuid, interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION link_code_consume(text, bytea, uuid, uuid, interval) TO app;

-- ---------------------------------------------------------------------------
-- _link_code_retention — terminal rows do not need to live forever. 0016 ships
-- a 30-day sweep for every table in the email-token family and DD-80 pins that
-- number; link_codes had none, so consumed/revoked/expired rows (and their
-- UNIQUE lookup-hash index entries, which is what would eventually collide on
-- issue) accumulated with no runtime role able to clean them.
-- INTERNAL: no GRANT, exactly like 0016's retention definers — the scheduled
-- caller belongs to the job lane that will own this sweep, not to this slice.
-- Bounded by p_batch_limit so an outage backlog cannot rewrite the table in one
-- transaction (0016's `_auth_email_delivery_cleanup` shape); the caller repeats
-- until it returns 0. Live codes are never touched.
-- ---------------------------------------------------------------------------
CREATE FUNCTION _link_code_retention(
  p_older_than interval DEFAULT interval '30 days',
  p_batch_limit integer DEFAULT 1000
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted integer;
BEGIN
  IF p_older_than IS NULL OR p_older_than <= interval '0'
     OR p_batch_limit IS NULL OR p_batch_limit < 1 THEN
    RAISE EXCEPTION '_link_code_retention: p_older_than must be positive and p_batch_limit >= 1'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  WITH doomed AS (
    SELECT lc.id FROM link_codes lc
     WHERE lc.created_at < clock_timestamp() - p_older_than
       AND (lc.consumed_at IS NOT NULL
            OR lc.revoked_at IS NOT NULL
            OR lc.expires_at < clock_timestamp())
     ORDER BY lc.created_at
     LIMIT p_batch_limit
     FOR UPDATE SKIP LOCKED
  )
  DELETE FROM link_codes lc USING doomed d WHERE lc.id = d.id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;
REVOKE ALL ON FUNCTION _link_code_retention(interval, integer) FROM PUBLIC;
-- Deliberately no GRANT (0016 precedent): owner/definer-callable only until a
-- scheduled job lane owns it.
