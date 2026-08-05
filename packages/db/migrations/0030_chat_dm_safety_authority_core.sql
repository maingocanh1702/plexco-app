-- ============================================================================
-- 0030_chat_dm_safety_authority_core.sql
-- chat-dm-safety-authority-core (slice 2 of the DD-38/DD-86 chat tree).
-- Canonical DD-55 DM safety authority: block/report/rate storage plus the
-- pure predicates and fail-closed gate that dd38-dd86-chat-schema-core
-- (slice 3) and every later DM-touching slice (7/8) call into. Creates no
-- chat_* content table -- those are root's own deliverable (slice 3).
-- Source: docs/autopilot-chat-dm-safety-authority-core.md, decisions.md
--         DD-55, feature_inapp_chat_tech.md v0.23 section "DD-55 design-probe
--         gates" / section 2 (helper idiom) / section 4-5.
--
-- Every CHECK below carries an explicit CONSTRAINT name (contract SS6.1's own
-- verbatim text left 6 of 8 unnamed; SS6.2 requires the schema.ts mirror to
-- declare matching explicit names so rls-invariants.test.ts's generic CND
-- guard covers these tables -- an unnamed CHECK here would make that
-- instruction unsatisfiable, since schema.ts can only truthfully declare a
-- name Postgres actually assigned). Naming propagates SS6.1's own two
-- examples (chat_dm_safety_config_{sender,target}_limit_positive_chk) to the
-- rest; no CHECK semantics changed.
--
-- NO chat_dm_safety_audit TABLE (owner-amended 2026-08-05, replacing SS6.1's
-- original pinned shape -- see design probe row 6 and this file's own
-- assert_dm_allowed() comment below for why). A table written via INSERT
-- immediately before RAISE EXCEPTION in the same statement can never persist
-- a row through normal operation: PL/pgSQL's exception handling is
-- savepoint-rollback-based, so the RAISE unconditionally undoes the INSERT,
-- for every calling pattern (proven empirically, not just reasoned). Shipping
-- that table anyway would have looked like a working audit trail to the next
-- reader while never actually holding a row -- a machine-readable claim that
-- contradicts reality. assert_dm_allowed() instead emits RAISE LOG, which
-- Postgres delivers outside transactional rollback.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- chat_dm_safety_config -- singleton kill-switch + tuning row. Four
-- independent capability toggles; dm_safety_enabled() is their AND. Global
-- protected: no RLS (not tenant-scoped), zero grant to app/chat_definer for
-- writes -- flipped only via direct DDL-owner/superuser access, never
-- through the application. All boolean flags default true: this migration
-- ships all four subsystems complete, so there is no reason to land it
-- pre-disabled.
--
-- audit_enabled has TWO effects (owner-amended 2026-08-05, no new column):
-- (1) unchanged -- it is one of the four flags dm_safety_enabled() ANDs, so
-- disabling it alone still fail-closes the WHOLE subsystem (test #28's own
-- "disable any ONE of the four" requirement). (2) it now ALSO gates whether
-- assert_dm_allowed() emits its RAISE LOG line on a denial -- see that
-- function's own comment; there is no queryable chat_dm_safety_audit table
-- in this migration.
--
-- KEEPING audit_enabled's default at true (codex round-01 [P1], addressed not
-- silently accepted): the reviewer's own suggested fix -- default audit to
-- false until log capture/retention is proven -- would, per effect (1) above,
-- default the ENTIRE DM safety subsystem to DISABLED on every fresh install,
-- not just logging: dm_safety_enabled() ANDs all four flags, by design (this
-- file's own contract SS5 design-probe row 2, itself required by BE spec
-- test #28's "disable any ONE independently" requirement, which presupposes
-- all four start enabled). That is a strictly worse outcome than the
-- observability gap it would fix -- DD-55 is a HARD gate (decisions.md:
-- "Thiếu một gate → DM disabled fail-closed"), not an opt-in one, and
-- shipping it pre-disabled defeats the migration's entire purpose. The real
-- gap the reviewer names -- production log capture/retention for RAISE LOG
-- is unverified -- is real and already tracked, not silently dropped: see
-- backlog chat-dm-safety-audit-queryable-path.
--
-- dm_sender_limit_per_min/dm_target_limit_per_min carry the same two
-- numbers previously hardcoded as literal arguments inside
-- assert_dm_allowed() (30 each -- see contract SS5 design-probe row 11).
-- Moved here for the identical reason the four booleans are here and not in
-- an env var: this table is read from inside SECURITY DEFINER functions
-- reached via direct-role test harnesses and future RPCs that never touch
-- the Node app layer, so config has to be DB-native. Under P17 (migrations
-- are forward-only, no reverse runbook), a hardcoded literal can only be
-- retuned by a brand-new migration that recreates this function's body --
-- full code+security review for what is purely an operational number.
-- A config column makes retuning a plain UPDATE. CHECK > 0 on both: a
-- typo'd UPDATE that sets either to 0 must fail loudly at write time, not
-- silently turn into "0 allowed per minute" (i.e. the limiter effectively
-- always denies, indistinguishable from a self-inflicted outage) discovered
-- only when DM traffic stops.
-- ---------------------------------------------------------------------------
CREATE TABLE chat_dm_safety_config (
  singleton boolean PRIMARY KEY DEFAULT true
    CONSTRAINT chat_dm_safety_config_singleton_chk CHECK (singleton),
  block_enabled boolean NOT NULL DEFAULT true,
  report_enabled boolean NOT NULL DEFAULT true,
  rate_limit_enabled boolean NOT NULL DEFAULT true,
  audit_enabled boolean NOT NULL DEFAULT true,
  dm_sender_limit_per_min integer NOT NULL DEFAULT 30
    CONSTRAINT chat_dm_safety_config_sender_limit_positive_chk CHECK (dm_sender_limit_per_min > 0),
  dm_target_limit_per_min integer NOT NULL DEFAULT 30
    CONSTRAINT chat_dm_safety_config_target_limit_positive_chk CHECK (dm_target_limit_per_min > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO chat_dm_safety_config (singleton) VALUES (true);

-- ---------------------------------------------------------------------------
-- chat_dm_safety_config's own updated_at needs a touch-on-UPDATE trigger
-- (codex round-01 [P2]): `DEFAULT now()` alone only stamps the INSERT above;
-- every later `UPDATE chat_dm_safety_config SET ...` (retuning limits,
-- flipping a capability) would otherwise leave updated_at frozen at insert
-- time forever, contradicting design probe row 11's own claim that retuning
-- is "auditable via updated_at". No existing touch-on-update trigger exists
-- elsewhere in this codebase to reuse (0010/0022's own triggers are all
-- append-only/immutability guards, a different shape); scoped to this one
-- table, matching this repo's per-table (not generic shared) trigger
-- convention.
-- ---------------------------------------------------------------------------
CREATE FUNCTION chat_dm_safety_config_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_chat_dm_safety_config_touch_updated_at
  BEFORE UPDATE ON chat_dm_safety_config
  FOR EACH ROW EXECUTE FUNCTION chat_dm_safety_config_touch_updated_at();

-- ---------------------------------------------------------------------------
-- chat_blocks -- canonical, cross-feature block-pair store (DD-55: "dùng
-- chung chat/social/User Settings, không tạo store thứ hai"). Current-state
-- relation, not a log: a row means "blocker currently blocks blocked".
-- Direction stored once; chat_pair_blocked() checks both directions, so the
-- effect is symmetric even though storage is directional (records WHO
-- acted). Write path (INSERT on block / DELETE on unblock) belongs to
-- chat-dm-lifecycle-command-core (slice 8) -- this migration grants no
-- INSERT/UPDATE/DELETE to chat_definer, only the SELECT its own predicate
-- needs; slice 8's own migration adds its own grant when it lands the RPC,
-- matching root's "never grant a capability whose lifecycle has no owner"
-- rule for chat_channels/members/messages.
-- ---------------------------------------------------------------------------
CREATE TABLE chat_blocks (
  blocker_person_id uuid NOT NULL REFERENCES persons(id),
  blocked_person_id uuid NOT NULL REFERENCES persons(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_person_id, blocked_person_id),
  CONSTRAINT chat_blocks_no_self_chk CHECK (blocker_person_id <> blocked_person_id)
);

-- ---------------------------------------------------------------------------
-- chat_reports -- canonical DM abuse report store. Workflow state machine
-- submitted -> triaged -> actioned|closed (feature_inapp_chat_tech.md line
-- 50). No channel_id: DM identity is the (reporter,reported) pair itself
-- (dm_key = least(a,b):greatest(a,b), root's own scheme), and chat_channels
-- does not exist yet at this migration's position in the dependency order
-- (slice 3 lands after this one) -- a channel_id FK here would be a forward
-- reference to a table this slice cannot see. Reason vocabulary reuses
-- DD-95's exact set for one taxonomy across the chat safety surface, not a
-- parallel one. Triage/action write path belongs to a future support/ops
-- tool, out of this slice's scope; this migration grants no mutation to
-- chat_definer or app on this table for the same "no owner yet" reason as
-- chat_blocks.
-- ---------------------------------------------------------------------------
CREATE TABLE chat_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_person_id uuid NOT NULL REFERENCES persons(id),
  reported_person_id uuid NOT NULL REFERENCES persons(id),
  reason_code text NOT NULL
    CONSTRAINT chat_reports_reason_code_chk
    CHECK (reason_code IN ('spam','harassment','unsafe','off_topic','other')),
  note text,
  status text NOT NULL DEFAULT 'submitted'
    CONSTRAINT chat_reports_status_chk
    CHECK (status IN ('submitted','triaged','actioned','closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chat_reports_no_self_chk CHECK (reporter_person_id <> reported_person_id),
  CONSTRAINT chat_reports_note_shape_chk CHECK (
    (reason_code = 'other' AND note IS NOT NULL AND length(btrim(note)) BETWEEN 1 AND 500)
    OR (reason_code <> 'other' AND note IS NULL)
  )
);

-- ---------------------------------------------------------------------------
-- dm_safety_enabled() -- pure predicate, the AND of all four capability
-- toggles. Missing config row (should never happen -- inserted above, no
-- delete grant to anyone) still fails closed via COALESCE, not an error.
-- ---------------------------------------------------------------------------
CREATE FUNCTION dm_safety_enabled() RETURNS boolean
  LANGUAGE sql SECURITY DEFINER STABLE SET search_path = pg_catalog, public AS $$
  SELECT COALESCE(
    (SELECT block_enabled AND report_enabled AND rate_limit_enabled AND audit_enabled
       FROM chat_dm_safety_config WHERE singleton),
    false
  );
$$;
REVOKE ALL ON FUNCTION dm_safety_enabled() FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- chat_pair_blocked(a, b) -- pure predicate, direction-agnostic (checks
-- both storage directions -- DD-55 "loại hai chiều").
-- ---------------------------------------------------------------------------
CREATE FUNCTION chat_pair_blocked(p_a uuid, p_b uuid) RETURNS boolean
  LANGUAGE sql SECURITY DEFINER STABLE SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM chat_blocks
    WHERE (blocker_person_id = p_a AND blocked_person_id = p_b)
       OR (blocker_person_id = p_b AND blocked_person_id = p_a)
  );
$$;
REVOKE ALL ON FUNCTION chat_pair_blocked(uuid, uuid) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- assert_dm_allowed(actor, peer, action) -- side-effecting fail-closed gate.
-- Called by create_dm/send_chat_message (slice 8/7 owners) for
-- action IN ('create','send'), and by mark_read (slice 7) for action =
-- 'read'. Order: malformed input -> disabled -> blocked -> sender rate ->
-- target rate; rate dimensions are skipped for 'read' (mark_read is
-- receiver-side bookkeeping, not a spam vector -- dm_current_read_allowed,
-- root's own RLS predicate, never rate-limits reads either). On any deny,
-- emits ONE RAISE LOG line with the real reason (when audit_enabled), then
-- raises the SAME generic message the Reviewed spec already uses at the RLS
-- boundary (feature_inapp_chat_tech.md:684, send_chat_message) -- one
-- wire-visible error text for the whole DM safety surface, by construction,
-- not by convention someone has to remember.
--
-- RAISE LOG, not a chat_dm_safety_audit table (owner-amended 2026-08-05,
-- replacing SS6.1's original pinned shape; see design probe row 6): an
-- INSERT immediately before RAISE EXCEPTION in the same statement can never
-- persist, because PL/pgSQL's exception handling is savepoint-rollback-based
-- -- the RAISE unconditionally undoes the INSERT, for every calling pattern
-- (proven empirically). RAISE LOG is delivered through Postgres's own
-- logging subsystem, which sits OUTSIDE transactional rollback, so it
-- survives the RAISE EXCEPTION that immediately follows it. This trades a
-- queryable table for unstructured server-log text; a queryable path is a
-- separate, deliberately deferred follow-up (backlog:
-- chat-dm-safety-audit-queryable-path) once a caller exists that can write
-- the row from inside its OWN exception handler, in a transaction that
-- actually commits.
--
-- The two rate limits (and now audit_enabled) are read from
-- chat_dm_safety_config on every call, the same
-- COALESCE-wrapped-scalar-subquery-to-fail-closed idiom dm_safety_enabled()
-- itself already uses, not a fresh pattern. A missing config row (should
-- never happen -- see that table's own header) COALESCEs the two limits to
-- 0, which makes rate_limit_check deny unconditionally (v_count >= 0 is true
-- even for a brand-new bucket) -- fail-closed defense in depth, even though
-- dm_safety_enabled()'s own identical missing-row COALESCE already denies
-- first via the IF/ELSIF chain below and would prevent this branch from ever
-- being reached with a NULL-turned-0 limit in practice. Belt and suspenders
-- on purpose: this function's fail-closed property should not depend on the
-- two checks staying in this exact order forever. audit_enabled COALESCEs to
-- false on a missing row -- fail-closed means "do not log", consistent with
-- every other missing-row behavior in this migration, never "log anyway".
-- ---------------------------------------------------------------------------
CREATE FUNCTION assert_dm_allowed(p_actor uuid, p_peer uuid, p_action text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_deny_reason text;
  v_sender_limit integer;
  v_target_limit integer;
  v_audit_enabled boolean;
BEGIN
  -- p_action IS NULL checked explicitly: `NULL NOT IN (...)` evaluates to NULL (SQL three-valued
  -- logic), not TRUE, so `IF p_action NOT IN (...) THEN` alone silently treats NULL as valid --
  -- skipping this guard AND, later, both `p_action IN ('create','send')` rate-limit branches
  -- (also NULL, also non-TRUE), reaching a normal return with no exception (codex round-01 [P1]).
  IF p_action IS NULL OR p_action NOT IN ('create','send','read') THEN
    RAISE EXCEPTION 'assert_dm_allowed: invalid action' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_actor IS NULL OR p_peer IS NULL OR p_actor = p_peer THEN
    RAISE EXCEPTION 'assert_dm_allowed: invalid participants' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_sender_limit := COALESCE((SELECT dm_sender_limit_per_min FROM chat_dm_safety_config WHERE singleton), 0);
  v_target_limit := COALESCE((SELECT dm_target_limit_per_min FROM chat_dm_safety_config WHERE singleton), 0);
  v_audit_enabled := COALESCE((SELECT audit_enabled FROM chat_dm_safety_config WHERE singleton), false);

  IF NOT dm_safety_enabled() THEN
    v_deny_reason := 'safety_disabled';
  ELSIF chat_pair_blocked(p_actor, p_peer) THEN
    v_deny_reason := 'blocked';
  ELSIF p_action IN ('create','send')
        AND NOT rate_limit_check('chat_dm_sender:' || p_actor::text, v_sender_limit, interval '1 minute') THEN
    v_deny_reason := 'rate_limited_sender';
  ELSIF p_action IN ('create','send')
        AND NOT rate_limit_check('chat_dm_target:' || p_peer::text, v_target_limit, interval '1 minute') THEN
    v_deny_reason := 'rate_limited_target';
  END IF;

  IF v_deny_reason IS NOT NULL THEN
    IF v_audit_enabled THEN
      RAISE LOG 'chat_dm_safety_audit actor=% peer=% action=% deny_reason=% at=%',
        p_actor, p_peer, p_action, v_deny_reason, clock_timestamp();
    END IF;
    RAISE EXCEPTION 'chat safety blocked' USING ERRCODE = 'insufficient_privilege';
  END IF;
END; $$;
REVOKE ALL ON FUNCTION assert_dm_allowed(uuid, uuid, text) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Owner/grant block -- REQUIRES chat_definer role (chat-definer-role-
-- provisioning, merged) to exist first. Mirrors dd38-dd86-chat-schema-
-- core's own GRANT CREATE / ALTER OWNER / REVOKE CREATE dance exactly
-- (PG16: new owner needs CREATE on the function's schema at ALTER-OWNER
-- time only); this is the FIRST migration to do it, since this slice lands
-- before root. Owner implicitly has EXECUTE on its own functions -- no
-- separate GRANT EXECUTE ... TO chat_definer needed for the three
-- functions this migration creates.
-- ---------------------------------------------------------------------------
GRANT USAGE, CREATE ON SCHEMA public TO chat_definer;
ALTER FUNCTION dm_safety_enabled() OWNER TO chat_definer;
ALTER FUNCTION chat_pair_blocked(uuid, uuid) OWNER TO chat_definer;
ALTER FUNCTION assert_dm_allowed(uuid, uuid, text) OWNER TO chat_definer;
REVOKE CREATE ON SCHEMA public FROM chat_definer;

GRANT SELECT ON chat_dm_safety_config TO chat_definer;
GRANT SELECT ON chat_blocks TO chat_definer;
GRANT EXECUTE ON FUNCTION rate_limit_check(text, integer, interval) TO chat_definer;

-- No grant of any kind to app/app_worker/readonly on either table above:
-- both global protected (not tenant-scoped -- DM is cross-tenant/
-- person-scoped, RLS keyed on app.tenant_id would be the wrong boundary
-- here), reached only through chat_definer-owned SECURITY DEFINER
-- functions -- same model as persons/accounts (0009). No grant on
-- chat_reports at all: nothing in this slice reads or writes it (see
-- design probe row 13); slice 8 grants what it needs when it lands the
-- report RPC.
