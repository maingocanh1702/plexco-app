/**
 * Sport taxonomy helpers for the matcher (BL-TEN-4, DD-08 starter list).
 *
 * The canonical sport LIST lives in the DB (`sports` table, seeded by
 * packages/db/migrations/0011_seeds.sql). This module owns the pure,
 * per-sport CONTENT vocabulary used when matching bank-transfer memos:
 *   - phrases  → sport-mention detection (matching-confidence rule 1/3),
 *   - tokens   → stopwords excluded from name/alias learning.
 * Generalizes the single-club bot's hardcoded "badminton/cau long" keywords.
 */

const squash = (s: string) => s.replace(/\s+/g, "");

/**
 * Normalized (diacritics-stripped, lowercase) memo phrases per seeded sport
 * key. Keys MUST match `sports.key` in 0011_seeds.sql; extend together with
 * the seed when DD-08 finalizes the taxonomy.
 */
export const SPORT_CONTENT_PHRASES: Record<string, readonly string[]> = {
  badminton: ["badminton", "cau long"],
  pickleball: ["pickleball", "pickle ball"],
  tennis: ["tennis", "quan vot"],
  football: ["football", "soccer", "bong da", "da banh", "da bong"],
  volleyball: ["volleyball", "bong chuyen"],
  basketball: ["basketball", "bong ro"],
};

/**
 * Memo phrases for one sport. Unknown key falls back to the key itself —
 * a new sport still gets minimal detection until its phrase set is added.
 */
export function sportPhrasesFor(sportKey: string): readonly string[] {
  return SPORT_CONTENT_PHRASES[sportKey] ?? [sportKey];
}

/**
 * Stopword TOKENS for the matcher's name/alias learning: every word of every
 * phrase plus the squashed phrase form ("cau long" → cau, long, caulong).
 * These tokens must never be learned as part of a player's bank name.
 */
export function sportStopwordTokens(sportKey: string): string[] {
  const phrases = sportPhrasesFor(sportKey);
  const tokens = new Set<string>();
  for (const phrase of phrases) {
    for (const word of phrase.split(" ")) tokens.add(word);
    tokens.add(squash(phrase));
  }
  return [...tokens];
}
