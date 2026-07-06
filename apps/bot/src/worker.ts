import { createQueue } from "./queue.js";

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

  const boss = createQueue(directUrl);
  boss.on("error", (error) => {
    console.error("[worker] pg-boss error", error);
  });

  await boss.start();
  console.log("[worker] pg-boss started");

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[worker] ${signal} received — stopping`);
    await boss.stop({ graceful: true });
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error) => {
  console.error("[worker] fatal", error);
  process.exit(1);
});
