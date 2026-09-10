import { describe, expect, it } from "vitest";

/**
 * Guards against `type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0]` being re-copied
 * (2026-09-10 backlog row: it was hand-duplicated in six files). client.ts DEFINES/exports it;
 * every other consumer must import it. capability.test.ts:38 declares an unrelated `type Tx`
 * (`Parameters<typeof resolveCapability>[0]`) and is excluded on purpose.
 */
describe("Tx type alias has exactly one definition (client.ts)", () => {
  it("has no re-declared copy anywhere under packages/db/src", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const root = path.dirname(fileURLToPath(import.meta.url));
    const ALIAS = 'type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];';
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry === ".next" || entry === "dist") continue;
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (
          /\.ts$/.test(entry) &&
          entry !== "capability.test.ts" &&
          entry !== "tx-alias.test.ts"
        ) {
          if (readFileSync(full, "utf8").includes(ALIAS)) hits.push(path.basename(full));
        }
      }
    };
    walk(root);
    expect(hits).toEqual(["client.ts"]);
  });
});
