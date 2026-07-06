-- ============================================================================
-- 0013_onboarding_steps_recency.sql
-- onboarding_steps needs a recency column (expand only — 0008 already applied).
-- Source: codex S4b round-08 — retries legitimately leave multiple rows per
--         (run_id, step) (unique on run_id/step/idempotency_key), and without
--         a timestamp to order by, the readiness read picks an arbitrary row.
--         codex auth-onboarding-v3 round-11 — created_at ALONE is not a safe
--         tie-breaker: Postgres now() is transaction-stable (concurrent/
--         same-transaction inserts can share one value) and the ALTER below
--         backfills every PRE-EXISTING row with the SAME now() at migration
--         time, so two rows for the same step can tie on created_at with no
--         deterministic ORDER BY winner. Added `seq` (bigserial — a sequence
--         allocation, strictly monotonic regardless of transaction timing) as
--         the authoritative recency-ordering column; created_at stays for
--         human-readable audit only, no longer used for ordering logic.
-- ============================================================================

ALTER TABLE onboarding_steps ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE onboarding_steps ADD COLUMN seq bigserial NOT NULL;
