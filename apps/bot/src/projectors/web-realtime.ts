import pg from "pg";
import type { DeliverFn } from "../dispatcher.js";
import type { Queryable } from "../projector-registry.js";

/**
 * web_realtime projector (lane L5, readiness R-2, R-3): one NOTIFY per session event on channel
 * web_realtime whose payload is the bare event id, never the body. The web listener reads the
 * event back under each subscriber's tenant (RLS) and re-authorizes before pushing ids only.
 * Replay-safe (D-18): a repeated NOTIFY only causes one more refetch of canonical state. The call
 * is bounded by NOTIFY_TIMEOUT_MS, so a hung connection becomes a retry, never a stuck claim.
 */
export const WEB_REALTIME_CHANNEL = "web_realtime";
export const NOTIFY_TIMEOUT_MS = 5_000;

let injected: Queryable | null = null;
let pool: pg.Pool | null = null;

/** Test seam (R-3): route the NOTIFY through `db` (null: the lazy pool); ends any lazily created pool. */
export async function setWebRealtimeDbForTests(db: Queryable | null): Promise<void> {
  injected = db;
  const created = pool;
  pool = null;
  await created?.end();
}

function notifyDb(): Queryable {
  if (injected) return injected;
  if (!pool) {
    const connectionString = process.env.DATABASE_URL_DIRECT;
    // Fail closed: without a URL pg would connect as the OS user with its implicit defaults.
    if (!connectionString) throw new Error("DATABASE_URL_DIRECT is not set");
    pool = new pg.Pool({
      connectionString,
      max: 1,
      connectionTimeoutMillis: NOTIFY_TIMEOUT_MS,
      query_timeout: NOTIFY_TIMEOUT_MS,
    });
    // An idle-client error must not crash the worker; the next delivery reconnects.
    pool.on("error", (error) => console.warn("web_realtime.pool_error", error.message));
  }
  return pool;
}

export const deliverWebRealtime: DeliverFn = async (job) => {
  if (job.event.aggregateType !== "session") {
    return { result: "dlq", errorCode: "unsupported_aggregate" };
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), NOTIFY_TIMEOUT_MS);
  });
  try {
    const notified = notifyDb()
      .query("SELECT pg_notify('web_realtime', $1)", [job.eventId])
      .then(() => "ok" as const);
    const outcome = await Promise.race([notified, timeout]);
    if (outcome === "timeout") return { result: "retry", errorCode: "notify_timeout" };
    return { result: "delivered" };
  } catch {
    return { result: "retry", errorCode: "notify_failed" };
  } finally {
    clearTimeout(timer);
  }
};
