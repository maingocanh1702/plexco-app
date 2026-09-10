import { describe, expect, it } from "vitest";
import * as core from "./index.js";

describe("@plexco/core barrel", () => {
  it("exposes every browser-safe module's key entrypoints", () => {
    expect("CORE_PACKAGE" in core).toBe(false);
    // time / dates
    expect(typeof core.todayIso).toBe("function");
    expect(typeof core.parseFlexibleDate).toBe("function");
    expect(typeof core.parseMoney).toBe("function");
    // format / vietqr
    expect(typeof core.fmtMoney).toBe("function");
    expect(typeof core.esc).toBe("function");
    expect(typeof core.buildVietQrUrl).toBe("function");
    // sports / matching / payments
    expect(typeof core.sportPhrasesFor).toBe("function");
    expect(typeof core.sportStopwordTokens).toBe("function");
    expect(typeof core.matchWithConfidence).toBe("function");
    expect(typeof core.extractPayCode).toBe("function");
    expect(typeof core.classifyAmount).toBe("function");
    expect(typeof core.classifyCoverage).toBe("function");
  });

  it("stays browser-safe: server-only i18n is NOT re-exported here", () => {
    // i18n uses node:async_hooks — it ships via the subpath @plexco/core/i18n.
    expect("t" in core).toBe(false);
    expect("runWithLang" in core).toBe(false);
    expect("setLang" in core).toBe(false);
  });
});
