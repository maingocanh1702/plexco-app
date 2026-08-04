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
-- Rollback — STANDALONE case only (codex round-15 [P1], gate-attempt-04: this
-- note's own BEGIN/COMMIT below is for rolling back 0029 BY ITSELF, with 0028
-- remaining applied — e.g. this file was deployed but something later needs
-- the wider CHECK/old rows back temporarily, without reverting 0028 too. This
-- is a genuinely different, standalone operation from rolling back the FULL
-- pair. If 0028 is ALSO being rolled back, do NOT run the transaction below —
-- Postgres has no nested transactions, so wrapping these same two statements
-- in their own BEGIN/COMMIT while ALSO wrapping the full pair in an outer one
-- would either commit this piece early or truncate the outer transaction.
-- 0028's own rollback note inlines these exact two statements directly into
-- its single combined transaction instead — use that note for a full-pair
-- rollback, this one only for reverting 0029 alone):
--   BEGIN;
--     ALTER TABLE plans DROP CONSTRAINT plans_key_chk;
--     ALTER TABLE plans ADD CONSTRAINT plans_key_chk
--       CHECK (plan_key IN ('free_web','telegram','plus_channel','all_channels','free','host_pro'));
--     -- re-insert the 4 deleted plans rows using 0011_seeds.sql's original
--     -- literals verbatim (this file does not carry them; 0011 is the source
--     -- of truth for their original price/limits/entitlements). Use
--     -- ON CONFLICT (plan_key, version) DO NOTHING, mirroring 0028's own seed
--     -- insert idiom — makes a retried rollback attempt idempotent instead of
--     -- erroring on a duplicate key.
--   COMMIT;
-- Whether standalone or inlined into 0028's transaction, this step always runs
-- BEFORE 0028's own reversal, mirroring the reverse of the expand→contract
-- application order — 0028's own rollback assumes `plans` still has the 4 old
-- rows to reference, which is only true again once this step has run.
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

-- Lock plans EXCLUSIVELY before checking it (codex round-15 [P1], gate-attempt-04:
-- guard 1b's own SELECT takes only ACCESS SHARE, which does not conflict with a
-- concurrent INSERT — a telegram@2-shaped row could commit AFTER guard 1b's count
-- already read 0 but BEFORE the DELETE below runs, and would then be silently
-- destroyed by that DELETE despite guard 1b "having checked"). Taking this lock
-- AFTER subscriptions above (not before) preserves the same subscriptions-then-plans
-- order 0028's own header establishes to avoid deadlocking a concurrent
-- tenant_provision() call — this migration touches subscriptions first (guard 1's
-- toggle), then plans, never the reverse.
LOCK TABLE plans IN ACCESS EXCLUSIVE MODE;

-- guard 1b (codex round-13 [P1], gate-attempt-02): refuse if any old-key
-- plans row exists at a version other than 1 — regardless of whether any
-- subscription references it. Mirrors 0028's own guard-2-catalog check, on
-- this file's side of the 0028-to-0029 gap: a historical price-change
-- snapshot (e.g. telegram@2) inserted into the catalog AFTER 0028 committed
-- would pass guard 1 above untouched (it only scans subscriptions) and then
-- be silently destroyed by the unconditional DELETE below. The exclusive lock
-- just taken above means nothing can insert such a row between this check and
-- the DELETE — closing the TOCTOU race, not just documenting it away.
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
