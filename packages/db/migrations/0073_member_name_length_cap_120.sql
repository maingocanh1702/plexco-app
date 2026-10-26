-- ============================================================================
-- 0073_member_name_length_cap_120.sql
-- L42 p4-name-rules-db (Phase 4). Authority: the owner's written approval of 2026-10-26 of the
-- Phase 4 plan, answer Q4: (b) the maximum display-name length is 120, with the user-visible effect
-- that the host can enter a name of 101 to 120 characters at the roster; (c) no CHECK constraint on
-- persons.display_name.
--
-- WHAT: two functions are re-created from their 0072 definitions, each block copied byte for byte
-- from its 0072 CREATE with the named literal edits below and no other (the generator proves each
-- block equal to its 0072 block once those edits are reverted):
--   (1) create_host_added_person: the length cap goes from 100 to 120 characters, and its message
--       from 1..100 to 1..120; nothing else.
--   (2) auth_login_google: the new-person insert truncates the rule's result to 120 code points with
--       pg_catalog.left, exactly as zalo_identity_resolve does (0072). It never raises on the name:
--       a hostile external name is normalized, never refused. A NULL rule result (a name made only
--       of hidden characters) stays NULL, since pg_catalog.left(NULL, 120) is NULL.
--
-- WHY (THREAT MODEL): this file defends against
--   (1) a re-creation that silently drops or changes an attribute of an identity writer (owner,
--       SECURITY DEFINER, search_path, volatility, ACL): every line before each body is copied
--       unchanged, CREATE OR REPLACE keeps the owner and the ACL, and the owner check runs first;
--   (2) body drift between this file, the byte pins and the live catalog;
--   (3) a writer accepting a length another layer refuses (the roster TS cap moves to 120 in the
--       same lane);
--   (4) the external-name path raising instead of normalizing;
--   (5) an unbounded stored external name.
-- Not defended: homoglyphs and confusables; stored production values nobody here can measure.
--
-- NOT CHANGED: every other byte of both bodies (each block is its 0072 block except the named
-- literals, proved by the generator); the owner and the ACL (CREATE OR REPLACE keeps both; no GRANT,
-- REVOKE, OWNER, COMMENT, table, role or column change in this file); the rule
-- member_name_apply_rule, the strip helper public_name_strip_invisible and every other definer; the
-- 120 caps of person_profile_update, tenant_profile_update and zalo_identity_resolve; no CHECK
-- constraint. The block between the two L42 owner-check marker lines raises 42501 unless both
-- functions have the owner of public.public_name_strip_invisible(text); it only reads the catalog.
--
-- ROLLBACK: a forward migration that restates the 0072 bodies of the two functions.
-- ============================================================================

-- Read-only owner check, before either function is re-created: the helper and the rule are owner-only
-- and the definers call them as their owner, so the two re-created here must have the helper's owner.
-- L42-OWNER-CHECK-BEGIN
DO $l42_owner_check$
DECLARE
  v_helper_owner oid;
  v_mismatch text;
BEGIN
  SELECT p.proowner INTO STRICT v_helper_owner
    FROM pg_catalog.pg_proc p
   WHERE p.oid = 'public.public_name_strip_invisible(text)'::pg_catalog.regprocedure;

  SELECT pg_catalog.string_agg(
           pg_catalog.format('%s (owner %s)', f.fn::text, pg_catalog.pg_get_userbyid(p.proowner)),
           ', ' ORDER BY f.fn::text)
    INTO v_mismatch
    FROM pg_catalog.unnest(ARRAY[
           'public.create_host_added_person(uuid, uuid, text)',
           'public.auth_login_google(text, text, bytea, text, uuid, text, text)'
         ]::pg_catalog.regprocedure[]) AS f(fn)
    JOIN pg_catalog.pg_proc p ON p.oid = f.fn
   WHERE p.proowner <> v_helper_owner;

  IF v_mismatch IS NOT NULL THEN
    RAISE EXCEPTION '0073: not owned by %, the owner of public.public_name_strip_invisible(text): %',
      pg_catalog.pg_get_userbyid(v_helper_owner), v_mismatch
      USING ERRCODE = '42501';
  END IF;
END
$l42_owner_check$;
-- L42-OWNER-CHECK-END

-- 1/2 create_host_added_person, newest definition 0072:205-250: 2 literal edits (the length cap 100 -> 120 and its message).
CREATE OR REPLACE FUNCTION create_host_added_person(
  p_tenant_id uuid,
  p_actor_person_id uuid,
  p_display_name text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_ctx uuid;
  v_name text;
  v_id uuid;
BEGIN
  BEGIN
    v_ctx := NULLIF(pg_catalog.current_setting('app.tenant_id', true), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_ctx := NULL;
  END;
  IF p_tenant_id IS NULL OR v_ctx IS NULL OR p_tenant_id <> v_ctx THEN
    RAISE EXCEPTION 'create_host_added_person: tenant context mismatch'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_actor_person_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.tenant_admins ta
     WHERE ta.tenant_id = p_tenant_id
       AND ta.platform = 'web'
       AND ta.platform_user_lookup_hash = p_actor_person_id::text
       AND ta.active
  ) THEN
    RAISE EXCEPTION 'create_host_added_person: actor is not an active tenant admin'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_name := public.member_name_apply_rule(p_display_name, false);
  IF v_name IS NULL OR pg_catalog.char_length(v_name) < 1 OR pg_catalog.char_length(v_name) > 120 THEN
    RAISE EXCEPTION 'create_host_added_person: display name must be 1..120 characters'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  INSERT INTO public.persons (display_name) VALUES (v_name) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- 2/2 auth_login_google, newest definition 0072:488-672: 1 literal edit (the new-person insert truncated to 120 code points with pg_catalog.left).
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
  IF p_subject_hash IS NULL OR pg_catalog.length(p_subject_hash) < 16 THEN
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
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('auth-oauth-email:' || p_email_lookup_hash, 0));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('auth-oauth-subject:' || p_subject_hash, 0));

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
      INSERT INTO persons(display_name) VALUES (pg_catalog.left(public.member_name_apply_rule(p_display_name, true), 120))
        RETURNING id INTO v_new_person;
      INSERT INTO accounts(person_id) VALUES (v_new_person) RETURNING id INTO v_new_account;
      INSERT INTO account_emails(id, account_id, email_lookup_hash, email_enc, kms_key_version, verified_at)
        VALUES (p_account_email_id, v_new_account, p_email_lookup_hash, p_email_enc, p_kms_key_version, pg_catalog.now());
      INSERT INTO account_identities(account_id, platform, platform_user_hash, verified_at)
        VALUES (v_new_account, 'google', p_subject_hash, pg_catalog.now());
      v_result_account := v_new_account;
      v_result_person  := v_new_person;
      v_outcome        := 'login_success';
    ELSIF v_email_verified THEN
      -- Cell 2: the verified email belongs to account A — DD-50 strong proof.
      -- Attach the Google identity to A; create no second account. ON CONFLICT
      -- keeps a re-login idempotent under the advisory-lock serialization.
      INSERT INTO account_identities(account_id, platform, platform_user_hash, verified_at)
        VALUES (v_email_account, 'google', p_subject_hash, pg_catalog.now())
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
      SET verified_at = pg_catalog.now(), pending_expires_at = NULL, updated_at = pg_catalog.now()
      WHERE id = v_email_id;

      UPDATE auth_pending_email_registrations
      SET superseded_at = pg_catalog.transaction_timestamp(), password_phc = NULL, registration_key_hash = NULL
      WHERE account_email_id = v_email_id
        AND consumed_at IS NULL AND superseded_at IS NULL;

      UPDATE auth_email_tokens
      SET superseded_at = pg_catalog.transaction_timestamp()
      WHERE account_email_id = v_email_id
        AND purpose = 'verify_email'
        AND consumed_at IS NULL AND superseded_at IS NULL;

      INSERT INTO account_identities(account_id, platform, platform_user_hash, verified_at)
        VALUES (v_email_account, 'google', p_subject_hash, pg_catalog.now())
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
