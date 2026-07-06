-- ============================================================================
-- 0013_onboarding_steps_recency.sql
-- onboarding_steps needs a recency column (expand only — 0008 already applied).
-- Source: codex S4b round-08 — retries legitimately leave multiple rows per
--         (run_id, step) (unique on run_id/step/idempotency_key), and without
--         a timestamp to order by, the readiness read picks an arbitrary row.
-- ============================================================================

ALTER TABLE onboarding_steps ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
