import { describe, expect, it } from "vitest";
import * as core from "./index.js";

describe("@plexco/core barrel", () => {
  it("exposes the browser-safe foundation modules", () => {
    expect(core.CORE_PACKAGE).toBe("@plexco/core");
    expect(typeof core.fmtMoney).toBe("function");
    expect(typeof core.esc).toBe("function");
    expect(typeof core.buildVietQrUrl).toBe("function");
    expect(typeof core.sportPhrasesFor).toBe("function");
    expect(typeof core.sportStopwordTokens).toBe("function");
  });

  it("stays browser-safe: server-only i18n is NOT re-exported here", () => {
    // i18n uses node:async_hooks — it ships via the subpath @plexco/core/i18n.
    expect("t" in core).toBe(false);
    expect("runWithLang" in core).toBe(false);
    expect("setLang" in core).toBe(false);
  });
});
