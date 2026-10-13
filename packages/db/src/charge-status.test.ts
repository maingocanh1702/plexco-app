import { describe, expect, it } from "vitest";
import { chargeStatusFor } from "./payment-manual.js";

// Pure unit test (no database): the ONE derivation of a charge's paid state (INV-7).
describe("chargeStatusFor", () => {
  it("nothing allocated is open", () => {
    expect(chargeStatusFor(100000, 0)).toBe("open");
  });
  it("part of the due is partial", () => {
    expect(chargeStatusFor(100000, 1)).toBe("partial");
    expect(chargeStatusFor(100000, 99999)).toBe("partial");
  });
  it("the whole due is paid", () => {
    expect(chargeStatusFor(100000, 100000)).toBe("paid");
  });
  it("a free session (due 0) is paid with nothing allocated", () => {
    expect(chargeStatusFor(0, 0)).toBe("paid");
  });
  it("an over-allocation (impossible by the CHECK) still reads paid, never partial", () => {
    expect(chargeStatusFor(100, 150)).toBe("paid");
  });
});
