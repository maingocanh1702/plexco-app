import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "./client.js";
import { onboardingRuns, onboardingSteps, processedCommands, sports } from "../schema.js";
import { authorizeTenantAction } from "./authorization.js";
import { authorize } from "./tenant-capability-authority.js";
import { withTenant } from "./tenant.js";
import {
  bad,
  ClubConfigError,
  KEY_PRICE,
  KEY_SPORT,
  KEY_VISIBILITY,
  readConfig,
  upsertSetting,
  validatePatch,
  type ClubConfig,
  type ClubConfigPatch,
} from "./club-config-validation.js";

export {
  ClubConfigError,
  type ClubConfig,
  type ClubConfigErrorCode,
  type ClubConfigPatch,
} from "./club-config-validation.js";

/**
 * Club configuration (WAO club step): name, timezone, language, default sport / price / visibility.
 *
 * STORAGE: name/timezone/locale live ONLY in `tenants` (one authority per fact) and are reached
 * through the 0052 SECURITY DEFINER pair `tenant_profile_read/update` -- role `app` has no
 * privilege on the table itself (0035). The three defaults live in `settings` (`club.default_*`).
 *
 * Authority: `authorize(content.manage)` (DD-56 matrix: tenant content/settings excluding
 * secrets/billing); the definer re-checks it under the same transaction. Authorization runs
 * BEFORE the dedup read so a replay never answers a caller who no longer holds the capability.
 */
export const CLUB_ACTION = "content.manage";
const COMMAND_TYPE = "UpdateClubConfig";
const STEP = "club_config";

export interface UpdateClubConfigParams {
  tenantId: string;
  actorPersonId: string;
  commandId: string;
  patch: ClubConfigPatch;
}

export interface UpdateClubConfigResult {
  club: ClubConfig;
  step: "verified";
  replayed: boolean;
}

export async function updateClubConfig(
  db: Db,
  params: UpdateClubConfigParams,
): Promise<UpdateClubConfigResult> {
  const { tenantId, actorPersonId, commandId } = params;
  return withTenant(db, tenantId, async (tx) => {
    const decision = await authorize(tx, { tenantId, action: CLUB_ACTION, actorPersonId });
    if (!decision.allowed) throw new ClubConfigError("FORBIDDEN", decision.reason);
    // Tenant-status axis (billing): a suspended/cancelled club freezes admin mutations. Orthogonal
    // to authorize(); the subscription row it reads is created by tenant_provision (0037).
    const status = await authorizeTenantAction(tx, tenantId, "admin_mutation");
    if (!status.allowed) throw new ClubConfigError("TENANT_SUSPENDED", "tenant is suspended");

    // Command-type-independent key reservation, same as the session family.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended('processed-command:' || ${tenantId}::uuid::text || ':' || ${commandId}, 0))`,
    );
    const prior = await tx
      .select({
        commandType: processedCommands.commandType,
        resultRef: processedCommands.resultRef,
      })
      .from(processedCommands)
      .where(
        and(eq(processedCommands.tenantId, tenantId), eq(processedCommands.commandId, commandId)),
      );
    if (prior.length > 0) {
      // Replay returns the CURRENT config (not a stored snapshot): no PII/ledger copy, same zero-mutation.
      if (prior[0]!.commandType !== COMMAND_TYPE) {
        throw new ClubConfigError(
          "COMMAND_ID_CONFLICT",
          "command_id belongs to a different command",
        );
      }
      return { club: await readConfig(tx, tenantId), step: "verified" as const, replayed: true };
    }

    const patch = validatePatch(params.patch);
    if (patch.defaultSportKey !== undefined) {
      const rows = await tx
        .select({ active: sports.active })
        .from(sports)
        .where(eq(sports.key, patch.defaultSportKey));
      if (rows.length === 0 || rows[0]!.active !== true) bad("sport is not in the active taxonomy");
    }

    const [run] = await tx
      .select({ id: onboardingRuns.id })
      .from(onboardingRuns)
      .where(eq(onboardingRuns.tenantId, tenantId))
      .orderBy(desc(onboardingRuns.createdAt))
      .limit(1);
    if (!run) throw new ClubConfigError("NO_ONBOARDING_RUN", "no onboarding run");

    if (patch.name !== undefined || patch.timezone !== undefined || patch.locale !== undefined) {
      // NULL = leave unchanged inside the definer; it re-authorizes content.manage under the GUC.
      const updated = await tx.execute(
        sql`SELECT id FROM tenant_profile_update(${tenantId}::uuid, ${actorPersonId}::uuid, ${patch.name ?? null}, ${patch.timezone ?? null}, ${patch.locale ?? null})`,
      );
      // Zero rows after authorize + the onboarding-run read = infrastructure anomaly, never a 4xx.
      if (updated.rows.length !== 1) {
        throw new Error("updateClubConfig: tenant_profile_update returned no row");
      }
    }
    if (patch.defaultSportKey !== undefined)
      await upsertSetting(tx, tenantId, KEY_SPORT, patch.defaultSportKey);
    if (patch.defaultPriceAmount !== undefined)
      await upsertSetting(tx, tenantId, KEY_PRICE, patch.defaultPriceAmount);
    if (patch.defaultVisibility !== undefined)
      await upsertSetting(tx, tenantId, KEY_VISIBILITY, patch.defaultVisibility);

    await tx
      .insert(onboardingSteps)
      .values({
        runId: run.id,
        step: STEP,
        status: "verified",
        idempotencyKey: commandId,
        completedAt: sql`now()`,
      })
      .onConflictDoNothing();
    await tx
      .insert(processedCommands)
      .values({ tenantId, commandId, commandType: COMMAND_TYPE, resultRef: { step: STEP } });

    return { club: await readConfig(tx, tenantId), step: "verified" as const, replayed: false };
  });
}

/** Current club config for the UI. Authorization is the CALLER's job (route runs authorize first). */
export async function getClubConfig(db: Db, params: { tenantId: string }): Promise<ClubConfig> {
  return withTenant(db, params.tenantId, (tx) => readConfig(tx, params.tenantId));
}
