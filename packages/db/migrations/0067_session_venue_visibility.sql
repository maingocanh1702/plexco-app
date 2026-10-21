-- 0067_session_venue_visibility: the session venue is public by default; a per-session host
-- option hides the exact address until the viewer holds an active seat.
--
-- WHY. DD-139 records owner decision B1 of 2026-10-21, which reverses DD-06 and L9 M-7: public
-- cards, discover detail, player web and /me reads show the venue name and address to everyone,
-- unless the host turns ON the new per-session option "hide exact address until confirmed"
-- (sessions.hide_exact_address, default OFF). With the option ON the old DD-06 rule holds exactly:
-- the public sees the area only, and the exact venue is returned only to a viewer whose
-- players.status = 'active' in that session. The public read model whitelist of DD-133 D1 is
-- amended by exactly the two venue columns.
--
-- SUPERSEDED. The venue column comments of 0002:83-84 and the 0059:13-15 header of
-- account_my_sessions state the DD-06 rule as unconditional. Old migrations are append-only and
-- never edited, so this header supersedes them: from here on that rule holds only while
-- sessions.hide_exact_address is ON.
--
-- LAYOUT. One migration, three sections, applied in order:
--   A. (this section, as the migration role) sessions.hide_exact_address; public_sessions.venue_name
--      and public_sessions.venue_address; the column grants the projector writer (job_definer)
--      needs, in the 0061:62 / 0061:67-77 pattern.
--   B. (appended below this section by the next unit) account_my_sessions re-created OUTSIDE the
--      definer bracket: seat rows return the venue when the option is OFF or pl.status = 'active';
--      pending (waitlisted / requested) rows return it only when the option is OFF; the row set is
--      unchanged, so left / removed seats still return no row.
--   C. (appended below section B by the unit after it) public_session_share_v and
--      public_sessions_project_session re-created INSIDE the job_definer bracket of 0061:90-91 /
--      0061:509-510: the writer projects CASE WHEN s.hide_exact_address THEN NULL ELSE s.venue_name
--      END (address alike); the view appends venue_name and venue_address last.
--   Nothing else: no fence change (0033 untouched), no outbox route row (0061:489-503 unchanged), no
--   other function, no new role.
--
-- THREAT MODEL. Defends against:
--   T1 leaking an exact venue the host chose to hide: with the option ON the venue never leaves the
--      database for the public read model or for a viewer who is not active in that session. SQL
--      enforces it in exactly two places (the writer, section C; account_my_sessions, section B);
--      the web layers pass the SQL value through and never re-derive it.
--   T2 leaking anything beyond the venue: the public read model gains exactly venue_name and
--      venue_address (the public DTO exactly venueName and venueAddress); the whitelist tests pin
--      the exact column and key sets.
--   T3 a stale projection: toggling the option re-projects the session through the outbox path the
--      projector already uses (session.updated, 0061:494, then the writer). Between the toggle and
--      the next projection the public row keeps the venue; the dispatch cycle bounds that window,
--      and with dispatch off nothing re-projects (the same staleness every other public field has).
--   Not defended: a viewer who copied the venue before the toggle. The /me read has no window (it
--   reads sessions directly). The DD-12 fence is declined (readiness file, section 2 pin 2).

-- ---------------------------------------------------------------------------
-- Section A: as the migration role.
-- ---------------------------------------------------------------------------

-- Every existing session gets the option OFF, so its venue becomes public: the owner's B1 default.
ALTER TABLE public.sessions ADD COLUMN hide_exact_address boolean NOT NULL DEFAULT false;

-- The projected venue: NULL whenever the option is ON or no venue was typed (written by section C).
ALTER TABLE public.public_sessions ADD COLUMN venue_name text, ADD COLUMN venue_address text;

-- What the writer reads and writes, added to 0061:62 and 0061:67-77. One column list per privilege:
-- "GRANT SELECT, INSERT, UPDATE (cols)" would grant SELECT and INSERT on the whole table.
GRANT SELECT (venue_name, venue_address, hide_exact_address) ON public.sessions TO job_definer;
GRANT SELECT (venue_name, venue_address) ON public.public_sessions TO job_definer;
GRANT INSERT (venue_name, venue_address) ON public.public_sessions TO job_definer;
GRANT UPDATE (venue_name, venue_address) ON public.public_sessions TO job_definer;
-- app: nothing new. 0009 grants app no column-level privilege on sessions (its only GRANT lines that
-- name sessions, 0009:117-118, are table-level grants on public_sessions). app, app_worker and
-- readonly keep no privilege on public_sessions (0033:237-238, 0036:36, 0061:511-513).

-- ---------------------------------------------------------------------------
-- Section B: as the migration role, OUTSIDE any definer bracket (owned like 0059, M-14).
-- ---------------------------------------------------------------------------

-- account_my_sessions (0059:80-149) re-created for DD-139 / B1. This supersedes the 0059:13-15 header
-- line "the venue only for an active seat (M-7)": it now holds only while hide_exact_address is ON.
-- Changed: the four venue expressions (a seat returns the venue when the option is OFF or
-- pl.status = 'active'; a pending request only when the option is OFF) and the (a) comment that
-- states the rule. Restated unchanged from 0059: RETURNS TABLE, the attributes (CREATE OR REPLACE
-- resets omitted ones), the row set (M-3: left seats return no row) and the ACL; the owner is kept.
CREATE OR REPLACE FUNCTION public.account_my_sessions(p_account_id uuid)
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
          -- (a) own seats; with sessions.hide_exact_address ON the venue never leaves the database
          -- for a caller who is not active (DD-139 / B1)
          SELECT s.id AS session_id, t.slug AS club_ref, t.name AS club_label, sp.key AS sport_key,
                 s.starts_at, s.ends_at, s.timezone, s.area, pl.status AS my_status,
                 CASE WHEN pl.status = 'waitlisted' THEN pl.waitlist_position END AS waitlist_position,
                 CASE WHEN NOT s.hide_exact_address OR pl.status = 'active' THEN s.venue_name END
                   AS venue_name,
                 CASE WHEN NOT s.hide_exact_address OR pl.status = 'active' THEN s.venue_address END
                   AS venue_address
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
                 'pending'::text, NULL::integer,
                 CASE WHEN NOT s.hide_exact_address THEN s.venue_name END,
                 CASE WHEN NOT s.hide_exact_address THEN s.venue_address END
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
REVOKE ALL ON FUNCTION public.account_my_sessions(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.account_my_sessions(uuid) TO app;

-- ---------------------------------------------------------------------------
-- Section C (DD-139 / owner decision B1): the share view serves the venue and the writer projects
-- it unless the host hid it. Created AS job_definer in the 0061:90-91 / 0061:509-510 bracket; this
-- text supersedes the 0061 text of public_session_share_v and public_sessions_project_session (0061
-- is never edited). Owner and ACL stay as 0061 set them; the ACL is restated below.
-- T1: hide_exact_address ON => the writer projects NULL venue columns; the view never serves them.
-- T3: toggling the option re-projects (the 0061:494 route); the next run clears or restores the venue.
-- ---------------------------------------------------------------------------
GRANT CREATE ON SCHEMA public TO job_definer;
SET ROLE job_definer;

-- CREATE OR REPLACE VIEW may only append columns, and it replaces reloptions: security_barrier is
-- restated. The 17 columns and the FROM / WHERE part are the 0061 text unchanged.
CREATE OR REPLACE VIEW public.public_session_share_v WITH (security_barrier = true) AS
SELECT
  ps.public_listing_id,
  ps.sport_key,
  ps.starts_at,
  ps.ends_at,
  ps.area,
  ps.price_amount,
  ps.slots_open,
  t.public_alias AS club_display_name,
  ps.join_policy,
  ps.title,
  ps.session_type,
  ps.level_min_rank,
  ps.level_max_rank,
  ps.level_strict,
  ps.gender_restriction,
  ps.age_min,
  ps.age_max,
  ps.venue_name,
  ps.venue_address
FROM public_sessions ps
JOIN tenants t ON t.id = ps.tenant_id
WHERE ps.expires_at > now()
  AND t.public_alias_status = 'approved'
  AND t.status NOT IN ('suspended', 'cancelled')
  AND NOT EXISTS (
    SELECT 1 FROM public_projection_fences f
    WHERE f.surface = 'session_share'
      AND f.target_kind = 'session'
      AND f.target_id = ps.session_id
      AND f.deny_scope IN ('public','all')
  );

-- The 0061 writer with the venue added (R2). CREATE OR REPLACE keeps the owner and the ACL but
-- resets every omitted attribute, so all of them are restated.
CREATE OR REPLACE FUNCTION public.public_sessions_project_session(p_session_id uuid, p_event_id uuid)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_found         boolean;
  v_tenant_id     uuid;
  v_status        text;
  v_visibility    text;
  v_starts_at     timestamptz;
  v_ends_at       timestamptz;
  v_area          text;
  v_price_amount  integer;
  v_slots_max     integer;
  v_join_policy   text;
  v_sport_key     text;
  v_tenant_status text;
  v_alias_status  text;
  v_venue_name    text;
  v_venue_address text;
  v_listable      boolean;
  v_slots_open    integer;
  v_existed       boolean;
  v_rows          integer;
  v_fence_token   uuid;
  v_disposition   text;
BEGIN
  -- D8 (s2 S2-SF-1): D3's observe-then-recompute order needs a fresh snapshot per statement after
  -- the lock (READ COMMITTED); a caller-held or imported REPEATABLE READ / SERIALIZABLE snapshot
  -- could replay a past public state.
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION 'public_sessions_project_session: transaction isolation %',
      current_setting('transaction_isolation') USING ERRCODE = '25000';
  END IF;
  -- P-11: one writer per session at a time; the slug definers take the same lock.
  PERFORM pg_advisory_xact_lock(hashtextextended('public-sessions:' || p_session_id::text, 0));
  -- D3 (s1 S-1): observe the DD-12 fence token BEFORE any canonical read. A raise commits with its
  -- source transition, so every token observed here predates the rows read below; the last
  -- statement CAS-clears exactly this token, and a raise committed after this read survives.
  v_fence_token := current_public_session_fence_token(p_session_id);

  -- DD-139 / B1 (T1): the venue is masked at this read (the writer's only read of sessions), so no
  -- path below can write a venue the host hid; an untyped venue stays NULL.
  SELECT s.tenant_id, s.status, s.visibility, s.starts_at, s.ends_at, s.area, s.price_amount,
         s.slots_max, s.join_policy, sp.key, t.status, t.public_alias_status,
         CASE WHEN s.hide_exact_address THEN NULL ELSE s.venue_name END,
         CASE WHEN s.hide_exact_address THEN NULL ELSE s.venue_address END
    INTO v_tenant_id, v_status, v_visibility, v_starts_at, v_ends_at, v_area, v_price_amount,
         v_slots_max, v_join_policy, v_sport_key, v_tenant_status, v_alias_status,
         v_venue_name, v_venue_address
    FROM sessions s
    JOIN sports sp ON sp.id = s.sport_id
    JOIN tenants t ON t.id = s.tenant_id
   WHERE s.id = p_session_id;
  v_found := FOUND;

  -- Every eligibility condition except slots_max (P-4: future = starts_at > now(); P-7).
  v_listable := coalesce(
    v_found
      AND v_status = 'open'
      AND v_visibility = 'public'
      AND v_starts_at > now()
      AND btrim(coalesce(v_area, '')) <> ''
      AND v_alias_status = 'approved'
      AND v_tenant_status NOT IN ('suspended', 'cancelled'),
    false);

  IF v_listable AND v_slots_max IS NULL THEN
    -- R-1 / P-6: defensive (sessions_public_capacity_chk makes it unrepresentable for public
    -- sessions): an unlimited session is never projected, and the event is audited once.
    DELETE FROM public_sessions WHERE id = p_session_id;
    UPDATE public_session_share_slugs SET revoked_at = clock_timestamp()
     WHERE session_id = p_session_id AND revoked_at IS NULL;
    IF p_event_id IS NOT NULL THEN
      INSERT INTO job_audit_events (job_id, tenant_id, actor, reason, fn_name, operation_id)
      VALUES (p_event_id, v_tenant_id, 'system', 'public_projection_ineligible_unlimited',
              'public_sessions_project_session', gen_random_uuid());
    END IF;
    v_disposition := 'ineligible_unlimited';
  ELSIF NOT v_listable THEN
    -- draft, private, closed, cancelled, past, blank area, no approved alias, suspended or
    -- cancelled tenant, or no such session: no row; the active slug dies with the listing.
    DELETE FROM public_sessions WHERE id = p_session_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    UPDATE public_session_share_slugs SET revoked_at = clock_timestamp()
     WHERE session_id = p_session_id AND revoked_at IS NULL;
    v_disposition := CASE WHEN v_rows > 0 THEN 'deleted' ELSE 'absent' END;
  ELSE
    v_slots_open := greatest(0, v_slots_max - session_occupancy(p_session_id));

    IF EXISTS (
      SELECT 1 FROM public_projection_fences f
      WHERE f.surface = 'session_share'
        AND f.target_kind = 'session'
        AND f.target_id = p_session_id
        AND f.deny_scope IN ('public','all')
    ) THEN
      -- P-16: an eligible recompute under a fence replaces the row (new public_listing_id, active
      -- slug tombstoned), so a public -> private -> public flip seen only afterwards still rotates.
      DELETE FROM public_sessions WHERE id = p_session_id;
      INSERT INTO public_sessions (id, session_id, tenant_id, sport_key, starts_at, ends_at, area,
          price_amount, slots_open, join_policy, projected_at, expires_at, public_projection_version,
          title, session_type, level_min_rank, level_max_rank, level_strict, gender_restriction,
          age_min, age_max, venue_name, venue_address)
      VALUES (p_session_id, p_session_id, v_tenant_id, v_sport_key, v_starts_at, v_ends_at, v_area,
          v_price_amount, v_slots_open, v_join_policy, now(), v_starts_at, 1,
          NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, v_venue_name, v_venue_address);
      UPDATE public_session_share_slugs SET revoked_at = clock_timestamp()
       WHERE session_id = p_session_id AND revoked_at IS NULL;
      v_disposition := 'rotated';
    ELSE
      v_existed := EXISTS (SELECT 1 FROM public_sessions WHERE id = p_session_id);
      -- P-5: version 1 on insert, +1 only when a projected column changed (re-delivery = no write).
      -- public_listing_id is never updated. The DD-41 columns are written NULL (P-1).
      INSERT INTO public_sessions AS ps (id, session_id, tenant_id, sport_key, starts_at, ends_at, area,
          price_amount, slots_open, join_policy, projected_at, expires_at, public_projection_version,
          title, session_type, level_min_rank, level_max_rank, level_strict, gender_restriction,
          age_min, age_max, venue_name, venue_address)
      VALUES (p_session_id, p_session_id, v_tenant_id, v_sport_key, v_starts_at, v_ends_at, v_area,
          v_price_amount, v_slots_open, v_join_policy, now(), v_starts_at, 1,
          NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, v_venue_name, v_venue_address)
      ON CONFLICT (id) DO UPDATE SET
          sport_key = EXCLUDED.sport_key,
          starts_at = EXCLUDED.starts_at,
          ends_at = EXCLUDED.ends_at,
          area = EXCLUDED.area,
          price_amount = EXCLUDED.price_amount,
          slots_open = EXCLUDED.slots_open,
          join_policy = EXCLUDED.join_policy,
          projected_at = EXCLUDED.projected_at,
          expires_at = EXCLUDED.expires_at,
          public_projection_version = ps.public_projection_version + 1,
          title = EXCLUDED.title,
          session_type = EXCLUDED.session_type,
          level_min_rank = EXCLUDED.level_min_rank,
          level_max_rank = EXCLUDED.level_max_rank,
          level_strict = EXCLUDED.level_strict,
          gender_restriction = EXCLUDED.gender_restriction,
          age_min = EXCLUDED.age_min,
          age_max = EXCLUDED.age_max,
          venue_name = EXCLUDED.venue_name,
          venue_address = EXCLUDED.venue_address
        WHERE (ps.sport_key, ps.starts_at, ps.ends_at, ps.area, ps.price_amount, ps.slots_open,
               ps.join_policy, ps.expires_at, ps.title, ps.session_type, ps.level_min_rank,
               ps.level_max_rank, ps.level_strict, ps.gender_restriction, ps.age_min, ps.age_max,
               ps.venue_name, ps.venue_address)
              IS DISTINCT FROM
              (EXCLUDED.sport_key, EXCLUDED.starts_at, EXCLUDED.ends_at, EXCLUDED.area,
               EXCLUDED.price_amount, EXCLUDED.slots_open, EXCLUDED.join_policy, EXCLUDED.expires_at,
               EXCLUDED.title, EXCLUDED.session_type, EXCLUDED.level_min_rank, EXCLUDED.level_max_rank,
               EXCLUDED.level_strict, EXCLUDED.gender_restriction, EXCLUDED.age_min, EXCLUDED.age_max,
               EXCLUDED.venue_name, EXCLUDED.venue_address);
      GET DIAGNOSTICS v_rows = ROW_COUNT;

      IF NOT v_existed THEN
        -- P-17: a new listing never inherits a slug minted for an earlier one.
        UPDATE public_session_share_slugs SET revoked_at = clock_timestamp()
         WHERE session_id = p_session_id AND revoked_at IS NULL;
        v_disposition := 'upserted';
      ELSE
        v_disposition := CASE WHEN v_rows > 0 THEN 'upserted' ELSE 'unchanged' END;
      END IF;
    END IF;
  END IF;

  -- D3: every path above leaves the row converged, so the CAS-clear of the OBSERVED token is the
  -- last statement; a newer token (a raise after the observation) is never cleared by this run.
  IF v_fence_token IS NOT NULL THEN
    PERFORM clear_public_session_fence(p_session_id, v_fence_token);
  END IF;
  RETURN v_disposition;
END;
$$;

-- The 0061:477-487 ACL of these two objects, restated as 0061 states it (no other role).
REVOKE ALL ON FUNCTION public.public_sessions_project_session(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON public.public_session_share_v FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_sessions_project_session(uuid, uuid) TO app_worker;
GRANT SELECT ON public.public_session_share_v TO readonly;

RESET ROLE;
REVOKE CREATE ON SCHEMA public FROM job_definer;
