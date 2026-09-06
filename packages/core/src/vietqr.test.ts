import { describe, expect, it } from "vitest";
import { buildVietQrUrl, canBuildDynamicVietQr } from "./vietqr.js";

describe("buildVietQrUrl", () => {
  it("builds the img.vietqr.io compact2 URL", () => {
    const url = buildVietQrUrl({ bin: "970407", account: "1102696789", holder: "MAI NGOC ANH" });
    expect(url.startsWith("https://img.vietqr.io/image/")).toBe(true);
    expect(url).toContain("970407-1102696789-compact2.png");
  });

  it("encodes amount only when provided", () => {
    const withAmount = buildVietQrUrl({
      bin: "970407",
      account: "1102696789",
      holder: "MAI NGOC ANH",
      amount: 110000,
    });
    expect(withAmount).toContain("amount=110000");
    const without = buildVietQrUrl({
      bin: "970407",
      account: "1102696789",
      holder: "MAI NGOC ANH",
    });
    expect(without).not.toContain("amount=");
  });

  it("encodes addInfo and accountName", () => {
    const url = buildVietQrUrl({
      bin: "970407",
      account: "1102696789",
      holder: "MAI NGOC ANH",
      addInfo: "BMT7Q2A",
    });
    expect(url).toContain("addInfo=BMT7Q2A");

    const spaced = buildVietQrUrl({
      bin: "970407",
      account: "1102696789",
      holder: "MAI NGOC ANH",
      addInfo: "Hao jun13 badminton",
    });
    expect(spaced.includes("Hao%20jun13%20badminton") || spaced.includes("addInfo=Hao+jun13")).toBe(
      true,
    );

    const named = buildVietQrUrl({ bin: "970407", account: "1102696789", holder: "MAI NGOC ANH" });
    expect(named).toContain("accountName=");
    expect(named.includes("MAI%20NGOC%20ANH") || named.includes("MAI+NGOC+ANH")).toBe(true);
  });
});

describe("canBuildDynamicVietQr", () => {
  it("requires both bin and account", () => {
    expect(canBuildDynamicVietQr({ bankBin: "970407", bankAccount: "1102696789" })).toBe(true);
    expect(canBuildDynamicVietQr({ bankAccount: "1102696789" })).toBe(false);
    expect(canBuildDynamicVietQr({ bankBin: "970407" })).toBe(false);
    expect(canBuildDynamicVietQr({})).toBe(false);
  });
});

/**
 * Audit 2026-09-06 C-2 — bin/account are validated against the provider vocabulary before they
 * reach the URL path; amount must be a non-negative safe integer within the money ceiling.
 */
describe("buildVietQrUrl — input validation (audit C-2)", () => {
  const good = { bin: "970407", account: "1102696789", holder: "MAI NGOC ANH" };

  it("refuses a bin that is not exactly six digits", () => {
    for (const bin of ["97040", "9704077", "97040a", "970407/../x", ""]) {
      expect(() => buildVietQrUrl({ ...good, bin })).toThrow(/invalid bin/);
    }
  });

  it("refuses an account carrying path/query/fragment characters or over 19 chars", () => {
    for (const account of ["1102/../evil", "1102?x=1", "1102#frag", "1102 696", "", "1".repeat(20)]) {
      expect(() => buildVietQrUrl({ ...good, account })).toThrow(/invalid account/);
    }
    expect(buildVietQrUrl({ ...good, account: "AB12cd" })).toContain("970407-AB12cd-compact2.png");
  });

  it("refuses NaN, negative, fractional, Infinity and over-ceiling amounts; accepts 0 and the ceiling", () => {
    for (const amount of [Number.NaN, -1, 1.5, Number.POSITIVE_INFINITY, 1_000_000_000_001]) {
      expect(() => buildVietQrUrl({ ...good, amount })).toThrow(/invalid amount/);
    }
    expect(buildVietQrUrl({ ...good, amount: 0 })).toContain("amount=0");
    expect(buildVietQrUrl({ ...good, amount: 1_000_000_000_000 })).toContain("amount=1000000000000");
  });
});
