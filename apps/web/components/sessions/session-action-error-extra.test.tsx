import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ApiClientError } from "../../lib/api-client";
import { LangProvider } from "../../lib/i18n-client";
import { SessionActionErrorExtra } from "./session-action-error-extra";

const debt = (details?: unknown) =>
  new ApiClientError("CLOSE_BLOCKED_OPEN_DEBT", "m", 409, "r", details as never);
const render = (error: unknown, lang: "vi" | "en" = "vi") =>
  renderToStaticMarkup(
    <LangProvider lang={lang}>
      <SessionActionErrorExtra error={error} onShowRoster={() => {}} />
    </LangProvider>,
  );

describe("SessionActionErrorExtra", () => {
  it("CLOSE_BLOCKED_OPEN_DEBT lists display names (an unnamed one gets the placeholder) and the roster button", () => {
    const html = render(
      debt({
        openBalancePlayers: [
          { playerId: "p2", displayName: "Minh Trần" },
          { playerId: "p5", displayName: null },
        ],
      }),
    );
    expect(html).toContain("Người chơi còn thiếu tiền:");
    expect(html.match(/<li>/g)).toHaveLength(2);
    expect(html).toContain("<li>Minh Trần</li>");
    expect(html).toContain("<li>(chưa đặt tên)</li>");
    expect(html).toContain("Mở danh sách người chơi");
    expect(html).not.toContain("p2"); // ids are keys only, never text
  });

  it("is escaped: a hostile display name renders as text, never markup", () => {
    const html = render(
      debt({ openBalancePlayers: [{ playerId: "p1", displayName: "<img src=x onerror=1>" }] }),
    );
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("empty / malformed / absent details render nothing extra (the generic message stands alone)", () => {
    for (const details of [
      undefined,
      {},
      { openBalancePlayers: [] },
      { openBalancePlayers: "x" },
      { openBalancePlayers: [{ displayName: "no id" }] },
    ]) {
      expect(render(debt(details)), JSON.stringify(details)).toBe("");
    }
  });

  it("CANCEL_REQUIRES_REVIEW shows one generic hint: remove players one by one, reverse recorded payments", () => {
    const html = render(new ApiClientError("CANCEL_REQUIRES_REVIEW", "m", 400, "r"));
    expect(html).toContain("Gỡ từng người chơi");
    expect(html).toContain("hoàn tác các khoản thanh toán đã ghi");
    expect(html).toContain("Mở danh sách người chơi");
    expect(html).not.toContain("<li>");
    const en = render(new ApiClientError("CANCEL_REQUIRES_REVIEW", "m", 400, "r"), "en");
    expect(en).toContain("Remove the players one by one and reverse any recorded payments first");
    expect(en).not.toContain("Gỡ");
  });

  it("any other error renders nothing extra", () => {
    expect(render(new ApiClientError("STALE_VERSION", "m", 409, "r"))).toBe("");
    expect(render(new Error("x"))).toBe("");
    expect(render(null)).toBe("");
  });

  it("English twin of the list lead", () => {
    const html = render(
      debt({ openBalancePlayers: [{ playerId: "p1", displayName: "Lan" }] }),
      "en",
    );
    expect(html).toContain("Players with an open balance:");
    expect(html).toContain("Open the roster");
    expect(html).not.toContain("Người chơi");
  });
});
