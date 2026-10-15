import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * DD-128 OD-4b guard: apps/web has exactly ONE money formatter, lib/money.ts. Any other source
 * file that formats a number itself (Intl.NumberFormat, number toLocaleString, the dong sign
 * U+20AB, a home-made thousands regex or a format*Money/Vnd/Price helper) fails here, so a second
 * "150.000 d" style cannot creep back. Test files are exempt (they assert the absence of U+20AB).
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

const FORBIDDEN: Array<[string, RegExp]> = [
  ["Intl.NumberFormat", /Intl\s*\.\s*NumberFormat/],
  // toLocaleString on anything but a Date (toLocaleDateString/TimeString are different names).
  ["number toLocaleString", /(?<!new Date\([^)]*\))\.toLocaleString\s*\(/],
  ["dong sign U+20AB", /\u20ab|\\u20ab|\\u\{20ab\}|0x20ab/i],
  ["own thousands regex", /\\B\(\?=\(\\d\{3\}\)\+/],
  [
    "own money-format helper",
    /\b(?:function|const|let)\s+(?:format|fmt)(?:Vnd|Money|Currency|Price|Amount|Dong)\w*/i,
  ],
];

describe("one shared VND formatter (DD-128 OD-4b)", () => {
  it("scans real files and never skips the owner by accident", () => {
    expect(sources.some((f) => f.endsWith("components/sessions/session-card.tsx"))).toBe(true);
    expect(sources.length).toBeGreaterThan(50);
    expect(readFileSync(join(WEB_ROOT, OWNER), "utf8")).toContain("export function formatVnd");
  });

  for (const [name, pattern] of FORBIDDEN) {
    it(`no source file outside ${OWNER} uses: ${name}`, () => {
      const offenders = sources.filter((f) => pattern.test(readFileSync(f, "utf8")));
      expect(offenders.map((f) => relative(WEB_ROOT, f))).toEqual([]);
    });
  }

  it("the guard patterns themselves match what they claim to ban", () => {
    expect(FORBIDDEN[0]![1].test("new Intl.NumberFormat('vi')")).toBe(true);
    expect(FORBIDDEN[1]![1].test("(5).toLocaleString('vi')")).toBe(true);
    expect(FORBIDDEN[1]![1].test("new Date(iso).toLocaleString('vi')")).toBe(false);
    expect(FORBIDDEN[2]![1].test("x \u20ab")).toBe(true);
    expect(FORBIDDEN[2]![1].test("const a = 0x20AB")).toBe(true);
    expect(FORBIDDEN[3]![1].test("s.replace(/\\B(?=(\\d{3})+(?!\\d))/g, '.')")).toBe(true);
    expect(FORBIDDEN[4]![1].test("function formatMoney(n) {}")).toBe(true);
    expect(FORBIDDEN[4]![1].test("const fmtPrice = (n) => n")).toBe(true);
  });
});
