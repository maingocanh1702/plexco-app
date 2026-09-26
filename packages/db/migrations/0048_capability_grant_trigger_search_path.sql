-- ============================================================================
-- 0048_capability_grant_trigger_search_path.sql
-- Post-merge Codex finding [P1] on 0047 (PR #34): temp-table shadowing
-- bypassed the non-delegable grant rejection.
--
-- 0047's forbid_non_delegable_capability_grant() ran with
-- `SET search_path = pg_catalog, public`. When pg_temp is not listed,
-- PostgreSQL searches the session's temp schema FIRST for relations, so a
-- session that creates `TEMP TABLE tenant_capability_actions` with
-- ('role.manage', delegable = true) made the unqualified lookup read the temp
-- row. The trigger then accepted a role.manage grant, and the real FK to
-- public.tenant_capability_actions(action_key) still passed because that key
-- exists. Reproduced against 0047 before this fix.
--
-- No runtime role can write tenant_capability_grants yet (0047 grants app
-- SELECT only), so nothing was exploitable in production; the future
-- grant-lifecycle writer would have inherited the hole.
--
-- Fix: same body, the registry read schema-qualified, and pg_temp pinned LAST
-- in search_path (the 0012 `public, pg_temp` idiom). Forward-only: 0047 is
-- applied and immutable, so the function is replaced here.
-- ============================================================================

CREATE OR REPLACE FUNCTION forbid_non_delegable_capability_grant()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF (SELECT a.delegable FROM public.tenant_capability_actions a WHERE a.action_key = NEW.action_key)
       IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'capability % is non-delegable and cannot be granted', NEW.action_key
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION forbid_non_delegable_capability_grant() FROM PUBLIC;
