-- ============================================================================
-- 0059_me_player_reads_definers.sql
-- Phase 3 lane L9 (M9 me reads). Authority: the contract in
-- docs/sessions/web-mvp-phase3-readiness-p3-m9-me-reads.md section 4.1 (pins M-1..M-16, section 5).
-- Additive only: four app-only read functions. No table, column, index, CHECK, policy or grant on an
-- existing object, so schema.ts and db.dbml are unchanged (functions are not mirrored; 0055, 0058).
--
-- The signed-in player's own cross-club reads, keyed by the ACCOUNT id the web session verified
-- (0055 precedent). No function takes a person, tenant or membership id: the person is resolved
-- inside exactly as 0055 person_profile_read (merged, deleted or no person => no rows) and every row
-- is keyed by that person, so a caller only ever reads its own rows.
--   account_my_clubs         own active|guest memberships (M-1)
--   account_my_sessions      own active|waitlisted seats on own active|guest memberships, plus own
--                            pending requests, on open sessions not yet ended (M-3); the venue only
--                            for an active seat (M-7); a seat wins over a pending request
--   account_my_open_charges  own open|partial charges through ANY own membership (M-2), with the
--                            ledger SUM next to the stored amount_allocated (the caller derives)
--   account_my_join_requests own pending|approved|rejected requests on sessions not yet ended (M-4)
--
-- TENANT RLS IS NOT BYPASSED. Owned by the migration role (0051/0052/0055/0058 shape, M-14). FORCE
-- RLS (0009) binds the owner, so under a NOSUPERUSER NOBYPASSRLS owner a tenant's rows are visible
-- only while the function itself has set app.tenant_id to that tenant. Each function loops over
-- public.tenants ORDER BY id (no RLS; a person's tenant set cannot be listed without crossing RLS,
-- and tenant_ids_for_person, 0037, covers admin tenants only), sets the GUC transaction-locally per
-- tenant and restores the caller's previous value at the end (0037 idiom). Under a superuser owner
-- RLS is bypassed, so EVERY tenant-table reference also carries tenant_id = v_tenant: the explicit
-- person and tenant predicates carry the isolation whatever the owner.
-- COST (known limit): each call loops over EVERY tenant. Per tenant, memberships, players and
-- charges are read through tenant_id-leading indexes (0002, 0003, 0019, 0020): a (tenant_id,
-- person_id) probe for memberships, index ranges over the tenant's players and open|partial charges.
-- join_requests has NO (tenant_id, person_id) index (its only secondary index is the partial unique
-- (session_id, person_id) WHERE status = 'pending', 0006_discovery.sql), so account_my_join_requests,
-- which also reads approved and rejected rows, costs one join_requests scan per tenant per call.
-- Bounded today only by the local-only scale and the per-account bucket me-requests-read (30 per
-- 60 s). The cap + 1 LIMIT bounds the rows returned, not the rows read. Follow-up before any
-- non-local deployment: an index on join_requests (tenant_id, person_id) with its schema.ts mirror.
--
-- Never reads tenant_admins (no admin shortcut); never selects a person's name or phone,
-- memberships.display_name or pay_code, payment_allocations.created_by, join_requests.decided_by or
-- command_id, or any *_enc column. Each per-tenant list is capped at cap + 1 rows (bounds the work;
-- the TS caller orders and caps across tenants, M-5/M-6). SET search_path = pg_catalog, public,
-- pg_temp (pg_temp LAST, 0048 lesson); every relation public.-qualified; plpgsql VOLATILE
-- (set_config is volatile); no RAISE, no dynamic SQL; REVOKE ALL FROM PUBLIC; EXECUTE for app only.
-- ============================================================================

CREATE FUNCTION account_my_clubs(p_account_id uuid)
RETURNS TABLE (club_ref text, club_label text, membership_status text)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_person uuid;
  v_tenant uuid;
  v_prev   text := current_setting('app.tenant_id', true);
BEGIN
  -- the person is resolved exactly as 0055 person_profile_read: merged, deleted or no person => no rows
  SELECT p.id INTO v_person
    FROM public.accounts a
    JOIN public.persons p ON p.id = a.person_id AND p.status = 'active'
   WHERE a.id = p_account_id;
  IF v_person IS NULL THEN RETURN; END IF;
  FOR v_tenant IN SELECT t.id FROM public.tenants t ORDER BY t.id LOOP
    PERFORM set_config('app.tenant_id', v_tenant::text, true);
    -- at most one row per tenant: memberships_active_person_unique (0002) covers active|guest
    RETURN QUERY
      SELECT t.slug, t.name, m.status
        FROM public.memberships m
        JOIN public.tenants t ON t.id = v_tenant
       WHERE m.tenant_id = v_tenant AND m.person_id = v_person
         AND m.status IN ('active', 'guest');
  END LOOP;
  PERFORM set_config('app.tenant_id', coalesce(v_prev, ''), true);
END;
$$;
REVOKE ALL ON FUNCTION account_my_clubs(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION account_my_clubs(uuid) TO app;

CREATE FUNCTION account_my_sessions(p_account_id uuid)
RETURNS TABLE (session_id uuid, club_ref text, club_label text, sport_key text,
               starts_at timestamptz, ends_at timestamptz, timezone text, area text,
               my_status text, waitlist_position integer, venue_name text, venue_address text)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_person uuid;
  v_tenant uuid;
  v_prev   text := current_setting('app.tenant_id', true);
BEGIN
  SELECT p.id INTO v_person
    FROM public.accounts a
    JOIN public.persons p ON p.id = a.person_id AND p.status = 'active'
   WHERE a.id = p_account_id;
  IF v_person IS NULL THEN RETURN; END IF;
  FOR v_tenant IN SELECT t.id FROM public.tenants t ORDER BY t.id LOOP
    PERFORM set_config('app.tenant_id', v_tenant::text, true);
    RETURN QUERY
      SELECT u.session_id, u.club_ref, u.club_label, u.sport_key, u.starts_at, u.ends_at,
             u.timezone, u.area, u.my_status, u.waitlist_position, u.venue_name, u.venue_address
        FROM (
          -- (a) own seats; the venue never leaves the database for a caller who is not active
          SELECT s.id AS session_id, t.slug AS club_ref, t.name AS club_label, sp.key AS sport_key,
                 s.starts_at, s.ends_at, s.timezone, s.area, pl.status AS my_status,
                 CASE WHEN pl.status = 'waitlisted' THEN pl.waitlist_position END AS waitlist_position,
                 CASE WHEN pl.status = 'active' THEN s.venue_name END AS venue_name,
                 CASE WHEN pl.status = 'active' THEN s.venue_address END AS venue_address
            FROM public.players pl
            JOIN public.memberships m ON m.id = pl.membership_id AND m.tenant_id = v_tenant
                                     AND m.person_id = v_person AND m.status IN ('active', 'guest')
            JOIN public.sessions s ON s.id = pl.session_id AND s.tenant_id = v_tenant
            JOIN public.sports sp ON sp.id = s.sport_id
            JOIN public.tenants t ON t.id = v_tenant
           WHERE pl.tenant_id = v_tenant AND pl.status IN ('active', 'waitlisted')
             AND s.status = 'open' AND s.ends_at > now()
          UNION ALL
          -- (b) own pending requests; the NOT EXISTS mirrors (a)'s predicate, so a session is
          -- listed once, by its seat when it has one (M-3)
          SELECT s.id, t.slug, t.name, sp.key, s.starts_at, s.ends_at, s.timezone, s.area,
                 'pending'::text, NULL::integer, NULL::text, NULL::text
            FROM public.join_requests jr
            JOIN public.sessions s ON s.id = jr.session_id AND s.tenant_id = v_tenant
            JOIN public.sports sp ON sp.id = s.sport_id
            JOIN public.tenants t ON t.id = v_tenant
           WHERE jr.tenant_id = v_tenant AND jr.person_id = v_person AND jr.status = 'pending'
             AND s.status = 'open' AND s.ends_at > now()
             AND NOT EXISTS (
                   SELECT 1
                     FROM public.players pl2
                     JOIN public.memberships m2 ON m2.id = pl2.membership_id
                                               AND m2.tenant_id = v_tenant
                                               AND m2.person_id = v_person
                                               AND m2.status IN ('active', 'guest')
                    WHERE pl2.tenant_id = v_tenant AND pl2.session_id = s.id
                      AND pl2.status IN ('active', 'waitlisted'))
        ) u
       ORDER BY u.starts_at, u.session_id
       LIMIT 51;
  END LOOP;
  PERFORM set_config('app.tenant_id', coalesce(v_prev, ''), true);
END;
$$;
REVOKE ALL ON FUNCTION account_my_sessions(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION account_my_sessions(uuid) TO app;

CREATE FUNCTION account_my_open_charges(p_account_id uuid)
RETURNS TABLE (club_ref text, club_label text, session_id uuid, starts_at timestamptz,
               amount_due integer, amount_allocated integer, effective_allocated integer,
               charge_status text)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_person uuid;
  v_tenant uuid;
  v_prev   text := current_setting('app.tenant_id', true);
BEGIN
  SELECT p.id INTO v_person
    FROM public.accounts a
    JOIN public.persons p ON p.id = a.person_id AND p.status = 'active'
   WHERE a.id = p_account_id;
  IF v_person IS NULL THEN RETURN; END IF;
  FOR v_tenant IN SELECT t.id FROM public.tenants t ORDER BY t.id LOOP
    PERFORM set_config('app.tenant_id', v_tenant::text, true);
    -- any membership status (M-2): an open debt is never hidden by a membership state.
    -- effective_allocated is the effectiveByCharge ledger SUM; the only coalesce to 0 is the SUM
    -- over zero allocation rows (provably nothing allocated).
    RETURN QUERY
      SELECT t.slug, t.name, c.session_id, s.starts_at, c.amount_due, c.amount_allocated,
             (SELECT coalesce(sum(pa.amount), 0)::integer
                FROM public.payment_allocations pa
               WHERE pa.tenant_id = v_tenant AND pa.charge_id = c.id),
             c.status
        FROM public.charges c
        JOIN public.players pl ON pl.id = c.player_id AND pl.tenant_id = v_tenant
        JOIN public.memberships m ON m.id = pl.membership_id AND m.tenant_id = v_tenant
                                 AND m.person_id = v_person
        JOIN public.sessions s ON s.id = c.session_id AND s.tenant_id = v_tenant
        JOIN public.tenants t ON t.id = v_tenant
       WHERE c.tenant_id = v_tenant AND c.status IN ('open', 'partial')
       ORDER BY s.starts_at, c.session_id
       LIMIT 201;
  END LOOP;
  PERFORM set_config('app.tenant_id', coalesce(v_prev, ''), true);
END;
$$;
REVOKE ALL ON FUNCTION account_my_open_charges(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION account_my_open_charges(uuid) TO app;

CREATE FUNCTION account_my_join_requests(p_account_id uuid)
RETURNS TABLE (request_id uuid, session_id uuid, club_ref text, club_label text,
               starts_at timestamptz, area text, status text, created_at timestamptz,
               decided_at timestamptz, expires_at timestamptz)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_person uuid;
  v_tenant uuid;
  v_prev   text := current_setting('app.tenant_id', true);
BEGIN
  SELECT p.id INTO v_person
    FROM public.accounts a
    JOIN public.persons p ON p.id = a.person_id AND p.status = 'active'
   WHERE a.id = p_account_id;
  IF v_person IS NULL THEN RETURN; END IF;
  FOR v_tenant IN SELECT t.id FROM public.tenants t ORDER BY t.id LOOP
    PERFORM set_config('app.tenant_id', v_tenant::text, true);
    -- one join_requests scan per tenant per call: no (tenant_id, person_id) index (COST, header)
    RETURN QUERY
      SELECT jr.id, jr.session_id, t.slug, t.name, s.starts_at, s.area, jr.status,
             jr.created_at, jr.decided_at, jr.expires_at
        FROM public.join_requests jr
        JOIN public.sessions s ON s.id = jr.session_id AND s.tenant_id = v_tenant
        JOIN public.tenants t ON t.id = v_tenant
       WHERE jr.tenant_id = v_tenant AND jr.person_id = v_person
         AND jr.status IN ('pending', 'approved', 'rejected') AND s.ends_at > now()
       ORDER BY jr.created_at DESC, jr.id DESC
       LIMIT 51;
  END LOOP;
  PERFORM set_config('app.tenant_id', coalesce(v_prev, ''), true);
END;
$$;
REVOKE ALL ON FUNCTION account_my_join_requests(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION account_my_join_requests(uuid) TO app;
