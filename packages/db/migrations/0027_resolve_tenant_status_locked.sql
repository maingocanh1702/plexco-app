-- ============================================================================
-- 0027_resolve_tenant_status_locked.sql
-- Closes the access gap authorize-tenant-action-core (AP-40, authorization.ts)
-- left open on purpose: the `app` role holds zero privileges on `tenants`,
-- and a plain SELECT privilege would not be enough — PostgreSQL requires
-- UPDATE privilege for any row-locking clause, FOR SHARE included, not just
-- SELECT. Adding UPDATE privilege on the table directly would instead reopen
-- exactly the write path AP-40's negative scope closed: tenants.status is
-- the tenant-root hard-override axis, and the trust-safety mechanism that
-- must own both set and clear of that column together does not exist yet.
--
-- Mirrors the 0012 pattern used for every other app-restricted privileged
-- read: one narrow SECURITY DEFINER function, fixed search_path, EXECUTE
-- privilege given to `app` alone below. This function is READ-ONLY forever —
-- one SELECT ... FOR SHARE, no UPDATE branch. `subscriptions` is unaffected:
-- it already has full table privileges via 0009's tenant_tables loop, so its
-- own FOR SHARE read in authorization.ts already works for `app` today and
-- needs no wrapper here.
--
-- Source: AP-43 slice doc.
-- ============================================================================

CREATE OR REPLACE FUNCTION resolve_tenant_status_locked(p_tenant_id uuid)
RETURNS TABLE (status text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT status FROM tenants WHERE id = p_tenant_id FOR SHARE;
$$;
REVOKE ALL ON FUNCTION resolve_tenant_status_locked(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_tenant_status_locked(uuid) TO app;
