import { and, desc, eq, sql } from "drizzle-orm";
import type { Db, Tx } from "./client.js";
import { onboardingRuns, onboardingSteps, processedCommands, settings, sports } from "../schema.js";
import { authorize } from "./tenant-capability-authority.js";
import { withTenant } from "./tenant.js";

/**
 * Club configuration (WAO club step): name, timezone, language, default sport / price / visibility.
 *
 * STORAGE: name/timezone/locale live ONLY in `tenants` (one authority per fact) and are reached
 * through the 0051 SECURITY DEFINER pair `tenant_profile_read/update` -- role `app` has no
 * privilege on the table itself (0035). The three defaults live in `settings` (`club.default_*`).
 *
 * Authority: `authorize(content.manage)` (DD-56 matrix: tenant content/settings excluding
 * secrets/billing); the definer re-checks it under the same transaction. Authorization runs
 * BEFORE the dedup read so a replay never answers a caller who no longer holds the capability.
 */
export const CLUB_ACTION = "content.manage";
const COMMAND_TYPE = "UpdateClubConfig";
const STEP = "club_config";
const INT4_MAX = 2_147_483_647;
const KEY_SPORT = "club.default_sport";
const KEY_PRICE = "club.default_price";
const KEY_VISIBILITY = "club.default_visibility";

export type ClubConfigErrorCode =
  "FORBIDDEN" | "INVALID_INPUT" | "COMMAND_ID_CONFLICT" | "NO_ONBOARDING_RUN";

export class ClubConfigError extends Error {
  constructor(
    readonly code: ClubConfigErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ClubConfigError";
  }
}

export interface ClubConfigPatch {
  name?: string;
  timezone?: string;
  locale?: "vi" | "en";
  defaultSportKey?: string;
  defaultPriceAmount?: number;
  defaultVisibility?: "private" | "public";
}

export interface ClubConfig {
  /** Read-only identity; never patchable here. */
  slug: string | null;
  name: string | null;
  timezone: string | null;
  locale: string | null;
  defaultSportKey: string | null;
  defaultPriceAmount: number | null;
  defaultVisibility: string | null;
}

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

const bad = (message: string): never => {
  throw new ClubConfigError("INVALID_INPUT", message);
};

const isValidTimezone = (tz: string): boolean => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

/** Validates TYPES and ranges only; the sport lookup needs the tx and happens in the command. */
function validatePatch(patch: ClubConfigPatch): ClubConfigPatch {
  if (patch === null || typeof patch !== "object") return bad("patch must be an object");
  const out: ClubConfigPatch = {};
  if (patch.name !== undefined) {
    const name = typeof patch.name === "string" ? patch.name.trim() : "";
    if (name.length < 1 || name.length > 120 || name.includes("\u0000"))
      bad("name must be 1-120 chars");
    out.name = name;
  }
  if (patch.timezone !== undefined) {
    if (typeof patch.timezone !== "string" || !isValidTimezone(patch.timezone))
      bad("invalid timezone");
    out.timezone = patch.timezone;
  }
  if (patch.locale !== undefined) {
    if (patch.locale !== "vi" && patch.locale !== "en") bad("locale must be vi or en");
    out.locale = patch.locale;
  }
  if (patch.defaultSportKey !== undefined) {
    if (
      typeof patch.defaultSportKey !== "string" ||
      patch.defaultSportKey.length === 0 ||
      patch.defaultSportKey.length > 64 ||
      patch.defaultSportKey.includes("\u0000")
    ) {
      bad("invalid sport key");
    }
    out.defaultSportKey = patch.defaultSportKey;
  }
  if (patch.defaultPriceAmount !== undefined) {
    const p = patch.defaultPriceAmount;
    if (typeof p !== "number" || !Number.isInteger(p) || p < 0 || p > INT4_MAX)
      bad("invalid price");
    out.defaultPriceAmount = p;
  }
  if (patch.defaultVisibility !== undefined) {
    if (patch.defaultVisibility !== "private" && patch.defaultVisibility !== "public")
      bad("invalid visibility");
    out.defaultVisibility = patch.defaultVisibility;
  }
  if (Object.keys(out).length === 0) bad("at least one field is required");
  return out;
}

async function upsertSetting(tx: Tx, tenantId: string, key: string, value: unknown) {
  await tx
    .insert(settings)
    .values({ tenantId, key, value })
    .onConflictDoUpdate({
      target: [settings.tenantId, settings.key],
      set: { value: sql`excluded.value`, updatedAt: sql`now()` },
    });
}

/** Reads the club config inside an open tenant tx: tenants via the 0051 definer, defaults via settings. */
async function readConfig(tx: Tx, tenantId: string): Promise<ClubConfig> {
  const profile = await tx.execute(
    sql`SELECT slug, name, timezone, locale FROM tenant_profile_read(${tenantId}::uuid)`,
  );
  const p = (profile.rows[0] ?? {}) as Record<string, unknown>;
  const rows = await tx
    .select({ key: settings.key, value: settings.value })
    .from(settings)
    .where(eq(settings.tenantId, tenantId));
  const byKey = new Map(rows.map((r) => [r.key, r.value as unknown]));
  const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
  const price = byKey.get(KEY_PRICE);
  return {
    slug: str(p.slug),
    name: str(p.name),
    timezone: str(p.timezone),
    locale: str(p.locale),
    defaultSportKey: str(byKey.get(KEY_SPORT)),
    defaultPriceAmount: typeof price === "number" ? price : null,
    defaultVisibility: str(byKey.get(KEY_VISIBILITY)),
  };
}

export async function updateClubConfig(
  db: Db,
  params: UpdateClubConfigParams,
): Promise<UpdateClubConfigResult> {
  const { tenantId, actorPersonId, commandId } = params;
  return withTenant(db, tenantId, async (tx) => {
    const decision = await authorize(tx, { tenantId, action: CLUB_ACTION, actorPersonId });
    if (!decision.allowed) throw new ClubConfigError("FORBIDDEN", decision.reason);

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
      if (updated.rows.length !== 1) {
        throw new ClubConfigError("NO_ONBOARDING_RUN", "tenant not found");
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
