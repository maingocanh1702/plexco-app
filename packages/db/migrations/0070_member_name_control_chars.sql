-- ============================================================================
-- 0070_member_name_control_chars.sql
-- L29, the follow-up of L27 (conductor decision D3 under the owner's delegation of 2026-10-22, not an
-- owner signature; decision record DD-147): the control half of the owner's item 6 wording. After the
-- 0068 strip, ONE rule decides what persons.display_name, memberships.display_name, tenants.name and
-- sessions.venue_address may hold, at every writer. Specification: sections 4-8 of
-- docs/sessions/web-mvp-phase3-readiness-p3-name-writers-refuse-control-bidi.md. Unchanged: the strip
-- set, the emoji rule, the length limits and the L23 public-name semantics.
--
-- THREAT MODEL: defends against (1) bidi-override name spoofing on rosters, join-request inboxes, chat
-- author labels and club names (a <bdi> wrapper does not stop an override inside the label); (2)
-- control and separator code points breaking single-line fields, logs and exports; (3) blank-looking
-- names impersonating "nobody" or hiding a person (Zs-only, U+2800-only, bidi-only, invisible-only);
-- (4) writer inconsistency: create versus set (tenant_provision versus tenant_profile_update), SQL
-- versus TypeScript versus web; (5) a hostile external display name (Zalo, Google) blocking sign-in or
-- identity resolution: it is normalized, never raised; (6) a second definition of the rule drifting
-- from the first: one function, its constants byte-pinned to person_profile_update's by a test.
-- NOT defended (backlog): homoglyphs and confusables. Residual risks: a writer missed by the inventory
-- (a source-scan guard test fails it) and stored production values nobody here can measure (the
-- guarded one-time cleanup of this file).
--
-- THE RULE public.member_name_apply_rule(p_value, p_external), with person_profile_update's (0069)
-- sets: strip S (the 0068 helper), trim T (exactly String.prototype.trim), then
--   p_external false (a person typed it): NULL when the value holds a refused code point R (Cc, Cf
--     with all 12 Bidi_Control, U+2028, U+2029, U+2800, ...) or no visible character V; the calling
--     definer raises its own 22023. An R code point that is also in T is trimmed at the edges.
--   p_external true (Zalo, Google, a copied name): every R code point removed, T trimmed again, NULL
--     when no V character remains; it never raises.
-- STRICT (NULL in, NULL out); each writer's own length check runs on the result.
--
-- WRITERS: person_profile_update already applies the rule and is not re-created. Re-created to call
-- it, every attribute restated as live: create_host_added_person, tenant_provision and
-- tenant_profile_update in mode false; zalo_identity_resolve, auth_login_google and
-- create_guest_membership in mode true.
--
-- PRIVILEGES: the rule is owner-only (REVOKE ALL from PUBLIC, app, app_worker and readonly; no grant)
-- and SECURITY INVOKER: the definers call it, and through it the owner-only 0068 helper, as their
-- owner. The block between the two L29 owner-check marker lines raises 42501 unless the rule and the
-- six definers have the owner of the 0068 helper; no ALTER OWNER, no SET ROLE.
-- ============================================================================

-- Section A: the rule. Attributes as the 0068 helper's; constants byte-equal to 0069:441-461.
CREATE FUNCTION public.member_name_apply_rule(p_value text, p_external boolean)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE
  v_name   text;
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
  v_name := regexp_replace(public.public_name_strip_invisible(p_value), '^' || c_space || '+|' || c_space || '+$', '', 'g');
  IF p_external THEN
    v_name := regexp_replace(regexp_replace(v_name, c_reject, '', 'g'), '^' || c_space || '+|' || c_space || '+$', '', 'g');
  ELSIF v_name ~ c_reject THEN
    RETURN NULL;
  END IF;
  IF v_name !~ c_visible THEN
    RETURN NULL;
  END IF;
  RETURN v_name;
END;
$$;

REVOKE ALL ON FUNCTION public.member_name_apply_rule(text, boolean) FROM PUBLIC, app, app_worker, readonly;
COMMENT ON FUNCTION public.member_name_apply_rule(text, boolean) IS
  'L29 (DD-147): the one rule of the member-facing name writers after the 0068 strip and the trim. '
  'p_external false (typed by a person): the value, or NULL when it holds a control, bidi, separator, '
  'U+2800 or other refused code point or no visible character (the caller raises 22023). p_external '
  'true (Zalo, Google, a copied name): those code points removed, NULL when no visible character '
  'remains; never raises. Constants byte-equal to person_profile_update (0069), pinned by a test. '
  'Threat model: the 0070 header.';

-- Read-only owner check, before any definer is re-created: the rule is owner-only, so the rule and
-- the six definers that call it must all have the owner of the owner-only 0068 helper.
-- L29-OWNER-CHECK-BEGIN
DO $l29_owner_check$
DECLARE
  v_helper_owner oid;
  v_mismatch text;
BEGIN
  SELECT p.proowner INTO STRICT v_helper_owner
    FROM pg_catalog.pg_proc p
   WHERE p.oid = 'public.public_name_strip_invisible(text)'::pg_catalog.regprocedure;

  SELECT pg_catalog.string_agg(
           pg_catalog.format('%s (owner %s)', f.fn::text, pg_catalog.pg_get_userbyid(p.proowner)),
           ', ' ORDER BY f.fn::text)
    INTO v_mismatch
    FROM pg_catalog.unnest(ARRAY[
           'public.member_name_apply_rule(text, boolean)',
           'public.create_host_added_person(uuid, uuid, text)',
           'public.tenant_provision(text, text, text, text, uuid)',
           'public.tenant_profile_update(uuid, uuid, text, text, text)',
           'public.zalo_identity_resolve(uuid, uuid, text, text, bytea, text)',
           'public.auth_login_google(text, text, bytea, text, uuid, text, text)',
           'public.create_guest_membership(uuid, uuid)'
         ]::pg_catalog.regprocedure[]) AS f(fn)
    JOIN pg_catalog.pg_proc p ON p.oid = f.fn
   WHERE p.proowner <> v_helper_owner;

  IF v_mismatch IS NOT NULL THEN
    RAISE EXCEPTION '0070: not owned by %, the owner of public.public_name_strip_invisible(text): %',
      pg_catalog.pg_get_userbyid(v_helper_owner), v_mismatch
      USING ERRCODE = '42501';
  END IF;
END
$l29_owner_check$;
-- L29-OWNER-CHECK-END
