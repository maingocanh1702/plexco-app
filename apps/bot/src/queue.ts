import PgBoss from "pg-boss";

/**
 * pg-boss factory for the worker process (PROCESS_ROLE=worker).
 *
 * Requires a DIRECT (session-mode) connection — pg-boss relies on
 * LISTEN/NOTIFY + advisory locks, which transaction-mode poolers do not
 * support. Callers pass DATABASE_URL_DIRECT, never the pooled URL.
 */
export function createQueue(directConnectionString: string): PgBoss {
  if (!directConnectionString) {
    throw new Error("createQueue: DATABASE_URL_DIRECT is required (direct, session-mode)");
  }
  return new PgBoss({
    connectionString: directConnectionString,
    schema: "pgboss",
  });
}
