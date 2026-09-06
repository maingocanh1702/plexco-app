import pg from "pg";
import type PgBoss from "pg-boss";
import { isDirectRun } from "./direct-run.js";
import { startHeartbeat } from "./heartbeat.js";
import { createQueue } from "./queue.js";
import { preflightOrExit } from "./preflight.js";
import { OUTBOX_DISPATCH_CRON, OUTBOX_DISPATCH_QUEUE } from "./queues.js";
import {
  REQUIRED_PROJECTORS,
  productionStubDeliver,
  runDispatchCycle,
  type DeliverFn,
} from "./dispatcher.js";

/** In-flight deliver() budget on SIGTERM; the hard deadline gives stop() a little extra to unwind. */
export const SHUTDOWN_GRACE_MS = 25_000;
export const SHUTDOWN_DEADLINE_MS = SHUTDOWN_GRACE_MS + 5_000;

/**
 * Worker entrypoint (entrypoint.sh: PROCESS_ROLE=worker → `pnpm --filter
 * @plexco/bot start:worker`). Hosts pg-boss scheduler/dispatcher, projectors
 * and cron. Fail-fast on missing configuration — no silent defaults.
 */

/**
 * Fail-closed: only the exact string "true" enables the schedule. Unset,
 * empty, or any other value (including case variants, "1", "yes") stays
 * disabled — an unparseable/garbage env value must never be treated as
 * opt-in (job-infra slice 3a design probe, item (e)).
 */
export function isOutboxDispatchScheduleEnabled(rawValue: string | undefined): boolean {
  return rawValue === "true";
}

/**
 * Gated OFF by default (job-infra slice 3a design probe, item (e), founder-
 * confirmed 2026-07-27): `runDispatchCycle`'s phase 1 calls `ack_outbox_event`
 * right after prepare, unconditionally, before phase 2 ever runs `deliver()`
 * — and `dlq` is a terminal `projector_deliveries` state with zero replay
 * path anywhere in this repo (0022:264). So once `productionStubDeliver`
 * DLQs a delivery, both ends are dead simultaneously: the outbox event is
 * acked (never re-claimable) and the delivery row is terminal.
 *
 * Safe to enable only once BOTH hold — see docs/autopilot-backlog.md for
 * the tracked flip condition — (a) a real projector replaces the stub, AND
 * (b) a sub-minute wake-up plus a drain-while-full-batch policy exist:
 * codex round-03 [P1]x2 correctly measured that this one-per-minute cron
 * cannot meet NFR-1c's sync-lag SLO (TDD.md:82: p95<=3s, p99<=10s;
 * feature_sync_engine.md:129) — pg-boss's cron floor is one minute, so p95
 * lands near 57s regardless of tuning, and DEFAULT_BATCH_LIMIT=25/cycle
 * with one cycle/minute caps sustained throughput at 25 events/min. Neither
 * is this slice's to fix: a sub-minute wake-up wants a LISTEN/NOTIFY (DD-07)
 * emitted from the transaction that inserts the outbox event, i.e. from the
 * PRODUCER, which is DEFERRED_OUT_OF_SCOPE (2026-07-26); a drain-while-full
 * loop is throughput POLICY, which docs/autopilot-db-job-claim-lease-core.md
 * §4.3 assigns to the concrete consumer slice, same reasoning that keeps
 * retry/backoff out of dispatcher.ts. This cron stays a code-owned recovery
 * sweep, not the mechanism NFR-1c will be met by. Exported so
 * schedule.test.ts can exercise the actual registration path directly,
 * independent of process.env: JSO-1/JSO-6 must not pass merely because the
 * flag happens to be set in a test environment.
 *
 * Reconciles rather than merely skips when disabled (codex round-01 [P1]):
 * `pgboss.schedule` is a persisted table, keyed only by queue name, that
 * pg-boss's own timekeeper fires unconditionally on every boss.start() —
 * independent of this flag. A run that flips the flag back to false after
 * an earlier run had it true (rollback / emergency disable) would otherwise
 * leave the PRIOR run's row in place, so the schedule keeps firing despite
 * the flag reading "disabled". Calling unschedule() is a harmless no-op via
 * a plain `DELETE ... WHERE name = $1` (plans.js) when no row exists.
 */
/**
 * The schedule flag is NECESSARY but not sufficient (audit 2026-09-06 X-3). Producers exist
 * (session-service.ts inserts outbox_events for every session command) while the only
 * deliverer is productionStubDeliver, which DLQs every row terminally after phase 1 has
 * already acked the event — a real product event dies at both ends. So enablement is
 * resolved from BOTH inputs: the flag AND whether the configured deliverer is the stub.
 * Pure, exported, and tested without process.env, like isOutboxDispatchScheduleEnabled.
 */
export function resolveOutboxDispatchEnablement(
  rawFlag: string | undefined,
  deliver: DeliverFn,
): { enabled: boolean; reason: string | null } {
  if (!isOutboxDispatchScheduleEnabled(rawFlag)) {
    return { enabled: false, reason: 'OUTBOX_DISPATCH_SCHEDULE_ENABLED is not "true"' };
  }
  if (deliver === productionStubDeliver) {
    return {
      enabled: false,
      reason:
        "OUTBOX_DISPATCH_SCHEDULE_ENABLED is true but the configured deliverer is productionStubDeliver, which DLQs every delivery terminally — refusing to schedule until a real projector replaces the stub (audit 2026-09-06 X-3)",
    };
  }
  return { enabled: true, reason: null };
}

export async function registerOutboxDispatchSchedule(
  boss: PgBoss,
  enabled: boolean,
): Promise<void> {
  if (!enabled) {
    await boss.unschedule(OUTBOX_DISPATCH_QUEUE);
    console.log(
      '[worker] outbox dispatch schedule disabled (OUTBOX_DISPATCH_SCHEDULE_ENABLED is not "true") — any previously persisted schedule row was removed',
    );
    return;
  }
  await boss.schedule(OUTBOX_DISPATCH_QUEUE, OUTBOX_DISPATCH_CRON);
  console.log(`[worker] outbox dispatch schedule registered: "${OUTBOX_DISPATCH_CRON}"`);
}

async function main(): Promise<void> {
  const directUrl = process.env.DATABASE_URL_DIRECT;
  if (!directUrl) {
    console.error("[worker] DATABASE_URL_DIRECT is not set — refusing to start");
    process.exit(1);
  }

  // DD-90 Q6: preflight runs BEFORE boss.start() — not boss.work(), because
  // startup itself already touches the pgboss schema. No PgBoss instance
  // exists yet at this point (JRD-4).
  await preflightOrExit(directUrl);

  const pool = new pg.Pool({ connectionString: directUrl });
  const boss = createQueue(directUrl);
  boss.on("error", (error) => {
    console.error("[worker] pg-boss error", error);
  });

  await boss.start();
  console.log("[worker] pg-boss started");

  // Business liveness (audit X-5): DB heartbeat via the 0041 definer + local file for the
  // container HEALTHCHECK. Starts after boss.start() so "alive" means the loop is really running.
  const stopHeartbeat = startHeartbeat({ pool });

  const deliver: DeliverFn = productionStubDeliver;
  const enablement = resolveOutboxDispatchEnablement(
    process.env.OUTBOX_DISPATCH_SCHEDULE_ENABLED,
    deliver,
  );
  if (!enablement.enabled && enablement.reason) {
    console.log(`[worker] outbox dispatch schedule OFF — ${enablement.reason}`);
  }
  const scheduleEnabled = enablement.enabled;
  await registerOutboxDispatchSchedule(boss, scheduleEnabled);

  // Gated on the SAME flag as the schedule itself (codex round-02 [P1]):
  // unschedule() only stops FUTURE sends — it cannot retract a
  // __pgboss__send-it/outbox_dispatch job that a prior enabled run already
  // persisted, nor one boss.start()'s own setImmediate(onCron) fires before
  // this line runs. Not registering a worker at all while disabled makes
  // any such stray job sit inertly unconsumed instead of driving
  // productionStubDeliver's terminal dlq/ack — "off" must mean this process
  // never touches dispatch, not merely "does not schedule new triggers".
  if (scheduleEnabled) {
    boss.work(OUTBOX_DISPATCH_QUEUE, async () => {
      const summary = await runDispatchCycle(pool, {
        deliver,
        requiredProjectors: REQUIRED_PROJECTORS,
      });
      console.log("[worker] dispatch cycle", summary);
    });
  } else {
    console.log("[worker] outbox dispatch worker not registered (schedule disabled)");
  }

  // Audit 2026-09-06 B-3: the previous stop() neither WAITED for in-flight work nor bounded it —
  // `graceful: true` without `wait: true` resolves before active jobs finish, so pool.end() and
  // process.exit(0) ran while a deliver() could still be mid-flight, and a hung deliver could
  // hold the process forever. Now: stop waits for active jobs up to SHUTDOWN_GRACE_MS (pg-boss
  // `timeout`), a hard deadline slightly beyond it exits non-zero so an orchestrator sees the
  // abnormal end, and a second signal cannot start a second shutdown.
  let stopping = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    console.log(`[worker] ${signal} received — stopping (grace ${SHUTDOWN_GRACE_MS}ms)`);
    const deadline = setTimeout(() => {
      console.error(`[worker] shutdown exceeded ${SHUTDOWN_DEADLINE_MS}ms — exiting hard`);
      process.exit(1);
    }, SHUTDOWN_DEADLINE_MS);
    deadline.unref();
    try {
      stopHeartbeat();
      await boss.stop({ graceful: true, wait: true, timeout: SHUTDOWN_GRACE_MS });
      await pool.end();
      clearTimeout(deadline);
      process.exit(0);
    } catch (error) {
      console.error("[worker] shutdown failed", error);
      process.exit(1);
    }
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

// Direct-run guard (audit 2026-09-06 B-4): compares this module's URL with the entry script's,
// so importing from a test never runs main(), and a compiled dist/worker.js started directly
// still does. The old `argv[1].endsWith("worker.ts")` was false for any compiled path — the
// worker would load, do nothing, and exit 0.
if (isDirectRun(import.meta.url)) {
  main().catch((error) => {
    console.error("[worker] fatal", error);
    process.exit(1);
  });
}
