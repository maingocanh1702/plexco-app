import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * DD-128 OD-4b guard: apps/web has exactly ONE money formatter, lib/money.ts. Any other source
 * file that formats a number itself fails here, so a second "150.000 d" style cannot creep back.
 * Banned outside lib/money.ts (see RULES below): any NumberFormat identifier (Intl.NumberFormat,
 * destructured or aliased), currency-style options, toLocaleString on anything that is not
 * visibly a Date, the dong sign U+20AB, digit-grouping regexes, an amount (or any digit) written
 * directly before a d-stroke currency suffix, and format*Money/Vnd/Price helpers that do not
 * delegate to formatVnd. Test files are exempt (they assert the absence of U+20AB).
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

type Rule = { name: string; find: (src: string) => boolean };

/** A toLocaleString receiver that is visibly a date: new Date(..), Date.now(), *Date/*At/*Time/d/dt. */
const DATE_RECEIVER = /^(?:new Date\(.*\)|Date\.now\(\)|d|dt|\w*(?:date|time|at|when|day)\w*)$/i;

/** True when the file calls toLocaleString on something that is not visibly a Date. */
function hasNumberToLocaleString(src: string): boolean {
  const call = /(new Date\([^)]*\)|[\w$]+(?:\([^()]*\))?|\))\s*\??\.\s*toLocaleString\s*\(/g;
  for (const m of src.matchAll(call)) {
    if (!DATE_RECEIVER.test(m[1]!)) return true;
  }
  return /(?<![\w$])toLocaleString\s*\(/.test(src.replace(call, ""));
}

/** A format*Money/Vnd/Price helper whose body (up to the next top-level declaration) never calls formatVnd. */
function hasOwnMoneyHelper(src: string): boolean {
  const decl =
    /\b(?:function|const|let)\s+(?:format|fmt)(?:Vnd|Money|Currency|Price|Amount|Dong)\w*/gi;
  for (const m of src.matchAll(decl)) {
    const rest = src.slice(m.index! + m[0].length);
    const next = rest.search(/\n(?:export\s+)?(?:async\s+)?(?:function|const|let|class)\b/);
    const body = next === -1 ? rest : rest.slice(0, next);
    if (!/\bformatVnd\s*\(/.test(body)) return true;
  }
  return false;
}

const RULES: Rule[] = [
  {
    // Catches Intl.NumberFormat, `const { NumberFormat: NF } = Intl`, Intl["NumberFormat"], aliases.
    name: "NumberFormat in any form",
    find: (s) => /\bNumberFormat\b/.test(s) || /Intl\s*\[\s*["'`]Number/.test(s),
  },
  {
    name: "currency-style number options",
    find: (s) => /\bcurrencyDisplay\b|\bstyle\s*:\s*["'`]currency["'`]/.test(s),
  },
  { name: "number toLocaleString (non-Date receiver)", find: hasNumberToLocaleString },
  {
    name: "dong sign U+20AB",
    find: (s) => /₫|\\u20ab|\\u\{0*20ab\}|0x20ab/i.test(s),
  },
  {
    // (?=(\d{3})+$) , (?=(?:\d{3})+(?!\d)) , [0-9]{3} variants, and a capturing (\d{3}) group.
    name: "digit-grouping regex",
    find: (s) =>
      /\(\?=\(?(?:\?:)?(?:\\d|\[0-9\])\{3\}/.test(s) || /\((?:\?:)?(?:\\d|\[0-9\])\{3\}\)/.test(s),
  },
  {
    // `${x}d`, `${x} d`, JSX `{x} d`, `150.000d`, `n + "d"`; a letter after the d-stroke is a word ("da", "den").
    name: "amount directly before a d-stroke currency suffix",
    find: (s) =>
      new RegExp(String.raw`\}\s*${D_STROKE}(?!\p{L})`, "u").test(s) ||
      new RegExp(String.raw`\d\s*${D_STROKE}(?!\p{L})`, "u").test(s) ||
      new RegExp(String.raw`\+\s*["'\x60]\s*${D_STROKE}(?!\p{L})`, "u").test(s),
  },
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
    ["dong sign", `const s = "x ${dongSign}"`],
    ["dong sign", "const a = 0x20AB"],
    ["dong sign", "const s = '\\u20AB'"],
    ["digit-grouping", "s.replace(/\\B(?=(\\d{3})+(?!\\d))/g, '.')"],
    ["digit-grouping", "s.replace(/(\\d)(?=(\\d{3})+$)/g, '$1.')"],
    ["digit-grouping", "s.replace(/(\\d)(?=(?:\\d{3})+$)/g, '$1,')"],
    ["digit-grouping", "s.replace(/(?=([0-9]{3})+$)/g, '.')"],
    ["amount directly", "t(`${session.priceAmount} " + d + "`, 'x')"],
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
      "const formatPrice = (n) => {\n  return `${n}`;\n};\nconst other = formatVnd(1);",
    ],
  ];

  const NEGATIVE: Array<[string, string]> = [
    ["number toLocaleString", "new Date(iso).toLocaleString(lang === 'en' ? 'en-GB' : 'vi-VN')"],
    ["number toLocaleString", "startsAt.toLocaleString('vi-VN')"],
    ["number toLocaleString", "const d = new Date(x); d.toLocaleString()"],
    ["number toLocaleString", "createdAt.toLocaleString()"],
    ["NumberFormat", "const n = 'number format of a phone'"],
    ["amount directly", "t('Giờ " + d + "ã bắt đầu', 'x') ; {count} " + d + "ã xong"],
    ["amount directly", "t('Chưa " + d + "ăng nhập', 'x') // {name} " + d + "ợi"],
    ["amount directly", "t('Từ 1 " + d + "ến 5', 'x')"],
    ["amount directly", "t('Tối " + d + "a 200 ký tự', 'Up to 200 characters')"],
    ["dong sign", "const s = formatVnd(150000)"],
    ["digit-grouping", "/^\\d+$/.test(s) && /\\d{1,3}/.test(s)"],
    ["own money-format", "function formatPrice(n) { return formatVnd(n); }\nconst z = 1;"],
    ["own money-format", "const formatMoney = (n: number) => formatVnd(n);"],
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
