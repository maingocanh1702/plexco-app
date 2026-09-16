import { createRequire } from "node:module";
import type pg from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  boundRawErrorCode,
  completionArgs,
  runDispatchCycle,
  type DeliveryOutcome,
} from "./dispatcher.js";

const { prepareValue } = createRequire(import.meta.url)("pg/lib/utils") as {
  prepareValue(value: unknown): unknown;
};
const malformed = {
  result: "dlq",
  nextAttemptAt: null,
  providerRef: null,
  errorCode: "malformed_outcome",
  rawErrorCode: null,
};
const privateError = "projector exception content must not be logged";
const throwing = () => {
  throw new Error(privateError);
};
const revoked = () => {
  const { proxy, revoke } = Proxy.revocable({}, {});
  revoke();
  return proxy;
};
const accessor = (key: string, result = "dlq") =>
  Object.defineProperty({ result }, key, { get: throwing });
const hostileDate = (epoch = Date.now() + 60_000) => {
  const date = new Date(epoch);
  for (const method of [
    "getTime",
    "getTimezoneOffset",
    "getFullYear",
    "getUTCFullYear",
    "toPostgres",
  ])
    Object.defineProperty(date, method, { value: throwing });
  return date;
};
const malformedCases: [string, () => unknown][] = [
  ["null", () => null],
  ["undefined", () => undefined],
  ["string", () => "delivered"],
  ["number", () => 1],
  ["boolean", () => false],
  ["bigint", () => 1n],
  ["symbol", () => Symbol("outcome")],
  ["array", () => []],
  ["function", () => throwing],
  ["missing result", () => ({})],
  ["unknown result", () => ({ result: "unknown" })],
  ["object result", () => ({ result: { toString: throwing } })],
  ["revoked outcome", revoked],
  ["result getter", () => accessor("result")],
  ["provider getter", () => accessor("providerRef", "delivered")],
  ["date getter", () => accessor("nextAttemptAt", "retry")],
  ["error getter", () => accessor("errorCode")],
  ["invalid retry/error getter", () => accessor("errorCode", "retry")],
  ["Date proxy", () => ({ result: "retry", nextAttemptAt: new Proxy(new Date(), {}) })],
];

beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

describe("completionArgs runtime boundary", () => {
  it.each(malformedCases)("fails closed for %s", (_name, make) => {
    expect(completionArgs(make())).toEqual(malformed);
  });
  it.each([undefined, null, "", "provider-1"])(
    "preserves delivered providerRef %s",
    (providerRef) => {
      expect(completionArgs({ result: "delivered", providerRef })).toEqual({
        result: "delivered",
        nextAttemptAt: null,
        providerRef: providerRef ?? null,
        errorCode: null,
        rawErrorCode: null,
      });
    },
  );
  it("rejects non-string provider references without invoking conversion hooks", () => {
    for (const providerRef of [0, false, 1n, Symbol("ref"), [], {}, { toPostgres: throwing }])
      expect(completionArgs({ result: "delivered", providerRef })).toEqual(malformed);
  });
  it.each(["\0", "\0provider", "provider\0ref", "provider\0"])(
    "rejects NUL-containing provider reference %j without changing the ID",
    (providerRef) => {
      expect(completionArgs({ result: "delivered", providerRef })).toEqual(malformed);
    },
  );
  it("keeps invalid retry precedence and snapshots a valid future instant", () => {
    const now = () => new Date(1_000_000);
    for (const nextAttemptAt of [undefined, null, "future", new Date(NaN), now(), new Date(0)])
      expect(completionArgs({ result: "retry", nextAttemptAt, errorCode: "X" }, now)).toEqual({
        ...malformed,
        errorCode: "malformed_next_attempt",
        rawErrorCode: "X",
      });
    const date = new Date(1_000_001);
    const args = completionArgs({ result: "retry", nextAttemptAt: date, errorCode: "X" }, now);
    expect(args).toEqual({
      result: "retry",
      nextAttemptAt: date,
      providerRef: null,
      errorCode: "x",
      rawErrorCode: "X",
    });
    expect(args.nextAttemptAt).not.toBe(date);
    expect(
      completionArgs({ result: "retry", nextAttemptAt: date, errorCode: "x" }, throwing),
    ).toEqual(malformed);
  });
  it("preserves non-string error grammar and safely describes a revoked proxy", () => {
    for (const raw of [
      42,
      true,
      10n,
      null,
      undefined,
      [],
      {},
      Symbol("code"),
      throwing,
      revoked(),
    ]) {
      for (const result of ["retry", "dlq"]) {
        const args = completionArgs({
          result,
          nextAttemptAt: new Date(Date.now() + 60_000),
          errorCode: raw,
        });
        expect(args.errorCode).toBe("malformed_error_code");
        expect(args.rawErrorCode).toBe(raw);
        expect(() => boundRawErrorCode(args.rawErrorCode)).not.toThrow();
      }
    }
    expect(boundRawErrorCode(revoked())).toBe("[object]");
  });
  it.each(["result", "providerRef", "nextAttemptAt", "errorCode"])("reads %s only once", (key) => {
    const outcome: Record<string, unknown> = {
      result: ["result", "providerRef"].includes(key) ? "delivered" : "retry",
      providerRef: "provider-1",
      nextAttemptAt: new Date(Date.now() + 60_000),
      errorCode: "X",
    };
    const value = outcome[key];
    const get = vi.fn().mockReturnValueOnce(value).mockImplementation(throwing);
    Object.defineProperty(outcome, key, { get });
    expect(completionArgs(outcome).errorCode).not.toBe("malformed_outcome");
    expect(get).toHaveBeenCalledTimes(1);
  });
});

const rows = [0, 1].map((i) => ({
  event_id: `00000000-0000-4000-8000-00000000000${i}`,
  tenant_id: "00000000-0000-4000-8000-000000000010",
  projector: "test_projector",
  claim_token: `00000000-0000-4000-8000-00000000010${i}`,
  attempts: i,
}));
function cycleFixture(
  first: () => unknown,
  options: {
    stale?: boolean;
    reject22023?: boolean;
    failure?: { at: "phase1" | "claim" | "completion" | "fallback"; error: Error };
  } = {},
) {
  let claimed = 0;
  const completions: unknown[][] = [];
  const deliver = vi.fn(async (): Promise<DeliveryOutcome> => ({
    result: "delivered",
    providerRef: "healthy",
  }));
  deliver.mockImplementationOnce(async () => first() as DeliveryOutcome);
  const query = vi.fn(async (sql: string, values: unknown[]) => {
    if (sql === "SELECT * FROM claim_outbox_batch($1)") {
      if (options.failure?.at === "phase1") throw options.failure.error;
      return { rows: [] };
    }
    if (sql === "SELECT * FROM claim_projector_delivery_batch($1, 1)") {
      if (options.failure?.at === "claim") throw options.failure.error;
      expect(values).toEqual(["test_projector"]);
      return { rows: claimed < rows.length ? [rows[claimed++]] : [] };
    }
    expect(sql).toBe(
      "SELECT complete_projector_delivery($1, $2, $3, $4, $5, $6, $7) AS complete_projector_delivery",
    );
    const row = rows[claimed - 1]!;
    expect(values.slice(0, 3)).toEqual([row.event_id, row.projector, row.claim_token]);
    values.forEach((value) => prepareValue(value));
    completions.push(values);
    if (options.failure?.at === "completion") throw options.failure.error;
    if (options.reject22023 && completions.length === 1)
      throw Object.assign(new Error("SQL grammar rejection"), { code: "22023" });
    if (options.failure?.at === "fallback" && completions.length === 2) throw options.failure.error;
    return { rows: [{ complete_projector_delivery: !options.stale }] };
  });
  const run = () =>
    runDispatchCycle({ query } as unknown as pg.Pool, {
      deliver,
      requiredProjectors: ["test_projector"],
      limit: 2,
    });
  return { run, deliver, query, completions };
}

describe("runDispatchCycle malformed completion containment", () => {
  const cases: [string, () => unknown, string, string][] = [
    ["null", () => null, "dlq", "malformed_outcome"],
    ["unknown result", () => ({ result: "unknown" }), "dlq", "malformed_outcome"],
    [
      "NUL provider reference",
      () => ({ result: "delivered", providerRef: "provider\0ref" }),
      "dlq",
      "malformed_outcome",
    ],
    [
      "provider object",
      () => ({ result: "delivered", providerRef: { toPostgres: throwing } }),
      "dlq",
      "malformed_outcome",
    ],
    ["result getter", () => accessor("result"), "dlq", "malformed_outcome"],
    ["error getter", () => accessor("errorCode"), "dlq", "malformed_outcome"],
    [
      "Date proxy",
      () => ({ result: "retry", nextAttemptAt: new Proxy(new Date(), {}) }),
      "dlq",
      "malformed_outcome",
    ],
    [
      "Date method overrides",
      () => ({ result: "retry", nextAttemptAt: hostileDate(), errorCode: "X" }),
      "retry",
      "x",
    ],
    [
      "invalid native Date",
      () => ({ result: "retry", nextAttemptAt: hostileDate(NaN), errorCode: "x" }),
      "dlq",
      "malformed_next_attempt",
    ],
    [
      "revoked error code",
      () => ({ result: "dlq", errorCode: revoked() }),
      "dlq",
      "malformed_error_code",
    ],
    ["deliver throws", throwing, "dlq", "deliver_threw"],
  ];
  it.each(cases)(
    "completes the next row after %s with the original claim fence",
    async (_name, first, result, code) => {
      const fixture = cycleFixture(first);
      expect(await fixture.run()).toMatchObject({
        processedDeliveries: 2,
        staleCompletionSkips: 0,
      });
      expect(fixture.deliver).toHaveBeenCalledTimes(2);
      expect(fixture.completions).toHaveLength(2);
      expect(fixture.completions[0]![3]).toBe(result);
      expect(fixture.completions[0]![5]).toBeNull();
      expect(fixture.completions[0]![6]).toBe(code);
      expect(fixture.completions[1]!.slice(3)).toEqual(["delivered", null, "healthy", null]);
      expect(console.warn).not.toHaveBeenCalledWith(expect.stringContaining(privateError));
    },
  );
  it("stops after a stale malformed completion without claiming the second row", async () => {
    const fixture = cycleFixture(() => null, { stale: true });
    expect(await fixture.run()).toMatchObject({ processedDeliveries: 0, staleCompletionSkips: 1 });
    expect(fixture.deliver).toHaveBeenCalledTimes(1);
    expect(fixture.completions).toHaveLength(1);
    expect(
      fixture.query.mock.calls.filter(([sql]) => sql.includes("claim_projector_delivery_batch")),
    ).toHaveLength(1);
  });
  it("uses one 22023 fallback with the same fence before continuing", async () => {
    const fixture = cycleFixture(() => ({ result: "delivered" }), { reject22023: true });
    expect(await fixture.run()).toMatchObject({ processedDeliveries: 2 });
    expect(fixture.completions).toHaveLength(3);
    expect(fixture.completions[0]!.slice(0, 3)).toEqual(fixture.completions[1]!.slice(0, 3));
    expect(fixture.completions[1]!.slice(3)).toEqual(["dlq", null, null, "malformed_outcome"]);
  });
  it.each(["phase1", "claim", "completion", "fallback"] as const)(
    "propagates %s infrastructure faults unchanged",
    async (at) => {
      const error = Object.assign(new Error("database unavailable"), { code: "57P01" });
      const fixture = cycleFixture(() => null, {
        reject22023: at === "fallback",
        failure: { at, error },
      });
      await expect(fixture.run()).rejects.toBe(error);
      expect(fixture.deliver.mock.calls.length).toBe(at === "phase1" || at === "claim" ? 0 : 1);
      expect(fixture.completions).toHaveLength(at === "fallback" ? 2 : at === "completion" ? 1 : 0);
    },
  );
});
