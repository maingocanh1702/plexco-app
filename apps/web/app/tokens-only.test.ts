import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { THEME_BG_DARK, THEME_BG_LIGHT, THEME_PRIMARY } from "../lib/theme-colors";

/**
 * FE-INV-2 (tokens only). Component stylesheets and TSX may not carry colour literals; the one
 * place values live is app/globals.css. Also fails on a `var(--x)` that globals.css never defines.
 */
const WEB_ROOT = join(__dirname, "..");
const SKIP = new Set(["node_modules", ".next", "e2e", "public", "coverage", "playwright-report"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const files = walk(WEB_ROOT);
const styled = files.filter(
  (f) => (f.endsWith(".module.css") || f.endsWith(".tsx")) && !f.endsWith(".test.tsx"),
);
const globals = readFileSync(join(WEB_ROOT, "app/globals.css"), "utf8");
const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/;

describe("tokens-only (FE-INV-2)", () => {
  it("scans real files", () => {
    expect(styled.some((f) => f.endsWith(".module.css"))).toBe(true);
    expect(styled.some((f) => f.endsWith(".tsx"))).toBe(true);
  });

  it("no *.module.css or *.tsx contains a hex/rgb/hsl colour literal", () => {
    const offenders = styled.filter((f) => COLOR_LITERAL.test(readFileSync(f, "utf8")));
    expect(offenders.map((f) => relative(WEB_ROOT, f))).toEqual([]);
  });

  it("every var(--token) used in component CSS/TSX is defined in globals.css", () => {
    const defined = new Set([...globals.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
    defined.add("--font-be-vietnam-pro").add("--font-inter"); // injected by next/font on <html>
    const missing = new Set<string>();
    for (const file of styled) {
      for (const m of readFileSync(file, "utf8").matchAll(/var\((--[a-z0-9-]+)/g)) {
        if (!defined.has(m[1]!)) missing.add(`${relative(WEB_ROOT, file)}: ${m[1]}`);
      }
    }
    expect([...missing]).toEqual([]);
  });
});

describe("design-tokens.md and globals.css name the same tokens", () => {
  const doc = readFileSync(join(WEB_ROOT, "../../docs/standards/design-tokens.md"), "utf8");
  const declared = (text: string) =>
    new Set([...text.matchAll(/(?<![\w-])(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]!));
  const docTokens = declared(doc);
  const cssTokens = declared(globals);

  it("every documented token is defined in globals.css", () => {
    expect([...docTokens].filter((name) => !cssTokens.has(name))).toEqual([]);
  });

  it("every token in globals.css is documented", () => {
    expect([...cssTokens].filter((name) => !docTokens.has(name))).toEqual([]);
  });

  it("--tracking-tight agrees", () => {
    const value = (text: string) => /--tracking-tight:\s*([^;\s]+)/.exec(text)?.[1];
    expect(value(doc)).toBe(value(globals));
  });
});

describe("theme-colors mirror globals.css", () => {
  it("--primary and light --bg-page match", () => {
    expect(globals).toContain(`--primary: ${THEME_PRIMARY};`);
    expect(globals).toContain(`--bg-page: var(--gray-50);`);
    expect(globals).toContain(`--gray-50: ${THEME_BG_LIGHT};`);
  });

  it("dark --bg-page matches", () => {
    expect(globals).toContain(`--bg-page: ${THEME_BG_DARK};`);
  });
});
