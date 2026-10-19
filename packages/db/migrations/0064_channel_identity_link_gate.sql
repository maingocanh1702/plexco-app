-- ============================================================================
-- 0064_channel_identity_link_gate.sql
-- Phase 3 lane L13a (M9). Authority: owner decision B-A1 R1 (2026-10-19) and the contract in
-- docs/sessions/web-mvp-phase3-readiness-p3-m9-channel-identity-link-gate.md section 4 (pins M-1..M-6,
-- section 5). Additive only: ONE app-only read function and its two grant statements. No table, column,
-- index, trigger, policy, role or grant on an existing object, so schema.ts and db.dbml are unchanged
-- (functions are not mirrored; 0055, 0058, 0059).
--
-- channel_identity_link_gate(p_channel_identity_id) answers one question for ONE channel identity: is it
-- linked to a verified Account, and if so which one. It only delegates to the 0034 core
-- resolve_deferred_payment_account_core(uuid), which already decides every cell of DD-50's predicate
-- literally (a verified Account = >= 1 account_emails.verified_at IS NOT NULL on the final active
-- canonical Person of a fully tombstoned merge chain; legacy account_identities do not count), and maps
-- its row: linked = qualified; account_ref = the core's account_ref when qualified, else NULL. The core's
-- person_ref and binding_version are never returned. Every deny (NULL or unknown id, inactive identity,
-- merged or deleted person, no account, unverified or legacy-only account, several accounts across the
-- chain, missing tombstone) is the one generic row (false, NULL), never an error.
--
-- WHAT IT IS NOT. A read gate for a message handler (the Zalo player commands, lane L13), NOT the DD-50
-- pay-later resolver: the bare name resolve_deferred_payment_account stays reserved (0034 header) for the
-- DD-65..68 app-granted, endpoint-complete, finalizer-safe successor. A snapshot at call time and not
-- finalizer-safe (it withholds the core's recheck token, so nothing can be finalized against it). Not
-- endpoint-complete: the endpoint scope comes from the caller's bot-scoped HMAC identity. No money action
-- may rest on it.
--
-- THREAT MODEL. Defends against an app-tier caller obtaining an account id for a channel identity that
-- does not qualify (legacy account without a verified email, unverified, merged without tombstone,
-- ambiguous across the merge chain, inactive or deleted person), and against an enumeration or oracle
-- through the result shape or an error. It does NOT defend against a compromised app tier, which already
-- holds the account-keyed L9 reads (the 0059 posture).
--
-- LOCKS AND CALLER CONTRACT. The function takes no lock of its own. The core takes FOR SHARE only once
-- its read-only phase has qualified the identity, in the canonical order account/email -> Person(s) ->
-- channel_identity, and those locks survive into the caller's transaction. So the caller runs it as its
-- own short autocommit statement, BEFORE and outside any tenant transaction; treats (false, NULL), an
-- error, a timeout or a missing row as not linked (fail closed); never caches linked = true beyond the
-- request; never logs the identity id together with a platform or any user text.
--
-- Owned by the migration role, which also owns the core, so it executes the core with no grant on the
-- core; the core's own ACL (0034, owner-only) is untouched. SET search_path = pg_catalog, public, pg_temp
-- (pg_temp LAST, 0048 lesson); every name public.-qualified; plpgsql VOLATILE (the core takes row locks);
-- reads no relation itself; no RAISE, no dynamic SQL; REVOKE ALL FROM PUBLIC, app_worker, readonly;
-- EXECUTE for app only.
-- ============================================================================

CREATE FUNCTION public.channel_identity_link_gate(p_channel_identity_id uuid)
RETURNS TABLE (linked boolean, account_ref uuid)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
#variable_conflict use_column
BEGIN
  -- the core decides every cell (NULL input included) and returns one row; this only maps it
  RETURN QUERY
    SELECT (c.qualified IS TRUE),
           CASE WHEN c.qualified IS TRUE THEN c.account_ref END
      FROM public.resolve_deferred_payment_account_core(p_channel_identity_id) AS c;
  -- no core row (never expected): the same generic deny, never an error
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::uuid;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.channel_identity_link_gate(uuid) FROM PUBLIC, app_worker, readonly;
GRANT EXECUTE ON FUNCTION public.channel_identity_link_gate(uuid) TO app;
