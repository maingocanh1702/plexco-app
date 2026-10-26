-- ============================================================================
-- 0072_member_name_definers_qualify_builtins.sql
-- L41, the follow-up of L29 (conductor ruling under the owner's delegation of 2026-10-22, not an
-- owner signature): the ten functions of the member-name rule set call every built-in function by
-- its schema, and the two owner-only helpers list pg_temp last. Specification: sections 5 and 14 of
-- docs/sessions/web-mvp-phase4-readiness-p4-name-definers-and-rule-tests.md.
--
-- WHAT: the ten are re-created from their newest definitions by a generator kept outside the
-- repository, which copies each block by its exact line range, byte for byte, in this order:
-- public_name_strip_invisible (0068), member_name_apply_rule (0070), person_profile_update (0069),
-- create_host_added_person, tenant_provision, tenant_profile_update, zalo_identity_resolve,
-- auth_login_google, create_guest_membership (0070) and tenant_public_alias_set (0068). It makes
-- three edits and asserts them (the count per function, the total, and every block equal to its
-- source once the edits are reverted):
--   (1) pg_catalog. before each of the 45 unqualified built-in FUNCTION calls of the ten bodies
--       (regexp_replace, char_length, btrim, length, left, current_setting, set_config, now,
--       transaction_timestamp, pg_advisory_xact_lock, hashtextextended, max, jsonb_build_object),
--       each located by its source line; nothing inside a literal or a comment;
--   (2) the search_path of member_name_apply_rule and public_name_strip_invisible goes from
--       pg_catalog to pg_catalog, pg_temp;
--   (3) those two, created without OR REPLACE in their source files, gain OR REPLACE.
-- The eight definers keep their search_path: pg_catalog, public, pg_temp (six) and public, pg_temp
-- (tenant_provision, auth_login_google). Operators, casts, DECLARE types and keyword forms (COALESCE,
-- NULLIF, IN, CASE, ...) stay unqualified: OPERATOR(pg_catalog.op) takes the generic operator
-- precedence and could re-associate a byte-pinned expression; type names are covered by (2).
--
-- WHY (THREAT MODEL): a search_path that does not list pg_temp searches the session's temporary
-- schema FIRST for type and table names. The rule runs under its own search_path pg_catalog, so a
-- pg_temp.text domain planted by the calling session captures the type names of the rule's body
-- when a definer calls it; listing pg_temp last closes that class, and the strip helper gets the
-- same setting so that all ten list pg_temp last. pg_temp is never searched for functions; a
-- qualified call binds to pg_catalog whatever the search_path. The lane's pg_temp regression test
-- is the proof.
--
-- NOT CHANGED: what any writer accepts, refuses, normalizes or stores (each call binds the same
-- pg_catalog function as before); every other attribute (SECURITY, volatility, STRICT, PARALLEL,
-- LEAKPROOF, COST and the definers' search_path), restated exactly as its source block has it; the
-- owner and the ACL, which the re-creation keeps (no privilege, owner, comment, table, role or column
-- change in this file). The block between the two L41 owner-check marker lines raises 42501 unless
-- the nine other functions have the owner of the 0068 helper; it only reads the catalog.
--
-- ROLLBACK: a forward migration that restates the 0068-0070 bodies and attributes of the ten.
-- ============================================================================

-- Read-only owner check, before any function is re-created: the helper and the rule are owner-only
-- and the definers call them as their owner, so the nine others must all have the helper's owner.
-- L41-OWNER-CHECK-BEGIN
DO $l41_owner_check$
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
           'public.person_profile_update(uuid, text)',
           'public.create_host_added_person(uuid, uuid, text)',
           'public.tenant_provision(text, text, text, text, uuid)',
           'public.tenant_profile_update(uuid, uuid, text, text, text)',
           'public.zalo_identity_resolve(uuid, uuid, text, text, bytea, text)',
           'public.auth_login_google(text, text, bytea, text, uuid, text, text)',
           'public.create_guest_membership(uuid, uuid)',
           'public.tenant_public_alias_set(uuid, uuid, text)'
         ]::pg_catalog.regprocedure[]) AS f(fn)
    JOIN pg_catalog.pg_proc p ON p.oid = f.fn
   WHERE p.proowner <> v_helper_owner;

  IF v_mismatch IS NOT NULL THEN
    RAISE EXCEPTION '0072: not owned by %, the owner of public.public_name_strip_invisible(text): %',
      pg_catalog.pg_get_userbyid(v_helper_owner), v_mismatch
      USING ERRCODE = '42501';
  END IF;
END
$l41_owner_check$;
-- L41-OWNER-CHECK-END

-- 1/10 public_name_strip_invisible, newest definition 0068:50-63: 1 built-in call qualified; search_path lists pg_temp last.
CREATE OR REPLACE FUNCTION public.public_name_strip_invisible(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT pg_catalog.regexp_replace(p_text, '['
    || E'\u00ad\u034f\u115f-\u1160\u17b4-\u17b5\u180b-\u180f\u200b-\u200d'
    || E'\u2060-\u2065\u206a-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0\ufff0-\ufff8'
    || E'\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0000-\U000e0fff'
    || ']', '', 'g');
$$;

-- 2/10 member_name_apply_rule, newest definition 0070:43-87: 3 built-in calls qualified; search_path lists pg_temp last.
CREATE OR REPLACE FUNCTION public.member_name_apply_rule(p_value text, p_external boolean)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
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
  v_name := pg_catalog.regexp_replace(public.public_name_strip_invisible(p_value), '^' || c_space || '+|' || c_space || '+$', '', 'g');
  IF p_external THEN
    v_name := pg_catalog.regexp_replace(pg_catalog.regexp_replace(v_name, c_reject, '', 'g'), '^' || c_space || '+|' || c_space || '+$', '', 'g');
  ELSIF v_name ~ c_reject THEN
    RETURN NULL;
  END IF;
  IF v_name !~ c_visible THEN
    RETURN NULL;
  END IF;
  RETURN v_name;
END;
$$;

-- 3/10 person_profile_update, newest definition 0069:429-483: 3 built-in calls qualified.
CREATE OR REPLACE FUNCTION person_profile_update(p_account_id uuid, p_display_name text)
RETURNS TABLE (person_id uuid, display_name text)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_name   text;
  v_person uuid;
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
  IF p_account_id IS NULL OR p_display_name IS NULL THEN
    RAISE EXCEPTION 'person_profile_update: account id and display name are required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  v_name := pg_catalog.regexp_replace(public.public_name_strip_invisible(p_display_name), '^' || c_space || '+|' || c_space || '+$', '', 'g');
  IF pg_catalog.char_length(v_name) < 1 OR pg_catalog.char_length(v_name) > 120 OR v_name ~ c_reject
     OR v_name !~ c_visible THEN
    RAISE EXCEPTION 'person_profile_update: display name must be 1-120 printable characters'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT a.person_id INTO v_person FROM public.accounts a WHERE a.id = p_account_id FOR UPDATE;
  IF v_person IS NULL THEN RETURN; END IF;
  -- ONLY display_name is written; the status filter makes a merged/deleted Person unwritable.
  UPDATE public.persons SET display_name = v_name
   WHERE id = v_person AND status = 'active'
   RETURNING id, display_name INTO v_person, v_name;
  IF NOT FOUND THEN RETURN; END IF;
  RETURN QUERY SELECT v_person, v_name;
END;
$$;

-- 4/10 create_host_added_person, newest definition 0070:147-192: 3 built-in calls qualified.
CREATE OR REPLACE FUNCTION create_host_added_person(
  p_tenant_id uuid,
  p_actor_person_id uuid,
  p_display_name text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_ctx uuid;
  v_name text;
  v_id uuid;
BEGIN
  BEGIN
    v_ctx := NULLIF(pg_catalog.current_setting('app.tenant_id', true), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_ctx := NULL;
  END;
  IF p_tenant_id IS NULL OR v_ctx IS NULL OR p_tenant_id <> v_ctx THEN
    RAISE EXCEPTION 'create_host_added_person: tenant context mismatch'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_actor_person_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.tenant_admins ta
     WHERE ta.tenant_id = p_tenant_id
       AND ta.platform = 'web'
       AND ta.platform_user_lookup_hash = p_actor_person_id::text
       AND ta.active
  ) THEN
    RAISE EXCEPTION 'create_host_added_person: actor is not an active tenant admin'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_name := public.member_name_apply_rule(p_display_name, false);
  IF v_name IS NULL OR pg_catalog.char_length(v_name) < 1 OR pg_catalog.char_length(v_name) > 100 THEN
    RAISE EXCEPTION 'create_host_added_person: display name must be 1..100 characters'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  INSERT INTO public.persons (display_name) VALUES (v_name) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- 5/10 tenant_provision, newest definition 0070:197-278: 6 built-in calls qualified.
CREATE OR REPLACE FUNCTION tenant_provision(
  p_slug text, p_name text, p_timezone text, p_locale text, p_person_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid;
  v_owned boolean;
  v_conflict boolean;
  v_prev_tenant text := pg_catalog.current_setting('app.tenant_id', true);
BEGIN
  IF p_slug !~ '^[a-z0-9][a-z0-9-]{1,62}$' THEN
    RAISE EXCEPTION 'tenant_provision: invalid slug' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF public.member_name_apply_rule(p_name, false) IS NULL THEN
    RAISE EXCEPTION 'tenant_provision: name required' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- ATOMIC create-or-lookup: ON CONFLICT waits for a concurrent inserter's
  -- transaction to finish, so the reselect below always sees the committed
  -- winner (two same-owner tabs both get the tenant id, never a false 409).
  INSERT INTO tenants(name, slug, status, locale, timezone)
  VALUES (public.member_name_apply_rule(p_name, false), p_slug, 'active', coalesce(p_locale, 'vi'),
          coalesce(p_timezone, 'Asia/Ho_Chi_Minh'))
  ON CONFLICT (slug) DO NOTHING
  RETURNING id INTO v_tenant;

  v_conflict := (v_tenant IS NULL);
  IF v_conflict THEN
    SELECT id INTO v_tenant FROM tenants WHERE slug = p_slug;
  END IF;

  -- 0037: every tenant-scoped statement below runs under FORCE RLS regardless
  -- of who owns this function. Scope the transaction to the tenant just
  -- resolved; the caller's previous value is restored on every exit path
  -- (a RAISE aborts this block's subtransaction, which also reverts the
  -- txn-local GUC — the EXCEPTION clause restores it explicitly anyway).
  PERFORM pg_catalog.set_config('app.tenant_id', v_tenant::text, true);

  IF v_conflict THEN
    -- idempotent ONLY for the web OWNER/ADMIN of that tenant — a mere member
    -- re-submitting the slug must get SLUG_TAKEN, not the tenant id.
    SELECT EXISTS (
      SELECT 1 FROM tenant_admins ta
      WHERE ta.tenant_id = v_tenant
        AND ta.platform = 'web'
        AND ta.platform_user_lookup_hash = p_person_id::text
        AND ta.role IN ('owner','admin')
        AND ta.active
    ) INTO v_owned;
    IF v_owned THEN
      PERFORM pg_catalog.set_config('app.tenant_id', coalesce(v_prev_tenant, ''), true);
      RETURN v_tenant; -- idempotent re-submit by the same owner
    END IF;
    RAISE EXCEPTION 'tenant_provision: slug taken' USING ERRCODE = 'unique_violation';
  END IF;

  INSERT INTO memberships(tenant_id, person_id, status)
  VALUES (v_tenant, p_person_id, 'active');

  -- Web owner authz row. platform_user_lookup_hash carries the INTERNAL person
  -- uuid for platform='web' (not platform PII — nothing to hash).
  INSERT INTO tenant_admins(tenant_id, platform, platform_user_lookup_hash, role)
  VALUES (v_tenant, 'web', p_person_id::text, 'owner');

  -- FREE plan: active immediately, no trial, no period end in practice.
  -- DD-29: plan_key 'free' (was 'free_web' — see 0028 header).
  INSERT INTO subscriptions(tenant_id, plan_key, plan_version, status,
                            period_start, period_end)
  VALUES (v_tenant, 'free', 1, 'active', pg_catalog.now(), 'infinity');

  INSERT INTO onboarding_runs(tenant_id, status) VALUES (v_tenant, 'in_progress');

  PERFORM pg_catalog.set_config('app.tenant_id', coalesce(v_prev_tenant, ''), true);
  RETURN v_tenant;
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_catalog.set_config('app.tenant_id', coalesce(v_prev_tenant, ''), true);
  RAISE;
END;
$$;

-- 6/10 tenant_profile_update, newest definition 0070:283-344: 5 built-in calls qualified.
CREATE OR REPLACE FUNCTION tenant_profile_update(
  p_tenant_id uuid,
  p_actor_person_id uuid,
  p_name text,
  p_timezone text,
  p_locale text
)
RETURNS TABLE (id uuid, name text, slug text, timezone text, locale text)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_ctx uuid;
  v_allowed boolean;
  v_name text := public.member_name_apply_rule(p_name, false);
BEGIN
  BEGIN
    v_ctx := NULLIF(pg_catalog.current_setting('app.tenant_id', true), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_ctx := NULL;
  END;
  IF p_tenant_id IS NULL OR v_ctx IS NULL OR p_tenant_id <> v_ctx THEN
    RAISE EXCEPTION 'tenant_profile_update: tenant context mismatch'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Authorization FIRST (DD-56): owner, or admin/co_admin via the content.manage preset.
  SELECT a.allowed INTO v_allowed
    FROM public.tenant_capability_authorize(p_tenant_id, 'content.manage', p_actor_person_id) a;
  IF v_allowed IS NOT TRUE THEN
    RAISE EXCEPTION 'tenant_profile_update: not permitted'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_name IS NOT NULL AND (v_name IS NULL OR pg_catalog.char_length(v_name) < 1 OR pg_catalog.char_length(v_name) > 120) THEN
    RAISE EXCEPTION 'tenant_profile_update: name must be 1..120 chars'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_locale IS NOT NULL AND p_locale NOT IN ('vi', 'en') THEN
    RAISE EXCEPTION 'tenant_profile_update: unsupported locale'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_timezone IS NOT NULL AND (pg_catalog.btrim(p_timezone) = '' OR pg_catalog.char_length(p_timezone) > 64) THEN
    RAISE EXCEPTION 'tenant_profile_update: timezone must be 1..64 chars'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  RETURN QUERY
    WITH u AS (
      UPDATE public.tenants t
         SET name = coalesce(v_name, t.name),
             timezone = coalesce(p_timezone, t.timezone),
             locale = coalesce(p_locale, t.locale)
       WHERE t.id = p_tenant_id
      RETURNING t.id, t.name, t.slug, t.timezone, t.locale
    )
    SELECT u.id, u.name, u.slug, u.timezone, u.locale FROM u;
END;
$$;

-- 7/10 zalo_identity_resolve, newest definition 0070:361-445: 2 built-in calls qualified.
CREATE OR REPLACE FUNCTION zalo_identity_resolve(
  p_tenant_id uuid, p_bot_id uuid, p_scope_hash text, p_user_hash text,
  p_user_id_enc bytea, p_display_name text
)
RETURNS TABLE (person_id uuid, channel_identity_id uuid, created boolean,
               display_name text, has_account boolean)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_ctx uuid;
  v_person uuid;
  v_ci uuid;
  v_created boolean := false;
  v_status text;
  v_name text := pg_catalog.left(public.member_name_apply_rule(p_display_name, true), 120);
BEGIN
  BEGIN
    v_ctx := NULLIF(pg_catalog.current_setting('app.tenant_id', true), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_ctx := NULL;
  END;
  IF p_tenant_id IS NULL OR v_ctx IS NULL OR p_tenant_id <> v_ctx THEN
    RAISE EXCEPTION 'zalo_identity_resolve: tenant context mismatch'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_bot_id IS NULL OR p_scope_hash IS NULL OR p_user_hash IS NULL OR p_user_id_enc IS NULL
     OR p_scope_hash = '' OR p_user_hash = '' THEN
    RAISE EXCEPTION 'zalo_identity_resolve: scope, user hash and ciphertext are required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  PERFORM 1 FROM public.zalo_bots b WHERE b.id = p_bot_id AND b.tenant_id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'zalo_identity_resolve: bot not in tenant'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT ci.id, ci.person_id, ci.status INTO v_ci, v_person, v_status
    FROM public.channel_identities ci
   WHERE ci.platform = 'zalo' AND ci.provider_scope_lookup_hash = p_scope_hash
     AND ci.platform_user_lookup_hash = p_user_hash;
  IF NOT FOUND THEN
    BEGIN
      INSERT INTO public.persons (display_name, status) VALUES (v_name, 'active')
        RETURNING id INTO v_person;
      INSERT INTO public.channel_identities
        (person_id, platform, platform_user_id_enc, platform_user_lookup_hash, status,
         provider_scope_lookup_hash, zalo_bot_id)
        VALUES (v_person, 'zalo', p_user_id_enc, p_user_hash, 'active', p_scope_hash, p_bot_id)
        RETURNING id INTO v_ci;
      v_created := true;
      v_status := 'active';
    EXCEPTION WHEN unique_violation THEN
      -- Only a concurrent first event can race here (the block rolled back our persons row):
      -- re-read the winner, else refuse.
      SELECT ci.id, ci.person_id, ci.status INTO v_ci, v_person, v_status
        FROM public.channel_identities ci
       WHERE ci.platform = 'zalo' AND ci.provider_scope_lookup_hash = p_scope_hash
         AND ci.platform_user_lookup_hash = p_user_hash;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'zalo_identity_resolve: identity scope conflict'
          USING ERRCODE = 'integrity_constraint_violation';
      END IF;
    END;
  END IF;
  -- Tombstoning must NEVER rely on channel_identities.status: refuse any non-active Person.
  PERFORM 1 FROM public.persons p WHERE p.id = v_person AND p.status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'zalo_identity_resolve: person is not active'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- The unique ignores status, so an inactive row would otherwise lock the user out forever.
  IF v_status <> 'active' THEN
    UPDATE public.channel_identities SET status = 'active' WHERE id = v_ci;
  END IF;

  RETURN QUERY
    SELECT v_person, v_ci, v_created,
           (SELECT p.display_name FROM public.persons p WHERE p.id = v_person),
           EXISTS (SELECT 1 FROM public.accounts a WHERE a.person_id = v_person);
END;
$$;

-- 8/10 auth_login_google, newest definition 0070:449-633: 13 built-in calls qualified.
CREATE OR REPLACE FUNCTION auth_login_google(
  p_subject_hash text,
  p_email_lookup_hash text,
  p_email_enc bytea,
  p_kms_key_version text,
  p_account_email_id uuid,
  p_display_name text,
  p_request_ref text
) RETURNS TABLE (account_id uuid, person_id uuid, outcome text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_subject_account uuid;
  v_subject_person  uuid;
  v_email_id        uuid;
  v_email_account   uuid;
  v_email_verified  boolean;
  v_new_person      uuid;
  v_new_account     uuid;
  v_result_account  uuid;
  v_result_person   uuid;
  v_outcome         text;
BEGIN
  IF p_subject_hash IS NULL OR pg_catalog.length(p_subject_hash) < 16 THEN
    RAISE EXCEPTION 'auth_login_google: invalid subject hash'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- (1) Read-only resolve BOTH owners (no lock). now() here is a candidate
  --     filter only; the mutation runs under the locks below.
  SELECT ai.account_id, a.person_id INTO v_subject_account, v_subject_person
  FROM account_identities ai
  JOIN accounts a ON a.id = ai.account_id
  WHERE ai.platform = 'google' AND ai.platform_user_hash = p_subject_hash;

  SELECT ae.id, ae.account_id, (ae.verified_at IS NOT NULL)
    INTO v_email_id, v_email_account, v_email_verified
  FROM account_emails ae
  WHERE ae.email_lookup_hash = p_email_lookup_hash;

  -- (2) Serialize concurrent logins on TWO domain-separated advisory locks
  --     (§5.2 step 3 "absent email -> advisory lock from email_lookup_hash"),
  --     always in this fixed order (email then subject) so no lock-order
  --     inversion / deadlock is possible; the two key spaces are disjoint
  --     (distinct string prefixes). hashtextextended keeps the full 64-bit key
  --     space (hashtext is 32-bit) to minimise cross-key collisions.
  --   * EMAIL lock: a cell-1 create and a cell-2/3 promote/attach for the SAME
  --     address never race — the loser re-resolves below and sees the winner.
  --   * SUBJECT lock (codex round-01 [P1]): two concurrent logins for the SAME
  --     Google subject but DIFFERENT returned emails take different email locks,
  --     so without this both could resolve the subject as absent and each
  --     attach it to a different account (the loser's ON CONFLICT identity
  --     insert no-ops, yet the function would still return that account with
  --     login_success — authenticating the subject into the WRONG account).
  --     Serializing on the subject makes the loser block here, re-resolve with
  --     the subject now PRESENT, and take the subject branch (login the correct
  --     account, or cell-7 identity_conflict) instead of a second attach.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('auth-oauth-email:' || p_email_lookup_hash, 0));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('auth-oauth-subject:' || p_subject_hash, 0));

  -- (3) Parent tier, parent-first: lock the involved existing accounts in
  --     ascending UUID order (§5.2 step 3), then the account_emails row. A
  --     cell-1 create has neither yet — the advisory lock above is its
  --     serialization point. DISTINCT collapses a same-account subject+email.
  PERFORM 1 FROM accounts
  WHERE id IN (v_subject_account, v_email_account) AND id IS NOT NULL
  ORDER BY id
  FOR UPDATE;
  IF v_email_id IS NOT NULL THEN
    PERFORM 1 FROM account_emails WHERE id = v_email_id FOR UPDATE;
  END IF;

  -- (4) Re-resolve under the locks (§5.2 step 6): the advisory + row locks make
  --     a concurrent creator's commit visible now.
  SELECT ai.account_id, a.person_id INTO v_subject_account, v_subject_person
  FROM account_identities ai
  JOIN accounts a ON a.id = ai.account_id
  WHERE ai.platform = 'google' AND ai.platform_user_hash = p_subject_hash;

  SELECT ae.id, ae.account_id, (ae.verified_at IS NOT NULL)
    INTO v_email_id, v_email_account, v_email_verified
  FROM account_emails ae
  WHERE ae.email_lookup_hash = p_email_lookup_hash;

  -- (5) Apply the collision cell.
  IF v_subject_account IS NOT NULL THEN
    -- Subject already exists — the stable identity owner (cells 4/5/6/7). A
    -- Google email change never rebinds the account (email-change is a separate
    -- re-auth+verify workflow, out of D1 scope), so the returned email only
    -- MATTERS for the cell-7 conflict check.
    IF v_email_id IS NOT NULL AND v_email_verified
       AND v_email_account IS DISTINCT FROM v_subject_account THEN
      -- Cell 7: the proven-verified email belongs to a DIFFERENT account.
      -- Fail closed — no auto-merge, no session (→ DD-53).
      v_result_account := v_subject_account;
      v_result_person  := v_subject_person;
      v_outcome        := 'identity_conflict';
    ELSE
      -- Cells 4 (email @ A), 5 (email absent), 6 (email pending @ B): log in
      -- account A by its stable subject; mutate NOTHING (never create/promote a
      -- contact, never touch B's pending attempts/tokens).
      v_result_account := v_subject_account;
      v_result_person  := v_subject_person;
      v_outcome        := 'login_success';
    END IF;
  ELSE
    -- Subject absent (cells 1/2/3).
    IF v_email_id IS NULL THEN
      -- Cell 1 (new/new): create Person + Account + verified account_emails
      -- (using the app-preallocated id so the ciphertext AAD stays valid) +
      -- Google identity, atomically.
      INSERT INTO persons(display_name) VALUES (public.member_name_apply_rule(p_display_name, true))
        RETURNING id INTO v_new_person;
      INSERT INTO accounts(person_id) VALUES (v_new_person) RETURNING id INTO v_new_account;
      INSERT INTO account_emails(id, account_id, email_lookup_hash, email_enc, kms_key_version, verified_at)
        VALUES (p_account_email_id, v_new_account, p_email_lookup_hash, p_email_enc, p_kms_key_version, pg_catalog.now());
      INSERT INTO account_identities(account_id, platform, platform_user_hash, verified_at)
        VALUES (v_new_account, 'google', p_subject_hash, pg_catalog.now());
      v_result_account := v_new_account;
      v_result_person  := v_new_person;
      v_outcome        := 'login_success';
    ELSIF v_email_verified THEN
      -- Cell 2: the verified email belongs to account A — DD-50 strong proof.
      -- Attach the Google identity to A; create no second account. ON CONFLICT
      -- keeps a re-login idempotent under the advisory-lock serialization.
      INSERT INTO account_identities(account_id, platform, platform_user_hash, verified_at)
        VALUES (v_email_account, 'google', p_subject_hash, pg_catalog.now())
        ON CONFLICT (platform, platform_user_hash) DO NOTHING;
      -- alias `accounts`: the column `person_id` would otherwise be ambiguous
      -- with this function's OUT parameter of the same name.
      SELECT a.person_id INTO v_result_person FROM accounts a WHERE a.id = v_email_account;
      v_result_account := v_email_account;
      v_outcome        := 'login_success';
    ELSE
      -- Cell 3: the email is PENDING on account A. Promote it (a verified Google
      -- email is DD-50 strong proof), supersede ALL of A's pending attempts and
      -- their verify tokens, NULL the password/registration-key candidates and
      -- COPY NONE (a pre-registration hijack must not silently install its
      -- password), then attach the Google identity.
      UPDATE account_emails
      SET verified_at = pg_catalog.now(), pending_expires_at = NULL, updated_at = pg_catalog.now()
      WHERE id = v_email_id;

      UPDATE auth_pending_email_registrations
      SET superseded_at = pg_catalog.transaction_timestamp(), password_phc = NULL, registration_key_hash = NULL
      WHERE account_email_id = v_email_id
        AND consumed_at IS NULL AND superseded_at IS NULL;

      UPDATE auth_email_tokens
      SET superseded_at = pg_catalog.transaction_timestamp()
      WHERE account_email_id = v_email_id
        AND purpose = 'verify_email'
        AND consumed_at IS NULL AND superseded_at IS NULL;

      INSERT INTO account_identities(account_id, platform, platform_user_hash, verified_at)
        VALUES (v_email_account, 'google', p_subject_hash, pg_catalog.now())
        ON CONFLICT (platform, platform_user_hash) DO NOTHING;
      -- alias `accounts`: the column `person_id` would otherwise be ambiguous
      -- with this function's OUT parameter of the same name.
      SELECT a.person_id INTO v_result_person FROM accounts a WHERE a.id = v_email_account;
      v_result_account := v_email_account;
      v_outcome        := 'login_success';
    END IF;
  END IF;

  -- (6) Per-lane audit (§8.3 v1.85), SAME transaction as the cell above. Cells
  --     1-6 write login_success, cell 7 writes identity_conflict. session_epoch
  --     / link_codes_revoked / merge_artifacts_cancelled stay NULL (no session
  --     revoke, no link-code work on this lane).
  INSERT INTO auth_audit_events(
    event_type, account_id, outcome_class, actor_class, request_ref
  ) VALUES (
    v_outcome, v_result_account,
    CASE WHEN v_outcome = 'identity_conflict' THEN 'conflict' ELSE 'success' END,
    'google', p_request_ref
  );

  account_id := v_result_account;
  person_id  := v_result_person;
  outcome    := v_outcome;
  RETURN NEXT;
END;
$$;

-- 9/10 create_guest_membership, newest definition 0070:637-706: 1 built-in call qualified.
CREATE OR REPLACE FUNCTION create_guest_membership(
  p_tenant_id uuid,
  p_person_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_ctx uuid;
  v_name text;
  v_id uuid;
BEGIN
  BEGIN
    v_ctx := NULLIF(pg_catalog.current_setting('app.tenant_id', true), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_ctx := NULL;
  END;
  IF p_tenant_id IS NULL OR v_ctx IS NULL OR p_tenant_id <> v_ctx THEN
    RAISE EXCEPTION 'create_guest_membership: tenant context mismatch'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- FOR SHARE (a lock, not a write): a concurrent 0054 empty-person reparent cannot flip this person
  -- to 'merged' between this check and the insert; if it got there first, the re-checked row fails
  -- status = 'active' after it commits and this function raises.
  SELECT public.member_name_apply_rule(p.display_name, true) INTO v_name
    FROM public.persons p
   WHERE p.id = p_person_id
     AND p.status = 'active'
     FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'create_guest_membership: person is not active'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT m.id INTO v_id
    FROM public.memberships m
   WHERE m.tenant_id = p_tenant_id
     AND m.person_id = p_person_id
     AND m.status IN ('active', 'guest')
     FOR SHARE;
  IF FOUND THEN
    RETURN v_id;
  END IF;

  INSERT INTO public.memberships (tenant_id, person_id, status, display_name)
  VALUES (p_tenant_id, p_person_id, 'guest', v_name)
  ON CONFLICT (tenant_id, person_id) WHERE status IN ('active', 'guest') DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  -- A concurrent first call inserted the row and committed while this INSERT waited on it
  -- (READ COMMITTED: this statement takes a fresh snapshot and sees it).
  SELECT m.id INTO v_id
    FROM public.memberships m
   WHERE m.tenant_id = p_tenant_id
     AND m.person_id = p_person_id
     AND m.status IN ('active', 'guest')
     FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'create_guest_membership: no live membership after insert'
      USING ERRCODE = 'serialization_failure';
  END IF;
  RETURN v_id;
END;
$$;

-- 10/10 tenant_public_alias_set, newest definition 0068:76-168: 8 built-in calls qualified.
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
    v_ctx := NULLIF(pg_catalog.current_setting('app.tenant_id', true), '')::uuid;
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
  v_alias := pg_catalog.regexp_replace(public.public_name_strip_invisible(p_alias), '^' || c_space || '+|' || c_space || '+$', '', 'g');
  IF pg_catalog.char_length(v_alias) < 1 OR pg_catalog.char_length(v_alias) > 60 OR v_alias ~ c_reject
     OR v_alias !~ c_visible THEN
    RAISE EXCEPTION 'tenant_public_alias_set: alias must be 1-60 printable characters'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Same key as club-config.ts (re-entrant when the TS caller already holds it), then the row.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('club-config:' || p_tenant_id::text, 0));
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
  SELECT p_tenant_id, 'tenant', p_tenant_id, coalesce(pg_catalog.max(o.sequence), 0) + 1,
         'tenant.public_alias_set', pg_catalog.jsonb_build_object('status', 'pending')
    FROM public.outbox_events o
   WHERE o.aggregate_id = p_tenant_id;
  RETURN QUERY SELECT v_alias, 'pending'::text, true;
END;
$$;
