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
--     identity (and its own link_codes)                        requires_review + one routing_audit row
--   otherwise                                                  consumed: identity moved, source tombstoned
--                                                              (persons.status merged + merged_into),
--                                                              merge_audit + merge_tombstones rows,
--                                                              source's live codes revoked, audit row
--
-- EMPTINESS IS DYNAMIC. Every foreign key whose referenced table is persons is read from pg_constraint
-- and counted with EXECUTE format(). A table added in a later migration that references persons makes
-- the Person non-empty (fail closed) without anyone remembering to edit this function. Allowed rows:
-- channel_identities.person_id = exactly 1 (the identity being moved) and link_codes.source_person_id
-- (any, revoked). A composite FK onto persons, or a table whose RLS this function's owner cannot
-- read through (FORCE RLS, owner neither superuser nor BYPASSRLS: a count would silently read 0),
-- is UNPROVABLE and therefore blocking. The function also pins `row_security = off`, so a table
-- wrongly predicted "provable" RAISES (a row-security error) instead of silently counting 0.
-- ponytail: with a NOBYPASSRLS owner every Person is non-empty (tenant tables are FORCE RLS), so
-- linking degrades to requires_review everywhere until the migration owner can bypass RLS or a
-- per-tenant scan is added; that is fail closed, never a false "empty". Measured: the test suite
-- migrates as a superuser, so the bypass branch is the one proven by default; the fail-closed branch
-- has its own regression test (setupNonSuperuserOwnerContext). Current production shape: the managed
-- host's admin role is documented as "Bypass RLS" and able to create BYPASSRLS roles
-- (infra/postgres-init/01-job-definer.sql, confirmed 2026-08-05), so the bypass branch is the real
-- one there; the fail-closed branch is documented defence.
--
-- LOCK ORDER matches 0043: accounts -> persons (UUID-sorted) -> channel_identities -> link_codes.
-- merge_audit snapshots are NOT NULL; this path stores ids + reason only (no PII), as plain JSON
-- bytes, not encrypted. The real merge planner owns encrypted snapshots.
-- merge_audit rows with reason_code = 'link_code_empty_reparent' carry plaintext id-only JSON snapshots.
-- routing_audit is written directly: routing_audit_append (0053) allowlists a single action and
-- demands a tenant GUC, and linking is tenant-less.
-- ============================================================================

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
           (c.relrowsecurity AND NOT v_bypass AND (c.relforcerowsecurity OR c.relowner <> v_owner)) AS unprovable
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
    EXECUTE format('SELECT count(*) FROM %I.%I WHERE %I = $1', f.sch, f.rel, f.col)
      INTO v_cnt USING v_source;
    IF f.sch = 'public' AND f.rel = 'link_codes' AND f.col = 'source_person_id' THEN
      CONTINUE; -- the source's own codes are revoked below
    ELSIF f.sch = 'public' AND f.rel = 'channel_identities' AND f.col = 'person_id' THEN
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
