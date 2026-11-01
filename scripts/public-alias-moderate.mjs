#!/usr/bin/env node
/**
 * Owner CLI for club public alias moderation (Phase 3 L10a, migration 0060; no UI in the MVP).
 *
 *   node scripts/public-alias-moderate.mjs list
 *   node scripts/public-alias-moderate.mjs approve --tenant <uuid> --sha256 <64 lowercase hex>
 *   node scripts/public-alias-moderate.mjs reject --tenant <uuid> --sha256 <64 lowercase hex>
 *
 * Owner path only: the credential is DATABASE_URL_MIGRATION, read from the environment and nowhere
 * else; no SET ROLE (the migration role owns the 0060 definers). app, app_worker and readonly hold no
 * EXECUTE on tenant_public_alias_decide / tenant_public_alias_pending. `list` prints one JSON line
 * per pending alias, {tenantId, publicAlias, aliasSha256}: no tenant name, slug, person or host.
 * approve / reject take the digest printed by `list` (compare-and-set: a text changed since the
 * listing is refused) and record decided_by 'owner-cli'; each decision writes one audit row and one
 * outbox event in the definer's transaction.
 *
 * Arguments are validated before connecting. Output never contains the connection string or a
 * credential. Exit codes: 0 done; 2 refused (bad arguments, or SQLSTATE 22023 invalid arguments,
 * P0002 tenant not found, 55000 alias changed or decision already applied); 1 any other error or
 * DATABASE_URL_MIGRATION unset.
 */
import { createRequire } from "node:module";
import { operatorCliPgConfig } from "./lib/operator-cli-pg-config.mjs";
const require = createRequire(new URL("../packages/db/package.json", import.meta.url));
const pg = require("pg");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/;
const DECISIONS = { approve: "approved", reject: "rejected" };
const REFUSAL_CODES = new Set(["22023", "P0002", "55000"]);
const USAGE =
  "usage: public-alias-moderate.mjs list | approve --tenant <uuid> --sha256 <hex> | reject --tenant <uuid> --sha256 <hex>";

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (command === "list" && rest.length === 0) return { command };
  if (!Object.hasOwn(DECISIONS, command ?? "")) throw new Error(USAGE);
  const options = {};
  for (let i = 0; i < rest.length; i += 2) {
    const [flag, value] = [rest[i], rest[i + 1]];
    if ((flag !== "--tenant" && flag !== "--sha256") || value === undefined || flag in options) {
      throw new Error(USAGE);
    }
    options[flag] = value;
  }
  if (!UUID_RE.test(options["--tenant"] ?? "")) throw new Error("--tenant must be a uuid");
  if (!SHA256_RE.test(options["--sha256"] ?? "")) {
    throw new Error("--sha256 must be 64 lowercase hex characters");
  }
  return {
    command,
    tenantId: options["--tenant"].toLowerCase(),
    decision: DECISIONS[command],
    digest: options["--sha256"],
  };
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
  if (args.command === "list") {
    const { rows } = await client.query(
      "SELECT tenant_id, public_alias, alias_sha256 FROM tenant_public_alias_pending()",
    );
    for (const r of rows) {
      // JSON.stringify escapes control characters; 0060 refuses them and bidi marks anyway.
      console.log(
        JSON.stringify({ tenantId: r.tenant_id, publicAlias: r.public_alias, aliasSha256: r.alias_sha256 }),
      );
    }
    return;
  }
  const { rows } = await client.query(
    "SELECT tenant_id, public_alias_status FROM tenant_public_alias_decide($1, $2, $3, 'owner-cli')",
    [args.tenantId, args.decision, args.digest],
  );
  console.log(JSON.stringify({ tenantId: rows[0].tenant_id, status: rows[0].public_alias_status }));
}

async function main(argv, env) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    console.error(`refused: ${error.message}`);
    return 2;
  }
  const url = env.DATABASE_URL_MIGRATION;
  if (!url) {
    console.error("error: DATABASE_URL_MIGRATION is not set (the owner credential)");
    return 1;
  }
  // Built inside the try: pg parses the URL in the constructor, so a malformed one ends in the
  // redacted `error:` line below rather than an uncaught stack trace.
  let client;
  try {
    client = new pg.Client({
      ...(await operatorCliPgConfig(url, env)),
      application_name: "plexco_public_alias_cli",
    });
    await client.connect();
    await run(args, client);
    return 0;
  } catch (error) {
    const message = redact(error?.message ?? error, url);
    if (REFUSAL_CODES.has(error?.code)) {
      console.error(`refused: ${message}`);
      return 2;
    }
    console.error(`error: ${error?.code ? `${error.code} ` : ""}${message}`);
    return 1;
  } finally {
    await client?.end().catch(() => {});
  }
}

process.exitCode = await main(process.argv.slice(2), process.env);
