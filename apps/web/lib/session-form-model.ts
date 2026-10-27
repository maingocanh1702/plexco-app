import type { TFn } from "./i18n-client";
import { INT4_MAX, formatVndInput, parseVndInput } from "./money";
import { isoToLocalInput, localInputToIso, resolveTimeZone } from "./session-time";
import type { SessionDetailDto, SessionFieldsBody } from "./sessions-api";

/**
 * Pure model behind <SessionForm>: values <-> API bodies and client-side validation. The server
 * stays the authority (every rule here is re-checked by the command); this only avoids a round
 * trip for mistakes the host can see. `price` and `slotsMax` are TEXT (what the host typed).
 */
export interface SessionFormValues {
  sportId: string;
  startsAt: string; // datetime-local wall clock in the session zone
  endsAt: string;
  venueName: string;
  venueAddress: string;
  area: string;
  price: string;
  /** "gender": priceMale / priceFemale apply; an empty side is null (never 0) and falls back to `price`. */
  priceMode: "single" | "gender";
  priceMale: string;
  priceFemale: string;
  slotsUnlimited: boolean;
  slotsMax: string;
  visibility: "private" | "public";
  joinPolicy: "open" | "approval";
  /** DD-139 / B1: "hide exact address until confirmed"; off (the default) = the venue is public. */
  hideExactAddress: boolean;
}

/**
 * Max venue address length: the command caps it at 200 UTF-16 code units (DD-128 OD-4a), which is
 * also the unit of the HTML maxLength attribute, so the input, the hint and this check agree.
 */
export const VENUE_ADDRESS_MAX = 200;

export type FormErrors = Partial<Record<keyof SessionFormValues, string>>;

export const emptyFormValues = (): SessionFormValues => ({
  sportId: "",
  startsAt: "",
  endsAt: "",
  venueName: "",
  venueAddress: "",
  area: "",
  price: "0",
  priceMode: "single",
  priceMale: "",
  priceFemale: "",
  slotsUnlimited: true,
  slotsMax: "",
  visibility: "private",
  joinPolicy: "open",
  hideExactAddress: false,
});

export function valuesFromSession(s: SessionDetailDto): SessionFormValues {
  return {
    sportId: s.sportId,
    startsAt: isoToLocalInput(s.startsAt, resolveTimeZone(s.timezone)),
    endsAt: isoToLocalInput(s.endsAt, resolveTimeZone(s.timezone)),
    venueName: s.venueName ?? "",
    venueAddress: s.venueAddress ?? "",
    area: s.area ?? "",
    price: formatVndInput(s.priceAmount),
    // An absent per-gender price (an older API response) reads as null: the one-price mode.
    priceMode:
      (s.priceMale ?? null) !== null || (s.priceFemale ?? null) !== null ? "gender" : "single",
    priceMale: formatVndInput(s.priceMale),
    priceFemale: formatVndInput(s.priceFemale),
    slotsUnlimited: s.slotsMax === null,
    slotsMax: s.slotsMax === null ? "" : String(s.slotsMax),
    visibility: s.visibility === "public" ? "public" : "private",
    joinPolicy: s.joinPolicy === "approval" ? "approval" : "open",
    // An older API response without the field reads as off.
    hideExactAddress: s.hideExactAddress ?? false,
  };
}

/** Parsed numeric slots: null = unlimited, NaN = invalid. */
function slotsOf(v: SessionFormValues): number | null {
  if (v.slotsUnlimited) return null;
  const digits = v.slotsMax.trim();
  if (!/^\d+$/.test(digits)) return Number.NaN;
  const n = Number(digits);
  return n >= 1 && n <= INT4_MAX ? n : Number.NaN;
}

/** A per-gender price as sent: null in single mode or when left empty (never 0); NaN = invalid. */
const genderSide = (v: SessionFormValues, raw: string): number | null =>
  v.priceMode === "gender" ? parseVndInput(raw) : null;

const textOrNull = (s: string): string | null => (s.trim() === "" ? null : s.trim());

/**
 * Client mirror of hasHiddenChar (packages/db/src/text-safety.ts, the rule behind display names and
 * the session text fields). Client code cannot import the db package (FE-INV-3), so the class is copied
 * from me-settings-client.ts; session-form-model.test.ts pins it against validateDisplayName over
 * every code point. Control, format (bidi, zero-width), line and paragraph separators, invisible fillers.
 */
export function hasHiddenChar(value: string): boolean {
  return /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\u034f\u17b4\u17b5\u115f\u1160\u3164\uffa0\u2800]/u.test(value);
}

/**
 * STRIP_CHAR_RANGES of packages/db/src/text-safety.ts (the single server list), copied as numbers
 * because the code points are invisible in source: Default_Ignorable_Code_Point minus Bidi_Control,
 * Unicode 17.0, 4162 code points in 16 inclusive [first, last] ranges. Client code cannot import
 * the db package (FE-INV-3), so this is the web's one copy; session-form-model.test.ts pins
 * stripInvisibleChars against the server function over every code point. Do not fork it:
 * club-settings-model.ts imports stripInvisibleChars from here.
 */
const STRIP_CHAR_RANGES: readonly (readonly [first: number, last: number])[] = [
  [0x00ad, 0x00ad],
  [0x034f, 0x034f],
  [0x115f, 0x1160],
  [0x17b4, 0x17b5],
  [0x180b, 0x180f],
  [0x200b, 0x200d],
  [0x2060, 0x2065],
  [0x206a, 0x206f],
  [0x3164, 0x3164],
  [0xfe00, 0xfe0f],
  [0xfeff, 0xfeff],
  [0xffa0, 0xffa0],
  [0xfff0, 0xfff8],
  [0x1bca0, 0x1bca3],
  [0x1d173, 0x1d17a],
  [0xe0000, 0xe0fff],
];

function isStripCodePoint(codePoint: number): boolean {
  return STRIP_CHAR_RANGES.some(([first, last]) => codePoint >= first && codePoint <= last);
}

/**
 * Client mirror of stripInvisibleChars (packages/db/src/text-safety.ts, L23, DD-138 sign-off A.1: the
 * strip every publicly displayed name goes through before any other check; here the session area and
 * venue name). Removes every STRIP code point and changes nothing else (no trim, no normalisation).
 * It is the server's linear scan over UTF-16 code units, not one regex pass: a lone high and a lone
 * low surrogate around a stripped code point meet once it is gone, and the code point they form gets
 * the same test (U+DB40 U+200B U+DD00 leaves nothing; one regex pass would leave U+E0100, a variation
 * selector). The rule as written strips U+200D and U+FE0F, so a composed emoji splits (no exception).
 */
export function stripInvisibleChars(value: string): string {
  const kept: string[] = [];
  for (const unit of value.split("")) {
    const code = unit.charCodeAt(0);
    const last = kept[kept.length - 1]?.charCodeAt(0) ?? 0;
    if (code >= 0xdc00 && code <= 0xdfff && last >= 0xd800 && last <= 0xdbff) {
      // A low surrogate after a kept high surrogate: the pair is one code point.
      if (isStripCodePoint(0x10000 + (last - 0xd800) * 0x400 + (code - 0xdc00))) kept.pop();
      else kept.push(unit);
    } else if (!isStripCodePoint(code)) {
      kept.push(unit);
    }
  }
  return kept.join("");
}

// Copy of VISIBLE_CHAR in packages/db/src/text-safety.ts (the visible-character test).
const VISIBLE_CHAR = /[^\s\p{DI}]/u;

/**
 * Web twin of hasVisibleChar in packages/db/src/text-safety.ts: true when the value holds at least
 * one VISIBLE_CHAR (not whitespace, not default-ignorable). session-form-model.test.ts pins it.
 */
export function hasVisibleChar(value: string): boolean {
  return VISIBLE_CHAR.test(value);
}

/**
 * Web twin of packages/db/src/text-safety.ts checkTypedName (L29-AG2 pins it over every scalar).
 */
export function checkTypedName(value: string): string | null {
  const name = stripInvisibleChars(value).trim();
  return hasHiddenChar(name) || !hasVisibleChar(name) ? null : name;
}

/**
 * Web twin of DISPLAY_NAME_MAX in packages/db/src/text-safety.ts: the most code points a person's
 * display name holds, counted on the stripped, trimmed value (DD-150 Q4 (b)). Pinned by
 * session-form-model.test.ts.
 */
export const DISPLAY_NAME_MAX = 120;

/**
 * The club (tenant) name cap, its own field: twin of tenants_name_len_chk (migration 0039) and
 * tenant_profile_update, which count char_length (code points). Not the person cap above.
 */
export const CLUB_NAME_MAX = 120;

/**
 * True when the name holds 1..max code points and no unpaired surrogate (in unicode mode \p{Cs}
 * matches only a lone surrogate, never a well-formed pair). Web twin of isBoundedText,
 * packages/db/src/roster-money-shared.ts:63-77; its NUL refusal is already hasHiddenChar's.
 */
export function isBoundedName(name: string, max: number): boolean {
  const points = [...name].length;
  return points >= 1 && points <= max && !/\p{Cs}/u.test(name);
}

/**
 * area, venue name and venue address as this form validates, sends and compares them (L23, L27):
 * STRIP code points removed first, then the usual trim (textOrNull), blank = null. A value of
 * invisible code points only is therefore exactly an empty one (same message, same sent value).
 */
const publicNameOrNull = (raw: string): string | null => textOrNull(stripInvisibleChars(raw));
const publicNameKey = (raw: string | null | undefined): string | null =>
  publicNameOrNull(raw ?? "");

/**
 * True when the value this form would SEND holds a hidden character. `key` turns a raw field into
 * the value sent (trimmed, blank = null; publicNameOrNull for the public names, so stripped first).
 * In edit mode a value whose key equals the loaded one is skipped: buildUpdateBody compares in the
 * same form and does not send it, so a legacy value must not block saving other fields; once edited
 * it is held to the rule.
 */
function hasNewHiddenChar(
  raw: string,
  initialRaw: string | undefined,
  key: (raw: string) => string | null = publicNameOrNull,
): boolean {
  const sent = key(raw);
  if (sent === null || !hasHiddenChar(sent)) return false;
  return initialRaw === undefined || sent !== key(initialRaw);
}

/**
 * The venue address, stripped first like area and venue name (L27), in the form this
 * client sends and compares: trimmed, blank = null. The server does not trim: it stores the value
 * it receives as-is (session-service.ts), so a legacy value with surrounding spaces is stored raw
 * and only compares equal here after trimming.
 * validateForm's legacy exemptions (address cap, hidden characters) and buildUpdateBody's "changed?"
 * diff ALL compare in this form, so a field exempted as untouched is also never sent (a legacy value
 * with surrounding spaces would otherwise be exempted, sent trimmed and end in the generic INVALID_BODY).
 */
const textKey = (raw: string | null | undefined): string | null => publicNameKey(raw);

/**
 * `initial` (edit mode) lets the address check skip an address the host did not touch: a legacy
 * 201-300 character one (the old edit limit was 300, with no server cap) is never sent by
 * buildUpdateBody while unchanged, so it must not block saving other fields; once edited it is
 * held to the cap here, pinned to the Address field instead of the generic INVALID_BODY summary.
 */
export function validateForm(
  v: SessionFormValues,
  tz: string,
  t: TFn,
  initial?: SessionFormValues,
): FormErrors {
  const e: FormErrors = {};
  if (!v.sportId) e.sportId = t("Chọn môn thể thao.", "Choose a sport.");

  const start = localInputToIso(v.startsAt, tz);
  const end = localInputToIso(v.endsAt, tz);
  if (!v.startsAt) e.startsAt = t("Chọn thời gian bắt đầu.", "Choose a start time.");
  else if (!start)
    e.startsAt = t("Thời gian bắt đầu không hợp lệ.", "The start time is not valid.");
  if (!v.endsAt) e.endsAt = t("Chọn thời gian kết thúc.", "Choose an end time.");
  else if (!end) e.endsAt = t("Thời gian kết thúc không hợp lệ.", "The end time is not valid.");
  else if (start && Date.parse(end) <= Date.parse(start)) {
    e.endsAt = t(
      "Thời gian kết thúc phải sau thời gian bắt đầu.",
      "End time must be after start time.",
    );
  }

  if (hasNewHiddenChar(v.venueName, initial?.venueName, publicNameOrNull)) {
    e.venueName = t(
      "Tên sân không được chứa ký tự điều khiển hoặc ký tự ẩn.",
      "The venue name cannot contain control or hidden characters.",
    );
  }

  const address = stripInvisibleChars(v.venueAddress).trim();
  if (
    address.length > VENUE_ADDRESS_MAX &&
    textKey(v.venueAddress) !== textKey(initial?.venueAddress)
  ) {
    e.venueAddress = t(
      `Địa chỉ tối đa ${VENUE_ADDRESS_MAX} ký tự.`,
      `The address is at most ${VENUE_ADDRESS_MAX} characters.`,
    );
  } else if (hasNewHiddenChar(v.venueAddress, initial?.venueAddress)) {
    e.venueAddress = t(
      "Địa chỉ không được chứa ký tự điều khiển hoặc ký tự ẩn.",
      "The address cannot contain control or hidden characters.",
    );
  }

  // Area after the address: the summary lists errors in form order (venue name, address, area).
  if (hasNewHiddenChar(v.area, initial?.area, publicNameOrNull)) {
    e.area = t(
      "Khu vực không được chứa ký tự điều khiển hoặc ký tự ẩn.",
      "The area cannot contain control or hidden characters.",
    );
  }

  const price = parseVndInput(v.price);
  if (price === null) e.price = t("Nhập giá (0 nếu miễn phí).", "Enter a price (0 if free).");
  else if (Number.isNaN(price)) e.price = t("Giá không hợp lệ.", "The price is not valid.");

  // Gender mode: the base price above stays required (it is the fallback); an empty side is null.
  const male = genderSide(v, v.priceMale);
  const female = genderSide(v, v.priceFemale);
  if (v.priceMode === "gender" && male === null && female === null) {
    e.priceMale = t(
      "Nhập ít nhất một giá theo giới tính, hoặc chọn Một giá.",
      "Enter at least one price by gender, or choose One price.",
    );
  }
  if (Number.isNaN(male)) e.priceMale = t("Giá không hợp lệ.", "The price is not valid.");
  if (Number.isNaN(female)) e.priceFemale = t("Giá không hợp lệ.", "The price is not valid.");

  const slots = slotsOf(v);
  if (slots !== null && Number.isNaN(slots)) {
    e.slotsMax = t(
      "Số chỗ phải là số nguyên từ 1 trở lên.",
      "Slots must be a whole number of 1 or more.",
    );
  }

  if (v.visibility === "public") {
    if (publicNameOrNull(v.area) === null) {
      e.area = t("Kèo công khai cần có khu vực.", "A public session needs an area.");
    }
    if (slots === null) {
      e.slotsMax = t(
        "Kèo công khai cần số chỗ giới hạn.",
        "A public session needs a finite number of slots.",
      );
    }
  }
  return e;
}

/** POST body minus commandId. Optional text fields are sent only when non-empty (DD-128 OD-4a: venueAddress included). */
export function buildCreateBody(
  v: SessionFormValues,
  tz: string,
): SessionFieldsBody & { sportId: string } {
  const body: SessionFieldsBody & { sportId: string } = {
    sportId: v.sportId,
    startsAt: localInputToIso(v.startsAt, tz)!,
    endsAt: localInputToIso(v.endsAt, tz)!,
    timezone: tz,
    priceAmount: parseVndInput(v.price) as number,
    priceMale: genderSide(v, v.priceMale),
    priceFemale: genderSide(v, v.priceFemale),
    slotsMax: slotsOf(v),
    visibility: v.visibility,
    joinPolicy: v.joinPolicy,
  };
  const area = publicNameOrNull(v.area);
  const venueName = publicNameOrNull(v.venueName);
  const venueAddress = publicNameOrNull(v.venueAddress);
  if (area !== null) body.area = area;
  if (venueName !== null) body.venueName = venueName;
  if (venueAddress !== null) body.venueAddress = venueAddress;
  // DD-139 D-8: sent only when on; absent means off, so an untouched form posts the old body.
  if (v.hideExactAddress) body.hideExactAddress = true;
  return body;
}

/**
 * PUT body: ONLY fields that differ from the loaded session (the command treats absent as
 * "leave alone" and null as "clear"), so an untouched price never trips the price guard.
 * null = nothing changed.
 */
export function buildUpdateBody(
  v: SessionFormValues,
  original: SessionDetailDto,
): SessionFieldsBody | null {
  const tz = resolveTimeZone(original.timezone);
  const body: SessionFieldsBody = {};
  // The inputs are minute-precision; compare the TEXT the host saw (not instants) so a stored
  // value carrying seconds is not reported as "changed" just because the input dropped them.
  if (v.startsAt !== isoToLocalInput(original.startsAt, tz)) {
    body.startsAt = localInputToIso(v.startsAt, tz)!;
  }
  if (v.endsAt !== isoToLocalInput(original.endsAt, tz)) {
    body.endsAt = localInputToIso(v.endsAt, tz)!;
  }
  const price = parseVndInput(v.price) as number;
  if (price !== original.priceAmount) body.priceAmount = price;
  // Same rule per side; switching to one price sends null only for a side that was set.
  // An absent stored side (an older API response) compares as null, so an untouched form sends none.
  const male = genderSide(v, v.priceMale);
  if (male !== (original.priceMale ?? null)) body.priceMale = male;
  const female = genderSide(v, v.priceFemale);
  if (female !== (original.priceFemale ?? null)) body.priceFemale = female;
  const slots = slotsOf(v);
  if (slots !== original.slotsMax) body.slotsMax = slots;
  if (v.visibility !== original.visibility) body.visibility = v.visibility;
  if (v.joinPolicy !== original.joinPolicy) body.joinPolicy = v.joinPolicy;
  // L23: the public names compare and send in stripped form (publicNameKey, both sides), so a value
  // equal to the loaded one after stripping is no change and the sent value is the stripped one.
  const area = publicNameKey(v.area);
  if (area !== publicNameKey(original.area)) body.area = area;
  const venueName = publicNameKey(v.venueName);
  if (venueName !== publicNameKey(original.venueName)) body.venueName = venueName;
  const venueAddress = textKey(v.venueAddress);
  if (venueAddress !== textKey(original.venueAddress)) body.venueAddress = venueAddress;
  // DD-139 D-8: only when it differs; an older response without the field compares as off.
  if (v.hideExactAddress !== (original.hideExactAddress ?? false)) {
    body.hideExactAddress = v.hideExactAddress;
  }
  return Object.keys(body).length === 0 ? null : body;
}
