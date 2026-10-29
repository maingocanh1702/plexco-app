// Test-only (RO-L68-5): imported only by `*.test.ts`, never by a production file. Captures the REAL
// logger's three console sinks (error, warn, log), silenced.
// - captureConsoleSinks: around each case of the calling describe; asserts nothing itself.
// - expectTenantOnlyAfterTheGate: asserts the A-15 pair of probe lines (see its doc).
// - captureLogLine: asserts no fake reaches any sink's calls.
// - captureSignInLog: captureLogLine + the response's x-request-id matches the pattern, and the line
//   is at its sink's level, carries that id and no tenant_id.
import { afterEach, beforeEach, expect, vi } from "vitest";

const SINKS = ["error", "warn", "log"] as const;

/**
 * Spies and silences the sinks before each case of the calling describe and restores every spy
 * after it. `written()` = JSON of every sink's calls; `probes(event)` = the console.error lines of
 * `event`, parsed.
 */
export function captureConsoleSinks() {
  beforeEach(() => {
    for (const sink of SINKS) {
      vi.spyOn(console, sink).mockImplementation(() => {});
    }
  });
  afterEach(() => vi.restoreAllMocks());
  const written = () =>
    JSON.stringify([console.error, console.warn, console.log].map((s) => vi.mocked(s).mock.calls));
  const probes = (event: string) =>
    vi
      .mocked(console.error)
      .mock.calls.map((call) => String(call[0]))
      .filter((line) => line.includes(`"event":"${event}"`))
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  return { written, probes };
}

/**
 * L68 A-15, with `probes` from captureConsoleSinks: `l68.after` (written once the gate has proven
 * the tenant) = one line with the response's x-request-id and `tenant`; `l68.before` (written
 * inside the gate) = one line with that id and no tenant_id.
 */
export function expectTenantOnlyAfterTheGate(
  probes: (event: string) => Record<string, unknown>[],
  response: Response,
  tenant: string,
) {
  const id = response.headers.get("x-request-id");
  expect(probes("l68.after")).toEqual([
    expect.objectContaining({ request_id: id, tenant_id: tenant }),
  ]);
  expect(probes("l68.before")).toEqual([expect.objectContaining({ request_id: id })]);
  expect(probes("l68.before")[0]).not.toHaveProperty("tenant_id");
}

/**
 * Runs `act` at LOG_LEVEL `logLevel` with the sinks spied and silenced, then restores them and the
 * env. No fake reaches any sink's calls. Returns the response and the `event` line `method` wrote.
 */
export async function captureLogLine(
  fakes: readonly string[],
  logLevel: string,
  method: "error" | "warn",
  event: string,
  act: () => Promise<Response>,
) {
  vi.stubEnv("LOG_LEVEL", logLevel);
  const spies = SINKS.map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
  try {
    const res = await act();
    const written = JSON.stringify(spies.map((s) => s.mock.calls));
    for (const fake of fakes) expect(written).not.toContain(fake);
    const line = vi
      .mocked(console[method])
      .mock.calls.map((c) => JSON.parse(c[0] as string) as Record<string, unknown>)
      .find((l) => l.event === event);
    return { res, line };
  } finally {
    for (const s of spies) s.mockRestore();
    vi.unstubAllEnvs();
  }
}

/**
 * L68 D7, before sign-in: returns `captureLog(logLevel, method, event, act)` = captureLogLine with
 * `fakes`, where the response's x-request-id matches `requestId` and the line is at `method`'s
 * level, carries that id and no tenant (none exists before sign-in).
 */
export function captureSignInLog(fakes: readonly string[], requestId: RegExp) {
  return async (
    logLevel: string,
    method: "error" | "warn",
    event: string,
    act: () => Promise<Response>,
  ) => {
    const { res, line } = await captureLogLine(fakes, logLevel, method, event, act);
    expect(res.headers.get("x-request-id")).toMatch(requestId);
    expect(line).toMatchObject({ level: method, request_id: res.headers.get("x-request-id") });
    expect(line).not.toHaveProperty("tenant_id");
    return { res, line: line! };
  };
}
