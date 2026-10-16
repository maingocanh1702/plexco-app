import { hostname } from "node:os";
import { writeFile } from "node:fs/promises";
import type pg from "pg";

/**
 * Worker business liveness (audit 2026-09-06 X-5, last part). Two signals, one loop:
 *   1. DB: `job_worker_heartbeat(worker_id, hostname, pid, schedule_enabled)` — the ONE definer
 *      app_worker may call for this (0041, flag added by 0056); an operator reads
 *      `job_worker_liveness()` to see which workers still tick. "The process is up" and "the loop
 *      still reaches the database" are different facts; this is the second one. The flag is the
 *      gate that decided boss.work in this process, so `outbox_dispatch_schedule_live()` (the
 *      L4b guard, DD-134 f) can tell a live dispatching worker from a live idle one.
 *   2. Local file: after every SUCCESSFUL DB heartbeat the loop rewrites HEARTBEAT_FILE, so the
 *      container HEALTHCHECK (infra/Dockerfile, worker branch) can judge liveness from the file's
 *      age without holding database credentials. A stalled loop, a lost connection or a hung
 *      pg-boss stop all show up as a stale file within HEARTBEAT_STALE_MS.
 *
 * Failures are logged and retried on the next tick — a heartbeat must never take the worker
 * down on its own (the worker's job is dispatch; this is the observer, not the observed).
 *
 * Two things keep the observer from starving the observed, both measured on a database that
 * ACCEPTS connections but never settles queries (a lock wait, a pgbouncer server-side stall, a
 * silently dropped TCP before the OS timeout):
 *   * one tick at a time. `setInterval` fires on a wall clock, not on completion, so without a
 *     guard a hung database stacks a new in-flight query every 30 s; each holds a checked-out
 *     client, and the worker's pool is the DISPATCHER's pool (default max 10), so within ~5
 *     minutes `runDispatchCycle` queues forever behind heartbeats. Measured before the guard:
 *     12 ticks started, 12 concurrently in flight.
 *   * a statement timeout per tick, set transaction-locally so it can never leak onto the next
 *     user of a pooled client. Postgres cancels the stuck heartbeat, the client goes back to the
 *     pool, and `pool.end()` during shutdown is not left waiting on it (that wait is what made a
 *     stall-time deploy exit 1 on SHUTDOWN_DEADLINE_MS).
 */
export const HEARTBEAT_INTERVAL_MS = 30_000;
/** HEALTHCHECK threshold: 3 missed ticks. Mirrors `--interval=30s --retries=3` in the Dockerfile. */
export const HEARTBEAT_STALE_MS = 90_000;
export const DEFAULT_HEARTBEAT_FILE = "/tmp/plexco-worker-heartbeat";
/** Per-tick statement timeout. Well under HEARTBEAT_INTERVAL_MS so a stuck tick clears before the next. */
export const HEARTBEAT_STATEMENT_TIMEOUT_MS = 5_000;

export function heartbeatFilePath(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.WORKER_HEARTBEAT_FILE?.trim();
  return raw && raw.length > 0 ? raw : DEFAULT_HEARTBEAT_FILE;
}

/** Stable per-machine id: the container/machine hostname. Restarts keep it; pid changes. */
export function workerId(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.WORKER_ID?.trim();
  return (raw && raw.length > 0 ? raw : hostname()).slice(0, 128);
}

export interface HeartbeatDeps {
  pool: pg.Pool;
  file?: string;
  id?: string;
  pid?: number;
  now?: () => Date;
  log?: (line: string) => void;
  /**
   * Checked again after the DB tick and before the file write. `startHeartbeat`'s stop function
   * flips it, so a tick already in flight when shutdown began does NOT refresh the health file
   * behind the shutdown's back — worker.ts stops the heartbeat first and then spends up to
   * SHUTDOWN_GRACE_MS in boss.stop(), and a late write would keep the container probe green for
   * up to HEARTBEAT_STALE_MS into a shutdown that has already started.
   */
  cancelled?: () => boolean;
  /** D-12: whether this process registered the dispatch consumer; omitted = NULL (= off). */
  scheduleEnabled?: boolean;
}

/** One tick: DB first, file second. Returns true iff the DB heartbeat succeeded. */
export async function heartbeatOnce(deps: HeartbeatDeps): Promise<boolean> {
  const id = deps.id ?? workerId();
  const pid = deps.pid ?? process.pid;
  const file = deps.file ?? heartbeatFilePath();
  try {
    const client = await deps.pool.connect();
    try {
      // SET LOCAL, so the timeout dies with the transaction and never leaks onto whatever
      // borrows this pooled client next (a session-level SET would).
      await client.query("BEGIN");
      await client.query(`SET LOCAL statement_timeout = ${HEARTBEAT_STATEMENT_TIMEOUT_MS}`);
      await client.query("SELECT job_worker_heartbeat($1, $2, $3, $4)", [
        id,
        hostname(),
        pid,
        deps.scheduleEnabled ?? null,
      ]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    (deps.log ?? console.error)(`[worker] heartbeat failed: ${(error as Error).message}`);
    return false;
  }
  if (deps.cancelled?.()) return true; // stopped while this tick was in flight: DB ticked, file not refreshed
  try {
    await writeFile(file, `${(deps.now ?? (() => new Date()))().toISOString()}\n`, "utf8");
  } catch (error) {
    // The DB tick is the truth; a missing local file only degrades the container probe.
    (deps.log ?? console.error)(
      `[worker] heartbeat file write failed: ${(error as Error).message}`,
    );
  }
  return true;
}

/**
 * Start the loop; returns a stop function. First tick runs immediately. At most ONE tick is ever
 * in flight: a tick that outlives its interval (a stalled database) makes the next one a no-op
 * rather than stacking another checked-out client on the dispatcher's pool.
 */
export function startHeartbeat(
  deps: HeartbeatDeps,
  intervalMs = HEARTBEAT_INTERVAL_MS,
): () => void {
  let stopped = false;
  let inFlight = false;
  const cancelled = () => stopped || deps.cancelled?.() === true;
  const tick = () => {
    if (stopped || inFlight) return;
    inFlight = true;
    void heartbeatOnce({ ...deps, cancelled }).finally(() => {
      inFlight = false;
    });
  };
  tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

/**
 * Pure mirror of the Dockerfile probe: is a heartbeat file written at `writtenAt` still fresh at
 * `now`? The shell computes `now - mtime <= staleSeconds` with no lower bound, so a file dated in
 * the FUTURE (clock skew between the writer and the probe) reads as healthy there; this returns
 * the same verdict rather than a stricter one, because only the shell runs in production and a
 * helper that disagrees with it is a worse lie than the skew it was guarding against.
 */
export function heartbeatFresh(writtenAt: Date, now: Date, staleMs = HEARTBEAT_STALE_MS): boolean {
  return now.getTime() - writtenAt.getTime() <= staleMs;
}
