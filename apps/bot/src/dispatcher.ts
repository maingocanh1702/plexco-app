import type pg from "pg";
import {
  claimedEvent,
  projectorIsEnabled,
  requiredProjectorsFor,
  type ProjectorEvent,
} from "./projector-registry.js";
import zaloDmDeliveryAgeBound from "./zalo-dm-delivery-age-bound.json" with { type: "json" };

const DEFAULT_BATCH_LIMIT = 25;

/**
 * DD-134 (a), signed 2026-10-16: at most 8 deliveries. Failure n (n = attempts + 1) with n < 8
 * retries after 15 s x 2^(n-1): 15, 30, 60, 120, 240, 480, 960 s, seven waits, 1905 s in all; the
 * 8th failure dead-letters with this code. The dispatcher is the ONLY retry scheduler (D-7).
 */
export const MAX_DELIVERY_ATTEMPTS = 8;
export const RETRY_BASE_MS = 15_000;
export const ATTEMPTS_EXHAUSTED = "attempts_exhausted";

/** The wait before the next try of a delivery claimed with `attempts` prior tries (0..6). */
export function retryDelayMs(attempts: number): number {
  return RETRY_BASE_MS * 2 ** attempts;
}

export interface ClaimedDeliveryJob {
  eventId: string;
  tenantId: string;
  projector: string;
  claimToken: string;
  /** Prior completed tries of this delivery (0022), so a projector can see where it stands. */
  attempts: number;
  /** The claimed event, read through this claim's token (0056 outbox_claimed_event). */
  event: ProjectorEvent;
}

/**
 * What a projector returns. `retry` is a retryable failure and `dlq` a terminal one; the dispatcher
 * decides WHEN a retry runs and when retries are exhausted, so a nextAttemptAt a projector still
 * attaches is ignored, never read (D-7).
 */
export type DeliveryOutcome =
  | { result: "delivered"; providerRef?: string }
  | { result: "retry"; errorCode: string }
  | { result: "dlq"; errorCode: string };

export type DeliverFn = (job: ClaimedDeliveryJob) => Promise<DeliveryOutcome>;

/** Projector name -> deliver function; production passes projectors/index.ts PROJECTORS. */
export type ProjectorMap = ReadonlyMap<string, DeliverFn>;

/**
 * The refusal sentinel (D-5): resolveOutboxDispatchEnablement (worker.ts) refuses to schedule while
 * any configured projector is this function. It is no longer wired anywhere; it stays exported so
 * that a projector map built from it can never be enabled by accident.
 */
export const productionStubDeliver: DeliverFn = async () => ({
  result: "dlq",
  errorCode: "no_projector_implemented",
});

/** DD-146 bound in minutes, defined ONCE (the enable CLI reads the same JSON); checked at load. */
export const ZALO_DM_MAX_AGE_MINUTES: number = zaloDmDeliveryAgeBound.maxAgeMinutes;
if (!Number.isInteger(ZALO_DM_MAX_AGE_MINUTES) || ZALO_DM_MAX_AGE_MINUTES <= 0) {
  throw new Error("zalo-dm-delivery-age-bound.json: maxAgeMinutes must be a positive integer");
}

/** A Date the age query can take as $1; an Invalid Date there would make the query throw. */
export function isReadableEventTime(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

export type ZaloDmAgeVerdict =
  { expired: false; ageSeconds: number } | { expired: true; ageSeconds: number | "unreadable" };

/** Strict `>`: the bound itself delivers. Only a finite number is readable (Number(null) is 0). */
export function zaloDmAgeVerdict(raw: unknown): ZaloDmAgeVerdict {
  if (typeof raw !== "number" || !Number.isFinite(raw))
    return { expired: true, ageSeconds: "unreadable" };
  return { expired: raw > ZALO_DM_MAX_AGE_MINUTES * 60, ageSeconds: raw };
}

/**
 * DD-146 (L31) threat model. The age check runs for every `zalo_dm` row before deliver() on every
 * path: live attempt or retry, backfill, CLI or raw re-enable, DLQ replay.
 * 1 stale DM ("you hold a seat, fee X" after it stopped being true): age > bound ends the row as
 *   delivered/noop_expired; no deliver(), no targets read, no send, no recipient write;
 * 2 bypasses: every path reaches deliver() through the one call site this check guards;
 * 3 clock error: the age is on the DATABASE clock (clock_timestamp()), never Date.now() or
 *   options.now; an unreadable event time expires without a query (fail closed);
 * 4 silent drop: the terminal row plus one warning line (ids and integers only); a failed clock
 *   read propagates and leaves the row claimed, re-checked at its reclaim;
 * 5 dropping a live retry: the bound exceeds the measured live worst case, and `>` is strict;
 * 6 drift: one definition of the bound (zalo-dm-delivery-age-bound.json, also read by the CLI).
 */
export async function zaloDmDeliveryAge(
  db: pg.Pool,
  createdAt: unknown,
): Promise<ZaloDmAgeVerdict> {
  if (!isReadableEventTime(createdAt)) return { expired: true, ageSeconds: "unreadable" };
  const result = await db.query<{ age_s: unknown }>(
    "SELECT date_part('epoch', clock_timestamp() - $1::timestamptz) AS age_s",
    [createdAt],
  );
  return zaloDmAgeVerdict(result.rows[0]?.age_s);
}

export interface DispatchCycleOptions {
  projectors: ProjectorMap;
  limit?: number;
  /** Clock for the retry schedule (tests); the DB re-checks it against clock_timestamp(). */
  now?: () => Date;
}

export interface DispatchCycleSummary {
  claimedEvents: number;
  ackedEvents: number;
  staleTokenSkips: number;
  processedDeliveries: number;
  staleCompletionSkips: number;
  /** Claims whose envelope read found the lease already gone: no deliver() call. */
  leaseLostSkips: number;
  /** This cycle filled a batch (limit events, or limit deliveries for one projector): drain again. */
  fullBatch: boolean;
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
 * Phase 1 (outer, per claimed OUTBOX event): read the event's required set
 * from the durable registry ONCE (outbox_required_projectors, 0056), prepare
 * each member, then ack with that same array (D-5). `ack_outbox_event` only
 * requires that a projector_deliveries ROW EXISTS for each member (0023), so
 * acking right after prepare is the SQL contract, not a shortcut. Because the
 * set is computed from the DB per event, two workers (or two code versions in
 * a rolling deploy) cannot ack a set they did not prepare, and a projector or
 * route added later never applies to an event acked before it: claims skip
 * acked rows. An event with no enabled, routed projector acks with '{}'.
 *
 * Phase 2 (inner, per projector of `projectors`, in name order, only when
 * projector_is_enabled at cycle start): claim due/claimable delivery rows,
 * read the event through the claim token (outbox_claimed_event), and complete
 * them via that projector's deliver function. A registry-enabled name with no
 * map entry is never claimed (its rows wait; one warning per cycle). Not 1:1
 * with phase 1 within a single call. The retry policy (D-7) is applied here,
 * once, in completionArgs: see its doc comment.
 *
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
  const { projectors, limit = DEFAULT_BATCH_LIMIT, now = () => new Date() } = options;
  const summary: DispatchCycleSummary = {
    claimedEvents: 0,
    ackedEvents: 0,
    staleTokenSkips: 0,
    processedDeliveries: 0,
    staleCompletionSkips: 0,
    leaseLostSkips: 0,
    fullBatch: false,
  };
  const names = [...projectors.keys()].sort();
  const enabled = new Set<string>();
  for (const name of names) if (await projectorIsEnabled(pool, name)) enabled.add(name);

  // Phase 1: outer outbox claim -> required set from the registry -> prepare each -> ack.
  const claimed = await pool.query<ClaimedOutboxEvent>("SELECT * FROM claim_outbox_batch($1)", [
    limit,
  ]);
  summary.claimedEvents = claimed.rows.length;
  if (claimed.rows.length >= limit) summary.fullBatch = true;
  const unmapped = new Set<string>();

  for (const event of claimed.rows) {
    const required = await requiredProjectorsFor(pool, event.event_id);
    for (const projector of required) {
      if (!projectors.has(projector)) unmapped.add(projector);
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
      [event.event_id, required, event.claim_token],
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
  for (const name of unmapped) {
    console.warn(
      `[dispatcher] projector ${name} is required by the registry but has no deliver module in this build; its deliveries wait`,
    );
  }

  // Phase 2: inner per-projector delivery claim -> envelope -> deliver -> complete, one row at a
  // time (see the doc comment above for why: fresh leases, and no single poison row can
  // head-of-line-block the rest).
  for (const projector of names) {
    const deliver = projectors.get(projector);
    if (!deliver || !enabled.has(projector)) continue;
    let deliveriesThisCycle = 0;
    for (;;) {
      if (deliveriesThisCycle >= limit) {
        summary.fullBatch = true;
        break;
      }
      const claimedDeliveries = await pool.query<ClaimedProjectorDelivery>(
        "SELECT * FROM claim_projector_delivery_batch($1, 1)",
        [projector],
      );
      const row = claimedDeliveries.rows[0];
      if (!row) break;
      deliveriesThisCycle += 1;

      // D-6: zero rows = the lease was lost, or the projector is no longer registered, enabled and
      // routed for the event (0056 3d). No deliver(); stop it for the cycle (the stale-stop rule).
      const event = await claimedEvent(pool, row.event_id, row.projector, row.claim_token);
      if (!event) {
        summary.leaseLostSkips += 1; // lease lost or projector no longer registered/enabled/routed
        break;
      }
      const job: ClaimedDeliveryJob = {
        eventId: row.event_id,
        tenantId: row.tenant_id,
        projector: row.projector,
        claimToken: row.claim_token,
        attempts: row.attempts,
        event,
      };

      // DD-146: an expired zalo_dm row ends as delivered/noop_expired without deliver(). Awaited
      // OUTSIDE the try: a clock-read error aborts the cycle, never a dlq deliver_threw.
      const expiry =
        job.projector === "zalo_dm" ? await zaloDmDeliveryAge(pool, job.event.createdAt) : null;
      let outcome: DeliveryOutcome;
      try {
        outcome = expiry?.expired
          ? { result: "delivered", providerRef: "noop_expired" }
          : await deliver(job);
      } catch {
        // deliver() is contracted to RETURN a DeliveryOutcome, not throw.
        // codex round-09 [P1]: an untyped throw is AMBIGUOUS — it can mean
        // "definitely did not happen" (safe to retry) or "the external
        // side effect may already have gone out and only the response
        // handling failed" (e.g. a timeout or a parse error after the
        // provider accepted the request) — retrying the latter risks a
        // DUPLICATE external action. A projector that knows a failure is
        // retryable returns `retry`; an unclassified throw fails closed to
        // 'dlq', never 'retry': the safer wrong answer is "stop and require
        // manual attention" (and an owner replay), not "maybe send it again."
        outcome = { result: "dlq", errorCode: "deliver_threw" };
      }

      const args = completionArgs(outcome, job.attempts, now);
      if (args.errorCode === ATTEMPTS_EXHAUSTED && args.rawErrorCode !== ATTEMPTS_EXHAUSTED) {
        console.warn(
          `[dispatcher] delivery failed ${MAX_DELIVERY_ATTEMPTS} times; last projector error_code ${JSON.stringify(boundRawErrorCode(args.rawErrorCode))} -> dlq ${ATTEMPTS_EXHAUSTED} (event ${job.eventId}, projector ${job.projector})`,
        );
      } else if (args.rawErrorCode !== null && args.rawErrorCode !== args.errorCode) {
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
        // DD-146 record: ids, the projector and integers only; a stale completion logs nothing.
        if (expiry?.expired) {
          const bound = ZALO_DM_MAX_AGE_MINUTES * 60;
          const age =
            expiry.ageSeconds === "unreadable"
              ? `age unreadable, bound ${bound}s`
              : `age ${Math.ceil(expiry.ageSeconds)}s > bound ${bound}s`;
          console.warn(
            `[dispatcher] delivery expired: ${age} (event ${job.eventId}, projector ${job.projector})`,
          );
        }
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
 *   - the retry schedule is the dispatcher's (DD-134 a, D-7): a `retry` claimed
 *     with `attempts` a <= 6 becomes failed with next_attempt_at = now + 15 s x
 *     2^a; at a >= 7 (the 8th failure) it becomes dlq `attempts_exhausted`,
 *     and the projector's own code goes to the bounded log line only. A
 *     projector-supplied nextAttemptAt is never read. The worker clock sets the
 *     instant and the DB checks it against clock_timestamp(), so a worker/DB
 *     skew of 15 s or more turns an early retry into dlq/malformed_outcome via
 *     the 22023 fallback (replayable; the runbook requires NTP).
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
    try {
      text = `[${Array.isArray(raw) ? "array" : typeof raw}]`;
    } catch {
      text = `[${typeof raw}]`; // Array.isArray throws on revoked proxies.
    }
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
  outcome: unknown,
  attempts: number,
  now: () => Date = () => new Date(),
): {
  result: "delivered" | "retry" | "dlq";
  nextAttemptAt: Date | null;
  providerRef: string | null;
  errorCode: string | null;
  rawErrorCode: unknown;
} {
  const malformed = {
    result: "dlq" as const,
    nextAttemptAt: null,
    providerRef: null,
    errorCode: "malformed_outcome",
    rawErrorCode: null,
  };
  try {
    if (typeof outcome !== "object" || outcome === null || Array.isArray(outcome)) {
      return malformed;
    }
    const value = outcome as Record<string, unknown>;
    switch (value.result) {
      case "delivered": {
        const providerRef = value.providerRef;
        if (providerRef != null && (typeof providerRef !== "string" || providerRef.includes("\0")))
          return malformed;
        return {
          result: "delivered",
          nextAttemptAt: null,
          providerRef: providerRef ?? null,
          errorCode: null,
          rawErrorCode: null,
        };
      }
      case "retry": {
        const rawErrorCode = value.errorCode;
        // Fails closed: an attempts value that is not a small non-negative integer is exhausted.
        if (!Number.isInteger(attempts) || attempts < 0 || attempts >= MAX_DELIVERY_ATTEMPTS - 1) {
          return {
            result: "dlq",
            nextAttemptAt: null,
            providerRef: null,
            errorCode: ATTEMPTS_EXHAUSTED,
            rawErrorCode,
          };
        }
        return {
          result: "retry",
          nextAttemptAt: new Date(now().getTime() + retryDelayMs(attempts)),
          providerRef: null,
          errorCode: normalizeErrorCode(rawErrorCode),
          rawErrorCode,
        };
      }
      case "dlq": {
        const rawErrorCode = value.errorCode;
        return {
          result: "dlq",
          nextAttemptAt: null,
          providerRef: null,
          errorCode: normalizeErrorCode(rawErrorCode),
          rawErrorCode,
        };
      }
      default:
        return malformed;
    }
  } catch {
    return malformed;
  }
}
