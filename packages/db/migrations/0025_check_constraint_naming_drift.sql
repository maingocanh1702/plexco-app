-- ============================================================================
-- 0025_check_constraint_naming_drift.sql
-- Rename 40 auto-generated CHECK constraint names to the names schema.ts
-- declares, across 23 tables. Pure identity rename — zero predicate change.
--
-- Contract: docs/autopilot-manifests/db-check-constraint-naming-drift.json ·
--   .autopilot/state/db-check-constraint-naming-drift/design-probe.md.
--
-- The bug (documented once already, in 0014:43-50, and never swept past
-- `players`): 0002-0008 wrote most of their CHECKs INLINE and UNNAMED, so
-- PostgreSQL auto-named them `<table>_<column>_check` (or `<table>_check`
-- for a multi-column/table-level predicate). schema.ts's Drizzle `check()`
-- builder declares a DIFFERENT name (typically `<table>_<column>_chk`) for
-- the exact same predicate. Every constraint below fires and enforces
-- correctly today under its auto-generated name — this is a naming-identity
-- fix, not a behavior fix. It matters because `schema.ts`, `dep_checks`-style
-- tooling, and any future migration/test that assumes a `schema.ts` name is
-- the live name are all silently wrong until this file applies. Measured
-- from `pg_constraint` on a database freshly migrated to 0024 (not from
-- `schema.ts` source text — see design-probe.md for the full method chain
-- and why an earlier `awk`-based count of 27 and an earlier catalog count of
-- 47 were both wrong in different ways).
--
-- What this migration does and does NOT do:
--   DOES     — for each of the 40 pairs below:
--              ALTER TABLE <t> RENAME CONSTRAINT <auto_name> TO <declared_name>.
--              Also adds a regression guard
--              (packages/db/src/rls-invariants.test.ts) that fails the
--              moment a future migration repeats this class of drift.
--   DOES NOT — change any predicate, column, nullability, default, type,
--              RLS policy, role, or grant. Does not touch
--              `sessions_public_capacity_chk` (0024, already correctly
--              named). Does not add the 6 CHECK constraints that exist live
--              with no `schema.ts` declaration at all (`bank_accounts.
--              webhook_status`, `channel_identities.status`,
--              `messenger_pages.status`, `oauth_transactions.provider`,
--              `provider_connections.status`, `zalo_bots.status`) — those
--              have no declared name to rename them TO; they are reported in
--              design-probe.md item (e) and tracked as a separate follow-up
--              (schema.ts-only patch, no migration), not fixed here.
--
-- RENAME, not DROP+ADD (codex round-01 [P1]): the settled precedent (0014)
-- used `DROP CONSTRAINT IF EXISTS <auto> / DROP CONSTRAINT IF EXISTS
-- <declared> / ADD CONSTRAINT <declared> CHECK (<predicate>)` for a SINGLE
-- constraint on an empty table. Applying that same shape to 40 constraints
-- across 23 tables in one transaction is materially riskier on a POPULATED
-- database: `ADD CONSTRAINT ... CHECK (...)` re-validates the predicate
-- against every existing row before it can commit, and — because all 40
-- renames run inside ONE transaction (migrate.ts's per-file contract) — the
-- ACCESS EXCLUSIVE lock each `ADD CONSTRAINT` takes is held until the FINAL
-- commit, not released between tables. On money-path tables specifically
-- (`charges`, `bank_transactions`, `payment_allocations`, `bank_accounts`)
-- that means a long-held exclusive lock blocking all reads/writes for
-- however long the full-table scan+validation takes, compounding across all
-- 12 money-path renames plus every other table renamed first in the same
-- transaction. `RENAME CONSTRAINT` is a pure catalog metadata update — it
-- cannot change what the constraint accepts (there is no predicate clause to
-- transcribe, which also removes any risk of a hand-transcription error
-- diverging from the live predicate), does not scan or re-validate table
-- data, and commits in the time it takes to update one `pg_constraint` row
-- regardless of table size. Verified directly (not assumed): applied against
-- a database migrated to 0024, `ALTER TABLE persons RENAME CONSTRAINT
-- persons_status_check TO persons_status_chk` leaves
-- `pg_get_constraintdef` byte-identical to what it was before the rename.
-- `RENAME CONSTRAINT` has no `IF EXISTS` form in PostgreSQL — this is a
-- monotonic migration applied exactly once per database (migrate.ts records
-- applied files by hash and skips re-application), so the absence of a
-- defensive IF EXISTS is the correct fail-closed behavior: if a name below
-- turns out not to match live reality on some database, the migration
-- fails loudly instead of silently doing nothing.
--
-- Money-path: 12 of the 40 sit on `charges`, `bank_transactions`,
-- `payment_allocations`, `bank_accounts`. `migrate.ts` runs this whole file
-- in ONE transaction (BEGIN before the first statement, COMMIT after the
-- last, ROLLBACK on any error — see migrate.ts:161-173), so there is no
-- window where a money table is unconstrained even momentarily; a mid-file
-- failure rolls back every rename in this file, not just the failing one.
-- ============================================================================

-- ---- persons ---------------------------------------------------------------
ALTER TABLE persons RENAME CONSTRAINT persons_status_check TO persons_status_chk;

-- ---- channel_identities -----------------------------------------------------
ALTER TABLE channel_identities RENAME CONSTRAINT channel_identities_platform_check TO channel_identities_platform_chk;

-- ---- auth_email_tokens -------------------------------------------------------
ALTER TABLE auth_email_tokens RENAME CONSTRAINT auth_email_tokens_purpose_check TO auth_email_tokens_purpose_chk;

-- ---- auth_email_deliveries (3) -----------------------------------------------
ALTER TABLE auth_email_deliveries RENAME CONSTRAINT auth_email_deliveries_kind_check TO auth_email_deliveries_kind_chk;
ALTER TABLE auth_email_deliveries RENAME CONSTRAINT auth_email_deliveries_command_operation_check TO auth_email_deliveries_operation_chk;
ALTER TABLE auth_email_deliveries RENAME CONSTRAINT auth_email_deliveries_outcome_check TO auth_email_deliveries_outcome_chk;

-- ---- tenants ------------------------------------------------------------------
ALTER TABLE tenants RENAME CONSTRAINT tenants_status_check TO tenants_status_chk;

-- ---- memberships ----------------------------------------------------------------
ALTER TABLE memberships RENAME CONSTRAINT memberships_status_check TO memberships_status_chk;

-- ---- sessions (6) — sessions_public_capacity_chk (0024) is NOT in this list,
-- it is already correctly named and must stay untouched. --------------------
ALTER TABLE sessions RENAME CONSTRAINT sessions_check TO sessions_time_chk;
ALTER TABLE sessions RENAME CONSTRAINT sessions_price_amount_check TO sessions_price_chk;
ALTER TABLE sessions RENAME CONSTRAINT sessions_slots_max_check TO sessions_slots_chk;
ALTER TABLE sessions RENAME CONSTRAINT sessions_visibility_check TO sessions_vis_chk;
ALTER TABLE sessions RENAME CONSTRAINT sessions_join_policy_check TO sessions_join_chk;
ALTER TABLE sessions RENAME CONSTRAINT sessions_status_check TO sessions_status_chk;

-- ---- telegram_links -------------------------------------------------------------
ALTER TABLE telegram_links RENAME CONSTRAINT telegram_links_kind_check TO telegram_links_kind_chk;

-- ---- tenant_admins --------------------------------------------------------------
ALTER TABLE tenant_admins RENAME CONSTRAINT tenant_admins_role_check TO tenant_admins_role_chk;

-- ---- bank_accounts [MONEY] — webhook_status is a SEPARATE, undeclared live
-- constraint (design-probe.md item (e)); not touched here. -------------------
ALTER TABLE bank_accounts RENAME CONSTRAINT bank_accounts_provider_check TO bank_accounts_provider_chk;

-- ---- charges (4) [MONEY] ---------------------------------------------------------
ALTER TABLE charges RENAME CONSTRAINT charges_amount_due_check TO charges_due_chk;
ALTER TABLE charges RENAME CONSTRAINT charges_amount_allocated_check TO charges_alloc_chk;
ALTER TABLE charges RENAME CONSTRAINT charges_check TO charges_alloc_le_due_chk;
ALTER TABLE charges RENAME CONSTRAINT charges_status_check TO charges_status_chk;

-- ---- bank_transactions (4) [MONEY] -----------------------------------------------
ALTER TABLE bank_transactions RENAME CONSTRAINT bank_transactions_amount_check TO bank_txn_amount_chk;
ALTER TABLE bank_transactions RENAME CONSTRAINT bank_transactions_unallocated_amount_check TO bank_txn_unalloc_chk;
ALTER TABLE bank_transactions RENAME CONSTRAINT bank_transactions_check TO bank_txn_unalloc_le_chk;
ALTER TABLE bank_transactions RENAME CONSTRAINT bank_transactions_reconcile_status_check TO bank_txn_reconcile_chk;

-- ---- payment_allocations (3) [MONEY] ---------------------------------------------
ALTER TABLE payment_allocations RENAME CONSTRAINT payment_allocations_amount_check TO alloc_amount_nonzero_chk;
ALTER TABLE payment_allocations RENAME CONSTRAINT payment_allocations_source_check TO alloc_source_chk;
ALTER TABLE payment_allocations RENAME CONSTRAINT payment_allocations_check TO alloc_shape_chk;

-- ---- provider_connections (2) — status is a SEPARATE, undeclared live
-- constraint (design-probe.md item (e)); not touched here. -------------------
ALTER TABLE provider_connections RENAME CONSTRAINT provider_connections_provider_check TO provider_connections_provider_chk;
ALTER TABLE provider_connections RENAME CONSTRAINT provider_connections_auth_mode_check TO provider_connections_auth_chk;

-- ---- projector_deliveries ------------------------------------------------------
ALTER TABLE projector_deliveries RENAME CONSTRAINT projector_deliveries_status_check TO projector_status_chk;

-- ---- join_requests --------------------------------------------------------------
ALTER TABLE join_requests RENAME CONSTRAINT join_requests_status_check TO join_requests_status_chk;

-- ---- plans ------------------------------------------------------------------------
ALTER TABLE plans RENAME CONSTRAINT plans_plan_key_check TO plans_key_chk;

-- ---- subscriptions (2) ------------------------------------------------------------
ALTER TABLE subscriptions RENAME CONSTRAINT subscriptions_selected_extra_channel_check TO subscriptions_extra_chk;
ALTER TABLE subscriptions RENAME CONSTRAINT subscriptions_status_check TO subscriptions_status_chk;

-- ---- subscription_invoices --------------------------------------------------------
ALTER TABLE subscription_invoices RENAME CONSTRAINT subscription_invoices_status_check TO subscription_invoices_status_chk;

-- ---- notification_intents ----------------------------------------------------------
ALTER TABLE notification_intents RENAME CONSTRAINT notification_intents_status_check TO notif_intents_status_chk;

-- ---- notification_deliveries -------------------------------------------------------
ALTER TABLE notification_deliveries RENAME CONSTRAINT notification_deliveries_status_check TO notif_deliveries_status_chk;

-- ---- onboarding_runs ------------------------------------------------------------------
ALTER TABLE onboarding_runs RENAME CONSTRAINT onboarding_runs_status_check TO onboarding_runs_status_chk;

-- ---- onboarding_steps -----------------------------------------------------------------
ALTER TABLE onboarding_steps RENAME CONSTRAINT onboarding_steps_status_check TO onboarding_steps_status_chk;
