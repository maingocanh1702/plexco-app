import { isDirectRun } from "./direct-run.js";
import { pgSslConnectionConfig } from "@plexco/db/pg-ssl-options";
import pg from "pg";
import PgBoss from "pg-boss";
import { QUEUE_SCHEMA } from "./queue.js";
import { QUEUES } from "./queues.js";

/**
 * Provision the pg-boss schema + queues as the MIGRATION (DDL-owner) role.
 *
 * Runtime roles hold no DDL privileges (0000/0009), so the worker starts with
 * `migrate: false`; this script is the single place pg-boss DDL happens:
 *   1. construct/migrate the pgboss schema (pg-boss's own machinery),
 *   2. create every registered queue (partition DDL in pg-boss v10),
 *   3. grant the runtime `app_worker` role DML on the schema's objects.
 * Idempotent — safe to run on every deploy. Usage:
 *   DATABASE_URL_MIGRATION=postgres://... pnpm --filter @plexco/bot provision:queue
 */
export async function provisionQueue(migrationUrl: string): Promise<void> {
  if (!migrationUrl) {
    throw new Error("provisionQueue: DATABASE_URL_MIGRATION is required (DDL-owner role)");
  }

  // Own the connection even if pg-boss startup fails before stop() can close its pool.
  const client = new pg.Client(pgSslConnectionConfig(migrationUrl));
  try {
    await client.connect();
    const boss = new PgBoss({
      db: { executeSql: (text, values) => client.query(text, values) },
      schema: QUEUE_SCHEMA,
      schedule: false,
      supervise: false,
    });
    try {
      await boss.start();
      for (const queue of QUEUES) {
        await boss.createQueue(queue);
      }
    } finally {
      await boss.stop({ graceful: true, wait: true });
    }

    // Runtime grants: app_worker gets DML only — no CREATE, no ownership.
    await client.query(`GRANT USAGE ON SCHEMA ${QUEUE_SCHEMA} TO app_worker`);
    await client.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${QUEUE_SCHEMA} TO app_worker`,
    );
    await client.query(`GRANT USAGE ON ALL SEQUENCES IN SCHEMA ${QUEUE_SCHEMA} TO app_worker`);
    await client.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA ${QUEUE_SCHEMA}
         GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_worker`,
    );
    await client.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA ${QUEUE_SCHEMA} GRANT USAGE ON SEQUENCES TO app_worker`,
    );
  } finally {
    await client.end();
  }
}

// Direct-run guard (audit 2026-09-06 B-4) — see direct-run.ts; the old endsWith() check was
// false for a compiled path, so `node dist/provision-queue.js` would exit 0 having done nothing.
if (isDirectRun(import.meta.url)) {
  provisionQueue(process.env.DATABASE_URL_MIGRATION ?? "")
    .then(() => {
      console.log("[provision-queue] pgboss schema + queues provisioned");
      process.exit(0);
    })
    .catch((error) => {
      console.error("[provision-queue] failed", error);
      process.exit(1);
    });
}
