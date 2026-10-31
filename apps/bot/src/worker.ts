import { pgSslConnectionConfig } from "@plexco/db/pg-ssl-options";
import pg from "pg";
import type PgBoss from "pg-boss";
import { isDirectRun } from "./direct-run.js";
import { outboxCronHandler, runDraftExpiry } from "./draft-expiry-job.js";
import { startHeartbeat } from "./heartbeat.js";
import { holdProcessOpen } from "./keep-alive.js";
import { createDispatchRunner, describeError, startOutboxWake } from "./outbox-wake.js";
import { probeOutboxRegistry } from "./projector-registry.js";
import { PROJECTORS } from "./projectors/index.js";
import { createQueue } from "./queue.js";
import { preflightOrExit } from "./preflight.js";
import { OUTBOX_DISPATCH_CRON, OUTBOX_DISPATCH_QUEUE } from "./queues.js";
import { productionStubDeliver, runDispatchCycle, type ProjectorMap } from "./dispatcher.js";

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
 * The schedule flag is NECESSARY but not sufficient (audit 2026-09-06 X-3): a projector map wired
 * to productionStubDeliver (the old terminal-DLQ stub) or an empty map is refused even with the
 * flag on. Pure, exported, and tested without process.env, like isOutboxDispatchScheduleEnabled.
 */
export function resolveOutboxDispatchEnablement(
  rawFlag: string | undefined,
  projectors: ProjectorMap,
): { enabled: boolean; reason: string | null } {
  if (!isOutboxDispatchScheduleEnabled(rawFlag)) {
    return { enabled: false, reason: 'OUTBOX_DISPATCH_SCHEDULE_ENABLED is not "true"' };
  }
  if (projectors.size === 0 || [...projectors.values()].includes(productionStubDeliver)) {
    return {
      enabled: false,
      reason:
        "OUTBOX_DISPATCH_SCHEDULE_ENABLED is true but the configured deliverer is productionStubDeliver (or no projector is configured), which DLQs every delivery terminally — refusing to schedule (audit 2026-09-06 X-3)",
    };
  }
  return { enabled: true, reason: null };
}

/**
 * D-14: ON iff the flag is exactly "true", the projector map is not the stub, AND the registry
 * probe succeeds. The probe runs only when the first two pass; a failing probe (for example a
 * database without 0056 during a rolling deploy) turns dispatch OFF with a logged reason, so a new
 * worker never claims against an old schema.
 */
export async function resolveWorkerDispatchEnablement(
  rawFlag: string | undefined,
  projectors: ProjectorMap,
  probe: () => Promise<void>,
): Promise<{ enabled: boolean; reason: string | null }> {
  const decision = resolveOutboxDispatchEnablement(rawFlag, projectors);
  if (!decision.enabled) return decision;
  try {
    await probe();
  } catch (error) {
    return {
      enabled: false,
      reason: `OUTBOX_DISPATCH_SCHEDULE_ENABLED is true but the outbox registry probe failed (${describeError(error)}) — is migration 0056 applied?`,
    };
  }
  return decision;
}

/**
 * Gated OFF by default (job-infra slice 3a design probe, item (e), founder-confirmed 2026-07-27;
 * DD-134 (e), 2026-10-16: enabling it for real use is the owner's P0 step, see
 * docs/runbooks/outbox-dispatch-enable-rollback.md). What used to make the flag unsafe is gone:
 * the required set comes from the durable registry (0056, seeded all DISABLED, so events ack with
 * '{}' until the owner enables a projector), retries are bounded with an owner replay path for the
 * DLQ (DD-134 a/b), and outbox-wake.ts adds the sub-minute LISTEN/NOTIFY drain NFR-1c needs; this
 * one-minute cron stays as the recovery sweep. Exported so schedule.test.ts can exercise the
 * registration path directly, independent of process.env.
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

  const pool = new pg.Pool(pgSslConnectionConfig(directUrl));
  const boss = createQueue(directUrl);
  boss.on("error", (error) => {
    console.error("[worker] pg-boss error", error);
  });

  await boss.start();
  console.log("[worker] pg-boss started");

  const enablement = await resolveWorkerDispatchEnablement(
    process.env.OUTBOX_DISPATCH_SCHEDULE_ENABLED,
    PROJECTORS,
    () => probeOutboxRegistry(pool),
  );
  if (!enablement.enabled && enablement.reason) {
    console.log(`[worker] outbox dispatch schedule OFF — ${enablement.reason}`);
  }
  const scheduleEnabled = enablement.enabled;

  // Business liveness (audit X-5): DB heartbeat via the 0041 definer + local file for the
  // container HEALTHCHECK. Starts after boss.start() so "alive" means the loop is really running,
  // and after the enablement decision so every tick reports exactly that gate (D-12).
  const stopHeartbeat = startHeartbeat({ pool, scheduleEnabled });
  await registerOutboxDispatchSchedule(boss, scheduleEnabled);

  // Gated on the SAME decision as the schedule itself (codex round-02 [P1]):
  // unschedule() only stops FUTURE sends — it cannot retract a
  // __pgboss__send-it/outbox_dispatch job that a prior enabled run already
  // persisted, nor one boss.start()'s own setImmediate(onCron) fires before
  // this line runs. Not registering a worker at all while disabled makes
  // any such stray job sit inertly unconsumed. "Off" means this process never
  // touches dispatch: no consumer, no LISTEN, no draft expiry.
  const runner = scheduleEnabled
    ? createDispatchRunner(() => runDispatchCycle(pool, { projectors: PROJECTORS }))
    : null;
  const wake = runner ? startOutboxWake({ connectionString: directUrl, runner }) : null;
  if (runner) {
    // D-16: the cron tick drains, then runs one stale-draft expiry pass; a NOTIFY never does.
    const onCronTick = outboxCronHandler({
      drain: () => runner.request(),
      expire: () => runDraftExpiry(pool),
    });
    boss.work(OUTBOX_DISPATCH_QUEUE, onCronTick);
  } else {
    console.log("[worker] outbox dispatch worker not registered (schedule disabled)");
  }

  // Nothing above is guaranteed to keep the loop alive (see keep-alive.ts), so hold it open
  // explicitly until a signal arrives.
  const releaseProcess = holdProcessOpen();
  console.log("[worker] running until SIGTERM/SIGINT");

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
    releaseProcess();
    console.log(`[worker] ${signal} received — stopping (grace ${SHUTDOWN_GRACE_MS}ms)`);
    const deadline = setTimeout(() => {
      console.error(`[worker] shutdown exceeded ${SHUTDOWN_DEADLINE_MS}ms — exiting hard`);
      process.exit(1);
    }, SHUTDOWN_DEADLINE_MS);
    deadline.unref();
    try {
      stopHeartbeat();
      // D-11: the LISTEN client stops first, then no new drain starts and the in-flight cycle is
      // awaited, all inside the same deadline.
      await wake?.stop();
      runner?.close();
      await runner?.idle();
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
