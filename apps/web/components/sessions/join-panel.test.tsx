import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ApiClientError } from "../../lib/api-client";
import type { PublicJoinResult } from "../../lib/discover-api";
import { LangProvider, makeT } from "../../lib/i18n-client";
import { describePlayerError } from "../../lib/session-error-ui";
import { JoinPanelView } from "./join-panel";

// ApiErrorNotice calls useRouter(), and no app router is mounted in a static render.
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => {} }) }));

const noop = () => {};
const failure = (code: string, status: number) =>
  new ApiClientError(code, "server text", status, "req-1");
const render = (
  over: Partial<ComponentProps<typeof JoinPanelView>> = {},
  lang: "vi" | "en" = "en",
) =>
  renderToStaticMarkup(
    <LangProvider lang={lang}>
      <JoinPanelView
        access="ready"
        phase={{ kind: "idle" }}
        online
        onJoin={noop}
        onRetrySession={noop}
        onReload={noop}
        {...over}
      />
    </LangProvider>,
  );
const done = (result: Record<string, unknown>) => ({
  kind: "done" as const,
  result: result as unknown as PublicJoinResult,
});
/** Visible text only: tags stripped, the entities React escapes decoded. */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

describe("JoinPanelView", () => {
  it("idle: one enabled Join button", () => {
    const html = render();
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(text(html)).toContain("Join");
    expect(html).not.toContain("disabled");
    expect(html).not.toContain("aria-busy");
  });

  it("pending: the button is disabled and busy with the busy label", () => {
    const button = /<button[^>]*>Joining…<\/button>/.exec(
      render({ phase: { kind: "pending" } }),
    )?.[0];
    expect(button).toContain('disabled=""');
    expect(button).toContain('aria-busy="true"');
  });

  it("signed out: a Sign in to join link to / and no button to post with", () => {
    const html = render({ access: "signed-out" });
    expect(html).toContain('href="/"');
    expect(text(html)).toContain("Sign in to join.");
    expect(html).not.toContain("<button");
  });

  it("discovery role (session read answers 404): the web-app note, no button and no link", () => {
    const html = render({ access: "web-only" });
    expect(text(html)).toContain("Join on the Plexco web app.");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<a ");
  });

  it("session still loading: busy and nothing to press", () => {
    const html = render({ access: "loading" });
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain("<button");
  });

  it("session read failed (not 404): the retryable error state and no Join button", () => {
    const error = failure("CLIENT_NETWORK_ERROR", 0);
    const html = render({ access: { error } });
    expect(html).toContain('role="alert"');
    expect(text(html)).toContain(describePlayerError(error, makeT("en")).message);
    expect(text(html)).toContain("Try again");
    expect(text(html)).not.toContain("Join");
  });

  it("joined: active seat shows the result and a link to my sessions", () => {
    const html = render({ phase: done({ outcome: "active", waitlistPosition: null }) });
    expect(text(html)).toContain("You are in this session.");
    expect(html).toContain('href="/me/sessions"');
    expect(html).not.toContain("<button");
  });

  it("waitlisted shows position, no venue", () => {
    const html = render({
      phase: done({
        outcome: "waitlisted",
        waitlistPosition: 3,
        venueName: "San Cau Long A1",
        venueAddress: "12 Pho Hue",
      }),
    });
    expect(text(html)).toContain("You are on the waitlist #3");
    expect(html).not.toContain("San Cau Long A1");
    expect(html).not.toContain("12 Pho Hue");
  });

  it("requested: waiting for the host; an unknown outcome shows only the link", () => {
    expect(
      text(render({ phase: done({ outcome: "requested", waitlistPosition: null }) })),
    ).toContain("Request sent. Waiting for the host to approve.");
    const unknown = render({ phase: done({ outcome: null, waitlistPosition: null }) });
    expect(unknown).toContain('href="/me/sessions"');
    expect(unknown).not.toContain("role=");
  });

  it.each([
    ["AUTH_REQUIRED", 401, null],
    ["CSRF_INVALID", 403, null],
    ["RATE_LIMITED", 429, null],
    ["INVALID_BODY", 400, null],
    ["NOT_FOUND", 404, "/discover"],
    ["TENANT_SUSPENDED", 403, null],
    ["FORBIDDEN", 403, null],
    ["SESSION_NOT_FOUND", 404, "/discover"],
    ["SESSION_NOT_JOINABLE", 400, null],
    ["ALREADY_JOINED", 409, "/me/sessions"],
    ["REJOIN_REQUIRES_REVIEW", 409, null],
    ["CHARGE_DERIVATION_UNAVAILABLE", 503, null],
    ["GENDER_FORBIDDEN", 403, null],
    ["CLIENT_NETWORK_ERROR", 0, null],
    ["CLIENT_BAD_RESPONSE", 500, null],
    ["SOMETHING_NEW", 418, null],
  ])(
    "failed %s (%i): the mapped message, the mapped action and the next-step link",
    (code, status, link) => {
      const error = failure(code, status);
      const view = describePlayerError(error, makeT("en"));
      const html = render({ phase: { kind: "failed", error } });
      expect(html).toContain('role="alert"');
      expect(text(html)).toContain(view.message);
      expect(text(html).includes("Try again")).toBe(view.action === "retry");
      expect(text(html).includes("Reload data")).toBe(view.action === "reload");
      expect(text(html).includes("Sign in again")).toBe(view.action === "sign-in");
      for (const href of ["/discover", "/me/sessions"])
        expect(html.includes(`href="${href}"`)).toBe(href === link);
      // The Join button stays for a re-attempt, except after a mapped action of none (R 4.5.2 S-3).
      expect(html.match(/>Join<\/button>/g) ?? []).toHaveLength(view.action === "none" ? 0 : 1);
    },
  );

  it("failed CHARGE_DERIVATION_UNAVAILABLE and GENDER_FORBIDDEN never mention gender, price or pricing", () => {
    for (const lang of ["vi", "en"] as const) {
      for (const code of ["CHARGE_DERIVATION_UNAVAILABLE", "GENDER_FORBIDDEN"]) {
        const html = render({ phase: { kind: "failed", error: failure(code, 503) } }, lang);
        expect(text(html)).not.toMatch(/gender|giới tính|price|giá/i);
      }
    }
  });

  it("offline: the Join button is disabled and an offline hint shows", () => {
    const html = render({ online: false });
    expect(/<button[^>]*>Join<\/button>/.exec(html)?.[0]).toContain('disabled=""');
    expect(html).toContain('role="status"');
    expect(text(html)).toContain("You are offline");
  });

  it("failed with a mapped action of none: no Join button to press again, no offline hint", () => {
    for (const [code, status] of [
      ["INVALID_BODY", 400],
      ["NOT_FOUND", 404],
      ["TENANT_SUSPENDED", 403],
      ["FORBIDDEN", 403],
      ["SESSION_NOT_FOUND", 404],
      ["REJOIN_REQUIRES_REVIEW", 409],
    ] as const) {
      const error = failure(code, status);
      expect(describePlayerError(error, makeT("en")).action).toBe("none");
      const phase = { kind: "failed" as const, error };
      expect(render({ phase })).not.toContain("<button");
      expect(text(render({ phase, online: false }))).not.toContain("You are offline");
    }
  });

  type PanelProps = Partial<ComponentProps<typeof JoinPanelView>>;
  const DATA_STATES: [string, PanelProps, string][] = [
    ["session loading", { access: "loading" }, "loading"],
    ["signed out", { access: "signed-out" }, "ready"],
    ["web-only", { access: "web-only" }, "ready"],
    ["session read failed", { access: { error: failure("CLIENT_NETWORK_ERROR", 0) } }, "error"],
    ["joined", { phase: done({ outcome: "active", waitlistPosition: null }) }, "ready"],
    ["idle", {}, "ready"],
    ["pending", { phase: { kind: "pending" } }, "loading"],
    ["failed join", { phase: { kind: "failed", error: failure("RATE_LIMITED", 429) } }, "error"],
    [
      "failed join offline",
      { phase: { kind: "failed", error: failure("RATE_LIMITED", 429) }, online: false },
      "error",
    ],
    ["offline", { online: false }, "offline"],
  ];
  it.each(DATA_STATES)("P-19: the %s root renders data-state", (_name, over, expected) => {
    expect(/^<[a-z]+[^>]*data-state="([a-z]+)"/.exec(render(over))?.[1]).toBe(expected);
  });

  it("renders vi and en: distinct text in every state", () => {
    const cases: Partial<ComponentProps<typeof JoinPanelView>>[] = [
      {},
      { phase: { kind: "pending" } },
      { access: "signed-out" },
      { access: "web-only" },
      { phase: done({ outcome: "waitlisted", waitlistPosition: 2 }) },
      { phase: { kind: "failed", error: failure("ALREADY_JOINED", 409) } },
      { online: false },
    ];
    for (const over of cases) expect(render(over, "vi")).not.toBe(render(over, "en"));
    expect(text(render({}, "vi"))).toContain("Tham gia");
  });
});
