/**
 * Hold the event loop open until released.
 *
 * worker.ts had no handle of its own keeping the process alive: the heartbeat timer is unref()'d
 * on purpose, and with the outbox schedule off there is no boss.work() poller either. What was
 * left were pg-boss's internal timers and the pools' idle sockets, which are pg-boss's and pg's
 * to manage, not the worker's. A daemon that exits 0 with nothing to do gets restarted in a loop
 * by its supervisor, so the worker owns one referenced handle and drops it only on shutdown.
 * (The macOS schedule.test.ts failure first blamed on this was the test misreading a timed-out
 * SIGTERM exit 0 as an early exit; see runUntilTimeout there.)
 *
 * The interval body is empty: it exists only to be a referenced handle.
 */
export const KEEP_ALIVE_INTERVAL_MS = 60_000;

export function holdProcessOpen(intervalMs = KEEP_ALIVE_INTERVAL_MS): () => void {
  const timer = setInterval(() => {}, intervalMs);
  return () => clearInterval(timer);
}
