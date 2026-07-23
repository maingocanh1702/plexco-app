-- ============================================================================
-- 0019_tenant_integrity_fks.sql
-- DD-68 same-tenant tenant-integrity: composite candidate keys + composite FKs
-- on the money-path child rows. EXPAND ONLY, additive, code stays dark.
--
-- Contract: docs/features/BE/feature_session_management_tech.md §2 (the DDL
--   note that the implementing migration MUST add same-tenant composite
--   candidate keys/FKs for (tenant_id, session_id) → sessions and
--   (tenant_id, membership_id) → memberships, and force
--   session_surface_refs(tenant_id, session_id) to the same tenant — "CHƯA có
--   trong 0014 — đó là DD-68 scope, không phải DD-45") · HANDOFF HR1 (the DB is
--   the fail-closed choke-point) · manifest db-session-tenant-integrity-fks.json.
--
-- The gap this closes:
--   Every money-path child references its parent by a SINGLE-column FK only —
--   players.session_id → sessions.id, players.membership_id → memberships.id,
--   charges.session_id, charges.player_id, charges.membership_id,
--   join_requests.session_id, session_surface_refs.session_id,
--   aliases.membership_id (0002/0003/0006).
--   A single-column FK proves the parent EXISTS; it does NOT prove the parent
--   belongs to the SAME tenant as the child's own tenant_id. RLS filters reads,
--   so a service-layer bug writing players(tenant_id = A, session_id = <B's
--   session>) produces a row invisible to BOTH tenants while charges still
--   references it — silent cross-tenant corruption on the money path. The
--   composite FK (tenant_id, fk_id) → parent(tenant_id, id) makes that row
--   unrepresentable at the database, which is the whole point of HR1: the DB is
--   the fail-closed choke-point, not the service layer.
--
--   Why this works even under RLS: PostgreSQL referential-integrity checks run
--   as an internal system mechanism that is NOT subject to the querying role's
--   row-level security. So when the `app` role (NOBYPASSRLS) inserts a child
--   under tenant B's GUC, the composite FK still resolves the parent across all
--   tenants and rejects (tenant_id = B, id = <A's session>) because the real
--   parent row is tenant A. Enforcement holds on the runtime path, not just for
--   a superuser.
--
-- What this migration does and does NOT do:
--   DOES  — add UNIQUE (tenant_id, id) candidate keys on sessions, memberships,
--           AND players (a composite FK must target a unique constraint on the
--           referenced column set, in that column order), then add the eight
--           composite FKs listed below, keeping EVERY existing single-column FK.
--
--   charges.player_id note: charges references THREE tenant-scoped parents
--   (session, player, membership). Binding only session+membership would leave a
--   charge in tenant B able to point at a player owned by tenant A (session leg
--   B→B passes, membership leg unenforced when NULL), so charges.player_id is
--   bound too — players therefore needs its own (tenant_id, id) candidate key.
--   The deeper ledger references of the SAME class — payment_allocations →
--   charges / bank_transactions / payment_allocations, and bank_transactions →
--   bank_accounts — are NOT in this slice (their tables are otherwise untouched
--   here); they are a documented follow-up.
--   DOES NOT — drop any single-column FK. The composite key is ADDITIVE; the id
--           FK still governs ON DELETE / ON UPDATE (both default NO ACTION),
--           and dropping it would silently change delete behaviour. No new
--           table, no column added/dropped except the two candidate keys, no
--           RLS policy change, no grant change, no service/repo/adapter code.
--
-- session_occurrences is deliberately OUT: it has NO tenant_id column, so there
--   is nothing to bind; its dual-parent tenant integrity is already proven by
--   the existing rls-invariants "dual-parent child rows (session_occurrences)"
--   test. public_sessions is OUT (the cross-tenant public read model has no FK
--   into tenant tables by design, HR2). magic_links.session_id is OUT (despite
--   the name it references web_sessions).
--
-- MATCH SIMPLE for the one nullable child column (charges.membership_id): under
--   MATCH SIMPLE (the PostgreSQL default) a composite FK is NOT enforced when
--   ANY referencing column is NULL. tenant_id is always NOT NULL, so a charge
--   with membership_id = NULL leaves charges_tenant_membership_fk unenforced —
--   preserving today's "charge without a membership" shape — while the separate
--   charges_tenant_session_fk still binds the tenant. When membership_id IS set,
--   both columns are non-null and the tenant match is enforced. It is spelled
--   out explicitly on that one constraint; the other six reference all-NOT-NULL
--   columns where the MATCH mode is irrelevant.
--
-- VALIDATE → named halt (not a bare mid-migration error): the composite FKs are
--   added NOT VALID (enforced for NEW writes immediately, existing rows
--   unchecked), then each is VALIDATEd inside its own BEGIN/EXCEPTION
--   subtransaction. Detection runs through VALIDATE CONSTRAINT — NOT a SELECT
--   scan — on purpose: constraint validation is an internal integrity operation
--   that is NOT subject to RLS, so it sees rows across ALL tenants regardless of
--   whether the migration/DDL-owner role can bypass FORCE RLS. A plain SELECT
--   probe here would be RLS-filtered to zero rows under a non-superuser DDL owner
--   that never sets app.tenant_id (the least-privilege managed-Postgres path
--   exercised by migrate.test.ts BR-3), silently skipping a pre-existing
--   violation — codex round-02 [P2]. A caught foreign_key_violation is re-raised
--   as a NAMED halt naming the table, the relationship, and the offending
--   (tenant_id, fk) key from the FK error detail, so a stray cross-tenant row is
--   an owner-actionable halt, never a raw constraint-scan abort, and is never
--   auto-deleted or re-parented. On clean data (the money-path feature layer is
--   unbuilt, so these tables are empty today) every VALIDATE succeeds instantly.
--
-- Locking — "EXPAND ONLY" here is additive-and-reversible, NOT online-safe (see
--   0014's identical note): migrate.ts runs each file in ONE transaction, so
--   ADD CONSTRAINT … NOT VALID + VALIDATE both run under one lock rather than
--   the online two-transaction form, and the candidate-key index builds hold
--   ACCESS EXCLUSIVE on the parent. Acceptable now ONLY because every table
--   touched here is empty (the session/charge feature layer is unbuilt). A
--   future slice against a POPULATED table must split NOT VALID and VALIDATE
--   across separate migration files so VALIDATE can run without blocking
--   writers — do not copy this single-transaction shape onto live data.
--
-- Grants/RLS: 0009 grants are TABLE-level and RLS is already ENABLE+FORCE on all
--   affected tables; adding constraints changes neither, so there is no grant or
--   policy work here.
-- ============================================================================

-- ---- 1. Candidate keys on the parents -------------------------------------
-- A composite FK must reference a UNIQUE/PRIMARY KEY on exactly its referenced
-- column set. id is already the PK (unique on its own), so UNIQUE (tenant_id,
-- id) is a strict superset and is always satisfiable — it cannot reject any
-- existing row. Column order (tenant_id, id) matches the FK reference lists.
ALTER TABLE sessions
  ADD CONSTRAINT sessions_tenant_id_candidate_key UNIQUE (tenant_id, id);
ALTER TABLE memberships
  ADD CONSTRAINT memberships_tenant_id_candidate_key UNIQUE (tenant_id, id);
-- players is BOTH a child (bound to sessions/memberships below) and a parent
-- (charges.player_id → players); it needs its own candidate key.
ALTER TABLE players
  ADD CONSTRAINT players_tenant_id_candidate_key UNIQUE (tenant_id, id);

-- ---- 2. Composite FKs, added NOT VALID (single-column FKs kept intact) -----
-- Each ADD is additive: the pre-existing single-column *_fkey from 0002/0003/
-- 0006 stays and continues to govern ON DELETE (NO ACTION). These bind the
-- child's tenant_id to its parent's tenant_id.
ALTER TABLE session_surface_refs
  ADD CONSTRAINT session_surface_refs_tenant_session_fk
  FOREIGN KEY (tenant_id, session_id) REFERENCES sessions (tenant_id, id) NOT VALID;

ALTER TABLE players
  ADD CONSTRAINT players_tenant_session_fk
  FOREIGN KEY (tenant_id, session_id) REFERENCES sessions (tenant_id, id) NOT VALID;

ALTER TABLE players
  ADD CONSTRAINT players_tenant_membership_fk
  FOREIGN KEY (tenant_id, membership_id) REFERENCES memberships (tenant_id, id) NOT VALID;

ALTER TABLE charges
  ADD CONSTRAINT charges_tenant_session_fk
  FOREIGN KEY (tenant_id, session_id) REFERENCES sessions (tenant_id, id) NOT VALID;

-- charges.membership_id is NULLABLE — MATCH SIMPLE leaves the composite
-- unenforced when it is NULL (charge without a membership), enforced when set.
ALTER TABLE charges
  ADD CONSTRAINT charges_tenant_membership_fk
  FOREIGN KEY (tenant_id, membership_id) REFERENCES memberships (tenant_id, id)
  MATCH SIMPLE NOT VALID;

-- charges.player_id (NOT NULL) — the money row must reference a player in its
-- own tenant, else a B-tenant charge with a NULL membership could point at an
-- A-tenant player (codex round-01 [P1]).
ALTER TABLE charges
  ADD CONSTRAINT charges_tenant_player_fk
  FOREIGN KEY (tenant_id, player_id) REFERENCES players (tenant_id, id) NOT VALID;

ALTER TABLE join_requests
  ADD CONSTRAINT join_requests_tenant_session_fk
  FOREIGN KEY (tenant_id, session_id) REFERENCES sessions (tenant_id, id) NOT VALID;

ALTER TABLE aliases
  ADD CONSTRAINT aliases_tenant_membership_fk
  FOREIGN KEY (tenant_id, membership_id) REFERENCES memberships (tenant_id, id) NOT VALID;

-- ---- 3. VALIDATE each composite FK, converting a violation to a NAMED halt --
-- Detection is via VALIDATE CONSTRAINT (RLS-independent), NOT a SELECT scan (see
-- the header note / codex round-02 [P2]). Each VALIDATE runs in its own
-- BEGIN/EXCEPTION subtransaction; a foreign_key_violation is caught and
-- re-raised naming the child table, the relationship, and the offending
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
      ('session_surface_refs', 'session_surface_refs_tenant_session_fk', '(tenant_id, session_id) -> sessions'),
      ('players',              'players_tenant_session_fk',              '(tenant_id, session_id) -> sessions'),
      ('players',              'players_tenant_membership_fk',           '(tenant_id, membership_id) -> memberships'),
      ('charges',              'charges_tenant_session_fk',              '(tenant_id, session_id) -> sessions'),
      ('charges',              'charges_tenant_membership_fk',           '(tenant_id, membership_id) -> memberships'),
      ('charges',              'charges_tenant_player_fk',               '(tenant_id, player_id) -> players'),
      ('join_requests',        'join_requests_tenant_session_fk',        '(tenant_id, session_id) -> sessions'),
      ('aliases',              'aliases_tenant_membership_fk',           '(tenant_id, membership_id) -> memberships')
    ) AS t(child_table, constraint_name, rel)
  LOOP
    BEGIN
      EXECUTE format('ALTER TABLE %I VALIDATE CONSTRAINT %I', r.child_table, r.constraint_name);
    EXCEPTION WHEN foreign_key_violation THEN
      GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
      RAISE EXCEPTION 'tenant-integrity halt (0019): table % has a cross-tenant row on % — %  Owner must resolve this row before 0019 can apply (this migration never deletes or re-parents a money-path row).',
        r.child_table, r.rel, COALESCE(NULLIF(v_detail, ''), '(offending key unavailable)')
        USING ERRCODE = 'raise_exception';
    END;
  END LOOP;
END $$;
