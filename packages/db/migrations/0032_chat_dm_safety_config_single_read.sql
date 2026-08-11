-- ============================================================================
-- 0032_chat_dm_safety_config_single_read.sql
-- chat-dm-safety-config-single-read -- discharges DD-102's hard condition.
--
-- DD-102 (decisions.md, owner-final 2026-08-10) recorded that assert_dm_allowed()
-- (created by chat-dm-safety-authority-core, migration 0030, lines 290-333) reads
-- its configuration through FOUR separate statements -- three inline scalar
-- subqueries for dm_sender_limit_per_min / dm_target_limit_per_min / audit_enabled,
-- plus the SELECT inside dm_safety_enabled() -- each taking its own READ COMMITTED
-- snapshot. A config tightening committing between any two of them is seen by the
-- later statements but not the earlier ones: a torn read. DD-102 measured this is
-- NOT fail-open (every missing/NULL path still denies -- rate_limit_check(bucket, 0,
-- ...) returns false because v_count >= 0 is always true; dm_safety_enabled() false
-- => safety_disabled), so the defect is inconsistency, not bypass. The waiver's hard
-- condition: collapse the four reads into ONE before slice 7/8 become the first
-- callers. This migration does exactly that, byte-identical otherwise.
--
-- Two design rules make the fix nearly unique:
--   * SINGLE READ (DD-102's literal requirement): assert_dm_allowed() reads the
--     singleton config row ONCE, into a %ROWTYPE record, and derives everything
--     (enabled, both limits, audit flag) from that one snapshot.
--   * SINGLE SOURCE of the derived aggregate (autopilot-invariant-catalog): the
--     "enabled = AND of the four flags" value gets ONE definition, the new pure
--     helper dm_safety_flags_enabled(), which both dm_safety_enabled() and
--     assert_dm_allowed() call -- never re-derived per call site (the catalog's
--     named #1 thrash source, and here also a security hazard: two drifting copies
--     could let one DM path enforce while another does not).
--
-- Fail-closed is preserved BY CONSTRUCTION. A missing config row leaves the record
-- all-NULL: dm_safety_flags_enabled(NULL,...) = COALESCE(NULL AND ..., false) = false
-- => safety_disabled; COALESCE(NULL, 0) on the limits => rate_limit_check denies
-- (defense in depth); COALESCE(NULL, false) audit => no log. dm_safety_enabled()'s
-- OUTER COALESCE over the singleton subquery preserves 0030's empty-row-set => false
-- exactly (the inner helper form alone would return NULL on an empty row set -- a
-- silent regression dm_current_read_allowed() at 0031 would inherit).
--
-- chat_pair_blocked() stays a SEPARATE statement: DD-102 scopes the torn read to
-- chat_dm_safety_config; chat_pair_blocked() reads a different table (chat_blocks)
-- whose current-state semantics already accept a block landing mid-call. Folding it
-- in would change no correctness property and couple two unrelated tables.
--
-- WHY THE SET ROLE / GRANT-CREATE BRACKET (not plain CREATE OR REPLACE):
-- both recreated functions are owned by chat_definer (0030). PostgreSQL's
-- CREATE OR REPLACE FUNCTION checks BOTH ownership (has_privs_of_role, which is
-- INHERIT-sensitive in PG16) AND ACL_CREATE on the function's schema -- even when
-- the function already exists and you own it. So a NOINHERIT migration role
-- (migrate.test.ts BR-6's own posture) running a plain CREATE OR REPLACE is refused
-- "permission denied for schema public" (verified empirically against this cluster:
-- plain replace as a NOINHERIT member, and SET ROLE chat_definer WITHOUT schema
-- CREATE, both fail; SET ROLE chat_definer WITH schema CREATE succeeds). The fix is
-- the same idiom 0022/0023 already use for definer-owned DDL "regardless of inherit"
-- (0022:514-518): grant chat_definer CREATE on schema public, become chat_definer,
-- run the two replaces, then restore least privilege. Non-behavioral scaffolding --
-- the function bodies below are byte-identical to the DD-102 follow-up spec; only
-- the read count changed (four -> one).
--
-- Forward-only (P17): no reverse runbook, no edit to the applied+hash-locked 0030.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- dm_safety_flags_enabled: the SINGLE definition of the four-flag kill-switch
-- AND. Pure (no table access), so no SECURITY DEFINER and no search_path pinning
-- is needed -- it references only its arguments and built-in AND/COALESCE.
-- COALESCE(..., false) makes any NULL flag fail closed. Created by the migration
-- role; PUBLIC revoked, ownership transferred to chat_definer below (matching the
-- 0030/0031 owner block) so the two definer callers keep implicit EXECUTE with no
-- extra grant, and app/app_worker/readonly/PUBLIC get none.
-- ---------------------------------------------------------------------------
CREATE FUNCTION dm_safety_flags_enabled(p_block boolean, p_report boolean, p_rate boolean, p_audit boolean)
  RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(p_block AND p_report AND p_rate AND p_audit, false);
$$;
REVOKE ALL ON FUNCTION dm_safety_flags_enabled(boolean, boolean, boolean, boolean) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Grant chat_definer CREATE on schema public and hand it the helper's ownership,
-- then run the two CREATE OR REPLACE statements AS chat_definer (see header). CREATE
-- on schema is restored to least-privilege at the end.
-- ---------------------------------------------------------------------------
GRANT USAGE, CREATE ON SCHEMA public TO chat_definer;
ALTER FUNCTION dm_safety_flags_enabled(boolean, boolean, boolean, boolean) OWNER TO chat_definer;

SET ROLE chat_definer;

-- dm_safety_enabled: unchanged signature/semantics; now DELEGATES to the shared
-- helper so the four-flag AND has one definition. The OUTER COALESCE over the
-- singleton subquery preserves 0030's missing-row -> false exactly.
CREATE OR REPLACE FUNCTION dm_safety_enabled() RETURNS boolean
  LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
  SELECT COALESCE(
    (SELECT dm_safety_flags_enabled(block_enabled, report_enabled, rate_limit_enabled, audit_enabled)
       FROM chat_dm_safety_config WHERE singleton),
    false
  );
$$;

-- assert_dm_allowed: reads the singleton row ONCE (one snapshot), derives enabled
-- via the shared helper, and uses the record's limits + audit flag. Every branch,
-- reason, exception text, read-skip and the RAISE LOG audit line is preserved
-- verbatim from 0030 -- ONLY the read count changes (four -> one). It no longer
-- calls dm_safety_enabled() (that was read #4); it computes enabled from its own
-- snapshot. The three per-value local assignments 0030 used are gone -- their
-- values now come from the single record read.
CREATE OR REPLACE FUNCTION assert_dm_allowed(p_actor uuid, p_peer uuid, p_action text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  SET client_min_messages = warning AS $$
DECLARE
  v_deny_reason text;
  v_cfg chat_dm_safety_config%ROWTYPE;   -- one snapshot; %ROWTYPE survives future column additions
  v_enabled boolean;
BEGIN
  -- p_action IS NULL checked explicitly: `NULL NOT IN (...)` is NULL (three-valued logic),
  -- not TRUE, so `IF p_action NOT IN (...)` alone would silently treat NULL as valid.
  IF p_action IS NULL OR p_action NOT IN ('create','send','read') THEN
    RAISE EXCEPTION 'assert_dm_allowed: invalid action' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_actor IS NULL OR p_peer IS NULL OR p_actor = p_peer THEN
    RAISE EXCEPTION 'assert_dm_allowed: invalid participants' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT * INTO v_cfg FROM chat_dm_safety_config WHERE singleton;   -- the single read
  v_enabled := dm_safety_flags_enabled(v_cfg.block_enabled, v_cfg.report_enabled,
                                       v_cfg.rate_limit_enabled, v_cfg.audit_enabled);

  IF NOT v_enabled THEN                                             -- helper guarantees non-null
    v_deny_reason := 'safety_disabled';
  ELSIF chat_pair_blocked(p_actor, p_peer) THEN                     -- different table; intentionally separate
    v_deny_reason := 'blocked';
  ELSIF p_action IN ('create','send')
        AND NOT rate_limit_check('chat_dm_sender:' || p_actor::text,
                                 COALESCE(v_cfg.dm_sender_limit_per_min, 0), interval '1 minute') THEN
    v_deny_reason := 'rate_limited_sender';
  ELSIF p_action IN ('create','send')
        AND NOT rate_limit_check('chat_dm_target:' || p_peer::text,
                                 COALESCE(v_cfg.dm_target_limit_per_min, 0), interval '1 minute') THEN
    v_deny_reason := 'rate_limited_target';
  END IF;

  IF v_deny_reason IS NOT NULL THEN
    IF COALESCE(v_cfg.audit_enabled, false) THEN
      RAISE LOG 'chat_dm_safety_audit actor=% peer=% action=% deny_reason=% at=%',
        p_actor, p_peer, p_action, v_deny_reason, clock_timestamp();
    END IF;
    RAISE EXCEPTION 'chat safety blocked' USING ERRCODE = 'insufficient_privilege';
  END IF;
END; $$;

RESET ROLE;

-- Restore least privilege: chat_definer keeps ownership + implicit EXECUTE on all
-- three functions, but no longer holds CREATE on schema public (mirrors 0030/0031).
REVOKE CREATE ON SCHEMA public FROM chat_definer;
