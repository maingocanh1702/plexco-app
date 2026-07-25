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
DO $$
DECLARE
  v_target text := NULLIF(current_setting('job_definer_bootstrap.migration_role', true), '');
BEGIN
  IF v_target IS NULL THEN
    EXECUTE format('GRANT job_definer TO %I', current_user);
  ELSE
    EXECUTE format('GRANT job_definer TO %I', v_target);
  END IF;
END
$$;
GRANT USAGE ON SCHEMA public TO job_definer;

COMMIT;
