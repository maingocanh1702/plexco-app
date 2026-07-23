-- ============================================================================
-- 0020_ledger_tenant_integrity_fks.sql
-- DD-68 same-tenant tenant-integrity, payment-ledger leg: composite candidate
-- keys + composite FKs on the ledger child rows. EXPAND ONLY, additive, code
-- stays dark. Sibling of 0019 (session domain) — this is exactly the follow-up
-- 0019's header documents ("payment_allocations → charges / bank_transactions /
-- payment_allocations, and bank_transactions → bank_accounts").
--
-- Contract: manifest docs/autopilot-manifests/db-ledger-tenant-integrity-fks.json
--   · 0019_tenant_integrity_fks.sql (mechanism + full RLS-independence argument,
--   DD-68) · HANDOFF HR1 (the DB is the fail-closed choke-point).
--
-- The gap this closes (same class as 0019, one level deeper in the ledger):
--   every ledger child references its parent by a SINGLE-column FK only —
--     bank_transactions.bank_account_id        → bank_accounts.id        (0003)
--     payment_allocations.charge_id            → charges.id              (0003)
--     payment_allocations.bank_transaction_id  → bank_transactions.id    (0003)
--     payment_allocations.reverses_allocation_id → payment_allocations.id (0003)
--     bank_accounts.provider_connection_id     → provider_connections.id (0004)
--   A single-column FK proves the parent EXISTS; it does NOT prove the parent
--   belongs to the SAME tenant as the child's own tenant_id. RLS filters
--   reads, so a service-layer bug can write a ledger row pointing at another
--   tenant's parent — silent cross-tenant money corruption: an allocation
--   "paying" another club's charge, a transaction attributed to another
--   club's bank account, a reversal reversing another club's allocation, a
--   bank account attached to another club's provider connection. The
--   composite FK (tenant_id, fk) → parent(tenant_id, id) makes such rows
--   unrepresentable at the database. PostgreSQL referential-integrity checks
--   run as an internal system mechanism NOT subject to the querying role's
--   RLS, so enforcement holds on the app-role (NOBYPASSRLS) runtime path —
--   see 0019's header for the full argument.
--
-- FK inventory — derived by an EXHAUSTIVE scan of schema.ts plus migrations
--   0003/0004 (the 0019 round-01 lesson: a hand-listed inventory missed
--   charges → players; the scan here surfaced #4's existing FK and #5 beyond
--   the manifest's known clear set):
--     1. bank_transactions (tenant_id, bank_account_id) → bank_accounts
--        — both columns NOT NULL, always enforced.
--     2. payment_allocations (tenant_id, charge_id) → charges — NOT NULL.
--     3. payment_allocations (tenant_id, bank_transaction_id)
--        → bank_transactions — NULLABLE (cash/waiver allocations carry no
--        bank transaction) → MATCH SIMPLE spelled out.
--     4. payment_allocations (tenant_id, reverses_allocation_id)
--        → payment_allocations — NULLABLE (only reversal rows set it) →
--        MATCH SIMPLE; self-referencing. NOT net-new integrity: 0003 already
--        carries the single-column FK (schema.ts had drifted and did not
--        mirror it; the mirror is fixed in this slice).
--     5. bank_accounts (tenant_id, provider_connection_id)
--        → provider_connections — NULLABLE (set during connector onboarding;
--        single-column FK added in 0004) → MATCH SIMPLE. Surfaced by the
--        exhaustive scan: a tenant-A bank account must not attach to
--        tenant-B's provider connection (webhook registration / credential
--        context on the money path).
--
-- What this migration does and does NOT do:
--   DOES  — add UNIQUE (tenant_id, id) candidate keys on bank_accounts,
--           bank_transactions, charges, payment_allocations, and
--           provider_connections (a composite FK must target a unique
--           constraint on exactly its referenced column set; id is already
--           the PK, so each is a strict-superset uniqueness — additive, it
--           cannot reject any existing row), then add the five composite FKs
--           above NOT VALID and VALIDATE each under a named-halt wrapper.
--   DOES NOT — drop any single-column FK (each stays and still governs
--           ON DELETE / ON UPDATE, both default NO ACTION). No new table, no
--           column added or dropped, no RLS policy change (RLS is already
--           ENABLE+FORCE on all six tables involved and 0009's grants are
--           table-level — constraints change neither), no grant change, no
--           service/repo/adapter code (the ledger feature layer is unbuilt —
--           code dark).
--
-- Deliberately OUT (scanned and excluded):
--   * bank_accounts.pending_change_by and payment_allocations.created_by are
--     actor uuids with no FK by design (audit-actor references, global-person
--     semantics) — the same treatment 0019 gave join_requests.decided_by.
--   * The BILLING domain has NO same-shape gap: billing_transactions is
--     platform-global (no tenant_id — Plexco's own revenue ledger, BL-BIL-1)
--     and billing_allocations carries no tenant_id column, so there is no
--     child tenant_id to bind; allocating a platform transaction to a
--     tenant's subscription_invoices row is cross-tenant BY DESIGN.
--     subscription_invoices is referenced only by that non-tenant child.
--     Flagged for the record; no action.
--   * tenant_id → tenants on each table is the anchor being bound, not a
--     bindable relationship.
--
-- MATCH SIMPLE on the nullable children (#3/#4/#5): under MATCH SIMPLE (the
--   PostgreSQL default) a composite FK is NOT enforced when ANY referencing
--   column is NULL. tenant_id is always NOT NULL, so a NULL fk column leaves
--   exactly that composite unenforced — preserving today's row shapes (a
--   cash/waiver allocation without a bank transaction; a non-reversal
--   allocation; a bank account before connector onboarding) — and enforced
--   the moment the column is set. It is spelled out explicitly on those three
--   constraints; #1/#2 reference all-NOT-NULL columns where the MATCH mode is
--   irrelevant.
--
-- VALIDATE → named halt (not a bare mid-migration error): identical mechanism
--   to 0019 — detection runs through VALIDATE CONSTRAINT (an internal
--   integrity operation that is NOT RLS-filtered, unlike a SELECT probe under
--   a least-privilege DDL owner; see 0019's header / its codex round-02
--   [P2]). Each VALIDATE runs in its own BEGIN/EXCEPTION subtransaction; a
--   caught foreign_key_violation is re-raised as a NAMED halt naming the
--   child table, the relationship, and the offending (tenant_id, fk) key from
--   the FK error detail — an owner-actionable halt, never an auto delete or
--   re-parent. On clean data every VALIDATE succeeds instantly.
--
-- Locking — identical caveat to 0019/0014: "EXPAND ONLY" here is additive-
--   and-reversible, NOT online-safe. migrate.ts applies this file in ONE
--   transaction, so ADD CONSTRAINT … NOT VALID + VALIDATE run under one lock
--   and the candidate-key index builds hold ACCESS EXCLUSIVE on the parents.
--   Acceptable now ONLY because every table touched here is empty (the ledger
--   feature layer is unbuilt). A future slice against POPULATED tables must
--   split NOT VALID and VALIDATE across separate migration files so VALIDATE
--   can run without blocking writers — do not copy this single-transaction
--   shape onto live data.
-- ============================================================================

-- ---- 1. Candidate keys on the parents -------------------------------------
-- A composite FK must reference a UNIQUE/PRIMARY KEY on exactly its referenced
-- column set. id is already the PK (unique on its own), so UNIQUE (tenant_id,
-- id) is a strict superset and is always satisfiable — it cannot reject any
-- existing row. Column order (tenant_id, id) matches the FK reference lists.
ALTER TABLE bank_accounts
  ADD CONSTRAINT bank_accounts_tenant_id_candidate_key UNIQUE (tenant_id, id);
ALTER TABLE bank_transactions
  ADD CONSTRAINT bank_transactions_tenant_id_candidate_key UNIQUE (tenant_id, id);
ALTER TABLE charges
  ADD CONSTRAINT charges_tenant_id_candidate_key UNIQUE (tenant_id, id);
-- payment_allocations is BOTH a child (three FKs below) and a parent (the
-- reversal self-reference); it needs its own candidate key.
ALTER TABLE payment_allocations
  ADD CONSTRAINT payment_allocations_tenant_id_candidate_key UNIQUE (tenant_id, id);
ALTER TABLE provider_connections
  ADD CONSTRAINT provider_connections_tenant_id_candidate_key UNIQUE (tenant_id, id);

-- ---- 2. Composite FKs, added NOT VALID (single-column FKs kept intact) -----
-- Each ADD is additive: the pre-existing single-column FK from 0003/0004 stays
-- and continues to govern ON DELETE (NO ACTION). These bind the child's
-- tenant_id to its parent's tenant_id.
ALTER TABLE bank_transactions
  ADD CONSTRAINT bank_transactions_tenant_bank_account_fk
  FOREIGN KEY (tenant_id, bank_account_id) REFERENCES bank_accounts (tenant_id, id) NOT VALID;

ALTER TABLE payment_allocations
  ADD CONSTRAINT payment_allocations_tenant_charge_fk
  FOREIGN KEY (tenant_id, charge_id) REFERENCES charges (tenant_id, id) NOT VALID;

-- bank_transaction_id is NULLABLE (cash/waiver allocations) — MATCH SIMPLE
-- leaves the composite unenforced while it is NULL, enforced when set.
ALTER TABLE payment_allocations
  ADD CONSTRAINT payment_allocations_tenant_bank_transaction_fk
  FOREIGN KEY (tenant_id, bank_transaction_id) REFERENCES bank_transactions (tenant_id, id)
  MATCH SIMPLE NOT VALID;

-- reverses_allocation_id is NULLABLE (set only on reversal rows) — MATCH
-- SIMPLE; self-referencing: a reversal must reverse an allocation of the SAME
-- tenant. The 0003 single-column self-FK stays and still governs ON DELETE.
ALTER TABLE payment_allocations
  ADD CONSTRAINT payment_allocations_tenant_reverses_allocation_fk
  FOREIGN KEY (tenant_id, reverses_allocation_id) REFERENCES payment_allocations (tenant_id, id)
  MATCH SIMPLE NOT VALID;

-- provider_connection_id is NULLABLE (set during connector onboarding) —
-- MATCH SIMPLE; binds a bank account to a provider connection of its OWN tenant.
ALTER TABLE bank_accounts
  ADD CONSTRAINT bank_accounts_tenant_provider_connection_fk
  FOREIGN KEY (tenant_id, provider_connection_id) REFERENCES provider_connections (tenant_id, id)
  MATCH SIMPLE NOT VALID;

-- ---- 3. VALIDATE each composite FK, converting a violation to a NAMED halt --
-- Detection is via VALIDATE CONSTRAINT (RLS-independent), NOT a SELECT scan
-- (see the header note / 0019's codex round-02 [P2]). Each VALIDATE runs in
-- its own BEGIN/EXCEPTION subtransaction; a foreign_key_violation is caught
-- and re-raised naming the child table, the relationship, and the offending
-- (tenant_id, fk) key from the FK error detail. A clean table validates
-- instantly; the first offender aborts the whole migration in one piece
-- (migrate.ts wraps each file in a single transaction). No auto delete/re-parent.
DO $$
DECLARE
  r record;
  v_detail text;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('bank_transactions',   'bank_transactions_tenant_bank_account_fk',          '(tenant_id, bank_account_id) -> bank_accounts'),
      ('payment_allocations', 'payment_allocations_tenant_charge_fk',              '(tenant_id, charge_id) -> charges'),
      ('payment_allocations', 'payment_allocations_tenant_bank_transaction_fk',    '(tenant_id, bank_transaction_id) -> bank_transactions'),
      ('payment_allocations', 'payment_allocations_tenant_reverses_allocation_fk', '(tenant_id, reverses_allocation_id) -> payment_allocations'),
      ('bank_accounts',       'bank_accounts_tenant_provider_connection_fk',       '(tenant_id, provider_connection_id) -> provider_connections')
    ) AS t(child_table, constraint_name, rel)
  LOOP
    BEGIN
      EXECUTE format('ALTER TABLE %I VALIDATE CONSTRAINT %I', r.child_table, r.constraint_name);
    EXCEPTION WHEN foreign_key_violation THEN
      GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
      RAISE EXCEPTION 'tenant-integrity halt (0020): table % has a cross-tenant row on % — %  Owner must resolve this row before 0020 can apply (this migration never deletes or re-parents a money-path row).',
        r.child_table, r.rel, COALESCE(NULLIF(v_detail, ''), '(offending key unavailable)')
        USING ERRCODE = 'raise_exception';
    END;
  END LOOP;
END $$;
