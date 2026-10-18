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
    priceMode: s.priceMale !== null || s.priceFemale !== null ? "gender" : "single",
    priceMale: formatVndInput(s.priceMale),
    priceFemale: formatVndInput(s.priceFemale),
    slotsUnlimited: s.slotsMax === null,
    slotsMax: s.slotsMax === null ? "" : String(s.slotsMax),
    visibility: s.visibility === "public" ? "public" : "private",
    joinPolicy: s.joinPolicy === "approval" ? "approval" : "open",
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
 * True when the value this form would SEND (trimmed, blank = null) holds a hidden character. In
 * edit mode a value whose textKey equals the loaded one is skipped: buildUpdateBody compares in the
 * same form and does not send it, so a legacy value must not block saving other fields; once edited
 * it is held to the rule.
 */
function hasNewHiddenChar(raw: string, initialRaw: string | undefined): boolean {
  const sent = textOrNull(raw);
  if (sent === null || !hasHiddenChar(sent)) return false;
  return initialRaw === undefined || sent !== textKey(initialRaw);
}

/**
 * A text field (area, venue name, address) in the form this client sends and compares: trimmed,
 * blank = null. The server does not trim: it stores the value it receives as-is (session-service.ts),
 * so a legacy value with surrounding spaces is stored raw and only compares equal here after trimming.
 * validateForm's legacy exemptions (address cap, hidden characters) and buildUpdateBody's "changed?"
 * diff ALL compare in this form, so a field exempted as untouched is also never sent (a legacy value
 * with surrounding spaces would otherwise be exempted, sent trimmed and end in the generic INVALID_BODY).
 */
const textKey = (raw: string | null | undefined): string | null => textOrNull(raw ?? "");

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

  if (hasNewHiddenChar(v.venueName, initial?.venueName)) {
    e.venueName = t(
      "Tên sân không được chứa ký tự điều khiển hoặc ký tự ẩn.",
      "The venue name cannot contain control or hidden characters.",
    );
  }

  const address = v.venueAddress.trim();
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
  if (hasNewHiddenChar(v.area, initial?.area)) {
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
    if (v.area.trim() === "") {
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
  const area = textOrNull(v.area);
  const venueName = textOrNull(v.venueName);
  const venueAddress = textOrNull(v.venueAddress);
  if (area !== null) body.area = area;
  if (venueName !== null) body.venueName = venueName;
  if (venueAddress !== null) body.venueAddress = venueAddress;
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
  const male = genderSide(v, v.priceMale);
  if (male !== original.priceMale) body.priceMale = male;
  const female = genderSide(v, v.priceFemale);
  if (female !== original.priceFemale) body.priceFemale = female;
  const slots = slotsOf(v);
  if (slots !== original.slotsMax) body.slotsMax = slots;
  if (v.visibility !== original.visibility) body.visibility = v.visibility;
  if (v.joinPolicy !== original.joinPolicy) body.joinPolicy = v.joinPolicy;
  const area = textKey(v.area);
  if (area !== textKey(original.area)) body.area = area;
  const venueName = textKey(v.venueName);
  if (venueName !== textKey(original.venueName)) body.venueName = venueName;
  const venueAddress = textKey(v.venueAddress);
  if (venueAddress !== textKey(original.venueAddress)) body.venueAddress = venueAddress;
  return Object.keys(body).length === 0 ? null : body;
}
