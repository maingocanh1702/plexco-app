-- ============================================================================
-- 0066_account_club_chat_context.sql
-- Phase 3 lane L16c (M10 member chat entry). Authority: the contract in
-- docs/sessions/web-mvp-phase3-readiness-p3-m10-chat-member-entry.md sections 0 and 3 (pin 1a).
-- Additive only: one app-only read function. No table, column, index, CHECK, policy or grant on an
-- existing object, so schema.ts and db.dbml are unchanged (functions are not mirrored; 0055, 0059).
--
-- account_club_chat_context gives the player web's member chat pages the tenant id and IANA time
-- zone of ONE club, only when the signed-in account's own person holds an ACTIVE membership in the
-- club whose slug is p_club_ref. Keyed by the ACCOUNT id the web session verified (0055/0059
-- precedent): it takes no person, tenant or membership id and returns no person or membership id;
-- the person is resolved exactly as 0059 account_my_clubs (merged, deleted or no person => no rows).
-- Every deny (a guest, left or merged membership, no membership, an unknown slug, a NULL argument)
-- is zero rows, never an error. The context GRANTS NOTHING: the chat API's live-membership pre-gate
-- stays the one authorization for every chat read and write. No tenant-status filter (M-16): a
-- suspended club surfaces through the chat API's TENANT_SUSPENDED.
--
-- TENANT RLS IS NOT BYPASSED. Owned by the migration role (the 0059 shape, M-14). FORCE RLS (0009)
-- binds the owner, so under a NOSUPERUSER NOBYPASSRLS owner the club's memberships are visible only
-- while the function itself has set app.tenant_id to that tenant. The tenant is read by its UNIQUE
-- slug from public.tenants (no RLS; 0002) before any set_config; the GUC is set transaction-locally
-- once and the caller's previous value is restored on the single exit (0037 idiom). Under a
-- superuser owner RLS is bypassed, so the membership read also carries tenant_id = v_tenant and
-- person_id = v_person: the explicit predicates carry the isolation whatever the owner. This
-- loop-free single-tenant form deviates from M-14's per-tenant loop only because there is exactly
-- one tenant by construction.
--
-- Threat model (readiness section 0). Defends against: (1) enumeration of clubs or memberships:
-- only the caller's own ACTIVE membership answers, every deny is zero rows; (2) acting as another
-- account: the caller passes the account id of the verified session, never one from the client;
-- (3) a tenant uuid reaching a non-member, a guest or a former member: every non-active state is
-- zero rows; (4) the client choosing the tenant for the chat API: unchanged, the chat API's
-- live-membership gate remains the authorization; (5) a shape oracle between "unknown slug" and
-- "not a member": both are zero rows (the residual, an unknown slug skips the membership probe, is
-- review question R-1: slugs are public handles, membership is the secret); (6) caching: the
-- context route answers private, no-store. Not defended: a compromised app tier, which already
-- holds the session.
--
-- Never reads tenant_admins (no admin shortcut); never selects a person's name or phone,
-- memberships.display_name or pay_code, or any *_enc column. SET search_path = pg_catalog, public,
-- pg_temp (pg_temp LAST, 0048 lesson); every relation public.-qualified and every column
-- alias-qualified (#variable_conflict use_column: the OUT names equal real column names); plpgsql
-- VOLATILE (set_config is volatile); no RAISE, no dynamic SQL; REVOKE ALL FROM PUBLIC; EXECUTE for
-- app only.
-- ============================================================================

CREATE FUNCTION public.account_club_chat_context(p_account_id uuid, p_club_ref text)
RETURNS TABLE (tenant_id uuid, timezone text)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_person uuid;
  v_tenant uuid;
  v_tz     text;
  v_prev   text := current_setting('app.tenant_id', true);
BEGIN
  -- the person is resolved exactly as 0059 account_my_clubs: merged, deleted or no person => no rows
  SELECT p.id INTO v_person
    FROM public.accounts a
    JOIN public.persons p ON p.id = a.person_id AND p.status = 'active'
   WHERE a.id = p_account_id;
  IF v_person IS NULL THEN RETURN; END IF;
  -- one tenant by its UNIQUE slug (0002); a NULL or unknown slug matches no tenant
  SELECT t.id, t.timezone INTO v_tenant, v_tz
    FROM public.tenants t
   WHERE t.slug = p_club_ref;
  IF v_tenant IS NULL THEN RETURN; END IF;
  PERFORM set_config('app.tenant_id', v_tenant::text, true);
  -- at most one row: memberships_active_person_unique (0002) covers active|guest; a guest is no row
  RETURN QUERY
    SELECT v_tenant, v_tz
      FROM public.memberships m
     WHERE m.tenant_id = v_tenant AND m.person_id = v_person
       AND m.status = 'active';
  PERFORM set_config('app.tenant_id', coalesce(v_prev, ''), true);
END;
$$;
REVOKE ALL ON FUNCTION public.account_club_chat_context(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.account_club_chat_context(uuid, text) TO app;
