-- ============================================================================
-- 02-chat-definer.sql
-- Privileged, idempotent bootstrap of the chat_definer role (in-app-chat primary-
-- player-surface plan, slice `chat-definer-role-provisioning`, plan §9.2).
--
-- Applied to a RUNNING cluster via `pnpm db:bootstrap` (package.json), immediately
-- after 01-job-definer.sql, for the exact same two reasons that file documents:
--   - CI's postgres service container starts BEFORE actions/checkout, so the init
--     directory can never see this file there (.github/workflows/ci.yml);
--   - a pre-existing local `pgdata` volume never re-runs init scripts, so a
--     mount-only bootstrap silently no-ops on every developer's already-started stack.
-- The compose init mount (infra/docker-compose.yml) stays a convenience for genuinely
-- fresh volumes; this file's own idempotency is what makes both paths safe.
--
-- chat_definer is CLUSTER-global (like job_definer, app/app_worker/readonly) and is
-- pre-provisioned OUTSIDE the migration runner: the future dd38-dd86-chat-schema-core
-- migration only ASSERTS/consumes these exact attributes and membership via
-- `ALTER FUNCTION ... OWNER TO chat_definer`; it never creates or alters this role.
-- Must NOT be added to migrate.ts's RUNTIME_ROLES/ensureRoleExists — that idiom
-- hard-codes LOGIN NOBYPASSRLS, the opposite of what a definer role needs (mirrors
-- DD-89/DD-90 Q5's job_definer precedent exactly).
--
-- Grant-target resolution deliberately mirrors 01-job-definer.sql's own
-- COALESCE(GUC, CURRENT_USER) fallback rather than requiring the GUC unconditionally.
-- That file's own codex round-06 [P1] comment (lines 59-67) already settled this exact
-- question for job_definer: an explicit MIGRATION_ROLE grants to that role; unset (the
-- common case, true for both CI and local dev today) falls back to CURRENT_USER. This
-- slice inherits that ruling rather than re-deriving it — see contract doc §5.4.
-- What is new relative to job_definer: (a) an EXPLICIT pg_roles existence check on the
-- resolved target, giving a clear "migration role % does not exist" error instead of
-- relying on the native GRANT statement's generic Postgres error; (b) a guard against
-- re-pointing — job_definer's own script (see its codex round-08 [P1] comment, lines
-- 68-74) only refuses a RUNTIME-role re-target; it does not stop a re-run with a
-- DIFFERENT non-runtime role from silently ACCUMULATING a second member alongside the
-- first. chat_definer closes that gap: it fails closed if it is already granted to any
-- role other than the one being resolved right now (contract doc §5.4).
-- ============================================================================

BEGIN;

-- 1. Idempotent, race-safe create. Mirrors migrate.ts's ensureRoleExists / 01-job-
--    definer.sql: a bare CREATE + duplicate_object/unique_violation swallow, not an
--    IF NOT EXISTS pre-check (TOCTOU gap under real concurrent bootstrap calls).
DO $$
BEGIN
  CREATE ROLE chat_definer
    NOLOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION;
EXCEPTION
  WHEN duplicate_object OR unique_violation THEN NULL;
END
$$;

-- 2. Fail closed on attribute drift. Runs unconditionally (creator, every race-loser,
--    and every idempotent re-run alike) so a role that exists for some OTHER reason
--    with different attributes stops the bootstrap instead of silently granting
--    BYPASSRLS-equivalent trust to the wrong thing. Bootstrap never silently ALTERs
--    an existing role to "fix" it — that is an operator decision, not this script's.
DO $$
DECLARE r record;
BEGIN
  SELECT rolsuper, rolcanlogin, rolbypassrls, rolcreatedb, rolcreaterole, rolinherit, rolreplication
    INTO STRICT r
    FROM pg_roles WHERE rolname = 'chat_definer';
  IF r.rolsuper OR r.rolcanlogin OR NOT r.rolbypassrls OR r.rolcreatedb
     OR r.rolcreaterole OR r.rolinherit OR r.rolreplication THEN
    RAISE EXCEPTION
      'chat_definer bootstrap: existing role has unexpected attributes (need exactly NOLOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION)';
  END IF;
END
$$;

-- 3. Membership grant. GRANT is idempotent (re-granting an already-held privilege is
--    a silent no-op). Grant target resolves to the GUC if set, else CURRENT_USER —
--    see the header comment and contract §5.4 for why an unset GUC is safe here,
--    unlike a runtime-role or nonexistent-role target, which both fail closed below.
DO $$
DECLARE
  v_target text := COALESCE(NULLIF(current_setting('chat_definer_bootstrap.migration_role', true), ''), current_user);
  v_existing_runtime_member text;
  v_other_member text;
  v_existing_admin boolean;
  v_existing_set boolean;
BEGIN
  -- Serialize the whole check-then-grant decision against ANY concurrent invocation of this script,
  -- regardless of target. Without this, two concurrent calls targeting DIFFERENT valid non-runtime
  -- roles can each observe zero existing chat_definer members (neither has committed yet), pass the
  -- re-pointing guard below, and both GRANT their own distinct target -- the exact accumulation that
  -- guard exists to prevent, just reached via a race instead of a sequential re-run. Transaction-
  -- scoped (auto-released at COMMIT/ROLLBACK, no matching unlock needed).
  --
  -- DELIBERATELY A DIFFERENT KEY from CHAT_DEFINER_LOCK_KEY (migrate.test.ts, "chad") / the
  -- withChatDefinerLock() test harness, not a reuse of it -- the two serve different purposes and
  -- MUST NOT share a key. withChatDefinerLock holds a SESSION-scoped lock on ONE dedicated connection
  -- for an entire test body's duration, external to this script. If this in-script lock used the SAME
  -- key, any test connection OTHER than that dedicated one (i.e. every real test in this suite) would
  -- block forever waiting for a lock the test harness's own connection is holding and will not release
  -- until the test body -- which is itself awaiting this very call -- returns: a guaranteed deadlock,
  -- caught in practice by a 60s Vitest test timeout (codex round-03 fix, self-discovered before commit).
  PERFORM pg_advisory_xact_lock(1667525739); -- 0x63646c6b, "cdlk" -- distinct from "chad" (0x63686164), "jobd" (0x6a6f6264), "plxc" (0x706c7863)
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_target) THEN
    RAISE EXCEPTION
      'chat_definer bootstrap: migration role % does not exist', v_target;
  END IF;
  IF v_target IN ('app', 'app_worker', 'readonly') THEN
    RAISE EXCEPTION
      'chat_definer bootstrap: refusing to grant chat_definer to runtime role % — this would let it bypass the narrow function/audit boundary',
      v_target;
  END IF;
  -- pg_has_role raises "role ... does not exist" for an absent role name rather than
  -- returning false (the exact hazard 01-job-definer.sql documents) — filter through
  -- pg_roles first so an absent runtime role is simply not a member yet.
  SELECT rolname INTO v_existing_runtime_member
    FROM pg_roles
   WHERE rolname IN ('app', 'app_worker', 'readonly')
     AND pg_has_role(rolname, 'chat_definer', 'MEMBER')
   LIMIT 1;
  IF v_existing_runtime_member IS NOT NULL THEN
    RAISE EXCEPTION
      'chat_definer bootstrap: chat_definer is already granted to a runtime role (app/app_worker/readonly) — revoke it before proceeding';
  END IF;
  -- Refuse to re-point: 01-job-definer.sql's own re-run guard (codex round-08 [P1])
  -- only refuses a RUNTIME-role re-target, so a re-run of that file with a DIFFERENT
  -- non-runtime role silently ACCUMULATES a second member there. chat_definer fails
  -- closed instead: it must already have no member, or only v_target itself (exact
  -- replay), before granting — a genuinely different target is an operator decision
  -- (revoke the old membership first), never a silent multi-member back door.
  SELECT r.rolname INTO v_other_member
    FROM pg_auth_members m
    JOIN pg_roles r ON r.oid = m.member
    JOIN pg_roles g ON g.oid = m.roleid
   WHERE g.rolname = 'chat_definer'
     AND r.rolname <> v_target
   LIMIT 1;
  IF v_other_member IS NOT NULL THEN
    RAISE EXCEPTION
      'chat_definer bootstrap: chat_definer is already granted to % — refusing to also grant it to % (revoke the existing membership first if this is an intentional re-point)',
      v_other_member, v_target;
  END IF;
  -- Fail closed on unsafe membership OPTIONS surviving an idempotent re-run. PostgreSQL 16's own
  -- GRANT documentation: "When altering an existing membership the omission of an option results
  -- in the current value being retained" — so this script's own bare GRANT below (no WITH clause)
  -- never resets ADMIN/SET on a membership that already exists for v_target, whether that
  -- membership came from an earlier run of this same script (safe: a bare GRANT's own defaults are
  -- ADMIN=false, SET=true) or from an out-of-band GRANT issued directly against the cluster (unsafe
  -- if it set ADMIN TRUE — v_target could then re-grant chat_definer to anything, including a
  -- runtime role, with none of this script's checks in the loop — or SET FALSE, which would silently
  -- break the downstream migration's expected SET ROLE chat_definer capability). Mirrors the
  -- existing attribute-drift philosophy exactly: detect and refuse, never silently re-GRANT WITH the
  -- safe options to "fix" it — that is an operator decision, not this script's.
  SELECT m.admin_option, m.set_option
    INTO v_existing_admin, v_existing_set
    FROM pg_auth_members m
    JOIN pg_roles r ON r.oid = m.member
    JOIN pg_roles g ON g.oid = m.roleid
   WHERE g.rolname = 'chat_definer'
     AND r.rolname = v_target;
  IF FOUND AND (v_existing_admin OR NOT v_existing_set) THEN
    RAISE EXCEPTION
      'chat_definer bootstrap: existing membership for % has unsafe options (admin_option=%, set_option=%; need admin_option=false, set_option=true) — refusing to silently proceed',
      v_target, v_existing_admin, v_existing_set;
  END IF;
  EXECUTE format('GRANT chat_definer TO %I', v_target);
  -- Re-run the identical transitive check AFTER the grant: if v_target is a
  -- non-runtime GROUP role a runtime role already belongs to, this GRANT itself
  -- creates a NEW indirect path (runtime role -> v_target -> chat_definer,
  -- BYPASSRLS). Raising here rolls back the GRANT (and this whole file) atomically,
  -- since the whole script is one explicit transaction (BEGIN at the top).
  SELECT rolname INTO v_existing_runtime_member
    FROM pg_roles
   WHERE rolname IN ('app', 'app_worker', 'readonly')
     AND pg_has_role(rolname, 'chat_definer', 'MEMBER')
   LIMIT 1;
  IF v_existing_runtime_member IS NOT NULL THEN
    RAISE EXCEPTION
      'chat_definer bootstrap: granting chat_definer to % would give runtime role % an indirect path to it — aborting',
      v_target, v_existing_runtime_member;
  END IF;
END
$$;

COMMIT;
