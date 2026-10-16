import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LangProvider } from "../../lib/i18n-client";
import type { SessionDetailDto } from "../../lib/sessions-api";
import { VisibilityToggle, discoveryGaps } from "./visibility-toggle";

const HOUR = 3_600_000;
// Only the fields the toggle reads (the roster-tab.test.tsx pattern).
const session = (over: Partial<SessionDetailDto>) =>
  ({
    id: "s1",
    status: "open",
    visibility: "private",
    startsAt: new Date(Date.now() + 24 * HOUR).toISOString(),
    area: "Quận 7",
    slotsMax: 12,
    version: 3,
    ...over,
  }) as SessionDetailDto;
const render = (over: Partial<SessionDetailDto>, lang: "vi" | "en" = "vi") =>
  renderToStaticMarkup(
    <LangProvider lang={lang}>
      <VisibilityToggle
        session={session(over)}
        ctx={{ tenantId: "t1", csrfToken: "csrf" }}
        editHref="/edit"
        onDone={() => {}}
        onReload={() => {}}
      />
    </LangProvider>,
  );
/** The toggle's own buttons sit before its (closed) confirm dialog: their count and the first. */
function trigger(html: string) {
  const region = html.split("<dialog")[0]!;
  const start = region.indexOf("<button");
  const tagEnd = region.indexOf(">", start);
  const text = region.slice(tagEnd + 1, region.indexOf("</button>", tagEnd));
  return { count: region.split("<button").length - 1, tag: region.slice(start, tagEnd + 1), text };
}

describe("VisibilityToggle", () => {
  it.each([
    ["vi", "open", "private", "Hiển thị: Riêng tư", "Chuyển sang Công khai"],
    ["vi", "draft", "private", "Hiển thị: Riêng tư", "Chuyển sang Công khai"],
    ["vi", "open", "public", "Hiển thị: Công khai", "Chuyển về Riêng tư"],
    ["en", "open", "private", "Visibility: Private", "Make public"],
    ["en", "open", "public", "Visibility: Public", "Make private"],
  ] as const)("W1-W3 %s %s %s: the served state and ONE enabled action", (...row) => {
    const [lang, status, visibility, state, action] = row;
    const html = render({ status, visibility }, lang);
    expect(html).toContain(`>${state}</p>`);
    const button = trigger(html);
    expect([button.count, button.text]).toEqual([1, action]);
    expect(button.tag).not.toMatch(/disabled|aria-describedby/);
  });

  it.each([
    { status: "closed" },
    { status: "cancelled" },
    { status: "paused" },
    { visibility: "secret" },
  ])("W4: %o renders nothing at all (fail closed)", (over) => expect(render(over)).toBe(""));

  it.each([
    ["vi", "Buổi đã bắt đầu nên không đổi được chế độ hiển thị nữa."],
    ["en", "The session has started, so its visibility can no longer be changed."],
  ] as const)("W5 %s: an open session past its start is disabled and says why", (lang, hint) => {
    const html = render({ startsAt: new Date(Date.now() - HOUR).toISOString() }, lang);
    const { tag } = trigger(html);
    expect(tag).toContain('disabled=""');
    const at = html.indexOf(`id="${/aria-describedby="([^"]+)"/.exec(tag)?.[1]}"`);
    expect(at, "the aria-describedby target exists").toBeGreaterThan(-1);
    const textStart = html.indexOf(">", at) + 1;
    expect(html.slice(textStart, html.indexOf("<", textStart))).toBe(hint);
  });

  it.each([
    [null, 8, ["area"]],
    ["", 8, ["area"]],
    ["   ", 8, ["area"]],
    ["Quận 1", null, ["slots"]],
    [null, null, ["area", "slots"]],
    ["Quận 1", 8, []],
  ] as const)("W6: discoveryGaps(%j, %j) is %j, the server's predicate", (area, slotsMax, gaps) => {
    expect(discoveryGaps({ area, slotsMax })).toEqual(gaps);
  });
});
