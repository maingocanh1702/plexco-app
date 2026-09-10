import pg from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../schema.js";

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

export function createDb(connectionString: string, options?: { max?: number }): DbHandle {
  if (!connectionString) {
    throw new Error("createDb: a role-scoped connection string is required");
  }
  const pool = new pg.Pool({ connectionString, max: options?.max ?? 10 });
  const db = drizzle(pool, { schema });
  return { db, pool, close: () => pool.end() };
}
