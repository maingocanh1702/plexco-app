import pg from "pg";
import { QUEUES } from "./queues.js";
import { QUEUE_SCHEMA } from "./queue.js";

const REQUIRED_TABLE_PRIVILEGES = ["SELECT", "INSERT", "UPDATE", "DELETE"] as const;
const EXPECTED_IDENTITY = "app_worker";

export interface PreflightResult {
  ok: boolean;
  failures: string[];
}

/**
 * DD-90 Q6 fail-closed preflight (docs/standards/decisions.md:1140-1144).
 * Connects as app_worker and asserts exactly what pg-boss's own
 * `boss.start()` (migrate:false -> contractor.check(), see
 * node_modules/pg-boss/src/contractor.js) does NOT already check — schema-
 * existence and version-staleness stay pg-boss's own job there (JRD-18
 * proves that boundary actually holds instead of only being assumed). This
 * adds: every queue this repo registers has an actual `queue` row AND its
 * hashed partition table genuinely exists and is attached to
 * `${QUEUE_SCHEMA}.job` (a surviving row with a dropped/detached partition
 * would otherwise read as "provisioned" — the real failure mode Q6 names:
 * "mọi queue mới bắt buộc qua provision trước khi worker dùng"), and
 * app_worker holds the exact catalog grants it needs (schema USAGE, table
 * DML, sequence USAGE) — all enumerated from the live catalog at runtime,
 * never a hard-coded object list, since pg-boss creates its own internal
 * objects (e.g. its `__pgboss__send-it` maintenance queue) that a fixed
 * list would silently skip.
 *
 * DELIBERATELY OUT OF SCOPE (founder decision, 2026-07-27, post round-06):
 * verifying app_worker does NOT hold MORE than the required privileges
 * (role-attribute drift, forbidden CREATE/job_definer-membership,
 * ownership, an excess-privilege denylist). DD-90 Q6's own text asks this
 * preflight to assert presence of required grants — "assert pgboss schema/
 * base objects, mọi queue registry và exact catalog grants/sequence usage;
 * thiếu bất kỳ item nào ⇒ exit non-zero" — not absence of excess ones.
 * Least-privilege attestation is a DIFFERENT, structurally unbounded
 * control (there is no closed set of "things a role must NOT have"), and
 * it belongs in a DIFFERENT seat: a preflight running AS app_worker cannot
 * credibly attest that app_worker is not over-privileged (the credible
 * version of that check runs from an independent, privileged vantage
 * point — see packages/db's own job_definer-owns-exactly-its-allowlist
 * tests, Verdict 23 / OAM-9, which compare against a migration-owned
 * allowlist rather than self-attesting). Folding it into this boot-time
 * fail-closed gate also adds a new availability risk: an unrelated,
 * legitimate future privilege change would kill the worker at startup.
 * Six codex rounds (01-06) progressively added exactly this class of
 * check; all were reverted here in one pass rather than continuing to grow
 * an open-ended allowlist/denylist. If least-privilege attestation is
 * wanted, it belongs in its own packages/db slice, bounded against an
 * allowlist a migration owns.
 *
 * ALSO DELIBERATELY OUT OF SCOPE: verifying pg-boss's own fixed base
 * relations (version/queue/job/archive/schedule/subscription) are ALL
 * present, beyond the per-queue partition check above. Codex re-raised this
 * in round-07 after round-06 first found it; the founder's own round-06
 * response traced it to an imprecise paraphrase in this slice's readiness
 * verdict ("pgboss schema and base objects" reads as two distinct asserted
 * things; DD-90 Q6's own text — quoted above — does not clearly require
 * enumerating pg-boss's fixed internal tables individually) and directed it
 * be dropped, corrected at the verdict source rather than patched here
 * again. pg-boss's own `contractor.check()` already asserts the schema
 * VERSION matches exactly (JRD-18); it does not separately enumerate every
 * base table, but neither does DD-90 Q6 unambiguously ask this preflight
 * to. Recorded here explicitly so a future round does not re-derive the
 * same already-declined requirement a third time.
 *
 * Every check below is independently wrapped: a privilege function on a
 * NOT-YET-EXISTENT schema/table raises rather than returning false/NULL
 * (verified directly against Postgres, not assumed), so "the object doesn't
 * exist yet" and "the object exists but isn't granted" both surface as a
 * failure line here instead of one of them throwing past this function.
 *
 * assertIdentity runs first: has_*_privilege(current_user, ...) is TRUE for
 * a superuser/migration role on everything, by definition, and current_user
 * itself can be switched post-connect (SET ROLE / a `-c role=` startup
 * option) without re-authenticating — so both current_user AND session_user
 * (who actually authenticated) must be app_worker before any privilege
 * check below is meaningful.
 */
export async function runPreflightChecks(directConnectionString: string): Promise<PreflightResult> {
  const failures: string[] = [];
  const client = new pg.Client({ connectionString: directConnectionString });
  await client.connect();
  try {
    await assertIdentity(client, failures);
    await assertSchemaUsage(client, failures);
    await assertQueuesProvisioned(client, failures);
    await assertTableGrants(client, failures);
    await assertSequenceGrants(client, failures);
  } finally {
    await client.end();
  }
  return { ok: failures.length === 0, failures };
}

async function assertIdentity(client: pg.Client, failures: string[]): Promise<void> {
  const identity = await client.query<{ session_user: string; current_user: string }>(
    "SELECT session_user, current_user",
  );
  const sessionUser = identity.rows[0]?.session_user;
  const currentUser = identity.rows[0]?.current_user;
  // codex round-05 [P1]: session_user (who actually AUTHENTICATED) and
  // current_user (whose privileges currently apply) can differ — a
  // connection string carrying `options=-c role=app_worker`, or a `SET ROLE
  // app_worker` issued right after connecting, makes current_user read as
  // app_worker while session_user still holds the original, possibly-
  // elevated authenticated identity, which can `RESET ROLE` back to it at
  // any time. Requiring both closes that gap — the connection must have
  // authenticated AS app_worker directly.
  if (sessionUser !== EXPECTED_IDENTITY || currentUser !== EXPECTED_IDENTITY) {
    failures.push(
      `session_user="${sessionUser}", current_user="${currentUser}", expected both to be "${EXPECTED_IDENTITY}" — ` +
        `DATABASE_URL_DIRECT must authenticate AS app_worker directly, never via a role switch (SET ROLE / connection-string role= option) from a different credential (every privilege check below is meaningless otherwise)`,
    );
  }
}

async function checkPrivilege(
  client: pg.Client,
  sql: string,
  params: unknown[],
  failureMessage: string,
  failures: string[],
): Promise<void> {
  try {
    const result = await client.query<{ ok: boolean | null }>(sql, params);
    if (result.rows[0]?.ok !== true) {
      failures.push(failureMessage);
    }
  } catch (error) {
    failures.push(`${failureMessage} (${describeError(error)})`);
  }
}

async function assertSchemaUsage(client: pg.Client, failures: string[]): Promise<void> {
  await checkPrivilege(
    client,
    "SELECT has_schema_privilege(current_user, $1, 'USAGE') AS ok",
    [QUEUE_SCHEMA],
    `missing USAGE privilege on schema "${QUEUE_SCHEMA}"`,
    failures,
  );
}

async function assertQueuesProvisioned(client: pg.Client, failures: string[]): Promise<void> {
  if (QUEUES.length === 0) return;
  let rows: Map<string, string>;
  try {
    const result = await client.query<{ name: string; partition_name: string }>(
      `SELECT name, partition_name FROM ${QUEUE_SCHEMA}.queue WHERE name = ANY($1::text[])`,
      [QUEUES],
    );
    rows = new Map(result.rows.map((r) => [r.name, r.partition_name]));
  } catch (error) {
    for (const queue of QUEUES) {
      failures.push(
        `queue "${queue}" is registered but ${QUEUE_SCHEMA}.queue could not be read (${describeError(error)}) — run provision:queue`,
      );
    }
    return;
  }
  for (const queue of QUEUES) {
    const partitionName = rows.get(queue);
    if (partitionName === undefined) {
      failures.push(
        `queue "${queue}" is registered but has no ${QUEUE_SCHEMA}.queue row — run provision:queue`,
      );
      continue;
    }
    // A queue row surviving with its partition dropped/detached (manual
    // cleanup, a failed migration, direct DBA intervention) would otherwise
    // read as "provisioned" here while pg-boss can neither enqueue nor
    // dequeue jobs for it — the row alone proves nothing about the actual
    // partition. pg_inherits is the authoritative record of a declarative
    // partition's attachment, independent of whether a same-named table
    // merely happens to exist.
    await checkPrivilege(
      client,
      `SELECT EXISTS (
         SELECT 1 FROM pg_inherits i
         JOIN pg_class child ON child.oid = i.inhrelid
         JOIN pg_namespace child_ns ON child_ns.oid = child.relnamespace
         JOIN pg_class parent ON parent.oid = i.inhparent
         JOIN pg_namespace parent_ns ON parent_ns.oid = parent.relnamespace
         WHERE child_ns.nspname = $1 AND child.relname = $2
           AND parent_ns.nspname = $1 AND parent.relname = 'job'
       ) AS ok`,
      [QUEUE_SCHEMA, partitionName],
      `queue "${queue}" has a ${QUEUE_SCHEMA}.queue row but its partition "${QUEUE_SCHEMA}.${partitionName}" is missing or not attached to ${QUEUE_SCHEMA}.job — run provision:queue`,
      failures,
    );
  }
}

async function assertTableGrants(client: pg.Client, failures: string[]): Promise<void> {
  const result = await client.query<{ relname: string }>(
    `SELECT c.relname FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relkind IN ('r','p')`,
    [QUEUE_SCHEMA],
  );
  for (const { relname } of result.rows) {
    for (const privilege of REQUIRED_TABLE_PRIVILEGES) {
      await checkPrivilege(
        client,
        "SELECT has_table_privilege(current_user, $1, $2) AS ok",
        [`${QUEUE_SCHEMA}.${relname}`, privilege],
        `missing ${privilege} privilege on table "${QUEUE_SCHEMA}.${relname}"`,
        failures,
      );
    }
  }
}

async function assertSequenceGrants(client: pg.Client, failures: string[]): Promise<void> {
  // codex round-03 [P2]: information_schema.sequences is ACL-filtered — it
  // only lists sequences the CURRENT connection already has some privilege
  // on, so a sequence app_worker has lost its ONLY grant on (exactly the
  // failure this check exists to catch) would silently vanish from that
  // view, making the loop below run zero times and report success. pg_class
  // is not ACL-filtered (mirrors assertTableGrants's own approach above).
  const result = await client.query<{ relname: string }>(
    `SELECT c.relname FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relkind = 'S'`,
    [QUEUE_SCHEMA],
  );
  for (const { relname } of result.rows) {
    await checkPrivilege(
      client,
      "SELECT has_sequence_privilege(current_user, $1, 'USAGE') AS ok",
      [`${QUEUE_SCHEMA}.${relname}`],
      `missing USAGE privilege on sequence "${QUEUE_SCHEMA}.${relname}"`,
      failures,
    );
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Fail-closed wrapper — worker.ts calls this BEFORE constructing any PgBoss
 * instance or calling boss.start(), so a failure here means zero pg-boss
 * startup or maintenance work has happened (JRD-4).
 */
export async function preflightOrExit(directConnectionString: string): Promise<void> {
  const result = await runPreflightChecks(directConnectionString);
  if (!result.ok) {
    console.error("[preflight] FAILED — refusing to start worker:");
    for (const failure of result.failures) {
      console.error(`[preflight]   - ${failure}`);
    }
    process.exit(1);
  }
  console.log("[preflight] passed");
}
