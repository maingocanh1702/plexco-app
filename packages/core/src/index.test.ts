import { describe, expect, it } from "vitest";
import * as core from "./index.js";

describe("@plexco/core barrel", () => {
  it("exposes every lifted module's key entrypoints", () => {
    expect(core.CORE_PACKAGE).toBe("@plexco/core");
    // time / dates
    expect(typeof core.todayIso).toBe("function");
    expect(typeof core.parseFlexibleDate).toBe("function");
    expect(typeof core.parseMoney).toBe("function");
    // i18n / format / vietqr
    expect(typeof core.t).toBe("function");
    expect(typeof core.fmtMoney).toBe("function");
    expect(typeof core.buildVietQrUrl).toBe("function");
    // sports / matching / payments
    expect(typeof core.sportPhrasesFor).toBe("function");
    expect(typeof core.matchWithConfidence).toBe("function");
    expect(typeof core.extractPayCode).toBe("function");
    expect(typeof core.classifyAmount).toBe("function");
    expect(typeof core.classifyCoverage).toBe("function");
  });
});
