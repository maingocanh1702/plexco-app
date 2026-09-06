-- ============================================================================
-- 0039_audit_hardening_definers_ledger_link_codes.sql
-- Audit 2026-09-06 (docs/sessions/2026-09-06-repo-audit.md) — P3 schema items
-- D-7 · D-8 (the one function that HAS a tenant context to assert) · D-9 ·
-- D-12 · W-8 (db half). Expand-only; no data rewrite; every new CHECK is named
-- and mirrored in packages/db/schema.ts (rls-invariants "regression guard —
-- prevents a 28th unnamed CHECK").
-- ============================================================================

-- ---------------------------------------------------------------------------
-- D-7 — 0010's two oauth_transactions definers set `search_path = public`
-- WITHOUT pg_temp. 0022:12-19 explains in this repo's own words why that is
-- not enough: a caller can create a temp object that shadows a public one
-- and the definer resolves the caller's object first. Same bodies, corrected
-- search_path. Both functions have ZERO TypeScript callers today (measured
-- 2026-09-06: git grep over packages/ apps/ → 0), so this is a posture fix
-- ahead of the Zalo/connector onboarding lane that will call them.
--
-- D-8 — create_oauth_transaction(p_tenant_id) accepted ANY tenant id from the
-- app role. It is tenant-scoped connector work (0010 header), so the tenant
-- context exists and can be asserted, in the 0033/0038 shape:
-- p_tenant_id must equal app.tenant_id or the call is refused. The two
-- LOGIN-path definers the audit also names (auth_create_web_session,
-- auth_oauth_handoff_arm) have no tenant/account context to assert against
-- before login completes — that IS the trusted-server design and is left as
-- such (documented, not changed).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_oauth_transaction(
  p_state text, p_tenant_id uuid, p_provider text,
  p_code_verifier_enc bytea, p_redirect_uri text, p_created_by uuid,
  p_ttl interval DEFAULT interval '10 minutes'
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_tenant_id IS NULL
     OR p_tenant_id IS DISTINCT FROM NULLIF(current_setting('app.tenant_id', true), '')::uuid THEN
    RAISE EXCEPTION 'create_oauth_transaction: p_tenant_id must equal the current app.tenant_id'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO oauth_transactions(state, tenant_id, provider, code_verifier_enc,
                                 redirect_uri, created_by, expires_at)
  VALUES (p_state, p_tenant_id, p_provider, p_code_verifier_enc,
          p_redirect_uri, p_created_by, now() + p_ttl);
END;
$$;
REVOKE ALL ON FUNCTION create_oauth_transaction(text,uuid,text,bytea,text,uuid,interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_oauth_transaction(text,uuid,text,bytea,text,uuid,interval) TO app;

CREATE OR REPLACE FUNCTION consume_oauth_transaction(p_state text)
RETURNS TABLE (tenant_id uuid, provider text, code_verifier_enc bytea, redirect_uri text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM oauth_transactions WHERE state = p_state FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  DELETE FROM oauth_transactions WHERE state = p_state;     -- single-use
  -- clock_timestamp(), not now(): now() is frozen at this transaction's start and does NOT advance
  -- across the FOR UPDATE wait above, so a consume that queued on the row lock just before expiry
  -- and resumed after it would still read as unexpired and hand back the transaction. Same reason
  -- 0015 gives for auth_rotate_web_session (codex round-09 [P2]).
  IF r.expires_at < clock_timestamp() THEN RETURN; END IF;  -- expired -> empty
  tenant_id := r.tenant_id; provider := r.provider;
  code_verifier_enc := r.code_verifier_enc; redirect_uri := r.redirect_uri;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION consume_oauth_transaction(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION consume_oauth_transaction(text) TO app;

-- ---------------------------------------------------------------------------
-- D-9 — link_codes: the DD-50 shape the Reviewed identity spec pins
-- (feature_identity_tech.md §2 DDL, "Delta còn thiếu so với live schema").
-- Expand only: source_channel_identity_id becomes nullable so the XOR with
-- the new source_account_id can hold; max_attempts/locked_until/revoked_at
-- added with the spec's defaults. No consume runtime exists yet
-- (identity-link-code-issue-consume), so no row can be in a state the new
-- CHECKs reject; the XOR CHECK is added directly (empty table in every
-- environment measured — 0 writers on main).
-- ---------------------------------------------------------------------------
ALTER TABLE link_codes
  ALTER COLUMN source_channel_identity_id DROP NOT NULL,
  ADD COLUMN source_account_id uuid REFERENCES accounts(id),
  ADD COLUMN max_attempts integer NOT NULL DEFAULT 5,
  ADD COLUMN locked_until timestamptz,
  ADD COLUMN revoked_at timestamptz;
ALTER TABLE link_codes
  ADD CONSTRAINT link_codes_max_attempts_chk CHECK (max_attempts BETWEEN 1 AND 20),
  ADD CONSTRAINT link_codes_issuer_xor_chk
    CHECK (num_nonnulls(source_channel_identity_id, source_account_id) = 1);
CREATE INDEX idx_link_codes_source_account ON link_codes(source_account_id)
  WHERE source_account_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- D-12 — two ledger FKs bind the tenant but not the aggregate:
--   charges(tenant_id, player_id) proves the player is the tenant's, not that
--   the player belongs to charges.session_id (session-service.ts:2139-2143
--   admits it in a comment). A charge for session S pointing at a player of
--   session T is now unrepresentable.
--   payment_allocations.reverses_allocation_id proves the reversed row is the
--   tenant's, not that it is on the SAME charge. A reversal "reversing" an
--   allocation of a different charge is now unrepresentable.
-- Both need a UNIQUE candidate key on the parent; both are additive.
-- ---------------------------------------------------------------------------
ALTER TABLE players
  ADD CONSTRAINT players_tenant_session_candidate_key UNIQUE (tenant_id, session_id, id);
ALTER TABLE charges
  ADD CONSTRAINT charges_tenant_session_player_fk
    FOREIGN KEY (tenant_id, session_id, player_id)
    REFERENCES players(tenant_id, session_id, id);

ALTER TABLE payment_allocations
  ADD CONSTRAINT payment_allocations_tenant_charge_candidate_key UNIQUE (tenant_id, charge_id, id);
ALTER TABLE payment_allocations
  ADD CONSTRAINT payment_allocations_reversal_same_charge_fk
    FOREIGN KEY (tenant_id, charge_id, reverses_allocation_id)
    REFERENCES payment_allocations(tenant_id, charge_id, id);

-- ---------------------------------------------------------------------------
-- W-8 (db half) — tenants.name had no length bound (0002:13); the route
-- trims and rejects empty but accepts anything else. 120 chars matches the
-- club-name field on every surface spec; the route mirrors the same number.
-- ---------------------------------------------------------------------------
ALTER TABLE tenants
  ADD CONSTRAINT tenants_name_len_chk CHECK (char_length(name) BETWEEN 1 AND 120);
