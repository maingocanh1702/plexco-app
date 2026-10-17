-- 0061_public_sessions_projector_writer.sql
-- The public_sessions projector's database half (M9). Contract:
-- docs/sessions/web-mvp-phase3-readiness-p3-m9-public-projector.md sections 4.1-4.8, pins P-1..P-19.
--
--   1. public_sessions narrowed to the approved whitelist: skill_level (BL-DSC-1 retired),
--      club_display_name (now read LIVE from the tenant's approved alias) and host_display_name
--      (persons are never projected) are dropped; the 8 DD-41 columns (nullable, written NULL:
--      sessions has no source for them yet, P-1) and an opaque 128-bit public_listing_id are added.
--   2. session_occupancy(uuid): THE occupancy formula (active players + guest notes) as one
--      SECURITY INVOKER function, so the TS reads and the writer share one definition.
--   3. Writer definers (EXECUTE app_worker): recompute one session's row from canonical rows only,
--      never from an event payload, the session writer observing then CAS-clearing the DD-12 fence
--      itself (D3: no runtime role keeps EXECUTE on the 0033 observe/clear); the tenant fan-out
--      candidates (also the R-2 backfill) and the expiry sweep.
--   4. Share-link registry: hash-only slugs (raw slug shown once), tombstoned on revoke, rotate and
--      listing delete; two lookups for the discovery role.
--   5. public_session_share_v REPLACED: exactly 17 whitelisted columns, keyed by public_listing_id
--      (never session_id or public_projection_version), club_display_name = the approved alias read
--      live (tenants without one, or suspended/cancelled, are filtered out at once), the expiry
--      filter and the fence anti-join kept.
--
-- No privilege on public_sessions, public_projection_fences or the slug table is granted to app,
-- app_worker or readonly: 0033 (base SELECT revoked) and 0036 (app DML revoked) stay in force; every
-- access goes through the definers below or the view. Every new object is owned by job_definer
-- (P-12; NOLOGIN BYPASSRLS, never granted to a runtime role). migrate.ts runs this whole file in one
-- transaction, so the DROP and CREATE of the view are atomic.
--
-- The public_sessions registry row stays DISABLED (0056): enabling it, then the R-2 backfill
-- (for each tenant t with an approved alias:
--   SELECT public_sessions_project_session(c, NULL) FROM public_sessions_tenant_candidates(t) AS c;
-- a NULL event id writes no audit row), is the owner's P0 step.

-- ---------------------------------------------------------------------------
-- Step 1 (migration role): reshape the table, then the column-narrow job_definer grants.
-- ---------------------------------------------------------------------------
-- Derived rows only (no writer existed before this migration); they are recomputed on enablement.
DELETE FROM public_sessions;

-- The old view reads club_display_name / host_display_name; it is re-created in step 2.
DROP VIEW public_session_share_v;

ALTER TABLE public_sessions
  DROP COLUMN host_display_name,
  DROP COLUMN club_display_name,
  DROP COLUMN skill_level,
  ADD COLUMN title text,
  ADD COLUMN session_type text,
  ADD COLUMN level_min_rank integer,
  ADD COLUMN level_max_rank integer,
  ADD COLUMN level_strict boolean,
  ADD COLUMN gender_restriction text,
  ADD COLUMN age_min integer,
  ADD COLUMN age_max integer,
  -- P-2: 128 CSPRNG bits, never updated; the row is deleted whenever the session leaves public,
  -- so every re-entry gets a new value and the old one resolves nothing.
  ADD COLUMN public_listing_id uuid NOT NULL DEFAULT (encode(public.gen_random_bytes(16), 'hex')::uuid);

CREATE UNIQUE INDEX uq_public_sessions_public_listing_id ON public_sessions (public_listing_id);

-- What the writer, the view and the lookups read (players (session_id, status) and sessions
-- (id, tenant_id, status, starts_at, ends_at) are already held: 0056:29-31, 0057:25-28).
GRANT SELECT (sport_id, area, price_amount, slots_max, visibility, join_policy) ON sessions TO job_definer;
GRANT SELECT (id, key) ON sports TO job_definer;
GRANT SELECT (session_id) ON session_guest_notes TO job_definer;
GRANT SELECT (id, status, public_alias, public_alias_status) ON tenants TO job_definer;
GRANT SELECT (surface, target_kind, target_id, deny_scope) ON public_projection_fences TO job_definer;
GRANT SELECT (id, session_id, tenant_id, sport_key, starts_at, ends_at, area, price_amount, slots_open, join_policy,
  projected_at, expires_at, public_projection_version, title, session_type, level_min_rank, level_max_rank,
  level_strict, gender_restriction, age_min, age_max, public_listing_id) ON public_sessions TO job_definer;
-- INSERT: every column except public_listing_id, which comes from its DEFAULT
GRANT INSERT (id, session_id, tenant_id, sport_key, starts_at, ends_at, area, price_amount, slots_open, join_policy,
  projected_at, expires_at, public_projection_version, title, session_type, level_min_rank, level_max_rank,
  level_strict, gender_restriction, age_min, age_max) ON public_sessions TO job_definer;
-- UPDATE: never id, session_id, tenant_id or public_listing_id
GRANT UPDATE (sport_key, starts_at, ends_at, area, price_amount, slots_open, join_policy, projected_at, expires_at,
  public_projection_version, title, session_type, level_min_rank, level_max_rank, level_strict, gender_restriction,
  age_min, age_max) ON public_sessions TO job_definer;
GRANT DELETE ON public_sessions TO job_definer;
-- D3 (s1 S-1): the DD-12 fence is observed and CAS-cleared only INSIDE the writer, around its
-- canonical recompute, so no runtime role keeps the bare 0033 clear. Both functions are owned by
-- the migration role, hence these statements sit here, outside the SET ROLE bracket.
GRANT EXECUTE ON FUNCTION current_public_session_fence_token(uuid), clear_public_session_fence(uuid, uuid)
  TO job_definer;
REVOKE EXECUTE ON FUNCTION current_public_session_fence_token(uuid), clear_public_session_fence(uuid, uuid)
  FROM app_worker;

-- ---------------------------------------------------------------------------
-- Step 2: everything below is created AS job_definer (the 0056:61-69 bracket).
-- ---------------------------------------------------------------------------
GRANT CREATE ON SCHEMA public TO job_definer;
SET ROLE job_definer;

-- 2a. THE occupancy formula (P-19): active players + guest notes. SECURITY INVOKER: under app it
-- counts through RLS (another tenant's GUC sees 0); inside the writer it runs as job_definer
-- (BYPASSRLS), where rows keyed by a session id are tenant-exact. SET search_path blocks inlining:
-- one call per listed row, two index-backed counts each (idx_players_session,
-- idx_session_guest_notes_session).
CREATE FUNCTION session_occupancy(p_session_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT ((SELECT count(*) FROM players p WHERE p.session_id = p_session_id AND p.status = 'active')
        + (SELECT count(*) FROM session_guest_notes g WHERE g.session_id = p_session_id))::integer;
$$;

-- 2b. Share-link registry (P-3; DD-83 / DD-75). Hash-only: slug_hash =
-- sha256('plexco/session-share-slug/v1:' || raw slug); the raw slug is returned once by rotate
-- and never stored or logged. revoked_at is the tombstone; at most one active slug per session.
-- No FK (the definers derive the session server-side) and no runtime grant, like the fence table.
CREATE TABLE public_session_share_slugs (
  slug_hash  bytea PRIMARY KEY,
  session_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz,
  CONSTRAINT public_session_share_slugs_hash_len_chk CHECK (octet_length(slug_hash) = 32)
);
CREATE UNIQUE INDEX uq_public_session_share_slugs_active
  ON public_session_share_slugs (session_id) WHERE revoked_at IS NULL;

-- 2c. The replaced guarded view (DD-12 / DD-73:913-915 / BL-DSC-1). EXPLICIT columns = the
-- structural whitelist. Never served: session_id, tenant_id, public_projection_version, any slug,
-- host or person name, confirmed_count, expires_at (a filter only). club_display_name is the
-- tenant's CURRENTLY approved alias, read live: a rejection, a pending edit or a suspension hides
-- every row of the club at once, with no projector run, and a stored copy is never served.
CREATE VIEW public_session_share_v WITH (security_barrier = true) AS
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
  ps.age_max
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

-- 2d. The writer (R-1, P-4..P-7, P-9, P-11, P-16, P-17). Recomputes one session's public row from
-- canonical rows only; p_event_id is used ONLY as the audit row's job_id. Dispositions:
-- 'upserted' (inserted, or a projected column changed), 'unchanged', 'deleted', 'absent',
-- 'rotated', 'ineligible_unlimited'. READ COMMITTED: each statement sees rows committed before it.
CREATE FUNCTION public_sessions_project_session(p_session_id uuid, p_event_id uuid)
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

  SELECT s.tenant_id, s.status, s.visibility, s.starts_at, s.ends_at, s.area, s.price_amount,
         s.slots_max, s.join_policy, sp.key, t.status, t.public_alias_status
    INTO v_tenant_id, v_status, v_visibility, v_starts_at, v_ends_at, v_area, v_price_amount,
         v_slots_max, v_join_policy, v_sport_key, v_tenant_status, v_alias_status
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
          age_min, age_max)
      VALUES (p_session_id, p_session_id, v_tenant_id, v_sport_key, v_starts_at, v_ends_at, v_area,
          v_price_amount, v_slots_open, v_join_policy, now(), v_starts_at, 1,
          NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
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
          age_min, age_max)
      VALUES (p_session_id, p_session_id, v_tenant_id, v_sport_key, v_starts_at, v_ends_at, v_area,
          v_price_amount, v_slots_open, v_join_policy, now(), v_starts_at, 1,
          NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)
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
          age_max = EXCLUDED.age_max
        WHERE (ps.sport_key, ps.starts_at, ps.ends_at, ps.area, ps.price_amount, ps.slots_open,
               ps.join_policy, ps.expires_at, ps.title, ps.session_type, ps.level_min_rank,
               ps.level_max_rank, ps.level_strict, ps.gender_restriction, ps.age_min, ps.age_max)
              IS DISTINCT FROM
              (EXCLUDED.sport_key, EXCLUDED.starts_at, EXCLUDED.ends_at, EXCLUDED.area,
               EXCLUDED.price_amount, EXCLUDED.slots_open, EXCLUDED.join_policy, EXCLUDED.expires_at,
               EXCLUDED.title, EXCLUDED.session_type, EXCLUDED.level_min_rank, EXCLUDED.level_max_rank,
               EXCLUDED.level_strict, EXCLUDED.gender_restriction, EXCLUDED.age_min, EXCLUDED.age_max);
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

-- 2e. Tenant fan-out (alias events) and the R-2 backfill: the tenant's projected rows plus its open
-- public future sessions; the projector calls the per-session writer for each id.
CREATE FUNCTION public_sessions_tenant_candidates(p_tenant_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT ps.id FROM public_sessions ps WHERE ps.tenant_id = p_tenant_id
  UNION
  SELECT s.id FROM sessions s
   WHERE s.tenant_id = p_tenant_id
     AND s.status = 'open'
     AND s.visibility = 'public'
     AND s.starts_at > now();
$$;

-- 2f. Expiry sweep (P-10): up to p_limit expired rows, each under its session lock, with its
-- active slug tombstoned in the same transaction (P-17). The view's expiry filter already hides
-- them. A stable order keeps two concurrent sweeps from deadlocking.
CREATE FUNCTION public_sessions_sweep_expired(p_limit integer)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id    uuid;
  v_swept integer := 0;
BEGIN
  FOR v_id IN
    SELECT ps.id FROM public_sessions ps
     WHERE ps.expires_at <= now()
     ORDER BY ps.expires_at, ps.id
     LIMIT greatest(coalesce(p_limit, 0), 0)
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('public-sessions:' || v_id::text, 0));
    DELETE FROM public_sessions WHERE id = v_id AND expires_at <= now();
    IF FOUND THEN
      UPDATE public_session_share_slugs SET revoked_at = clock_timestamp()
       WHERE session_id = v_id AND revoked_at IS NULL;
      v_swept := v_swept + 1;
    END IF;
  END LOOP;
  RETURN v_swept;
END;
$$;

-- 2g. Slug rotate / revoke (app; session.manage authorization is L10b's service). The tenant is
-- derived from the app.tenant_id GUC and verified server-side, fail-closed exactly like
-- raise_public_session_fence (0033:173-180).
CREATE FUNCTION public_session_share_slug_rotate(p_session_id uuid)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_slug text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM sessions
    WHERE id = p_session_id
      AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  ) THEN
    RAISE EXCEPTION 'public_session_share_slug_rotate: session % is not in the caller tenant (fail-closed)', p_session_id
      USING ERRCODE = 'raise_exception';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('public-sessions:' || p_session_id::text, 0));
  -- Only a listing the public can see right now gets a link (one visibility authority: the view).
  IF NOT EXISTS (
    SELECT 1 FROM public_sessions ps
    JOIN public_session_share_v v ON v.public_listing_id = ps.public_listing_id
    WHERE ps.id = p_session_id
  ) THEN
    RAISE EXCEPTION 'public_session_share_slug_rotate: session % is not publicly listed', p_session_id
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  UPDATE public_session_share_slugs SET revoked_at = clock_timestamp()
   WHERE session_id = p_session_id AND revoked_at IS NULL;
  -- base64url of 128 CSPRNG bits without padding: 22 characters (DD-75 :1065).
  v_slug := translate(rtrim(encode(gen_random_bytes(16), 'base64'), '='), '+/', '-_');
  INSERT INTO public_session_share_slugs (slug_hash, session_id)
  VALUES (sha256(convert_to('plexco/session-share-slug/v1:' || v_slug, 'UTF8')), p_session_id);
  RETURN v_slug; -- shown once to the host; never stored or logged
END;
$$;

CREATE FUNCTION public_session_share_slug_revoke(p_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM sessions
    WHERE id = p_session_id
      AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  ) THEN
    RAISE EXCEPTION 'public_session_share_slug_revoke: session % is not in the caller tenant (fail-closed)', p_session_id
      USING ERRCODE = 'raise_exception';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('public-sessions:' || p_session_id::text, 0));
  UPDATE public_session_share_slugs SET revoked_at = clock_timestamp()
   WHERE session_id = p_session_id AND revoked_at IS NULL;
  RETURN FOUND;
END;
$$;

-- 2h. Lookups for the discovery role (readonly only). A row comes back only while the listing is
-- visible through the view. A NULL or malformed slug resolves nothing; the slug lookup also
-- returns public_listing_id so L10b can reach the view row.
CREATE FUNCTION public_share_slug_resolve(p_slug text)
RETURNS TABLE (tenant_id uuid, session_id uuid, public_listing_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT ps.tenant_id, ps.session_id, ps.public_listing_id
    FROM public_session_share_slugs sl
    JOIN public_sessions ps ON ps.id = sl.session_id
   WHERE p_slug ~ '^[A-Za-z0-9_-]{22}$'
     AND sl.slug_hash = sha256(convert_to('plexco/session-share-slug/v1:' || p_slug, 'UTF8'))
     AND sl.revoked_at IS NULL
     AND EXISTS (SELECT 1 FROM public_session_share_v v WHERE v.public_listing_id = ps.public_listing_id);
$$;

CREATE FUNCTION public_listing_resolve(p_public_listing_id uuid)
RETURNS TABLE (tenant_id uuid, session_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT ps.tenant_id, ps.session_id
    FROM public_sessions ps
   WHERE ps.public_listing_id = p_public_listing_id
     AND EXISTS (SELECT 1 FROM public_session_share_v v WHERE v.public_listing_id = ps.public_listing_id);
$$;

-- 2i. Privileges (4.8, binding).
REVOKE ALL ON FUNCTION session_occupancy(uuid), public_sessions_project_session(uuid, uuid),
  public_sessions_tenant_candidates(uuid), public_sessions_sweep_expired(integer),
  public_session_share_slug_rotate(uuid), public_session_share_slug_revoke(uuid),
  public_share_slug_resolve(text), public_listing_resolve(uuid) FROM PUBLIC;
REVOKE ALL ON public_session_share_slugs, public_session_share_v FROM PUBLIC;
GRANT EXECUTE ON FUNCTION session_occupancy(uuid), public_session_share_slug_rotate(uuid),
  public_session_share_slug_revoke(uuid) TO app;
GRANT EXECUTE ON FUNCTION public_sessions_project_session(uuid, uuid), public_sessions_tenant_candidates(uuid),
  public_sessions_sweep_expired(integer) TO app_worker;
GRANT EXECUTE ON FUNCTION public_share_slug_resolve(text), public_listing_resolve(uuid) TO readonly;
GRANT SELECT ON public_session_share_v TO readonly;

-- 2j. The 15 public_sessions routes (P-14). Not routed: session.created,
-- session.announcement_requested, session.expiry_anomaly_detected, join_request.created,
-- join_request.rejected, join_request.cancelled (pending requests never occupy).
INSERT INTO outbox_projector_routes (projector, aggregate_type, event_type) VALUES
  ('public_sessions', 'session', 'session.published'),
  ('public_sessions', 'session', 'session.updated'),
  ('public_sessions', 'session', 'session.visibility_changed'),
  ('public_sessions', 'session', 'session.closed'),
  ('public_sessions', 'session', 'session.cancelled'),
  ('public_sessions', 'session', 'player.added'),
  ('public_sessions', 'session', 'player.waitlisted'),
  ('public_sessions', 'session', 'player.removed'),
  ('public_sessions', 'session', 'player.promoted'),
  ('public_sessions', 'session', 'guest_note.created'),
  ('public_sessions', 'session', 'guest_note.deleted'),
  ('public_sessions', 'session', 'join_request.approved'),
  ('public_sessions', 'tenant', 'tenant.public_alias_set'),
  ('public_sessions', 'tenant', 'tenant.public_alias_approved'),
  ('public_sessions', 'tenant', 'tenant.public_alias_rejected');

RESET ROLE;
REVOKE CREATE ON SCHEMA public FROM job_definer;
-- Resulting state: no privilege on public_sessions, public_projection_fences or
-- public_session_share_slugs for app, app_worker or readonly; 0033:237-238 (base SELECT revokes)
-- and 0036:36 (app DML revoked) stay in force.
