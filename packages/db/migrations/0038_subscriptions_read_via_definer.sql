-- ============================================================================
-- 0038_subscriptions_read_via_definer.sql
-- Role `app` loses INSERT/UPDATE/DELETE on `subscriptions`. The two gates that
-- read it under FOR SHARE (authorizeTenantAction, resolveCapability) go through
-- one narrow SECURITY DEFINER instead — the exact 0027 shape.
-- Source: docs/sessions/2026-09-06-repo-audit.md D-1.
-- ----------------------------------------------------------------------------
-- WHY THIS EXISTS. 0009's tenant_tables loop granted `app` full DML on
-- `subscriptions` (0009:42,57). That table is the SOURCE OF TRUTH for both
-- authorization axes: authorization.ts reads `status` (suspension, DD-110 D2)
-- and capability.ts reads `(plan_key, plan_version)` (entitlements, DD-29).
-- Any `app`-role path running inside withTenant(T) — a bug, or a future
-- webhook handler (web runs webhooks as `app`) — could therefore
--   UPDATE subscriptions SET plan_key='host_pro', status='active' WHERE tenant_id=T
-- and mint host_pro entitlements / lift a suspension for its own tenant.
-- 0027 closed exactly this hole for `tenants.status` ("would reopen the write
-- path AP-40's negative scope closed") and explicitly left `subscriptions`
-- alone because its FOR SHARE read "already works for app". It works because
-- of the grant this migration removes.
--
-- WHY A DEFINER AND NOT A PLAIN REVOKE. PostgreSQL requires UPDATE privilege
-- for any row-locking clause, FOR SHARE included (the 0027 lesson). Revoking
-- UPDATE alone would break both gates. So the FOR SHARE read moves into a
-- SECURITY DEFINER that `app` may EXECUTE; the row lock it takes still belongs
-- to the caller's transaction, so the "pin the binding until the money action
-- commits" property both gates document is unchanged.
--
-- FAIL-CLOSED TENANT BINDING. Unlike 0027 (any tenant id, status only), this
-- function refuses a p_tenant_id that differs from the caller's app.tenant_id
-- — the 0033 raise_public_session_fence shape. Both callers set that GUC to the
-- same value immediately before reading, so no behaviour changes for them; a
-- caller that has not scoped its transaction gets insufficient_privilege, not
-- another tenant's row.
--
-- WHAT THIS DOES NOT DO. No change to the allow-sets, the ActionClass enum, the
-- Suspended Action Matrix, 0027, or tenant_provision (the only writer, a
-- SECURITY DEFINER owned by the migration role — unaffected by an `app`
-- REVOKE). `app` keeps SELECT (tenant-scoped by RLS) for future billing UI.
-- ============================================================================

CREATE OR REPLACE FUNCTION resolve_subscription_locked(p_tenant_id uuid)
RETURNS TABLE (status text, plan_key text, plan_version integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_tenant_id IS NULL
     OR p_tenant_id IS DISTINCT FROM NULLIF(current_setting('app.tenant_id', true), '')::uuid THEN
    RAISE EXCEPTION 'resolve_subscription_locked: tenant % is not the transaction''s app.tenant_id',
      p_tenant_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
    SELECT s.status, s.plan_key, s.plan_version
    FROM subscriptions s
    WHERE s.tenant_id = p_tenant_id
    FOR SHARE;
END;
$$;
REVOKE ALL ON FUNCTION resolve_subscription_locked(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_subscription_locked(uuid) TO app;

REVOKE INSERT, UPDATE, DELETE ON subscriptions FROM app;
