-- ============================================================================
-- 0014_players_waitlist.sql
-- DD-45 waitlist model — EXPAND ONLY, code stays dark.
--
-- Contract: docs/dd-45-waitlist-analysis.md §2/§3 ·
--           docs/features/BE/feature_session_management_tech.md v2.11 (DDL +
--           rollout step 2: "Expand players with waitlist status/position
--           CHECK/index; keep code dark until backfill/verification passes").
--
-- What this migration does and does NOT do:
--   DOES  — open players.status to 'waitlisted', add waitlist_position, pin the
--           state-shape + positive-position invariants in the DB, and add the
--           queue-ordering index.
--   DOES NOT — write any promotion/join/leave logic. There is no SessionService,
--           no deriveChargeAmount (DD-39), no evaluateSessionEligibility
--           (DD-41), reliability restriction (DD-42), or shared
--           evaluateJoinRestriction (DD-52) in the codebase yet.
--           The DD-49 correction core is also absent. First-activation
--           promotion is a MONEY-WRITE (derive + exactly one charge); proven
--           DD-49 rejoin promotion revalidates the canonical aggregate, then
--           carries a non-refunded lifecycle or appends a refunded lifecycle
--           atomically with activation; it creates no second charge row.
--           0014 also has no waitlist_entry_version/root promotion-retry job
--           store: candidate-event binding, CAS leases, sweep worker and DLQ
--           belong to a later migration.
--           Neither path may be wired until those prerequisites exist.
--
-- Why the CHECKs live in the DB and not only in the service:
--   'waitlisted' rows must never occupy capacity or see the venue. A first-entry
--   waitlisted row creates no charge; a proven DD-49 rejoin-waitlisted row may
--   retain a non-refunded historical obligation/allocation. A refunded rejoin
--   creates no new obligation while waitlisted; append happens only atomically
--   with later activation. Those dispositions belong to the future service/core;
--   this migration only makes the state/position shape unambiguous. The single
--   fact the rest of the system keys off is
--   status = 'waitlisted' <=> waitlist_position IS NOT NULL. If a service bug
--   ever half-writes that pair (status flipped, position left behind, or vice
--   versa) a capacity query counting status='active' would silently disagree
--   with a queue query ordering by waitlist_position — an over-fill or a
--   permanently stuck candidate, both of which touch money. A DB CHECK makes
--   the half-written row unrepresentable rather than merely unlikely.
--
-- Constraint-name note: 0002 declared the status CHECK INLINE and UNNAMED, so
--   Postgres auto-named it `players_status_check` — NOT the `players_status_chk`
--   spelled in schema.ts's Drizzle builder (that name was never applied to a
--   live database). The replacement below is given the explicit name so
--   schema.ts and the live DB finally agree. The second DROP (…_chk) is pure
--   belt-and-braces: no database this repo can produce has that name, since
--   migrate.ts is the only thing that applies these files and 0002 is the sole
--   origin of the constraint.
--
-- Grants: 0009 grants are TABLE-level (GRANT ... ON players TO app), so the new
--   column is covered with no further grant. waitlist_position is a plain
--   integer, not a serial — no sequence object is created and therefore no
--   USAGE grant is needed (contrast 0013, which did add a bigserial). Asserted
--   from the app seat in waitlist-invariants.test.ts, NOT assumed: 0013's own
--   header records how an owner-only test masked exactly this class of gap.
--
-- RLS: players is already in 0009's tenant_isolation list with FORCE RLS. Adding
--   a column does not change the policy; no policy work here.
--
-- Locking — "EXPAND ONLY" here means additive-and-reversible, NOT online-safe:
--   migrate.ts runs each file in ONE transaction, so the validated ADD
--   CONSTRAINTs and the non-concurrent CREATE INDEX below hold ACCESS EXCLUSIVE
--   on players for the whole file. The online forms (ADD CONSTRAINT … NOT VALID
--   + VALIDATE, CREATE INDEX CONCURRENTLY) cannot be expressed in this runner
--   at all — both must escape the transaction. Acceptable now because players
--   is empty (the feature layer is unbuilt); a future slice against a populated
--   players table must split this across files rather than copy this pattern.
--
-- Out of scope, deliberately: the same-tenant composite candidate keys/FKs
--   ((tenant_id, session_id) → sessions, (tenant_id, membership_id) →
--   memberships) that feature_session_management_tech.md's DDL block requires
--   are a DD-68 prerequisite, not DD-45. Single-id FKs stay as 0002 left them.
-- ============================================================================

-- ---- 1. Open the status domain -------------------------------------------
ALTER TABLE players DROP CONSTRAINT IF EXISTS players_status_check;
ALTER TABLE players DROP CONSTRAINT IF EXISTS players_status_chk;
ALTER TABLE players ADD CONSTRAINT players_status_chk
  CHECK (status IN ('active', 'left', 'waitlisted'));

-- ---- 2. Queue rank --------------------------------------------------------
-- Nullable: only 'waitlisted' rows carry a rank.
--
-- NOT contiguous, by contract: DD-45 §3.2 assigns max(position)+1 under the
-- session lock and DD-42 deprioritize moves a candidate to the tail the same
-- way, so gaps are expected and renumbering is never required. The total order
-- is (waitlist_position, joined_at, id) precisely so gaps do not matter.
--
-- No uniqueness constraint — matching the documented DDL in
-- feature_session_management_tech.md verbatim. Normal max(position)+1 under a
-- session lock does not generate duplicates, but the current invariant suite
-- intentionally inserts an equal (position, joined_at) pair and verifies the
-- id tie-break. Duplicate ranks are therefore representable and test-pinned in
-- this schema version. Whether a future monotonic migration should add
--   UNIQUE (session_id, waitlist_position) WHERE status = 'waitlisted'
-- remains DD-45a for the promotion slice; that change must also replace the
-- permissive duplicate fixture/test rather than claiming current behavior is
-- unpinned.
ALTER TABLE players ADD COLUMN waitlist_position integer;

-- ---- 3. State-shape invariants -------------------------------------------
-- Equivalence, not implication: 'waitlisted' MUST have a position, and
-- 'active'/'left' MUST NOT keep a stale one. Promotion and leave both have to
-- clear the position in the same statement that changes the status.
ALTER TABLE players ADD CONSTRAINT players_waitlist_shape_chk
  CHECK ((status = 'waitlisted') = (waitlist_position IS NOT NULL));

-- Rank is a positive tail rank; 0 and negatives are not a valid queue position.
ALTER TABLE players ADD CONSTRAINT players_waitlist_position_positive_chk
  CHECK (waitlist_position IS NULL OR waitlist_position > 0);

-- ---- 4. Queue-ordering index ---------------------------------------------
-- Column order mirrors the promotion query verbatim:
--   WHERE session_id = $1 AND status = 'waitlisted'
--   ORDER BY waitlist_position, joined_at, id  FOR UPDATE
-- Left as a FULL index (not partial on status='waitlisted') to match the
-- documented DDL in feature_session_management_tech.md v2.11; status is the
-- second key column so the waitlisted slice is still a contiguous range scan.
CREATE INDEX idx_players_waitlist_order
  ON players(session_id, status, waitlist_position, joined_at, id);
