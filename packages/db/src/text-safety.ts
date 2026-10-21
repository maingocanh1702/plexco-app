/**
 * Shared hidden-character predicate for player-visible free text, and the strip that runs before it
 * on every publicly displayed name (L23). Users:
 *  - validateDisplayName (me-settings.ts) applies it to the TRIMMED display name; its SQL twin is
 *    0055 person_profile_update (c_reject / c_visible).
 *  - the public names strip first: session area and venue_name (session-service.ts) and the club
 *    public alias (public-alias.ts) run stripInvisibleChars, and every later step (their existing
 *    trim and checks, the stored value) sees the stripped value. Their SQL side is migration 0068:
 *    it re-creates tenant_public_alias_set with the same strip and cleans the stored names once.
 *  - venue_address applies hasHiddenChar to the RAW value in session-service.ts isOptionalText;
 *    sessions have no SQL twin (no DB CHECK).
 * Do not fork the character class: a second copy drifts. The web keeps two client mirrors because
 * client code cannot import @plexco/db (FE-INV-3): apps/web/lib/me-settings-client.ts and
 * apps/web/lib/session-form-model.ts (pinned against this predicate over every code point by its
 * test; the first by example tests in me-settings-client.test.ts).
 */

/**
 * Refused ANYWHERE in a display name or venue_address, and in a public name on the value the strip
 * leaves (there it can only meet code points outside STRIP_CHAR_RANGES: controls, bidi controls,
 * the separators, the format characters that are not default-ignorable, U+2800); 0055
 * person_profile_update and 0060 tenant_public_alias_set enumerate the same set (c_reject):
 * control (Cc) and format (Cf, e.g. bidi override / zero-width) characters; the line and paragraph
 * separators (Zl U+2028, Zp U+2029: a line break inside a name); the default-ignorable code points
 * that are not variation selectors, i.e. the marks U+034F, U+17B4, U+17B5 and the Hangul filler
 * letters U+115F, U+1160, U+3164, U+FFA0 (they render as nothing, so a name of them looks empty);
 * and U+2800 BRAILLE PATTERN BLANK (a blank glyph). Variation selectors pass this predicate: emoji
 * presentation (U+2764 U+FE0F) and ideographic variants need them in a member-facing name (a public
 * name strips them first). me-settings.test.ts derives this set from the runtime's Unicode tables.
 * (Marks before letters: a letter followed by a combining mark inside a class is what
 * no-misleading-character-class refuses.)
 */
const HIDDEN_CHAR = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\u034f\u17b4\u17b5\u115f\u1160\u3164\uffa0\u2800]/u;

/**
 * STRIP: removed from every publicly displayed name before any other check (L23, DD-138 sign-off
 * A.1: the owner rejected R1-5). Default_Ignorable_Code_Point minus Bidi_Control, Unicode 17.0:
 * 4162 code points in 16 inclusive [first, last] ranges, written as numbers because they are
 * invisible in source. The bidi controls are default-ignorable too but stay REFUSED by HIDDEN_CHAR:
 * they reorder the visible text around them.
 * Threat model: defends against impersonation and blank-looking public names built from invisible
 * code points; it does NOT defend against visible confusables (homoglyphs).
 * The rule as written strips U+200D (ZWJ) and U+FE0F (VS16): a composed emoji splits into its parts
 * or shows as text. No emoji exception (that would be a new owner decision).
 * This is the single TypeScript list: the web mirror (apps/web/lib/session-form-model.ts) and the
 * SQL helper of migration 0068 copy it and are pinned to it over every code point by their tests.
 */
export const STRIP_CHAR_RANGES: readonly (readonly [first: number, last: number])[] = [
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
 * Removes every STRIP code point and changes nothing else (no trim, no normalisation, no case
 * change). It walks UTF-16 code units instead of one regex pass so that a single call is final on
 * malformed input too: a lone high and a lone low surrogate around a stripped code point meet once
 * it is gone, and the code point they form gets the same test (U+DB40 U+200B U+DD00 leaves nothing,
 * where one regex pass would leave U+E0100, a variation selector). Linear time.
 */
export function stripInvisibleChars(value: string): string {
  const kept: string[] = [];
  for (const unit of value.split("")) {
    const code = unit.charCodeAt(0);
    const last = kept.at(-1)?.charCodeAt(0) ?? 0;
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

/**
 * A name needs at least one VISIBLE code point: one that is neither whitespace (`\s`, the very set
 * trim() removes, so only an inner space is left) nor Default_Ignorable_Code_Point (`\p{DI}`, which
 * holds every variation selector and every unassigned default-ignorable). Both render as nothing, and
 * HIDDEN_CHAR lets variation selectors through for the character before them, so a name of them
 * alone (U+FE0F, U+E0100, U+180B) would otherwise show blank. A combining mark draws a glyph, so it
 * counts as visible. 0055 enumerates the same two sets (c_ws, c_visible): Default_Ignorable_Code_Point
 * is the same 17 ranges in Unicode 16 and 17.
 */
const VISIBLE_CHAR = /[^\s\p{DI}]/u;

/** True when the value holds any HIDDEN_CHAR (control, format, line/paragraph separator, invisible filler). */
export function hasHiddenChar(value: string): boolean {
  return HIDDEN_CHAR.test(value);
}

/** True when the value holds at least one VISIBLE_CHAR (not whitespace, not default-ignorable). */
export function hasVisibleChar(value: string): boolean {
  return VISIBLE_CHAR.test(value);
}
