import pg from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../schema.js";
import { pgSslConnectionConfig } from "./pg-ssl-options.js";

/**
 * Connection factories per DB role (0000_roles_extensions.sql):
 *   app       — HTTP/bot runtime, NOBYPASSRLS, tenant tables only via RLS
 *               (pooled DATABASE_URL);
 *   readonly  — discovery process, SELECT on the guarded view
 *               public_session_share_v ONLY (0033 revoked base SELECT on
 *               public_sessions from both readonly and app);
 *   app_worker— scheduler/outbox, narrow functions (DIRECT connection).
 * The MIGRATION role never appears here — it belongs to migrate.ts only.
 */

export type Db = NodePgDatabase<typeof schema>;

export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface DbHandle {
  db: Db;
  pool: pg.Pool;
  close: () => Promise<void>;
}

/** Pool settings under pg's own names; the timeouts are milliseconds and reach pg.Pool only when given. */
export interface CreateDbOptions {
  max?: number;
  statement_timeout?: number;
  connectionTimeoutMillis?: number;
  query_timeout?: number;
}

export function createDb(connectionString: string, options?: CreateDbOptions): DbHandle {
  if (!connectionString) {
    throw new Error("createDb: a role-scoped connection string is required");
  }
  const config: pg.PoolConfig = {
    ...pgSslConnectionConfig(connectionString),
    max: options?.max ?? 10,
  };
  for (const key of ["statement_timeout", "connectionTimeoutMillis", "query_timeout"] as const) {
    if (options?.[key] !== undefined) config[key] = options[key];
  }
  const pool = new pg.Pool(config);
  const db = drizzle(pool, { schema });
  return { db, pool, close: () => pool.end() };
}
