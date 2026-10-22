#!/usr/bin/env node
/**
 * Owner CLI that enables an outbox projector with a bounded backfill (lane L24, owner decision item 1 of
 * 2026-10-22; design: docs/sessions/web-mvp-phase3-readiness-p3-outbox-projector-enable-no-loss.md 3.2
 * and D1-D9; procedure: docs/runbooks/outbox-dispatch-enable-rollback.md). It is the only sanctioned
 * enable step; the disable (rollback) stays outbox_projector_set_enabled(name, false).
 *
 *   node scripts/outbox-projector-enable.mjs enable --projector <name>
 *
 * Why: an event acked while a projector was disabled has no delivery row for it and nothing prepares one
 * later. This CLI enables the projector and then reaches those events, once:
 *   1. Transaction 1 locks the projector row and refuses (unacked_backlog; nothing enabled) while an event
 *      routed to it is unacked and older than the bound (AM1: drain first, let the worker ack); otherwise
 *      it calls outbox_projector_set_enabled(name, true).
 *   2. Transaction 2 (after 1 committed) locks the row again (projector_disabled if a disable came in
 *      between) and classifies, in ONE scan, every routed event with no delivery row and no expiry record
 *      for the projector (AM5): unacked -> job_prepare_projector_delivery, outside the cap; acked, within
 *      the bound and among the newest BACKFILL_MAX_ROWS -> the same; every other acked one -> ONE expiry
 *      record in job_audit_events, reason 'projector_delivery_expired:<name>:age' or ':cap'. That one
 *      result feeds two set-based statements (the prepares over an id array, the records as one
 *      INSERT ... SELECT), so the row lock a DD-134 disable waits for is held for three statements, not
 *      one round trip per candidate. Prepared rows are delivered by the unchanged DD-134 path; a record is
 *      only ever written for an acked event, which is never claimed again, so no record is followed by a
 *      delivery.
 *   3. public_sessions only: the canonical rebuild (public_sessions_tenant_candidates +
 *      public_sessions_project_session) for every tenant that has an outbox event (D7): the tenant list is
 *      read once, then ONE transaction per tenant, each opening with a plain read of `enabled` (no row
 *      lock, so a DD-134 disable never waits for the rebuild). A disable stops it with projector_disabled;
 *      the tenants rebuilt before it stay committed.
 * A re-run adds no row and no record; it is also the recovery after an enable with the raw function and
 * after an exit 1 that came once transaction 1 had committed (the projector is then enabled).
 *
 * Threat model (readiness 6.2): (1) silent loss for a projector enabled later: every routed event ends
 * delivered or expired with a record; (2) a stale flood at enable time: bounded by age and count;
 * (3) a fail-open boot: nothing here runs at boot, and with every projector disabled nothing is delivered;
 * (4) duplicate delivery: one row per (event, projector) (ON CONFLICT DO NOTHING) and NOT EXISTS checks
 * under the projector row lock; (5) cross-tenant leakage: a record carries its own event's tenant_id and
 * the rebuild runs one tenant at a time.
 *
 * Owner path only, as scripts/outbox-dlq-replay.mjs: the credential is DATABASE_URL_MIGRATION, read from
 * the environment and nowhere else (a job_definer member after `pnpm db:bootstrap`). Every statement runs
 * in a READ COMMITTED transaction (D9; public_sessions_project_session raises 25000 otherwise) after
 * SET LOCAL ROLE job_definer, so the role ends with each transaction. job_definer owns or reads every
 * object touched: no new function, grant, role or migration (RO-L24-1). Arguments are validated before
 * connecting. Output is ONE JSON line with the projector name, the changed flag and counts only: never the
 * connection string, a credential, an event payload or the run's operation_id. Exit codes: 0 done;
 * 2 refusal (invalid_argument, projector_not_found, unacked_backlog, projector_disabled); 1 any other error.
 */
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

// D2 and D3 of the readiness file (Tier B defaults, pending owner sign-off).
// BACKFILL_MAX_AGE_MINUTES caps an event's age when its delivery row is PREPARED. It is of the order of
// DD-134's own retry stretch (8 attempts, waits of 15 s x 2^(n-1) = 1905 s of backoff), so a backfilled DM
// lands at worst about 70 minutes after its event against about 39 on the live path (AM2).
// BACKFILL_MAX_ROWS is the flood guard of threat 2 (readiness 6.2): at most this many ACKED in-window
// events per projector per run, newest first; every other acked candidate gets an expiry record.
export const BACKFILL_MAX_AGE_MINUTES = 30;
export const BACKFILL_MAX_ROWS = 200;

const NAME_RE = /^[a-z][a-z0-9_]{0,63}$/;
const USAGE = "usage: outbox-projector-enable.mjs enable --projector <name>";
const EXPIRY_REASON = "projector_delivery_expired";

export class Refusal extends Error {
  constructor(code, detail) {
    super(`${code}: ${detail}`);
    this.name = "Refusal";
    this.code = code;
  }
}

// The routing rule of outbox_required_projectors (0056:131-136): the route's aggregate type and its exact
// event type or the NULL wildcard. $1 = the projector, o = the outbox_events row.
const ROUTED_TO_PROJECTOR = `EXISTS (
  SELECT 1 FROM outbox_projector_routes r
   WHERE r.projector = $1
     AND r.aggregate_type = o.aggregate_type
     AND (r.event_type IS NULL OR r.event_type = o.type))`;

const UNACKED_BACKLOG_SQL = `
SELECT count(*)::int AS n
  FROM outbox_events o
 WHERE o.acked_at IS NULL
   AND o.created_at < clock_timestamp() - make_interval(mins => $2::int)
   AND ${ROUTED_TO_PROJECTOR}`;

// One scan, classified per AM5 against ONE DB-clock cutoff. No acked_at filter: a claimed but unacked event
// is a candidate too. The record check matches the exact prefix (starts_with, not LIKE: the '_' a projector
// name may hold is a LIKE wildcard).
// ponytail: full-history scan (a seq scan over outbox_events per run; its result then feeds one prepare
// statement and one INSERT, each over arrays of every candidate); add an index or a created_at floor when
// the table grows.
const CANDIDATES_SQL = `
WITH bound AS MATERIALIZED (
  SELECT clock_timestamp() - make_interval(mins => $2::int) AS cutoff
), candidates AS (
  SELECT o.id, o.tenant_id, o.created_at,
         o.acked_at IS NULL AS unacked,
         o.created_at >= bound.cutoff AS in_window
    FROM outbox_events o CROSS JOIN bound
   WHERE ${ROUTED_TO_PROJECTOR}
     AND NOT EXISTS (SELECT 1 FROM projector_deliveries d WHERE d.event_id = o.id AND d.projector = $1)
     AND NOT EXISTS (SELECT 1 FROM job_audit_events a WHERE a.job_id = o.id AND starts_with(a.reason, $4))
)
SELECT id, tenant_id,
       CASE
         WHEN unacked THEN 'prepare'
         WHEN NOT in_window THEN 'age'
         WHEN row_number() OVER (PARTITION BY unacked, in_window ORDER BY created_at DESC, id DESC) <= $3::int
           THEN 'prepare'
         ELSE 'cap'
       END AS action
  FROM candidates`;

/** Runs `work` in one READ COMMITTED transaction as job_definer (D9); any throw, a Refusal too, rolls back. */
async function inOwnerTransaction(client, work) {
  await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
  try {
    await client.query("SET LOCAL ROLE job_definer");
    const result = await work();
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

/**
 * Enables `projector` and reaches the events it missed while disabled (steps 1-3 of the header).
 * `client` is a connected pg.Client on the owner path. Returns the summary; throws a Refusal for exit 2.
 */
export async function enableProjector(client, projector) {
  const changed = await inOwnerTransaction(client, async () => {
    const found = await client.query("SELECT 1 FROM outbox_projectors WHERE name = $1 FOR UPDATE", [projector]);
    if (found.rowCount === 0) throw new Refusal("projector_not_found", projector);
    const backlog = await client.query(UNACKED_BACKLOG_SQL, [projector, BACKFILL_MAX_AGE_MINUTES]);
    const unacked = backlog.rows[0].n;
    if (unacked > 0) {
      throw new Refusal(
        "unacked_backlog",
        `${unacked} routed events are unacked and older than ${BACKFILL_MAX_AGE_MINUTES} minutes; let the worker ack them (runbook), then re-run`,
      );
    }
    const set = await client.query("SELECT outbox_projector_set_enabled($1, true) AS changed", [projector]);
    return set.rows[0].changed === true;
  });

  const counts = await inOwnerTransaction(client, async () => {
    const row = await client.query("SELECT enabled FROM outbox_projectors WHERE name = $1 FOR UPDATE", [projector]);
    if (row.rows[0]?.enabled !== true) {
      throw new Refusal("projector_disabled", `${projector} was disabled before the backfill; nothing was prepared`);
    }
    const prefix = `${EXPIRY_REASON}:${projector}:`;
    const candidates = await client.query(CANDIDATES_SQL, [
      projector,
      BACKFILL_MAX_AGE_MINUTES,
      BACKFILL_MAX_ROWS,
      prefix,
    ]);
    const operationId = randomUUID(); // one per run: written into the records, never printed
    const out = { prepared: 0, expired_age: 0, expired_cap: 0 };
    const prepareIds = [];
    const expiry = { ids: [], tenantIds: [], reasons: [] };
    for (const { id, tenant_id: tenantId, action } of candidates.rows) {
      if (action === "prepare") {
        prepareIds.push(id);
        out.prepared += 1;
        continue;
      }
      expiry.ids.push(id);
      expiry.tenantIds.push(tenantId);
      expiry.reasons.push(prefix + action);
      if (action === "age") out.expired_age += 1;
      else out.expired_cap += 1;
    }
    // The one classification above feeds both statements, so an event lands in exactly one of them.
    await client.query("SELECT job_prepare_projector_delivery(id, $1) FROM unnest($2::uuid[]) AS id", [
      projector,
      prepareIds,
    ]);
    await client.query(
      `INSERT INTO job_audit_events (job_id, tenant_id, actor, reason, fn_name, operation_id, created_at)
       SELECT t.id, t.tenant_id, 'owner', t.reason, 'outbox_projector_enable', $1, clock_timestamp()
         FROM unnest($2::uuid[], $3::uuid[], $4::text[]) AS t(id, tenant_id, reason)`,
      [operationId, expiry.ids, expiry.tenantIds, expiry.reasons],
    );
    return out;
  });

  let rebuilt = 0;
  if (projector === "public_sessions") {
    const tenants = await inOwnerTransaction(client, async () =>
      (await client.query("SELECT DISTINCT tenant_id FROM outbox_events")).rows.map((r) => r.tenant_id),
    );
    // ponytail: one transaction per tenant that ever produced an outbox event (D7), so a tenant's session
    // locks end at its commit; a tenant with more candidate sessions than the shared lock table holds
    // (about 64 x 100 by default) still fails. Narrow the set or split a tenant when that grows.
    for (const [done, tenantId] of tenants.entries()) {
      const sessions = await inOwnerTransaction(client, async () => {
        const row = await client.query("SELECT enabled FROM outbox_projectors WHERE name = $1", [projector]);
        if (row.rows[0]?.enabled !== true) {
          throw new Refusal(
            "projector_disabled",
            `${projector} was disabled during the rebuild; ${done} of ${tenants.length} tenants rebuilt`,
          );
        }
        const result = await client.query(
          "SELECT public_sessions_project_session(c, NULL) FROM public_sessions_tenant_candidates($1) AS c",
          [tenantId],
        );
        return result.rowCount;
      });
      rebuilt += sessions;
    }
  }
  return { projector, changed, ...counts, rebuilt_sessions: rebuilt };
}

function parseArgs(argv) {
  if (argv.length !== 3 || argv[0] !== "enable" || argv[1] !== "--projector") {
    throw new Refusal("invalid_argument", USAGE);
  }
  if (!NAME_RE.test(argv[2])) {
    throw new Refusal("invalid_argument", "--projector must match ^[a-z][a-z0-9_]{0,63}$");
  }
  return argv[2];
}

/** Removes the connection string and its password from a message, should a driver ever echo them. */
function redact(message, url) {
  let out = String(message).split(url).join("<redacted>");
  try {
    const password = decodeURIComponent(new URL(url).password);
    if (password) out = out.split(password).join("<redacted>");
  } catch {
    // an unparseable URL has no password to strip; pg rejects it before connecting
  }
  return out;
}

async function main(argv, env) {
  let projector;
  try {
    projector = parseArgs(argv);
  } catch (error) {
    console.error(`refused: ${error.message}`);
    return 2;
  }
  const url = env.DATABASE_URL_MIGRATION;
  if (!url) {
    console.error("error: DATABASE_URL_MIGRATION is not set (the owner credential; see the runbook)");
    return 1;
  }
  const pg = createRequire(new URL("../packages/db/package.json", import.meta.url))("pg");
  const client = new pg.Client({ connectionString: url, application_name: "plexco_outbox_projector_enable_cli" });
  try {
    await client.connect();
    console.log(JSON.stringify(await enableProjector(client, projector)));
    return 0;
  } catch (error) {
    const message = redact(error?.message ?? error, url);
    if (error instanceof Refusal) {
      console.error(`refused: ${message}`);
      return 2;
    }
    console.error(`error: ${error?.code ? `${error.code} ` : ""}${message}`);
    console.error(
      "if the enable step had committed, the projector stays enabled: re-run this command (it is idempotent) or disable it",
    );
    return 1;
  } finally {
    await client.end().catch(() => {});
  }
}

// The CLI runs only when this file is executed directly; tests import enableProjector.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2), process.env);
}
