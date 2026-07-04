-- ============================================================================
-- 0010_functions_triggers.sql
-- Narrow privileged functions (worker), OAuth bootstrap functions, and
-- append-only ledger enforcement.
-- Source: TDD §3.4 (worker contract), feature_connector_onboarding_tech §4.3,
--         core-db-principles P4/P5/P9/P10, BL-PAY-8.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Worker: claim a batch of unclaimed outbox events across tenants WITHOUT
-- bypassing RLS broadly. SECURITY DEFINER + fixed search_path; returns only
-- routing metadata (event_id, tenant_id, aggregate). The job then re-enters
-- tenant context (SET LOCAL app.tenant_id) before reading business data.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION claim_outbox_batch(p_limit integer DEFAULT 100)
RETURNS TABLE (event_id uuid, tenant_id uuid, aggregate_id uuid, sequence integer, type text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH claimed AS (
    SELECT id
    FROM outbox_events
    WHERE claimed_at IS NULL
    ORDER BY created_at
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE outbox_events o
  SET claimed_at = now()
  FROM claimed c
  WHERE o.id = c.id
  RETURNING o.id, o.tenant_id, o.aggregate_id, o.sequence, o.type;
$$;
REVOKE ALL ON FUNCTION claim_outbox_batch(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_outbox_batch(integer) TO app_worker;

-- ---------------------------------------------------------------------------
-- OAuth bootstrap (no cookie/tenant context at callback time). The app role
-- cannot SELECT oauth_transactions directly; only these functions touch it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_oauth_transaction(
  p_state text, p_tenant_id uuid, p_provider text,
  p_code_verifier_enc bytea, p_redirect_uri text, p_created_by uuid,
  p_ttl interval DEFAULT interval '10 minutes'
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO oauth_transactions(state, tenant_id, provider, code_verifier_enc,
                                 redirect_uri, created_by, expires_at)
  VALUES (p_state, p_tenant_id, p_provider, p_code_verifier_enc,
          p_redirect_uri, p_created_by, now() + p_ttl);
$$;
REVOKE ALL ON FUNCTION create_oauth_transaction(text,uuid,text,bytea,text,uuid,interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_oauth_transaction(text,uuid,text,bytea,text,uuid,interval) TO app;

-- Single-use consume: lock by state, TTL check, delete, return tenant + verifier.
CREATE OR REPLACE FUNCTION consume_oauth_transaction(p_state text)
RETURNS TABLE (tenant_id uuid, provider text, code_verifier_enc bytea, redirect_uri text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM oauth_transactions WHERE state = p_state FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  DELETE FROM oauth_transactions WHERE state = p_state;     -- single-use
  IF r.expires_at < now() THEN RETURN; END IF;             -- expired -> empty
  tenant_id := r.tenant_id; provider := r.provider;
  code_verifier_enc := r.code_verifier_enc; redirect_uri := r.redirect_uri;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION consume_oauth_transaction(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION consume_oauth_transaction(text) TO app;

-- ---------------------------------------------------------------------------
-- Append-only ledger enforcement (BL-PAY-8 / INV-4 / INV-10).
-- Corrections must use reversal rows, not destructive edits.
-- ---------------------------------------------------------------------------

-- payment_allocations: pure append-only. INSERT only; UPDATE/DELETE forbidden.
CREATE OR REPLACE FUNCTION forbid_allocation_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'payment_allocations is append-only (% blocked); use a reversal row', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;
CREATE TRIGGER trg_payment_allocations_immutable
  BEFORE UPDATE OR DELETE ON payment_allocations
  FOR EACH ROW EXECUTE FUNCTION forbid_allocation_mutation();

-- bank_transactions: the original financial facts are immutable, but the
-- derived counters (unallocated_amount, reconcile_status) are maintained by the
-- allocation service under row lock. Freeze the immutable columns; forbid DELETE.
CREATE OR REPLACE FUNCTION forbid_bank_txn_core_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'bank_transactions rows cannot be deleted (audit)'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.amount          IS DISTINCT FROM OLD.amount
     OR NEW.external_id  IS DISTINCT FROM OLD.external_id
     OR NEW.provider     IS DISTINCT FROM OLD.provider
     OR NEW.bank_account_id IS DISTINCT FROM OLD.bank_account_id
     OR NEW.occurred_at  IS DISTINCT FROM OLD.occurred_at
     OR NEW.raw_payload_enc IS DISTINCT FROM OLD.raw_payload_enc THEN
    RAISE EXCEPTION 'bank_transactions core financial fields are immutable'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_bank_transactions_core_immutable
  BEFORE UPDATE OR DELETE ON bank_transactions
  FOR EACH ROW EXECUTE FUNCTION forbid_bank_txn_core_change();

-- charges.amount_allocated/status are updated under row lock by the allocation
-- service, so charges is intentionally NOT frozen.
