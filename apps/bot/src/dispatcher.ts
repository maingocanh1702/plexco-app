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
 * or retrying forever around work that cannot succeed.
 *
 * NOT safe to schedule (audit 2026-09-06 X-3 corrected the old text here,
 * which claimed "no producer inserts outbox_events"): the session command
 * family in packages/db/src/session-service.ts has inserted outbox_events
 * since 2026-08-14 (session.created/published/announcement_requested/
 * updated/closed/cancelled ...). With this stub scheduled, phase 1 acks each
 * event right after prepare and phase 2 DLQs its delivery — a terminal state
 * with no replay path (0022:264, backlog db-projector-dlq-no-replay-path) —
 * so a real product event dies at both ends. worker.ts therefore REFUSES to
 * register the schedule while this stub is the configured deliverer, on top
 * of the OUTBOX_DISPATCH_SCHEDULE_ENABLED flag defaulting off. Replacing this
 * stub with a real projector is the first concrete projector slice's job;
 * the DLQ flood it would produce is expected, not a regression in this file.
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
      if (args.rawErrorCode !== null && args.rawErrorCode !== args.errorCode) {
        // The raw code comes from a projector we do not control, so it is untrusted free text:
        // it can carry a token-bearing URL, a response body, or arbitrary padding. The whole
        // point of logging it is to show WHAT was normalised away, and a bounded prefix does
        // that; the unbounded original does that plus retains whatever was embedded in it.
        console.warn(
          `[dispatcher] normalised projector error_code ${JSON.stringify(boundRawErrorCode(args.rawErrorCode))} -> ${args.errorCode} (event ${job.eventId}, projector ${job.projector})`,
        );
      }
      const complete = (a: typeof args) =>
        pool.query<{ complete_projector_delivery: boolean }>(
          "SELECT complete_projector_delivery($1, $2, $3, $4, $5, $6, $7) AS complete_projector_delivery",
          [
            job.eventId,
            job.projector,
            job.claimToken,
            a.result,
            a.nextAttemptAt,
            a.providerRef,
            a.errorCode,
          ],
        );
      let completeResult: { rows: { complete_projector_delivery: boolean }[] };
      try {
        completeResult = await complete(args);
      } catch (error) {
        // Defense in depth behind the normaliser: if the SQL grammar still rejects
        // the outcome (SQLSTATE 22023 invalid_parameter_value ONLY — anything else
        // is infra and propagates as before), fail this ROW closed to dlq with a
        // canonical code instead of aborting the cycle with the row left claimed.
        if ((error as { code?: string } | null)?.code !== "22023") throw error;
        console.warn(
          `[dispatcher] complete_projector_delivery rejected outcome for event ${job.eventId} (${String(error)}); recording dlq/malformed_outcome`,
        );
        completeResult = await complete({
          result: "dlq",
          nextAttemptAt: null,
          providerRef: null,
          errorCode: "malformed_outcome",
          rawErrorCode: args.rawErrorCode,
        });
      }
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

/**
 * complete_projector_delivery (0022:424-437) RAISES invalid_parameter_value
 * (SQLSTATE 22023) when `error_code` is not `^[a-z][a-z0-9_]{0,63}$` or when a
 * `retry` carries a non-future `next_attempt_at`. Before this normaliser, a
 * projector returning e.g. `errorCode: "ECONNRESET"` (uppercase) raised INSIDE
 * runDispatchCycle, outside the deliver() try/catch, and aborted the whole
 * cycle with the row still `claimed` — and claim_projector_delivery_batch's
 * reclaim-expired-first + ORDER BY event_id handed the SAME row back first on
 * the next cycle, forever: exactly the head-of-line block the file-level
 * comment says phase 2 prevents (audit 2026-09-06 B-1). The grammar is the
 * SQL contract's, not the projector's, so it is enforced here, once:
 *   - error codes are lower-cased, non-matching characters become `_`, an
 *     empty/leading-digit result is replaced by `malformed_error_code`, and
 *     the whole thing is cut to 64 chars;
 *   - a `retry` whose nextAttemptAt is not strictly in the future is turned
 *     into a `dlq` with `malformed_next_attempt` — a retry we cannot schedule
 *     is not a retry, and failing closed is the same choice deliver()'s own
 *     throw path makes.
 * The original value is preserved in `rawErrorCode` for the log line.
 */
export const ERROR_CODE_RE = /^[a-z][a-z0-9_]{0,63}$/;
/**
 * Bound the untrusted raw error code before it reaches a log line. 64 is the same ceiling
 * normalizeErrorCode() applies to the value it keeps, so a raw code already within the grammar's
 * length prints in full and only genuinely oversized input is cut.
 *
 * Takes `unknown`, not `string`, and that is the whole point. DeliveryOutcome DECLARES
 * `errorCode: string`, but a projector is external code and this module exists because runtime
 * values violate that declaration — completionArgs passes `outcome.errorCode` through to
 * rawErrorCode unguarded on the retry and dlq branches. A `.slice()` on a number would throw
 * HERE, before complete_projector_delivery runs, leaving the delivery claimed and the cycle
 * aborted: exactly the failure B-1 removed, reintroduced by a log line. Non-strings are described
 * by TYPE rather than coerced — String(Symbol()) throws, and an object may be huge or carry
 * secrets (the same rule apps/web/lib/log.ts applies to arbitrary objects).
 */
export const RAW_ERROR_CODE_LOG_MAX = 64;
export function boundRawErrorCode(raw: unknown): string {
  let text: string;
  if (typeof raw === "string") {
    text = raw;
  } else if (typeof raw === "number" || typeof raw === "boolean" || typeof raw === "bigint") {
    text = String(raw); // primitives are safe to show and are what a sloppy projector usually sends
  } else if (raw === null) {
    text = "[null]";
  } else {
    text = `[${Array.isArray(raw) ? "array" : typeof raw}]`;
  }
  return text.length <= RAW_ERROR_CODE_LOG_MAX
    ? text
    : `${text.slice(0, RAW_ERROR_CODE_LOG_MAX)}…[+${text.length - RAW_ERROR_CODE_LOG_MAX}]`;
}

export function normalizeErrorCode(raw: unknown): string {
  const text = typeof raw === "string" ? raw : "";
  let code = text
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .slice(0, 64);
  if (!/^[a-z]/.test(code)) code = "malformed_error_code";
  return ERROR_CODE_RE.test(code) ? code : "malformed_error_code";
}

export function completionArgs(
  outcome: DeliveryOutcome,
  now: () => Date = () => new Date(),
): {
  result: "delivered" | "retry" | "dlq";
  nextAttemptAt: Date | null;
  providerRef: string | null;
  errorCode: string | null;
  rawErrorCode: string | null;
} {
  switch (outcome.result) {
    case "delivered":
      return {
        result: "delivered",
        nextAttemptAt: null,
        providerRef: outcome.providerRef ?? null,
        errorCode: null,
        rawErrorCode: null,
      };
    case "retry": {
      const at = outcome.nextAttemptAt;
      const future =
        at instanceof Date && !Number.isNaN(at.getTime()) && at.getTime() > now().getTime();
      if (!future) {
        return {
          result: "dlq",
          nextAttemptAt: null,
          providerRef: null,
          errorCode: "malformed_next_attempt",
          rawErrorCode: typeof outcome.errorCode === "string" ? outcome.errorCode : null,
        };
      }
      return {
        result: "retry",
        nextAttemptAt: at,
        providerRef: null,
        errorCode: normalizeErrorCode(outcome.errorCode),
        rawErrorCode: outcome.errorCode,
      };
    }
    case "dlq":
      return {
        result: "dlq",
        nextAttemptAt: null,
        providerRef: null,
        errorCode: normalizeErrorCode(outcome.errorCode),
        rawErrorCode: outcome.errorCode,
      };
  }
}
