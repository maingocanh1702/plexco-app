import { describe, expect, it } from "vitest";
import { esc, fmtMoney, mdCode } from "./format.js";

describe("fmtMoney", () => {
  it("formats integer minor units with vi-VN grouping + đ", () => {
    expect(fmtMoney(110000)).toBe("110.000đ");
    expect(fmtMoney(0)).toBe("0đ");
    expect(fmtMoney(2310000)).toBe("2.310.000đ");
  });
});

describe("esc (Telegram legacy-Markdown)", () => {
  it("escapes _ * ` [", () => {
    expect(esc("a_b*c`d[e]")).toBe("a\\_b\\*c\\`d\\[e]");
    expect(esc("plain")).toBe("plain");
  });
});

describe("mdCode", () => {
  it("renders inline code, neutralizing backticks", () => {
    expect(mdCode("BMT7Q2A")).toBe("`BMT7Q2A`");
    expect(mdCode("a`b")).toBe("`a'b`");
  });
});
