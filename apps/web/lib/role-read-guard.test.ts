import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * DD-56 property kept after the interim gate was retired: no file in apps/web decides on a
 * membership role. `authorize()` exports `role` on its decision, so a future route could branch on
 * it; this whole-tree pin fails any non-test source that reads a `.role` property or `["role"]`.
 * The two surfaces that legitimately OBTAIN roles (and, for readiness, still check owner) are the
 * only exemptions.
 */
const WEB_ROOT = fileURLToPath(new URL("..", import.meta.url));
const EXEMPT = new Set(["app/api/auth/session/route.ts", "app/api/onboarding/readiness/route.ts"]);
const SKIP_DIRS = new Set(["node_modules", ".next"]);

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      return SKIP_DIRS.has(entry.name) ? [] : sources(path.join(dir, entry.name));
    }
    const name = entry.name;
    if (!/\.(ts|tsx)$/.test(name) || /\.test\.(ts|tsx)$/.test(name) || name.endsWith(".d.ts")) {
      return [];
    }
    return [path.join(dir, name)];
  });
}

const BRACKET_READ = /\[\s*["'`]role["'`]\s*\]/;
const DOT_READ = /\.role\b/;
// Single-line string literals are blanked before the dot test so a log key such as "db.role.mismatch"
// is not mistaken for a property read; the bracket form is tested on the raw text first.
const blankStrings = (src: string) => src.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""');
const readsRole = (src: string) => BRACKET_READ.test(src) || DOT_READ.test(blankStrings(src));

describe("DD-56: no apps/web source reads a role property", () => {
  const rel = (f: string) => path.relative(WEB_ROOT, f).split(path.sep).join("/");
  const files = sources(WEB_ROOT).filter((f) => !EXEMPT.has(rel(f)));

  it("scans the real tree (not a vacuous pass)", () => {
    const names = files.map(rel);
    expect(names).toContain("lib/session-command-route.ts");
    expect(names).toContain("lib/session-read-route.ts");
    expect(names).toContain("app/api/sessions/route.ts");
    expect(names.length).toBeGreaterThan(20);
  });

  it('finds no `.role` / ["role"] read outside the two exempt surfaces', () => {
    const offenders = files.filter((f) => readsRole(readFileSync(f, "utf8"))).map(rel);
    expect(offenders).toEqual([]);
  });

  it("the detector matches the forms it must catch", () => {
    for (const src of ["m.role === 'owner'", "const { x } = d; d['role']", "d?.role"]) {
      expect(readsRole(src), src).toBe(true);
    }
    expect(readsRole("const roleName = 1; // enrole")).toBe(false);
    expect(readsRole('log.error("db.role.mismatch", {})')).toBe(false);
  });
});
