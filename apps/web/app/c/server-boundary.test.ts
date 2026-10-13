import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Trust boundary for /c/**: pages and layouts under this tree take only `tenantId`; every piece
 * of tenant data arrives through /api after the client-side membership proof. So nothing here may
 * reach the database, and the only session helper it may import is `currentSession`.
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

const FORBIDDEN = [/@plexco\/db/, /\bappDb\b/, /\bwithTenant\b/, /\btenantRepo\b/, /next\/headers/];

describe("app/c/** server boundary", () => {
  const files = walk(ROOT);

  it("scans the club route files", () => {
    expect(files.length).toBeGreaterThan(3);
  });

  it("imports no database access or next/headers", () => {
    const offenders = files.flatMap((file) => {
      const text = readFileSync(file, "utf8");
      return FORBIDDEN.filter((rx) => rx.test(text)).map((rx) => `${relative(ROOT, file)}: ${rx}`);
    });
    expect(offenders).toEqual([]);
  });

  it("imports only currentSession from lib/session-cookies", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
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
