-- ============================================================================
-- 0050_payment_allocation_attested_transfer.sql
-- Web MVP lane M2c: the DD-40 "dedicated allocation source added by migration" for a
-- host-ATTESTED bank transfer that has NO ingested bank_transaction.
--
-- DD-40 / BRD FR-5.1 forbid mapping such a payment to 'cash' or 'manual' (manual REQUIRES a
-- bank_transaction) and forbid fabricating a synthetic bank_transaction. The honest shape is a
-- new source whose provenance is the host themself:
--   attested_transfer: amount > 0, bank_transaction_id IS NULL, created_by (the host) NOT NULL.
-- reason_code carries the host's bounded note. Corrections stay reversal rows (append-only).
--
-- Forward-only, drop + re-add the two NAMED CHECKs (0025 names). Existing rows already satisfy the
-- widened predicates (each new arm is a superset), so re-validation cannot fail.
-- ============================================================================

ALTER TABLE payment_allocations DROP CONSTRAINT alloc_source_chk;
ALTER TABLE payment_allocations ADD CONSTRAINT alloc_source_chk
  CHECK (source IN ('auto','manual','cash','waiver','reversal','attested_transfer'));

ALTER TABLE payment_allocations DROP CONSTRAINT alloc_shape_chk;
ALTER TABLE payment_allocations ADD CONSTRAINT alloc_shape_chk CHECK (
  (source IN ('auto','manual') AND amount > 0 AND bank_transaction_id IS NOT NULL)
  OR (source IN ('cash','waiver') AND amount > 0 AND bank_transaction_id IS NULL AND created_by IS NOT NULL)
  OR (source = 'attested_transfer' AND amount > 0 AND bank_transaction_id IS NULL AND created_by IS NOT NULL)
  OR (source = 'reversal' AND amount < 0 AND reverses_allocation_id IS NOT NULL)
);
