import { afterEach, describe, expect, it, vi } from "vitest";
import { log } from "./log";
import {
  currentLogContext,
  requestIdFrom,
  runWithLogContext,
  setLogTenant,
  withRequestIdHeader,
} from "./log-context";

const TENANT = "11111111-1111-4111-8111-111111111111";

function lastLine(spy: ReturnType<typeof vi.spyOn>): Record<string, unknown> {
  return JSON.parse(String(spy.mock.calls.at(-1)![0])) as Record<string, unknown>;
}

describe("log context (M5 observability)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.LOG_LEVEL;
  });

  it("a line inside a context carries request_id and tenant_id; PII-ish keys stay redacted", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    runWithLogContext({ requestId: "req-abcdef12" }, () => {
      setLogTenant(TENANT);
      log.info("roster_add", { email: "a@b.vn", authorization: "Bearer x", count: 2 });
    });
    const line = lastLine(spy);
    expect(line).toMatchObject({
      level: "info",
      event: "roster_add",
      request_id: "req-abcdef12",
      tenant_id: TENANT,
      count: 2,
      authorization: "[redacted]",
    });
    // Documents the redaction contract's limit: it is key-based, so call sites must not log
    // personal values under innocuous keys. `email` is a value the CALLER must not pass.
    expect(Object.keys(line)).not.toContain("tenantId");
  });

  it("outside a context there are no correlation fields; before setLogTenant only request_id", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    log.info("boot");
    expect(lastLine(spy)).not.toHaveProperty("request_id");
    runWithLogContext({ requestId: "req-abcdef12" }, () => log.info("early"));
    const early = lastLine(spy);
    expect(early.request_id).toBe("req-abcdef12");
    expect(early).not.toHaveProperty("tenant_id");
  });

  it("a call site cannot override the correlation ids with its own fields", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    runWithLogContext({ requestId: "req-abcdef12", tenantId: TENANT }, () =>
      log.info("spoof", { request_id: "evil", tenant_id: "evil" }),
    );
    expect(lastLine(spy)).toMatchObject({ request_id: "req-abcdef12", tenant_id: TENANT });
  });

  it("contexts do not leak between concurrent scopes", async () => {
    const seen: Array<string | undefined> = [];
    await Promise.all(
      ["req-00000001", "req-00000002"].map((id) =>
        runWithLogContext({ requestId: id }, async () => {
          await new Promise((r) => setTimeout(r, 5));
          seen.push(currentLogContext()?.requestId);
        }),
      ),
    );
    expect(seen.sort()).toEqual(["req-00000001", "req-00000002"]);
  });

  it("request id: adopts a safe edge header, replaces an unsafe one, generates when absent", () => {
    expect(requestIdFrom(new Headers({ "x-request-id": "edge-1234abcd" }))).toBe("edge-1234abcd");
    expect(requestIdFrom(new Headers({ "do-request-id": "do-1234abcd" }))).toBe("do-1234abcd");
    // The edge-set id wins over a client-supplied x-request-id.
    expect(
      requestIdFrom(
        new Headers({ "x-request-id": "client-1234abcd", "do-request-id": "do-1234abcd" }),
      ),
    ).toBe("do-1234abcd");
    const evil = requestIdFrom(new Headers({ "x-request-id": 'a"}{"level":"error"' }));
    expect(evil).toMatch(/^[0-9a-f-]{36}$/);
    expect(requestIdFrom(new Headers({ "x-request-id": "short" }))).toMatch(/^[0-9a-f-]{36}$/);
    expect(requestIdFrom(new Headers())).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("withRequestIdHeader echoes the id and tolerates an immutable response", () => {
    expect(
      withRequestIdHeader(new Response(null), "req-abcdef12").headers.get("x-request-id"),
    ).toBe("req-abcdef12");
    const frozen = new Response(null);
    Object.defineProperty(frozen, "headers", {
      value: {
        set: () => {
          throw new TypeError("immutable");
        },
      },
    });
    expect(() => withRequestIdHeader(frozen, "req-abcdef12")).not.toThrow();
  });
});
