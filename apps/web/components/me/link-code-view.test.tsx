import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { LinkUiState } from "../../lib/me-link-client";
import { LinkCodeView } from "./link-code-view";

const STATES: LinkUiState[] = [
  "idle",
  "submitting",
  "linked",
  "already_linked",
  "requires_review",
  "invalid",
  "rate_limited",
  "unavailable",
  "offline",
  "signed_out",
  "error",
];
const render = (state: LinkUiState, lang: "vi" | "en" = "en", code = "ABCD") =>
  renderToStaticMarkup(
    <LinkCodeView
      lang={lang}
      state={state}
      code={code}
      onCodeChange={() => {}}
      onSubmit={() => {}}
    />,
  );

describe("LinkCodeView", () => {
  it("has a labelled input, a polite live region and every state renders", () => {
    for (const state of STATES) {
      const html = render(state);
      expect(html).toContain('for="link-code"');
      expect(html).toContain('id="link-code"');
      expect(html).toContain('aria-live="polite"');
    }
  });

  it("every status state yields a different vi and en text with a non-colour prefix", () => {
    for (const state of STATES.filter((s) => s !== "idle" && s !== "submitting")) {
      const en = render(state, "en");
      const vi = render(state, "vi");
      expect(en).not.toBe(vi);
      expect(en).toMatch(/<strong>(Success|Problem):<\/strong>/);
      expect(vi).toMatch(/<strong>(Thành công|Lỗi):<\/strong>/);
    }
  });

  it("idle shows no status; submitting disables the controls", () => {
    expect(render("idle")).not.toContain("<strong>");
    const busy = render("submitting");
    expect(busy).toMatch(/<input[^>]*readOnly=""|<input[^>]*readonly=""/i);
    expect(busy).toContain('aria-busy="true"');
    expect(busy).toMatch(/<button[^>]*disabled/);
    expect(busy).toContain("Linking…");
  });

  it("an empty code disables submit; failures mark the input invalid", () => {
    expect(render("idle", "en", "")).toMatch(/<button[^>]*disabled/);
    expect(render("invalid")).toContain('aria-invalid="true"');
    for (const s of ["offline", "unavailable", "signed_out", "error", "rate_limited"] as const) {
      expect(render(s)).not.toContain("aria-invalid");
    }
    expect(render("linked")).not.toContain("aria-invalid");
  });

  it("requires_review explains support must merge", () => {
    expect(render("requires_review", "en")).toContain("cannot be linked automatically");
    expect(render("requires_review", "vi")).toContain("gộp thủ công");
    expect(render("requires_review", "en")).not.toContain("activity");
  });
});
