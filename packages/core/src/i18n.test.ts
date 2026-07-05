import { afterEach, describe, expect, it } from "vitest";
import {
  getLang,
  getDefaultLang,
  parseLang,
  resolveLang,
  runWithLang,
  setLang,
  t,
} from "./i18n.js";

afterEach(() => setLang("vi"));

describe("t / runWithLang (ALS request context)", () => {
  it("defaults to vi; en inside runWithLang; no leak across contexts", () => {
    expect(t("xin chào", "hello")).toBe("xin chào");
    const inside = runWithLang("en", () => t("xin chào", "hello"));
    expect(inside).toBe("hello");
    expect(t("xin chào", "hello")).toBe("xin chào"); // context did not leak
  });

  it("ALS survives await inside the wrapped fn", async () => {
    const out = await runWithLang("en", async () => {
      await Promise.resolve();
      return t("vi", "en");
    });
    expect(out).toBe("en");
  });

  it("module fallback via setLang; getDefaultLang ignores ALS", () => {
    setLang("en");
    expect(getLang()).toBe("en");
    runWithLang("vi", () => {
      expect(getLang()).toBe("vi");
      expect(getDefaultLang()).toBe("en"); // broadcast paths ignore per-user ALS
    });
  });
});

describe("parseLang / resolveLang", () => {
  it("normalizes input and rejects unknown languages", () => {
    expect(parseLang(" EN ")).toBe("en");
    expect(parseLang("vi")).toBe("vi");
    expect(parseLang("fr")).toBeNull();
  });

  it("member locale wins over tenant default", () => {
    expect(resolveLang("en", "vi")).toBe("en");
    expect(resolveLang(null, "vi")).toBe("vi");
  });
});
