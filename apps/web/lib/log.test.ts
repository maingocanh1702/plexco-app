import { afterEach, describe, expect, it, vi } from "vitest";
import { bound, ERROR_TEXT_MAX, log, parseLogLevel, sanitizeFields } from "./log";

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
