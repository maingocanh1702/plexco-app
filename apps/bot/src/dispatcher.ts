import type pg from "pg";

const DEFAULT_BATCH_LIMIT = 25;

/**
 * PLACEHOLDER — not a real channel/projector name. This slice ships no
 * production delivery implementation (scope-deferred to the first concrete
 * projector slice); this identifier only exists so the fan-out/ack lifecycle
 * below has something real to exercise. Read TWICE below (prepare loop and
 * the ack call's required-projector argument) from this ONE array — never
 * duplicated into a second constant — so the two cannot diverge WITHIN ONE
 * PROCESS when a future slice adds a second projector.
 *
 * codex round-02 [P1], NOT fixed here — a hard requirement for whoever next
 * extends this array (most likely the first concrete projector slice): a
 * single in-memory constant only prevents prepare/ack divergence within one
 * running process. It does NOT prevent divergence ACROSS PROCESSES during a
 * rolling deploy that changes this array's length: an old replica can claim
 * an event, prepare only its stale (shorter) required set, and successfully
 * ack with that shorter array — ack_outbox_event only verifies the set IT
 * was given, not that the set is complete for the event's type. Since
 * claim_outbox_batch permanently excludes acked events, the new replica
 * (and the newly-added projector) never sees that event again. Closing this
 * needs either (a) a durable, versioned required-projectors-per-event-type
 * registry — 0023's own migration comment already names this as not built
 * yet, and this slice's manifest forbids a new migration to build it here —
 * or (b) an operational drain-before-enable deploy discipline (stop every
 * old replica before starting one with a changed array; never overlap).
 * Do not extend this array under an ordinary rolling deploy until one of
 * those is in place.
 */
export const STUB_PROJECTOR = "stub_projector";
export const REQUIRED_PROJECTORS: readonly string[] = [STUB_PROJECTOR];

export interface ClaimedDeliveryJob {
  eventId: string;
  tenantId: string;
  projector: string;
  claimToken: string;
  attempts: number;
}

export type DeliveryOutcome =
  | { result: "delivered"; providerRef?: string }
  | { result: "retry"; nextAttemptAt: Date; errorCode: string }
  | { result: "dlq"; errorCode: string };

/**
 * Retry/dlq policy lives HERE, in the caller's own decision, not in
 * runDispatchCycle below — the SQL contract (0022) deliberately stores
 * `attempts` but leaves backoff/max-attempt policy to the consumer, and
 * docs/autopilot-db-job-claim-lease-core.md §4.3 assigns that policy to the
 * first concrete projector slice, not this one. `attempts` (pre-completion,
 * from claim_projector_delivery_batch) is provided so a real implementation
 * can compute its own backoff/max-attempt cutoff from it.
 */
export type DeliverFn = (job: ClaimedDeliveryJob) => Promise<DeliveryOutcome>;

/**
 * Production placeholder wired into worker.ts. No real projector exists yet,
 * so every delivery is DLQed immediately rather than pretending to succeed
 * or retrying forever around work that cannot succeed. SAFE today because
 * production is code-dark: no producer inserts outbox_events (deferred out
 * of scope) and no cron drives this queue yet (slice 3). CONSEQUENCE: once
 * slice 3 registers the cron, every event this dispatcher claims WILL DLQ
 * until slice 4 replaces this stub with a real implementation — that is
 * expected, not a regression; slice 3 must not read the resulting DLQ flood
 * as a defect in this handler.
 */
export const productionStubDeliver: DeliverFn = async () => ({
  result: "dlq",
  errorCode: "no_projector_implemented",
});

export interface DispatchCycleOptions {
  deliver: DeliverFn;
  requiredProjectors: readonly string[];
  limit?: number;
}

export interface DispatchCycleSummary {
  claimedEvents: number;
  ackedEvents: number;
  staleTokenSkips: number;
  processedDeliveries: number;
  staleCompletionSkips: number;
}

interface ClaimedOutboxEvent {
  event_id: string;
  tenant_id: string;
  aggregate_id: string;
  sequence: number;
  type: string;
  claim_token: string;
}

interface ClaimedProjectorDelivery {
  event_id: string;
  tenant_id: string;
  projector: string;
  claim_token: string;
  attempts: number;
}

/**
 * The full lifecycle shipped in 0022/0023, run as two independently-paced
 * phases per cycle call — NOT one tightly-coupled per-event sequence.
 *
 * Phase 1 (outer, per claimed OUTBOX event): prepare every required
 * projector, then ack. `ack_outbox_event`'s own SQL only requires that a
 * projector_deliveries ROW EXISTS for each required projector (0023) — not
 * that delivery has completed — so acking right after prepare is correct per
 * the SQL contract, not a shortcut: the outer outbox lease's job is "don't
 * lose track of an event until fan-out has been initiated for every
 * required consumer." Each projector's own delivery-with-retry durability is
 * independently owned by its projector_deliveries row's own lease/reclaim
 * (phase 2), decoupled from the outer event's lease.
 *
 * Phase 2 (inner, per required projector): claim due/claimable delivery
 * rows — which may include rows prepared in phase 1 of THIS call, or an
 * earlier call, or a reclaimed-expired row — and complete them via the
 * injected `deliver` function. Not 1:1 with phase 1 within a single call.
 * Claims and completes ONE ROW AT A TIME rather than claiming a whole batch
 * upfront (codex round-07 [P1]): claiming `limit` rows before the first
 * `deliver()` call stamps every row's five-minute lease at claim time, but
 * serial delivery means a later row in the batch can start AFTER its own
 * lease already expired if earlier deliveries were slow — another replica
 * may have already reclaimed and delivered it, and a stale-token no-op only
 * prevents a duplicate DB completion, not a duplicate EXTERNAL delivery
 * side effect. Claiming immediately before each delivery keeps every
 * lease essentially fresh when `deliver()` is actually called.
 *
 * A thrown error from phase 1 propagates uncaught out of this function — it
 * means either "this handler has a bug" (ack_outbox_event raised because a
 * required projector was never prepared, JRD-17) or a genuine infra
 * failure, and every unclaimed/unacked event simply stays claimed, picked
 * up again once its lease expires (self-healing at the SQL layer). Phase 2
 * is different: `deliver()` is an INJECTED, arbitrary implementation that
 * is contracted to RETURN a DeliveryOutcome, never throw — but if it throws
 * anyway (codex round-07 [P1]), letting that propagate would abort the
 * whole cycle after claim_projector_delivery_batch's own deterministic
 * `ORDER BY event_id` had already selected this row first; the SAME poison
 * row would be selected first again on every future cycle, permanently
 * starving every row after it. Phase 2 therefore contains a thrown
 * deliver() error into a completion for that ROW ONLY, never letting it
 * escape the loop — and fails that completion CLOSED to 'dlq', never
 * 'retry' (codex round-09 [P1]): an untyped throw cannot be distinguished
 * from "the external side effect may already have gone out and only the
 * response handling failed," and blindly retrying that risks a duplicate
 * external action.
 *
 * A stale (false) completion — the claim token no longer matches, whether
 * because another claimant reclaimed the row or because THIS row's own
 * lease expired while its `deliver()` call was still in flight (took
 * longer than the five-minute lease) — stops phase 2 for that projector
 * for the REST of this cycle (codex round-09 [P1]) rather than looping
 * back to claim again: claim_projector_delivery_batch's own reclaim-
 * expired-first step would very likely hand back that SAME row (deliver()
 * being slow doesn't become NOT slow on retry), repeating the external
 * side effect up to `limit` times in one cycle. Nothing is lost by
 * stopping — the row is picked up again, by whichever claimant now
 * legitimately owns it, on a later cycle.
 */
export async function runDispatchCycle(
  pool: pg.Pool,
  options: DispatchCycleOptions,
): Promise<DispatchCycleSummary> {
  const { deliver, requiredProjectors, limit = DEFAULT_BATCH_LIMIT } = options;
  const summary: DispatchCycleSummary = {
    claimedEvents: 0,
    ackedEvents: 0,
    staleTokenSkips: 0,
    processedDeliveries: 0,
    staleCompletionSkips: 0,
  };

  // Phase 1: outer outbox claim -> prepare every required projector -> ack.
  const claimed = await pool.query<ClaimedOutboxEvent>("SELECT * FROM claim_outbox_batch($1)", [
    limit,
  ]);
  summary.claimedEvents = claimed.rows.length;

  for (const event of claimed.rows) {
    for (const projector of requiredProjectors) {
      await pool.query("SELECT job_prepare_projector_delivery($1, $2)", [
        event.event_id,
        projector,
      ]);
    }

    // Any error here (e.g. ack_outbox_event raising because a required
    // projector was never prepared — JRD-17) propagates unchanged: it means
    // this handler has a bug, not "another claimant owns this event".
    const ackResult = await pool.query<{ ack_outbox_event: boolean }>(
      "SELECT ack_outbox_event($1, $2, $3) AS ack_outbox_event",
      [event.event_id, requiredProjectors, event.claim_token],
    );
    const acked = ackResult.rows[0]?.ack_outbox_event === true;
    if (acked) {
      summary.ackedEvents += 1;
    } else {
      // false (no exception) = stale token: another claimant reclaimed this
      // event already. Expected, non-error — do not retry, do not throw.
      summary.staleTokenSkips += 1;
    }
  }

  // Phase 2: inner per-projector delivery claim -> deliver -> complete, one
  // row at a time (see the file-level doc comment for why: fresh leases,
  // and no single poison row can head-of-line-block the rest).
  for (const projector of requiredProjectors) {
    let deliveriesThisCycle = 0;
    for (;;) {
      if (deliveriesThisCycle >= limit) break;
      const claimedDeliveries = await pool.query<ClaimedProjectorDelivery>(
        "SELECT * FROM claim_projector_delivery_batch($1, 1)",
        [projector],
      );
      const row = claimedDeliveries.rows[0];
      if (!row) break;
      deliveriesThisCycle += 1;

      const job: ClaimedDeliveryJob = {
        eventId: row.event_id,
        tenantId: row.tenant_id,
        projector: row.projector,
        claimToken: row.claim_token,
        attempts: row.attempts,
      };

      let outcome: DeliveryOutcome;
      try {
        outcome = await deliver(job);
      } catch {
        // deliver() is contracted to RETURN a DeliveryOutcome, not throw.
        // codex round-09 [P1]: an untyped throw is AMBIGUOUS — it can mean
        // "definitely did not happen" (safe to retry) or "the external
        // side effect may already have gone out and only the response
        // handling failed" (e.g. a timeout or a parse error after the
        // provider accepted the request) — retrying the latter risks a
        // DUPLICATE external action. This slice has no typed/classified
        // error contract to distinguish the two (and none is invented
        // here — that would mean guessing at a future real projector's
        // error shape), so an unclassified throw fails closed to 'dlq',
        // never 'retry': the safer wrong answer is "stop and require
        // manual attention", not "maybe send it again."
        outcome = { result: "dlq", errorCode: "deliver_threw" };
      }

      const args = completionArgs(outcome);
      const completeResult = await pool.query<{ complete_projector_delivery: boolean }>(
        "SELECT complete_projector_delivery($1, $2, $3, $4, $5, $6, $7) AS complete_projector_delivery",
        [
          job.eventId,
          job.projector,
          job.claimToken,
          args.result,
          args.nextAttemptAt,
          args.providerRef,
          args.errorCode,
        ],
      );
      // false (no exception) = the token expired or was reclaimed by another
      // worker before this completion landed — the SAME "another claimant
      // owns this now" contract as ack_outbox_event's false path above, not
      // success. Reporting it as processed would silently let a row stay
      // uncompleted (still 'claimed', eligible for its own reclaim once the
      // lease expires) while logs claim it was handled.
      if (completeResult.rows[0]?.complete_projector_delivery === true) {
        summary.processedDeliveries += 1;
      } else {
        summary.staleCompletionSkips += 1;
        // codex round-09 [P1]: a stale completion can mean the lease
        // expired WHILE deliver() for THIS row was still running (it took
        // longer than the five-minute lease) — with no other claimant
        // involved at all. Looping back to claim_projector_delivery_batch
        // immediately would very likely RECLAIM THE SAME ROW (its own
        // reclaim-expired-first step, ORDER BY event_id) and call
        // deliver() on it again, and again, up to `limit` times in this
        // one cycle, each one a REAL external side effect once a real
        // projector is connected. Stop this projector's phase-2 work for
        // the rest of THIS cycle instead — nothing is lost, the row (or
        // whichever claimant now legitimately owns it) is picked up again
        // on a later cycle.
        break;
      }
    }
  }

  return summary;
}

function completionArgs(outcome: DeliveryOutcome): {
  result: "delivered" | "retry" | "dlq";
  nextAttemptAt: Date | null;
  providerRef: string | null;
  errorCode: string | null;
} {
  switch (outcome.result) {
    case "delivered":
      return {
        result: "delivered",
        nextAttemptAt: null,
        providerRef: outcome.providerRef ?? null,
        errorCode: null,
      };
    case "retry":
      return {
        result: "retry",
        nextAttemptAt: outcome.nextAttemptAt,
        providerRef: null,
        errorCode: outcome.errorCode,
      };
    case "dlq":
      return {
        result: "dlq",
        nextAttemptAt: null,
        providerRef: null,
        errorCode: outcome.errorCode,
      };
  }
}
