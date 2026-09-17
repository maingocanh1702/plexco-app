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
  -- deployment/CI log capturing this script's output. The rest of this bootstrap does not need superuser
  -- -- doadmin's own Bypass RLS attribute is exactly what CREATE ROLE ... BYPASSRLS requires of its
  -- creator (verified empirically against a role shaped exactly like doadmin's documented attribute set,
  -- SS5.4.1).
  --
  -- TWO-LAYER design, added round-01 codex review (2026-08-05): this LOCK TABLE statement alone gives
  -- ZERO protection on the one host it cannot mechanically take its lock on -- the exact production host
  -- this bootstrap targets. An UNCONDITIONAL, ordinary pg_advisory_xact_lock (below, before this
  -- statement) needs no elevated privilege at all and always succeeds for any authenticated role, so it
  -- is taken FIRST and unconditionally to guarantee AT LEAST same-database serialization on every host,
  -- superuser or not. LOCK TABLE then attempts to UPGRADE that to cluster-wide serialization when the
  -- connection can take it (local/CI/docker-compose today; never on DigitalOcean). Layered, not
  -- either/or: on a superuser connection both locks are held (redundant, harmless); on a degraded
  -- connection only the advisory lock holds, which is still strictly better than the zero protection a
  -- LOCK-TABLE-only design would leave in place on the exact host that matters most. On a host where the
  -- cluster-wide upgrade cannot be taken, cluster-wide safety (beyond the same-database floor this
  -- advisory lock guarantees) depends on an OPERATIONAL rule: this bootstrap runs from exactly one place,
  -- never concurrently, against that cluster -- see docs/autopilot-definer-bootstrap-cluster-wide-
  -- serialization.md SS5.5. The WARNING appearing (or not) in a given run's log is the only evidence of
  -- whether the cluster-wide upgrade held for that run -- this statement's mere presence in the file is
  -- not proof.
  PERFORM pg_advisory_xact_lock(1784966251); -- 0x6a646c6b, "jdlk" -- distinct from "chad" (0x63686164),
  -- "jobd" (0x6a6f6264, a DIFFERENT test-only inter-file lock, migrate.test.ts), "plxc" (0x706c7863), and
  -- "cdlk" (0x63646c6b, chat_definer's own equivalent same-database fallback, 02-chat-definer.sql)
  DO $lock$
  BEGIN
    LOCK TABLE pg_auth_members IN SHARE UPDATE EXCLUSIVE MODE;
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE WARNING 'job_definer bootstrap: DEGRADED -- cannot acquire the cluster-wide serialization lock on pg_auth_members (insufficient privilege on this connection -- expected on a managed Postgres host with no true superuser). Proceeding WITHOUT the cross-database concurrency guarantee; this run depends on the operational single-bootstrap-point rule instead (docs/autopilot-definer-bootstrap-cluster-wide-serialization.md SS5.5).';
  END
  $lock$;
  -- (distinct dollar-quote tag "lock", not the bare empty tag: the outer block already opened with the
  -- bare empty dollar-quote tag, and PostgreSQL closes a dollar-quoted string at the FIRST subsequent
  -- occurrence of that SAME tag -- nesting another bare-tag DO block here would prematurely close the
  -- OUTER block's string right at this inner DO's own opening tag, breaking the rest of this block into
  -- unparsable top-level SQL. Confirmed empirically this session: the bare-tag form throws "syntax error
  -- at or near BEGIN" at the inner block's own BEGIN -- and this exact comment must never itself contain
  -- the literal two-character dollar-quote tag sequence, or it reproduces the same collision.)
  IF v_grant_to IN ('app', 'app_worker', 'readonly') THEN
    RAISE EXCEPTION
      'job_definer bootstrap: refusing to grant job_definer to runtime role % — this would let it bypass the narrow function/audit boundary',
      v_grant_to;
  END IF;
  -- A fresh cluster may not have runtime roles yet, so scan pg_roles. Use its snapshot-derived
  -- oid: a concurrent DROP can invalidate a scanned name before pg_has_role resolves it, even
  -- before the runtime-name filter is evaluated.
  SELECT rolname INTO v_existing_runtime_member
    FROM pg_roles
   WHERE rolname IN ('app', 'app_worker', 'readonly')
     AND pg_has_role(oid, 'job_definer', 'MEMBER')
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
     AND pg_has_role(oid, 'job_definer', 'MEMBER')
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
