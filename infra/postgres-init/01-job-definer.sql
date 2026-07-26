-- ============================================================================
-- 01-job-definer.sql
-- Privileged, idempotent bootstrap of the job_definer role (DD-89/DD-90 Q5).
--
-- Applied to a RUNNING cluster via `pnpm db:bootstrap` (package.json), never relied
-- upon as a docker-entrypoint-initdb.d mount on its own:
--   - CI's postgres service container starts BEFORE actions/checkout, so the init
--     directory can never see this file there (.github/workflows/ci.yml);
--   - a pre-existing local `pgdata` volume never re-runs init scripts, so a
--     mount-only bootstrap silently no-ops on every developer's already-started stack.
-- The compose init mount (infra/docker-compose.yml) stays as a convenience for
-- genuinely fresh volumes; this file's own idempotency is what makes both paths safe.
--
-- job_definer is CLUSTER-global (like app/app_worker/readonly, packages/db/migrations/
-- 0000_roles_extensions.sql) and is pre-provisioned OUTSIDE the migration runner: the
-- 0022 migration only ASSERTS these exact attributes and membership, it never creates
-- or alters this role. Must NOT be added to migrate.ts's RUNTIME_ROLES/ensureRoleExists
-- — that idiom hard-codes LOGIN NOBYPASSRLS, which is the opposite of what this role
-- needs (DD-90 Q5).
-- ============================================================================

BEGIN;

-- 1. Idempotent, race-safe create. Mirrors packages/db/src/migrate.ts's
--    ensureRoleExists: this bootstrap runs once per cluster in CI/production, but the
--    DB test suite (vitest fileParallelism:true) may invoke it once per parallel test
--    file against the SAME cluster, so a bare CREATE + duplicate_object/unique_violation
--    swallow is required, not an IF NOT EXISTS pre-check (TOCTOU gap under real races).
DO $$
BEGIN
  CREATE ROLE job_definer
    NOLOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION;
EXCEPTION
  WHEN duplicate_object OR unique_violation THEN NULL;
END
$$;

-- 2. Fail closed on attribute drift. Runs unconditionally (creator, every race-loser,
--    and every idempotent re-run alike) so a role that exists for some OTHER reason
--    with different attributes stops the bootstrap instead of silently granting
--    BYPASSRLS-equivalent trust to the wrong thing.
DO $$
DECLARE r record;
BEGIN
  SELECT rolsuper, rolcanlogin, rolbypassrls, rolcreatedb, rolcreaterole, rolinherit, rolreplication
    INTO STRICT r
    FROM pg_roles WHERE rolname = 'job_definer';
  IF r.rolsuper OR r.rolcanlogin OR NOT r.rolbypassrls OR r.rolcreatedb
     OR r.rolcreaterole OR r.rolinherit OR r.rolreplication THEN
    RAISE EXCEPTION
      'job_definer bootstrap: existing role has unexpected attributes (need exactly NOLOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION)';
  END IF;
END
$$;

-- 3. Membership + schema usage. GRANT is idempotent (re-granting an already-held
--    privilege is a silent no-op, never an error).
--
--    codex round-06 [P1]: CURRENT_USER is only correct when the connection running this
--    file IS the migration role — true locally/CI (both bootstrap and migrate as
--    `plexco`), but NOT guaranteed in every deployment: a privileged admin connection can
--    bootstrap this role while a SEPARATE, lesser-privileged identity later runs
--    `pnpm --filter @plexco/db migrate`, which then fails 0022's membership assertion
--    with no grant ever issued to it. The caller may `SET job_definer_bootstrap.migration_role
--    = '<role>'` (a plain custom GUC — works identically whether this file is applied via
--    psql or any other client, unlike a psql-only `:variable`) before running this file to
--    grant to that role explicitly instead; unset (the common case) falls back to CURRENT_USER.
--    codex round-08 [P1]: this bootstrap is advertised idempotent and safe to re-run at any
--    time — including AFTER 0022 has already applied, when its own runtime-role denylist
--    (packages/db/migrations/0022_job_claim_lease_core.sql) can never run again to catch a bad
--    grant. A later `MIGRATION_ROLE=app_worker` (or app/readonly) re-run would otherwise succeed
--    silently, handing that LOGIN role a permanent SET ROLE job_definer path with NOTHING left
--    to reject it. Fail closed here too: refuse a runtime role as the grant TARGET, and refuse
--    to proceed if job_definer is somehow ALREADY granted to one (independent of this run).
DO $$
DECLARE
  v_target text := NULLIF(current_setting('job_definer_bootstrap.migration_role', true), '');
  v_grant_to text := COALESCE(v_target, current_user);
  v_existing_runtime_member text;
BEGIN
  IF v_grant_to IN ('app', 'app_worker', 'readonly') THEN
    RAISE EXCEPTION
      'job_definer bootstrap: refusing to grant job_definer to runtime role % — this would let it bypass the narrow function/audit boundary',
      v_grant_to;
  END IF;
  -- codex round-09 [P1]: pg_has_role raises "role ... does not exist" for an absent role name,
  -- it does NOT return false — so an unconditional pg_has_role('app', ...) aborts this bootstrap
  -- on the documented fresh-cluster path (this file runs BEFORE migration 0000 creates app/
  -- app_worker/readonly). Filter through pg_roles first: pg_has_role is then only evaluated for
  -- rolname values that already exist, so an absent runtime role is simply not a member yet.
  SELECT rolname INTO v_existing_runtime_member
    FROM pg_roles
   WHERE rolname IN ('app', 'app_worker', 'readonly')
     AND pg_has_role(rolname, 'job_definer', 'MEMBER')
   LIMIT 1;
  IF v_existing_runtime_member IS NOT NULL THEN
    RAISE EXCEPTION
      'job_definer bootstrap: job_definer is already granted to a runtime role (app/app_worker/readonly) — revoke it before proceeding';
  END IF;
  EXECUTE format('GRANT job_definer TO %I', v_grant_to);
  -- codex round-11 [P1]: the check above runs BEFORE this GRANT, so it only sees membership that
  -- predates this run. If v_grant_to is a non-runtime GROUP role a runtime role already belongs
  -- to, the pre-grant check correctly finds nothing, then this GRANT itself creates a NEW indirect
  -- path (runtime role -> v_grant_to -> job_definer, BYPASSRLS) that nothing re-verifies. Re-run
  -- the identical, transitive pg_has_role check AFTER the grant: since this whole file is one
  -- explicit transaction (BEGIN at the top), raising here rolls back the GRANT — and everything
  -- else in this run — atomically, so the vulnerable state never persists.
  SELECT rolname INTO v_existing_runtime_member
    FROM pg_roles
   WHERE rolname IN ('app', 'app_worker', 'readonly')
     AND pg_has_role(rolname, 'job_definer', 'MEMBER')
   LIMIT 1;
  IF v_existing_runtime_member IS NOT NULL THEN
    RAISE EXCEPTION
      'job_definer bootstrap: granting job_definer to % would give runtime role % an indirect path to it — aborting',
      v_grant_to, v_existing_runtime_member;
  END IF;
END
$$;
GRANT USAGE ON SCHEMA public TO job_definer;

COMMIT;
