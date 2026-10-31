import { pgSslConnectionConfig } from "@plexco/db/pg-ssl-options";
import PgBoss from "pg-boss";

export const QUEUE_SCHEMA = "pgboss";

/**
 * pg-boss options for the worker process (PROCESS_ROLE=worker).
 *
 * - Requires a DIRECT (session-mode) connection — pg-boss relies on
 *   LISTEN/NOTIFY + advisory locks, which transaction-mode poolers do not
 *   support. Callers pass DATABASE_URL_DIRECT, never the pooled URL.
 * - `migrate: false` — the runtime `app_worker` role has no DDL privileges by
 *   design (migration role owns DDL). The pgboss schema is provisioned by
 *   `provision-queue.ts` running under DATABASE_URL_MIGRATION.
 */
export function queueOptions(directConnectionString: string): PgBoss.ConstructorOptions {
  if (!directConnectionString) {
    throw new Error("queueOptions: DATABASE_URL_DIRECT is required (direct, session-mode)");
  }
  return { ...pgSslConnectionConfig(directConnectionString), schema: QUEUE_SCHEMA, migrate: false };
}

export function createQueue(directConnectionString: string): PgBoss {
  return new PgBoss(queueOptions(directConnectionString));
}
