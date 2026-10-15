import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * DD-123 OD-7 pins. The heading face must be Be Vietnam Pro with the "vietnamese" subset (the
 * previous face had none, so stacked Vietnamese vowels fell back to another font), and the chain
 * layout.tsx -> next/font CSS variable -> globals.css --font-heading -> design-tokens.md must stay
 * connected: a renamed variable would silently drop headings to Inter and keep every other test green.
 */
const WEB_ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(WEB_ROOT, rel), "utf8");
const layout = read("app/layout.tsx");
const globals = read("app/globals.css");
const doc = readFileSync(join(WEB_ROOT, "../../docs/standards/design-tokens.md"), "utf8");

/** The `{ ... }` option object passed to `Be_Vietnam_Pro(` in layout.tsx. */
const options = /\bBe_Vietnam_Pro\(\s*\{([^}]*)\}/.exec(layout)?.[1] ?? "";
const strings = (list: string | undefined) =>
  [...(list ?? "").matchAll(/["']([^"']+)["']/g)].map((m) => m[1]!);

/** Value of `--font-heading:` as one whitespace-normalised, single-quoted line. */
const headingValue = (text: string) =>
  /--font-heading:\s*([^;]+);/.exec(text)?.[1]?.replace(/\s+/g, " ").replace(/"/g, "'").trim();

describe("heading font = Be Vietnam Pro with a vietnamese subset (DD-123 OD-7)", () => {
  it("layout.tsx loads Be_Vietnam_Pro from next/font/google", () => {
    expect(layout).toMatch(
      /import\s*\{[^}]*\bBe_Vietnam_Pro\b[^}]*\}\s*from\s*["']next\/font\/google["']/,
    );
    expect(options).not.toBe("");
  });

  it('its subsets include "vietnamese"', () => {
    expect(strings(/subsets:\s*\[([^\]]*)\]/.exec(options)?.[1])).toContain("vietnamese");
  });

  it("loads only the weights a heading uses (700), not a preloaded-but-unused 600", () => {
    expect(strings(/weight:\s*\[([^\]]*)\]/.exec(options)?.[1])).toEqual(["700"]);
  });

  it("the variable layout.tsx declares is the first var() of globals.css --font-heading", () => {
    const declared = /variable:\s*["'](--[a-z0-9-]+)["']/.exec(options)?.[1];
    expect(declared).toMatch(/^--font-/);
    // ...and it is the one actually attached to <html>, not just declared.
    const constName = /const\s+(\w+)\s*=\s*Be_Vietnam_Pro\(/.exec(layout)?.[1];
    expect(constName).toBeTruthy();
    expect(layout).toMatch(new RegExp(`\\$\\{${constName}\\.variable\\}`));
    expect(/var\((--[a-z0-9-]+)/.exec(headingValue(globals) ?? "")?.[1]).toBe(declared);
  });

  it("design-tokens.md --font-heading equals globals.css", () => {
    expect(headingValue(doc)).toBeTruthy();
    expect(headingValue(doc)).toBe(headingValue(globals));
  });

  it("every --font-heading rule uses --font-bold (the only weight loaded), when it sets one", () => {
    const cssFiles = walk(WEB_ROOT).filter((f) => f.endsWith(".css"));
    const bad: string[] = [];
    for (const file of cssFiles) {
      for (const block of read(relative(WEB_ROOT, file)).split("}")) {
        if (!/font-family:\s*var\(--font-heading\)/.test(block)) continue;
        const weight = /font-weight:\s*([^;]+);/.exec(block)?.[1]?.trim();
        if (weight !== undefined && weight !== "var(--font-bold)") {
          bad.push(`${relative(WEB_ROOT, file)}: ${weight}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("no previous heading face name survives in app/, components/ or lib/", () => {
    const old = new RegExp(`\\b${"So"}${"ra"}\\b`, "i");
    const hits = ["app", "components", "lib"]
      .flatMap((dir) => walk(join(WEB_ROOT, dir)))
      .filter((f) => /\.(ts|tsx|css|mjs|js)$/.test(f) && old.test(readFileSync(f, "utf8")));
    expect(hits.map((f) => relative(WEB_ROOT, f))).toEqual([]);
  });
});

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}
