-- ============================================================================
-- 03-identity-definer.sql
-- Privileged, idempotent bootstrap of the identity_definer role (DD-127 / DD-131 OD-3 (decisions.md,
-- pending in PR #51), option (a)): the BYPASSRLS owner of link_code_reparent_empty_person (migration
-- 0054), so the definer's emptiness scan reads FORCE-RLS tenant tables for real instead of degrading
-- every link to requires_review under a NOBYPASSRLS migration owner.
--
-- Applied to a RUNNING cluster via `pnpm db:bootstrap` (package.json), right after
-- 02-chat-definer.sql, for the reasons 01-job-definer.sql documents (CI's postgres service starts
-- before checkout; an existing local pgdata volume never re-runs init scripts). The compose init
-- mount stays a convenience for fresh volumes only.
--
-- Statement-for-statement mirror of 02-chat-definer.sql: same attribute set, same fail-closed
-- drift / member-of / runtime-role / re-point / unsafe-option / post-grant checks, same
-- COALESCE(GUC, CURRENT_USER) grant target. Only three things differ: the role name, the GUC
-- (identity_definer_bootstrap.migration_role) and the same-database advisory key ("idlk"). Read
-- 02's comments for why each guard exists; they are not repeated here. That includes 02's known
-- managed-host limitation (a non-superuser creator is auto-granted ADMIN membership, which the
-- re-point / unsafe-option checks refuse): R1, out of scope per that same OD-3.
--
-- Pre-provisioned OUTSIDE the migration runner: 0054 only ASSERTS this role (exists, exact
-- attributes, migration role is a member, no runtime role is) and then creates the function
-- inside a SET ROLE identity_definer bracket. Must NOT be added to migrate.ts's RUNTIME_ROLES.
-- ============================================================================

BEGIN;

-- 1. Idempotent, race-safe create (02 step 1).
DO $$
BEGIN
  CREATE ROLE identity_definer
    NOLOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION;
EXCEPTION
  WHEN duplicate_object OR unique_violation THEN NULL;
END
$$;

-- 2. Fail closed on attribute drift, and on identity_definer being a member of anything (02 step 2).
DO $$
DECLARE
  r record;
  v_member_of text;
BEGIN
  SELECT rolsuper, rolcanlogin, rolbypassrls, rolcreatedb, rolcreaterole, rolinherit, rolreplication
    INTO STRICT r
    FROM pg_roles WHERE rolname = 'identity_definer';
  IF r.rolsuper OR r.rolcanlogin OR NOT r.rolbypassrls OR r.rolcreatedb
     OR r.rolcreaterole OR r.rolinherit OR r.rolreplication THEN
    RAISE EXCEPTION
      'identity_definer bootstrap: existing role has unexpected attributes (need exactly NOLOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION)';
  END IF;
  SELECT g.rolname INTO v_member_of
    FROM pg_auth_members m
    JOIN pg_roles g ON g.oid = m.roleid
    JOIN pg_roles cd ON cd.oid = m.member
   WHERE cd.rolname = 'identity_definer'
   LIMIT 1;
  IF v_member_of IS NOT NULL THEN
    RAISE EXCEPTION
      'identity_definer bootstrap: identity_definer is unexpectedly a member of role % -- refusing (identity_definer must never be a member of anything, regardless of INHERIT option; this direction is never legitimate)',
      v_member_of;
  END IF;
END
$$;

-- 3. Membership grant to the GUC role, else CURRENT_USER (02 step 3, every guard kept).
DO $$
DECLARE
  v_target text := COALESCE(NULLIF(current_setting('identity_definer_bootstrap.migration_role', true), ''), current_user);
  v_existing_runtime_member text;
  v_other_member text;
BEGIN
  PERFORM pg_advisory_xact_lock(1768189035); -- 0x69646c6b, "idlk" -- distinct from "cdlk", "jdlk",
  -- "chad", "jobd" and "plxc" (see 02-chat-definer.sql for why it must not reuse a test-harness key)
  DO $lock$
  BEGIN
    LOCK TABLE pg_auth_members IN SHARE UPDATE EXCLUSIVE MODE;
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE WARNING 'identity_definer bootstrap: DEGRADED -- cannot acquire the cluster-wide serialization lock on pg_auth_members (insufficient privilege on this connection -- expected on a managed Postgres host with no true superuser). Proceeding WITHOUT the cross-database concurrency guarantee; this run depends on the operational single-bootstrap-point rule instead (docs/autopilot-definer-bootstrap-cluster-wide-serialization.md SS5.5).';
  END
  $lock$;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_target) THEN
    RAISE EXCEPTION
      'identity_definer bootstrap: migration role % does not exist', v_target;
  END IF;
  IF v_target IN ('app', 'app_worker', 'readonly') THEN
    RAISE EXCEPTION
      'identity_definer bootstrap: refusing to grant identity_definer to runtime role % — this would let it bypass the narrow function/audit boundary',
      v_target;
  END IF;
  SELECT rolname INTO v_existing_runtime_member
    FROM pg_roles
   WHERE rolname IN ('app', 'app_worker', 'readonly')
     AND pg_has_role(oid, 'identity_definer', 'MEMBER')
   LIMIT 1;
  IF v_existing_runtime_member IS NOT NULL THEN
    RAISE EXCEPTION
      'identity_definer bootstrap: identity_definer is already granted to a runtime role (app/app_worker/readonly) — revoke it before proceeding';
  END IF;
  SELECT r.rolname INTO v_other_member
    FROM pg_auth_members m
    JOIN pg_roles r ON r.oid = m.member
    JOIN pg_roles g ON g.oid = m.roleid
   WHERE g.rolname = 'identity_definer'
     AND r.rolname <> v_target
   LIMIT 1;
  IF v_other_member IS NOT NULL THEN
    RAISE EXCEPTION
      'identity_definer bootstrap: identity_definer is already granted to % — refusing to also grant it to % (revoke the existing membership first if this is an intentional re-point)',
      v_other_member, v_target;
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_auth_members m
      JOIN pg_roles r ON r.oid = m.member
      JOIN pg_roles g ON g.oid = m.roleid
     WHERE g.rolname = 'identity_definer'
       AND r.rolname = v_target
       AND (m.admin_option OR NOT m.set_option)
  ) THEN
    RAISE EXCEPTION
      'identity_definer bootstrap: existing membership for % has at least one unsafe grant record with unsafe options (admin_option or not set_option) — refusing to silently proceed',
      v_target;
  END IF;
  EXECUTE format('GRANT identity_definer TO %I', v_target);
  SELECT rolname INTO v_existing_runtime_member
    FROM pg_roles
   WHERE rolname IN ('app', 'app_worker', 'readonly')
     AND pg_has_role(oid, 'identity_definer', 'MEMBER')
   LIMIT 1;
  IF v_existing_runtime_member IS NOT NULL THEN
    RAISE EXCEPTION
      'identity_definer bootstrap: granting identity_definer to % would give runtime role % an indirect path to it — aborting',
      v_target, v_existing_runtime_member;
  END IF;
END
$$;

COMMIT;
