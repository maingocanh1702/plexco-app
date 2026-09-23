import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const JOB_DEFINER_BOOTSTRAP_SQL_PATH = path.join(
  HERE,
  "..",
  "..",
  "..",
  "infra",
  "postgres-init",
  "01-job-definer.sql",
);
// SAME key as packages/db/src/test-harness.ts's JOB_DEFINER_LOCK_KEY ("jobd") — this
// lock only protects job_definer (cluster-global) if every caller that bootstraps or
// migrates against it shares the identical advisory-lock key. A different key here
// would silently not coordinate with packages/db's own JCL-2/3 tests, which
// deliberately put job_definer into a broken state mid-run under this same lock.
export const JOB_DEFINER_LOCK_KEY = 0x6a6f6264;

export async function bootstrapJobDefiner(client: pg.Client): Promise<void> {
  const sql = await readFile(JOB_DEFINER_BOOTSTRAP_SQL_PATH, "utf8");
  try {
    await client.query(sql);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function withJobDefinerLock<T>(base: string, fn: () => Promise<T>): Promise<T> {
  const lockClient = new pg.Client({ connectionString: base });
  try {
    await lockClient.connect();
    await lockClient.query("SELECT pg_advisory_lock($1)", [JOB_DEFINER_LOCK_KEY]);
    return await fn();
  } finally {
    // Closing the session releases its advisory lock, including on failed setup.
    await lockClient.end();
  }
}

export async function setAppWorkerPasswordRaceSafe(
  client: pg.Client,
  password: string,
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await client.query(`ALTER ROLE app_worker WITH LOGIN PASSWORD '${password}'`);
      return;
    } catch (error) {
      if (String(error).includes("tuple concurrently updated") && attempt < 10) {
        await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
        continue;
      }
      throw error;
    }
  }
}

export function testUrl(
  base: string,
  opts: { db?: string; user?: string; password?: string },
): string {
  const url = new URL(base);
  if (opts.db) url.pathname = `/${opts.db}`;
  if (opts.user) {
    url.username = opts.user;
    url.password = opts.password ?? "";
  }
  return url.toString();
}
