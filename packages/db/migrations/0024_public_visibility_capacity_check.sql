-- ============================================================================
-- 0024_public_visibility_capacity_check.sql
-- Capacity x visibility: a public session may not have unlimited slots.
-- EXPAND ONLY, additive, code stays dark (no runtime change in this slice).
--
-- Contract: docs/features/BE/feature_session_management_tech.md:120 (PRD E#7
--   - "visibility='public' requires slots_max IS NOT NULL; a DB-level CHECK
--   is a hardening candidate via a new monotonic migration, once decided" -
--   paraphrased from the Vietnamese original) · :386/:396 (SessionService
--   choke-point that fail-closes on this same state today, still spec-only -
--   see below) · manifest db-public-visibility-capacity-check.json.
--
-- The gap this closes:
--   sessions.slots_max stays nullable (unlimited is a valid, intentional
--   state for non-public sessions). visibility='public' with slots_max IS
--   NULL is an INVALID state today - nothing at the database rejects it. It
--   is enforced only at the SessionService validation choke-point, which is
--   spec-only as of this migration (grepped apps/, packages/: no
--   SessionService class, evaluateJoinRestriction or
--   evaluateSessionEligibility exist in code yet), so a fixture, a legacy
--   row, a direct SQL write, or any future writer that bypasses the service
--   layer can produce this state and nothing rejects it.
--
--   Why this matters beyond tidiness (Verdict 20, ENABLEMENT_ONLY gate on the
--   future public-projection projector): the invalid state is invisible to
--   event-driven repair. feature_marketplace_discovery_tech.md edge #15
--   skips an invalid row and purges its projection, but only when the
--   projector EVALUATES the session. A bypassing writer flipping an
--   already-projected public session's slots_max from finite to NULL emits
--   no session event, so the projector never revisits it and a
--   stale-but-now-invalid projection stays publicly visible. This migration
--   closes the DB-writable half of that gap: it makes the state
--   unrepresentable going forward, it does not detect or purge a projection
--   already written before this migration applies (see the design-probe doc
--   item (d) for what survives).
--
-- What this migration does and does NOT do:
--   DOES     - add ONE CHECK constraint to sessions:
--              NOT (visibility='public' AND slots_max IS NULL), alongside the
--              existing sessions_vis_chk / sessions_slots_chk constraints,
--              following their naming.
--   DOES NOT - narrow slots_max (stays nullable; unlimited remains valid for
--              non-public). DOES NOT weaken or replace sessions_vis_chk or
--              sessions_slots_chk. DOES NOT touch public_sessions, RLS,
--              roles or grants. DOES NOT delete or re-parent any row - see
--              the VALIDATE halt behaviour below; a violating row blocks
--              this migration entirely rather than being silently fixed or
--              dropped.
--
-- Design-probe item (a) - existing violating rows (the reflex trap): ADD
--   CONSTRAINT ... NOT VALID followed immediately by VALIDATE CONSTRAINT
--   reads as the standard safe expand-only idiom. It is not, unconditionally:
--   NOT VALID skips existing rows; VALIDATE then scans them and FAILS if any
--   violate - the same failure mode as adding the constraint outright, while
--   looking more careful. Measured before choosing this shape (see
--   .autopilot/state/db-public-visibility-capacity-check/design-probe.md):
--   zero violating rows in every environment reachable from the authoring
--   machine, AND - the argument this migration actually rests on - no write
--   path capable of producing one exists in code yet (SessionService and the
--   public projector are both still stubs/spec). The shape below is safe
--   because of the second fact, not merely because a count happened to read
--   zero. PVC-6 (packages/db/src/rls-invariants.test.ts) seeds exactly one
--   violating row in a throwaway pre-0024 database and proves this
--   migration's VALIDATE halt actually fires, so the failure mode is
--   exercised, not merely assumed safe because the table happened to be
--   empty.
--
-- VALIDATE -> named halt (not a bare mid-migration error): mirrors
--   0019_tenant_integrity_fks.sql's pattern (its own header explains why:
--   VALIDATE CONSTRAINT is an internal integrity operation NOT subject to
--   RLS, so it sees every row regardless of the migration/DDL-owner role's
--   RLS exposure - a plain SELECT probe would not). Unlike an FK violation, a
--   CHECK constraint's VALIDATE failure carries no row-identifying detail -
--   confirmed empirically against this repo's own Postgres (16-alpine):
--   check_violation's PG_EXCEPTION_DETAIL is empty for a CHECK, where an FK's
--   is not. So this halt cannot name the offending row the way 0019 names an
--   offending key; instead it names the migration and constraint and hands
--   the owner a copy-pasteable query to find the row(s) themselves. On clean
--   data (measured zero above) VALIDATE succeeds instantly.
--
--   That copy-pasteable query is itself an RLS trap (codex round-01 [P1]):
--   sessions carries FORCE ROW LEVEL SECURITY (0009), so running a plain
--   SELECT under this migration's own owner role (or any other non-
--   BYPASSRLS connection with no app.tenant_id set) returns ZERO rows even
--   though VALIDATE just found a violation - the same false-zero shape the
--   design-probe doc flags for the measurement that justified this
--   migration's shape in the first place. The halt message says so
--   explicitly and tells the owner to requery as a role that bypasses RLS.
--
-- Locking - same acceptable-now caveat 0019 states for itself: ADD
--   CONSTRAINT ... NOT VALID takes ACCESS EXCLUSIVE on sessions but is
--   instant (no scan). VALIDATE CONSTRAINT takes the weaker SHARE UPDATE
--   EXCLUSIVE but does scan the table; migrate.ts runs this file in one
--   transaction, so both run under one lock rather than the online
--   two-transaction form. Acceptable now ONLY because sessions carries 0
--   rows in every reachable environment (the feature layer is unbuilt) -
--   verified, not assumed. A FUTURE application of this shape against a
--   POPULATED sessions table must split NOT VALID and VALIDATE across
--   separate migration files so VALIDATE does not hold a scan under the same
--   transaction as the ACCESS EXCLUSIVE add - do not copy this
--   single-transaction shape onto live data (0019's own forward caveat,
--   restated here because it applies to this file too).
--
-- The SessionService choke-point (feature_session_management_tech.md:386,
--   :396) is not removed or superseded by this migration and stays defense
--   in depth once built: any environment that has not yet applied this
--   migration has only that check. This migration does not purge a
--   pre-existing stale projection in public_sessions - see the design-probe
--   doc item (d); that remains job-infra-public-projection-reconciliation's
--   open territory (candidates (a)/(b)), not resolved here.
--
-- Grants/RLS: 0009 grants are TABLE-level and RLS is already ENABLE+FORCE on
--   sessions; this migration changes neither.
-- ============================================================================

ALTER TABLE sessions
  ADD CONSTRAINT sessions_public_capacity_chk
  CHECK (NOT (visibility = 'public' AND slots_max IS NULL)) NOT VALID;

DO $$
BEGIN
  BEGIN
    ALTER TABLE sessions VALIDATE CONSTRAINT sessions_public_capacity_chk;
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION 'capacity-visibility halt (0024): sessions has at least one row with visibility=''public'' AND slots_max IS NULL. A CHECK VALIDATE failure carries no row-identifying detail from Postgres (unlike an FK violation) — run this AS A ROLE THAT BYPASSES RLS (e.g. the cluster superuser/admin connection, NOT necessarily this migration''s own owner role): sessions has FORCE ROW LEVEL SECURITY (0009), so running this query over a plain non-bypassing connection with no app.tenant_id set returns ZERO rows even though VALIDATE just found one — that empty result is not proof the row is gone: SELECT id, tenant_id, visibility, slots_max FROM sessions WHERE visibility=''public'' AND slots_max IS NULL;  Owner must resolve every such row (set a finite slots_max, or make it non-public) before 0024 can apply — this migration never mutates or deletes a session row.'
      USING ERRCODE = 'raise_exception';
  END;
END $$;
