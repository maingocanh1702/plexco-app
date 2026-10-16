import pg from "pg";
import type { DispatchCycleSummary } from "./dispatcher.js";

/**
 * Sub-minute dispatch (D-11, NFR-1c): 0056's trigger sends `NOTIFY outbox_wake` (empty payload) on
 * every outbox_events INSERT statement; this module LISTENs on one dedicated session-mode client and
 * runs a debounced, single-flight drain. The 1-minute pg-boss cron (queues.ts) stays the safety net
 * and goes through the same runner, so a cron tick and a wake can never run two cycles at once in
 * one process. Two processes may: claim tokens keep each delivery single (0022/0023).
 */
export const WAKE_CHANNEL = "outbox_wake";
export const WAKE_APPLICATION_NAME = "plexco_outbox_wake";
export const WAKE_DEBOUNCE_MS = 100;
/** A drain reruns at once while cycles come back full, at most this many in a row. */
export const MAX_DRAIN_CYCLES = 20;
export const RECONNECT_MIN_MS = 1_000;
export const RECONNECT_MAX_MS = 30_000;

type Log = (line: string) => void;
const defaultLog: Log = (line) => console.log(line);

/** SQLSTATE plus message: never a connection string (pg does not put one in its errors). */
export function describeError(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  const message = error instanceof Error ? error.message : String(error);
  return typeof code === "string" ? `${code} ${message}` : message;
}

export interface DispatchRunner {
  /** Ask for a drain; resolves when a drain started at or after this call ends. Never rejects. */
  request(): Promise<void>;
  /** Resolves once no drain is running (shutdown). */
  idle(): Promise<void>;
  /** No drain starts after this; a queued follow-up resolves without running. */
  close(): void;
}

/**
 * The single-flight runner shared by the cron handler and the wake loop. A request while a drain
 * runs queues exactly ONE follow-up, however many requests arrive. A failing cycle is logged and
 * contained: the next wake, cron tick or reconnect catch-up runs again.
 */
export function createDispatchRunner(
  cycle: () => Promise<DispatchCycleSummary>,
  options: { maxDrainCycles?: number; log?: Log } = {},
): DispatchRunner {
  const maxDrainCycles = options.maxDrainCycles ?? MAX_DRAIN_CYCLES;
  const log = options.log ?? defaultLog;
  let running: Promise<void> | null = null;
  let followUp: { promise: Promise<void>; resolve: () => void } | null = null;
  let closed = false;

  const drain = async () => {
    for (let n = 1; n <= maxDrainCycles; n++) {
      if (closed) return;
      let summary: DispatchCycleSummary;
      try {
        summary = await cycle();
      } catch (error) {
        log(`[worker] dispatch cycle failed: ${describeError(error)}`);
        return;
      }
      log(`[worker] dispatch cycle ${JSON.stringify(summary)}`);
      if (!summary.fullBatch) return;
    }
    log(
      `[worker] dispatch drain paused after ${maxDrainCycles} full cycles; the next wake continues`,
    );
  };

  const launch = (): Promise<void> => {
    const current = drain().finally(() => {
      running = null;
      const queued = followUp;
      followUp = null;
      if (!queued) return;
      if (closed) queued.resolve();
      else void launch().then(queued.resolve);
    });
    running = current;
    return current;
  };

  return {
    request() {
      if (closed) return Promise.resolve();
      if (!running) return launch();
      if (!followUp) {
        let resolve: () => void = () => {};
        const promise = new Promise<void>((done) => (resolve = done));
        followUp = { promise, resolve };
      }
      return followUp.promise;
    },
    async idle() {
      while (running) await running;
    },
    close() {
      closed = true;
    },
  };
}

export interface OutboxWakeOptions {
  connectionString: string;
  runner: DispatchRunner;
  debounceMs?: number;
  reconnectMinMs?: number;
  reconnectMaxMs?: number;
  log?: Log;
}

/**
 * LISTEN outbox_wake and turn each burst of notifications into one runner request after
 * `debounceMs`. A lost connection reconnects with backoff (1 s doubling to 30 s), and every
 * (re)connect runs one catch-up drain for whatever was inserted while nobody listened. Errors are
 * logged and contained. stop() closes the client first; the caller then awaits runner.idle().
 */
export function startOutboxWake(options: OutboxWakeOptions): { stop(): Promise<void> } {
  const debounceMs = options.debounceMs ?? WAKE_DEBOUNCE_MS;
  const reconnectMinMs = options.reconnectMinMs ?? RECONNECT_MIN_MS;
  const reconnectMaxMs = options.reconnectMaxMs ?? RECONNECT_MAX_MS;
  const log = options.log ?? defaultLog;
  let stopped = false;
  let client: pg.Client | null = null;
  let debounce: NodeJS.Timeout | null = null;
  let reconnect: NodeJS.Timeout | null = null;
  let backoffMs = reconnectMinMs;

  const wake = () => {
    if (stopped || debounce) return;
    debounce = setTimeout(() => {
      debounce = null;
      if (!stopped) void options.runner.request();
    }, debounceMs);
    debounce.unref();
  };

  const connect = async () => {
    if (stopped) return;
    const c = new pg.Client({
      connectionString: options.connectionString,
      application_name: WAKE_APPLICATION_NAME,
    });
    client = c;
    let lost = false;
    const onLost = (error: unknown) => {
      if (lost || stopped) return;
      lost = true;
      if (client === c) client = null;
      c.removeAllListeners("notification");
      c.end().catch(() => {});
      const delay = backoffMs;
      backoffMs = Math.min(backoffMs * 2, reconnectMaxMs);
      log(
        `[worker] outbox wake listener lost (${describeError(error)}); reconnecting in ${delay} ms`,
      );
      reconnect = setTimeout(() => {
        reconnect = null;
        void connect();
      }, delay);
      reconnect.unref();
    };
    c.on("error", onLost);
    c.on("end", () => onLost(new Error("connection ended")));
    c.on("notification", (message) => {
      if (message.channel === WAKE_CHANNEL) wake();
    });
    try {
      await c.connect();
      await c.query("LISTEN outbox_wake");
    } catch (error) {
      onLost(error);
      return;
    }
    if (stopped || lost) return;
    backoffMs = reconnectMinMs;
    log("[worker] outbox wake listening");
    void options.runner.request(); // catch-up for anything inserted while nobody listened
  };

  void connect();

  return {
    async stop() {
      stopped = true;
      if (debounce) clearTimeout(debounce);
      if (reconnect) clearTimeout(reconnect);
      const c = client;
      client = null;
      if (!c) return;
      c.removeAllListeners();
      c.on("error", () => {}); // a late socket error after stop must not crash the process
      await c.end().catch(() => {});
    },
  };
}
