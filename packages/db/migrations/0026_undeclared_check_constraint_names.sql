-- ============================================================================
-- 0026_undeclared_check_constraint_names.sql
-- Rename 6 auto-generated CHECK constraint names to the names schema.ts now
-- declares, across 6 tables. Pure identity rename — zero predicate change.
--
-- Contract: docs/autopilot-manifests/db-undeclared-check-constraints-schema-mirror.json ·
--   .autopilot/state/db-undeclared-check-constraints-schema-mirror/design-probe.md.
--
-- Opposite direction from 0025: 0025 renamed live constraints to match names
-- schema.ts ALREADY declared. This migration is for the six constraints 0025
-- explicitly excluded because schema.ts had no declared name to rename them
-- to at the time (0025:33-40) — schema.ts now declares one for each, in the
-- same commit that adds this file. All six were applied inline and unnamed by
-- 0001/0003/0004 and enforce correctly today under their auto-generated name;
-- this is a naming-identity fix, not a behavior fix.
--
-- What this migration does and does NOT do:
--   DOES     — for each of the 6 pairs below:
--              ALTER TABLE <t> RENAME CONSTRAINT <auto_name> TO <declared_name>.
--   DOES NOT — change any predicate, column, nullability, default, type, RLS
--              policy, role, or grant. Does not touch the 40 constraints 0025
--              already renamed or the 27 that were already correctly named.
--              Four of the six share one 6-value enum
--              (connecting|registered|active|drift|error|revoked); the other
--              two do NOT — channel_identities_status is (active|inactive)
--              and oauth_transactions_provider is the single literal 'sepay'
--              — this migration only renames, so no predicate is transcribed
--              here at all, but the schema.ts declarations added alongside it
--              must not treat all six as the same enum (design-probe.md pin 2).
--
-- RENAME, not DROP+ADD (same precedent as 0025's codex round-01 [P1]): ADD
-- CONSTRAINT re-validates the predicate against every existing row while
-- holding ACCESS EXCLUSIVE, and forces hand-transcription of the predicate.
-- RENAME CONSTRAINT is a pure catalog metadata update — no table scan, no
-- re-validation, and no predicate clause to transcribe, so no hand-
-- transcription error is possible. `RENAME CONSTRAINT` has no `IF EXISTS`
-- form — this is a monotonic migration applied exactly once per database
-- (migrate.ts records applied files by hash and skips re-application), so a
-- name below that turns out not to match live reality fails the migration
-- loudly instead of silently doing nothing.
--
-- Money-path: none of the six sit on a money table (charges, bank_transactions,
-- payment_allocations). bank_accounts.webhook_status is on a money-adjacent
-- table but is not itself a money column. migrate.ts runs this whole file in
-- ONE transaction (BEGIN before the first statement, COMMIT after the last,
-- ROLLBACK on any error), so there is no window where any of the six tables
-- is unconstrained even momentarily.
-- ============================================================================

-- ---- bank_accounts [money-adjacent] -----------------------------------------
ALTER TABLE bank_accounts RENAME CONSTRAINT bank_accounts_webhook_status_check TO bank_accounts_webhook_status_chk;

-- ---- channel_identities — 2-value predicate (active|inactive), NOT the
-- 6-value enum most of the others below share. --------------------------------
ALTER TABLE channel_identities RENAME CONSTRAINT channel_identities_status_check TO channel_identities_status_chk;

-- ---- messenger_pages ---------------------------------------------------------
ALTER TABLE messenger_pages RENAME CONSTRAINT messenger_pages_status_check TO messenger_pages_status_chk;

-- ---- oauth_transactions — legacy Sepay-only channel-bootstrap table, DISTINCT
-- from auth_oauth_transactions (the Google/Facebook login table, already fully
-- declared). Single-literal predicate ('sepay'), NOT the 6-value enum. --------
ALTER TABLE oauth_transactions RENAME CONSTRAINT oauth_transactions_provider_check TO oauth_transactions_provider_chk;

-- ---- provider_connections — status column; provider_connections_provider_chk
-- and provider_connections_auth_chk (both already declared, renamed by 0025)
-- are DIFFERENT columns on this same table. -----------------------------------
ALTER TABLE provider_connections RENAME CONSTRAINT provider_connections_status_check TO provider_connections_status_chk;

-- ---- zalo_bots ----------------------------------------------------------------
ALTER TABLE zalo_bots RENAME CONSTRAINT zalo_bots_status_check TO zalo_bots_status_chk;
