-- ============================================================================
-- 0033_public_projection_fences.sql
-- Public read-model IMMEDIATE-DENY path — DD-12 debt, re-scoped from DD-73 Q5
-- (decisions.md:264-269, 906-923, 946-968); ROADMAP §Next Actions (8a); a
-- DD-114 D3 hard dependency (owner config public/private toggle must not ship
-- before this lands, decisions.md:1852-1862). EXPAND-ONLY, additive.
--
-- The gap this closes (a real open hole, not tidiness):
--   public_sessions is the cross-tenant PUBLIC read model (no RLS, field
--   whitelist — HARD RULE #2). Today, when a host flips a public session to
--   private, or cancels/closes it, the row stays visible in public_sessions
--   until the ASYNC projector next runs and deletes it. Between the transition
--   and the projector, the stale public row is still readable = a privacy
--   leak. The public/private toggle (DD-114 D3) must not ship on top of that.
--   This migration closes the hole at READ time, fail-closed, so the deny is
--   immediate and does NOT wait for the projector.
--
-- Mechanism (DD-12-owned; the DD-73 /s/:id route and the DD-74/75 activity_card
-- surface build ON TOP of this and are OUT of scope here):
--   1. public_sessions.public_projection_version — monotonic control metadata
--      (non-PII); the SOLE whitelist-exception column DD-73 permits in the
--      guarded view (decisions.md:914), used by DD-78 as the
--      authorization-before-cache key.
--   2. public_projection_fences — GLOBAL PROTECTED, denial-only (DD-75:955).
--      A privacy-reducing transition raises a fence row in the SAME source
--      transaction; the guarded view anti-joins it, so the row disappears from
--      every public read instantly. No content / PII / tenant column. This
--      migration creates it for surface='session_share'; share_activities later
--      EXTENDS usage to 'activity_card' — it does NOT recreate the table.
--   3. public_session_share_v — guarded view, EXPLICIT columns = the BL-DSC-1
--      display fields that exist in public_sessions today (DD-73:914 — follow
--      BL-DSC-1 NOT DDL 0006; skill_level is retired, expires_at is only a
--      filter) + session_id (row identity) + public_projection_version (the sole
--      control-column exception), WHERE not-expired AND not-fenced. Created WITH
--      (security_barrier = true) so a caller's non-leakproof predicate cannot be
--      pushed BELOW the fence/expiry filters and observe a denied row via a side
--      effect or error — the view is the sole privacy boundary, so the barrier
--      is load-bearing, not cosmetic. After this migration it is the ONLY public
--      read path; the base grant is revoked (step 5).
--   4. Narrow SECURITY DEFINER functions (the exact 0010 pattern) mediate ALL
--      fence access — the fence table itself has ZERO direct grant:
--        raise_public_session_fence(session, reason)  EXECUTE app  (source tx)
--        current_public_session_fence_token(session)  EXECUTE app_worker
--        clear_public_session_fence(session, token)   EXECUTE app_worker (CAS)
--   5. Grant migration: REVOKE base SELECT from readonly (the discovery
--      consumer), GRANT the guarded view instead. After cutover no consumer
--      role can read the base — reading the base would bypass the
--      immediate-deny fence (decisions.md:269).
--
-- Immediate-deny + CAS-clear contract (DD-73:917 / DD-75:957,962):
--   * A public->private / cancel / close transition calls raise_...; the
--     function REPLACES any existing fence token with a fresh random one, so a
--     newer transition always wins over a stale projector worker.
--   * The projector (a LATER slice) observes the current token, converges the
--     projection, then calls clear_...(session, observed_token): a CAS delete
--     that no-ops if a newer raise changed the token in between (new token
--     wins, deny persists). The token is a race-coordination value, never an
--     authorization secret — clear is EXECUTE-gated to app_worker, not
--     token-gated — and raise never returns it and never logs it
--     (DD-75 "token khong tra/log").
--   * raise verifies the session belongs to the CALLER tenant via an explicit
--     tenant_id = app.tenant_id predicate, fail-closed on a missing GUC — the
--     "current-tenant target derive+verify server-side, no generic client
--     target" rule (DD-75:957). The narrow signature (surface / target_kind /
--     deny_scope all hardcoded) is the structural half of that same rule.
--
-- What this migration does NOT do (negative scope): no projector, no dispatcher
--   wiring, no /s/:id route, no toggle route/UI, no DD-41 whitelist fields and
--   no skill_level removal, no DD-32 confirmed_count/occupancy, no schedule
--   enablement, no change to app's base DML or app_worker's grants (app's base
--   SELECT IS revoked in step 5 — required for the immediate-deny), no
--   infra/postgres-init edit.
--
-- Expand-safe: public_sessions is EMPTY (no real projector or consumer exists
--   yet — grep packages/ apps/ for a writer/reader returns only schema + tests),
--   so adding a NOT NULL DEFAULT column and revoking the readonly grant break
--   nothing live. The definer functions follow the exact 0010 shape (SECURITY
--   DEFINER + SET search_path + REVOKE FROM PUBLIC + GRANT EXECUTE), owned by
--   the migration role like every 0010 function, and need NO RLS bypass: the
--   fence table and public_sessions carry no RLS, and the sessions existence
--   check is tenant-scoped by an EXPLICIT predicate that holds whether or not
--   the definer owner happens to bypass RLS. migrate.ts runs this whole file in
--   ONE transaction.
-- ============================================================================

-- 1. control-metadata column (whitelist exception, DD-73:914 / DD-78) --------
ALTER TABLE public_sessions
  ADD COLUMN public_projection_version bigint NOT NULL DEFAULT 0;

-- 1b. canonical-identity invariant. public_sessions.id AND .session_id both mean
--     sessions.id (0006:12-13), but nothing enforced their equality. The guarded
--     view anti-joins the fence on ps.session_id, while raise_public_session_fence
--     fences the canonical sessions.id — so a row with id <> session_id would stay
--     public AFTER its session is fenced (the fence key and the view key would
--     differ). Enforce equality so the fence path is single-keyed. public_sessions
--     is empty (no projector/consumer yet), so an immediate-validate ADD CONSTRAINT
--     is safe — nothing to scan.
ALTER TABLE public_sessions
  ADD CONSTRAINT public_sessions_id_session_id_chk CHECK (id = session_id);

-- 2. denial-only GLOBAL PROTECTED fence table (DD-75:955) --------------------
CREATE TABLE public_projection_fences (
  surface      text NOT NULL,        -- 'session_share' (DD-12) | 'activity_card' (DD-74/75, later)
  target_kind  text NOT NULL,        -- 'session' here; 'activity_share'|'person'|'tenant' later
  target_id    uuid NOT NULL,
  fence_token  uuid NOT NULL,        -- random; projector CAS-clears; never returned/logged
  deny_scope   text NOT NULL
    CONSTRAINT public_projection_fences_deny_scope_chk CHECK (deny_scope IN ('public','all')),
  reason       text NOT NULL,        -- closed enum, validated by the narrow raise function
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (surface, target_kind, target_id)
);
-- NO RLS (global / cross-tenant, like public_sessions) and NO grant to app or
-- readonly: every access is mediated by the narrow SECURITY DEFINER functions
-- below (DD-75: base/fence carry no blanket grant).

-- 3. guarded public read view (DD-12 / DD-73:913-915) ------------------------
-- EXPLICIT columns = structural whitelist enforcement (DD-75:959), following
-- BL-DSC-1 (DD-73:914 — "follow BL-DSC-1, NOT DDL 0006"), intersected with the
-- fields that actually exist in public_sessions today (the DD-41 fields
-- title/session_type/level_*/gender_restriction/age_* are NOT yet in the table
-- and stay out until that migration). Deliberately NOT projected:
--   * skill_level — RETIRED by DD-73:914 (BL-DSC-1 drops it); the legacy base
--     column stays until the separate DD-41 migration removes it.
--   * tenant_id (internal routing, HR2), projected_at (internal), id (redundant
--     with session_id under the id=session_id CHECK), expires_at (a freshness
--     FILTER, below — a row's presence already means not-expired, so BL-DSC-1
--     does not display it).
-- Projected beyond BL-DSC-1: session_id (the row identity, needed to reference a
-- session) and public_projection_version (the SOLE control-column exception
-- DD-73:914 permits). A row is visible only while NOT expired AND NOT fenced.
CREATE VIEW public_session_share_v WITH (security_barrier = true) AS
SELECT
  ps.session_id,
  ps.sport_key,
  ps.starts_at,
  ps.ends_at,
  ps.area,
  ps.price_amount,
  ps.slots_open,
  ps.club_display_name,
  ps.host_display_name,
  ps.join_policy,
  ps.public_projection_version
FROM public_sessions ps
WHERE ps.expires_at > now()
  AND NOT EXISTS (
    SELECT 1 FROM public_projection_fences f
    WHERE f.surface = 'session_share'
      AND f.target_kind = 'session'
      AND f.target_id = ps.session_id
      AND f.deny_scope IN ('public','all')
  );

-- 4. narrow SECURITY DEFINER fence functions (0010 pattern) ------------------
-- 4a. raise (source transaction, role app): replace token => immediate deny.
CREATE OR REPLACE FUNCTION raise_public_session_fence(p_session_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- reason is a CLOSED enum (session_share raises on private/cancel/close only,
  -- DD-73:917); an unknown reason is a caller bug, fail-closed.
  IF p_reason IS NULL OR p_reason NOT IN ('visibility_private', 'cancelled', 'closed') THEN
    RAISE EXCEPTION 'raise_public_session_fence: reason must be visibility_private|cancelled|closed, got %', p_reason
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- current-tenant target derive+verify server-side (DD-75:957), fail-closed
  -- on a missing app.tenant_id GUC. The explicit tenant_id predicate holds
  -- whether or not the definer owner bypasses RLS on sessions.
  IF NOT EXISTS (
    SELECT 1 FROM sessions
    WHERE id = p_session_id
      AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  ) THEN
    RAISE EXCEPTION 'raise_public_session_fence: session % is not in the caller tenant (fail-closed)', p_session_id
      USING ERRCODE = 'raise_exception';
  END IF;
  INSERT INTO public_projection_fences (surface, target_kind, target_id, fence_token, deny_scope, reason)
  VALUES ('session_share', 'session', p_session_id, gen_random_uuid(), 'public', p_reason)
  ON CONFLICT (surface, target_kind, target_id)
  DO UPDATE SET fence_token = EXCLUDED.fence_token,
                deny_scope  = EXCLUDED.deny_scope,
                reason      = EXCLUDED.reason,
                created_at  = now();
END;
$$;
REVOKE ALL ON FUNCTION raise_public_session_fence(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION raise_public_session_fence(uuid, text) TO app;

-- 4b. observe current token (projector worker) — the read the CAS-clear needs.
CREATE OR REPLACE FUNCTION current_public_session_fence_token(p_session_id uuid)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT fence_token FROM public_projection_fences
  WHERE surface = 'session_share' AND target_kind = 'session' AND target_id = p_session_id;
$$;
REVOKE ALL ON FUNCTION current_public_session_fence_token(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION current_public_session_fence_token(uuid) TO app_worker;

-- 4c. CAS-clear (projector worker): delete IFF the observed token is still
--     current — no-ops when a newer raise changed it (new token wins).
CREATE OR REPLACE FUNCTION clear_public_session_fence(p_session_id uuid, p_observed_token uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM public_projection_fences
  WHERE surface = 'session_share' AND target_kind = 'session'
    AND target_id = p_session_id AND fence_token = p_observed_token;
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION clear_public_session_fence(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION clear_public_session_fence(uuid, uuid) TO app_worker;

-- 5. grant migration: move EVERY reader off the base table -------------------
-- NO runtime role may SELECT the base after cutover — a base read bypasses the
-- immediate-deny fence (decisions.md:269). readonly (the discovery consumer) is
-- moved to the guarded view. `app` is the generic HTTP/bot runtime role, so
-- leaving it base SELECT would let ordinary app code read a stale fenced row —
-- revoke it too. `app` KEEPS its INSERT/UPDATE/DELETE (0009:118) so the future
-- projector can write (DD-12: "projector writer keeps narrow rights"). app_worker
-- keeps its zero base grant.
--   NB for the projector slice: a projector that needs to read the base for a
--   conditional upsert or a WHERE-qualified UPDATE/DELETE must obtain that read
--   NARROWLY (a SECURITY DEFINER writer function, like the fence functions, or a
--   dedicated non-`app` writer role) — NOT by re-granting `app` base SELECT,
--   which would re-open exactly this bypass.
REVOKE SELECT ON public_sessions FROM readonly;
REVOKE SELECT ON public_sessions FROM app;
GRANT SELECT ON public_session_share_v TO readonly;
