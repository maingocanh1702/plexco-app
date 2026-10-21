-- ============================================================================
-- 0068_public_name_invisible_chars.sql
-- L23 (DD-138 owner sign-off A.1, 2026-10-21): "#61 R1-5 (default-ignorable code points allowed):
-- REJECTED -> follow-up lane: strip default-ignorable / invisible code points from every publicly
-- displayed name." R1-5 had kept 4029 default-ignorable code points (260 variation selectors, 3769
-- unassigned) allowed, so invisible characters could be inserted to impersonate a venue name.
--
-- FIELDS (RO-L23-1, D1): sessions.area, sessions.venue_name, tenants.public_alias. Untouched here:
-- sessions.venue_address, persons.display_name, tenants.name, memberships.display_name (extending the
-- rule to them is an owner decision) and every non-name text.
--
-- THREAT MODEL (D12): defends against impersonation and blank-looking names on public surfaces
-- through invisible code points (the R1-5 consequence). It does NOT defend against visible
-- confusables (homoglyphs); those stay out of scope (a backlog candidate).
--
-- STRIP SET (D2, Unicode 17.0): Default_Ignorable_Code_Point minus Bidi_Control = 4162 code points in
-- 16 ranges: 00AD 034F 115F-1160 17B4-17B5 180B-180F 200B-200D 2060-2065 206A-206F 3164 FE00-FE0F
-- FEFF FFA0 FFF0-FFF8 1BCA0-1BCA3 1D173-1D17A E0000-E0FFF. SQL holds it ONCE, in
-- public_name_strip_invisible below; TypeScript holds it once, in packages/db/src/text-safety.ts; a
-- test pins the two lists equal over every code point. The bidi controls, the other format and
-- control characters, U+2028, U+2029 and U+2800 stay REFUSED exactly as before (c_reject unchanged).
-- Nothing beyond stripping: no NFC/NFKC rewrite, no case folding, no confusable mapping.
--
-- EMOJI CONSEQUENCE (D11, the owner rule applied as written, no exception): U+200D (ZERO WIDTH
-- JOINER) and U+FE0F (VARIATION SELECTOR-16) are in the set, so composed emoji split or render as
-- text: U+2764 U+FE0F -> U+2764; U+1F468 U+200D U+1F469 U+200D U+1F467 -> U+1F468 U+1F469 U+1F467.
--
-- ORDER (D3): strip -> the field's existing trim -> every existing check unchanged on the stripped
-- value; an alias with no visible character left is refused like an empty one (22023, D4).
-- WRITE PATH (D5): tenant_public_alias_set strips before its trim (re-created below, otherwise
-- byte-identical to 0060); the two session columns have no SQL writer (the TypeScript session
-- service strips them).
-- CLEANUP (D5-D8), once, in the block between the two L23 cleanup marker lines at the end:
--   sessions.area, sessions.venue_name: strip only; each changed session is re-projected through
--     public_sessions_project_session (0067) inside this transaction.
--   tenants.public_alias: strip, then the 0060 trim, by a direct UPDATE (the set definer would reset
--     the status and emit an event): the status is kept (approved included), one NOTICE per tenant
--     id, no audit row, no event (D6). The public surfaces read the alias live: no projection
--     changes. A pending alias listed before this runs fails decide's digest CAS (55000): re-list.
--   a value the strip would leave with no visible character stays unchanged, one NOTICE each (D7).
--   fail closed on visibility (D8): a runner that row security applies to proceeds only on tables
--     that hold no heap page; otherwise the file raises (apply it as the superuser migration role).
-- Privileges: the helper is owned by the migration role, which also owns tenant_public_alias_set
-- (0060 has no SET ROLE); EXECUTE is revoked from PUBLIC; no grant, no SET ROLE, no FORCE RLS change.
-- ============================================================================

CREATE FUNCTION public.public_name_strip_invisible(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT regexp_replace(p_text, '['
    || E'\u00ad\u034f\u115f-\u1160\u17b4-\u17b5\u180b-\u180f\u200b-\u200d'
    || E'\u2060-\u2065\u206a-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0\ufff0-\ufff8'
    || E'\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0000-\U000e0fff'
    || ']', '', 'g');
$$;

REVOKE ALL ON FUNCTION public.public_name_strip_invisible(text) FROM PUBLIC, app, app_worker, readonly;
COMMENT ON FUNCTION public.public_name_strip_invisible(text) IS
  'L23 (DD-138 A.1, R1-5 rejected): removes Default_Ignorable_Code_Point minus Bidi_Control '
  '(Unicode 17.0, 4162 code points in 16 ranges) from a publicly displayed name. Threat model: '
  'defends against impersonation and blank-looking public names through invisible code points; '
  'does not defend against visible confusables (homoglyphs). Pinned equal to the list in '
  'packages/db/src/text-safety.ts by a test.';

-- The 0060 definer with ONE added step (D3, D9): the alias is stripped before its trim. CREATE OR
-- REPLACE keeps the owner and the ACL (EXECUTE app only) but resets every omitted attribute, so all
-- of them are restated; the character constants stay byte-equal to 0055 (A-12).
CREATE OR REPLACE FUNCTION public.tenant_public_alias_set(p_tenant_id uuid, p_actor_person_id uuid, p_alias text)
RETURNS TABLE (public_alias text, public_alias_status text, changed boolean)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_ctx     uuid;
  v_allowed boolean;
  v_alias   text;
  v_old     text;
  v_status  text;
  -- ECMAScript WhiteSpace + LineTerminator: exactly the set String.prototype.trim removes.
  c_ws     CONSTANT text := E'\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff';
  c_space  CONSTANT text := '[' || c_ws || ']';
  -- Cc (U+0000 never reaches a text parameter), Cf, Zl/Zp, the default-ignorable code points that are
  -- not variation selectors, and U+2800; see the header for where each list comes from.
  c_reject CONSTANT text := '['
    || E'\u0001-\u001f\u007f-\u009f'
    || E'\u00ad\u0600-\u0605\u061c\u06dd\u070f\u0890\u0891\u08e2\u180e'
    || E'\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb'
    || E'\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3'
    || E'\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f'
    || E'\u2028\u2029'
    || E'\u034f\u17b4\u17b5\u115f\u1160\u3164\uffa0'
    || E'\u2800'
    || ']';
  -- One code point outside c_ws and Default_Ignorable_Code_Point (all 17 ranges, variation selectors
  -- and unassigned code points included): one that renders as something.
  c_visible CONSTANT text := '[^' || c_ws
    || E'\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u202a-\u202e'
    || E'\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0\ufff0-\ufff8'
    || E'\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0000-\U000e0fff'
    || ']';
BEGIN
  BEGIN
    v_ctx := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_ctx := NULL;
  END;
  IF p_tenant_id IS NULL OR v_ctx IS NULL OR p_tenant_id <> v_ctx THEN
    RAISE EXCEPTION 'tenant_public_alias_set: tenant context mismatch'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Authorization FIRST (DD-56), one message for every deny reason.
  SELECT a.allowed INTO v_allowed
    FROM public.tenant_capability_authorize(p_tenant_id, 'content.manage', p_actor_person_id) a;
  IF v_allowed IS NOT TRUE THEN
    RAISE EXCEPTION 'tenant_public_alias_set: not permitted'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_alias IS NULL THEN
    RAISE EXCEPTION 'tenant_public_alias_set: alias is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- L23 (D3): strip the invisible set first, then trim; every check below is unchanged.
  v_alias := regexp_replace(public.public_name_strip_invisible(p_alias), '^' || c_space || '+|' || c_space || '+$', '', 'g');
  IF char_length(v_alias) < 1 OR char_length(v_alias) > 60 OR v_alias ~ c_reject
     OR v_alias !~ c_visible THEN
    RAISE EXCEPTION 'tenant_public_alias_set: alias must be 1-60 printable characters'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Same key as club-config.ts (re-entrant when the TS caller already holds it), then the row.
  PERFORM pg_advisory_xact_lock(hashtextextended('club-config:' || p_tenant_id::text, 0));
  SELECT t.public_alias, t.public_alias_status INTO v_old, v_status
    FROM public.tenants t
   WHERE t.id = p_tenant_id
     FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  -- Identical trimmed text is a no-op whatever the status (approved stays approved).
  IF v_old IS NOT DISTINCT FROM v_alias THEN
    RETURN QUERY SELECT v_old, v_status, false;
    RETURN;
  END IF;

  -- A different text always goes back to pending: no club edit keeps an approval.
  UPDATE public.tenants
     SET public_alias = v_alias, public_alias_status = 'pending'
   WHERE id = p_tenant_id;
  INSERT INTO public.outbox_events (tenant_id, aggregate_type, aggregate_id, sequence, type, payload)
  SELECT p_tenant_id, 'tenant', p_tenant_id, coalesce(max(o.sequence), 0) + 1,
         'tenant.public_alias_set', jsonb_build_object('status', 'pending')
    FROM public.outbox_events o
   WHERE o.aggregate_id = p_tenant_id;
  RETURN QUERY SELECT v_alias, 'pending'::text, true;
END;
$$;

-- The one-time cleanup (D5-D8). Self-contained and safe to run twice: a cleaned value is no longer
-- a candidate; a value left unchanged (D7) is reported again and still not changed.
-- L23-CLEANUP-BEGIN
DO $l23_cleanup$
DECLARE
  -- The 0060 trim and visible rule: a byte-equal copy of the constants of tenant_public_alias_set
  -- above (0055, 0060), written once here for the three fields.
  c_ws     CONSTANT text := E'\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff';
  c_space  CONSTANT text := '[' || c_ws || ']';
  c_visible CONSTANT text := '[^' || c_ws
    || E'\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u202a-\u202e'
    || E'\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0\ufff0-\ufff8'
    || E'\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0000-\U000e0fff'
    || ']';
  r           record;
  v_area      text;
  v_venue     text;
  v_alias     text;
  n_sessions  integer := 0;
  n_projected integer := 0;
  n_aliases   integer := 0;
  n_left      integer := 0;
BEGIN
  -- D8: never silently skip a row row security hides. Superuser and BYPASSRLS runners (and an owner
  -- without FORCE RLS) see every row: row_security_active is false. Otherwise the table must hold no
  -- heap page at all (the empty schema of the non-superuser test chain), else raise.
  IF (row_security_active('public.sessions') AND pg_relation_size('public.sessions') > 0)
     OR (row_security_active('public.tenants') AND pg_relation_size('public.tenants') > 0) THEN
    RAISE EXCEPTION '0068 cleanup: row security applies to % and sessions or tenants holds rows it may not see; apply 0068 as the superuser migration role',
      current_user USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- sessions.area and sessions.venue_name: the write transform is the strip alone.
  FOR r IN
    SELECT s.id, s.area, s.venue_name
      FROM public.sessions s
     WHERE s.area IS DISTINCT FROM public.public_name_strip_invisible(s.area)
        OR s.venue_name IS DISTINCT FROM public.public_name_strip_invisible(s.venue_name)
     ORDER BY s.id
       FOR UPDATE
  LOOP
    v_area := public.public_name_strip_invisible(r.area);
    v_venue := public.public_name_strip_invisible(r.venue_name);
    IF v_area IS DISTINCT FROM r.area AND v_area !~ c_visible THEN
      RAISE NOTICE '0068 cleanup: session % area left unchanged (no visible character after the strip)', r.id;
      n_left := n_left + 1;
      v_area := r.area;
    END IF;
    IF v_venue IS DISTINCT FROM r.venue_name AND v_venue !~ c_visible THEN
      RAISE NOTICE '0068 cleanup: session % venue_name left unchanged (no visible character after the strip)', r.id;
      n_left := n_left + 1;
      v_venue := r.venue_name;
    END IF;
    IF v_area IS DISTINCT FROM r.area OR v_venue IS DISTINCT FROM r.venue_name THEN
      UPDATE public.sessions SET area = v_area, venue_name = v_venue WHERE id = r.id;
      n_sessions := n_sessions + 1;
      -- The projector's own path (its lock, fence and venue mask) rewrites or removes the public row.
      PERFORM public.public_sessions_project_session(r.id, NULL);
      n_projected := n_projected + 1;
    END IF;
  END LOOP;

  -- tenants.public_alias: the write transform of tenant_public_alias_set above (strip, then trim).
  FOR r IN
    SELECT t.id, t.public_alias
      FROM public.tenants t
     WHERE t.public_alias IS DISTINCT FROM public.public_name_strip_invisible(t.public_alias)
     ORDER BY t.id
       FOR UPDATE
  LOOP
    v_alias := regexp_replace(public.public_name_strip_invisible(r.public_alias),
                              '^' || c_space || '+|' || c_space || '+$', '', 'g');
    IF v_alias ~ c_visible THEN
      UPDATE public.tenants SET public_alias = v_alias WHERE id = r.id;
      n_aliases := n_aliases + 1;
      RAISE NOTICE '0068 cleanup: tenant % public alias stripped, status kept', r.id;
    ELSE
      RAISE NOTICE '0068 cleanup: tenant % public alias left unchanged (no visible character after the strip)', r.id;
      n_left := n_left + 1;
    END IF;
  END LOOP;

  RAISE NOTICE '0068 cleanup: % sessions changed, % re-projected, % public aliases changed, % values left unchanged',
    n_sessions, n_projected, n_aliases, n_left;
END
$l23_cleanup$;
-- L23-CLEANUP-END
