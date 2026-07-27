-- ============================================================================
-- 0023_outbox_ack_marker.sql
-- Completion/ack marker for outbox_events — closes the HARD BLOCKING
-- REQUIREMENT 0022:166-181 flagged by name for job-runtime-dispatcher (slice
-- 2/4): the five-minute lease is crash-recovery only, so a successfully
-- processed event had no way to stop being reclaimed forever, starving newer
-- events (reclaim runs before claiming new rows; ORDER BY created_at prefers
-- the oldest). Source: docs/autopilot-manifests/db-outbox-ack-marker.json,
-- .autopilot/state/db-outbox-ack-marker/design-probe.md (founder-directed
-- design, two confirmation rounds).
--
-- Design (full reasoning in design-probe.md):
--   (a) acked_at timestamptz marker, not a terminal state — purely additive,
--       does not change the meaning of the existing two-state CHECK.
--   (b) ack_outbox_event is decoupled from any projector-fan-out POLICY, but
--       made STRUCTURAL per founder direction rather than relying on a
--       migration comment alone (0022:166-181 already tried comment-only for
--       the ack requirement itself, and it was missed by a reader who read
--       the function signature but not the comment). The caller must supply
--       the exact set of projectors it asserts are required, and this
--       function verifies every one of them actually has a
--       projector_deliveries row before it will ack — RAISE if any is
--       missing. This does not verify the SET itself is the correct one for
--       the event's type (that stays the caller's responsibility — a
--       registry of required-projectors-per-event-type does not exist yet
--       and is not built here); it converts "caller forgot to check fan-out
--       completeness at all" into "caller must state a set and prove it."
--   (c) claim_outbox_batch's reclaim AND claim passes both gain an
--       `acked_at IS NULL` filter; idx_outbox_expired_lease narrows to match
--       so acked rows stop accumulating in it. idx_outbox_unclaimed needs no
--       change — an acked row's claimed_at is never NULL.
--   (d) both existing CHECKs extend (never replace, never weaken) to cover
--       the new columns; a new ack-shape CHECK is added.
--   (e) FOUNDER-DIRECTED (round 1 Q2): outbox_events gains claim_token uuid,
--       mirroring projector_deliveries's already-settled token-guarded-
--       completion shape (chosen over a lease-expiry-only guard because it
--       interacts with (b): a zombie worker's stale ack could otherwise mark
--       an event done before every required projector actually has a
--       delivery row — a correctness loss, not a harmless idempotent no-op).
--       claim_outbox_batch's RETURNS TABLE grows a claim_token column.
--       ack_outbox_event requires an exact token match PLUS a live
--       lease_expires_at — mirrors complete_projector_delivery's double
--       guard exactly (0022 round-07): the token proves this caller was not
--       superseded by a reclaim-and-reclaim cycle (identity comparison, no
--       race window); the live lease proves the caller is still within its
--       granted window even if nobody has actually run the reclaim scan yet.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Step 1: extend outbox_events shape. acked_at is the completion marker;
-- claim_token is the exact-match guard ack_outbox_event requires so a stale
-- (already-superseded) claimant cannot ack over the current one.
-- ---------------------------------------------------------------------------
ALTER TABLE outbox_events ADD COLUMN acked_at timestamptz;
ALTER TABLE outbox_events ADD COLUMN claim_token uuid;

-- Backfill any pre-existing claim with a synthetic token — mirrors 0022's own
-- lease_expires_at backfill (0022 round-01) exactly, same reasoning: a row
-- claimed before this migration ran has claimed_at NOT NULL but no
-- claim_token, which would fail the new triple-shape CHECK below on ADD
-- CONSTRAINT (validated synchronously against current data). The backfilled
-- token grants no real ack eligibility beyond satisfying the shape invariant
-- — these legacy claims are almost certainly already past their five-minute
-- lease, so the very next claim_outbox_batch call reclaims them (resetting
-- claimed_at/lease_expires_at/claim_token to NULL) through the same
-- crash-recovery path five-minute leases already use. SET ROLE job_definer:
-- outbox_events has FORCE RLS and no tenant GUC is set here (0022 Step 1
-- already asserted job_definer's attributes and this migration role's
-- membership, a hard dependency of this migration).
SET ROLE job_definer;
UPDATE outbox_events
SET claim_token = gen_random_uuid()
WHERE claimed_at IS NOT NULL AND claim_token IS NULL;
RESET ROLE;

-- Extends the existing pair (0022:114-118) to a strict triple: claimed_at,
-- lease_expires_at and claim_token are always all-null (available) or all
-- non-null (leased) together — never partially set. Kept separate from
-- acked_at on purpose: acked is a one-directional implication off this
-- triple (see outbox_events_ack_shape_chk below), not a fourth member of an
-- all-or-nothing group — a row stays "leased"-shaped forever once acked,
-- since ack never clears claimed_at/lease_expires_at/claim_token.
ALTER TABLE outbox_events DROP CONSTRAINT outbox_events_lease_shape_chk;
ALTER TABLE outbox_events ADD CONSTRAINT outbox_events_lease_shape_chk
  CHECK (
    (claimed_at IS NULL AND lease_expires_at IS NULL AND claim_token IS NULL)
    OR (claimed_at IS NOT NULL AND lease_expires_at IS NOT NULL AND claim_token IS NOT NULL)
  );

-- Acked implies (currently, and permanently, since nothing ever clears the
-- triple on an acked row) claimed. The only writer of acked_at is
-- ack_outbox_event below, which already enforces this procedurally in its
-- guarded UPDATE — this CHECK is cheap defense-in-depth, the same
-- philosophy 0022 already applied for the lease shape itself.
ALTER TABLE outbox_events ADD CONSTRAINT outbox_events_ack_shape_chk
  CHECK (acked_at IS NULL OR claimed_at IS NOT NULL);

-- Extends the producer boundary (0022:567-568, round-04) to the two new
-- columns for the identical reason it originally covered claimed_at/
-- lease_expires_at: `app` still has table-level INSERT (0022 only revoked
-- UPDATE/DELETE), and Postgres requires INSERT privilege on a column the
-- moment it is named in the column list — column-level grants were already
-- tried and rejected in 0022 because Drizzle always lists every column.
-- Without this, a producer-role INSERT could set claim_token/acked_at on its
-- own freshly-inserted row, permanently excluding that event from ever being
-- claimed at all — worse than the pre-fix bug (never claimed even once, not
-- just reclaimed forever).
ALTER TABLE outbox_events DROP CONSTRAINT outbox_events_producer_lease_boundary_chk;
ALTER TABLE outbox_events ADD CONSTRAINT outbox_events_producer_lease_boundary_chk
  CHECK (current_user != 'app' OR (
    claimed_at IS NULL AND lease_expires_at IS NULL
    AND claim_token IS NULL AND acked_at IS NULL
  ));

-- idx_outbox_expired_lease (0022:122) narrows so acked rows stop
-- accumulating in it — this is the actual fix OAM-2's starvation regression
-- proves. idx_outbox_unclaimed needs no change: an acked row's claimed_at is
-- never NULL (you can only ack a row that was claimed), so it is already
-- excluded from that index's existing predicate.
DROP INDEX idx_outbox_expired_lease;
CREATE INDEX idx_outbox_expired_lease ON outbox_events (lease_expires_at)
  WHERE claimed_at IS NOT NULL AND acked_at IS NULL;

-- ---------------------------------------------------------------------------
-- Step 2: function work. claim_outbox_batch's RETURNS TABLE gains a column
-- (claim_token), which Postgres does not allow via a plain CREATE OR
-- REPLACE (only the body may change that way; changing the output columns
-- requires DROP + CREATE). ack_outbox_event is brand new. Both are created
-- directly AS job_definer (SET ROLE) so neither needs a separate ownership-
-- transfer step — PG16 requires the CURRENT owner-to-be to hold CREATE on
-- the schema for the duration, temporarily granted and revoked in this same
-- migration transaction, matching 0022's Step 3 bracket.
-- ---------------------------------------------------------------------------
GRANT CREATE ON SCHEMA public TO job_definer;
SET ROLE job_definer;

DROP FUNCTION claim_outbox_batch(integer);
CREATE FUNCTION claim_outbox_batch(p_limit integer DEFAULT 100)
RETURNS TABLE (event_id uuid, tenant_id uuid, aggregate_id uuid, sequence integer, type text, claim_token uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_operation_id uuid := gen_random_uuid();
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'claim_outbox_batch: p_limit must be between 1 and 100'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- 1. reclaim up to p_limit expired, unacked leases (SKIP LOCKED), one audit row each.
  WITH expired AS (
    SELECT id FROM outbox_events
    WHERE claimed_at IS NOT NULL AND lease_expires_at < clock_timestamp() AND acked_at IS NULL
    ORDER BY created_at
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  ),
  reclaimed AS (
    UPDATE outbox_events o
    SET claimed_at = NULL, lease_expires_at = NULL, claim_token = NULL
    FROM expired e
    WHERE o.id = e.id
    RETURNING o.id, o.tenant_id
  )
  -- codex round-02 [P2]: created_at explicit clock_timestamp(), not the table's DEFAULT now() —
  -- same staleness class as round-01's claimed_at fix, applied consistently to every audit row
  -- this function writes, so an aged-transaction caller never gets a created_at timestamped
  -- before the outbox_events stamp it is auditing.
  INSERT INTO job_audit_events (job_id, tenant_id, actor, reason, fn_name, operation_id, created_at)
  SELECT reclaimed.id, reclaimed.tenant_id, 'system', 'outbox_lease_reclaimed', 'claim_outbox_batch', v_operation_id, clock_timestamp()
  FROM reclaimed;

  -- 2. claim up to p_limit available, unacked rows (now includes anything just reclaimed above).
  RETURN QUERY
  WITH claimable AS (
    SELECT id
    FROM outbox_events
    WHERE claimed_at IS NULL AND acked_at IS NULL
    ORDER BY created_at
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  ),
  updated AS (
    -- codex round-01 [P2]: clock_timestamp(), not now() — 0022's original stamp used now(), which
    -- is frozen at transaction start. That was harmless for 0022 alone (nothing compared the stamp
    -- against live time until a LATER, separate transaction), but ack_outbox_event's guard below
    -- compares lease_expires_at against clock_timestamp() shortly after claiming: a caller running
    -- claim_outbox_batch inside an explicit transaction open more than five minutes would otherwise
    -- receive an already-expired lease, so a correctly-processed event could never be acked and
    -- would be reclaimed and reprocessed forever.
    UPDATE outbox_events o
    SET claimed_at = clock_timestamp(), lease_expires_at = clock_timestamp() + interval '5 minutes', claim_token = gen_random_uuid()
    FROM claimable c
    WHERE o.id = c.id
    RETURNING o.id, o.tenant_id, o.aggregate_id, o.sequence, o.type, o.claim_token
  ),
  audited AS (
    -- codex round-02 [P2]: same explicit clock_timestamp() as the reclaim audit insert above.
    INSERT INTO job_audit_events (job_id, tenant_id, actor, reason, fn_name, operation_id, created_at)
    SELECT updated.id, updated.tenant_id, 'system', 'outbox_claimed', 'claim_outbox_batch', v_operation_id, clock_timestamp()
    FROM updated
    RETURNING job_id
  )
  SELECT u.id, u.tenant_id, u.aggregate_id, u.sequence, u.type, u.claim_token
  FROM updated u
  JOIN audited a ON a.job_id = u.id;
END;
$$;
REVOKE ALL ON FUNCTION claim_outbox_batch(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_outbox_batch(integer) TO app_worker;

-- ack_outbox_event: the completion marker slice 2b (job-runtime-dispatcher)
-- must call once, and only once, it has finished fanning this event out.
--
-- HARD BLOCKING REQUIREMENT FOR job-runtime-dispatcher (slice 2b): do not
-- call this function until you have prepared delivery
-- (job_prepare_projector_delivery) for every projector actually required
-- for this event's type, and pass that exact set as p_required_projectors.
-- An empty array is a valid, explicit "this event type requires zero
-- projectors" assertion — it is never a default (no default value; the
-- caller must always decide). Passing a short/wrong set will NOT be caught
-- by this function (it can only verify the set it is given, not whether
-- that set is the right one) — the required-projectors source of truth
-- belongs to slice 2b's own code (e.g. a registry constant analogous to
-- apps/bot/src/queues.ts's QUEUES), not to this migration.
CREATE FUNCTION ack_outbox_event(
  p_event_id uuid,
  p_required_projectors text[],
  p_claim_token uuid
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant_id uuid;
  v_row_count integer;
BEGIN
  IF p_required_projectors IS NULL THEN
    RAISE EXCEPTION 'ack_outbox_event: p_required_projectors must not be NULL (pass an empty array for zero required projectors)'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT tenant_id INTO v_tenant_id FROM outbox_events WHERE id = p_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ack_outbox_event: outbox event % does not exist', p_event_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- codex round-05-class fix (0022) already established the pattern this
  -- mirrors: verify completeness with a set-based anti-join, never a count
  -- comparison — a count would false-positive RAISE on caller-supplied
  -- duplicate projector names (projector_deliveries' PK is (event_id,
  -- projector), so a duplicate can only ever match one row).
  IF EXISTS (
    SELECT 1 FROM unnest(p_required_projectors) AS req(projector)
    WHERE NOT EXISTS (
      SELECT 1 FROM projector_deliveries pd
      WHERE pd.event_id = p_event_id AND pd.projector = req.projector
    )
  ) THEN
    RAISE EXCEPTION 'ack_outbox_event: event % missing prepared delivery for one or more required projectors in %',
      p_event_id, p_required_projectors
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- codex round-07 [P1]-class fix (0022): clock_timestamp(), not now() — a
  -- call that starts before expiry but waits on a lock would otherwise judge
  -- liveness against a stale, frozen instant. claim_token match proves this
  -- caller was not superseded by a reclaim-and-reclaim cycle (no NULL-token
  -- guard needed: `claim_token = NULL` is never true in SQL, so a NULL
  -- p_claim_token naturally falls through to the same no-op path as a
  -- stale/wrong one, mirroring complete_projector_delivery's own precedent).
  -- codex round-02 [P2]: acked_at also uses clock_timestamp(), not now() — when claim_outbox_batch
  -- and ack_outbox_event run in the SAME aged explicit transaction (the exact scenario round-01's
  -- fix supports), a frozen now() here would record acked_at BEFORE the claimed_at this call just
  -- read, an impossible causal ordering.
  UPDATE outbox_events
  SET acked_at = clock_timestamp()
  WHERE id = p_event_id
    AND claimed_at IS NOT NULL
    AND acked_at IS NULL
    AND claim_token = p_claim_token
    AND lease_expires_at >= clock_timestamp();
  GET DIAGNOSTICS v_row_count = ROW_COUNT;

  IF v_row_count > 0 THEN
    INSERT INTO job_audit_events (job_id, tenant_id, actor, reason, fn_name, operation_id, created_at)
    VALUES (p_event_id, v_tenant_id, 'system', 'outbox_acked', 'ack_outbox_event', gen_random_uuid(), clock_timestamp());
  END IF;

  RETURN v_row_count > 0;
END;
$$;
REVOKE ALL ON FUNCTION ack_outbox_event(uuid, text[], uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ack_outbox_event(uuid, text[], uuid) TO app_worker;

RESET ROLE;
REVOKE CREATE ON SCHEMA public FROM job_definer;
