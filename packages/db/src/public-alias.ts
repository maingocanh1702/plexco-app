import { and, eq, sql } from "drizzle-orm";
import { processedCommands } from "../schema.js";
import { authorizeTenantAction } from "./authorization.js";
import type { Db, Tx } from "./client.js";
import { CLUB_ACTION, ClubConfigError } from "./club-config.js";
import { pgErrorHasCode } from "./pg-error.js";
import { authorize } from "./tenant-capability-authority.js";
import { withTenant } from "./tenant.js";
import { hasHiddenChar, hasVisibleChar } from "./text-safety.js";

/**
 * Club public alias (Phase 3 L10a, migration 0060): the only club name that may ever become public
 * (DD-114 D3 precondition 4); tenants.name never is. A club `content.manage` caller sets it and every
 * set leaves it `pending`; only an owner decision (scripts/public-alias-moderate.mjs ->
 * tenant_public_alias_decide, no grant to app / app_worker / readonly) makes it `approved`.
 *
 * Role `app` holds no privilege on `tenants`: the GUC-bound definers tenant_public_alias_set / _read
 * are its only way in, and the set definer re-authorizes content.manage in the same transaction.
 */
export const PUBLIC_ALIAS_MAX = 60;
const COMMAND_TYPE = "SetPublicAlias";
const STATUSES = ["pending", "approved", "rejected"] as const;

export type PublicAliasStatus = (typeof STATUSES)[number];

export interface PublicAliasState {
  publicAlias: string | null;
  publicAliasStatus: PublicAliasStatus | null;
}

export interface SetPublicAliasParams {
  tenantId: string;
  actorPersonId: string;
  commandId: string;
  publicAlias: unknown;
}

export type SetPublicAliasResult = PublicAliasState & { changed: boolean; replayed: boolean };

/**
 * Trim, then 1..60 code points, no hidden character and at least one visible one: the display-name
 * rule of me-settings.ts over the same text-safety constants that the 0060 set definer enumerates.
 */
export function validatePublicAlias(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new ClubConfigError("INVALID_INPUT", "public alias must be a string");
  }
  const alias = raw.trim();
  const length = [...alias].length;
  if (length < 1 || length > PUBLIC_ALIAS_MAX || hasHiddenChar(alias) || !hasVisibleChar(alias)) {
    throw new ClubConfigError(
      "INVALID_INPUT",
      `public alias must be 1-${PUBLIC_ALIAS_MAX} printable characters`,
    );
  }
  return alias;
}

/** Fail closed: a status outside the enum (the CHECK forbids one) reads as no alias at all. */
function toState(row: Record<string, unknown> | undefined): PublicAliasState {
  const status = STATUSES.find((s) => s === row?.public_alias_status) ?? null;
  const alias = row?.public_alias;
  return {
    publicAlias: status && typeof alias === "string" ? alias : null,
    publicAliasStatus: status,
  };
}

async function readState(tx: Tx, tenantId: string): Promise<PublicAliasState> {
  const { rows } = await tx.execute(
    sql`SELECT public_alias, public_alias_status FROM tenant_public_alias_read(${tenantId}::uuid)`,
  );
  return toState(rows[0] as Record<string, unknown> | undefined);
}

/** The club's alias and its status. Authorization is the CALLER's job, as for getClubConfig. */
export async function getPublicAlias(
  db: Db,
  params: { tenantId: string },
): Promise<PublicAliasState> {
  return withTenant(db, params.tenantId, (tx) => readState(tx, params.tenantId));
}

/**
 * Sets the alias as `pending`; the identical trimmed text is a no-op whatever the status (M-5).
 * Validation runs before any DB call. Then the club-config order: authorize(content.manage), the
 * per-tenant `club-config:` key (taken before authorizeTenantAction share-locks the tenants row, or
 * two writers deadlock on the upgrade), the tenant-status axis, the commandId reservation + replay.
 * The commandId is recorded for a no-op too, so its replay stays a replay.
 */
export async function setPublicAlias(
  db: Db,
  params: SetPublicAliasParams,
): Promise<SetPublicAliasResult> {
  const { tenantId, actorPersonId, commandId } = params;
  const alias = validatePublicAlias(params.publicAlias);
  return withTenant(db, tenantId, async (tx) => {
    const decision = await authorize(tx, { tenantId, action: CLUB_ACTION, actorPersonId });
    if (!decision.allowed) throw new ClubConfigError("FORBIDDEN", decision.reason);
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended('club-config:' || ${tenantId}::uuid::text, 0))`,
    );
    const status = await authorizeTenantAction(tx, tenantId, "admin_mutation");
    if (!status.allowed) throw new ClubConfigError("TENANT_SUSPENDED", "tenant is suspended");

    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended('processed-command:' || ${tenantId}::uuid::text || ':' || ${commandId}, 0))`,
    );
    const prior = await tx
      .select({ commandType: processedCommands.commandType })
      .from(processedCommands)
      .where(
        and(eq(processedCommands.tenantId, tenantId), eq(processedCommands.commandId, commandId)),
      );
    if (prior.length > 0) {
      if (prior[0]!.commandType !== COMMAND_TYPE) {
        throw new ClubConfigError(
          "COMMAND_ID_CONFLICT",
          "command_id belongs to a different command",
        );
      }
      // A replay returns the CURRENT state and writes nothing.
      return { ...(await readState(tx, tenantId)), changed: false, replayed: true };
    }

    let row: Record<string, unknown> | undefined;
    try {
      const { rows } = await tx.execute(
        sql`SELECT public_alias, public_alias_status, changed FROM tenant_public_alias_set(${tenantId}::uuid, ${actorPersonId}::uuid, ${alias})`,
      );
      row = rows[0] as Record<string, unknown> | undefined;
    } catch (e) {
      // M-17: the definer's own re-check maps onto the same codes as the TS checks above.
      if (pgErrorHasCode(e, "42501")) throw new ClubConfigError("FORBIDDEN", "not permitted");
      if (pgErrorHasCode(e, "22023")) {
        throw new ClubConfigError("INVALID_INPUT", "invalid public alias");
      }
      throw e;
    }
    // Zero rows after both authorizations = infrastructure anomaly, never a 4xx.
    if (!row) throw new Error("setPublicAlias: tenant_public_alias_set returned no row");
    const changed = row.changed === true;
    await tx
      .insert(processedCommands)
      .values({ tenantId, commandId, commandType: COMMAND_TYPE, resultRef: { changed } });
    return { ...toState(row), changed, replayed: false };
  });
}
