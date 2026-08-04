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
-- migration transfers ownership to it via `ALTER FUNCTION ... OWNER TO chat_definer`,
-- which mechanically requires the role to EXIST (SET ROLE-eligible + schema CREATE
-- privilege) but does NOT re-validate NOLOGIN/BYPASSRLS/other attributes
-- (postgresql.org/docs/16/sql-alterfunction.html: "you must be able to SET ROLE to
-- the new owning role, and that role must have CREATE privilege on the function's
-- schema") -- those are guaranteed by THIS bootstrap's own fail-closed attribute-drift
-- check (block 2 below), not re-asserted downstream. It never creates or alters this role.
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
  --
  -- KNOWN, ACCEPTED BOUNDARY (codex round-04 [P1]): this lock -- like every PostgreSQL advisory lock
  -- -- only serializes callers connected to the SAME database ("Advisory locks are local to each
  -- database" -- postgresql.org/docs/16/explicit-locking.html). chat_definer itself is cluster-global
  -- (pg_authid is a documented SHARED catalog, one copy per cluster, not per database --
  -- postgresql.org/docs/16/catalog-pg-authid.html), so two bootstrap invocations against DIFFERENT
  -- databases in the same cluster are not serialized by this lock and could in principle still race.
  -- Matches 01-job-definer.sql's own advisory-lock scope exactly (the identical limitation, never
  -- required to be closed for that role) and this application's actual deployment model, which does
  -- not run multiple databases per cluster in normal operation. A cluster-wide fix exists in
  -- principle (SERIALIZABLE isolation with caller-side retry -- the underlying pg_auth_members rows
  -- ARE shared, so PostgreSQL's own conflict detection would correctly span databases) but would
  -- require new retry logic in package.json's plain `psql` invocation that exists nowhere else in
  -- this codebase's bootstrap tooling; deliberately deferred rather than built here.
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
  --
  -- Checks EXISTENCE across ALL matching records, not one arbitrary row (codex round-04 [P1]):
  -- PostgreSQL 16 allows MULTIPLE pg_auth_members rows for the same (role, member) pair from
  -- different grantors ("Allow multiple role membership records" — PG16 release notes; pre-16 a new
  -- grant replaced the prior row instead). A single non-STRICT SELECT INTO with no ORDER BY would
  -- pick an arbitrary one of them, silently missing an unsafe record left by a DIFFERENT grantor if
  -- the arbitrary pick happened to be the safe one.
  IF EXISTS (
    SELECT 1
      FROM pg_auth_members m
      JOIN pg_roles r ON r.oid = m.member
      JOIN pg_roles g ON g.oid = m.roleid
     WHERE g.rolname = 'chat_definer'
       AND r.rolname = v_target
       AND (m.admin_option OR NOT m.set_option)
  ) THEN
    RAISE EXCEPTION
      'chat_definer bootstrap: existing membership for % has at least one unsafe grant record with unsafe options (admin_option or not set_option) — refusing to silently proceed',
      v_target;
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
