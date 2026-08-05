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
--   1c. target-catalog guard (codex round-1, gate-attempt-02 [P1]): 0028's own
--      guard 4 validated free@1/host_pro@1 once, at 0028's commit — a
--      privileged edit landing in the gap window before this file runs could
--      delete or alter either row with nothing else here noticing, since
--      guards 1/1b only ever scan for OLD-key rows. Re-runs 0028's exact
--      canonical-payload check under the same exclusive lock guard 1b uses;
--   2. delete the 4 old plans rows — safe once guards 1, 1b and 1c above prove
--      no subscriptions row still references the old rows, no unexpected
--      extra version exists, and the new target rows are themselves intact
--      (plans carries no RLS — it is a shared global catalog, not a
--      tenant-scoped table, so no toggle is needed for this step);
--   3. narrow plans_key_chk to the final DD-29 shape, ('free','host_pro').
--      Keep the constraint NAME plans_key_chk (0025 established it for
--      schema.ts alignment) — only the predicate narrows.
--
-- Migrations in this repo are forward-only; see
-- docs/standards/core-db-architecture-principles.md (P17) for why no reverse
-- runbook is provided.
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

-- guard 1c (codex round-1, gate-attempt-02 [P1]): guards 1/1b above prove the OLD rows are safe to
-- delete, but nothing re-checks that the NEW target rows (free@1, host_pro@1) this whole pair exists
-- to establish are still intact. 0028's own guard 4 validated them once, at 0028's commit — but that
-- transaction ends there, and a privileged edit landing in the gap window before this file runs
-- (however narrow — see both files' own OPERATIONAL PRECONDITION notes for the analogous
-- tenant_provision() gap) could delete or alter either row with nothing in 0029 noticing, since
-- guard 1/1b only ever scan for OLD-key rows. If free@1 were deleted in that window, this file would
-- still narrow plans_key_chk and report success, leaving tenant_provision()'s very next INSERT
-- referencing a plans row that no longer exists — a live FK failure on the onboarding path, not a
-- migration-time one. Re-running the exact canonical-payload check from 0028's guard 4 here, under
-- the SAME exclusive lock already held above (no new lock, no new TOCTOU window), closes it: this
-- migration verifies its own precondition instead of trusting 0028's now-committed, no-longer-checked
-- past tense.
DO $$ DECLARE v_free_ok boolean; v_host_pro_ok boolean; BEGIN
  SELECT (
    price = 0 AND currency = 'VND' AND interval = 'monthly' AND active
    AND limits = '{"max_clubs": 2, "ai_monthly_question_cap": 0}'::jsonb
    AND entitlements = '{"capabilities": {"web_app": true, "bot_zalo": true, "bot_messenger": true,
         "session_management": true, "discovery_marketplace": true,
         "payment_mark_manual": true, "payment_reconcile_auto": false,
         "reminders_manual": true, "reminders_auto": false,
         "assistant_ai_kb": false, "crm_dashboard": false}}'::jsonb
  ) INTO v_free_ok FROM plans WHERE plan_key = 'free' AND version = 1;
  SELECT (
    price = 250000 AND currency = 'VND' AND interval = 'monthly' AND active
    AND limits = '{"max_clubs": null, "ai_monthly_question_cap": 2000}'::jsonb
    AND entitlements = '{"capabilities": {"web_app": true, "bot_zalo": true, "bot_messenger": true,
         "session_management": true, "discovery_marketplace": true,
         "payment_mark_manual": true, "payment_reconcile_auto": true,
         "reminders_manual": true, "reminders_auto": true,
         "assistant_ai_kb": true, "crm_dashboard": true}}'::jsonb
  ) INTO v_host_pro_ok FROM plans WHERE plan_key = 'host_pro' AND version = 1;
  IF NOT coalesce(v_free_ok, false) THEN
    RAISE EXCEPTION 'DD-29 contract: free@1 plans row is missing or no longer matches the canonical DD-29 payload — 0028 validated it at commit, but this file re-checks independently before deleting the old catalog and narrowing the CHECK; resolve before retrying'
      USING ERRCODE = 'data_exception';
  END IF;
  IF NOT coalesce(v_host_pro_ok, false) THEN
    RAISE EXCEPTION 'DD-29 contract: host_pro@1 plans row is missing or no longer matches the canonical DD-29 payload — 0028 validated it at commit, but this file re-checks independently before deleting the old catalog and narrowing the CHECK; resolve before retrying'
      USING ERRCODE = 'data_exception';
  END IF;
END $$;

DELETE FROM plans WHERE plan_key IN ('free_web','telegram','plus_channel','all_channels');
-- safe: guards 1/1b above prove no subscriptions FK still references these rows and no unexpected
-- extra version exists among them; guard 1c proves the target rows this deletion's whole purpose is
-- to make canonical are themselves still intact.

ALTER TABLE plans DROP CONSTRAINT plans_key_chk;
ALTER TABLE plans ADD CONSTRAINT plans_key_chk CHECK (plan_key IN ('free','host_pro'));
