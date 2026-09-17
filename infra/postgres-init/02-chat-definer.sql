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
--
--    Also fails closed on chat_definer being a MEMBER of any other role (codex round
--    12 [P1], this registration): PostgreSQL 16 lets a per-grant `WITH INHERIT TRUE`
--    override this role's own NOINHERIT for that one membership
--    (postgresql.org/docs/16/role-attributes.html: "inheritance can be overridden for
--    individual grants") -- so a role that reads NOLOGIN NOSUPERUSER BYPASSRLS ...
--    NOINHERIT correctly above can still silently inherit another role's privileges
--    through such a grant, invisible to the attribute check alone. The correct
--    invariant here is directional, not a list to keep current: this script only ever
--    grants membership INTO chat_definer (the migration role becomes its member) --
--    chat_definer being a member OF anything else is never legitimate, regardless of
--    which role or which INHERIT option the grant used.
DO $$
DECLARE
  r record;
  v_member_of text;
BEGIN
  SELECT rolsuper, rolcanlogin, rolbypassrls, rolcreatedb, rolcreaterole, rolinherit, rolreplication
    INTO STRICT r
    FROM pg_roles WHERE rolname = 'chat_definer';
  IF r.rolsuper OR r.rolcanlogin OR NOT r.rolbypassrls OR r.rolcreatedb
     OR r.rolcreaterole OR r.rolinherit OR r.rolreplication THEN
    RAISE EXCEPTION
      'chat_definer bootstrap: existing role has unexpected attributes (need exactly NOLOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION)';
  END IF;
  SELECT g.rolname INTO v_member_of
    FROM pg_auth_members m
    JOIN pg_roles g ON g.oid = m.roleid
    JOIN pg_roles cd ON cd.oid = m.member
   WHERE cd.rolname = 'chat_definer'
   LIMIT 1;
  IF v_member_of IS NOT NULL THEN
    RAISE EXCEPTION
      'chat_definer bootstrap: chat_definer is unexpectedly a member of role % -- refusing (chat_definer must never be a member of anything, regardless of INHERIT option; this direction is never legitimate)',
      v_member_of;
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
  -- Cluster-wide serialization (definer-bootstrap-cluster-wide-serialization, 2026-08-05): roles and
  -- pg_auth_members are CLUSTER-shared, not database-local, so a concurrent bootstrap of this same role
  -- from a DIFFERENT database in this cluster is a real, measured race this file had zero protection
  -- against (not even same-database -- that gap was chat_definer-only). Measured against a live cluster
  -- before choosing this mechanism: pg_advisory_xact_lock is documented+confirmed database-local;
  -- SERIALIZABLE isolation does NOT detect this specific conflict (verified empirically -- two concurrent
  -- SERIALIZABLE transactions from different databases both committed a GRANT to distinct targets with no
  -- serialization_failure -- this corrects the "SERIALIZABLE isolation with caller-side retry... exists in
  -- principle" claim the merge commit deferring this fix originally made; see docs/autopilot-definer-
  -- bootstrap-cluster-wide-serialization.md SS5.2); a row-level FOR UPDATE lock on a shared-catalog row
  -- does NOT block cross-database despite the catalog's storage being physically shared (verified
  -- empirically, SS5.3). A RELATION-level LOCK on a shared catalog DOES block cross-database (verified
  -- empirically, SS5.4) and, at SHARE UPDATE EXCLUSIVE, self-conflicts without blocking ordinary
  -- GRANT/REVOKE elsewhere (which take ROW EXCLUSIVE -- confirmed non-conflicting).
  --
  -- Requires a true superuser connection -- confirmed no ACL grant or pg_write_all_data membership
  -- substitutes (SS5.4). This application's actual production host, DigitalOcean Managed PostgreSQL, NEVER
  -- grants superuser -- a product constraint, not a config gap (docs.digitalocean.com/products/databases/
  -- postgresql/how-to/modify-user-privileges/: doadmin's attributes are exactly Create role, Create DB,
  -- Replication, Bypass RLS -- no Superuser, confirmed 2026-08-05). This statement WILL fail there. It
  -- fails OPEN, not silently and not fatally: catches insufficient_privilege specifically (SQLSTATE 42501,
  -- never any other error class) and announces the degraded run via RAISE WARNING, loud in every
  -- deployment/CI log capturing this script's output. This LOCK statement is the ONLY superuser-specific
  -- requirement in this file -- doadmin's own Bypass RLS attribute is exactly what CREATE ROLE ...
  -- BYPASSRLS requires of its creator (verified empirically against a role shaped exactly like doadmin's
  -- documented attribute set, SS5.4.1). That does NOT mean the overall bootstrap SUCCEEDS under doadmin,
  -- unlike 01-job-definer.sql's identical claim (true there): a SEPARATE, pre-existing check further down
  -- this same block (the unsafe-membership-options / re-pointing logic below, unrelated to superuser
  -- privilege) currently refuses every fresh, non-superuser-created chat_definer unconditionally --
  -- confirmed empirically, see docs/autopilot-definer-bootstrap-cluster-wide-serialization.md SS10 item 7
  -- for the full writeup. Not fixed here -- out of this slice's negative scope (SS8).
  --
  -- TWO-LAYER design, added round-01 codex review (2026-08-05): this LOCK TABLE statement alone gives
  -- ZERO protection on the one host it cannot mechanically take its lock on -- the exact production host
  -- this bootstrap targets, and this file previously had SOME protection there (the original
  -- pg_advisory_xact_lock below, database-local but needing no elevated privilege) that a LOCK-TABLE-only
  -- design would have silently thrown away on exactly the host that matters most. Restored, unconditional,
  -- taken FIRST, before this statement: it needs no privilege beyond ordinary connect rights and always
  -- succeeds for any authenticated role, so it guarantees AT LEAST same-database serialization on every
  -- host. LOCK TABLE then attempts to UPGRADE that to cluster-wide serialization when the connection can
  -- take it (local/CI/docker-compose today; never on DigitalOcean). Layered, not either/or: on a
  -- superuser connection both locks are held (redundant, harmless); on a degraded connection only the
  -- advisory lock holds, which is still strictly better than zero. On a host where the cluster-wide
  -- upgrade cannot be taken, cluster-wide safety (beyond the same-database floor this advisory lock
  -- guarantees) depends on an OPERATIONAL rule: this bootstrap runs from exactly one place, never
  -- concurrently, against that cluster -- see docs/autopilot-definer-bootstrap-cluster-wide-serialization.md SS5.5.
  -- The WARNING appearing (or not) in a given run's log is the only evidence of whether the cluster-wide
  -- upgrade held for that run -- this statement's mere presence in the file is not proof.
  --
  -- DELIBERATELY A DIFFERENT KEY from CHAT_DEFINER_LOCK_KEY (migrate.test.ts, "chad") / the
  -- withChatDefinerLock() test harness, not a reuse of it -- the two serve different purposes and MUST
  -- NOT share a key. withChatDefinerLock holds a SESSION-scoped lock on ONE dedicated connection for an
  -- entire test body's duration, external to this script. If this in-script lock used the SAME key, any
  -- test connection OTHER than that dedicated one (i.e. every real test in this suite) would block
  -- forever waiting for a lock the test harness's own connection is holding and will not release until
  -- the test body -- which is itself awaiting this very call -- returns: a guaranteed deadlock, caught in
  -- practice by a 60s Vitest test timeout (codex round-03 fix, self-discovered before commit, chat-
  -- definer-role-provisioning).
  PERFORM pg_advisory_xact_lock(1667525739); -- 0x63646c6b, "cdlk" -- distinct from "chad" (0x63686164),
  -- "jobd" (0x6a6f6264), "plxc" (0x706c7863), and "jdlk" (0x6a646c6b, job_definer's own equivalent
  -- same-database fallback, 01-job-definer.sql)
  DO $lock$
  BEGIN
    LOCK TABLE pg_auth_members IN SHARE UPDATE EXCLUSIVE MODE;
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE WARNING 'chat_definer bootstrap: DEGRADED -- cannot acquire the cluster-wide serialization lock on pg_auth_members (insufficient privilege on this connection -- expected on a managed Postgres host with no true superuser). Proceeding WITHOUT the cross-database concurrency guarantee; this run depends on the operational single-bootstrap-point rule instead (docs/autopilot-definer-bootstrap-cluster-wide-serialization.md SS5.5).';
  END
  $lock$;
  -- (distinct dollar-quote tag "lock", not the bare empty tag: the outer block already opened with the
  -- bare empty dollar-quote tag, and PostgreSQL closes a dollar-quoted string at the FIRST subsequent
  -- occurrence of that SAME tag -- nesting another bare-tag DO block here would prematurely close the
  -- OUTER block's string right at this inner DO's own opening tag, breaking the rest of this block into
  -- unparsable top-level SQL. Confirmed empirically this session: the bare-tag form throws "syntax error
  -- at or near BEGIN" at the inner block's own BEGIN -- and this exact comment must never itself contain
  -- the literal two-character dollar-quote tag sequence, or it reproduces the same collision.)
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_target) THEN
    RAISE EXCEPTION
      'chat_definer bootstrap: migration role % does not exist', v_target;
  END IF;
  IF v_target IN ('app', 'app_worker', 'readonly') THEN
    RAISE EXCEPTION
      'chat_definer bootstrap: refusing to grant chat_definer to runtime role % — this would let it bypass the narrow function/audit boundary',
      v_target;
  END IF;
  -- A fresh cluster may not have runtime roles yet, so scan pg_roles. Use its snapshot-derived
  -- oid: a concurrent DROP can invalidate a scanned name before pg_has_role resolves it, even
  -- before the runtime-name filter is evaluated.
  SELECT rolname INTO v_existing_runtime_member
    FROM pg_roles
   WHERE rolname IN ('app', 'app_worker', 'readonly')
     AND pg_has_role(oid, 'chat_definer', 'MEMBER')
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
     AND pg_has_role(oid, 'chat_definer', 'MEMBER')
   LIMIT 1;
  IF v_existing_runtime_member IS NOT NULL THEN
    RAISE EXCEPTION
      'chat_definer bootstrap: granting chat_definer to % would give runtime role % an indirect path to it — aborting',
      v_target, v_existing_runtime_member;
  END IF;
END
$$;

COMMIT;
