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
-- DECISION TABLE (anything not listed is refused; ALWAYS returns exactly one row)
--   p_link_code_id / p_account_id NULL                         RAISE invalid_parameter_value
--   code row missing                                           invalid
--   code is account-issued (no source channel identity)        unsupported
--   code not consumed / revoked / action <> merge_identity /
--     consumed more than 10 minutes ago                        invalid  (the app calls this right after
--                                                                consume; the window bounds replay of
--                                                                an old consumed code id)
--   account has no active Person                               invalid
--   channel identity not active zalo                           invalid
--   channel identity already belongs to the target Person      same_person (idempotent re-call; nothing written)
--   channel identity not owned by code.source_person_id,
--     or source Person not active                              invalid
--   source Person = target Person                              same_person
--   source Person referenced by ANY row beyond its one Zalo
--     identity (and its own link_codes), or by a column the
--     owner cannot provably read (see EMPTINESS)               requires_review + one routing_audit row
--   a referencing table the owner cannot reach (read error)    RAISE (the call aborts, nothing written)
--   otherwise                                                  consumed: identity moved, source tombstoned
--                                                              (persons.status merged + merged_into),
--                                                              merge_audit + merge_tombstones rows,
--                                                              source's live codes revoked, audit row
--
-- OWNER: identity_definer (NOLOGIN NOSUPERUSER BYPASSRLS NOINHERIT), pre-provisioned outside the
-- runner by infra/postgres-init/03-identity-definer.sql (`pnpm db:bootstrap`). Step 1 below only
-- ASSERTS it; the function is created inside a SET ROLE identity_definer bracket (the 0022/0032
-- idiom: works for a NOINHERIT migration role too), so BYPASSRLS belongs to the function owner and
-- never depends on what the migration role happens to be. Rule: DD-127 / DD-131 OD-3 (decisions.md,
-- pending in PR #51), option (a), signed 2026-10-14. R1 (a managed host refusing a BYPASSRLS role)
-- is out of scope per that same OD-3.
-- identity_definer's privileges are only what the body uses: table-level SELECT/UPDATE on the four
-- tables it reads and locks (accounts, persons, channel_identities, link_codes), INSERT on the three
-- audit tables (+ SELECT (id) on merge_audit for RETURNING), and SELECT on the FK column of every
-- single-column FK onto persons as of this migration (the emptiness scan, granted dynamically in
-- step 2). Nothing is owned by it but this function; `app` only gets EXECUTE and is never a member.
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
-- the call aborts with nothing written. The function also pins `row_security = off`, so a table
-- wrongly predicted "provable" RAISES (a row-security error) instead of silently counting 0.
-- The RLS branch is the documented DEFENCE branch, no longer the expected shape: it is reached only
-- if identity_definer loses BYPASSRLS, and then every Person with a FORCE-RLS reference reads
-- non-empty (requires_review), never a false "empty"; it keeps its own regression test.
--
-- LOCK ORDER matches 0043: accounts -> persons (UUID-sorted) -> channel_identities -> link_codes.
-- merge_audit snapshots are NOT NULL; this path stores ids + reason only (no PII), as plain JSON
-- bytes, not encrypted. The real merge planner owns encrypted snapshots.
-- merge_audit rows with reason_code = 'link_code_empty_reparent' carry plaintext id-only JSON snapshots.
-- routing_audit is written directly: routing_audit_append (0053) allowlists a single action and
-- demands a tenant GUC, and linking is tenant-less.
-- Edited in place on 2026-10-14 (OD-3) instead of superseded: the earlier text was never applied
-- outside local/CI databases (never on main, and no deploy path runs migrations), so P17's
-- forward-only rule protects no shared database. A local database that applied the earlier text
-- fails migrate()'s sha256 guard: reset it with `pnpm db:reset:test`.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Step 1: assert identity_definer (exists, exact attributes, the migration role is a member, no
-- runtime role is) BEFORE any grant below. Mirrors 0022 step 1 for job_definer.
-- ---------------------------------------------------------------------------
DO $$
DECLARE r record;
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
END
$$;

-- ---------------------------------------------------------------------------
-- Step 2: the privileges the body uses (see OWNER), granted by the migration role, which owns
-- every table. Schema CREATE is transient: revoked right after the bracket (step 3).
-- ---------------------------------------------------------------------------
GRANT USAGE, CREATE ON SCHEMA public TO identity_definer;
GRANT SELECT, UPDATE ON accounts, persons, channel_identities, link_codes TO identity_definer;
GRANT INSERT ON merge_audit, merge_tombstones, routing_audit TO identity_definer;
GRANT SELECT (id) ON merge_audit TO identity_definer;
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
  v_source   uuid;
  v_ci_id    uuid;
  v_src_acct uuid;
  v_target   uuid;
  v_lock     uuid;
  lc         public.link_codes%ROWTYPE;
  ci         public.channel_identities%ROWTYPE;
  v_re_tgt   uuid;
  v_bypass   boolean;
  v_owner    oid;
  f          record;
  v_cnt      bigint;
  v_blocking text[] := ARRAY[]::text[];
  v_audit    uuid;
  v_snap     bytea;
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
  SELECT * INTO lc FROM public.link_codes l WHERE l.id = p_link_code_id FOR UPDATE;

  -- ---- (3) re-derive under lock ---------------------------------------------------
  SELECT a.person_id INTO v_re_tgt
    FROM public.accounts a JOIN public.persons p ON p.id = a.person_id
   WHERE a.id = p_account_id AND p.status = 'active';
  IF v_re_tgt IS DISTINCT FROM v_target
     OR lc.consumed_at IS NULL
     OR lc.revoked_at IS NOT NULL
     OR lc.action <> 'merge_identity'
     OR lc.source_channel_identity_id IS DISTINCT FROM v_ci_id
     OR lc.source_person_id IS DISTINCT FROM v_source
     OR lc.consumed_at < clock_timestamp() - interval '10 minutes' THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::uuid; RETURN;
  END IF;
  SELECT * INTO ci FROM public.channel_identities c WHERE c.id = v_ci_id;
  IF NOT FOUND OR ci.status <> 'active' OR ci.platform <> 'zalo' THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::uuid; RETURN;
  END IF;
  IF ci.person_id = v_target THEN
    RETURN QUERY SELECT 'same_person'::text, v_ci_id; RETURN;
  END IF;
  IF ci.person_id <> v_source
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
