#!/usr/bin/env node
/**
 * Owner CLI for the outbox dead-letter queue (lane L3, migration 0056; DD-134 (b): DLQ inspect and
 * replay are owner-only).
 *
 *   node scripts/outbox-dlq-replay.mjs list [--projector <name>] [--limit <1..500>]
 *   node scripts/outbox-dlq-replay.mjs replay --event <uuid> --projector <name>
 *
 * Owner path only: the credential is DATABASE_URL_MIGRATION, read from the environment and nowhere
 * else (a job_definer member after `pnpm db:bootstrap`). The CLI issues SET ROLE job_definer before
 * any call and RESET ROLE after, so it works whatever the role's INHERIT posture. app, app_worker and
 * readonly hold no EXECUTE on outbox_dlq_list / outbox_dlq_replay. No HTTP, no UI.
 *
 * Arguments are validated before connecting. Output never contains the connection string, a
 * credential or an event payload (outbox_dlq_list returns none). Exit codes: 0 done; 2 refusal
 * (invalid_argument, delivery_not_found, delivery_not_in_dlq); 1 any other error.
 * Procedure: docs/runbooks/outbox-dispatch-enable-rollback.md.
 */
import { createRequire } from "node:module";

const require = createRequire(new URL("../packages/db/package.json", import.meta.url));
const pg = require("pg");

const NAME_RE = /^[a-z][a-z0-9_]{0,63}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USAGE =
  "usage: outbox-dlq-replay.mjs list [--projector <name>] [--limit <1..500>] | replay --event <uuid> --projector <name>";
const REFUSAL_RE = /^(delivery_not_found|delivery_not_in_dlq):/;

class Refusal extends Error {}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (command !== "list" && command !== "replay") throw new Refusal(`invalid_argument: ${USAGE}`);
  const allowed = command === "list" ? ["--projector", "--limit"] : ["--event", "--projector"];
  const options = {};
  for (let i = 0; i < rest.length; i += 2) {
    const [flag, value] = [rest[i], rest[i + 1]];
    if (!allowed.includes(flag) || value === undefined || flag.slice(2) in options) {
      throw new Refusal(`invalid_argument: ${USAGE}`);
    }
    options[flag.slice(2)] = value;
  }
  if (options.projector !== undefined && !NAME_RE.test(options.projector)) {
    throw new Refusal("invalid_argument: --projector must match ^[a-z][a-z0-9_]{0,63}$");
  }
  if (command === "list") {
    const limit = options.limit === undefined ? 100 : Number(options.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new Refusal("invalid_argument: --limit must be an integer from 1 to 500");
    }
    return { command, projector: options.projector ?? null, limit };
  }
  if (!UUID_RE.test(options.event ?? "")) throw new Refusal("invalid_argument: --event must be a uuid");
  if (!options.projector) throw new Refusal("invalid_argument: --projector is required");
  return { command, eventId: options.event.toLowerCase(), projector: options.projector };
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

async function run(args, client) {
  if (args.projector) {
    const enabled = await client.query("SELECT projector_is_enabled($1) AS enabled", [args.projector]);
    if (enabled.rows[0]?.enabled !== true) {
      console.error(`warning: projector ${args.projector} is disabled or unknown; replayed rows wait until it is enabled`);
    }
  }
  if (args.command === "list") {
    const result = await client.query("SELECT * FROM outbox_dlq_list($1, $2)", [args.projector, args.limit]);
    for (const row of result.rows) console.log(JSON.stringify(row));
    console.log(`dlq rows: ${result.rows.length}`);
    return;
  }
  await client.query("SELECT outbox_dlq_replay($1, $2)", [args.eventId, args.projector]);
  console.log(`replayed: event ${args.eventId} projector ${args.projector} -> pending, attempts 0`);
}

async function main(argv, env) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    console.error(`refused: ${error.message}`);
    return error instanceof Refusal ? 2 : 1;
  }
  const url = env.DATABASE_URL_MIGRATION;
  if (!url) {
    console.error("error: DATABASE_URL_MIGRATION is not set (the owner credential; see the runbook)");
    return 1;
  }
  const client = new pg.Client({ connectionString: url, application_name: "plexco_outbox_dlq_cli" });
  try {
    await client.connect();
    await client.query("SET ROLE job_definer");
    try {
      await run(args, client);
    } finally {
      await client.query("RESET ROLE").catch(() => {});
    }
    return 0;
  } catch (error) {
    const message = redact(error?.message ?? error, url);
    if (REFUSAL_RE.test(message)) {
      console.error(`refused: ${message}`);
      return 2;
    }
    console.error(`error: ${error?.code ? `${error.code} ` : ""}${message}`);
    return 1;
  } finally {
    await client.end().catch(() => {});
  }
}

process.exitCode = await main(process.argv.slice(2), process.env);
