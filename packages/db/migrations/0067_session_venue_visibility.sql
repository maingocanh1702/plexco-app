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
