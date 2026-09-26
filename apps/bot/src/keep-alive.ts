/**
 * Hold the event loop open until released.
 *
 * worker.ts had no handle of its own keeping the process alive: the heartbeat timer is unref()'d
 * on purpose, and with the outbox schedule off there is no boss.work() poller either. What was
 * left were pg-boss's internal timers and the pools' idle sockets, and whether those still hold
 * the loop depends on the runtime. On a developer Mac the worker printed "[worker] pg-boss
 * started" and then exited 0 about a second later; under Linux CI it happened to stay up. A
 * daemon that exits 0 with nothing to do gets restarted in a loop by its supervisor, so the
 * worker now owns one referenced handle and drops it only on shutdown.
 *
 * The interval body is empty: it exists only to be a referenced handle.
 */
export const KEEP_ALIVE_INTERVAL_MS = 60_000;

export function holdProcessOpen(intervalMs = KEEP_ALIVE_INTERVAL_MS): () => void {
  const timer = setInterval(() => {}, intervalMs);
  return () => clearInterval(timer);
}
