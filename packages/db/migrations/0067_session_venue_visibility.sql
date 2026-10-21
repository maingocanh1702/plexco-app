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
