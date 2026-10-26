import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ApiClientError } from "../../lib/api-client";
import { LangProvider, makeT } from "../../lib/i18n-client";
import { describePlayerError } from "../../lib/session-error-ui";
import { SessionProvider } from "../../lib/use-session";
import {
  PlayerLeaveSessionButton,
  PlayerLeaveSessionView,
  type LeavePhase,
} from "./player-leave-session-button";

// ApiErrorNotice calls useRouter(), and no app router is mounted in a static render.
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => {} }) }));

const LANGS = ["vi", "en"] as const;
const noop = () => {};
const failure = (code: string, status: number) =>
  new ApiClientError(code, "server text", status, "req-1");
const handlers = { onStart: noop, onConfirm: noop, onDismiss: noop, onReload: noop };
const render = (phase: LeavePhase, online = true, lang: "vi" | "en" = "en") =>
  renderToStaticMarkup(
    <LangProvider lang={lang}>
      <PlayerLeaveSessionView phase={phase} online={online} {...handlers} />
    </LangProvider>,
  );
/** Visible text only: tags stripped, the entities React escapes decoded. */
const text = (html = "") =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
const buttons = (html: string) => html.match(/<button\b[^>]*>.*?<\/button>/g) ?? [];
const disabled = (button: string) => button.includes(' disabled=""');

describe("PlayerLeaveSessionView", () => {
  it.each(LANGS)("idle (%s): one enabled Leave button, disabled offline", (lang) => {
    const online = buttons(render({ step: "idle" }, true, lang));
    expect(online.map(text)).toEqual([makeT(lang)("Rời buổi", "Leave session")]);
    expect(online.map(disabled)).toEqual([false]);
    expect(buttons(render({ step: "idle" }, false, lang)).map(disabled)).toEqual([true]);
  });

  it.each(LANGS)("confirm (%s): question, Confirm and Stay; offline disables Confirm", (lang) => {
    const t = makeT(lang);
    const html = render({ step: "confirm" }, true, lang);
    expect(text(html)).toContain(t("Rời buổi này?", "Leave this session?"));
    expect(buttons(html).map(text)).toEqual([t("Xác nhận", "Confirm"), t("Ở lại", "Stay")]);
    expect(buttons(html).map(disabled)).toEqual([false, false]);
    expect(html).not.toContain("aria-busy");
    expect(buttons(render({ step: "confirm" }, false, lang)).map(disabled)).toEqual([true, false]);
  });

  it.each(LANGS)("pending (%s): Confirm busy as Leaving, both buttons disabled", (lang) => {
    const t = makeT(lang);
    const found = buttons(render({ step: "pending" }, true, lang));
    expect(found.map(text)).toEqual([t("Đang rời…", "Leaving…"), t("Ở lại", "Stay")]);
    expect(found.map(disabled)).toEqual([true, true]);
    expect(found[0]).toContain('aria-busy="true"');
  });

  it.each(LANGS)("LEAVE_REQUIRES_HOST (%s): asks for the host, no retry control", (lang) => {
    const error = failure("LEAVE_REQUIRES_HOST", 409);
    const html = render({ step: "failed", error }, true, lang);
    expect(html).toContain('role="alert"');
    expect(text(html)).toBe(
      makeT(lang)(
        "Bạn không thể tự rời buổi này, hãy nhờ chủ kèo.",
        "You cannot leave this session yourself; ask the host.",
      ),
    );
    expect(buttons(html)).toHaveLength(0);
  });

  it.each([
    ["PLAYER_NOT_FOUND", 404, ["Tải lại dữ liệu", "Reload data"]],
    ["CLIENT_NETWORK_ERROR", 0, ["Thử lại", "Try again"]],
  ] as const)("%s (%s): the mapper's copy and its one control", (code, status, control) => {
    for (const lang of LANGS) {
      const error = failure(code, status);
      const html = render({ step: "failed", error }, true, lang);
      expect(text(html)).toContain(describePlayerError(error, makeT(lang)).message);
      expect(buttons(html).map(text)).toEqual([control[lang === "vi" ? 0 : 1]]);
    }
  });

  it("the container draws the idle view only, never the session id or the tenant uuid", () => {
    const html = renderToStaticMarkup(
      <LangProvider lang="en">
        <SessionProvider>
          <PlayerLeaveSessionButton
            sessionId="session-4b7e"
            tenantId="9c1d7a52-0e3b-4f68-8a21-5d6e7f809a1b"
            onLeft={noop}
            onReload={noop}
          />
        </SessionProvider>
      </LangProvider>,
    );
    expect(buttons(html).map(text)).toEqual(["Leave session"]);
    expect(html).not.toMatch(/session-4b7e|9c1d7a52/);
  });
});
