-- ============================================================================
-- 0054_link_code_reparent_empty_person.sql
-- Web-side account <-> Zalo linking (lane M3b). link_code_consume (0043) verifies and consumes a
-- channel-issued code and returns a redacted merge intent; this definer is the ONLY thing that acts
-- on that intent, and only in the one case that is safe without a Person merge planner: the Zalo
-- user's Person is EMPTY (minted by zalo_identity_resolve, never used for anything else). Then the
-- Zalo channel identity is re-parented to the account's Person and the empty source Person is
-- tombstoned. Anything else is `requires_review`: refused, and recorded for support. The real merge
-- (Person with memberships / players / debt) stays P0 - prepared, NOT executed (DD-14/15/50).
--
-- ONE TRANSACTION WITH THE CONSUME: the web caller (packages/db/src/identity-link-web.ts) runs
-- link_code_consume and this function on ONE connection inside ONE transaction and commits only a
-- decision (consumed / same_person / requires_review) or a counted wrong-code attempt. A raise in
-- here, a refusal (invalid / unsupported) or a connection lost between the two calls rolls the
-- consume back with it: the code stays live and nothing is written. The 10-minute window below
-- therefore bounds only a re-call after a consume that WAS committed (an idempotent same_person
-- re-call, or a requires_review code).
--
-- DECISION TABLE (anything not listed is refused; ALWAYS returns exactly one row)
--   p_link_code_id / p_account_id NULL                         RAISE invalid_parameter_value
--   code row missing                                           invalid
--   code is account-issued (no source channel identity)        unsupported
--   code not consumed / revoked / action <> merge_identity /
--     consumed more than 10 minutes ago                        invalid  (the window bounds a re-call
--                                                                of an already committed consume)
--   account has no active Person                               invalid
--   channel identity not active zalo                           invalid
--   channel identity already belongs to the target Person      same_person (idempotent re-call; nothing written)
--   channel identity not owned by code.source_person_id,
--     or source Person not active                              invalid
--   source Person = target Person                              same_person
--   source Person referenced by ANY row beyond its one Zalo
--     identity (and its own link_codes), or by a column the
--     owner cannot provably read (see EMPTINESS)               requires_review + one routing_audit row
--   a referencing table the owner cannot reach (read error)    RAISE: nothing written, and the web
--                                                                caller's consume rolls back with it
--   otherwise                                                  consumed: identity moved, source tombstoned
--                                                              (persons.status merged + merged_into),
--                                                              merge_audit + merge_tombstones rows,
--                                                              source's live codes revoked, audit row
--
-- OWNER: identity_definer (NOLOGIN NOSUPERUSER BYPASSRLS NOINHERIT), pre-provisioned outside the
-- runner by infra/postgres-init/03-identity-definer.sql (`pnpm db:bootstrap`). Step 1 below only
-- ASSERTS it, with every check 0022 step 1 makes for job_definer plus the two 03 makes at bootstrap
-- (identity_definer is a member of nothing; it has no member besides the migration role). The
-- function is created inside a SET ROLE identity_definer bracket (the 0022/0032 idiom: works for a
-- NOINHERIT migration role too), so BYPASSRLS belongs to the function owner and never depends on
-- what the migration role happens to be. Rule: DD-127 / DD-131 OD-3 (decisions.md, pending in PR
-- #51), option (a), signed 2026-10-14. R1 (a managed host refusing a BYPASSRLS role) is out of scope
-- per that same OD-3.
-- identity_definer's privileges are COLUMN-level and only what the body reads or writes (step 2
-- lists them): it can never read link_codes.code_hash / salt / code_lookup_hash, any *_enc column or
-- persons' phone and name columns, and its only UPDATEs are the columns step (5) writes plus
-- accounts (id), the one column a FOR UPDATE row lock requires and the body never updates. It also
-- gets SELECT on the FK column of every single-column FK onto persons as of this migration (the
-- emptiness scan, granted dynamically in step 2). Nothing is owned by it but this function; `app`
-- only gets EXECUTE and is never a member.
--
-- EMPTINESS IS DYNAMIC. Every foreign key whose referenced table is persons is read from pg_constraint
-- and counted with EXECUTE format(). A table added in a later migration that references persons makes
-- the Person non-empty (fail closed) without anyone remembering to edit this function. Allowed rows:
-- channel_identities.person_id = exactly 1 (the identity being moved) and link_codes.source_person_id
-- (any, revoked). UNPROVABLE, therefore blocking: a composite FK onto persons; an FK column the owner
-- has no SELECT on (every FK a LATER migration adds, until that migration runs `GRANT SELECT (<col>)
-- ON <table> TO identity_definer`; the identity-link-web suite's grant-coverage test stays red until
-- it does); and a table whose RLS the owner cannot read through (owner neither superuser nor
-- BYPASSRLS: a count would silently read 0). FORCE RLS is no obstacle to a BYPASSRLS owner: a
-- tenant-table reference is COUNTED, never guessed. A read the prediction does not cover (e.g. a
-- referencing table in a schema the owner has no USAGE on) RAISES: there is no exception handler, so
-- nothing is written and the web caller's consume rolls back with it. The function also pins
-- `row_security = off`, so a table wrongly predicted "provable" RAISES (a row-security error)
-- instead of silently counting 0.
-- The RLS branch is the documented DEFENCE branch, no longer the expected shape: it is reached only
-- if identity_definer loses BYPASSRLS, and then every Person with a FORCE-RLS reference reads
-- non-empty (requires_review), never a false "empty"; it keeps its own regression test.
-- KNOWN LIMIT, FK-ONLY: a person id stored WITHOUT a foreign key is invisible to the scan. As of this
-- migration those are bank_accounts.pending_change_by and payment_allocations.created_by (actor ids,
-- no FK by design, 0020), oauth_transactions.created_by, billing_overrides.actor_id, tenant_admins'
-- platform_user_lookup_hash for platform 'web' (the person uuid as text), the audit trails
-- (routing_audit, merge_audit, merge_tombstones.old_person_id) and ids inside jsonb payloads. Today
-- each tenant-side one implies a COUNTED reference: payment_allocations.created_by is written only
-- for an actor authorize() accepts, i.e. one with an active web tenant_admins row, and the only
-- writer of such a row (tenant_provision) inserts that person's memberships row with it; the other
-- three have no runtime writer yet. The identity-link-web suite pins the list (a catalog tripwire on
-- FK-less person/actor columns) and the tenant_admins -> memberships implication. A future FK-less
-- person reference without such an implication must add an FK or its own check here.
--
-- LOCK ORDER matches 0043: accounts -> persons (UUID-sorted) -> channel_identities -> link_codes.
-- In the web caller's transaction link_code_consume already holds exactly these rows, so the locks
-- below are re-entrant; the only new row locks are the source's other live link_codes (revoke step),
-- and every other writer of those rows (link_code_issue's supersede, another consume) takes
-- persons(source) first, so no cycle forms. A residual 40P01/40001 is rolled back whole by the
-- caller and answered as a retryable LINK_UNAVAILABLE.
-- merge_audit snapshots are NOT NULL; this path stores ids + reason only (no PII), as plain JSON
-- bytes, not encrypted. The real merge planner owns encrypted snapshots.
-- merge_audit rows with reason_code = 'link_code_empty_reparent' carry plaintext id-only JSON snapshots.
-- routing_audit is written directly: routing_audit_append (0053) allowlists a single action and
-- demands a tenant GUC, and linking is tenant-less.
-- Edited in place on 2026-10-14 (OD-3; again for the PR #49 security review round 1) instead of
-- superseded: the earlier texts were never applied outside local/CI databases (never on main, and
-- no deploy path runs migrations), so P17's forward-only rule protects no shared database. A local
-- database that applied an earlier text fails migrate()'s sha256 guard. A *_test database: `pnpm
-- db:reset:test`. Any other local database (db:reset:test refuses it, it only drops *_test): drop
-- and recreate it through the compose container, then migrate:
--   docker compose -f infra/docker-compose.yml exec -T postgres psql -U plexco -d postgres
--     -c 'DROP DATABASE <db> WITH (FORCE)' -c 'CREATE DATABASE <db> TEMPLATE template0'
--   DATABASE_URL_MIGRATION=postgres://plexco:plexco_dev@localhost:5432/<db> pnpm --filter @plexco/db migrate
-- Measured 2026-10-14 on a non-test database holding the previous text: the guard refused it,
-- db:reset:test refused the name, and the recreated database applied 0000..0054. Never edit
-- schema_migrations instead.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Step 1: assert identity_definer BEFORE any grant below: it exists with the exact attributes, the
-- migration role is a member and no runtime role is (0022 step 1 for job_definer), it is a member of
-- nothing (03 step 2), and it has no member besides the migration role (03 step 3's one-member rule).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r          record;
  v_super    boolean;
  v_member_of text;
  v_members  text[];
BEGIN
  SELECT rolsuper, rolcanlogin, rolbypassrls, rolcreatedb, rolcreaterole, rolinherit, rolreplication
    INTO r
    FROM pg_roles WHERE rolname = 'identity_definer';
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'link_code_reparent_empty_person: identity_definer role does not exist — run `pnpm db:bootstrap` first'
      USING ERRCODE = 'undefined_object';
  END IF;
  IF r.rolsuper OR r.rolcanlogin OR NOT r.rolbypassrls OR r.rolcreatedb
     OR r.rolcreaterole OR r.rolinherit OR r.rolreplication THEN
    RAISE EXCEPTION
      'link_code_reparent_empty_person: identity_definer has unexpected attributes (need exactly NOLOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT pg_has_role(current_user, 'identity_definer', 'MEMBER') THEN
    RAISE EXCEPTION
      'link_code_reparent_empty_person: migration role % is not a member of identity_definer — run `pnpm db:bootstrap` first',
      current_user
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF pg_has_role('app', 'identity_definer', 'MEMBER')
     OR pg_has_role('app_worker', 'identity_definer', 'MEMBER')
     OR pg_has_role('readonly', 'identity_definer', 'MEMBER') THEN
    RAISE EXCEPTION
      'link_code_reparent_empty_person: identity_definer must not be granted to app/app_worker/readonly — review and revoke it before proceeding'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Member of anything: the function body would run with a path into that role's privileges.
  SELECT g.rolname INTO v_member_of
    FROM pg_auth_members m JOIN pg_roles g ON g.oid = m.roleid
   WHERE m.member = 'identity_definer'::regrole
   ORDER BY g.rolname LIMIT 1;
  IF v_member_of IS NOT NULL THEN
    RAISE EXCEPTION
      'link_code_reparent_empty_person: identity_definer is a member of role % — it must be a member of nothing; revoke it before proceeding',
      v_member_of
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- A second member could SET ROLE identity_definer and act as this BYPASSRLS function's owner.
  -- The bootstrap grants exactly one role, the migration role. A superuser migration role needs no
  -- membership (it can SET ROLE to anything), so under one the single member may be whichever role
  -- the bootstrap targeted; distinct members, because PG16 keeps one row per grantor.
  SELECT rolsuper INTO v_super FROM pg_roles WHERE rolname = current_user;
  SELECT array_agg(DISTINCT mr.rolname ORDER BY mr.rolname) INTO v_members
    FROM pg_auth_members m JOIN pg_roles mr ON mr.oid = m.member
   WHERE m.roleid = 'identity_definer'::regrole;
  IF cardinality(v_members) > 1
     OR (cardinality(v_members) = 1 AND v_members[1] <> current_user AND NOT v_super) THEN
    RAISE EXCEPTION
      'link_code_reparent_empty_person: identity_definer must have exactly one member, the migration role (here %), but its members are % — revoke the extra membership before proceeding',
      current_user, array_to_string(v_members, ', ')
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Step 2: the privileges the body uses (see OWNER), granted by the migration role, which owns
-- every table. Column-level, each list = the columns step (1)-(5) of the body read or write. Schema
-- CREATE is transient: revoked right after the bracket (step 3).
-- ---------------------------------------------------------------------------
GRANT USAGE, CREATE ON SCHEMA public TO identity_definer;
GRANT SELECT (id, person_id) ON accounts TO identity_definer;
GRANT UPDATE (id) ON accounts TO identity_definer; -- FOR UPDATE needs UPDATE on one column; never written
GRANT SELECT (id, status) ON persons TO identity_definer;
GRANT UPDATE (status, merged_into_person_id) ON persons TO identity_definer;
GRANT SELECT (id, person_id, platform, status) ON channel_identities TO identity_definer;
GRANT UPDATE (person_id) ON channel_identities TO identity_definer;
GRANT SELECT (id, source_person_id, source_channel_identity_id, source_account_id, action,
              consumed_at, revoked_at) ON link_codes TO identity_definer;
GRANT UPDATE (revoked_at) ON link_codes TO identity_definer;
GRANT INSERT (source_person_id, target_person_id, canonical_person_id, method, actor_type, actor_id,
              reason_code, before_snapshot_enc, after_snapshot_enc) ON merge_audit TO identity_definer;
GRANT SELECT (id) ON merge_audit TO identity_definer; -- RETURNING id
GRANT INSERT (old_person_id, canonical_person_id, merge_audit_id) ON merge_tombstones TO identity_definer;
GRANT INSERT (action, actor_id, tenant_id, detail) ON routing_audit TO identity_definer;
DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT con.conrelid::regclass AS rel, a.attname AS col
      FROM pg_catalog.pg_constraint con
      JOIN pg_catalog.pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
     WHERE con.contype = 'f' AND con.confrelid = 'public.persons'::regclass
       AND array_length(con.conkey, 1) = 1
  LOOP
    EXECUTE format('GRANT SELECT (%I) ON %s TO identity_definer', f.col, f.rel);
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- Step 3: create the function AS identity_definer (it becomes the owner), then restore least
-- privilege. ACL statements run inside the bracket: only the owner may change them, and a
-- NOINHERIT migration role does not hold the owner's privileges.
-- ---------------------------------------------------------------------------
SET ROLE identity_definer;

CREATE FUNCTION link_code_reparent_empty_person(p_link_code_id uuid, p_account_id uuid)
RETURNS TABLE (outcome text, channel_identity_id uuid)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
SET row_security = off
AS $$
#variable_conflict use_column
DECLARE
  v_source      uuid;
  v_ci_id       uuid;
  v_src_acct    uuid;
  v_target      uuid;
  v_lock        uuid;
  -- the code row under lock: exactly the columns step (3) judges (never code_hash / salt)
  v_consumed_at timestamptz;
  v_revoked_at  timestamptz;
  v_action      text;
  v_lc_ci       uuid;
  v_lc_person   uuid;
  -- the channel identity: never its encrypted platform user id
  v_ci_status   text;
  v_ci_platform text;
  v_ci_person   uuid;
  v_re_tgt      uuid;
  v_bypass      boolean;
  v_owner       oid;
  f             record;
  v_cnt         bigint;
  v_blocking    text[] := ARRAY[]::text[];
  v_audit       uuid;
  v_snap        bytea;
BEGIN
  IF p_link_code_id IS NULL OR p_account_id IS NULL THEN
    RAISE EXCEPTION 'link_code_reparent_empty_person: code id and account id are required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- ---- (1) read-only candidate -------------------------------------------------
  SELECT l.source_person_id, l.source_channel_identity_id, l.source_account_id
    INTO v_source, v_ci_id, v_src_acct
    FROM public.link_codes l WHERE l.id = p_link_code_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::uuid; RETURN;
  END IF;
  IF v_ci_id IS NULL OR v_src_acct IS NOT NULL THEN
    RETURN QUERY SELECT 'unsupported'::text, NULL::uuid; RETURN;
  END IF;
  SELECT a.person_id INTO v_target
    FROM public.accounts a JOIN public.persons p ON p.id = a.person_id
   WHERE a.id = p_account_id AND p.status = 'active';
  IF v_target IS NULL THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::uuid; RETURN;
  END IF;

  -- ---- (2) locks: accounts -> persons (UUID order) -> channel_identities -> code row
  PERFORM 1 FROM public.accounts WHERE id = p_account_id FOR UPDATE;
  FOR v_lock IN SELECT x FROM unnest(ARRAY[v_source, v_target]) AS x ORDER BY x LOOP
    PERFORM 1 FROM public.persons WHERE id = v_lock FOR UPDATE;
  END LOOP;
  PERFORM 1 FROM public.channel_identities WHERE id = v_ci_id FOR UPDATE;
  SELECT l.consumed_at, l.revoked_at, l.action, l.source_channel_identity_id, l.source_person_id
    INTO v_consumed_at, v_revoked_at, v_action, v_lc_ci, v_lc_person
    FROM public.link_codes l WHERE l.id = p_link_code_id FOR UPDATE;

  -- ---- (3) re-derive under lock ---------------------------------------------------
  SELECT a.person_id INTO v_re_tgt
    FROM public.accounts a JOIN public.persons p ON p.id = a.person_id
   WHERE a.id = p_account_id AND p.status = 'active';
  IF v_re_tgt IS DISTINCT FROM v_target
     OR v_consumed_at IS NULL
     OR v_revoked_at IS NOT NULL
     OR v_action IS DISTINCT FROM 'merge_identity'
     OR v_lc_ci IS DISTINCT FROM v_ci_id
     OR v_lc_person IS DISTINCT FROM v_source
     OR v_consumed_at < clock_timestamp() - interval '10 minutes' THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::uuid; RETURN;
  END IF;
  SELECT c.status, c.platform, c.person_id INTO v_ci_status, v_ci_platform, v_ci_person
    FROM public.channel_identities c WHERE c.id = v_ci_id;
  IF NOT FOUND OR v_ci_status <> 'active' OR v_ci_platform <> 'zalo' THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::uuid; RETURN;
  END IF;
  IF v_ci_person = v_target THEN
    RETURN QUERY SELECT 'same_person'::text, v_ci_id; RETURN;
  END IF;
  IF v_ci_person <> v_source
     OR NOT EXISTS (SELECT 1 FROM public.persons p WHERE p.id = v_source AND p.status = 'active') THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::uuid; RETURN;
  END IF;
  IF v_source = v_target THEN
    RETURN QUERY SELECT 'same_person'::text, v_ci_id; RETURN;
  END IF;

  -- ---- (4) emptiness of the SOURCE person, from the catalog --------------------------
  SELECT r.rolsuper OR r.rolbypassrls, r.oid INTO v_bypass, v_owner
    FROM pg_catalog.pg_roles r WHERE r.rolname = current_user;
  FOR f IN
    SELECT n.nspname AS sch, c.relname AS rel, a.attname AS col,
           array_length(con.conkey, 1) AS ncols,
           ((c.relrowsecurity AND NOT v_bypass AND (c.relforcerowsecurity OR c.relowner <> v_owner))
            OR NOT pg_catalog.has_column_privilege(c.oid, a.attnum, 'SELECT')) AS unprovable
      FROM pg_catalog.pg_constraint con
      JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_catalog.pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
     WHERE con.contype = 'f' AND con.confrelid = 'public.persons'::regclass
     ORDER BY n.nspname, c.relname, a.attname
  LOOP
    IF f.ncols > 1 OR f.unprovable THEN
      v_blocking := v_blocking || (f.rel || '.' || f.col);
      CONTINUE;
    END IF;
    IF f.sch = 'public' AND f.rel = 'link_codes' AND f.col = 'source_person_id' THEN
      CONTINUE; -- the source's own codes are revoked below; not counted
    END IF;
    EXECUTE format('SELECT count(*) FROM %I.%I WHERE %I = $1', f.sch, f.rel, f.col)
      INTO v_cnt USING v_source;
    IF f.sch = 'public' AND f.rel = 'channel_identities' AND f.col = 'person_id' THEN
      IF v_cnt <> 1 THEN v_blocking := v_blocking || (f.rel || '.' || f.col); END IF;
    ELSIF v_cnt <> 0 THEN
      v_blocking := v_blocking || (f.rel || '.' || f.col);
    END IF;
  END LOOP;

  IF cardinality(v_blocking) > 0 THEN
    -- "Prepared, not executed": evidence for support, never shown to the user.
    INSERT INTO public.routing_audit (action, actor_id, tenant_id, detail)
      VALUES ('identity.link_requires_review', p_account_id, NULL,
              jsonb_build_object('link_code_id', p_link_code_id, 'source_person_id', v_source,
                                 'target_person_id', v_target, 'blocking_tables', to_jsonb(v_blocking)));
    RETURN QUERY SELECT 'requires_review'::text, v_ci_id; RETURN;
  END IF;

  -- ---- (5) empty: re-parent, tombstone, audit ------------------------------------------
  UPDATE public.channel_identities SET person_id = v_target WHERE id = v_ci_id;
  v_snap := convert_to(jsonb_build_object('source_person_id', v_source, 'target_person_id', v_target,
                                          'channel_identity_id', v_ci_id)::text, 'UTF8');
  INSERT INTO public.merge_audit (source_person_id, target_person_id, canonical_person_id, method,
                                  actor_type, actor_id, reason_code, before_snapshot_enc,
                                  after_snapshot_enc)
    VALUES (v_source, v_target, v_target, 'link_code', 'system', p_account_id,
            'link_code_empty_reparent', v_snap, v_snap)
    RETURNING id INTO v_audit;
  UPDATE public.persons SET status = 'merged', merged_into_person_id = v_target WHERE id = v_source;
  INSERT INTO public.merge_tombstones (old_person_id, canonical_person_id, merge_audit_id)
    VALUES (v_source, v_target, v_audit);
  UPDATE public.link_codes SET revoked_at = clock_timestamp()
   WHERE source_person_id = v_source AND consumed_at IS NULL AND revoked_at IS NULL;
  INSERT INTO public.routing_audit (action, actor_id, tenant_id, detail)
    VALUES ('identity.link_reparented', p_account_id, NULL,
            jsonb_build_object('link_code_id', p_link_code_id, 'source_person_id', v_source,
                               'target_person_id', v_target, 'merge_audit_id', v_audit));
  RETURN QUERY SELECT 'consumed'::text, v_ci_id;
END;
$$;
REVOKE ALL ON FUNCTION link_code_reparent_empty_person(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION link_code_reparent_empty_person(uuid, uuid) TO app;
RESET ROLE;
REVOKE CREATE ON SCHEMA public FROM identity_definer;
