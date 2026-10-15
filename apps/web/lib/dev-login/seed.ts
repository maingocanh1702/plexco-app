import { randomUUID } from "node:crypto";
import { createDb, provisionTenant, SlugTakenError, type DbHandle } from "@plexco/db";
import { ensureDevClubMember } from "../../../../packages/db/scripts/dev-seed-club-members";
import {
  DEV_LOGIN_OPT_IN_RUN_AS,
  devLoginDatabaseVerdict,
  devLoginOptInCommand,
} from "./database-guard";
import { isLocalDatabaseUrl } from "./env-policy.mjs";
import { resolveDevPersonaAccount } from "./persona-account";
import { DEV_CLUB, DEV_PERSONAS, type DevPersonaKey } from "./personas";

/**
 * `pnpm dev:seed` (seed-cli.ts): the "Dev Club" tenant with an owner/host, a co_admin and a player
 * persona, every row created through the entry points the product itself uses:
 *  - account + Person (+ verified account_emails + account_identities): auth_login_google, via the
 *    SAME resolveDevPersonaAccount() the dev-login route calls (one derivation for both);
 *  - tenant + owner membership + owner admin row + free subscription + onboarding run:
 *    tenant_provision via provisionTenant(), the onboarding club-create path
 *    (app/api/onboarding/start/route.ts), idempotent for the same owner;
 *  - co_admin / player membership (+ co_admin admin row): no product entry point exists, so the
 *    narrowest existing DB entry point, documented in packages/db/scripts/dev-seed-club-members.ts.
 *
 * Refusals, in order:
 *  - BEFORE any connection: the database URL must name this machine (env-policy
 *    isLocalDatabaseUrl, the same rule the request gate uses) and the auth pepper must be the local
 *    ENCRYPTION_KEY (never a KMS-held production pepper);
 *  - after connecting, BEFORE any write (database-guard.ts, the same check the login handler runs):
 *    the database must be opted in at database level (plexco.dev_login = 'on', which only a
 *    superuser or a role granted SET ON PARAMETER can write; a host-string check cannot tell a
 *    local database from a port-forward to a shared one) and the role must be
 *    RLS-enforced (not superuser, not BYPASSRLS).
 *
 * Idempotent: a second run creates no tenant/person/account/email/identity/membership/admin row and
 * returns the same ids. What every run DOES append: one definer audit row per persona
 * (auth_audit_events, normally login_success / success / google / request_ref dev_seed_<uuid>),
 * i.e. 3 rows recording "logins" that never happened. There is no read-only path for app to find
 * an identity (every app-callable identity function writes), so the seed cannot avoid calling the
 * definer.
 */
export class DevSeedRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DevSeedRefusedError";
  }
}

export interface DevSeedResult {
  tenantId: string;
  personas: Record<DevPersonaKey, { accountId: string; personId: string; membershipId?: string }>;
}

export interface DevSeedDeps {
  /** Overridable for the refusal tests, which must prove no connection is ever attempted. */
  connect: (url: string) => DbHandle;
}

/** Every refusal, evaluated without touching the network. */
export function assertDevSeedEnvironment(
  env: Readonly<Record<string, string | undefined>>,
): string {
  const url = env.DATABASE_URL;
  if (!url) {
    throw new DevSeedRefusedError(
      "dev:seed refused: DATABASE_URL is not set (expected the local app-role URL, e.g. " +
        "postgres://app:<password>@localhost:5432/plexco).",
    );
  }
  if (!isLocalDatabaseUrl(url)) {
    throw new DevSeedRefusedError(
      "dev:seed refused: DATABASE_URL must point at localhost, 127.0.0.1, [::1] or the compose host " +
        "`postgres`, with no query string. The seed never writes to a database on another machine.",
    );
  }
  const kms = env.KMS_PROVIDER;
  if (kms !== undefined && kms !== "" && kms !== "local") {
    throw new DevSeedRefusedError(
      `dev:seed refused: KMS_PROVIDER is "${kms}". The seed derives identities only with the local ` +
        "ENCRYPTION_KEY, never with a KMS-held pepper.",
    );
  }
  if (!env.ENCRYPTION_KEY) {
    throw new DevSeedRefusedError(
      "dev:seed refused: ENCRYPTION_KEY is not set. Use the SAME value the dev server runs with " +
        "(generate once: openssl rand -base64 32), or dev-login cannot find the seeded personas.",
    );
  }
  return url;
}

export async function runDevSeed(
  env: Readonly<Record<string, string | undefined>>,
  deps: DevSeedDeps = { connect: (url) => createDb(url, { max: 2 }) },
): Promise<DevSeedResult> {
  const url = assertDevSeedEnvironment(env);
  const handle = deps.connect(url);
  try {
    const database = await devLoginDatabaseVerdict(handle.pool);
    if (!database.ok) {
      throw new DevSeedRefusedError(
        database.reason === "database_not_opted_in"
          ? `dev:seed refused: database "${database.database}" is not opted in to dev-login. As ` +
              `${DEV_LOGIN_OPT_IN_RUN_AS} run: ${devLoginOptInCommand(database.database)}`
          : "dev:seed refused: DATABASE_URL connects as a superuser or BYPASSRLS role; use the app " +
              "role (NOBYPASSRLS), the same role the web server runs as.",
      );
    }
    const accounts = {} as DevSeedResult["personas"];
    for (const persona of DEV_PERSONAS) {
      const login = await resolveDevPersonaAccount(
        handle.pool,
        persona,
        `dev_seed_${randomUUID()}`,
      );
      if (login.outcome !== "login_success") {
        throw new Error(`dev:seed: persona ${persona.key} resolved to ${login.outcome}`);
      }
      accounts[persona.key] = { accountId: login.accountId, personId: login.personId };
    }

    let tenantId: string;
    try {
      tenantId = await provisionTenant(handle.pool, {
        slug: DEV_CLUB.slug,
        name: DEV_CLUB.name,
        timezone: DEV_CLUB.timezone,
        locale: DEV_CLUB.locale,
        personId: accounts.owner.personId,
      });
    } catch (error) {
      if (error instanceof SlugTakenError) {
        throw new DevSeedRefusedError(
          `dev:seed: the slug "${DEV_CLUB.slug}" belongs to a club the dev owner persona does not ` +
            "own. Usually ENCRYPTION_KEY changed since the last seed (the persona identities are " +
            "keyed by it): restore the previous key, or reset the local dev database.",
        );
      }
      throw error;
    }

    for (const persona of DEV_PERSONAS) {
      if (persona.adminGrant === "owner") continue; // tenant_provision already made the owner rows
      const member = await ensureDevClubMember(handle.db, tenantId, {
        personId: accounts[persona.key].personId,
        displayName: persona.displayName,
        adminGrant: persona.adminGrant,
      });
      accounts[persona.key].membershipId = member.membershipId;
    }
    return { tenantId, personas: accounts };
  } finally {
    await handle.close();
  }
}
