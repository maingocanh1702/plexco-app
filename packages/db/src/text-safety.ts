/**
 * Shared hidden-character predicate for player-visible free text. One rule, two users:
 *  - validateDisplayName (me-settings.ts) applies it to the TRIMMED display name; its SQL twin is
 *    0055 person_profile_update (c_reject / c_visible).
 *  - the session text fields (area, venue_name, venue_address) apply hasHiddenChar to the RAW value
 *    in session-service.ts isOptionalText; sessions have no SQL twin (no DB CHECK, no migration).
 * Do not fork the character class: a second copy drifts. The web keeps one client mirror because
 * client code cannot import @plexco/db (FE-INV-3); the parity tests pin it.
 */

/**
 * Refused ANYWHERE in a display name; 0055 person_profile_update enumerates the same set (c_reject):
 * control (Cc) and format (Cf, e.g. bidi override / zero-width) characters; the line and paragraph
 * separators (Zl U+2028, Zp U+2029: a line break inside a name); the default-ignorable code points
 * that are not variation selectors, i.e. the marks U+034F, U+17B4, U+17B5 and the Hangul filler
 * letters U+115F, U+1160, U+3164, U+FFA0 (they render as nothing, so a name of them looks empty);
 * and U+2800 BRAILLE PATTERN BLANK (a blank glyph). Variation selectors stay allowed: emoji
 * presentation (U+2764 U+FE0F) and ideographic variants need them. me-settings.test.ts derives this
 * set from the runtime's Unicode tables. (Marks before letters: a letter followed by a combining mark
 * inside a class is what no-misleading-character-class refuses.)
 */
const HIDDEN_CHAR = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\u034f\u17b4\u17b5\u115f\u1160\u3164\uffa0\u2800]/u;

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
