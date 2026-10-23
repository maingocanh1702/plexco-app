import { eq, sql } from "drizzle-orm";
import type { Tx } from "./client.js";
import { settings } from "../schema.js";
import { checkTypedName, stripInvisibleChars } from "./text-safety.js";

/** Club-config validation, storage keys and the tenant-tx read model (split from club-config.ts). */
const INT4_MAX = 2_147_483_647;
export const KEY_SPORT = "club.default_sport";
export const KEY_PRICE = "club.default_price";
export const KEY_VISIBILITY = "club.default_visibility";

export type ClubConfigErrorCode =
  "FORBIDDEN" | "TENANT_SUSPENDED" | "INVALID_INPUT" | "COMMAND_ID_CONFLICT" | "NO_ONBOARDING_RUN";

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

export const bad = (message: string): never => {
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
export function validatePatch(patch: ClubConfigPatch): ClubConfigPatch {
  if (patch === null || typeof patch !== "object") return bad("patch must be an object");
  const out: ClubConfigPatch = {};
  if (patch.name !== undefined) {
    // L27: strip the invisible set first (text-safety.ts), then trim; every check below runs on
    // the stripped value (length counted after the strip), so invisible-only fails as empty.
    const name = typeof patch.name === "string" ? stripInvisibleChars(patch.name).trim() : "";
    // checkTypedName refuses every HIDDEN_CHAR code point left after the strip (Cc incl. NUL, every
    // remaining Cf with all Bidi_Control, U+2028/U+2029, U+2800) and a name with no visible char.
    if (name.length > 120 || checkTypedName(name) === null)
      bad("name must be 1-120 printable chars");
    out.name = name;
  }
  if (patch.timezone !== undefined) {
    if (
      typeof patch.timezone !== "string" ||
      patch.timezone.length > 64 ||
      !isValidTimezone(patch.timezone)
    )
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

export async function upsertSetting(tx: Tx, tenantId: string, key: string, value: unknown) {
  await tx
    .insert(settings)
    .values({ tenantId, key, value })
    .onConflictDoUpdate({
      target: [settings.tenantId, settings.key],
      set: { value: sql`excluded.value`, updatedAt: sql`now()` },
    });
}

/** Reads the club config inside an open tenant tx: tenants via the 0052 definer, defaults via settings. */
export async function readConfig(tx: Tx, tenantId: string): Promise<ClubConfig> {
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
