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
