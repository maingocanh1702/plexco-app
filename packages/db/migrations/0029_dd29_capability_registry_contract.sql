-- ============================================================================
-- 0029_dd29_capability_registry_contract.sql
-- DD-29 capability registry — CONTRACT half of the expand→contract pair (see
-- 0028_dd29_capability_registry_expand.sql for the widening half, which must
-- be applied on this database before this file can succeed).
--
-- Source: docs/autopilot-plans-dd29-capability-registry.md (CODE_READY v1.1) ·
--         docs/autopilot-manifests/plans-dd29-capability-registry.json.
--
-- Self-guarding: safe regardless of the actual deploy gap between 0028 and
-- this file (Q2 in the slice doc — decided to ship both in one release, but
-- the guard below makes correctness independent of that decision, not reliant
-- on it). If any subscriptions row still references an old plan_key — 0028
-- has not fully landed / repointed every row on THIS database — this
-- migration refuses to proceed rather than deleting a plans row a live FK
-- still points to.
--
-- Runs as ONE transaction (migrate.ts wraps each file in BEGIN…COMMIT/
-- ROLLBACK):
--   1. self-guard: refuse if any subscriptions row still references an old
--      plan_key. subscriptions carries ENABLE + FORCE ROW LEVEL SECURITY
--      (0009) — see 0028's header for the full rationale: a plain SELECT
--      here under a connection with no app.tenant_id set would silently see
--      ZERO rows across every tenant (the same hazard
--      0024_public_visibility_capacity_check.sql already documented for
--      `sessions`), so the guard's own count query needs the same
--      NO FORCE / FORCE ROW LEVEL SECURITY toggle 0028 uses, scoped to this
--      transaction only;
--   2. delete the 4 old plans rows — safe once the guard above proves no
--      subscriptions row still references them (plans carries no RLS — it is
--      a shared global catalog, not a tenant-scoped table, so no toggle is
--      needed for this step);
--   3. narrow plans_key_chk to the final DD-29 shape, ('free','host_pro').
--      Keep the constraint NAME plans_key_chk (0025 established it for
--      schema.ts alignment) — only the predicate narrows.
--
-- Rollback (conditional — safe only if committed and no row created since
-- relies on the narrowed CHECK or the deleted rows being gone): widen
-- plans_key_chk back to 0028's post-expand predicate (union of old ∪ new
-- values — the exact ALTER in 0028's own step 1), and re-insert the 4
-- deleted plans rows using 0011_seeds.sql's original literals verbatim
-- (this file does not carry them; 0011 is the source of truth for their
-- original price/limits/entitlements). Apply this file's rollback BEFORE
-- 0028's, mirroring the reverse of the expand→contract application order —
-- 0028's own rollback note assumes `plans` still has the 4 old rows to
-- reference, which is only true again once this step has run.
-- ============================================================================

ALTER TABLE subscriptions NO FORCE ROW LEVEL SECURITY;
DO $$ DECLARE v_remaining integer; BEGIN
  SELECT count(*) INTO v_remaining FROM subscriptions
    WHERE plan_key IN ('free_web','telegram','plus_channel','all_channels');
  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'DD-29 contract: % subscriptions row(s) still on an old plan_key — expand migration has not fully landed on this database', v_remaining
      USING ERRCODE = 'data_exception';
  END IF;
END $$;
ALTER TABLE subscriptions FORCE ROW LEVEL SECURITY;

DELETE FROM plans WHERE plan_key IN ('free_web','telegram','plus_channel','all_channels');
-- safe: the guard above proves no subscriptions FK still references these rows.

ALTER TABLE plans DROP CONSTRAINT plans_key_chk;
ALTER TABLE plans ADD CONSTRAINT plans_key_chk CHECK (plan_key IN ('free','host_pro'));
