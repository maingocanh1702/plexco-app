import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import * as harness from "../../../packages/db/src/test-harness.js";

export { ROLE_PW, type TestRolePasswordLease } from "../../../packages/db/src/test-harness.js";

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
// SAME key as packages/db/src/test-harness.ts's JOB_DEFINER_LOCK_KEY ("jobd"). The lock is the
// harness's own (withJobDefinerLock below delegates to it), so the bot coordinates with
// packages/db's breaker windows, which deliberately break job_definer mid-run, on one key.
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

/** The bot only reads the definers its migrate() reaches: the reader side of their locks. */
export async function withJobDefinerLock<T>(base: string, fn: () => Promise<T>): Promise<T> {
  return harness.withDefinerReadLock(base, fn);
}

/** ROLE_PW.app_worker (and app, readonly) until the lease is released; release it after the pools. */
export async function setAppWorkerPasswordRaceSafe(base: string) {
  return harness.leaseTestRolePasswords(base);
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
