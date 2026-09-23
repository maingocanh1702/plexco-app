import { describe, expect, it } from "vitest";

/**
 * Guards against the job_definer DB test helpers being re-copied across bot test files
 * (measured 2026-09-23: byte-identical in dispatcher.test.ts, preflight.test.ts,
 * schedule.test.ts). test-db.ts DEFINES/exports them; every test file must import them.
 */
describe("job_definer test helpers have exactly one definition (test-db.ts)", () => {
  const HELPER_NAMES = [
    "bootstrapJobDefiner",
    "withJobDefinerLock",
    "setAppWorkerPasswordRaceSafe",
    "testUrl",
  ] as const;

  async function listSrcFiles(): Promise<string[]> {
    const { readdirSync, statSync } = await import("node:fs");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const root = path.dirname(fileURLToPath(import.meta.url));
    const files: string[] = [];
    for (const entry of readdirSync(root)) {
      const full = path.join(root, entry);
      if (statSync(full).isDirectory()) continue;
      // Excluded: this guard's own source quotes the helper names/literal it looks for.
      if (/\.ts$/.test(entry) && entry !== "test-db.test.ts") files.push(full);
    }
    return files;
  }

  it("has no re-declared copy of any of the four helpers outside test-db.ts", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const files = await listSrcFiles();
    for (const name of HELPER_NAMES) {
      const defRe = new RegExp(`^(export )?(async )?function ${name}[<(]`, "m");
      const hits = files
        .filter((file) => defRe.test(readFileSync(file, "utf8")))
        .map((file) => path.basename(file));
      expect(hits).toEqual(["test-db.ts"]);
    }
  });

  it("has no re-declared copy of the JOB_DEFINER_LOCK_KEY literal outside test-db.ts", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const files = await listSrcFiles();
    const hits = files
      .filter((file) => readFileSync(file, "utf8").includes("0x6a6f6264"))
      .map((file) => path.basename(file));
    expect(hits).toEqual(["test-db.ts"]);
  });

  it("JOB_DEFINER_LOCK_KEY matches packages/db/src/test-harness.ts's own key", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const root = path.dirname(fileURLToPath(import.meta.url));
    const dbHarnessPath = path.resolve(
      root,
      "..",
      "..",
      "..",
      "packages",
      "db",
      "src",
      "test-harness.ts",
    );
    const dbHarnessSource = readFileSync(dbHarnessPath, "utf8");
    const match = dbHarnessSource.match(/JOB_DEFINER_LOCK_KEY\s*=\s*(0x[0-9a-fA-F]+)/);
    expect(match).not.toBeNull();
    const dbHarnessKey = Number(match![1]);

    const { JOB_DEFINER_LOCK_KEY } = await import("./test-db.js");
    expect(JOB_DEFINER_LOCK_KEY).toBe(dbHarnessKey);
  });
});
