import { expect, test } from "@playwright/test";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

/**
 * The ONE smoke definition, scripts/smoke-predeploy.mjs (SP), and its post-deploy adapter,
 * infra/smoke-check.sh, in the default suite. The positive case runs SP against this config's real
 * `next start` (no stub). Every negative changes ONE answer of a healthy-shaped 127.0.0.1 stub; the
 * changed body carries a short unique marker that SP's output must never contain (no failure quotes
 * a body; short, because a JSON parse error quotes a body whole only up to 20 characters). SP runs
 * through an async execFile with an argument array (no shell), so this process's stub keeps answering.
 */
test.describe.configure({ timeout: 20_000 });

const run = promisify(execFile);
/** A path under the repo root, from this spec's own location (apps/web/e2e/). */
const repo = (path: string) => resolve(dirname(test.info().file), "../../..", path);

interface Answer {
  status: number;
  type?: string;
  location?: string;
  body?: string;
}
/** One answer per path; "hang" takes the request and never answers. */
type Routes = Record<string, Answer | "hang">;

const json = (body: string): Answer => ({ status: 200, type: "application/json", body });
const HEALTHY: Routes = {
  "/healthz": json('{"ok":true}'),
  "/": { status: 200, type: "text/html; charset=utf-8", body: "<!doctype html><title>s</title>" },
  "/manifest.webmanifest": { status: 200, type: "application/manifest+json", body: "{}" },
};

/** A healthy-shaped stub on an ephemeral 127.0.0.1 port, with `changes` applied; counts requests. */
async function stub(changes: Routes) {
  const routes: Routes = { ...HEALTHY, ...changes };
  let hits = 0;
  const server = createServer((request, response) => {
    hits += 1;
    const answer = routes[request.url ?? ""] ?? { status: 404 };
    if (answer === "hang") return;
    const headers: Record<string, string> = {};
    if (answer.type) headers["content-type"] = answer.type;
    if (answer.location) headers.location = answer.location;
    response.writeHead(answer.status, headers).end(answer.body ?? "");
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    hits: () => hits,
    close: () =>
      new Promise<void>((done) => {
        server.close(() => done());
        server.closeAllConnections();
      }),
  };
}

interface Ran {
  code: unknown;
  stdout: string;
  stderr: string;
}
/** Runs `file` with an argument array (no shell); resolves to its exit code and its output. */
async function exec(file: string, args: string[], env: Record<string, string>): Promise<Ran> {
  try {
    const options = { env: { ...process.env, ...env }, encoding: "utf8" as const, timeout: 15_000 };
    const { stdout, stderr } = await run(file, args, options);
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failed = error as Partial<Ran>;
    return { code: failed.code, stdout: failed.stdout ?? "", stderr: failed.stderr ?? "" };
  }
}
const sp = (base: string, timeoutMs = "5000") =>
  exec(process.execPath, [repo("scripts/smoke-predeploy.mjs")], {
    SMOKE_BASE_URL: base,
    SMOKE_TIMEOUT_MS: timeoutMs,
  });

test("smoke passes against the app's real next start with one line naming its three checks", async ({
  baseURL,
}) => {
  const out = await sp(baseURL ?? "");
  expect(out.code, out.stderr).toBe(0);
  const lines = out.stdout.trim().split("\n");
  expect(lines).toHaveLength(1);
  for (const part of [
    "smoke: PASS",
    "/healthz 200 ok=true",
    "/ 200 text/html",
    "/manifest.webmanifest 200 application/manifest+json",
  ]) {
    expect(lines[0]).toContain(part);
  }
});

test("smoke passes against the healthy-shaped stub (the control for every negative)", async () => {
  const healthy = await stub({});
  try {
    const out = await sp(healthy.url);
    expect(out.code, out.stderr).toBe(0);
    expect(healthy.hits()).toBe(3);
  } finally {
    await healthy.close();
  }
});

/** Each: the case, the ONE changed answer (its body holds the marker m), the check that fails. */
const negatives: [string, (m: string) => Routes, string][] = [
  [
    "a 302 on /healthz",
    (m) => ({
      "/healthz": { status: 302, location: "/elsewhere", body: m },
      "/elsewhere": json('{"ok":true}'),
    }),
    "/healthz",
  ],
  [
    "a 503 on /healthz",
    (m) => ({
      "/healthz": { status: 503, type: "application/json", body: `{"ok":true,"m":"${m}"}` },
    }),
    "/healthz",
  ],
  [
    "/healthz as text/plain",
    (m) => ({ "/healthz": { status: 200, type: "text/plain", body: `{"ok":true,"m":"${m}"}` } }),
    "/healthz",
  ],
  ["a 500 on /", (m) => ({ "/": { status: 500, type: "text/html", body: m } }), "/"],
  ["a non-JSON /healthz body", (m) => ({ "/healthz": json(`ok ${m}`) }), "/healthz"],
  [
    "two JSON documents on /healthz",
    (m) => ({ "/healthz": json(`{"ok":true}{"ok":true,"m":"${m}"}`) }),
    "/healthz",
  ],
  [
    'ok as the string "true"',
    (m) => ({ "/healthz": json(`{"ok":"true","m":"${m}"}`) }),
    "/healthz",
  ],
  ["/ as application/json", (m) => ({ "/": json(`{"m":"${m}"}`) }), "/"],
  [
    "the manifest as text/html",
    (m) => ({ "/manifest.webmanifest": { status: 200, type: "text/html", body: `<p>${m}</p>` } }),
    "/manifest.webmanifest",
  ],
];

for (const [name, change, check] of negatives) {
  test(`smoke fails on ${name}, names GET ${check} and never prints the body`, async () => {
    const marker = `MK${randomUUID().slice(0, 8)}`;
    const server = await stub(change(marker));
    try {
      const out = await sp(server.url);
      expect(out.code, out.stderr).toBe(1);
      expect(out.stderr).toContain(`GET ${check}: `);
      expect(out.stdout + out.stderr).not.toContain(marker);
    } finally {
      await server.close();
    }
  });
}

test("smoke fails within SMOKE_TIMEOUT_MS when /healthz never answers", async () => {
  const server = await stub({ "/healthz": "hang" });
  try {
    const started = Date.now();
    const out = await sp(server.url, "300");
    expect(out.code, out.stderr).toBe(1);
    expect(out.stderr).toContain("GET /healthz: ");
    expect(Date.now() - started).toBeLessThan(5_000);
  } finally {
    await server.close();
  }
});

test("smoke refuses a base that is not http(s) as a bad invocation (exit 2)", async () => {
  const out = await sp("ftp://x");
  expect(out.code, out.stderr).toBe(2);
  expect(out.stderr).toContain("SMOKE_BASE_URL must start with http(s)://");
});

test("the adapter refuses an http origin before any request", async () => {
  const server = await stub({});
  try {
    const out = await exec("bash", [repo("infra/smoke-check.sh"), server.url], {});
    expect(out.code, out.stderr).toBe(1);
    expect(out.stderr).toContain("smoke: origin must be https://");
    expect(server.hits()).toBe(0);
  } finally {
    await server.close();
  }
});
