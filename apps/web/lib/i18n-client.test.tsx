import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LangProvider, makeT, normalizeLang, useT } from "./i18n-client";

function Probe() {
  const t = useT();
  return createElement("span", null, t("Xin chào", "Hello"));
}

describe("i18n-client", () => {
  it("t(vi, en) picks the literal for the language", () => {
    expect(makeT("vi")("Xin chào", "Hello")).toBe("Xin chào");
    expect(makeT("en")("Xin chào", "Hello")).toBe("Hello");
  });

  it("normalizeLang fails closed to vi for anything but en", () => {
    expect(normalizeLang("en")).toBe("en");
    expect(normalizeLang("vi")).toBe("vi");
    for (const bad of ["EN", "fr", "", null, undefined]) expect(normalizeLang(bad)).toBe("vi");
  });

  it("useT defaults to vi without a provider and follows LangProvider", () => {
    expect(renderToString(createElement(Probe))).toContain("Xin chào");
    const en = renderToString(
      createElement(LangProvider, { lang: "en", children: createElement(Probe) }),
    );
    expect(en).toContain("Hello");
  });
});
