import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * DD-128 OD-4b guard: apps/web has exactly ONE money formatter, lib/money.ts. Any other source
 * file that formats a number itself fails here, so a second "150.000 d" style cannot creep back.
 * Banned outside lib/money.ts (see RULES below): any NumberFormat identifier (Intl.NumberFormat,
 * destructured or aliased), currency-style options, toLocaleString on anything that is not
 * visibly a Date, the dong sign U+20AB, digit-grouping regexes, an amount (or any digit) written
 * directly before a currency suffix (d-stroke, VND, VN-D-stroke, "dong"), a constant that holds
 * only such a suffix, and format*Money/Vnd/Price helpers that do not delegate to formatVnd (or
 * its input twin formatVndInput). Test files are exempt (they assert the absence of U+20AB).
 * Comments are stripped before every rule runs.
 *
 * A guard against ACCIDENTS (a second formatter written in good faith), not against a motivated
 * bypass. KNOWN GAPS, deliberately not chased (each would cost more false positives than it saves):
 *  - grouping done by loops/slice/split/reduce, or `(\d{3}){1,}` / `\d{3}(?:...)` forms with no `)+`;
 *  - a currency suffix built from pieces (`"V" + "ND"`), or kept in an object property / enum;
 *  - a Date receiver recognised by NAME (suffix At|Date|Time|Day, plural ok): a Number held in
 *    `retryAt`/`dueDay` passes, and a Date held in `start` is flagged (rename or use new Date());
 *  - comment stripping is line-based and string-unaware: a string literal holding `//` mid-line
 *    hides the rest of that line, and `/*` inside a string can hide code up to the next close;
 *  - `x.toLocaleString` reached through a computed key (`x["toLocale" + "String"]`);
 *  - a helper whose name does not start with "format" or "fmt" (the helper rule is name-based);
 *  - a helper declared with `var`, or as an object / class method shorthand (`{ formatMoney(n) {..} }`):
 *    the helper rule only reads `function|const|let` declarations;
 *  - an HTML entity between amount and suffix (`{price}&nbsp;đ`): only whitespace is skipped;
 *  - a suffix chosen by a ternary or other expression (`${n}${ok ? "đ" : ""}`): only a literal suffix right
 *    after the amount is seen;
 *  - a grouping regex written `([\d]{3})+` (a bracketed `\d` class): the triplet forms are `\d{3}`,
 *    `[0-9]{3}` and `\d\d\d`;
 *  - `\p{L}`-style boundaries are approximate for "đồng" (see DONG_COMPOUND_SECOND_WORD): a currency "đồng"
 *    followed by one of those second words is not flagged; an unlisted compound is a false positive;
 *  - a constant holding the ISO code `"VND"` alone (`const CURRENCY = "VND"`) is deliberately allowed (it is
 *    a currency CODE for an API field, not a suffix glued after an amount), so `${n} ${CURRENCY}` is a gap.
 */
const WEB_ROOT = join(__dirname, "..");
const SKIP = new Set(["node_modules", ".next", "public", "coverage", "playwright-report"]);
const OWNER = "lib/money.ts";

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const sources = walk(WEB_ROOT).filter(
  (f) =>
    /\.(ts|tsx|mjs|js)$/.test(f) &&
    !/\.(test|spec)\.[tj]sx?$/.test(f) &&
    relative(WEB_ROOT, f) !== OWNER,
);

/** The d-stroke (U+0111) written as itself or as a JS escape. Tests build it from escapes. */
const D_STROKE = String.raw`(?:đ|\\u0111|\\u\{0*111\})`;
/**
 * The Vietnamese word "dong" (currency) and not a longer word or a compound that merely starts with
 * it: no letter may follow directly (`đồngxu`), and it may not be followed by a word that makes a
 * different noun (`đồng đội` teammate, `đồng bộ` sync, `đồng hồ` clock, ...). Any other compound
 * is a false positive until its second word is added to this list.
 */
const DONG_COMPOUND_SECOND_WORD =
  "đội|bộ|hồ|ý|thời|nghiệp|loạt|hành|minh|tình|cảm|đều|bào|chí|phục|quê|lòng|ca|nhất|thuận|sự|tiền|xu|cỏ|nát|ruộng|bằng|dạng|môn";
const DONG_WORD = String.raw`đồng(?!\p{L})(?!\s+(?:${DONG_COMPOUND_SECOND_WORD})(?!\p{L}))`;
/** A currency suffix word: d-stroke, VND, VN + capital D-stroke (also escaped), "dong" in Vietnamese. */
const CURRENCY_SUFFIX = String.raw`(?:${DONG_WORD}|${D_STROKE}(?!\p{L})|VND(?!\p{L})|VN(?:Đ|\\u0110)(?!\p{L}))`;

type Rule = { name: string; find: (src: string) => boolean };

/** Removes block and line comments (see KNOWN GAPS: line-based, string-unaware; `://` is kept). */
function stripComments(src: string): string {
  return src
    .replace(/(?<![\w"'\x60\\*])\/\*[\s\S]*?\*\//g, " ")
    .replace(/(?<![:"'\x60\\])\/\/.*$/gm, "");
}

/** A rule that only ever looks at code, never at comments. */
const onCode = (find: (code: string) => boolean) => (src: string) => find(stripComments(src));

/** A bare name that is visibly a Date: d, dt, date, time, day, or a camelCase *At/*Date/*Time/*Day suffix. */
const DATE_NAME = /^(?:(?:d|dt|date|time|day)s?|\w*[a-z0-9_$](?:At|Date|Time|Day)s?)$/;

/** The index just past the group that closes the `)` or `]` at src[close]'s opener, scanning backwards: its opener index. */
function openerOf(src: string, close: number): number {
  let depth = 0;
  for (let j = close; j >= 0; j--) {
    const c = src[j];
    if (c === ")" || c === "]") depth++;
    else if ((c === "(" || c === "[") && --depth === 0) return j;
  }
  return 0;
}

/** The receiver expression that ends right before `.toLocaleString` (dotAt = index of that "."). */
function receiverBefore(src: string, dotAt: number): string {
  let end = dotAt;
  while (end > 0 && /[\s?]/.test(src[end - 1]!)) end--; // `x ?. y`, `x\n.y`
  let i = end;
  while (i > 0) {
    const ch = src[i - 1]!;
    if (ch === ")" || ch === "]") i = openerOf(src, i - 1);
    else if (/[\w$.?!]/.test(ch)) i--;
    else break;
  }
  const prefix = /\bnew\s+$/.exec(src.slice(0, i));
  return src.slice(prefix ? i - prefix[0].length : i, end).trim();
}

/** True for new Date(..), Date.now(), a parenthesised/cast/indexed/optional/non-null Date name. */
function isDateExpr(expr: string): boolean {
  const e = expr.replace(/[!?]+$/, "").trim();
  const open = e.indexOf("(");
  const isNewDate = /^new\s+Date$/.test(e.slice(0, Math.max(open, 0))) && e.endsWith(")");
  // `new Date(..)` only when that one call is the whole receiver (not `new Date(..).getTime()`)
  if ((isNewDate && openerOf(e, e.length - 1) === open) || e === "Date.now()") return true;
  if (e.startsWith("(") && e.endsWith(")") && openerOf(e, e.length - 1) === 0) {
    const inner = e.slice(1, -1).trim();
    return /\bas\s+Date$/.test(inner) || isDateExpr(inner.replace(/\s+as\s+[\w.<>| ]+$/, ""));
  }
  if (e.endsWith("]")) return isDateExpr(e.replace(/(?:\[[^[\]]*\])+$/, "")); // dates[i] -> dates
  if (e.endsWith(")")) return false; // some other call: Number(x), fee.get()
  return DATE_NAME.test((e.split(".").pop() ?? "").replace(/[!?]+$/, ""));
}

/** True when the code mentions toLocaleString on something that is not visibly a Date (or on nothing). */
function hasNumberToLocaleString(src: string): boolean {
  const code = stripComments(src);
  for (const m of code.matchAll(/\btoLocaleString\b/g)) {
    let k = m.index!;
    while (k > 0 && /\s/.test(code[k - 1]!)) k--;
    if (code[k - 1] !== ".") return true; // bare / destructured: no receiver to vouch for it
    if (!isDateExpr(receiverBefore(code, k - 1))) return true;
  }
  return false;
}

/** The word-boundary of a helper body: the next top-level declaration (incl. `export default function`). */
const NEXT_DECL =
  /\n(?:export\s+(?:default\s+)?)?(?:async\s+)?(?:function|const|let|class|type|interface|enum)\b/;

/** A format*Money/Vnd/Price helper whose body never calls formatVnd / formatVndInput. */
function hasOwnMoneyHelper(src: string): boolean {
  const code = stripComments(src);
  const decl =
    /\b(?:function|const|let)\s+(?:format|fmt)(?:Vnd|Money|Currency|Price|Amount|Dong)\w*/gi;
  for (const m of code.matchAll(decl)) {
    const rest = code.slice(m.index! + m[0].length);
    const next = rest.search(NEXT_DECL);
    const body = next === -1 ? rest : rest.slice(0, next);
    if (!/\bformatVnd(?:Input)?\s*\(/.test(body)) return true;
  }
  return false;
}

/** A 3-digit group repeated with + or *: \d{3}, [0-9]{3} or \d\d\d, as source text or as a RegExp string. */
const TRIPLET = String.raw`(?:\\{1,2}d\{3\}|\[0-9\]\{3\}|(?:\\{1,2}d){3})`;

/** Digit grouping in a regex: a repeated triplet group, or the classic (\d+)(\d{3}) loop. */
function hasGroupingRegex(code: string): boolean {
  return (
    new RegExp(String.raw`\((?:\?:)?${TRIPLET}\)[+*]`).test(code) ||
    new RegExp(String.raw`\(\\{1,2}d\+\)\(\\{1,2}d\{3\}\)`).test(code)
  );
}

/** An amount or interpolation directly before a currency suffix, outside regex character classes. */
function hasAmountBeforeSuffix(code: string): boolean {
  // `[0-9đ]` / `[a-zđ]` (a regex character class) is not an amount: drop plain classes first.
  const c = code.replace(/\[[^\][\s{}$"'\x60]*\]/g, "[]");
  return (
    new RegExp(String.raw`\}\s*${CURRENCY_SUFFIX}`, "u").test(c) ||
    new RegExp(String.raw`\d\s*${CURRENCY_SUFFIX}`, "u").test(c) ||
    new RegExp(String.raw`\+\s*["'\x60]\s*${CURRENCY_SUFFIX}`, "u").test(c)
  );
}

/** `const DONG = "d"` style: a constant that is only a currency suffix, to be glued after an amount. */
function hasSuffixConstant(code: string): boolean {
  const decl = new RegExp(
    String.raw`\b(?:const|let|var)\s+\w+\s*(?::[^=\n]+)?=\s*["'\x60](\s*${CURRENCY_SUFFIX}\s*)["'\x60]`,
    "gu",
  );
  // a bare ISO code ("VND", no whitespace) is a currency CODE, not a suffix to glue after an amount
  return [...code.matchAll(decl)].some((m) => m[1] !== "VND");
}

const RULES: Rule[] = [
  {
    // Catches Intl.NumberFormat, `const { NumberFormat: NF } = Intl`, Intl["NumberFormat"], aliases.
    name: "NumberFormat in any form",
    find: onCode((s) => /\bNumberFormat\b/.test(s) || /Intl\s*\[\s*["'`]Number/.test(s)),
  },
  {
    name: "currency-style number options",
    find: onCode((s) => /\bcurrencyDisplay\b|\bstyle\s*:\s*["'`]currency["'`]/.test(s)),
  },
  { name: "number toLocaleString (non-Date receiver)", find: hasNumberToLocaleString },
  {
    name: "dong sign U+20AB",
    find: onCode((s) => /₫|\\u20ab|\\u\{0*20ab\}|0x20ab/i.test(s)),
  },
  { name: "digit-grouping regex", find: onCode(hasGroupingRegex) },
  {
    // `${x}d`, `${x} VND`, JSX `{x} dong`, `150.000d`, `n + "d"`; a letter after the suffix is a word ("da", "den").
    name: "amount directly before a currency suffix",
    find: onCode(hasAmountBeforeSuffix),
  },
  { name: "currency suffix held in a constant", find: onCode(hasSuffixConstant) },
  { name: "own money-format helper (not delegating to formatVnd)", find: hasOwnMoneyHelper },
];

describe("one shared VND formatter (DD-128 OD-4b)", () => {
  it("scans real files and never skips the owner by accident", () => {
    expect(sources.some((f) => f.endsWith("components/sessions/session-card.tsx"))).toBe(true);
    expect(sources.length).toBeGreaterThan(50);
    expect(readFileSync(join(WEB_ROOT, OWNER), "utf8")).toContain("export function formatVnd");
  });

  for (const rule of RULES) {
    it(`no source file outside ${OWNER} uses: ${rule.name}`, () => {
      const offenders = sources.filter((f) => rule.find(readFileSync(f, "utf8")));
      expect(offenders.map((f) => relative(WEB_ROOT, f))).toEqual([]);
    });
  }
});

describe("the guard matcher itself", () => {
  const d = "đ"; // d-stroke
  const dBig = "Đ"; // capital D-stroke (VN + D-stroke)
  const dong = "đồng"; // the word "dong" (currency); also the first syllable of compounds
  const doi = "đội"; // dong doi = teammate
  const bo = "bộ"; // dong bo = sync
  const ho = "hồ"; // dong ho = clock
  const dongSign = "₫";
  const rule = (name: string): Rule => RULES.find((r) => r.name.startsWith(name))!;

  const POSITIVE: Array<[string, string]> = [
    ["NumberFormat", "new Intl.NumberFormat('vi-VN').format(n)"],
    ["NumberFormat", "const { NumberFormat: NF } = Intl;\nnew NF('vi')"],
    ["NumberFormat", "const { NumberFormat } = globalThis.Intl;"],
    ["NumberFormat", "const F = Intl['NumberFormat'];"],
    ["currency-style", "{ style: 'currency', currency: 'VND' }"],
    ["currency-style", "{ currencyDisplay: 'code' }"],
    ["number toLocaleString", "(5).toLocaleString('vi')"],
    ["number toLocaleString", "session.priceAmount.toLocaleString('vi-VN')"],
    ["number toLocaleString", "Number(x).toLocaleString()"],
    // names that merely CONTAIN at/time/day/date/when are money, not dates
    ["number toLocaleString", "courtRate.toLocaleString('vi-VN')"],
    ["number toLocaleString", "matchFee.toLocaleString('vi-VN')"],
    ["number toLocaleString", "vatAmount.toLocaleString('vi-VN')"],
    ["number toLocaleString", "todayTotal.toLocaleString('vi-VN')"],
    ["number toLocaleString", "prices[0].toLocaleString('vi-VN')"],
    ["number toLocaleString", "(total as number).toLocaleString()"],
    ["number toLocaleString", "const f = total.toLocaleString;"],
    ["number toLocaleString", "const { toLocaleString } = total;"],
    ["number toLocaleString", "new Date(x).getTime().toLocaleString()"],
    ["dong sign", `const s = "x ${dongSign}"`],
    ["dong sign", "const a = 0x20AB"],
    ["dong sign", "const s = '\\u20AB'"],
    ["digit-grouping", "s.replace(/\\B(?=(\\d{3})+(?!\\d))/g, '.')"],
    ["digit-grouping", "s.replace(/(\\d)(?=(\\d{3})+$)/g, '$1.')"],
    ["digit-grouping", "s.replace(/(\\d)(?=(?:\\d{3})+$)/g, '$1,')"],
    ["digit-grouping", "s.replace(/(?=([0-9]{3})+$)/g, '.')"],
    ["digit-grouping", "s.replace(new RegExp('\\\\B(?=(\\\\d{3})+(?!\\\\d))', 'g'), '.')"],
    ["digit-grouping", "s.replace(/(\\d)(?=(\\d\\d\\d)+$)/g, '$1.')"],
    ["digit-grouping", "while (/(\\d+)(\\d{3})/.test(s)) s = s.replace(/(\\d+)(\\d{3})/, '$1.$2')"],
    ["amount directly", "t(`${session.priceAmount} " + d + "`, 'x')"],
    ["amount directly", "`${n} VND`"],
    ["amount directly", "`${n}VND`"],
    ["amount directly", "`${n} VN" + dBig + "`"],
    ["amount directly", "<span>{x} " + d + "ồng</span>"],
    ["amount directly", "`${n} " + dong + "`"],
    ["amount directly", "`${n} " + dong + " mỗi người`"],
    ["amount directly", "const s = n + ' VND'"],
    ["amount directly", "const s = '150.000 VND'"],
    ["currency suffix", "const DONG = '" + d + "';\nconst s = `${n}${DONG}`;"],
    ["currency suffix", "const SUFFIX: string = ' VND'"],
    ["amount directly", "`${x}" + d + "`"],
    ["amount directly", "<span>{price} " + d + "</span>"],
    ["amount directly", "<span>{price}" + d + "</span>"],
    ["amount directly", "const s = '150.000" + d + "'"],
    ["amount directly", "const s = n + '" + d + "'"],
    ["amount directly", "`${x}\\u0111`"],
    ["own money-format", "function formatMoney(n) { return String(n); }"],
    ["own money-format", "const fmtPrice = (n) => n + '.'"],
    [
      "own money-format",
      "export function formatMoney(n) {\n  return `${n}`;\n}\nexport default function Page() {\n  return formatVnd(1);\n}",
    ],
    ["own money-format", "function formatPrice(n) { return `${n}`; } // formatVnd(n)"],
    [
      "own money-format",
      "const formatPrice = (n) => {\n  return `${n}`;\n};\nconst other = formatVnd(1);",
    ],
  ];

  const NEGATIVE: Array<[string, string]> = [
    ["number toLocaleString", "new Date(iso).toLocaleString(lang === 'en' ? 'en-GB' : 'vi-VN')"],
    ["number toLocaleString", "startsAt.toLocaleString('vi-VN')"],
    ["number toLocaleString", "const d = new Date(x); d.toLocaleString()"],
    ["number toLocaleString", "createdAt.toLocaleString()"],
    ["number toLocaleString", "startsAt!.toLocaleString('vi-VN')"],
    ["number toLocaleString", "session.startsAt?.toLocaleString('vi-VN')"],
    ["number toLocaleString", "session?.startsAt!.toLocaleString()"],
    ["number toLocaleString", "(startsAt as Date).toLocaleString()"],
    ["number toLocaleString", "(row.startsAt as unknown as Date).toLocaleString()"],
    ["number toLocaleString", "rows[0].startsAt.toLocaleString()"],
    ["number toLocaleString", "dates[i].toLocaleString()"],
    ["number toLocaleString", "Date.now().toLocaleString()"],
    ["number toLocaleString", "new Date(a, (b + 1)).toLocaleString()"],
    ["number toLocaleString", "// price.toLocaleString() would be wrong\nconst z = 1;"],
    ["NumberFormat", "const n = 'number format of a phone'"],
    ["NumberFormat", "// never new Intl.NumberFormat here\nconst z = 1;"],
    ["NumberFormat", "/* Intl.NumberFormat is banned */ const z = 1;"],
    ["amount directly", "t('Giờ " + d + "ã bắt đầu', 'x') ; {count} " + d + "ã xong"],
    ["amount directly", "t('Chưa " + d + "ăng nhập', 'x') // {name} " + d + "ợi"],
    ["amount directly", "t('Từ 1 " + d + "ến 5', 'x')"],
    ["amount directly", "t('Tối " + d + "a 200 ký tự', 'Up to 200 characters')"],
    ["dong sign", "const s = formatVnd(150000)"],
    ["amount directly", "const ok = /[0-9" + d + "]/.test(s) && /[a-z" + d + "]/.test(s)"],
    ["amount directly", "t('Ghi " + d + "ồng ý', 'x') // {n} VND"],
    ["amount directly", "t('Giá mỗi người (VND)', 'Price per person (VND)')"],
    ["currency suffix", "const LABEL = 'Giá (VND)';"],
    ["currency suffix", "const CURRENCY = 'VND';"],
    ["currency suffix", 'export const CURRENCY: string = "VND"'],
    // "dong" followed by a letter, or the first word of another noun, is not the currency
    ["amount directly", "t(`${n} " + dong + " " + doi + "`, 'x')"],
    ["amount directly", "t('Bước 2 " + dong + " " + bo + "', 'Step 2 sync')"],
    ["amount directly", "<span>{n} " + dong + " " + ho + "</span>"],
    ["amount directly", "<span>{n} " + dong + "xu</span>"],
    ["digit-grouping", "/^\\d+$/.test(s) && /\\d{1,3}/.test(s)"],
    ["digit-grouping", "const phone = /^(\\d{3})(\\d{3})(\\d{4})$/.exec(s)"],
    ["digit-grouping", "const iso = /T\\d{2}:\\d{2}:\\d{2}\\.(\\d{3})Z$/.exec(s)"],
    ["digit-grouping", "// s.replace(/(?=(\\d{3})+$)/g, '.')\nconst z = 1;"],
    ["own money-format", "function formatPrice(n) { return formatVnd(n); }\nconst z = 1;"],
    ["own money-format", "const formatMoney = (n: number) => formatVnd(n);"],
    ["own money-format", "const formatPriceInput = (n: number | null) => formatVndInput(n);"],
    [
      "own money-format",
      "const formatPrice = (n) => formatVnd(n);\nexport default function Page() {\n  return `${n}`;\n}",
    ],
    ["own money-format", "const formatAmountLine = (n) => {\n  return `Còn ${formatVnd(n)}`;\n};"],
  ];

  for (const [name, snippet] of POSITIVE) {
    it(`flags (${name}): ${snippet.replace(/\n/g, "\\n").slice(0, 60)}`, () => {
      expect(rule(name).find(snippet)).toBe(true);
    });
  }
  for (const [name, snippet] of NEGATIVE) {
    it(`allows (${name}): ${snippet.replace(/\n/g, "\\n").slice(0, 60)}`, () => {
      expect(rule(name).find(snippet)).toBe(false);
    });
  }
});
