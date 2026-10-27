import type { PendingJoinRequestDto } from "@plexco/core";
import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError, CLIENT_BAD_RESPONSE, CLIENT_NETWORK_ERROR } from "../../lib/api-client";
import { LangProvider } from "../../lib/i18n-client";
import { formatVnd } from "../../lib/money";
import {
  fetchPending,
  parsePending,
  RequestInboxView,
  RequestRowView,
  type RowPhase,
} from "./request-inbox";
import { SessionDetailView } from "./session-detail-view";

// ApiErrorNotice calls useRouter(), and no app router is mounted in a static render.
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => {} }) }));
// The tab test mounts the host detail on a ready session; only the tabs and the inbox stay real.
vi.mock("../../lib/use-sessions-data", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/use-sessions-data")>()),
  useSessionDetail: () => ({
    state: {
      status: "ready",
      data: {
        id: "s1",
        sportName: "Pickleball",
        startsAt: "2026-10-20T11:00:00.000Z",
        endsAt: "2026-10-20T13:00:00.000Z",
        timezone: "Asia/Ho_Chi_Minh",
        status: "open",
        version: 3,
      },
    },
    reload: () => {},
    refresh: () => {},
  }),
}));
vi.mock("../../lib/use-tenant-context", () => ({
  useTenantContext: () => ({ tenantId: "t1", csrfToken: "csrf", timezone: "UTC", lang: "en" }),
}));
vi.mock("./roster-tab", () => ({ RosterTab: () => null }));
vi.mock("./details-tab", () => ({ DetailsTab: () => null }));
vi.mock("./session-action-bar", () => ({ SessionActionBar: () => null }));
vi.mock("./visibility-toggle", () => ({ VisibilityToggle: () => null }));
vi.mock("./session-status-badge", () => ({ SessionStatusBadge: () => null }));
vi.mock("../ui/confirm-dialog", () => ({ ConfirmDialog: () => null }));
vi.mock("../ui/tabs", () => ({
  Tabs: ({ items }: { items: { id: string; label: string; panel: ReactNode }[] }) => (
    <>
      {items.map((item) => (
        <section key={item.id} data-tab={item.id}>
          <h2>{item.label}</h2>
          {item.panel}
        </section>
      ))}
    </>
  ),
}));

const REQUEST_ID = "0b8f3c1e-5d2a-4e7b-9a41-6c2f8d1e7a35";
const noop = () => {};
const request = (over: Partial<PendingJoinRequestDto> = {}): PendingJoinRequestDto => ({
  requestId: REQUEST_ID,
  displayName: "Lan Anh",
  createdAt: "2026-10-18T03:00:00.000Z",
  ...over,
});
const failure = (code: string, status: number) =>
  new ApiClientError(code, "server text", status, "req-1");
const wrap = (node: ReactNode, lang: "vi" | "en") =>
  renderToStaticMarkup(<LangProvider lang={lang}>{node}</LangProvider>);
/** Visible text only: tags stripped, the entities React escapes decoded. */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

const row = (
  phase: RowPhase = { kind: "idle" },
  over: Partial<ComponentProps<typeof RequestRowView>> = {},
  lang: "vi" | "en" = "en",
) =>
  wrap(
    <ul>
      <RequestRowView
        request={request()}
        phase={phase}
        online
        onDecide={noop}
        onReload={noop}
        {...over}
      />
    </ul>,
    lang,
  );
const inbox = (
  state: ComponentProps<typeof RequestInboxView>["state"],
  over: Partial<ComponentProps<typeof RequestInboxView>> = {},
  lang: "vi" | "en" = "en",
) =>
  wrap(
    <RequestInboxView
      state={state}
      online
      result={null}
      onReload={noop}
      renderRow={(r) => (
        <RequestRowView
          key={r.requestId}
          request={r}
          phase={{ kind: "idle" }}
          online
          onDecide={noop}
          onReload={noop}
        />
      )}
      {...over}
    />,
    lang,
  );
const ready = (...requests: PendingJoinRequestDto[]) => ({
  status: "ready" as const,
  data: { requests },
});

describe("RequestRowView", () => {
  it("renders name and time only", () => {
    // injected keys the DTO does not carry: none of them may reach the markup (B-12, B-14)
    const html = row(
      { kind: "idle" },
      {
        request: request({
          email: "lan@example.com",
          phone: "0900000000",
          amountDue: 150000,
        } as unknown as Partial<PendingJoinRequestDto>),
      },
    );
    expect(text(html)).toContain("Lan Anh");
    expect(text(html)).toContain("2026");
    for (const leak of ["lan@example.com", "0900000000", "150000", formatVnd(150000), REQUEST_ID]) {
      expect(html).not.toContain(leak);
    }
  });

  it("a missing name shows the fixed unnamed label and nothing else", () => {
    const named = request({ displayName: null });
    expect(text(row({ kind: "idle" }, { request: named }))).toContain("(unnamed)");
    expect(text(row({ kind: "idle" }, { request: named }, "vi"))).toContain("(chưa đặt tên)");
  });

  it("idle: Approve and Reject are enabled and not busy", () => {
    const html = row();
    expect(html.match(/<button/g)).toHaveLength(2);
    expect(text(html)).toContain("Approve");
    expect(text(html)).toContain("Reject");
    expect(html).not.toContain("disabled");
    expect(html).not.toContain("aria-busy");
  });

  it.each([
    ["approve", /<button[^>]*>Approving…<\/button>/],
    ["reject", /<button[^>]*>Rejecting…<\/button>/],
  ] as const)(
    "in flight (%s): both buttons disabled, only the pressed one busy",
    (action, busy) => {
      const html = row({ kind: "pending", action });
      expect(html.match(/disabled=""/g)).toHaveLength(2);
      expect(html.match(/aria-busy="true"/g)).toHaveLength(1);
      expect(busy.exec(html)?.[0]).toContain('aria-busy="true"');
    },
  );

  it("done or offline: both buttons are disabled", () => {
    expect(row({ kind: "done" }).match(/disabled=""/g)).toHaveLength(2);
    expect(row({ kind: "idle" }, { online: false }).match(/disabled=""/g)).toHaveLength(2);
  });

  it.each([
    ["REQUEST_DECIDED", 409, "This request has already been decided.", "Reload data"],
    ["REQUEST_EXPIRED", 409, "This request has expired.", "Reload data"],
    ["JOIN_REQUEST_NOT_FOUND", 404, "This request was not found.", "Reload data"],
    ["COMMAND_ID_CONFLICT", 409, "Duplicate action.", "Reload data"],
    ["CHARGE_DERIVATION_UNAVAILABLE", 503, "can't be done right now", "Try again"],
    ["REJOIN_REQUIRES_REVIEW", 409, "Earlier payments need review", null],
    ["TENANT_SUSPENDED", 403, "This club is suspended.", null],
    ["CLIENT_NETWORK_ERROR", 0, "", "Try again"],
  ])("decide error %s maps to its catalog row", (code, status, message, action) => {
    const html = row({ kind: "failed", action: "approve", error: failure(code, status) });
    expect(html).toContain('role="alert"');
    expect(text(html)).toContain(message);
    expect(html.includes("Reload data")).toBe(action === "Reload data");
    expect(html.includes("Try again")).toBe(action === "Try again");
  });

  it("an unknown decide error fails closed with its reference and a retry", () => {
    const html = row({ kind: "failed", action: "reject", error: failure("SOMETHING_ELSE", 500) });
    expect(text(html)).toContain("req-1");
    expect(html).toContain("Try again");
    expect(html).not.toContain("server text");
  });
});

describe("RequestInboxView", () => {
  it("loading: skeletons, aria-busy and no buttons", () => {
    const html = inbox({ status: "loading" });
    expect(html).toContain('data-state="loading"');
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain("<button");
  });

  it("ready: one Approve and one Reject per pending request", () => {
    const html = inbox(ready(request(), request({ requestId: "other", displayName: null })));
    expect(html).toContain('data-state="ready"');
    expect(html.match(/<li/g)).toHaveLength(2);
    expect(html.match(/<button/g)).toHaveLength(4);
  });

  it("empty: the no pending requests state", () => {
    const html = inbox(ready());
    expect(html).toContain('data-state="empty"');
    expect(text(html)).toContain("No pending requests");
    expect(html).not.toContain("<button");
  });

  it("error: FORBIDDEN renders the notice and no list; an unknown code fails closed", () => {
    const forbidden = inbox({ status: "error", error: failure("FORBIDDEN", 403) });
    expect(forbidden).toContain('data-state="error"');
    expect(forbidden).toContain('role="alert"');
    expect(forbidden).not.toContain("<li");
    const unknown = inbox({ status: "error", error: failure("SOMETHING_ELSE", 500) });
    expect(text(unknown)).toContain("req-1");
    expect(unknown).toContain("Try again");
  });

  it.each([
    ["offline", { status: "error" as const, error: failure("CLIENT_NETWORK_ERROR", 0) }, true],
    ["navigator offline", { status: "loading" as const }, false],
  ])("%s: a status notice with Retry", (_name, state, online) => {
    const html = inbox(state, { online });
    expect(html).toContain('data-state="offline"');
    expect(html).toContain('role="status"');
    expect(html).toContain("Try again");
    expect(html).not.toContain('role="alert"');
  });

  it.each([
    [{ status: "approved", outcome: "active" }, "Approved: seat confirmed."],
    [{ status: "approved", outcome: "waitlisted", waitlistPosition: 2 }, "on the waitlist #2"],
    [{ status: "approved", outcome: "waitlisted", waitlistPosition: null }, "on the waitlist"],
    [{ status: "rejected" }, "Request rejected."],
    [{ status: "approved" }, "Request handled."],
  ])("result line from %j", (result, line) => {
    const html = inbox(ready(request()), { result });
    expect(html).toContain('role="status"');
    expect(text(html)).toContain(line);
    expect(text(html)).not.toContain("#null");
  });

  it("renders vi and en", () => {
    // a loading list is skeletons only (aria-hidden, no text), so it has no language to compare
    const states = [
      ready(request()),
      ready(),
      { status: "error" as const, error: failure("FORBIDDEN", 403) },
    ];
    for (const state of states) expect(inbox(state, {}, "vi")).not.toBe(inbox(state, {}, "en"));
    expect(text(inbox(ready(request()), {}, "vi"))).toContain("Duyệt");
    expect(text(inbox(ready(request()), {}, "en"))).toContain("Approve");
  });
});

describe("pending list read", () => {
  afterEach(() => vi.unstubAllGlobals());
  const codeOf = (fn: () => unknown) => {
    try {
      fn();
    } catch (error) {
      return (error as ApiClientError).code;
    }
    return null;
  };
  // fetch as a hung server sees it: settles only when its signal aborts (at once if it already did).
  const hang = (_url: string, init: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      const stop = () => reject(new DOMException("aborted", "AbortError"));
      if (init.signal?.aborted) stop();
      else init.signal?.addEventListener("abort", stop);
    });
  const answer = (data: unknown) =>
    new Response(JSON.stringify({ data, meta: { requestId: "req-1" } }), { status: 200 });
  const live = () => new AbortController().signal;
  const stamp = "2026-10-18T03:00:00.000Z";

  it.each([
    ["the body is null", null],
    ["there is no requests key", {}],
    ["requests is not a list", { requests: "none" }],
    ["a row is null", { requests: [null] }],
    ["a row has no requestId", { requests: [{ displayName: "Lan Anh", createdAt: stamp }] }],
    ["a row has no createdAt", { requests: [{ requestId: REQUEST_ID, displayName: "Lan Anh" }] }],
  ])("F-3: %s => CLIENT_BAD_RESPONSE, not a crash in render", (_label, body) => {
    expect(codeOf(() => parsePending(body))).toBe(CLIENT_BAD_RESPONSE);
  });

  it("F-3: each row is rebuilt to requestId, displayName and createdAt only", () => {
    const extra = { ...request(), playerId: "p-1", phone: "0900000000" };
    const nameless = { requestId: "r-2", createdAt: stamp };
    expect(parsePending({ requests: [extra, nameless] })).toEqual({
      requests: [request(), { ...nameless, displayName: null }],
    });
  });

  it("F-3: a 200 whose body is not the list fails the read; a well-formed one passes", async () => {
    vi.stubGlobal("fetch", async () => answer({ requests: "none" }));
    await expect(fetchPending("/api/x", live())).rejects.toMatchObject({
      code: CLIENT_BAD_RESPONSE,
    });
    vi.stubGlobal("fetch", async () => answer({ requests: [request()] }));
    await expect(fetchPending("/api/x", live())).resolves.toEqual({ requests: [request()] });
  });

  it("F-2: a hung read ends in CLIENT_NETWORK_ERROR once the time limit passes", async () => {
    vi.stubGlobal("fetch", hang);
    await expect(fetchPending("/api/x", live(), 20)).rejects.toMatchObject({
      code: CLIENT_NETWORK_ERROR,
    });
  });

  it("F-2: the loadable's own abort still ends the read, even one already aborted", async () => {
    vi.stubGlobal("fetch", hang);
    const running = new AbortController();
    const read = fetchPending("/api/x", running.signal, 60_000);
    running.abort();
    await expect(read).rejects.toMatchObject({ code: CLIENT_NETWORK_ERROR });
    const gone = new AbortController();
    gone.abort();
    await expect(fetchPending("/api/x", gone.signal, 60_000)).rejects.toMatchObject({
      code: CLIENT_NETWORK_ERROR,
    });
  });
});

describe("decision result line", () => {
  it("F-5: it is a programmatic focus target (tabindex -1) for when the decided row leaves", () => {
    const state: ComponentProps<typeof RequestInboxView>["state"] = {
      status: "ready",
      data: { requests: [request()] },
    };
    const tagOf = (html: string) => /<p[^>]*role="status"[^>]*>/.exec(html)?.[0] ?? "";
    const decided = inbox(state, { result: { status: "approved", outcome: "active" } });
    expect(tagOf(decided)).toContain('tabindex="-1"');
    expect(tagOf(inbox(state))).toBe("");
  });
});

describe("host session detail", () => {
  it("has a third Join requests tab that renders the inbox for the host session", () => {
    const html = wrap(<SessionDetailView tenantId="t1" sessionId="s1" />, "en");
    expect([...html.matchAll(/data-tab="(\w+)"/g)].map((m) => m[1])).toEqual([
      "roster",
      "details",
      "requests",
    ]);
    const tab = /<section data-tab="requests">([\s\S]*?)<\/section>/.exec(html)?.[1] ?? "";
    expect(text(tab)).toContain("Join requests");
    expect(tab).toContain('data-state="loading"');
  });
});
