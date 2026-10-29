import { afterEach, describe, expect, it, vi } from "vitest";
import { log } from "./log";
import { currentRequestId, setLogTenant, withRequestLogContext } from "./log-context";

const TARGET = "http://localhost/x";
const GENERATED = /^req_[0-9a-f-]{36}$/;
const FAKES = { token: "FAKE-TOKEN-L68", cookie: "FAKE-COOKIE-L68" };

const requestWithId = (id: string) => new Request(TARGET, { headers: { "x-request-id": id } });

/** The id `run` sees inside one wrapped request. */
async function idSeenFor(request: Request): Promise<string | undefined> {
  let seen: string | undefined;
  await withRequestLogContext(request, async () => {
    seen = currentRequestId();
    return new Response(null);
  });
  return seen;
}

/** Asserts no seeded fake reached the console, then returns the parsed JSON lines. */
function linesWithoutFakes(spy: { mock: { calls: unknown[][] } }): Record<string, unknown>[] {
  const written = JSON.stringify(spy.mock.calls);
  expect(written).not.toContain(FAKES.token);
  expect(written).not.toContain(FAKES.cookie);
  return spy.mock.calls.map((call) => JSON.parse(call[0] as string) as Record<string, unknown>);
}

/** L68 D2 — the inbound x-request-id is adopted only when id-safe; anything else is replaced. */
describe("withRequestLogContext — request id source (L68)", () => {
  it("A-1 adopts an id-safe inbound id as sent (8 and 64 chars, every safe character)", async () => {
    for (const id of ["abcd-123", "a".repeat(64), "trace.ID_42-xyz"]) {
      expect(await idSeenFor(requestWithId(id))).toBe(id);
    }
  });

  it("A-2 replaces an absent or unsafe id with a fresh req_<uuid>", async () => {
    // A real Headers refuses CR/LF (undici TypeError), so that row is a stub request.
    const crlf = { headers: { get: () => "abcdefgh\r\nset-cookie: a=b" } } as unknown as Request;
    const twoHeaders = new Request(TARGET, {
      headers: [
        ["x-request-id", "abcdefgh"],
        ["x-request-id", "ijklmnop"],
      ],
    });
    expect(twoHeaders.headers.get("x-request-id")).toBe("abcdefgh, ijklmnop");
    const replaced = [
      new Request(TARGET),
      crlf,
      ...['abcd"efgh', "abcdefg", "a".repeat(65), "", "   "].map(requestWithId),
      twoHeaders,
    ];
    for (const request of replaced) {
      const seen = await idSeenFor(request);
      expect(seen).toMatch(GENERATED);
      expect(seen).not.toBe(request.headers.get("x-request-id"));
    }
  });

  it("A-3 adopts a padded id trimmed", async () => {
    // A real Headers already trims on append, so the padded value is a stub request: only then
    // does the wrapper's own trim run.
    const padded = { headers: { get: () => "  abcdefgh  " } } as unknown as Request;
    expect(await idSeenFor(padded)).toBe("abcdefgh");
  });

  it("A-4 keeps the id across awaits, and overlapping requests keep their own", async () => {
    const res = await withRequestLogContext(requestWithId("abcdefgh-a4"), async () => {
      await new Promise((r) => setTimeout(r, 5));
      const afterTimer = currentRequestId();
      await Promise.resolve();
      return Response.json({ afterTimer, afterPromise: currentRequestId() });
    });
    expect(await res.json()).toEqual({ afterTimer: "abcdefgh-a4", afterPromise: "abcdefgh-a4" });

    // The first request starts first and also finishes first, so the two contexts cross rather
    // than nest: a save-and-restore global would hand the first request the second one's id.
    const ids = await Promise.all(
      ["fast-request-1", "slow-request-2"].map(async (id, i) => {
        const echoed = await withRequestLogContext(requestWithId(id), async () => {
          await new Promise((r) => setTimeout(r, i === 0 ? 1 : 10));
          return new Response(currentRequestId());
        });
        return echoed.text();
      }),
    );
    expect(ids).toEqual(["fast-request-1", "slow-request-2"]);
  });
});

/** L68 — what a log line and the response carry, inside and outside the wrapper. */
describe("log context — log lines and the response header (L68)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("A-5 outside a context: no id, setLogTenant sets nothing, and nothing outlives run", async () => {
    // log.error: written at every LOG_LEVEL, so these cases do not depend on the environment.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(currentRequestId()).toBeUndefined();
    expect(() => setLogTenant("t")).not.toThrow();
    log.error("l68.outside", FAKES);
    await withRequestLogContext(new Request(TARGET), async () => {
      log.error("l68.inside", FAKES);
      return new Response(null);
    });
    expect(currentRequestId()).toBeUndefined();
    const [outside, inside] = linesWithoutFakes(errSpy);
    expect(outside).not.toHaveProperty("request_id");
    expect(outside).not.toHaveProperty("tenant_id");
    expect(inside).toHaveProperty("request_id");
    expect(inside).not.toHaveProperty("tenant_id");
  });

  it("A-6 lines carry request_id, tenant_id from setLogTenant on, and the response echoes the id", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const status of [200, 401]) {
      errSpy.mockClear();
      let id: string | undefined;
      const res = await withRequestLogContext(new Request(TARGET), async () => {
        id = currentRequestId();
        log.error("l68.before_tenant", FAKES);
        setLogTenant("tenant-l68");
        log.error("l68.after_tenant", FAKES);
        return new Response(null, { status });
      });
      const [before, after] = linesWithoutFakes(errSpy);
      expect(id).toMatch(GENERATED);
      expect(before).toMatchObject({ request_id: id });
      expect(before).not.toHaveProperty("tenant_id");
      expect(after).toMatchObject({ request_id: id, tenant_id: "tenant-l68" });
      expect(res.status).toBe(status);
      expect(res.headers.get("x-request-id")).toBe(id);
    }
  });

  it("a throw from run propagates unchanged", async () => {
    const boom = new Error("boom");
    await expect(
      withRequestLogContext(new Request(TARGET), () => Promise.reject(boom)),
    ).rejects.toBe(boom);
  });
});
