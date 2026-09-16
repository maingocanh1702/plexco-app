import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const vitest = path.join(path.dirname(require.resolve("vitest/package.json")), "vitest.mjs");
const harness = pathToFileURL(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "test-harness.ts"),
);

async function runProbe(tests: string, hookTimeout = 400) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "plexco-test-lifecycle-"));
  try {
    await writeFile(
      path.join(directory, "vitest.config.mjs"),
      `export default { test: {
      globals: true, include: ["probe.test.ts"], testTimeout: 40, hookTimeout: ${hookTimeout},
      fileParallelism: false, sequence: { concurrent: false }
    } };`,
    );
    await writeFile(
      path.join(directory, "probe.test.ts"),
      `
      import { appendFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
      import { withTestContext } from ${JSON.stringify(harness.href)};
      const record = (event) => appendFileSync("events.jsonl", JSON.stringify(event) + "\\n");
      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      ${tests}
    `,
    );
    const result = await execFileAsync(
      process.execPath,
      [
        vitest,
        "run",
        "--config",
        "vitest.config.mjs",
        "--reporter=default",
        "--reporter=json",
        "--outputFile.json=report.json",
      ],
      {
        cwd: directory,
        env: { ...process.env, NO_COLOR: "1" },
        timeout: 30_000,
      },
    ).then(
      ({ stdout, stderr }) => ({ code: 0, stdout, stderr }),
      (error: { code?: number; stdout?: string; stderr?: string }) => ({
        code: error.code,
        stdout: error.stdout ?? "",
        stderr: error.stderr ?? "",
      }),
    );
    const report = JSON.parse(await readFile(path.join(directory, "report.json"), "utf8")) as {
      numPassedTests: number;
      numFailedTests: number;
      testResults: {
        assertionResults: { title: string; status: string; failureMessages: string[] }[];
      }[];
    };
    const events = (await readFile(path.join(directory, "events.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as string);
    return { ...result, report, events };
  } finally {
    // execFile settles after the child exits; no late fixture can recreate this directory.
    await rm(directory, { recursive: true, force: true });
  }
}

describe("withTestContext — real Vitest timeout lifecycle", () => {
  it("joins timed-out setup/body before cleanup and the next test, while preserving failures", async () => {
    const result = await runProbe(`
      test("slow setup", withTestContext(async () => {
        record("setup:start"); await delay(120); record("setup:end");
        return { teardown: async () => record("setup:cleanup") };
      }, async () => record("setup:body-must-not-run")));
      test("after setup", () => record("after:setup"));
      test("slow body", withTestContext(async () => {
        mkdirSync("owned");
        return { teardown: async () => { record("body:cleanup"); rmSync("owned", { recursive: true }); } };
      }, async () => {
        record("body:start"); await delay(120); writeFileSync("owned/late", "done"); record("body:write");
      }));
      test("after body", () => { if (existsSync("owned")) throw new Error("late directory survived"); record("after:body"); });
      test("setup rejects", withTestContext(async () => {
        try { throw new Error("setup failed"); } finally { record("reject-setup:cleanup"); }
      }, async () => record("reject-setup:body-must-not-run")));
      test("body rejects", withTestContext(async () => ({ teardown: async () => record("reject-body:cleanup") }),
        async () => { record("reject-body:start"); throw new Error("body failed"); }));
      test("teardown rejects", withTestContext(async () => ({ teardown: async () => {
        record("reject-teardown:cleanup"); throw new Error("teardown failed");
      } }), async () => record("reject-teardown:body")));
      test("success", withTestContext(async () => ({ teardown: async () => record("success:cleanup") }),
        async () => record("success:body")));
    `);
    expect(result.code).toBe(1);
    expect(result.report.numFailedTests).toBe(5);
    expect(result.report.numPassedTests).toBe(3);
    expect(result.events).toEqual([
      "setup:start",
      "setup:end",
      "setup:cleanup",
      "after:setup",
      "body:start",
      "body:write",
      "body:cleanup",
      "after:body",
      "reject-setup:cleanup",
      "reject-body:start",
      "reject-body:cleanup",
      "reject-teardown:body",
      "reject-teardown:cleanup",
      "success:body",
      "success:cleanup",
    ]);
    const cases = result.report.testResults.flatMap((suite) => suite.assertionResults);
    for (const title of ["slow setup", "slow body"]) {
      expect(cases.find((test) => test.title === title)?.status).toBe("failed");
    }
    // Vitest's JSON reporter uses the captured stack (STACK_TRACE_ERROR) for timeouts.
    expect(result.stdout + result.stderr).toContain("Test timed out in 40ms");
    for (const stage of ["setup", "body", "teardown"]) {
      expect(
        cases.find((test) => test.title === `${stage} rejects`)?.failureMessages.join("\n"),
      ).toContain(`${stage} failed`);
    }
    expect(result.stdout + result.stderr).not.toMatch(/Unhandled Rejection|Unhandled Error/);
  });

  it("fails the finite drain hook without destroying resources owned by an unsettled operation", async () => {
    const result = await runProbe(
      `
      test("never settles", withTestContext(async () => ({ teardown: async () => record("unsafe:drop") }),
        async () => { record("pending:body"); await new Promise(() => {}); }));
      test("observer", () => record("after:hook-timeout"));
    `,
      60,
    );
    expect(result.code).toBe(1);
    expect(result.report.numFailedTests).toBe(1);
    expect(result.events).toEqual(["pending:body", "after:hook-timeout"]);
    const failed = result.report.testResults
      .flatMap((suite) => suite.assertionResults)
      .find((test) => test.title === "never settles");
    expect(failed?.status).toBe("failed");
    expect(result.stdout + result.stderr).toContain("Hook timed out in 60ms");
  });
});
