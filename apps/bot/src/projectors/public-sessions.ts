import { pgSslConnectionConfig } from "@plexco/db/pg-ssl-options";
import pg from "pg";
import type { DeliverFn, DeliveryOutcome } from "../dispatcher.js";
import type { Queryable } from "../projector-registry.js";

/**
 * The public_sessions projector (lane L10; readiness 4.7, DD-41, DD-12). A routed event (12
 * session types and 3 tenant alias types, 0061) only names WHICH sessions to recompute: its payload
 * is never read, so a forged or stale event causes at most a recompute from canonical rows.
 *
 * Per session: one call to public_sessions_project_session (0061), which observes the DD-12 fence
 * token, recomputes the public row from canonical rows and, as its last statement, CAS-clears the
 * fence only while its token is still the observed one, on every path, so a newer raise always
 * wins. app_worker cannot call the 0033 observe/clear functions at all (D3, s1 S-1). A tenant event
 * does the same for each of the tenant's candidates. Every delivery ends with a bounded expiry
 * sweep. All SQL is raw EXECUTE of SECURITY DEFINER functions on the app_worker seat (P-18), which
 * holds no privilege on public_sessions itself.
 *
 * Outcomes (P-13): delivered, with the disposition as providerRef; any DB failure is a retry the
 * dispatcher bounds (MAX_DELIVERY_ATTEMPTS, then attempts_exhausted); an unknown aggregate type,
 * a non-UUID aggregate id or a missing DATABASE_URL_DIRECT dead-letters before any SQL. Never
 * throws: one poison delivery only records its own retry or dlq row.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Expired rows deleted per delivery (BE tech :195); the view's expiry filter hides the rest. */
const SWEEP_LIMIT = 100;

const dlq = (errorCode: string): DeliveryOutcome => ({ result: "dlq", errorCode });

/** P-13: every DB failure retries; the code only tells serialization, deadlock and lost
 *  connections (SQLSTATE class 08, 57P01-57P03, a Node socket error) apart from the rest. */
function retryFor(error: unknown): DeliveryOutcome {
  const code = (error as { code?: unknown } | null)?.code;
  let errorCode = "db_error";
  if (code === "40001") errorCode = "serialization_failure";
  else if (code === "40P01") errorCode = "deadlock_detected";
  else if (typeof code === "string" && /^(08...|57P0[1-3]|E[A-Z]+)$/.test(code)) {
    errorCode = "connection_error";
  }
  return { result: "retry", errorCode };
}

export interface PublicSessionsDeps {
  /** The app_worker seat (DATABASE_URL_DIRECT in production). */
  db: Queryable;
}

export function createPublicSessionsDeliver({ db }: PublicSessionsDeps): DeliverFn {
  /** One session: the writer observes the fence, recomputes and CAS-clears in one call (D3). */
  async function projectSession(sessionId: string, eventId: string): Promise<string> {
    const projected = await db.query<{ disposition: string }>(
      "SELECT public_sessions_project_session($1, $2) AS disposition",
      [sessionId, eventId],
    );
    return String(projected.rows[0]?.disposition);
  }

  return async (job) => {
    try {
      const { aggregateType, aggregateId } = job.event;
      if (aggregateType !== "session" && aggregateType !== "tenant") {
        return dlq("unsupported_event");
      }
      if (typeof aggregateId !== "string" || !UUID_RE.test(aggregateId)) {
        return dlq("malformed_event");
      }
      let providerRef: string;
      if (aggregateType === "session") {
        providerRef = await projectSession(aggregateId, job.eventId);
      } else {
        const candidates = await db.query<{ id: string }>(
          "SELECT * FROM public_sessions_tenant_candidates($1) AS c(id) ORDER BY 1",
          [aggregateId],
        );
        for (const { id } of candidates.rows) await projectSession(id, job.eventId);
        providerRef = `tenant_${candidates.rows.length}`;
      }
      await db.query("SELECT public_sessions_sweep_expired($1)", [SWEEP_LIMIT]);
      return { result: "delivered", providerRef };
    } catch (error) {
      return retryFor(error);
    }
  };
}

let production: DeliverFn | undefined;

/**
 * The registry's public_sessions entry: a lazily created pool on DATABASE_URL_DIRECT, the
 * app_worker credential the preflight checks (the zalo_dm pattern); dispatcher.ts, worker.ts and
 * projectors/index.ts are unchanged. Still dark by default: 0056 seeds the row disabled, and
 * enabling it plus the R-2 backfill (readiness 4.7 (h)) is an owner P0 step.
 */
export const deliverPublicSessions: DeliverFn = async (job) => {
  const connectionString = process.env.DATABASE_URL_DIRECT;
  if (!connectionString) return dlq("config_missing");
  if (!production) {
    const pool = new pg.Pool({
      ...pgSslConnectionConfig(connectionString),
      max: 2,
      allowExitOnIdle: true,
    });
    pool.on("error", () => console.error("public_sessions: an idle pool client failed")); // no detail
    production = createPublicSessionsDeliver({ db: pool });
  }
  return production(job);
};
