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
  "throttled",
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
    for (const s of [
      "offline",
      "unavailable",
      "signed_out",
      "error",
      "rate_limited",
      "throttled",
    ] as const) {
      expect(render(s)).not.toContain("aria-invalid");
    }
    expect(render("linked")).not.toContain("aria-invalid");
  });

  it("rate_limited (LINK_CODE_RATE_LIMITED) is true for the 600 s buckets AND the dead-code attempt cap: 10 minutes, then a new code", () => {
    const en = render("rate_limited", "en");
    const vi = render("rate_limited", "vi");
    expect(en).toContain("Wait 10 minutes");
    expect(en).toContain("for a new code");
    expect(vi).toContain("đợi 10 phút");
    expect(vi).toContain("lấy mã mới");
  });

  it("throttled (RATE_LIMITED, the 60 per 60 s actor ceiling) says a minute, never 10 minutes or a new code", () => {
    const en = render("throttled", "en");
    const vi = render("throttled", "vi");
    expect(en).toContain("Wait a minute");
    expect(vi).toContain("đợi 1 phút");
    for (const html of [en, vi]) {
      expect(html).not.toMatch(/10 (minutes|phút)/);
      expect(html).not.toMatch(/new code|mã mới/);
    }
  });

  it("requires_review explains support must merge", () => {
    expect(render("requires_review", "en")).toContain("cannot be linked automatically");
    expect(render("requires_review", "vi")).toContain("gộp thủ công");
    expect(render("requires_review", "en")).not.toContain("activity");
  });
});
