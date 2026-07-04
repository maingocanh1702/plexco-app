import { describe, expect, it } from "vitest";
import { CORE_PACKAGE } from "./index.js";

describe("workspace scaffold", () => {
  it("resolves @plexco/core entrypoint", () => {
    expect(CORE_PACKAGE).toBe("@plexco/core");
  });
});
