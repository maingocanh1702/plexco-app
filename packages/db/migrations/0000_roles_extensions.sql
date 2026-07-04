-- ============================================================================
-- 0000_roles_extensions.sql
-- Plexco core DB — roles, extensions, RLS GUC convention.
-- Source: docs/core/TDD.md §3.4, docs/standards/core-db-architecture-principles.md
--         docs/features/BE/feature_multi_tenant_tech.md
-- ----------------------------------------------------------------------------
-- Three runtime roles (INV-1, BL-TEN-1, BL-TEN-5):
--   app        = HTTP/bot runtime. NOBYPASSRLS. Tenant tables only via RLS.
--   app_worker = scheduler/outbox. EXECUTE narrow functions + queue metadata.
--   readonly   = discovery process. SELECT only on public_sessions / public views.
--   migration  = DDL owner (not used at runtime).
-- RLS tenant context is set per-transaction with:  SET LOCAL app.tenant_id = '<uuid>'
-- Missing GUC -> current_setting(...,true) returns NULL -> 0 rows (fail-closed).
-- ============================================================================

-- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---- Roles (idempotent) ----------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app') THEN
    CREATE ROLE app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_worker') THEN
    CREATE ROLE app_worker LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly') THEN
    CREATE ROLE readonly LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

-- Default: no privileges. Grants are issued explicitly in 0009_rls_policies_grants.sql.
-- Schema usage (objects live in public schema).
GRANT USAGE ON SCHEMA public TO app, app_worker, readonly;

-- Do NOT grant blanket table privileges here. See 0009.
