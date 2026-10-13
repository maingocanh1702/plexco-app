import type { ClubConfigDto, ClubPatchBody } from "./club-settings-client";
import { INT4_MAX, parseVndInput } from "./money";

/**
 * Pure model of the club settings forms: option lists and "what changed" -> PATCH body. The route
 * (club-config-validation.ts) stays authoritative; this only avoids sending an empty or obviously
 * invalid patch. A PATCH needs >= 1 field, so an unchanged form sends NOTHING (`null`).
 */
export const COMMON_TIMEZONES = [
  "Asia/Ho_Chi_Minh",
  "Asia/Bangkok",
  "Asia/Singapore",
  "Asia/Manila",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Australia/Sydney",
  "Europe/London",
  "Europe/Paris",
  "America/New_York",
  "America/Los_Angeles",
  "UTC",
] as const;

/** The common zones, plus the club's current one when it is not among them (never drop a saved value). */
export function timezoneOptions(current: string | null): string[] {
  const list: string[] = [...COMMON_TIMEZONES];
  return current && !list.includes(current) ? [current, ...list] : list;
}

export interface ProfileFormValues {
  name: string;
  timezone: string;
  locale: "vi" | "en";
}

export function profileValues(club: ClubConfigDto): ProfileFormValues {
  return {
    name: club.name ?? "",
    timezone: club.timezone ?? "Asia/Ho_Chi_Minh",
    locale: club.locale === "en" ? "en" : "vi",
  };
}

/** Only the changed fields; `null` when nothing changed. */
export function buildProfilePatch(
  club: ClubConfigDto,
  values: ProfileFormValues,
): ClubPatchBody | null {
  const before = profileValues(club);
  const patch: ClubPatchBody = {};
  const name = values.name.trim();
  if (name !== before.name) patch.name = name;
  if (values.timezone !== before.timezone) patch.timezone = values.timezone;
  if (values.locale !== before.locale) patch.locale = values.locale;
  return Object.keys(patch).length > 0 ? patch : null;
}

export interface DefaultsFormValues {
  sportKey: string;
  price: string;
  visibility: "private" | "public";
}

export function defaultsValues(club: ClubConfigDto, formatPrice: (n: number) => string) {
  return {
    sportKey: club.defaultSportKey ?? "",
    price: club.defaultPriceAmount === null ? "" : formatPrice(club.defaultPriceAmount),
    visibility: club.defaultVisibility === "public" ? "public" : "private",
  } satisfies DefaultsFormValues;
}

export type DefaultsProblem = "price_invalid" | "price_required";

export function buildDefaultsPatch(
  club: ClubConfigDto,
  values: DefaultsFormValues,
): { patch: ClubPatchBody | null; problem: DefaultsProblem | null } {
  const patch: ClubPatchBody = {};
  if (values.sportKey !== "" && values.sportKey !== club.defaultSportKey) {
    patch.defaultSportKey = values.sportKey;
  }
  const price = parseVndInput(values.price);
  if (Number.isNaN(price) || (price !== null && price > INT4_MAX)) {
    return { patch: null, problem: "price_invalid" };
  }
  if (price === null && club.defaultPriceAmount !== null) {
    return { patch: null, problem: "price_required" }; // a saved price cannot be unset, only changed
  }
  if (price !== null && price !== club.defaultPriceAmount) patch.defaultPriceAmount = price;
  const visibility = values.visibility;
  if (visibility !== (club.defaultVisibility === "public" ? "public" : "private")) {
    patch.defaultVisibility = visibility;
  }
  return { patch: Object.keys(patch).length > 0 ? patch : null, problem: null };
}
