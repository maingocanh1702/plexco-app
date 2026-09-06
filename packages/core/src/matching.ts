/**
 * Name normalization + transfer-content matching (PURE — proposal only).
 *
 * Lifted from the production single-club bot (src/matching.ts; ~85% auto-match,
 * 0 false positives in production). Core PROPOSES candidates/plans — it never
 * writes; the ledger service is the only allocation writer (BL-PAY, INV-4).
 *
 * Bank transfer contents in VN usually arrive UPPERCASE without diacritics
 * ("NGOC ANH JUN 13 BADMINTON"), so everything is compared in a
 * diacritics-stripped, lowercase, alphanumeric-only space.
 *
 * Generalizations vs the single-club source (behavior otherwise identical):
 *   - PlayerId = string | number (uuid-ready);
 *   - sport words arrive via MatchVocab/sport phrases (were hardcoded
 *     badminton/cau long) — see ./sports.ts;
 *   - pay-code prefix/skip-list arrive via PayCodeConfig (were BMT/BMTRANS).
 */
import { MONTHS, MONTH_TOKEN_ALT } from "./dates.js";

export type PlayerId = string | number;

export interface MatchCandidate {
  playerId: PlayerId;
  name: string;
  norm: string;
  /** the norm variant (username or learned bank-name alias) that actually matched */
  matchedNorm: string;
  score: number;
}

export interface MatchablePlayer {
  id: PlayerId;
  name: string;
  norm: string;
  /** learned bank-name norms, e.g. "nguyen thien trang" for "kelly" */
  aliases?: string[];
}

/**
 * Extra vocabulary the matcher must treat as noise, per tenant/sport context.
 * `sportTokens` (see sports.ts sportStopwordTokens) join the stopword sets so
 * sport words never score as names nor get learned as aliases. Default [] =
 * generic transfer matching without sport hints.
 */
export interface MatchVocab {
  sportTokens?: readonly string[];
}

/** "Ngọc-Anh  Mai" -> "ngoc anh mai" */
export function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const squash = (s: string) => s.replace(/\s+/g, "");

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Strip a "<host>'s +1" / "+1" label from a label string -> the host name.
 * e.g. "Chung's +1" -> "Chung", "Ngoc-Anh Mai's +1" -> "Ngoc-Anh Mai". */
export function hostFromPlusOneLabel(label: string): string | null {
  const m = label.trim().match(/^(.+?)['’]s\s*\+\s*1$/);
  return m ? m[1]!.trim() : null;
}

/**
 * A guest's row shows their name with a "<host>'s +1" sub-label underneath
 * (e.g. name "Hao", label "Chung's +1"). OCR sometimes glues them into one
 * string ("Hao Chung's +1"). Split it back into the real display name plus the
 * host. Also strips a bare trailing "+1" badge. Returns host=null when there's
 * no "<host>'s" part.
 *
 * `knownHosts` (hosts isolated from the model's labels/plus_ones) are tried
 * first, longest-first, so MULTI-WORD hosts ("Ngoc-Anh Mai's +1") split
 * correctly instead of grabbing only the last token.
 */
/**
 * Audit 2026-09-06 C-3: the three suffix regexes below pair a lazy `(.+?)` with `\s+…$`, which
 * backtracks quadratically on a crafted input that never reaches the terminal "+1". Two cheap
 * fences bound it: an OCR label longer than this is not a name (returned untouched), and the
 * regexes only run when the string actually ends in "+1" — the only case they can match.
 */
export const MAX_PLUS_ONE_INPUT_LENGTH = 200;

export function parsePlusOneSuffix(
  raw: string,
  knownHosts: string[] = [],
): { name: string; host: string | null } {
  const s = raw.trim();
  if (s.length > MAX_PLUS_ONE_INPUT_LENGTH || !/\+\s*1$/.test(s)) return { name: s, host: null };
  for (const h of [...new Set(knownHosts)].filter(Boolean).sort((a, b) => b.length - a.length)) {
    // `h` is escaped into literal text before interpolation; it cannot add regex structure.
    const m = s.match(
      new RegExp(`^(.+?)\\s+${escapeRegExp(h)}['’]s\\s*\\+\\s*1$`, "iu"), // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
    );
    if (m) return { name: m[1]!.trim(), host: h };
  }
  // "<guest> <host>'s +1" with a single-token host (fallback)
  const withHost = s.match(/^(.+?)\s+([\p{L}][\p{L}\d.\-']*)['’]s\s*\+\s*1$/u);
  if (withHost) return { name: withHost[1]!.trim(), host: withHost[2]!.trim() };
  // bare trailing "+1" with no host
  const bare = s.match(/^(.+?)\s*\+\s*1$/);
  if (bare) return { name: bare[1]!.trim(), host: null };
  return { name: s, host: null };
}

// ---------- stopword vocabulary ----------

// Full English month names — the date grammar accepts them ("JUNE 13"), so
// alias/name learning must treat them as noise exactly like the short forms.
const FULL_MONTH_NAMES: readonly string[] = [
  "january",
  "february",
  "march",
  "april",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

// Months & generic transfer words + bank/gateway codes. Sport words join via
// MatchVocab (sportTokens) — they were hardcoded in the single-club source.
const BASE_ALIAS_STOPWORDS: readonly string[] = [
  ...Object.keys(MONTHS),
  ...FULL_MONTH_NAMES,
  "session",
  "san",
  "ck",
  "chuyen",
  "khoan",
  "tien",
  "thanh",
  "toan",
  "tra",
  "gui",
  "ung",
  "ho",
  "pay",
  "payment",
  "fee",
  "transfer",
  "transfers",
  "transferred",
  "transferring",
  "from",
  "to",
  "for",
  "vnd",
  "dong",
  "d",
  // bank/gateway codes commonly prefixed into contents
  "mbvcb",
  "vcb",
  "tcb",
  "acb",
  "mb",
  "vib",
  "bidv",
  "agribank",
  "vpb",
  "tpb",
  "momo",
  "zalopay",
  "napas",
  "ft",
  "ref",
  "ma",
  "gd",
  "giao",
  "dich",
  "noi",
  "dung",
  "ct",
  "tu",
  "den",
  "toi",
  "qua",
  "cho",
  "va",
  "anh",
  "chi",
  "em",
];

// Vietnamese politeness pronouns that are ALSO common given-name syllables. They live in
// the alias stopwords (so they don't start a name run or score as the content's "given
// name"), but when they appear AFTER unknown tokens in a name run they are part of the
// bank name (e.g. "NGUYEN THI KIM CHI" → last token "chi" = the player's given name).
const ALIAS_PRONOUN_STOPWORDS = new Set(["anh", "chi", "em"]);

// Default bank-transfer descriptions put the sender's full legal name first,
// immediately followed by a fixed phrase ("... chuyen tien", "... transfer").
// Tokens that are clearly bank/gateway noise, not part of a name.
const DESC_PREFIX_JUNK = new Set([
  "mbvcb",
  "vcb",
  "tcb",
  "acb",
  "mb",
  "mbbank",
  "vib",
  "bidv",
  "agribank",
  "vpb",
  "tpb",
  "momo",
  "zalopay",
  "napas",
  "ft",
  "ref",
  "trace",
  "ma",
  "gd",
  "giao",
  "dich",
  "noi",
  "dung",
  "ct",
  "ck",
  "tu",
  "den",
]);

function aliasStopwords(vocab?: MatchVocab): Set<string> {
  return new Set([...BASE_ALIAS_STOPWORDS, ...(vocab?.sportTokens ?? [])]);
}

/**
 * Match a transfer content against players. Returns candidates sorted by
 * score desc. Caller auto-accepts only when there is a single clear winner.
 */
export function matchContentToPlayers(
  content: string,
  players: MatchablePlayer[],
  vocab?: MatchVocab,
): MatchCandidate[] {
  const stopwords = aliasStopwords(vocab);
  const normContent = normalizeName(content);
  const contentTokens = new Set(normContent.split(" ").filter(Boolean));
  const contentSquashed = squash(normContent);
  // VN bank names put the family name first ("TRAN LE DUC MINH" = họ Trần,
  // tên Minh) -> the LAST meaningful token is the given name; players whose
  // name contains it get a ranking bonus ("Minh Tran" > "Tran Duc" here)
  const givenName = normContent
    .split(" ")
    .filter((t) => t && !/\d/.test(t) && !stopwords.has(t))
    .at(-1);

  const candidates: MatchCandidate[] = [];

  // Tokens that BLOCK name-matching: sport words, months, transfer/gateway
  // noise — but NOT the pronoun syllables (anh/chi/em), which are also common
  // real given names ("Chi", "Ngoc Anh") and must stay matchable.
  const nameBlocking = new Set([...stopwords].filter((t) => !ALIAS_PRONOUN_STOPWORDS.has(t)));

  const scoreNorm = (norm: string): number => {
    const tokens = norm.split(" ").filter(Boolean);
    if (tokens.length === 0) return 0;

    // A name variant whose tokens are ALL memo-noise can only ever "match"
    // noise — a badminton memo "CAU LONG JUN 13" must never match a player
    // named "Long"/"Cau Long". Names with ≥1 real token score normally.
    if (tokens.every((t) => nameBlocking.has(t))) return 0;

    const squashedName = squash(norm);
    // min length 5 so short names ("minh", "chi") don't false-positive as
    // substrings of longer names/words — they go through exact-token matching
    if (squashedName.length >= 5 && contentSquashed.includes(squashedName)) {
      // full name appears contiguously, e.g. "ngocanhmai" in "ngocanhmaijun13badminton"
      return 100 + norm.length;
    }
    if (tokens.every((t) => contentTokens.has(t))) {
      // all name tokens present somewhere; +3 when the given name is among them
      return 80 + tokens.length + (givenName && tokens.includes(givenName) ? 3 : 0);
    }
    // partial: how many tokens matched (min 1 token of length >= 3), and at
    // least one matched token must be a real name token (not memo noise)
    const hit = tokens.filter((t) => t.length >= 3 && contentTokens.has(t));
    if (
      hit.length > 0 &&
      hit.length >= Math.ceil(tokens.length / 2) &&
      hit.some((t) => !nameBlocking.has(t))
    ) {
      return 40 + hit.length * 5;
    }
    // prefix squash: "ngocanh" inside "ngocanhjun13..." when content
    // omits the last name ("Ngoc-Anh" for "Ngoc-Anh Mai")
    for (let k = tokens.length - 1; k >= 1; k--) {
      const prefix = squash(tokens.slice(0, k).join(" "));
      if (prefix.length >= 5 && contentSquashed.includes(prefix)) {
        return 40 + k * 5;
      }
    }
    return 0;
  };

  for (const p of players) {
    // try the username and every learned alias, keep the best
    let score = 0;
    let matchedNorm = p.norm;
    for (const variant of [p.norm, ...(p.aliases ?? [])]) {
      const s = scoreNorm(variant);
      if (s > score) {
        score = s;
        matchedNorm = variant;
      }
    }
    if (score > 0) {
      candidates.push({ playerId: p.id, name: p.name, norm: p.norm, matchedNorm, score });
    }
  }

  return candidates.sort((a, b) => b.score - a.score);
}

/**
 * Decide whether the top candidate is safe to auto-accept.
 *
 * - Single candidate with a reasonable score -> accept (covers first-name-only
 *   transfers like "Ngoc-Anh jun 13" for player "Ngoc-Anh Mai").
 * - Top's name tokens are a subset of the runner-up's ("Minh" vs "Minh Tran")
 *   -> ambiguous, the payer might have abbreviated either name -> manual.
 * - Top & runner-up are both full token-matches SHARING a token and the top
 *   isn't a contiguous full-name hit ("TRAN LE DUC MINH" matches "Minh Tran"
 *   82 vs "Minh" 81 — VN bank names put the family name first, so this could
 *   be either player) -> manual, with the top suggested.
 * - Two strong full-name matches (someone paying for two people) -> manual.
 */
export function pickAutoMatch(candidates: MatchCandidate[]): MatchCandidate | null {
  if (candidates.length === 0) return null;
  const [top, second] = candidates;
  if (!second) return top!.score >= 45 ? top! : null;

  const topTokens = top!.matchedNorm.split(" ").filter(Boolean);
  const secondTokens = new Set(second.matchedNorm.split(" ").filter(Boolean));
  const topIsSubsetOfSecond = topTokens.every((t) => secondTokens.has(t));
  if (topIsSubsetOfSecond) return null;
  const shareToken = topTokens.some((t) => secondTokens.has(t));
  if (top!.score < 100 && second.score >= 80 && shareToken) return null;
  if (top!.score >= 100 && second.score >= 100) return null;
  return top!.score >= 80 ? top! : null;
}

function disjointStrongMatches(candidates: MatchCandidate[]): MatchCandidate[] {
  const strong = candidates.filter((c) => c.score >= 100);
  if (strong.length < 2) return [];
  for (let i = 0; i < strong.length; i++) {
    const a = new Set(strong[i]!.matchedNorm.split(" ").filter(Boolean));
    for (let j = i + 1; j < strong.length; j++) {
      const b = strong[j]!.matchedNorm.split(" ").filter(Boolean);
      if (b.some((t) => a.has(t))) return [];
    }
  }
  return strong;
}

/**
 * ≥2 matched payers are ambiguous when their matched tokens all sit inside ONE
 * contiguous name-token run that ALSO carries tokens unknown to the roster —
 * the signature of a single payer's LEGAL name ("NGUYEN THI KIM CHI" with
 * roster names Kim + Chi is one person, not a buddy payment). A run whose
 * tokens are all roster-known ("kelly chi") stays a genuine payer list.
 * Same membership mechanism the alias learner uses; fail-closed → manual.
 */
function isOneLegalNameRun(
  content: string,
  matched: MatchCandidate[],
  players: MatchablePlayer[],
  vocab?: MatchVocab,
): boolean {
  if (matched.length < 2) return false;
  const stopwords = aliasStopwords(vocab);
  const knownTokens = new Set(
    players.flatMap((p) => [p.norm, ...(p.aliases ?? [])].flatMap((n) => n.split(" "))),
  );
  const isName = (t: string) => !/\d/.test(t) && !stopwords.has(t) && !DESC_PREFIX_JUNK.has(t);

  // Split the memo into contiguous name-token runs.
  const runs: string[][] = [];
  let current: string[] = [];
  for (const tok of normalizeName(content).split(" ").filter(Boolean)) {
    if (isName(tok) || (ALIAS_PRONOUN_STOPWORDS.has(tok) && current.length > 0)) {
      current.push(tok);
    } else if (current.length > 0) {
      runs.push(current);
      current = [];
    }
  }
  if (current.length > 0) runs.push(current);

  // All matched tokens inside one run + that run has roster-unknown tokens?
  const matchedTokens = matched.flatMap((m) => m.matchedNorm.split(" ").filter(Boolean));
  for (const run of runs) {
    const runSet = new Set(run);
    if (!matchedTokens.every((t) => runSet.has(t))) continue;
    if (run.some((t) => !knownTokens.has(t))) return true; // one legal name
  }
  return false;
}

/**
 * Match ALL players mentioned in one transfer (one person paying for several:
 * "kelly chi thad jun 13 badminton").
 *
 * Greedy: repeatedly auto-match the strongest candidate, consume that player's
 * name tokens from the content, repeat until nothing matches confidently.
 * Ambiguity rules of pickAutoMatch still apply at every step; a multi-payer
 * result that is really fragments of ONE legal name fails closed to manual.
 */
export function matchAllInContent(
  content: string,
  players: MatchablePlayer[],
  vocab?: MatchVocab,
): MatchCandidate[] {
  const matched: MatchCandidate[] = [];
  let pool = [...players];
  const tokens = normalizeName(content).split(" ").filter(Boolean);

  while (pool.length > 0) {
    const candidates = matchContentToPlayers(tokens.join(" "), pool, vocab);
    const top = pickAutoMatch(candidates);
    const picked = top ? [top] : disjointStrongMatches(candidates);
    if (picked.length === 0) break;
    matched.push(...picked);
    const pickedIds = new Set(picked.map((m) => m.playerId));
    pool = pool.filter((p) => !pickedIds.has(p.id));
    // consume one occurrence of each matched name token
    for (const m of picked) {
      for (const t of m.matchedNorm.split(" ")) {
        const i = tokens.indexOf(t);
        if (i >= 0) tokens.splice(i, 1);
      }
    }
  }
  if (isOneLegalNameRun(content, matched, players, vocab)) return [];
  return matched;
}

/**
 * Extract candidate dates from content. Grammar is FINITE (decision table in
 * the slice state dir): named month+day, dd/mm, dd/mm/yyyy, ISO yyyy-mm-dd.
 * Forms carrying an explicit year keep it (`year` set); yearless forms leave
 * `year` undefined — the comparison semantics live in contentMentionsDate.
 */
export function extractDates(content: string): { month: number; day: number; year?: number }[] {
  const norm = normalizeName(content);
  const out: { month: number; day: number; year?: number }[] = [];

  // Named-month forms, with an OPTIONAL explicit year on either side:
  // "jun 13" / "2025 jun 13" / "jun 13 2025" / "13 jun [2025]". Month tokens
  // use the BOUNDED alternation from dates.ts — "MAYBANK 13"/"MARTIN 13" must
  // never read as May/Mar 13. Only 19xx/20xx counts as a year — a 4-digit
  // reference fragment ("jun 13 4821") must not turn a yearless date into a
  // mismatching dated one.
  const MONTH = `(?<![a-z0-9])(${MONTH_TOKEN_ALT})(?![a-z0-9])`;
  const YEAR = "((?:19|20)\\d{2})";
  for (const m of norm.matchAll(
    new RegExp(`(?:(?<!\\d)${YEAR}\\s+)?${MONTH}\\s+(\\d{1,2})(?!\\d)(?:\\s+${YEAR}(?!\\d))?`, "g"),
  )) {
    const month = MONTHS[m[2]!.slice(0, 3)]!;
    const day = Number(m[3]);
    const year = m[1] ?? m[4];
    if (day >= 1 && day <= 31) {
      out.push(year ? { month, day, year: Number(year) } : { month, day });
    }
  }
  for (const m of norm.matchAll(
    new RegExp(`(?<!\\d)(\\d{1,2})\\s+${MONTH}(?:\\s+${YEAR}(?!\\d))?`, "g"),
  )) {
    const month = MONTHS[m[2]!.slice(0, 3)]!;
    const day = Number(m[1]);
    if (day >= 1 && day <= 31) {
      out.push(m[3] ? { month, day, year: Number(m[3]) } : { month, day });
    }
  }

  // ISO-style year-first dates ("2026-06-13") — parsed FIRST and bounded so
  // the day/month scan below can never grab digits out of the middle of the
  // year ("2026-06-13" must yield {6,13}, not a phantom {6,26}).
  for (const m of content.matchAll(/(?<!\d)(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})(?!\d)/g)) {
    const month = Number(m[2]);
    const day = Number(m[3]);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      out.push({ month, day, year: Number(m[1]) });
    }
  }

  // "13/6", "13-06", "13/6/2026" (day first, VN convention) — digit/separator
  // boundaries reject matches that start or end inside a longer number run.
  for (const m of content.matchAll(
    /(?<![\d/\-.])(\d{1,2})[/\-.](\d{1,2})(?:[/\-.](\d{4}))?(?![\d/\-.])/g,
  )) {
    const day = Number(m[1]);
    const month = Number(m[2]);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      out.push(m[3] ? { month, day, year: Number(m[3]) } : { month, day });
    }
  }

  return out;
}

/**
 * Does the content mention this ISO date (YYYY-MM-DD)?
 * Date-grammar decision table (finite, fail-closed):
 *   - yearless forms ("jun 13", "13/6")   → month+day comparison;
 *   - explicit-year forms ("13/6/2025", "2025-06-13") → month+day AND year —
 *     a stale-year memo must never earn a date-based confidence boost;
 *   - compact 4-digit ("1306"/"0613")     → accepted ONLY as a STANDALONE
 *     token equal to THIS session's ddmm/mmdd — a fragment inside a
 *     reference run ("FT1306") or a longer digit run is never a date.
 */
export function contentMentionsDate(content: string, isoDate: string): boolean {
  const [yy, mm, dd] = isoDate.split("-").map(Number);
  if (
    extractDates(content).some(
      (d) => d.month === mm && d.day === dd && (d.year === undefined || d.year === yy),
    )
  ) {
    return true;
  }
  const ddmm = `${String(dd).padStart(2, "0")}${String(mm).padStart(2, "0")}`;
  const mmdd = `${String(mm).padStart(2, "0")}${String(dd).padStart(2, "0")}`;
  // token-level: alnum runs stay glued after normalization, so "ft1306" can
  // never equal the bare compact form
  for (const tok of normalizeName(content).split(" ")) {
    if (tok === ddmm || tok === mmdd) return true;
  }
  return false;
}

// ---------- bank-name alias learning ----------

/**
 * When the content uses the bank's DEFAULT description, the payer's real name
 * is the run of name tokens right before "chuyen tien" / "transfer":
 *   "TRAN NGUYEN DUC MINH chuyen tien FT261..."        -> "tran nguyen duc minh"
 *   "MBVCB.12345.NGUYEN THIEN TRANG chuyen tien.CT ..." -> "nguyen thien trang"
 * The whole leading name is taken verbatim — we do NOT strip the player's own
 * known tokens here, so "Minh Tran" still learns the full "tran nguyen duc minh"
 * rather than just the leftover "nguyen duc".
 */
export function extractRealNameFromDefaultDesc(content: string): string | null {
  const norm = normalizeName(content);
  let idx = -1;
  for (const trigger of ["chuyen tien", "transfer"]) {
    const i = norm.indexOf(trigger);
    if (i >= 0 && (idx < 0 || i < idx)) idx = i;
  }
  if (idx <= 0) return null;
  const tokens = norm.slice(0, idx).trim().split(" ").filter(Boolean);
  // trim bank/gateway noise and numeric reference tokens off both ends
  const junk = (t: string) => /\d/.test(t) || DESC_PREFIX_JUNK.has(t);
  while (tokens.length && junk(tokens[0]!)) tokens.shift();
  while (tokens.length && junk(tokens[tokens.length - 1]!)) tokens.pop();
  const name = tokens.join(" ").trim();
  return name.length >= 3 ? name : null;
}

/**
 * Extract the payer's bank name from a transfer content, to be learned as an
 * alias. "NGUYEN THIEN TRANG JUN 13 BADMINTON" -> "nguyen thien trang".
 * Returns null if nothing meaningful remains.
 */
export function extractAliasFromContent(
  content: string,
  knownNorms: string[],
  vocab?: MatchVocab,
): string | null {
  const stopwords = aliasStopwords(vocab);

  // 1. default bank desc with an explicit "... chuyen tien" / "transfer" trigger.
  const fromDesc = extractRealNameFromDefaultDesc(content);
  if (fromDesc && fromDesc.length >= 5) return fromDesc;

  // 2. otherwise the bank name is the FIRST contiguous run of name tokens: skip
  //    any leading gateway/keyword junk, then stop at the first date / keyword /
  //    reference-code token after the run. Taken VERBATIM — we do NOT drop the
  //    player's own name tokens here, because a real bank name often CONTAINS
  //    them (username "Hiền" → realname "DANG THU HIEN" must keep "HIEN").
  const known = new Set(knownNorms.flatMap((n) => normalizeName(n).split(" ")));
  const run: string[] = [];
  for (const tok of normalizeName(content).split(" ").filter(Boolean)) {
    const isName = !/\d/.test(tok) && !stopwords.has(tok) && !DESC_PREFIX_JUNK.has(tok);
    if (isName) {
      if (run.length < 6) run.push(tok); // bank names are at most a few words
    } else if (
      ALIAS_PRONOUN_STOPWORDS.has(tok) &&
      run.length > 0 &&
      run.some((t) => !known.has(t))
    ) {
      // Pronoun-tokens ("anh"/"chi"/"em") are common Vietnamese given-name syllables.
      // Allow them to continue the run when the run already has unknown (non-player-known)
      // tokens — meaning we're inside the player's real bank name, not echoing their own
      // username. When the run only contains known tokens (e.g. "kelly") we stop, so a
      // multi-player "KELLY CHI" content never extends kelly's alias to "kelly chi".
      if (run.length < 6) run.push(tok);
    } else if (run.length > 0) {
      break; // run ended (hit a date / keyword / reference code)
    }
  }
  const alias = run.join(" ");
  if (alias.length < 5) return null;
  // only worth learning if it adds something beyond what we already know — so we
  // don't re-learn the player's own username (e.g. "ngoc anh" for "Ngoc-Anh Mai")
  return run.some((tok) => !known.has(tok)) ? alias : null;
}

// ---------- pay_code extraction ----------

/**
 * Pay-code contract (DD-02): a club-facing PREFIX (display/routing aid) + a
 * 4-char suffix from the safe base-32 alphabet A-Z + 2-9 minus 0/O/1/I/L.
 * The DB stores the code; the extractor returns the full UPPERCASE code —
 * callers strip `prefix` for bare lookups when needed.
 */
export interface PayCodeConfig {
  /** e.g. "BMT" — display prefix minted into memos (DD-02) */
  prefix: string;
  /** full codes never minted (memo noise like BMTRANS) — skip, keep scanning */
  skipCodes?: ReadonlySet<string>;
}

// Suffixes that are pure digits are never minted by the generator, so they
// can't resolve to a member and must be excluded from extraction too.
const ALL_DIGIT_SUFFIX_RE = /^\d+$/;

// No leading \b — allow squashed memos where a word is directly concatenated
// with the code (e.g. "BADMINTONBMT7Q2A"). Trailing \b still prevents
// partial-suffix matches.
const payCodeRe = (prefix: string) =>
  // `prefix` is escaped into literal text; the only active pattern is the fixed 4-char suffix.
  new RegExp(`${escapeRegExp(prefix)}([A-HJ-KM-NP-Z2-9]{4})\\b`, "gi"); // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp

function isSkippedPayCode(suffix: string, code: string, cfg: PayCodeConfig): boolean {
  return (cfg.skipCodes?.has(code) ?? false) || ALL_DIGIT_SUFFIX_RE.test(suffix);
}

/** Extract the first valid pay_code from content, or null. */
export function extractPayCode(content: string, cfg: PayCodeConfig): string | null {
  for (const m of content.matchAll(payCodeRe(cfg.prefix))) {
    const code = (cfg.prefix + m[1]!).toUpperCase();
    if (!isSkippedPayCode(m[1]!, code, cfg)) return code;
  }
  return null;
}

/** Count DISTINCT valid pay_codes in content (skip-list and all-digit suffixes excluded). */
export function countPayCodes(content: string, cfg: PayCodeConfig): number {
  const seen = new Set<string>();
  for (const m of content.matchAll(payCodeRe(cfg.prefix))) {
    const code = (cfg.prefix + m[1]!).toUpperCase();
    if (!isSkippedPayCode(m[1]!, code, cfg)) seen.add(code);
  }
  return seen.size;
}

// ---------- real-name validation / noise stripping ----------

/**
 * Tokens that must NEVER appear in a real name — transfer phrases, months,
 * bank/gateway/reference codes + the caller's sport tokens. Deliberately
 * EXCLUDES the pronoun-ish stopwords (anh/chi/em) because those are common
 * Vietnamese name parts ("NGUYEN NGOC ANH") and must be kept.
 */
function nameNoise(vocab?: MatchVocab): Set<string> {
  return new Set([
    ...Object.keys(MONTHS),
    ...FULL_MONTH_NAMES,
    "session",
    "san",
    "ck",
    "chuyen",
    "khoan",
    "tien",
    "thanh",
    "toan",
    "tra",
    "gui",
    "pay",
    "payment",
    "fee",
    "transfer",
    "transfers",
    "transferred",
    "transferring",
    "vnd",
    "dong",
    ...DESC_PREFIX_JUNK,
    ...(vocab?.sportTokens ?? []),
  ]);
}

/**
 * Validate a candidate real name (e.g. from an LLM/import) BEFORE learning it.
 * Returns the NORMALIZED name, or null when it's noisy / not a clean name:
 *   - empty, or more than 6 tokens (model echoed a sentence like "the payer is X"),
 *   - any token has a digit (reference/amount), or is a transfer/sport/gateway
 *     noise token,
 *   - adds nothing new beyond the player's known names.
 */
export function sanitizeRealName(
  raw: string,
  knownNorms: string[],
  vocab?: MatchVocab,
): string | null {
  const noise = nameNoise(vocab);
  const tokens = normalizeName(raw).split(" ").filter(Boolean);
  if (tokens.length === 0 || tokens.length > 6) return null;
  for (const tok of tokens) {
    if (/\d/.test(tok) || noise.has(tok)) return null;
  }
  const name = tokens.join(" ");
  if (name.length < 3) return null;
  const known = new Set(knownNorms.flatMap((n) => normalizeName(n).split(" ")));
  return tokens.some((tok) => !known.has(tok)) ? name : null;
}

/**
 * Strip transfer/month/gateway/reference noise + any numeric tokens from an
 * ALREADY-normalized string, leaving only plausible name tokens. Mirrors
 * sanitizeRealName's noise set; KEEPS pronoun-ish name syllables (anh/chi/em).
 *
 * Used by the pay_code "other debtor" veto: a memo word like the month "jun",
 * the FT reference, or the pay_code itself must NOT be allowed to masquerade
 * as another open debtor's name and force a needless manual review.
 */
export function stripNameNoise(normContent: string, vocab?: MatchVocab): string {
  const noise = nameNoise(vocab);
  return normContent
    .split(/\s+/)
    .filter((t) => t && !/\d/.test(t) && !noise.has(t))
    .join(" ");
}

// ---------- confidence scoring + deterministic rescue rules ----------
//
// Model (production-calibrated in the single-club bot):
//   auto-match  ⇔  ( similarity ≥ 88% )  OR  ( one rule fires )
// ADDITIVE: keeps the base auto-match set (matchAllInContent) unchanged; rules
// only add an explainable % label + a tx-date confidence dimension.

export type MatchReason = "similarity" | "rule1" | "rule2-sameday" | "rule2-window" | "rule3";

export interface ConfidentMatch extends MatchCandidate {
  /** 0..100 — độ tin cậy của match này */
  pct: number;
  reason: MatchReason;
}

export interface MatchCtx {
  content: string;
  /** ISO date của session, vd "2026-06-13" */
  sessionDate: string;
  players: MatchablePlayer[];
  /** tx.transactionDate (datetime "YYYY-MM-DD HH:MM:SS" hoặc ISO) — cho Rule 2 */
  txDate?: string;
  /** sport memo phrases (sports.ts sportPhrasesFor) — rule 1/3 template check */
  sportPhrases?: readonly string[];
  /** stopword tokens (sports.ts sportStopwordTokens) — name/alias noise */
  vocab?: MatchVocab;
}

/** transfer keyword: transfer / chuyen tien / chuyen khoan / ck (standalone). */
export function hasTransferKeyword(content: string): boolean {
  const n = ` ${normalizeName(content)} `;
  if (/\bck\b/.test(n)) return true; // "ck" đứng riêng, không match "luck"/"buck"
  return ["transfer", "chuyen tien", "chuyen khoan"].some((k) => n.includes(k));
}

/** Does the content mention the sport? Phrases match at TOKEN boundaries —
 * "bong da" must not fire inside "bong dan", or rule confidence would upgrade
 * a transfer whose memo never mentioned the sport. */
export function hasSportKeyword(content: string, phrases: readonly string[]): boolean {
  const padded = ` ${normalizeName(content)} `;
  return phrases.some((p) => padded.includes(` ${p} `));
}

/**
 * realname của player có DUY NHẤT trong session không?
 * Unique = player này là full/partial match (score ≥ 45) và KHÔNG player nào khác
 * có token-set chồng lấn theo kiểu subset/superset (vd "Minh" ⊂ "Minh Tran" → không
 * unique). Hai tên rời rạc cùng xuất hiện ("Thad" + "Maggie") thì mỗi tên vẫn unique.
 */
export function isUniqueInSession(
  playerId: PlayerId,
  content: string,
  players: MatchablePlayer[],
  vocab?: MatchVocab,
): boolean {
  const cands = matchContentToPlayers(content, players, vocab);
  const me = cands.find((c) => c.playerId === playerId);
  if (!me || me.score < 45) return false;
  const myTokens = me.matchedNorm.split(" ").filter(Boolean);
  const mySet = new Set(myTokens);
  for (const c of cands) {
    if (c.playerId === playerId || c.score < 45) continue;
    const ts = c.matchedNorm.split(" ").filter(Boolean);
    const cSubsetMe = ts.every((t) => mySet.has(t)); // c ⊆ me
    const meSubsetC = myTokens.every((t) => ts.includes(t)); // me ⊆ c
    if (cSubsetMe || meSubsetC) return false; // chồng lấn → ambiguous
    // ANY shared token with another plausible candidate → ambiguous. A legal
    // name like "TRAN LE DUC MINH" makes {Minh Tran, Minh, Tran Duc} all
    // plausible; only subset checks would let "Tran Duc" slip through as
    // "unique" and rule1 would propose 100% for the WRONG member. Money is
    // fail-closed: shared surname/token → manual, never a confident boost.
    if (ts.some((t) => mySet.has(t))) return false;
  }
  return true;
}

/** Số ngày chênh giữa tx và session (tx − session). null nếu không parse được. */
export function dayDiffFromSession(txDate: string, sessionIso: string): number | null {
  const datePart = txDate.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart) || !/^\d{4}-\d{2}-\d{2}$/.test(sessionIso)) return null;
  const a = Date.parse(`${datePart}T00:00:00Z`);
  const b = Date.parse(`${sessionIso}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((a - b) / 86_400_000);
}

/** % cho một similarity match đã được auto-accept (giữ hành vi production → ≥88). */
function similarityPct(score: number): number {
  if (score >= 100) return 100; // full-name xuất hiện liền nhau
  if (score >= 80) return 90; // đủ tất cả tokens
  return 88; // partial/first-name DUY NHẤT (đã được pickAutoMatch chấp nhận)
}

/**
 * Match một transfer → danh sách player được auto-match, kèm % + lý do.
 *
 * ADDITIVE: bắt đầu từ matchAllInContent (giữ nguyên auto-match), rồi với mỗi
 * player được nêu tên DUY NHẤT trong session, áp rules để NÂNG % / gắn nhãn
 * (rule1=100, rule2-sameday=100, rule2-window=99, rule3=99). Không bao giờ gỡ match.
 *
 * LƯU Ý: `pct` là NHÃN giải thích (explainability), KHÔNG phải ngưỡng quyết
 * định — auto-match hay không vẫn do matchAllInContent/pickAutoMatch định đoạt
 * (ambiguity guards). Deterministic-settle (S15) chỉ tin pay_code/exact match,
 * không tin pct.
 */
export function matchWithConfidence(ctx: MatchCtx): ConfidentMatch[] {
  const { content, players, sessionDate, txDate, sportPhrases, vocab } = ctx;

  // điểm fuzzy thô để map ra % cho nhánh similarity
  const scoreById = new Map<PlayerId, number>();
  for (const c of matchContentToPlayers(content, players, vocab))
    scoreById.set(c.playerId, c.score);

  // 1) giữ nguyên auto-match hiện tại
  const byId = new Map<PlayerId, ConfidentMatch>();
  for (const m of matchAllInContent(content, players, vocab)) {
    byId.set(m.playerId, {
      ...m,
      pct: similarityPct(scoreById.get(m.playerId) ?? m.score),
      reason: "similarity",
    });
  }

  // 2) rules (chỉ áp khi có transfer keyword) — nâng % / gắn nhãn, có thể bổ sung match
  if (hasTransferKeyword(content)) {
    const sportOk = hasSportKeyword(content, sportPhrases ?? []);
    const dateOk = contentMentionsDate(content, sessionDate);
    const dd = txDate != null ? dayDiffFromSession(txDate, sessionDate) : null;

    // player được nêu tên (score ≥ 45) và DUY NHẤT trong session
    const named = matchContentToPlayers(content, players, vocab).filter(
      (c) => c.score >= 45 && isUniqueInSession(c.playerId, content, players, vocab),
    );

    const apply = (c: MatchCandidate, pct: number, reason: MatchReason) => {
      const cur = byId.get(c.playerId);
      if (!cur) byId.set(c.playerId, { ...c, pct, reason });
      else if (pct >= cur.pct) byId.set(c.playerId, { ...cur, pct, reason });
    };

    if (named.length >= 2) {
      // Rule 3 — player + buddy (player thứ 2 cũng unique), cùng template sport + ngày.
      // Fragments of ONE legal name ("NGUYEN THI KIM CHI" ⊃ roster Kim + Chi)
      // are NOT a buddy pair — fail closed, no rule boost.
      if (sportOk && dateOk && !isOneLegalNameRun(content, named, players, vocab))
        for (const c of named) apply(c, 99, "rule3");
    } else if (named.length === 1) {
      const c = named[0]!;
      if (sportOk && dateOk)
        apply(c, 100, "rule1"); // template đầy đủ
      else if (dd === 0)
        apply(c, 100, "rule2-sameday"); // tx đúng ngày session
      else if (dd === 1 || dd === -1) apply(c, 99, "rule2-window"); // tx lệch ±1 ngày
    }
  }

  return [...byId.values()].sort((a, b) => b.pct - a.pct || b.score - a.score);
}
