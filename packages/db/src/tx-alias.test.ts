import { describe, expect, it } from "vitest";

/**
 * Guards against the hand-derived Db["transaction"] callback-argument alias being re-copied
 * (2026-09-10 backlog row: it was hand-duplicated in six files). client.ts DEFINES/exports it;
 * every other consumer must import it. capability.test.ts:38 declares an unrelated `type Tx`
 * (`Parameters<typeof resolveCapability>[0]`) and is excluded on purpose.
 *
 * The alias literal is built from two halves below (never written contiguously in this file)
 * so this guard can scan itself along with every other file.
 */
describe("Tx type alias has exactly one definition (client.ts)", () => {
  it("has no re-declared copy anywhere under packages/db/src", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const root = path.dirname(fileURLToPath(import.meta.url));
    const ALIAS_HEAD = 'type Tx = Parameters<Parameters<Db["transac';
    const ALIAS_TAIL = 'tion"]>[0]>[0];';
    const ALIAS = ALIAS_HEAD + ALIAS_TAIL;
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry === ".next" || entry === "dist") continue;
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.ts$/.test(entry) && entry !== "capability.test.ts") {
          if (readFileSync(full, "utf8").includes(ALIAS)) hits.push(path.basename(full));
        }
      }
    };
    walk(root);
    expect(hits).toEqual(["client.ts"]);
  });
});
