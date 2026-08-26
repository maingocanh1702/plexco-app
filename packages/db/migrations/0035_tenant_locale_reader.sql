-- ============================================================================
-- 0035_tenant_locale_reader.sql
-- Closes the access gap that made web-i18n-runwithlang-request-context v1 ship
-- a no-op: the `app` role holds ZERO privileges on `tenants`, so a plain read
-- of tenants.locale from the web choke-point raises a permission error. v1
-- swallowed that error and returned null, and null means "fall back to vi"
-- (DD-118) — so EVERY tenant silently resolved to Vietnamese and the English
-- half of every t(vi, en) call stayed unreachable. Green lint, green typecheck
-- and 1191 green tests did not catch it, because no test ran as `app`.
--
-- Measured 2026-08-26 on base 8e668a1:
--   has_table_privilege('app','tenants','SELECT')  = false
--   GRANT statements naming `tenants`, all migrations = zero
-- 0027_resolve_tenant_status_locked.sql already states the premise in its
-- opening sentence. This migration is the same remedy for the same wall.
--
-- Mirrors the 0012/0027 pattern used for every app-restricted privileged read:
-- one narrow SECURITY DEFINER function, fixed search_path, EXECUTE granted to
-- `app` alone. READ-ONLY FOREVER — one SELECT, no UPDATE branch, no second
-- function, and NO grant on the `tenants` table itself. Granting SELECT on the
-- table would hand `app` every column of the tenant root, including the
-- status axis 0027 deliberately kept behind a function.
--
-- THREAT MODEL, stated because SECURITY DEFINER bypasses RLS by design:
--   * Exposure is one column — `locale` — for a caller that already holds an
--     app-role database seat. It is not PII, not money, not an authorization
--     input; it selects which of two hard-coded UI strings is returned.
--   * Like resolve_tenant_status_locked, this function does NOT itself prove
--     the caller's membership: it has no session context to prove it with. The
--     web choke-point resolves membership and role BEFORE calling it, and that
--     ordering is asserted by session-command-route's own tests. Adding a
--     membership join here would duplicate an authorization decision in a place
--     that cannot see the actor — a worse posture, not a better one.
--   * Worst case for a caller that skips the choke-point is learning whether
--     some tenant id renders in Vietnamese or English. That is strictly less
--     than resolve_tenant_status_locked already exposes, and it cannot be used
--     to enumerate tenants: a non-existent id and an existing id are told apart
--     only by NULL vs a value the caller must already know the id to request.
--
-- STABLE (not the default VOLATILE): a pure read with no lock. 0027 must stay
-- VOLATILE because it takes FOR SHARE; this one takes no lock at all, so the
-- planner may cache it within a statement.
--
-- Source: DD-118 · lane web-i18n-runwithlang-request-context--v2 · 0027 pattern.
-- ============================================================================

CREATE OR REPLACE FUNCTION tenant_locale(p_tenant_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT locale FROM tenants WHERE id = p_tenant_id;
$$;
REVOKE ALL ON FUNCTION tenant_locale(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenant_locale(uuid) TO app;
