import { describeError } from "./outbox-wake.js";
import type { Queryable } from "./projector-registry.js";

/** Stale drafts examined per cron tick (job_expire_stale_drafts accepts 1..100). */
export const DRAFT_EXPIRY_BATCH_LIMIT = 25;

export interface DraftExpiryCounts {
  cancelled: number;
  anomalies: number;
}

type Log = (line: string) => void;

/**
 * One stale-draft auto-expiry pass (D-15/D-16; BE spec section 4 "Draft discard + auto-expiry"):
 * 0056's job_expire_stale_drafts cancels every empty draft whose start has passed and reports
 * drafts carrying players or charges as anomalies, all inside the definer. Only the two counts are
 * logged: no session id, tenant or payload.
 */
export async function runDraftExpiry(
  db: Queryable,
  log: Log = (line) => console.log(line),
): Promise<DraftExpiryCounts> {
  const result = await db.query<DraftExpiryCounts>("SELECT * FROM job_expire_stale_drafts($1)", [
    DRAFT_EXPIRY_BATCH_LIMIT,
  ]);
  const counts = {
    cancelled: Number(result.rows[0]?.cancelled ?? 0),
    anomalies: Number(result.rows[0]?.anomalies ?? 0),
  };
  log(`[worker] draft expiry: cancelled=${counts.cancelled} anomalies=${counts.anomalies}`);
  return counts;
}

/**
 * The cron-driven handler (D-16): drain the outbox, then ONE expiry pass. The wake loop never calls
 * this, so expiry runs once per cron tick and never on a NOTIFY; the worker registers it only when
 * dispatch is enabled. An expiry failure is logged and contained so the tick still completes.
 */
export function outboxCronHandler(deps: {
  drain: () => Promise<void>;
  expire: () => Promise<unknown>;
  log?: Log;
}): () => Promise<void> {
  const log = deps.log ?? ((line: string) => console.error(line));
  return async () => {
    await deps.drain();
    try {
      await deps.expire();
    } catch (error) {
      log(`[worker] draft expiry failed: ${describeError(error)}`);
    }
  };
}
