-- ============================================================================
-- 0016_account_email_token_core.sql
-- D1 (order-2, CODE DARK) — account-email + credential + token + delivery
-- storage, the Argon2id PHC validator/trigger, the parent-first email-token
-- consume helper, and the retention/cleanup primitive. DB layer only.
-- Source: docs/standards/decisions.md DD-80 v1.88 (§10 order-2) ·
--   docs/b0-auth-credential-lifecycle-design-probe.md
--   §3.1 (storage) · §5.1 (token table + partial indexes) · §5.2 (consume
--   boundary + THE canonical parent-first lock hierarchy) · §5.3 (TTL/retention)
--   · §8.1 (password policy + PHC validator) · §9 (schema.ts mirror "(a)") ·
--   docs/features/BE/feature_web_auth_onboarding_tech.md v2.10 acceptance
--   matrix D1E-1..D1E-22.
--
-- Scope (exactly this migration): five tables — account_emails,
-- email_password_credentials, auth_pending_email_registrations,
-- auth_email_tokens, auth_email_deliveries (+ the deliveries->tokens FK added
-- AFTER the token table, same migration) — their partial unique / retention
-- indexes; the internal `_auth_assert_password_phc` validator + the constraint
-- triggers that force it on BOTH write paths (pending attempt candidate and
-- credential); the internal `_auth_consume_email_token` parent-first consume
-- helper; and the internal `_auth_email_cleanup` retention sweep.
--
-- CODE DARK / NEGATIVE SCOPE (binding — DD-80 §10 order-2, manifest):
--   * REUSE `auth_audit_events` created by D0a/0015 — never recreate it.
--   * NO public functions: auth_verify_email / auth_reset_password /
--     auth_finalize_email_login are ORDER-4. Only the internal helpers +
--     validators live here; none is granted to the runtime `app` role.
--   * NO DD-70(a) inbox fence step — order-2 has no global-emitting path
--     (security_alert / identity_merged are order-4 producers). The lock
--     hierarchy below is §5.2 WITHOUT the fence.
--   * NO routes, email UI, provider send, pg-boss enqueue wiring beyond the
--     dark delivery storage + persisted provider-idempotency key.
--   * NO auth_oauth_transactions / Google adapter (order-3, migration 0017).
--   * Every new table is function-only: ZERO grant to `app` (mirrors the
--     auth_login_nonces/auth_login_state/rate_limit_hits pattern of 0012).
--     Direct DML on `password_phc` columns and EXECUTE on the internal
--     helpers are therefore denied to `app` by construction.
--
-- Canonical lock hierarchy (B0 §5.2 — do NOT re-derive): read-only resolve the
-- candidate token -> account_email/account (no lock) -> lock parents
-- (accounts, then account_emails, UUID order) -> lock children (pending
-- attempt, then token, UUID order) -> re-resolve and require EXACT candidate
-- equality + lifecycle predicate under the lock -> conditional UPDATE
-- consumed_at = transaction_timestamp(). Never child-first. Reads that filter
-- on a candidate use now(); the post-lock revalidation uses clock_timestamp()
-- so a token that genuinely crosses its expiry WHILE queued on the parent lock
-- is treated as expired (0015 established this now()/clock_timestamp() split
-- for rotate/logout-all — codex round-08/09).
--
-- Rollback (pre-production, additive-only): DROP the internal functions/triggers,
-- then DROP the five tables in reverse-dependency order (auth_email_deliveries
-- token FK first, then auth_email_tokens, auth_pending_email_registrations,
-- email_password_credentials, account_emails). auth_audit_events is NOT owned
-- by this migration and must not be dropped here.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. account_emails (B0 §3.1) — provider-neutral verified contact. One email
--    per account (UNIQUE(account_id)); one owner per normalized email
--    (UNIQUE(email_lookup_hash)). Google and email/password share this record.
--    Exactly one of verified_at / pending_expires_at is set at all times
--    (mutually-exclusive lifecycle CHECK — D1E-2).
-- ---------------------------------------------------------------------------
CREATE TABLE account_emails (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id         uuid NOT NULL REFERENCES accounts(id),
  email_lookup_hash  text NOT NULL UNIQUE,
  email_enc          bytea NOT NULL,
  kms_key_version    text NOT NULL,
  verified_at        timestamptz,
  pending_expires_at timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_emails_account_uq UNIQUE (account_id),
  CONSTRAINT account_emails_lifecycle_chk CHECK (
    (verified_at IS NULL AND pending_expires_at IS NOT NULL)
    OR
    (verified_at IS NOT NULL AND pending_expires_at IS NULL)
  )
);
-- No grants: reached only inside SECURITY DEFINER auth functions.
-- Orphan-cleanup scan index: the retention sweep looks for PENDING emails past
-- their expiry, so index only those rows — a mostly-verified table would
-- otherwise be full-scanned each run despite the batch limit (codex round-04 [P2]).
CREATE INDEX account_emails_pending_expires_idx
  ON account_emails(pending_expires_at) WHERE verified_at IS NULL;

-- ---------------------------------------------------------------------------
-- 2. email_password_credentials (B0 §3.1) — owns ONLY the password hash. One
--    credential per verified account_email (PK = account_email_id). Created
--    ONLY for a verified email (D1E-4, enforced by the verified-gate trigger
--    below) and only with a policy-valid Argon2id PHC (D1E-11/12, PHC trigger).
-- ---------------------------------------------------------------------------
CREATE TABLE email_password_credentials (
  account_email_id uuid PRIMARY KEY REFERENCES account_emails(id),
  password_phc     text NOT NULL,
  updated_at       timestamptz NOT NULL DEFAULT now()
);
-- No grants: `app` has zero DML here, so INSERT/UPDATE of password_phc is
-- denied to `app` by construction (D1E-13).

-- ---------------------------------------------------------------------------
-- 3. auth_pending_email_registrations (B0 §3.1) — one INDEPENDENT attempt per
--    register command (no last-writer-wins on the email slot — D1E-6). An
--    active attempt (consumed_at & superseded_at NULL) carries BOTH the
--    password PHC candidate and the SHA-256 of the browser registration key;
--    a terminal attempt (exactly one of consumed/superseded set — XOR) has
--    BOTH candidates NULL (D1E-5). UNIQUE(id, account_email_id) exists solely
--    so the token table's composite FK can reference it.
-- ---------------------------------------------------------------------------
CREATE TABLE auth_pending_email_registrations (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_email_id      uuid NOT NULL REFERENCES account_emails(id) ON DELETE CASCADE,
  password_phc          text,
  registration_key_hash text UNIQUE,
  expires_at            timestamptz NOT NULL,
  consumed_at           timestamptz,
  superseded_at         timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_pending_email_registrations_id_email_uq UNIQUE (id, account_email_id),
  CONSTRAINT auth_pending_email_registrations_lifecycle_chk CHECK (
    (consumed_at IS NULL AND superseded_at IS NULL
      AND password_phc IS NOT NULL AND registration_key_hash IS NOT NULL)
    OR
    ((consumed_at IS NOT NULL) <> (superseded_at IS NOT NULL)
      AND password_phc IS NULL AND registration_key_hash IS NULL)
  )
);
-- Active-attempt lookup (parent-first resolve) — partial, does NOT reference
-- now() so an expired-but-unswept row is still visible to supersede-before-insert.
CREATE INDEX auth_pending_email_registrations_active_idx
  ON auth_pending_email_registrations(account_email_id, created_at)
  WHERE consumed_at IS NULL AND superseded_at IS NULL;
-- Retention sweep (indexed batch delete keyed on expires_at — §5.3).
CREATE INDEX auth_pending_email_registrations_expires_idx
  ON auth_pending_email_registrations(expires_at);
-- Non-partial FK index: deleting an account_email cascades here by
-- account_email_id, and the active_idx above is partial (active rows only), so
-- without this the orphan-email delete full-scans this table (codex round-07 [P2]).
CREATE INDEX auth_pending_email_registrations_account_email_idx
  ON auth_pending_email_registrations(account_email_id);

-- ---------------------------------------------------------------------------
-- 4. auth_email_deliveries (B0 §3.1) — enumeration-safe dark delivery ledger.
--    `command_id` is the public command-receipt fence; `provider_idempotency_key`
--    is a SEPARATE persisted upstream-send key derived from the immutable
--    delivery id (§3.4) — the two are structurally distinct (D1E-19). The
--    token FK is added AFTER auth_email_tokens exists (§5.1), below.
-- ---------------------------------------------------------------------------
CREATE TABLE auth_email_deliveries (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind                       text NOT NULL CHECK (kind IN ('verify_email','password_reset')),
  token_id                   uuid,
  payload_enc                bytea,
  kms_key_version            text,
  command_id                 uuid NOT NULL UNIQUE,
  command_owner_hash         text NOT NULL,
  command_operation          text NOT NULL
    CHECK (command_operation IN ('register','verify_resend','forgot')),
  command_target_fingerprint text NOT NULL,
  provider_idempotency_key   text NOT NULL UNIQUE,
  provider_key_version       text NOT NULL,
  outcome                    text NOT NULL
    CHECK (outcome IN ('queued','delivered','noop','dead_letter','failed_terminal')),
  enqueued_at                timestamptz,
  expires_at                 timestamptz NOT NULL,
  terminal_at                timestamptz,
  last_error_class           text,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  -- queued is the only non-terminal outcome; every other outcome stamps
  -- terminal_at (D1E-19).
  CONSTRAINT auth_email_deliveries_terminal_chk CHECK (
    (outcome = 'queued' AND terminal_at IS NULL)
    OR
    (outcome IN ('delivered','noop','dead_letter','failed_terminal') AND terminal_at IS NOT NULL)
  ),
  -- ciphertext + key live ONLY while the payload is still deliverable
  -- (queued or dead_letter, replayable); they are NULL once the row reaches a
  -- delivered/noop/failed_terminal disposition (D1E-19).
  CONSTRAINT auth_email_deliveries_payload_chk CHECK (
    (outcome IN ('queued','dead_letter') AND payload_enc IS NOT NULL AND kms_key_version IS NOT NULL)
    OR
    (outcome IN ('delivered','noop','failed_terminal') AND payload_enc IS NULL AND kms_key_version IS NULL)
  ),
  -- verify emails come from register/verify_resend; password resets from forgot.
  CONSTRAINT auth_email_deliveries_operation_kind_chk CHECK (
    (command_operation IN ('register','verify_resend') AND kind = 'verify_email')
    OR
    (command_operation = 'forgot' AND kind = 'password_reset')
  )
);
CREATE INDEX auth_email_deliveries_expires_idx
  ON auth_email_deliveries(expires_at);
CREATE INDEX auth_email_deliveries_terminal_idx
  ON auth_email_deliveries(terminal_at) WHERE terminal_at IS NOT NULL;
-- Dispatcher pickup (order-4 app_worker) — indexed for the queued/un-enqueued set.
CREATE INDEX auth_email_deliveries_dispatch_idx
  ON auth_email_deliveries(created_at) WHERE outcome = 'queued' AND enqueued_at IS NULL;

-- ---------------------------------------------------------------------------
-- 5. auth_email_tokens (B0 §5.1) — one 256-bit random token, stored ONLY as a
--    lowercase SHA-256 hex hash (no salt / slow hash / failed_attempts: the
--    token is high-entropy and never user-typed). purpose is bound to the
--    presence of a pending attempt (D1E-7); the composite FK guarantees a
--    verify token's attempt belongs to the SAME account_email.
-- ---------------------------------------------------------------------------
CREATE TABLE auth_email_tokens (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_email_id        uuid NOT NULL REFERENCES account_emails(id) ON DELETE CASCADE,
  pending_registration_id uuid,
  purpose                 text NOT NULL CHECK (purpose IN ('verify_email','password_reset')),
  token_hash              text NOT NULL UNIQUE,
  expires_at              timestamptz NOT NULL,
  consumed_at             timestamptz,
  superseded_at           timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  -- a token is consumed XOR superseded XOR still active — never both terminal
  -- states at once (D1E-10).
  CONSTRAINT auth_email_tokens_terminal_chk CHECK (consumed_at IS NULL OR superseded_at IS NULL),
  -- verify tokens carry an attempt; reset tokens never do (D1E-7).
  CONSTRAINT auth_email_tokens_purpose_reg_chk CHECK (
    (purpose = 'verify_email' AND pending_registration_id IS NOT NULL)
    OR
    (purpose = 'password_reset' AND pending_registration_id IS NULL)
  ),
  CONSTRAINT auth_email_tokens_attempt_fk FOREIGN KEY (pending_registration_id, account_email_id)
    REFERENCES auth_pending_email_registrations(id, account_email_id) ON DELETE CASCADE
);
-- One ACTIVE verify token per attempt (D1E-8). Partial on the lifecycle flags
-- only — NOT on now() — so an expired-but-unswept token still holds the slot,
-- forcing supersede-before-insert (D1E-9 rationale).
CREATE UNIQUE INDEX auth_email_tokens_one_active_verify_per_attempt_uq
  ON auth_email_tokens(pending_registration_id)
  WHERE purpose = 'verify_email' AND consumed_at IS NULL AND superseded_at IS NULL;
-- One ACTIVE reset token per account_email (D1E-9) — same now()-independent shape.
CREATE UNIQUE INDEX auth_email_tokens_one_active_reset_uq
  ON auth_email_tokens(account_email_id, purpose)
  WHERE purpose = 'password_reset' AND consumed_at IS NULL AND superseded_at IS NULL;
-- Retention sweep index (§5.3).
CREATE INDEX auth_email_tokens_expires_at_idx
  ON auth_email_tokens(expires_at);
-- Non-partial index on the composite FK's referencing columns. The
-- one-active-verify partial index above only covers ACTIVE verify tokens, so
-- deleting a (terminal) pending attempt during retention cleanup would
-- otherwise full-scan this child table to enforce the ON DELETE CASCADE
-- (codex round-04 [P2]).
CREATE INDEX auth_email_tokens_pending_fk_idx
  ON auth_email_tokens(pending_registration_id, account_email_id);
-- Non-partial FK index on account_email_id: deleting an account_email cascades
-- here by that column, and the reset partial index / pending_fk_idx above do not
-- lead with it, so without this the orphan-email delete full-scans this table
-- (codex round-07 [P2]). Together with the two indexes above and the delivery
-- token_id index, EVERY FK cascade/set-null path is now covered.
CREATE INDEX auth_email_tokens_account_email_idx
  ON auth_email_tokens(account_email_id);

-- Deliveries -> tokens FK, added now that auth_email_tokens exists (B0 §5.1):
-- a superseded/expired token that a delivery still points at nulls the ref
-- rather than blocking token cleanup.
ALTER TABLE auth_email_deliveries
  ADD CONSTRAINT auth_email_deliveries_token_fk
  FOREIGN KEY (token_id) REFERENCES auth_email_tokens(id) ON DELETE SET NULL;
-- Index the FK's referencing column so deleting a token during retention
-- cleanup can find the delivery rows to ON DELETE SET NULL without a full scan
-- (codex round-04 [P2]).
CREATE INDEX auth_email_deliveries_token_id_idx
  ON auth_email_deliveries(token_id) WHERE token_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 6. _auth_b64_decode_canonical — internal helper: decode standard-alphabet,
--    UNPADDED base64 (the PHC/argon2 encoding) and REJECT any non-canonical
--    encoding (invalid alphabet, impossible length, or non-zero trailing bits
--    that decode-then-re-encode would normalise away). Returns the raw bytes
--    so the caller can measure the exact decoded length. Never echoes its
--    input (D1E-22).
-- ---------------------------------------------------------------------------
CREATE FUNCTION _auth_b64_decode_canonical(p_b64 text)
RETURNS bytea
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_pad   text;
  v_bytes bytea;
BEGIN
  -- Standard base64 alphabet only, and never a length that leaves a single
  -- dangling 6-bit group (len % 4 = 1 is not a valid base64 length).
  IF p_b64 !~ '^[A-Za-z0-9+/]+$' OR length(p_b64) % 4 = 1 THEN
    RAISE EXCEPTION 'invalid base64 encoding' USING ERRCODE = 'check_violation';
  END IF;
  v_pad := repeat('=', (4 - length(p_b64) % 4) % 4);
  v_bytes := decode(p_b64 || v_pad, 'base64');
  -- Canonical: re-encoding the decoded bytes must reproduce the padded input
  -- verbatim. This rejects non-zero trailing bits that decode() tolerates.
  IF replace(replace(encode(v_bytes, 'base64'), E'\n', ''), E'\r', '') <> p_b64 || v_pad THEN
    RAISE EXCEPTION 'non-canonical base64 encoding' USING ERRCODE = 'check_violation';
  END IF;
  RETURN v_bytes;
END;
$$;
REVOKE ALL ON FUNCTION _auth_b64_decode_canonical(text) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 7. _auth_assert_password_phc (B0 §8.1) — the SINGLE owner of PHC shape for
--    EVERY write path. Internal, fixed search_path, NOT granted to `app`. It
--    parses the FULL Argon2id PHC (not a regex prefix): algorithm argon2id,
--    version v=19, EXACTLY one m,t,p tuple in that order, canonical base64
--    salt >= 16 bytes and output >= 32 bytes, and the m/t/p tuple within the
--    SERVER-OWNED install policy band. Policy v1 pins the exact benchmarked
--    tuple m=19456,t=2,p=1 as BOTH floor and ceiling (raising cost is a future
--    versioned migration, never a caller choice — §8.1). Only that tuple
--    passes; every other cell RAISEs and rolls back (D1E-11). Messages are
--    generic — no PHC/salt/hash content ever appears in an error (D1E-22).
-- ---------------------------------------------------------------------------
CREATE FUNCTION _auth_assert_password_phc(p_phc text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- Server-owned install policy v1 (caller cannot select a version). Floor
  -- and ceiling coincide on the benchmarked tuple; a cost bump ships as a new
  -- migration that widens the ceiling, not an ad-hoc request parameter.
  c_m_floor  constant integer := 19456;
  c_t_floor  constant integer := 2;
  c_p_floor  constant integer := 1;
  c_m_ceil   constant integer := 19456;
  c_t_ceil   constant integer := 2;
  c_p_ceil   constant integer := 1;
  c_salt_min constant integer := 16;
  c_hash_min constant integer := 32;
  v_parts text[];
  v_m integer;
  v_t integer;
  v_p integer;
BEGIN
  IF p_phc IS NULL THEN
    RAISE EXCEPTION 'password PHC: missing' USING ERRCODE = 'check_violation';
  END IF;

  -- Full structural parse: argon2id / v=19 / m,t,p (that exact order, no
  -- duplicates or extras) / salt / hash. Standard base64 alphabet, no padding.
  v_parts := regexp_match(
    p_phc,
    '^\$argon2id\$v=19\$m=([0-9]+),t=([0-9]+),p=([0-9]+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$'
  );
  IF v_parts IS NULL THEN
    RAISE EXCEPTION 'password PHC: malformed, or unsupported algorithm/version/parameters'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Guard integer overflow BEFORE casting: a value with more than 9 digits
  -- exceeds int range, and casting it directly raises a native SQLSTATE 22003
  -- that echoes the numeric text — violating the generic-error / no-PHC-leak
  -- contract (codex round-09 [P2], D1E-22). Any such value is, by construction,
  -- far above the policy ceiling (9 digits max = 999,999,999 always casts).
  IF length(v_parts[1]) > 9 OR length(v_parts[2]) > 9 OR length(v_parts[3]) > 9 THEN
    RAISE EXCEPTION 'password PHC: cost parameters above policy ceiling'
      USING ERRCODE = 'check_violation';
  END IF;

  v_m := v_parts[1]::integer;
  v_t := v_parts[2]::integer;
  v_p := v_parts[3]::integer;

  IF v_m < c_m_floor OR v_t < c_t_floor OR v_p < c_p_floor THEN
    RAISE EXCEPTION 'password PHC: cost parameters below policy floor'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_m > c_m_ceil OR v_t > c_t_ceil OR v_p > c_p_ceil THEN
    RAISE EXCEPTION 'password PHC: cost parameters above policy ceiling'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Canonical base64 + exact decoded lengths (salt >= 16B, output >= 32B).
  IF octet_length(_auth_b64_decode_canonical(v_parts[4])) < c_salt_min THEN
    RAISE EXCEPTION 'password PHC: salt too short' USING ERRCODE = 'check_violation';
  END IF;
  IF octet_length(_auth_b64_decode_canonical(v_parts[5])) < c_hash_min THEN
    RAISE EXCEPTION 'password PHC: output too short' USING ERRCODE = 'check_violation';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION _auth_assert_password_phc(text) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 8. Constraint triggers forcing the PHC validator on BOTH write paths
--    (D1E-12) plus the verified-email gate on credentials (D1E-4). A
--    CONSTRAINT TRIGGER (AFTER, per-row) is used deliberately — the validator
--    owns the shape and a malformed/downgraded PHC aborts the whole
--    transaction. NULL password_phc is permitted only where the lifecycle
--    CHECK already permits it (a terminal pending attempt).
-- ---------------------------------------------------------------------------
CREATE FUNCTION _auth_assert_password_phc_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.password_phc IS NOT NULL THEN
    PERFORM _auth_assert_password_phc(NEW.password_phc);
  END IF;
  RETURN NULL; -- AFTER/constraint trigger: return value is ignored
END;
$$;
REVOKE ALL ON FUNCTION _auth_assert_password_phc_trg() FROM PUBLIC;

CREATE CONSTRAINT TRIGGER auth_pending_email_registrations_phc_trg
  AFTER INSERT OR UPDATE ON auth_pending_email_registrations
  FOR EACH ROW EXECUTE FUNCTION _auth_assert_password_phc_trg();

CREATE CONSTRAINT TRIGGER email_password_credentials_phc_trg
  AFTER INSERT OR UPDATE ON email_password_credentials
  FOR EACH ROW EXECUTE FUNCTION _auth_assert_password_phc_trg();

-- Verified-email gate: a credential may exist ONLY for a verified account_email
-- (B0 §3.1, D1E-4). A pending (unverified) email keeps its candidate password
-- in auth_pending_email_registrations; only a winning verify promotes it.
CREATE FUNCTION _auth_assert_email_verified_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM 1 FROM account_emails
  WHERE id = NEW.account_email_id AND verified_at IS NOT NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'email_password_credentials: credential requires a verified account_email'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION _auth_assert_email_verified_trg() FROM PUBLIC;

CREATE CONSTRAINT TRIGGER email_password_credentials_verified_trg
  AFTER INSERT OR UPDATE ON email_password_credentials
  FOR EACH ROW EXECUTE FUNCTION _auth_assert_email_verified_trg();

-- Parent-side companion to the verified-gate: verified_at is MONOTONIC.
-- Making the guard CONDITIONAL on a credential's existence (round-01) left a
-- concurrency hole — a first credential INSERT racing a verified->pending
-- UPDATE: the credential trigger reads the still-verified parent while this
-- trigger cannot see the uncommitted child, and the FK's key-share lock does
-- not serialize a non-key parent UPDATE, so both commit and orphan the
-- credential (codex round-02 [P1]). The clean, race-free invariant is simply
-- that an email is NEVER un-verified: promotion pending->verified is one-way,
-- and an email CHANGE is a NEW account_emails row, never an un-verify. Rejecting
-- the transition UNCONDITIONALLY needs no cross-row visibility, so no race
-- exists. (Raising the cost / re-keying is a future versioned migration.)
CREATE FUNCTION _auth_forbid_unverify_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.verified_at IS NOT NULL AND NEW.verified_at IS NULL THEN
    RAISE EXCEPTION 'account_emails: verified_at is monotonic — an email cannot be un-verified'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION _auth_forbid_unverify_trg() FROM PUBLIC;

CREATE CONSTRAINT TRIGGER account_emails_forbid_unverify_trg
  AFTER UPDATE ON account_emails
  FOR EACH ROW EXECUTE FUNCTION _auth_forbid_unverify_trg();

-- ---------------------------------------------------------------------------
-- 9. _auth_consume_email_token (B0 §5.2) — the ONE canonical transactional
--    consume boundary. Internal, NOT granted (the order-4 public verify/reset
--    functions call it; nothing else). purpose is passed by the caller, which
--    hardcodes it per endpoint; the helper never lets a token cross purposes.
--    Follows the parent-first lock hierarchy EXACTLY, WITHOUT the DD-70 fence
--    step (order-2 emits no global item):
--      resolve (read-only) -> accounts -> account_emails -> attempt -> token
--      -> re-resolve/revalidate under lock -> conditional consume.
--    Returns (account_email_id, pending_registration_id) on success, or ZERO
--    rows for every fail-closed case (wrong purpose, expired, consumed,
--    superseded, unknown hash) — indistinguishable to the caller (D1E-15).
-- ---------------------------------------------------------------------------
CREATE FUNCTION _auth_consume_email_token(p_token_hash text, p_expected_purpose text)
RETURNS TABLE (account_email_id uuid, pending_registration_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_token_id         uuid;
  v_account_email_id uuid;
  v_account_id       uuid;
  v_pending_id       uuid;
  v_locked_pending   uuid;
BEGIN
  -- Contract guard: purpose is caller-hardcoded per endpoint, never attacker
  -- input. An unknown purpose is a programming error, not a token probe.
  IF p_expected_purpose NOT IN ('verify_email','password_reset') THEN
    RAISE EXCEPTION '_auth_consume_email_token: unsupported purpose'
      USING ERRCODE = 'check_violation';
  END IF;

  -- (1) Read-only resolve the candidate: token -> account_email -> account.
  --     now() is the frozen transaction start — fine for a candidate filter;
  --     the authoritative expiry re-check under the lock uses clock_timestamp().
  SELECT t.id, t.account_email_id, t.pending_registration_id, ae.account_id
    INTO v_token_id, v_account_email_id, v_pending_id, v_account_id
  FROM auth_email_tokens t
  JOIN account_emails ae ON ae.id = t.account_email_id
  WHERE t.token_hash = p_token_hash
    AND t.purpose = p_expected_purpose
    AND t.consumed_at IS NULL
    AND t.superseded_at IS NULL
    AND t.expires_at > now();
  IF NOT FOUND THEN
    RETURN; -- zero rows: nothing to reveal
  END IF;

  -- (2) Parent tier, parent-first: accounts, then account_emails. Single-row
  --     targets, so UUID order (§5.2 step 3) is trivially satisfied and the
  --     same account is locked exactly once.
  PERFORM 1 FROM accounts WHERE id = v_account_id FOR UPDATE;
  PERFORM 1 FROM account_emails WHERE id = v_account_email_id FOR UPDATE;

  -- (3) Child tier, parent-first: the pending attempt (verify only), then the
  --     token itself (§5.2 step 4). Never a token/child lock before the parents.
  --     A verify token is only consumable while its attempt is STILL the active,
  --     unexpired winner mapped to this email (§3.2#3 "revalidate token/attempt
  --     ... chưa expired/consumed/superseded"): a token can outlive its attempt
  --     (a competing verify or the cleanup sweep supersedes the attempt without
  --     touching the token), and consuming it then would install a dead attempt.
  IF v_pending_id IS NOT NULL THEN
    -- alias the table: the column `account_email_id` would otherwise be
    -- ambiguous with this function's OUT parameter of the same name.
    PERFORM 1 FROM auth_pending_email_registrations r
    WHERE r.id = v_pending_id
      AND r.account_email_id = v_account_email_id
      AND r.consumed_at IS NULL
      AND r.superseded_at IS NULL
      AND r.expires_at > clock_timestamp()
    FOR UPDATE;
    IF NOT FOUND THEN
      RETURN; -- attempt terminal/expired/re-parented under lock: zero mutation
    END IF;
  END IF;

  -- (4) Re-resolve under the locks and require EXACT candidate equality plus
  --     an unexpired/active lifecycle (§5.2 step 6). clock_timestamp(), not
  --     now(): a token that crossed its expiry WHILE we queued on the parent
  --     lock must read as expired (0015 rotate/logout-all precedent).
  PERFORM 1 FROM account_emails
  WHERE id = v_account_email_id AND account_id = v_account_id;
  IF NOT FOUND THEN
    RETURN; -- parent mapping drifted under lock
  END IF;

  SELECT t.pending_registration_id INTO v_locked_pending
  FROM auth_email_tokens t
  WHERE t.id = v_token_id
    AND t.token_hash = p_token_hash
    AND t.account_email_id = v_account_email_id
    AND t.purpose = p_expected_purpose
    AND t.consumed_at IS NULL
    AND t.superseded_at IS NULL
    AND t.expires_at > clock_timestamp()
  FOR UPDATE;
  IF NOT FOUND OR v_locked_pending IS DISTINCT FROM v_pending_id THEN
    RETURN; -- drifted/terminalized/expired under lock: zero mutation
  END IF;

  -- (5) Conditional consume. The WHERE re-asserts the active predicate so two
  --     racers can never both consume the same token.
  UPDATE auth_email_tokens
  SET consumed_at = transaction_timestamp()
  WHERE id = v_token_id AND consumed_at IS NULL AND superseded_at IS NULL;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  account_email_id := v_account_email_id;
  pending_registration_id := v_pending_id;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION _auth_consume_email_token(text,text) FROM PUBLIC;
-- Deliberately no GRANT: reached only from the order-4 SECURITY DEFINER
-- verify/reset functions (not built in this slice).

-- ---------------------------------------------------------------------------
-- 10a. _auth_email_delivery_cleanup (B0 §5.3) — delivery retention ONLY.
--      Internal, NOT granted. Deliveries own NO account_emails parent (they
--      reference a token by id, ON DELETE SET NULL), so this runs in its OWN
--      transaction and NEVER acquires accounts/account_emails. Keeping delivery
--      locks out of any transaction that later takes the account parent tier is
--      what removes the cross-cycle: a concurrent account sweep may wait on a
--      delivery this holds, but this never waits back on a parent, so no
--      deadlock (codex round-03 [P1]). Both statements are bounded by
--      p_batch_limit + FOR UPDATE SKIP LOCKED so an outage backlog cannot
--      rewrite every row in one transaction (codex round-02 [P2]); the
--      order-4 scheduled job repeats until drained.
-- ---------------------------------------------------------------------------
CREATE FUNCTION _auth_email_delivery_cleanup(p_batch_limit integer DEFAULT 1000)
RETURNS TABLE (deliveries_terminalized integer, deliveries_deleted integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now       timestamptz := now();
  v_retention timestamptz := now() - interval '30 days';
BEGIN
  deliveries_terminalized := 0;
  deliveries_deleted := 0;

  WITH doomed AS (
    SELECT id FROM auth_email_deliveries
    WHERE outcome IN ('queued','dead_letter') AND expires_at < v_now
    ORDER BY expires_at
    LIMIT p_batch_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE auth_email_deliveries d
  SET outcome = 'failed_terminal',
      terminal_at = transaction_timestamp(),
      payload_enc = NULL,
      kms_key_version = NULL,
      last_error_class = 'expired'
  FROM doomed WHERE d.id = doomed.id;
  GET DIAGNOSTICS deliveries_terminalized = ROW_COUNT;

  WITH doomed AS (
    SELECT id FROM auth_email_deliveries
    WHERE terminal_at IS NOT NULL AND terminal_at < v_retention
    ORDER BY terminal_at
    LIMIT p_batch_limit
    FOR UPDATE SKIP LOCKED
  )
  DELETE FROM auth_email_deliveries e USING doomed d WHERE e.id = d.id;
  GET DIAGNOSTICS deliveries_deleted = ROW_COUNT;

  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION _auth_email_delivery_cleanup(integer) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 10b. account_emails-tree retention — FOUR single-concern functions, each its
--      OWN transaction. Internal, NOT granted. The order-4 `auth-email-cleanup`
--      job calls them in the order declared here (terminalize -> token
--      retention -> attempt retention -> orphan) so children are drained before
--      their parents (minimising the ON DELETE CASCADE fan-out).
--
--      Why four functions instead of four phases in one function: each function
--      is a SINGLE ascending-account-id pass, and — being its own transaction —
--      it releases its parent locks at COMMIT before the next concern starts.
--      A single multi-phase transaction accumulated locks across phases that
--      sorted independently (phase (a) could hold a higher-UUID account while
--      phase (b) requested a lower one), which deadlocks a concurrent
--      ascending-order `auth_rotate_web_session` (codex round-04 [P1]). With one
--      ascending pass per transaction, EVERY auth path — these sweeps, register,
--      verify, rotate, logout-all — acquires `accounts` in the same global order,
--      so no deadlock is possible. Each is bounded by CHILD rows (LIMIT on the
--      child, not the email — codex round-03 [P2]); locks accounts ->
--      account_emails BEFORE mutating any child (codex round-01 [P1]); and
--      re-asserts its predicate under the lock so a row that changed between the
--      read-only snapshot and the lock is skipped. None deletes accounts/persons
--      or cascades into business tables.
-- ---------------------------------------------------------------------------

-- (10b-i) Terminalize a bounded batch of expired ACTIVE attempts, NULLing the
--         password/key candidate immediately (§5.3 "ngay"). Security-critical
--         and overlap-prone with a live register/verify, hence parent-first.
CREATE FUNCTION _auth_email_attempt_terminalize(p_batch_limit integer DEFAULT 1000)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_now timestamptz := now(); v_rec record; v_total integer := 0; v_n integer;
BEGIN
  -- Pick the OLDEST eligible rows via the expiry index FIRST (so a sustained
  -- backlog cannot starve higher-UUID accounts), then sort that FIXED set by
  -- account_id for ascending-order parent locking (codex round-05 [P2]).
  FOR v_rec IN
    SELECT s.attempt_id, s.account_email_id, s.account_id
    FROM (
      SELECT r.id AS attempt_id, r.account_email_id, ae.account_id, r.expires_at
      FROM auth_pending_email_registrations r
      JOIN account_emails ae ON ae.id = r.account_email_id
      WHERE r.consumed_at IS NULL AND r.superseded_at IS NULL AND r.expires_at < v_now
      ORDER BY r.expires_at
      LIMIT p_batch_limit
    ) s
    ORDER BY s.account_id, s.attempt_id
  LOOP
    PERFORM 1 FROM accounts WHERE id = v_rec.account_id FOR UPDATE;
    PERFORM 1 FROM account_emails WHERE id = v_rec.account_email_id FOR UPDATE;
    UPDATE auth_pending_email_registrations
    SET superseded_at = transaction_timestamp(), password_phc = NULL, registration_key_hash = NULL
    WHERE id = v_rec.attempt_id
      AND consumed_at IS NULL AND superseded_at IS NULL AND expires_at < v_now;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_total := v_total + v_n;
  END LOOP;
  RETURN v_total;
END;
$$;
REVOKE ALL ON FUNCTION _auth_email_attempt_terminalize(integer) FROM PUBLIC;

-- (10b-ii) Delete a bounded batch of past-retention tokens (leaf rows; their
--          delivery back-refs go NULL via the FK). Run before attempt retention
--          so a deleted attempt has fewer tokens left to cascade.
CREATE FUNCTION _auth_email_token_retention(p_batch_limit integer DEFAULT 1000)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_retention timestamptz := now() - interval '30 days'; v_rec record; v_total integer := 0; v_n integer;
BEGIN
  -- oldest-first select, then account-ordered locking (codex round-05 [P2]).
  FOR v_rec IN
    SELECT s.token_id, s.account_email_id, s.account_id
    FROM (
      SELECT t.id AS token_id, t.account_email_id, ae.account_id, t.expires_at
      FROM auth_email_tokens t
      JOIN account_emails ae ON ae.id = t.account_email_id
      WHERE t.expires_at < v_retention
      ORDER BY t.expires_at
      LIMIT p_batch_limit
    ) s
    ORDER BY s.account_id, s.token_id
  LOOP
    PERFORM 1 FROM accounts WHERE id = v_rec.account_id FOR UPDATE;
    PERFORM 1 FROM account_emails WHERE id = v_rec.account_email_id FOR UPDATE;
    DELETE FROM auth_email_tokens WHERE id = v_rec.token_id AND expires_at < v_retention;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_total := v_total + v_n;
  END LOOP;
  RETURN v_total;
END;
$$;
REVOKE ALL ON FUNCTION _auth_email_token_retention(integer) FROM PUBLIC;

-- (10b-iii) Delete a bounded batch of past-retention TERMINAL attempts. Their
--           tokens are the same vintage and are drained first by 10b-ii, so the
--           residual ON DELETE CASCADE per attempt is bounded by the resend
--           rate-limit (§8.2), and §3.2#6 permits cascading an email's own
--           attempts/tokens.
CREATE FUNCTION _auth_email_attempt_retention(p_batch_limit integer DEFAULT 1000)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_retention timestamptz := now() - interval '30 days'; v_rec record; v_total integer := 0; v_n integer;
BEGIN
  -- oldest-first select, then account-ordered locking (codex round-05 [P2]).
  FOR v_rec IN
    SELECT s.attempt_id, s.account_email_id, s.account_id
    FROM (
      SELECT r.id AS attempt_id, r.account_email_id, ae.account_id, r.expires_at
      FROM auth_pending_email_registrations r
      JOIN account_emails ae ON ae.id = r.account_email_id
      WHERE (r.consumed_at IS NOT NULL OR r.superseded_at IS NOT NULL) AND r.expires_at < v_retention
      ORDER BY r.expires_at
      LIMIT p_batch_limit
    ) s
    ORDER BY s.account_id, s.attempt_id
  LOOP
    PERFORM 1 FROM accounts WHERE id = v_rec.account_id FOR UPDATE;
    PERFORM 1 FROM account_emails WHERE id = v_rec.account_email_id FOR UPDATE;
    DELETE FROM auth_pending_email_registrations
    WHERE id = v_rec.attempt_id
      AND (consumed_at IS NOT NULL OR superseded_at IS NOT NULL) AND expires_at < v_retention;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_total := v_total + v_n;
  END LOOP;
  RETURN v_total;
END;
$$;
REVOKE ALL ON FUNCTION _auth_email_attempt_retention(integer) FROM PUBLIC;

-- (10b-iv) Delete a bounded batch of ORPHAN pending emails (verified_at NULL,
--          past expiry, no active attempt — re-checked under the lock). §3.2#6
--          permits cascading the email's own attempts/tokens; by running last,
--          most were already drained by 10b-ii/iii, so the cascade is bounded.
CREATE FUNCTION _auth_email_orphan_cleanup(p_batch_limit integer DEFAULT 1000)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_now timestamptz := now(); v_rec record; v_total integer := 0; v_n integer;
BEGIN
  -- oldest-first select, then account-ordered locking (codex round-05 [P2]).
  FOR v_rec IN
    SELECT s.email_id, s.account_id
    FROM (
      SELECT ae.id AS email_id, ae.account_id, ae.pending_expires_at
      FROM account_emails ae
      WHERE ae.verified_at IS NULL AND ae.pending_expires_at < v_now
        AND NOT EXISTS (
          SELECT 1 FROM auth_pending_email_registrations r
          WHERE r.account_email_id = ae.id AND r.consumed_at IS NULL AND r.superseded_at IS NULL
        )
      ORDER BY ae.pending_expires_at
      LIMIT p_batch_limit
    ) s
    ORDER BY s.account_id
  LOOP
    PERFORM 1 FROM accounts WHERE id = v_rec.account_id FOR UPDATE;
    PERFORM 1 FROM account_emails WHERE id = v_rec.email_id FOR UPDATE;
    DELETE FROM account_emails ae
    WHERE ae.id = v_rec.email_id
      AND ae.verified_at IS NULL AND ae.pending_expires_at < v_now
      AND NOT EXISTS (
        SELECT 1 FROM auth_pending_email_registrations r
        WHERE r.account_email_id = ae.id AND r.consumed_at IS NULL AND r.superseded_at IS NULL
      );
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_total := v_total + v_n;
  END LOOP;
  RETURN v_total;
END;
$$;
REVOKE ALL ON FUNCTION _auth_email_orphan_cleanup(integer) FROM PUBLIC;
