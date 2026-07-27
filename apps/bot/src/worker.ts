import pg from "pg";
import { createQueue } from "./queue.js";
import { preflightOrExit } from "./preflight.js";
import { OUTBOX_DISPATCH_QUEUE } from "./queues.js";
import { REQUIRED_PROJECTORS, productionStubDeliver, runDispatchCycle } from "./dispatcher.js";

/**
 * Worker entrypoint (entrypoint.sh: PROCESS_ROLE=worker → `pnpm --filter
 * @plexco/bot start:worker`). Hosts pg-boss scheduler/dispatcher, projectors
 * and cron. Fail-fast on missing configuration — no silent defaults.
 */
async function main(): Promise<void> {
  const directUrl = process.env.DATABASE_URL_DIRECT;
  if (!directUrl) {
    console.error("[worker] DATABASE_URL_DIRECT is not set — refusing to start");
    process.exit(1);
  }

  // DD-90 Q6: preflight runs BEFORE boss.start() — not boss.work(), because
  // startup itself already touches the pgboss schema. No PgBoss instance
  // exists yet at this point (JRD-4).
  await preflightOrExit(directUrl);

  const pool = new pg.Pool({ connectionString: directUrl });
  const boss = createQueue(directUrl);
  boss.on("error", (error) => {
    console.error("[worker] pg-boss error", error);
  });

  await boss.start();
  console.log("[worker] pg-boss started");

  boss.work(OUTBOX_DISPATCH_QUEUE, async () => {
    const summary = await runDispatchCycle(pool, {
      deliver: productionStubDeliver,
      requiredProjectors: REQUIRED_PROJECTORS,
    });
    console.log("[worker] dispatch cycle", summary);
  });

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[worker] ${signal} received — stopping`);
    await boss.stop({ graceful: true });
    await pool.end();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error) => {
  console.error("[worker] fatal", error);
  process.exit(1);
});
