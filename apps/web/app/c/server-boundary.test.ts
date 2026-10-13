import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Trust boundary for /c/**: pages and layouts under this tree take only `tenantId`; every piece
 * of tenant data arrives through /api after the client-side membership proof. So nothing here may
 * reach the database, and the only session helper it may import is `currentSession`.
 *
 * What is checked: FORBIDDEN patterns over the direct files AND their relative-transitive import
 * closure (`./`, `../`; static, `import * as`, default, side-effect, dynamic and re-export forms;
 * `.ts/.tsx/.js/index` resolution). Not checked: package-path indirection (`@plexco/*`, `@/`
 * aliases) is not followed, and `lib/session-cookies` is the one permitted seam so its own
 * server-side imports are not walked. This is a textual guard, not a module-graph proof.
 */
const ROOT = __dirname;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

const SEAM = /session-cookies$/;
const IMPORT_SPEC = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["'](\.{1,2}\/[^"']*)["']/g;

function resolveImport(from: string, spec: string): string | null {
  const base = join(dirname(from), spec.replace(/\.js$/, ""));
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ];
  return candidates.find((c) => existsSync(c) && statSync(c).isFile()) ?? null;
}

/** Files plus everything they reach through relative imports (excluding the session seam). */
function closure(roots: string[]): string[] {
  const seen = new Set<string>(roots);
  const queue = [...roots];
  while (queue.length > 0) {
    const file = queue.pop()!;
    for (const m of readFileSync(file, "utf8").matchAll(IMPORT_SPEC)) {
      if (SEAM.test(m[1]!)) continue;
      const next = resolveImport(file, m[1]!);
      if (next && !seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return [...seen];
}

const FORBIDDEN = [/@plexco\/db/, /\bappDb\b/, /\bwithTenant\b/, /\btenantRepo\b/, /next\/headers/];

describe("app/c/** server boundary", () => {
  const files = walk(ROOT);
  const reached = closure(files);

  it("scans the club route files", () => {
    expect(files.length).toBeGreaterThan(3);
  });

  it("imports no database access or next/headers (direct and relative-transitive)", () => {
    const offenders = reached.flatMap((file) => {
      const text = readFileSync(file, "utf8");
      return FORBIDDEN.filter((rx) => rx.test(text)).map((rx) => `${relative(ROOT, file)}: ${rx}`);
    });
    expect(offenders).toEqual([]);
  });

  it("imports only currentSession from lib/session-cookies", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/import\s+\*\s+as\s+\w+\s+from\s*"[^"]*session-cookies"/g)) {
        offenders.push(`${relative(ROOT, file)}: ${m[0]}`);
      }
      for (const m of text.matchAll(
        /import\s+\w+\s*(?:,\s*\{[^}]*\}\s*)?from\s*"[^"]*session-cookies"/g,
      )) {
        offenders.push(`${relative(ROOT, file)}: ${m[0]}`);
      }
      for (const m of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*"[^"]*session-cookies"/g)) {
        const names = m[1]!
          .split(",")
          .map((n) => n.trim())
          .filter(Boolean);
        for (const name of names) {
          if (name !== "currentSession") offenders.push(`${relative(ROOT, file)}: ${name}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
