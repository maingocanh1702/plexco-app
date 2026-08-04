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
-- OPERATIONAL PRECONDITION (see 0028's header for the full mechanism and the
-- evidence behind it; restated here since a deployer may read this file
-- without re-reading 0028's): IF THIS PAIR IS EVER APPLIED TO AN ENVIRONMENT
-- CARRYING LIVE ONBOARDING TRAFFIC, PAUSE WRITES TO tenant_provision() (i.e.
-- onboarding) FOR THE DURATION OF THE DEPLOY. No code fence is added,
-- deliberately: the window this guards against — a tenant_provision() call
-- already in flight when 0028's CREATE OR REPLACE FUNCTION commits, finishing
-- on its session's cached OLD function body — closes PERMANENTLY once this
-- pair lands, so a fence would protect exactly one deploy event, and today
-- that event has zero traffic to protect. The self-guard immediately below IS
-- the enforcement for this precondition: if it is ignored anyway and a
-- straggler 'free_web' row was created, this guard aborts the migration on
-- it — a loud, recoverable deploy failure, not silent data corruption.
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
--   1b. catalog-version guard (codex round-13 [P1], gate-attempt-02: this
--      file's own gap — 0028's guard 2/2-catalog only ever ran AT 0028's OWN
--      COMMIT; anything inserted into `plans` on an old key AFTER that, in the
--      window before this file runs — e.g. a stray telegram@2 historical
--      price-change row with no subscription pointing at it — would sail past
--      guard 1 above (which only checks subscriptions) and then get silently
--      erased by the unconditional DELETE below, exactly the "plan version is
--      immutable, never silently destroyed" hazard 0028's own guard 2-catalog
--      exists to prevent, just on this file's side of the gap instead):
--      refuse if any `plans` row on an old key still exists at a version other
--      than 1 — the CHECK below only handles version 1 rows dying together
--      with the fixed 4-row seed;
--   2. delete the 4 old plans rows — safe once guards 1 and 1b above prove no
--      subscriptions row still references them AND no unexpected extra
--      version exists (plans carries no RLS — it is a shared global catalog,
--      not a tenant-scoped table, so no toggle is needed for this step);
--   3. narrow plans_key_chk to the final DD-29 shape, ('free','host_pro').
--      Keep the constraint NAME plans_key_chk (0025 established it for
--      schema.ts alignment) — only the predicate narrows.
--
-- Rollback (codex round-14 [P1], gate-attempt-03: run inside one explicit
-- transaction, same reasoning as 0028's own rollback note — a widened CHECK
-- with the 4 rows not yet reinserted, left half-done by an unhandled error,
-- is not a state anyone should observe):
--   BEGIN;
--     ALTER TABLE plans DROP CONSTRAINT plans_key_chk;
--     ALTER TABLE plans ADD CONSTRAINT plans_key_chk
--       CHECK (plan_key IN ('free_web','telegram','plus_channel','all_channels','free','host_pro'));
--     -- re-insert the 4 deleted plans rows using 0011_seeds.sql's original
--     -- literals verbatim (this file does not carry them; 0011 is the source
--     -- of truth for their original price/limits/entitlements). Use
--     -- ON CONFLICT (plan_key, version) DO NOTHING, mirroring 0028's own seed
--     -- insert idiom — makes a retried rollback attempt (e.g. after the
--     -- transaction above committed but a LATER step in 0028's own rollback
--     -- failed and this whole procedure is re-run from the top) idempotent
--     -- instead of erroring on a duplicate key.
--   COMMIT;
-- Apply this file's rollback BEFORE 0028's, mirroring the reverse of the
-- expand→contract application order — 0028's own rollback note assumes
-- `plans` still has the 4 old rows to reference, which is only true again
-- once this step has run.
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

-- guard 1b (codex round-13 [P1], gate-attempt-02): refuse if any old-key
-- plans row exists at a version other than 1 — regardless of whether any
-- subscription references it. Mirrors 0028's own guard-2-catalog check, on
-- this file's side of the 0028-to-0029 gap: a historical price-change
-- snapshot (e.g. telegram@2) inserted into the catalog AFTER 0028 committed
-- would pass guard 1 above untouched (it only scans subscriptions) and then
-- be silently destroyed by the unconditional DELETE below.
DO $$ DECLARE v_bad_catalog_version integer; BEGIN
  SELECT count(*) INTO v_bad_catalog_version FROM plans
    WHERE plan_key IN ('free_web','telegram','plus_channel','all_channels') AND version <> 1;
  IF v_bad_catalog_version > 0 THEN
    RAISE EXCEPTION 'DD-29 contract: % plans catalog row(s) exist on an old plan_key at version <> 1 — this DELETE only knows how to retire the fixed 4-row v1 seed; resolve the extra version before retrying', v_bad_catalog_version
      USING ERRCODE = 'data_exception';
  END IF;
END $$;

DELETE FROM plans WHERE plan_key IN ('free_web','telegram','plus_channel','all_channels');
-- safe: the guards above prove no subscriptions FK still references these
-- rows, and no unexpected extra version exists among them.

ALTER TABLE plans DROP CONSTRAINT plans_key_chk;
ALTER TABLE plans ADD CONSTRAINT plans_key_chk CHECK (plan_key IN ('free','host_pro'));
