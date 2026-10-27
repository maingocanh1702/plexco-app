import type { ClubConfigDto, ClubPatchBody } from "./club-settings-client";
import { INT4_MAX, formatVndInput, parseVndInput } from "./money";
import {
  CLUB_NAME_MAX,
  checkTypedName,
  hasHiddenChar,
  hasVisibleChar,
  stripInvisibleChars,
} from "./session-form-model";

/**
 * Pure model of the club settings forms: option lists and "what changed" -> PATCH body. The route
 * (club-config-validation.ts) stays authoritative; this only avoids sending an empty or obviously
 * invalid patch. A PATCH needs >= 1 field, so an unchanged form sends NOTHING (`null`).
 *
 * `unsure` = the fields an UNCERTAIN failure (network loss, 5xx) may already have saved since the
 * loaded `club` was read. The loaded value no longer proves what the server holds for them, so they
 * are always sent with the form's value (never "nothing changed"), and a saved-once rule (a sport or
 * price cannot be unset) applies to them as if they were saved.
 */
export type ClubPatchField = keyof ClubPatchBody;

/** The fields still unsure after `patch` failed uncertainly: the earlier ones plus its own. */
export function unsureAfter(
  pending: ReadonlySet<ClubPatchField> | undefined,
  patch: ClubPatchBody,
): Set<ClubPatchField> {
  const fields = new Set<ClubPatchField>(pending);
  for (const field of Object.keys(patch) as ClubPatchField[]) fields.add(field);
  return fields;
}

export type ClubNameProblem = "empty" | "too_long" | "invalid_chars";

/**
 * Client mirror of the club-name rule in club-config-validation.ts (validatePatch), counted the
 * SAME way: trimmed, 1..120 code points (`[...name].length`) like validatePatch and the SQL
 * char_length of tenants_name_len_chk (0039) and tenant_profile_update (0072), then the web
 * checkTypedName (L29). Not the display-name rule (me-settings-client.ts), which refuses more
 * characters. The invisible set is stripped first (L27, as the server stores it), so a name that
 * strips to nothing is "empty". Returns the first problem or null.
 */
export function clubNameProblem(raw: string): ClubNameProblem | null {
  const name = stripInvisibleChars(raw).trim();
  const length = [...name].length;
  if (length < 1) return "empty";
  if (length > CLUB_NAME_MAX) return "too_long";
  return checkTypedName(name) === null ? "invalid_chars" : null;
}

export type PublicAliasProblem = ClubNameProblem;

/**
 * The public alias as this form validates and sends it (L23, DD-138 sign-off A.1): the invisible set
 * removed first (stripInvisibleChars, the web's one mirror of the server list, not a second copy),
 * then the usual trim. Strip before trim, as validatePublicAlias and the 0068 set definer do, so an
 * invisible code point next to spaces cannot survive the trim.
 */
export function publicAliasValue(raw: string): string {
  return stripInvisibleChars(raw).trim();
}

/**
 * Client mirror of validatePublicAlias (packages/db/src/public-alias.ts, the 0060 set definer as
 * re-created by 0068): the alias is stripped and trimmed (publicAliasValue), then 1..60 CODE
 * POINTS, no hidden character (hasHiddenChar, the pinned text-safety mirror: the code points the
 * strip leaves, such as controls, bidi controls, U+2028 and
 * U+2800, are still refused) and at least one visible one, i.e. neither whitespace nor
 * Default_Ignorable (`\p{DI}`). An invisible-only alias is stripped to nothing, so it reads as
 * "empty": exactly the problem an empty alias gets.
 */
export function publicAliasProblem(raw: string): PublicAliasProblem | null {
  const alias = publicAliasValue(raw);
  const length = [...alias].length;
  if (length < 1) return "empty";
  if (length > 60) return "too_long";
  if (hasHiddenChar(alias)) return "invalid_chars";
  return hasVisibleChar(alias) ? null : "empty";
}

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

/** Only the changed (or `unsure`) fields; `null` when nothing changed. */
export function buildProfilePatch(
  club: ClubConfigDto,
  values: ProfileFormValues,
  unsure: ReadonlySet<ClubPatchField> = new Set(),
): ClubPatchBody | null {
  const before = profileValues(club);
  const patch: ClubPatchBody = {};
  const name = values.name.trim();
  if (name !== before.name || unsure.has("name")) patch.name = name;
  if (values.timezone !== before.timezone || unsure.has("timezone")) {
    patch.timezone = values.timezone;
  }
  if (values.locale !== before.locale || unsure.has("locale")) patch.locale = values.locale;
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

/**
 * What the default-price box shows after each keystroke: the digits the host typed, re-rendered
 * through formatVndInput, so the box always reads exactly what buildDefaultsPatch will save
 * ("1,500.50" -> "150.050" saves 150050; "1.5" -> "15" saves 15). Empty stays empty; a value above
 * int4 is left as typed so the submit shows price_invalid instead of silently clamping (same
 * contract as session-form.tsx and mark-paid-sheet.tsx).
 */
export function normalizePriceInput(raw: string): string {
  const parsed = parseVndInput(raw);
  if (parsed === null) return "";
  return Number.isNaN(parsed) ? raw : formatVndInput(parsed);
}

export type DefaultsProblem = "sport_required" | "price_invalid" | "price_required";

export function buildDefaultsPatch(
  club: ClubConfigDto,
  values: DefaultsFormValues,
  unsure: ReadonlySet<ClubPatchField> = new Set(),
): { patch: ClubPatchBody | null; problem: DefaultsProblem | null } {
  const patch: ClubPatchBody = {};
  const sportSaved = club.defaultSportKey !== null || unsure.has("defaultSportKey");
  if (values.sportKey === "" && sportSaved) {
    // The route only accepts a sport key (it has no "unset"): a saved sport can be changed, not cleared.
    return { patch: null, problem: "sport_required" };
  }
  if (
    values.sportKey !== "" &&
    (values.sportKey !== club.defaultSportKey || unsure.has("defaultSportKey"))
  ) {
    patch.defaultSportKey = values.sportKey;
  }
  const price = parseVndInput(values.price);
  if (Number.isNaN(price) || (price !== null && price > INT4_MAX)) {
    return { patch: null, problem: "price_invalid" };
  }
  if (price === null && (club.defaultPriceAmount !== null || unsure.has("defaultPriceAmount"))) {
    return { patch: null, problem: "price_required" }; // a saved price cannot be unset, only changed
  }
  if (price !== null && (price !== club.defaultPriceAmount || unsure.has("defaultPriceAmount"))) {
    patch.defaultPriceAmount = price;
  }
  const visibility = values.visibility;
  if (
    visibility !== (club.defaultVisibility === "public" ? "public" : "private") ||
    unsure.has("defaultVisibility")
  ) {
    patch.defaultVisibility = visibility;
  }
  return { patch: Object.keys(patch).length > 0 ? patch : null, problem: null };
}
