-- ============================================================================
-- 0037_tenant_provision_rls_self_scope.sql
-- tenant_provision() and tenant_ids_for_person() must work when their OWNER is
-- NOSUPERUSER NOBYPASSRLS — without granting BYPASSRLS to anyone.
-- Source: docs/sessions/2026-09-06-repo-audit.md D-2 (CONFIRMED by replay).
-- ----------------------------------------------------------------------------
-- WHY THIS EXISTS. Both functions are SECURITY DEFINER owned by the migration
-- role (0012, redefined in 0028). tenant_provision() INSERTs into memberships,
-- tenant_admins, subscriptions and onboarding_runs; all four are FORCE ROW
-- LEVEL SECURITY with `WITH CHECK tenant_id = app.tenant_id` (0009:51-55).
-- FORCE applies to the table owner too, and the function never set the GUC —
-- so it only ever worked because dev/test replay migrations as a superuser
-- (test-harness setupRlsTestContext), whose objects bypass RLS. Reproduced on
-- 2026-09-06 with a NOBYPASSRLS owner (setupNonSuperuserOwnerContext shape):
--
--   SELECT tenant_provision(...)  as app
--   ERROR:  new row violates row-level security policy for table "memberships"
--   SELECT * FROM tenant_ids_for_person(...)  as app   -> 0 rows
--
-- migrate.test.ts:1336-1341 already names this hazard; 0022:28-50 pins the
-- attributes of job_definer as a precondition but nothing pins the owner of
-- these two functions. On a managed Postgres whose DDL role is not BYPASSRLS,
-- POST /api/onboarding/start fails and tenantsForPerson() is empty for every
-- user. Fail-closed, no leak, but a total outage of tenant access.
--
-- FIX SHAPE — make each function scope itself, instead of relying on who owns it:
--   * tenant_provision: as soon as v_tenant is known (both the fresh-insert and
--     the idempotent re-submit path), set the txn-local tenant GUC to it, so
--     the tenant-scoped reads/writes below pass the 0009 policies under ANY
--     owner. The previous value is restored before returning so a caller's
--     transaction context is not silently re-scoped (the audit's D-15 concern).
--   * tenant_ids_for_person: it must read tenant_admins ACROSS tenants for ONE
--     person. A tenant GUC cannot express that, and giving the owner BYPASSRLS
--     is exactly what this migration refuses to do. So: one additional
--     PERMISSIVE, SELECT-only policy on tenant_admins keyed on the existing
--     `app.person_id` GUC convention (0031:289,311 — same NULLIF(...,'') shape,
--     unset => NULL => zero rows), and the function sets that GUC to its
--     argument for the duration of its own statement. Exposure is unchanged:
--     app could already call tenant_ids_for_person(<any uuid>) (audit D-8) and
--     the policy returns exactly the rows that function returns.
--
-- WHAT THIS DOES NOT DO. No BYPASSRLS anywhere. No change to 0009's
-- tenant_isolation policy. No new grant to app on any table. The function
-- signatures, grants (REVOKE ALL FROM PUBLIC / GRANT EXECUTE TO app) and
-- return shapes are byte-identical to 0028/0012.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. tenant_admins: person-scoped SELECT policy (permissive, OR-ed with the
--    tenant policy). Only SELECT — INSERT/UPDATE/DELETE stay tenant-scoped.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS tenant_admins_web_person_self ON tenant_admins;
CREATE POLICY tenant_admins_web_person_self ON tenant_admins
  FOR SELECT
  USING (
    platform = 'web'
    AND platform_user_lookup_hash = NULLIF(current_setting('app.person_id', true), '')
  );

-- ---------------------------------------------------------------------------
-- 2. tenant_ids_for_person — same signature/body semantics as 0012, but sets
--    app.person_id for its own read and restores the previous value.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION tenant_ids_for_person(p_person_id uuid)
RETURNS TABLE (tenant_id uuid, role text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_prev text := current_setting('app.person_id', true);
BEGIN
  PERFORM set_config('app.person_id', p_person_id::text, true);
  RETURN QUERY
    SELECT ta.tenant_id, ta.role
    FROM tenant_admins ta
    WHERE ta.platform = 'web'
      AND ta.platform_user_lookup_hash = p_person_id::text
      AND ta.active;
  PERFORM set_config('app.person_id', coalesce(v_prev, ''), true);
END;
$$;
REVOKE ALL ON FUNCTION tenant_ids_for_person(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenant_ids_for_person(uuid) TO app;

-- ---------------------------------------------------------------------------
-- 3. tenant_provision — body of 0028 verbatim, plus the tenant GUC bracket.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION tenant_provision(
  p_slug text, p_name text, p_timezone text, p_locale text, p_person_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid;
  v_owned boolean;
  v_conflict boolean;
  v_prev_tenant text := current_setting('app.tenant_id', true);
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

  v_conflict := (v_tenant IS NULL);
  IF v_conflict THEN
    SELECT id INTO v_tenant FROM tenants WHERE slug = p_slug;
  END IF;

  -- 0037: every tenant-scoped statement below runs under FORCE RLS regardless
  -- of who owns this function. Scope the transaction to the tenant just
  -- resolved; the caller's previous value is restored on every exit path
  -- (a RAISE aborts this block's subtransaction, which also reverts the
  -- txn-local GUC — the EXCEPTION clause restores it explicitly anyway).
  PERFORM set_config('app.tenant_id', v_tenant::text, true);

  IF v_conflict THEN
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
      PERFORM set_config('app.tenant_id', coalesce(v_prev_tenant, ''), true);
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
  -- DD-29: plan_key 'free' (was 'free_web' — see 0028 header).
  INSERT INTO subscriptions(tenant_id, plan_key, plan_version, status,
                            period_start, period_end)
  VALUES (v_tenant, 'free', 1, 'active', now(), 'infinity');

  INSERT INTO onboarding_runs(tenant_id, status) VALUES (v_tenant, 'in_progress');

  PERFORM set_config('app.tenant_id', coalesce(v_prev_tenant, ''), true);
  RETURN v_tenant;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.tenant_id', coalesce(v_prev_tenant, ''), true);
  RAISE;
END;
$$;
REVOKE ALL ON FUNCTION tenant_provision(text,text,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenant_provision(text,text,text,text,uuid) TO app;
