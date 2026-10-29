import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bound,
  ERROR_TEXT_MAX,
  errorClass,
  log,
  parseLogLevel,
  sanitizeFields,
  setLogContextReader,
} from "./log";

/** Audit 2026-09-06 W-11 / NFR-O2 — the logger must never be a second leak path. */
describe("log — redaction and level (audit W-11)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.LOG_LEVEL;
  });

  it("redacts by key name: anything token/secret/cookie/handoff/code/state/nonce-like is never written", () => {
    const out = sanitizeFields(
      {
        handoff: "raw-handoff",
        idToken: "eyJ",
        csrfSecret: "s",
        cookie: "plx_session=abc",
        code: "4/0Aabc",
        state: "st",
        nonce: "n",
        codeVerifier: "v",
        expected: "app",
      },
      "info",
    );
    for (const k of [
      "handoff",
      "idToken",
      "csrfSecret",
      "cookie",
      "code",
      "state",
      "nonce",
      "codeVerifier",
    ]) {
      expect(out[k], k).toBe("[redacted]");
    }
    expect(out.expected).toBe("app");
  });

  it("redacts the gender keys (T-23, R-C1-e): gender, genderConsent and gender_enc are never written", () => {
    const out = sanitizeFields(
      { gender: "female", genderConsent: true, gender_enc: "AQID", sessionId: "s1" },
      "info",
    );
    for (const k of ["gender", "genderConsent", "gender_enc"]) {
      expect(out[k], k).toBe("[redacted]");
    }
    expect(out.sessionId).toBe("s1");
  });

  it("reduces an Error to name/message (+ SQLSTATE code), stack only at debug", () => {
    const err = Object.assign(new Error("permission denied for table sessions"), { code: "42501" });
    expect(sanitizeFields({ error: err }, "info").error).toEqual({
      name: "Error",
      message: "permission denied for table sessions",
      code: "42501",
    });
    expect(
      (sanitizeFields({ error: err }, "debug").error as { stack?: string }).stack,
    ).toBeTruthy();
  });

  /**
   * name/message/stack are typed as strings but are plain writable properties, and `code` comes
   * from whatever threw. A logger that throws while FORMATTING turns a handled error into an
   * unhandled one, so every field is described rather than coerced when it is not a string.
   */
  it("survives an Error whose name/message/stack are not strings, and describes them by type", () => {
    const err = new Error("x");
    Object.assign(err, { name: 42, message: { secret: "tenant" }, stack: [1, 2], code: 7 });
    let out!: Record<string, unknown>;
    expect(() => {
      out = sanitizeFields({ error: err }, "debug");
    }).not.toThrow();
    expect(out.error).toEqual({ name: "42", message: "[object]", stack: "[array]" });
    // a non-string `code` is not a SQLSTATE and is dropped entirely, as before
    expect(out.error).not.toHaveProperty("code");
  });

  it("bounds free text so an external error cannot push an unbounded payload into a log line", () => {
    const err = Object.assign(new Error("t".repeat(ERROR_TEXT_MAX + 25)), {
      code: "c".repeat(100),
    });
    const out = sanitizeFields({ error: err }, "info").error as {
      message: string;
      code: string;
    };
    expect(out.message).toBe(`${"t".repeat(ERROR_TEXT_MAX)}…[+25]`);
    expect(out.code).toBe(`${"c".repeat(64)}…[+36]`);
    expect(bound("short", 64)).toBe("short"); // within the bound, untouched
  });

  it("never serialises arbitrary objects (a Request or a row) — only their shape", () => {
    const out = sanitizeFields({ request: new Request("https://x/y"), rows: [1, 2, 3] }, "info");
    expect(out.request).toBe("[object]");
    expect(out.rows).toBe("[array:3]");
  });

  it("LOG_LEVEL parses known levels and fails closed to info on junk", () => {
    expect(parseLogLevel("debug")).toBe("debug");
    expect(parseLogLevel(" WARN ")).toBe("warn");
    expect(parseLogLevel(undefined)).toBe("info");
    expect(parseLogLevel("verbose")).toBe("info");
  });

  it("LOG_LEVEL ignores keys LEVELS only inherits from Object.prototype (fails closed to info)", () => {
    expect(parseLogLevel("__proto__")).toBe("info");
    expect(parseLogLevel("constructor")).toBe("info");
  });

  it("emits one JSON line per event on the level's console channel and honours LOG_LEVEL", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    process.env.LOG_LEVEL = "warn";
    log.error("auth.google.callback.unhandled", { error: new Error("kms down"), handoff: "x" });
    log.info("suppressed");
    expect(logSpy).not.toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalledOnce();
    const line = JSON.parse(errSpy.mock.calls[0]![0] as string) as Record<string, unknown>;
    expect(line.level).toBe("error");
    expect(line.event).toBe("auth.google.callback.unhandled");
    expect(line.handoff).toBe("[redacted]");
    expect((line.error as { message: string }).message).toBe("kms down");
    expect(typeof line.ts).toBe("string");
  });
});

/** L68 A-7 — the correlation keys come from the context reader alone, never from a caller. */
describe("log — context reader (L68)", () => {
  afterEach(() => {
    setLogContextReader(undefined);
    vi.restoreAllMocks();
  });

  it("D13: a caller field named request_id or tenant_id never appears, context or not", () => {
    // log.error: written at every LOG_LEVEL. `token`: key redaction still applies in a context.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const forged = {
      request_id: "forged-req",
      tenant_id: "forged-tenant",
      token: "FAKE-TOKEN-L68",
    };
    log.error("l68.no_reader", forged); // the Edge bundle: lib/log-context.ts is never loaded
    setLogContextReader(() => undefined); // Node, outside withRequestLogContext
    log.error("l68.outside", forged);
    setLogContextReader(() => ({ requestId: "req-ctx-l68" }));
    log.error("l68.no_tenant", forged);
    setLogContextReader(() => ({ requestId: "req-ctx-l68", tenantId: "tenant-ctx-l68" }));
    log.error("l68.with_tenant", forged);
    expect(errSpy).toHaveBeenCalledTimes(4);
    const [noReader, outside, noTenant, withTenant] = errSpy.mock.calls.map(
      (call) => JSON.parse(call[0] as string) as Record<string, unknown>,
    );
    for (const line of [noReader, outside]) {
      expect(line).not.toHaveProperty("request_id");
      expect(line).not.toHaveProperty("tenant_id");
    }
    expect(noTenant).toMatchObject({ request_id: "req-ctx-l68" });
    expect(noTenant).not.toHaveProperty("tenant_id");
    expect(withTenant).toMatchObject({ request_id: "req-ctx-l68", tenant_id: "tenant-ctx-l68" });
    expect(JSON.stringify(errSpy.mock.calls)).not.toContain("forged");
    expect(JSON.stringify(errSpy.mock.calls)).not.toContain("FAKE-TOKEN-L68");
  });
});

/** L68 A-16 (D7/D14) — an error by class only: the one object the logger writes as-is. */
describe("log — errorClass (L68)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  /** An Error carrying `code`, wrapped in `depth` causes. */
  const chain = (depth: number, code: string): Error => {
    let e: Error = Object.assign(new Error("FAKE-LEAF-L68"), { code });
    for (let i = 0; i < depth; i++) e = Object.assign(new Error("FAKE-WRAP-L68"), { cause: e });
    return e;
  };

  it("cuts the name to 64, freezes the result and describes a non-Error by its type", () => {
    const cls = errorClass(Object.assign(new Error("FAKE-MSG-L68"), { name: "N".repeat(100) }));
    expect(cls).toEqual({ name: "N".repeat(64) });
    expect(cls).not.toHaveProperty("code");
    expect(Object.isFrozen(cls)).toBe(true);
    expect(errorClass(Object.assign(new Error("x"), { name: 42 }))).toEqual({ name: "42" });
    expect(errorClass("FAKE-MSG-L68")).toEqual({ name: "string" });
    expect(errorClass(null)).toEqual({ name: "object" });
    expect(errorClass({ message: "FAKE-MSG-L68" })).toEqual({ name: "object" });
  });

  it("takes the first code on the cause chain within 8 hops, SQLSTATE/constant-shaped only", () => {
    expect(errorClass(chain(2, "40P01"))).toEqual({ name: "Error", code: "40P01" });
    expect(errorClass(chain(7, "40P01")).code).toBe("40P01"); // the 8th error the walk reads
    expect(errorClass(chain(8, "40P01"))).not.toHaveProperty("code");
    expect(errorClass(chain(0, "econnreset"))).not.toHaveProperty("code");
    expect(errorClass(chain(0, "A".repeat(33)))).not.toHaveProperty("code");
    expect(errorClass(chain(0, "A".repeat(32))).code).toBe("A".repeat(32));
  });

  it("logs the outer code when the outer error and its cause both carry one", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const both = (outer: string, inner: string) =>
      Object.assign(new Error("FAKE-WRAP-L68"), { code: outer, cause: chain(0, inner) });
    log.error("l68.two_codes", { error: errorClass(both("OUTER", "INNER")) });
    // An outer code of the wrong shape is skipped, so the first VALID code wins.
    log.error("l68.two_codes", { error: errorClass(both("econnreset", "ECONNRESET")) });
    const [first, second] = errSpy.mock.calls.map(
      (call) => (JSON.parse(call[0] as string) as Record<string, unknown>).error,
    );
    expect(first).toEqual({ name: "Error", code: "OUTER" });
    expect(second).toEqual({ name: "Error", code: "ECONNRESET" });
  });

  it.each(["", "debug"])("logs error: { name, code } and no message (LOG_LEVEL %j)", (level) => {
    vi.stubEnv("LOG_LEVEL", level);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    log.error("l68.class_only", { error: errorClass(chain(1, "40P01")) });
    const line = JSON.parse(errSpy.mock.calls[0]![0] as string) as Record<string, unknown>;
    expect(line.error).toEqual({ name: "Error", code: "40P01" });
    expect(JSON.stringify(errSpy.mock.calls)).not.toContain("FAKE-");
  });

  it("writes only an errorClass() result as-is: a copy or a look-alike is still [object]", () => {
    const cls = errorClass(chain(0, "40P01"));
    const out = sanitizeFields(
      { a: cls, b: { ...cls }, c: { name: "Error", code: "40P01" } },
      "info",
    );
    expect(out).toEqual({ a: { name: "Error", code: "40P01" }, b: "[object]", c: "[object]" });
  });
});
