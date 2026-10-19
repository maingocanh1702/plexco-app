import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ApiClientError } from "../../lib/api-client";
import type { DiscoveryListing } from "../../lib/discover-api";
import { LangProvider, makeT } from "../../lib/i18n-client";
import { formatVnd } from "../../lib/money";
import { describePlayerError } from "../../lib/session-error-ui";
import { DiscoverListView, EMPTY_FILTER, type DiscoverListState } from "./discover-list-view";

// ApiErrorNotice calls useRouter(), and no app router is mounted in a static render.
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => {} }) }));

const LISTING: DiscoveryListing = {
  publicListingId: "listing-4c1e",
  sportKey: "badminton",
  startsAt: "2026-11-02T11:30:00.000Z",
  endsAt: "2026-11-02T13:00:00.000Z",
  title: "Cầu lông tối thứ 2",
  area: "Cầu Giấy",
  clubDisplayName: "Dev Club",
  priceAmount: 60000,
  slotsOpen: 4,
  joinPolicy: "open",
};
const IDLE = { busy: false, error: null as unknown };
const noop = () => {};
const ready = (items: DiscoveryListing[], nextCursor: string | null = null): DiscoverListState => ({
  status: "ready",
  items,
  nextCursor,
});
const failure = (code: string, status: number) =>
  new ApiClientError(code, "server text", status, "req-1");

const render = (state: DiscoverListState, lang: "vi" | "en" = "en", more = IDLE) =>
  renderToStaticMarkup(
    <LangProvider lang={lang}>
      <DiscoverListView
        state={state}
        draft={EMPTY_FILTER}
        onDraft={noop}
        onApply={noop}
        onReset={noop}
        onRetry={noop}
        more={more}
        onLoadMore={noop}
      />
    </LangProvider>,
  );
/** Visible text only: tags stripped, the entities React escapes decoded. */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
const stateOf = (html: string) => /data-state="([a-z]+)"/.exec(html)?.[1];

describe("DiscoverListView", () => {
  it("loading: a busy skeleton list and no card", () => {
    const html = render({ status: "loading" });
    expect(stateOf(html)).toBe("loading");
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain("/discover/");
  });

  it("ready: one card per listing, linked by publicListingId and never showing it as text", () => {
    const untitled = { ...LISTING, publicListingId: "other-listing-7", title: null };
    const html = render(ready([LISTING, untitled]));
    expect(stateOf(html)).toBe("ready");
    expect(html).toContain('href="/discover/listing-4c1e"');
    expect(html).toContain('href="/discover/other-listing-7"');
    const visible = text(html);
    expect(visible).not.toContain("listing-4c1e");
    expect(visible).not.toContain("other-listing-7");
    expect(visible).toContain("Cầu lông tối thứ 2");
    expect(visible).toContain(formatVnd(60000));
    expect(visible).toContain("4 spots open");
    expect(visible).toContain("Instant join");
    expect(visible).toMatch(/\d{2}:\d{2}.\d{2}:\d{2}/);
    expect(html).toContain(">Badminton</h2>"); // the untitled card is headed by its sport label
  });

  it("ready: an unknown sport key gets the neutral label, never the raw key", () => {
    const html = render(ready([{ ...LISTING, title: null, sportKey: "quidditch" }]));
    expect(html).toContain(">Session</h2>");
    expect(text(html)).not.toContain("quidditch");
  });

  it("ready: a missing price, slot count, join policy or area renders nothing, never a made-up 0", () => {
    const bare = {
      ...LISTING,
      priceAmount: null,
      slotsOpen: null,
      joinPolicy: null,
      area: null,
      clubDisplayName: null,
    };
    const visible = text(render(ready([bare])));
    expect(visible).not.toContain(formatVnd(0));
    for (const gone of ["spots open", "Instant join", "Host approval", "Cầu Giấy", "Dev Club"]) {
      expect(visible).not.toContain(gone);
    }
  });

  it("ignores non-whitelisted keys: gender, per-gender price, bank, QR, venue and session ids never render", () => {
    const injected = {
      ...LISTING,
      genderRestriction: "female",
      priceByGender: { male: 70001, female: 50002 },
      bankAccount: "0123456789",
      qrUrl: "https://qr.example/pay",
      venueName: "San Cau Long A1",
      venueAddress: "12 Pho Hue",
      sessionId: "6f1d0f7e-5d0c-4a52-9a53-0d3f6a1b2c3d",
    } as unknown as DiscoveryListing;
    const html = render(ready([injected]));
    for (const leaked of [
      "female",
      "70001",
      "50002",
      "0123456789",
      "qr.example",
      "San Cau Long A1",
      "12 Pho Hue",
      "6f1d0f7e",
    ]) {
      expect(html).not.toContain(leaked);
    }
  });

  it("empty: says no game matches and offers Reset filters next to the form's own", () => {
    const html = render(ready([]));
    expect(stateOf(html)).toBe("empty");
    expect(text(html)).toContain("No games match");
    expect(text(html).match(/Reset filters/g)).toHaveLength(2);
  });

  it("error: INVALID_FILTER keeps Reset filters reachable, DISCOVERY_RATE_LIMITED offers Try again, an unknown code shows its reference", () => {
    const t = makeT("en");
    const invalid = failure("INVALID_FILTER", 400);
    const html = render({ status: "error", error: invalid });
    expect(stateOf(html)).toBe("error");
    expect(html).toContain('role="alert"');
    expect(text(html)).toContain(describePlayerError(invalid, t).message);
    expect(text(html)).toContain("Reset filters");
    expect(text(html)).not.toContain("Try again");

    const limited = failure("DISCOVERY_RATE_LIMITED", 429);
    expect(text(render({ status: "error", error: limited }))).toContain(
      describePlayerError(limited, t).message,
    );
    expect(text(render({ status: "error", error: limited }))).toContain("Try again");

    const unknown = text(render({ status: "error", error: failure("SOMETHING_NEW", 418) }));
    expect(unknown).toContain("Reference");
    expect(unknown).toContain("req-1");
  });

  it("offline: a status notice with Try again", () => {
    const html = render({ status: "offline" });
    expect(stateOf(html)).toBe("offline");
    expect(html).toContain('role="status"');
    expect(text(html)).toContain("You are offline");
    expect(text(html)).toContain("Try again");
  });

  it("load more: only with a next cursor, busy and disabled while loading, failure notice under the kept list", () => {
    expect(text(render(ready([LISTING])))).not.toContain("Load more");
    const idle = render(ready([LISTING], "cursor-2"));
    expect(text(idle)).toContain("Load more");
    expect(idle).not.toContain("cursor-2");

    const busy = /<button[^>]*>Loading…<\/button>/.exec(
      render(ready([LISTING], "cursor-2"), "en", { busy: true, error: null }),
    )?.[0];
    expect(busy).toContain('disabled=""');
    expect(busy).toContain('aria-busy="true"');

    const failed = render(ready([LISTING], "cursor-2"), "en", {
      busy: false,
      error: failure("CLIENT_NETWORK_ERROR", 0),
    });
    expect(text(failed)).toContain("Cầu lông tối thứ 2");
    expect(failed).toContain('role="alert"');
  });

  it("renders vi and en: distinct text in every state", () => {
    const states: DiscoverListState[] = [
      { status: "loading" },
      ready([LISTING]),
      ready([]),
      { status: "error", error: failure("DISCOVERY_RATE_LIMITED", 429) },
      { status: "offline" },
    ];
    for (const state of states) {
      const viHtml = render(state, "vi");
      const enHtml = render(state, "en");
      expect(viHtml).not.toBe(enHtml);
      expect(text(viHtml)).toContain("Tìm kèo chơi");
      expect(text(enHtml)).toContain("Find a game");
    }
  });
});
