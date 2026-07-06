-- ============================================================================
-- 0012_auth_functions.sql
-- Web auth + tenant provisioning access path (NEW migration — expand only).
-- Source: feature_web_auth_onboarding(_tech) WAO-UC-1/2, BL-BIL-1, DD-13 (TG
--         Login only), DD-26 (no silent name persist), §P6 (persons anchor).
--         DD-31 SI-1 (login-state CSRF binding, new in v3); SI-5/SI-6/SI-7
--         (rate-limit / creation-race / session rotation, ported from the
--         auth-onboarding-v2 reference @7407caa, which never merged).
--
-- The runtime `app` role has ZERO grants on the protected global tables
-- (persons/accounts/web_sessions/account_identities — 0009). These SECURITY
-- DEFINER functions (owner = migration role) are the ONLY doorway, mirroring
-- the 0010 oauth/worker pattern: fixed search_path, minimal returned columns,
-- EXECUTE granted to `app` alone.
-- ============================================================================

-- Replay guard for Telegram Login payloads: one login hash is consumed once.
CREATE TABLE auth_login_nonces (
  login_hash text PRIMARY KEY,
  seen_at    timestamptz NOT NULL DEFAULT now()
);
-- No grants: touched only inside SECURITY DEFINER fns.

-- ---------------------------------------------------------------------------
-- auth_login_telegram — upsert person+account for a VERIFIED TG login.
-- Caller (apps/web) has already verified the widget HMAC + freshness; this fn
-- enforces single-use of the exact login payload (p_login_hash) as the nonce.
-- Display name is written ONLY when the person is first created (DD-26: no
-- silent overwrite of an existing person's money-adjacent name at login).
-- p_platform_user_hash arrives ALREADY KEYED (DD-31 SI-2) — this function is
-- hash-agnostic, it never computes or sees the raw Telegram user id.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION auth_login_telegram(
  p_platform_user_hash text,
  p_display_name text,
  p_login_hash text
) RETURNS TABLE (account_id uuid, person_id uuid, created boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account uuid;
  v_person  uuid;
  v_created boolean := false;
BEGIN
  IF p_platform_user_hash IS NULL OR length(p_platform_user_hash) < 16 THEN
    RAISE EXCEPTION 'auth_login_telegram: invalid platform user hash'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- single-use nonce (replayed payload -> unique_violation for the caller)
  DELETE FROM auth_login_nonces WHERE seen_at < now() - interval '10 minutes';
  INSERT INTO auth_login_nonces(login_hash) VALUES (p_login_hash);

  SELECT ai.account_id, a.person_id INTO v_account, v_person
  FROM account_identities ai
  JOIN accounts a ON a.id = ai.account_id
  WHERE ai.platform = 'telegram' AND ai.platform_user_hash = p_platform_user_hash;

  IF v_account IS NULL THEN
    INSERT INTO persons(display_name) VALUES (NULLIF(trim(p_display_name), ''))
      RETURNING id INTO v_person;
    INSERT INTO accounts(person_id) VALUES (v_person) RETURNING id INTO v_account;
    -- ATOMIC first-login: two concurrent fresh callbacks (distinct nonces) can
    -- both reach here; ON CONFLICT waits out the winner, the loser discards
    -- its orphan rows and adopts the winner's account — never a false 401.
    INSERT INTO account_identities(account_id, platform, platform_user_hash, verified_at)
      VALUES (v_account, 'telegram', p_platform_user_hash, now())
    ON CONFLICT (platform, platform_user_hash) DO NOTHING;
    IF NOT FOUND THEN
      DELETE FROM accounts WHERE id = v_account;
      DELETE FROM persons WHERE id = v_person;
      SELECT ai.account_id, a.person_id INTO v_account, v_person
      FROM account_identities ai
      JOIN accounts a ON a.id = ai.account_id
      WHERE ai.platform = 'telegram' AND ai.platform_user_hash = p_platform_user_hash;
    ELSE
      v_created := true;
    END IF;
  END IF;

  RETURN QUERY SELECT v_account, v_person, v_created;
END;
$$;
REVOKE ALL ON FUNCTION auth_login_telegram(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_login_telegram(text,text,text) TO app;

-- ---------------------------------------------------------------------------
-- Login-state CSRF binding (DD-31 SI-1, new in v3). Distinct from
-- auth_login_nonces above: the nonce guards REPLAY of an already-signed TG
-- payload; this table proves the callback is a continuation of the SAME
-- browser that started the login, independent of Origin/Referer transport.
-- Plain sha256 lookup is fine here (unlike SI-2): the raw state token is a
-- high-entropy random value, not a low-entropy enumerable id — no brute-force
-- surface to key against.
-- ---------------------------------------------------------------------------
CREATE TABLE auth_login_state (
  state_hash  text PRIMARY KEY,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
-- No grants: touched only inside SECURITY DEFINER fns.

CREATE OR REPLACE FUNCTION auth_login_state_issue(p_state_hash text, p_ttl interval)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM auth_login_state WHERE expires_at < now() - interval '1 day';
  INSERT INTO auth_login_state(state_hash, expires_at) VALUES (p_state_hash, now() + p_ttl);
$$;
REVOKE ALL ON FUNCTION auth_login_state_issue(text,interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_login_state_issue(text,interval) TO app;

-- Atomic single-use consume: true = valid & now consumed; false = missing,
-- expired, or already consumed. The UPDATE...RETURNING IS the atomicity —
-- two concurrent consumes of the same state_hash can never both succeed.
CREATE OR REPLACE FUNCTION auth_login_state_consume(p_state_hash text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE auth_login_state
  SET consumed_at = now()
  WHERE state_hash = p_state_hash
    AND consumed_at IS NULL
    AND expires_at > now()
  RETURNING true;
$$;
REVOKE ALL ON FUNCTION auth_login_state_consume(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_login_state_consume(text) TO app;

-- ---------------------------------------------------------------------------
-- Web sessions: create / resolve / rotate / revoke. Tokens arrive HASHED.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION auth_create_web_session(
  p_account_id uuid, p_token_hash text, p_csrf_secret text, p_ttl interval
) RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO web_sessions(account_id, token_hash, csrf_secret, expires_at)
  VALUES (p_account_id, p_token_hash, p_csrf_secret, now() + p_ttl)
  RETURNING id;
$$;
REVOKE ALL ON FUNCTION auth_create_web_session(uuid,text,text,interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_create_web_session(uuid,text,text,interval) TO app;

CREATE OR REPLACE FUNCTION auth_resolve_web_session(p_token_hash text)
RETURNS TABLE (session_id uuid, account_id uuid, person_id uuid,
               csrf_secret text, expires_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.id, s.account_id, a.person_id, s.csrf_secret, s.expires_at
  FROM web_sessions s
  JOIN accounts a ON a.id = s.account_id
  WHERE s.token_hash = p_token_hash
    AND s.revoked_at IS NULL
    AND s.expires_at > now();
$$;
REVOKE ALL ON FUNCTION auth_resolve_web_session(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_resolve_web_session(text) TO app;

-- Rotation (login / privilege change): revoke old, mint linked replacement
-- BOUND TO THE AUTHENTICATED ACCOUNT — logging in as Telegram account B over
-- account A's live cookie must never leave a cookie that authenticates as A.
CREATE OR REPLACE FUNCTION auth_rotate_web_session(
  p_old_token_hash text, p_new_token_hash text, p_new_csrf text, p_ttl interval,
  p_account_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old web_sessions%ROWTYPE;
  v_new uuid;
BEGIN
  SELECT * INTO v_old FROM web_sessions
  WHERE token_hash = p_old_token_hash AND revoked_at IS NULL AND expires_at > now()
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL; -- nothing to rotate (caller treats as plain login)
  END IF;
  UPDATE web_sessions SET revoked_at = now() WHERE id = v_old.id;
  INSERT INTO web_sessions(account_id, token_hash, csrf_secret, expires_at, rotated_from)
  VALUES (p_account_id, p_new_token_hash, p_new_csrf, now() + p_ttl, v_old.id)
  RETURNING id INTO v_new;
  RETURN v_new;
END;
$$;
REVOKE ALL ON FUNCTION auth_rotate_web_session(text,text,text,interval,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_rotate_web_session(text,text,text,interval,uuid) TO app;

CREATE OR REPLACE FUNCTION auth_revoke_web_session(p_token_hash text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE web_sessions SET revoked_at = now()
  WHERE token_hash = p_token_hash AND revoked_at IS NULL
  RETURNING true;
$$;
REVOKE ALL ON FUNCTION auth_revoke_web_session(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_revoke_web_session(text) TO app;

-- ---------------------------------------------------------------------------
-- tenant_provision — WAO-UC-2. Creates the club with the FREE plan active
-- immediately and forever (BL-BIL-1: free never trials, never goes past_due).
-- plan_key 'free_web' = the CURRENT seeded free catalog row; the DD-29 billing
-- slice renames the catalog (free_web -> free) expand→contract.
-- Idempotent by slug: same owner -> return existing; different owner -> error.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION tenant_provision(
  p_slug text, p_name text, p_timezone text, p_locale text, p_person_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_owned boolean;
BEGIN
  IF p_slug !~ '^[a-z0-9][a-z0-9-]{1,62}$' THEN
    RAISE EXCEPTION 'tenant_provision: invalid slug' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF trim(coalesce(p_name, '')) = '' THEN
    RAISE EXCEPTION 'tenant_provision: name required' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- ATOMIC create-or-lookup: ON CONFLICT waits for a concurrent inserter's
  -- transaction to finish, so the reselect below always sees the committed
  -- winner (two same-owner tabs both get the tenant id, never a false 409).
  INSERT INTO tenants(name, slug, status, locale, timezone)
  VALUES (trim(p_name), p_slug, 'active', coalesce(p_locale, 'vi'),
          coalesce(p_timezone, 'Asia/Ho_Chi_Minh'))
  ON CONFLICT (slug) DO NOTHING
  RETURNING id INTO v_tenant;

  IF v_tenant IS NULL THEN
    SELECT id INTO v_tenant FROM tenants WHERE slug = p_slug;
    -- idempotent ONLY for the web OWNER/ADMIN of that tenant — a mere member
    -- re-submitting the slug must get SLUG_TAKEN, not the tenant id.
    SELECT EXISTS (
      SELECT 1 FROM tenant_admins ta
      WHERE ta.tenant_id = v_tenant
        AND ta.platform = 'web'
        AND ta.platform_user_lookup_hash = p_person_id::text
        AND ta.role IN ('owner','admin')
        AND ta.active
    ) INTO v_owned;
    IF v_owned THEN
      RETURN v_tenant; -- idempotent re-submit by the same owner
    END IF;
    RAISE EXCEPTION 'tenant_provision: slug taken' USING ERRCODE = 'unique_violation';
  END IF;

  INSERT INTO memberships(tenant_id, person_id, status)
  VALUES (v_tenant, p_person_id, 'active');

  -- Web owner authz row. platform_user_lookup_hash carries the INTERNAL person
  -- uuid for platform='web' (not platform PII — nothing to hash).
  INSERT INTO tenant_admins(tenant_id, platform, platform_user_lookup_hash, role)
  VALUES (v_tenant, 'web', p_person_id::text, 'owner');

  -- FREE plan: active immediately, no trial, no period end in practice.
  INSERT INTO subscriptions(tenant_id, plan_key, plan_version, status,
                            period_start, period_end)
  VALUES (v_tenant, 'free_web', 1, 'active', now(), 'infinity');

  INSERT INTO onboarding_runs(tenant_id, status) VALUES (v_tenant, 'in_progress');

  RETURN v_tenant;
END;
$$;
REVOKE ALL ON FUNCTION tenant_provision(text,text,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenant_provision(text,text,text,text,uuid) TO app;

-- ---------------------------------------------------------------------------
-- tenant_ids_for_person — tenants where the person is a web admin/owner.
-- Minimal columns; used by GET /api/auth/session and route authz.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION tenant_ids_for_person(p_person_id uuid)
RETURNS TABLE (tenant_id uuid, role text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ta.tenant_id, ta.role
  FROM tenant_admins ta
  WHERE ta.platform = 'web'
    AND ta.platform_user_lookup_hash = p_person_id::text
    AND ta.active;
$$;
REVOKE ALL ON FUNCTION tenant_ids_for_person(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenant_ids_for_person(uuid) TO app;

-- ---------------------------------------------------------------------------
-- Shared rate limiting (BL-SEC-5) — one counter store for ALL replicas.
-- UNLOGGED: throughput over durability (losing counters on crash is fine).
-- ---------------------------------------------------------------------------
CREATE UNLOGGED TABLE rate_limit_hits (
  bucket text NOT NULL,
  at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_rate_limit_bucket_at ON rate_limit_hits(bucket, at);
-- Separate index on `at` ALONE (codex round-01 finding): the composite
-- (bucket, at) index above cannot serve a bare `at < ...` predicate without
-- a leading bucket equality, so the global retention sweep below would
-- degrade to a full scan as the number of distinct buckets grows.
CREATE INDEX idx_rate_limit_at ON rate_limit_hits(at);
-- No grants: touched only via the function below.

-- true = allowed (hit recorded); false = over the limit for this window.
CREATE OR REPLACE FUNCTION rate_limit_check(
  p_bucket text, p_limit integer, p_window interval
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  -- Serialize same-bucket admission: without this, a concurrent burst all
  -- counts before any peer commits and every request passes the limit.
  PERFORM pg_advisory_xact_lock(hashtext(p_bucket));
  -- Global retention sweep: a bucket that never returns (one-off IP, a
  -- tenant-create burst) would otherwise leak rows forever, since the
  -- per-bucket delete below only ever touches the CURRENT bucket. The
  -- ceiling is independent of p_window (longest caller window today is 1h)
  -- so it never shortens any bucket's own counting window.
  DELETE FROM rate_limit_hits WHERE at < now() - interval '1 day';
  DELETE FROM rate_limit_hits WHERE bucket = p_bucket AND at < now() - p_window;
  SELECT count(*) INTO v_count FROM rate_limit_hits WHERE bucket = p_bucket;
  IF v_count >= p_limit THEN
    RETURN false;
  END IF;
  INSERT INTO rate_limit_hits(bucket) VALUES (p_bucket);
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION rate_limit_check(text,integer,interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rate_limit_check(text,integer,interval) TO app;
